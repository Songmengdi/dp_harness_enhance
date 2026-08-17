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

function buildBridgeGlobals(meta: Record<string, unknown>) {
  const socketPath = process.env[BROKER_SOCKET_ENV]?.trim()
  const token = process.env[BROKER_TOKEN_ENV]?.trim()
  if (!socketPath || !token) {
    throw new Error('Browser broker is unavailable: missing DSH_BROWSER_USE_BROKER_SOCKET/TOKEN')
  }
  const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : 'default'
  const transport = {
    list: async () => {
      const response = await sendBrokerRequest({ op: 'list', sessionId }, socketPath, token)
      return response.browsers ?? []
    },
    execute: async (browserId: string, browserGeneration: number, command: BrowserCommand) => {
      const response = await sendBrokerRequest(
        { op: 'execute', browserId, browserGeneration, sessionId, command },
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

function countDelimiters(line: string): { paren: number; bracket: number; brace: number } {
  let paren = 0
  let bracket = 0
  let brace = 0
  let quote: string | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (lineComment) break
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i += 1
      }
      continue
    }
    if (!quote) {
      if (ch === '/' && next === '/') {
        lineComment = true
        continue
      }
      if (ch === '/' && next === '*') {
        blockComment = true
        i += 1
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        continue
      }
      if (ch === '(') paren += 1
      else if (ch === ')') paren -= 1
      else if (ch === '[') bracket += 1
      else if (ch === ']') bracket -= 1
      else if (ch === '{') brace += 1
      else if (ch === '}') brace -= 1
    } else {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === quote) quote = null
    }
  }
  return { paren, bracket, brace }
}

function splitFinalExpression(code: string): { prefix: string; expression: string } | null {
  const trimmed = code.replace(/\s+$/, '')
  if (!trimmed) return null
  const lines = trimmed.split('\n')
  let exprStart = -1
  let paren = 0
  let bracket = 0
  let brace = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!
    if (exprStart < 0) {
      if (line.trim() === '') continue
      exprStart = i
    }
    const counts = countDelimiters(line)
    paren += counts.paren
    bracket += counts.bracket
    brace += counts.brace
    if (paren === 0 && bracket === 0 && brace === 0) break
  }
  if (exprStart < 0) return null
  const expression = lines.slice(exprStart).join('\n').trim().replace(/;+\s*$/, '')
  if (!expression) return null
  if (/^(const|let|var|function|class|if|for|while|switch|try|catch|return|import|export|throw|break|continue|debugger|new\s+Promise)\b/.test(expression)) return null
  if (/^[}\])]\s*$/.test(expression)) return null
  const prefix = lines.slice(0, exprStart).join('\n').replace(/\s+$/, '')
  return { prefix, expression }
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

  const bridge = buildBridgeGlobals(meta)
  sandbox[BRIDGE_SYMBOL as unknown as string] = bridge[BRIDGE_SYMBOL]
  setupBrowserRuntime({ globals: sandbox })

  const context = vm.createContext(sandbox)
  const split = splitFinalExpression(code)
  let script: vm.Script
  if (split) {
    const candidateSource = `(async () => {\n${split.prefix}\nreturn (${split.expression});\n})()`
    try {
      script = new vm.Script(candidateSource, { filename: 'dsh-node-repl.js' })
    } catch {
      script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'dsh-node-repl.js' })
    }
  } else {
    script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'dsh-node-repl.js' })
  }
  const promise = script.runInContext(context) as Promise<unknown>
  const autoValue = await promise

  const value = result !== undefined ? result : sandbox.__dshResult !== undefined ? sandbox.__dshResult : autoValue
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
    'Browser Use only. Run JavaScript in a fresh Node-backed kernel to drive agent.browsers. Top-level await is supported inside the async wrapper; the last expression is returned automatically (or use nodeRepl.write(value) / globalThis.__dshResult = value to return explicitly).',
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
