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

function validateTrace(value: unknown): void {
  if (!isObject(value)) throw new Error('trace 结果必须是对象')
  requireString(value.svg, 'svg')
  if (typeof value.paths !== 'number' || typeof value.width !== 'number' || typeof value.height !== 'number' || typeof value.scale !== 'number') {
    throw new Error('trace 结果字段缺失或类型错误')
  }
}

function validateExtractForeground(value: unknown): void {
  if (!isObject(value)) throw new Error('extract_foreground 结果必须是对象')
  validateBox(value.box)
  if (typeof value.components !== 'number' || typeof value.coveragePct !== 'number') throw new Error('components/coveragePct 必须是数字')
  if (typeof value.width !== 'number' || typeof value.height !== 'number') throw new Error('宽高必须是数字')
}

function validateLongOcr(value: unknown): void {
  if (!isObject(value)) throw new Error('long_screenshot_ocr 结果必须是对象')
  if (typeof value.chunks !== 'number' || typeof value.complete !== 'boolean') throw new Error('chunks/complete 形状非法')
  requireString(value.runDir, 'runDir')
  const files = requireArray(value.chunkFiles, 'chunkFiles')
  if (files.length === 0) throw new Error('chunkFiles 不能为空')
  if (value.complete) {
    requireString(value.mergedFile, 'mergedFile')
    requireString(value.manifestFile, 'manifestFile')
    requireString(value.auditFile, 'auditFile')
  }
}

function validateHtmlShot(value: unknown): void {
  if (!isObject(value)) throw new Error('html_screenshot 结果必须是对象')
  if (!isObject(value.source)) throw new Error('source 必须是对象')
  requireString(value.source.path, 'source.path')
  if (typeof value.source.bytes !== 'number') throw new Error('source.bytes 必须是数字')
  if (!isObject(value.viewport) || !isObject(value.rendered)) throw new Error('viewport/rendered 必须是对象')
  if (typeof value.viewport.width !== 'number' || typeof value.rendered.width !== 'number') throw new Error('视口宽高必须是数字')
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
    trace: validateTrace,
    extract_foreground: validateExtractForeground,
    long_screenshot_ocr: validateLongOcr,
    html_screenshot: validateHtmlShot,
  }
}
