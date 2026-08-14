/**
 * dsh-mermaid-renderer — host 半边:同源 Kroki 代理 + 客户端配置下发。
 *
 * 唯一职责:把浏览器的渲染请求转发给 Kroki 兼容服务(浏览器永远不直连
 * 外网),并把配置的客户端可见子集下发给 client 半边。
 * 依赖 `webServer` service(dsh-host-webserver 提供);两个 route 都注册在
 * effect 里,随 fiber 卸载自动清理。
 */
import type { Context } from '@deepseek-ai/cordis'
// type-only:载入 dsh-host-webserver 的 Context augmentation,使 ctx.webServer
// 与其 WebRoute 契约有官方类型;构建产物不引入任何运行时依赖。
import type {} from '@deepseek-ai/dsh-host-webserver'
// 值导入:Config 同时是类型与 Schemastery schema(同名双义导出),
// loader 需要运行时的 schema 值来校验/补默认配置。
import { Config } from './config.js'
import { CONFIG_PATH, handleClientConfig, handleRender, RENDER_PATH } from './host/http.js'

export const name = 'dsh-mermaid-renderer'

export const inject = ['webServer'] as const

export function apply(ctx: Context, config: Config) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RENDER_PATH,
    handler: (req, res) => handleRender(req, res, config),
  }), 'dsh-mermaid-renderer: render route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_PATH,
    handler: (req, res) => handleClientConfig(req, res, config),
  }), 'dsh-mermaid-renderer: client-config route')
}

export { Config }
export { CLIENT_DEFAULTS, clientConfigOf } from './config.js'
export type { ClientConfig, DarkColors } from './config.js'
