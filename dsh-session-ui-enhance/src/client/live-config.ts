/**
 * dsh-session-ui-enhance — 浏览器侧运行时配置存储。
 *
 * client bundle 无法直接读 host 侧的插件配置(boot graph 只含
 * id/url/rev/inject/immediately),所以启动时从 host 的 client-config
 * 端点拉取配置快照;成功前各消费方统一使用编译期默认值(与 host
 * schema 默认值一致,由 test/client-config.test.js 守护不漂移)。
 *
 * 原内嵌于 mermaid.ts;自 think-collapse 起多个 client 特性消费同一
 * 份配置,抽为独立模块。
 */
import { CLIENT_DEFAULTS, sanitizeClientConfig, type ClientConfig } from '../shared/client-config'

const CONFIG_ENDPOINT = '/plugins/dsh-session-ui-enhance/client-config'
const CONFIG_FETCH_TIMEOUT_MS = 5000

/** 当前生效的配置:拉取成功前为编译期默认值。 */
let liveConfig: ClientConfig = CLIENT_DEFAULTS
const configListeners = new Set<() => void>()

export function setLiveConfig(cfg: ClientConfig): void {
  liveConfig = cfg
  for (const listener of configListeners) listener()
}

export function subscribeConfig(listener: () => void): () => void {
  configListeners.add(listener)
  return () => {
    configListeners.delete(listener)
  }
}

export function configNow(): ClientConfig {
  return liveConfig
}

/** 从 host 拉取配置快照;网络/解析失败抛错,由调用方决定回退策略。 */
export async function loadClientConfig(): Promise<ClientConfig> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return sanitizeClientConfig(await res.json())
  } finally {
    clearTimeout(timer)
  }
}
