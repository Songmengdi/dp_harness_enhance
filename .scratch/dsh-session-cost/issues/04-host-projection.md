# 04 - Host 投影注册（sessionOwnCost）

Status: ready-for-agent
Type: task

## 目标

把纯费用计算模块接入 dsh session-projection，使每个会话在 client 端可通过 `projectionValues.sessionOwnCost` 读到自身费用。

## 任务

- 在 host 入口（`src/index.ts`）通过 `ctx.sessionProjections.register` 注册投影 key `sessionOwnCost`。
- 通过 declaration merging 扩展 `SessionProjectionMap`，`sessionOwnCost: number`。
- 投影状态与 `apply` 复用 03 的纯计算逻辑；保证投影值只反映已结算费用。
- `enabled: false` 时不注册投影（或注册后始终返回 0/absent）。
- 保持 effect 所有权：插件卸载时投影随 fiber 注销。

## 验收

- `typecheck` 通过。
- 用一组假 `SessionEvent[]` 驱动投影 fold，能产出与 03 纯函数一致的值。
- 卸载后投影 key 从 registry 消失。
