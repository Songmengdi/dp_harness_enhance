import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { BridgeLogger } from './logger.js'

export type ActivateResult = {
  activated: boolean
  tools: string[]
}

/** skill 内容标记：skill 工具返回内容含此标记即视为加载了本插件打包的 vision-bridge skill。 */
export const SKILL_MARKER = 'VISION_BRIDGE_ROUTE_C_SKILL_MARKER'

interface AgentState {
  /** null = 能力尚未判定完成。 */
  nativeVision: boolean | null
  activated: boolean
  guideDisposer: (() => void) | null
  skillDisposer: (() => void) | null
  execDisposers: Array<() => void>
  activationReason?: string
  scopeKey: ScopeKey | undefined
}

export interface ExposureOptions {
  runtimeReady: () => boolean
  seesImages: (agent: Agent) => Promise<boolean>
  execTools: () => ToolDefinition[]
  execToolNames: () => string[]
  logger: BridgeLogger
  skillDefinition: {
    name: string
    description: string
    content: string
  }
  protocolSection: () => string
}

/** 激活后注入的协议说明：完整明眼人协议只存在于 skill 内容，这里只做指路。 */
export function activationSection(): string {
  return [
    '# 视觉桥（vision-bridge）——本会话已激活',
    '可用工具：vision_glance（看图/问答/OCR）· vision_ground（定位）· vision_detect（盘点）· ',
    'vision_crop（裁剪）· vision_pixel_diff（像素差异）· vision_dominant_colors（主色）· ',
    'vision_media / vision_frames（媒体）· vision_trace（SVG 几何）· ',
    'vision_extract_foreground（透明 PNG）· vision_long_screenshot_ocr（长截图 OCR）· ',
    'vision_html_screenshot（HTML 截图）。',
    '完整使用协议（明眼人协议）见 skill：调用 skill 工具加载 `vision-bridge`。',
  ].join('\n')
}

/**
 * 渐进暴露（D5）：每个 Agent 独立状态机。
 * 未激活：引导工具 vision_activate + vision-bridge skill；激活后：执行工具注册、引导工具隐藏。
 * 视觉模型会话整套隐身；runtime 未就绪时一个工具都不发布。
 * 会话恢复：凭持久事件里的激活证据（vision_* 工具调用记录）重新 attach。
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
      state = {
        nativeVision: null,
        activated: false,
        guideDisposer: null,
        skillDisposer: null,
        execDisposers: [],
        scopeKey: undefined,
      }
      try {
        state.scopeKey = scopeOf(agent.ctx)
      } catch (e) { /* 无 scope 环境（测试） */ }
      this.states.set(agent.id, state)
    }
    return state
  }

  isActivated(agent: Agent): boolean {
    return this.states.get(agent.id)?.activated === true
  }

  /** 当前会话（scope）是否激活：驱动按 Agent 隔离的协议段注入。 */
  protocolFor(scope: ScopeKey | undefined): string {
    if (scope === undefined) return ''
    for (const state of this.states.values()) {
      if (state.scopeKey === scope && state.activated && state.nativeVision === false) {
        return this.opts.protocolSection()
      }
    }
    return ''
  }

  private guide(): ToolDefinition {
    if (this.guideDefinition === null) {
      this.guideDefinition = defineTool({
        name: 'vision_activate',
        description:
          '激活当前 Agent 的视觉桥工具集（vision_glance/ground/detect/crop/pixel_diff/dominant_colors/media/frames）。' +
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

  /** 会话持久事件里的激活证据：调过 vision_* 工具，或消息里出现过本插件落盘的粘贴路径。 */
  private hasActivationEvidence(agent: Agent): boolean {
    const execNames = new Set(this.opts.execToolNames())
    try {
      const events = agent.session?.events ?? []
      for (const event of events) {
        const type = (event as { type?: string }).type
        const data = (event as { data?: { name?: unknown; message?: unknown } }).data
        if (type === 'tool/call' && typeof data?.name === 'string') {
          if (data.name === 'vision_activate' || execNames.has(data.name)) return true
        }
        if (type === 'user/message') {
          const message = data?.message as { content?: Array<{ type?: string; text?: unknown }> } | undefined
          const text = (message?.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => String(b.text ?? ''))
            .join('\n')
          if (/inputs[/\\]vision-bridge[/\\][0-9a-f]{64}\./.test(text)) return true
        }
      }
    } catch (e) { /* 会话事件不可读则无证据 */ }
    return false
  }

  /** 幂等：Agent 创建 / runtime 就绪后都可调用，按状态补齐引导工具与 skill。 */
  handleAgentCreated(agent: Agent): void {
    const state = this.stateOf(agent)
    if (state.activated) return
    if (state.nativeVision === true) return
    if (state.nativeVision === false) {
      this.completeSetup(agent, state)
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
      if (!this.opts.runtimeReady()) {
        this.opts.logger.info({ agent: agent.id }, 'setup deferred — runtime not ready yet')
        return
      }
      this.completeSetup(agent, state)
    })()
  }

  /**
   * 注册 vision-bridge skill 到当前 agent 的 skills 服务。
   *
   * 注意：不能写 `agent.ctx.skills.register(...)`。dsh 的 AgentLoop 只 inject
   * agents/sessions/llm/tools/systemPrompt，没有 inject `skills`；直接属性访问
   * 在独立 fiber 下会抛 `cannot get property "skills" without inject`，异常被
   * 吞掉后 skill 永远不会出现在 `<available_skills>`。必须用 `agent.ctx.get('skills')`
   * 显式获取服务。这里也容忍服务暂不可用：下次 activate/handleAgentCreated 会重试。
   */
  private ensureSkill(agent: Agent, state: AgentState): void {
    if (state.skillDisposer !== null) return
    try {
      const skills = agent.ctx.get('skills')
      if (!skills || typeof skills.register !== 'function') {
        this.opts.logger.warn({ agent: agent.id }, 'skills service unavailable — skill registration skipped')
        return
      }
      state.skillDisposer = skills.register({
        name: this.opts.skillDefinition.name,
        description: this.opts.skillDefinition.description,
        content: this.opts.skillDefinition.content,
        source: 'bundled',
      })
      this.opts.logger.info({ agent: agent.id }, 'skill vision-bridge registered')
    } catch (e) {
      this.opts.logger.error({ agent: agent.id }, `skill register failed: ${String(e)}`)
    }
  }

  private completeSetup(agent: Agent, state: AgentState): void {
    if (state.activated) return
    // 按 router-spec/router-standard 的最小暴露原则：初始阶段不把 skill 放进 catalog，
    // 只保留引导工具。第一次遇到图（read/bash/paste/vision_activate/会话证据）时，
    // activate() 内部会 ensureSkill() 把 skill 和工具一起注入。
    if (this.hasActivationEvidence(agent)) {
      this.activate(agent, 'session-evidence')
      return
    }
    if (state.guideDisposer === null) {
      this.registerGuide(agent, state)
    }
  }

  private registerGuide(agent: Agent, state: AgentState): void {
    try {
      state.guideDisposer = agent.ctx.tools.register(this.guide())
      this.opts.logger.info({ agent: agent.id }, 'guide vision_activate registered')
    } catch (e) {
      this.opts.logger.error({ agent: agent.id }, `guide register failed: ${String(e)}`)
    }
  }

  /** 激活当前 Agent：执行工具全部注册进该 Agent，引导工具回收。runtime 未就绪不发布任何能力。 */
  activate(agent: Agent, reason: string): ActivateResult {
    const state = this.stateOf(agent)
    if (state.activated) {
      // 已激活也可能因早期 skills 服务未就绪而缺 skill；这里补一次，幂等。
      this.ensureSkill(agent, state)
      return { activated: false, tools: this.opts.execToolNames() }
    }
    if (!this.opts.runtimeReady()) {
      this.opts.logger.warn({ agent: agent.id, reason }, 'activation deferred — runtime not ready')
      return { activated: false, tools: [] }
    }
    this.ensureSkill(agent, state)
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

  /** 能力缓存失效后重判：只影响未激活 Agent 的引导工具/skill 去留。 */
  async recheckCapability(agent: Agent): Promise<void> {
    const state = this.stateOf(agent)
    if (state.activated) return
    let sees = true
    try {
      sees = await this.opts.seesImages(agent)
    } catch (e) {
      sees = false
    }
    state.nativeVision = sees
    if (sees) {
      this.teardown(state)
    } else {
      this.completeSetup(agent, state)
    }
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
    if (state.skillDisposer !== null) {
      try { state.skillDisposer() } catch (e) { /* 已回收则忽略 */ }
      state.skillDisposer = null
    }
    state.activated = false
    state.nativeVision = null
  }

  /** 卸载清理：逐 Agent 回收工具与 skill 注册。 */
  disposeAll(): void {
    for (const state of this.states.values()) this.teardown(state)
    this.states.clear()
  }
}
