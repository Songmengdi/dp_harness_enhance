---
name: dsh-capability-development
description: 指导如何为 DeepSeek Harness (dsh) 添加更强大的功能——开发新插件、新工具、Host/Client 能力、UI 扩展(slot/会话节点/浮层)、HTTP、持久化,或打包发布插件。Use when 用户想"给 dsh 加功能/扩展 dsh/写插件/开发工具/加 UI 入口"、提到 cordis 插件开发、dsh plugin add、slot、插件打包发布,或在本仓库的 dsh 插件项目里动手改代码时——即使没明说"插件"两个字。
metadata:
  version: "2.4.0"
  date: "2026-08-14"
  reference: "官方文档中文快照(本 skill references/) + 社区经验吸收自 https://github.com/NanmiCoder/dsh-agent-teams"
---

# dsh 能力扩展开发指南

为 DeepSeek Harness (dsh) 添加更强大功能时的执行手册。dsh 是"万物皆插件"的 Agent 运行时:llm、session、webserver、agent-loop 本身都是插件。本 skill 只管**代码插件**,给出**运行面判断 + 契约 + 工作流**,概念细节路由到 `references/deepseek-harness/`(官方文档中文快照,路径相对本 skill 目录解析)。

## 红线(全程)

- 不覆盖用户改动;未经授权不 commit / push / publish,不访问未授权私有仓库
- 不写死本机绝对路径
- 不把某个项目的偶然实现当成框架契约;行为不确定时按"取证顺序"查证,不猜
- 文档快照可能滞后:契约与 API 以已安装 `node_modules/@deepseek-ai/*` 和官方 checkout 的实际代码为准

## 第一步:判断运行面(动手前)

按能力落在哪:

| 能力 | 运行面 |
|---|---|
| 工具、system prompt、HTTP、持久化、provider | host |
| slot、会话节点、浏览器状态、浮层 | client |
| host 能力 + 需要 Web 可视化 | host + client |
| 无 Web 需求 | 不声明 `dsh.client`,不建 client bundle |

动笔前写下:插件唯一职责、依赖的 service、贡献的配置行、持久化归属、用户可见的验证面。

## 取证顺序(行为不确定时,按序查,不猜)

1. 本项目及已安装 `node_modules/@deepseek-ai/*` 的 `package.json`、`exports`、`types`、`README`
2. 环境提供的 DSH checkout(如 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`),只读分析
3. 浅克隆官方仓库只读取证(无需 `pnpm install`):
   ```sh
   SCRATCH="$(mktemp -d)"   # 临时目录,不写死本机绝对路径
   git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "$SCRATCH/dsh-official"
   ```
   - 同一任务只维护这一个目录,避免反复克隆;已存在且 `git remote -v` 指向官方、根目录含 `AGENTS.md` 与 `LICENSE` 时直接复用,需更新则 `git -C "$SCRATCH/dsh-official" fetch --depth 1 origin master && git -C "$SCRATCH/dsh-official" reset --hard origin/master`(或删除重克隆)
   - 只克隆官方 `deepseek-ai/deepseek-harness`,不访问未授权私有仓库;对克隆内容只读分析,不修改
   - 定位:先读根 `AGENTS.md`(仓库布局/命令/约定一次讲清),再用 `packages/README.md` 的 group 表定位目标包;记录 `git rev-parse HEAD` 供证据复现
4. 仍不足:以正式版 exports/types 为边界,选可安全失败的最小实现并标注假设

概念学习读 references 文档;契约验证读代码。

## 官方模板表(想做 X,先读 checkout 里的 Y)

| 目标 | checkout 主参考(路径以 checkout 根为准) |
|---|---|
| Host Service / HTTP | `packages/host/webserver` |
| 最小 client 插件 | `packages/client/ui-message-feedback` |
| Slot / 会话节点 | `packages/client/ui-conversation` + `packages/client/ui-slots` |
| Bundle 分层 | `packages/bundle/base` + `packages/bundle/web-app` |
| 简单持久化 backend | `packages/storage/storage-json` |
| 工具插件 | `packages/fs/tool-fs` |
| 崩溃安全日志 | `packages/session/session-persistence-jsonl` |
| client tsdown 预设 | `packages/client/tsdown.client.ts`(独立包可整体移植,见"构建与类型隔离") |

路径漂移时用 `packages/README.md` 重新定位,不要凭旧文档猜。

## 代码插件主线(制作 → 发布)

1. **写插件骨架** — 读 `references/deepseek-harness/user/develop/basic/index.md`
   - 函数插件:导出 `name`、`inject`、`apply(ctx, config)`;依赖的 service 用 `inject` 声明,未满足时 fiber 保持 pending,框架就绪后激活——不要用轮询模拟依赖注入
   - 可选 service 用 `ctx.get()` 判断,或 `ctx.inject([...], childCtx => ...)` 惰性挂载;不要在 `apply()` 里抢跑兄弟 provider
   - Service 插件:继承 `Service`,构造器声明 service key,异步启动放 `Service.init`;初始化失败让 fiber 失败由启动方报告,不要吞组合错误
   - effect 所有权:route、listener、watcher、timer、DOM、React root、socket 全部归当前 fiber(`ctx.on()` / `ctx.effect(() => disposer)`);disposer 顺序:停外部入口/注销 registry → 等在途工作 → 关资源
2. **加工具** — 读 `references/deepseek-harness/user/develop/basic/tool.md`
   - `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`;`parameters`/`output.schema` 用 `@deepseek-ai/dsh-tools` 的 value-schema DSL,自动推导校验入参
   - `description` 写清:何时调用、必要前置条件、失败语义、副作用
   - 会话/工作区/owner 从 `exec.agent` 取,不从全局进程状态猜;异步工作观察或转发 `exec.signal`;写操作要有幂等、锁或冲突策略
   - 工具注册表机制 → `references/deepseek-harness/subsystems/tools.md`
3. **加配置** — 读 `references/deepseek-harness/user/develop/basic/config.md`
   - 导出 `Config` 类型 + 同名 Schemastery schema(从 `@deepseek-ai/schemastery` 导入,不是 zod),默认值放 schema;可调参数一律做成配置字段,不许硬编码
4. **本地调试** — `cordis.yml` 里 `insert` 插件行(路径必须绝对),`--patch` 起 Web UI 验证
5. **打包发布** — 读 `references/deepseek-harness/user/develop/basic/publish.md`,契约要点:
   - host-only 包:不声明 `dsh.client`、不建 client bundle
   - client 包:必须有 `dsh.client.platform: "web"` 和真实存在的 `exports["./client"]`;`dsh.client.immediately` 仅供启动关键入口,普通插件不要默认开
   - `exports`、`files`、构建产物三者一致,任何入口都不能指向不存在的文件
   - DSH/Cordis/React 等共享运行时声明 peer,避免复制 runtime identity
   - patch 按 `id` 覆盖,目标行 `config` 是**整段替换**不是深合并;生效顺序 profile bundles → profile patch → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`,后者胜
   - 分发三条路:npm 发布 / GitHub 安装(需自包含 `prepare` 构建 + 用户 `allowBuilds`,建议 pin commit)/ tarball;用户侧 `dsh plugin --profile xxx add <你的包>`
    - **安装/分发的实战坑(全部实测过)**:
      - **GitHub 安装语法(monorepo 子目录)**:用 `github:owner/repo#<sha>&path:<subdir>`;`github:owner/repo/subdir#sha` 的 slash 形式会把 subdir 当仓库名的一部分,报 "repository exists" 权限错误。构建授权:pnpm 10 打印 `onlyBuiltDependencies`(列表)、旧版 `allowBuilds`(map),两个键都写进 profile 的 `pnpm-workspace.yaml` 最稳
      - **pnpm 9.x 首装坑**:dsh 初始化的 profile workspace(`packages: ['.']`)会让 `dsh plugin add` 报 `ERR_PNPM_ADDING_TO_ROOT`;修法:`add` 后加 `-w`,或 profile 目录写 `.npmrc`(`ignore-workspace-root-check=true`)。pnpm ≥10 无此问题——README 安装命令必须经"全新 profile + 本机 pnpm 版本"实测才写
      - **tarball URL 缓存陷阱**:`gh release upload --clobber` 替换资产后 CDN 仍发旧货;且 pnpm store 按 URL 缓存 tarball,`remove`+`add` 也复用旧内容。修法:换新 URL(文件名带版本号),或删 `$(pnpm store path)` 下对应的 `https+++...` 目录再 add。发布后必须比对 安装物/发布物 哈希一致
      - **@deepseek-ai 依赖版本漂移**:npm `latest` dist-tag 是 0.0.1-rc.1 旧版,运行时的 0.1.0-rc.6 挂在 `next`;devDeps/peers 显式 pin 运行时同版本,别写 `latest` 或信默认解析

最小骨架(完整解释见文档):

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: v }] },
    async execute(args) { return `Hello, ${args.name}!` },
  }))
}
```

## Host 能力要点

- **HTTP**:注入正式版 web server service;路由用 `ctx.effect(() => ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler }))`,重复 (kind, path) 抛错;敏感/实时快照 `Cache-Control: no-store`;未知插件资源返回 404,不落 SPA fallback
- **持久化**:路径显式配置,不用 `process.cwd()` 散落数据;状态按 workspace/session/owner 隔离;同资源读改写串行化;人读 JSON 用临时文件 + fsync 原子发布;并发创建 no-clobber(`link()`+`unlink()`,勿 `rename()` 静默覆盖);registry 清理顺序 unregister → close

## Client 能力要点

- **入口**:`export const inject = ['slots']`;类型贡献用 type-only import 拉 Context/SlotMap merge
- **Slot 四步契约**:①声明(从官方包拉类型;自定义 owner 才 module augmentation 扩展 `SlotMap`)→ ②认领(父 entry 的 `children` 表声明子 slot,认领即占有渲染权)→ ③注册(`ctx.slots.inject(key, () => ctx.slots.register(...))` 等待声明;keyed 必填 `key`、list 必填 `id`、chain 必填 `select`;向未声明 slot register 会抛错)→ ④渲染(owner 用 `renderSlot`,贡献者不 import owner 实现)
- **常用会话接缝**:`conversation.session.header.actions/.utilities`、`conversation.view`、`conversation.chat.node/.commandview/.assistant-actions/.turnTail`、`conversation.input.*`、`conversation.composer.*`;全局浮层 `shell.overlay`,不碰 `root` 单槽。以 checkout `ui-conversation/src/client/contract/slots.ts` 的 SlotMap 为准,不凭旧文档写 slot 名
- **Conversation Node**:事件折叠 + keyed renderer;重放同一事件序列必须得到同一节点(不读时间/随机数/磁盘);`match` 返回稳定业务 id
- **Portal 兜底**:语义 slot 优先;全应用浮层优先 `shell.overlay`;React root/宿主 DOM/window listener 都有 disposer;键盘、`:focus-visible`、`aria-*`、Escape、reduced motion
- 机制细节:`references/deepseek-harness/subsystems/web.md`、`subsystems/client-modules.md`;完整教程 `references/deepseek-harness/cookbook/adding-a-conversation-node.md`

## 构建与类型隔离

- host/client 用**两个 tsc program**(如 `tsconfig.host.json`/`tsconfig.client.json`),避免 host 会话与浏览器 runtime 的 Context declaration merge 冲突
- client bundle 复用正式版 client tsdown helper 或已验证模板,不手写 loader 协议;产物 host/client 并存、保 sourcemap、CSS Modules 注入
- **client import 纯度**:值 import 只允许平台模块表与官方豁免;跨包只 type-only import;协作必须走 Cordis service/slot——否则纯度门或运行时 require 失败
- **tsdown 0.22 新 API**:`external`/`noExternal` 已废弃(能用但告警),改 `deps.neverBundle`(平台模块数组)+ `deps.alwaysBundle`(函数:表内返回 undefined,其余一律 true 内联);移植官方 `tsdown.client.ts` 预设时替换这两处即零警告,行为不变
- **client 类型链**:devDeps pin 运行时版本后,`import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'` 拉 SlotMap merge,`PropsRuntime<'slot.name'>` 直接当组件 props 类型;list 条目 register options 的合法字段是 `name`/`id`/`order`/`label`(`label` 是官方字段,可放心用)
- **HMR 边界**:只有 bundle 内容变化可 client HMR;manifest、exports、插件集合、profile、host 代码变化要重启;不启动独立 Vite server 替代 DSH GUI

## 验证矩阵

- **基线**:先读 `package.json.scripts` 再跑(`typecheck`/`build`/`test`/`verify`);至少覆盖纯业务规则、文件往返/锁/归档恢复、投影折叠纯函数
- **真实组合**:不只手搓 `ctx.plugin()`;`dsh plugin --profile <scratch> add <pkg>` → `dsh --profile <scratch> --dump-config` 断言 bundle 层、行 id、name、config、注入顺序;坏 patch 时 `--dump-default-config` 恢复诊断
- **真实任务**:在**真实 `DSH_HOME`**(有模型设置)下建独立 base 系 profile 跑 `dsh --profile <p> "一个小而可判定的任务"`(不要发明 `dsh run` 子命令)。注意:`dsh web` 是 `--profile web` 的别名,不接受 `--profile`;web profile 是 server-shaped,`dsh --profile web "task"` 报 too many arguments。全新 DSH_HOME 缺模型/权限配置导致任务失败(如 "tool call aborted")不是插件问题,勿死磕任务验证——以 dump-config + GUI 启动为准
- **从零安装**:全新临时 `DSH_HOME`/profile → 按 README 精确命令安装 → 断言 dependencies、`dsh.profile.bundles`、产物、`--dump-config` 出现插件层 → 启动验证;私有仓库用 `git+file://` 验证"Git 获取的内容"而非当前 checkout
  - scratch GUI 验证时 profile 必须命名为 `web`(见上);断言 boot manifest 出现插件条目(`curl -s <host>/` 里 grep 插件 id)、`/plugins/<id>/client.js` 返回 200 且是标准 `__ModuleLoader__.load` 产物
  - **字节一致性**:boot manifest 的 `rev` = bundle 内容 sha1 前 12 hex(`shasum lib/client.js | cut -c1-12`);比对 served / installed / release 三方字节,防 CDN 与 pnpm store 缓存发旧货
  - client-modules 会动态重算 boot graph(profile 内包文件变化后 rev 自动更新,刷新页面即可);manifest、exports、插件集合变化仍要重启服务
- **存量迁移**:从旧形态(link:/手工 patch 行)迁到标准形态:先 `dsh plugin remove` 旧依赖、删 profile `cordis.patch.yml` 的手工行(残留会 duplicate loader entry id),再 `add` 新包;迁移前备份 profile 目录
- README 只给经过全新 profile 验证的推荐命令

## 本项目上下文

- 本仓库是 dsh plugin **多项目仓库,仓库间彼此独立**(见 `Agents.md`):`vision-bridge`、`dsh-user-turn-rail`、`dsh-mermaid-renderer` 是现有插件;改哪个先读哪个自己的 README
- 官方文档中文快照在本 skill `references/deepseek-harness/`(入口 `references/deepseek-harness/README.md`);更新:运行本 skill 的 `scripts/sync-dsh-docs.sh`
- 快照里指向 `packages/`、`apps/`、`.agents/` 的链接属于上游仓库,本地不可达,回 GitHub 同路径看
- 本会话运行时另有"动态 Cordis 插件"(cordis_define/cordis_run)机制,是**进程内临时扩展**,与仓库内正式插件开发是两条链路;正式交付一律走本文档流程

## 完成标准

- [ ] 运行面最小;manifest、exports、patch、产物一致
- [ ] 必需 inject 与可选 service 边界清楚;route/registry/timer/watcher/DOM/存储全部可清理
- [ ] 可调参数全部做成 Config schema 字段,无硬编码
- [ ] 工具 description 含前置条件/失败语义/副作用;异步观察 `exec.signal`
- [ ] Client 面 slot 契约四步完整;Conversation Node 可确定性重放
- [ ] typecheck、build、真实组合(`--dump-config` + 有 settings 的 base 系 profile 跑任务)、从零安装验证通过
- [ ] README 安装命令与实际分发形态一致
- [ ] 未执行未经授权的 commit/push/publish
