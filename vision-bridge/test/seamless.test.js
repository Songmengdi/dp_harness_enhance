// 03 票验收：seamless 桥（粘贴落地 / read 拦截 / bash 出图）+ intent 提取 + 自动激活，全部按会话隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { Seamless } from '../lib/seamless.js'
import { FenceRegistry } from '../lib/paths.js'
import { intentFromPaste, intentFromRecent } from '../lib/intent.js'
import { SKILL_MARKER, activationSection } from '../lib/exposure.js'

const noop = { info() {}, warn() {}, error() {} }

function fakeCtx() {
  const handlers = new Map()
  return {
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, [])
      handlers.get(type).push(handler)
    },
    emit(type, ...args) {
      return Promise.all((handlers.get(type) ?? []).map((h) => Promise.resolve(h(...args))))
    },
    get(type) {
      return handlers.get(type)?.[0]
    },
  }
}

function makeAgent(id, ws, events = []) {
  return {
    id,
    options: { provider: 'p', model: 'm' },
    session: { header: { cwd: ws }, events },
    ctx: { tools: { register() { return () => {} } }, skills: { register() { return () => {} } } },
  }
}

function makeEnv(overrides = {}) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-03-'))
  const ws = join(tmp, 'ws')
  mkdirSync(ws, { recursive: true })
  const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
  const activations = []
  const exposure = {
    activate(agent, reason) {
      activations.push({ agent: agent.id, reason })
      return { activated: true, tools: [] }
    },
    protocolFor() { return '' },
  }
  const storedBytes = overrides.bytes ?? Buffer.from('fake-png-bytes')
  const attachments = {
    readImage: async (ref) => ({ ref, data: new Uint8Array(storedBytes) }),
  }
  const deps = {
    exposure,
    seesImages: overrides.seesImages ?? (async () => false),
    fences,
    logger: noop,
    attachments,
    remote: overrides.remote,
    isAutoDescribeEnabled: () => overrides.autoDescribeBashShots ?? false,
  }
  const ctx = fakeCtx()
  const seamless = new Seamless(ctx, deps)
  seamless.attach()
  const emit = (type, ...args) => ctx.emit(type, ...args)
  return { tmp, ws, fences, activations, attachments, seamless, emit }
}

test('seamless: 粘贴图片 → 内容哈希落地 + 同消息意图注入 + 自动激活', async () => {
  const env = makeEnv()
  try {
    const agent = makeAgent('s1', env.ws)
    const message = {
      id: 'm1',
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '帮我看看这张截图里的报错' },
        { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 14, width: 2, height: 2 } },
      ],
    }
    const next = async () => ({ kind: 'enter', messages: [message] })
    const decision = await env.emit('agent/pre-step', { agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, next).then((r) => r[0])
    assert.equal(decision.kind, 'enter')
    const allText = decision.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    assert.match(allText, /inputs\/vision-bridge\/[0-9a-f]{64}\.png/)
    assert.match(allText, /意图：帮我看看这张截图里的报错/)
    const inputs = readdirSync(join(env.ws, 'inputs', 'vision-bridge'))
    assert.equal(inputs.length, 1)
    assert.deepEqual(env.activations, [{ agent: 's1', reason: 'paste' }])
    // 同内容第二次粘贴 → 复用同一路径，不重复落盘
    await env.emit('agent/pre-step', { agent, messages: [message], turn: 2, step: 1, signal: new AbortController().signal }, next).then((r) => r[0])
    assert.equal(readdirSync(join(env.ws, 'inputs', 'vision-bridge')).length, 1, '同内容不重复落盘')
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('seamless: 粘贴无伴生文本 → 只注入路径，不编造意图；视觉模型会话原样放行', async () => {
  const env = makeEnv()
  try {
    const agent = makeAgent('s2', env.ws)
    const imageMessage = {
      id: 'm2', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: { attachmentId: 'a2', mediaType: 'image/png', bytes: 14, width: 2, height: 2 } }],
    }
    const next = async () => ({ kind: 'enter', messages: [imageMessage] })
    const decision = (await env.emit('agent/pre-step', { agent, messages: [imageMessage], turn: 1, step: 1, signal: new AbortController().signal }, next))[0]
    const text = decision.messages[0].content[0].text
    assert.ok(!text.includes('意图'), '无伴生文本不得注入意图')
    assert.match(text, /\.png$/)
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }

  const env2 = makeEnv({ seesImages: async () => true })
  try {
    const agent = makeAgent('s2v', env2.ws)
    const imageMessage = {
      id: 'm3', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: { attachmentId: 'a3', mediaType: 'image/png', bytes: 14, width: 2, height: 2 } }],
    }
    const next = async () => ({ kind: 'enter', messages: [imageMessage] })
    const decision = (await env2.emit('agent/pre-step', { agent, messages: [imageMessage], turn: 1, step: 1, signal: new AbortController().signal }, next))[0]
    assert.equal(decision.messages[0].content[0].type, 'image', '视觉模型会话图片块原样保留')
    assert.deepEqual(env2.activations, [])
  } finally {
    rmSync(env2.tmp, { recursive: true, force: true })
  }
})

test('seamless: read 拦截 deny 只给两行指路并触发激活', async () => {
  const env = makeEnv()
  try {
    const agent = makeAgent('s3', env.ws)
    writeFileSync(join(env.ws, 'a.png'), Buffer.from([1]))
    let denied = null
    const next = async () => ({ kind: 'allow' })
    for (const name of ['read', 'read_image']) {
      const r = (await env.emit('tools/pre-execute', { name, arguments: { file_path: join(env.ws, 'a.png') }, agent }, next))[0]
      if (r.kind === 'deny') denied = r
    }
    assert.ok(denied, 'read 应被 deny')
    const lines = denied.reason.split('\n').filter((l) => l.trim())
    assert.equal(lines.length, 2, 'deny reason 只允许两行')
    assert.match(denied.reason, /vision_glance/)
    assert.ok(!denied.reason.includes('明眼人协议'), '完整协议不随拦截重复注入')
    assert.deepEqual(env.activations, [
      { agent: 's3', reason: 'read-intercept' },
      { agent: 's3', reason: 'read-intercept' },
    ], 'read 与 read_image 各触发一次激活（第二次幂等）')
    // 非图片路径放行
    const pass = (await env.emit('tools/pre-execute', { name: 'read', arguments: { file_path: join(env.ws, 'note.txt') }, agent }, next))[0]
    assert.equal(pass.kind, 'allow')
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('seamless: bash 出图检测 → 注入路径+建议并激活；自动描述默认关', async () => {
  const env = makeEnv()
  try {
    const agent = makeAgent('s4', env.ws)
    const shot = join(env.ws, 'shot.png')
    writeFileSync(shot, Buffer.from([1]))
    const result = { content: [{ type: 'text', text: `saved ${shot}` }] }
    const next = async () => ({ kind: 'accept', content: [{ type: 'text', text: 'bash ok' }] })
    const r = (await env.emit('tools/post-execute',
      { name: 'bash', arguments: { command: 'screencapture ' + shot }, agent },
      result, next))[0]
    assert.equal(r.kind, 'accept')
    assert.match(r.content[1].text, /检测到图片/)
    assert.match(r.content[1].text, /vision_glance/)
    assert.deepEqual(env.activations, [{ agent: 's4', reason: 'bash-shot' }])
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('seamless: 自动描述开启 → 最多前 2 张、带当前意图、失败不阻断原结果', async () => {
  const calls = []
  const remote = { run: async (sub, spec) => { calls.push({ sub, spec }); return { answer: '自动描述' } } }
  const events = [
    { type: 'user/message', data: { message: { content: [{ type: 'text', text: '帮我把界面重建出来' }], source: { kind: 'user' } } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好，我先截图。\n\n重点看顶部导航栏的配色' }], source: { kind: 'model' } } } },
  ]
  const env = makeEnv({ autoDescribeBashShots: true, remote })
  try {
    const agent = makeAgent('s5', env.ws, events)
    const a = join(env.ws, 'a.png'); const b = join(env.ws, 'b.png'); const c = join(env.ws, 'c.png')
    for (const p of [a, b, c]) writeFileSync(p, Buffer.from([1]))
    const result = { content: [{ type: 'text', text: `shot ${a} ${b} ${c}` }] }
    const next = async () => ({ kind: 'accept', content: [{ type: 'text', text: 'ok' }] })
    const r = (await env.emit('tools/post-execute', { name: 'bash', arguments: { command: 'x' }, agent }, result, next))[0]
    assert.equal(calls.length, 1)
    assert.equal(calls[0].sub, 'glance')
    assert.ok(calls[0].spec.images.length <= 2, '最多处理前 2 张')
    assert.equal(calls[0].spec.hint, '重点看顶部导航栏的配色', 'intent 取助手最后一段')
    assert.match(r.content[1].text, /自动描述/)
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }

  // 失败不阻断
  const failing = makeEnv({ autoDescribeBashShots: true, remote: { run: async () => { throw new Error('boom') } } })
  try {
    const agent = makeAgent('s5f', failing.ws, events)
    const a = join(failing.ws, 'a.png')
    writeFileSync(a, Buffer.from([1]))
    const result = { content: [{ type: 'text', text: `shot ${a}` }] }
    const next = async () => ({ kind: 'accept', content: [{ type: 'text', text: 'ok' }] })
    const r = (await failing.emit('tools/post-execute', { name: 'bash', arguments: { command: 'x' }, agent }, result, next))[0]
    assert.equal(r.kind, 'accept')
    assert.ok(!r.content[1].text.includes('自动描述'), '失败不阻断且不注入描述')
  } finally {
    rmSync(failing.tmp, { recursive: true, force: true })
  }
})

test('seamless: skill 加载本插件 skill（返回内容含标记）→ 激活当前 Agent', async () => {
  const env = makeEnv()
  try {
    const agent = makeAgent('s6', env.ws)
    await env.emit('tools/result', { name: 'skill', agent }, { content: [{ type: 'text', text: `<skill_content name="vision-bridge">...${SKILL_MARKER}...</skill_content>` }] })
    assert.deepEqual(env.activations, [{ agent: 's6', reason: 'skill-load' }])
    // 别的 skill 不触发
    const env2 = makeEnv()
    const agent2 = makeAgent('s6b', env2.ws)
    await env2.emit('tools/result', { name: 'skill', agent: agent2 }, { content: [{ type: 'text', text: '<skill_content name="other">...</skill_content>' }] })
    assert.deepEqual(env2.activations, [])
    rmSync(env2.tmp, { recursive: true, force: true })
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('intent: 粘贴意图只取同条消息；近期意图取助手最后一段，过滤注入内容', () => {
  const pasteMsg = {
    content: [
      { type: 'text', text: '看下这个按钮颜色' },
      { type: 'image', attachment: {} },
    ],
    source: { kind: 'user' },
  }
  assert.equal(intentFromPaste(pasteMsg), '看下这个按钮颜色')
  assert.equal(intentFromPaste({ content: [{ type: 'image', attachment: {} }], source: { kind: 'user' } }), '')

  const agent = {
    session: {
      events: [
        { type: 'user/message', data: { message: { content: [{ type: 'text', text: '最早的问题' }], source: { kind: 'user' } } } },
        { type: 'user/message', data: { message: { content: [{ type: 'text', text: 'system-reminder 注入' }], source: { kind: 'plugin', form: 'notice' } } } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '先做 A。\n\n最后一段：把登录按钮的蓝色换成品牌蓝' }], source: { kind: 'model' } } } },
      ],
    },
  }
  assert.equal(intentFromRecent(agent), '最后一段：把登录按钮的蓝色换成品牌蓝')
  const noAssistant = {
    session: {
      events: [
        { type: 'user/message', data: { message: { content: [{ type: 'text', text: '注入不算' }], source: { kind: 'plugin', form: 'instructions' } } } },
        { type: 'user/message', data: { message: { content: [{ type: 'text', text: '真实用户请求' }], source: { kind: 'user' } } } },
      ],
    },
  }
  assert.equal(intentFromRecent(noAssistant), '真实用户请求')
  // 500 字符截尾
  const long = intentFromPaste({ content: [{ type: 'text', text: 'x'.repeat(900) }], source: { kind: 'user' } })
  assert.equal(long.length, 500)
})

test('exposure: 激活说明段只含指路不含协议全文（协议只在 skill）', () => {
  const section = activationSection()
  assert.match(section, /vision_glance/)
  assert.match(section, /skill/)
  assert.ok(!section.includes('绝不接受只答「是/否/没有」'), '激活说明不应内嵌完整协议正文')
})
