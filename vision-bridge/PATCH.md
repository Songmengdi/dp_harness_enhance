# vision-hook 维护说明（粘贴图片落地转路径 + 读图拦截）

> 本文件与源码同在项目内：`vision-bridge/`（见 README.md 的目录结构）。

## 文件清单（运行时位置）

- 插件源码（唯一真源）：`vision-bridge/plugin/lib/index.js`
  - 运行时通过符号链接加载：`~/.dsh/profiles/web/vision-hook → <项目>/vision-bridge/plugin`
    （预设行 `- id: vision-hook` / `name: vision-hook` 经 profile 的 node_modules 解析到该链接）
  - 用户预设（配置，非源码）：`~/.dsh/.agent-presets/vision/`（视觉增强）与
    `cordis-vision/`（创造+视觉增强）——预设发现只认真实目录，不跟随符号链接，
    所以这两份留在 `~/.dsh` 下；改预设行时记得同步此处的说明。
- CLI 源码（唯一真源）：`vision-bridge/cli/dsh-vision`
  - 插件启动时把它安装到 `~/.dsh/bin/dsh-vision`（installCli 优先读本文件，读不到才用内嵌副本）
  - `node vision-bridge/sync-cli.js` 把本文件同步进插件的内嵌 CLI_SRC 块（回退副本防漂移）
- 出厂补丁（升级 dsh 后会被覆盖，需重新打）：
  `<dsh 安装目录>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`
  （本机为 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`）

## 出厂补丁内容（三处，可对照 grep `imageBridgeActive` 找回）

1. 新增函数 `imageBridgeActive(ctx, agent)`：解析会话所属预设的组成文本，
   含 `vision-hook` 行（正则 `-\s*id:\s*vision-hook\b`）即返回 true；任何失败保守返回 false。
2. `prompt` 端点图片门槛：模型不支持图片时，条件尾部加
   `&& (await imageBridgeActive(ctx, agent)) === false` 才拒绝
   （否则拒绝 reason 为 MODEL_DOES_NOT_SUPPORT_IMAGES，钩子永远收不到图片）。
3. `selectModel` 端点：会话已含图片、切换纯文本模型时同样放行 vision-hook 预设。

## 工作流

用户粘贴截图 → 消息以 image block（attachment 引用）进入会话
→ `agent/pre-step` 钩子（仅纯文本模型会话生效）只做一件事：
  图片字节落盘到系统临时目录 `$TMPDIR/dsh-vision-paste/<id>.<ext>`
  （OS 定期自动清理，无需手动维护），
  并把 image block 替换成纯文件路径文本，不附加任何说明（钩子不调用视觉模型）
→ 模型按原有流程自己查看该文件（read 图片会被拦截并指路 dsh-vision CLI）。
视觉模型会话（如 doubao）整套不拦截。

## 明眼人协议（教文本模型如何给视觉模型写题）

同款协议出现在三个 agent 可见位置，改协议要三处一起改：
1. `read`/`read_image` 拦截的 deny reason（插件 `tools/pre-execute`）；
2. 系统提示注入段 `USAGE_SECTION`（插件内，触发后按会话注入）；
3. CLI 内置 `USAGE`（`dsh-vision` 不带参数时打印，改 `cli/dsh-vision` 后跑 sync-cli.js）。

核心内容：第一轮先要全景描述再核对假设；提问要具体可观测
（数量/颜色/方位+坐标/文字逐字）；每次提问要求五段式回答
（直接回答/实际所见/证据/信心/补充），绝不接受只答是/否；
对关键声明追问证据，对方说不确定就要求明说。
OCR 与"交叉验证"字样已按用户要求全部移除。

## 重启生效

插件与补丁都在进程启动时加载：改动后执行 `dsh-web restart`。
（CLI 会在每次插件启动时自动重装到 `~/.dsh/bin/dsh-vision`。）
