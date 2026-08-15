/**
 * dsh-session-ui-enhance — client half.
 *
 * A vertically centered rail of user-turn bars at the left edge of the
 * conversation column: hovering ramps the bar lengths around the hovered
 * turn, a hover card previews the turn's input, and clicking locates and
 * highlights the message. The same bundle contributes the tiered
 * content-width breakpoints and breathing clearance (see rail.module.css),
 * plus a zcode-style markdown typography restyle of the conversation
 * surface (see typography.css — type scale, weights, ink, tables, and
 * code-block cards), and a quiet bottom collapse button for tall expanded
 * Think blocks (see think-collapse.ts). User message bubbles get a quiet
 * restyle (smaller radius, compact type, hairline border) plus a collapse
 * toggle for overlong inputs (see user-bubble.ts); the composer card gets a
 * matching restyle with a focus ring (see composer.ts), and plain Tab
 * confirms the highlighted slash-menu candidate through the official Enter
 * arbitration (see slash-tab.ts).
 *
 * The rail is contributed into the `conversation.session.header.utilities`
 * slot, which ui-conversation declares and owns: this plugin only registers
 * an entry (the four-step contract — declare / claim / inject / render —
 * never lets a contributor own a slot it did not declare).
 *
 * @module dsh-session-ui-enhance/client
 */

import type { ClientContext, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the
// conversation.session.header.utilities entry) through the assembly boundary.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import React from 'react'
import styles from './rail.module.css'
import { applyCodeLangTagging } from './code-lang'
import { applyMermaidRenderer } from './mermaid'
import { applyThinkCollapse } from './think-collapse'
import { applyProcessCollapse } from './process-collapse'
import { applyWorkspaceActions } from './workspace-actions'
import { applyUserBubble } from './user-bubble'
import { applyComposerStyle } from './composer'
import { applyModelSplit } from './model-split'
import { applySlashTabConfirm } from './slash-tab'
// Side effect: injects the zcode-style markdown typography restyle (global,
// non-module CSS — token overrides + table/code-block chrome) as one
// <style data-plugin> tag that the loader removes on unload.
import './typography.css'
// Side effect: quiet styling for the injected think-block bottom collapse
// button (see think-collapse.ts).
import './think-collapse.css'
// Side effect: per-turn process collapse — attribute-driven hiding plus the
// injected 「过程细节」toggle row (see process-collapse.ts).
import './process-collapse.css'
// Side effect: single-row session header restyle — tabs moved up beside the
// title via CSS order, active bar docked onto the header hairline (pure CSS,
// gated on :has(> [role=tablist]); see header.css).
import './header.css'
// Side effect: workspace session-row actions — 「...」 becomes an archive
// button with an in-row red confirm step and rename/fork move to a
// right-click menu (see workspace-actions.ts).
import './workspace-actions.css'
// Side effect: user message bubble restyle + long-input collapse chrome
// (gated on body[data-z-user-bubble]; see user-bubble.ts).
import './user-bubble.css'
// Side effect: composer card restyle — smaller radius, compact type, focus
// ring (gated on body[data-z-composer]; see composer.ts).
import './composer.css'

/** Required services: the slot registry (provided by the client runtime). */
export const inject = ['slots']

/** One rail row's derived view data; `key` is the engine-owned chat node key. */
interface Turn {
  key: string
  seq: number
  text: string
}

/** Structural view of a content block for the preview extractor. */
interface TextBlockLike {
  type: string
  text?: unknown
}

/** The header-utilities owner passes nothing: this is the framework session kit. */
type RailProps = PropsRuntime<'conversation.session.header.utilities'>

const BASE_WIDTH = 13
const PEAK_WIDTH = 26
const RAMP_STEP = 3
const MIN_WIDTH = 13
/** Gap between the conversation scrollport's left edge and the rail. */
const RAIL_OFFSET = 10

/**
 * Collapse one user message's content blocks into a short preview string.
 * @param content - the user message's content blocks.
 * @returns up to four non-blank lines, ellipsized beyond 260 characters.
 */
function previewText(content: readonly TextBlockLike[]): string {
  const lines = content
    .filter(block => block.type === 'text' && block.text !== undefined && block.text !== null)
    .map(block => String(block.text))
    .join('\n')
    .split('\n')
    .filter(line => line.trim().length > 0)
  if (lines.length === 0) return '（无文本内容）'
  let out = lines.slice(0, 4).join('\n')
  if (lines.length > 4) out += '\n…'
  if (out.length > 260) out = out.slice(0, 260) + '…'
  return out
}

/**
 * The rail body: derives the turn list from the chat view's own visible
 * order (the same `chat.order` the owner renders from, so rail rows and
 * DOM flow items can never drift apart), tracks the conversation
 * scrollport's left edge, and renders the interactive bar rail.
 * @param props - framework session kit (sessionId, useSession, …).
 * @returns the rail, or null while there is nothing to anchor it to.
 */
function UserTurnRail(props: RailProps): React.ReactElement | null {
  const { useSession, sessionId } = props
  const [left, setLeft] = React.useState<number | null>(null)
  const [hovered, setHovered] = React.useState(-1)
  const [selected, setSelected] = React.useState(-1)
  const flashRef = React.useRef<HTMLElement | null>(null)

  // Authoritative render source: the chat view's visible order + keyed
  // store, exactly what ui-conversation's ChatView maps into DOM rows.
  // (The legacy top-level `snapshot.nodes` field keeps every node and its
  // own order, so an index built from it can silently point at the wrong
  // row whenever nodes are hidden or reordered.)
  const order = useSession(snapshot => snapshot.chat.order)
  const nodeStore = useSession(snapshot => snapshot.chat.nodes)

  const turns: Turn[] = []
  for (const key of order) {
    const node = nodeStore.get(key)
    if (node === undefined || node.kind !== 'user') continue
    const data = node.data as UserMessageNode
    if (!Array.isArray(data.content)) continue
    turns.push({ key, seq: data.seq, text: previewText(data.content) })
  }

  // 测量常驻滚动口([data-conversation-scroll])的左缘,并只在 chat 视图
  // 激活时显示:对话/轨迹两个视图分时渲染进同一个常驻 scrollport(轨迹
  // 视图没有 [data-chat-flow-key] 会话流行),仅量左缘会让导轨错误地挂在
  // 轨迹页上。DOM 观察器按 rAF 节流收敛视图切换、流式增行与布局变化。
  React.useEffect(() => {
    if (turns.length === 0) return
    let alive = true
    let scrollport: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null
    let raf = 0
    const evaluate = () => {
      raf = 0
      if (!alive) return
      const el = document.querySelector('[data-conversation-scroll]')
      if (el !== scrollport) {
        scrollport = el instanceof HTMLElement ? el : null
        if (resizeObserver !== null) {
          resizeObserver.disconnect()
          resizeObserver = null
        }
        if (scrollport !== null) {
          resizeObserver = new ResizeObserver(schedule)
          resizeObserver.observe(scrollport)
        }
      }
      if (scrollport === null) {
        setLeft(null)
        raf = window.requestAnimationFrame(evaluate)
        return
      }
      const chatActive = scrollport.querySelector('[data-chat-flow-key]') !== null
      setLeft(chatActive ? scrollport.getBoundingClientRect().left : null)
    }
    const schedule = () => {
      if (!alive || raf !== 0) return
      raf = window.requestAnimationFrame(evaluate)
    }
    evaluate()
    const domObserver = new MutationObserver(schedule)
    domObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => {
      alive = false
      if (raf !== 0) window.cancelAnimationFrame(raf)
      domObserver.disconnect()
      if (resizeObserver !== null) resizeObserver.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [sessionId, turns.length])

  if (turns.length === 0 || left === null) return null

  const activeIndex = selected >= 0 && selected < turns.length ? selected : turns.length - 1
  const hoveredIndex = hovered >= 0 && hovered < turns.length ? hovered : -1

  const goTo = (index: number) => {
    setSelected(index)
    const turn = turns[index]
    if (turn === undefined) return
    // Match the owner's own row by the engine-owned chat node key instead
    // of positional index: the DOM list is `chat.order` filtered by kind,
    // so keys stay aligned no matter what the rest of the flow contains.
    let row: HTMLElement | null = null
    for (const el of document.querySelectorAll('[data-chat-flow-key]')) {
      if (el instanceof HTMLElement && el.dataset.chatFlowKey === turn.key) {
        row = el
        break
      }
    }
    if (row === null) return
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const flashClass = styles.flash ?? ''
    const prev = flashRef.current
    if (prev !== null) prev.classList.remove(flashClass)
    row.classList.add(flashClass)
    flashRef.current = row
    window.setTimeout(() => {
      if (flashRef.current === row) {
        row.classList.remove(flashClass)
        flashRef.current = null
      }
    }, 1700)
  }

  return (
    <nav className={styles.rail} style={{ left: Math.round(left + RAIL_OFFSET) }} aria-label="用户轮次定位">
      {turns.map((turn, index) => {
        const bright = index === activeIndex || index === hoveredIndex
        const dist = hoveredIndex < 0 ? -1 : Math.abs(index - hoveredIndex)
        const width = hoveredIndex < 0 ? BASE_WIDTH : Math.max(MIN_WIDTH, PEAK_WIDTH - dist * RAMP_STEP)
        let opacity = bright ? 1 : 0.5
        if (hoveredIndex >= 0 && !bright) opacity = Math.max(0.26, 0.5 - dist * 0.06)
        return (
          <div
            key={turn.key}
            className={styles.row}
            role="button"
            tabIndex={0}
            aria-label={`第 ${index + 1} 轮`}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(-1)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(-1)}
            onClick={() => goTo(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                goTo(index)
              }
            }}
          >
            <div
              className={styles.line}
              style={{
                width: `${width}px`,
                backgroundColor: bright
                  ? 'var(--dsw-alias-label-primary)'
                  : 'var(--dsw-alias-label-secondary)',
                opacity,
              }}
            />
            <div className={styles.card}>
              <div className={styles.cardMeta}>
                <span className={styles.cardTurn}>第 {index + 1} 轮</span>
                <span className={styles.cardHint}>点击定位</span>
              </div>
              <div className={styles.cardText}>{turn.text}</div>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

/**
 * Client plugin body: waits for the header-utilities declaration and
 * contributes the rail entry. The loader collects the whole effect tree on
 * unload; the CSS Module tag is injected by the bundle and removed by the
 * loader, so nothing here needs manual cleanup.
 * @param ctx - client root context carrying the slot registry.
 */
export function apply(ctx: ClientContext): void {
  // Mirror code-block banner language text into `data-z-lang` so
  // typography.css can render per-language brand icons (see code-lang.ts).
  applyCodeLangTagging(ctx)
  // Replace ```mermaid code blocks with interactive SVG cards (see mermaid.ts).
  applyMermaidRenderer(ctx)
  // Give tall expanded Think blocks a quiet bottom collapse button (see
  // think-collapse.ts).
  applyThinkCollapse(ctx)
  // Fold each finished turn's intermediate process (think rows, tool cards)
  // behind a quiet 「过程细节」toggle, zcode-style (see process-collapse.ts).
  applyProcessCollapse(ctx)
  // Left-workspace session rows: replace the 「...」 button with an archive
  // button that pops an in-row red 「确认」 button, and move rename/fork into
  // a right-click menu (see workspace-actions.ts).
  applyWorkspaceActions(ctx)
  // User message bubbles: quiet restyle + collapse for overlong inputs
  // (see user-bubble.ts).
  applyUserBubble(ctx)
  // Composer card restyle gate (see composer.ts).
  applyComposerStyle(ctx)
  // Plain Tab in an open slash menu confirms the highlighted skill/command
  // through the official Enter arbitration (see slash-tab.ts).
  applySlashTabConfirm(ctx)
  // Split the model selector and reasoning-effort selector into two direct
  // cascading triggers in the composer tool row (see model-split.tsx).
  applyModelSplit(ctx)
  ctx.slots.inject('conversation.session.header.utilities', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'dsh-session-ui-enhance',
      label: '用户轮次定位',
      order: 100,
    }, UserTurnRail)
    return () => dispose()
  })
}
