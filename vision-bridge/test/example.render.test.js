// 04 票验收：闭合示例可复现——本地 HTML 渲染 → pixel_diff 度量，初版差异 > 终版差异（无真实 key）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hasChrome = existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ||
  existsSync('/Applications/Chromium.app/Contents/MacOS/Chromium') ||
  existsSync('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')

test('render-verify 闭合示例：初版差异 > 终版差异，数值证据落盘', { timeout: 180_000 }, (t) => {
  if (!hasChrome) {
    t.skip('本机没有 Chrome/Chromium/Edge')
    return
  }
  const r = spawnSync('node', [join(root, 'scripts', 'render-verify.mjs')], { encoding: 'utf8', cwd: root })
  assert.equal(r.status, 0, `render-verify 失败: ${r.stderr || r.stdout}`)
  const results = readFileSync(join(root, 'examples', 'render-verify', 'RESULTS.md'), 'utf8')
  const v1 = Number(results.match(/v1 初版 \| \*\*([\d.]+)%\*\*/)?.[1])
  const v2 = Number(results.match(/v2 终版 \| \*\*([\d.]+)%\*\*/)?.[1])
  assert.ok(Number.isFinite(v1) && Number.isFinite(v2), `RESULTS.md 缺少数值: ${results}`)
  assert.ok(v1 > v2, `初版差异 ${v1}% 应大于终版差异 ${v2}%`)
})
