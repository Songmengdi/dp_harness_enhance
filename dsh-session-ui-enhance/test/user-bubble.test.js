import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldCollapse } from '../lib/types/client/user-bubble.js'

test('shouldCollapse: 超过阈值+缓冲才折叠(避免刚超一行的尴尬折叠)', () => {
  assert.equal(shouldCollapse(160, 160), false)
  assert.equal(shouldCollapse(184, 160), false)
  assert.equal(shouldCollapse(185, 160), true)
  assert.equal(shouldCollapse(400, 160), true)
})
