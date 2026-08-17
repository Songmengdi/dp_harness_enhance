#!/usr/bin/env node
/**
 * 05 票验收：干净 DSH_HOME 全生命周期 e2e。
 *
 * 在一个全新的临时 DSH_HOME 里从零走完：
 *   本地安装（manifest + pnpm）→ 装配可见（dump-config）→ 激活 + 真实工具调用（runner）
 *   → 禁用（disabled 行，断言无工具）→ 重新启用（再次全链路 PASS）→ 卸载（remove 后装配清单无残留）。
 * 全部在临时目录进行；只做本地装配，无任何发布动作。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = process.env.VB_E2E_PORT ?? 41877
const report = { name: 'clean-home-e2e', pass: false, steps: [] }

function step(label, ok, evidence = '') {
  report.steps.push({ label, ok, evidence: String(evidence).slice(0, 400) })
  console.log(`[clean-home-e2e] ${ok ? 'PASS' : 'FAIL'} ${label}${evidence ? ' — ' + evidence : ''}`)
  if (!ok) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }
}

function run(label, command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', ...options })
  return r
}

function main() {
  const home = mkdtempSync(join(os.tmpdir(), 'vb-clean-home-'))
  const profileDir = join(home, 'profiles', 'vision-bridge-e2e')
  const env = { ...process.env, DSH_HOME: home }
  try {
    mkdirSync(profileDir, { recursive: true })
    const manifest = {
      name: 'dsh-profile-vision-bridge-e2e',
      private: true,
      dependencies: {
        '@deepseek-ai/dsh-base': '0.1.0-rc.6',
        'dsh-vision-bridge': `link:${packageRoot}`,
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-vision-bridge'] } },
    }
    const patch = `# clean-home e2e（由 scripts/clean-home-e2e.mjs 生成）
- id: dsh-vision-bridge
  config:
    managed: false
    endpoint: 'http://127.0.0.1:${PORT}/v1'
    model: vb-e2e-fake-vision
    credential: ''
    visionTimeoutMs: 15000
    maxRetries: 1
    glanceCacheTtlMs: 0
- insert:
    - id: vision-bridge-e2e-runner
      name: ${resolve(join(packageRoot, 'scripts', 'e2e-runner.mjs'))}
`
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), patch)

    // 1. 本地安装
    const install = run('pnpm install', 'pnpm', ['install', '--ignore-scripts'], { cwd: profileDir })
    step('本地安装（pnpm install）', install.status === 0, install.stderr?.slice(-200) ?? '')

    // 2. 装配可见
    const dump = run('dump-config', 'dsh', ['--profile', 'vision-bridge-e2e', '--dump-config'], { env })
    step('装配可见（dump-config 含 dsh-vision-bridge 层）', dump.status === 0 && dump.stdout.includes('dsh-vision-bridge'), 'exit=' + dump.status)

    // 3. 激活 + 真实工具调用（runner 全链路）
    const boot = run('boot', 'dsh', ['--profile', 'vision-bridge-e2e', 'run-vision-bridge-e2e'], { env })
    const bootLine = boot.stdout.split('\n').find((l) => l.startsWith('VISION_BRIDGE_E2E_REPORT '))
    const bootReport = bootLine ? JSON.parse(bootLine.slice('VISION_BRIDGE_E2E_REPORT '.length)) : null
    step('激活 + 真实工具调用全链路', boot.status === 0 && bootReport?.pass === true, boot.stderr?.slice(-300) ?? '')

    // 4. 禁用
    const disablePatch = join(home, 'disable-vision.yml')
    writeFileSync(disablePatch, '- id: dsh-vision-bridge\n  disabled: true\n')
    const disabled = run('disabled-boot', 'dsh', ['--profile', 'vision-bridge-e2e', '--patch', disablePatch, 'run-vision-bridge-e2e'], { env: { ...env, VB_EXPECT_DISABLED: '1' } })
    const disabledLine = disabled.stdout.split('\n').find((l) => l.startsWith('VISION_BRIDGE_E2E_REPORT '))
    const disabledReport = disabledLine ? JSON.parse(disabledLine.slice('VISION_BRIDGE_E2E_REPORT '.length)) : null
    step('禁用（disabled 行生效、无 vision_* 工具）', disabled.status === 0 && disabledReport?.pass === true, disabled.stderr?.slice(-300) ?? '')

    // 5. 重新启用
    const reenabled = run('re-enabled-boot', 'dsh', ['--profile', 'vision-bridge-e2e', 'run-vision-bridge-e2e'], { env })
    const reenabledLine = reenabled.stdout.split('\n').find((l) => l.startsWith('VISION_BRIDGE_E2E_REPORT '))
    const reenabledReport = reenabledLine ? JSON.parse(reenabledLine.slice('VISION_BRIDGE_E2E_REPORT '.length)) : null
    step('重新启用后全链路再次 PASS', reenabled.status === 0 && reenabledReport?.pass === true, reenabled.stderr?.slice(-300) ?? '')

    // 6. 卸载（dsh plugin remove = pnpm remove + bundles 清单 reconcile）
    const remove = run('dsh plugin remove', 'dsh', ['plugin', '--profile', 'vision-bridge-e2e', 'remove', 'dsh-vision-bridge'], { env })
    step('卸载（pnpm remove）', remove.status === 0, remove.stderr?.slice(-200) ?? '')
    const dumpAfter = run('dump-config-after', 'dsh', ['--profile', 'vision-bridge-e2e', '--dump-config'], { env })
    step('卸载后装配清单无残留', dumpAfter.status === 0 && !dumpAfter.stdout.includes('dsh-vision-bridge'), '')
    step('全程无发布动作（仅本地 manifest/pnpm）', true, `home=${home}`)

    report.pass = true
    console.log('CLEAN_HOME_E2E_REPORT ' + JSON.stringify(report))
    process.exit(0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

main()
