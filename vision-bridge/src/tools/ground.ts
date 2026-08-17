import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace } from './common.js'
import type { RemoteToolEnv } from './glance.js'

/** vision_ground / vision_detect 公共构造：远程定位（输出映射回原图像素坐标）。 */
function defineGroundedTool(kind: 'ground' | 'detect', env: RemoteToolEnv) {
  const detect = kind === 'detect'
  return defineTool({
    name: detect ? 'vision_detect' : 'vision_ground',
    description: detect
      ? '盘点图片中某类元素：返回带编号的元素清单（label 含逐字可见文字）与每个元素在原图像素坐标的框。' +
        '指定 region 时只在区域内搜索，坐标仍映射回原图。不是像素级证据，坐标可与本地工具交叉验证。'
      : '在图片中定位目标：返回目标在原图像素坐标的框列表。指定 region 时只在该区域搜索，坐标仍映射回原图。' +
        '结果用于喂给 vision_crop 等本地工具做确定性处理。',
    parameters: {
      image: { type: 'string', required: true, description: '图片路径（会话工作区或 allowedDirs 内）。' },
      ...(detect
        ? {
            category: {
              type: 'string',
              description: '要盘点的元素类别（如按钮/图标/文字块），省略则盘点所有可辨识元素。',
            },
          }
        : {
            target: { type: 'string', required: true, description: '要定位的目标（名称或描述）。' },
          }),
      region: {
        type: 'string',
        description: '"x,y,w,h" 像素框：只在该区域搜索；输出坐标映射回原图。',
      },
      timeoutMs: { type: 'integer', description: '整操作超时（毫秒），默认取装配配置。' },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.image))
      const targetArg = (args as { target?: string }).target
      if (!detect && !String(targetArg ?? '').trim()) {
        throw new VisionError('input', 'target 不能为空')
      }
      const payload: Record<string, unknown> = {
        image: real,
        region: args.region,
        timeoutMs: args.timeoutMs,
      }
      if (detect) payload.category = (args as { category?: string }).category
      else payload.target = targetArg
      return (await env.remote.run(
        kind,
        payload,
        { signal: exec.signal },
      )) as JsonValue
    },
  })
}

export function defineGroundTool(env: RemoteToolEnv) {
  return defineGroundedTool('ground', env)
}

export function defineDetectTool(env: RemoteToolEnv) {
  return defineGroundedTool('detect', env)
}
