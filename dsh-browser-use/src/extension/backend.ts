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

  setTransport(transport: ExtensionTransport | undefined): void {
    this.transport = transport
  }

  get connected(): boolean {
    return this.transport?.isConnected() ?? false
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
