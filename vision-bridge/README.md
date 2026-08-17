# vision-bridge — 纯文本模型的视觉桥（Route C 自研实现）

给 text-only 模型的 dsh Agent 装视觉工程能力：粘贴/读图/截图无缝桥接，
看图走结构化原生工具（vision_*），语义问题交给远程视觉模型，
像素级事实（坐标/颜色/差异/几何）交给本地确定性工具。
视觉模型会话整套能力自动隐身。

## 能力一览

- **seamless 桥**：粘贴截图自动落地工作区并注入路径与意图；read 读图被拦截时只给两行指路；
  bash 出图自动提示。三种触发都会按会话自动激活全部工具。
- **13 个工具**（引导 `vision_activate` + 12 个执行工具）：
  - 远程（需配置视觉端点）：`vision_glance`（描述/问答/OCR/多图）· `vision_ground`（定位）
    · `vision_detect`（盘点，逐字文字）· `vision_long_screenshot_ocr`（长截图分块 OCR）。
  - 本地（无需任何 key）：`vision_crop` · `vision_pixel_diff` · `vision_dominant_colors`
    · `vision_media` · `vision_frames` · `vision_trace`（SVG 几何）
    · `vision_extract_foreground`（透明 PNG）· `vision_html_screenshot`（HTML 截图）。
- **架构**：Host 插件（TypeScript，装配校验/激活状态机/执行总闸门/managed venv）
  + Python runtime（独立 venv，stdout 单段 JSON + 稳定退出码 + 脱敏 stderr）。
  详见 `docs/architecture.md`。

## 本地装配（仅本地交付，不发布）

```bash
cd vision-bridge
pnpm install
npm run verify    # 门禁 + typecheck + build + Python 语法检查 + 全量测试 + 打包 dry-run

# 装进本地 profile（dsh plugin add = pnpm add + bundles 清单 reconcile）
dsh plugin --profile <profile> add -w <本目录绝对路径>
dsh --profile <profile> --dump-config   # 末尾应出现 dsh-vision-bridge 层
```

远程工具需要一行装配配置（D8，配置写在 bundle 装配行）。在 profile 的
`cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-vision-bridge
  config:
    endpoint: https://<视觉端点>/v1          # OpenAI-compatible
    model: <视觉模型 id>
    credential: <DSH Credential 引用名>      # 只存引用；每次现取现用、只进子进程环境
    language: 中文
```

凭据值存 DSH Credential（settings 里配置 `credential` 指向的引用名），
插件每次远程操作现取现用、绝不落盘。

## 配置热更新与卸载

- 热更新：settings 里 `dsh-vision-bridge` 段（schema 同装配 config）→ 校验 →
  staging 准备候选运行时 → 原子切换 generation；失败保留旧运行时并记录原因。
- 卸载：`dsh plugin --profile <profile> remove dsh-vision-bridge`；
  插件卸载时先取消活动视觉操作，再逐 Agent 回收工具与 skill。

## 测试与验证

```bash
npm run verify                     # 全部门禁 + 单测 + 集成（真实 venv/ffmpeg/Chrome + 假上游）
npm run e2e                        # 真实 dsh host headless e2e（vision-bridge-e2e profile）
node scripts/clean-home-e2e.mjs    # 干净 DSH_HOME 全生命周期（安装→激活→禁用→重启用→卸载）
node scripts/render-verify.mjs     # 闭合示例：HTML 渲染 → 像素比对（无 key）
```

## 上游补丁（粘贴通道）

dsh 宿主 api-proxy 会对不支持图片的模型拒绝带图消息。本插件需要一处出厂补丁
放行（详见 `PATCH.md`）：dsh 升级后会被覆盖，需按 PATCH.md 重打。
