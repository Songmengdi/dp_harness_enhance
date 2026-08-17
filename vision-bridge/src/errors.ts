/** Route C 稳定错误类别（01 票冻结，Host 侧统一）。 */
export type ErrorCategory =
  | 'config'
  | 'input'
  | 'capacity'
  | 'upstream'
  | 'runtime'
  | 'output'
  | 'cancelled'
  | 'timeout'

/** 所有对外错误统一携带稳定类别。 */
export class VisionError extends Error {
  readonly category: ErrorCategory
  constructor(category: ErrorCategory, message: string) {
    super(message)
    this.name = 'VisionError'
    this.category = category
  }
  override toString() {
    return `[${this.category}] ${this.message}`
  }
}

export function isVisionError(e: unknown): e is VisionError {
  return e instanceof VisionError
}
