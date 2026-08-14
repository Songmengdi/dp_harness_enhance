/**
 * dsh-session-ui-enhance — 思考块底部收起。
 *
 * 产品的 Think 折叠行(ui-conversation 的 ReasoningRow,DOM 上是
 * `[data-variant="think"]`)展开后内容无界增长,而收起控件只在头部行
 * 上;流式思考时长文把头部顶出视口,用户只能一路滚回顶部才能收起。
 *
 * 本 effect 在「展开的、够高的」思考块正文底部注入一枚安静的「收起」
 * 小字按钮。点击等效于点头部行:把原生 click 转发给产品自己的
 * `[data-disclosure-row]`(React 根监听冒泡,同步 flush,onToggle 照常
 * 走),不接管产品的展开状态;随后把块头滚回视口,避免高块塌缩后视口
 * 落在不知名位置。
 *
 * 注入位置选在折叠容器(`[data-open]`)尾部、正文元素之后,而不是正
 * 文内部:React 对「文本唯一子节点」的更新快路径要求首尾子节点都是
 * 同一文本节点,正文里一旦混入外来节点,每个 token 的更新就退化为
 * textContent 整体重写——按钮会被反复抹掉重建(流式期间闪烁、点击落
 * 空)。容器子级是元素数组,React 按 fiber 引用增删,外来尾节点不被
 * 触碰;收起时正文被摘除、按钮由本模块同步摘除。
 *
 * 显示门禁:配置启用 + 块处于展开(直接子级出现 `[data-open]`) +
 * 正文高度 ≥ thinkCollapse.minBodyHeight;流式逐 token 的 characterData
 * 与 data-open 翻转都由全局 MutationObserver 按块 rAF 节流收敛。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { configNow, subscribeConfig } from './live-config'

const BLOCK_SELECTOR = '[data-variant="think"]'
const ROW_SELECTOR = '[data-disclosure-row]'
const BODY_SELECTOR = '[class*="_thinkBody"]'
const BUTTON_CLASS = 'z-think-collapse'
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 造一枚底部收起按钮:chevron-up + 「收起」小字,跟随 thinkBody 的
 * 三级墨色,hover 略深(样式见 think-collapse.css,亮暗主题走 token)。
 */
function createButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = BUTTON_CLASS
  btn.setAttribute('aria-label', '收起思考过程')
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
  chevron.setAttribute('points', '18 15 12 9 6 15')
  svg.appendChild(chevron)
  btn.appendChild(svg)
  btn.appendChild(document.createTextNode('收起'))
  btn.addEventListener('click', () => {
    const block = btn.closest(BLOCK_SELECTOR)
    if (!(block instanceof HTMLElement)) return
    const row = block.querySelector(ROW_SELECTOR)
    if (!(row instanceof HTMLElement)) return
    // 原生 click 冒泡到 React 根即触发 DisclosureRow 的 onToggle;离散
    // 事件同步 flush,返回时正文已被 React 摘掉。按钮此刻已失去存在依
    // 据(块已收起),立即自摘,不等下一帧同步(避免残留一帧)。
    row.click()
    btn.remove()
    // 高块塌缩会把视口顶到块后很远:把块头拉回视口顶部,保住阅读位置。
    block.scrollIntoView({ block: 'start' })
  })
  return btn
}

/**
 * 对齐一个思考块的按钮存在性:不该有就摘掉,该有就挂在折叠容器尾部
 * (正文之后)。无 DOM 变更时零写入(offsetHeight 一次布局读,rAF 内
 * 每块至多一次)。
 */
function syncBlock(block: HTMLElement): void {
  const cfg = configNow().thinkCollapse
  const open = block.querySelector(':scope > [data-open]')
  const body = open?.querySelector(BODY_SELECTOR) ?? null
  const btn = block.querySelector(`.${BUTTON_CLASS}`)
  const want = cfg.enabled
    && open !== null
    && body instanceof HTMLElement
    && body.offsetHeight >= cfg.minBodyHeight
  if (!want || !(open instanceof HTMLElement)) {
    btn?.remove()
    return
  }
  if (btn instanceof HTMLButtonElement
    && btn.parentElement === open
    && btn.previousElementSibling === body) return
  btn?.remove()
  open.appendChild(createButton())
}

/**
 * Client effect:为展开的高思考块提供底部收起,返回的 disposer 断开
 * 观察器并摘掉全部注入按钮。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applyThinkCollapse(ctx: ClientContext): void {
  ctx.effect(() => {
    const pending = new Set<HTMLElement>()
    let raf = 0
    const flush = (): void => {
      raf = 0
      for (const block of pending) {
        if (block.isConnected) syncBlock(block)
      }
      pending.clear()
    }
    const schedule = (block: HTMLElement | null): void => {
      if (block === null || !block.isConnected) return
      pending.add(block)
      if (raf === 0) raf = requestAnimationFrame(flush)
    }
    const blockOf = (node: Node): HTMLElement | null => {
      const el = node instanceof Element ? node : node.parentElement
      const block = el?.closest(BLOCK_SELECTOR)
      return block instanceof HTMLElement ? block : null
    }
    const scanAll = (): void => {
      for (const block of document.querySelectorAll(BLOCK_SELECTOR)) {
        if (block instanceof HTMLElement) schedule(block)
      }
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        schedule(blockOf(mutation.target))
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          schedule(node.matches(BLOCK_SELECTOR) ? node : blockOf(node))
          for (const inner of node.querySelectorAll(BLOCK_SELECTOR)) {
            if (inner instanceof HTMLElement) schedule(inner)
          }
        }
      }
    })
    scanAll()
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-open'],
    })
    // host 配置快照到达后阈值/开关可能变化:全量重对齐一次。
    const unsubscribe = subscribeConfig(scanAll)
    return () => {
      observer.disconnect()
      unsubscribe()
      if (raf !== 0) cancelAnimationFrame(raf)
      pending.clear()
      for (const btn of document.querySelectorAll(`.${BUTTON_CLASS}`)) btn.remove()
    }
  }, 'dsh-session-ui-enhance: think collapse')
}
