/**
 * Anchored tool bootstrap gate for dsh agent presets.
 *
 * 两种用法:
 * - `prewarm: false`(默认)—— 上游式首请求锚定。会话第一条用户消息就是 request #1:
 *   第一次模型请求只暴露一个原生 shell + alwaysTools(默认 read),会话持久日志出现
 *   首个晋升信号(默认 tool/call 或首个 assistant/message,先到者为准)后,后续请求
 *   开放 preset 的完整工具目录。
 * - `prewarm: true` —— 会话创建/选定本 preset 后,插件以系统来源的
 *   `prewarmMessage`(默认 "Run the bash command ls and reply with exactly the word done.")
 *   驱动 turn 1;用户的真实消息从 turn 2 开始。
 *
 * 无论是否 prewarm,只要 `prewarmPersona` 非空:首次模型请求的 system prompt 压成
 * 单独的锚定 persona 一节、maxTokens 压到 bootstrapMaxTokens、剥离
 * agent-instructions / skill-catalog;首个持久 `tool/call` 或首个 `assistant/message`
 * (默认 `promoteOn: either`)一落盘,同一回合的下一步就开放完整目录并恢复
 * AGENTS.md / skill catalog,原 system prompt 以 persona context 消息注入一次,
 * 后续 system prompt 仍保持锚定句。
 *
 * 阶段从持久 session events 推导,resume / reload 不丢状态。bootstrap 约束不满足时
 * 降级为完整目录并告警,组合漂移不会锁死会话。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { PERSONA_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import Schema from '@deepseek-ai/schemastery'
import { createHash, randomUUID } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

export const name = 'tool-bootstrap'

/**
 * prewarm 的驱动与延后触发依赖 host 提供的 timer 服务;preset 挂载语境里该服务
 * 恒可用(host 组合先于任何 session 就绪)。不声明 agents/agentPresets:两者都是
 * 可选协作方,经 ctx.get() 惰性读取,缺失时只意味着 prewarm 不投递,不影响锚定
 * 门本身。
 */
export const inject = ['timer'] as const

/** prewarm turn 1 的默认驱动消息(用户指定的锚定预热输入)。 */
export const DEFAULT_PREWARM_MESSAGE = 'Run the bash command ls and reply with exactly the word done.'

/** prewarm turn 1 的默认 system prompt(锚定 persona,逐字节 Minimal 一句话)。 */
export const DEFAULT_PREWARM_PERSONA = 'You are a helpful software engineer assistant.'

export const Config = Schema.object({
  shellTools: Schema.array(Schema.string())
    .default(['bash', 'pwsh'])
    .description('候选 shell 工具;组装目录里必须恰好出现其中一个(按列表顺序取第一个)。'),
  alwaysTools: Schema.array(Schema.string())
    .default(['read'])
    .description('bootstrap 阶段与 shell 一起保留的工具;每个都必须存在于组装目录。'),
  bootstrapTools: Schema.array(Schema.string()).description(
    '显式覆盖:bootstrap 目录完全由此列表决定(非空且每个都存在),设置后 shellTools/alwaysTools 被忽略。空数组视为未设置。',
  ),
  promoteOn: Schema.union(['either', 'tool-call', 'assistant-message', 'first-turn-complete'])
    .default('either')
    .description(
      '晋升信号:either = 首个持久 tool/call 或首个 assistant/message 先到者为准;'
        + 'tool-call = 仅首个持久 tool/call;assistant-message = 仅首个 assistant/message;'
        + 'first-turn-complete = 会话出现首个持久 turn/end 后晋升。',
    ),
  bootstrapMaxTokens: Schema.number()
    .default(1024)
    .description('bootstrap 请求的 maxTokens 上限;晋升后若仍是该值则剥离,恢复正常预算。'),
  prewarm: Schema.boolean()
    .default(false)
    .description(
      'true 时,会话创建即带本 preset 或 GUI 空白会话选定本 preset 后,自动以 prewarmMessage '
        + '驱动 turn 1;用户的真实消息从 turn 2 开始。',
    ),
  prewarmMessage: Schema.string()
    .default(DEFAULT_PREWARM_MESSAGE)
    .description('prewarm turn 1 注入的用户消息文本。'),
  prewarmPersona: Schema.string()
    .default(DEFAULT_PREWARM_PERSONA)
    .description(
      '常驻锚定 system prompt(与是否 prewarm 无关):整个系统提示压成这一节(其余 section 全部剥离),'
        + '晋升后仍保持;原 system prompt 改以 persona context 消息在晋升后的第一个 pre-step 注入。空字符串表示不替换。',
    ),
  zeroTools: Schema.boolean()
    .default(false)
    .description('bootstrap 请求不暴露任何工具(zero-tool 锚定,配合 anchorMessage 使用)。'),
  anchorMessage: Schema.string()
    .default('')
    .description(
      '非空时,顶层全新会话的第一条真实用户消息前自动插入该固定系统消息(source.kind=plugin/form=anchor);'
        + '模型先零工具答复该消息,晋升后用户的真实消息带全量工具继续。',
    ),
}) as Schema<BootstrapConfig>

export interface BootstrapConfig {
  shellTools?: string[]
  alwaysTools?: string[]
  bootstrapTools?: string[]
  promoteOn?: 'either' | 'tool-call' | 'assistant-message' | 'first-turn-complete'
  bootstrapMaxTokens?: number
  prewarm?: boolean
  prewarmMessage?: string
  prewarmPersona?: string
  zeroTools?: boolean
  anchorMessage?: string
}

/** agent loop 在运行时塞进组装上下文的 agent 字段(见 dsh-agent-loop 的 assembleContextFor)。 */
interface BootstrapAgent {
  session: {
    id: string
    events: ReadonlyArray<{
      type: string
      data?: { source?: { kind?: string } }
    }>
    header?: {
      /** 会话工作目录;项目级 AGENTS.md 向上发现从这里开始。 */
      cwd?: string
      /** 会话创建元数据;subagent 与 fork 会话不应再被预热。 */
      origin?: 'subagent'
      delegationDepth?: number
      seedLength?: number
      agentPreset?: string
    }
  }
  /** agent loop 的 scoped ctx;composedPreset 由此读实时组合。 */
  ctx?: unknown
  followup?(input: unknown): void
  /** agent loop 的 inbox;zero-tool 锚定用它把锚定消息插到第一条真实消息前。 */
  inbox?: { prepend(target: string, message: unknown): void }
}

const PROMOTE_EVENTS: Record<NonNullable<BootstrapConfig['promoteOn']>, string[]> = {
  either: ['tool/call', 'assistant/message'],
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  'first-turn-complete': ['turn/end'],
}

/** bootstrap 首请求必须剥离的注入提醒。 */
const BOOTSTRAP_INJECTED_SOURCE_KINDS = new Set(['skill-catalog', 'agent-instructions'])

const INSTRUCTIONS_INTRO = 'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. '
  + 'More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.'

const SYSTEM_REMINDER_OPEN = '<system-reminder>'
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'
/** 同一目录里同时识别 AGENTS.md 与 Agents.md;同名候选按内容去重,只保留首个。 */
const INSTRUCTION_FILE_NAMES = ['AGENTS.md', 'Agents.md'] as const
const USER_GLOBAL_SCOPE = 'user-global'
const PROJECT_ROOT_MARKERS = ['.git']

interface InstructionFile {
  absolutePath: string
  displayPath: string
  scope: string
  content: string
}

/** 晋升后注入的 AGENTS.md 基线:渲染文本 + 官方 agent-instructions 契约的 changes。 */
interface InstructionSet {
  text: string
  changes: Array<{ action: 'set'; scope: string; path: string; digest: string }>
}

const defaultDshHome = () => join(homedir(), '.dsh')
const resolveDshHome = () => {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? resolve(fromEnv) : defaultDshHome()
}

/** 官方同款显示规则:默认 home 显示 ~/.dsh,自定义 DSH_HOME 显示 $DSH_HOME。 */
function dshHomeDisplay(dshHome: string): string {
  return dshHome === defaultDshHome() ? '~/.dsh' : '$DSH_HOME'
}

function instructionContentSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function escapeInstructionFrameBody(text: string): string {
  return text.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')
}

/** 把任意注入文本包成与官方 instructions 一致的 system-reminder frame。 */
function systemReminderText(text: string): string {
  return `${SYSTEM_REMINDER_OPEN}\n${escapeInstructionFrameBody(text)}\n${SYSTEM_REMINDER_CLOSE}`
}

function isPluginPersonaContext(message: unknown): boolean {
  const source = (message as { source?: { kind?: string; form?: string; plugin?: string } } | undefined)?.source
  return source?.kind === 'plugin' && source.form === 'persona' && source.plugin === PERSONA_CONTEXT_PLUGIN
}

/**
 * 把 persona context 移到三个晋升后 context(skill-catalog / agent-instructions /
 * persona)的最前面。内层 tool-skill 的 catalog 追加在 next() 之后,且 claimed
 * 消息可能被内层克隆导致按 identity 找不到插入点;显式重排保证顺序稳定。
 */
function withPersonaFirst<T>(messages: T[]): T[] {
  const personaIndex = messages.findIndex(isPluginPersonaContext)
  if (personaIndex < 0) return messages
  const withoutPersona = messages.filter((_message, index) => index !== personaIndex)
  const firstInjectedContext = withoutPersona.findIndex((message) => {
    const kind = (message as { source?: { kind?: string } } | undefined)?.source?.kind
    return kind === 'skill-catalog' || kind === 'agent-instructions'
  })
  if (firstInjectedContext < 0) return messages
  const reordered = [...withoutPersona]
  reordered.splice(firstInjectedContext, 0, messages[personaIndex])
  return reordered
}

function projectScopeKey(directory: string, fileName: string): string {
  return `${directory.length === 0 ? '.' : directory}\0${fileName}`
}

function projectDisplayPath(projectRoot: string, absolutePath: string): string {
  const display = relative(projectRoot, absolutePath)
  return display.length === 0 ? basename(absolutePath) : display
}

/** 原始 system prompt 作为 context 消息注入时的 source.plugin 标识。 */
const PERSONA_CONTEXT_PLUGIN = '@deepseek-ai/dsh-tool-bootstrap'

/**
 * 插件注入的 user-role context 消息必须带唯一 id:聊天视图按 `data.id` 建立
 * context key,同一 pre-step 注入的两条 id-less 消息会在 `input-message/undefined`
 * 上相撞,客户端装配会丢弃后一条(模型收到、GUI 轨迹/上下文不显示)。
 */
function contextMessage(text: string, source: Record<string, unknown>): unknown {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
}

/** preset 挂载的 composition 目录(baseUrl)尾段就是 preset id。 */
function presetIdFromBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined
  try {
    const segments = new URL(baseUrl).pathname.split('/').filter((segment) => segment.length > 0)
    const id = segments.at(-1)
    if (id === undefined || id.length === 0) return undefined
    try {
      return decodeURIComponent(id)
    } catch {
      return id
    }
  } catch {
    return undefined
  }
}

/**
 * 从 cwd 向上找到最近的 `.git` 标记目录作为项目根;找不到时退回 cwd 本身,
 * 不继续把上层无关目录的 AGENTS.md 拉进上下文。
 */
async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        await access(join(current, marker))
        return current
      } catch {
        // 该目录没有此标记,继续向上。
      }
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** root → cwd 的包含链(由宽到窄),对齐官方 agent-instructions 的发现顺序。 */
function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  const resolvedRoot = resolve(root)
  let current = resolve(cwd)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * 收集全局($DSH_HOME/AGENTS.md)+ 项目(项目根 → cwd 逐级)的工作区指令,
 * 渲染为官方 agent-instructions 的 baseline 形态:`<system-reminder>` 分文件
 * 小节 + `form: instructions` 所需的 changes 清单。
 * 全部缺失时返回 undefined。web profile 没有 host agent-instructions 行,
 * 晋升后由本插件自行注入;有 host 行的部署已有持久事件,会自动跳过。
 */
async function readInstructionFiles(agent: BootstrapAgent): Promise<InstructionSet | undefined> {
  const dshHome = resolveDshHome()
  const files: InstructionFile[] = []

  const addDirectoryCandidates = async (
    directory: string,
    displayOf: (fileName: string) => string,
    scopeOf: (fileName: string) => string,
  ) => {
    // 大小写不敏感文件系统上候选名与磁盘实际大小写可能不一致;
    // 用 readdir 解析真实文件名,让 changes.path 与文本小节显示磁盘上的名字。
    const entries: string[] = await readdir(directory).catch(() => [] as string[])
    const actualNameOf = (candidate: string): string | undefined => {
      if (entries.includes(candidate)) return candidate
      const matches = entries.filter((entry) => entry.toLowerCase() === candidate.toLowerCase())
      return matches.length === 1 ? matches[0] : undefined
    }
    const reads: InstructionFile[] = []
    const seenPaths = new Set<string>()
    for (const candidate of INSTRUCTION_FILE_NAMES) {
      const fileName = actualNameOf(candidate)
      if (fileName === undefined) continue
      const absolutePath = join(directory, fileName)
      if (seenPaths.has(absolutePath)) continue
      seenPaths.add(absolutePath)
      try {
        const content = (await readFile(absolutePath, 'utf8')).trim()
        if (content.length > 0) {
          reads.push({ absolutePath, displayPath: displayOf(fileName), scope: scopeOf(fileName), content })
        }
      } catch {
        // 文件不存在或不可读:跳过。
      }
    }
    // AGENTS.md / Agents.md 在大小写不敏感文件系统上指向同一文件,
    // 同目录同名候选按内容去重,避免全局和项目内容重复注入。
    const digests = new Set<string>()
    for (const file of reads) {
      const digest = instructionContentSha1(file.content)
      if (digests.has(digest)) continue
      digests.add(digest)
      files.push(file)
    }
  }

  await addDirectoryCandidates(
    dshHome,
    (fileName) => `${dshHomeDisplay(dshHome)}/${fileName}`,
    (fileName) => `${USER_GLOBAL_SCOPE}\0${fileName}`,
  )

  const cwd = agent.session.header?.cwd ?? process.cwd()
  const projectRoot = await findProjectRoot(resolve(cwd))
  for (const directory of ancestorChain(projectRoot, cwd)) {
    await addDirectoryCandidates(
      directory,
      (fileName) => projectDisplayPath(projectRoot, join(directory, fileName)),
      (fileName) => projectScopeKey(relative(projectRoot, directory), fileName),
    )
  }

  if (files.length === 0) return undefined
  const changes = files.map((file) => ({
    action: 'set' as const,
    scope: file.scope,
    path: file.displayPath,
    digest: instructionContentSha1(file.content),
  }))
  const sections = files.map((file) => (
    `Instructions from: ${file.displayPath}\n\n${escapeInstructionFrameBody(file.content)}`
  ))
  const text = `${SYSTEM_REMINDER_OPEN}\n`
    + `${escapeInstructionFrameBody(INSTRUCTIONS_INTRO)}\n\n`
    + `${sections.join('\n\n')}\n`
    + SYSTEM_REMINDER_CLOSE
  return { text, changes }
}

function stringList(value: string[], field: string): string[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

function positiveInt(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name}: ${field} must be a positive safe integer`)
  }
  return value
}

export function apply(ctx: Context, config: BootstrapConfig = {}) {
  const shellTools = stringList(config.shellTools ?? ['bash', 'pwsh'], 'shellTools')
  const alwaysTools = stringList(config.alwaysTools ?? ['read'], 'alwaysTools')
  const bootstrapTools = config.bootstrapTools === undefined || config.bootstrapTools.length === 0
    ? undefined
    : stringList(config.bootstrapTools, 'bootstrapTools')
  const prewarm = config.prewarm === true
  const prewarmMessage = (config.prewarmMessage ?? DEFAULT_PREWARM_MESSAGE).trim()
  if (prewarm && prewarmMessage.length === 0) {
    throw new TypeError(`${name}: prewarmMessage must be a non-empty string when prewarm is enabled`)
  }
  const prewarmPersona = (config.prewarmPersona ?? DEFAULT_PREWARM_PERSONA).trim()
  const zeroTools = config.zeroTools === true
  const anchorMessage = (config.anchorMessage ?? '').trim()
  const promoteOn = config.promoteOn ?? 'either'
  const promoteEvents = PROMOTE_EVENTS[promoteOn]
  if (promoteEvents === undefined) {
    throw new TypeError(
      `${name}: promoteOn must be one of "tool-call", "assistant-message", "either", "first-turn-complete"; got ${JSON.stringify(promoteOn)}`,
    )
  }
  const bootstrapMaxTokens = positiveInt(config.bootstrapMaxTokens ?? 1024, 'bootstrapMaxTokens')

  /** 本进程内已晋升的会话;晋升只增不减,Set 成立。 */
  const promoted = new Set<string>()
  /** 已由本插件注入 AGENTS.md 的会话;避免重复注入。 */
  const injectedInstructions = new Set<string>()
  /** 已调度/已投递 prewarm 的会话;两条触发路径(agent/created 与 agent-preset/selected)去重。 */
  const prewarmed = new Set<string>()
  /** 已插入 zero-tool 锚定消息的会话;同一会话只锚定一次。 */
  const anchoredSessions = new Set<string>()
  /** 会话的原始 system prompt(renderPrompt 后的完整文本),晋升后作为 context 消息注入。 */
  const originalPrompts = new Map<string, string>()
  /** 已把原始 system prompt 作为 context 注入的会话;避免重复注入。 */
  const injectedPersonaContext = new Set<string>()
  const personaContextActive = () => prewarmPersona.length > 0
  let warned = false
  const warnOnce = (message: string) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // logger 缺失时只要求不刷屏。
    }
  }

  /** 本插件实例所属的 preset id,取自 preset composition 目录(baseUrl)。 */
  let selfPresetId = presetIdFromBaseUrl(ctx.baseUrl)
  if (prewarm && selfPresetId === undefined) {
    warnOnce(
      `${name}: prewarm requires a preset mount (the plugin context must carry the preset `
      + 'directory as baseUrl); prewarm is disabled and the bootstrap gate still applies',
    )
  }
  const prewarmActive = () => prewarm && selfPresetId !== undefined

  const lookupAgentPresets = () => ctx.get('agentPresets') as
    | { composedPreset(agentCtx: unknown): string | undefined }
    | undefined
  const lookupAgents = () => ctx.get('agents') as
    | { get(id: string): BootstrapAgent | undefined }
    | undefined

  /** agent 当前实际组合的 preset id;live scope 读不到时退回会话头部的创建事实。 */
  const composedPresetOf = (agent: BootstrapAgent | undefined): string | undefined => {
    if (agent === undefined) return undefined
    try {
      const composed = lookupAgentPresets()?.composedPreset(agent.ctx)
      if (composed !== undefined) return composed
    } catch {
      // agentPresets 服务缺失或 agent 已卸载:退回 header。
    }
    return agent.session.header?.agentPreset
  }

  const hasSessionWork = (session: BootstrapAgent['session']): boolean => (
    session.events.some((event) => event.type === 'turn/start' || event.type === 'user/message')
  )
  const isDelegated = (session: BootstrapAgent['session']): boolean => (
    session.header?.origin === 'subagent'
    || (session.header?.delegationDepth ?? 0) > 0
    || (session.header?.seedLength ?? 0) > 0
  )

  /**
   * 渲染会话真正的原始 system prompt,作为晋升后的 persona context 文本。
   * `system-prompt/assemble` 的 complete-section 约束发生在 waterfall 返回之后,
   * 监听器拿到的是约束前的 sections;这里按官方同样规则补上 complete 还原,
   * 避免把 harness identity / 工具使用指导错当成原 prompt。
   */
  const renderOriginalPrompt = (assembleContext: unknown, assembled: PromptAssembly): string => {
    const scope = (assembleContext as { scope?: unknown } | undefined)?.scope
    if (scope !== undefined) {
      try {
        const systemPrompt = ctx.get('systemPrompt') as any
        const definitions = systemPrompt?.layers?.merge?.(scope, (layer: any) => layer.sections)
        const complete = [...(definitions?.values?.() ?? [])].find((section) => section?.complete === true)
        if (complete !== undefined) {
          const section = assembled.sections.find((item) => item.name === complete.name)
          if (section !== undefined) return renderPrompt({ ...assembled, sections: [section] })
        }
      } catch {
        // 服务缺失或 layers 契约变化:退回渲染当前 sections。
      }
    }
    return renderPrompt(assembled)
  }

  /**
   * 调度 prewarm turn 1:以普通用户消息投递给 agent loop。两条触发路径都先落到
   * 这里,`prewarmed` 去重;投递前再次核对组合与会话状态,防止空白会话在 timer
   * 到期前被切换 preset 或已开始真实工作。
   */
  const schedulePrewarm = (agent: BootstrapAgent | undefined): void => {
    if (!prewarmActive() || agent === undefined) return
    const session = agent.session
    if (session === undefined || session.id === undefined) return
    if (prewarmed.has(session.id) || hasSessionWork(session) || isDelegated(session)) return
    const composed = composedPresetOf(agent)
    if (composed !== undefined && composed !== selfPresetId) return
    prewarmed.add(session.id)
    const sessionId = session.id
    // session/event 回调位于 session.append 栈内,append 不能重入;延后到栈外投递。
    ctx.setTimeout(() => {
      try {
        const live = lookupAgents()?.get(sessionId) ?? agent
        if (live === undefined) return
        const liveComposed = composedPresetOf(live)
        if (selfPresetId === undefined || (liveComposed !== undefined && liveComposed !== selfPresetId)) return
        if (hasSessionWork(live.session) || isDelegated(live.session)) return
        if (typeof live.followup !== 'function') {
          warnOnce(`${name}: prewarm delivery requires agent.followup (agent loop missing); skipped for session ${sessionId}`)
          return
        }
        live.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: prewarmMessage }],
          source: {
            kind: 'plugin',
            plugin: PERSONA_CONTEXT_PLUGIN,
            form: 'prewarm',
            summary: 'bootstrap prewarm turn',
          },
        })
      } catch (error) {
        try {
          ctx.logger.warn(`${name}: prewarm delivery failed for session ${sessionId}: ${String((error as Error)?.message ?? error)}`)
        } catch {
          // 只要求不抛出。
        }
      }
    }, 0)
  }

  // agent/created 是 scope-filtered 事件:只有组成于本 preset 的 agent 才会派发给
  // 本插件实例,覆盖「创建即带 preset」的路径。
  ctx.on('agent/created', (payload: any) => {
    const agent = payload?.agent as BootstrapAgent | undefined
    if (agent === undefined || !prewarm) return
    if (selfPresetId === undefined) selfPresetId = composedPresetOf(agent)
    schedulePrewarm(agent)
  })

  // session/event 是全局事件,不按 scope 过滤;以事件里的 agentPreset id 对照
  // 本实例的 preset id,覆盖 GUI 两步流(空白会话 → agentPreset.select → 落盘
  // agent-preset/selected)。
  ctx.on('session/event', (session: any, event: any) => {
    if (!prewarm || event.type !== 'agent-preset/selected') return
    const selected = event.data?.agentPreset as string | undefined
    if (selected !== undefined && selfPresetId !== undefined && selected !== selfPresetId) return
    if (selfPresetId === undefined && selected !== undefined) selfPresetId = selected
    const sessionId = session?.id
    if (sessionId === undefined) return
    const agent = lookupAgents()?.get(sessionId)
    schedulePrewarm(agent)
  })

  // zero-tool 锚定(anchorMessage 非空):顶层全新会话的第一条真实用户消息进 inbox 时,
  // 把固定锚定消息插到它前面。模型先零工具答复锚定消息,晋升后真实消息带全量工具继续。
  // 锚定在第一条消息到达时触发,而不是会话创建时,空白会话仍可自由切换 preset。
  if (anchorMessage.length > 0) {
    ctx.on('agent/inbox/inserted', (payload: any) => {
      const agent = payload?.agent as BootstrapAgent | undefined
      const message = payload?.message as { source?: { kind?: string } } | undefined
      if (agent === undefined || message === undefined || anchoredSessions.has(agent.session.id)) return
      if (isDelegated(agent.session)) return
      if (agent.session.events.some((event) => event.type === 'user/message')) return
      if (message.source?.kind === 'plugin') return
      if (typeof agent.inbox?.prepend !== 'function') {
        warnOnce(`${name}: anchorMessage requires agent.inbox.prepend (agent loop missing); zero-tool anchor disabled`)
        return
      }
      anchoredSessions.add(agent.session.id)
      try {
        agent.inbox.prepend('next-turn', {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: anchorMessage }],
          source: {
            kind: 'plugin',
            plugin: PERSONA_CONTEXT_PLUGIN,
            form: 'anchor',
            summary: 'zero-tool anchor turn',
          },
        })
      } catch (error) {
        anchoredSessions.delete(agent.session.id)
        try {
          ctx.logger.warn(`${name}: failed to insert zero-tool anchor for session ${agent.session.id}: ${String((error as Error)?.message ?? error)}`)
        } catch {
          // 只要求不抛出。
        }
      }
    })
  }

  const isPromoted = (agent: BootstrapAgent | undefined): boolean => {
    if (agent === undefined || agent.session === undefined) return true
    const session = agent.session
    if (promoted.has(session.id)) return true
    const hit = session.events.some((event) => promoteEvents.includes(event.type))
    if (hit) promoted.add(session.id)
    return hit
  }

  const applyBootstrap = (assembled: PromptAssembly): PromptAssembly => {
    const available = new Set(assembled.tools.map((tool) => tool.name))
    let bootstrap: Set<string>
    if (zeroTools) {
      bootstrap = new Set()
    } else if (bootstrapTools !== undefined) {
      const missing = bootstrapTools.filter((toolName) => !available.has(toolName))
      if (missing.length > 0) {
        warnOnce(
          `${name}: bootstrapTools missing from the catalog: ${JSON.stringify(missing)} — `
          + 'bootstrap disabled, full catalog exposed',
        )
        return assembled
      }
      bootstrap = new Set(bootstrapTools)
    } else {
      const selectedShells = shellTools.filter((toolName) => available.has(toolName))
      const missingAlways = alwaysTools.filter((toolName) => !available.has(toolName))
      if (selectedShells.length !== 1 || missingAlways.length > 0) {
        warnOnce(
          `${name}: expected exactly one bootstrap shell and every alwaysTool; `
          + `shells=${JSON.stringify(selectedShells)}, missing=${JSON.stringify(missingAlways)} — `
          + 'bootstrap disabled, full catalog exposed',
        )
        return assembled
      }
      bootstrap = new Set([...selectedShells, ...alwaysTools])
    }
    const filtered = { ...assembled, tools: assembled.tools.filter((tool) => bootstrap.has(tool.name)) }
    // 只要 prewarmPersona 非空,首请求的 system prompt 就必须逐字节等于锚定 persona:
    // 只保留一个 persona 槽,把 harness identity / 工具使用指导等其他 section 全部剥掉。
    // 晋升后 system prompt 仍保持锚定(见 system-prompt/assemble 监听器),
    // 原 system prompt 改以 context 消息在晋升后第一个 pre-step 注入。
    if (prewarmPersona.length === 0) return filtered
    return {
      ...filtered,
      sections: [{ name: PERSONA_SECTION, text: prewarmPersona }],
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      const agent = (context as AssembleContext & { agent?: BootstrapAgent }).agent
      const sessionId = agent?.session?.id
      // 捕获会话的原始 system prompt(prewarmPersona 非空时),晋升后作为 context
      // 消息注入;捕获发生在任何变换之前,resume/reload 后同样能拿到原文。
      if (personaContextActive() && sessionId !== undefined && !originalPrompts.has(sessionId)) {
        try {
          const original = renderOriginalPrompt(context, assembled)
          if (original.length > 0) originalPrompts.set(sessionId, original)
        } catch (error) {
          warnOnce(`${name}: failed to render the original system prompt for context injection: ${String((error as Error)?.message ?? error)}`)
        }
      }
      if (isPromoted(agent)) {
        // 晋升后 system prompt 仍保持锚定句;原 system prompt 改由 agent/pre-step
        // 在晋升后的第一个 pre-step 以 context 消息注入。
        if (personaContextActive()) {
          return { ...assembled, sections: [{ name: PERSONA_SECTION, text: prewarmPersona }] }
        }
        return assembled
      }
      return applyBootstrap(assembled)
    } catch (error) {
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error as Error)?.message ?? error)}`)
      return assembled
    }
  })

  // 首个模型请求的 output budget 对轨迹锚定影响很大:1024 复现上游结果。
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload.agent as unknown as BootstrapAgent
    if (isPromoted(agent)) {
      // 下一请求的 seed proposal 会继承上一份 header 的 maxTokens;
      // 晋升后必须显式剥离注入的 cap,否则 1024 会跟随整个会话。
      if (resolved.maxTokens === bootstrapMaxTokens) {
        const { maxTokens: _bootstrap, ...rest } = resolved
        return rest
      }
      return resolved
    }
    return { ...resolved, maxTokens: bootstrapMaxTokens }
  })

  // pre-step 瀑布:
  // - bootstrap 请求剥离 skill catalog 与 AGENTS.md 注入;
  // - 晋升后的第一个 pre-step 注入两样东西:捕获到的原 system prompt(以 context
  //   消息形式)与全局 + 项目 AGENTS.md(web profile 没有 host agent-instructions
  //   行;有该行且已落盘的部署会跳过,避免重复)。
  // 注意:rc.6 的 loader 会并发激活 preset 行,行序不能保证 listener 注册序;
  // 因此这里用 prepend 注册,确保本插件恒为瀑布最外层,能在 tool-skill 与
  // agent-instructions 追加注入之后做最终过滤。
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const agent = payload.agent as unknown as BootstrapAgent
    if (!isPromoted(agent)) {
      return {
        ...decision,
        messages: decision.messages.filter((message) => {
          const kind = (message as { source?: { kind?: string } }).source?.kind
          return kind === undefined || !BOOTSTRAP_INJECTED_SOURCE_KINDS.has(kind)
        }),
      }
    }
    const session = agent.session
    const pending: unknown[] = []

    // 原 system prompt 作为 context 消息注入:晋升后的第一个 pre-step 一次到位,
    // 之后的请求靠会话历史携带,不重复注入。原 prompt 与锚定句相同时无需注入。
    if (personaContextActive() && !injectedPersonaContext.has(session.id)) {
      injectedPersonaContext.add(session.id)
      const original = originalPrompts.get(session.id)
      if (original !== undefined && original.trim() !== prewarmPersona) {
        pending.push(contextMessage(systemReminderText(original), {
          kind: 'plugin', plugin: PERSONA_CONTEXT_PLUGIN, form: 'persona',
        }))
      }
      originalPrompts.delete(session.id)
    }

    if (!injectedInstructions.has(session.id)) {
      const existing = session.events.some((event) => event.type === 'user/message'
        && event.data?.source?.kind === 'agent-instructions')
      if (existing) {
        injectedInstructions.add(session.id)
      } else {
        const instructions = await readInstructionFiles(agent)
        injectedInstructions.add(session.id)
        if (instructions !== undefined) {
          pending.push(contextMessage(instructions.text, {
            kind: 'agent-instructions',
            form: 'instructions',
            baseline: true,
            changes: instructions.changes,
          }))
        }
      }
    }

    if (pending.length === 0) return decision
    const claimed = (payload as { messages?: unknown[] }).messages
    const lastClaimed = decision.messages.findLastIndex((message) => claimed?.includes(message))
    const insertAt = lastClaimed === -1 ? decision.messages.length : lastClaimed + 1
    const withPending = decision.messages.toSpliced(insertAt, 0, ...(pending as never[]))
    return {
      kind: 'enter',
      messages: withPersonaFirst(withPending),
    }
  }, { prepend: true })
}
