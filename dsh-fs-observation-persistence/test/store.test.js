/**
 * Unit tests for the persistence store: restart round-trip, absent
 * invalidation, pending-ops-before-load, recency eviction, prune.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionObsStore, defaultStorageDir } from '../lib/store.js'

async function tmpDir() {
  return mkdtemp(join(tmpdir(), 'fs-obs-store-'))
}

function mkStore(dir, overrides = {}) {
  return new SessionObsStore({
    dir,
    flushDelayMs: 1,
    maxEntriesPerSession: 100,
    maxSessionsInMemory: 8,
    ...overrides,
  })
}

test('records survive a restart (new store instance, same directory)', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-1', '/tmp/alpha.txt', 'v1')
    a.record('session-1', '/tmp/beta.txt', 'v2')
    a.record('session-2', '/tmp/alpha.txt', 'v3')
    await a.dispose()

    const b = mkStore(dir)
    assert.equal(await b.get('session-1', '/tmp/alpha.txt'), 'v1')
    assert.equal(await b.get('session-1', '/tmp/beta.txt'), 'v2')
    assert.equal(await b.get('session-2', '/tmp/alpha.txt'), 'v3')
    assert.equal(await b.get('session-1', '/tmp/missing.txt'), undefined)
    assert.equal(await b.get('session-9', '/tmp/alpha.txt'), undefined)
    await b.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('absent observations delete the persisted entry', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-1', '/tmp/alpha.txt', 'v1')
    a.remove('session-1', '/tmp/alpha.txt')
    await a.dispose()

    const b = mkStore(dir)
    assert.equal(await b.get('session-1', '/tmp/alpha.txt'), undefined)
    await b.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('remove on a not-yet-loaded session applies after load (restart invalidation)', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-1', '/tmp/alpha.txt', 'v1')
    await a.dispose()

    // Fresh process: remove arrives before any get() loaded the session file.
    const b = mkStore(dir)
    b.remove('session-1', '/tmp/alpha.txt')
    assert.equal(await b.get('session-1', '/tmp/alpha.txt'), undefined)
    await b.dispose()

    const c = mkStore(dir)
    assert.equal(await c.get('session-1', '/tmp/alpha.txt'), undefined)
    await c.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('record on a not-yet-loaded session is visible to get and persisted', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-1', '/tmp/alpha.txt', 'v1')
    a.record('session-1', '/tmp/beta.txt', 'v2')
    await a.dispose()

    const b = mkStore(dir)
    // record() before any load queues as a pending op; get() loads then applies.
    b.record('session-1', '/tmp/beta.txt', 'v2-new')
    assert.equal(await b.get('session-1', '/tmp/beta.txt'), 'v2-new')
    assert.equal(await b.get('session-1', '/tmp/alpha.txt'), 'v1')
    await b.dispose()

    const c = mkStore(dir)
    assert.equal(await c.get('session-1', '/tmp/beta.txt'), 'v2-new')
    await c.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('per-session entry cap evicts least-recently-observed first', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir, { maxEntriesPerSession: 2 })
    a.record('session-1', '/tmp/a.txt', 'v1')
    a.record('session-1', '/tmp/b.txt', 'v2')
    a.record('session-1', '/tmp/a.txt', 'v1') // refresh a's recency
    a.record('session-1', '/tmp/c.txt', 'v3') // evicts b, not a
    await a.dispose()

    const b = mkStore(dir, { maxEntriesPerSession: 2 })
    assert.equal(await b.get('session-1', '/tmp/a.txt'), 'v1')
    assert.equal(await b.get('session-1', '/tmp/b.txt'), undefined)
    assert.equal(await b.get('session-1', '/tmp/c.txt'), 'v3')
    await b.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('flush writes one parseable JSON file per session', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-1', '/tmp/a.txt', 'v1')
    await a.dispose()

    const names = await readdir(dir)
    assert.deepEqual(names, ['session-1.json'])
    const parsed = JSON.parse(await readFile(join(dir, 'session-1.json'), 'utf8'))
    assert.equal(parsed.v, 1)
    assert.deepEqual(parsed.entries, { '/tmp/a.txt': 'v1' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('prune removes session files older than maxAgeDays', async () => {
  const dir = await tmpDir()
  try {
    const a = mkStore(dir)
    a.record('session-old', '/tmp/a.txt', 'v1')
    a.record('session-new', '/tmp/b.txt', 'v2')
    await a.dispose()

    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await utimes(join(dir, 'session-old.json'), old, old)

    const pruner = mkStore(dir)
    const removed = await pruner.prune(30)
    assert.equal(removed, 1)
    assert.deepEqual(await readdir(dir), ['session-new.json'])
    await pruner.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('corrupt session files read as empty, not as errors', async () => {
  const dir = await tmpDir()
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'session-1.json'), '{not json')
    const a = mkStore(dir)
    assert.equal(await a.get('session-1', '/tmp/a.txt'), undefined)
    await a.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('defaultStorageDir honours DSH_HOME', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/dsh-home-x'
    assert.equal(defaultStorageDir(), join('/tmp/dsh-home-x', 'storages', 'dsh-fs-observation-persistence'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
