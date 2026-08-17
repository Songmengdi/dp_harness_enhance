#!/usr/bin/env node
/**
 * 同步 headless e2e profile（~/.dsh/profiles/vision-bridge-e2e）：
 * manifest + patch 写入后由 `dsh --profile vision-bridge-e2e` 直接可跑。
 * 只做本地装配，不发布任何制品。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE || '', '.dsh')
const profileDir = join(home, 'profiles', 'vision-bridge-e2e')
const port = process.env.VB_E2E_PORT ?? 41877

const manifest = {
  name: 'dsh-profile-vision-bridge-e2e',
  private: true,
  dependencies: {
    '@deepseek-ai/dsh-base': '0.1.0-rc.6',
    'dsh-vision-bridge': `link:${packageRoot}`,
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-vision-bridge'] } },
}

const patch = `# vision-bridge headless e2e profile：
# dsh-base 组合 + 按 id 覆盖 dsh-vision-bridge 装配配置（managed 关、指向本机假上游）
# + 一次性 e2e runner。由 scripts/sync-e2e-profile.mjs 生成，勿手改。
- id: dsh-vision-bridge
  config:
    managed: false
    endpoint: 'http://127.0.0.1:${port}/v1'
    model: vb-e2e-fake-vision
    credential: ''
    visionTimeoutMs: 15000
    maxRetries: 1
    glanceCacheTtlMs: 0
- insert:
    - id: vision-bridge-e2e-runner
      name: ${resolve(join(packageRoot, 'scripts', 'e2e-runner.mjs'))}
`

mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), patch)

const installed = existsSync(join(profileDir, 'node_modules', '.pnpm'))
if (!installed) {
  console.log('vision-bridge e2e: pnpm install 到 profile…')
  const r = spawnSync('pnpm', ['install', '--ignore-scripts'], { cwd: profileDir, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`vision-bridge e2e: pnpm install 失败（exit ${r.status}）`)
    process.exit(1)
  }
}
console.log(`vision-bridge e2e: profile 已同步到 ${profileDir}（假上游端口 ${port}）`)
