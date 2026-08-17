import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { BrowserBrokerRequest, BrowserBrokerResponse, BrowserCommand } from '../protocol.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BROKER_SOCKET_ENV = 'DSH_BROWSER_USE_BROKER_SOCKET'
const BROKER_TOKEN_ENV = 'DSH_BROWSER_USE_BROKER_TOKEN'
const PLUGIN_ROOT_ENV = 'DSH_BROWSER_USE_ROOT'
const BRIDGE_SYMBOL = Symbol.for('dsh.node-repl.browser-control-bridge')
const WORKER_KIND = 'dsh-node-repl-call'
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 120_000

const jsInputSchema = {
  code: z.string(),
  timeout_ms: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
  title: z.string().min(1).max(120).optional(),
}

function pluginRoot(): string {
  return process.env[PLUGIN_ROOT_ENV]?.trim() || resolve(__dirname, '..', '..')
}

function documentationRoot(): string {
  return join(pluginRoot(), 'docs')
}

function requestMetaFromArgs(args: Record<string, unknown>): Record<string, unknown> {
  return (args as { _meta?: Record<string, unknown> })._meta ?? {}
}

function buildBridgeGlobals() {
  const socketPath = process.env[BROKER_SOCKET_ENV]?.trim()
  const token = process.env[BROKER_TOKEN_ENV]?.trim()
  if (!socketPath || !token) {
    throw new Error('Browser broker is unavailable: missing DSH_BROWSER_USE_BROKER_SOCKET/TOKEN')
  }
  const transport = {
    list: async () => {
      const response = await sendBrokerRequest({ op: 'list', sessionId: 'mcp' }, socketPath, token)
      return response.browsers ?? []
    },
    execute: async (browserId: string, browserGeneration: number, command: BrowserCommand) => {
      const response = await sendBrokerRequest(
        { op: 'execute', browserId, browserGeneration, sessionId: 'mcp', command },
        socketPath,
        token,
      )
      if (!response.result) throw new Error('Browser broker returned no command result')
      return response.result
    },
  }
  return {
    [BRIDGE_SYMBOL]: {
      ...transport,
      documentationRoot: documentationRoot(),
      assertAvailable: () => { if (!socketPath || !token) throw new Error('Browser broker unavailable') },
    },
  }
}

async function sendBrokerRequest(
  request: BrowserBrokerRequest,
  socketPath: string,
  token: string,
): Promise<Extract<BrowserBrokerResponse, { ok: true }>> {
  const id = randomUUID()
  return await new Promise((resolvePromise, reject) => {
    let buffer = ''
    let settled = false
    const socket = createConnection(socketPath)
    const finish = (error?: Error, value?: Extract<BrowserBrokerResponse, { ok: true }>) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else if (value) resolvePromise(value)
      else reject(new Error('Browser broker returned no response'))
    }
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ id, token, ...request })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as BrowserBrokerResponse
        if (parsed.id !== id) throw new Error('Browser broker response id mismatch')
        if (!parsed.ok) throw new Error(parsed.error)
        finish(undefined, parsed)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('error', (error) => finish(error))
    socket.once('close', () => finish(new Error('Browser broker closed before returning a response')))
  })
}

async function runUserCode(code: string, meta: Record<string, unknown>): Promise<{ value?: unknown; text: string }> {
  const root = pluginRoot()
  const clientUrl = pathToFileURL(join(root, 'scripts', 'browser-client.mjs')).href
  const { setupBrowserRuntime } = await import(clientUrl) as { setupBrowserRuntime(input: { globals: Record<string, unknown> }): void }

  let result: unknown
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    process: {
      env: {},
      platform: process.platform,
      cwd: () => '/',
      version: process.version,
    },
    nodeRepl: {
      write: (value: unknown) => { result = value },
      emitImage: (_image: unknown) => { /* images are represented as text placeholders in dsh */ },
      requestMeta: meta,
      cwd: () => '/',
      homeDir: () => '/',
      tmpDir: () => '/tmp',
    },
    agent: {},
    __dshResult: undefined,
  }

  const bridge = buildBridgeGlobals()
  sandbox[BRIDGE_SYMBOL as unknown as string] = bridge[BRIDGE_SYMBOL]
  setupBrowserRuntime({ globals: sandbox })

  const context = vm.createContext(sandbox)
  const script = new vm.Script(`(async () => { ${code}\n })()`, { filename: 'dsh-node-repl.js' })
  const promise = script.runInContext(context) as Promise<unknown>
  await promise

  const value = result !== undefined ? result : sandbox.__dshResult
  const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { value, text }
}

async function executeJs(args: { code: string; timeout_ms: number | undefined; title?: string }) {
  const meta = requestMetaFromArgs(args as unknown as Record<string, unknown>)
  const worker = new Worker(new URL(import.meta.url), {
    workerData: {
      kind: WORKER_KIND,
      code: args.code,
      meta,
    },
    execArgv: [],
  })
  return await new Promise<{ value?: unknown; text: string }>((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        void worker.terminate()
        reject(new Error(`js execution timed out after ${args.timeout_ms ?? DEFAULT_TIMEOUT_MS}ms`))
      }
    }, args.timeout_ms ?? DEFAULT_TIMEOUT_MS)
    worker.once('message', (message: { ok: boolean; value?: unknown; text?: string; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (message.ok) resolvePromise({ value: message.value, text: message.text ?? '' })
      else reject(new Error(message.error ?? 'js execution failed'))
    })
    worker.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error(`js worker exited with code ${code}`))
      }
    })
  })
}

async function main(): Promise<void> {
  const server = new McpServer({ name: 'node_repl', version: '0.1.0' })
  server.tool(
    'js',
    'Browser Use only. Run JavaScript in a fresh Node-backed kernel to drive agent.browsers. Top-level await is supported inside the async wrapper; end with nodeRepl.write(value) or assign globalThis.__dshResult to return a value.',
    jsInputSchema,
    async (args) => {
      try {
        const run = await executeJs({
          code: args.code,
          timeout_ms: args.timeout_ms,
          ...(args.title ? { title: args.title } : {}),
        })
        return { content: [{ type: 'text', text: run.text }] }
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
      }
    },
  )
  server.tool(
    'js_reset',
    'Compatibility barrier. Every js call already starts fresh, so this is a no-op.',
    {},
    async () => ({ content: [{ type: 'text', text: 'js kernel reset' }] }),
  )
  server.tool(
    'js_add_node_module_dir',
    'Browser Use only. Add an absolute node_modules directory for future fresh calls.',
    { path: z.string() },
    async ({ path }) => ({ content: [{ type: 'text', text: String(path) }] }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (!isMainThread && workerData?.kind === WORKER_KIND) {
  const meta = (workerData.meta ?? {}) as Record<string, unknown>
  try {
    const run = await runUserCode(workerData.code as string, meta)
    parentPort?.postMessage({ ok: true, value: run.value, text: run.text })
  } catch (error) {
    parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
} else if (isMainThread) {
  void main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
