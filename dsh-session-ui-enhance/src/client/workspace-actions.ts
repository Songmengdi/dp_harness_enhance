/**
 * dsh-session-ui-enhance — 左侧工作区会话行的操作入口改造。
 *
 * 产品 ui-workspace 的会话行(SessionNodeItem)只有一个「...」按钮,
 * 点开是三项菜单:重命名 / 分叉会话 / 归档会话。该行没有行级 slot
 * (唯一的槽位是整块 `sidebar.workspaces`,接管它等于重写整个工作区浏览
 * 器),所以本模块沿用插件的 DOM 增强模式:
 *
 * - 隐藏原「...」按钮(`data-z-session-menu-source` + CSS display:none),
 *   在同容器注入一枚同款样式的归档图标按钮。单击归档按钮不直接归档,
 *   而是在归档图标所在的位置叠上一枚红色「确认」小按钮(点页面其他
 *   区域/Escape/滚动即收起);确认后才程序化 click 原按钮把产品菜单打
 *   开(菜单项仍是产品自己的 handler),然后点击其中的归档项——归档
 *   逻辑、当前会话清空、失败处理全部由产品承担,本模块不接管任何会话
 *   状态。
 * - 右键会话行弹出本模块的上下文菜单,只展示另外两项(重命名/分叉会话),
 *   选择后走同一条「打开原菜单 → 点对应项」转发路径,重命名对话框与
 *   分叉行为同样是产品原生的。
 *
 * 定位菜单项优先按产品中英文字面量匹配,退化为「恰好三项菜单的第
 * rename/fork/archive 项」——会话行菜单的条目顺序是稳定的。
 * 自动化期间给 body 打 `data-z-menu-puppet`,CSS 把 portal 菜单
 * visibility:hidden,避免隐藏锚点导致菜单在左上角闪一帧;找不到条目时
 * 派发 Escape 让产品自行收起菜单。
 *
 * 与 code-lang/think-collapse 相同的约定:纯 DOM 观察 + rAF 节流,对
 * React 管理的元素只写 data-z-* 属性,注入节点每次 flush 自愈,卸载时
 * 全部摘除、还原原按钮。
 *
 * 归档确认的状态机(产品 rowActions 只在会话行 hover/menuOpen 时显示):
 * - 归档图标可见 → 单击进入「确认态」:红色「确认」按钮叠在图标位置;
 * - 确认态退出:点「确认」归档、点击其他区域、Escape、滚动/缩放/窗口
 *   失焦、鼠标移出该会话行、键盘焦点移出行,或行/按钮被移除/配置关闭;
 * - 退出即移除确认按钮:归档图标按产品规则在下次 hover 时重新出现,
 *   确认态绝不残留在不可见的 rowActions 里。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { configNow, subscribeConfig } from './live-config.js'

const SESSION_ROW_SELECTOR = '[class*="_sessionRow"]'
const TITLE_SELECTOR = ':scope > [class*="_title"]'
const ROW_ACTIONS_SELECTOR = ':scope > [class*="_rowActions"]'
const SOURCE_SELECTOR = 'button[class*="_iconButton"]'
const ROW_ATTR = 'data-z-session-actions'
const ROW_ACTIONS_ATTR = 'data-z-session-row-actions'
const SOURCE_ATTR = 'data-z-session-menu-source'
const ARCHIVE_ATTR = 'data-z-session-archive'
const CONFIRM_ATTR = 'data-z-session-archive-confirm'
const PUPPET_ATTR = 'data-z-menu-puppet'
const ARCHIVE_CLASS = 'z-session-archive'
const CONFIRM_CLASS = 'z-session-archive-confirm'
const CONTEXT_CLASS = 'z-session-context'
const CONTEXT_ITEM_CLASS = 'z-session-context-item'
const SVG_NS = 'http://www.w3.org/2000/svg'
const MENU_WAIT_TIMEOUT_MS = 800
const MENU_POLL_MS = 16
const VIEWPORT_MARGIN = 8

type SessionAction = 'rename' | 'fork' | 'archive'
type Locale = 'zh' | 'en'

/** 产品会话行菜单的条目顺序(rename / fork / archive 固定)。 */
const ACTION_INDEX: Record<SessionAction, number> = { rename: 0, fork: 1, archive: 2 }
/** 产品菜单项的两种官方文案(zh / en);未知 locale 由前者兜底。 */
const ACTION_LABELS: Record<SessionAction, readonly string[]> = {
  rename: ['重命名', 'Rename'],
  fork: ['分叉会话', 'Fork session'],
  archive: ['归档会话', 'Archive session'],
}
/** 本模块右键菜单只展示另外两项。 */
const CONTEXT_LABELS: Record<Locale, Record<'rename' | 'fork', string>> = {
  zh: { rename: '重命名', fork: '分叉会话' },
  en: { rename: 'Rename', fork: 'Fork session' },
}
/** 归档确认按钮文案(需求固定为「确认」)。 */
const CONFIRM_LABEL = '确认'

let contextMenu: HTMLDivElement | null = null
let contextRow: HTMLElement | null = null
let confirmButton: HTMLButtonElement | null = null
let confirmAnchor: HTMLButtonElement | null = null
let confirmRow: HTMLElement | null = null
const busyRows = new WeakSet<HTMLElement>()

/** 从产品按钮的 aria-label 判定当前 UI locale(zh / en 两种官方字典)。 */
export function localeForAriaLabel(aria: string | null): Locale {
  return aria !== null && aria.startsWith('Session actions for') ? 'en' : 'zh'
}

/** 菜单项文字是否命中某动作的官方文案(空白折叠后精确比较)。 */
export function actionLabelMatches(text: string, action: SessionAction): boolean {
  const label = text.trim()
  return ACTION_LABELS[action].some(candidate => label === candidate)
}

/** 会话行菜单缺省定位顺序(仅在产品文案变化时使用)。 */
export function sessionActionIndex(action: SessionAction): number {
  return ACTION_INDEX[action]
}

/** 归档按钮的无障碍名,与产品 aria-label 同构。 */
export function archiveAriaLabel(locale: Locale, title: string): string {
  return locale === 'en' ? `Archive session ${title}` : `归档会话“${title}”`
}

/** 归档确认按钮文案。 */
export function confirmLabel(): string {
  return CONFIRM_LABEL
}

interface IconPath {
  d: string
  evenOdd?: boolean
}

function svgIcon(viewBox: string, paths: readonly IconPath[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  for (const path of paths) {
    const el = document.createElementNS(SVG_NS, 'path')
    el.setAttribute('d', path.d)
    if (path.evenOdd === true) {
      el.setAttribute('fill-rule', 'evenodd')
      el.setAttribute('clip-rule', 'evenodd')
    }
    el.setAttribute('fill', 'currentColor')
    svg.appendChild(el)
  }
  return svg
}

/** 产品 IconArchiveOutline20 的同款路径(16px 展示)。 */
function archiveIcon(): SVGSVGElement {
  return svgIcon('0 0 20 20', [
    {
      d: 'M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z',
      evenOdd: true,
    },
    { d: 'M12.7962 12.5661V11.0832H7.20548V12.5661L12.7962 12.5661Z' },
  ])
}

/** 产品 IconEditOutline16 的同款路径。 */
function editIcon(): SVGSVGElement {
  return svgIcon('0 0 16 16', [
    { d: 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z' },
  ])
}

/** 产品 IconBranchOutline16 的同款路径。 */
function branchIcon(): SVGSVGElement {
  return svgIcon('0 0 16 16', [
    {
      d: 'M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z',
      evenOdd: true,
    },
  ])
}

function querySessionRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll(SESSION_ROW_SELECTOR))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
}

function titleOf(row: HTMLElement): string {
  const title = row.querySelector(TITLE_SELECTOR)
  return title?.textContent?.trim() ?? ''
}

function rowActionsOf(row: HTMLElement): HTMLElement | null {
  const actions = row.querySelector(ROW_ACTIONS_SELECTOR)
  return actions instanceof HTMLElement ? actions : null
}

function sourceOf(row: HTMLElement): HTMLButtonElement | null {
  const actions = rowActionsOf(row)
  const source = actions?.querySelector(SOURCE_SELECTOR)
  return source instanceof HTMLButtonElement ? source : null
}

function sessionRowOf(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target : null
  const row = el?.closest(SESSION_ROW_SELECTOR)
  return row instanceof HTMLElement ? row : null
}

function createArchiveButton(row: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute(ARCHIVE_ATTR, '')
  btn.setAttribute('aria-expanded', 'false')
  btn.appendChild(archiveIcon())
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busyRows.has(row)) return
    closeContextMenu()
    if (confirmButton !== null && confirmAnchor === btn) {
      // 再点一次归档按钮 = 收起确认小按钮,不触发归档。
      closeArchiveConfirm()
      return
    }
    showArchiveConfirm(row, btn)
  })
  return btn
}

/** 归档确认小按钮:红色「确认」,由 CSS + JS 叠到归档图标所在的位置。 */
function createArchiveConfirmButton(row: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute(CONFIRM_ATTR, '')
  btn.className = CONFIRM_CLASS
  btn.textContent = confirmLabel()
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (busyRows.has(row)) return
    closeArchiveConfirm()
    closeContextMenu()
    busyRows.add(row)
    void triggerSessionAction(row, 'archive').finally(() => {
      busyRows.delete(row)
    })
  })
  return btn
}

function closeArchiveConfirm(restoreFocus = false): void {
  const button = confirmButton
  const anchor = confirmAnchor
  // 先清状态再动 DOM:remove() 会同步派发 blur/focusout,若此时状态
  // 还在,监听器会重入并对同一个按钮再次 remove(),抛 NotFoundError。
  confirmButton = null
  confirmAnchor = null
  confirmRow = null
  // 键盘路径(Escape):焦点在确认按钮上时收起,交还焦点给归档按钮;
  // 鼠标路径不抢焦点,避免打断用户正在点击的目标。
  if (restoreFocus && button !== null && anchor !== null
    && button.contains(document.activeElement) && anchor.isConnected) {
    anchor.focus()
  }
  if (anchor !== null) anchor.setAttribute('aria-expanded', 'false')
  if (button !== null) {
    try {
      button.remove()
    } catch {
      // 焦点事件重入或产品重渲染可能已把它摘掉;这里只求 DOM 不残留。
    }
  }
}

function showArchiveConfirm(row: HTMLElement, anchor: HTMLButtonElement): void {
  closeContextMenu()
  closeArchiveConfirm()
  const actions = rowActionsOf(row)
  if (actions === null) return
  const created = createArchiveConfirmButton(row)
  actions.appendChild(created)
  confirmAnchor = anchor
  confirmButton = created
  confirmRow = row
  anchor.setAttribute('aria-expanded', 'true')
  positionArchiveConfirm(created, anchor, actions)
}

/**
 * 把红色「确认」小按钮叠到归档图标所在的位置:右缘与归档按钮右缘对齐,
 * 只向左扩展,避免超出会话行/块的右侧;垂直方向居中到图标上。
 */
function positionArchiveConfirm(button: HTMLButtonElement, anchor: HTMLElement, container: HTMLElement): void {
  button.style.left = '0px'
  button.style.top = '0px'
  button.style.width = ''
  button.style.height = ''
  const anchorRect = anchor.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const containerStyle = getComputedStyle(container)
  const borderLeft = Number.parseFloat(containerStyle.borderLeftWidth) || 0
  const borderTop = Number.parseFloat(containerStyle.borderTopWidth) || 0
  const anchorLeft = anchorRect.left - containerRect.left - borderLeft
  const anchorTop = anchorRect.top - containerRect.top - borderTop
  const rect = button.getBoundingClientRect()
  const width = Math.max(rect.width, anchorRect.width)
  const height = Math.max(rect.height, anchorRect.height)
  button.style.width = `${width}px`
  button.style.height = `${height}px`
  button.style.left = `${Math.round(anchorLeft - (width - anchorRect.width))}px`
  button.style.top = `${Math.round(anchorTop - (height - anchorRect.height) / 2)}px`
}

/** 对齐一个会话行:隐藏原按钮、注入归档按钮并同步无障碍名。 */
function syncRow(row: HTMLElement): void {
  const actions = rowActionsOf(row)
  const source = actions?.querySelector(SOURCE_SELECTOR)
  if (!(actions instanceof HTMLElement) || !(source instanceof HTMLButtonElement)) {
    clearRow(row)
    return
  }
  row.setAttribute(ROW_ATTR, '')
  source.setAttribute(SOURCE_ATTR, '')
  if (!actions.hasAttribute(ROW_ACTIONS_ATTR)) actions.setAttribute(ROW_ACTIONS_ATTR, '')
  let btn = actions.querySelector(`[${ARCHIVE_ATTR}]`)
  if (!(btn instanceof HTMLButtonElement) || btn.parentElement !== actions) btn = null
  if (btn === null) {
    const created = createArchiveButton(row)
    actions.appendChild(created)
    btn = created
  }
  // 复用产品 iconButton 类,归档按钮与原「...」按钮同款外观与悬停显示。
  const productClass = source.getAttribute('class') ?? ''
  const desiredClass = productClass.length > 0 ? `${productClass} ${ARCHIVE_CLASS}` : ARCHIVE_CLASS
  if (btn.className !== desiredClass) btn.className = desiredClass
  const aria = archiveAriaLabel(localeForAriaLabel(source.getAttribute('aria-label')), titleOf(row))
  if (btn.getAttribute('aria-label') !== aria) btn.setAttribute('aria-label', aria)
}

/** 摘掉本模块在某个会话行留下的注入物,还原原「...」按钮。 */
function clearRow(row: HTMLElement): void {
  row.removeAttribute(ROW_ATTR)
  if (confirmAnchor !== null && row.contains(confirmAnchor)) closeArchiveConfirm()
  for (const btn of Array.from(row.querySelectorAll(`[${ARCHIVE_ATTR}]`))) btn.remove()
  for (const btn of Array.from(row.querySelectorAll(`[${CONFIRM_ATTR}]`))) btn.remove()
  for (const actions of Array.from(row.querySelectorAll(`[${ROW_ACTIONS_ATTR}]`))) {
    actions.removeAttribute(ROW_ACTIONS_ATTR)
  }
  for (const source of Array.from(row.querySelectorAll(`[${SOURCE_ATTR}]`))) {
    source.removeAttribute(SOURCE_ATTR)
  }
}

/** 全量重对齐:未认领的旧标记全部还原,状态不变的行零写入。 */
function sync(): void {
  const enabled = configNow().workspaceActions.enabled
  if (contextRow !== null && !contextRow.isConnected) closeContextMenu()
  if (confirmAnchor !== null
    && (!confirmAnchor.isConnected || confirmAnchor.getAttribute(ARCHIVE_ATTR) === null)) {
    closeArchiveConfirm()
  }
  if (confirmButton !== null
    && (!confirmButton.isConnected || confirmButton.getClientRects().length === 0)) {
    closeArchiveConfirm()
  }
  if (confirmButton !== null && confirmAnchor !== null
    && confirmButton.isConnected && confirmAnchor.isConnected) {
    const actions = confirmButton.parentElement
    if (actions instanceof HTMLElement) positionArchiveConfirm(confirmButton, confirmAnchor, actions)
  }
  const claimed = new Set<HTMLElement>()
  if (enabled) {
    for (const row of querySessionRows()) {
      if (rowActionsOf(row) !== null) {
        syncRow(row)
        claimed.add(row)
      } else {
        clearRow(row)
      }
    }
  } else {
    closeContextMenu()
    closeArchiveConfirm()
  }
  for (const row of Array.from(document.querySelectorAll(`[${ROW_ATTR}]`))) {
    const el = row instanceof HTMLElement ? row : null
    if (el === null) continue
    if (!claimed.has(el)) clearRow(el)
  }
}

function makeContextMenuItem(locale: Locale, action: 'rename' | 'fork'): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.setAttribute('role', 'menuitem')
  item.setAttribute('data-z-action', action)
  item.className = CONTEXT_ITEM_CLASS
  item.appendChild(action === 'rename' ? editIcon() : branchIcon())
  const label = document.createElement('span')
  label.textContent = CONTEXT_LABELS[locale][action]
  item.appendChild(label)
  return item
}

function closeContextMenu(): void {
  if (contextMenu !== null) {
    contextMenu.remove()
    contextMenu = null
  }
  contextRow = null
}

function showContextMenu(row: HTMLElement, x: number, y: number): void {
  closeArchiveConfirm()
  closeContextMenu()
  const source = sourceOf(row)
  const locale = source === null ? 'zh' : localeForAriaLabel(source.getAttribute('aria-label'))
  const menu = document.createElement('div')
  menu.className = CONTEXT_CLASS
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', locale === 'en' ? 'Session actions' : '会话操作')
  menu.appendChild(makeContextMenuItem(locale, 'rename'))
  menu.appendChild(makeContextMenuItem(locale, 'fork'))
  menu.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const item = target?.closest(`.${CONTEXT_ITEM_CLASS}`)
    if (!(item instanceof HTMLButtonElement) || item.parentElement !== menu) return
    const action = item.getAttribute('data-z-action')
    if (action !== 'rename' && action !== 'fork') return
    const selectedRow = contextRow
    closeContextMenu()
    if (selectedRow === null || busyRows.has(selectedRow)) return
    busyRows.add(selectedRow)
    void triggerSessionAction(selectedRow, action).finally(() => {
      busyRows.delete(selectedRow)
    })
  })
  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(`.${CONTEXT_ITEM_CLASS}`))
    if (items.length === 0) return
    const current = document.activeElement
    const index = current instanceof HTMLButtonElement ? items.indexOf(current) : -1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = index < 0 ? items[0] : items[(index + 1) % items.length]
      next?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = index <= 0 ? items[items.length - 1] : items[index - 1]
      prev?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu()
    }
  })
  contextRow = row
  contextMenu = menu
  document.body.appendChild(menu)
  menu.style.left = '0px'
  menu.style.top = '0px'
  const rect = menu.getBoundingClientRect()
  const left = Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN))
  const top = Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN))
  menu.style.left = `${Math.round(left)}px`
  menu.style.top = `${Math.round(top)}px`
  const first = menu.querySelector(`.${CONTEXT_ITEM_CLASS}`)
  if (first instanceof HTMLButtonElement) first.focus()
}

/** 打开原「...」菜单后,定位并点击指定动作的菜单项;失败返回 false。 */
async function triggerSessionAction(row: HTMLElement, action: SessionAction): Promise<boolean> {
  const source = sourceOf(row)
  if (source === null) return false
  const beforeMenus = new Set<Element>()
  for (const menu of document.querySelectorAll('[role="menu"]')) beforeMenus.add(menu)
  document.body.setAttribute(PUPPET_ATTR, '')
  try {
    source.click()
    const item = await waitForSessionMenuItem(action, beforeMenus)
    if (item === null) {
      // 菜单开出来但没找到条目(产品结构漂移):派发 Escape 让产品
      // 自己的 Menu 收起来,不留一个看不见的孤儿菜单。
      if (hasNewMenu(beforeMenus)) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }
      return false
    }
    item.click()
    return true
  } finally {
    document.body.removeAttribute(PUPPET_ATTR)
  }
}

function hasNewMenu(beforeMenus: ReadonlySet<Element>): boolean {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (!beforeMenus.has(menu)) return true
  }
  return false
}

function waitForSessionMenuItem(action: SessionAction, beforeMenus: ReadonlySet<Element>): Promise<HTMLButtonElement | null> {
  return new Promise((resolve) => {
    const deadline = performance.now() + MENU_WAIT_TIMEOUT_MS
    const poll = (): void => {
      const item = findSessionMenuItem(action, beforeMenus)
      if (item !== null) {
        resolve(item)
        return
      }
      if (performance.now() >= deadline) {
        resolve(null)
        return
      }
      window.setTimeout(poll, MENU_POLL_MS)
    }
    poll()
  })
}

function findSessionMenuItem(action: SessionAction, beforeMenus: ReadonlySet<Element>): HTMLButtonElement | null {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (!(menu instanceof HTMLElement) || beforeMenus.has(menu)) continue
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (items.length === 0) continue
    for (const item of items) {
      if (actionLabelMatches(item.textContent ?? '', action)) return item
    }
    if (items.length === 3) {
      const fallback = items[ACTION_INDEX[action]]
      if (fallback !== undefined) return fallback
    }
  }
  return null
}

/**
 * Client effect:左侧工作区会话行的归档按钮 + 右键菜单。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applyWorkspaceActions(ctx: ClientContext): void {
  ctx.effect(() => {
    let raf = 0
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        sync()
      })
    }
    const onContextMenu = (event: MouseEvent): void => {
      const row = sessionRowOf(event.target)
      if (row === null || !row.hasAttribute(ROW_ATTR)) {
        if (contextMenu !== null) closeContextMenu()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      showContextMenu(row, event.clientX, event.clientY)
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (confirmButton !== null) {
        const anchor = confirmAnchor
        const outsideConfirm = !(target instanceof Node) || !confirmButton.contains(target)
        const outsideAnchor = !(target instanceof Node) || anchor === null || !anchor.contains(target)
        if (outsideConfirm && outsideAnchor) closeArchiveConfirm()
      }
      if (contextMenu !== null && (!(target instanceof Node) || !contextMenu.contains(target))) {
        closeContextMenu()
      }
    }
    // 鼠标移出会话行即取消确认:产品的 rowActions 在非 hover 时会整个
    // display:none,若只靠点击收起,确认态会残留在不可见容器里,下次
    // 悬停又突然出现。移出后归档按钮回到"下次 hover 才显示"的产品节奏。
    const onPointerOut = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse' || confirmRow === null) return
      const row = confirmRow
      const related = event.relatedTarget
      if (!(related instanceof Node) || !row.contains(related)) closeArchiveConfirm()
    }
    // 键盘路径:焦点移出会话行同样取消确认(产品 rowActions 也不会一直显示)。
    const onFocusOut = (event: FocusEvent): void => {
      if (confirmRow === null) return
      const row = confirmRow
      const related = event.relatedTarget
      if (!(related instanceof Node) || !row.contains(related)) closeArchiveConfirm()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        const hadOverlay = confirmButton !== null || contextMenu !== null
        if (confirmButton !== null) closeArchiveConfirm(true)
        if (contextMenu !== null) closeContextMenu()
        if (hadOverlay) event.preventDefault()
      }
    }
    const onScrollOrResize = (): void => {
      closeArchiveConfirm()
      closeContextMenu()
    }
    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    })
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('blur', onScrollOrResize)
    const unsubscribe = subscribeConfig(schedule)
    return () => {
      observer.disconnect()
      unsubscribe()
      if (raf !== 0) cancelAnimationFrame(raf)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('blur', onScrollOrResize)
      closeArchiveConfirm()
      closeContextMenu()
      for (const source of Array.from(document.querySelectorAll(`[${SOURCE_ATTR}]`))) {
        source.removeAttribute(SOURCE_ATTR)
      }
      for (const btn of Array.from(document.querySelectorAll(`[${ARCHIVE_ATTR}]`))) btn.remove()
      for (const btn of Array.from(document.querySelectorAll(`[${CONFIRM_ATTR}]`))) btn.remove()
      for (const actions of Array.from(document.querySelectorAll(`[${ROW_ACTIONS_ATTR}]`))) {
        actions.removeAttribute(ROW_ACTIONS_ATTR)
      }
      for (const row of Array.from(document.querySelectorAll(`[${ROW_ATTR}]`))) {
        row.removeAttribute(ROW_ATTR)
      }
    }
  }, 'dsh-session-ui-enhance: workspace actions')
}
