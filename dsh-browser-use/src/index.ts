import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { BrowserManager, defaultProfileDir } from './browser.js'
import { startBroker } from './broker.js'
import { Config, type BrowserUseConfig } from './config.js'
import { startExtensionServer } from './extension/server.js'
import { registerBrowserHttp } from './http.js'
import { startNodeReplBridge } from './mcp-host.js'
import { registerBrowserTools } from './tools.js'

export const name = 'dsh-browser-use'
export const inject = ['tools', 'webServer']

export { Config }
export type { BrowserUseConfig }

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

/** 浏览器任务识别：只用于“把 browser_* 工具补回工具目录”，不修改任何 router 模式，也不注入 system prompt。 */
const BROWSER_TASK_RE = /(浏览器|browser|打开\s*(网页|页面|网站|https?:\/\/)|点击|填表|截图|走查|网页|页面|深色模式|dark mode|ui|界面)/i

function loadSkill(name: string): { name: string; description: string; content: string } | undefined {
  try {
    const content = readFileSync(join(packageRoot, 'skills', name, 'SKILL.md'), 'utf8')
    const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
    return { name, description, content }
  } catch {
    return undefined
  }
}

function extractText(data: { content?: Array<{ type?: string; text?: string }> }): string {
  if (!Array.isArray(data.content)) return ''
  return data.content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ')
}

export function apply(ctx: Context, config: BrowserUseConfig): void {
  const manager = new BrowserManager(config, defaultProfileDir())

  // 关闭浏览器时随插件卸载回收。
  ctx.effect(() => () => {
    void manager.close()
  })

  registerBrowserTools(ctx as never, manager, config)
  registerBrowserHttp(ctx as never, manager, config)

  // Codex/ZCode 式 Browser Use broker：node_repl MCP server 通过 Unix socket
  // 把 browser 命令路由回本插件共享的 BrowserManager。插件同时自带一个轻量
  // MCP 客户端，把 node_repl 的 js/js_reset/js_add_node_module_dir 注册成
  // mcp__node_repl__* 工具，无需额外安装 dsh-mcp-client。
  if (config.enableMcpBridge) {
    ctx.effect(() => {
      let disposed = false
      let closeBridge: (() => void) | undefined
      void (async () => {
        try {
          const extensionServer = await startExtensionServer(ctx.webServer as never)
          if (disposed) {
            void extensionServer.close()
            return
          }
          const broker = await startBroker(manager, config, extensionServer.backend)
          if (disposed) {
            void extensionServer.close().then(() => broker.close())
            return
          }
          process.env.DSH_BROWSER_USE_BROKER_SOCKET = broker.socketPath
          process.env.DSH_BROWSER_USE_BROKER_TOKEN = broker.token
          process.env.DSH_BROWSER_USE_ROOT = packageRoot
          ctx.logger?.info?.(`[dsh-browser-use] broker ready at ${broker.socketPath}`)
          const bridge = await startNodeReplBridge(ctx.tools as never, broker, packageRoot)
          if (disposed) {
            void bridge.close().then(() => extensionServer.close()).then(() => broker.close())
            return
          }
          closeBridge = () => {
            void bridge.close().then(() => extensionServer.close()).then(() => broker.close())
            delete process.env.DSH_BROWSER_USE_BROKER_SOCKET
            delete process.env.DSH_BROWSER_USE_BROKER_TOKEN
          }
        } catch (error) {
          ctx.logger?.warn?.('[dsh-browser-use] node_repl MCP bridge failed to start', error)
        }
      })()
      return () => {
        disposed = true
        closeBridge?.()
      }
    })
  }

  // 技能注册（可选 service：headless/无 skill 场景不阻塞）。
  const contextAny = ctx as unknown as { get?: (key: string) => { register?: (skill: {
    name: string
    description: string
    content: string
    source: string
  }) => () => void } | undefined }
  const skillService = contextAny.get?.call(ctx, 'skills')
  if (skillService?.register) {
    const disposers: Array<() => void> = []
    for (const skillName of ['browser-drive', 'browser-walkthrough', 'control-browser']) {
      const skill = loadSkill(skillName)
      if (skill) disposers.push(skillService.register({ ...skill, source: 'bundled' }))
    }
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    })
  }

  // ── 与 router-bootstrap 兼容的“工具可见性”补丁 ─────────────────────────────
  // 不动 router 的模式、不往 system prompt 塞东西；只在装配阶段把 browser_*
  // 工具补回 tools 列表。这样首轮即使被 router-bootstrap 过滤成最小目录，
  // 浏览器任务仍能看到 browser_* 工具；非浏览器任务保持原样。
  //
  // 关键：必须用 `prepend: true` 注册为 system-prompt/assemble 的**最外层**
  // 监听。waterfall 的语义是“先注册的在外层，后注册的在内层”；router-bootstrap
  // 在 preset 作用域先注册，若本插件不加 prepend，就会成为内层，先于 router
  // 看到完整 tools，router 随后仍会把 browser_* 过滤掉。prepend 后本插件先
  // 调用 next() 让 router 过滤，再在返回结果上把 browser_* 补回，并且按原始
  // toolOrder（`assembly.tools`）放在列表最前。
  const firstUserText = new Map<string, string>()

  ctx.effect(() => (ctx as any).on('session/event', (session: any, event: any) => {
    if (event.type !== 'user/message') return
    const data = event.data ?? {}
    if (data.source?.kind !== 'user') return
    const text = extractText(data)
    if (!firstUserText.has(session.id) && text.trim()) {
      firstUserText.set(session.id, text.trim())
    }
  }))

  ctx.effect(() => (ctx as any).on('system-prompt/assemble', async (assembly: any, assembleContext: any, next: any) => {
    const assembled = await next()
    const session = assembleContext?.agent?.session
    const sessionId = session?.id
    if (sessionId === undefined) return assembled

    // 优先用 session/event 捕获的首条用户消息；若首次装配早于事件落盘，直接从 session.events 兜底。
    let firstText = firstUserText.get(sessionId) ?? ''
    if (!firstText && Array.isArray(session?.events)) {
      const firstUserEvent = session.events.find((event: any) =>
        event.type === 'user/message' && event.data?.source?.kind === 'user',
      )
      if (firstUserEvent) firstText = extractText(firstUserEvent.data ?? {})
    }
    if (!BROWSER_TASK_RE.test(firstText)) return assembled

    // assembly 是 router 过滤前的完整 tools 列表（已经过 toolOrder 排序），
    // 从这里取 browser_* 才能保持 toolOrder 的“browser 工具最前”顺序。
    const fullTools: Array<{ name: string; description?: string; parameters?: unknown }> = Array.isArray(assembly?.tools) ? assembly.tools : []
    const browserSchemas = fullTools.filter((tool) => typeof tool.name === 'string' && tool.name.startsWith('browser_'))
    if (browserSchemas.length === 0) return assembled

    const existing = new Set(assembled.tools.map((tool: any) => tool.name))
    const missing = browserSchemas.filter((tool) => !existing.has(tool.name))
    if (missing.length === 0) return assembled

    // 把 browser_* 放到最前（匹配 profile 的 toolOrder），其余保持 router 过滤后的顺序。
    return {
      ...assembled,
      tools: [...missing, ...assembled.tools],
    }
  }, { prepend: true }))

  ctx.logger?.info?.('[dsh-browser-use] 已启动（工具 + /browser-use API + 浏览器视图）')
}
