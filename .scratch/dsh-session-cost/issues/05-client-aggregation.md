# 05 - Client 聚合/格式化纯模块（单测试缝）

Status: ready-for-agent
Type: task

## 目标

实现“当前会话 + subagent 后代”费用汇总与显示决策的纯函数，不碰 React。

## 任务

- 新增纯模块（如 `src/client/cost-display.ts`），导出：
  - `collectSubagentDescendants(sessionId, summaries)`：递归收集 `origin === 'subagent'` 的后代；fork 终止传播。
  - `aggregateTaskCost(sessionId, summaries)`：当前会话 + 后代 `projectionValues.sessionOwnCost` 之和。
  - `shouldShowCost(currentModel, totalCost)`：当前模型为 DeepSeek 且模型信息可用且 totalCost > 0 才显示。
  - `formatCost(totalCost)`：`费用 ¥X.XX`；0 < totalCost < 0.01 时 `费用 <¥0.01`。
- 输入类型使用 `SessionSummary`、`SessionId` 等 type-only import。
- DeepSeek 判定：provider `deepseek-official` 且模型 id 在价格表（或前缀 `deepseek-` 的官方模型）中；具体判定函数放在本模块，便于测试。

## 验收

- 单测覆盖 spec 中列出的 Client 场景（递归 subagent、fork 终止、缺失忽略、当前模型非 DeepSeek/不可用/零费用隐藏、格式化）。
- `npm test` 通过。
