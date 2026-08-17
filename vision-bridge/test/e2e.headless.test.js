// 03 票验收：headless e2e —— 真实 dsh host 里粘贴截图 → 自动激活 → ground → crop → pixel_diff + read 拦截。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('headless e2e: 粘贴 → 自动激活 → ground → crop → pixel_diff + read 拦截', { timeout: 300_000 }, async () => {
  const sync = spawnSync('node', [join(root, 'scripts', 'sync-e2e-profile.mjs')], { encoding: 'utf8' })
  assert.equal(sync.status, 0, `e2e profile 同步失败: ${sync.stderr || sync.stdout}`)

  const result = await new Promise((resolve) => {
    const child = spawn('dsh', ['--profile', 'vision-bridge-e2e', 'run-vision-bridge-e2e'], {
      cwd: root,
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })

  const reportLine = result.stdout.split('\n').find((line) => line.startsWith('VISION_BRIDGE_E2E_REPORT '))
  assert.ok(reportLine, `e2e 没有输出报告：\n${result.stderr.slice(-2000)}\n${result.stdout.slice(-2000)}`)
  const report = JSON.parse(reportLine.slice('VISION_BRIDGE_E2E_REPORT '.length))
  assert.equal(report.pass, true, `e2e 未通过：\n${JSON.stringify(report, null, 2)}\nstderr:\n${result.stderr.slice(-2000)}`)
  assert.equal(result.code, 0)
})
