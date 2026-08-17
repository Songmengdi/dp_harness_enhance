import Schema from '@deepseek-ai/schemastery'

export interface ViewportConfig {
  width: number
  height: number
}

export interface BrowserUseConfig {
  executablePath?: string
  channel?: string
  headless: boolean
  userDataDir?: string
  viewport: ViewportConfig
  navigationTimeoutMs: number
  actionTimeoutMs: number
  screenshotDir: string
  allowEval: boolean
  allowPrivate: boolean
  allowedHosts: string[]
  blockedHosts: string[]
  enableMcpBridge: boolean
}

export const Config = Schema.object({
  executablePath: Schema.string(),
  channel: Schema.string(),
  headless: Schema.boolean().default(false),
  userDataDir: Schema.string(),
  viewport: Schema.object({
    width: Schema.number().default(1280),
    height: Schema.number().default(800),
  }),
  navigationTimeoutMs: Schema.number().default(30_000),
  actionTimeoutMs: Schema.number().default(15_000),
  screenshotDir: Schema.string().default('browser-screenshots'),
  allowEval: Schema.boolean().default(false),
  allowPrivate: Schema.boolean().default(true),
  allowedHosts: Schema.array(Schema.string()).default([]),
  blockedHosts: Schema.array(Schema.string()).default([]),
  enableMcpBridge: Schema.boolean().default(true),
})
