import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Runtime } from '../runtime.js'
import type { FenceRegistry } from '../paths.js'

export interface ToolEnv {
  fences: FenceRegistry
  runtime: Runtime
}

/** 结构化结果统一渲染为 JSON 文本。 */
export function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** 契约输出：任意 JSON（具体结构由 Host 侧 validators + Python 契约保证）。 */
export function jsonOutput() {
  return { schema: { type: 'json' as const }, render: renderJson }
}

export function agentWorkspace(exec: { agent?: unknown }): string | undefined {
  const agent = exec.agent as { session?: { cwd?: string } } | undefined
  return agent?.session?.cwd
}
