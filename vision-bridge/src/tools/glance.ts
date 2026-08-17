import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import type { GlanceCache, RemoteVision } from '../remote.js'
import { jsonOutput, agentWorkspace, type ToolEnv } from './common.js'

export interface RemoteToolEnv extends ToolEnv {
  remote: RemoteVision
  cache: GlanceCache
}

/** vision_glance：远程 VLM 看图（描述 / 问答 / OCR / 多图一次比较）。 */
export function defineGlanceTool(env: RemoteToolEnv) {
  return defineTool({
    name: 'vision_glance',
    description:
      '让视觉模型看一张或多张图并回答：不带 query/ocr = 完整全景描述；带 query = 五段式问答；' +
      'ocr=true = 逐字转写图中文字。多图必须一次传入（同一次视觉请求，逐张独立描述）。' +
      '同会话内输入完全相同的调用直接复用上次成功结果。回答不是像素级证据。',
    parameters: {
      images: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: '图片路径数组（会话工作区或 allowedDirs 内），最多 10 张。',
      },
      query: {
        type: 'string',
        description: '要问的问题；与 ocr 互斥。省略时做完整全景描述。',
      },
      ocr: {
        type: 'boolean',
        description: '逐字 OCR 模式；与 query 互斥。',
      },
      region: {
        type: 'string',
        description: '"x,y,w,h" 像素框；只允许单图时使用。',
      },
      timeoutMs: {
        type: 'integer',
        description: '整操作超时（毫秒），默认取装配配置。',
      },
    },
    output: jsonOutput(),
    timeoutMs: 120_000,
    execute: async (args, exec) => {
      const images = args.images.map((p) => String(p))
      if (images.length === 0 || images.length > 10) {
        throw new VisionError('input', `一次 1-10 张图，收到 ${images.length} 张`)
      }
      if (args.query !== undefined && args.ocr === true) {
        throw new VisionError('input', 'query 与 ocr 互斥')
      }
      if (args.region !== undefined && images.length !== 1) {
        throw new VisionError('input', 'region 只允许单图')
      }
      const agentId = exec.agent?.id ?? '?'
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const reals: string[] = []
      for (const p of images) reals.push(await fence.resolveInput(p))
      const apiKey = await env.remote.resolveCredential()
      const key = await env.cache.keyFor({
        images: reals,
        query: args.query,
        ocr: args.ocr,
        region: args.region,
        ...env.remote.target,
        apiKey,
      })
      const hit = env.cache.get(agentId, key)
      if (hit !== undefined) return hit as JsonValue
      const value = (await env.remote.run(
        'glance',
        { images: reals, query: args.query, ocr: args.ocr, region: args.region, timeoutMs: args.timeoutMs },
        { signal: exec.signal, cacheHit: false },
      )) as JsonValue
      env.cache.set(agentId, key, value)
      return value
    },
  })
}
