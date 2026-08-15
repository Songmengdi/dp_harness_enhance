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

/** 左侧工作区会话行的操作入口改造。 */
export interface WorkspaceActionsConfig {
  /** 会话行「...」按钮改为带确认浮层的归档按钮,重命名/分叉会话移入右键菜单 */
  enabled: boolean
}

/** 用户消息气泡的重排与超长收缩。 */
export interface UserBubbleConfig {
  /** 用户气泡精致化(小圆角/紧凑字号/细描边)与超长收缩 */
  enabled: boolean
  /** 气泡内容超过该高度(px)时收缩为渐变截断 + 「展开全部」 */
  collapseHeight: number
}

/** 底部输入框(composer)的精致化重排与键盘交互。 */
export interface ComposerStyleConfig {
  /** composer 卡片小圆角/紧凑字号/焦点描边环重排 */
  enabled: boolean
  /** 斜杠候选菜单打开时,普通 Tab 等效 Enter 把高亮技能/命令上屏(Shift+Tab 不拦) */
  slashTabConfirm: boolean
}

/** 模型选择与推理等级拆分为输入区两个直接级联的触发按钮。 */
export interface ModelSplitConfig {
  /** 是否用拆分式「模型 / 推理等级」双按钮接管 composer 模型 seat */
  enabled: boolean
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
  /** 工作区会话行操作(归档按钮 + 右键菜单) */
  workspaceActions: WorkspaceActionsConfig
  /** 用户消息气泡(精致化 + 超长收缩) */
  userBubble: UserBubbleConfig
  /** 底部输入框精致化 */
  composer: ComposerStyleConfig
  /** 模型选择与推理等级拆分(输入区双按钮直接级联) */
  modelSplit: ModelSplitConfig
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
  workspaceActions: {
    enabled: true,
  },
  userBubble: {
    enabled: true,
    collapseHeight: 160,
  },
  composer: {
    enabled: true,
    slashTabConfirm: true,
  },
  modelSplit: {
    enabled: true,
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
    workspaceActions: { ...config.workspaceActions },
    userBubble: { ...config.userBubble },
    composer: { ...config.composer },
    modelSplit: { ...config.modelSplit },
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
  const wa = src.workspaceActions !== null && typeof src.workspaceActions === 'object'
    ? src.workspaceActions as Record<string, unknown>
    : {}
  const ub = src.userBubble !== null && typeof src.userBubble === 'object'
    ? src.userBubble as Record<string, unknown>
    : {}
  const cp = src.composer !== null && typeof src.composer === 'object'
    ? src.composer as Record<string, unknown>
    : {}
  const ms = src.modelSplit !== null && typeof src.modelSplit === 'object'
    ? src.modelSplit as Record<string, unknown>
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
    workspaceActions: {
      enabled: bool(wa.enabled, CLIENT_DEFAULTS.workspaceActions.enabled),
    },
    userBubble: {
      enabled: bool(ub.enabled, CLIENT_DEFAULTS.userBubble.enabled),
      collapseHeight: num(ub.collapseHeight, CLIENT_DEFAULTS.userBubble.collapseHeight),
    },
    composer: {
      enabled: bool(cp.enabled, CLIENT_DEFAULTS.composer.enabled),
      slashTabConfirm: bool(cp.slashTabConfirm, CLIENT_DEFAULTS.composer.slashTabConfirm),
    },
    modelSplit: {
      enabled: bool(ms.enabled, CLIENT_DEFAULTS.modelSplit.enabled),
    },
  }
}
