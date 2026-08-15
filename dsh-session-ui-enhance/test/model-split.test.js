import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentModelOf,
  effectiveEffortOf,
  effortChoicesOf,
  effortLabelOf,
  splitLocale,
} from '../lib/types/client/model-split-logic.js'

test('splitLocale: <html lang> 判定 en/zh,未知值 zh 兜底', () => {
  assert.equal(splitLocale('en'), 'en')
  assert.equal(splitLocale('EN-US'), 'en')
  assert.equal(splitLocale('zh-CN'), 'zh')
  assert.equal(splitLocale(null), 'zh')
  assert.equal(splitLocale(undefined), 'zh')
  assert.equal(splitLocale('fr'), 'zh')
})

test('currentModelOf: 只在已发布分组中回显 host 当前选择', () => {
  const state = {
    current: { provider: 'p1', model: 'm2' },
    groups: [
      { id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] },
    ],
  }
  assert.equal(currentModelOf(state)?.name, 'M2')
  assert.equal(currentModelOf({ ...state, current: null }), undefined)
  // 路由仍在服务但目录不再发布该模型:不回显、也不合成陈旧行。
  assert.equal(currentModelOf({ ...state, current: { provider: 'p1', model: 'stale' } }), undefined)
})

test('effectiveEffortOf: 显式选择 > 模型默认 > undefined', () => {
  const reasoning = { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'low' }
  assert.equal(effectiveEffortOf({ current: { provider: 'p', model: 'm', reasoningEffort: 'high' } }, reasoning), 'high')
  assert.equal(effectiveEffortOf({ current: { provider: 'p', model: 'm' } }, reasoning), 'low')
  assert.equal(effectiveEffortOf({ current: { provider: 'p', model: 'm' } }, undefined), undefined)
})

test('effortLabelOf: 无 reasoning 元数据不显示,未知 id 原样兜底', () => {
  const reasoning = { efforts: [{ id: 'high', name: '高' }], defaultEffort: 'low' }
  assert.equal(effortLabelOf(undefined, reasoning, 'zh'), '默认')
  assert.equal(effortLabelOf(undefined, reasoning, 'en'), 'Default')
  assert.equal(effortLabelOf('high', reasoning, 'zh'), '高')
  assert.equal(effortLabelOf('ghost', reasoning, 'zh'), 'ghost')
  assert.equal(effortLabelOf('low', undefined, 'zh'), undefined)
})

test('effortChoicesOf: 默认项按官方规则只在无 defaultEffort 时出现', () => {
  const withDefault = { efforts: [{ id: 'high', name: '高', description: '更多思考' }], defaultEffort: 'high' }
  assert.deepEqual(effortChoicesOf(withDefault, 'zh'), [
    { key: 'effort:high', effort: 'high', label: '高', description: '更多思考' },
  ])
  const withoutDefault = { efforts: [{ id: 'high', name: '高' }] }
  assert.deepEqual(effortChoicesOf(withoutDefault, 'en'), [
    { key: 'provider-default', effort: undefined, label: 'Default' },
    { key: 'effort:high', effort: 'high', label: '高' },
  ])
  assert.deepEqual(effortChoicesOf(undefined, 'zh'), [])
})
