// 04 票验收：trace / extract_foreground / long_screenshot_ocr / html_screenshot（确定性单测 + 集成）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { RuntimeManager } from '../lib/runtime-manager.js'
import { Runtime } from '../lib/runtime.js'
import { makeValidators } from '../lib/validators.js'
import { FenceRegistry } from '../lib/paths.js'
import { RemoteVision, GlanceCache } from '../lib/remote.js'
import { VisionError } from '../lib/errors.js'
import { defineTraceTool } from '../lib/tools/trace.js'
import { defineExtractForegroundTool } from '../lib/tools/extract-foreground.js'
import { defineLongScreenshotOcrTool } from '../lib/tools/long-screenshot-ocr.js'
import { defineHtmlScreenshotTool } from '../lib/tools/html-screenshot.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')
const noop = { info() {}, warn() {}, error() {} }
const hasChrome = existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') || existsSync('/Applications/Chromium.app/Contents/MacOS/Chromium') || existsSync('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')

function py(script) {
  return spawnSync('python3', ['-c', script], { encoding: 'utf8' })
}

function makeImages(ws) {
  mkdirSync(ws, { recursive: true })
  const script = `
from PIL import Image, ImageDraw
# 20x20 图标
im = Image.new('RGB', (20, 20), '#ffffff')
d = ImageDraw.Draw(im); d.rectangle([5, 5, 14, 14], fill='#000000')
im.save(${JSON.stringify(join(ws, 'icon.png'))})
# 白底红圆
im2 = Image.new('RGB', (120, 80), '#ffffff')
d2 = ImageDraw.Draw(im2); d2.ellipse([30, 20, 90, 70], fill='#ff0000')
im2.save(${JSON.stringify(join(ws, 'fg.png'))})
# 全出血图（无背景，auto 应失败）
im3 = Image.new('RGB', (100, 100), '#224466')
im3.save(${JSON.stringify(join(ws, 'bleed.png'))})
# 长截图：三条内容带
im4 = Image.new('RGB', (200, 800), '#ffffff')
d4 = ImageDraw.Draw(im4)
for y0, y1 in [(50, 120), (400, 470), (700, 760)]:
    d4.rectangle([20, y0, 180, y1], fill='#333333', outline='#999999')
im4.save(${JSON.stringify(join(ws, 'long.png'))})
`
  const r = py(script)
  assert.equal(r.status, 0, `PIL 生成测试图失败: ${r.stderr}`)
}

function makeFakeUpstream() {
  const counters = { ocr: 0 }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      counters.ocr += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OCR-分块-%d' .replace('%d', String(counters.ocr)) }, finish_reason: 'stop' }] }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, counters, endpoint: `http://127.0.0.1:${server.address().port}/v1` }))
  })
}

function makeEnv(up) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-04-'))
  const ws = join(tmp, 'ws')
  makeImages(ws)
  const manager = new RuntimeManager({
    runtimeDir, stateDir: join(tmp, 'state'), python: 'python3', managed: false, venvDir: '',
    requirementsFile: join(runtimeDir, 'requirements.lock'), prepareTimeoutMs: 60_000, logger: noop,
  })
  const runtime = new Runtime({ manager, defaultTimeoutMs: 120_000, maxConcurrency: 4, logger: noop, validators: makeValidators() })
  const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
  const remote = up
    ? new RemoteVision({ credentials: { resolve: async () => ({ value: 'sk-04', source: 'test' }) } }, runtime, {
        endpoint: up.endpoint, model: 'fake', credential: 'TEST_KEY', language: '中文', visionTimeoutMs: 20_000, maxRetries: 0,
      }, noop)
    : undefined
  const cache = new GlanceCache(0, noop)
  const toolEnv = { fences, runtime }
  const remoteEnv = { fences, runtime, remote, cache }
  return {
    tmp, ws, runtime, fences,
    tools: {
      trace: defineTraceTool(toolEnv),
      fg: defineExtractForegroundTool(toolEnv),
      longOcr: defineLongScreenshotOcrTool(remoteEnv),
      html: defineHtmlScreenshotTool(toolEnv),
    },
  }
}

function execFor(ws, id = 'sess-04', signal = undefined) {
  return {
    signal: signal ?? new AbortController().signal,
    agent: { id, session: { header: { cwd: ws } }, options: {} },
    callId: 'c1', name: '', arguments: {},
  }
}

test('vision_trace: 小图标先放大分析、输出保持原图坐标、SVG 校验通过', async () => {
  const env = makeEnv()
  try {
    const out = await env.tools.trace.execute({ image: 'icon.png', color: true }, execFor(env.ws))
    assert.ok(out.paths >= 1)
    assert.equal(out.width, 20)
    assert.equal(out.height, 20)
    assert.ok(out.scale > 1, '小图标应先放大分析')
    assert.ok(existsSync(out.artifact.path))
    const svg = readFileSync(out.artifact.path, 'utf8')
    assert.match(svg, /viewBox="0 0 20 20"/)
    assert.equal((svg.match(/<svg/g) ?? []).length, 1)
    assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1)
    assert.ok(!/script|javascript:|foreignObject|DOCTYPE/i.test(svg))
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('vision_extract_foreground: 透明 PNG + 分量/覆盖率；auto 失败可手工重试', async () => {
  const env = makeEnv()
  try {
    const out = await env.tools.fg.execute({ image: 'fg.png' }, execFor(env.ws))
    assert.equal(out.components, 1)
    assert.ok(out.coveragePct > 15 && out.coveragePct < 50, `覆盖率异常: ${out.coveragePct}`)
    assert.ok(existsSync(out.artifact.path))
    const buf = readFileSync(out.artifact.path)
    assert.equal(buf[25], 6, '产物必须是带 alpha 的 PNG')

    const manual = await env.tools.fg.execute({ image: 'fg.png', mode: 'manual', region: '25,15,70,60' }, execFor(env.ws))
    assert.ok(manual.coveragePct > 0)

    // auto 失败路径：全出血图 → output 错误并提示 manual 重试
    const err = await env.tools.fg.execute({ image: 'bleed.png' }, execFor(env.ws)).catch((e) => e)
    assert.ok(err instanceof VisionError)
    assert.match(err.message, /manual/)
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('vision_long_screenshot_ocr: splitOnly 不发远程；resume 复用；完整 OCR 合并+审计', async () => {
  const up = await makeFakeUpstream()
  const env = makeEnv(up)
  try {
    const split = await env.tools.longOcr.execute({ image: 'long.png', runName: 'demo', splitOnly: true }, execFor(env.ws))
    assert.ok(split.chunks >= 2, `分块数异常: ${split.chunks}`)
    assert.equal(split.complete, false)
    assert.equal(up.counters.ocr, 0, 'splitOnly 不得发起任何远程请求')
    assert.ok(existsSync(split.manifest.path))

    const resumeSplit = await env.tools.longOcr.execute({ image: 'long.png', runName: 'demo', splitOnly: true, resume: true }, execFor(env.ws))
    assert.equal(resumeSplit.reused.chunks, split.chunks, 'resume 应复用分块')
    assert.equal(up.counters.ocr, 0)

    const full = await env.tools.longOcr.execute({ image: 'long.png', runName: 'demo', resume: true }, execFor(env.ws))
    assert.equal(full.complete, true)
    assert.equal(up.counters.ocr, full.chunks, 'resume 只对缺失侧车的块发远程')
    assert.ok(existsSync(full.mergedMarkdown.path))
    const merged = readFileSync(full.mergedMarkdown.path, 'utf8')
    assert.match(merged, /OCR-分块-/)
    assert.ok(existsSync(full.audit.path))
    assert.ok(full.chunkImages.length === full.chunks)

    const fullAgain = await env.tools.longOcr.execute({ image: 'long.png', runName: 'demo', resume: true }, execFor(env.ws))
    assert.equal(fullAgain.reused.ocr, full.chunks, '同名 resume 应复用全部 OCR 侧车')
    assert.equal(up.counters.ocr, full.chunks, '复用后不再发远程')
  } finally {
    up.server.close()
    rmSync(env.tmp, { recursive: true, force: true })
  }
})

test('vision_html_screenshot: 本地 HTML → 视口 PNG；拒绝 URL/data URI 与非 HTML', { timeout: 180_000 }, async (t) => {
  if (!hasChrome) {
    t.skip('本机没有 Chrome/Chromium/Edge')
    return
  }
  const env = makeEnv()
  try {
    writeFileSync(join(env.ws, 'page.html'), '<!DOCTYPE html><html><body style="margin:0"><div style="width:100px;height:60px;background:#336699"></div></body></html>')
    writeFileSync(join(env.ws, 'note.txt'), 'x')
    const out = await env.tools.html.execute({ source: 'page.html', width: 320, height: 240 }, execFor(env.ws))
    assert.equal(out.viewport.width, 320)
    assert.equal(out.rendered.width, 320)
    assert.ok(out.source.bytes > 0)
    assert.ok(existsSync(out.artifact.path))

    await assert.rejects(
      () => env.tools.html.execute({ source: 'note.txt' }, execFor(env.ws)),
      (e) => e instanceof VisionError && e.category === 'input',
    )
    await assert.rejects(
      () => env.tools.html.execute({ source: 'https://example.com/x.html' }, execFor(env.ws)),
      (e) => e instanceof VisionError && e.category === 'input',
    )
  } finally {
    rmSync(env.tmp, { recursive: true, force: true })
  }
})
