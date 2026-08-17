// 02 票验收：提示词单源 —— 明眼人协议与 focus hint 模板只存在于 Python 运行时一处。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'runtime')

test('prompts: 明眼人协议只定义一次（python 文件内单源）', () => {
  const prompts = readFileSync(join(runtimeDir, 'dsh_vision', 'prompts.py'), 'utf8')
  assert.match(prompts, /SYSTEM_DESCRIBE\s*=\s*\(/)
  assert.match(prompts, /SYSTEM_ASK\s*=\s*\(/)
  // 协议正文只在 prompts.py 出现（其他命令只 import）
  const protocolFragment = '完整、独立的全景描述'
  const inPrompts = prompts.split(protocolFragment).length - 1
  assert.equal(inPrompts, 1, '协议正文必须在 prompts.py 只出现一次')
})

test('prompts: focus hint 截尾 500 字符且声明只用于判断重点', () => {
  const r = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, ${JSON.stringify(runtimeDir)})
from dsh_vision.prompts import focus_hint
h = focus_hint('x' * 900)
assert len(h) <= 500 + len('重点（只用于判断重点，与图无关请忽略）：'), len(h)
assert h.startswith('重点（只用于判断重点，与图无关请忽略）：')
assert focus_hint('') == ''
assert focus_hint(None) == ''
print('hint-ok')
`], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('prompts: host 侧源码不含协议全文（只有 Python 单源）', () => {
  // host 侧不复制协议正文；deny 指路文案等按 03 票另建 skill 单一来源
  const indexSrc = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
  assert.ok(!indexSrc.includes('完整、独立的全景描述'))
})
