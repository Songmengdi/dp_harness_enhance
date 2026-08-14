/**
 * dsh-mermaid-renderer 配置契约:导出 Config 类型 + 同名 Schemastery schema,
 * 默认值写在 schema 里(可调参数一律字段化,不许硬编码)。
 * 客户端可见子集(CLIENT_DEFAULTS 等)来自 shared/client-config.ts,
 * 由单测断言两者默认值一致。
 */
import Schema from '@deepseek-ai/schemastery'
import { CLIENT_DEFAULTS, clientConfigOf, type ClientConfig, type DarkColors } from './shared/client-config.js'

export interface Config {
  /** Kroki 兼容渲染服务基地址(host 半边使用) */
  krokiBaseUrl: string
  /** Kroki 渲染路径(拼在基地址后) */
  krokiPath: string
  /** 上游渲染请求超时(ms) */
  upstreamTimeoutMs: number
  /** 渲染请求体上限(字节,超出返回 413) */
  maxBodyBytes: number
  /** 单张图源码上限(字节,超出返回 400) */
  maxDiagramBytes: number
  /** 适配模式最大展示高度(px) */
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
}

export const Config: Schema<Config> = Schema.object({
  krokiBaseUrl: Schema.string().default('https://kroki.io'),
  krokiPath: Schema.string().default('/mermaid/svg'),
  upstreamTimeoutMs: Schema.number().min(1000).max(120000).default(30000),
  maxBodyBytes: Schema.number().min(1024).max(1000000).default(200000),
  maxDiagramBytes: Schema.number().min(256).max(100000).default(40000),
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
})

export { CLIENT_DEFAULTS, clientConfigOf }
export type { ClientConfig, DarkColors }
