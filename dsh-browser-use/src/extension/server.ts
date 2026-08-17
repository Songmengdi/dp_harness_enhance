import type { WebServer, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebSocket, WebSocketServer } from 'ws'
import type { BrowserCommandResult } from '../protocol.js'
import { ExtensionBackend } from './backend.js'
import type { ExtensionClientMessage, ExtensionHostMessage } from './protocol.js'

const COMMAND_TIMEOUT_MS = 60_000

export interface ExtensionServer {
  backend: ExtensionBackend
  close(): Promise<void>
}

export async function startExtensionServer(webServer: WebServer): Promise<ExtensionServer> {
  const backend = new ExtensionBackend()
  const wss = new WebSocketServer({ noServer: true })
  const pending = new Map<number, { resolve: (value: BrowserCommandResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let currentSocket: WebSocket | undefined

  const rejectAll = (message: string) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(new Error(message))
    }
    pending.clear()
  }

  const sendCommand = (message: ExtensionHostMessage): Promise<BrowserCommandResult> => {
    if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        ok: false,
        elapsedMs: 0,
        error: { code: 'backend_unavailable', message: 'User Chrome extension is not connected' },
      })
    }
    const { id } = message
    return new Promise<BrowserCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Chrome extension command timed out'))
      }, COMMAND_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      currentSocket!.send(JSON.stringify(message))
    })
  }

  backend.setTransport({
    send: sendCommand,
    isConnected: () => currentSocket?.readyState === WebSocket.OPEN,
  })

  const route: WebUpgradeRoute = {
    path: '/browser-use/extension',
    handler: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
          ws.close(4000, 'replaced by a newer extension connection')
          return
        }
        currentSocket = ws
        backend.setTransport({
          send: sendCommand,
          isConnected: () => ws.readyState === WebSocket.OPEN,
        })
        ws.on('message', (data) => {
          let message: ExtensionClientMessage
          try {
            message = JSON.parse(data.toString()) as ExtensionClientMessage
          } catch {
            return
          }
          if (message.type === 'response') {
            const item = pending.get(message.id)
            if (!item) return
            pending.delete(message.id)
            clearTimeout(item.timer)
            item.resolve(message.result)
          } else if (message.type === 'hello') {
            backend.name = message.name || 'User Chrome (dsh extension)'
          }
        })
        ws.on('close', () => {
          if (currentSocket === ws) {
            currentSocket = undefined
            backend.setTransport(undefined)
            rejectAll('User Chrome extension disconnected')
          }
        })
        ws.on('error', () => {
          ws.close()
        })
      })
    },
  }

  const disposer = webServer.registerUpgrade(route)

  return {
    backend,
    close: async () => {
      disposer()
      rejectAll('Extension server closed')
      currentSocket?.close()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
