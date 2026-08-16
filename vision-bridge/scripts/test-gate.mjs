#!/usr/bin/env node
// test-gate.mjs — 测试门禁：零测试即失败。
// 前置门禁（verify 第一步）：必须有测试文件且注册了真实用例；
// node --test 本身保证跑过的用例里失败即非零退出。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testDir = join(root, 'test')
let files = []
try {
  files = readdirSync(testDir).filter((f) => f.endsWith('.test.js'))
} catch (e) {
  console.error(`test-gate: 没有 test/ 目录 — 零测试即失败`)
  process.exit(1)
}
if (files.length === 0) {
  console.error('test-gate: test/ 目录下没有 *.test.js — 零测试即失败')
  process.exit(1)
}
let totalCases = 0
for (const file of files) {
  const src = readFileSync(join(testDir, file), 'utf8')
  const count = (src.match(/\btest\s*\(/g) || []).length
  if (count === 0) {
    console.error(`test-gate: ${file} 没有注册任何 test() 用例 — 零测试即失败`)
    process.exit(1)
  }
  totalCases += count
}
if (statSync(testDir).isDirectory() === false) {
  console.error('test-gate: test/ 不是目录')
  process.exit(1)
}
console.log(`test-gate: OK — ${files.length} 个测试文件，${totalCases} 个 test() 用例`)
