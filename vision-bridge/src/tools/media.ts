import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'

/** vision_media：本地 ffprobe 元数据（文件 → 时长/分辨率/流/编码 JSON）。 */
export function defineMediaTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_media',
    description:
      '读取媒体文件的元数据（ffprobe）：时长、分辨率、流类型、编码。' +
      '输入路径只能是会话工作区或配置的 allowedDirs 内的文件。纯本地确定性操作，不需要视觉 API。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: '媒体文件路径（视频/音频/图片）。',
      },
    },
    output: jsonOutput(),
    timeoutMs: 60_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.path))
      return (await env.runtime.run('media', { path: real }, { signal: exec.signal })) as JsonValue
    },
  })
}
