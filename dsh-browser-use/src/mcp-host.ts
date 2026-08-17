import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BrowserBroker } from './broker.js'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

class McpClient {
  private child: ChildProcess
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()

  constructor(child: ChildProcess) {
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const raw = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (!raw.trim()) continue
        try {
          const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } }
          if (message.id !== undefined) {
            const pending = this.pending.get(message.id)
            if (!pending) continue
            this.pending.delete(message.id)
            if (message.error) pending.reject(new Error(message.error.message ?? 'MCP error'))
            else pending.resolve(message.result)
          }
        } catch {
          // ignore malformed frames
        }
      }
    })
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }> {
    const result = await this.request('tools/call', { name, arguments: args }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    return result
  }
}

export interface NodeReplBridge {
  close(): Promise<void>
}

export async function startNodeReplBridge(
  tools: { register(tool: ToolDefinition): () => void },
  broker: BrowserBroker,
  packageRoot: string,
): Promise<NodeReplBridge> {
  const serverPath = join(packageRoot, 'lib', 'mcp', 'server.js')
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      DSH_BROWSER_USE_BROKER_SOCKET: broker.socketPath,
      DSH_BROWSER_USE_BROKER_TOKEN: broker.token,
      DSH_BROWSER_USE_ROOT: packageRoot,
    },
  })
  const client = new McpClient(child)
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'dsh-browser-use', version: '0.1.0' },
  })
  client.notify('notifications/initialized', {})
  const listResult = await client.request('tools/list', {}) as { tools?: McpTool[] }
  const disposers: Array<() => void> = []
  for (const tool of listResult.tools ?? []) {
    const publicName = `mcp__node_repl__${tool.name}`
    const definition: ToolDefinition = {
      name: publicName,
      description: tool.description ?? `Browser Use MCP tool ${tool.name}`,
      parameters: tool.inputSchema ?? {},
      output: {
        schema: { type: 'string' },
        render: (_args, value: unknown) => [
          { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args: unknown) {
        const result = await client.callTool(tool.name, (args ?? {}) as Record<string, unknown>)
        const text = (result.content ?? [])
          .filter((block) => block.type === 'text' && block.text !== undefined)
          .map((block) => block.text)
          .join('\n')
        if (result.isError) throw new Error(text || `MCP tool ${tool.name} failed`)
        return text
      },
    }
    disposers.push(tools.register(definition))
  }

  let closed = false
  return {
    close: async () => {
      if (closed) return
      closed = true
      for (const dispose of disposers) dispose()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      }
    },
  }
}
