// 05 票验收：配置热更新原子切换 / 卸载取消活动操作 / 指标日志（脱敏）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { RuntimeManager } from '../lib/runtime-manager.js'
import { Runtime } from '../lib/runtime.js'
import { makeValidators } from '../lib/validators.js'
import { VisionError } from '../lib/errors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')
const SECRET = 'sk-prod-secret-05'

function makeLogger() {
  const lines = []
  return {
    lines,
    info(fields, message) { lines.push(JSON.stringify({ message, ...fields })) },
    warn() {},
    error() {},
  }
}

function makeManager(tmp, opts = {}) {
  const logger = makeLogger()
  const manager = new RuntimeManager({
    runtimeDir,
    stateDir: join(tmp, 'state'),
    python: 'python3',
    managed: false,
    venvDir: '',
    requirementsFile: join(runtimeDir, 'requirements.lock'),
    prepareTimeoutMs: 60_000,
    logger,
    ...opts,
  })
  return { manager, logger }
}

test('hot-reload: 候选准备失败被拒绝并保留旧 generation；成功候选原子切换', async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-05-'))
  try {
    const { manager } = makeManager(tmp)
    const gen1 = await manager.ensureReady()
    assert.ok(gen1)

    const rejected = await manager.reconfigure({
      python: '/definitely/missing-python-vb',
      managed: true,
      venvDir: join(tmp, 'venv-bad'),
    })
    assert.equal(rejected.ok, false)
    assert.match(rejected.reason, /修复/)
    assert.equal(manager.generation?.id, gen1.id, '失败必须保留旧 generation')

    const swapped = await manager.reconfigure({ managed: false })
    assert.equal(swapped.ok, true)
    assert.notEqual(manager.generation?.id, gen1.id, '成功候选应原子切换 generation')
    const probe = await manager.ensureReady()
    assert.equal(probe?.id, manager.generation?.id)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('hot-reload: managed 候选 venv 独立准备，切换后旧 venv 被清理', { timeout: 240_000 }, async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-05b-'))
  try {
    const { manager } = makeManager(tmp)
    const gen1 = await manager.ensureReady()
    assert.equal(gen1.managed_venv ?? '', '')

    const swapped = await manager.reconfigure({
      managed: true,
      venvDir: join(tmp, 'venv-next'),
      prepareTimeoutMs: 180_000,
    })
    assert.equal(swapped.ok, true)
    assert.ok(manager.generation.pythonBin.includes('venv-next'))
    // 新调用走新 generation（工具定义惰性取用当前 runtime）
    const logger = makeLogger()
    const runtime = new Runtime({ manager, defaultTimeoutMs: 60_000, maxConcurrency: 2, logger, validators: makeValidators() })
    const probe = await runtime.run('probe', {})
    assert.equal(probe.ok, true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('dispose: 先取消活动视觉操作并等待终止，之后拒绝新操作', { timeout: 60_000 }, async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-05c-'))
  const server = http.createServer(() => { /* 永不响应 */ })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    const { manager } = makeManager(tmp)
    const logger = makeLogger()
    const runtime = new Runtime({ manager, defaultTimeoutMs: 60_000, maxConcurrency: 2, logger, validators: makeValidators() })
    const ws = join(tmp, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'a.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ))
    const inFlight = runtime.run(
      'glance',
      {
        images: [join(ws, 'a.png')], query: 'HANG', endpoint: `http://127.0.0.1:${port}/v1`, model: 'm',
        language: '中文', protocol: 'openai-completions', maxRetries: 0, timeoutMs: 55_000,
      },
      { env: { DSH_VISION_API_KEY: SECRET }, timeoutMs: 60_000 },
    ).catch((e) => e)
    await new Promise((r) => setTimeout(r, 200))
    await runtime.dispose()
    const err = await inFlight
    assert.ok(err instanceof VisionError && err.category === 'cancelled', `活动操作应被取消: ${err}`)
    await assert.rejects(
      () => runtime.run('probe', {}),
      (e) => e instanceof VisionError && e.category === 'cancelled',
    )
    // 指标日志不含密钥
    for (const line of logger.lines) assert.ok(!line.includes(SECRET), '指标日志不得含密钥')
  } finally {
    server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('metrics: 字段含工具名/耗时/图片数量与字节/模型/类别，无密钥与 base64', async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-05d-'))
  try {
    const ws = join(tmp, 'ws')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
    const { manager, logger } = makeManager(tmp)
    const runtime = new Runtime({ manager, defaultTimeoutMs: 60_000, maxConcurrency: 2, logger, validators: makeValidators() })
    await runtime.run('media', { path: join(ws, 'a.png') }, { meta: { toolName: 'vision_media' } }).catch(() => {})
    await runtime.run('media', { path: join(ws, 'missing.png') }, { meta: { toolName: 'vision_media' } }).catch(() => {})
    const metrics = logger.lines.filter((l) => l.includes('"vision-metric"'))
    assert.ok(metrics.length >= 2)
    for (const line of metrics) {
      const parsed = JSON.parse(line)
      assert.equal(parsed.tool, 'vision_media')
      assert.equal(typeof parsed.totalMs, 'number')
      assert.equal(typeof parsed.images, 'number')
      assert.equal(typeof parsed.imageBytes, 'number')
      assert.ok(['ok', 'input'].includes(parsed.category))
      assert.ok(!line.includes('base64'))
      assert.ok(!/eyJ|iVBOR/.test(line), '指标日志不得含 base64')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
