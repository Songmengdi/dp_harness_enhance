/**
 * Per-session persisted fs observation records.
 *
 * One JSON file per session id, stored under a configurable directory. Each
 * file maps `targetKey -> FsVersion` for targets the session last observed
 * present. Absent observations delete the entry. Files are written atomically
 * (temp file + rename) through a serialized flush chain; reads lazy-load the
 * session file on first access so a fresh process only pays for sessions it
 * actually touches.
 *
 * This module is deliberately framework-free: it knows nothing about Cordis
 * events, so its invariants (round-trip across restart, recency eviction,
 * pending-ops-before-load) are unit-testable in isolation.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** On-disk record version; a future format change bumps this and discards older files. */
const FORMAT_VERSION = 1

/** A mutation queued before a session's file has been loaded. */
type PendingOp = { kind: 'set'; targetKey: string; version: string } | { kind: 'del'; targetKey: string }

export interface SessionObsStoreOptions {
  /** Directory holding one `<encoded-session-id>.json` per session. */
  dir: string
  /** Debounce window (ms) trailing the last record before a flush is scheduled. */
  flushDelayMs: number
  /** Cap on remembered targets per session; least-recently-observed evicted first. */
  maxEntriesPerSession: number
  /** Cap on sessions held in memory; least-recently-touched evicted first (disk files stay). */
  maxSessionsInMemory: number
}

/** Derive the default storage directory from `DSH_HOME` (or `~/.dsh`). */
export function defaultStorageDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-fs-observation-persistence')
}

/** Encode a session id into a filename-safe segment. */
function fileNameFor(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.json`
}

export class SessionObsStore {
  private readonly opts: SessionObsStoreOptions
  /** Loaded sessions: targetKey -> version, insertion order = recency. */
  private readonly sessions = new Map<string, Map<string, string>>()
  /** Session ids whose file needs writing at the next flush. */
  private readonly dirty = new Set<string>()
  /** Load in flight per session id. */
  private readonly loading = new Map<string, Promise<void>>()
  /** Mutations queued before load completion; applied in order after loading. */
  private readonly pending = new Map<string, PendingOp[]>()
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Serializes flushes so renames never interleave for the same file. */
  private flushChain: Promise<void> = Promise.resolve()
  private disposed = false
  private tmpCounter = 0

  constructor(opts: SessionObsStoreOptions) {
    this.opts = opts
  }

  /** Look up the persisted version for one target of one session. */
  async get(sessionId: string, targetKey: string): Promise<string | undefined> {
    if (this.disposed) return undefined
    await this.ensureLoaded(sessionId)
    return this.sessions.get(sessionId)?.get(targetKey)
  }

  /** Record a present observation. Synchronous recorder contract: never awaits. */
  record(sessionId: string, targetKey: string, version: string): void {
    if (this.disposed) return
    if (this.sessions.has(sessionId)) {
      this.applySet(sessionId, targetKey, version)
    } else {
      this.queuePending(sessionId, { kind: 'set', targetKey, version })
    }
    this.touchSession(sessionId)
    this.dirty.add(sessionId)
    this.scheduleFlush()
  }

  /** Record an absent observation: forget the target. Synchronous recorder contract. */
  remove(sessionId: string, targetKey: string): void {
    if (this.disposed) return
    if (this.sessions.has(sessionId)) {
      this.sessions.get(sessionId)!.delete(targetKey)
    } else {
      this.queuePending(sessionId, { kind: 'del', targetKey })
    }
    this.dirty.add(sessionId)
    this.scheduleFlush()
  }

  /** Best-effort deletion of session files not touched within `maxAgeDays`. */
  async prune(maxAgeDays: number): Promise<number> {
    if (!(maxAgeDays > 0)) return 0
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    let removed = 0
    let names: string[]
    try {
      names = await readdir(this.opts.dir)
    } catch {
      return 0 // missing directory: nothing to prune
    }
    await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => {
          const file = join(this.opts.dir, n)
          try {
            const info = await stat(file)
            if (info.mtimeMs < cutoff) {
              await rm(file, { force: true })
              removed++
            }
          } catch {
            /* raced away or unreadable: leave it for the next prune */
          }
        }),
    )
    return removed
  }

  /** Cancel the debounce timer and flush everything pending. */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.flushChain.catch(() => {})
    await this.flushNow()
  }

  /** Flush without waiting for the debounce window (also the timer callback). */
  private flushNow(): Promise<void> {
    const ids = [...this.dirty]
    this.dirty.clear()
    this.flushChain = this.flushChain.then(async () => {
      await Promise.all(ids.map((id) => this.flushSession(id)))
    })
    return this.flushChain.catch(() => {})
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined || this.opts.flushDelayMs <= 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flushNow()
    }, this.opts.flushDelayMs)
    // Do not hold the event loop open just for a debounce window.
    this.timer.unref?.()
  }

  private async ensureLoaded(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return
    const inFlight = this.loading.get(sessionId)
    if (inFlight) return inFlight
    const load = (async () => {
      const entries = await this.readFile(sessionId)
      const map = new Map<string, string>()
      for (const [key, version] of entries) map.set(key, version)
      // The session may have been created (and marked loaded) by a record()
      // while the read was in flight only if record() found it absent — it
      // cannot have; record() queues pending ops instead. Assert the slot.
      if (this.sessions.has(sessionId)) {
        const existing = this.sessions.get(sessionId)!
        for (const [key, version] of map) if (!existing.has(key)) existing.set(key, version)
      } else {
        this.sessions.set(sessionId, map)
      }
      const queued = this.pending.get(sessionId)
      if (queued) {
        this.pending.delete(sessionId)
        for (const op of queued) {
          if (op.kind === 'set') this.applySet(sessionId, op.targetKey, op.version)
          else this.sessions.get(sessionId)!.delete(op.targetKey)
        }
      }
    })().finally(() => {
      this.loading.delete(sessionId)
    })
    this.loading.set(sessionId, load)
    return load
  }

  private async readFile(sessionId: string): Promise<Array<[string, string]>> {
    try {
      const raw = await readFile(join(this.opts.dir, fileNameFor(sessionId)), 'utf8')
      const parsed = JSON.parse(raw) as { v?: number; entries?: Record<string, string> }
      if (parsed?.v !== FORMAT_VERSION || parsed.entries === null || typeof parsed.entries !== 'object') return []
      return Object.entries(parsed.entries).filter(
        ([key, version]) => typeof key === 'string' && typeof version === 'string',
      )
    } catch {
      return [] // missing or unreadable file: treat as no observations
    }
  }

  private applySet(sessionId: string, targetKey: string, version: string): void {
    let map = this.sessions.get(sessionId)
    if (!map) {
      map = new Map()
      this.sessions.set(sessionId, map)
    } else if (map.has(targetKey)) {
      map.delete(targetKey) // re-insert to refresh recency
    }
    map.set(targetKey, version)
    while (map.size > this.opts.maxEntriesPerSession) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  private queuePending(sessionId: string, op: PendingOp): void {
    let queue = this.pending.get(sessionId)
    if (!queue) {
      queue = []
      this.pending.set(sessionId, queue)
    }
    queue.push(op)
  }

  /** Keep `sessions` insertion order aligned with recency for the in-memory cap. */
  private touchSession(sessionId: string): void {
    const map = this.sessions.get(sessionId)
    if (!map) return // not loaded yet; load order does not matter for the cap
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, map)
    while (this.sessions.size > this.opts.maxSessionsInMemory) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      if (this.dirty.has(oldest) || this.loading.has(oldest)) break // never evict unflushed state
      this.sessions.delete(oldest)
    }
  }

  private async flushSession(sessionId: string): Promise<void> {
    await this.ensureLoaded(sessionId)
    const map = this.sessions.get(sessionId)
    if (!map) return
    const payload = JSON.stringify({ v: FORMAT_VERSION, entries: Object.fromEntries(map) })
    const dir = this.opts.dir
    const final = join(dir, fileNameFor(sessionId))
    const tmp = join(dir, `.${process.pid}-${this.tmpCounter++}-${fileNameFor(sessionId)}.tmp`)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, final)
    } catch {
      try {
        await rm(tmp, { force: true })
      } catch {
        /* best effort */
      }
      // A failed flush only loses persistence freshness: the next observation
      // re-marks the session dirty. Never surface through the tool call.
    }
  }
}
