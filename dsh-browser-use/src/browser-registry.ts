import { join } from 'node:path'
import { BrowserManager } from './browser.js'
import type { BrowserUseConfig } from './config.js'

function sessionDirName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return safe || 'default'
}

/**
 * 每个 Agent 会话持有独立的 BrowserManager / 浏览器实例。
 *
 * - 默认会话（'default'）沿用原有 profile 路径，保持既有登录态。
 * - 其他会话使用 `profile/sessions/<sessionId>` 独立 userDataDir，避免多个
 *   Chrome 实例争用同一个 profile。
 * - `lastActive` 供 HTTP 面板跟随最近活跃的会话浏览器。
 */
export class BrowserManagerRegistry {
  private readonly managers = new Map<string, BrowserManager>()
  private lastActiveSessionId = 'default'

  constructor(
    private readonly config: BrowserUseConfig,
    private readonly defaultProfileRoot: string,
  ) {}

  get(sessionId = 'default'): BrowserManager {
    const key = sessionId || 'default'
    this.lastActiveSessionId = key
    const existing = this.managers.get(key)
    if (existing) return existing

    let manager: BrowserManager
    if (key === 'default') {
      const dir = this.config.userDataDir || this.defaultProfileRoot
      manager = new BrowserManager(this.config, dir)
    } else {
      const root = this.config.userDataDir || this.defaultProfileRoot
      const sessionDir = join(root, 'sessions', sessionDirName(key))
      manager = new BrowserManager({ ...this.config, userDataDir: sessionDir }, sessionDir)
    }
    this.managers.set(key, manager)
    return manager
  }

  getDefault(): BrowserManager {
    return this.get('default')
  }

  get lastActive(): BrowserManager {
    return this.get(this.lastActiveSessionId)
  }

  has(sessionId: string): boolean {
    return this.managers.has(sessionId || 'default')
  }

  async dispose(sessionId: string): Promise<void> {
    const key = sessionId || 'default'
    const manager = this.managers.get(key)
    if (!manager) return
    this.managers.delete(key)
    await manager.close()
  }

  async closeAll(): Promise<void> {
    const managers = [...this.managers.values()]
    this.managers.clear()
    await Promise.allSettled(managers.map((manager) => manager.close()))
  }
}
