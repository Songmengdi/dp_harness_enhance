import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BridgeLogger } from './logger.js'

export type ActivateResult = {
  activated: boolean
  tools: string[]
}

interface AgentState {
  /** null = 能力尚未判定完成。 */
  nativeVision: boolean | null
  activated: boolean
  guideDisposer: (() => void) | null
  execDisposers: Array<() => void>
  activationReason?: string
}

export interface ExposureOptions {
  runtimeReady: () => boolean
  seesImages: (agent: Agent) => Promise<boolean>
  execTools: () => ToolDefinition[]
  execToolNames: () => string[]
  logger: BridgeLogger
}

/**
 * 渐进暴露（D5）：每个 Agent 独立状态机。
 * 未激活：只有引导工具 vision_activate；激活后：执行工具注册到该 Agent、引导工具隐藏。
 * 视觉模型会话整套隐身；runtime 未就绪时一个工具都不发布。
 */
export class Exposure {
  private readonly states = new Map<string, AgentState>()
  private guideDefinition: ToolDefinition | null = null

  constructor(
    private readonly ctx: Context,
    private readonly opts: ExposureOptions,
  ) {}

  stateOf(agent: Agent): AgentState {
    let state = this.states.get(agent.id)
    if (!state) {
      state = { nativeVision: null, activated: false, guideDisposer: null, execDisposers: [] }
      this.states.set(agent.id, state)
    }
    return state
  }

  isActivated(agent: Agent): boolean {
    return this.states.get(agent.id)?.activated === true
  }

  private guide(): ToolDefinition {
    if (this.guideDefinition === null) {
      this.guideDefinition = defineTool({
        name: 'vision_activate',
        description:
          '激活当前 Agent 的视觉桥工具集（vision_media / vision_frames / 后续视觉工具）。' +
          '激活后这些工具会注册到当前 Agent 上下文，本引导工具自动隐藏。激活只影响当前会话。',
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (_args, exec) => {
          const agent = exec.agent
          if (!agent) return { activated: false, tools: [] as string[] }
          return this.activate(agent, 'tool')
        },
      })
    }
    return this.guideDefinition
  }

  /** 幂等：Agent 创建 / runtime 就绪后都可调用，按状态补齐引导工具。 */
  handleAgentCreated(agent: Agent): void {
    const state = this.stateOf(agent)
    if (state.activated) return
    if (state.nativeVision === true) return
    if (state.nativeVision === false) {
      if (state.guideDisposer === null && this.opts.runtimeReady()) {
        this.registerGuide(agent, state)
      }
      return
    }
    void (async () => {
      let sees = true
      try {
        sees = await this.opts.seesImages(agent)
      } catch (e) {
        sees = false
        this.opts.logger.warn({ agent: agent.id }, `capability check failed: ${String(e)}`)
      }
      const fresh = this.states.get(agent.id)
      if (fresh !== state) return
      state.nativeVision = sees
      if (sees) {
        this.opts.logger.info({ agent: agent.id, nativeVision: true }, 'agent sees images natively — bridge hidden')
        return
      }
      if (state.guideDisposer === null && this.opts.runtimeReady()) {
        this.registerGuide(agent, state)
      } else {
        this.opts.logger.info({ agent: agent.id }, 'guide deferred — runtime not ready yet')
      }
    })()
  }

  private registerGuide(agent: Agent, state: AgentState): void {
    try {
      state.guideDisposer = agent.ctx.tools.register(this.guide())
      this.opts.logger.info({ agent: agent.id }, 'guide vision_activate registered')
    } catch (e) {
      this.opts.logger.error({ agent: agent.id }, `guide register failed: ${String(e)}`)
    }
  }

  /** 激活当前 Agent：执行工具全部注册进该 Agent，引导工具回收。 */
  activate(agent: Agent, reason: string): ActivateResult {
    const state = this.stateOf(agent)
    if (state.activated) {
      return { activated: false, tools: this.opts.execToolNames() }
    }
    state.activated = true
    state.activationReason = reason
    const names: string[] = []
    for (const definition of this.opts.execTools()) {
      names.push(definition.name)
      try {
        state.execDisposers.push(agent.ctx.tools.register(definition))
      } catch (e) {
        this.opts.logger.error({ agent: agent.id, tool: definition.name }, `exec tool register failed: ${String(e)}`)
      }
    }
    if (state.guideDisposer !== null) {
      try {
        state.guideDisposer()
      } catch (e) { /* 已回收则忽略 */ }
      state.guideDisposer = null
    }
    this.opts.logger.info({ agent: agent.id, reason, tools: names }, 'agent activated')
    return { activated: true, tools: names }
  }

  handleAgentDisposed(agent: Agent): void {
    const state = this.states.get(agent.id)
    if (!state) return
    this.teardown(state)
    this.states.delete(agent.id)
  }

  private teardown(state: AgentState): void {
    for (const dispose of state.execDisposers) {
      try { dispose() } catch (e) { /* 已回收则忽略 */ }
    }
    state.execDisposers = []
    if (state.guideDisposer !== null) {
      try { state.guideDisposer() } catch (e) { /* 已回收则忽略 */ }
      state.guideDisposer = null
    }
  }

  /** 卸载清理：逐 Agent 回收工具注册。 */
  disposeAll(): void {
    for (const state of this.states.values()) this.teardown(state)
    this.states.clear()
  }
}
