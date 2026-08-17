import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BrowserManager } from './browser.js'
import type { BrowserUseConfig } from './config.js'
import { isAllowedUrl } from './guard.js'
import { clickRef, fillRef, selectRef } from './refs.js'
import { snapshotPage } from './snapshot.js'

function jsonOutput() {
  return {
    schema: { type: 'json' as const },
    render: (_args: Record<string, unknown>, value: unknown) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

function cwdOf(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined {
  return exec.agent?.session?.header?.cwd
}

function resolveWorkspacePath(cwd: string | undefined, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd ?? process.cwd(), p)
}

export function registerBrowserTools(
  ctx: { tools: { register(tool: unknown): void } },
  manager: BrowserManager,
  config: BrowserUseConfig,
): void {
  const register = (tool: ReturnType<typeof defineTool>) => ctx.tools.register(tool)

  register(defineTool({
    name: 'browser_open',
    description: '打开（或复用）浏览器并可选导航到 URL。首次调用会启动持久浏览器；之后所有 browser_* 工具共享同一实例和标签页。',
    parameters: {
      url: { type: 'string', description: '要打开的 URL（可选；省略则打开空白页）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      await manager.ensure()
      if (args.url) {
        const check = isAllowedUrl(args.url, config)
        if (!check.ok) throw new Error(check.reason)
        await manager.newTab(check.url)
      }
      const state = await manager.state()
      return state
    },
  }))

  register(defineTool({
    name: 'browser_navigate',
    description: '让当前标签页导航到指定 URL，并等待页面加载。',
    parameters: {
      url: { type: 'string', required: true, description: 'http/https URL' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const check = isAllowedUrl(args.url, config)
      if (!check.ok) throw new Error(check.reason)
      const page = await manager.navigate(check.url)
      return { url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_click',
    description: '点击页面元素。可用 ref（browser_snapshot 返回的 e1/e2/...）或 CSS selector。',
    parameters: {
      ref: { type: 'string', description: 'browser_snapshot 返回的交互元素编号，如 e1' },
      selector: { type: 'string', description: 'CSS 选择器' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      if (args.ref) {
        await clickRef(page, args.ref)
      } else if (args.selector) {
        await page.click(args.selector)
      } else {
        throw new Error('browser_click 需要 ref 或 selector')
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      return { url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_type',
    description: '向输入框输入文本。可用 ref 或 selector；submit=true 时输入后按 Enter。',
    parameters: {
      ref: { type: 'string', description: '交互元素编号，如 e1' },
      selector: { type: 'string', description: 'CSS 选择器' },
      text: { type: 'string', required: true, description: '要输入的文本' },
      submit: { type: 'boolean', description: '输入后按 Enter（默认 false）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      if (args.ref) {
        await fillRef(page, args.ref, args.text)
      } else if (args.selector) {
        await page.fill(args.selector, args.text)
      } else {
        throw new Error('browser_type 需要 ref 或 selector')
      }
      if (args.submit) await page.keyboard.press('Enter')
      return { ok: true, url: page.url() }
    },
  }))

  register(defineTool({
    name: 'browser_press',
    description: '在当前页面按下键盘按键，如 Enter、Tab、Escape、ArrowDown。',
    parameters: {
      key: { type: 'string', required: true, description: '按键名（Playwright Keyboard.key 格式）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      await page.keyboard.press(args.key)
      return { ok: true }
    },
  }))

  register(defineTool({
    name: 'browser_select',
    description: '在 <select> 下拉框中选择选项。可用 ref 或 selector；values 传 option 的 value 或显示文本。',
    parameters: {
      ref: { type: 'string', description: '交互元素编号，如 e1' },
      selector: { type: 'string', description: 'CSS 选择器' },
      values: { type: 'array', items: { type: 'string' }, required: true, description: '要选中的选项值或文本' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      let selected: string[]
      if (args.ref) {
        selected = await selectRef(page, args.ref, args.values)
      } else if (args.selector) {
        selected = await page.selectOption(args.selector, args.values)
      } else {
        throw new Error('browser_select 需要 ref 或 selector')
      }
      return { ok: true, selected }
    },
  }))

  register(defineTool({
    name: 'browser_scroll',
    description: '滚动当前页面。direction 支持 down/up/left/right/top/bottom；amount 为像素（默认 800）。',
    parameters: {
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right', 'top', 'bottom'], description: '滚动方向（默认 down）' },
      amount: { type: 'integer', description: '滚动像素（默认 800）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      const direction = args.direction ?? 'down'
      const amount = args.amount ?? 800
      if (direction === 'top' || direction === 'bottom') {
        await page.evaluate((dir) => {
          window.scrollTo({ top: dir === 'top' ? 0 : document.body.scrollHeight, behavior: 'instant' })
        }, direction)
      } else {
        const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
        const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
        await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy })
      }
      const pos = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      return { ...pos, atBoundary: pos.y <= 0 || pos.y >= (await page.evaluate(() => document.body.scrollHeight - window.innerHeight)) }
    },
  }))

  register(defineTool({
    name: 'browser_snapshot',
    description: '读取当前页面的结构化快照：URL、标题、可见文本、可交互元素编号列表（ref）。用 ref 操作比手写 CSS 更稳。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      const page = await manager.page()
      return snapshotPage(page)
    },
  }))

  register(defineTool({
    name: 'browser_get_text',
    description: '读取页面可见文本（可选 selector 限定首个匹配元素；省略则读取整页）。',
    parameters: {
      selector: { type: 'string', description: 'CSS 选择器（可选）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      if (args.selector) {
        const locator = page.locator(args.selector).first()
        const found = await locator.count().then((n) => n > 0)
        const text = found ? (await locator.innerText()) : ''
        return { text, found }
      }
      const text = await page.evaluate(() => document.body?.innerText ?? '')
      return { text, found: true }
    },
  }))

  register(defineTool({
    name: 'browser_get_html',
    description: '读取当前页面（或 selector 匹配元素）的 outerHTML。',
    parameters: {
      selector: { type: 'string', description: 'CSS 选择器（可选，省略则返回 document.documentElement.outerHTML）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.page()
      if (args.selector) {
        const locator = page.locator(args.selector).first()
        const found = await locator.count().then((n) => n > 0)
        const html = found ? (await locator.evaluate((el) => el.outerHTML)) : ''
        return { html, found }
      }
      const html = await page.evaluate(() => document.documentElement.outerHTML)
      return { html, found: true }
    },
  }))

  register(defineTool({
    name: 'browser_screenshot',
    description: '把当前页面截图保存到工作区（默认 <cwd>/browser-screenshots/<时间戳>.png）。可用 read_image 查看。',
    parameters: {
      path: { type: 'string', description: '输出 PNG 路径（绝对或相对工作区）' },
      fullPage: { type: 'boolean', description: '是否截整页（默认 false）' },
    },
    output: jsonOutput(),
    async execute(args, exec): Promise<any> {
      const page = await manager.page()
      const cwd = cwdOf(exec)
      let target: string
      if (args.path) {
        target = resolveWorkspacePath(cwd, args.path)
      } else {
        const dir = resolveWorkspacePath(cwd, config.screenshotDir)
        mkdirSync(dir, { recursive: true })
        target = join(dir, `shot-${Date.now()}.png`)
      }
      await page.screenshot({ path: target, fullPage: args.fullPage === true })
      const viewport = page.viewportSize()
      return { path: target, width: viewport?.width ?? 0, height: viewport?.height ?? 0 }
    },
  }))

  register(defineTool({
    name: 'browser_wait',
    description: '等待指定毫秒（用于慢页面/懒加载）。',
    parameters: {
      ms: { type: 'integer', required: true, description: '等待毫秒数（<=30000）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const ms = Math.min(Math.max(0, args.ms), 30_000)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
      return { waitedMs: ms }
    },
  }))

  register(defineTool({
    name: 'browser_back',
    description: '当前标签页后退。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      const page = await manager.page()
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
      return { url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_forward',
    description: '当前标签页前进。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      const page = await manager.page()
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {})
      return { url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_reload',
    description: '重新加载当前标签页。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      const page = await manager.page()
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      return { url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_new_tab',
    description: '新开一个标签页，可选导航到 URL。',
    parameters: {
      url: { type: 'string', description: '要打开的 URL（可选）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      let url: string | undefined
      if (args.url) {
        const check = isAllowedUrl(args.url, config)
        if (!check.ok) throw new Error(check.reason)
        url = check.url
      }
      const page = await manager.newTab(url)
      return { index: (await manager.state()).activeIndex, url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_switch_tab',
    description: '切换到指定索引的标签页（从 0 开始）。',
    parameters: {
      index: { type: 'integer', required: true, description: '标签页索引' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      const page = await manager.switchTab(args.index)
      return { index: args.index, url: page.url(), title: await page.title() }
    },
  }))

  register(defineTool({
    name: 'browser_close_tab',
    description: '关闭指定索引的标签页（默认当前页）。',
    parameters: {
      index: { type: 'integer', description: '标签页索引（默认当前）' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      await manager.closeTab(args.index)
      return { ok: true, tabs: (await manager.state()).tabs }
    },
  }))

  register(defineTool({
    name: 'browser_list_tabs',
    description: '列出当前所有标签页。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      const state = await manager.state()
      return state
    },
  }))

  register(defineTool({
    name: 'browser_resize',
    description: '调整当前页面视口尺寸（如 375x812 测移动端）。',
    parameters: {
      width: { type: 'integer', required: true, description: '宽度 px' },
      height: { type: 'integer', required: true, description: '高度 px' },
    },
    output: jsonOutput(),
    async execute(args): Promise<any> {
      await manager.setViewport(args.width, args.height)
      const page = await manager.page()
      const viewport = page.viewportSize()
      return { width: viewport?.width ?? args.width, height: viewport?.height ?? args.height }
    },
  }))

  register(defineTool({
    name: 'browser_close',
    description: '关闭整个浏览器（下次任意 browser_* 工具会自动重新打开；持久登录态保留）。',
    parameters: {},
    output: jsonOutput(),
    async execute(): Promise<any> {
      await manager.close()
      return { ok: true }
    },
  }))

  if (config.allowEval) {
    register(defineTool({
      name: 'browser_eval',
      description: '在页面执行 JavaScript 表达式并返回 JSON 化结果。高风险，默认关闭；开启前请确认页面可信。',
      parameters: {
        expression: { type: 'string', required: true, description: 'JS 表达式或函数体' },
      },
      output: jsonOutput(),
      async execute(args): Promise<any> {
        const page = await manager.page()
        const result = await page.evaluate((expr) => {
          // eslint-disable-next-line no-new-func
          return Function(`"use strict"; return (${expr})`)()
        }, args.expression)
        return result
      },
    }))
  }
}
