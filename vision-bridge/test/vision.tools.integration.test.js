// 02 票验收：假上游覆盖成功/重试/超时/协议变体 + 凭据脱敏 + 缓存 + 全链路（无真实 key）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { RuntimeManager } from '../lib/runtime-manager.js'
import { Runtime } from '../lib/runtime.js'
import { makeValidators } from '../lib/validators.js'
import { FenceRegistry } from '../lib/paths.js'
import { RemoteVision, GlanceCache } from '../lib/remote.js'
import { VisionError } from '../lib/errors.js'
import { defineGlanceTool } from '../lib/tools/glance.js'
import { defineGroundTool, defineDetectTool } from '../lib/tools/ground.js'
import { defineCropTool } from '../lib/tools/crop.js'
import { definePixelDiffTool } from '../lib/tools/pixel-diff.js'
import { defineDominantColorsTool } from '../lib/tools/dominant-colors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')
const noop = { info() {}, warn() {}, error() {} }
const SECRET = 'sk-test-02-secret'

function makeImages(dir) {
  mkdirSync(dir, { recursive: true })
  const py = `
from PIL import Image, ImageDraw
im = Image.new('RGB', (200, 120), '#336699')
d = ImageDraw.Draw(im)
d.rectangle([20, 20, 100, 100], fill='#ff0000')
im.save(${JSON.stringify(join(dir, 'base.png'))})
im2 = Image.new('RGB', (200, 120), '#336699')
d2 = ImageDraw.Draw(im2)
d2.rectangle([30, 20, 100, 100], fill='#ff0000')
im2.save(${JSON.stringify(join(dir, 'shifted.png'))})
`
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' })
  assert.equal(r.status, 0, `PIL 生成测试图失败: ${r.stderr}`)
}

function makeFakeUpstream() {
  const counters = {}
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const auth = String(req.headers.authorization ?? '')
      counters.auth = auth
      counters.authCalls = (counters.authCalls ?? 0) + 1
      let user = ''
      try { user = JSON.stringify(JSON.parse(body).messages?.[1]?.content ?? '') } catch (e) { /* ignore */ }
      const scenes = ['RETRY-429', 'HANG', 'ECHO-KEY', 'EMPTY', 'TRUNC', 'TARGET-REGION', 'TARGET-BOXES', 'DETECT-LIST', 'BAD-BOX', 'CACHE-500']
      const scene = scenes.find((s) => user.includes(s))
      if (scene) counters[scene] = (counters[scene] ?? 0) + 1
      const reply = (obj, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      switch (scene) {
        case 'RETRY-429':
          if ((counters['RETRY-429'] ?? 0) <= 2) return reply({ error: { message: 'busy' } }, 429)
          return reply({ choices: [{ message: { content: '重试成功' }, finish_reason: 'stop' }] })
        case 'HANG':
          return // 永不响应
        case 'ECHO-KEY':
          return reply({ error: { message: 'boom key=' + SECRET } }, 500)
        case 'EMPTY':
          return reply({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })
        case 'TRUNC':
          return reply({ choices: [{ message: { content: '截断回答' }, finish_reason: 'length' }] })
        case 'TARGET-REGION':
          return reply({ choices: [{ message: { content: '{"matches":[{"label":"红块","box":[0,0,1000,1000]}]}' }, finish_reason: 'stop' }] })
        case 'TARGET-BOXES':
          return reply({ choices: [{ message: { content: '{"matches":[{"label":"红块","box":[100,200,900,900]}]}' }, finish_reason: 'stop' }] })
        case 'DETECT-LIST':
          return reply({ choices: [{ message: { content: '{"matches":[{"label":"1: 确定","box":[100,200,400,500]},{"label":"2: 取消","box":[500,200,900,500]}]}' }, finish_reason: 'stop' }] })
        case 'BAD-BOX':
          return reply({ choices: [{ message: { content: '{"matches":[{"label":"坏框","box":[900,900,100,100]}]}' }, finish_reason: 'stop' }] })
        case 'CACHE-500':
          return reply({ error: { message: 'internal' } }, 500)
        default:
          return reply({ choices: [{ message: { content: '全景描述文本（默认回答）' }, finish_reason: 'stop' }] })
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, counters, endpoint: `http://127.0.0.1:${port}/v1` })
    })
  })
}

function makeEnv(up, overrides = {}) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-02-'))
  const ws = join(tmp, 'ws')
  makeImages(ws)
  const manager = new RuntimeManager({
    runtimeDir,
    stateDir: join(tmp, 'state'),
    python: 'python3',
    managed: false, // 测试用系统 python3（已装 Pillow），无需网络装依赖
    venvDir: '',
    requirementsFile: join(runtimeDir, 'requirements.lock'),
    prepareTimeoutMs: 60_000,
    logger: noop,
  })
  const runtime = new Runtime({ manager, defaultTimeoutMs: 60_000, maxConcurrency: 4, logger: noop, validators: makeValidators() })
  const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
  const fakeCtx = {
    credentials: {
      resolve: async (ref) => (String(ref) === 'TEST_VISION_KEY' ? { value: SECRET, source: 'test' } : undefined),
    },
  }
  const remote = new RemoteVision(fakeCtx, runtime, {
    endpoint: overrides.endpoint ?? up.endpoint,
    model: 'fake-vision',
    protocol: overrides.protocol ?? 'openai-completions',
    credential: 'TEST_VISION_KEY',
    language: '中文',
    visionTimeoutMs: 10_000,
    maxRetries: 2,
  }, noop)
  const cache = new GlanceCache(1_800_000, noop)
  const toolEnv = { fences, runtime }
  const remoteEnv = { fences, runtime, remote, cache }
  return {
    tmp,
    ws,
    manager,
    runtime,
    fences,
    remote,
    cache,
    toolEnv,
    remoteEnv,
    tools: {
      glance: defineGlanceTool(remoteEnv),
      ground: defineGroundTool(remoteEnv),
      detect: defineDetectTool(remoteEnv),
      crop: defineCropTool(toolEnv),
      pixelDiff: definePixelDiffTool(toolEnv),
      colors: defineDominantColorsTool(toolEnv),
    },
  }
}

function execFor(ws, signal = undefined) {
  return {
    signal: signal ?? new AbortController().signal,
    agent: { id: 'sess-02', session: { header: { cwd: ws } }, options: {} },
    callId: 'c1',
    name: '',
    arguments: {},
  }
}

test('glance: 描述/问答/OCR 与多图、互斥校验、截断标记', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const describe = await env.tools.glance.execute({ images: ['base.png'] }, execFor(env.ws))
    assert.equal(describe.mode, 'describe')
    assert.equal(describe.truncated, false)
    assert.match(describe.answer, /全景描述/)
    assert.equal(describe.images.length, 1)
    assert.equal(describe.images[0].width, 200)
    assert.equal(describe.images[0].height, 120)

    const trunc = await env.tools.glance.execute({ images: ['base.png'], query: 'TRUNC 说点什么' }, execFor(env.ws))
    assert.equal(trunc.mode, 'qa')
    assert.equal(trunc.truncated, true)

    const ocr = await env.tools.glance.execute({ images: ['base.png'], ocr: true }, execFor(env.ws))
    assert.equal(ocr.mode, 'ocr')

    const multi = await env.tools.glance.execute({ images: ['base.png', 'shifted.png'] }, execFor(env.ws))
    assert.equal(multi.images.length, 2)

    await assert.rejects(
      () => env.tools.glance.execute({ images: ['base.png'], query: 'x', ocr: true }, execFor(env.ws)),
      (e) => e instanceof VisionError && e.category === 'input',
    )
    await assert.rejects(
      () => env.tools.glance.execute({ images: ['base.png', 'shifted.png'], region: '0,0,10,10' }, execFor(env.ws)),
      (e) => e instanceof VisionError && e.category === 'input',
    )
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('glance: 凭据只进子进程环境、结果与错误不含密钥', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const value = await env.tools.glance.execute({ images: ['base.png'], query: 'ECHO-KEY 触发错误' }, execFor(env.ws)).catch((e) => e)
    assert.ok(value instanceof VisionError, '500 应映射为 VisionError')
    assert.equal(value.category, 'upstream')
    assert.ok(!value.message.includes(SECRET), '错误正文必须脱敏')
    assert.equal(up.counters.auth, 'Bearer ' + SECRET, '凭据应以 Bearer 进上游')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('glance: 429 退避重试（最多 2 次后成功）', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const value = await env.tools.glance.execute({ images: ['base.png'], query: 'RETRY-429' }, execFor(env.ws))
    assert.match(value.answer, /重试成功/)
    assert.equal(up.counters['RETRY-429'], 3, '两次 429 + 一次成功')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('glance: 网络挂死 → Python 硬超时（上游类别，重试耗尽）', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const err = await env.tools.glance.execute(
      { images: ['base.png'], query: 'HANG', timeoutMs: 600 },
      execFor(env.ws),
    ).catch((e) => e)
    assert.ok(err instanceof VisionError)
    assert.ok(['upstream', 'timeout'].includes(err.category), `实际类别: ${err.category}`)
    assert.equal(up.counters.HANG, 3, '应重试 3 次（1+2）')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('glance: Host 兜底超时杀进程 → timeout 类别', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    // 直接走 runtime：Python 侧超时很长，Host 300ms 兜底 SIGKILL
    const spec = {
      images: [join(env.ws, 'base.png')],
      query: 'HANG',
      endpoint: up.endpoint,
      model: 'fake-vision',
      language: '中文',
      protocol: 'openai-completions',
      maxRetries: 0,
      timeoutMs: 60_000,
    }
    const err = await env.runtime.run('glance', spec, { timeoutMs: 300, env: { DSH_VISION_API_KEY: SECRET } }).catch((e) => e)
    assert.ok(err instanceof VisionError && err.category === 'timeout', `实际: ${err}`)
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('ground/detect: 原图坐标 + region 映射回原图 + 退化框拒绝 + 逐字文字', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const ground = await env.tools.ground.execute({ image: 'base.png', target: 'TARGET-BOXES 红块' }, execFor(env.ws))
    assert.equal(ground.matches.length, 1)
    const box = ground.matches[0].box // 200x120, 归一化 [100,200,900,900]
    assert.deepEqual(box, { x1: 20, y1: 24, x2: 180, y2: 108 })

    // region 裁剪后送 VLM，输出仍映射回原图
    const region = await env.tools.ground.execute(
      { image: 'base.png', target: 'TARGET-REGION 红块', region: '50,30,100,60' },
      execFor(env.ws),
    )
    assert.deepEqual(region.matches[0].box, { x1: 50, y1: 30, x2: 150, y2: 90 })

    const detect = await env.tools.detect.execute({ image: 'base.png', category: 'DETECT-LIST 按钮' }, execFor(env.ws))
    assert.equal(detect.matches.length, 2)
    assert.match(detect.matches[0].label, /1: 确定/, 'label 必须含逐字可见文字')

    const bad = await env.tools.ground.execute({ image: 'base.png', target: 'BAD-BOX 坏框' }, execFor(env.ws))
    assert.deepEqual(bad.matches, [], '退化框被拒绝（跳过）')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('crop / pixel_diff / dominant_colors: 本地确定性 + 产物 staging→原子提交', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const crop = await env.tools.crop.execute({ image: 'base.png', region: '20,20,100,80', scale: 2 }, execFor(env.ws))
    assert.deepEqual(crop.box, { x1: 20, y1: 20, x2: 120, y2: 100 })
    assert.equal(crop.width, 200)
    assert.equal(crop.height, 160)
    assert.equal(crop.artifact.mimeType, 'image/png')
    assert.ok(existsSync(crop.artifact.path))
    assert.ok(!crop.artifact.path.endsWith('base.png'), '不得覆盖输入图')

    const diff = await env.tools.pixelDiff.execute(
      { original: 'base.png', rebuilt: 'shifted.png', runName: 'demo' },
      execFor(env.ws),
    )
    assert.ok(diff.ratioPct > 0 && diff.ratioPct < 100)
    assert.ok(diff.worstRegions.length >= 1 && diff.worstRegions.length <= 3)
    assert.ok(existsSync(diff.heatmap.path))
    assert.ok(existsSync(diff.report.path))
    assert.match(readFileSync(diff.report.path, 'utf8'), /差异比例/)

    const colors = await env.tools.colors.execute(
      { image: 'base.png', top: 3, candidates: ['#ff0000', '#336699', '#00ff00'] },
      execFor(env.ws),
    )
    assert.equal(colors.colors.length, 2)
    const total = colors.colors.reduce((s, c) => s + c.sharePct, 0)
    assert.ok(Math.abs(total - 100) < 2, `主色占比应约等于 100，实际 ${total}`)
    assert.equal(colors.winner, '#336699')
    const red = colors.candidates.find((c) => c.color === '#ff0000')
    assert.ok(red.sharePct > 20)
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('glance 会话级缓存: 相同输入命中、变化不命中、失败不缓存', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const a = await env.tools.glance.execute({ images: ['base.png'], query: 'CACHE 问题' }, execFor(env.ws))
    const b = await env.tools.glance.execute({ images: ['base.png'], query: 'CACHE 问题' }, execFor(env.ws))
    assert.equal(a.answer, b.answer)
    assert.equal(up.counters.authCalls, 1, '第二次应命中缓存不再发请求')

    await env.tools.glance.execute({ images: ['base.png'], query: 'CACHE 问题 v2' }, execFor(env.ws))
    assert.equal(up.counters.authCalls, 2)

    for (let i = 0; i < 2; i++) {
      await env.tools.glance.execute({ images: ['base.png'], query: 'CACHE-500' }, execFor(env.ws)).catch(() => {})
    }
    assert.equal(up.counters['CACHE-500'], 6, '失败不缓存：2 次调用 ×（1+2 次重试）= 6 个上游请求')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('headless 全链路: ground → crop → pixel_diff（假上游，无真实 key）', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const ground = await env.tools.ground.execute({ image: 'base.png', target: 'TARGET-BOXES 红块' }, execFor(env.ws))
    const b = ground.matches[0].box
    const region = `${b.x1},${b.y1},${b.x2 - b.x1},${b.y2 - b.y1}`
    const crop = await env.tools.crop.execute({ image: 'base.png', region }, execFor(env.ws))
    const diff = await env.tools.pixelDiff.execute(
      { original: crop.artifact.path, rebuilt: crop.artifact.path, runName: 'self' },
      execFor(env.ws),
    )
    assert.equal(diff.ratioPct, 0, '同图比较差异必须为 0')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

// ── Anthropic Messages 协议变体（火山方舟 /api/plan：x-api-key + /v1/messages） ──

function makeAnthropicUpstream() {
  const counters = { calls: 0, auth: '', version: '' }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      counters.calls += 1
      counters.auth = String(req.headers['x-api-key'] ?? '')
      counters.version = String(req.headers['anthropic-version'] ?? '')
      let user = ''
      try { user = JSON.stringify(JSON.parse(body).messages?.[0]?.content ?? '') } catch (e) { /* ignore */ }
      const reply = (obj, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (user.includes('TRUNC')) {
        return reply({ content: [{ type: 'text', text: '截断回答' }], stop_reason: 'max_tokens' })
      }
      return reply({ content: [{ type: 'text', text: 'anthropic 回答' }], stop_reason: 'end_turn' })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, counters, endpoint: `http://127.0.0.1:${server.address().port}/api/plan` }))
  })
}

test('glance anthropic 协议: x-api-key + /v1/messages + stop_reason=max_tokens → truncated', async () => {
  const up = await makeAnthropicUpstream()
  const env = makeEnv(up, { endpoint: up.endpoint, protocol: 'anthropic-messages' })
  try {
    const out = await env.tools.glance.execute({ images: ['base.png'], query: '看看这张图' }, execFor(env.ws))
    assert.match(out.answer, /anthropic 回答/)
    assert.equal(out.truncated, false)
    assert.equal(up.counters.auth, SECRET, 'x-api-key 应携带凭据')
    assert.equal(up.counters.version, '2023-06-01')

    const trunc = await env.tools.glance.execute({ images: ['base.png'], query: 'TRUNC 说点啥' }, execFor(env.ws))
    assert.equal(trunc.truncated, true, 'stop_reason=max_tokens 应映射为截断')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})
