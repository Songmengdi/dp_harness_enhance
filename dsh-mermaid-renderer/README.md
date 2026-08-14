# dsh-mermaid-renderer

把 dsh Web GUI 会话里助手输出的 ```mermaid 代码块,原位替换成**主题感知的可交互 SVG 卡片**:适配/缩放/平移、源码查看、复制、失败重试,深色主题自动重着色。渲染走 **host 同源 Kroki 代理**,浏览器永不直连外网(无 CORS/代理问题)。

## 组成

| 半边 | 职责 |
|---|---|
| host(`lib/index.js`) | 注入 `webServer`:① `POST /plugins/dsh-mermaid-renderer/render`(diagram JSON 进 → SVG 出,转发 Kroki 兼容服务);② `GET /plugins/dsh-mermaid-renderer/client-config`(配置客户端子集,`no-store`) |
| client(`lib/client.js`) | 注入 `slots`,注册到 `conversation.chat.assistant-actions` 列表槽;启动时从 host 拉配置快照,失败回退编译期默认值 |

配置单一事实源:host 侧 Schemastery schema 校验并补默认值,客户端可见子集经 HTTP 下发(client bundle 的 boot graph 不携带配置);两端默认值由单测守护不漂移。

## 安装(推荐:GitHub Release tarball)

```sh
# 1. 全新 profile 首次使用 dsh plugin add 前,需要一次 pnpm workspace-root 豁免
#    (dsh 初始化新 profile 时不会写 .npmrc;已装过插件的 profile 无需此步):
mkdir -p ~/.dsh/profiles/<name>
printf 'ignore-workspace-root-check=true\n' > ~/.dsh/profiles/<name>/.npmrc

# 2. 安装(声明了 dsh.bundle,自动追加进 dsh.profile.bundles 并激活配置层):
dsh plugin --profile <name> add https://github.com/Songmengdi/dp_harness_enhance/releases/download/dsh-mermaid-renderer-v1.2.0/dsh-mermaid-renderer-1.2.0.tgz

# 3. 验证层与行:
dsh --profile <name> --dump-config
#   应出现:# == dsh-mermaid-renderer / - id: mermaid-renderer

# 4. 启动:
dsh --profile <name>
```

旧版手工安装迁移:若 profile 的 `cordis.patch.yml` 里还有 `- insert: - id: mermaid-renderer` 块,请删除(bundle patch 已提供该行,再 insert 会报 `duplicate loader entry id`)。

> 备选分发:源码目录 `npm pack` 生成 tgz 后 `dsh plugin --profile <name> add ./dsh-mermaid-renderer-1.2.0.tgz`(离线/内网场景)。

## 配置

在 profile 的 `cordis.patch.yml` 按行 id 覆盖(整段替换,未写字段用 schema 默认值):

```yaml
- id: mermaid-renderer
  config:
    krokiBaseUrl: 'https://kroki.io'
    fitMaxHeight: 480
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `krokiBaseUrl` | `https://kroki.io` | Kroki 兼容渲染服务基地址(host) |
| `krokiPath` | `/mermaid/svg` | 渲染路径(host) |
| `upstreamTimeoutMs` | `30000` | 上游超时(host) |
| `maxBodyBytes` | `200000` | 请求体上限,超出 413(host) |
| `maxDiagramBytes` | `40000` | 单图源码上限,超出 400(host) |
| `fitMaxHeight` | `360` | 适配模式最大高度 px(client) |
| `zoomBoxHeight` | `560` | 缩放容器高度 px(client) |
| `zoomMinScale` / `zoomMaxScale` | `0.15` / `6` | 缩放范围(client) |
| `renderTimeoutMs` | `30000` | 单图渲染超时(client) |
| `themeAuto` | `true` | 深色 GUI 自动注入 dark theme(client) |
| `darkColors.*` | 见 schema | 深色重着色:shape/stroke/cluster/edge/text/canvas(client) |

> 上游不可达(如本机网络到 kroki.io 超时)时,渲染失败会以卡片内错误 + 重试按钮呈现;可把 `krokiBaseUrl` 指向自建 Kroki/Mermaid 服务。

## 开发与验证

```sh
npm install
npm run verify   # typecheck(host/client 双 program) + build + 单测(21 例)
npm run build    # tsc host ESM → lib/;esbuild 打包 client → lib/client.js(react 保持 external,banner/footer 包裹,inline sourcemap 有效)
```

构建契约:`lib/index.js`(含运行时的 `Config` schema 值导出)与 `lib/client.js`(`window.__ModuleLoader__.load` 工厂,导出 apply/inject/name)必须真实存在,与 `package.json` 的 `exports`/`files` 一致;`dsh.client.platform: "web"` 与 `exports["./client"]` 成对出现。

## 实现要点

- 纯函数(缩放钳制/适配计算/深色注入/SVG id 重命名/请求体解析)在 `src/shared/`,host 与 client 各自编译进产物,单测直接覆盖。
- client 值 import 只有 `react`/`react-dom/client`(平台模块表 seed 词);`@deepseek-ai/cordis` 仅 type-only;跨包协作走 slots service。
- 所有 route、style 注入、MutationObserver、wheel/keydown 监听都挂在 `ctx.effect` 或 React effect 上,随 fiber 卸载清理;在途渲染请求用 AbortController 中止。
- 缩放模式支持拖拽平移/滚轮缩放/双击适配/Esc 退出,`prefers-reduced-motion` 下关闭过渡。

## License

MIT
