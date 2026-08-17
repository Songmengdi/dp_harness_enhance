import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeLang } from '../lib/types/client/code-lang.js'

/**
 * The markdown renderer (`@deepseek-ai/dsh-client-ui-primitives`) exposes
 * this exact set of aliases to its highlighter. Every one should resolve to a
 * canonical `data-z-lang` icon key so the code-block banner gets a brand icon
 * instead of falling back to the generic code icon.
 */
const PRODUCT_ALIASES = [
  'typescript', 'ts', 'tsx',
  'javascript', 'js', 'jsx',
  'shellscript', 'bash', 'sh', 'shell', 'zsh',
  'json', 'jsonc',
  'py', 'python',
  'rb', 'ruby',
  'go',
  'rs', 'rust',
  'java',
  'c', 'cpp',
  'cs', 'csharp',
  'kotlin', 'swift', 'php',
  'yaml', 'yml',
  'toml', 'ini',
  'md', 'markdown', 'mdx',
  'html', 'css', 'scss', 'less',
  'sql', 'xml', 'lua',
  'txt', 'text', 'plaintext', 'plain',
]

test('normalizeLang: product-supported aliases resolve to a non-empty icon key', () => {
  for (const alias of PRODUCT_ALIASES) {
    assert.notEqual(normalizeLang(alias), '', `${alias} should resolve to a data-z-lang key`)
  }
})

test('normalizeLang: alias normalization matches the icon table', () => {
  assert.equal(normalizeLang('py'), 'python')
  assert.equal(normalizeLang('sh'), 'bash')
  assert.equal(normalizeLang('shell'), 'bash')
  assert.equal(normalizeLang('cpp'), 'cplusplus')
  assert.equal(normalizeLang('cs'), 'csharp')
  assert.equal(normalizeLang('rb'), 'ruby')
  assert.equal(normalizeLang('rs'), 'rust')
  assert.equal(normalizeLang('jsonc'), 'json')
  assert.equal(normalizeLang('yml'), 'yaml')
  assert.equal(normalizeLang('sql'), 'mysql')
  assert.equal(normalizeLang('txt'), 'text')
  assert.equal(normalizeLang('text'), 'text')
  assert.equal(normalizeLang('plaintext'), 'text')
  assert.equal(normalizeLang('unknown-lang'), 'unknown-lang')
})

test('normalizeLang: `c` banner disambiguates C++/C# from plain C', () => {
  assert.equal(normalizeLang('c', '#include <iostream>\nint main() { std::cout << 1; }'), 'cplusplus')
  assert.equal(normalizeLang('c', 'using System; class Program { static void Main() {} }'), 'csharp')
  assert.equal(normalizeLang('c', 'int main(void) { return 0; }'), 'c')
})

test('every canonical icon key used by the aliases has a typography.css rule', () => {
  const css = fs.readFileSync(new URL('../src/client/typography.css', import.meta.url), 'utf8')
  const keys = [...new Set(PRODUCT_ALIASES.map((alias) => normalizeLang(alias)))]
  for (const key of keys) {
    assert.ok(css.includes(`data-z-lang="${key}"`), `missing CSS rule for data-z-lang="${key}"`)
  }
})
