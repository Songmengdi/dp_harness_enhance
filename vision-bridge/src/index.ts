import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Config, assertSafeSubdir, type VisionBridgeConfig } from './config.js'
import { createLogger } from './logger.js'
import { FenceRegistry } from './paths.js'
import { RuntimeManager } from './runtime-manager.js'
import { Runtime } from './runtime.js'
import { createCapabilityChecker } from './capabilities.js'
import { Exposure } from './exposure.js'
import { makeValidators } from './validators.js'
import { RemoteVision, GlanceCache } from './remote.js'
import { defineMediaTool } from './tools/media.js'
import { defineFramesTool } from './tools/frames.js'
import { defineGlanceTool } from './tools/glance.js'
import { defineGroundTool, defineDetectTool } from './tools/ground.js'
import { defineCropTool } from './tools/crop.js'
import { definePixelDiffTool } from './tools/pixel-diff.js'
import { defineDominantColorsTool } from './tools/dominant-colors.js'

export const name = 'dsh-vision-bridge'
export { Config }
export type { VisionBridgeConfig }

export function apply(ctx: Context, config: VisionBridgeConfig) {
  // ── 装配时校验（非法配置在发布任何能力前失败） ──
  assertSafeSubdir(config.artifactsDir, 'artifactsDir')
  assertSafeSubdir(config.inputsDir, 'inputsDir')
  for (const dir of config.allowedDirs) {
    if (!dir.startsWith('/')) {
      throw new Error(`allowedDirs 必须是绝对路径（收到 ${JSON.stringify(dir)}）`)
    }
  }
  if (config.venvDir && !config.venvDir.startsWith('/')) {
    throw new Error(`venvDir 必须是绝对路径（收到 ${JSON.stringify(config.venvDir)}）`)
  }
  if (config.credential && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.credential)) {
    throw new Error(`credential 必须是合法的 DSH Credential 引用名（POSIX 标识符，收到 ${JSON.stringify(config.credential)}）`)
  }

  const logger = createLogger(ctx)
  const packageRoot = dirname(fileURLToPath(import.meta.url))
  const runtimeDir = join(packageRoot, 'runtime')
  const homeRoot = process.env.DSH_HOME || join(os.homedir(), '.dsh')
  const stateDir = join(homeRoot, 'storages', 'dsh-vision-bridge')

  // runtime 没就绪就不发布任何模型能力（D8：健康状态走日志）。
  let startupError: string | null = null
  const manager = new RuntimeManager({
    runtimeDir,
    stateDir,
    python: config.python,
    managed: config.managed,
    venvDir: config.venvDir,
    requirementsFile: config.requirementsFile,
    prepareTimeoutMs: config.prepareTimeoutMs,
    logger,
    onReady: publishGuides,
  })
  const runtime = new Runtime({
    manager,
    defaultTimeoutMs: config.defaultTimeoutMs,
    maxConcurrency: config.maxConcurrency,
    logger,
    validators: makeValidators(),
  })
  const fences = new FenceRegistry(config.allowedDirs, config.artifactsDir)
  const capability = createCapabilityChecker(ctx, logger)

  const remote = new RemoteVision(ctx, runtime, {
    endpoint: config.endpoint,
    model: config.model,
    credential: config.credential,
    language: config.language,
    visionTimeoutMs: config.visionTimeoutMs,
    maxRetries: config.maxRetries,
  }, logger)
  const cache = new GlanceCache(config.glanceCacheTtlMs, logger)
  const toolEnv = { fences, runtime }
  const remoteEnv = { fences, runtime, remote, cache }

  const mediaTool = defineMediaTool(toolEnv)
  const framesTool = defineFramesTool(toolEnv)
  const glanceTool = defineGlanceTool(remoteEnv)
  const groundTool = defineGroundTool(remoteEnv)
  const detectTool = defineDetectTool(remoteEnv)
  const cropTool = defineCropTool(toolEnv)
  const pixelDiffTool = definePixelDiffTool(toolEnv)
  const dominantColorsTool = defineDominantColorsTool(toolEnv)
  const execTools: ToolDefinition[] = [
    mediaTool, framesTool, glanceTool, groundTool, detectTool, cropTool, pixelDiffTool, dominantColorsTool,
  ]

  const exposure = new Exposure(ctx, {
    runtimeReady: () => startupError === null && manager.ready,
    seesImages: capability.seesImages,
    execTools: () => execTools,
    execToolNames: () => execTools.map((t) => t.name),
    logger,
  })

  function publishGuides(): void {
    if (startupError !== null || !manager.ready) return
    for (const agent of ctx.agents.list()) exposure.handleAgentCreated(agent)
  }

  // ── 生命周期 ──
  ctx.on('agent/created', (payload: { agent: Parameters<typeof exposure.handleAgentCreated>[0] }) => {
    exposure.handleAgentCreated(payload.agent)
  })
  ctx.on('agent/disposed', (payload: { agent: Parameters<typeof exposure.handleAgentCreated>[0] }) => {
    cache.drop(payload.agent.id)
    exposure.handleAgentDisposed(payload.agent)
  })
  ctx.on('llm/adapters-updated', () => capability.invalidate())

  ctx.effect(() => () => {
    exposure.disposeAll()
    manager.dispose()
  })

  // ── 启动：allowedDirs realpath 校验 → 准备运行时 → 向已存在 Agent 补发引导工具 ──
  void (async () => {
    try {
      for (const dir of config.allowedDirs) await fsp.realpath(dir)
    } catch (e) {
      startupError = `allowedDirs 校验失败（${e instanceof Error ? e.message : String(e)}）`
      logger.error({}, `vision 能力不发布: ${startupError}`)
      return
    }
    const generation = await manager.ensureReady()
    if (generation === null) {
      logger.error({}, `vision 能力不发布: ${manager.lastError ?? 'runtime 准备失败'}`)
      return
    }
    publishGuides()
  })()
}
