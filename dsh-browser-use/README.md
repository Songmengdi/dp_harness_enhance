# dsh-browser-use

ZCode 式浏览器自动化插件：给 dsh 一个**持久浏览器**，Agent 可以打开网页、点击、填表、滚动、截图、切换标签页，并在会话内新增一个「浏览器」标签页实时查看画面。不依赖社区插件，使用 Playwright + 本机 Chrome/Edge。

## 能力

- **Host 浏览器工具**：`browser_open` / `browser_navigate` / `browser_click` / `browser_type` / `browser_press` / `browser_select` / `browser_scroll` / `browser_snapshot` / `browser_get_text` / `browser_get_html` / `browser_screenshot` / `browser_wait` / `browser_back` / `browser_forward` / `browser_reload` / `browser_new_tab` / `browser_switch_tab` / `browser_close_tab` / `browser_list_tabs` / `browser_resize` / `browser_close`（`browser_eval` 默认关闭）
- **Codex/ZCode 式 Browser Use**：插件自托管 `node_repl` MCP server，自动注册 `mcp__node_repl__js` / `mcp__node_repl__js_reset` / `mcp__node_repl__js_add_node_module_dir`；每个 `js` 调用都是 fresh kernel，通过 `agent.browsers` 驱动浏览器（`domSnapshot` → Playwright locator → act）
- **结构化快照**：`browser_snapshot` 返回页面可见文本 + 可交互元素编号（`e1`/`e2`…），纯文本模型也能稳定操作。
- **可见浏览器窗口**：默认以非无头模式启动本机 Chrome/Edge，用户能实时看到 Agent 的操作（类似 ZCode/Codex 的内置浏览器）；同时会话头部出现「浏览器」标签页，显示当前页面截图、地址栏、后退/前进/刷新、标签页列表，点击画面可让 Agent 点击该坐标。
- **持久登录态**：浏览器使用独立 profile（默认 `$DSH_HOME/browser-use/profile`），重启 dsh 后登录状态保留。
- **安全边界**：只允许 http/https，拒绝 `file:`/`data:`/云元数据；默认放行 localhost（开发友好），可用白/黑名单收窄；`browser_eval` 默认关闭。
- **两个技能**：`browser-drive`（驾驶浏览器）和 `browser-walkthrough`（网页走查/回归）。

## 安装

本地开发/构建后安装：

```bash
cd dsh-browser-use
pnpm install
npm run verify          # typecheck + build + test
dsh plugin --profile web add .   # 或使用 tarball
```

发布 tarball 安装（构建产物自包含，需安装 `playwright-core` 依赖）：

```bash
npm pack
dsh plugin --profile web add ./dsh-browser-use-0.1.0.tgz
```

> 目标 profile 不是 `web` 时，把 `web` 换成你的 profile 名。
> 插件需要本机有 Chrome/Chromium/Edge；找不到时用 `launch.channel` 或 `executablePath` 指定。

## 配置

在 profile 的 `cordis.patch.yml` 按行 id 覆盖整段 config：

```yaml
- id: browser-use
  config:
    executablePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
    channel: chrome            # auto: chrome -> msedge -> chromium
    headless: false            # false = 打开可见 Chrome 窗口（默认，类 ZCode/Codex）；true = 只在 dsh 面板显示截图
    userDataDir: ""            # 空 = $DSH_HOME/browser-use/profile
    viewport:
      width: 1280
      height: 800
    navigationTimeoutMs: 30000
    actionTimeoutMs: 15000
    screenshotDir: browser-screenshots
    allowEval: false           # 开启 browser_eval（高风险）
    allowPrivate: true         # 是否允许 localhost/内网
    allowedHosts: []           # 非空时只放行这些域名（支持 *.example.com）
    blockedHosts: []           # 黑名单优先
    enableMcpBridge: true      # 是否启动 Codex 式 node_repl MCP bridge（默认开）
```

## 使用

安装并重启后，在会话里直接说：

- “打开 http://localhost:5173/settings，切到深色模式，看看有没有撞色”
- “在注册页填一组测试数据并提交，把结果告诉我”
- “把页面切到 375×812，看导航栏会不会重叠”
- “走一遍订单列表 → 详情 → 返回，看筛选条件是否丢失”

Agent 会调用 `browser_open` 等工具；同时点击会话头部的「浏览器」标签页可以实时看到画面。

## Codex/ZCode 式 Browser Use（node_repl MCP）

插件默认自托管一个轻量 MCP 客户端，内部拉起 `node_repl` MCP server，并把以下工具注册到 dsh 工具表：

- `mcp__node_repl__js`
- `mcp__node_repl__js_reset`
- `mcp__node_repl__js_add_node_module_dir`

每个 `js` 调用都在独立 worker 中执行，JS 变量不跨调用保留；持久浏览器标签页是唯一连续性边界。模型侧通过 `agent.browsers` 工作：

```js
// 每次 js 调用先选浏览器并列出受控标签
const browser = await agent.browsers.getDefault();
const controlledTabs = await browser.tabs.list();
controlledTabs;
```

```js
// 绑定已验证的标签并读取 DOM 快照
const tab = await browser.tabs.get("tab:1");
await tab.playwright.domSnapshot();
```

```js
// 用快照事实构造 locator 并操作
const input = tab.playwright.getByRole("textbox", { name: "Search" });
if ((await input.count()) !== 1) throw new Error("not unique");
await input.fill("hello");
await input.press("Enter");
```

配套技能 `control-browser` 会教模型完整的 bootstrap / tab 恢复 / snapshot→locator→act 流程。

关闭该能力：把配置里的 `enableMcpBridge` 设为 `false`，插件只保留原 `browser_*` 工具。

## 真实 Chrome 扩展（可选，Codex for Chrome 模式）

如果你想直接操作用户**日常 Chrome**（登录态、历史、扩展都可用），可以加载 `chrome-extension/` 目录：

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. “加载已解压的扩展程序”，选择 `dsh-browser-use/chrome-extension/`
4. 保持 dsh web 运行在 `127.0.0.1:3080`

扩展会自动连接 `ws://127.0.0.1:3080/browser-use/extension`。连接后：

- `agent.browsers.list()` 会同时看到 `iab`（dsh 自带浏览器）和 `extension`（你的真实 Chrome）
- 用 `agent.browsers.get("extension")` 选择真实 Chrome
- Agent 创建的标签页会标记为 **Agent**；你手动打开的标签页默认是 **User**，Agent 需要先 `user.openTabs()` → `user.claimTab()` 才能接管

## 开发

```bash
pnpm install
npm run typecheck
npm run build
npm run test
npm run verify
```

热更新 host 代码后需重启 `dsh web`；client bundle 拷贝到 profile 后刷新页面即可。

## 已知边界

- 会话内面板目前是“截图 + 坐标点击”的实时镜像，不是嵌入第二个真实浏览器内核；真正可见的浏览器是本机弹出的 Chrome/Edge 窗口，交互通过 Playwright 驱动该窗口完成。
- `<input type=file>` 的文件上传需要用户手动处理。
- 页面文字不会被当作指令；会真实提交数据的操作应先征求用户确认。
