/**
 * Integration tests: the real composition — @deepseek-ai/dsh-system-prompt as
 * the assembly registry plus this plugin mounted in a minted scope — driven
 * through the real `system-prompt/assemble` waterfall, including the scoped
 * dispatch that keeps one preset's gate away from every other scope.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { TimerService } from '@deepseek-ai/cordis-plugin-timer'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

import * as Bootstrap from '../lib/index.js'

const TOOLS = [
  { name: 'bash', description: 'native shell', parameters: {} },
  { name: 'read', description: 'read files', parameters: {} },
  { name: 'write', description: 'write files', parameters: {} },
]

/** One "preset": root service + global tool provider + this plugin in a scoped ctx. */
async function boot(config = {}, { agents = false, before = undefined } = {}) {
  const ctx = new Context()
  await ctx.plugin(TimerService, {})
  if (agents) await ctx.plugin(AgentRegistry, {})
  await ctx.plugin(SystemPrompt, {})
  ctx.systemPrompt.tools(() => ({ schemas: TOOLS }))
  const scopeKey = {}
  const scope = createScope(ctx, scopeKey)
  // 真实 preset 挂载里插件 ctx 的 baseUrl 是 preset composition 目录;
  // 测试用同样的形态让插件能推导出自己的 preset id 并启用 prewarm。
  const scoped = scope.ctx.extend({ baseUrl: new URL('file:///presets/tool-bootstrap-standard/').href })
  await before?.(scoped)
  await scoped.plugin(Bootstrap, {
    shellTools: ['bash', 'pwsh'],
    alwaysTools: ['read'],
    strict: true,
    ...config,
  })
  return { ctx, scope, scopeKey, scoped, dispose: () => scope.dispose() }
}

function agentWith(events) {
  return { session: { events } }
}

test('real scoped dispatch filters the first assembly and promotes after a durable tool/call', async () => {
  const { ctx, scopeKey, dispose } = await boot()
  try {
    const first = await ctx.systemPrompt.assemble({ scope: scopeKey, agent: agentWith([]) })
    assert.deepEqual(first.tools.map((tool) => tool.name), ['bash', 'read'])

    const after = await ctx.systemPrompt.assemble({
      scope: scopeKey,
      agent: agentWith([{ type: 'tool/call' }]),
    })
    assert.deepEqual(after.tools.map((tool) => tool.name), ['bash', 'read', 'write'])
  } finally {
    await dispose()
  }
})

test('an assembly scoped elsewhere is untouched by this preset\'s gate', async () => {
  const { ctx, dispose } = await boot()
  try {
    const other = await ctx.systemPrompt.assemble({ scope: {}, agent: agentWith([]) })
    assert.deepEqual(other.tools.map((tool) => tool.name), ['bash', 'read', 'write'])
  } finally {
    await dispose()
  }
})

test('a sibling scope under the same root keeps its own stage', async () => {
  const { ctx, dispose } = await boot()
  try {
    const keyA = {}
    const keyB = {}
    const scopeA = createScope(ctx, keyA)
    const scopeB = createScope(ctx, keyB)
    await scopeA.ctx.plugin(Bootstrap, { shellTools: ['bash', 'pwsh'], alwaysTools: ['read'], strict: true })
    await scopeB.ctx.plugin(Bootstrap, { shellTools: ['bash', 'pwsh'], alwaysTools: ['read'], strict: true })

    const aBefore = await ctx.systemPrompt.assemble({ scope: keyA, agent: agentWith([]) })
    const bBefore = await ctx.systemPrompt.assemble({ scope: keyB, agent: agentWith([]) })
    assert.deepEqual(aBefore.tools.map((tool) => tool.name), ['bash', 'read'])
    assert.deepEqual(bBefore.tools.map((tool) => tool.name), ['bash', 'read'])

    const aAfter = await ctx.systemPrompt.assemble({
      scope: keyA,
      agent: agentWith([{ type: 'tool/call' }]),
    })
    const bAfter = await ctx.systemPrompt.assemble({ scope: keyB, agent: agentWith([]) })
    assert.deepEqual(aAfter.tools.map((tool) => tool.name), ['bash', 'read', 'write'])
    assert.deepEqual(bAfter.tools.map((tool) => tool.name), ['bash', 'read'])

    await scopeA.dispose()
    await scopeB.dispose()
  } finally {
    await dispose()
  }
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

function fakeAgent({ id, events = [], header = {} } = {}) {
  const messages = []
  return {
    id: id ?? `session-${Math.random().toString(36).slice(2)}`,
    session: { id: id ?? 'session-without-explicit-id', events, header },
    followup(input) { messages.push(input) },
    messages,
  }
}

/** 把 fake agent 挂到插件所属 preset 的 scope 之下,复刻 agent loop 的 scope 父链。 */
function joinAgent(ctx, agent, scopeKey) {
  agent.ctx = createScope(ctx, agent, { parent: scopeKey }).ctx
  return agent
}

test('prewarm drives one user followup for a fresh session through agent/created', async () => {
  const { ctx, scopeKey, dispose } = await boot({ prewarm: true, prewarmMessage: 'warm up turn one' }, { agents: true })
  const unregister = []
  try {
    const agent = joinAgent(ctx, fakeAgent({ id: 'session-created' }), scopeKey)
    unregister.push(ctx.get('agents').register(agent))
    await tick()
    assert.equal(agent.messages.length, 1)
    assert.deepEqual(agent.messages[0].content, [{ type: 'text', text: 'warm up turn one' }])
    assert.equal(agent.messages[0].source.kind, 'plugin')
    assert.equal(agent.messages[0].source.form, 'prewarm')

    // 两条触发路径都必须幂等:同一会话不会收到第二次预热。
    ctx.emit('session/event', agent.session, { type: 'agent-preset/selected', data: { agentPreset: 'tool-bootstrap-standard' } })
    await tick()
    assert.equal(agent.messages.length, 1)
  } finally {
    for (const disposeRegistration of unregister) disposeRegistration()
    await dispose()
  }
})

test('prewarm follows the GUI two-step selection path without an agent/created delivery', async () => {
  const { ctx, scopeKey, dispose } = await boot({ prewarm: true, prewarmMessage: 'warm up turn one' }, { agents: true })
  try {
    const agents = ctx.get('agents')
    // GUI 两步流:空白会话先创建(此时未组成于本 preset),随后 recompose 才把
    // agent 挂到本 preset 的 standing mount;对应 enter(不 announce)+
    // agent-preset/selected 事件。
    const selected = joinAgent(ctx, fakeAgent({ id: 'session-gui' }), scopeKey)
    agents.enter(selected, undefined)
    ctx.emit('session/event', selected.session, { type: 'agent-preset/selected', data: { agentPreset: 'tool-bootstrap-standard' } })
    await tick()
    assert.equal(selected.messages.length, 1)
    assert.equal(selected.messages[0].content[0].text, 'warm up turn one')

    // 其他 preset 的选择事件不得触发本实例。
    const foreign = joinAgent(ctx, fakeAgent({ id: 'session-foreign' }), scopeKey)
    agents.enter(foreign, undefined)
    ctx.emit('session/event', foreign.session, { type: 'agent-preset/selected', data: { agentPreset: 'some-other-preset' } })
    await tick()
    assert.equal(foreign.messages.length, 0)
  } finally {
    await dispose()
  }
})

test('prewarm skips subagents, forks, and sessions that already have work', async () => {
  const { ctx, scopeKey, dispose } = await boot({ prewarm: true, prewarmMessage: 'warm up turn one' }, { agents: true })
  const unregister = []
  try {
    const subagent = joinAgent(ctx, fakeAgent({ id: 'session-sub', header: { origin: 'subagent' } }), scopeKey)
    const fork = joinAgent(ctx, fakeAgent({ id: 'session-fork', header: { seedLength: 3 } }), scopeKey)
    const busy = joinAgent(ctx, fakeAgent({ id: 'session-busy', events: [{ type: 'turn/start' }] }), scopeKey)
    for (const agent of [subagent, fork, busy]) unregister.push(ctx.get('agents').register(agent))
    await tick()
    assert.equal(subagent.messages.length, 0)
    assert.equal(fork.messages.length, 0)
    assert.equal(busy.messages.length, 0)
  } finally {
    for (const disposeRegistration of unregister) disposeRegistration()
    await dispose()
  }
})

test('the bootstrap pre-step strips skill-catalog even when tool-skill registered earlier', async () => {
  // 复刻 rc.6 loader 并发激活时 tool-skill 先注册、把 catalog 追加在 next() 之后
  // 的时序;本插件必须靠 prepend 注册成为最外层才能做最终过滤。
  const lateCatalogListener = async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return {
      ...decision,
      messages: [...decision.messages, { id: 'late-skill-catalog', source: { kind: 'skill-catalog' }, content: [] }],
    }
  }
  const { ctx, scopeKey, dispose } = await boot(
    { promoteOn: 'first-turn-complete' },
    { before: (scoped) => scoped.on('agent/pre-step', lateCatalogListener) },
  )
  try {
    const agent = joinAgent(ctx, fakeAgent({ id: 'session-pre-step-order', events: [] }), scopeKey)
    const signal = { throwIfAborted() {} }
    const decision = await ctx.waterfall(
      scopeTarget(agent, agent),
      'agent/pre-step',
      { agent, messages: [], turn: 1, step: 1, signal },
      async () => ({ kind: 'enter', messages: [] }),
    )
    assert.deepEqual(decision.messages.map((message) => message.id), [])

    // 晋升后 catalog 必须原样保留(不剥正常注入)。
    const promoted = joinAgent(ctx, fakeAgent({
      id: 'session-pre-step-promoted',
      events: [
        { type: 'turn/end' },
        { type: 'user/message', data: { source: { kind: 'agent-instructions' } } },
      ],
    }), scopeKey)
    const after = await ctx.waterfall(
      scopeTarget(promoted, promoted),
      'agent/pre-step',
      { agent: promoted, messages: [], turn: 2, step: 1, signal },
      async () => ({ kind: 'enter', messages: [] }),
    )
    assert.deepEqual(after.messages.map((message) => message.id), ['late-skill-catalog'])
  } finally {
    await dispose()
  }
})
