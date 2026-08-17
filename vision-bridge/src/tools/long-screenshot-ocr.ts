import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import type { ArtifactDescriptor } from '../paths.js'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'
import { pngProbe } from './frames.js'
import type { RemoteToolEnv } from './glance.js'

interface LongOcrResult {
  chunks: number
  complete: boolean
  runDir: string
  mergedFile?: string
  manifestFile?: string
  auditFile?: string
  chunkFiles: string[]
  reused: { chunks: number; ocr: number }
}

const jsonProbe = (buf: Buffer): string | null => {
  try {
    JSON.parse(buf.toString('utf8'))
    return null
  } catch (e) {
    return '不是合法 JSON'
  }
}
const auditProbe = (buf: Buffer): string | null => {
  return buf.toString('utf8', 0, 64).includes('边界审计') ? null : '不是边界审计报告'
}
const mergedProbe = (buf: Buffer): string | null => {
  return buf.length > 0 ? null : '合并结果为空'
}

/** vision_long_screenshot_ocr：长截图低内容切口分块 + 逐块 OCR + 重叠合并 + 边界审计。 */
export function defineLongScreenshotOcrTool(env: RemoteToolEnv) {
  return defineTool({
    name: 'vision_long_screenshot_ocr',
    description:
      '把长截图按低内容切口分块，逐块 OCR 后合并重复重叠，交付合并 Markdown、清单、边界审计与分块产物。' +
      'splitOnly=true 只分块不发任何远程请求；同 runName + resume=true 复用已有分块与侧车文件。',
    parameters: {
      image: { type: 'string', required: true, description: '长截图路径（会话工作区或 allowedDirs 内）。' },
      mode: { type: 'string', description: 'general（默认）| chat（聊天截图按消息顺序转写）。' },
      runName: { type: 'string', description: '运行名（同名运行可复用分块，默认 run）。' },
      resume: { type: 'boolean', description: '复用同名运行已有的分块与 OCR 侧车文件。' },
      jobs: { type: 'integer', description: 'OCR 并发度 1-8（默认 1）。' },
      splitOnly: { type: 'boolean', description: '只分块，不发远程请求。' },
    },
    output: jsonOutput(),
    timeoutMs: 600_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      const runName = String(args.runName ?? 'run').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 48) || 'run'
      const resume = args.resume === true
      const splitOnly = args.splitOnly === true
      const artifactsBase = await fence.ensureArtifactsDir()
      const runRoot = path.join(artifactsBase, 'long-ocr')
      await fsp.mkdir(runRoot, { recursive: true })
      const finalRunDir = path.join(runRoot, runName)
      let workingDir = finalRunDir
      let staging = ''
      if (resume && await fsp.stat(finalRunDir).then(() => true, () => false)) {
        // 复用已提交的运行目录（含分块与侧车）
      } else {
        if (await fsp.stat(finalRunDir).then(() => true, () => false)) {
          throw new VisionError('input', `runName ${runName} 已存在；用 resume=true 复用或换个名字`)
        }
        staging = await fence.beginStaging()
        workingDir = path.join(staging, 'run')
        await fsp.mkdir(workingDir, { recursive: true })
      }
      try {
        const spec: Record<string, unknown> = {
          image: real,
          mode: args.mode,
          runName,
          runDir: workingDir,
          resume,
          splitOnly,
          jobs: args.jobs,
        }
        const raw = splitOnly
          ? await env.runtime.run('long_screenshot_ocr', spec, { signal: exec.signal, timeoutMs: 120_000 })
          : await env.remote.run('long_screenshot_ocr', spec, { signal: exec.signal })
        const result = raw as LongOcrResult
        if (typeof result !== 'object' || result === null || !Array.isArray(result.chunkFiles) || result.chunkFiles.length === 0) {
          throw new VisionError('output', 'long_screenshot_ocr 结果契约违反')
        }
        // 首次运行：整目录原子提交（同一文件系统 rename）
        if (staging) {
          await fsp.rename(workingDir, finalRunDir)
        }
        const descFor = async (rel: string, kind: string, description: string): Promise<ArtifactDescriptor> => {
          const p = path.join(finalRunDir, rel)
          const stat = await fsp.stat(p).catch(() => { throw new VisionError('output', `产物缺失: ${rel}`) })
          return {
            path: p,
            filename: rel,
            mimeType: rel.endsWith('.json') ? 'application/json' : rel.endsWith('.md') ? 'text/markdown' : rel.endsWith('.png') ? 'image/png' : 'application/octet-stream',
            kind,
            description,
            sourceTool: 'vision_long_screenshot_ocr',
            bytes: stat.size,
          }
        }
        // 校验全部产物（失败即 output 类别）；manifest 在 splitOnly 时也已写出
        const manifest = (await fsp.stat(path.join(finalRunDir, 'manifest.json')).then(() => true, () => false))
          ? await descFor('manifest.json', 'manifest', `分块清单（run=${runName}）`)
          : undefined
        if (manifest) {
          const buf = await fsp.readFile(manifest.path)
          const reason = jsonProbe(buf)
          if (reason) throw new VisionError('output', `manifest 校验失败: ${reason}`)
        }
        const audit = result.complete
          ? await descFor('audit.md', 'audit', `边界审计（run=${runName}）`)
          : undefined
        if (audit) {
          const buf = await fsp.readFile(audit.path)
          const reason = auditProbe(buf)
          if (reason) throw new VisionError('output', `audit 校验失败: ${reason}`)
        }
        const merged = result.complete
          ? await descFor('merged.md', 'report', `合并 OCR Markdown（run=${runName}）`)
          : undefined
        if (merged) {
          const buf = await fsp.readFile(merged.path)
          const reason = mergedProbe(buf)
          if (reason) throw new VisionError('output', `merged 校验失败: ${reason}`)
        }
        const chunkImages: ArtifactDescriptor[] = []
        for (const rel of result.chunkFiles) {
          const artifact = await descFor(rel, 'image', `分块截图（run=${runName}）`)
          const buf = await fsp.readFile(artifact.path)
          const reason = pngProbe(buf)
          if (reason) throw new VisionError('output', `分块校验失败: ${reason}`)
          chunkImages.push(artifact)
        }
        const out: Record<string, unknown> = {
          chunks: result.chunks,
          complete: result.complete,
          chunkImages,
          reused: result.reused,
          runDir: finalRunDir,
        }
        if (merged) out.mergedMarkdown = merged
        if (manifest) out.manifest = manifest
        if (audit) out.audit = audit
        return out as JsonValue
      } catch (e) {
        if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
        throw e
      }
    },
  })
}
