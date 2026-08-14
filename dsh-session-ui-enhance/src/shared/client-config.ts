/**
 * 客户端渲染配置契约 —— host 与 client 半边共享的单一事实源。
 *
 * 本模块不 import schemastery:client bundle 的平台模块表里没有它,
 * 浏览器半边只消费纯 JSON(config 由 host 的 client-config 端点下发,
 * 合并前的编译期默认值与 host schema 默认值一致,由单测守护不漂移)。
 */

/** 深色主题下 SVG 重着色用的调色板。 */
export interface DarkColors {
  /** 节点形状填充色 */
  shape: string
  /** 形状/簇描边色 */
  stroke: string
  /** 簇与边标签底色 */
  cluster: string
  /** 连线与箭头色 */
  edge: string
  /** 文本色 */
  text: string
  /** 深色卡片画布底色 */
  canvas: string
}

/** 思考块底部收起的可调参数。 */
export interface ThinkCollapseConfig {
  /** 展开的高思考块底部是否提供「收起」小字按钮 */
  enabled: boolean
  /** 思考正文高度达到该值(px)才显示底部收起 */
  minBodyHeight: number
}

/** 下发给浏览器的渲染配置(host Config 的客户端可见子集)。 */
export interface ClientConfig {
  /** 适配模式的最大展示高度(px) */
  fitMaxHeight: number
  /** 缩放模式容器高度(px) */
  zoomBoxHeight: number
  /** 缩放下限 */
  zoomMinScale: number
  /** 缩放上限 */
  zoomMaxScale: number
  /** 单图渲染超时(ms) */
  renderTimeoutMs: number
  /** 深色 GUI 下自动注入 dark theme(无显式 init 指令时) */
  themeAuto: boolean
  /** 深色重着色调色板 */
  darkColors: DarkColors
  /** 思考块底部收起 */
  thinkCollapse: ThinkCollapseConfig
  /** 轮次过程折叠(zcode 式) */
  processCollapse: ProcessCollapseConfig
}

/** 轮次过程折叠的可调参数。 */
export interface ProcessCollapseConfig {
  /** 轮次定稿后把中间过程(思考/工具调用等)折叠为「过程细节」行 */
  enabled: boolean
  /** 展开的过程区总高度达到该值(px)才在底部提供「收起过程」行 */
  bottomToggleMinHeight: number
}

/** 轮次过程折叠的可调参数。 */
export interface ProcessCollapseConfig {
  /** 轮次定稿后把中间过程(思考/工具调用等)折叠为「过程细节」行 */
  enabled: boolean
}

/**
 * 编译期默认值。必须与 src/config.ts 中 Schemastery schema 的默认值
 * 完全一致(由 test/client-config.test.js 断言守护)。
 */
export const CLIENT_DEFAULTS: ClientConfig = {
  fitMaxHeight: 360,
  zoomBoxHeight: 560,
  zoomMinScale: 0.15,
  zoomMaxScale: 6,
  renderTimeoutMs: 30000,
  themeAuto: true,
  darkColors: {
    shape: '#21262d',
    stroke: '#6e7681',
    cluster: '#161b22',
    edge: '#8b949e',
    text: '#e6edf3',
    canvas: '#0d1117',
  },
  thinkCollapse: {
    enabled: true,
    minBodyHeight: 320,
  },
  processCollapse: {
    enabled: true,
    bottomToggleMinHeight: 480,
  },
}

/** 从完整 host 配置投影出客户端子集(host 的 client-config 端点使用)。 */
export function clientConfigOf(config: ClientConfig): ClientConfig {
  return {
    fitMaxHeight: config.fitMaxHeight,
    zoomBoxHeight: config.zoomBoxHeight,
    zoomMinScale: config.zoomMinScale,
    zoomMaxScale: config.zoomMaxScale,
    renderTimeoutMs: config.renderTimeoutMs,
    themeAuto: config.themeAuto,
    darkColors: { ...config.darkColors },
    thinkCollapse: { ...config.thinkCollapse },
    processCollapse: { ...config.processCollapse },
  }
}

/**
 * 清洗网络下发的未知 JSON:字段缺失或类型不对时逐项回退到编译期默认值,
 * 保证浏览器半边拿到的一定是结构完好的 ClientConfig。
 */
export function sanitizeClientConfig(data: unknown): ClientConfig {
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback
  const str = (value: unknown, fallback: string) =>
    typeof value === 'string' ? value : fallback
  if (data === null || typeof data !== 'object') return CLIENT_DEFAULTS
  const src = data as Record<string, unknown>
  const dc = src.darkColors !== null && typeof src.darkColors === 'object'
    ? src.darkColors as Record<string, unknown>
    : {}
  const tc = src.thinkCollapse !== null && typeof src.thinkCollapse === 'object'
    ? src.thinkCollapse as Record<string, unknown>
    : {}
  const pc = src.processCollapse !== null && typeof src.processCollapse === 'object'
    ? src.processCollapse as Record<string, unknown>
    : {}
  return {
    fitMaxHeight: num(src.fitMaxHeight, CLIENT_DEFAULTS.fitMaxHeight),
    zoomBoxHeight: num(src.zoomBoxHeight, CLIENT_DEFAULTS.zoomBoxHeight),
    zoomMinScale: num(src.zoomMinScale, CLIENT_DEFAULTS.zoomMinScale),
    zoomMaxScale: num(src.zoomMaxScale, CLIENT_DEFAULTS.zoomMaxScale),
    renderTimeoutMs: num(src.renderTimeoutMs, CLIENT_DEFAULTS.renderTimeoutMs),
    themeAuto: bool(src.themeAuto, CLIENT_DEFAULTS.themeAuto),
    darkColors: {
      shape: str(dc.shape, CLIENT_DEFAULTS.darkColors.shape),
      stroke: str(dc.stroke, CLIENT_DEFAULTS.darkColors.stroke),
      cluster: str(dc.cluster, CLIENT_DEFAULTS.darkColors.cluster),
      edge: str(dc.edge, CLIENT_DEFAULTS.darkColors.edge),
      text: str(dc.text, CLIENT_DEFAULTS.darkColors.text),
      canvas: str(dc.canvas, CLIENT_DEFAULTS.darkColors.canvas),
    },
    thinkCollapse: {
      enabled: bool(tc.enabled, CLIENT_DEFAULTS.thinkCollapse.enabled),
      minBodyHeight: num(tc.minBodyHeight, CLIENT_DEFAULTS.thinkCollapse.minBodyHeight),
    },
    processCollapse: {
      enabled: bool(pc.enabled, CLIENT_DEFAULTS.processCollapse.enabled),
      bottomToggleMinHeight: num(pc.bottomToggleMinHeight, CLIENT_DEFAULTS.processCollapse.bottomToggleMinHeight),
    },
  }
}
