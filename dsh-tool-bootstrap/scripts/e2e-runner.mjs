#!/usr/bin/env node
/**
 * One-shot end-to-end repro driver for the anchored presets.
 *
 * Composes the REAL host (`@deepseek-ai/dsh-base` with the dsh-web-app row
 * ownership boundary mirrored), mounts a user preset through the production
 * path (`ctx.agentPresets.mount`, the same call the api-proxy uses), and
 * drives real user turns.
 *
 * Two modes:
 *   E2E_PREWARM=0 (default) — upstream first-request anchoring: the task is
 *     turn 1 (bootstrap catalog), and the promoted catalog is observed on the
 *     next requests.
 *   E2E_PREWARM=1 — pre-input anchoring: the preset itself drives turn 1 with
 *     the prewarm `ls` message; the runner waits for that turn to finish and
 *     then sends the real user task as turn 2 (full catalog + restored
 *     AGENTS.md / skill catalog).
 *
 * Targeted preset and expectations come from the environment:
 *   E2E_PRESET_ID          preset id under ~/.dsh/.agent-presets
 *                          (default anchored-standard)
 *   E2E_BOOTSTRAP          comma-separated first-header tool names
 *                          (default bash,read)
 *   E2E_FULL_INCLUDES      comma-separated names the promoted catalog must
 *                          include (default write)
 *   E2E_SELECT_PATH=1      replicate the GUI two-step flow (blank session
 *                          first, then recompose + agent-preset/selected)
 *   E2E_PRE_SELECT         mount another shipped/user preset before switching
 *                          to the target, replicating a warm web process
 *   E2E_PREWARM_MESSAGE    exact prewarm turn message the preset must inject
 *                          (default matches the bundled presets)
 *   E2E_PREWARM_TIMEOUT_MS prewarm turn completion deadline (default 180000)
 *   E2E_TURN1_SYSTEM       exact expected turn-1 system prompt
 *                          (default: the Minimal anchor sentence)
 *   E2E_TURN1_SYSTEM_CONTAINS
 *                          substring the turn-1 system prompt must contain
 *   E2E_TURN2_SYSTEM_CONTAINS
 *                          substring any promoted system prompt must contain;
 *                          when unset, promoted systems must equal turn 1
 *
 * Run through the bundled `anchored-e2e` profile:
 *   dsh --profile anchored-e2e "Run the bash command 'echo anchored-e2e-ok' and then reply with exactly the word done."
 *   E2E_PREWARM=1 dsh --profile anchored-e2e "Run the bash command 'echo anchored-e2e-ok' and then reply with exactly the word done."
 */

export const name = 'anchored-e2e-runner'

export const inject = ['cmdlineArgs', 'agentPresets', 'agents', 'agentDefaultModel', 'sessions']

const PRESET_ID = process.env.E2E_PRESET_ID ?? 'anchored-standard'
const SELECT_PATH = process.env.E2E_SELECT_PATH === '1'
const PRE_SELECT = process.env.E2E_PRE_SELECT
const PREWARM = process.env.E2E_PREWARM === '1'
const PREWARM_MESSAGE = process.env.E2E_PREWARM_MESSAGE ?? 'Run the bash command ls and reply with exactly the word done.'
const PREWARM_TIMEOUT_MS = Number(process.env.E2E_PREWARM_TIMEOUT_MS ?? 180000)
const DEFAULT_TURN1_SYSTEM = 'You are a helpful software engineer assistant.'
const TURN1_SYSTEM = process.env.E2E_TURN1_SYSTEM
const TURN1_SYSTEM_CONTAINS = process.env.E2E_TURN1_SYSTEM_CONTAINS
const TURN2_SYSTEM_CONTAINS = process.env.E2E_TURN2_SYSTEM_CONTAINS
const BOOTSTRAP = (process.env.E2E_BOOTSTRAP ?? 'bash,read').split(',').map((s) => s.trim()).filter(Boolean).sort()
const FULL_INCLUDES = (process.env.E2E_FULL_INCLUDES ?? 'write').split(',').map((s) => s.trim()).filter(Boolean)

export function apply(ctx) {
  const task = ctx.cmdlineArgs.get().join(' ').trim()
  const exit = ctx.get('appExit') ?? ((code) => process.exit(code))
  if (task === '') {
    console.error(`${name}: a task is required, e.g. dsh --profile anchored-e2e "run the command echo hi"`)
    exit(2)
    return
  }

  void run(ctx, task).then(
    (report) => {
      console.log(JSON.stringify(report, null, 2))
      exit(report.pass ? 0 : 1)
    },
    (error) => {
      console.log(JSON.stringify({ preset: PRESET_ID, pass: false, error: String(error?.stack ?? error) }, null, 2))
      exit(1)
    },
  )
}

/** 等一个已开始的回合落下 turn/end;预热投递经 ctx.setTimeout(0) 延后,所以要轮询。 */
async function waitForTurnEnd(agent, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await agent.whenIdle()
    if (agent.session.events.some((event) => event.type === 'turn/end')) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function run(ctx, task) {
  await ctx.get('loader')?.await()

  const resolved = (await ctx.agentPresets.resolve(PRESET_ID)).id
  const selection = ctx.agentDefaultModel.currentSelection()

  const { agent } = await ctx.agents.create({
    sessionId: `session-${crypto.randomUUID()}`,
    meta: { cwd: process.cwd(), agentPreset: resolved },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: SELECT_PATH
      ? () => {}
      : async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, resolved)
      },
  })

  if (SELECT_PATH) {
    if (PRE_SELECT) {
      const pre = (await ctx.agentPresets.resolve(PRE_SELECT)).id
      await ctx.agentPresets.recompose(agent.ctx, pre)
      agent.session.append('agent-preset/selected', { agentPreset: pre })
    }
    await ctx.agentPresets.recompose(agent.ctx, resolved)
    agent.session.append('agent-preset/selected', { agentPreset: resolved })
  }

  let prewarmCompleted = true
  if (PREWARM) {
    // 预热消息由 tool-bootstrap 经 agent/created 或 agent-preset/selected 路径
    // 自动投递;这里等它作为 turn 1 完整跑完,再把真实任务作为 turn 2 送入。
    prewarmCompleted = await waitForTurnEnd(agent, PREWARM_TIMEOUT_MS)
    if (!prewarmCompleted) {
      await ctx.sessions.flush(agent.session)
      return {
        preset: resolved,
        sessionId: agent.session.id,
        task,
        mode: SELECT_PATH ? 'prewarm-select-path' : 'prewarm',
        pass: false,
        error: `prewarm turn did not complete within ${PREWARM_TIMEOUT_MS}ms`,
      }
    }
  }

  // 默认模式:task 就是 turn 1(bootstrap);prewarm 模式:task 是 turn 2(全量)。
  agent.followup({ content: [{ type: 'text', text: task }], source: { kind: 'user' } })
  await agent.whenIdle()
  if (!PREWARM) {
    agent.followup({ content: [{ type: 'text', text: 'Reply with exactly the word done.' }], source: { kind: 'user' } })
    await agent.whenIdle()
  }
  await ctx.sessions.flush(agent.session)

  const events = agent.session.events
  const headersByTurn = []
  const userMessagesByTurn = []
  let currentTurn = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      currentTurn = event.data.turn
      headersByTurn[currentTurn] ??= []
      userMessagesByTurn[currentTurn] ??= []
    }
    if (event.type === 'request/header') {
      (headersByTurn[currentTurn] ??= []).push({
        tools: (event.data.header.tools ?? []).map((tool) => tool.name).sort(),
        system: event.data.header.system ?? '',
      })
    }
    if (event.type === 'user/message') {
      (userMessagesByTurn[currentTurn] ??= []).push(event.data)
    }
  }
  const calls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({ name: event.data.name, turn: event.data.turn }))

  const headers = events
    .filter((event) => event.type === 'request/header')
    .map((event) => ({
      tools: (event.data.header.tools ?? []).map((tool) => tool.name).sort(),
      system: event.data.header.system ?? '',
    }))
  const firstHeader = headers[0]
  const promotedHeaders = headers.slice(1)
  const promotionEvent = (event) => PREWARM
    ? event.type === 'turn/end'
    : event.type === 'tool/call' || event.type === 'assistant/message'
  const firstPromotionIndex = events.findIndex(promotionEvent)
  const prePromotionMessages = events
    .filter((event) => event.type === 'user/message' && event.seq < (firstPromotionIndex === -1 ? Infinity : events[firstPromotionIndex].seq))
    .map((event) => event.data)
  const allMessages = events
    .filter((event) => event.type === 'user/message')
    .map((event) => event.data)
  const prePromotionKinds = [...new Set(prePromotionMessages.map((message) => message.source?.kind))]
  const allMessageKinds = [...new Set(allMessages.map((message) => message.source?.kind))]
  const turn1Messages = userMessagesByTurn[1] ?? []

  const bootstrapShape = JSON.stringify(BOOTSTRAP)
  const fullCheck = (header) => header.tools.length > BOOTSTRAP.length
    && FULL_INCLUDES.every((toolName) => header.tools.includes(toolName))

  const turn1SystemOk = (() => {
    if (TURN1_SYSTEM !== undefined && TURN1_SYSTEM !== '') return firstHeader?.system === TURN1_SYSTEM
    if (TURN1_SYSTEM_CONTAINS !== undefined && TURN1_SYSTEM_CONTAINS !== '') {
      return firstHeader !== undefined && firstHeader.system.includes(TURN1_SYSTEM_CONTAINS)
    }
    return firstHeader?.system === DEFAULT_TURN1_SYSTEM
  })()
  const promotedSystemOk = TURN2_SYSTEM_CONTAINS
    ? promotedHeaders.length > 0 && promotedHeaders.some((header) => header.system.includes(TURN2_SYSTEM_CONTAINS))
    : promotedHeaders.length === 0 || promotedHeaders.every((header) => header.system === firstHeader?.system)

  const prewarmMessageOk = PREWARM
    && turn1Messages.length === 1
    && turn1Messages[0].source?.kind === 'user'
    && turn1Messages[0].content?.some((part) => part.type === 'text' && part.text === PREWARM_MESSAGE)
  const prewarmTurnCalledBootstrapTool = calls.some((call) => call.turn === 1 && BOOTSTRAP.includes(call.name))

  const checks = []
  if (PREWARM) {
    checks.push(
      [`the prewarm turn completed (turn/end seen)`, prewarmCompleted],
      [`the prewarm turn ran exactly the configured prewarm message (turn-1 messages: ${JSON.stringify(turn1Messages.map((message) => message.content?.map((part) => part.text)))})`, prewarmMessageOk === true],
      [`the prewarm turn made a bootstrap tool call (calls: ${JSON.stringify(calls)})`, prewarmTurnCalledBootstrapTool],
      [`the prewarm request stayed on the bootstrap catalog (tools: ${JSON.stringify(firstHeader?.tools)})`, firstHeader !== undefined && JSON.stringify(firstHeader.tools) === bootstrapShape],
      [`the prewarm request ran the expected anchor system prompt (system: ${JSON.stringify(firstHeader?.system)})`, turn1SystemOk],
      [`the prewarm turn carried no injected reminders (pre-promotion message kinds: ${JSON.stringify(prePromotionKinds)})`, prePromotionMessages.length >= 1 && prePromotionKinds.every((kind) => kind === 'user')],
      [`the user task ran on the complete catalog (${promotedHeaders.length} later header(s), must include ${JSON.stringify(FULL_INCLUDES)})`, promotedHeaders.length >= 1 && promotedHeaders.every(fullCheck)],
      [`later requests kept or restored the expected system prompt (systems: ${JSON.stringify([...new Set(promotedHeaders.map((header) => header.system))])})`, promotedSystemOk],
      [`later requests restored AGENTS.md and skill-catalog context (message kinds: ${JSON.stringify(allMessageKinds)})`, ['agent-instructions', 'skill-catalog'].every((kind) => allMessageKinds.includes(kind))],
      [`at least two turns completed (turn/end count: ${events.filter((event) => event.type === 'turn/end').length})`, events.filter((event) => event.type === 'turn/end').length >= 2],
    )
  } else {
    checks.push(
      [`the first request stayed on the bootstrap catalog (tools: ${JSON.stringify(firstHeader?.tools)})`, firstHeader !== undefined && JSON.stringify(firstHeader.tools) === bootstrapShape],
      [`the first request ran on the anchor persona (system: ${JSON.stringify(firstHeader?.system)})`, turn1SystemOk],
      [`the first turn made a durable tool call or assistant message (calls: ${JSON.stringify(calls)})`, calls.length >= 1],
      [`the first request carried no injected reminders (pre-promotion message kinds: ${JSON.stringify(prePromotionKinds)})`, prePromotionMessages.length >= 1 && prePromotionKinds.every((kind) => kind === 'user')],
      [`every later request ran on the complete catalog (${promotedHeaders.length} later header(s), must include ${JSON.stringify(FULL_INCLUDES)})`, promotedHeaders.length >= 1 && promotedHeaders.every(fullCheck)],
      [`later requests kept or restored the expected system prompt (systems: ${JSON.stringify([...new Set(promotedHeaders.map((header) => header.system))])})`, promotedSystemOk],
      [`later requests restored AGENTS.md and skill-catalog context (message kinds: ${JSON.stringify(allMessageKinds)})`, ['agent-instructions', 'skill-catalog'].every((kind) => allMessageKinds.includes(kind))],
      [`at least two turns completed (turn/end count: ${events.filter((event) => event.type === 'turn/end').length})`, events.filter((event) => event.type === 'turn/end').length >= 2],
    )
  }

  return {
    preset: resolved,
    sessionId: agent.session.id,
    task,
    mode: PREWARM ? (SELECT_PATH ? 'prewarm-select-path' : 'prewarm') : (SELECT_PATH ? 'task-select-path' : 'task'),
    headersByTurn: headersByTurn.map((headers) => (headers ?? []).map((header) => ({ tools: header.tools, systemPreview: header.system.slice(0, 80) }))),
    messageKindsByTurn: userMessagesByTurn.map((messages) => (messages ?? []).map((message) => message.source?.kind)),
    toolCalls: calls,
    checks,
    pass: checks.every(([, ok]) => ok),
  }
}
