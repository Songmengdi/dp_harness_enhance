/** 子命令 stdout 结果契约校验（Host 侧，契约违反 → output 类别）。 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireString(v: unknown, label: string): string {
  if (typeof v !== 'string') throw new Error(`${label} 必须是字符串`)
  return v
}

function requireArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${label} 必须是数组`)
  return v
}

function validateMedia(value: unknown): void {
  if (!isObject(value)) throw new Error('media 结果必须是对象')
  requireString(value.path, 'path')
  const streams = requireArray(value.streams, 'streams')
  for (const stream of streams) {
    if (!isObject(stream)) throw new Error('streams 元素必须是对象')
    requireString(stream.type, 'stream.type')
    requireString(stream.codec, 'stream.codec')
  }
}

function validateFrames(value: unknown): void {
  if (!isObject(value)) throw new Error('frames 结果必须是对象')
  requireString(value.dir, 'dir')
  const frames = requireArray(value.frames, 'frames')
  for (const frame of frames) {
    if (!isObject(frame)) throw new Error('frames 元素必须是对象')
    requireString(frame.time, 'frame.time')
    requireString(frame.path, 'frame.path')
  }
}

export function makeValidators(): Record<string, (value: unknown) => void> {
  return {
    media: validateMedia,
    frames: validateFrames,
    // 02/04 票的工具在此追加。
  }
}
