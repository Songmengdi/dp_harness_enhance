/**
 * Discovery tests: the production roster code (@deepseek-ai/dsh-agent-presets
 * scanRoot) must accept every bundled anchored preset as a healthy user
 * preset — valid entry-list YAML (including the `!!js` rows copied from the
 * shipped compositions), sane rows, and metadata from preset.yml. A control
 * preset with a broken composition proves the check is not vacuous.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanRoot } from '@deepseek-ai/dsh-agent-presets'

import { listPresetIds, presetsRoot, substitute } from '../scripts/sync-preset.mjs'

async function rootWithPreset(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-bootstrap-presets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

const PRESETS = await listPresetIds()

test('the bundled preset collection is discovered as healthy', async (t) => {
  assert.ok(PRESETS.includes('tool-bootstrap-standard'), 'tool-bootstrap-standard must ship')
  assert.ok(PRESETS.includes('tool-bootstrap-cordis'), 'tool-bootstrap-cordis must ship')
  assert.ok(PRESETS.includes('tool-bootstrap-zero-standard'), 'tool-bootstrap-zero-standard must ship')
  const root = await rootWithPreset(t)

  const ids = []
  for (const presetId of PRESETS) {
    const source = join(presetsRoot, presetId)
    const dir = join(root, presetId)
    await mkdir(dir)
    await writeFile(join(dir, 'agent.cordis.yml'), substitute(await readFile(join(source, 'agent.cordis.yml'), 'utf8'), '/tmp/tool-bootstrap-lib/index.js'))
    for (const entry of ['preset.yml', 'skills']) {
      const from = join(source, entry)
      if (await stat(from).then(() => true, () => false)) {
        if ((await stat(from)).isDirectory()) await cp(from, join(dir, entry), { recursive: true })
        else await copyFile(from, join(dir, entry))
      }
    }
    ids.push(presetId)
  }

  const discovered = await scanRoot({ path: root, trust: 'user' })
  assert.deepEqual(discovered.map((preset) => preset.id).sort(), ids.slice().sort())
  for (const preset of discovered) {
    assert.equal(preset.broken, undefined, `${preset.id} must be healthy`)
    assert.ok(preset.name.length > 0, `${preset.id} must publish a name`)
    assert.equal(typeof preset.order, 'number', `${preset.id} must declare an order`)
  }

  const cordis = discovered.find((preset) => preset.id === 'tool-bootstrap-cordis')
  assert.match(cordis.description, /cordis/)
  const standard = discovered.find((preset) => preset.id === 'tool-bootstrap-standard')
  assert.match(standard.description, /Standard/)
  const zero = discovered.find((preset) => preset.id === 'tool-bootstrap-zero-standard')
  assert.match(zero.description, /0 工具/)
})

test('a malformed composition is reported broken, so the check is not vacuous', async (t) => {
  const root = await rootWithPreset(t)
  const dir = join(root, 'broken-preset')
  await mkdir(dir)
  await writeFile(join(dir, 'agent.cordis.yml'), '{{{{ not: [valid, yaml\n')

  const [preset] = await scanRoot({ path: root, trust: 'user' })
  assert.equal(preset.id, 'broken-preset')
  assert.match(preset.broken, /not valid YAML/)
})
