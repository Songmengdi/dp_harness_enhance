# dsh-tool-bootstrap

Anchored tool-catalog bootstrap gate for dsh agent presets(「锚定式工具目录引导」)。

思路和首版行为对齐社区项目
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)(MIT):
会话的第一次模型请求只暴露一个小目录(当前平台 shell + `read`),出现晋升信号后,后续请求开放
preset 的完整工具目录。随附 preset 已启用 `prewarm`:**插件自动以 `ls` 消息驱动 turn 1,用户的真实
消息从 turn 2 开始**;关闭 `prewarm` 时退化为上游式「用户第一条消息就是 request #1」。本包只携带
**机制**,不把工具清单写死在插件里,因此可以挂到任意 preset 上。

## 为什么这样做

DeepSeek V4 Pro 会强烈依赖 API 中可见的工具目录选择执行轨迹。Standard 全程完整目录的轨迹不如
Minimal 锚定轨迹稳定,但全程 Minimal 又缺少大部分工具。锚定方案把两者拆开:

1. 第一次模型请求保持 Minimal 对齐的 system prompt,并只暴露 `bash/read`(Windows 为 `pwsh/read`);
2. 出现晋升信号后开放完整工具目录。两种驱动方式:
   - **prewarm(随附 preset 默认)**:插件在会话创建/选定本 preset 后,自动以
     `Run the bash command ls and reply with exactly the word done.` 驱动 turn 1,
     `promoteOn: first-turn-complete` 让整个预热回合停留在 bootstrap,用户的真实消息从 turn 2 开始;
   - **无 prewarm**:用户第一条消息就是 request #1,默认 `either` 在首个持久 `tool/call` **或**
     首个 `assistant/message` 先到者为准时晋升,纯文字首答不会把会话困在 bootstrap;
3. 首个请求同时压小 `maxTokens`(默认 1024),并剥离 skill catalog 等 pre-step 注入;
4. 阶段从持久 session events 推导,resume / reload 不丢状态。

## 机制(harness 0.1.0-rc.6 契约)

- `inject: [timer]`;本插件的 `agent/pre-step` 监听器以 `prepend` 注册,恒为瀑布最外层:
  rc.6 的 loader 并发激活 preset 行,行序不保证 listener 注册序(anchored-cordis e2e 已复现
  tool-skill 先注册导致 skill catalog 在我们的过滤之后追加),只有 prepend 能保证在
  tool-skill / agent-instructions 追加注入之后做最终过滤。行仍建议放在组合第一位。
  rc.6 的 agent-instructions 监听器因此也会被本插件压住,随附 preset 不挂该行,晋升后由
  本插件自行注入 AGENTS.md。
- 监听 `system-prompt/assemble` 瀑布:agent loop 以 `{ agent, scope: agent }` 调用 `assemble()`,
  scope 路由只让 preset 行看到自己会话的组装。
- 晋升判定读取 `agent.session.events`:默认 `either` 在首个 `tool/call` 或首个 `assistant/message`
  落盘后晋升;`first-turn-complete` 在首个 `turn/end` 落盘后晋升(整个预热回合保持 bootstrap)。
  每会话每进程记忆化。
- 监听 `agent/request`:bootstrap 请求的 `maxTokens` 压到 `bootstrapMaxTokens`;晋升后若下一请求
  仍继承该值,则显式剥离,恢复正常输出预算。
- `prewarm: true` 时自动驱动 turn 1:
  - 本插件实例所属 preset id 从 preset composition 目录(`ctx.baseUrl`)推导;
  - 两条触发路径:`agent/created`(scope-filtered,覆盖「创建即带 preset」)与
    `session/event` 的 `agent-preset/selected`(全局事件,以事件里的 preset id 对照,覆盖
    GUI 两步流:空白会话 → 选定 preset);
  - 两条路径都以 `prewarmed` 会话集合去重,投递经 `ctx.setTimeout(0)` 延后到
    `session.append` 栈外(append 不能重入);
  - 只预热空会话:已有 turn/user message、subagent、fork(seedLength>0)、delegationDepth>0
    的会话一律跳过;投递前再次核对会话仍组成于本 preset,空白窗口内切走 preset 不会误投。
- bootstrap 约束无法满足时不抛错,而是降级为完整目录并一次性告警,组合漂移不会锁死会话。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `shellTools` | `[bash, pwsh]` | 候选 shell;组装目录里必须恰好出现其中一个(取列表顺序第一个)。 |
| `alwaysTools` | `[read]` | bootstrap 阶段与 shell 一起保留的工具;每个都必须存在。 |
| `bootstrapTools` | — | 显式覆盖 bootstrap 目录(非空且每个都存在);设置后忽略上两项。空数组视为未设置。 |
| `promoteOn` | `first-turn-complete`(prewarm 开)/ `either`(prewarm 关) | 晋升信号:`either` / `tool-call` / `assistant-message` / `first-turn-complete`(首个持久 `turn/end`)。 |
| `bootstrapMaxTokens` | `1024` | bootstrap 请求的 `maxTokens` 上限;晋升后恢复正常预算。 |
| `prewarm` | `false` | `true` 时自动以 `prewarmMessage` 驱动 turn 1,用户真实消息从 turn 2 开始;随附 preset 已启用。 |
| `prewarmMessage` | `Run the bash command ls and reply with exactly the word done.` | prewarm turn 1 注入的用户消息文本;`prewarm: true` 时必须非空。 |
| `prewarmPersona` | `You are a helpful software engineer assistant.` | prewarm turn 1 的 system prompt:整个系统提示压成这一节(其余 section 全部剥离),晋升后恢复原 sections。空字符串 = 不替换。 |

## 锚定配方(随附 preset)

随附 preset 均启用 prewarm,序列为:

```
会话创建/选定 preset
- 插件自动注入用户消息 "Run the bash command ls and reply with exactly the word done."
turn 1(预热回合,由插件驱动)
- system prompt 逐字节 = prewarmPersona(默认 Minimal 一句话;harness identity 等其余
  section 全部剥离)
- tools = [bash, read](Windows 为 [pwsh, read])
- maxTokens = 1024
- 无 AGENTS.md、无 skill catalog
turn 1 结束
- 会话持久事件里出现首个 turn/end
turn 2 起(用户的真实消息)
- 恢复 preset 原 persona + 完整工具目录 + AGENTS.md + skill catalog
```

关闭 `prewarm`(并把 `promoteOn` 设为 `either`)即回到上游式配方:用户第一条消息就是 request #1,
首个 tool/call 或 assistant/message 后晋升,persona 保持 preset 原样。

`anchored-standard` 的原 persona 与上游 Minimal 逐字节一致(所以两轮 system prompt 相同);
`anchored-cordis` 的原 persona 是创造模式文本(含 `{{model}}`/`{{cwd}}` 变量),预热回合被换成
Minimal 一句话,第二轮恢复。两个 preset 的 persona 行均 `includeRuntimeContext: false`,
运行时 context 由 persona 行关闭。

`agent-instructions` 不随附在 preset 组合中:rc.6 中它恒定位于 pre-step 瀑布外层,首请求无法剥离;
AGENTS.md(全局 + 项目)由 `tool-bootstrap` 在晋升后的第一个 pre-step 自行注入。skill catalog
仍由 preset 的 `tool-skill` 行管理,晋升后自动恢复。

## 本地复现(anchored presets)

| 预设 | 基准模式 | bootstrap 目录 | persona |
|---|---|---|---|
| `anchored-standard` | 标准模式 | shell + read | Minimal 逐字节版本(上游配方) |
| `anchored-cordis` | 创造模式 | shell + read | cordis 原样(含 skills/,但不含 cordis_* 自省工具) |
| (code 模式) | PTC 模式 | — 不需要 | 目录本就是 run_code+SDK 的最小形态,锚定无意义 |

**已知约束**:官方 `cordis` 预设的 `tool-cordis` 注册的 Host Cordis Inspect 提供器是进程级单例
(固定 id、进程存活期内不释放),因此 `anchored-cordis` 刻意不随附 `tool-cordis` —— 与官方创造模式
同进程共存(本仓库 e2e 已复现该冲突:`Host Cordis inspect provider "Service" is already registered`)。
组合创作走 persona 指引 + 随带 skills + fs 工具;需要 `cordis_*` 自省工具时用官方创造模式。

同步脚本把行内 `__TOOL_BOOTSTRAP_LIB__` 占位符替换为本仓库构建产物的绝对路径,preset
直接从 checkout 加载插件(改代码 → 重建 → 新建会话即可,host 代码变化需重启 `dsh web`)。
`anchored-cordis` 随带的 `skills/` 目录一并同步。

```sh
npm install
npm run dev          # = build + sync:preset(全部预设)
```

`sync:preset` 幂等地写入 `$DSH_HOME/.agent-presets/<id>/`。然后重启/新建 dsh 会话,在
preset 选择器里选 **Anchored Standard (实验)** 或 **Anchored Cordis (实验)**。
不要在已经产生内容的会话中途切换 preset。

## 验证加载

### 自动端到端(`anchored-e2e` profile)

仓库附了一个一次性的 headless 测试 profile:真实 host 组合(`@deepseek-ai/dsh-base`,并按
`dsh-web-app` 的所有权边界禁用同名宿主行)+ 生产挂载路径(`ctx.agentPresets.mount`,与浏览器建会话
同一调用)+ 本仓库的 `scripts/e2e-runner.mjs`。它默认驱动两次真实用户回合并断言 bootstrap/晋升
边界;`E2E_PREWARM=1` 时改为等 preset 自动跑完预热回合,再把任务作为 turn 2 送入:

- 预热回合只含预配置的 prewarm 消息、首份 header 恰为 bootstrap 目录且 system 为 Minimal 锚定句,
  无 AGENTS.md / skill catalog;
- turn 2 起的 header 为完整目录并恢复 preset 原 persona,且恢复 AGENTS.md 与 skill catalog。

```sh
npm run sync:e2e-profile   # 同步 ~/.dsh/profiles/anchored-e2e 并 pnpm install
# 默认(用户消息即 request #1):
dsh --profile anchored-e2e "Run the bash command 'echo anchored-e2e-ok' and then reply with exactly the word done."
# prewarm(插件自动跑 ls 预热回合,任务作为 turn 2):
E2E_PREWARM=1 dsh --profile anchored-e2e "Run the bash command 'echo anchored-e2e-ok' and then reply with exactly the word done."
# 其他预设 / 自定义期望(环境变量):
E2E_PREWARM=1 \
E2E_PRESET_ID=anchored-cordis \
E2E_SELECT_PATH=1 \
E2E_PRE_SELECT=cordis \
E2E_TURN2_SYSTEM_CONTAINS='DeepSeek Harness' \
  dsh --profile anchored-e2e "Run the bash command 'echo anchored-e2e-ok' and then reply with exactly the word done."
```

目标预设与断言期望由环境变量决定:`E2E_PRESET_ID`(默认 anchored-standard)、
`E2E_BOOTSTRAP`(首份 header 应恰好包含的逗号分隔工具名,默认 bash,read)、
`E2E_FULL_INCLUDES`(晋升后目录必须包含的逗号分隔工具名,默认 write)、
`E2E_SELECT_PATH=1`(复刻 GUI 两步流)、`E2E_PRE_SELECT`(复刻 web 进程已有官方预设挂载的场景)、
`E2E_TURN1_SYSTEM`(turn 1 system prompt 精确值)/ `E2E_TURN1_SYSTEM_CONTAINS`(子串)、
`E2E_TURN2_SYSTEM_CONTAINS`(晋升后 system prompt 子串)。
报告是 JSON(checks / headersByTurn / messageKindsByTurn / toolCalls / pass),退出码 0 即通过;
prewarm 模式约消耗 3~4 次真实模型往返,默认模式约 2~3 次。

注意:e2e profile 必须用 **hoisted 平铺 node_modules**(`e2e-profile/.npmrc` 已配
`node-linker=hoisted`)。否则 dsh-base 的传递依赖经 Node 向上寻址落进共享的
`~/.dsh/profiles/node_modules`,与 profile 自装副本形成两份 `dsh-scope` 实例,preset 挂载会以
"refusing to compose an unscoped context" 失败。实测踩过,勿删该配置。

### 手工核对

导出用该 preset 跑过至少两条消息的会话 JSONL,检查 `request/header`:

1. 第一份 header 只有 `bash/read`(Windows 为 `pwsh/read`);
2. 首条消息产生 tool/call 或 assistant/message 后,下一份变更 header 包含完整目录;
3. 此后的请求保持完整目录。

会话日志在 `$DSH_HOME/sessions/<workspace>/<session-id>/session.jsonl.zstd`(`zstd -d` 解压后 grep
`request/header`),也可以直接用 Web GUI 的会话导出。

## 行为边界

- prewarm 只注入空会话;subagent / fork / 已有消息的会话不会被预热,恢复会话不重跑预热;
- prewarm 消息投递前会再核对会话仍组成于本 preset,空白窗口内切换 preset 不会误投;
- `first-turn-complete` 下,预热回合即使没有工具调用也照常在回合结束晋升,不会困死会话;
- 工具执行即使失败,只要 `tool/call` 已持久化,默认 `either` 的下一步仍晋升;
- bootstrap 工具缺失时降级为完整目录并告警,不会让请求失败;
- 工具目录只变化一次;
- 插件不发网络请求、不加遥测,与 shell 访问同信任等级,安装前自行审阅。

## 演化路线图

- v0.1 —— 复现 anchored-standard(bash/read 锚定 + 首次 tool/call 晋升)。
- v0.2 —— 多预设覆盖:`anchored-cordis`(创造模式,含 skills/,但不含 cordis_* 自省工具);
  e2e 驱动器参数化(`E2E_PRESET_ID`/`E2E_BOOTSTRAP`/`E2E_FULL_INCLUDES`)。
- v0.3 —— 对齐上游 PR #7 的首请求条件:`promoteOn: either`(纯文字首答不困死会话)、
  `bootstrapMaxTokens: 1024`、首请求剥离 AGENTS.md / skill catalog。
- v0.4(当前开发中)—— prewarm 回归:插件自动以 `ls` 消息驱动 turn 1,用户消息作为 turn 2;
  `promoteOn: first-turn-complete` 让整个预热回合保持 bootstrap,两条触发路径
  (`agent/created` 与 GUI 的 `agent-preset/selected`)幂等去重。
- 后续候选:多阶段晋升(如 bootstrap → 中级 → 全量)、按结果晋升(首个成功调用 / 连续 N 次失败回退)、
  host 平面按预设映射的"零快照"接入。

## 兼容性

开发与验证版本:DeepSeek Harness `0.1.0-rc.6`(仓库提交 `4dacfe77a24dead72de749c0876028b77b99cd04`)、
macOS / Node.js 24。Harness 仍是开发者预览版,升级后先对照上游 preset 与本包快照的差异再继续使用。

## 许可证

MIT。`presets/*/agent.cordis.yml` 基于 DeepSeek Harness 随附 preset 修改,原始版权归 DeepSeek;
思路归 `xiaobright/dsh-anchored-standard`(MIT)。
