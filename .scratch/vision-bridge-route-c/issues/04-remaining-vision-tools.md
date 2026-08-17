# 04 — 剩余视觉工具：trace / extract_foreground / long_screenshot_ocr / html_screenshot

**What to build:** 补齐四个专用工具，覆盖图形素材重建、长截图 OCR 与「参考图 → HTML 实现 → 截图 → 像素比对」的闭合验证；每个工具仍是结构化 schema、JSON 契约与产物交付。

**Blocked by:** 02 — 核心工具主干道：远程三件套 + 本地三件套 + 产物管线

**Status:** ready-for-agent

## 会话上下文（开工前必读）

- 共享架构上下文：`.scratch/vision-bridge-route-c/CONTEXT.md`；本票实现工具清单里剩余的 4 个工具。
- **02 票已交付**：六个核心工具、远程凭据/重试/缓存、产物 staging→原子提交、路径围栏与错误类别、假上游测试。本票四个工具复用这些管线；其中 long_screenshot_ocr 的 OCR 步骤复用 `vision_glance` 的远程能力，其余三个是纯本地工具。
- **03 票可能并行进行**：本票不依赖 seamless 桥，03 票改动激活/桥接层，二者不要互相覆盖对方的领域；若合并冲突，以“本票只加工具、03 票只加桥接”为界。
- **本票冻结的工具契约**：

```jsonc
// vision_trace
in : { image:string, region?:string, color?:boolean, outline?:boolean, output?:string }
out: { svg:string(路径), paths:int, width:int, height:int, scale:number, artifact:{...} }
// 小图标先放大分析，输出几何仍按原图坐标；提交前校验 SVG 为合法 XML、单一 svg 根、拒绝危险结构

// vision_extract_foreground
in : { image:string, region?:string, mode?:"manual"|"auto", excludeColor?:string, output?:string }
out: { box, components:int, coveragePct:number, width, height, artifact:{...} }
// 产物是透明 PNG；auto 失败时允许手工区域/排除色重试

// vision_long_screenshot_ocr
in : { image:string, mode?:"general"|"chat", runName?:string, resume?:boolean, jobs?:int, splitOnly?:boolean }
out: { chunks:int, complete:boolean, mergedMarkdown:artifact, manifest:artifact,
       audit:artifact, chunkImages:[artifact], reused:{...} }
// 找低内容切口分块；重叠只合并确实重复的内容；边界复查写入 audit；splitOnly 不发远程请求；
// 同 runName + resume=true 复用已有分块与侧车文件

// vision_html_screenshot
in : { source:string, width?:int, height?:int, scale?:int, waitMs?:int, output?:string }
out: { source:{path,bytes}, viewport:{width,height}, rendered:{width,height}, artifact:{...} }
// 只接受工作区内的本地 .html/.htm；拒绝 URL 与 data URI
```

- **本地算法来源**：四个工具自研实现；`agent-vision-toolkit` 的对应脚本与 skill 文档只读参考思路（切口选择、边界审计、SVG 校验），不拷贝代码。
- **浏览器规则（冻结）**：html_screenshot 使用 Chrome/Chromium/Edge 的无头模式；必须禁用网络、使用一次性临时 profile（一次性 mock keychain 等价物，避免触碰用户浏览器 profile/钥匙串），调用结束后删除临时 profile；找不到浏览器时只此工具不可用，其他工具不受影响。
- **闭合示例（冻结范围）**：在仓库里提交「参考图 + 故意不准的初版 HTML + 修正后的终版 HTML」三步产物，并用 `vision_html_screenshot` + `vision_pixel_diff` 生成可复现的差异数值证据（初版差异 > 终版差异）；示例要能在无真实视觉 key 下运行。
- **不做的事**：GUI 自动点击执行；摄像头/视频理解；seamless 桥与 intent（03 票）；配置热更新与卸载清理（05 票）；任何 UI 与发布。

## 验收标准

- [x] `vision_trace` 把扁平高对比图形恢复成 SVG 几何（路径数/缩放/尺寸结构化返回）；小图标先放大分析但输出保持原图坐标；提交前校验 SVG 合法且无危险结构
- [x] `vision_extract_foreground` 输出透明 PNG，并返回选区、连通分量数与前景覆盖率；自动模式失败时可手工指定区域/排除色
- [x] `vision_long_screenshot_ocr` 找到低内容切口分块、逐块 OCR、合并重复重叠，交付合并 Markdown、清单、边界审计与分块产物；`splitOnly` 模式不发起任何远程请求；同名运行可复用既有分块
- [x] `vision_html_screenshot` 只接受工作区内的本地 HTML 文件，按指定视口输出 PNG；浏览器以禁用网络 + 一次性临时 profile 运行，调用后清理临时 profile
- [x] 提交可复现示例：本地 HTML 渲染 → `vision_pixel_diff` 度量 → 按最差区域迭代，示例含参考图、初版、终版与数值验收结果
- [x] 每个工具均有确定性单测；HTML 渲染与长截图 OCR 有集成测试；错误路径（坏图/越界框/非法 HTML 引用）返回稳定错误类别

## 完成记录（由执行者填写）

- 验证命令与结果摘要：
  - `cd vision-bridge && npm run verify` → 门禁 OK、tsc 0 error、`node --test` 60 用例全绿。
  - `test/vision.tools04.integration.test.js`：trace（20x20 图标 scale=4 放大分析、输出 viewBox 保持 0 0 20 20、SVG 单一根且无 script/javascript:/foreignObject/DOCTYPE）；extract_foreground（透明 PNG alpha 通道、components/coveragePct、manual 重试、全出血图 auto 失败并提示 manual）；long_screenshot_ocr（splitOnly 零远程请求、resume 复用分块与 OCR 侧车、完整 OCR 合并 Markdown + 审计 + 分块产物、复用后不再发远程）；html_screenshot（本地 HTML → 320x240 PNG、拒绝非 HTML 与 URL）。
  - 闭合示例 `node scripts/render-verify.mjs` → `v1=22.96% v2=0.44%（初版 > 终版 ✓）`，数值证据写入 `examples/render-verify/RESULTS.md`；`test/example.render.test.js` 断言数值并校验 RESULTS.md（无真实视觉 key 可跑）。
  - Python 侧子命令直接冒烟：trace / extract_foreground / long_screenshot_ocr(splitOnly) / html_screenshot（真实 Chrome headless，禁网 + 一次性临时 profile，产物文件为准并在结束后终止/清理浏览器进程）。
- 遗留问题（若有）：
  - `vision_long_screenshot_ocr` 的 `jobs` 并发参数当前串行执行（接受并透传）；量大时可后续用线程池并行 OCR，不影响契约形状。
  - trace 只恢复外轮廓（不挖孔），对「扁平图形重建」场景够用；带孔图形如需精确填充可在后续迭代。
