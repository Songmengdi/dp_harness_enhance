import path from 'node:path'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, sanitizeStem, withStaging, type ToolEnv } from './common.js'
import { pngProbe } from './frames.js'

interface PixelDiffResult {
  ratioPct: number
  worstRegions: Array<{ box: { x1: number; y1: number; x2: number; y2: number }; ratioPct: number }>
  files: { heatmap: string; report: string }
}

const mdProbe = (buf: Buffer): string | null => {
  const head = buf.toString('utf8', 0, 64)
  return head.includes('# vision_pixel_diff') ? null : '不是 vision_pixel_diff 报告'
}

/** vision_pixel_diff：两图逐像素差异（比例 + 最差区域 + 热力图/报告产物）。 */
export function definePixelDiffTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_pixel_diff',
    description:
      '逐像素比较两张图（原图 vs 重建图，尺寸不同会自动对齐）：返回差异比例、最差区域框，' +
      '并把差异热力图与 Markdown 报告提交到工作区产物目录。像素级确定性证据。',
    parameters: {
      original: { type: 'string', required: true, description: '原图路径。' },
      rebuilt: { type: 'string', required: true, description: '重构图路径。' },
      runName: { type: 'string', description: '运行名（进报告标题与产物名，可选）。' },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const original = await fence.resolveInput(String(args.original))
      const rebuilt = await fence.resolveInput(String(args.rebuilt))
      return withStaging(fence, async (staging) => {
        const raw = (await env.runtime.run(
          'pixel_diff',
          { original, rebuilt, runName: args.runName, outDir: staging },
          { signal: exec.signal },
        )) as PixelDiffResult
        if (typeof raw !== 'object' || raw === null || typeof raw.files !== 'object' || raw.files === null) {
          throw new VisionError('output', 'pixel_diff 结果契约违反')
        }
        const stamp = crypto.randomBytes(4).toString('hex')
        const runTag = sanitizeStem(args.runName, 'diff').slice(0, 24)
        const committed = await fence.commitFiles(staging, [
          {
            staging: path.basename(raw.files.heatmap),
            finalName: `diff_${runTag}_${stamp}_heatmap.png`,
            sourceTool: 'vision_pixel_diff',
            kind: 'heatmap',
            description: `差异热力图 ${path.basename(original)} vs ${path.basename(rebuilt)}（ratioPct=${raw.ratioPct}）`,
            probe: pngProbe,
          },
          {
            staging: path.basename(raw.files.report),
            finalName: `diff_${runTag}_${stamp}_report.md`,
            sourceTool: 'vision_pixel_diff',
            kind: 'report',
            description: `差异报告 ${path.basename(original)} vs ${path.basename(rebuilt)}`,
            probe: mdProbe,
          },
        ])
        return { ratioPct: raw.ratioPct, worstRegions: raw.worstRegions, heatmap: committed[0], report: committed[1] }
      })
    },
  })
}
