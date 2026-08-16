# 01 — 修复旧版两个 bug + 新架构基座（media/frames 首条垂直切片）

**What to build:** 旧版视觉桥先恢复可用，新架构的骨架与运行时管道并行落地，并用 `vision_media` / `vision_frames` 作为第一条端到端能力验证整条新管线。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

## 会话上下文（开工前必读）

- 仓库根目录是 `dp_harness_enhance`，本票只动 `vision-bridge/`。工作语言中文。
- 共享架构上下文：`.scratch/vision-bridge-route-c/CONTEXT.md`（第 2、3、4 节是本票依据；决策 D5–D12 全部适用）。
- **旧版现状**：单文件 Cordis 插件 + `dsh-vision` CLI + 同步脚本三者已存在，但两个 bug 已提交在 HEAD，导致重启后安装的 CLI 是坏 Python。本票只修这两个 bug 让旧版恢复可用，**不做旧版其他改造**（新架构最终会在 05 票替换它）。
- **两个 bug 的根因（修法要点）**：① 同步脚本生成内嵌副本时用了会解释替换符的字符串替换，CLI 源码里的 `$'` 被展开成原文，破坏生成物——改为把替换串当普通文本处理，并加 `--check` 干跑比对；② 插件定位项目内 CLI 的相对层级多了一级，永远读不到真源——改为正确层级，让启动安装走真源。
- **新架构从零开始**：`vision-bridge/` 下现在没有 TypeScript 工程、没有 runtime 目录。本票要搭出可装配的 dsh bundle 骨架，并把「managed venv 准备 → 工具注册 → subprocess 调用 → JSON 契约」这条最小管道一次打通。
- **本票冻结的接口形状**（后续票都依赖它）：
  - 引导工具 `vision_activate`：无参数；输出 `{activated, tools:[...]}`；当前 Agent 已激活则返回 `activated:false`；激活成功后引导工具对当前 Agent 隐藏。
  - `vision_media` 参数 `path`；输出至少含 `path`、`durationSeconds`、`sizeBytes`、`bitRate`、`formatName`、`streams:[{type,codec,width,height,fps,sampleRate,channels,pixFmt,duration}]`（与旧版 media 输出等价）。
  - `vision_frames` 参数 `path`、`times`（逗号分隔时间点，最多 8 个）；输出 `{dir, frames:[{time,path}]}`。
  - 错误契约：稳定错误类别 = `config / input / capacity / upstream / runtime / output / cancelled / timeout`，Host 侧统一成带类别的错误，Python 侧用稳定退出码 + 脱敏 stderr。
- **可用的真源参考**：旧 CLI 的 media/frames 逻辑可以直接作为 Python 行为参照；参考项目 `agent-vision-toolkit/dsh-vision-toolkit` 只读借鉴结构，不引入代码依赖。
- **不做的事**：视觉 API 调用与凭据（02 票）；粘贴/read/截图无缝桥（03 票）；trace/OCR/HTML 截图等剩余工具（04 票）；配置热更新与卸载清理的完整版（05 票）；任何 UI、任何发布动作。

## 验收标准

- [x] 修复同步脚本的替换符漏洞：重新生成后，插件内嵌 CLI 与真源逐字节一致，且 `py_compile` 通过；同步脚本支持 `--check` 模式，发现漂移时非零退出
- [x] 修复插件定位项目 CLI 的路径层级：重启后安装到用户 bin 目录的 `dsh-vision` 是可执行的干净脚本（`py_compile` 通过，`describe` 子命令可解析）
- [x] 新包结构就位，可被本地 profile 装配（`dsh plugin add` 本地路径成功，插件出现在装配清单）
- [x] managed 运行时首次启动按锁定依赖在隔离环境准备；准备失败时输出可修复的明确错误，并且不发布任何模型可见能力
- [x] 模型通过 skill/引导工具激活后，当前 Agent 获得 `vision_media` 与 `vision_frames` 工具；未激活的 Agent 上下文里不含这两个 schema
- [x] `vision_media` 对媒体文件返回结构化 JSON（时长/分辨率/流/编码）；`vision_frames` 按时间点抽帧并返回帧文件路径列表；两者都不需要视觉 API 凭据
- [x] 输入路径只在会话工作区或显式允许目录内解析，符号链接逃逸被拒绝
- [x] 所有上游调用走 argv 向量（无 shell 拼接），超时与取消生效，stdout/stderr 有界
- [x] 配置 schema 在装配时校验，非法配置在发布任何能力前失败并给出原因
- [x] 单测 + 集成测试（真实 venv + 真实子进程）全绿；测试门禁零测试即失败
- [x] 共享上下文与架构说明随本票落库，后续票可在新会话里独立开工

## 完成记录（由执行者填写）

- 验证命令与结果摘要：
  - `node vision-bridge/sync-cli.js --check` → `OK — 内嵌 CLI 与 cli/dsh-vision 一致`（exit 0）；改动 CLI 或内嵌块后 → `DRIFT`（exit 1），恢复后回归 OK。
  - 内嵌 CLI_SRC 与 `cli/dsh-vision` 逐字节一致（test/sync.test.js 断言）；抽取安装进 `/tmp/vb-bin/dsh-vision`（chmod +x）后 `python3 -m py_compile` 通过，`describe`/`media` 子命令 argparse 正常解析。
  - 路径层级修复：`plugin/lib/index.js` 改为 `new URL('../../cli/dsh-vision', ...)`，解析结果 = `vision-bridge/cli/dsh-vision` 真源；`node --check plugin/lib/index.js` 通过，CLI 块标记各 1 处。
  - `cd vision-bridge && npm run verify` → 门禁 OK、tsc 0 error、`node --test` 33 用例全绿（含 managed venv 真实准备 + 真实 ffprobe/ffmpeg 抽帧 + 符号链接逃逸拒绝 + spawn 超时/取消/输出有界 + exposure 状态机）。
  - 本地装配：`dsh plugin --profile vision-bridge-dev add -w <repo>/vision-bridge` → profile `package.json` 出现 `"dsh-vision-bridge": "link:..."` 且 `dsh.profile.bundles` 自动追加 `dsh-vision-bridge`；`dsh --profile vision-bridge-dev --dump-config` 末尾出现 `# == dsh-vision-bridge` 层（装配清单可见）。
  - managed venv 准备失败路径：`python=/definitely/missing/python-vb` → `ensureReady()` 返回 null、`lastError` 含「修复：…」文案，不发布任何工具（集成测试覆盖）。
- 遗留问题（若有）：
  - `vision_frames` 的帧产物直接落在工作区 `artifacts/vision-bridge`（结构化为 dir+paths，未挂 artifact 对象）——02 票产物管线落地后若需要可按同一 staging→原子提交机制回填 artifact 描述，不改契约形状。
  - 视觉模型会话的「整套隐身」目前由 `agent/created` 时的能力判定保证；模型热切换后的重判与 seamless 桥按 03 票交付。
  - 引导工具经 skill 工具加载触发激活（状态机规则③）在 03 票接入。
