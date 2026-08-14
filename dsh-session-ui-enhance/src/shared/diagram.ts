/**
 * 纯函数共享层 —— host 与 client 半边各自编译进自己的产物,
 * 不依赖任何运行时环境,单元测试直接针对本模块。
 */

/** 数值夹取。 */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/**
 * 适配模式缩放:把自然尺寸 (nw, nh) 的图放进 (boxW, boxH) 的视口,
 * 留 12px 边距,从不放大(上限 1),下限为 minScale。
 * 任何尺寸非法(<=0)返回 0,调用方按"不缩放"处理。
 */
export function fitScaleFor(
  nw: number,
  nh: number,
  boxW: number,
  boxH: number,
  minScale = 0.15,
): number {
  if (!(nw > 0) || !(nh > 0) || !(boxW > 0) || !(boxH > 0)) return 0
  const s = Math.min(1, (boxW - 12) / nw, (boxH - 12) / nh)
  return clamp(s, minScale, 1)
}

/**
 * mermaid 渲染返回的 SVG 里 id="container" 会与页面上其他 SVG 冲突,
 * 这里做确定性重命名:同一输入 + 同一新 id 得到同一输出(可重放)。
 */
export function uniquifySvgIds(svg: string, id: string): string {
  return svg
    .replace(/id="container"/g, `id="${id}"`)
    .replace(/#container/g, `#${id}`)
}

/** 渲染错误文本归一:折叠空白并去首尾、截断到 400 字符。 */
export function summarizeError(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400)
}
