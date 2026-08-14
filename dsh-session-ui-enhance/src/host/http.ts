/**
 * Host HTTP 处理:mermaid 客户端配置下发端点。
 * route 在 apply 的 effect 里注册(可随 fiber 清理),
 * handler 拥有完整响应生命周期(见 dsh-host-webserver 的 WebRoute 契约)。
 *
 * v1.3.0 起渲染移至浏览器本地 mermaid.js,同源 Kroki 代理路由已移除。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { clientConfigOf } from '../config.js'

export const CONFIG_PATH = '/plugins/dsh-session-ui-enhance/client-config'

/** 纯文本收尾,幂等(已发送过 header 则只 end)。 */
export function endText(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers })
  res.end(message)
}

/**
 * 客户端配置下发:浏览器半边启动时拉取,返回 Config 的客户端可见子集。
 * 实时快照,禁止缓存。
 */
export function handleClientConfig(req: IncomingMessage, res: ServerResponse, config: Config): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    endText(res, 405, 'method not allowed', { allow: 'GET, HEAD' })
    return
  }
  const body = JSON.stringify(clientConfigOf(config))
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}
