import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_DEFAULTS, clientConfigOf, sanitizeClientConfig } from '../lib/shared/client-config.js'
import { Config as ConfigSchema } from '../lib/config.js'

/** host schema 默认值必须与客户端编译期默认值一致(防漂移守护)。 */
test('schema 默认值 === CLIENT_DEFAULTS', () => {
  const dict = ConfigSchema.dict
  const pairs = [
    ['fitMaxHeight', dict.fitMaxHeight.meta.default],
    ['zoomBoxHeight', dict.zoomBoxHeight.meta.default],
    ['zoomMinScale', dict.zoomMinScale.meta.default],
    ['zoomMaxScale', dict.zoomMaxScale.meta.default],
    ['renderTimeoutMs', dict.renderTimeoutMs.meta.default],
    ['themeAuto', dict.themeAuto.meta.default],
  ]
  for (const [key, schemaDefault] of pairs) {
    assert.equal(schemaDefault, CLIENT_DEFAULTS[key], `CLIENT_DEFAULTS.${key} 与 schema 默认值漂移`)
  }
  const dc = dict.darkColors.dict
  for (const key of ['shape', 'stroke', 'cluster', 'edge', 'text', 'canvas']) {
    assert.equal(dc[key].meta.default, CLIENT_DEFAULTS.darkColors[key], `darkColors.${key} 默认值漂移`)
  }
})

test('clientConfigOf: 只投影客户端子集且深拷贝 darkColors', () => {
  const full = {
    krokiBaseUrl: 'https://example.com',
    krokiPath: '/mermaid/svg',
    upstreamTimeoutMs: 1000,
    maxBodyBytes: 2000,
    maxDiagramBytes: 3000,
    ...CLIENT_DEFAULTS,
  }
  const projected = clientConfigOf(full)
  assert.deepEqual(projected, CLIENT_DEFAULTS)
  assert.equal('krokiBaseUrl' in projected, false)
  projected.darkColors.shape = '#000000'
  assert.notEqual(CLIENT_DEFAULTS.darkColors.shape, '#000000')
})

test('sanitizeClientConfig: 非对象输入回退默认值', () => {
  assert.deepEqual(sanitizeClientConfig(null), CLIENT_DEFAULTS)
  assert.deepEqual(sanitizeClientConfig('x'), CLIENT_DEFAULTS)
  assert.deepEqual(sanitizeClientConfig(42), CLIENT_DEFAULTS)
})

test('sanitizeClientConfig: 逐字段类型清洗,坏字段回退', () => {
  const cleaned = sanitizeClientConfig({
    fitMaxHeight: 999,
    zoomBoxHeight: 'oops',
    zoomMinScale: 0.2,
    renderTimeoutMs: null,
    themeAuto: false,
    darkColors: { shape: '#fff', text: 7 },
  })
  assert.equal(cleaned.fitMaxHeight, 999)
  assert.equal(cleaned.zoomBoxHeight, CLIENT_DEFAULTS.zoomBoxHeight)
  assert.equal(cleaned.zoomMinScale, 0.2)
  assert.equal(cleaned.renderTimeoutMs, CLIENT_DEFAULTS.renderTimeoutMs)
  assert.equal(cleaned.themeAuto, false)
  assert.equal(cleaned.darkColors.shape, '#fff')
  assert.equal(cleaned.darkColors.text, CLIENT_DEFAULTS.darkColors.text)
  assert.equal(cleaned.darkColors.canvas, CLIENT_DEFAULTS.darkColors.canvas)
})
