#!/usr/bin/env node
// sync-cli.js — 把 cli/dsh-vision（唯一真源）同步进 plugin/lib/index.js 的内嵌 CLI_SRC 块。
// 用法：
//   node vision-bridge/sync-cli.js            重新生成内嵌块
//   node vision-bridge/sync-cli.js --check    干跑比对：内嵌副本与真源漂移时非零退出
// 说明：运行时 installCli 优先安装 cli/dsh-vision 本体，内嵌块只是回退副本；
// 本脚本保证回退副本不漂移。改动 CLI 后跑一次本脚本（或直接依赖运行时读取）。
//
// 修复历史（Route C 01）：旧版用 src.replace(re, block) 写回，block 里含 CLI 源码，
// CLI 里的 "$'" 被 JS String.replace 解释成替换符（匹配之后的原文），把插件 JS 代码体
// 吞进 CLI 字符串中间。现在改为 indexOf/slice 纯文本拼接——替换串作为普通文本处理，
// 任何 $ 模式都不会被解释。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const cliPath = join(root, 'cli', 'dsh-vision')
const pluginPath = join(root, 'plugin', 'lib', 'index.js')
const checkOnly = process.argv.includes('--check')

const cli = readFileSync(cliPath, 'utf8')
if (!cli.startsWith('#!/usr/bin/env python3') || !cli.includes('dsh-vision')) {
  console.error('sync-cli: cli/dsh-vision 内容异常，拒绝同步')
  process.exit(1)
}

const src = readFileSync(pluginPath, 'utf8')
const BEGIN = '// ══ CLI_SRC_BEGIN'
const END = '// ══ CLI_SRC_END'
const beginIdx = src.indexOf(BEGIN)
if (beginIdx < 0) {
  console.error('sync-cli: 未找到 CLI_SRC_BEGIN 标记，拒绝同步')
  process.exit(1)
}
const endIdx = src.indexOf(END, beginIdx + BEGIN.length)
if (endIdx < 0) {
  console.error('sync-cli: 未找到 CLI_SRC_END 标记，拒绝同步')
  process.exit(1)
}

// String.raw 模板：仅需转义反引号与 ${（反斜杠原样保留）。
// 这两个 replace 的替换串都不含 $，CLI 文本是 subject 而不是 replacement，
// 因此 "$'" 之类内容原样保留。
const escapeRaw = (s) => s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const escaped = escapeRaw(cli)

// END 标记所在行整体替换（连同行尾注释），行首保留缩进。
const lineStart = src.lastIndexOf('\n', endIdx) + 1
const lineEnd = src.indexOf('\n', endIdx)

const block =
  BEGIN + ' ══（由 vision-bridge/sync-cli.js 从 cli/dsh-vision 自动同步，勿手改此块）\n' +
  '  const CLI_SRC = String.raw`' + escaped + '`\n' +
  '  ' + END + ' ══（以上内嵌 CLI 由 sync-cli.js 自动同步；运行时优先读 cli/dsh-vision）'

const regenerated =
  src.slice(0, beginIdx) + block + (lineEnd < 0 ? '' : src.slice(lineEnd))

if (checkOnly) {
  if (regenerated === src) {
    console.log('sync-cli: OK — 内嵌 CLI 与 cli/dsh-vision 一致')
    process.exit(0)
  }
  console.error('sync-cli: DRIFT — 内嵌 CLI 与 cli/dsh-vision 不一致；请运行 node vision-bridge/sync-cli.js')
  process.exit(1)
}

writeFileSync(pluginPath, regenerated)
console.log('synced: cli/dsh-vision -> plugin/lib/index.js (CLI_SRC)')
