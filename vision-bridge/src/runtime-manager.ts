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
 * 05 票：配置变更 = 在 staging 准备候选（venv/探针全过）→ 原子切换 generation；
 * 任何一步失败都保留旧 generation 继续服务。
 */
export class RuntimeManager {
  private current: Generation | null = null
  private preparing: Promise<Generation | null> | null = null
  private disposed = false
  private lastOptions: RuntimeManagerOptions
  lastError: string | null = null

  constructor(private opts: RuntimeManagerOptions) {
    this.lastOptions = { ...opts }
  }

  get generation(): Generation | null {
    return this.current
  }

  get ready(): boolean {
    return this.current !== null && this.current.ready
  }

  async ensureReady(): Promise<Generation | null> {
    if (this.current !== null && this.current.ready) return this.current
    if (this.preparing !== null) return this.preparing
    this.preparing = this.prepare(this.lastOptions)
    const generation = await this.preparing
    this.preparing = null
    return generation
  }

  /** 配置热更新入口：先验证候选，成功才原子切换；失败保留旧 generation 并返回原因。 */
  async reconfigure(next: Partial<RuntimeManagerOptions>): Promise<{ ok: true } | { ok: false; reason: string }> {
    const candidateOptions = { ...this.lastOptions, ...next }
    const old = this.current
    try {
      if (candidateOptions.managed) {
        const candidateVenv = candidateOptions.venvDir || path.join(candidateOptions.stateDir, `venv-next-${Date.now().toString(36)}`)
        const candidate = await this.prepareCandidate({ ...candidateOptions, venvDir: candidateVenv })
        this.lastOptions = candidateOptions
        this.current = candidate
        this.lastError = null
        this.opts.logger.info({ from: old?.id, to: candidate.id }, 'runtime generation swapped')
        if (old && old.venvDir !== candidate.venvDir) {
          void fsp.rm(old.venvDir, { recursive: true, force: true }).catch(() => {})
        }
        return { ok: true }
      }
      // managed=false：候选 = 系统 python3 探针
      const candidate = await this.prepareCandidate(candidateOptions)
      this.lastOptions = candidateOptions
      this.current = candidate
      this.lastError = null
      this.opts.logger.info({ from: old?.id, to: candidate.id }, 'runtime generation swapped')
      return { ok: true }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      this.opts.logger.error({ from: old?.id }, `reconfigure rejected (旧 generation 继续服务): ${reason}`)
      return { ok: false, reason }
    }
  }

  /** 在独立 venv 目录准备候选（staging），不动 current。 */
  private async prepareCandidate(options: RuntimeManagerOptions): Promise<Generation> {
    const id = ++generationSeq
    const startedAt = Date.now()
    await fsp.mkdir(options.stateDir, { recursive: true })
    let venvDir = options.venvDir
    let pythonBin = options.python
    if (options.managed) {
      if (!venvDir) venvDir = path.join(options.stateDir, 'venv')
      const env: Record<string, string | undefined> = { ...process.env }
      let create
      try {
        create = await spawnBounded([options.python, '-m', 'venv', venvDir], {
          env,
          timeoutMs: options.prepareTimeoutMs,
          maxStderrBytes: 64 * 1024,
        })
      } catch (e) {
        throw new Error(`venv 创建失败: ${e instanceof Error ? e.message : String(e)}；` +
          `修复：确认 ${options.python} 可用（如 brew install python3）、${options.stateDir} 可写`)
      }
      if (create.exitCode !== 0) {
        throw new Error(`venv 创建失败（exit ${create.exitCode}）: ${tail(create.stderr)}；` +
          `修复：确认 ${options.python} 可用、${options.stateDir} 可写`)
      }
      pythonBin = path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
      const requirements = path.resolve(options.requirementsFile || path.join(options.runtimeDir, 'requirements.lock'))
      const install = await spawnBounded(
        [pythonBin, '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-r', requirements],
        { env, timeoutMs: options.prepareTimeoutMs, maxStderrBytes: 64 * 1024 },
      )
      if (install.exitCode !== 0) {
        throw new Error(`锁定依赖安装失败（exit ${install.exitCode}）: ${tail(install.stderr)}；` +
          `修复：检查 PyPI 网络后重试，或设置 managed=false 使用系统 python3（需已装 Pillow）`)
      }
    }
    const probe = await spawnBounded([pythonBin, '-m', 'dsh_vision', 'probe', '--spec', '{}'], {
      env: { ...process.env, PYTHONPATH: options.runtimeDir },
      timeoutMs: options.prepareTimeoutMs,
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
    return {
      id,
      venvDir,
      pythonBin,
      env: { PYTHONPATH: options.runtimeDir },
      ready: true,
      readyAt: Date.now(),
      startedAt,
    }
  }

  private async prepare(options: RuntimeManagerOptions): Promise<Generation | null> {
    if (this.disposed) return null
    const id = ++generationSeq
    const startedAt = Date.now()
    this.opts.logger.info({ id, managed: options.managed }, 'runtime prepare: start')
    try {
      const generation = await this.prepareCandidate(options)
      if (this.disposed) return null
      this.current = generation
      this.lastError = null
      this.opts.logger.info({ id, venvDir: generation.venvDir, ms: Date.now() - startedAt }, 'runtime ready')
      this.opts.onReady?.(generation)
      return generation
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.lastError = message
      this.opts.logger.error({ id, managed: options.managed }, `runtime prepare failed: ${message}`)
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
