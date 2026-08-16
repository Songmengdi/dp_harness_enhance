// 01 票验收：配置 schema 校验 + 非法配置在装配时失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config, assertSafeSubdir } from '../lib/config.js'

test('config: 空配置取默认值', () => {
  const config = Config({})
  assert.equal(config.artifactsDir, 'artifacts/vision-bridge')
  assert.equal(config.inputsDir, 'inputs/vision-bridge')
  assert.equal(config.managed, true)
  assert.equal(config.maxConcurrency, 2)
  assert.deepEqual(config.allowedDirs, [])
})

test('config: 类型非法被 schema 拒绝', () => {
  assert.throws(() => Config({ maxConcurrency: 0 }), /maxConcurrency|min/i)
  assert.throws(() => Config({ allowedDirs: [42] }))
  assert.throws(() => Config({ managed: 'yes' }))
})

test('config: 子目录名不能逃逸工作区', () => {
  assert.throws(() => assertSafeSubdir('', 'x'))
  assert.throws(() => assertSafeSubdir('/abs', 'x'))
  assert.throws(() => assertSafeSubdir('../up', 'x'))
  assert.throws(() => assertSafeSubdir('a/../../up', 'x'))
  assertSafeSubdir('artifacts/vision-bridge', 'ok')
})
