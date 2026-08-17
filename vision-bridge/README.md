# vision-bridge — 纯文本模型的视觉桥（Route C 自研实现）

给 text-only 模型的 dsh Agent 装视觉工程能力：粘贴/读图/截图无缝桥接，
看图走结构化原生工具（vision_*），语义问题交给远程视觉模型，
像素级事实（坐标/颜色/差异/几何）交给本地确定性工具。
视觉模型会话整套能力自动隐身。

## 目录结构

```
vision-bridge/
├── src/                      # Route C Host 插件（TypeScript，dsh bundle）
│   ├── index.ts              # 入口与生命周期（装配校验、启动、卸载清理）
│   ├── exposure.ts           # 按 Agent 激活状态机（渐进暴露 D5）
│   ├── runtime.ts            # 统一执行总闸门（并发信号量/超时/取消/契约校验）
│   ├── runtime-manager.ts    # managed venv（锁定依赖 + 探针；05 加原子切换）
│   ├── paths.ts              # realpath 围栏（工作区+allowedDirs）+ 产物 staging→原子提交
│   ├── capabilities.ts       # 按 Agent 判断模型是否原生支持图片（失败缓存带 TTL）
│   └── tools/                # vision_media / vision_frames / …（工具 schema + execute）
├── runtime/                  # Python runtime（独立 venv；单入口分派子命令）
│   ├── requirements.lock     # 锁定依赖（精确版本）
│   └── dsh_vision/           # contract.py：stdout 单段 JSON + 稳定退出码 + 脱敏 stderr
├── test/                     # node --test 单测 + 集成测试（真实 venv + 子进程）
├── docs/architecture.md      # 架构说明（模块职责、契约、决策映射）
├── package.json / cordis.patch.yml / tsconfig*.json
│
│  # —— 旧实现（05 票删除前保持可用，见 README-legacy 说明）——
├── plugin/                   # 旧单文件 Cordis 插件（vision-hook）
├── cli/dsh-vision            # 旧 dsh-vision CLI（唯一真源）
└── sync-cli.js               # cli/dsh-vision → 插件内嵌副本（已修 $' 替换符 bug，支持 --check）
```

## 新包（dsh-vision-bridge）开发与验证

```bash
cd vision-bridge
pnpm install
npm run verify        # 门禁(零测试即失败) + typecheck + build + 全量测试
npm run pack:dry      # 打包 dry-run（仅本地交付，不发布）
```

本地装配（不发布任何制品）：

```bash
dsh plugin --profile <profile> add -w <本目录绝对路径>
# reconcile 自动把 dsh-vision-bridge 加进 profile 的 dsh.profile.bundles
dsh --profile <profile> --dump-config   # 末尾应出现 `# == dsh-vision-bridge` 层
```

## 旧实现（vision-hook）现状与修复

- 旧插件挂在 agent preset 里（`~/.dsh/profiles/web/vision-hook` 符号链接 → `plugin/`），
  CLI 每次启动安装到 `~/.dsh/bin/dsh-vision`。详细运行时说明见 `PATCH.md`。
- 01 票已修两个 bug：
  1. `sync-cli.js` 旧版用 `src.replace(re, block)` 写回，CLI 源码里的 `$'` 被
     JS 替换符解释，把插件 JS 代码体吞进内嵌 CLI——已改为 indexOf/slice 纯文本拼接，
     并新增 `--check` 干跑比对（漂移非零退出）；
  2. 插件定位项目 CLI 的相对层级多了一级（`../../../cli`）——已改为 `../../cli/dsh-vision`，
     启动安装走真源。
- 改旧 CLI 后：`node vision-bridge/sync-cli.js`，再 `node vision-bridge/sync-cli.js --check`。
- 05 票切换完成后旧实现（plugin/、cli/、sync-cli.js）整体删除。

## 状态

| 票 | 内容 | 状态 |
|---|---|---|
| 01 | 旧版两 bug 修复 + 新架构基座（media/frames 首条垂直切片） | 完成 |
| 02 | 核心六工具 + 产物管线 | 待办 |
| 03 | Seamless 桥 + intent + 自动激活 | 完成 |
| 04 | trace/extract_foreground/long_screenshot_ocr/html_screenshot | 完成 |
| 05 | 生产化收口 + 全量 e2e + 本地切换 | 待办 |
