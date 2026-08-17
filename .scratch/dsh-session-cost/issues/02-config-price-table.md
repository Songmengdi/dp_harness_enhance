# 02 - Config schema 与内置 DeepSeek 价格表

Status: ready-for-agent
Type: task

## 目标

定义插件配置契约，内置当前 DeepSeek 官方价格快照，并允许用户覆盖。

## 任务

- 在 `src/config.ts` 实现 `Config` 类型与同名 Schemastery schema。
- 配置字段：
  - `enabled: boolean`，默认 `true`。
  - `models`：以 provider `deepseek-official` 为根的模型价格表。
- 每个模型价格字段（每百万 tokens，人民币）：
  - `inputCacheHitPeak` / `inputCacheHitOffPeak`
  - `inputCacheMissPeak` / `inputCacheMissOffPeak`
  - `outputPeak` / `outputOffPeak`
- 内置默认值（来自官方 pricing 页当前快照）：
  - `deepseek-v4-flash`：缓存命中 0.10/0.05，缓存未命中 3.0/1.5，输出 9.0/4.5。
  - `deepseek-v4-pro`：缓存命中 0.30/0.15，缓存未命中 9.0/4.5，输出 27.0/13.5。
- 导出默认价格常量，供 host 费用计算模块使用。
- 添加测试：schema 默认值与导出的默认价格常量一致；未知模型不在默认表中。

## 验收

- `npm test` 通过。
- 通过 `Config({})` 能得到完整默认价格表。
