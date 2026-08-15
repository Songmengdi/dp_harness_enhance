/**
 * dsh-session-ui-enhance — 斜杠候选菜单的 Tab 确认。
 *
 * 官方 ui-input-trigger 的 `InputTriggerController.arbitrate` 只认
 * up/down/enter/escape,ui-conversation 的 textarea `onKeyDown` 也不拦截
 * Tab:候选菜单打开时按 Tab 直接落到浏览器默认的焦点遍历,把焦点移出
 * 输入框。本模块在 document capture 阶段截获普通 Tab——焦点在 composer
 * textarea 上、当前会话的斜杠菜单打开且已有高亮候选项时,复用官方
 * `arbitrate('enter')` 的同一键盘路径把高亮技能/命令上屏,然后
 * preventDefault 阻止焦点移走。
 *
 * Shift+Tab 不拦,保留反向焦点遍历的逃生通道;组合键/IME 组合/长按
 * repeat 都不拦。服务发现走 `ctx.inject`:ui-input-trigger 未装配时本
 * 特性静默不激活,不影响插件其余能力。
 *
 * 纯判定函数在 slash-tab-logic.ts,由 test/slash-tab.test.js 守护。
 *
 * @module dsh-session-ui-enhance/client/slash-tab
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// type-only:拉入 `ctx.inputTriggers` service 的 Context augmentation。
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { configNow } from './live-config'
import { isConfirmableTab, slashPickAvailable } from './slash-tab-logic'

/**
 * Client effect:截获普通 Tab,把打开中的斜杠菜单高亮项走官方 Enter 仲裁
 * 上屏。listener 随 fiber 卸载;配置实时读取,无需订阅。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applySlashTabConfirm(ctx: ClientContext): void {
  ctx.inject(['inputTriggers', 'sessions'], (scope) => {
    const { inputTriggers, sessions } = scope
    scope.effect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!isConfirmableTab(event, configNow().composer.slashTabConfirm)) return
        const target = event.target
        if (!(target instanceof HTMLTextAreaElement)) return
        if (target.closest('[data-composer-card]') === null) return

        const current = sessions.list.getSnapshot().current
        if (current === undefined) return
        const actx = sessions.scope(current)
        if (actx === undefined) return

        const controller = inputTriggers.sessionOf(actx)
        if (!slashPickAvailable(controller.menu.getSnapshot())) return
        // 与官方 Enter 完全同一键盘仲裁路径:highlight 有效则 pick,无效 pass。
        if (controller.arbitrate('enter', false) === 'pass') return
        // 上屏已发生,吃掉 Tab 的默认焦点遍历,焦点留在 textarea。
        event.preventDefault()
      }
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, 'dsh-session-ui-enhance: slash tab confirm')
  })
}
