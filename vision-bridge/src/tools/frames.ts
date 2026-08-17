import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { VisionError } from '../errors.js'
import { jsonOutput, agentWorkspace, sanitizeStem, withStaging, type ToolEnv } from './common.js'

const MAX_TIMES = 8

/** PNG 魔数校验（staging 产物提交前的格式探针）。 */
export function pngProbe(buf: Buffer): string | null {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < magic.length || !buf.subarray(0, magic.length).equals(magic)) {
    return '不是合法 PNG'
  }
  return null
}

interface FramesResult {
  dir: string
  frames: Array<{ time: string; path: string }>
}

/** vision_frames：本地 ffmpeg 抽帧（视频 + 时间点 → 工作区产物目录里的帧文件列表）。 */
export function defineFramesTool(env: ToolEnv) {
  return defineTool({
    name: 'vision_frames',
    description:
      '按时间点从视频抽帧，返回帧文件路径列表。times 是逗号分隔的时间点（如 "0:05,10,1:30.5"），最多 8 个。' +
      '帧文件提交到会话工作区的固定产物目录。纯本地确定性操作，不需要视觉 API。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: '视频文件路径（会话工作区或 allowedDirs 内）。',
      },
      times: {
        type: 'string',
        required: true,
        description: '逗号分隔的时间点，最多 8 个，如 "0:05,10,1:30.5"。',
      },
    },
    output: jsonOutput(),
    timeoutMs: 180_000,
    execute: async (args, exec) => {
      const times = String(args.times ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (times.length === 0) {
        throw new VisionError('input', 'times 不能为空，如 "0:05,10"')
      }
      if (times.length > MAX_TIMES) {
        throw new VisionError('input', `一次最多抽 ${MAX_TIMES} 帧，收到 ${times.length} 个时间点`)
      }
      const fence = await env.fences.forWorkspace(agentWorkspace(exec))
      const real = await fence.resolveInput(String(args.path))
      return withStaging(fence, async (staging) => {
        const raw = (await env.runtime.run(
          'frames',
          { path: real, times, outDir: staging },
          { signal: exec.signal },
        )) as FramesResult
        if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.frames)) {
          throw new VisionError('output', 'frames 结果契约违反')
        }
        for (const frame of raw.frames) {
          const p = String(frame.path ?? '')
          if (!p.startsWith(staging + path.sep) || p === staging + path.sep) {
            throw new VisionError('output', `帧路径不在 staging 目录内: ${p}`)
          }
        }
        const stamp = Date.now().toString(36)
        const committed = await fence.commitFiles(
          staging,
          raw.frames.map((frame, i) => ({
            staging: path.basename(String(frame.path)),
            finalName: `frames_${stamp}_${String(i + 1).padStart(2, '0')}_${sanitizeStem(frame.time, 't')}.png`,
            sourceTool: 'vision_frames',
            kind: 'frame',
            description: `t=${frame.time}`,
            probe: pngProbe,
          })),
        )
        if (committed.length !== raw.frames.length) {
          throw new VisionError('output', '帧提交数量与抽帧数量不一致')
        }
        const frames = raw.frames.map((frame, i) => ({ time: frame.time, path: committed[i].path }))
        return { dir: fence.artifactsDir, frames }
      })
    },
  })
}
