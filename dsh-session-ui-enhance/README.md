# dsh-session-ui-enhance

dsh Web GUI 会话优化插件:

- **用户轮次定位导轨**:在对话列左缘垂直居中渲染一条横条导轨——每个用户轮次一根横条,悬停时按距离渐变条长、弹出卡片预览该轮输入,点击(或键盘 Enter/Space)定位并高亮对应消息;同时贡献**分档内容宽度断点**与呼吸留白(`--dsh-chat-content-width` / `--dsh-composer-side-clearance`)
- **zcode 风格排版重制**(`src/client/typography.css`,纯 CSS、零 JS):覆盖产品 `--dsw-font-markdown-*` token——正文 16/28→14/26、标题收敛为 20/18/16/14;整套字重抬一档(正文/代码 400→500、strong 600→700);正文纯黑墨色(暗色主题 82% 亮度白,防刺眼)+ 灰阶抗锯齿;表格撑满宽度 + 圆角外框 + 表头灰底带 + 行分隔线;代码块改为白底描边卡片 + hairline 头部 + 语言图标 + 图标式复制按钮
  - **分语言彩色图标**:`src/client/code-lang.ts` 用 MutationObserver 把 banner 语言文本镜像为 `data-z-lang` 属性,CSS 按属性挂 simple-icons 品牌图标(py→python、sh→bash、c++→cplusplus 等别名归一);选择器全部用属性子串匹配(`[class*="_markdown_"]` 等),不依赖构建哈希
- **Mermaid 图渲染**(自 v1.2.0 起融合内建,原独立插件 `dsh-mermaid-renderer` 已废弃;v1.3.0 起改为**浏览器本地渲染**):会话内 ```` ```mermaid ```` 代码块在流式输出中 fence 一闭合即原位替换为可交互 SVG 卡片(适配/缩放/平移、源码查看、复制、重试),跟随 GUI 主题(深色自动切 mermaid dark theme 并按调色板重着色);mermaid.js 内联进 client bundle,**零网络依赖**
- **思考块底部收起**(自 v1.4.0 起):展开的 Think 折叠行内容无界增长,流式思考时头部收起控件被顶出视口;本插件在「展开的、够高的」思考块正文底部注入一条安静的「收起」小字行(**整行可点**,三级墨色,hover 深一档并垫产品同款悬停底色,无动画)——点击等效于点头部行(转发原生 click 给产品的 `[data-disclosure-row]`,不接管展开状态),随后把块头滚回视口保住阅读位置。显示阈值由 `thinkCollapse.minBodyHeight`(默认 320px)控制,`thinkCollapse.enabled: false` 可整体关闭
- **轮次过程折叠(zcode 式,自 v1.4.0 起)**:轮次定稿(出现 turn-tail)且无错后,把「最终响应」之外的中间过程——思考行、工具卡片、重试行、上下文提醒——折叠成一条安静的「过程细节 N 项」小字行(整行可点、Enter/Space 可达、按轮次 id 记忆展开状态);展开的过程区够高(默认 480px,`processCollapse.bottomToggleMinHeight` 可调)时,底部再出现一条同款「收起过程」行,读完不必滚回顶部,点击后折叠行自动滚回视口。最终响应 = 组内最后一个非空 assistant-step(其内部思考行也折叠,正文/图片/mermaid 卡片保留)。简单问答轮无过程可折,不出现折叠行;流式中的轮次绝不折叠;出错的轮次保留过程便于排查。`processCollapse.enabled: false` 可整体关闭
- **会话头部单行化 + tabs 居中**(自 v1.4.0 起,`src/client/header.css`,纯 CSS):「对话/轨迹」tabs 脱离文档流、绝对定位于 header 水平中线(header 与内容列同宽同中线,侧栏 panel 开合时同步),标题/模式 chip 居左、动作组居右,header 从 ~76px 收成 ~44px;tab 激活蓝条与 header 分隔线精确贴合(经典顶部导航样式)。只覆盖垂直 padding,左右 padding 留给产品与其他插件(dsh-better-sidebar 在侧栏收起时把 header 右 padding 抬到 78px 为其 fixed 图标组腾位,互不干扰)。`:has(> [role=tablist])` 门禁——仅双 tab 时生效,单 tab 与无头部场景保持产品原样;零 DOM 移动,React 结构不受影响

> 前身是 `dsh-user-turn-rail`,自本版本起更名为 `dsh-session-ui-enhance`;功能不变,包名、组合行 id(`session-ui-enhance`)、client 条目 id 全部换新,旧名包装与新包互不相同,迁移时先 `dsh plugin remove dsh-user-turn-rail` 再按下文安装。

- 运行面:host 半边只持有 mermaid 客户端配置下发一条 route(依赖 `webServer` service,effect 注册、随 fiber 卸载);其余能力(导轨、排版、代码块卡片、mermaid 交互卡片)全部是 browser UI
- 槽位:导轨注册进 `conversation.session.header.utilities`(由 `@deepseek-ai/dsh-client-ui-conversation` 声明并持有渲染权,本插件只贡献条目,不认领);mermaid 渲染不占用槽位——全局 MutationObserver 直接对代码块做原位 DOM 替换
- 状态:全部取自框架会话套件(`useSession` / `sessionId`),不读写磁盘、不引入持久化

## 配置(可选)

可调参数全部由 Config schema 提供默认值;在 profile 的 `cordis.patch.yml` 中按行 id 覆盖整段 config 即可(patch 对目标行 config 是**整段替换**,不是深合并):

```yaml
- id: session-ui-enhance
  config:
    fitMaxHeight: 480                # 适配模式最大展示高度(px)
    themeAuto: true                  # 深色 GUI 下自动切 mermaid dark theme
    thinkCollapse:
      enabled: true                  # 展开的高思考块底部提供「收起」
      minBodyHeight: 320             # 正文高度达到该值(px)才显示
    processCollapse:
      enabled: true                  # 轮次定稿后折叠中间过程(zcode 式)
      bottomToggleMinHeight: 480     # 展开过程区达到该高度(px)底部出现「收起过程」
```

完整字段见 `src/config.ts`(mermaid 渲染超时护栏、缩放区间、深色调色板、思考块底部收起等,均带默认值)。

## 安装(推荐:tarball)

本包是标准 dsh 组合包(声明 `dsh.bundle.patch` 与 `dsh.client`),`dsh plugin add` 会自动写入 profile 依赖并追加 bundle 层,无需手动 patch。从 GitHub Release 下载的 tarball 安装(预构建产物,**无需构建授权**):

```sh
dsh plugin --profile <name> add https://github.com/Songmengdi/dp_harness_enhance/releases/download/dsh-session-ui-enhance-v1.3.0/dsh-session-ui-enhance-1.3.0.tgz
```

本地 tarball 同理:

```sh
dsh plugin --profile <name> add ./dsh-session-ui-enhance-1.3.0.tgz
```

> pnpm 9.x 用户:该版本对 dsh 生成的 workspace 布局会报 `ERR_PNPM_ADDING_TO_ROOT`,在 `add` 后追加 `-w` 即可(或在该 profile 目录写入 `.npmrc`:`ignore-workspace-root-check=true`);pnpm ≥10 直接执行上面的命令。

验证(应看到 `# == dsh-session-ui-enhance` 层与 `session-ui-enhance` 行):

```sh
dsh --profile <name> --dump-config
dsh --profile <name>
```

## 安装(备选:GitHub 源码,pin tag + 构建授权)

git 安装拉取的是源码,本包自带自包含的 `prepare` 构建(tsc + tsdown,不需要 monorepo 环境);pnpm ≥10 需要显式允许构建。**务必锁定 tag 或 commit**,防止后续推送改变实际运行内容(担心 tag 被移动时,可用 tag 对应的 commit SHA 替换 `#dsh-session-ui-enhance-v1.3.0`):

```sh
dsh plugin --profile <name> add 'github:Songmengdi/dp_harness_enhance#dsh-session-ui-enhance-v1.3.0&path:dsh-session-ui-enhance'
```

首次 `add` 会因构建未授权失败,按提示把 pnpm 打印的包键写入该 profile 的 `pnpm-workspace.yaml`(pnpm 10 用 `onlyBuiltDependencies`,旧版用 `allowBuilds`,两种都写最稳妥):

```yaml
allowBuilds:
  dsh-session-ui-enhance: true
onlyBuiltDependencies:
  - dsh-session-ui-enhance
```

然后重新执行 `add`。请如实看待这项授权:它允许本包代码在安装时于你的机器上执行,只对可信源码授权。

## 开发

```sh
pnpm install        # 安装 devDeps 并触发 prepare 构建
pnpm typecheck      # host / client 两个 tsc program
pnpm build          # tsc 产物 → tsdown(ESM node 半边 + 浏览器 client bundle)
pnpm test           # node --test(shared 纯函数、http 代理行为、配置契约防漂移)
pnpm verify         # typecheck + build + test 一把过
pnpm pack           # 打包发布 tarball
```

- 构建产物:`lib/index.js`(host 半边)、`lib/client.js`(+ sourcemap,标准 `window.__ModuleLoader__.load` client bundle)、`lib/types/**/*.d.ts`(类型)
- client bundle 只把平台模块表(`react`、`react/jsx-runtime` 等)留作 external,其余一律内联;跨包协作一律走 Cordis service,值 import 会触发纯度门禁
- CSS Modules 由 lightningcss 编译进 bundle,`<style data-plugin="dsh-session-ui-enhance">` 标签由 loader 在卸载时移除
