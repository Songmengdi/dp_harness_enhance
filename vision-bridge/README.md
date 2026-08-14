# vision-bridge — 纯文本模型的视觉外挂（vision-hook）

给 text-only 模型外挂一个视觉模型的完整系统：用户粘贴截图 → 落地为临时文件 →
路径注入上下文 → 模型按「明眼人协议」自己指挥视觉模型看图。

## 目录结构（本文件夹 = 唯一真源）

```
vision-bridge/
├── plugin/                  # Cordis 插件（挂在 agent preset 里）
│   ├── package.json
│   └── lib/index.js         # 全部钩子逻辑 + 内嵌 CLI 回退副本
├── cli/
│   └── dsh-vision           # CLI 唯一真源（describe/pixel/media/frames/config）
├── sync-cli.js              # cli/dsh-vision → 插件内嵌 CLI_SRC 的同步脚本
├── README.md
└── PATCH.md                 # 运行时布局、出厂补丁、协议改法、维护说明
```

## 运行时如何接上（重要）

- **插件**：`~/.dsh/profiles/web/vision-hook` 是指向 `plugin/` 的**符号链接**，
  预设行 `- id: vision-hook / name: vision-hook` 经 profile 的 node_modules 解析到这里。
  改 `plugin/lib/index.js` 就是改运行时。
- **CLI**：插件每次启动把 `cli/dsh-vision` 安装到 `~/.dsh/bin/dsh-vision`
  （读不到本文件时才用内嵌副本）。因此：
  - 改 CLI → 直接编辑 `cli/dsh-vision`，然后 `node vision-bridge/sync-cli.js`
    刷新内嵌副本（防漂移），再 `dsh-web restart`（其实重启时 installCli 会直接用本文件，sync 只是保持回退副本一致）。
- **预设**：`~/.dsh/.agent-presets/vision/`（视觉增强）与 `cordis-vision/`（创造+视觉增强）
  是配置，留在 `~/.dsh`（预设发现不跟随符号链接）。
- **出厂补丁**：`dsh-host-apiproxy` 的两处图片门槛（放行含 vision-hook 行的预设），
  dsh 升级后会被覆盖，重打方法见 PATCH.md。

## 核心行为

1. 纯文本模型会话：`read`/`read_image` 读图片被 `tools/pre-execute` 拦截，
   deny reason 携带【明眼人协议】——教模型如何给视觉模型写题（先全景→核对假设→
   具体可观测的提问→五段式结构化回答→证据追问）。
2. 用户粘贴的截图：宿主门槛放行 → `agent/pre-step` 把字节落到
   `$TMPDIR/dsh-vision-paste/<id>.<ext>`（OS 自动清理），image block 替换为纯路径文本。
3. `tools/post-execute`：bash 产出截图时自动补一段 describe 描述。
4. 视觉模型会话（如 doubao）：整套钩子隐身，图片原生进模型。

## 改动后的生效方式

`dsh-web restart`（插件与补丁都在进程启动时加载；CLI 自动重装）。
