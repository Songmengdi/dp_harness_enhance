/**
 * dsh-session-ui-enhance 配置契约:导出 Config 类型 + 同名 Schemastery schema,
 * 默认值写在 schema 里(可调参数一律字段化,不许硬编码)。
 *
 * v1.3.0 起 mermaid 渲染改为浏览器本地 mermaid.js(不再代理 Kroki),
 * 因此 Config 与客户端可见子集完全同构;CLIENT_DEFAULTS 来自
 * shared/client-config.ts,由单测断言两者默认值一致(防漂移)。
 */
import Schema from '@deepseek-ai/schemastery'
import { CLIENT_DEFAULTS, clientConfigOf, type ClientConfig, type DarkColors, type ProcessCollapseConfig, type ThinkCollapseConfig } from './shared/client-config.js'

export interface Config {
  /** 适配模式最大展示高度(px) */
  fitMaxHeight: number
  /** 缩放模式容器高度(px) */
  zoomBoxHeight: number
  /** 缩放下限 */
  zoomMinScale: number
  /** 缩放上限 */
  zoomMaxScale: number
  /** 单图渲染超时(ms,本地渲染的兜底护栏) */
  renderTimeoutMs: number
  /** 跟随 GUI 深色主题渲染 dark theme(图源显式 init 指令优先) */
  themeAuto: boolean
  /** 深色重着色调色板 */
  darkColors: DarkColors
  /** 思考块底部收起(展开的高 Think 块底部提供「收起」小字按钮) */
  thinkCollapse: ThinkCollapseConfig
  /** 轮次过程折叠(定稿后中间过程收成「过程细节」一行,zcode 式) */
  processCollapse: ProcessCollapseConfig
}

export const Config: Schema<Config> = Schema.object({
  fitMaxHeight: Schema.number().min(120).max(2000).default(CLIENT_DEFAULTS.fitMaxHeight),
  zoomBoxHeight: Schema.number().min(200).max(1200).default(CLIENT_DEFAULTS.zoomBoxHeight),
  zoomMinScale: Schema.number().min(0.05).max(1).default(CLIENT_DEFAULTS.zoomMinScale),
  zoomMaxScale: Schema.number().min(1).max(16).default(CLIENT_DEFAULTS.zoomMaxScale),
  renderTimeoutMs: Schema.number().min(1000).max(120000).default(CLIENT_DEFAULTS.renderTimeoutMs),
  themeAuto: Schema.boolean().default(CLIENT_DEFAULTS.themeAuto),
  darkColors: Schema.object({
    shape: Schema.string().default(CLIENT_DEFAULTS.darkColors.shape),
    stroke: Schema.string().default(CLIENT_DEFAULTS.darkColors.stroke),
    cluster: Schema.string().default(CLIENT_DEFAULTS.darkColors.cluster),
    edge: Schema.string().default(CLIENT_DEFAULTS.darkColors.edge),
    text: Schema.string().default(CLIENT_DEFAULTS.darkColors.text),
    canvas: Schema.string().default(CLIENT_DEFAULTS.darkColors.canvas),
  }),
  thinkCollapse: Schema.object({
    enabled: Schema.boolean().default(CLIENT_DEFAULTS.thinkCollapse.enabled),
    minBodyHeight: Schema.number().min(160).max(1200).default(CLIENT_DEFAULTS.thinkCollapse.minBodyHeight),
  }),
  processCollapse: Schema.object({
    enabled: Schema.boolean().default(CLIENT_DEFAULTS.processCollapse.enabled),
    bottomToggleMinHeight: Schema.number().min(160).max(4000).default(CLIENT_DEFAULTS.processCollapse.bottomToggleMinHeight),
  }),
})

export { CLIENT_DEFAULTS, clientConfigOf }
export type { ClientConfig, DarkColors, ThinkCollapseConfig, ProcessCollapseConfig }
