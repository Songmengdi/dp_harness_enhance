// 01/03 票验收：按 Agent 激活状态机（引导工具 → 激活 → 执行工具注册 + 引导隐藏 + skill + 会话证据恢复）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Exposure } from '../lib/exposure.js'

function makeAgent(id, events = []) {
  const registered = []
  const disposals = []
  const skills = []
  const tools = {
    register(def) {
      registered.push(def.name)
      return () => disposals.push(def.name)
    },
  }
  return {
    agent: {
      id,
      ctx: {
        tools,
        skills: {
          register(def) {
            skills.push(def.name)
            return () => disposals.push('skill:' + def.name)
          },
        },
      },
      options: { provider: 'p', model: 'm' },
      session: { header: { cwd: '/ws' }, events },
    },
    registered,
    disposals,
    skills,
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
    skillDefinition: { name: 'vision-bridge', description: 'd', content: 'c' },
    protocolSection: () => 'protocol',
  })
  return { exposure, execTools }
}

const tick = () => new Promise((r) => setImmediate(r))

test('exposure: 未激活 Agent 只有引导工具 + skill，没有执行工具 schema', async () => {
  const { exposure } = makeExposure()
  const { agent, registered, skills } = makeAgent('s1')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, ['vision_activate'])
  assert.deepEqual(skills, ['vision-bridge'])
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

test('exposure: 视觉模型会话整套隐身（无工具无 skill）', async () => {
  const { exposure } = makeExposure({ seesImages: async () => true })
  const { agent, registered, skills } = makeAgent('s3')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, [])
  assert.deepEqual(skills, [])
})

test('exposure: runtime 未就绪不发布任何工具，就绪后补发引导工具与 skill', async () => {
  let ready = false
  const { exposure } = makeExposure({ runtimeReady: () => ready })
  const { agent, registered, skills } = makeAgent('s4')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, [], 'runtime 未就绪时一个工具都没有')
  assert.deepEqual(skills, [])
  ready = true
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, ['vision_activate'])
  assert.deepEqual(skills, ['vision-bridge'])
})

test('exposure: 会话恢复凭持久事件里的激活证据重新 attach', async () => {
  const events = [
    { type: 'tool/call', data: { name: 'vision_media', arguments: '{}' } },
  ]
  const { exposure } = makeExposure()
  const { agent, registered, disposals } = makeAgent('s5', events)
  exposure.handleAgentCreated(agent)
  await tick()
  assert.equal(exposure.isActivated(agent), true, '有 vision_* 调用证据应直接激活')
  assert.deepEqual(registered, ['vision_media', 'vision_frames'], '不再注册引导工具')
  assert.deepEqual(disposals, [])
})

test('exposure: runtime 未就绪时 activate 不发布任何执行工具', async () => {
  let ready = false
  const { exposure } = makeExposure({ runtimeReady: () => ready })
  const { agent, registered } = makeAgent('s7')
  const result = exposure.activate(agent, 'paste')
  assert.equal(result.activated, false)
  assert.deepEqual(result.tools, [])
  assert.deepEqual(registered, [], 'runtime 未就绪不得注册执行工具')
  ready = true
  const later = exposure.activate(agent, 'paste')
  assert.equal(later.activated, true)
  assert.deepEqual(later.tools, ['vision_media', 'vision_frames'])
})

test('exposure: Agent 结束/卸载回收全部注册（含 skill）', async () => {
  const { exposure } = makeExposure()
  const { agent, disposals } = makeAgent('s6')
  exposure.handleAgentCreated(agent)
  await tick()
  exposure.activate(agent, 'tool')
  exposure.handleAgentDisposed(agent)
  assert.deepEqual(disposals, ['vision_activate', 'vision_media', 'vision_frames', 'skill:vision-bridge'])
})
