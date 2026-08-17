# dsh-session-cost Spec

Status: ready-for-agent

## Problem Statement

dsh 用户在使用 DeepSeek 官方模型跑任务时，无法在会话界面直接看到“这个任务已经花了多少钱”。费用分散在 API 账单里，且任务可能递归派生出多个 subagent 子会话，用户需要手动汇总才能知道真实花费。当前 dsh UI 底部只有 token/耗时统计，没有费用统计。

## Solution

提供一个独立的 dsh 插件 `dsh-session-cost`：host 端从会话日志精确计算每个会话自身的 DeepSeek 官方模型费用，client 端在会话 UI 底部（输入框下方的统计行区域）展示“当前会话 + 全部 subagent 后代”的累计费用。只有当当前查看会话的当前选中模型是 DeepSeek 官方模型时才展示；非 DeepSeek 调用不计入，fork 分支不聚合，缺失子会话忽略。

## User Stories

1. 作为 dsh 用户，我希望在 DeepSeek 会话底部看到累计 DeepSeek 费用，以便不离开界面就能跟踪花费。
2. 作为会派发 subagent 的用户，我希望父会话显示的费用包含所有递归 subagent 后代的 DeepSeek 费用，以便知道整个任务的真实成本。
3. 作为查看 subagent 会话的用户，我希望该会话底部显示它自己的“自身 + 后代”费用，以便理解子任务成本。
4. 作为会 fork 会话的用户，我希望 fork 出的分支不计入当前任务的费用，以便另开思路不会污染任务总额。
5. 作为会把当前模型切到非 DeepSeek 模型的用户，我希望费用行立即隐藏，以便不会展示无法按 DeepSeek 价格计价的金额。
6. 作为切回 DeepSeek 模型的用户，我希望费用行重新出现并继续显示 DeepSeek 部分费用，以便恢复花费跟踪。
7. 作为任务树中部分 subagent 使用非 DeepSeek 模型的用户，我希望只统计 DeepSeek 调用，以便总额只反映可计价部分。
8. 作为混合模型会话的用户，我希望未知/非 DeepSeek 调用被跳过，以便显示的不是错误估算。
9. 作为流式生成中的用户，我不希望费用随每个 token chunk 跳动，而希望等到 assistant 消息定稿或失败步结束时再结算。
10. 作为遇到失败/中断模型调用的用户，我希望该调用已产生的 usage 在步结束时计入，以便总额反映真实扣费。
11. 作为还没有任何 DeepSeek 调用的用户，我希望不显示费用行，以便不会看到无意义的 `¥0.00`。
12. 作为费用大于 0 但小于 ¥0.01 的用户，我希望看到 `<¥0.01`，以便不会误读成免费。
13. 作为当前模型信息尚未加载完成的用户，我希望费用行暂时隐藏，等模型信息可用后再显示，以避免错误闪动。
14. 作为存在缺失/已删除 subagent 会话的用户，我希望费用仍基于可用会话显示，以便单个缺失子会话不会让总额消失。
15. 作为在意高峰/空闲计价的用户，我希望按每次调用的实际时间使用官方高峰/空闲价格，以便总额更准确。
16. 作为遇到官方调价的用户，我希望通过插件配置覆盖价格，以便无需等待插件发版。
17. 作为遇到价格表未覆盖的新 DeepSeek 模型的用户，我希望该模型暂不统计，直到我补充价格，以避免按错误价格估算。
18. 作为 UI 用户，我希望费用文案为 `费用 ¥0.01`，并追加在官方统计行末尾，以便保持底部简洁一致。
19. 作为 dsh 插件使用者，我希望该功能是独立可安装插件，以便不依赖或改动现有 UI 增强插件。

## Implementation Decisions

- 新建独立插件包 `dsh-session-cost`，包含 host 与 client 两个构建入口，单独发布。
- Host 侧注册一个会话投影 key `sessionOwnCost`（通过 `SessionProjectionMap` declaration merging），值为非负人民币数字（`0` 表示没有可计价的 DeepSeek 用量）。
- 费用计算做成纯领域模块（单测试缝），输入为 `SessionEvent[]` + 价格配置，输出该会话“自身”的已结算 DeepSeek 费用。
- 计价规则：
  - 只统计 `assistant/message` 中 `message.source.provider === 'deepseek-official'` 且模型在价格表中的调用。
  - 三桶计价：缓存命中输入（cache read）、缓存未命中输入（uncached input）、输出；`cacheWriteTokens` 不额外收费。
  - 高峰/空闲按 `event.time` 转为北京时间（Asia/Shanghai）判断：高峰 9:00–12:00、14:00–18:00，其余为空闲。
  - 内置默认价格表：`deepseek-v4-flash` 与 `deepseek-v4-pro`，价格来自官方 pricing 页；可通过配置覆盖。
- 结算时机：
  - 正常成功调用在 `assistant/message` 定稿时计入。
  - 失败/中断但已产生 usage 的调用，由 `assistant/chunk` 的 usage 暂存到该 step 的 pending 状态，在 `step/end`（或 `turn/end`）时结算；暴露的投影值只在结算点变化，不在流式中跳动。
- subagent 去重边界：若会话日志中存在 `subagent/descriptor` 事件，忽略该事件之前的所有事件（继承的父会话 seed），只统计子会话自身新增部分，避免父历史重复计费。
- Client 聚合做成纯领域模块（单测试缝）：输入会话列表 `Record<SessionId, SessionSummary>`、当前会话 id、当前模型信息，输出显示状态与文案。
  - 递归收集 `origin === 'subagent'` 的后代；fork（`origin` 非 subagent）终止传播。
  - 汇总当前会话及后代的 `projectionValues.sessionOwnCost`。
  - 当前模型不是 DeepSeek、模型信息不可用、或总额为 0 时隐藏。
  - 文案：总额 ≥ ¥0.01 时 `费用 ¥X.XX`；0 < 总额 < ¥0.01 时 `费用 <¥0.01`。
- Client UI 适配层注册 `conversation.composer.dock` 条目，读取 `useSessions`、当前会话投影值、以及模型目录服务中的当前选中模型。
- 与官方统计行同排：优先尝试 CSS/inline 方式把费用追加到官方 StatsLine 同一行；若官方布局无法干净支持同排，则退化为独立一行并在实现时记录偏差。
- 配置使用 Schemastery schema：`enabled`（默认 true）与 `models` 价格表；价格表为 `deepseek-official` 下模型 id → 高峰/空闲 × 缓存命中/未命中/输出单价（每百万 tokens 人民币）。
- 不发起任何网络请求；价格完全来自内置默认值与用户配置。

## Testing Decisions

- 单测试缝：纯领域逻辑模块（host 费用计算 + client 聚合/格式化）。不测 React 组件、不测 Cordis 装配细节。
- 测试风格沿用 `dsh-session-ui-enhance/test/*.test.js`：`node:test` + `node:assert/strict`，直接 import `lib/types/...` 产物。
- Host 费用计算测试覆盖：
  - 成功 `assistant/message` 计费；
  - 失败/中断调用通过 usage chunk 在 step 结束时计入；
  - 混合模型只计 DeepSeek；
  - 未知模型跳过；
  - 高峰/空闲边界（9:00、12:00、14:00、18:00）；
  - 缓存命中/未命中/输出三桶；
  - `cacheWriteTokens` 不收费；
  - subagent seed 边界（首个 `subagent/descriptor` 之前的事件不计）；
  - 空日志/无 usage/零费用。
- Client 聚合/格式化测试覆盖：
  - 递归 subagent 树汇总；
  - fork 终止传播；
  - 缺失子会话忽略；
  - 当前模型非 DeepSeek / 模型信息不可用 / 总额为 0 的隐藏；
  - `<¥0.01`、正常金额、0 的格式化。
- 最终验收：`typecheck`、`build`、真实 profile 安装 + GUI 验证费用行出现/隐藏/更新。

## Out of Scope

- 跨会话/工作区/全局费用汇总。
- 非 DeepSeek 提供方的价格统计。
- 费用明细 hover/展开（按模型、时段、输入输出细分）。
- 流式过程中逐 chunk 实时刷新费用。
- 自动从官方网页抓取价格。
- 作为账单/发票依据的准确度保证（本功能是展示参考，不是官方账单）。

## Further Notes

- 领域词汇见根目录 `CONTEXT.md`。
- 已确认：独立插件、递归 subagent、只聚合 `origin: 'subagent'`、seed 去重、缺失忽略、当前模型决定显隐、高峰/空闲计价、2 位小数、`费用 ¥X.XX` 文案、失败调用步末结算、首版无 hover。
- 与官方统计行同排（Q21 B）存在实现风险：官方 StatsLine 是整行 block，composer.dock 列表条目默认堆叠；实现优先尝试同排，必要时退化为独立行并记录。
