import path from 'node:path'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, sanitizeStem, withStaging, type ToolEnv } from './common.js'

const svgProbe = (buf: Buffer): string | null => {
  const text = buf.toString('utf8')
  const lowered = text.toLowerCase()
  if (lowered.includes('<!doctype') || lowered.includes('<script') || lowered.includes('javascript:') || lowered.includes('<foreignobject')) {
    return '危险结构'
  }
  const rootMatch = text.match(/<svg[\s>]/)
  if (!rootMatch) return '不是 SVG'
  const closeCount = (text.match(/<\/svg>/gi) ?? []).length
  if (closeCount !== 1) return 'svg 根不唯一'
  return null
}

interface TraceResult {
  paths: number
  width: number
  height: number
  scale: number
  file: string
}

/** vision_trace：扁平图形 → SVG 几何（小图标先放大分析，输出保持原图坐标）。 */
export function defineTraceTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_trace',
    description:
      '把扁平高对比图形（图标/logo/示意图）恢复成 SVG 几何：返回路径数、尺寸、分析放大倍数与 SVG 产物。' +
      '小图标会先放大分析，但输出坐标仍按原图。提交前校验 SVG 为合法 XML、单一 svg 根、无危险结构。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径（会话工作区或 allowedDirs 内）。' },
      region: { type: 'string', description: '"x,y,w,h" 像素框（可选，默认全图）。' },
      color: { type: 'boolean', description: '路径填充原图颜色（默认只描边）。' },
      outline: { type: 'boolean', description: '保留描边（默认保留）。' },
      output: { type: 'string', description: 'SVG 产物文件名主干（可选，默认 trace）。' },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      return withStaging(fence, async (staging) => {
        const raw = (await env.runtime.run(
          'trace',
          { image: real, region: args.region, color: args.color, outline: args.outline, outDir: staging },
          { signal: exec.signal },
        )) as TraceResult
        if (typeof raw !== 'object' || raw === null || typeof raw.file !== 'string') {
          throw new VisionError('output', 'trace 结果契约违反')
        }
        const stamp = crypto.randomBytes(4).toString('hex')
        const committed = await fence.commitFiles(staging, [{
          staging: path.basename(raw.file),
          finalName: `${sanitizeStem(args.output, 'trace')}_${stamp}.svg`,
          sourceTool: 'vision_trace',
          kind: 'vector',
          description: `SVG 几何 ${path.basename(real)}（${raw.paths} 条路径）`,
          probe: svgProbe,
        }])
        return { svg: committed[0].path, paths: raw.paths, width: raw.width, height: raw.height, scale: raw.scale, artifact: committed[0] }
      })
    },
  })
}
