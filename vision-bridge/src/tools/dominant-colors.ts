import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'

/** vision_dominant_colors：区域主色分布 + 候选色打分（本地确定性）。 */
export function defineDominantColorsTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_dominant_colors',
    description:
      '测量图片区域的主色分布（按占比排序），并可对候选色列表打分（每个候选色的占比 + winner 标记）。' +
      '颜色是像素级事实，可用来核对视觉模型的描述。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径（会话工作区或 allowedDirs 内）。' },
      region: { type: 'string', description: '"x,y,w,h" 像素框（可选，默认全图）。' },
      top: { type: 'integer', description: '返回的主色数量 1-16（默认 5）。' },
      candidates: {
        type: 'array',
        items: { type: 'string' },
        description: '候选色 hex 列表（如 ["#ff0000","#336699"]），给每个候选色打分。',
      },
    },
    output: jsonOutput(),
    timeoutMs: 60_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      if (args.top !== undefined && (!Number.isInteger(args.top) || args.top < 1 || args.top > 16)) {
        throw new VisionError('input', 'top 必须是 1-16 的整数')
      }
      return (await env.runtime.run(
        'dominant_colors',
        { image: real, region: args.region, top: args.top, candidates: args.candidates },
        { signal: exec.signal },
      )) as JsonValue
    },
  })
}
