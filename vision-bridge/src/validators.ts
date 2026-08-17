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

function requireObjectList(value: unknown, label: string): Array<Record<string, unknown>> {
  const arr = requireArray(value, label)
  return arr.map((item, i) => {
    if (!isObject(item)) throw new Error(`${label}[${i}] 必须是对象`)
    return item
  })
}

function validateGlance(value: unknown): void {
  if (!isObject(value)) throw new Error('glance 结果必须是对象')
  requireObjectList(value.images, 'images')
  requireString(value.answer, 'answer')
  if (typeof value.mode !== 'string') throw new Error('mode 必须是字符串')
  if (typeof value.truncated !== 'boolean') throw new Error('truncated 必须是布尔值')
}

function validateBox(box: unknown): void {
  if (!isObject(box)) throw new Error('box 必须是对象')
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    if (typeof box[k] !== 'number') throw new Error(`box.${k} 必须是数字`)
  }
}

function validateGrounded(value: unknown): void {
  if (!isObject(value)) throw new Error('ground/detect 结果必须是对象')
  if (!isObject(value.image)) throw new Error('image 必须是对象')
  if (typeof value.imageWidth !== 'number' || typeof value.imageHeight !== 'number') {
    throw new Error('imageWidth/imageHeight 必须是数字')
  }
  const matches = requireObjectList(value.matches, 'matches')
  for (const match of matches) {
    requireString(match.label, 'matches[].label')
    validateBox(match.box)
  }
}

function validateCrop(value: unknown): void {
  if (!isObject(value)) throw new Error('crop 结果必须是对象')
  validateBox(value.box)
  if (typeof value.width !== 'number' || typeof value.height !== 'number') throw new Error('宽高必须是数字')
  requireString(value.format, 'format')
}

function validatePixelDiff(value: unknown): void {
  if (!isObject(value)) throw new Error('pixel_diff 结果必须是对象')
  if (typeof value.ratioPct !== 'number') throw new Error('ratioPct 必须是数字')
  const worst = requireObjectList(value.worstRegions, 'worstRegions')
  for (const region of worst) {
    validateBox(region.box)
    if (typeof region.ratioPct !== 'number') throw new Error('worstRegions[].ratioPct 必须是数字')
  }
}

function validateDominantColors(value: unknown): void {
  if (!isObject(value)) throw new Error('dominant_colors 结果必须是对象')
  const colors = requireObjectList(value.colors, 'colors')
  for (const color of colors) {
    requireString(color.color, 'colors[].color')
    if (typeof color.sharePct !== 'number') throw new Error('colors[].sharePct 必须是数字')
  }
  if (value.candidates !== undefined) {
    for (const item of requireObjectList(value.candidates, 'candidates')) {
      requireString(item.color, 'candidates[].color')
      if (typeof item.sharePct !== 'number' || typeof item.winner !== 'boolean') {
        throw new Error('candidates[] 形状非法')
      }
    }
  }
}

export function makeValidators(): Record<string, (value: unknown) => void> {
  return {
    media: validateMedia,
    frames: validateFrames,
    glance: validateGlance,
    ground: validateGrounded,
    detect: validateGrounded,
    crop: validateCrop,
    pixel_diff: validatePixelDiff,
    dominant_colors: validateDominantColors,
    // 04 票的工具在此追加。
  }
}
