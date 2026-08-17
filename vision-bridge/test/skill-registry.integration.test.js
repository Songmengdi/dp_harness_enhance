// 真实 SkillRegistry 集成测试：防止 `agent.ctx.skills` 属性访问在 Cordis 独立 fiber 下抛错被吞。
// 根因：dsh AgentLoop 未 inject `skills`，必须用 `agent.ctx.get('skills')` 显式获取服务。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { Exposure } from '../lib/exposure.js'

const noop = { info() {}, warn() {}, error() {} }

test('真实 SkillRegistry：agent.ctx.get("skills") 注册后 catalog 可见且可加载', async () => {
  const app = new Context()
  new SkillRegistry(app)
  const skills = app.get('skills')
  assert.ok(skills, '真实 dsh-skill 服务应可用')

  const registered = []
  const disposals = []
  const tools = {
    register(def) {
      registered.push(def.name)
      return () => disposals.push(def.name)
    },
  }

  // 模拟 AgentLoop 的 ctx：没有可属性访问的 `skills`，只有 `get('skills')`。
  const agent = {
    id: 'real-skill',
    ctx: {
      tools,
      get(name) {
        if (name === 'skills') return skills
        throw new Error(`cannot get property "${name}" without inject`)
      },
    },
    options: { provider: 'p', model: 'm' },
    session: { header: { cwd: '/ws' }, events: [] },
  }

  const exposure = new Exposure({}, {
    runtimeReady: () => true,
    seesImages: async () => false,
    execTools: () => [{ name: 'vision_media' }, { name: 'vision_frames' }],
    execToolNames: () => ['vision_media', 'vision_frames'],
    logger: noop,
    skillDefinition: {
      name: 'vision-bridge',
      description: '视觉桥测试 skill',
      content: '# vision-bridge\n测试内容',
    },
    protocolSection: () => 'protocol',
  })

  exposure.activate(agent, 'read-intercept')

  const list = await skills.list()
  assert.ok(
    list.some((s) => s.name === 'vision-bridge'),
    '真实 SkillRegistry 的 catalog 应能看到 vision-bridge',
  )

  const loaded = await skills.get('vision-bridge')
  assert.ok(loaded, 'skill 应可加载')
  assert.equal(loaded.content, '# vision-bridge\n测试内容')
  assert.equal(loaded.source, 'bundled')
  assert.deepEqual(registered, ['vision_media', 'vision_frames'])
})
