/**
 * dsh-session-ui-enhance — per-language code-block icon tagging.
 *
 * The markdown renderer's code-block banner exposes the language only as
 * visible text (`.md-code-block [class*="_infostring_"]`); no attribute hook
 * exists for CSS. This effect watches the conversation DOM and mirrors that
 * text into a `data-z-lang` attribute on the block element, so
 * `typography.css` can hang per-language brand icons on it with plain
 * attribute selectors.
 *
 * Unlike the dynamic-plugin sandbox, the real client bundle runs with full
 * DOM access (the rail already queries the conversation scrollport), so a
 * MutationObserver is the smallest reliable mirror: it covers initial
 * render, streamed fences (whose language label appears only after the
 * stream settles), and later turns without any product-side change.
 *
 * @module dsh-session-ui-enhance/client/code-lang
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Banner text → canonical icon key (matches the `data-z-lang` CSS rules). */
const LANG_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  'c++': 'cplusplus',
  cpp: 'cplusplus',
  cc: 'cplusplus',
  java: 'java',
  sql: 'mysql',
  html: 'html',
}

/**
 * Mirror every code block's banner language text into `data-z-lang`.
 * @param root - subtree to scan (document.body for the initial pass).
 */
function tagCodeBlocks(root: ParentNode): void {
  for (const block of root.querySelectorAll('.md-code-block')) {
    if (!(block instanceof HTMLElement)) continue
    const info = block.querySelector('[class*="_infostring_"]')
    const raw = (info?.textContent ?? '').trim().toLowerCase()
    // Streamed fences render with an empty banner until the stream settles;
    // leave those untouched so a later mutation pass tags them.
    if (raw === '') continue
    const lang = LANG_ALIASES[raw] ?? raw
    if (block.dataset.zLang !== lang) block.dataset.zLang = lang
  }
}

/**
 * Client effect: mirror banner language text to `data-z-lang` for as long
 * as the plugin is mounted; the returned disposer disconnects the observer.
 * @param ctx - client root context (owns the effect lifecycle).
 */
export function applyCodeLangTagging(ctx: ClientContext): void {
  ctx.effect(() => {
    tagCodeBlocks(document.body)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement
          if (parent !== null) tagCodeBlocks(parent)
          continue
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) tagCodeBlocks(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, 'code-lang-tagging')
}
