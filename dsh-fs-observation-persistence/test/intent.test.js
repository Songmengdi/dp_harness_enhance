/**
 * Integration tests: the real composition (dsh-fs-local provider +
 * @deepseek-ai/dsh-fs-observation-policy stock policy + this plugin) driven
 * through the real fs/* waterfalls, including the restart/resume scenario
 * this plugin exists for. Each "process" is a fresh cordis Context; a resumed
 * session is modelled as a NEW session object carrying the SAME stable id.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ObsPersist from '../lib/index.js'

const SESSION_ID = 'session-61a988bd-eadf-4657-a659-838dd7501818'

/** A fresh host "process": real provider + stock policy + this plugin. */
async function bootProcess(storageDir, cwd) {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ObsPersist, { storageDir, flushDelayMs: 1, pruneOnStart: false })
  return ctx
}

/** The opaque fs/* actor: derives owner via actor.agent.session like tool-fs. */
function actorFor(sessionId, nonce) {
  return { agent: { session: { id: sessionId, nonce } } }
}

function errCode(error) {
  return error?.code ?? /\((.*)\)/.exec(String(error?.message ?? ''))?.[1]
}

/** Poll until the session record file contains the expected key (flush landed). */
async function waitForEntry(storageDir, sessionId, targetKey, timeoutMs = 2000) {
  const file = join(storageDir, `${encodeURIComponent(sessionId)}.json`)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (parsed?.entries && targetKey in parsed.entries) return parsed
    } catch {
      /* not flushed yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`session record did not flush ${targetKey} within ${timeoutMs}ms`)
}

async function inScratch(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'fs-obs-it-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'fs-obs-store-'))
  try {
    await fn(cwd, storageDir)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
}

test('stock behaviour preserved: an unseen target still rejects with FS_NOT_OBSERVED', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx = await bootProcess(storageDir, cwd)
    const target = await ctx.fs.resolve('note.txt')
    const actor = actorFor(SESSION_ID, 'a')
    await assert.rejects(
      () => ctx.waterfall('fs/edit-intent', target, actor, () => undefined),
      (error) => errCode(error) === 'FS_NOT_OBSERVED',
    )
  })
})

test('same-process observation authorises the edit through stock state', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx = await bootProcess(storageDir, cwd)
    const target = await ctx.fs.resolve('note.txt')
    await ctx.fs.writeText(target, 'hello\n')
    const info = await ctx.fs.stat(target)
    const actor = actorFor(SESSION_ID, 'a')
    ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, actor)

    const guard = await ctx.waterfall('fs/edit-intent', target, actor, () => undefined)
    assert.equal(guard.version, info.version)
  })
})

test('restart: the persisted record authorises write/edit without any re-read', async () => {
  await inScratch(async (cwd, storageDir) => {
    // Process 1: the session reads the file (tool-fs emits fs/observed).
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(SESSION_ID, 'p1'))
    await waitForEntry(storageDir, SESSION_ID, String(target1.targetKey))

    // Process 2: same session id, brand-new session object, no observation yet.
    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    assert.equal(String(target2.targetKey), String(target1.targetKey))
    const resumed = actorFor(SESSION_ID, 'p2')

    const editGuard = await ctx2.waterfall('fs/edit-intent', target2, resumed, () => undefined)
    assert.equal(String(editGuard.version), String(info1.version))

    const writeIntent = await ctx2.waterfall('fs/write-intent', target2, resumed, () => undefined)
    assert.equal(writeIntent.kind, 'replaceIfVersion')
    assert.equal(String(writeIntent.version), String(info1.version))

    // The provider accepts both guards against the unchanged file. After a
    // successful edit tool-fs emits a fresh observation (new version); the
    // next write intent must pick that version up, not the pre-edit one.
    const outcome = await ctx2.fs.editText(target2, { oldString: 'hello', newString: 'hi' }, editGuard)
    assert.match(outcome.after, /hi/)
    ctx2.emit('fs/observed', target2, { kind: 'present', version: outcome.version }, resumed)

    const writeIntent2 = await ctx2.waterfall('fs/write-intent', target2, resumed, () => undefined)
    assert.equal(writeIntent2.kind, 'replaceIfVersion')
    assert.equal(String(writeIntent2.version), String(outcome.version))
    const writeOutcome = await ctx2.fs.writeText(target2, 'replaced\n', writeIntent2)
    assert.equal(writeOutcome.operation, 'update')
  })
})

test('restart with an externally changed file: provider CAS forces a re-read', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(SESSION_ID, 'p1'))
    await waitForEntry(storageDir, SESSION_ID, String(target1.targetKey))

    // External mutation between the observation and the resumed write.
    await writeFile(join(cwd, 'note.txt'), 'changed externally\n')

    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const resumed = actorFor(SESSION_ID, 'p2')
    const editGuard = await ctx2.waterfall('fs/edit-intent', target2, resumed, () => undefined)
    const writeIntent = await ctx2.waterfall('fs/write-intent', target2, resumed, () => undefined)

    await assert.rejects(
      () => ctx2.fs.editText(target2, { oldString: 'hello', newString: 'hi' }, editGuard),
      (error) => errCode(error) === 'FS_STALE_VERSION',
    )
    await assert.rejects(
      () => ctx2.fs.writeText(target2, 'replaced\n', writeIntent),
      (error) => errCode(error) === 'FS_STALE_VERSION',
    )
  })
})

test('a post-restart absent observation invalidates the persisted record (no stale loop)', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(SESSION_ID, 'p1'))
    await waitForEntry(storageDir, SESSION_ID, String(target1.targetKey))

    // Process 2: the resumed session tries to read and observes the file gone.
    await rm(join(cwd, 'note.txt'), { force: true })
    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const resumed = actorFor(SESSION_ID, 'p2')

    // Before the absent observation the persisted guard still applies, and the
    // provider reports stale (file no longer exists) — the model re-reads…
    const guard = await ctx2.waterfall('fs/edit-intent', target2, resumed, () => undefined)
    await assert.rejects(
      () => ctx2.fs.editText(target2, { oldString: 'hello', newString: 'hi' }, guard),
      (error) => errCode(error) === 'FS_STALE_VERSION',
    )

    // …which observes absence; the record must vanish so the NEXT write intent
    // resolves to createIfAbsent instead of looping on the stale guard.
    ctx2.emit('fs/observed', target2, { kind: 'absent' }, resumed)
    await waitForEntryFlushAbsent(storageDir, SESSION_ID, String(target2.targetKey))

    const writeIntent = await ctx2.waterfall('fs/write-intent', target2, resumed, () => undefined)
    assert.equal(writeIntent.kind, 'createIfAbsent')
    const created = await ctx2.fs.writeText(target2, 'recreated\n', writeIntent)
    assert.equal(created.operation, 'create')
  })
})

/** Poll until the session record no longer contains the key. */
async function waitForEntryFlushAbsent(storageDir, sessionId, targetKey, timeoutMs = 2000) {
  const file = join(storageDir, `${encodeURIComponent(sessionId)}.json`)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (!(targetKey in (parsed?.entries ?? {}))) return
    } catch {
      /* not flushed yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`session record did not drop ${targetKey} within ${timeoutMs}ms`)
}

test('sessions are isolated: another session id finds no record', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(SESSION_ID, 'p1'))
    await waitForEntry(storageDir, SESSION_ID, String(target1.targetKey))

    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const other = actorFor('session-00000000-other', 'p2')
    const writeIntent = await ctx2.waterfall('fs/write-intent', target2, other, () => undefined)
    assert.equal(writeIntent.kind, 'createIfAbsent') // stock fallback: unseen session
  })
})

test('actor without a session id delegates to stock behaviour', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx = await bootProcess(storageDir, cwd)
    const target = await ctx.fs.resolve('note.txt')
    await ctx.fs.writeText(target, 'hello\n')
    await assert.rejects(
      () => ctx.waterfall('fs/edit-intent', target, {}, () => undefined),
      (error) => errCode(error) === 'FS_NOT_OBSERVED',
    )
  })
})

const PARENT_ID = 'session-11111111-parent'
const FORK_ID = 'session-22222222-fork'

/** A fork actor: new id, parentSession header, no subagent markers.
 * Matches the REAL GUI fork header, which persists delegationDepth: 0. */
function forkActorFor(nonce) {
  return { agent: { session: { id: FORK_ID, header: { parentSession: PARENT_ID, delegationDepth: 0 } } } }
}

test('fork inherits the parent session records on lookup (one hop, unchanged file)', async () => {
  await inScratch(async (cwd, storageDir) => {
    // Parent observes the file in an earlier process.
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))

    // A later process: the fork (no observation of its own) edits directly.
    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const fork = forkActorFor('p2')
    const guard = await ctx2.waterfall('fs/edit-intent', target2, fork, () => undefined)
    assert.equal(String(guard.version), String(info1.version))
    const outcome = await ctx2.fs.editText(target2, { oldString: 'hello', newString: 'hi' }, guard)
    assert.match(outcome.after, /hi/)
  })
})

test('subagent children never inherit even though they also set parentSession', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))

    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const subagent = {
      agent: { session: { id: 'session-33333333-child', header: { parentSession: PARENT_ID, origin: 'subagent', delegationDepth: 1 } } },
    }
    await assert.rejects(
      () => ctx2.waterfall('fs/edit-intent', target2, subagent, () => undefined),
      (error) => errCode(error) === 'FS_NOT_OBSERVED',
    )
  })
})

test('fork own observations beat the inherited parent record', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))

    // The fork itself edits the file: its own record now carries the new version.
    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const fork = forkActorFor('p2')
    const guard1 = await ctx2.waterfall('fs/edit-intent', target2, fork, () => undefined)
    const outcome = await ctx2.fs.editText(target2, { oldString: 'hello', newString: 'hi' }, guard1)
    ctx2.emit('fs/observed', target2, { kind: 'present', version: outcome.version }, fork)
    await waitForEntry(storageDir, FORK_ID, String(target2.targetKey))

    const guard2 = await ctx2.waterfall('fs/edit-intent', target2, fork, () => undefined)
    assert.equal(String(guard2.version), String(outcome.version))
    assert.notEqual(String(guard2.version), String(info1.version))
  })
})

test('inheritForkObservations=false restores strict fork isolation', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))

    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd })
    await ctx.plugin(FsPolicy)
    await ctx.plugin(ObsPersist, { storageDir, flushDelayMs: 1, pruneOnStart: false, inheritForkObservations: false })
    const target = await ctx.fs.resolve('note.txt')
    await assert.rejects(
      () => ctx.waterfall('fs/edit-intent', target, forkActorFor('x'), () => undefined),
      (error) => errCode(error) === 'FS_NOT_OBSERVED',
    )
  })
})

test('fork observing absence drops the inherited parent entry (recreate without stale loop)', async () => {
  await inScratch(async (cwd, storageDir) => {
    // Parent observed the file; it is then deleted externally.
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))
    await rm(join(cwd, 'note.txt'))

    // The fork (new process) observes the absence while trying to read.
    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const fork = forkActorFor('p2')
    ctx2.emit('fs/observed', target2, { kind: 'absent' }, fork)
    await waitForEntryFlushAbsent(storageDir, PARENT_ID, String(target2.targetKey))

    // The recreate write must NOT inherit the dead parent version.
    const writeIntent = await ctx2.waterfall('fs/write-intent', target2, fork, () => undefined)
    assert.equal(writeIntent.kind, 'createIfAbsent')
    const created = await ctx2.fs.writeText(target2, 'recreated\n', writeIntent)
    assert.equal(created.operation, 'create')
  })
})

test('subagent observing absence leaves the parent record intact', async () => {
  await inScratch(async (cwd, storageDir) => {
    const ctx1 = await bootProcess(storageDir, cwd)
    const target1 = await ctx1.fs.resolve('note.txt')
    await ctx1.fs.writeText(target1, 'hello\n')
    const info1 = await ctx1.fs.stat(target1)
    ctx1.emit('fs/observed', target1, { kind: 'present', version: info1.version }, actorFor(PARENT_ID, 'p1'))
    await waitForEntry(storageDir, PARENT_ID, String(target1.targetKey))
    await rm(join(cwd, 'note.txt'))

    const ctx2 = await bootProcess(storageDir, cwd)
    const target2 = await ctx2.fs.resolve('note.txt')
    const subagent = {
      agent: {
        session: {
          id: 'session-33333333-child',
          header: { parentSession: PARENT_ID, origin: 'subagent', delegationDepth: 1 },
        },
      },
    }
    ctx2.emit('fs/observed', target2, { kind: 'absent' }, subagent)
    await new Promise((resolve) => setTimeout(resolve, 20))

    // The parent's own record survives a delegated child's absence.
    const parentWrite = await ctx2.waterfall('fs/write-intent', target2, actorFor(PARENT_ID, 'p2'), () => undefined)
    assert.equal(parentWrite.kind, 'replaceIfVersion')
    assert.equal(String(parentWrite.version), String(info1.version))
  })
})
