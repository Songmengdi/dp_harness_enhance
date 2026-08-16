import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { spawnBounded } from './runtime.js'
import type { BridgeLogger } from './logger.js'

export interface Generation {
  id: number
  venvDir: string
  pythonBin: string
  /** 附加子进程环境（PYTHONPATH 指向 runtime 源码，venv 只提供依赖）。 */
  env: Record<string, string>
  ready: boolean
  error?: string
  startedAt: number
  readyAt?: number
}

export interface RuntimeManagerOptions {
  runtimeDir: string
  stateDir: string
  python: string
  managed: boolean
  venvDir: string
  requirementsFile: string
  prepareTimeoutMs: number
  logger: BridgeLogger
  onReady?: (generation: Generation) => void
}

let generationSeq = 0

/**
 * managed 运行时：按锁定依赖建隔离 venv → 探针 → 就绪。
 * 准备失败给出可修复的明确错误；失败期间不发布任何模型可见能力（由 exposure 保证）。
 * 05 票在此之上加「候选准备 → 原子切换」。
 */
export class RuntimeManager {
  private current: Generation | null = null
  private preparing: Promise<Generation | null> | null = null
  private disposed = false
  lastError: string | null = null

  constructor(private readonly opts: RuntimeManagerOptions) {}

  get generation(): Generation | null {
    return this.current
  }

  get ready(): boolean {
    return this.current !== null && this.current.ready
  }

  async ensureReady(): Promise<Generation | null> {
    if (this.current !== null && this.current.ready) return this.current
    if (this.preparing !== null) return this.preparing
    this.preparing = this.prepare()
    const generation = await this.preparing
    this.preparing = null
    return generation
  }

  private async prepare(): Promise<Generation | null> {
    if (this.disposed) return null
    const id = ++generationSeq
    const startedAt = Date.now()
    this.opts.logger.info({ id, managed: this.opts.managed }, 'runtime prepare: start')
    try {
      await fsp.mkdir(this.opts.stateDir, { recursive: true })
      let venvDir = this.opts.venvDir
      let pythonBin = this.opts.python
      if (this.opts.managed) {
        if (!venvDir) venvDir = path.join(this.opts.stateDir, 'venv')
        const env: Record<string, string | undefined> = { ...process.env }
        let create
        try {
          create = await spawnBounded([this.opts.python, '-m', 'venv', venvDir], {
            env,
            timeoutMs: this.opts.prepareTimeoutMs,
            maxStderrBytes: 64 * 1024,
          })
        } catch (e) {
          throw new Error(`venv 创建失败: ${e instanceof Error ? e.message : String(e)}；` +
            `修复：确认 ${this.opts.python} 可用（如 brew install python3）、${this.opts.stateDir} 可写`)
        }
        if (create.exitCode !== 0) {
          throw new Error(`venv 创建失败（exit ${create.exitCode}）: ${tail(create.stderr)}；` +
            `修复：确认 ${this.opts.python} 可用、${this.opts.stateDir} 可写`)
        }
        pythonBin = path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
        const requirements = path.resolve(this.opts.requirementsFile || path.join(this.opts.runtimeDir, 'requirements.lock'))
        const install = await spawnBounded(
          [pythonBin, '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', requirements],
          { env, timeoutMs: this.opts.prepareTimeoutMs, maxStderrBytes: 64 * 1024 },
        )
        if (install.exitCode !== 0) {
          throw new Error(`锁定依赖安装失败（exit ${install.exitCode}）: ${tail(install.stderr)}；` +
            `修复：检查 PyPI 网络后重试，或设置 managed=false 使用系统 python3（需已装 Pillow）`)
        }
      }
      const probe = await spawnBounded([pythonBin, '-m', 'dsh_vision', 'probe', '--spec', '{}'], {
        env: { ...process.env, PYTHONPATH: this.opts.runtimeDir },
        timeoutMs: this.opts.prepareTimeoutMs,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 64 * 1024,
      })
      if (probe.exitCode !== 0) {
        throw new Error(`探针失败（exit ${probe.exitCode}）: ${tail(probe.stderr)}`)
      }
      let probeBody: { ok?: boolean } = {}
      try {
        probeBody = JSON.parse(probe.stdout)
      } catch (e) { /* 走下方校验 */ }
      if (!probeBody.ok) {
        throw new Error(`探针返回异常: ${probe.stdout.slice(0, 200)}`)
      }
      const generation: Generation = {
        id,
        venvDir,
        pythonBin,
        env: { PYTHONPATH: this.opts.runtimeDir },
        ready: true,
        readyAt: Date.now(),
        startedAt,
      }
      if (this.disposed) return null
      this.current = generation
      this.lastError = null
      this.opts.logger.info({ id, venvDir, ms: Date.now() - startedAt }, 'runtime ready')
      this.opts.onReady?.(generation)
      return generation
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.lastError = message
      this.opts.logger.error({ id, managed: this.opts.managed }, `runtime prepare failed: ${message}`)
      return null
    }
  }

  dispose(): void {
    this.disposed = true
    this.opts.logger.info({}, 'runtime manager disposed')
  }
}

function tail(text: string, max = 300): string {
  const t = text.trim()
  return t.length > max ? t.slice(-max) : t
}
