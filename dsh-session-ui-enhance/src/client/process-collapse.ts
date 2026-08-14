/**
 * dsh-session-ui-enhance — 轮次过程折叠(zcode 式)。
 *
 * dsh 的会话流把一个轮次的中间过程平铺:思考行(assistant-step 内的
 * [data-variant="think"])、工具卡片(command)、重试行(model-retry)、
 * 上下文提醒(context)等,全部摊在用户行与 turn-tail 之间。轮次一定
 * 长,最终响应就被淹没人海。
 *
 * 本 effect 在轮次定稿(出现 turn-tail)且无错(无 turn-error)后,把
 * 「最终响应」之外的过程行折叠成一条安静的小字行(「过程细节 N 项」,
 * 整行可点、键盘可达):点击展开/收起,状态按轮次 id 记忆(同页内
 * React 重绘不丢;页面刷新回到默认折叠,与 zcode 一致)。展开的过程区
 * 足够高时(processCollapse.bottomToggleMinHeight),底部再出现一条同款
 * 「收起过程」行,读完不必滚回顶部;点击后折叠行被滚回视口。
 *
 * 最终响应的界定:组内最后一个非空 assistant-step 行;其内部的思考行
 * 仍算过程一并折叠,正文/图片/mermaid 卡片保留。简单问答轮(无过程
 * 行)不出现折叠行,UI 与原生一致。仍在流式的轮次(无 turn-tail)绝
 * 不折叠。
 *
 * 实现约定(与 code-lang/think-collapse 相同):纯 DOM 观察 + rAF 节流;
 * 对 React 管理的元素只写 data-z-* 属性(不写 inline style,显隐全部走
 * process-collapse.css 的属性选择器);折叠行是插入流列的外来节点,位置
 * 与标记每次 flush 自愈;卸载时全部摘除。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { configNow, subscribeConfig } from './live-config'

const FLOW_ITEM = '[data-chat-flow-key]'
const KIND_ATTR = 'data-chat-flow-kind'
const TAIL_ATTR = 'data-turn-tail'
const THINK_BLOCK = '[data-variant="think"]'
const STREAMING_FLAG = '[data-streaming]'
const TOGGLE_CLASS = 'z-process-toggle'
const BOTTOM_CLASS = 'z-process-collapse'
const PROCESS_ATTR = 'data-z-process'
const COLLAPSED_ATTR = 'data-z-collapsed'
const SVG_NS = 'http://www.w3.org/2000/svg'

/** 用户消息类行:轮次分组的边界。 */
const USER_KINDS = new Set(['user', 'steering'])
/** 永远保持可见的行(即使落在轮次组内):尾部操作条、错误与截断信号、未知面。 */
const KEEP_VISIBLE_KINDS = new Set(['turn-tail', 'turn-error', 'turn-max-tokens', 'unknown'])
/** 最终响应的载体行类型。 */
const RESPONSE_KIND = 'assistant-step'

/** 一个已闭合轮次的分组视图。 */
interface TurnGroup {
  /** 组内全部流行(不含用户行,按文档序)。 */
  items: HTMLElement[]
  /** turn-tail 行(定稿标记),null 表示以错误收尾。 */
  tail: HTMLElement | null
  /** 是否以 turn-error 收尾(出错的轮次不折叠,保留过程便于排查)。 */
  errored: boolean
}

/** 用户主动展开/收起的轮次记忆(value=true 表示展开)。 */
const userChoice = new Map<string, boolean>()

/** 把会话流切成轮次组;尾部未闭合的组(流式中)不入列。 */
function collectGroups(items: HTMLElement[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let cur: TurnGroup | null = null
  for (const item of items) {
    const kind = item.getAttribute(KIND_ATTR) ?? ''
    if (USER_KINDS.has(kind)) {
      if (cur !== null && cur.items.length > 0) groups.push(cur)
      cur = { items: [], tail: null, errored: false }
      continue
    }
    if (cur === null) cur = { items: [], tail: null, errored: false }
    cur.items.push(item)
    if (kind === 'turn-error') {
      cur.errored = true
      groups.push(cur)
      cur = null
    } else if (kind === 'turn-tail') {
      cur.tail = item
      groups.push(cur)
      cur = null
    }
  }
  return groups.filter(group => group.tail !== null || group.errored)
}

/** 12px 线性 chevron 图标(points 决定朝向,stroke 跟随 currentColor)。 */
function chevronIcon(points: string): SVGSVGElement {
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
  chevron.setAttribute('points', points)
  svg.appendChild(chevron)
  return svg
}

/** 整行可点、Enter/Space 可达的安静小字行(折叠行与底部收起行共用)。 */
function clickableRow(className: string, label: string, onFlip: () => void): HTMLElement {
  const row = document.createElement('div')
  row.className = className
  row.setAttribute('role', 'button')
  row.setAttribute('tabindex', '0')
  row.addEventListener('click', onFlip)
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onFlip()
    }
  })
  const text = document.createElement('span')
  text.textContent = label
  row.appendChild(text)
  return row
}

/** 造一条折叠行:chevron-right + 「过程细节」+ 计数(chevron 展开时旋下)。 */
function createToggle(onFlip: () => void): HTMLElement {
  const toggle = clickableRow(TOGGLE_CLASS, '过程细节', onFlip)
  toggle.setAttribute('aria-expanded', 'false')
  toggle.insertBefore(chevronIcon('9 18 15 12 9 6'), toggle.firstChild)
  const count = document.createElement('span')
  count.className = 'z-process-count'
  toggle.appendChild(count)
  return toggle
}

/** 造一条过程区底部的「收起过程」行(chevron-up,语义同点折叠行)。 */
function createBottomRow(onCollapse: () => void): HTMLElement {
  const row = clickableRow(BOTTOM_CLASS, '收起过程', onCollapse)
  row.setAttribute('aria-label', '收起过程细节')
  row.insertBefore(chevronIcon('18 15 12 9 6 15'), row.firstChild)
  return row
}

/**
 * 主同步:重算分组,对齐每个轮次组的过程标记与折叠行,摘除失群的
 * 标记与折叠行。幂等:状态没变的元素零写入。
 * @param schedule - 状态翻转后请求下一帧重同步。
 */
function createSync(schedule: () => void) {
  /** 轮次 id → 该轮折叠行(本模块创建),供定位自愈与孤儿清扫。 */
  const togglesByTurn = new Map<string, HTMLElement>()
  /** 轮次 id → 过程区底部的「收起过程」行(仅展开且够高时存在)。 */
  const bottomRowsByTurn = new Map<string, HTMLElement>()

  return function sync(): void {
    const cfg = configNow().processCollapse
    const enabled = cfg.enabled
    const items = Array.from(document.querySelectorAll(FLOW_ITEM))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
    const claimedTurns = new Set<string>()
    const claimedBottoms = new Set<string>()
    const claimedMarks = new Set<Element>()
    const liveTurnIds = new Set<string>()

    if (enabled) {
      for (const group of collectGroups(items)) {
        // 轮次 id 在 turn-tail 行内部的视图根 div 上(TurnTailNodeView 的
        //  closing 分支),不在流 item 外壳上;读不到说明该轮尚未闭合。
        const tid = group.tail?.querySelector(`[${TAIL_ATTR}]`)?.getAttribute(TAIL_ATTR) ?? null
        if (tid === null || group.errored) continue
        liveTurnIds.add(tid)
        // 双保险:组内仍有流式标记则不动它(正常路径流式组没有 tail,
        // 在 collectGroups 就被滤掉了)。
        if (group.items.some(item => item.querySelector(STREAMING_FLAG) !== null)) continue

        const steps = group.items.filter(
          item => item.getAttribute(KIND_ATTR) === RESPONSE_KIND && item.childElementCount > 0,
        )
        const finalStep = steps.at(-1)
        const processItems = group.items.filter((item) => {
          if (item === finalStep) return false
          if (KEEP_VISIBLE_KINDS.has(item.getAttribute(KIND_ATTR) ?? '')) return false
          return item.childElementCount > 0
        })
        const thinkRows = finalStep === undefined
          ? []
          : Array.from(finalStep.querySelectorAll(THINK_BLOCK))
        const processEls: Element[] = [...processItems, ...thinkRows]
        if (processEls.length === 0) continue

        const expanded = userChoice.get(tid) ?? false
        for (const el of processEls) {
          if (!el.hasAttribute(PROCESS_ATTR)) el.setAttribute(PROCESS_ATTR, '')
          if (expanded) el.removeAttribute(COLLAPSED_ATTR)
          else if (!el.hasAttribute(COLLAPSED_ATTR)) el.setAttribute(COLLAPSED_ATTR, '')
          claimedMarks.add(el)
        }

        // 折叠行:位于第一个过程元素之前(通常在用户行正下方),
        // React 重绘打乱位置时下次 flush 移回。
        const first = processEls[0]
        if (first === undefined) continue
        let toggle = togglesByTurn.get(tid) ?? null
        if (toggle !== null && !toggle.isConnected) {
          togglesByTurn.delete(tid)
          toggle = null
        }
        if (toggle === null) {
          toggle = createToggle(() => {
            userChoice.set(tid, !(userChoice.get(tid) ?? false))
            schedule()
          })
          togglesByTurn.set(tid, toggle)
        }
        if (toggle.nextElementSibling !== first) {
          first.parentNode?.insertBefore(toggle, first)
        }
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
        const countEl = toggle.querySelector('.z-process-count')
        if (countEl !== null && countEl.textContent !== `${processEls.length} 项`) {
          countEl.textContent = `${processEls.length} 项`
        }
        claimedTurns.add(tid)

        // 底部「收起过程」行:仅展开且过程区足够高时出现(此时过程元素
        // 均可见,offsetHeight 是真实高度;整组元素同一渲染子树,布局读
        // 会合并结算,不构成逐元素回流)。
        let bottom = bottomRowsByTurn.get(tid) ?? null
        if (bottom !== null && !bottom.isConnected) {
          bottomRowsByTurn.delete(tid)
          bottom = null
        }
        const processHeight = expanded
          ? processEls.reduce((sum, el) => sum + (el instanceof HTMLElement ? el.offsetHeight : 0), 0)
          : 0
        const wantBottom = expanded && processHeight >= cfg.bottomToggleMinHeight
        if (!wantBottom) {
          if (bottom !== null) {
            if (bottom.isConnected) bottom.remove()
            bottomRowsByTurn.delete(tid)
          }
        } else {
          const last = processEls.at(-1)
          if (last !== undefined) {
            if (bottom === null) {
              bottom = createBottomRow(() => {
                userChoice.set(tid, false)
                schedule()
                // 收起发生在过程区底部,塌缩会把视口顶飞:下一帧(同步已
                // 生效)把折叠行滚回视口顶部,保住阅读位置。
                requestAnimationFrame(() => {
                  const top = togglesByTurn.get(tid)
                  if (top !== undefined && top.isConnected) top.scrollIntoView({ block: 'start' })
                })
              })
              bottomRowsByTurn.set(tid, bottom)
            }
            if (bottom.previousElementSibling !== last) {
              last.parentNode?.insertBefore(bottom, last.nextSibling)
            }
            claimedBottoms.add(tid)
          }
        }
      }
    }

    // 清扫:本 flush 未被任何组认领的过程标记(组解散/功能关闭/行被
    // 重建)全部摘除;未被认领的折叠行移除并出册。
    for (const el of Array.from(document.querySelectorAll(`[${PROCESS_ATTR}]`))) {
      if (!claimedMarks.has(el)) {
        el.removeAttribute(PROCESS_ATTR)
        el.removeAttribute(COLLAPSED_ATTR)
      }
    }
    for (const [tid, toggle] of Array.from(togglesByTurn)) {
      if (!claimedTurns.has(tid)) {
        if (toggle.isConnected) toggle.remove()
        togglesByTurn.delete(tid)
      }
    }
    for (const [tid, bottom] of Array.from(bottomRowsByTurn)) {
      if (!claimedBottoms.has(tid)) {
        if (bottom.isConnected) bottom.remove()
        bottomRowsByTurn.delete(tid)
      }
    }
    // 轮次 id 记忆随会话切换修剪,避免跨会话累积。
    for (const tid of Array.from(userChoice.keys())) {
      if (!liveTurnIds.has(tid)) userChoice.delete(tid)
    }
  }
}

/**
 * Client effect:zcode 式轮次过程折叠。返回的 disposer 断开观察器并
 * 还原全部过程标记与折叠行。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applyProcessCollapse(ctx: ClientContext): void {
  ctx.effect(() => {
    let raf = 0
    let sync = (): void => {}
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        sync()
      })
    }
    sync = createSync(schedule)
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    // host 配置快照到达后开关可能变化:全量重对齐一次。
    const unsubscribe = subscribeConfig(schedule)
    return () => {
      observer.disconnect()
      unsubscribe()
      if (raf !== 0) cancelAnimationFrame(raf)
      for (const el of Array.from(document.querySelectorAll(`[${PROCESS_ATTR}]`))) {
        el.removeAttribute(PROCESS_ATTR)
        el.removeAttribute(COLLAPSED_ATTR)
      }
      for (const el of Array.from(document.querySelectorAll(`.${TOGGLE_CLASS}, .${BOTTOM_CLASS}`))) el.remove()
    }
  }, 'dsh-session-ui-enhance: process collapse')
}
