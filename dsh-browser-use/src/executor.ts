import type { Page } from 'playwright-core'
import type { BrowserManager, TabInfo } from './browser.js'
import type { BrowserUseConfig } from './config.js'
import { isAllowedUrl } from './guard.js'
import { clickRef, fillRef, selectRef } from './refs.js'
import { snapshotPage } from './snapshot.js'
import {
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserTabSummary,
  errResult,
  okResult,
} from './protocol.js'

const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

function tabSummary(tab: TabInfo): BrowserTabSummary {
  return {
    tabId: tab.tabId ?? `tab:${tab.index + 1}`,
    ...(tab.url ? { url: tab.url } : {}),
    ...(tab.title ? { title: tab.title } : {}),
    viewport: DEFAULT_VIEWPORT,
  }
}

async function stateFor(page: Page): Promise<{ url: string; title: string; viewport: { width: number; height: number } }> {
  const viewport = page.viewportSize()
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    viewport: viewport ? { width: viewport.width, height: viewport.height } : DEFAULT_VIEWPORT,
  }
}

async function pageFor(manager: BrowserManager, command: BrowserCommand): Promise<Page> {
  const tabId = 'tabId' in command ? command.tabId : undefined
  if (tabId) {
    try {
      return await manager.activateTabById(tabId)
    } catch {
      return manager.page()
    }
  }
  return manager.page()
}

async function runPlaywright(
  config: BrowserUseConfig,
  page: Page,
  action: NonNullable<Extract<BrowserCommand, { method: 'playwright' }>['action']>,
  elapsed: number,
): Promise<BrowserCommandResult> {
  switch (action.name) {
    case 'domSnapshot': {
      const snapshot = await snapshotPage(page)
      return okResult({ snapshot: { ...snapshot, refs: snapshot.refs } }, Date.now() - elapsed)
    }
    case 'evaluate': {
      if (!config.allowEval) {
        return errResult('capability_unsupported', 'playwright.evaluate is read-only and disabled by default', Date.now() - elapsed)
      }
      const value = await page.evaluate(action.expression, action.arg as never)
      return okResult({ value }, Date.now() - elapsed)
    }
    case 'waitForLoadState': {
      await page.waitForLoadState((action.state as 'load' | 'domcontentloaded' | 'networkidle') ?? 'load', {
        timeout: action.timeoutMs ?? 3000,
      }).catch(() => {})
      return okResult({}, Date.now() - elapsed)
    }
    case 'waitForURL': {
      await page.waitForURL(action.url, { timeout: action.timeoutMs ?? 3000, waitUntil: action.waitUntil as never }).catch(() => {})
      return okResult({}, Date.now() - elapsed)
    }
    case 'locator': {
      return runLocator(page, action, elapsed)
    }
    default:
      return errResult('capability_unsupported', `playwright.${(action as { name: string }).name} is not supported`, Date.now() - elapsed)
  }
}

async function runLocator(
  page: Page,
  action: { name: 'locator'; selector: string; operation: string; [key: string]: unknown },
  elapsed: number,
): Promise<BrowserCommandResult> {
  const locator = page.locator(action.selector as string)
  const operation = action.operation as string
  try {
    switch (operation) {
      case 'count':
        return okResult({ value: await locator.count() }, Date.now() - elapsed)
      case 'click':
        await locator.click({ button: (action.button as 'left' | 'right' | 'middle') ?? 'left' })
        return okResult({}, Date.now() - elapsed)
      case 'dblclick':
        await locator.dblclick()
        return okResult({}, Date.now() - elapsed)
      case 'fill':
        await locator.fill(String(action.value ?? ''))
        return okResult({}, Date.now() - elapsed)
      case 'press':
        await locator.press(String(action.value ?? ''))
        return okResult({}, Date.now() - elapsed)
      case 'selectOption':
        await locator.selectOption(action.selections as string | string[] | Array<{ value?: string; label?: string; index?: number }>)
        return okResult({}, Date.now() - elapsed)
      case 'check':
        await locator.check()
        return okResult({}, Date.now() - elapsed)
      case 'uncheck':
        await locator.uncheck()
        return okResult({}, Date.now() - elapsed)
      case 'setChecked':
        await locator.setChecked(Boolean(action.checked))
        return okResult({}, Date.now() - elapsed)
      case 'textContent':
        return okResult({ value: await locator.textContent() }, Date.now() - elapsed)
      case 'innerText':
        return okResult({ value: await locator.innerText() }, Date.now() - elapsed)
      case 'getAttribute':
        return okResult({ value: await locator.getAttribute(String(action.attribute ?? '')) }, Date.now() - elapsed)
      case 'isVisible':
        return okResult({ value: await locator.isVisible() }, Date.now() - elapsed)
      case 'isEnabled':
        return okResult({ value: await locator.isEnabled() }, Date.now() - elapsed)
      case 'waitFor':
        await locator.waitFor({ state: (action.state as 'attached' | 'detached' | 'visible' | 'hidden') ?? 'visible', timeout: (action.timeoutMs as number) ?? 3000 })
        return okResult({}, Date.now() - elapsed)
      case 'allTextContents':
        return okResult({ value: await locator.allTextContents() }, Date.now() - elapsed)
      default:
        return errResult('capability_unsupported', `locator.${operation} is not supported`, Date.now() - elapsed)
    }
  } catch (error) {
    return errResult('execution_error', error instanceof Error ? error.message : String(error), Date.now() - elapsed)
  }
}

export async function executeBrowserCommand(
  manager: BrowserManager,
  config: BrowserUseConfig,
  command: BrowserCommand,
): Promise<BrowserCommandResult> {
  const elapsed = Date.now()
  try {
    switch (command.method) {
      case 'list': {
        const tabs = await manager.listControlledTabs()
        return okResult({ tabs: tabs.map(tabSummary) }, Date.now() - elapsed)
      }
      case 'listUserTabs': {
        const tabs = await manager.listUserTabs()
        return okResult({ userTabs: tabs.map((t) => ({ id: t.tabId ?? `tab:${t.index + 1}`, ...(t.url ? { url: t.url } : {}), ...(t.title ? { title: t.title } : {}) })) }, Date.now() - elapsed)
      }
      case 'newTab': {
        let url: string | undefined
        if (command.url) {
          const check = isAllowedUrl(command.url, config)
          if (!check.ok) return errResult('navigation_blocked', check.reason, Date.now() - elapsed)
          url = check.url
        }
        const page = await manager.newTab(url)
        const tabId = manager.tabIdOf(page)
        const tabs = await manager.listControlledTabs()
        const tab = tabs.find((t) => t.tabId === tabId) ?? tabs.at(-1)
        return okResult({ ...(tab ? { tab: tabSummary(tab) } : {}), tabs: tabs.map(tabSummary), state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'activateTab': {
        const page = await manager.activateTabById(command.tabId)
        const tabs = await manager.listControlledTabs()
        const activated = tabs.find((t) => t.tabId === command.tabId)
        return okResult({ ...(activated ? { tab: tabSummary(activated) } : {}), tabs: tabs.map(tabSummary), state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'claimTab': {
        const page = await manager.claimUserTab(command.tabId)
        const tabs = await manager.listControlledTabs()
        const claimed = tabs.find((t) => t.tabId === command.tabId)
        return okResult({ ...(claimed ? { tab: tabSummary(claimed) } : {}), tabs: tabs.map(tabSummary), state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'close': {
        if (command.tabId) await manager.closeTabById(command.tabId)
        else await manager.closeTab()
        const tabs = await manager.listControlledTabs()
        return okResult({ tabs: tabs.map(tabSummary) }, Date.now() - elapsed)
      }
      case 'navigate': {
        const check = isAllowedUrl(command.url, config)
        if (!check.ok) return errResult('navigation_blocked', check.reason, Date.now() - elapsed)
        const page = await manager.navigate(check.url)
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'getState': {
        const page = await pageFor(manager, command)
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'back': {
        const page = await pageFor(manager, command)
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'forward': {
        const page = await pageFor(manager, command)
        await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {})
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'reload': {
        const page = await pageFor(manager, command)
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'snapshot': {
        const page = await pageFor(manager, command)
        const snapshot = await snapshotPage(page)
        return okResult({ snapshot }, Date.now() - elapsed)
      }
      case 'screenshot': {
        const page = await pageFor(manager, command)
        const png = command.fullPage
          ? await page.screenshot({ type: 'png', fullPage: true })
          : await page.screenshot({ type: 'png', ...(command.clip ? { clip: command.clip } : {}) })
        return okResult({ image: { base64: png.toString('base64'), mimeType: 'image/png' } }, Date.now() - elapsed)
      }
      case 'click': {
        const page = await pageFor(manager, command)
        if (command.ref) {
          await clickRef(page, command.ref)
        } else if (command.selector) {
          await page.click(command.selector)
        } else if (command.x !== undefined && command.y !== undefined) {
          await page.mouse.click(command.x, command.y)
        } else {
          return errResult('execution_error', 'click 需要 ref / selector / x+y', Date.now() - elapsed)
        }
        await page.waitForLoadState('domcontentloaded').catch(() => {})
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'type': {
        const page = await pageFor(manager, command)
        if (command.ref) {
          await fillRef(page, command.ref, command.text)
        } else if (command.selector) {
          await page.fill(command.selector, command.text)
        } else {
          await page.keyboard.type(command.text)
        }
        if (command.submit) await page.keyboard.press('Enter')
        return okResult({ state: await stateFor(page) }, Date.now() - elapsed)
      }
      case 'press': {
        const page = await pageFor(manager, command)
        if (command.ref) {
          await page.locator(`[data-dsh-ref="${command.ref}"]`).press(command.key).catch(() => page.keyboard.press(command.key))
        } else {
          await page.keyboard.press(command.key)
        }
        return okResult({}, Date.now() - elapsed)
      }
      case 'scroll': {
        const page = await pageFor(manager, command)
        if (command.x !== undefined && command.y !== undefined) {
          await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: command.x, y: command.y })
        } else {
          const direction = command.direction ?? 'down'
          const amount = command.amount ?? 800
          if (direction === 'top' || direction === 'bottom') {
            await page.evaluate((dir) => window.scrollTo({ top: dir === 'top' ? 0 : document.body.scrollHeight, behavior: 'instant' }), direction)
          } else {
            const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
            const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
            await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy })
          }
        }
        return okResult({}, Date.now() - elapsed)
      }
      case 'select': {
        const page = await pageFor(manager, command)
        if (command.ref) {
          const selected = await selectRef(page, command.ref, command.values)
          return okResult({ value: selected }, Date.now() - elapsed)
        }
        if (command.selector) {
          const selected = await page.selectOption(command.selector, command.values)
          return okResult({ value: selected }, Date.now() - elapsed)
        }
        return errResult('execution_error', 'select 需要 ref 或 selector', Date.now() - elapsed)
      }
      case 'check': {
        const page = await pageFor(manager, command)
        if (command.selector) {
          await page.locator(command.selector).setChecked(command.checked ?? true)
        } else if (command.ref) {
          await page.locator(`[data-dsh-ref="${command.ref}"]`).setChecked(command.checked ?? true).catch(() => { throw new Error(`ref ${command.ref} 不可勾选`) })
        } else {
          return errResult('execution_error', 'check 需要 ref 或 selector', Date.now() - elapsed)
        }
        return okResult({}, Date.now() - elapsed)
      }
      case 'hover': {
        const page = await pageFor(manager, command)
        if (command.ref) {
          await page.locator(`[data-dsh-ref="${command.ref}"]`).hover().catch(() => { throw new Error(`ref ${command.ref} 不可 hover`) })
        } else if (command.x !== undefined && command.y !== undefined) {
          await page.mouse.move(command.x, command.y)
        } else {
          return errResult('execution_error', 'hover 需要 ref 或 x/y', Date.now() - elapsed)
        }
        return okResult({}, Date.now() - elapsed)
      }
      case 'drag': {
        const page = await pageFor(manager, command)
        const resolvePoint = async (ref: string | undefined, point: { x: number; y: number } | undefined) => {
          if (ref) {
            const box = await page.locator(`[data-dsh-ref="${ref}"]`).boundingBox().catch(() => null)
            return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined
          }
          return point
        }
        const from = await resolvePoint(command.fromRef, command.from)
        const to = await resolvePoint(command.toRef, command.to)
        if (!from || !to) return errResult('execution_error', 'drag 需要有效的起点/终点', Date.now() - elapsed)
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 8 })
        await page.mouse.up()
        return okResult({}, Date.now() - elapsed)
      }
      case 'browserViewportSet': {
        await manager.setViewport(command.width, command.height)
        return okResult({}, Date.now() - elapsed)
      }
      case 'browserViewportReset': {
        const page = await pageFor(manager, command)
        await page.setViewportSize({ width: 1280, height: 720 })
        return okResult({}, Date.now() - elapsed)
      }
      case 'playwright': {
        const page = await pageFor(manager, command)
        return runPlaywright(config, page, command.action, elapsed)
      }
      case 'playwrightWaitForTimeout': {
        await new Promise((resolve) => setTimeout(resolve, Math.min(command.timeoutMs, 30_000)))
        return okResult({}, Date.now() - elapsed)
      }
      case 'nameSession':
        return okResult({}, Date.now() - elapsed)
      case 'finalizeTabs':
        return okResult({}, Date.now() - elapsed)
      case 'cancelRequest':
        return okResult({}, Date.now() - elapsed)
      case 'turnEnded':
        return okResult({}, Date.now() - elapsed)
      case 'closeSession':
        return okResult({}, Date.now() - elapsed)
      default:
        return errResult('capability_unsupported', `command ${(command as { method: string }).method} is not supported`, Date.now() - elapsed)
    }
  } catch (error) {
    return errResult('execution_error', error instanceof Error ? error.message : String(error), Date.now() - elapsed)
  }
}
