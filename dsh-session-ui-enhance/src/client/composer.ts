/**
 * dsh-session-ui-enhance — 底部输入框(composer)精致化门禁。
 *
 * 重排本身是纯 CSS(见 composer.css,挂在 `[data-composer-card]` 稳定
 * 属性上);本 effect 只负责按配置在 <body> 上翻 `data-z-composer`
 * 门禁属性,配置关闭即整体还原产品原样。配置快照到达
 * (live-config 拉取成功)后重刷一次。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { configNow, subscribeConfig } from './live-config'

/**
 * Client effect:按 composer.enabled 翻 body 门禁属性;返回的 disposer
 * 还原属性。
 * @param ctx - client root context(owns the effect lifecycle)。
 */
export function applyComposerStyle(ctx: ClientContext): void {
  ctx.effect(() => {
    const syncGate = (): void => {
      if (configNow().composer.enabled) {
        document.body.setAttribute('data-z-composer', '')
      } else {
        document.body.removeAttribute('data-z-composer')
      }
    }
    syncGate()
    const unsubscribe = subscribeConfig(syncGate)
    return () => {
      unsubscribe()
      document.body.removeAttribute('data-z-composer')
    }
  }, 'dsh-session-ui-enhance: composer style')
}
