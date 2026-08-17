# 07 - README、打包与真实装配验证

Status: ready-for-agent
Type: task

## 目标

让插件可被用户安装、配置，并完成真实 dsh profile 验证。

## 任务

- 编写 `dsh-session-cost/README.md`：
  - 功能说明与隐藏/计价规则摘要；
  - 安装命令（`dsh plugin --profile <p> add <包>`）；
  - 配置示例（覆盖价格、`enabled: false`）；
  - 开发命令（typecheck/build/test）。
- 确保 `package.json` 的 `files`、`exports`、构建产物三者一致。
- 执行 `npm run typecheck`、`npm run build`、`npm test`、`npm pack`。
- 在 scratch profile 安装并验证：
  - `--dump-config` 出现 `dsh-session-cost` 层；
  - GUI 中费用行出现/隐藏/更新正确；
  - 若发布 tarball，比对 built / installed / served 三方字节一致（`shasum lib/client.js` 等）。

## 验收

- README 安装命令在全新 profile 上可用。
- 三方字节一致。
- 所有验证门禁通过。
