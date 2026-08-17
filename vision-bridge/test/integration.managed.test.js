// 01 票验收：managed venv（锁定依赖）→ Runtime 总闸门 → media/frames 端到端（真实子进程）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { RuntimeManager } from '../lib/runtime-manager.js'
import { Runtime } from '../lib/runtime.js'
import { makeValidators } from '../lib/validators.js'
import { FenceRegistry } from '../lib/paths.js'
import { defineMediaTool } from '../lib/tools/media.js'
import { defineFramesTool } from '../lib/tools/frames.js'
import { VisionError } from '../lib/errors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')
const requirements = join(runtimeDir, 'requirements.lock')
const noop = { info() {}, warn() {}, error() {} }

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const hasFfprobe = spawnSync('ffprobe', ['-version']).status === 0

function makeVideo(dir, name = 'clip.mp4') {
  const p = join(dir, name)
  const r = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', p,
  ])
  assert.equal(r.status, 0, `ffmpeg 生成测试视频失败: ${r.stderr}`)
  return p
}

function execFor(workspace, signal = undefined) {
  return {
    signal: signal ?? new AbortController().signal,
    agent: { session: { header: { cwd: workspace } }, options: {}, id: 'x' },
    callId: 'c1',
    name: '',
    arguments: {},
  }
}

test('managed runtime: 首次启动建隔离 venv + 锁定依赖 + 探针就绪', async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-managed-'))
  try {
    const manager = new RuntimeManager({
      runtimeDir,
      stateDir: join(tmp, 'state'),
      python: 'python3',
      managed: true,
      venvDir: join(tmp, 'venv'),
      requirementsFile: requirements,
      prepareTimeoutMs: 180_000,
      logger: noop,
    })
    const generation = await manager.ensureReady()
    assert.ok(generation, `runtime 准备失败: ${manager.lastError}`)
    assert.equal(generation.ready, true)
    assert.ok(generation.pythonBin.includes(join(tmp, 'venv')))
    // 隔离环境里 Pillow 可用（锁定依赖装上了）
    const check = spawnSync(generation.pythonBin, ['-c', 'import PIL; print(PIL.__version__)'], { encoding: 'utf8' })
    assert.equal(check.status, 0, `venv 内 Pillow 不可用: ${check.stderr}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('managed runtime: 准备失败给出可修复的明确错误且返回 null（不发布能力）', async () => {
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-fail-'))
  try {
    const manager = new RuntimeManager({
      runtimeDir,
      stateDir: join(tmp, 'state'),
      python: '/definitely/missing/python-vb',
      managed: true,
      venvDir: join(tmp, 'venv'),
      requirementsFile: requirements,
      prepareTimeoutMs: 30_000,
      logger: noop,
    })
    const generation = await manager.ensureReady()
    assert.equal(generation, null)
    assert.match(manager.lastError ?? '', /修复/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('端到端: vision_media 结构化 JSON + vision_frames 抽帧提交产物（真实 venv + 子进程）', { timeout: 240_000 }, async (t) => {
  if (!hasFfmpeg || !hasFfprobe) {
    t.skip('本机没有 ffmpeg/ffprobe')
    return
  }
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-e2e-'))
  try {
    const ws = join(tmp, 'ws')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(ws, { recursive: true })
    const manager = new RuntimeManager({
      runtimeDir,
      stateDir: join(tmp, 'state'),
      python: 'python3',
      managed: true,
      venvDir: join(tmp, 'venv'),
      requirementsFile: requirements,
      prepareTimeoutMs: 180_000,
      logger: noop,
    })
    const runtime = new Runtime({
      manager,
      defaultTimeoutMs: 60_000,
      maxConcurrency: 2,
      logger: noop,
      validators: makeValidators(),
    })
    const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
    const mediaTool = defineMediaTool({ fences, runtime })
    const framesTool = defineFramesTool({ fences, runtime })

    const video = makeVideo(ws)
    const media = await mediaTool.execute({ path: 'clip.mp4' }, execFor(ws))
    assert.equal(typeof media.durationSeconds, 'string')
    assert.ok(Number(media.durationSeconds) > 1.5, '时长应接近 2 秒')
    assert.equal(media.formatName, 'mov,mp4,m4a,3gp,3g2,mj2')
    const videoStream = media.streams.find((s) => s.type === 'video')
    assert.equal(videoStream.codec, 'h264')
    assert.equal(videoStream.width, 320)
    assert.equal(videoStream.height, 240)
    assert.ok(media.sizeBytes > 0)
    assert.ok(media.bitRate > 0)

    const frames = await framesTool.execute({ path: 'clip.mp4', times: '0:01,1.5' }, execFor(ws))
    assert.equal(frames.frames.length, 2)
    assert.ok(frames.dir.endsWith(join('artifacts', 'vision-bridge')))
    for (const f of frames.frames) {
      assert.ok(f.path.startsWith(frames.dir))
      assert.ok(existsSync(f.path), `帧文件应已提交: ${f.path}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('端到端: 符号链接逃逸在工具层被拒绝', { timeout: 240_000 }, async (t) => {
  if (!hasFfprobe) {
    t.skip('本机没有 ffprobe')
    return
  }
  const tmp = mkdtempSync(join(os.tmpdir(), 'vb-esc-'))
  try {
    const ws = join(tmp, 'ws')
    const outside = join(tmp, 'outside')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(ws, { recursive: true })
    mkdirSync(outside, { recursive: true })
    const video = makeVideo(outside)
    symlinkSync(video, join(ws, 'link.mp4'))
    const manager = new RuntimeManager({
      runtimeDir,
      stateDir: join(tmp, 'state'),
      python: 'python3',
      managed: true,
      venvDir: join(tmp, 'venv'),
      requirementsFile: requirements,
      prepareTimeoutMs: 180_000,
      logger: noop,
    })
    const runtime = new Runtime({
      manager, defaultTimeoutMs: 60_000, maxConcurrency: 2, logger: noop, validators: makeValidators(),
    })
    const fences = new FenceRegistry([], 'artifacts/vision-bridge', 'inputs/vision-bridge')
    const mediaTool = defineMediaTool({ fences, runtime })
    await assert.rejects(
      () => mediaTool.execute({ path: 'link.mp4' }, execFor(ws)),
      (e) => e instanceof VisionError && e.category === 'input',
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
