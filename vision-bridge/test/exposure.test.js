// 01 票验收：按 Agent 激活状态机（引导工具 → 激活 → 执行工具注册 + 引导隐藏）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Exposure } from '../lib/exposure.js'

function makeAgent(id) {
  const registered = []
  const disposals = []
  const tools = {
    register(def) {
      registered.push(def.name)
      return () => disposals.push(def.name)
    },
  }
  return {
    agent: {
      id,
      ctx: { tools },
      options: { provider: 'p', model: 'm' },
      session: { cwd: '/ws' },
    },
    registered,
    disposals,
  }
}

const noop = { info() {}, warn() {}, error() {} }

function makeExposure({ runtimeReady = () => true, seesImages = async () => false } = {}) {
  const execTools = [{ name: 'vision_media' }, { name: 'vision_frames' }]
  const exposure = new Exposure({}, {
    runtimeReady,
    seesImages,
    execTools: () => execTools,
    execToolNames: () => execTools.map((t) => t.name),
    logger: noop,
  })
  return { exposure, execTools }
}

const tick = () => new Promise((r) => setImmediate(r))

test('exposure: 未激活 Agent 只有引导工具，没有执行工具 schema', async () => {
  const { exposure } = makeExposure()
  const { agent, registered } = makeAgent('s1')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, ['vision_activate'])
  assert.equal(exposure.isActivated(agent), false)
})

test('exposure: vision_activate 激活后执行工具注册、引导工具隐藏、再次激活返回 false', async () => {
  const { exposure } = makeExposure()
  const { agent, registered, disposals } = makeAgent('s2')
  exposure.handleAgentCreated(agent)
  await tick()
  const first = exposure.activate(agent, 'tool')
  assert.equal(first.activated, true)
  assert.deepEqual(first.tools, ['vision_media', 'vision_frames'])
  assert.deepEqual(registered, ['vision_activate', 'vision_media', 'vision_frames'])
  assert.deepEqual(disposals, ['vision_activate'], '引导工具应被回收')
  const second = exposure.activate(agent, 'tool')
  assert.equal(second.activated, false)
  assert.deepEqual(second.tools, ['vision_media', 'vision_frames'])
})

test('exposure: 激活只影响当前 Agent，其他会话不受影响', async () => {
  const { exposure } = makeExposure()
  const a = makeAgent('a')
  const b = makeAgent('b')
  exposure.handleAgentCreated(a.agent)
  exposure.handleAgentCreated(b.agent)
  await tick()
  exposure.activate(a.agent, 'tool')
  assert.deepEqual(a.registered, ['vision_activate', 'vision_media', 'vision_frames'])
  assert.deepEqual(b.registered, ['vision_activate'], 'B 会话仍只有引导工具')
})

test('exposure: 视觉模型会话整套隐身', async () => {
  const { exposure } = makeExposure({ seesImages: async () => true })
  const { agent, registered } = makeAgent('s3')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, [])
})

test('exposure: runtime 未就绪不发布任何工具，就绪后补发引导工具', async () => {
  let ready = false
  const { exposure } = makeExposure({ runtimeReady: () => ready })
  const { agent, registered } = makeAgent('s4')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, [], 'runtime 未就绪时一个工具都没有')
  ready = true
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, ['vision_activate'])
})

test('exposure: Agent 结束/卸载回收全部注册', async () => {
  const { exposure } = makeExposure()
  const { agent, disposals } = makeAgent('s5')
  exposure.handleAgentCreated(agent)
  await tick()
  exposure.activate(agent, 'tool')
  exposure.handleAgentDisposed(agent)
  assert.deepEqual(disposals, ['vision_activate', 'vision_media', 'vision_frames'])
  const { agent: agent2, disposals: disposals2 } = makeAgent('s6')
  exposure.handleAgentCreated(agent2)
  await tick()
  exposure.activate(agent2, 'tool')
  exposure.disposeAll()
  assert.deepEqual(disposals2, ['vision_activate', 'vision_media', 'vision_frames'])
})
