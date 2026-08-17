/** intent：从会话事件提取「为什么看这张图」的 focus hint（03 票冻结规则）。 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

export const HINT_MAX_CHARS = 500

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => {
      const block = b as { type?: string; text?: unknown } | null
      return block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .join('\n')
}

function trimHint(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > HINT_MAX_CHARS ? cleaned.slice(0, HINT_MAX_CHARS) : cleaned
}

/** 粘贴图片：只取同一条用户消息里的非图片文本；没有伴生文本就无 hint，禁止借用更早上下文。 */
export function intentFromPaste(message: UserMessage): string {
  const blocks = message.content ?? []
  const texts = blocks
    .filter((b) => (b as { type?: string }).type === 'text')
    .map((b) => ((b as { text?: unknown }).text ?? '') as string)
  return trimHint(texts.join('\n'))
}

interface SurfaceEvent {
  type: string
  data?: {
    message?: UserMessage
  }
}

/** bash 出图自动描述：优先取助手最后一个段落的文本，否则回退到最新一条真实用户请求。 */
export function intentFromRecent(agent: Agent | undefined): string {
  const events = (agent?.session?.events ?? []) as readonly SurfaceEvent[]
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'assistant/message') continue
    const message = event.data?.message
    if (!message) continue
    const text = textOfBlocks(message.content).trim()
    if (!text) continue
    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
    const last = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : text
    const hint = trimHint(last)
    if (hint) return hint
  }
  // 回退：最新一条真实用户请求（source.kind === 'user'；system-reminder/AGENTS.md/工具结果等不算）
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'user/message') continue
    const message = event.data?.message
    const source = message?.source as { kind?: string } | undefined
    if (!message || source?.kind !== 'user') continue
    const hint = trimHint(textOfBlocks(message.content))
    if (hint) return hint
  }
  return ''
}
