/**
 * dsh-session-ui-enhance — 斜杠候选 Tab 确认的纯判定逻辑。
 *
 * 不 import 任何含运行时副作用/Node 不友好的模块,便于
 * test/slash-tab.test.js 直接以 Node 加载守护;DOM/服务编排见
 * slash-tab.ts。
 *
 * @module dsh-session-ui-enhance/client/slash-tab-logic
 */

import type { MenuState } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** KeyboardEvent 里 Tab 确认判定所需的字段(纯函数测试不必构造完整事件)。 */
export interface ConfirmableTabEvent {
  key: string
  shiftKey: boolean
  repeat: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  isComposing: boolean
  keyCode: number
}

/**
 * 一次 keydown 是否应作为「斜杠候选确认」处理:
 * 功能开启 + 普通 Tab(不带 Shift/修饰键、非 repeat、非 IME 组合)。
 */
export function isConfirmableTab(event: ConfirmableTabEvent, enabled: boolean): boolean {
  if (!enabled) return false
  if (event.key !== 'Tab') return false
  if (event.shiftKey || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false
  return !event.isComposing && event.keyCode !== 229
}

/**
 * 当前会话的触发菜单是否有一条可上屏的斜杠高亮项。
 * 只认 `/` 触发(命令/技能菜单),`@` 提及行为保持官方原样。
 */
export function slashPickAvailable(state: Pick<MenuState, 'open' | 'hit' | 'highlight'>): boolean {
  return state.open && state.hit !== null && state.hit.trigger === '/' && state.highlight !== null
}
