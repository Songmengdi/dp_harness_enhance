import { spawn } from 'node:child_process'
import { VisionError } from './errors.js'
import type { BridgeLogger } from './logger.js'
import type { RuntimeManager } from './runtime-manager.js'

export interface SpawnOptions {
  env?: Record<string, string | undefined>
  timeoutMs?: number
  signal?: AbortSignal
  maxStdoutBytes?: number
  maxStderrBytes?: number
}

export interface SpawnResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  durationMs: number
}

const DEFAULT_MAX_STDOUT = 1 << 20 // 1 MiB
const DEFAULT_MAX_STDERR = 256 * 1024

/** argv 向量 subprocess（无 shell）；stdout/stderr 有界，超时/取消即 SIGKILL。 */
export async function spawnBounded(argv: string[], opts: SpawnOptions = {}): Promise<SpawnResult> {
  const maxStdout = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT
  const maxStderr = opts.maxStderrBytes ?? DEFAULT_MAX_STDERR
  const startedAt = Date.now()
  const result: SpawnResult = {
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 0,
  }
  return new Promise<SpawnResult>((resolve, reject) => {
    let settled = false
    let killReason: 'timeout' | 'abort' | 'overflow' | null = null
    const child = spawn(argv[0], argv.slice(1), {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killReason = 'timeout'
          child.kill('SIGKILL')
        }, opts.timeoutMs)
      : null
    const onAbort = () => {
      killReason = 'abort'
      child.kill('SIGKILL')
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      result.durationMs = Date.now() - startedAt
      if (err) reject(err)
      else resolve(result)
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      finish(err)
    })
    let stdoutChunks = 0
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks += chunk.length
      if (stdoutChunks > maxStdout) {
        result.stdoutTruncated = true
        killReason = 'overflow'
        child.kill('SIGKILL')
        return
      }
      result.stdout += chunk.toString('utf8')
    })
    let stderrChunks = 0
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks += chunk.length
      if (stderrChunks > maxStderr) {
        result.stderrTruncated = true
        killReason = 'overflow'
        child.kill('SIGKILL')
        return
      }
      result.stderr += chunk.toString('utf8')
    })
    child.on('close', (code, signal) => {
      result.exitCode = code
      result.signal = signal
      if (killReason === 'timeout') result.timedOut = true
      else if (killReason === 'abort') result.cancelled = true
      finish()
    })
  })
}

/** 并发信号量：排队可被取消。 */
export class Semaphore {
  private used = 0
  private readonly waiters: Array<{
    resolve: (release: () => void) => void
    reject: (e: unknown) => void
  }> = []

  constructor(private readonly max: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.used < this.max) {
      this.used += 1
      return Promise.resolve(() => this.release())
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter = { resolve, reject }
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new VisionError('cancelled', '视觉操作在并发队列等待时被取消'))
      }
      if (signal) {
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next.resolve(() => this.release())
    } else {
      this.used -= 1
    }
  }
}

/** 敏感值从文本中剔除（凭据只进子进程环境，任何回传文本都先脱敏）。 */
export function redact(text: string, secrets: Iterable<string>): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[REDACTED]')
  }
  return out
}

export interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  env?: Record<string, string>
  maxStdoutBytes?: number
  maxStderrBytes?: number
}

export interface RuntimeDeps {
  manager: RuntimeManager
  defaultTimeoutMs: number
  maxConcurrency: number
  logger: BridgeLogger
  validators: Record<string, (value: unknown) => void>
}

/** 统一执行总闸门：输入校验（调用方）→ 并发信号量 → subprocess → JSON 契约校验。 */
export class Runtime {
  private readonly semaphore: Semaphore
  constructor(private readonly deps: RuntimeDeps) {
    this.semaphore = new Semaphore(deps.maxConcurrency)
  }

  async run(sub: string, spec: unknown, opts: RunOptions = {}): Promise<unknown> {
    const { manager } = this.deps
    const generation = await manager.ensureReady()
    if (generation === null) {
      throw new VisionError('config', `运行时未就绪：${manager.lastError ?? '准备中或准备失败'}`)
    }
    const release = await this.semaphore.acquire(opts.signal)
    const startedAt = Date.now()
    try {
      const env: Record<string, string | undefined> = { ...process.env, ...generation.env, ...opts.env }
      const secrets = opts.env ? Object.values(opts.env).filter((v): v is string => typeof v === 'string') : []
      const spawnResult = await spawnBounded(
        [generation.pythonBin, '-m', 'dsh_vision', sub, '--spec', JSON.stringify(spec)],
        {
          env,
          signal: opts.signal,
          timeoutMs: opts.timeoutMs ?? this.deps.defaultTimeoutMs,
          maxStdoutBytes: opts.maxStdoutBytes,
          maxStderrBytes: opts.maxStderrBytes,
        },
      )
      const durationMs = Date.now() - startedAt
      if (spawnResult.cancelled) {
        this.deps.logger.info({ sub, durationMs, category: 'cancelled' })
        throw new VisionError('cancelled', `vision_${sub} 已取消`)
      }
      if (spawnResult.timedOut) {
        this.deps.logger.info({ sub, durationMs, category: 'timeout' })
        throw new VisionError('timeout', `vision_${sub} 超过 ${opts.timeoutMs ?? this.deps.defaultTimeoutMs}ms 被终止`)
      }
      if (spawnResult.stdoutTruncated || spawnResult.stderrTruncated) {
        this.deps.logger.info({ sub, durationMs, category: 'output' })
        throw new VisionError('output', `vision_${sub} 输出超出上限，进程被终止`)
      }
      const stderrText = redact(spawnResult.stderr.trim(), secrets)
      if (spawnResult.exitCode === 0) {
        let envelope: unknown
        try {
          envelope = JSON.parse(spawnResult.stdout)
        } catch (e) {
          throw new VisionError('output', `vision_${sub} stdout 不是合法 JSON 契约`)
        }
        if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope)) {
          throw new VisionError('output', `vision_${sub} stdout 缺少 ok 字段（契约违反）`)
        }
        const body = envelope as { ok: boolean; result?: unknown; error?: { category?: string; message?: string } }
        if (!body.ok) {
          const category = isCategory(body.error?.category) ? body.error!.category! : 'runtime'
          const message = redact(body.error?.message ?? '未知错误', secrets)
          this.deps.logger.info({ sub, durationMs, category })
          throw new VisionError(category, message)
        }
        const validate = this.deps.validators[sub]
        try {
          validate?.(body.result)
        } catch (e) {
          this.deps.logger.info({ sub, durationMs, category: 'output' })
          throw new VisionError('output', `vision_${sub} 结果契约校验失败: ${e instanceof Error ? e.message : String(e)}`)
        }
        this.deps.logger.info({ sub, durationMs, category: 'ok' })
        return body.result
      }
      const category = exitCategory(spawnResult.exitCode)
      const message = stderrText ? stderrText.slice(-400) : `vision_${sub} 退出码 ${spawnResult.exitCode}`
      this.deps.logger.info({ sub, durationMs, category })
      throw new VisionError(category, message)
    } finally {
      release()
    }
  }
}

function isCategory(value: unknown): value is 'config' | 'input' | 'capacity' | 'upstream' | 'runtime' | 'output' {
  return (
    value === 'config' || value === 'input' || value === 'capacity' ||
    value === 'upstream' || value === 'runtime' || value === 'output'
  )
}

function exitCategory(code: number | null): 'input' | 'config' | 'upstream' | 'runtime' | 'output' {
  switch (code) {
    case 2: return 'input'
    case 3: return 'config'
    case 4: return 'upstream'
    case 6: return 'output'
    default: return 'runtime'
  }
}
