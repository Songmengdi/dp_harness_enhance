# Context

## 会话任务费用（Task Cost）
单个会话（含其全部 subagent 后代）内，由 DeepSeek 官方模型调用产生的累计费用，以人民币元展示。从用户视角，它回答“这个任务已经花了多少钱”。

## DeepSeek 模型
指 dsh 官方 DeepSeek provider（`deepseek-official`）下发布的模型，如 `deepseek-v4-flash`、`deepseek-v4-pro`。第三方中转或其它 provider 不算。

## 费用展示
- 单位：人民币元
- 精度：固定 2 位小数（Q7 B）
- 文案：`费用 ¥0.01`（Q22 B）
- 位置：与官方统计行合并为同一行，追加在末尾（Q21 B）
- 当前模型信息不可用时隐藏，等可用后再显示（Q23 A）

## 结算时机
只在每条 `assistant/message` 定稿后更新费用；流式 `assistant/chunk` 不参与计价（Q9 B）。

## 计价时段
按每条调用的实际发生时间区分高峰/空闲时段，使用 DeepSeek 官方对应价格（Q4 A）。

## 隐藏规则
以当前查看会话的当前选中模型是否为 DeepSeek 为准；若为 DeepSeek 则显示，否则隐藏。历史/子树混合时只统计 DeepSeek 调用（Q3 A、Q13 A）。

## subagent 汇总
- 递归包含全部 subagent 后代（Q11 A）
- 只聚合 `origin: 'subagent'` 的后代，用户 fork 不算（Q15 A）
- 每个会话都展示“自身 + 后代”的费用（Q12 A）
- 缺失/不可读的子会话忽略，不阻塞展示（Q14 A）
- 子会话若从父会话 seed，只计 `seedLength` 之后的新增部分，避免重复计费

## 费用边界
- 没有任何 DeepSeek 调用时隐藏；有费用但 < ¥0.01 时显示 `<¥0.01`（Q16 B）
- 失败/中断但已产生 usage 的调用计入，在步结束时结算（Q17 B）
- 价格表未覆盖的 DeepSeek 模型不统计，可由配置补充（Q19 A）
- 首版只显示总额，不做 hover 明细（Q20 A）
