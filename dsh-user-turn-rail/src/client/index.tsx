/**
 * dsh-user-turn-rail — client half.
 *
 * A vertically centered rail of user-turn bars at the left edge of the
 * conversation column: hovering ramps the bar lengths around the hovered
 * turn, a hover card previews the turn's input, and clicking locates and
 * highlights the message. The same bundle contributes the tiered
 * content-width breakpoints and breathing clearance (see rail.module.css).
 *
 * The rail is contributed into the `conversation.session.header.utilities`
 * slot, which ui-conversation declares and owns: this plugin only registers
 * an entry (the four-step contract — declare / claim / inject / render —
 * never lets a contributor own a slot it did not declare).
 *
 * @module dsh-user-turn-rail/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the
// conversation.session.header.utilities entry) through the assembly boundary.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import React from 'react'
import styles from './rail.module.css'

/** Required services: the slot registry (provided by the client runtime). */
export const inject = ['slots']

/** One rail row's derived view data. */
interface Turn {
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
 * The rail body: derives the turn list from the session snapshot, tracks the
 * conversation scrollport's left edge, and renders the interactive bar rail.
 * @param props - framework session kit (sessionId, useSession, …).
 * @returns the rail, or null while there is nothing to anchor it to.
 */
function UserTurnRail(props: RailProps): React.ReactElement | null {
  const { useSession, sessionId } = props
  const [left, setLeft] = React.useState<number | null>(null)
  const [hovered, setHovered] = React.useState(-1)
  const [selected, setSelected] = React.useState(-1)

  const nodes = useSession(snapshot => snapshot.nodes)

  const turns: Turn[] = []
  for (const node of nodes) {
    if (node.kind === 'user') {
      turns.push({ seq: node.seq, text: previewText(node.content) })
    }
  }

  React.useEffect(() => {
    if (turns.length === 0) return
    let alive = true
    let observer: ResizeObserver | null = null
    let raf = 0
    const measure = () => {
      if (!alive) return
      const el = document.querySelector('[data-conversation-scroll]')
      if (el === null) {
        raf = window.requestAnimationFrame(measure)
        return
      }
      setLeft(el.getBoundingClientRect().left)
      if (observer === null) {
        observer = new ResizeObserver(measure)
        observer.observe(el)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      alive = false
      if (raf !== 0) window.cancelAnimationFrame(raf)
      if (observer !== null) observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [sessionId, turns.length])

  if (turns.length === 0 || left === null) return null

  const activeIndex = selected >= 0 && selected < turns.length ? selected : turns.length - 1

  const goTo = (index: number) => {
    setSelected(index)
    const rows = document.querySelectorAll('[data-chat-flow-kind="user"]')
    const row = rows[index]
    if (row === undefined) return
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className={styles.rail} style={{ left: Math.round(left + RAIL_OFFSET) }}>
      {turns.map((turn, index) => {
        const bright = index === activeIndex || index === hovered
        const dist = hovered < 0 ? -1 : Math.abs(index - hovered)
        const width = hovered < 0 ? BASE_WIDTH : Math.max(MIN_WIDTH, PEAK_WIDTH - dist * RAMP_STEP)
        let opacity = bright ? 1 : 0.5
        if (hovered >= 0 && !bright) opacity = Math.max(0.26, 0.5 - dist * 0.06)
        return (
          <div
            key={String(turn.seq)}
            className={styles.row}
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(-1)}
            onClick={() => goTo(index)}
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
              <div className={styles.cardHead}>
                <div className={styles.badge}>第 {index + 1} 轮</div>
                <div className={styles.cardHeadSub}>用户输入预览</div>
              </div>
              <div className={styles.cardDivider} />
              <div className={styles.cardText}>{turn.text}</div>
            </div>
          </div>
        )
      })}
    </div>
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
  ctx.slots.inject('conversation.session.header.utilities', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'dsh-user-turn-rail',
      label: '用户轮次定位',
      order: 100,
    }, UserTurnRail)
    return () => dispose()
  })
}
