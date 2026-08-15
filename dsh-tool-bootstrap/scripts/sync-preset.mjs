#!/usr/bin/env node
/**
 * Sync the bundled anchored user presets into the harness home.
 *
 * Each directory under `presets/` is one user preset: its composition's
 * plugin row carries the `__TOOL_BOOTSTRAP_LIB__` token; substitution replaces
 * the row's `name:` with the absolute path of this project's built lib so the
 * preset resolves the plugin straight from this checkout — a rebuild plus a
 * new session (and a `dsh web` restart for host-code changes) picks it up,
 * with no copied artifact drifting. Extra entries beside the two owned files
 * (e.g. the `skills/` directory travelling with anchored-cordis) are copied
 * verbatim.
 *
 * Idempotent: rewrites only the files this project owns per preset
 * (`agent.cordis.yml`, `preset.yml`) plus the preset's own extra assets.
 */
import { cp, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const presetsRoot = join(projectDir, 'presets')

/** 默认不安装的 preset id(代码保留,作为可选实验变体)。 */
export const SKIPPED_PRESET_IDS = ['tool-bootstrap-zero-standard']

/**
 * Replace the plugin row's module token.
 * - dev mode(default): the built entry path in this checkout;
 * - release mode(SYNC_RELEASE=1 / release: true): the published package name,
 *   resolved from the profile where `dsh plugin add` installed the tag.
 */
export function substitute(composition, libEntry = resolve(projectDir, 'lib/index.js'), release = process.env.SYNC_RELEASE === '1') {
  const specifier = release ? 'dsh-tool-bootstrap' : libEntry
  return composition.replace('name: __TOOL_BOOTSTRAP_LIB__', `name: ${specifier}`)
}

export async function listPresetIds() {
  const entries = await readdir(presetsRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

export async function syncPreset({
  dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  presetId,
  libEntry,
  release = process.env.SYNC_RELEASE === '1',
} = {}) {
  const source = join(presetsRoot, presetId)
  const target = join(dshHome, '.agent-presets', presetId)
  const [composition] = await Promise.all([
    readFile(join(source, 'agent.cordis.yml'), 'utf8'),
    mkdir(target, { recursive: true }),
  ])
  await writeFile(join(target, 'agent.cordis.yml'), substitute(composition, libEntry, release))
  for (const entry of await readdir(source)) {
    if (entry === 'agent.cordis.yml') continue
    const from = join(source, entry)
    const to = join(target, entry)
    if ((await stat(from)).isDirectory()) await cp(from, to, { recursive: true, force: true })
    else await copyFile(from, to)
  }
  return target
}

export async function syncAllPresets(options = {}) {
  const includeSkipped = options.includeSkipped === true || process.env.SYNC_ZERO_PRESET === '1'
  const ids = (await listPresetIds()).filter((presetId) => includeSkipped || !SKIPPED_PRESET_IDS.includes(presetId))
  return Promise.all(ids.map((presetId) => syncPreset({ ...options, presetId })))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = await syncAllPresets()
  const mode = process.env.SYNC_RELEASE === '1' ? 'release (dsh-tool-bootstrap package)' : 'dev (checkout lib path)'
  console.log(`synced ${targets.length} tool-bootstrap preset(s) -> ${join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.agent-presets')}`)
  console.log(`mode: ${mode}`)
  if (process.env.SYNC_ZERO_PRESET !== '1') {
    console.log(`skipped: ${SKIPPED_PRESET_IDS.join(', ')} (set SYNC_ZERO_PRESET=1 to include)`)
  }
}
