import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/types/config.js'

test('Config schema 默认值', () => {
  const value = Config({})
  assert.equal(value.headless, false)
  assert.equal(value.viewport.width, 1280)
  assert.equal(value.viewport.height, 800)
  assert.equal(value.navigationTimeoutMs, 30000)
  assert.equal(value.actionTimeoutMs, 15000)
  assert.equal(value.screenshotDir, 'browser-screenshots')
  assert.equal(value.allowEval, false)
  assert.equal(value.allowPrivate, true)
  assert.deepEqual(value.allowedHosts, [])
  assert.deepEqual(value.blockedHosts, [])
  assert.equal(value.enableMcpBridge, true)
})

test('Config schema 覆盖', () => {
  const value = Config({ headless: false, allowEval: true, viewport: { width: 375, height: 812 } })
  assert.equal(value.headless, false)
  assert.equal(value.allowEval, true)
  assert.equal(value.viewport.width, 375)
  assert.equal(value.viewport.height, 812)
})
