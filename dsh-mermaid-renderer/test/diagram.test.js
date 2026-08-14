import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDarkInjection,
  clamp,
  fitScaleFor,
  krokiUrlOf,
  parseRenderBody,
  summarizeError,
  uniquifySvgIds,
} from '../lib/shared/diagram.js'

test('clamp: 夹取到上下界', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})

test('fitScaleFor: 适配缩放、永不放大、下限钳制、非法尺寸归零', () => {
  assert.equal(fitScaleFor(100, 50, 100, 100), 0.88) // 留 12px 边距:(100-12)/100
  assert.equal(fitScaleFor(400, 200, 200, 200, 0.15), 0.47)
  assert.ok(Math.abs(fitScaleFor(4000, 2000, 200, 200, 0.15) - 0.15) < 1e-9)
  assert.equal(fitScaleFor(0, 100, 200, 200), 0)
  assert.equal(fitScaleFor(100, 100, 0, 200), 0)
  assert.ok(fitScaleFor(1000, 1000, 400, 400, 0.15) < 1)
})

test('fitScaleFor: 高瘦图按高度适配', () => {
  // 宽 100 高 1000,视口 400x400 → (400-12)/1000 = 0.388
  assert.equal(fitScaleFor(100, 1000, 400, 400, 0.15), 0.388)
})

test('buildDarkInjection: 深色且未显式 init 才注入;显式 init 不注入;themeAuto=false 不注入', () => {
  const injected = buildDarkInjection('graph TD\nA-->B', true, true)
  assert.equal(injected.injected, true)
  assert.match(injected.diagram, /^%%\{init/)
  assert.ok(injected.diagram.endsWith('graph TD\nA-->B'))

  const hasInit = buildDarkInjection('%%{init: {"theme": "base"}}%%\ngraph TD\nA-->B', true, true)
  assert.equal(hasInit.injected, false)
  assert.equal(hasInit.diagram, '%%{init: {"theme": "base"}}%%\ngraph TD\nA-->B')

  const light = buildDarkInjection('graph TD\nA-->B', false, true)
  assert.equal(light.injected, false)

  const disabled = buildDarkInjection('graph TD\nA-->B', true, false)
  assert.equal(disabled.injected, false)
})

test('uniquifySvgIds: 确定性重命名 container 引用', () => {
  const input = '<svg><g id="container"><use href="#container"/></g></svg>'
  const a = uniquifySvgIds(input, 'tcm-x1')
  const b = uniquifySvgIds(input, 'tcm-x1')
  assert.equal(a, b)
  assert.match(a, /id="tcm-x1"/)
  assert.match(a, /href="#tcm-x1"/)
  assert.doesNotMatch(a, /"container"/)
  assert.equal(uniquifySvgIds('<svg></svg>', 'tcm-x1'), '<svg></svg>')
})

test('krokiUrlOf: 斜杠归一', () => {
  assert.equal(krokiUrlOf('https://kroki.io', '/mermaid/svg'), 'https://kroki.io/mermaid/svg')
  assert.equal(krokiUrlOf('https://kroki.io/', '/mermaid/svg'), 'https://kroki.io/mermaid/svg')
  assert.equal(krokiUrlOf('https://kroki.io', 'mermaid/svg'), 'https://kroki.io/mermaid/svg')
  assert.equal(krokiUrlOf('https://kroki.io///', '/mermaid/svg'), 'https://kroki.io/mermaid/svg')
})

test('parseRenderBody: 正常解析', () => {
  const limits = { maxBodyBytes: 1000, maxDiagramBytes: 500 }
  const ok = parseRenderBody('{"diagram_source":"graph TD\\nA-->B"}', limits)
  assert.deepEqual(ok, { ok: true, source: 'graph TD\nA-->B' })
})

test('parseRenderBody: 非法 JSON → 400', () => {
  const r = parseRenderBody('{nope', { maxBodyBytes: 1000, maxDiagramBytes: 500 })
  assert.deepEqual(r, { ok: false, status: 400, message: 'invalid json' })
})

test('parseRenderBody: 请求体超限 → 413', () => {
  const r = parseRenderBody('{"diagram_source":"' + 'x'.repeat(200) + '"}', { maxBodyBytes: 100, maxDiagramBytes: 500 })
  assert.deepEqual(r, { ok: false, status: 413, message: 'payload too large' })
})

test('parseRenderBody: 图源缺失/空/超限 → 400', () => {
  const limits = { maxBodyBytes: 1000, maxDiagramBytes: 500 }
  assert.equal(parseRenderBody('{}', limits).status, 400)
  assert.equal(parseRenderBody('{"diagram_source": 3}', limits).status, 400)
  assert.equal(parseRenderBody('{"diagram_source": ""}', limits).status, 400)
  assert.equal(parseRenderBody('{"diagram_source": "' + 'x'.repeat(501) + '"}', limits).status, 400)
})

test('summarizeError: 空白折叠 + 截断', () => {
  assert.equal(summarizeError('  a\n b  '), 'a b')
  assert.equal(summarizeError('x'.repeat(500)).length, 400)
})
