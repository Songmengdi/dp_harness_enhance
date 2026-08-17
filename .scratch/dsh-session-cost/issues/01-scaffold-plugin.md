# 01 - 搭建 dsh-session-cost 独立插件骨架

Status: ready-for-agent
Type: task

## 目标

在仓库根目录新建独立插件 `dsh-session-cost`，可构建、可打包、可被 dsh 加载。

## 任务

- 创建 `dsh-session-cost/` 目录，参考 `dsh-session-ui-enhance` 的结构：
  - `package.json`：`name: "dsh-session-cost"`、`type: "module"`、`main`/`types`/`exports`（含 `./client`）、`files`、`dsh.client.platform: "web"`、`dsh.client.inject`、peerDependencies 与 devDependencies。
  - `tsconfig.json`、`tsconfig.host.json`、`tsconfig.client.json`、`tsdown.config.ts`（可先复制已验证模板）。
  - `src/index.ts`（host 入口占位）、`src/client/index.tsx`（client 入口占位）、`src/config.ts`（Config schema 占位）。
  - `test/` 目录与 `npm test` 脚本（node:test）。
- 保证 `typecheck`、`build` 通过。
- 不实现业务逻辑；本 ticket 只保证骨架可装配。

## 验收

- `npm run typecheck` 通过。
- `npm run build` 产出 `lib/index.js`、`lib/client.js`、类型声明。
- `package.json` 的 exports/files 与构建产物一致。
