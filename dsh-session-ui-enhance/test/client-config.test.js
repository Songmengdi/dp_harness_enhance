import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_DEFAULTS, clientConfigOf, sanitizeClientConfig } from '../lib/types/shared/client-config.js'
import { Config as ConfigSchema } from '../lib/types/config.js'

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
  const tc = dict.thinkCollapse.dict
  for (const key of ['enabled', 'minBodyHeight']) {
    assert.equal(tc[key].meta.default, CLIENT_DEFAULTS.thinkCollapse[key], `thinkCollapse.${key} 默认值漂移`)
  }
  assert.equal(dict.processCollapse.dict.enabled.meta.default, CLIENT_DEFAULTS.processCollapse.enabled, 'processCollapse.enabled 默认值漂移')
  assert.equal(dict.processCollapse.dict.bottomToggleMinHeight.meta.default, CLIENT_DEFAULTS.processCollapse.bottomToggleMinHeight, 'processCollapse.bottomToggleMinHeight 默认值漂移')
  assert.equal(dict.workspaceActions.dict.enabled.meta.default, CLIENT_DEFAULTS.workspaceActions.enabled, 'workspaceActions.enabled 默认值漂移')
  assert.equal(dict.userBubble.dict.enabled.meta.default, CLIENT_DEFAULTS.userBubble.enabled, 'userBubble.enabled 默认值漂移')
  assert.equal(dict.userBubble.dict.collapseHeight.meta.default, CLIENT_DEFAULTS.userBubble.collapseHeight, 'userBubble.collapseHeight 默认值漂移')
  assert.equal(dict.composer.dict.enabled.meta.default, CLIENT_DEFAULTS.composer.enabled, 'composer.enabled 默认值漂移')
})

test('clientConfigOf: 只投影已知字段且深拷贝嵌套配置', () => {
  const full = {
    obsoleteKrokiField: 'https://example.com',
    ...CLIENT_DEFAULTS,
  }
  const projected = clientConfigOf(full)
  assert.deepEqual(projected, CLIENT_DEFAULTS)
  assert.equal('obsoleteKrokiField' in projected, false)
  projected.darkColors.shape = '#000000'
  assert.notEqual(CLIENT_DEFAULTS.darkColors.shape, '#000000')
  projected.thinkCollapse.enabled = false
  assert.notEqual(CLIENT_DEFAULTS.thinkCollapse.enabled, false)
  projected.processCollapse.enabled = false
  assert.notEqual(CLIENT_DEFAULTS.processCollapse.enabled, false)
  projected.workspaceActions.enabled = false
  assert.notEqual(CLIENT_DEFAULTS.workspaceActions.enabled, false)
  projected.userBubble.enabled = false
  assert.notEqual(CLIENT_DEFAULTS.userBubble.enabled, false)
  projected.composer.enabled = false
  assert.notEqual(CLIENT_DEFAULTS.composer.enabled, false)
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
    thinkCollapse: { enabled: 'yes', minBodyHeight: 480 },
    processCollapse: { enabled: 0, bottomToggleMinHeight: 600 },
    workspaceActions: { enabled: 1 },
    userBubble: { enabled: 'yes', collapseHeight: 200 },
    composer: { enabled: 0 },
  })
  assert.equal(cleaned.fitMaxHeight, 999)
  assert.equal(cleaned.zoomBoxHeight, CLIENT_DEFAULTS.zoomBoxHeight)
  assert.equal(cleaned.zoomMinScale, 0.2)
  assert.equal(cleaned.renderTimeoutMs, CLIENT_DEFAULTS.renderTimeoutMs)
  assert.equal(cleaned.themeAuto, false)
  assert.equal(cleaned.darkColors.shape, '#fff')
  assert.equal(cleaned.darkColors.text, CLIENT_DEFAULTS.darkColors.text)
  assert.equal(cleaned.darkColors.canvas, CLIENT_DEFAULTS.darkColors.canvas)
  assert.equal(cleaned.thinkCollapse.enabled, CLIENT_DEFAULTS.thinkCollapse.enabled)
  assert.equal(cleaned.thinkCollapse.minBodyHeight, 480)
  assert.equal(cleaned.processCollapse.enabled, CLIENT_DEFAULTS.processCollapse.enabled)
  assert.equal(cleaned.processCollapse.bottomToggleMinHeight, 600)
  assert.equal(cleaned.workspaceActions.enabled, CLIENT_DEFAULTS.workspaceActions.enabled)
  assert.equal(cleaned.userBubble.enabled, CLIENT_DEFAULTS.userBubble.enabled)
  assert.equal(cleaned.userBubble.collapseHeight, 200)
  assert.equal(cleaned.composer.enabled, CLIENT_DEFAULTS.composer.enabled)
})

test('sanitizeClientConfig: 旧版 host 快照缺新字段时回退默认值', () => {
  const legacy = { ...CLIENT_DEFAULTS }
  delete legacy.thinkCollapse
  delete legacy.processCollapse
  delete legacy.workspaceActions
  delete legacy.userBubble
  delete legacy.composer
  const cleaned = sanitizeClientConfig(legacy)
  assert.deepEqual(cleaned.thinkCollapse, CLIENT_DEFAULTS.thinkCollapse)
  assert.deepEqual(cleaned.processCollapse, CLIENT_DEFAULTS.processCollapse)
  assert.deepEqual(cleaned.workspaceActions, CLIENT_DEFAULTS.workspaceActions)
  assert.deepEqual(cleaned.userBubble, CLIENT_DEFAULTS.userBubble)
  assert.deepEqual(cleaned.composer, CLIENT_DEFAULTS.composer)
})
