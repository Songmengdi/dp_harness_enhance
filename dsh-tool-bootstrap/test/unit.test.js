/**
 * Unit tests for the upstream-aligned bootstrap gate.
 * Fake ctx exercises the plugin surface: system-prompt/assemble,
 * agent/request, and agent/pre-step waterfalls.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name, inject } from '../lib/index.js'

const BASE = { shellTools: ['bash', 'pwsh'], alwaysTools: ['read'] }

function listenersFor(config = BASE) {
  const listeners = {}
  const warns = []
  const ctx = {
    on(event, callback) {
      listeners[event] = callback
    },
    logger: { warn(message) { warns.push(message) } },
  }
  apply(ctx, config)
  return { listeners, warns }
}

function listenerFor(event, config = BASE) {
  const { listeners, warns } = listenersFor(config)
  return { listener: listeners[event], warns }
}

function fakeAgent(events, id = 'session-a') {
  return { session: { id, events } }
}

const ORIGINAL_PERSONA = 'Original preset persona.'

async function assemble(listener, events, tools, id = 'session-a', sections = [{ name: 'deployment:persona', text: ORIGINAL_PERSONA }]) {
  return listener(undefined, { agent: fakeAgent(events, id) }, async () => ({ tools, sections }))
}

async function request(listener, events, resolved, id = 'session-a') {
  return listener({ agent: fakeAgent(events, id), turn: 1, step: 1 }, async () => resolved)
}

async function preStep(listener, events, messages, id = 'session-a') {
  return listener({ agent: fakeAgent(events, id), turn: 1, step: 1 }, async () => ({ kind: 'enter', messages }))
}

const TOOLS = [
  { name: 'bash', description: 'shell', parameters: {} },
  { name: 'read', description: 'read', parameters: {} },
  { name: 'edit', description: 'edit', parameters: {} },
]

test('exports the diagnostic plugin identity and requires the timer service', () => {
  assert.equal(name, 'tool-bootstrap')
  assert.deepEqual(inject, ['timer'])
})

test('first request exposes one platform shell plus read', async () => {
  const { listener } = listenerFor('system-prompt/assemble')
  const result = await assemble(listener, [], [{ name: 'pwsh' }, { name: 'read' }, { name: 'edit' }])
  assert.deepEqual(result.tools.map((tool) => tool.name), ['pwsh', 'read'])
})

test('a durable tool call promotes the complete catalog', async () => {
  const { listener } = listenerFor('system-prompt/assemble')
  const result = await assemble(listener, [{ type: 'tool/call' }], TOOLS)
  assert.deepEqual(result.tools, TOOLS)
})

test('either mode also promotes after the first assistant message', async () => {
  const { listener } = listenerFor('system-prompt/assemble')
  const result = await assemble(listener, [{ type: 'assistant/message' }], TOOLS)
  assert.deepEqual(result.tools, TOOLS)
})

test('promotion is derived per session and memoized', async () => {
  const { listener } = listenerFor('system-prompt/assemble')
  const promoted = await assemble(listener, [{ type: 'tool/call' }], TOOLS, 'session-promoted')
  assert.deepEqual(promoted.tools, TOOLS)
  const fresh = await assemble(listener, [], TOOLS, 'session-fresh')
  assert.deepEqual(fresh.tools.map((tool) => tool.name), ['bash', 'read'])
  const memo = await assemble(listener, [], TOOLS, 'session-promoted')
  assert.deepEqual(memo.tools, TOOLS)
})

test('promoteOn tool-call requires a tool call, not a plain reply', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { ...BASE, promoteOn: 'tool-call' })
  const replyOnly = await assemble(listener, [{ type: 'assistant/message' }], TOOLS)
  assert.deepEqual(replyOnly.tools.map((tool) => tool.name), ['bash', 'read'])
  const withCall = await assemble(listener, [{ type: 'tool/call' }], TOOLS)
  assert.deepEqual(withCall.tools, TOOLS)
})

test('promoteOn assistant-message promotes after a plain reply', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { ...BASE, promoteOn: 'assistant-message' })
  const result = await assemble(listener, [{ type: 'assistant/message' }], TOOLS)
  assert.deepEqual(result.tools, TOOLS)
})

test('promoteOn first-turn-complete keeps the bootstrap catalog until a durable turn ends', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { ...BASE, promoteOn: 'first-turn-complete' })
  const during = await assemble(listener, [{ type: 'tool/call' }, { type: 'assistant/message' }], TOOLS)
  assert.deepEqual(during.tools.map((tool) => tool.name), ['bash', 'read'])
  const after = await assemble(listener, [{ type: 'turn/end' }], TOOLS)
  assert.deepEqual(after.tools, TOOLS)
})

test('enabling prewarm defaults promoteOn to first-turn-complete', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { ...BASE, prewarm: true, prewarmMessage: 'warm up' })
  const during = await assemble(listener, [{ type: 'tool/call' }], TOOLS)
  assert.deepEqual(during.tools.map((tool) => tool.name), ['bash', 'read'])
  assert.deepEqual(during.sections.map((section) => section.text), ['You are a helpful software engineer assistant.'])
  const after = await assemble(listener, [{ type: 'turn/end' }], TOOLS)
  assert.deepEqual(after.tools, TOOLS)
  assert.deepEqual(after.sections.map((section) => section.text), [ORIGINAL_PERSONA])
})

test('prewarm collapses the whole system prompt to the configured anchor persona', async () => {
  const { listener } = listenerFor('system-prompt/assemble', {
    ...BASE,
    prewarm: true,
    prewarmMessage: 'warm up',
    prewarmPersona: 'Anchor persona.',
  })
  const sections = [
    { name: 'deployment:persona', text: ORIGINAL_PERSONA },
    { name: 'some:other', text: 'keep me' },
  ]
  const during = await assemble(listener, [], TOOLS, 'session-a', sections)
  assert.deepEqual(during.sections, [
    { name: 'deployment:persona', text: 'Anchor persona.' },
  ])
  const promoted = await assemble(listener, [{ type: 'turn/end' }], TOOLS, 'session-a', sections)
  assert.deepEqual(promoted.sections, sections)
})

test('an empty prewarmPersona keeps the preset persona during the prewarm turn', async () => {
  const { listener } = listenerFor('system-prompt/assemble', {
    ...BASE,
    prewarm: true,
    prewarmMessage: 'warm up',
    prewarmPersona: '',
  })
  const during = await assemble(listener, [], TOOLS)
  assert.deepEqual(during.sections.map((section) => section.text), [ORIGINAL_PERSONA])
})

test('without prewarm the preset persona is never replaced', async () => {
  const { listener } = listenerFor('system-prompt/assemble', BASE)
  const bootstrap = await assemble(listener, [], TOOLS)
  const promoted = await assemble(listener, [{ type: 'tool/call' }], TOOLS)
  assert.deepEqual(bootstrap.sections.map((section) => section.text), [ORIGINAL_PERSONA])
  assert.deepEqual(promoted.sections.map((section) => section.text), [ORIGINAL_PERSONA])
})

test('an explicit promoteOn still wins when prewarm is enabled', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { ...BASE, prewarm: true, promoteOn: 'tool-call' })
  const result = await assemble(listener, [{ type: 'tool/call' }], TOOLS)
  assert.deepEqual(result.tools, TOOLS)
})

test('an assembly without an agent is left untouched', async () => {
  const { listener } = listenerFor('system-prompt/assemble')
  const result = await listener(undefined, {}, async () => ({ tools: TOOLS }))
  assert.deepEqual(result.tools, TOOLS)
})

test('bootstrapTools overrides the shell/read derivation', async () => {
  const { listener } = listenerFor('system-prompt/assemble', { bootstrapTools: ['read', 'edit'] })
  const result = await assemble(listener, [], TOOLS)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['read', 'edit'])
})

test('a missing bootstrap tool degrades to the full catalog with one warning', async () => {
  const { listener, warns } = listenerFor('system-prompt/assemble')
  const result = await assemble(listener, [], [{ name: 'edit' }])
  assert.deepEqual(result.tools.map((tool) => tool.name), ['edit'])
  assert.ok(warns.length >= 1)
})

test('misconfigured lists and promoteOn fail at registration', () => {
  assert.throws(() => listenerFor('system-prompt/assemble', { shellTools: [] }), /non-empty array/)
  assert.throws(() => listenerFor('system-prompt/assemble', { ...BASE, alwaysTools: [''] }), /non-empty array/)
  assert.throws(() => listenerFor('system-prompt/assemble', { ...BASE, promoteOn: 'bogus' }), /promoteOn/)
})

test('invalid bootstrapMaxTokens fails at registration', () => {
  assert.throws(() => listenerFor('system-prompt/assemble', { ...BASE, bootstrapMaxTokens: 0 }), /bootstrapMaxTokens/)
})

test('prewarm requires a non-empty prewarmMessage', () => {
  assert.throws(() => listenerFor('system-prompt/assemble', { ...BASE, prewarm: true, prewarmMessage: '   ' }), /prewarmMessage/)
})

test('the first request is capped to bootstrapMaxTokens', async () => {
  const { listener } = listenerFor('agent/request', { ...BASE, bootstrapMaxTokens: 1024 })
  const resolved = await request(listener, [], { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(resolved.maxTokens, 1024)
  assert.equal(resolved.provider, 'deepseek-official')
})

test('after promotion the injected cap is stripped so the default returns', async () => {
  const { listener } = listenerFor('agent/request', { ...BASE, bootstrapMaxTokens: 1024 })
  const resolved = await request(listener, [{ type: 'tool/call' }], { provider: 'x', model: 'y', maxTokens: 1024 })
  assert.equal(resolved.maxTokens, undefined)
})

test('first-turn-complete promotion also strips the injected cap', async () => {
  const { listener } = listenerFor('agent/request', { ...BASE, promoteOn: 'first-turn-complete' })
  const during = await request(listener, [{ type: 'tool/call' }], { provider: 'x', model: 'y' })
  assert.equal(during.maxTokens, 1024)
  const after = await request(listener, [{ type: 'turn/end' }], { provider: 'x', model: 'y', maxTokens: 1024 })
  assert.equal(after.maxTokens, undefined)
})

test('after promotion a different maxTokens is preserved', async () => {
  const { listener } = listenerFor('agent/request', { ...BASE, bootstrapMaxTokens: 1024 })
  const resolved = await request(listener, [{ type: 'tool/call' }], { provider: 'x', model: 'y', maxTokens: 256000 })
  assert.equal(resolved.maxTokens, 256000)
})

test('bootstrap pre-step strips skill-catalog and agent-instructions messages', async () => {
  const { listener } = listenerFor('agent/pre-step')
  const messages = [
    { id: 'm1', content: [], source: { kind: 'user' } },
    { id: 'm2', content: [], source: { kind: 'skill-catalog' } },
    { id: 'm3', content: [], source: { kind: 'agent-instructions' } },
  ]
  const decision = await preStep(listener, [], messages)
  assert.equal(decision.kind, 'enter')
  assert.deepEqual(decision.messages.map((message) => message.id), ['m1'])
})

test('promoted pre-step keeps skill-catalog and agent-instructions messages', async () => {
  const { listener } = listenerFor('agent/pre-step')
  const messages = [
    { id: 'm1', content: [], source: { kind: 'user' } },
    { id: 'm2', content: [], source: { kind: 'skill-catalog' } },
    { id: 'm3', content: [], source: { kind: 'agent-instructions' } },
  ]
  const events = [
    { type: 'assistant/message' },
    { type: 'user/message', data: { source: { kind: 'agent-instructions' } } },
  ]
  const decision = await preStep(listener, events, messages)
  assert.deepEqual(decision.messages.map((message) => message.id), ['m1', 'm2', 'm3'])
})

test('reject decisions pass through untouched', async () => {
  const { listener } = listenerFor('agent/pre-step')
  const decision = await listener({ agent: fakeAgent([]), turn: 1, step: 1 }, async () => ({ kind: 'reject' }))
  assert.equal(decision.kind, 'reject')
})
