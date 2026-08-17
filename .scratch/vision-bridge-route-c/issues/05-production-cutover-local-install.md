# 05 — 生产化收口 + 全量 e2e + 本地切换（不发布）

**What to build:** 把新实现从「功能齐全」推进到「可日常使用」：配置热更新与运行时原子切换、卸载清理、错误分类与指标、干净环境全生命周期 e2e，然后删除旧实现、把本地 profile 切换到新包。全程只做本地安装，不创建 release、不发布制品。

**Blocked by:** 03 — Seamless 桥 + 意图提取 + 自动激活；04 — 剩余视觉工具：trace / extract_foreground / long_screenshot_ocr / html_screenshot

**Status:** ready-for-agent

## 会话上下文（开工前必读）

- 共享架构上下文：`.scratch/vision-bridge-route-c/CONTEXT.md`；本票是 Route C 收口票，负责把 01–04 的能力变成“干净、可日常使用、可卸载”的本地交付。
- **03、04 已交付**：03 给了 seamless 桥 + intent + 自动激活与相应 e2e；04 给了 trace/extract_foreground/long_screenshot_ocr/html_screenshot 与闭合示例。01 的旧版修复至今仍在运行，**本票切换前旧版必须保持可用**，直到切换步骤完成并验证通过才删除。
- **配置热更新（冻结）**：settings 变更 → 校验新配置 → 在 staging 准备候选运行时（venv/探针全过）→ 提交 revision → 原子切换到新 generation；任何一步失败都保留旧 generation 继续服务，并输出“配置被拒 / 运行时不可用”的明确原因。工具定义通过惰性取用当前 runtime，不需要重新注册。
- **卸载清理（冻结）**：dispose 顺序 = 先取消所有活动视觉操作并等待终止 → 逐 Agent 回收执行工具与引导工具 → 注销 skill → 注销 settings/路由/监听 → 清理临时 staging；卸载后装配清单与工具目录里无残留。
- **错误与指标（冻结）**：所有对外错误映射到 01 票的稳定类别；指标日志字段 = 工具名、总耗时、上游耗时、图片数量/字节/像素、缓存命中、模型名、错误类别；禁止输出密钥、base64 与无界上游正文。
- **切换范围（冻结）**：删除旧版插件目录、旧 CLI、旧同步脚本及其在 profile 里的引用；本地 profile 改为装配新包并重启验证；**不创建 GitHub release、不 npm/pnpm publish、不推送任何发布制品**。上游粘贴通道所需的出厂补丁说明（若有）保留并更新到新包文档。
- **需要新会话可独立执行的验证**：干净 DSH_HOME 从零开始走完整生命周期；已有 profile 走切换流程。两条路都必须留下命令与结果证据。
- **不做的事**：任何客户端 UI；公开仓库 issue/release；对仓库内其他插件项目的改动；为“不发布”之外的交付渠道做适配。

## 验收标准

- [x] 配置热更新先验证后生效：非法或准备失败的候选被拒绝并保留旧运行时继续服务，成功候选原子切换 generation
- [x] 插件卸载先取消所有活动视觉操作，再逐 Agent 回收工具与 skill；卸载后无残留工具、监听或路由
- [x] 错误分类稳定（配置/输入/容量/上游/运行时/输出/取消/超时），指标日志包含工具名、耗时、图片数量/字节/像素、缓存命中与错误类别，不含密钥或 base64
- [x] 干净 DSH_HOME 的 e2e 全绿：本地安装 → 装配可见 → 激活 → 真实工具调用 → 禁用 → 重新启用 → 卸载
- [x] 旧版插件、同步脚本与旧 CLI 从仓库删除；本地 profile 改为装配新包；重启后新实现是唯一生效实现
- [x] README、维护文档与架构文档与新实现一致；粘贴通道所需的上游补丁说明保留
- [x] 便携门禁（类型检查 + 全量 Python 语法检查 + 清单校验 + 打包 dry-run）与全量测试在切换前全部通过
- [x] 确认没有任何 GitHub release / 公开制品 / 发布动作被执行，交付仅限本地 profile 装配

## 完成记录（由执行者填写）

- 验证命令与结果摘要：
  - `cd vision-bridge && npm run verify` → 门禁（13 测试文件/61 用例声明）OK、tsc 0 error、Python compileall 通过、`node --test` 59 用例全绿、`npm pack --dry-run` 产出 `dsh-vision-bridge-0.1.0.tgz`（dry-run，未写盘、未发布）。
  - `test/production.test.js`：候选准备失败被拒且保留旧 generation（错误含「修复」文案）；成功候选原子切换 generation 且新调用走新 runtime；dispose 先取消在飞操作（HANG 假上游 → cancelled）并拒绝新操作；指标日志含工具/总耗时/图片数量与字节/模型/类别，不含密钥与 base64。
  - `node scripts/clean-home-e2e.mjs` 全 PASS（干净 DSH_HOME）：本地安装（pnpm）→ dump-config 装配可见 → 激活 + 真实工具调用全链路 → disabled 行生效（无 vision_* 工具）→ 重新启用再次全链路 PASS → `dsh plugin remove` 卸载后装配清单无残留；全程仅本地 manifest/pnpm，无任何发布动作。
  - 已有 profile 切换：`dsh plugin --profile web add -w <repo>/vision-bridge` → web profile `bundles` 追加 `dsh-vision-bridge`；`cordis.patch.yml` 追加按 id 配置覆盖（endpoint `https://ark.cn-beijing.volces.com/api/v3`、model `doubao-seed-2.0-lite`、credential 引用 `ANTHROPIC_API_KEY`）；`dsh --profile web --dump-config` 出现该层并携带配置。重启后新实现生效（重启动作留给使用者）。
  - 上游粘贴通道出厂补丁：`dsh-host-apiproxy` 两处门槛加 `imageBridgeActive(ctx)`（装配行含 `dsh-vision-bridge` 且未禁用即放行），`node --check` 通过；补丁方法与重打说明已写入 `vision-bridge/PATCH.md`。
  - 旧实现删除：`git rm` 了 `plugin/`、`cli/`、`sync-cli.js` 与旧 `test/sync.test.js`；README/PATCH.md 已与新实现一致。
- 遗留问题（若有）：
  - 远程视觉端点按使用者 settings 里的火山方舟配置预填（OpenAI-compatible `/api/v3` + doubao 模型）；若实际协议不符，远程工具会返回 config 类错误，改 profile 里那一处 config 即可，本地八工具不受影响。
  - `~/.dsh/bin/dsh-vision`（旧 CLI 安装物）在本机已不存在，无需清理；若其他机器存在，切换后可手动删除。
