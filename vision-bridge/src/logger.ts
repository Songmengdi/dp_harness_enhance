import type { Context, Logger } from '@deepseek-ai/cordis'

/** 结构化日志门面：健康状态走日志（D8）；失败缓存/指标也只进日志。 */
export interface BridgeLogger {
  info(fields: Record<string, unknown>, message?: string): void
  warn(fields: Record<string, unknown>, message?: string): void
  error(fields: Record<string, unknown>, message?: string): void
}

export function createLogger(ctx: Context): BridgeLogger {
  const logger: Logger | undefined = ctx.logger ? ctx.logger('vision-bridge') : undefined
  const fmt = (fields: Record<string, unknown>, message?: string) =>
    message === undefined ? JSON.stringify(fields) : `${message} ${JSON.stringify(fields)}`
  return {
    info: (fields, message) => logger?.info(fmt(fields, message)),
    warn: (fields, message) => logger?.warn(fmt(fields, message)),
    error: (fields, message) => logger?.error(fmt(fields, message)),
  }
}
