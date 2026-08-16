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
}

/** 子目录名必须是相对路径、不能逃逸工作区。 */
export function assertSafeSubdir(name: string, label: string): void {
  if (!name || name.startsWith('/') || name.includes('..')) {
    throw new Error(`${label} 必须是工作区内的相对子目录（收到 ${JSON.stringify(name)}）`)
  }
}
