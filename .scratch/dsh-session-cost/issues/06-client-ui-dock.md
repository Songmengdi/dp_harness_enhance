# 06 - Client UI 适配（conversation.composer.dock）

Status: ready-for-agent
Type: task

## 目标

在会话 UI 底部展示费用行，并尽量与官方统计行同排。

## 任务

- 在 `src/client/index.tsx` 注册 `conversation.composer.dock` 列表条目。
- 读取：
  - `useSessions` 获取会话列表与各会话 `projectionValues.sessionOwnCost`；
  - 当前会话 id；
  - 当前选中模型（通过模型目录/会话服务，参考 `dsh-session-ui-enhance` 的 model-split 数据源）。
- 使用 05 的纯模块计算显示状态；隐藏时返回 `null`。
- 文案：`费用 ¥X.XX` / `费用 <¥0.01`。
- 同排尝试：用 CSS 尽量把本条目与官方 StatsLine 视觉合并为同一行；若官方布局不支持，则退化为独立一行并在代码注释/README 记录。
- 保证 `aria`/focus 可访问性不劣化；不拦截点击。

## 验收

- `typecheck`、`build` 通过。
- 在真实 GUI 中：DeepSeek 会话显示费用；非 DeepSeek 隐藏；subagent 费用计入父会话；模型切换时显隐正确。
