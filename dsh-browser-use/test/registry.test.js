import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManagerRegistry } from '../lib/types/browser-registry.js'

function makeConfig() {
  return {
    headless: true,
    viewport: { width: 1280, height: 800 },
    navigationTimeoutMs: 1000,
    actionTimeoutMs: 1000,
    screenshotDir: 'browser-screenshots',
    allowEval: false,
    allowPrivate: true,
    allowedHosts: [],
    blockedHosts: [],
    enableMcpBridge: true,
  }
}

test('BrowserManagerRegistry 按会话返回独立实例', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-browser-registry-'))
  try {
    const registry = new BrowserManagerRegistry(makeConfig(), root)
    const a = registry.get('session-a')
    const b = registry.get('session-b')
    const aAgain = registry.get('session-a')

    assert.notEqual(a, b)
    assert.equal(a, aAgain)
    assert.equal(registry.has('session-a'), true)
    assert.equal(registry.has('session-c'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('BrowserManagerRegistry dispose 后重建新实例', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-browser-registry-'))
  try {
    const registry = new BrowserManagerRegistry(makeConfig(), root)
    const first = registry.get('session-a')
    registry.dispose('session-a')
    const second = registry.get('session-a')

    assert.notEqual(first, second)
    assert.equal(registry.has('session-a'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('BrowserManagerRegistry lastActive 跟随最近访问的会话', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-browser-registry-'))
  try {
    const registry = new BrowserManagerRegistry(makeConfig(), root)
    const a = registry.get('session-a')
    const b = registry.get('session-b')

    assert.equal(registry.lastActive, b)
    registry.get('session-a')
    assert.equal(registry.lastActive, a)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
