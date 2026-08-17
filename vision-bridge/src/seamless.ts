/** seamless 桥：粘贴落地 / read 拦截 / bash 出图检测。状态按会话隔离（挂在 exposure 状态机上）。 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecution, ToolExecutionResult, PreToolDecision, PostToolDecision } from '@deepseek-ai/dsh-tools'
import type { Exposure } from './exposure.js'
import type { SeesImagesFn } from './capabilities.js'
import type { FenceRegistry } from './paths.js'
import type { RemoteVision } from './remote.js'
import type { BridgeLogger } from './logger.js'
import { intentFromPaste, intentFromRecent } from './intent.js'

const EXT_BY_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const IMG_PATH = /\b[\w./~-]+\.(png|jpe?g|webp|gif|heic|bmp|avif|tiff?)\b/i
const IMG_PATH_GLOBAL = /[\w./~-]+\.(png|jpe?g|webp|gif|heic|bmp)\b/gi

export interface SeamlessDeps {
  exposure: Exposure
  seesImages: SeesImagesFn
  fences: FenceRegistry
  logger: BridgeLogger
  attachments?: AttachmentStore
  remote?: RemoteVision
  autoDescribeBashShots: boolean
}

interface PreStepPayload {
  agent: Agent
  messages: UserMessage[]
  turn: number
  step: number
  signal: AbortSignal
}

function workspaceOf(agent: Agent): string | undefined {
  return (agent.session as unknown as { header?: { cwd?: string } })?.header?.cwd
}

export class Seamless {
  constructor(
    private readonly ctx: Context,
    private readonly deps: SeamlessDeps,
  ) {}

  attach(): void {
    this.ctx.on('agent/pre-step', (payload, next) => this.onPreStep(payload, next))
    this.ctx.on('tools/pre-execute', (exec, next) => this.onPreExecute(exec, next))
    this.ctx.on('tools/post-execute', (exec, result, next) => this.onPostExecute(exec, result, next))
    this.ctx.on('tools/result', (exec, result) => this.onToolResult(exec, result))
  }

  // ── 钩子 1：粘贴图片 → 工作区固定输入目录落盘 + 路径/意图注入 ──
  private async onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    const decision = await next()
    if (!decision || decision.kind !== 'enter') return decision
    const agent = payload.agent
    try {
      const sees = await this.deps.seesImages(agent)
      if (sees) return decision
      const messages = decision.messages ?? []
      let hit = false
      const out: UserMessage[] = []
      for (const message of messages) {
        const blocks = Array.isArray(message.content) ? message.content : null
        if (blocks === null || !blocks.some((b) => (b as { type?: string })?.type === 'image')) {
          out.push(message)
          continue
        }
        hit = true
        const hint = intentFromPaste(message)
        const newBlocks: ContentBlock[] = []
        for (const block of blocks) {
          if ((block as { type?: string }).type !== 'image') {
            newBlocks.push(block)
            continue
          }
          const ref = (block as { attachment?: ImageAttachmentRef }).attachment
          let saved: string | null = null
          try {
            saved = ref ? await this.savePaste(agent, ref, payload.signal) : null
          } catch (e) {
            this.deps.logger.warn({ agent: agent.id }, `paste save failed: ${String(e)}`)
          }
          const text = saved === null
            ? '（粘贴的图片未能保存到本地：请让用户把截图另存为文件后再试）'
            : saved + (hint ? '\n意图：' + hint : '')
          newBlocks.push({ type: 'text', text })
        }
        out.push({ ...message, content: newBlocks })
      }
      if (!hit) return decision
      this.deps.exposure.activate(agent, 'paste')
      return { kind: 'enter', messages: out }
    } catch (e) {
      this.deps.logger.warn({ agent: agent.id }, `pre-step seamless error: ${String(e)}`)
      return decision
    }
  }

  /** 内容哈希命名 → 工作区固定输入目录；同内容不重复落盘（持久，不用系统临时目录）。 */
  private async savePaste(agent: Agent, ref: ImageAttachmentRef, signal?: AbortSignal): Promise<string | null> {
    const attachments = this.deps.attachments
    if (attachments === undefined) return null
    const stored = await attachments.readImage(ref, signal)
    const fence = await this.deps.fences.forWorkspace(workspaceOf(agent))
    const dir = await fence.ensureInputsDir()
    const hash = createHash('sha256').update(Buffer.from(stored.data.buffer, stored.data.byteOffset, stored.data.byteLength)).digest('hex')
    const ext = EXT_BY_MEDIA[ref.mediaType] ?? 'png'
    const target = path.join(dir, hash + '.' + ext)
    if (existsSync(target) && (await fsp.stat(target)).size === stored.data.byteLength) {
      return target
    }
    const tmp = target + '.tmp-' + createHash('md5').update(String(Date.now()) + String(Math.random())).digest('hex').slice(0, 8)
    await fsp.writeFile(tmp, stored.data)
    await fsp.rename(tmp, target)
    this.deps.logger.info({ agent: agent.id, bytes: stored.data.byteLength, path: target }, 'pasted image landed')
    return target
  }

  // ── 钩子 2：read/read_image 读图拦截（deny 只给两行指路，完整协议只在 skill） ──
  private async onPreExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    try {
      if (exec.name !== 'read' && exec.name !== 'read_image') return next()
      const agent = exec.agent
      if (agent === undefined) return next()
      const args = exec.arguments as Record<string, unknown> | null | undefined
      const target = String(args?.file_path ?? '')
      if (!IMG_PATH.test(target)) return next()
      const sees = await this.deps.seesImages(agent)
      if (sees) return next()
      this.deps.exposure.activate(agent, 'read-intercept')
      return {
        kind: 'deny',
        reason:
          '当前会话模型不支持图片输入，read 读不了这张图。\n' +
          '用 vision_glance 看图/问答（或 vision_ground 定位 + vision_crop 裁剪）；完整方法见 skill：vision-bridge。',
      }
    } catch (e) {
      return next()
    }
  }

  // ── 钩子 3：bash 出图检测（默认只注入路径+建议；自动描述默认关） ──
  private async onPostExecute(exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> {
    try {
      if (exec.name !== 'bash' || exec.agent === undefined) return next()
      const agent = exec.agent
      const sees = await this.deps.seesImages(agent)
      if (sees) return next()
      const args = exec.arguments as Record<string, unknown> | null | undefined
      const command = String(args?.command ?? '')
      const resultContent = (result as { content?: ContentBlock[] }).content ?? []
      const resultText = resultContent
        .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
        .join('\n')
      const found = await this.collectExistingImages(command, resultText)
      if (found.length === 0) return next()
      this.deps.exposure.activate(agent, 'bash-shot')
      let extra = '【视觉桥】检测到图片 ' + found.join('、') + '。建议：vision_glance 查看/问答；vision_ground 定位 + vision_crop 裁剪。'
      if (this.deps.autoDescribeBashShots && this.deps.remote !== undefined) {
        try {
          const fence = await this.deps.fences.forWorkspace(workspaceOf(agent))
          const reals: string[] = []
          for (const p of found.slice(0, 2)) {
            try { reals.push(await fence.resolveInput(p)) } catch (e) { /* 越界图片跳过 */ }
          }
          if (reals.length > 0) {
            const hint = intentFromRecent(agent)
            const described = await this.deps.remote.run(
              'glance',
              { images: reals, hint, maxTokens: 1200 },
              { signal: exec.signal },
            ) as { answer?: unknown }
            if (described && typeof described.answer === 'string' && described.answer.trim()) {
              extra += '\n\n【视觉桥自动描述】\n' + described.answer.trim()
            }
          }
        } catch (e) {
          this.deps.logger.warn({ agent: agent.id }, `auto describe failed (不阻断原结果): ${String(e)}`)
        }
      }
      const base = await next()
      if (!base || base.kind !== 'accept') return base
      if (base.value !== undefined) return base
      const content = (base.content !== undefined ? base.content : resultContent).slice()
      content.push({ type: 'text', text: extra })
      return { kind: 'accept', content }
    } catch (e) {
      return next()
    }
  }

  /** 等待截图落盘（最多 3s），确认文件存在。 */
  private async collectExistingImages(command: string, resultText: string): Promise<string[]> {
    const source = command + '\n' + (resultText ?? '')
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    IMG_PATH_GLOBAL.lastIndex = 0
    while ((match = IMG_PATH_GLOBAL.exec(source)) !== null && seen.size < 2) {
      seen.add(match[0])
    }
    const out: string[] = []
    for (const p of seen) {
      for (let i = 0; i < 12; i++) {
        if (existsSync(p)) {
          out.push(p)
          break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    return out
  }

  // ── 钩子 4：skill 工具加载了 vision-bridge skill → 激活（按返回内容标记判定） ──
  private onToolResult(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined {
    try {
      if (exec.name !== 'skill' || exec.agent === undefined) return undefined
      const content = (result as { content?: ContentBlock[] }).content ?? []
      const loaded = content.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('VISION_BRIDGE_ROUTE_C_SKILL_MARKER'))
      if (loaded) {
        this.deps.exposure.activate(exec.agent, 'skill-load')
      }
    } catch (e) { /* 观察者绝不抛错 */ }
    return undefined
  }
}
