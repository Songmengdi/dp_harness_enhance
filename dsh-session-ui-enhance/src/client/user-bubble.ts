/**
 * dsh-session-ui-enhance — 用户消息气泡:精致化 + 超长收缩。
 *
 * 产品的用户气泡(MessageItem 的 UserStyleBubble)只有一个 22px 大圆角
 * 灰底块,16px 字号,且内容无界增长:一条超长输入(粘贴的日志/长需求)
 * 会把整屏对话顶掉,没有任何折叠手段。本模块做两件事:
 *
 * 1. 重排门禁:按配置在 <body> 上翻 `data-z-user-bubble` 属性,
 *    user-bubble.css 的精致化规则(14px 小圆角 + 右下 6px 尾角、
 *    14/22 紧凑字号、细描边)全部挂在这个属性上,配置关闭即整体还原。
 * 2. 超长收缩:MutationObserver 收敛会话 DOM,量每个用户气泡的
 *    scrollHeight,超过 userBubble.collapseHeight(含 24px 缓冲)时在
 *    气泡容器(userStack)上置 `data-z-collapse="collapsed"` 与
 *    `--z-bubble-collapse-max` 行内变量,CSS 负责 max-height 截断 +
 *    底部同底色渐变淡出;并在 userStack 尾部(气泡之后)注入一枚安静的
 *    「展开全部/收起」小字按钮。
 *
 * 注入位置与 think-collapse 同一考量:气泡正文是 React 的文本快路径,
 * 外来节点一律不进正文;userStack 子级是元素数组,外来尾节点不被
 * fiber 增删触碰。展开/收缩选择按 userStack 元素记在 WeakMap 里,
 * 重测量(换行重排、窗口变宽)不重置用户选择;pending 中的 steering
 * 气泡(内容仍在变)跳过收缩,只享受重排。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { configNow, subscribeConfig } from './live-config.js'

const ROW_SELECTOR = '[data-chat-flow-kind="user"]'
const USER_ROW_SELECTOR = '[data-time-hover-root]'
const BUBBLE_SELECTOR = '[class*="_bubble"]'
const BUTTON_CLASS = 'z-bubble-toggle'
const SVG_NS = 'http://www.w3.org/2000/svg'
/** 内容只超出阈值一点时不值得折叠(折叠条本身也占一行)。 */
const COLLAPSE_SLACK_PX = 24

/**
 * 高度是否达到折叠门槛(纯函数,供单测)。
 * @param scrollHeight - 气泡内容完整高度。
 * @param collapseHeight - 配置的折叠阈值。
 */
export function shouldCollapse(scrollHeight: number, collapseHeight: number): boolean {
  return scrollHeight > collapseHeight + COLLAPSE_SLACK_PX
}

/** 每个气泡容器的用户展开选择;容器被 React 摘除后随 GC 回收。 */
const expansionByStack = new WeakMap<HTMLElement, boolean>()

/** 造一枚 chevron(up/down 由 points 区分),跟随按钮 currentColor。 */
function createChevron(up: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const chevron = document.createElementNS(SVG_NS, 'polyline')
  chevron.setAttribute('points', up ? '18 15 12 9 6 15' : '6 9 12 15 18 9')
  svg.appendChild(chevron)
  return svg
}

/** 同步按钮文案与图标(展开全部 ↔ 收起)。 */
function paintButton(btn: HTMLButtonElement, expanded: boolean): void {
  btn.replaceChildren(createChevron(expanded), document.createTextNode(expanded ? '收起' : '展开全部'))
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
}

/**
 * 对齐一个用户轮次的折叠状态:不该折叠就摘掉按钮与状态;该折叠就
 * 置容器属性、行内高度变量,并保证按钮挂在 userStack 尾部、气泡之后。
 * 无 DOM 变更时零写入。
 */
function syncRow(row: HTMLElement): void {
  const cfg = configNow().userBubble
  const userRow = row.querySelector(USER_ROW_SELECTOR)
  if (!(userRow instanceof HTMLElement)) return
  const bubble = userRow.querySelector(BUBBLE_SELECTOR)
  const stack = bubble?.parentElement ?? null
  if (!(bubble instanceof HTMLElement) || !(stack instanceof HTMLElement)) return
  const btn = stack.querySelector(`:scope > .${BUTTON_CLASS}`)
  // pending 的 steering 气泡内容仍在变,不做折叠(避免截断中途高度抖动)。
  const pending = userRow.hasAttribute('data-pending-steering')
  const want = cfg.enabled && !pending && shouldCollapse(bubble.scrollHeight, cfg.collapseHeight)
  if (!want) {
    btn?.remove()
    stack.removeAttribute('data-z-collapse')
    stack.style.removeProperty('--z-bubble-collapse-max')
    return
  }
  const expanded = expansionByStack.get(stack) === true
  stack.style.setProperty('--z-bubble-collapse-max', `${cfg.collapseHeight}px`)
  if (stack.getAttribute('data-z-collapse') !== (expanded ? 'expanded' : 'collapsed')) {
    stack.setAttribute('data-z-collapse', expanded ? 'expanded' : 'collapsed')
  }
  if (btn instanceof HTMLButtonElement && btn.previousElementSibling === bubble) {
    paintButton(btn, expanded)
    return
  }
  btn?.remove()
  stack.appendChild(createButton(stack, bubble))
}

/** 造折叠开关按钮:点击翻转 WeakMap 里的选择并重刷容器状态。 */
function createButton(stack: HTMLElement, bubble: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = BUTTON_CLASS
  btn.setAttribute('aria-label', '展开或收起完整输入')
  paintButton(btn, expansionByStack.get(stack) === true)
  btn.addEventListener('click', () => {
    const expanded = expansionByStack.get(stack) === true
    expansionByStack.set(stack, !expanded)
    if (expanded) {
      stack.setAttribute('data-z-collapse', 'collapsed')
      paintButton(btn, false)
      // 高气泡塌缩会把视口顶走:把气泡顶拉回视口,保住阅读位置。
      bubble.scrollIntoView({ block: 'start' })
    } else {
      stack.setAttribute('data-z-collapse', 'expanded')
      paintButton(btn, true)
    }
  })
  return btn
}

/**
 * Client effect:用户气泡精致化门禁 + 超长收缩;返回的 disposer 断开
 * 观察器、摘掉全部注入按钮与状态、还原 body 门禁属性。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applyUserBubble(ctx: ClientContext): void {
  ctx.effect(() => {
    const pending = new Set<HTMLElement>()
    let raf = 0
    const flush = (): void => {
      raf = 0
      for (const row of pending) {
        if (row.isConnected) syncRow(row)
      }
      pending.clear()
    }
    const schedule = (row: HTMLElement | null): void => {
      if (row === null || !row.isConnected) return
      pending.add(row)
      if (raf === 0) raf = requestAnimationFrame(flush)
    }
    const rowOf = (node: Node): HTMLElement | null => {
      const el = node instanceof Element ? node : node.parentElement
      const row = el?.closest(ROW_SELECTOR)
      return row instanceof HTMLElement ? row : null
    }
    const scanAll = (): void => {
      for (const row of document.querySelectorAll(ROW_SELECTOR)) {
        if (row instanceof HTMLElement) schedule(row)
      }
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        schedule(rowOf(mutation.target))
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          schedule(node.matches(ROW_SELECTOR) ? node : rowOf(node))
          for (const inner of node.querySelectorAll(ROW_SELECTOR)) {
            if (inner instanceof HTMLElement) schedule(inner)
          }
        }
      }
    })
    const syncGate = (): void => {
      if (configNow().userBubble.enabled) {
        document.body.setAttribute('data-z-user-bubble', '')
      } else {
        document.body.removeAttribute('data-z-user-bubble')
      }
    }
    scanAll()
    syncGate()
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    // 窗口变宽改气泡宽度即改高度:全量重对齐一次。
    window.addEventListener('resize', scanAll)
    // host 配置快照到达后阈值/开关可能变化:重刷门禁并全量重对齐。
    const unsubscribe = subscribeConfig(() => {
      syncGate()
      scanAll()
    })
    return () => {
      observer.disconnect()
      unsubscribe()
      window.removeEventListener('resize', scanAll)
      if (raf !== 0) cancelAnimationFrame(raf)
      pending.clear()
      document.body.removeAttribute('data-z-user-bubble')
      for (const btn of document.querySelectorAll(`.${BUTTON_CLASS}`)) btn.remove()
      for (const row of document.querySelectorAll(ROW_SELECTOR)) {
        const bubble = row.querySelector(BUBBLE_SELECTOR)
        const stack = bubble?.parentElement
        if (stack instanceof HTMLElement) {
          stack.removeAttribute('data-z-collapse')
          stack.style.removeProperty('--z-bubble-collapse-max')
        }
      }
    }
  }, 'dsh-session-ui-enhance: user bubble')
}
