import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

/**
 * 回归测试：dsh-browser-use 的 system-prompt/assemble 补丁必须用
 * `prepend: true` 注册成最外层 waterfall 监听，才能在 router-bootstrap
 * 把首轮 tools 过滤成最小目录后，把 browser_* 工具补回列表。
 *
 * 这个测试直接复刻 Cordis waterfall 的“先注册在外层、后注册在内层”语义：
 * - 先注册 router 监听（过滤 tools）
 * - 再注册 browser-use 监听（补回 browser_*）
 * 如果不 prepend，browser-use 会成为内层，先看到完整 tools，router 随后仍会
 * 把它们过滤掉；prepend 后 browser-use 先 next() 让 router 过滤，再补回。
 */
test('prepend 的 browser-use 监听能在 router 过滤后把 browser_* 放回最前', async () => {
  const app = new Context()
  const fullTools = [
    { name: 'browser_open', description: 'open' },
    { name: 'browser_snapshot', description: 'snap' },
    { name: 'bash', description: 'shell' },
    { name: 'str_replace_editor', description: 'edit' },
    { name: 'read', description: 'read' },
  ]
  const assembly = { sections: [], contexts: [], tools: fullTools, variables: {} }

  // 模拟 router-bootstrap：先注册、不加 prepend，把 tools 过滤成 core。
  app.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const core = new Set(['bash', 'str_replace_editor'])
    return { ...assembled, tools: assembled.tools.filter((tool) => core.has(tool.name)) }
  })

  // 模拟 dsh-browser-use 修复后：全局 + prepend，先 next 再补 browser_*。
  app.on('system-prompt/assemble', async (assembly, _context, next) => {
    const assembled = await next()
    const browserSchemas = assembly.tools.filter((tool) => tool.name.startsWith('browser_'))
    const existing = new Set(assembled.tools.map((tool) => tool.name))
    const missing = browserSchemas.filter((tool) => !existing.has(tool.name))
    return { ...assembled, tools: [...missing, ...assembled.tools] }
  }, { prepend: true })

  const result = await app.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly))

  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ['browser_open', 'browser_snapshot', 'bash', 'str_replace_editor'],
  )
})

test('不 prepend 时 browser-use 监听无法阻止 router 过滤（旧缺陷复现）', async () => {
  const app = new Context()
  const fullTools = [
    { name: 'browser_open', description: 'open' },
    { name: 'browser_snapshot', description: 'snap' },
    { name: 'bash', description: 'shell' },
    { name: 'str_replace_editor', description: 'edit' },
  ]
  const assembly = { sections: [], contexts: [], tools: fullTools, variables: {} }

  app.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const core = new Set(['bash', 'str_replace_editor'])
    return { ...assembled, tools: assembled.tools.filter((tool) => core.has(tool.name)) }
  })

  // 旧行为：不加 prepend（后注册 = 内层）。
  app.on('system-prompt/assemble', async (assembly, _context, next) => {
    const assembled = await next()
    const browserSchemas = assembly.tools.filter((tool) => tool.name.startsWith('browser_'))
    const existing = new Set(assembled.tools.map((tool) => tool.name))
    const missing = browserSchemas.filter((tool) => !existing.has(tool.name))
    return { ...assembled, tools: [...missing, ...assembled.tools] }
  })

  const result = await app.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly))

  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ['bash', 'str_replace_editor'],
  )
})
