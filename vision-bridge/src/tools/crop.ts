import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'
import { pngProbe } from './frames.js'

function stemOf(raw: unknown): string {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'crop'
  return String(raw).replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 40)
}

interface CropResult {
  box: { x1: number; y1: number; x2: number; y2: number }
  width: number
  height: number
  format: string
  file: string
}

/** vision_crop：本地裁剪（像素框 → 工作区产物文件；不覆盖输入图）。 */
export function defineCropTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_crop',
    description:
      '把图片按像素框裁成 PNG 文件（可整数倍放大），产物提交到会话工作区固定产物目录，' +
      '返回结构化 artifact 描述（路径/大小/类型/来源工具），可直接喂给 vision_pixel_diff 等后续工具。纯本地确定性操作。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径（会话工作区或 allowedDirs 内）。' },
      region: { type: 'string', required: true, description: '"x,y,w,h" 像素框（原图坐标）。' },
      scale: { type: 'integer', description: '放大倍数 1-8（默认 1）。' },
      output: { type: 'string', description: '产物文件名主干（可选，默认 crop）。' },
    },
    output: jsonOutput(),
    timeoutMs: 60_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      if (args.scale !== undefined && (!Number.isInteger(args.scale) || args.scale < 1 || args.scale > 8)) {
        throw new VisionError('input', 'scale 必须是 1-8 的整数')
      }
      const staging = await fence.beginStaging()
      const outName = stemOf(args.output) + '.png'
      try {
        const raw = (await env.runtime.run(
          'crop',
          { image: real, region: args.region, scale: args.scale, outDir: staging, outName },
          { signal: exec.signal },
        )) as CropResult
        if (typeof raw !== 'object' || raw === null || typeof raw.file !== 'string') {
          throw new VisionError('output', 'crop 结果契约违反')
        }
        const stamp = crypto.randomBytes(4).toString('hex')
        const finalName = `${stemOf(args.output)}_${stamp}.png`
        const committed = await fence.commitFiles(staging, [{
          staging: path.basename(raw.file),
          finalName,
          sourceTool: 'vision_crop',
          kind: 'image',
          description: `裁剪 ${path.basename(real)} region=${args.region} scale=${args.scale ?? 1}`,
          probe: pngProbe,
        }])
        const artifact = committed[0]
        if (artifact.path === real) {
          throw new VisionError('output', '裁剪产物路径与输入图相同（禁止覆盖输入图）')
        }
        return { box: raw.box, width: raw.width, height: raw.height, format: raw.format, artifact }
      } catch (e) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
        throw e
      }
    },
  })
}
