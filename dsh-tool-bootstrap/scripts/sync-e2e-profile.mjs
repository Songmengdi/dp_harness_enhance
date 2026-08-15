#!/usr/bin/env node
/**
 * Sync the bundled `anchored-e2e` profile into the harness home and install
 * its dependencies. The patch's runner row carries the `__E2E_RUNNER__`
 * token; substitution points it at this checkout's e2e-runner.mjs.
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(projectDir, 'e2e-profile')
const runnerEntry = join(projectDir, 'scripts/e2e-runner.mjs')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const target = join(dshHome, 'profiles', 'anchored-e2e')

export async function syncE2eProfile() {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(sourceDir)) {
    const from = join(sourceDir, entry)
    const to = join(target, entry)
    if (entry === 'cordis.patch.yml') {
      const text = (await readFile(from, 'utf8')).replace('name: __E2E_RUNNER__', `name: ${runnerEntry}`)
      await writeFile(to, text)
    } else {
      await copyFile(from, to)
    }
  }
  const install = spawnSync('pnpm', ['install'], { cwd: target, stdio: 'inherit' })
  if (install.status !== 0) throw new Error(`pnpm install failed with status ${install.status}`)
  return target
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const synced = await syncE2eProfile()
  console.log(`synced anchored-e2e profile -> ${synced}`)
  console.log(`runner row -> ${runnerEntry}`)
}
