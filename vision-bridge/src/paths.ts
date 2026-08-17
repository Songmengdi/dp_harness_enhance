import { promises as fsp, existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { VisionError } from './errors.js'

export type ArtifactDescriptor = {
  path: string
  filename: string
  mimeType: string
  kind: string
  description: string
  sourceTool: string
  bytes: number
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 输入 realpath 围栏（工作区 + allowedDirs）+ 产物 staging→原子提交。 */
export class PathFence {
  private constructor(
    readonly workspace: string,
    private readonly workspaceReal: string,
    private readonly allowedReal: string[],
    readonly artifactsDir: string,
    private readonly artifactsRel: string,
  ) {}

  /** workspace 与 allowedDirs 全部 realpath；任何缺失/异常即 config 错误。 */
  static async create(
    workspace: string | undefined,
    allowedDirs: string[],
    artifactsRel: string,
  ): Promise<PathFence> {
    let workspaceReal: string
    try {
      workspaceReal = await fsp.realpath(workspace || process.cwd())
    } catch (e) {
      throw new VisionError('config', `工作区不存在或不可读: ${workspace || process.cwd()}`)
    }
    const allowedReal: string[] = []
    for (const dir of allowedDirs) {
      try {
        allowedReal.push(await fsp.realpath(dir))
      } catch (e) {
        throw new VisionError('config', `allowedDirs 目录不存在或不可读: ${dir}`)
      }
    }
    const artifactsDir = path.join(workspaceReal, artifactsRel)
    return new PathFence(workspace || process.cwd(), workspaceReal, allowedReal, artifactsDir, artifactsRel)
  }

  private admitted(real: string): boolean {
    return isInside(this.workspaceReal, real) || this.allowedReal.some((dir) => isInside(dir, real))
  }

  /** 输入路径只允许落在工作区或 allowedDirs 内；realpath 后比对，符号链接逃逸被拒绝。 */
  async resolveInput(raw: string): Promise<string> {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new VisionError('input', 'path 不能为空')
    }
    const abs = path.isAbsolute(raw) ? raw : path.resolve(this.workspaceReal, raw)
    let real: string
    try {
      real = await fsp.realpath(abs)
    } catch (e) {
      throw new VisionError('input', `输入路径不存在: ${raw}`)
    }
    if (!this.admitted(real)) {
      throw new VisionError('input', `输入路径越界（只在会话工作区或 allowedDirs 内解析，符号链接逃逸被拒绝）: ${raw}`)
    }
    const stat = await fsp.stat(real)
    if (!stat.isFile()) {
      throw new VisionError('input', `输入不是文件: ${raw}`)
    }
    return real
  }

  /** 产物目录（工作区内固定子目录，D9）。 */
  async ensureArtifactsDir(): Promise<string> {
    await fsp.mkdir(this.artifactsDir, { recursive: true })
    return this.artifactsDir
  }

  /** 每次调用一个 staging 目录（与产物目录同文件系统，原子 rename 有效）。 */
  async beginStaging(): Promise<string> {
    const base = await this.ensureArtifactsDir()
    return fsp.mkdtemp(path.join(base, '.staging-'))
  }

  /**
   * staging 文件校验后原子提交进产物目录。
   * probe 校验内容（返回非空字符串 = 校验失败原因）；失败即清理整个 staging 目录。
   */
  async commitFiles(
    stagingDir: string,
    files: Array<{
      staging: string
      finalName: string
      sourceTool: string
      description: string
      kind: string
      probe?: (buf: Buffer) => string | null
    }>,
  ): Promise<ArtifactDescriptor[]> {
    try {
      const base = await this.ensureArtifactsDir()
      const out: ArtifactDescriptor[] = []
      for (const f of files) {
        const stagingPath = path.resolve(stagingDir, f.staging)
        if (!isInside(stagingDir, stagingPath)) throw new Error(`staging 文件名越界: ${f.staging}`)
        if (!existsSync(stagingPath)) throw new Error(`staging 文件缺失: ${f.staging}`)
        const buf = await fsp.readFile(stagingPath)
        if (buf.length === 0) throw new Error(`staging 文件为空: ${f.staging}`)
        if (f.probe) {
          const reason = f.probe(buf)
          if (reason !== null) throw new Error(`staging 文件校验失败: ${f.staging} — ${reason}`)
        }
        let finalPath = path.join(base, f.finalName)
        if (existsSync(finalPath)) {
          finalPath = path.join(base, crypto.randomBytes(4).toString('hex') + '_' + f.finalName)
        }
        await fsp.rename(stagingPath, finalPath)
        const stat = await fsp.stat(finalPath)
        out.push({
          path: finalPath,
          filename: path.basename(finalPath),
          mimeType: MIME_BY_EXT[path.extname(finalPath).slice(1).toLowerCase()] || 'application/octet-stream',
          kind: f.kind,
          description: f.description,
          sourceTool: f.sourceTool,
          bytes: stat.size,
        })
      }
      return out
    } catch (e) {
      throw new VisionError('output', `产物提交失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** 按工作区缓存 fence（allowedDirs 与产物子目录不变）。 */
export class FenceRegistry {
  private readonly cache = new Map<string, PathFence>()
  constructor(
    private readonly allowedDirs: string[],
    private readonly artifactsRel: string,
  ) {}

  async forWorkspace(workspace: string | undefined): Promise<PathFence> {
    const key = workspace || process.cwd()
    const hit = this.cache.get(key)
    if (hit) return hit
    const fence = await PathFence.create(workspace, this.allowedDirs, this.artifactsRel)
    this.cache.set(key, fence)
    return fence
  }
}
