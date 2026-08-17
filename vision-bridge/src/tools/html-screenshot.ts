import path from 'node:path'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, sanitizeStem, withStaging, type ToolEnv } from './common.js'
import { pngProbe } from './frames.js'

interface HtmlShotResult {
  source: { path: string; bytes: number }
  viewport: { width: number; height: number }
  rendered: { width: number; height: number }
  file: string
}

/** vision_html_screenshot：本地 HTML → 视口 PNG（无头浏览器；禁网 + 一次性临时 profile）。 */
export function defineHtmlScreenshotTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_html_screenshot',
    description:
      '把工作区内的本地 HTML 文件渲染成视口 PNG（无头 Chrome/Chromium/Edge；禁用网络 + 一次性临时 profile，调用后清理）。' +
      '只接受本地 .html/.htm，拒绝 URL 与 data URI。产物可直接喂给 vision_pixel_diff 做「参考图 vs 实现」验证。',
    parameters: {
      source: { type: 'string', required: true, description: '工作区内的本地 HTML 文件路径。' },
      width: { type: 'integer', description: '视口宽（默认 1280）。' },
      height: { type: 'integer', description: '视口高（默认 800）。' },
      scale: { type: 'integer', description: '缩放倍数 1-4（默认 1）。' },
      waitMs: { type: 'integer', description: '渲染等待毫秒（默认 300）。' },
      output: { type: 'string', description: '产物文件名主干（可选，默认 shot）。' },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.source))
      const ext = path.extname(real).toLowerCase()
      if (ext !== '.html' && ext !== '.htm') {
        throw new VisionError('input', `只接受工作区内的本地 .html/.htm（拒绝 URL 与 data URI）: ${args.source}`)
      }
      return withStaging(fence, async (staging) => {
        const raw = (await env.runtime.run(
          'html_screenshot',
          { source: real, width: args.width, height: args.height, scale: args.scale, waitMs: args.waitMs, outDir: staging },
          { signal: exec.signal },
        )) as HtmlShotResult
        if (typeof raw !== 'object' || raw === null || typeof raw.file !== 'string') {
          throw new VisionError('output', 'html_screenshot 结果契约违反')
        }
        const stamp = crypto.randomBytes(4).toString('hex')
        const committed = await fence.commitFiles(staging, [{
          staging: path.basename(raw.file),
          finalName: `${sanitizeStem(args.output, 'shot')}_${stamp}.png`,
          sourceTool: 'vision_html_screenshot',
          kind: 'image',
          description: `HTML 渲染 ${path.basename(real)} ${raw.viewport.width}x${raw.viewport.height}`,
          probe: pngProbe,
        }])
        return { source: raw.source, viewport: raw.viewport, rendered: raw.rendered, artifact: committed[0] }
      })
    },
  })
}
