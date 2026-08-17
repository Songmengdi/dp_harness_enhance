import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { VisionError } from './errors.js'
import type { Runtime } from './runtime.js'
import type { BridgeLogger } from './logger.js'

export interface RemoteConfig {
  endpoint: string
  model: string
  credential: string
  language: string
  visionTimeoutMs: number
  maxRetries: number
}

/**
 * 远程视觉执行（D7）：凭据只存 DSH Credential 引用，每次操作现取现用、
 * 只以环境变量进入子进程；日志/错误/结果不含 key（runtime 侧再脱敏一遍）。
 */
export class RemoteVision {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: Runtime,
    private readonly config: RemoteConfig,
    private readonly logger: BridgeLogger,
  ) {}

  /** 05 票热更新：非运行时字段（端点/模型/凭据引用等）直接换新。 */
  updateConfig(next: Partial<RemoteConfig>): void {
    Object.assign(this.config, next)
  }

  get target() {
    return {
      endpoint: this.config.endpoint,
      model: this.config.model,
      language: this.config.language,
    }
  }

  /** 供 glance 缓存键取凭据哈希；返回值绝不进日志与结果。 */
  async resolveCredential(): Promise<string | undefined> {
    const ref = this.config.credential.trim()
    if (!ref) return undefined
    try {
      const hit = await this.ctx.credentials.resolve(credentialRef(ref))
      return hit?.value
    } catch (e) {
      throw new VisionError('config', `凭据引用 ${ref} 解析失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 远程子命令统一入口：配置校验 → 现取凭据 → 注入环境 → subprocess。 */
  async run(sub: 'glance' | 'ground' | 'detect' | 'long_screenshot_ocr', spec: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number; cacheHit?: boolean } = {}): Promise<unknown> {
    if (!this.config.endpoint.trim() || !this.config.model.trim()) {
      throw new VisionError('config', '未配置视觉端点/模型：请在 bundle 装配行的 config 里填 endpoint 与 model（D8）')
    }
    const apiKey = await this.resolveCredential()
    if (this.config.credential.trim() && apiKey === undefined) {
      throw new VisionError('config', `凭据引用 ${this.config.credential} 未配置（settings 里设置该 DSH Credential）`)
    }
    const timeoutMs = (typeof spec.timeoutMs === 'number' ? spec.timeoutMs : undefined) ?? this.config.visionTimeoutMs
    const env: Record<string, string> = {
      DSH_VISION_ENDPOINT: this.config.endpoint,
      DSH_VISION_MODEL: this.config.model,
      DSH_VISION_API_KEY: apiKey ?? '',
      DSH_VISION_LANGUAGE: this.config.language,
      DSH_VISION_PROTOCOL: 'openai-completions',
    }
    const payload = {
      endpoint: this.config.endpoint,
      model: this.config.model,
      language: this.config.language,
      protocol: 'openai-completions',
      maxRetries: this.config.maxRetries,
      timeoutMs,
      ...spec,
    }
    return this.runtime.run(sub, payload, {
      signal: opts.signal,
      timeoutMs: timeoutMs + 10_000, // 给 Python 硬超时留出余量，Host 兜底
      env,
      meta: { toolName: 'vision_' + sub.replace('long_screenshot_ocr', 'long_screenshot_ocr'), cacheHit: opts.cacheHit ?? false },
    })
  }
}

/**
 * vision_glance 会话级缓存：key = 图片内容哈希 + query/ocr/region + 端点/模型/语言/凭据哈希。
 * 失败与其他会话绝不共享；TTL 过期。
 */
export class GlanceCache {
  private readonly maps = new Map<string, Map<string, { value: unknown; at: number }>>()

  constructor(private ttlMs: number, private readonly logger: BridgeLogger) {}

  setTtl(ttlMs: number): void {
    this.ttlMs = ttlMs
    if (ttlMs <= 0) this.maps.clear()
  }

  async keyFor(args: {
    images: string[]
    query?: string
    ocr?: boolean
    region?: string
    endpoint: string
    model: string
    language: string
    apiKey: string | undefined
  }): Promise<string> {
    const parts: string[] = []
    for (const image of args.images) {
      const data = await fsp.readFile(image)
      parts.push('img:' + createHash('sha256').update(data).digest('hex'))
    }
    parts.push('q:' + (args.query ?? ''))
    parts.push('ocr:' + (args.ocr === true ? '1' : '0'))
    parts.push('region:' + (args.region ?? ''))
    parts.push('ep:' + args.endpoint)
    parts.push('model:' + args.model)
    parts.push('lang:' + args.language)
    parts.push('key:' + createHash('sha256').update(args.apiKey ?? '').digest('hex'))
    return createHash('sha256').update(parts.join('\n')).digest('hex')
  }

  get(agentId: string, key: string): unknown | undefined {
    if (this.ttlMs <= 0) return undefined
    const entry = this.maps.get(agentId)?.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.at > this.ttlMs) {
      this.maps.get(agentId)?.delete(key)
      return undefined
    }
    this.logger.info({ agentId, cacheHit: true })
    return structuredClone(entry.value)
  }

  set(agentId: string, key: string, value: unknown): void {
    if (this.ttlMs <= 0) return
    let map = this.maps.get(agentId)
    if (!map) {
      map = new Map()
      this.maps.set(agentId, map)
    }
    map.set(key, { value, at: Date.now() })
    this.logger.info({ agentId, cacheHit: false, cached: true })
  }

  drop(agentId: string): void {
    this.maps.delete(agentId)
  }
}
