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
        // AgentLoop 没有 inject `skills`，真实环境里 `agent.ctx.skills` 会抛错；
        // 必须用 `ctx.get('skills')` 显式获取。这里模拟这个契约。
        get(name) {
          if (name === 'skills') {
            return {
              register(def) {
                skills.push(def.name)
                return () => disposals.push('skill:' + def.name)
              },
            }
          }
          throw new Error(`cannot get property "${name}" without inject`)
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

test('exposure: 未激活 Agent 只有引导工具，没有执行工具 schema，也没有 skill（最小暴露）', async () => {
  const { exposure } = makeExposure()
  const { agent, registered, skills } = makeAgent('s1')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(registered, ['vision_activate'])
  assert.deepEqual(skills, [], 'router 最小暴露：初始不应把 skill 放进 catalog')
  assert.equal(exposure.isActivated(agent), false)
})

test('exposure: vision_activate 激活后执行工具注册、引导工具隐藏、skill 注入、再次激活返回 false', async () => {
  const { exposure } = makeExposure()
  const { agent, registered, disposals, skills } = makeAgent('s2')
  exposure.handleAgentCreated(agent)
  await tick()
  assert.deepEqual(skills, [], '激活前 skill 不可见')
  const first = exposure.activate(agent, 'tool')
  assert.equal(first.activated, true)
  assert.deepEqual(first.tools, ['vision_media', 'vision_frames'])
  assert.deepEqual(registered, ['vision_activate', 'vision_media', 'vision_frames'])
  assert.deepEqual(disposals, ['vision_activate'], '引导工具应被回收')
  assert.deepEqual(skills, ['vision-bridge'], '激活后 skill 注入 catalog')
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

test('exposure: runtime 未就绪不发布任何工具，就绪后只补发引导工具（skill 仍待触发）', async () => {
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
  assert.deepEqual(skills, [], '最小暴露：就绪后也不预注入 skill')
})

test('exposure: 会话恢复凭持久事件里的激活证据重新 attach', async () => {
  const events = [
    { type: 'tool/call', data: { name: 'vision_media', arguments: '{}' } },
  ]
  const { exposure } = makeExposure()
  const { agent, registered, disposals, skills } = makeAgent('s5', events)
  exposure.handleAgentCreated(agent)
  await tick()
  assert.equal(exposure.isActivated(agent), true, '有 vision_* 调用证据应直接激活')
  assert.deepEqual(registered, ['vision_media', 'vision_frames'], '不再注册引导工具')
  assert.deepEqual(skills, ['vision-bridge'], '会话恢复激活时也应注入 skill')
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

test('exposure: seamless 直接 activate（不经 completeSetup）也会注册 skill，覆盖竞态', () => {
  const { exposure } = makeExposure()
  const { agent, registered, skills } = makeAgent('race')
  const result = exposure.activate(agent, 'read-intercept')
  assert.equal(result.activated, true)
  assert.deepEqual(skills, ['vision-bridge'], 'activate 入口必须确保 skill 已注册')
  assert.deepEqual(registered, ['vision_media', 'vision_frames'])
})

test('exposure: skills 服务暂缺时 activate 不崩，后续 activate 补注册 skill', () => {
  let skillsAvailable = false
  const registered = []
  const disposals = []
  const skills = []
  const tools = {
    register(def) {
      registered.push(def.name)
      return () => disposals.push(def.name)
    },
  }
  const agent = {
    id: 'retry',
    ctx: {
      tools,
      get(name) {
        if (name !== 'skills') throw new Error(`cannot get property "${name}" without inject`)
        if (!skillsAvailable) return undefined
        return {
          register(def) {
            skills.push(def.name)
            return () => disposals.push('skill:' + def.name)
          },
        }
      },
    },
    options: { provider: 'p', model: 'm' },
    session: { header: { cwd: '/ws' }, events: [] },
  }
  const { exposure } = makeExposure()
  const first = exposure.activate(agent, 'paste')
  assert.equal(first.activated, true)
  assert.deepEqual(skills, [], 'skills 服务不可用时先跳过，不崩溃')
  skillsAvailable = true
  const second = exposure.activate(agent, 'paste')
  assert.equal(second.activated, false, '已激活的再次 activate 返回 false')
  assert.deepEqual(skills, ['vision-bridge'], '后续 activate 应补注册缺失的 skill')
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
