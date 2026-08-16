import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BridgeLogger } from './logger.js'

export type SeesImagesFn = (agent: Agent) => Promise<boolean>

interface CacheEntry {
  sees: boolean
  at: number
  ttlMs: number | null // null = 正缓存（成功结果），永不主动过期
}

const FAILURE_TTL_MS = 30_000

/**
 * 按 Agent 真实 provider/model 判断是否原生支持图片。
 * 成功结果正缓存；失败结果带 TTL（不会一次失败永久误判）。
 */
export function createCapabilityChecker(ctx: Context, logger: BridgeLogger): {
  seesImages: SeesImagesFn
  invalidate: () => void
} {
  const cache = new Map<string, CacheEntry>()
  const llm = ctx.get('llm')

  async function resolve(agent: Agent): Promise<boolean> {
    const options = agent.options ?? {}
    let provider = typeof options.provider === 'string' ? options.provider : ''
    let model = typeof options.model === 'string' ? options.model : ''
    if (!provider || !model) {
      try {
        const adm = ctx.get('agentDefaultModel')
        const sel = adm?.currentSelection()
        if (sel) {
          provider = String(sel.provider ?? '')
          model = String(sel.model ?? '')
        }
      } catch (e) { /* 无默认模型服务 → 保守 false */ }
    }
    if (!provider || !model || llm === undefined) return false
    const key = `${provider}|${model}`
    const hit = cache.get(key)
    if (hit) {
      if (hit.ttlMs === null || Date.now() - hit.at <= hit.ttlMs) return hit.sees
      cache.delete(key)
    }
    let sees = false
    try {
      const info = await llm.resolveModelInfo(provider, model)
      sees = (info?.inputModalities ?? []).includes('image')
      cache.set(key, { sees, at: Date.now(), ttlMs: null })
    } catch (e) {
      sees = false
      cache.set(key, { sees, at: Date.now(), ttlMs: FAILURE_TTL_MS })
      logger.warn({ provider, model }, `capability resolve failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    return sees
  }

  return {
    seesImages: resolve,
    invalidate: () => cache.clear(),
  }
}
