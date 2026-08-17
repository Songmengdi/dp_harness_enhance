import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { BrowserManager } from './browser.js'
import type { BrowserUseConfig } from './config.js'
import type { ExtensionBackend } from './extension/backend.js'
import { executeBrowserCommand } from './executor.js'
import type { BrowserBrokerRequest, BrowserBrokerResponse } from './protocol.js'

const BROWSER_ID = 'dsh-iab'
const BROWSER_GENERATION = 1

function iabDescriptor() {
  return {
    id: BROWSER_ID,
    generation: BROWSER_GENERATION,
    type: 'iab' as const,
    name: 'dsh In-app Browser',
    capabilities: {
      browser: [
        { id: 'visibility', description: 'Use to show or hide the browser pane.' },
      ],
      tab: [],
    },
    apiSupportOverrides: {
      'BrowserUser.openTabs': true,
      'BrowserUser.claimTab': true,
    },
    metadata: { provider: 'dsh-browser-use' },
  }
}

function allDescriptors(extension?: ExtensionBackend) {
  const descriptors: Array<{
    id: string
    generation: number
    type: string
    name: string
    capabilities: { browser: Array<{ id: string; description: string }>; tab: Array<{ id: string; description: string }> }
    apiSupportOverrides?: Record<string, boolean>
    metadata?: Record<string, string>
  }> = [iabDescriptor()]
  if (extension?.connected) descriptors.push(extension.descriptor())
  return descriptors
}

function sendJson(socket: Socket, data: BrowserBrokerResponse): void {
  socket.write(`${JSON.stringify(data)}\n`)
}

export interface BrowserBroker {
  socketPath: string
  token: string
  close(): Promise<void>
}

export async function startBroker(
  manager: BrowserManager,
  config: BrowserUseConfig,
  extension?: ExtensionBackend,
): Promise<BrowserBroker> {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dir = join(root, 'browser-use')
  mkdirSync(dir, { recursive: true })
  const socketPath = join(dir, 'broker.sock')
  if (existsSync(socketPath)) unlinkSync(socketPath)
  const token = randomBytes(32).toString('hex')
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const raw = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!raw.trim()) return
      void handleRequest(socket, raw, token, manager, config, extension)
    })
    socket.on('error', () => {})
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  return {
    socketPath,
    token,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (existsSync(socketPath)) unlinkSync(socketPath)
    },
  }
}

async function handleRequest(
  socket: Socket,
  raw: string,
  token: string,
  manager: BrowserManager,
  config: BrowserUseConfig,
  extension?: ExtensionBackend,
): Promise<void> {
  let parsed: BrowserBrokerRequest
  try {
    parsed = JSON.parse(raw) as BrowserBrokerRequest
  } catch {
    sendJson(socket, { id: randomUUID(), ok: false, error: 'invalid JSON' })
    return
  }
  const id = (parsed as { id?: string }).id ?? randomUUID()
  const incomingToken = (parsed as { token?: string }).token
  if (incomingToken !== token) {
    sendJson(socket, { id, ok: false, error: 'unauthorized' })
    return
  }
  try {
    if (parsed.op === 'list') {
      sendJson(socket, { id, ok: true, browsers: allDescriptors(extension) })
      return
    }
    if (parsed.op === 'execute') {
      if (extension?.connected && parsed.browserId === extension.id && parsed.browserGeneration === extension.generation) {
        const result = await extension.execute(parsed.command)
        sendJson(socket, { id, ok: true, result })
        return
      }
      if (parsed.browserId !== BROWSER_ID || parsed.browserGeneration !== BROWSER_GENERATION) {
        sendJson(socket, { id, ok: false, error: 'browser backend is stale or unavailable' })
        return
      }
      const result = await executeBrowserCommand(manager, config, parsed.command)
      sendJson(socket, { id, ok: true, result })
      return
    }
    sendJson(socket, { id, ok: false, error: `unknown op: ${(parsed as { op?: string }).op ?? ''}` })
  } catch (error) {
    sendJson(socket, { id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
