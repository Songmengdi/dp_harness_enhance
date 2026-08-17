import type { Page } from 'playwright-core'

export const INTERACTIVE_SELECTOR = [
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

export function refIndex(ref: string): number {
  const m = /^e(\d+)$/i.exec(ref.trim())
  if (!m) throw new Error(`ref 格式应为 e1/e2/...，收到: ${ref}`)
  return Number(m[1]) - 1
}

async function visibleElements(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let visible = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.width >= 2 && rect.height >= 2) visible += 1
    }
    return visible
  }, INTERACTIVE_SELECTOR)
}

export async function elementByRef(page: Page, ref: string): Promise<void> {
  const index = refIndex(ref)
  const found = await page.evaluate(({ selector, index }) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let visible = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (visible === index) {
        return el
      }
      visible += 1
    }
    return null
  }, { selector: INTERACTIVE_SELECTOR, index })
  if (!found) {
    const count = await visibleElements(page)
    throw new Error(`ref ${ref} 不存在（当前可见交互元素 ${count} 个）`)
  }
}

export async function clickRef(page: Page, ref: string): Promise<void> {
  const index = refIndex(ref)
  const clicked = await page.evaluate(({ selector, index }) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let visible = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (visible === index) {
        el.click()
        return true
      }
      visible += 1
    }
    return false
  }, { selector: INTERACTIVE_SELECTOR, index })
  if (!clicked) {
    const count = await visibleElements(page)
    throw new Error(`ref ${ref} 不存在（当前可见交互元素 ${count} 个）`)
  }
}

export async function fillRef(page: Page, ref: string, text: string): Promise<void> {
  const index = refIndex(ref)
  const filled = await page.evaluate(({ selector, index, text }) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let visible = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (visible === index) {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(el, text)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        } else if (el.isContentEditable) {
          el.textContent = text
          el.dispatchEvent(new Event('input', { bubbles: true }))
        } else {
          return false
        }
        return true
      }
      visible += 1
    }
    return false
  }, { selector: INTERACTIVE_SELECTOR, index, text })
  if (!filled) {
    const count = await visibleElements(page)
    throw new Error(`ref ${ref} 不是可输入元素（当前可见交互元素 ${count} 个）`)
  }
}

export async function selectRef(page: Page, ref: string, values: string[]): Promise<string[]> {
  const index = refIndex(ref)
  const selected = await page.evaluate(({ selector, index, values }) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    let visible = 0
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      if (visible === index) {
        if (!(el instanceof HTMLSelectElement)) return null
        const picked: string[] = []
        for (const option of Array.from(el.options)) {
          if (values.includes(option.value) || values.includes(option.text)) {
            option.selected = true
            picked.push(option.value)
          }
        }
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return picked
      }
      visible += 1
    }
    return null
  }, { selector: INTERACTIVE_SELECTOR, index, values })
  if (!selected) {
    const count = await visibleElements(page)
    throw new Error(`ref ${ref} 不是 <select>（当前可见交互元素 ${count} 个）`)
  }
  return selected
}
