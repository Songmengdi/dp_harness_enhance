import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  actionLabelMatches,
  archiveAriaLabel,
  confirmLabel,
  localeForAriaLabel,
  sessionActionIndex,
} from '../lib/types/client/workspace-actions.js'

test('localeForAriaLabel: 按产品会话操作按钮的 aria-label 判定 zh/en', () => {
  assert.equal(localeForAriaLabel('Session actions for demo'), 'en')
  assert.equal(localeForAriaLabel('会话“demo”的操作'), 'zh')
  assert.equal(localeForAriaLabel(null), 'zh')
})

test('actionLabelMatches: 中英文案精确匹配且折叠空白', () => {
  assert.equal(actionLabelMatches('重命名', 'rename'), true)
  assert.equal(actionLabelMatches('Rename', 'rename'), true)
  assert.equal(actionLabelMatches(' 分叉会话 ', 'fork'), true)
  assert.equal(actionLabelMatches('Fork session', 'fork'), true)
  assert.equal(actionLabelMatches('归档会话', 'archive'), true)
  assert.equal(actionLabelMatches('Archive session', 'archive'), true)
  assert.equal(actionLabelMatches('Delete', 'archive'), false)
})

test('sessionActionIndex: 菜单条目顺序 rename/fork/archive', () => {
  assert.equal(sessionActionIndex('rename'), 0)
  assert.equal(sessionActionIndex('fork'), 1)
  assert.equal(sessionActionIndex('archive'), 2)
})

test('archiveAriaLabel: 与产品 aria-label 同构的归档按钮名', () => {
  assert.equal(archiveAriaLabel('en', 'demo'), 'Archive session demo')
  assert.equal(archiveAriaLabel('zh', '演示'), '归档会话“演示”')
})

test('confirmLabel: 归档确认按钮文案固定为「确认」', () => {
  assert.equal(confirmLabel(), '确认')
})
