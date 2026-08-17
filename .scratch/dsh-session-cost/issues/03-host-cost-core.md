# 03 - Host 纯费用计算模块（单测试缝）

Status: ready-for-agent
Type: task

## 目标

实现“单会话自身 DeepSeek 费用”的纯领域计算函数，不碰 I/O、React、Cordis。

## 任务

- 新增纯模块（如 `src/host/cost-core.ts`），导出类似 `computeSessionOwnCost(events, prices)`。
- 输入：
  - `SessionEvent[]`（完整会话日志，含 `time`、`data`）。
  - 价格表（来自 Config 的 `models['deepseek-official']`）。
- 输出：非负人民币数字（`number`），表示该会话自身已结算的 DeepSeek 费用。
- 规则：
  - 只处理 `assistant/message` 且 `data.usage` 存在、`data.message.source.provider === 'deepseek-official'`、模型在价格表中的调用。
  - 三桶：`usage.inputTokens`（缓存未命中）、`usage.cacheReadTokens`（缓存命中）、`usage.outputTokens`；`cacheWriteTokens` 不收费。
  - 高峰/空闲：`event.time` 转北京时间（Asia/Shanghai），高峰 9:00–12:00、14:00–18:00。
  - 失败/中断：`assistant/chunk` 的 `usage` 暂存到当前 step；`assistant/message` 或 `step/end`/`turn/end` 时结算，暴露结果只在这些结算点变化。
  - subagent seed 边界：日志中首个 `subagent/descriptor` 之前的事件不计。
- 该模块保持纯函数、可确定性重放。

## 验收

- 单测覆盖 spec 中列出的 Host 费用计算场景（成功、失败 usage、混合模型、未知模型、高峰/空闲边界、三桶、cacheWrite 不收费、seed 边界、空日志/零费用）。
- `npm test` 通过。
