import type { BrowserCommand, BrowserCommandResult } from '../protocol.js'

export interface ExtensionTransport {
  send(message: { type: 'command'; id: number; command: BrowserCommand }): Promise<BrowserCommandResult>
  isConnected(): boolean
}

export class ExtensionBackend {
  readonly id = 'dsh-extension'
  readonly generation = 1
  readonly type = 'extension' as const
  name = 'User Chrome (dsh extension)'

  private transport: ExtensionTransport | undefined
  owner: string | undefined

  setTransport(transport: ExtensionTransport | undefined): void {
    this.transport = transport
  }

  get connected(): boolean {
    return this.transport?.isConnected() ?? false
  }

  /** 尝试把扩展后端分配给某个会话；已被其他会话占用时返回 false。 */
  claim(sessionId: string): boolean {
    const key = sessionId || 'default'
    if (this.owner && this.owner !== key) return false
    this.owner = key
    return true
  }

  async release(sessionId: string): Promise<void> {
    const key = sessionId || 'default'
    if (this.owner !== key) return
    this.owner = undefined
    if (!this.transport?.isConnected()) return
    try {
      const id = Math.floor(Math.random() * 0x7fffffff)
      await this.transport.send({ type: 'command', id, command: { method: 'clearAgentTabs' } })
    } catch {
      // 扩展可能已经断开；忽略释放时的清理失败。
    }
  }

  descriptor() {
    return {
      id: this.id,
      generation: this.generation,
      type: this.type,
      name: this.name,
      capabilities: {
        browser: [
          { id: 'visibility', description: 'User Chrome is always visible on the desktop.' },
        ],
        tab: [],
      },
      apiSupportOverrides: {
        'BrowserUser.openTabs': true,
        'BrowserUser.claimTab': true,
      },
      metadata: { provider: 'dsh-chrome-extension' },
    }
  }

  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    if (!this.transport) {
      return {
        ok: false,
        elapsedMs: 0,
        error: { code: 'backend_unavailable', message: 'User Chrome extension is not connected' },
      }
    }
    const id = Math.floor(Math.random() * 0x7fffffff)
    return this.transport.send({ type: 'command', id, command })
  }
}
