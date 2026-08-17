#!/usr/bin/env node
/**
 * render-verify 闭合示例（04 票）：参考图 → 本地 HTML 渲染 → 像素比对 → 数值证据。
 * 无真实视觉 key；产物写 examples/render-verify/RESULTS.md。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { RuntimeManager } from '../lib/runtime-manager.js'
import { Runtime } from '../lib/runtime.js'
import { makeValidators } from '../lib/validators.js'
import { FenceRegistry } from '../lib/paths.js'
import { defineHtmlScreenshotTool } from '../lib/tools/html-screenshot.js'
import { definePixelDiffTool } from '../lib/tools/pixel-diff.js'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const exampleDir = join(packageRoot, 'examples', 'render-verify')
const runtimeDir = join(packageRoot, 'runtime')
const noop = { info() {}, warn() {}, error() {} }

const execFor = (ws, signal) => ({
  signal: signal ?? new AbortController().signal,
  agent: { id: 'render-verify', session: { header: { cwd: ws } }, options: {} },
  callId: 'c1', name: '', arguments: {},
})

async function main() {
  // 1. 确定性生成参考图（与 v2.html 同布局）
  const gen = spawnSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (400, 300), '#f5f5f5')
d = ImageDraw.Draw(im)
d.rectangle([50, 40, 350, 260], fill='#336699')
d.rectangle([80, 70, 320, 230], fill='#ffcc00')
im.save(${JSON.stringify(join(exampleDir, 'reference.png'))})
`], { encoding: 'utf8' })
  if (gen.status !== 0) throw new Error(`PIL 生成参考图失败: ${gen.stderr}`)

  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-render-verify-'))
  try {
    const manager = new RuntimeManager({
      runtimeDir, stateDir: join(tmp, 'state'), python: 'python3', managed: false, venvDir: '',
      requirementsFile: join(runtimeDir, 'requirements.lock'), prepareTimeoutMs: 60_000, logger: noop,
    })
    const runtime = new Runtime({ manager, defaultTimeoutMs: 120_000, maxConcurrency: 2, logger: noop, validators: makeValidators() })
    const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
    const toolEnv = { fences, runtime }
    const htmlTool = defineHtmlScreenshotTool(toolEnv)
    const diffTool = definePixelDiffTool(toolEnv)

    const shot = async (name) => {
      const out = await htmlTool.execute({ source: name, width: 400, height: 300, output: 'render-' + name.replace('.html', '') }, execFor(exampleDir))
      return out.artifact.path
    }
    const diffOf = async (label, shotPath) => {
      const out = await diffTool.execute({ original: 'reference.png', rebuilt: shotPath, runName: label }, execFor(exampleDir))
      return { label, ratioPct: out.ratioPct, worst: out.worstRegions[0] ?? null }
    }

    const v1Shot = await shot('v1.html')
    const v2Shot = await shot('v2.html')
    const d1 = await diffOf('v1', v1Shot)
    const d2 = await diffOf('v2', v2Shot)

    if (!(d1.ratioPct > d2.ratioPct)) {
      throw new Error(`断言失败：初版差异 ${d1.ratioPct}% 应大于终版差异 ${d2.ratioPct}%`)
    }
    const lines = [
      '# render-verify 数值验收结果',
      '',
      '| 版本 | 差异比例 | 最差区域 |',
      '|---|---|---|',
      `| v1 初版 | **${d1.ratioPct}%** | (${d1.worst.box.x1},${d1.worst.box.y1})-(${d1.worst.box.x2},${d1.worst.box.y2}) ${d1.worst.ratioPct}% |`,
      `| v2 终版 | **${d2.ratioPct}%** | (${d2.worst.box.x1},${d2.worst.box.y1})-(${d2.worst.box.x2},${d2.worst.box.y2}) ${d2.worst.ratioPct}% |`,
      '',
      `断言：初版差异（${d1.ratioPct}%）> 终版差异（${d2.ratioPct}%）✓`,
    ]
    writeFileSync(join(exampleDir, 'RESULTS.md'), lines.join('\n') + '\n')
    console.log(`render-verify: v1=${d1.ratioPct}% v2=${d2.ratioPct}% (初版 > 终版 ✓) → examples/render-verify/RESULTS.md`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error('render-verify failed:', e)
  process.exit(1)
})
