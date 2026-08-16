// 01 票验收：argv 向量 subprocess —— 超时/取消/输出有界 + Python 契约稳定退出码。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnBounded } from '../lib/runtime.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')

function py(extraArgs, env) {
  return spawnSync('python3', ['-m', 'dsh_vision', ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: runtimeDir, ...env },
  })
}

test('contract: probe 返回 ok envelope', () => {
  const r = py(['probe', '--spec', '{}'])
  assert.equal(r.status, 0)
  const body = JSON.parse(r.stdout)
  assert.equal(body.ok, true)
  assert.equal(body.result.runtime, 'dsh-vision')
})

test('contract: 不存在文件 → input 类别 + 退出码 2', () => {
  const r = py(['media', '--spec', JSON.stringify({ path: '/nonexistent-vb.mp4' })])
  assert.equal(r.status, 2)
  const body = JSON.parse(r.stdout)
  assert.equal(body.ok, false)
  assert.equal(body.error.category, 'input')
})

test('contract: frames 时间点超限 → input 类别', () => {
  const many = Array.from({ length: 9 }, (_, i) => String(i))
  const r = py(['frames', '--spec', JSON.stringify({ path: 'x', times: many, outDir: '/tmp' })])
  assert.equal(r.status, 2)
  assert.equal(JSON.parse(r.stdout).error.category, 'input')
})

test('contract: 未知子命令 → input 类别退出码 2', () => {
  const r = py(['nope', '--spec', '{}'])
  assert.equal(r.status, 2)
  assert.equal(JSON.parse(r.stdout).error.category, 'input')
})

test('contract: --spec 非法 JSON → input 类别', () => {
  const r = py(['media', '--spec', '{bad json'])
  assert.equal(r.status, 2)
  assert.equal(JSON.parse(r.stdout).error.category, 'input')
})

test('spawn: 超时 SIGKILL（timedOut）', async () => {
  const r = await spawnBounded(['python3', '-c', 'import time; time.sleep(30)'], { timeoutMs: 300 })
  assert.equal(r.timedOut, true)
  assert.equal(r.exitCode, null)
})

test('spawn: AbortSignal 取消（cancelled）', async () => {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 50)
  const r = await spawnBounded(['python3', '-c', 'import time; time.sleep(30)'], { signal: ac.signal })
  assert.equal(r.cancelled, true)
})

test('spawn: stdout 超界被终止并标记 truncated', async () => {
  const r = await spawnBounded(['python3', '-c', 'print("x" * (2 * 1024 * 1024))'], { maxStdoutBytes: 64 * 1024 })
  assert.equal(r.stdoutTruncated, true)
  assert.ok(r.stdout.length <= 64 * 1024 + 64 * 1024)
})

test('spawn: argv 向量调用（无 shell 拼接）且 stdout 有界正常返回', async () => {
  const r = await spawnBounded(['python3', '-c', 'print("hello argv")'])
  assert.equal(r.exitCode, 0)
  assert.equal(r.stdout.trim(), 'hello argv')
})
