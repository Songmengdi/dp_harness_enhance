// 01 票验收：输入 realpath 围栏（工作区 + allowedDirs）+ 产物 staging→原子提交。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { PathFence } from '../lib/paths.js'
import { VisionError } from '../lib/errors.js'

function makeWorkspace() {
  const ws = mkdtempSync(join(os.tmpdir(), 'vb-ws-'))
  const outside = mkdtempSync(join(os.tmpdir(), 'vb-out-'))
  const allowed = mkdtempSync(join(os.tmpdir(), 'vb-allowed-'))
  writeFileSync(join(ws, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))
  writeFileSync(join(outside, 'secret.png'), Buffer.from([1, 2, 3]))
  writeFileSync(join(allowed, 'lib.png'), Buffer.from([1, 2, 3]))
  symlinkSync(join(outside, 'secret.png'), join(ws, 'escape.png'))
  return { ws, outside, allowed }
}

test('fence: 工作区内相对/绝对路径可解析', async () => {
  const { ws, outside, allowed } = makeWorkspace()
  const fence = await PathFence.create(ws, [allowed], 'artifacts/vision-bridge')
  const real = await fence.resolveInput('a.png')
  assert.ok(real.endsWith('a.png'))
  const realAbs = await fence.resolveInput(join(ws, 'a.png'))
  assert.equal(realAbs, real)
  const realAllowed = await fence.resolveInput(join(allowed, 'lib.png'))
  assert.ok(realAllowed.endsWith('lib.png'))
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  rmSync(allowed, { recursive: true, force: true })
})

test('fence: 工作区外文件被拒绝（input 类别）', async () => {
  const { ws, outside, allowed } = makeWorkspace()
  const fence = await PathFence.create(ws, [allowed], 'artifacts/vision-bridge')
  await assert.rejects(
    () => fence.resolveInput(join(outside, 'secret.png')),
    (e) => e instanceof VisionError && e.category === 'input',
  )
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  rmSync(allowed, { recursive: true, force: true })
})

test('fence: 符号链接逃逸被拒绝', async () => {
  const { ws, outside, allowed } = makeWorkspace()
  const fence = await PathFence.create(ws, [allowed], 'artifacts/vision-bridge')
  await assert.rejects(
    () => fence.resolveInput(join(ws, 'escape.png')),
    (e) => e instanceof VisionError && e.category === 'input',
  )
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  rmSync(allowed, { recursive: true, force: true })
})

test('fence: 产物 staging 校验后原子提交进固定产物目录', async () => {
  const { ws, outside, allowed } = makeWorkspace()
  const fence = await PathFence.create(ws, [allowed], 'artifacts/vision-bridge')
  const staging = await fence.beginStaging()
  writeFileSync(join(staging, 'frame_01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]))
  const committed = await fence.commitFiles(staging, [{
    staging: 'frame_01.png',
    finalName: 'frames_x_01.png',
    sourceTool: 'vision_frames',
    kind: 'frame',
    description: 't=0:01',
    probe: (buf) => (buf.length >= 8 && buf[0] === 0x89 ? null : '不是 PNG'),
  }])
  assert.equal(committed.length, 1)
  assert.equal(committed[0].filename, 'frames_x_01.png')
  assert.equal(committed[0].mimeType, 'image/png')
  assert.ok(committed[0].path.startsWith(join(realpathSync(ws), 'artifacts', 'vision-bridge')))
  assert.ok(existsSync(committed[0].path))
  assert.equal(existsSync(staging), false, 'staging 目录应已清理')
  // 校验失败的文件不落地
  const staging2 = await fence.beginStaging()
  writeFileSync(join(staging2, 'bad.png'), Buffer.from([1, 2, 3]))
  await assert.rejects(
    () => fence.commitFiles(staging2, [{
      staging: 'bad.png',
      finalName: 'bad_final.png',
      sourceTool: 'vision_frames',
      kind: 'frame',
      description: 'x',
      probe: () => '不是 PNG',
    }]),
    (e) => e instanceof VisionError && e.category === 'output',
  )
  assert.equal(existsSync(join(ws, 'artifacts', 'vision-bridge', 'bad_final.png')), false)
  assert.equal(existsSync(staging2), false)
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  rmSync(allowed, { recursive: true, force: true })
})

test('fence: allowedDirs 不存在 → config 错误', async () => {
  const ws = mkdtempSync(join(os.tmpdir(), 'vb-ws-'))
  await assert.rejects(
    () => PathFence.create(ws, ['/definitely/not/here-vb'], 'artifacts/vision-bridge'),
    (e) => e instanceof VisionError && e.category === 'config',
  )
  rmSync(ws, { recursive: true, force: true })
})
