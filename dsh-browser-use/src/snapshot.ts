import type { Page } from 'playwright-core'

export interface SnapshotRef {
  ref: string
  tag: string
  text: string
  type?: string
  value?: string
  href?: string
  role?: string
}

export interface BrowserSnapshot {
  url: string
  title: string
  text: string
  aria: string
  refs: SnapshotRef[]
  truncated: boolean
}

const MAX_TEXT = 20_000
const MAX_REFS = 200

/** 收集页面结构化快照：可见文本 + 可交互元素编号清单（text-only 模型也能稳定操作）。 */
export async function snapshotPage(page: Page): Promise<BrowserSnapshot> {
  const raw = await page.evaluate(() => {
    const refs: Array<{
      ref: string
      tag: string
      text: string
      type?: string
      value?: string
      href?: string
      role?: string
    }> = []
    const seen = new Set<Element>()
    const selector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="menuitem"]',
      'summary',
      '[onclick]',
    ].join(',')
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let count = 0
    for (const el of elements) {
      if (seen.has(el)) continue
      seen.add(el)
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const tag = el.tagName.toLowerCase()
      let text = ''
      if (el instanceof HTMLInputElement) {
        text = el.placeholder || el.name || el.getAttribute('aria-label') || ''
        const sensitive = el.type === 'password' || (el.autocomplete || '').toLowerCase().startsWith('cc-')
        const value = sensitive ? '••••' : el.value
        refs.push({
          ref: `e${++count}`,
          tag,
          text,
          type: el.type || 'text',
          value,
        })
      } else if (el instanceof HTMLTextAreaElement) {
        text = el.placeholder || el.name || el.getAttribute('aria-label') || ''
        refs.push({ ref: `e${++count}`, tag, text, type: 'textarea', value: el.value })
      } else if (el instanceof HTMLSelectElement) {
        text = el.name || el.getAttribute('aria-label') || ''
        const options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 20).join(' | ')
        refs.push({ ref: `e${++count}`, tag, text, type: 'select', value: options })
      } else {
        text = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120)
        const href = el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href') || undefined
        const role = el.getAttribute('role') || undefined
        const entry: { ref: string; tag: string; text: string; href?: string; role?: string } = {
          ref: `e${++count}`,
          tag,
          text,
        }
        if (href !== undefined && href !== '') entry.href = href
        if (role !== undefined && role !== '') entry.role = role
        refs.push(entry)
      }
      if (count >= 200) break
    }
    const bodyText = (document.body?.innerText || '').trim()
    return {
      url: location.href,
      title: document.title,
      text: bodyText,
      refs,
    }
  })

  const truncated = raw.text.length > MAX_TEXT
  let aria = ''
  try {
    // Playwright 1.49+ exposes ariaSnapshot(); if unavailable this stays empty.
    aria = await page.locator('body').ariaSnapshot().catch(() => '')
  } catch {
    aria = ''
  }
  return {
    url: raw.url,
    title: raw.title,
    text: raw.text.slice(0, MAX_TEXT),
    aria: aria.slice(0, MAX_TEXT),
    refs: raw.refs.slice(0, MAX_REFS),
    truncated,
  }
}
