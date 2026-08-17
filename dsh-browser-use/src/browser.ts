import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import type { BrowserUseConfig } from './config.js'

export interface TabInfo {
  index: number
  tabId?: string
  url: string
  title: string
}

export interface BrowserState {
  open: boolean
  tabs: TabInfo[]
  activeIndex: number
  viewport: { width: number; height: number } | null
  headless: boolean
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe') : '',
  process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe') : '',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
].filter(Boolean)

export function findSystemBrowser(): string | undefined {
  const env = process.env.DSH_BROWSER_USE_CHROME
  if (env) return env
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // ignore per-candidate probe errors
    }
  }
  return undefined
}

export class BrowserManager {
  private context: BrowserContext | undefined
  private activeIndex = 0
  private nextTabId = 0
  private readonly pageIds = new Map<Page, string>()
  private readonly agentPages = new Set<Page>()

  constructor(
    private readonly config: BrowserUseConfig,
    private readonly defaultUserDataDir: string,
  ) {}

  get isOpen(): boolean {
    return this.context !== undefined
  }

  private applyPageDefaults(page: Page): void {
    page.setDefaultTimeout(this.config.actionTimeoutMs)
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
  }

  private idOf(page: Page): string {
    const existing = this.pageIds.get(page)
    if (existing) return existing
    const id = `tab:${++this.nextTabId}`
    this.pageIds.set(page, id)
    return id
  }

  /** 返回页面稳定 tabId（不存在时分配）。 */
  tabIdOf(page: Page): string {
    return this.idOf(page)
  }

  private markAgent(page: Page): string {
    this.agentPages.add(page)
    return this.idOf(page)
  }

  private async tabInfo(page: Page, index: number): Promise<TabInfo> {
    return {
      index,
      tabId: this.idOf(page),
      url: page.url(),
      title: await page.title().catch(() => ''),
    }
  }

  private pages(): Page[] {
    if (!this.context) return []
    return this.context.pages()
  }

  private findPageByTabId(tabId: string): Page | undefined {
    for (const [page, id] of this.pageIds) {
      if (id === tabId) return page
    }
    return undefined
  }

  async ensure(): Promise<BrowserContext> {
    if (this.context) return this.context
    const userDataDir = this.config.userDataDir || this.defaultUserDataDir
    mkdirSync(userDataDir, { recursive: true })

    const executablePath = this.config.executablePath || findSystemBrowser()
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: this.config.headless,
      viewport: this.config.viewport,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    }
    if (executablePath) {
      launchOptions.executablePath = executablePath
    } else if (this.config.channel) {
      launchOptions.channel = this.config.channel
    } else {
      // Playwright's bundled chromium may not be installed; prefer a system
      // browser channel when no explicit executable was found.
      launchOptions.channel = 'chrome'
    }

    try {
      this.context = await chromium.launchPersistentContext(userDataDir, launchOptions)
    } catch (error) {
      this.context = undefined
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `浏览器启动失败: ${detail}。请安装 Chrome/Edge，或在配置里设置 executablePath/channel。`,
      )
    }

    for (const page of this.context.pages()) this.applyPageDefaults(page)
    if (this.context.pages().length === 0) {
      const page = await this.context.newPage()
      this.applyPageDefaults(page)
      this.markAgent(page)
    }
    this.activeIndex = 0
    return this.context
  }

  async page(): Promise<Page> {
    const ctx = await this.ensure()
    const pages = ctx.pages()
    if (pages.length === 0) {
      const page = await ctx.newPage()
      this.applyPageDefaults(page)
      this.markAgent(page)
      this.activeIndex = 0
      return page
    }
    if (this.activeIndex >= pages.length) this.activeIndex = pages.length - 1
    const page = pages[this.activeIndex]
    if (!page) throw new Error('浏览器当前标签页不可用')
    return page
  }

  async newTab(url?: string): Promise<Page> {
    const ctx = await this.ensure()
    const page = await ctx.newPage()
    this.applyPageDefaults(page)
    this.markAgent(page)
    this.activeIndex = ctx.pages().length - 1
    if (url) await page.goto(url, { timeout: this.config.navigationTimeoutMs })
    return page
  }

  /** 列出 Agent 已控制（自己打开或已认领）的标签页。 */
  async listControlledTabs(): Promise<TabInfo[]> {
    const pages = this.pages()
    const result: TabInfo[] = []
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i]!
      if (this.agentPages.has(page)) result.push(await this.tabInfo(page, i))
    }
    return result
  }

  /** 列出用户手动打开、尚未被 Agent 认领的标签页。 */
  async listUserTabs(): Promise<TabInfo[]> {
    const pages = this.pages()
    const result: TabInfo[] = []
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i]!
      if (!this.agentPages.has(page)) result.push(await this.tabInfo(page, i))
    }
    return result
  }

  /** 认领一个用户标签页，使其进入 Agent 控制列表。 */
  async claimUserTab(tabId: string): Promise<Page> {
    const page = this.findPageByTabId(tabId)
    if (!page) throw new Error(`用户标签页不存在: ${tabId}`)
    this.markAgent(page)
    const index = this.pages().indexOf(page)
    if (index >= 0) this.activeIndex = index
    return page
  }

  /** 按 tabId 取 Page；找不到时回退到当前活动页。 */
  async pageByTabId(tabId?: string): Promise<Page> {
    if (tabId) {
      const page = this.findPageByTabId(tabId)
      if (page) return page
    }
    return this.page()
  }

  private indexOfTabId(tabId: string): number {
    const page = this.findPageByTabId(tabId)
    if (!page) return -1
    return this.pages().indexOf(page)
  }

  /** 按 tabId 激活标签页，返回该页。 */
  async activateTabById(tabId: string): Promise<Page> {
    const page = this.findPageByTabId(tabId)
    if (!page) throw new Error(`标签页不存在: ${tabId}`)
    const index = this.pages().indexOf(page)
    if (index < 0) throw new Error(`标签页不可用: ${tabId}`)
    this.activeIndex = index
    return page
  }

  /** 按 tabId 关闭标签页。 */
  async closeTabById(tabId: string): Promise<void> {
    const index = this.indexOfTabId(tabId)
    if (index < 0) throw new Error(`标签页不存在: ${tabId}`)
    await this.closeTab(index)
  }

  async switchTab(index: number): Promise<Page> {
    const ctx = await this.ensure()
    const pages = ctx.pages()
    if (index < 0 || index >= pages.length) throw new Error(`标签页索引越界: ${index}（共 ${pages.length} 个）`)
    this.activeIndex = index
    return pages[index]!
  }

  async closeTab(index?: number): Promise<void> {
    const ctx = await this.ensure()
    const pages = ctx.pages()
    const target = index ?? this.activeIndex
    if (target < 0 || target >= pages.length) throw new Error(`标签页索引越界: ${target}`)
    const page = pages[target]!
    await page.close()
    this.agentPages.delete(page)
    this.pageIds.delete(page)
    if (pages.length <= 1) {
      const fresh = await ctx.newPage()
      this.applyPageDefaults(fresh)
      this.markAgent(fresh)
      this.activeIndex = 0
      return
    }
    if (this.activeIndex >= target && this.activeIndex > 0) this.activeIndex -= 1
    if (this.activeIndex >= ctx.pages().length) this.activeIndex = ctx.pages().length - 1
  }

  async navigate(url: string): Promise<Page> {
    const page = await this.page()
    await page.goto(url, { timeout: this.config.navigationTimeoutMs, waitUntil: 'domcontentloaded' })
    return page
  }

  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.page()
    await page.setViewportSize({ width, height })
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.page()
    return page.screenshot({ type: 'png' })
  }

  async state(): Promise<BrowserState> {
    if (!this.context) return { open: false, tabs: [], activeIndex: 0, viewport: null, headless: this.config.headless }
    try {
      const pages = this.context.pages()
      const tabs: TabInfo[] = []
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i]!
        tabs.push(await this.tabInfo(page, i))
      }
      const active = pages[this.activeIndex]
      const viewport = active ? active.viewportSize() : null
      return {
        open: true,
        tabs,
        activeIndex: this.activeIndex,
        viewport: viewport ? { width: viewport.width, height: viewport.height } : null,
        headless: this.config.headless,
      }
    } catch {
      return { open: false, tabs: [], activeIndex: 0, viewport: null, headless: this.config.headless }
    }
  }

  async close(): Promise<void> {
    if (!this.context) return
    const ctx = this.context
    this.context = undefined
    this.activeIndex = 0
    this.agentPages.clear()
    this.pageIds.clear()
    try {
      await ctx.close()
    } catch {
      // already closed
    }
  }
}

export function defaultProfileDir(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'browser-use', 'profile')
}
