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
  mdx: 'mdx',
  'c++': 'cplusplus',
  cpp: 'cplusplus',
  cc: 'cplusplus',
  java: 'java',
  sql: 'mysql',
  html: 'html',
  jsonc: 'json',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  cs: 'csharp',
  csharp: 'csharp',
  'c#': 'csharp',
  kotlin: 'kotlin',
  swift: 'swift',
  php: 'php',
  toml: 'toml',
  ini: 'ini',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  xml: 'xml',
  lua: 'lua',
  txt: 'text',
  text: 'text',
  plaintext: 'text',
  plain: 'text',
}

/**
 * Hints that distinguish a `c` banner (the renderer normalizes `c++`/`c#`
 * to just `c`) from plain C. These are intentionally conservative: only
 * unmistakable C++ or C# constructs flip the icon.
 */
const CPLUSPLUS_HINTS = [
  '#include <iostream>',
  '#include <vector>',
  '#include <string>',
  '#include <algorithm>',
  '#include <memory>',
  'std::',
  '::',
  '->',
  'cout',
  'cin',
  'nullptr',
  'template<',
  'using namespace',
]
const CSHARP_HINTS = [
  'using system;',
  'console.',
  'static void main',
  'string[] args',
  'async task',
  'await ',
  'public class',
  'private class',
  'namespace ',
]

/**
 * Pick the most likely canonical icon key when the banner says `c`. The
 * product markdown renderer collapses `c++`/`c#` to `c` before displaying
 * the banner, so the code body is the only remaining signal.
 * @param code - lower-cased code block text.
 * @returns `cplusplus`, `csharp`, or `c` when no strong hint matches.
 */
function disambiguateC(code: string): string {
  if (CPLUSPLUS_HINTS.some((hint) => code.includes(hint))) return 'cplusplus'
  if (CSHARP_HINTS.some((hint) => code.includes(hint))) return 'csharp'
  return 'c'
}

/**
 * Normalize a code-block banner language into the canonical `data-z-lang`
 * key used by `typography.css`. Unknown languages are passed through so the
 * generic code icon still applies.
 * @param raw - banner text as displayed by the markdown renderer.
 * @param code - optional code body text; used to disambiguate `c` between
 * C, C++, and C# when the renderer has already collapsed the banner.
 * @returns canonical icon key, or the lower-cased raw text when unknown.
 */
export function normalizeLang(raw: string, code = ''): string {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === '') return ''
  const lang = LANG_ALIASES[trimmed] ?? trimmed
  if (lang === 'c' && code !== '') return disambiguateC(code.toLowerCase())
  return lang
}

/**
 * Mirror one code block's banner language text into `data-z-lang`.
 * @param block - the `.md-code-block` element to tag.
 */
function tagBlock(block: HTMLElement): void {
  const info = block.querySelector('[class*="_infostring_"]')
  const raw = (info?.textContent ?? '').trim().toLowerCase()
  // Streamed fences start with an empty banner. Use the neutral text-file
  // icon as a stable fallback; once the real language appears, the observer
  // re-tags the block with the language-specific icon.
  if (raw === '') {
    if (block.dataset.zLang !== 'text') block.dataset.zLang = 'text'
    return
  }
  const code = block.querySelector('pre')?.textContent ?? ''
  const lang = normalizeLang(raw, code)
  if (block.dataset.zLang !== lang) block.dataset.zLang = lang
}

/**
 * Mirror every code block's banner language text into `data-z-lang`.
 * @param root - subtree to scan (document.body for the initial pass).
 */
function tagCodeBlocks(root: ParentNode): void {
  for (const block of root.querySelectorAll('.md-code-block')) {
    if (!(block instanceof HTMLElement)) continue
    tagBlock(block)
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
          // Streamed fences fill the language label after the block is
          // already in the DOM; the text node's parent is the infostring
          // element, so walk up to the owning code block and re-tag it.
          const block = mutation.target.parentElement?.closest('.md-code-block')
          if (block instanceof HTMLElement) tagBlock(block)
          continue
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('md-code-block')) tagBlock(node)
            else tagCodeBlocks(node)
          } else if (node.nodeType === Node.TEXT_NODE) {
            const block = node.parentElement?.closest('.md-code-block')
            if (block instanceof HTMLElement) tagBlock(block)
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, 'code-lang-tagging')
}
