# vision-bridge Route C — 架构说明

> 本文件是 Route C 的实现级架构文档；业务目标、冻结决策（D1–D12）与票据依赖
> 见 `.scratch/vision-bridge-route-c/CONTEXT.md`。后续票只在本文件之上增量。

## 三层

```
模型/Agent          纯文本会话：vision_activate（引导）+ 激活后的 vision_* 工具
                   视觉模型会话：整套隐身（agent/created 时按模型能力判定）
Host 插件(TS)       exposure（按 Agent 激活）→ runtime（总闸门）→ runtime-manager（venv）
                    paths（围栏/产物）· capabilities（能力缓存）· logger（健康日志）
Python runtime      python -m dsh_vision <sub> --spec '<json>'（独立 venv，锁定依赖）
```

## 模块与职责

| 模块 | 文件 | 职责 |
|---|---|---|
| 入口与生命周期 | `src/index.ts` | 装配时同步校验配置（非法即抛，装配失败）；异步准备运行时；`agent/created`/`agent/disposed` 接线；卸载回收 |
| 渐进暴露 | `src/exposure.ts` | 每 Agent 状态机：未激活只有引导工具；激活注册全部执行工具并回收引导工具；runtime 未就绪零发布 |
| 执行总闸门 | `src/runtime.ts` | 并发信号量（可取消排队）→ argv 向量 subprocess → 超时/取消 SIGKILL → stdout 有界 → envelope JSON → Host 侧契约校验 → 稳定错误类别 |
| 运行时管理 | `src/runtime-manager.ts` | managed：`python3 -m venv` → pip 按 `runtime/requirements.lock` 安装 → probe 探针；失败返回可修复错误文案；05 票加候选→原子切换 |
| 路径与产物 | `src/paths.ts` | 输入 realpath 围栏（会话工作区 + allowedDirs，符号链接逃逸拒绝）；产物：staging 目录写入 → 格式探针 → 同文件系统原子 rename 提交 |
| 能力判定 | `src/capabilities.ts` | `llm.resolveModelInfo` 判原生图片能力；成功正缓存，失败 TTL 30s |
| 远程视觉 | `src/remote.ts` | D7 凭据管线：只存 DSH Credential 引用，每次现取现用、只进子进程环境；glance 会话级缓存（key = 图片内容哈希 + query/ocr/region + 端点/模型/语言/凭据哈希） |
| Seamless 桥 | `src/seamless.ts` | 三条钩子（粘贴落地 / read 拦截 / bash 出图）+ skill 加载检测，全部按会话隔离（挂在 exposure 状态机上）；视觉模型会话整套不触发 |
| intent | `src/intent.ts` | 粘贴取同消息非图片文本；bash 自动描述取助手最后一段（回退最新真实用户请求）；过滤注入内容；一律截尾 500 字符 |
| skill 单源 | `skills/vision-bridge/SKILL.md` | 完整明眼人协议唯一来源；按 Agent 注册（文本模型会话才可见）；加载即激活（返回内容标记判定） |
| 提示词单源 | `runtime/dsh_vision/prompts.py` | 明眼人协议 + focus hint 模板唯一来源；hint 截尾 500 字符并声明「只用于判断重点，与图无关请忽略」 |
| 远程客户端 | `runtime/dsh_vision/vision_client.py` | OpenAI-compatible；429/5xx/网络错误退避重试（最多 2 次）；整操作硬超时；空/非结构化回答 = output 错误；`finish_reason==length` → `truncated:true` |
| Python 契约 | `runtime/dsh_vision/contract.py` | stdout 单段 JSON envelope；退出码 0/2/3/4/5/6 = ok/input/config/upstream/runtime/output；stderr 脱敏（凭据值替换） |

## 契约（Host ↔ Python）

- 调用：`<venv python> -m dsh_vision <sub> --spec '<json>'`，argv 向量 + 环境变量，无 shell。
- 返回：`{"ok":true,"result":...}` 或 `{"ok":false,"error":{"category","message"}}` + 稳定退出码。
- 凭据（02 票起）：Host 经 DSH Credential 现取现用，只注入子进程环境；任何回传文本先脱敏。
- 取消/超时：Host 信号 SIGKILL 子进程 → `cancelled` / `timeout` 类别。

## 配置（bundle 装配行，schema 见 `src/config.ts`）

| 字段 | 默认 | 说明 |
|---|---|---|
| allowedDirs | `[]` | 工作区外额外允许的输入目录（绝对路径，realpath 校验） |
| artifactsDir | `artifacts/vision-bridge` | 工作区内固定产物子目录（D9） |
| inputsDir | `inputs/vision-bridge` | 工作区内粘贴截图落地目录（03 票用） |
| venvDir | 空 | managed venv 目录；空取 `$DSH_HOME/storages/dsh-vision-bridge/venv` |
| managed | `true` | 按锁定依赖建隔离 venv；false 直接用系统 python3 |
| python | `python3` | 建 venv 的基础解释器 |
| maxConcurrency | `2` | 视觉操作并发信号量上限 |
| defaultTimeoutMs | `120000` | 默认整操作超时 |
| endpoint / model | 空 | 视觉 API 端点与模型（空 = 远程工具报 config 错误） |
| credential | 空 | DSH Credential 引用名（POSIX 标识符；只存引用） |
| language | `中文` | 进视觉 prompt 与 glance 缓存键 |
| visionTimeoutMs / maxRetries | `90000` / `2` | 远程硬超时与 429/5xx/网络退避重试上限 |
| glanceCacheTtlMs | `1800000` | glance 会话级成功缓存 TTL（0 关闭） |
| autoDescribeBashShots | `false` | seamless：bash 出图自动补 VLM 描述（开启时最多前 2 张、带当前意图、失败不阻断） |

## 错误类别（稳定）

`config / input / capacity / upstream / runtime / output / cancelled / timeout`。
Host 侧统一成 `VisionError(category, message)`，工具失败时模型看到 `[category] message`。

## 测试防线

- `scripts/test-gate.mjs`：门禁——`test/*.test.js` 零文件或零 `test()` 即失败。
- 单测：sync 回归 / config / paths 围栏 / exposure 状态机 / spawn 超时取消有界。
- 集成（真实 venv + 子进程）：managed 首次准备（含失败路径）、media/frames 端到端、符号链接逃逸。
- 入口：`npm run verify`（门禁 → typecheck → build → 全量 node --test）。

## 已冻结、后续票依赖的形状

- 引导工具 `vision_activate`：无参；输出 `{activated, tools:[...]}`；已激活返回 `activated:false`；激活后对本 Agent 隐藏。
- `vision_media(path)` → 时长/分辨率/流/编码 JSON；`vision_frames(path, times≤8)` → `{dir, frames:[{time,path}]}`（帧文件已在工作区产物目录）。
- 02 票六个工具（glance/ground/detect/crop/pixel_diff/dominant_colors）与产物/缓存/凭据契约见 `issues/02`；ground/detect 指定 region 搜索时输出坐标仍映射回原图。
- 03 票冻结状态机：激活条件 = 粘贴落地 / read 读图被拦截 / bash 出图被检测 / 成功调用 vision_activate / skill 工具加载 vision-bridge skill；会话恢复凭持久事件里的 vision_* 调用证据重新 attach。
- 04 的剩余工具契约见 `issues/04`。
