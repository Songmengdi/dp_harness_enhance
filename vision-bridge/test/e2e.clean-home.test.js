// 05 票验收：干净 DSH_HOME 全生命周期 e2e（安装 → 装配 → 激活调用 → 禁用 → 重新启用 → 卸载）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('clean-home e2e: 全新 DSH_HOME 完整生命周期', { timeout: 900_000 }, async () => {
  const result = await new Promise((resolve) => {
    const child = spawn('node', [join(root, 'scripts', 'clean-home-e2e.mjs')], {
      cwd: root,
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  const reportLine = result.stdout.split('\n').find((l) => l.startsWith('CLEAN_HOME_E2E_REPORT '))
  assert.ok(reportLine, `无 e2e 报告：\n${result.stderr.slice(-3000)}\n${result.stdout.slice(-2000)}`)
  const report = JSON.parse(reportLine.slice('CLEAN_HOME_E2E_REPORT '.length))
  assert.equal(report.pass, true, `clean-home e2e 未通过：\n${JSON.stringify(report, null, 2)}\nstderr:\n${result.stderr.slice(-2000)}`)
  assert.equal(result.code, 0)
})
