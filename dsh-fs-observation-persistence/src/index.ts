/**
 * Persistent observed-state overlay for the dsh fs policy layer.
 *
 * `@deepseek-ai/dsh-fs-observation-policy` keeps its observed-state in a
 * WeakMap keyed by the live session object, so a resumed session (new process,
 * rebuilt session) starts unseen and every edit fails with `FS_NOT_OBSERVED`
 * until each target is re-read. This plugin closes that gap:
 *
 * - `fs/observed` (recorder, plain listener) mirrors each session's positive
 *   observations into a per-session JSON file and forgets targets observed
 *   absent.
 * - `fs/{write,edit}-intent` (deciders, prepended) consult that record only
 *   when they can add information, and otherwise delegate via `next()` to the
 *   stock policy listener — same-process behaviour is bit-for-bit stock.
 *
 * A persisted record is never trusted for freshness: the version string is
 * handed straight to the provider's compare-and-swap guard, so a file changed
 * (or replaced, or deleted) since the recorded observation still fails with
 * `FS_STALE_VERSION` and forces a re-read. Persistence widens only *which*
 * edits may be attempted, never *which* edits may land.
 *
 * A forked session (new id, `parentSession` header, no `origin: 'subagent'`)
 * inherits its parent's records on lookup — one hop, own observations first —
 * because its conversation history already contains the parent's reads.
 * Subagent children are excluded by their `origin`/`delegationDepth` markers
 * even though they also set `parentSession`.
 *
 * Removal is graceful: the stock policy keeps recording its own in-memory
 * state while this plugin is active, so uninstalling it restores stock
 * behaviour without even losing same-session observations.
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import Schema from '@deepseek-ai/schemastery'
import { defaultStorageDir, SessionObsStore } from './store.js'

export const name = 'fs-observation-persistence'

export const Config = Schema.object({
  storageDir: Schema.string()
    .default('')
    .description(
      'Directory for per-session observation records. Empty derives the default ' +
        '`$DSH_HOME/storages/dsh-fs-observation-persistence` (falling back to `~/.dsh`).',
    ),
  flushDelayMs: Schema.number()
    .default(250)
    .min(0)
    .description('Debounce window (ms) trailing the last observation before the session record is flushed to disk.'),
  maxAgeDays: Schema.number()
    .default(30)
    .min(1)
    .description('Session observation files untouched for longer than this are pruned at startup.'),
  pruneOnStart: Schema.boolean().default(true).description('Prune stale session observation files when the plugin starts.'),
  maxEntriesPerSession: Schema.number()
    .default(2000)
    .min(1)
    .description('Cap on remembered targets per session; least-recently-observed entries are evicted first.'),
  maxSessionsInMemory: Schema.number()
    .default(64)
    .min(1)
    .description('Cap on session records held in memory (disk files are unaffected).'),
  inheritForkObservations: Schema.boolean().default(true).description(
    'Let a forked session inherit its parent session records on lookup (one hop; own observations always win). ' +
      'Subagent sessions never inherit regardless of this flag.',
  ),
})

export interface FsObsPersistenceConfig {
  storageDir: string
  flushDelayMs: number
  maxAgeDays: number
  pruneOnStart: boolean
  maxEntriesPerSession: number
  maxSessionsInMemory: number
  inheritForkObservations: boolean
}

/** The opaque `fs/*` event actor: derive the session owner's identity and fork lineage. */
function lineageOf(actor: object | undefined):
  | { id: string; parentSession: string | undefined; subagent: boolean }
  | undefined {
  const session = (actor as { agent?: { session?: unknown } } | undefined)?.agent?.session
  if (typeof session !== 'object' || session === null) return undefined
  const id = (session as { id?: unknown }).id
  if (typeof id !== 'string' || id.length === 0) return undefined
  const header = (session as { header?: { parentSession?: unknown; origin?: unknown; delegationDepth?: unknown } })
    .header
  const parent = header?.parentSession
  // Subagent children ALSO set parentSession. The reliable marker is
  // `origin: 'subagent'` (set only by delegation); `delegationDepth` alone is
  // NOT — a GUI fork persists depth 0 for its top-level parent, so a nonzero
  // depth is required for that signal. Inheritance must never reach a
  // delegated child: its parent's reads do not authorise it.
  const subagent =
    header?.origin === 'subagent' ||
    (typeof header?.delegationDepth === 'number' && (header as { delegationDepth: number }).delegationDepth > 0)
  return {
    id,
    parentSession: typeof parent === 'string' && parent.length > 0 ? parent : undefined,
    subagent,
  }
}

export function apply(ctx: Context, config: FsObsPersistenceConfig) {
  const store = new SessionObsStore({
    dir: config.storageDir || defaultStorageDir(),
    flushDelayMs: config.flushDelayMs,
    maxEntriesPerSession: config.maxEntriesPerSession,
    maxSessionsInMemory: config.maxSessionsInMemory,
  })
  ctx.effect(() => () => void store.dispose(), 'fs-observation-persistence store teardown')
  if (config.pruneOnStart) void store.prune(config.maxAgeDays)

  // Recorder: the fs/observed contract requires synchronous listeners that
  // never throw into the tool call; record/remove only touch memory and arm
  // the debounced flush.
  ctx.on('fs/observed', (target, observation, actor) => {
    const lineage = lineageOf(actor)
    if (lineage === undefined) return
    const targetKey = String(target.targetKey)
    if (observation.kind === 'present') {
      store.record(lineage.id, targetKey, String(observation.version))
    } else {
      store.remove(lineage.id, targetKey)
      // Absence is a filesystem fact, not session state: a present record for
      // a now-missing target is CAS-dead for every session holding it. Drop
      // it from the inheritable parent too, or a fork that observed the
      // absence could never recreate the file — its write intent would keep
      // inheriting the dead version and fail FS_STALE_VERSION forever.
      if (config.inheritForkObservations && !lineage.subagent && lineage.parentSession !== undefined) {
        store.remove(lineage.parentSession, targetKey)
      }
    }
  })

  // Lookup order: the session's own record always wins; a fork (never a
  // subagent) may fall back one hop to its parent's record. The returned
  // version is a CAS basis, not a freshness claim.
  const persistedVersion = async (
    lineage: { id: string; parentSession: string | undefined; subagent: boolean },
    targetKey: string,
  ): Promise<string | undefined> => {
    const own = await store.get(lineage.id, targetKey)
    if (own !== undefined) return own
    if (!config.inheritForkObservations) return undefined
    if (lineage.subagent || lineage.parentSession === undefined) return undefined
    return store.get(lineage.parentSession, targetKey)
  }

  // Deciders (prepended ahead of the stock policy listener): answer from the
  // persisted record only on a hit; every miss — no owner, no record, or no
  // inheritable parent record — falls through to next() and stock behaviour.
  // The provider rejects stale guards with FS_STALE_VERSION.
  ctx.on(
    'fs/edit-intent',
    async (target, actor, next) => {
      const lineage = lineageOf(actor)
      if (lineage === undefined) return next()
      const version = await persistedVersion(lineage, String(target.targetKey))
      if (version === undefined) return next()
      return { version: FsVersion(version) }
    },
    { prepend: true },
  )

  ctx.on(
    'fs/write-intent',
    async (target, actor, next) => {
      const lineage = lineageOf(actor)
      if (lineage === undefined) return next()
      const version = await persistedVersion(lineage, String(target.targetKey))
      if (version === undefined) return next()
      return { kind: 'replaceIfVersion', version: FsVersion(version) }
    },
    { prepend: true },
  )
}
