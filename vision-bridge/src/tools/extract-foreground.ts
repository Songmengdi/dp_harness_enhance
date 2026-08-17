import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'

function stemOf(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  return String(raw).replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 40)
}

/** PNG 必须带 alpha（IHDR color type 6 = RGBA）。 */
const alphaPngProbe = (buf: Buffer): string | null => {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 26 || !buf.subarray(0, 8).equals(magic)) return '不是合法 PNG'
  if (buf[25] !== 6) return 'PNG 没有 alpha 通道'
  return null
}

interface ForegroundResult {
  box: { x1: number; y1: number; x2: number; y2: number }
  components: number
  coveragePct: number
  width: number
  height: number
  file: string
}

/** vision_extract_foreground：图标/logo → 透明 PNG（auto 失败可手工区域/排除色重试）。 */
export function defineExtractForegroundTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_extract_foreground',
    description:
      '从图片中提取前景（图标/logo），输出透明 PNG：auto 模式自动估计背景；auto 失败时用 mode=manual + region/excludeColor 重试。' +
      '返回前景外接框、连通分量数与覆盖率。纯本地确定性操作。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径（会话工作区或 allowedDirs 内）。' },
      region: { type: 'string', description: '"x,y,w,h"：manual 模式下只在该区域取前景。' },
      mode: { type: 'string', description: 'auto（默认，自动估计背景）| manual（用 region/excludeColor）。' },
      excludeColor: { type: 'string', description: 'manual 模式指定背景色（如 #ffffff），按它分割前景。' },
      output: { type: 'string', description: '产物文件名主干（可选，默认 foreground）。' },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      const staging = await fence.beginStaging()
      try {
        const raw = (await env.runtime.run(
          'extract_foreground',
          { image: real, region: args.region, mode: args.mode, excludeColor: args.excludeColor, outDir: staging },
          { signal: exec.signal },
        )) as ForegroundResult
        if (typeof raw !== 'object' || raw === null || typeof raw.file !== 'string') {
          throw new VisionError('output', 'extract_foreground 结果契约违反')
        }
        const stamp = crypto.randomBytes(4).toString('hex')
        const committed = await fence.commitFiles(staging, [{
          staging: path.basename(raw.file),
          finalName: `${stemOf(args.output, 'foreground')}_${stamp}.png`,
          sourceTool: 'vision_extract_foreground',
          kind: 'image',
          description: `前景提取 ${path.basename(real)}（覆盖率 ${raw.coveragePct}%）`,
          probe: alphaPngProbe,
        }])
        return {
          box: raw.box,
          components: raw.components,
          coveragePct: raw.coveragePct,
          width: raw.width,
          height: raw.height,
          artifact: committed[0],
        }
      } catch (e) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
        throw e
      }
    },
  })
}
