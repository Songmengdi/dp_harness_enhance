import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isConfirmableTab, slashPickAvailable } from '../lib/types/client/slash-tab-logic.js'

const baseTab = {
  key: 'Tab',
  shiftKey: false,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 9,
}

test('isConfirmableTab: 普通 Tab + 功能开启才确认', () => {
  assert.equal(isConfirmableTab(baseTab, true), true)
  assert.equal(isConfirmableTab(baseTab, false), false)
  assert.equal(isConfirmableTab({ ...baseTab, key: 'Enter' }, true), false)
})

test('isConfirmableTab: Shift+Tab 留给反向焦点遍历', () => {
  assert.equal(isConfirmableTab({ ...baseTab, shiftKey: true }, true), false)
})

test('isConfirmableTab: repeat/修饰键/IME 组合一律放行', () => {
  assert.equal(isConfirmableTab({ ...baseTab, repeat: true }, true), false)
  assert.equal(isConfirmableTab({ ...baseTab, altKey: true }, true), false)
  assert.equal(isConfirmableTab({ ...baseTab, ctrlKey: true }, true), false)
  assert.equal(isConfirmableTab({ ...baseTab, metaKey: true }, true), false)
  assert.equal(isConfirmableTab({ ...baseTab, isComposing: true }, true), false)
  assert.equal(isConfirmableTab({ ...baseTab, keyCode: 229 }, true), false)
})

test('slashPickAvailable: 仅打开的斜杠菜单且已有高亮项', () => {
  const slash = { open: true, hit: { trigger: '/' }, highlight: { source: 'skill', index: 0 } }
  assert.equal(slashPickAvailable(slash), true)
  assert.equal(slashPickAvailable({ ...slash, open: false }), false)
  assert.equal(slashPickAvailable({ ...slash, hit: null }), false)
  assert.equal(slashPickAvailable({ ...slash, hit: { trigger: '@' } }), false)
  assert.equal(slashPickAvailable({ ...slash, highlight: null }), false)
})
