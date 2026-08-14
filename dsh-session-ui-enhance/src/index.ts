/**
 * dsh-session-ui-enhance — host half.
 *
 * Two responsibilities:
 *
 * 1. Mount the composition row so the client-modules scanner discovers the
 *    `./client` bundle through the package.json `dsh.client` declaration
 *    (the rail / typography / code-block chrome are pure browser UI).
 * 2. Serve the mermaid renderer's client-visible config snapshot to the
 *    browser half (merged in from the former dsh-mermaid-renderer plugin;
 *    since v1.3.0 diagrams render locally in the browser via mermaid.js —
 *    the same-origin Kroki proxy route is gone).
 *
 * The route depends on the `webServer` service (dsh-host-webserver) and is
 * registered inside an effect, so it unloads with the fiber.
 *
 * @module dsh-session-ui-enhance
 */

import type { Context } from '@deepseek-ai/cordis'
// type-only:载入 dsh-host-webserver 的 Context augmentation,使 ctx.webServer
// 与其 WebRoute 契约有官方类型;构建产物不引入任何运行时依赖。
import type {} from '@deepseek-ai/dsh-host-webserver'
// 值导入:Config 同时是类型与 Schemastery schema(同名双义导出),
// loader 需要运行时的 schema 值来校验/补默认配置。
import { Config } from './config.js'
import { CONFIG_PATH, handleClientConfig } from './host/http.js'

export const name = 'dsh-session-ui-enhance'

export const inject = ['webServer'] as const

export function apply(ctx: Context, config: Config) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_PATH,
    handler: (req, res) => handleClientConfig(req, res, config),
  }), 'dsh-session-ui-enhance: mermaid client-config route')
}

export { Config }
export { CLIENT_DEFAULTS, clientConfigOf } from './config.js'
export type { ClientConfig, DarkColors } from './config.js'
