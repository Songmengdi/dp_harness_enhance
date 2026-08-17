import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { BrowserManager } from './browser.js'
import type { BrowserUseConfig } from './config.js'
import { isAllowedUrl } from './guard.js'
import { clickRef, fillRef } from './refs.js'

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, error: message })
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

export function registerBrowserHttp(
  ctx: Context & { webServer: { register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void } },
  manager: BrowserManager,
  config: BrowserUseConfig,
): void {
  const exact = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => ({
    kind: 'exact' as const,
    path,
    handler,
  })

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(exact('/browser-use/state', async (_req, res) => {
        sendJson(res, 200, await manager.state())
      })),

      ctx.webServer.register(exact('/browser-use/screenshot.png', async (_req, res) => {
        if (!manager.isOpen) {
          sendError(res, 409, '浏览器未启动')
          return
        }
        try {
          const png = await manager.screenshot()
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': png.length,
          })
          res.end(png)
        } catch (error) {
          sendError(res, 500, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/navigate', async (req, res) => {
        try {
          const body = await readJson(req)
          const raw = String(body.url ?? '')
          if (!raw) throw new Error('缺少 url')
          const check = isAllowedUrl(raw, config)
          if (!check.ok) throw new Error(check.reason)
          const page = await manager.navigate(check.url)
          sendJson(res, 200, { ok: true, url: page.url(), title: await page.title() })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/click', async (req, res) => {
        try {
          const body = await readJson(req)
          const page = await manager.page()
          if (typeof body.ref === 'string' && body.ref) {
            await clickRef(page, body.ref)
          } else if (typeof body.selector === 'string' && body.selector) {
            await page.click(body.selector)
          } else if (typeof body.x === 'number' && typeof body.y === 'number') {
            await page.mouse.click(body.x, body.y)
          } else {
            throw new Error('需要 ref / selector / x+y')
          }
          await page.waitForLoadState('domcontentloaded').catch(() => {})
          sendJson(res, 200, { ok: true, url: page.url(), title: await page.title() })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/type', async (req, res) => {
        try {
          const body = await readJson(req)
          const text = String(body.text ?? '')
          const page = await manager.page()
          if (typeof body.ref === 'string' && body.ref) {
            await fillRef(page, body.ref, text)
          } else if (typeof body.selector === 'string' && body.selector) {
            await page.fill(body.selector, text)
          } else if (typeof body.x === 'number' && typeof body.y === 'number') {
            await page.mouse.click(body.x, body.y)
            await page.keyboard.type(text)
          } else {
            throw new Error('需要 ref / selector / x+y')
          }
          if (body.submit) await page.keyboard.press('Enter')
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/press', async (req, res) => {
        try {
          const body = await readJson(req)
          const key = String(body.key ?? '')
          if (!key) throw new Error('缺少 key')
          const page = await manager.page()
          await page.keyboard.press(key)
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/scroll', async (req, res) => {
        try {
          const body = await readJson(req)
          const page = await manager.page()
          const dx = Number(body.dx ?? 0)
          const dy = Number(body.dy ?? 0)
          await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy })
          const pos = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
          sendJson(res, 200, { ok: true, ...pos })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/resize', async (req, res) => {
        try {
          const body = await readJson(req)
          const width = Number(body.width)
          const height = Number(body.height)
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) {
            throw new Error('width/height 必须是 >=64 的整数')
          }
          await manager.setViewport(width, height)
          sendJson(res, 200, { ok: true, width, height })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/tab', async (req, res) => {
        try {
          const body = await readJson(req)
          const action = String(body.action ?? '')
          if (action === 'new') {
            let url: string | undefined
            if (body.url) {
              const check = isAllowedUrl(String(body.url), config)
              if (!check.ok) throw new Error(check.reason)
              url = check.url
            }
            await manager.newTab(url)
          } else if (action === 'switch') {
            await manager.switchTab(Number(body.index))
          } else if (action === 'close') {
            await manager.closeTab(body.index === undefined ? undefined : Number(body.index))
          } else {
            throw new Error('action 必须是 new/switch/close')
          }
          sendJson(res, 200, await manager.state())
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/reload', async (_req, res) => {
        try {
          const page = await manager.page()
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
          sendJson(res, 200, { ok: true, url: page.url(), title: await page.title() })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/back', async (_req, res) => {
        try {
          const page = await manager.page()
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
          sendJson(res, 200, { ok: true, url: page.url(), title: await page.title() })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/forward', async (_req, res) => {
        try {
          const page = await manager.page()
          await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {})
          sendJson(res, 200, { ok: true, url: page.url(), title: await page.title() })
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error))
        }
      })),

      ctx.webServer.register(exact('/browser-use/close', async (_req, res) => {
        await manager.close()
        sendJson(res, 200, { ok: true })
      })),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}
