import { promises as fsp } from 'node:fs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Runtime } from '../runtime.js'
import type { FenceRegistry, PathFence } from '../paths.js'

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
  return workspaceOfAgent(exec.agent)
}

export function workspaceOfAgent(agent: unknown): string | undefined {
  const session = (agent as { session?: unknown })?.session
  return (session as { header?: { cwd?: string } } | undefined)?.header?.cwd
}

/** 文件名主干净化：只留 [0-9A-Za-z._-]。 */
export function sanitizeStem(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  return String(raw).replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 40)
}

/** staging 生命周期：失败即清理目录并重抛。 */
export async function withStaging<T>(fence: PathFence, fn: (staging: string) => Promise<T>): Promise<T> {
  const staging = await fence.beginStaging()
  try {
    return await fn(staging)
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}
