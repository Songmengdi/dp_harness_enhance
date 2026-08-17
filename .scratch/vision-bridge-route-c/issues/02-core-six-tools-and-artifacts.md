# 02 — 核心工具主干道：远程三件套 + 本地三件套 + 产物管线

**What to build:** 激活后的 Agent 获得六个核心视觉工具：远程的问答/定位/盘点，以及本地的裁剪/像素差异/主色测量；文件型产物以结构化描述交付到工作区，凭据全程不落盘。完成后可在 headless 会话跑通「定位 → 裁剪 → 像素比对」闭环。

**Blocked by:** 01 — 修复旧版两个 bug + 新架构基座（media/frames 首条垂直切片）

**Status:** ready-for-agent

## 会话上下文（开工前必读）

- 共享架构上下文：`.scratch/vision-bridge-route-c/CONTEXT.md`；本票实现其中工具清单里的 6 个工具（glance/ground/detect/crop/pixel_diff/dominant_colors）。
- **01 票已交付**：可装配的 dsh bundle 骨架、managed venv、配置 schema、路径围栏、subprocess 总闸门、JSON 契约与错误类别、按 Agent 激活机制、media/frames 两个工具和测试门禁。本票只在其上增量添加工具与 Python 子命令，不改动激活与总闸门架构。
- **凭据规则（冻结）**：配置只存 DSH Credential 引用；远程操作每次现取现用，值只以环境变量进入 Python 子进程；日志/错误/结果不含 key，上游错误正文先脱敏再回传。
- **本票冻结的工具契约**（schema 与 stdout JSON 按此实现，后续票依赖这些形状）：

```jsonc
// vision_glance
in : { images:[string], query?:string, ocr?:boolean, region?:string, timeoutMs?:int }
out: { images:[{path,bytes,width,height,format}], mode:"describe"|"qa"|"ocr", answer:string, truncated:boolean }
// query 与 ocr 互斥；region 只允许单图；多图必须一次传入（同一次视觉请求）

// vision_ground
in : { image:string, target:string, region?:string, timeoutMs?:int }
out: { target, image:{path,bytes,width,height,format}, imageWidth, imageHeight,
       matches:[{label:string, box:{x1,y1,x2,y2}}] }
// vision_detect
in : { image:string, category?:string, region?:string, timeoutMs?:int }
out: 与 ground 同构的编号清单；label 必须含逐字可见文字
// 两者：region 裁剪后送给 VLM，但输出坐标必须映射回原图；越界/退化框拒绝

// vision_crop
in : { image:string, region:string, scale?:int, output?:string }
out: { box, width, height, format, artifact:{path,filename,mimeType,kind,description,sourceTool,bytes} }

// vision_pixel_diff
in : { original:string, rebuilt:string, runName?:string }
out: { ratioPct:number, worstRegions:[{box,ratioPct}],
       heatmap:artifact, report:artifact }

// vision_dominant_colors
in : { image:string, region?:string, top?:int, candidates?:string[] }
out: { colors:[{color,sharePct}], candidates?:[{color,sharePct,winner}], winner?:string }
```

- **提示词单源（冻结）**：明眼人协议 + focus hint 模板只存在于 Python 运行时一处；`--question` 与 `--focus` 都要进入视觉 prompt；hint 截尾 500 字符并声明“只用于判断重点，无关则忽略”。
- **客户端行为（冻结）**：支持 OpenAI-compatible 协议（本票不要求 Anthropic 协议）；429/5xx/网络错误退避重试（最多 2 次重试）；整操作硬超时；空回答/非结构化回答是 output 错误；`finish_reason == length` 时 `truncated:true`。
- **缓存（冻结）**：只有 `vision_glance` 做会话级缓存；key = 各图片内容哈希 + query/ocr/region + 端点/模型/语言/凭据哈希；失败与其他会话绝不共享；重复输入直接命中。
- **产物（冻结）**：写工作区固定产物子目录；先生成随机 staging 文件 → 格式探针校验 → 原子改名提交；返回结构化 artifact 描述；crop 不得覆盖输入图。
- **本地算法来源**：自研实现 crop / 像素差异 / 主色聚类；`agent-vision-toolkit` 只读参考，不拷贝代码。
- **不做的事**：seamless 桥与 intent 自动提取（03 票）；trace/extract/long_ocr/html_screenshot（04 票）；配置热更新原子切换、卸载清理、指标日志的完整版（05 票）；任何 UI 与发布。

## 验收标准

- [x] `vision_glance` 支持图片问答、无问题全景描述、OCR 与多图一次比较；结果含图片信息、模式与回答，截断状态显式返回
- [x] `vision_ground` 按目标名返回原图像素框；`vision_detect` 返回带编号的元素清单与逐字可见文字；指定区域搜索时输出仍映射回原图坐标，越界或退化框被拒绝
- [x] `vision_crop` 把像素框裁成文件；`vision_pixel_diff` 返回差异比例、最差区域框并产出热力图与报告；`vision_dominant_colors` 返回区域主色分布，并支持候选色打分
- [x] 文件型产物先写临时 staging、校验通过后原子提交到工作区产物目录；模型可见结果是结构化描述（路径/大小/类型/来源工具），可直接喂给后续工具
- [x] 远程操作凭据使用 DSH Credential 引用，每次调用现取现用、只注入子进程环境；日志、错误与工具结果均不含密钥，上游错误正文脱敏
- [x] 视觉协议与 focus hint 提示词只有单一来源；hint 被明确标注为「只用于判断重点，无关则忽略」
- [x] Python 客户端对 429/5xx 与网络错误退避重试、完整操作超时；同会话内输入完全相同的重复 `vision_glance` 复用上一次成功结果，输入变化或失败不命中缓存
- [x] 所有远程/本地工具的 stdout 都通过 JSON 契约校验后才回给模型；契约违反映射为稳定错误类别
- [x] 集成测试使用假上游覆盖成功/重试/超时/协议变体；无真实 key 也能完整验证工具路径
- [x] headless 真实调用验收：`vision_ground → vision_crop → vision_pixel_diff` 整条链可运行（有 key 走真上游，无 key 走假上游）

## 完成记录（由执行者填写）

- 验证命令与结果摘要：
  - `cd vision-bridge && npm run verify` → 门禁 OK、tsc 0 error、`node --test` 45 用例全绿（01 的 33 个 + 02 的 12 个）。
  - 假上游（node:http 本地 OpenAI-compatible 端点）集成测试 `test/vision.tools.integration.test.js` 覆盖：glance 描述/问答/OCR/多图/互斥校验/`finish_reason=length` 截断标记；凭据 `Bearer` 进上游、错误正文（500 回显 key）不含密钥；429 两次退避后成功（3 个请求）；网络挂死 → Python 硬超时（3 次尝试耗尽）；Host 300ms 兜底 SIGKILL → `timeout` 类别；ground 归一化框 → 原图像素、region 裁剪后映射回原图、退化框拒绝；detect 带编号 + 逐字文字；crop 产物 staging→原子提交（不覆盖输入）；pixel_diff 比例/最差区域/热力图+报告；dominant_colors 主色占比≈100 + 候选色 winner；glance 会话级缓存（相同输入 1 个请求、变化 2 个、失败不缓存 2×3）；headless 全链路 ground→crop→pixel_diff（同图比较 ratioPct=0）。
  - 真实系统 python3 跑通本地三件套子命令（crop/pixel_diff/dominant_colors），结果 JSON 符合契约。
  - 提示词单源断言（`test/prompts.test.js`）：明眼人协议正文只在 `runtime/dsh_vision/prompts.py` 出现一次；focus hint 截尾 500 字符且前缀「重点（只用于判断重点，与图无关请忽略）」。
- 遗留问题（若有）：
  - 远程链路未接真实视觉 key（按票设计用假上游验证工具路径）；用户装配后只需在 bundle 配置行填 `endpoint`/`model`/`credential`（DSH Credential 引用）即可用真上游。
  - Anthropic 协议本票不要求，Python 客户端只实现 OpenAI-compatible。
  - hint 通道已在 Python 侧冻结（`prompts.focus_hint` + spec.hint），Host 侧由 03 票的 intent 提取接入。
