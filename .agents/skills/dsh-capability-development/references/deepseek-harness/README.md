# DSH 插件开发文档库

官方 deepseek-harness 插件开发文档的**中文快照**,供本仓库各 dsh plugin 项目直接参考。

- 上游仓库:<https://github.com/deepseek-ai/deepseek-harness>
- 快照 commit:以本 skill `scripts/sync-dsh-docs.sh` 顶部的 `PIN` 为准(拉取日期:2026-08-14)
- 语言:**仅保留中文版**;`cordis-api/inherited.md` 上游未提供中文,保留英文(生成目录,勿手改)
- 同步:`bash scripts/sync-dsh-docs.sh`(本 skill 目录下)按当前 PIN 重新拉取并重建本目录;升级快照 = 改脚本顶部 `PIN`

## 目录地图

| 目录 | 内容 |
|---|---|
| `user/develop/basic/` | **插件开发主线**:第一个插件 → 开发工具 → 插件配置 → 打包发布 |
| `user/develop/framework/` | 服务与依赖注入、事件机制(插件生命周期) |
| `user/develop/practice/` | 能力分层实践(LLM 适配器案例) |
| `cordis-tutorial/` | 底层 Cordis 框架零基础教程(无需 API key) |
| `cordis-api/` | ctx / fiber / service / registry / events API 参考 |
| `cookbook/` | 工具编写参考、扩展模式、LLM 适配器、对话节点 |
| `subsystems/` | core、approval、skills、tools、web、client-modules 子系统说明(被教程引用) |
| `cordis-primer.md` | Cordis 概念手册 |
| `architecture.md` | 总体架构与扩展点地图 |
| `capability-seams.md` | 能力接缝(capability seams)说明 |

完整流程入口:`user/develop/basic/index.md` → `tool.md` → `config.md` → `publish.md`。

## 链接说明

快照内**文档互链均已本地打通**。指向 `packages/`、`apps/`、`.agents/` 以及 `development.md`、`testing.md`、`tool-catalog.md` 的链接属于上游仓库内部(代码路径、内部笔记、贡献者文档),本地不可达,回上游按同路径查看:

`https://github.com/deepseek-ai/deepseek-harness/blob/<PIN>/docs/<本目录相对路径>`
