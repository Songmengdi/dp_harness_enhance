import Schema from '@deepseek-ai/schemastery'

/** 装配行配置；非法值在装配时被 schema 拒绝，任何能力发布之前失败。 */
export const Config = Schema.object({
  /** 会话工作区之外仍允许读取的目录（绝对路径，realpath 后比对）。 */
  allowedDirs: Schema.array(Schema.string()).default([]),
  /** 工作区内产物固定子目录（相对工作区）。 */
  artifactsDir: Schema.string().default('artifacts/vision-bridge'),
  /** 工作区内输入固定子目录（粘贴截图落地，03 票使用）。 */
  inputsDir: Schema.string().default('inputs/vision-bridge'),
  /** managed venv 目录；留空自动取 DSH_HOME 或 ~/.dsh 下的 storages 目录。 */
  venvDir: Schema.string().default(''),
  /** 建 venv 用的基础解释器。 */
  python: Schema.string().default('python3'),
  /** managed 模式：按 runtime/requirements.lock 建隔离环境；false 直接用系统 python3。 */
  managed: Schema.boolean().default(true),
  /** 锁定依赖文件（相对本包目录）；留空用 runtime/requirements.lock。 */
  requirementsFile: Schema.string().default(''),
  /** 视觉操作的并发信号量上限。 */
  maxConcurrency: Schema.number().default(2).min(1),
  /** 默认整操作超时（毫秒）。 */
  defaultTimeoutMs: Schema.number().default(120000).min(1000),
  /** runtime 准备 / 探针超时（毫秒）。 */
  prepareTimeoutMs: Schema.number().default(180000).min(5000),
  /** 视觉 API 端点（OpenAI-compatible base URL 或 Anthropic 端点前缀）；空 = 远程工具未配置。 */
  endpoint: Schema.string().default(''),
  /** 视觉模型 id。 */
  model: Schema.string().default(''),
  /** 协议：openai-completions（/chat/completions + Bearer）| anthropic-messages（/v1/messages + x-api-key）。 */
  protocol: Schema.string().default('openai-completions'),
  /** DSH Credential 引用名（只存引用，凭据每次现取现用、只进子进程环境）。 */
  credential: Schema.string().default(''),
  /** 视觉回答语言（进 prompt 与 glance 缓存键）。 */
  language: Schema.string().default('中文'),
  /** 远程操作整操作硬超时（毫秒）。 */
  visionTimeoutMs: Schema.number().default(90000).min(5000),
  /** 429/5xx/网络错误退避重试上限。 */
  maxRetries: Schema.number().default(2).min(0).max(5),
  /** vision_glance 会话级成功缓存 TTL（毫秒，0 = 关闭）。 */
  glanceCacheTtlMs: Schema.number().default(1800000).min(0),
  /** seamless 桥：bash 出图后自动补 VLM 描述（默认关；开启时最多前 2 张、带当前意图）。 */
  autoDescribeBashShots: Schema.boolean().default(false),
})

export interface VisionBridgeConfig {
  allowedDirs: string[]
  artifactsDir: string
  inputsDir: string
  venvDir: string
  python: string
  managed: boolean
  requirementsFile: string
  maxConcurrency: number
  defaultTimeoutMs: number
  prepareTimeoutMs: number
  endpoint: string
  model: string
  protocol: string
  credential: string
  language: string
  visionTimeoutMs: number
  maxRetries: number
  glanceCacheTtlMs: number
  autoDescribeBashShots: boolean
}

/** 子目录名必须是相对路径、不能逃逸工作区。 */
export function assertSafeSubdir(name: string, label: string): void {
  if (!name || name.startsWith('/') || name.includes('..')) {
    throw new Error(`${label} 必须是工作区内的相对子目录（收到 ${JSON.stringify(name)}）`)
  }
}
