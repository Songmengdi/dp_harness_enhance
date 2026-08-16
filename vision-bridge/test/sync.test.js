// 01 票验收：旧版修复回归 —— 内嵌 CLI 与真源逐字节一致、py_compile 通过、
// --check 干跑比对漂移非零退出、插件定位项目 CLI 的层级正确。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cliPath = join(root, 'cli', 'dsh-vision')
const pluginPath = join(root, 'plugin', 'lib', 'index.js')
const syncPath = join(root, 'sync-cli.js')

test('sync: 内嵌 CLI_SRC 与 cli/dsh-vision 逐字节一致', () => {
  const src = readFileSync(pluginPath, 'utf8')
  const match = src.match(/const CLI_SRC = String\.raw`([\s\S]*?)`\n/)
  assert.ok(match, '未找到 CLI_SRC 块')
  const cli = readFileSync(cliPath, 'utf8')
  assert.equal(match[1], cli, '内嵌副本与真源漂移，请运行 node vision-bridge/sync-cli.js')
})

test('sync: 内嵌 CLI 通过 py_compile', () => {
  const src = readFileSync(pluginPath, 'utf8')
  const match = src.match(/const CLI_SRC = String\.raw`([\s\S]*?)`\n/)
  assert.ok(match)
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-sync-'))
  const py = join(tmp, 'dsh-vision-embedded')
  writeFileSync(py, match[1])
  const r = spawnSync('python3', ['-m', 'py_compile', py], { encoding: 'utf8' })
  rmSync(tmp, { recursive: true, force: true })
  assert.equal(r.status, 0, `py_compile 失败: ${r.stderr}`)
})

test('sync: --check 同步时退出 0', () => {
  const r = spawnSync('node', [syncPath, '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, `--check 应退出 0: ${r.stderr}`)
})

test('sync: CLI 真源改动后 --check 漂移非零退出（自动恢复）', () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-cli-'))
  const backup = join(tmp, 'dsh-vision.bak')
  copyFileSync(cliPath, backup)
  const cli = readFileSync(cliPath, 'utf8')
  try {
    writeFileSync(cliPath, cli.replace('dsh-vision', 'dsh-vision-drift-test'))
    const r = spawnSync('node', [syncPath, '--check'], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, '漂移时 --check 必须非零退出')
    assert.match(r.stderr + r.stdout, /DRIFT/)
  } finally {
    copyFileSync(backup, cliPath)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('sync: 插件定位项目 CLI 的层级正确（../../cli/dsh-vision）', () => {
  const src = readFileSync(pluginPath, 'utf8')
  assert.match(src, /new URL\('\.\.\/\.\.\/cli\/dsh-vision'/)
  const fromPluginLib = resolve(join(root, 'plugin', 'lib'), '../../cli/dsh-vision')
  assert.equal(resolve(fromPluginLib), resolve(cliPath))
})

test('sync: 恢复后的插件 JS 语法合法且 CLI 块标记各一', () => {
  const src = readFileSync(pluginPath, 'utf8')
  const r = spawnSync('node', ['--check', pluginPath], { encoding: 'utf8' })
  assert.equal(r.status, 0, `node --check 失败: ${r.stderr}`)
  assert.equal((src.match(/══ CLI_SRC_BEGIN/g) || []).length, 1)
  assert.equal((src.match(/══ CLI_SRC_END/g) || []).length, 1)
})
