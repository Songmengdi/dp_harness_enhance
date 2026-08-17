#!/usr/bin/env node
/**
 * vision-bridge 一次性 headless e2e runner（03 票验收）。
 *
 * 在真实 dsh host（dsh-base 组合）里跑通完整链路，不调用任何真实 LLM：
 *   1. 启动假 OpenAI-compatible 视觉上游（本进程内 http server）。
 *   2. 创建文本模型 Agent（fake provider/model → 能力判定失败 → 文本路径）。
 *   3. 真实 attachments 保存一张粘贴图 → agent/pre-step 瀑布 → 断言图片落地
 *      工作区固定输入目录 + 同消息意图注入 + 工具自动激活（引导隐藏）。
 *   4. ctx.tools.execute 真实管线：vision_ground → vision_crop → vision_pixel_diff。
 *   5. read 对图片的拦截（deny 两行指路）。
 *
 * 由 test/e2e.headless.test.js 经 `dsh --profile vision-bridge-e2e` 拉起。
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'vision-bridge-e2e-runner'
export const inject = ['cmdlineArgs', 'agents', 'tools', 'attachments', 'skills']

const PORT = Number(process.env.VB_E2E_PORT ?? 41877)
const GUIDE_WAIT_MS = 120_000

// 1x1 透明 PNG（合法可解码）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function startFakeUpstream(port) {
  let boxes = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      boxes += 1
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      reply({ choices: [{ message: { content: '{"matches":[{"label":"红块","box":[100,200,900,900]}]}' }, finish_reason: 'stop' }] })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ server, stats: () => ({ boxes }) }))
  })
}

export function apply(ctx) {
  const exit = ctx.get('appExit') ?? ((code) => process.exit(code))
  void run(ctx).then(
    (report) => {
      console.log('VISION_BRIDGE_E2E_REPORT ' + JSON.stringify(report))
      exit(report.pass ? 0 : 1)
    },
    (error) => {
      console.log('VISION_BRIDGE_E2E_REPORT ' + JSON.stringify({ pass: false, error: String(error?.stack ?? error) }))
      exit(1)
    },
  )
}

async function run(ctx) {
  const report = { name, pass: false, steps: [] }
  const step = (label, ok, detail = '') => {
    report.steps.push({ label, ok, detail })
    if (!ok) throw new Error(`e2e 步骤失败: ${label} ${detail}`)
  }
  await ctx.get('loader')?.await()

  const ws = mkdtempSync(path.join(os.tmpdir(), 'vb-e2e-ws-'))
  let upstream = null
  let handle = null
  try {
    upstream = await startFakeUpstream(PORT)

    // 创建文本模型 Agent（fake provider/model → 能力判定失败 → 文本路径）
    handle = await ctx.agents.create({
      sessionId: 'vision-e2e-' + crypto.randomUUID(),
      meta: { cwd: ws },
      agentOptions: { provider: 'vb-e2e-fake', model: 'vb-e2e-fake' },
    })
    const { agent } = handle

    // 禁用态断言（VB_EXPECT_DISABLED=1）：插件被 disabled 时任何 vision_* 工具都不该出现
    if (process.env.VB_EXPECT_DISABLED === '1') {
      await new Promise((r) => setTimeout(r, 2000))
      const gone = ctx.tools.get('vision_activate', agent) === undefined && ctx.tools.get('vision_ground', agent) === undefined
      step('禁用状态：无任何 vision_* 工具', gone, 'vision_activate=' + String(ctx.tools.get('vision_activate', agent) !== undefined))
      report.pass = true
      return report
    }

    // 等 runtime 就绪 + 引导工具注册
    let guideReady = false
    const deadline = Date.now() + GUIDE_WAIT_MS
    while (Date.now() < deadline) {
      if (ctx.tools.get('vision_activate', agent) !== undefined) {
        guideReady = true
        break
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    step('引导工具注册（未激活只有引导工具）', guideReady, guideReady ? '' : `${GUIDE_WAIT_MS}ms 内未就绪`)
    step('未激活 Agent 无执行工具 schema', ctx.tools.get('vision_ground', agent) === undefined)

    // 最小暴露：router-spec/router-standard 初始阶段不应让 vision-bridge skill 出现在 catalog
    const skillService = ctx.get('skills')
    const preSnapshot = await skillService.snapshot({ cwd: ws, scope: agent, signal: new AbortController().signal })
    const preSkillNames = preSnapshot.skills.map((s) => s.name)
    step('初始 catalog 不含 vision-bridge skill（最小暴露）', !preSkillNames.includes('vision-bridge'), preSkillNames.join(','))

    // 粘贴截图：真实 attachments 保存 → 真实 agent/pre-step 瀑布
    const ref = await ctx.attachments.saveImage({ data: TINY_PNG, mediaType: 'image/png', name: 'paste.png' })
    const pasteMessage = {
      id: 'paste-1',
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '帮我看这张图里红块的位置' },
        { type: 'image', attachment: ref },
      ],
    }
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent, messages: [pasteMessage], turn: 0, step: 0, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [pasteMessage] }),
    )
    const pasteOut = (decision?.messages ?? []).find((m) => m.id === 'paste-1')
    const landedText = ((pasteOut?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')) ?? ''
    step('粘贴图片被替换为工作区路径 + 同消息意图', /inputs[/\\]vision-bridge[/\\][0-9a-f]{64}\.png/.test(landedText) && landedText.includes('意图：帮我看这张图里红块的位置'), landedText.slice(0, 120))
    const landedMatch = landedText.match(/[^\s]*inputs[/\\]vision-bridge[/\\][0-9a-f]{64}\.png/)
    const landedPath = landedMatch ? landedMatch[0] : ''
    step('落地文件存在（持久输入目录）', landedPath !== '' && existsSync(landedPath), landedPath || landedText.slice(0, 120))

    // 粘贴触发自动激活：执行工具注册、引导工具隐藏
    await new Promise((r) => setTimeout(r, 50))
    step('粘贴后工具自动激活（vision_ground 可见）', ctx.tools.get('vision_ground', agent) !== undefined)
    step('激活后引导工具对当前 Agent 隐藏', ctx.tools.get('vision_activate', agent) === undefined)

    // skill 可见/可加载：激活路径必须把 vision-bridge skill 注册进当前 agent 的 catalog
    const skillSnapshot = await skillService.snapshot({ cwd: ws, scope: agent, signal: new AbortController().signal })
    const skillNames = skillSnapshot.skills.map((s) => s.name)
    step('激活后 vision-bridge skill 进入 agent catalog', skillNames.includes('vision-bridge'), skillNames.join(','))
    const loadedSkill = await skillService.get('vision-bridge', { scope: agent, signal: new AbortController().signal })
    step(
      'skill 可加载且内容含激活 marker',
      loadedSkill?.content?.includes('VISION_BRIDGE_ROUTE_C_SKILL_MARKER') === true,
      loadedSkill?.name ?? 'skill not found',
    )

    // 真实工具管线：ground → crop → pixel_diff（假上游）
    const groundResult = await ctx.tools.execute({
      callId: 'g1',
      name: 'vision_ground',
      arguments: { image: landedPath, target: 'TARGET-BOXES 红块' },
      agent,
      signal: new AbortController().signal,
    })
    step('vision_ground 成功', groundResult.isError === false, groundResult.isError ? JSON.stringify(groundResult.content) : '')
    const box = groundResult.value.matches?.[0]?.box
    step('ground 返回原图像素框', box !== undefined && box.x1 === 0 && box.y1 === 0 && box.x2 === 1 && box.y2 === 1, JSON.stringify(box))

    const cropResult = await ctx.tools.execute({
      callId: 'c1',
      name: 'vision_crop',
      arguments: { image: landedPath, region: `${box.x1},${box.y1},${box.x2 - box.x1},${box.y2 - box.y1}` },
      agent,
      signal: new AbortController().signal,
    })
    step('vision_crop 成功并产出 artifact', cropResult.isError === false && existsSync(cropResult.value.artifact.path), cropResult.isError ? JSON.stringify(cropResult.content) : cropResult.value.artifact.path)

    const diffResult = await ctx.tools.execute({
      callId: 'd1',
      name: 'vision_pixel_diff',
      arguments: { original: cropResult.value.artifact.path, rebuilt: cropResult.value.artifact.path, runName: 'e2e-self' },
      agent,
      signal: new AbortController().signal,
    })
    step('vision_pixel_diff 成功（同图 0 差异）', diffResult.isError === false && diffResult.value.ratioPct === 0, JSON.stringify(diffResult.isError ? diffResult.content : diffResult.value.ratioPct))

    // read 拦截：deny 两行指路
    const readResult = await ctx.tools.execute({
      callId: 'r1',
      name: 'read',
      arguments: { file_path: landedPath },
      agent,
      signal: new AbortController().signal,
    })
    const readText = (readResult.content ?? []).map((b) => b.text ?? '').join('\n')
    step('read 读图被拦截且只给两行指路', readResult.isError === true && readText.includes('读不了这张图') && readText.includes('vision_glance'), readText.slice(0, 160))
    step('上游假视觉模型被调用', upstream.stats().boxes >= 1, `boxes=${upstream.stats().boxes}`)

    report.pass = true
    report.upstreamCalls = upstream.stats().boxes
    return report
  } finally {
    if (handle) { try { await handle.dispose() } catch (e) { /* 忽略 */ } }
    if (upstream) { try { upstream.server.close() } catch (e) { /* 忽略 */ } }
    rmSync(ws, { recursive: true, force: true })
  }
}
