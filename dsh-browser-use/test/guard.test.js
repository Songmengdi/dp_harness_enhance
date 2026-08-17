import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedUrl } from '../lib/types/guard.js'

const baseConfig = {
  executablePath: undefined,
  channel: undefined,
  headless: true,
  userDataDir: '',
  viewport: { width: 1280, height: 800 },
  navigationTimeoutMs: 30000,
  actionTimeoutMs: 15000,
  screenshotDir: 'browser-screenshots',
  allowEval: false,
  allowPrivate: true,
  allowedHosts: [],
  blockedHosts: [],
}

test('允许公网 http/https', () => {
  assert.equal(isAllowedUrl('https://example.com', baseConfig).ok, true)
  assert.equal(isAllowedUrl('http://example.com/a?b=1', baseConfig).ok, true)
})

test('拒绝非 http(s) 协议', () => {
  for (const url of ['file:///etc/passwd', 'data:text/html,x', 'chrome://settings', 'javascript:alert(1)']) {
    const r = isAllowedUrl(url, baseConfig)
    assert.equal(r.ok, false, url)
  }
})

test('拒绝云元数据地址', () => {
  assert.equal(isAllowedUrl('http://169.254.169.254/latest/meta-data', baseConfig).ok, false)
  assert.equal(isAllowedUrl('http://metadata.google.internal/computeMetadata/v1', baseConfig).ok, false)
})

test('allowPrivate=false 时拒绝内网/回环', () => {
  const strict = { ...baseConfig, allowPrivate: false }
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.1', 'http://10.0.0.1']) {
    const r = isAllowedUrl(url, strict)
    assert.equal(r.ok, false, url)
  }
  assert.equal(isAllowedUrl('https://example.com', strict).ok, true)
})

test('黑名单优先', () => {
  const cfg = { ...baseConfig, blockedHosts: ['example.com'] }
  assert.equal(isAllowedUrl('https://example.com', cfg).ok, false)
  assert.equal(isAllowedUrl('https://sub.example.com', cfg).ok, false)
  assert.equal(isAllowedUrl('https://other.com', cfg).ok, true)
})

test('白名单收窄', () => {
  const cfg = { ...baseConfig, allowedHosts: ['example.com'] }
  assert.equal(isAllowedUrl('https://example.com', cfg).ok, true)
  assert.equal(isAllowedUrl('https://other.com', cfg).ok, false)
})
