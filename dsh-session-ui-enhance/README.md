# dsh-session-ui-enhance

dsh Web GUI 会话优化插件:在对话列左缘垂直居中渲染一条**用户轮次定位导轨**——每个用户轮次一根横条,悬停时按距离渐变条长、弹出卡片预览该轮输入,点击(或键盘 Enter/Space)定位并高亮对应消息;同时贡献**分档内容宽度断点**与呼吸留白(`--dsh-chat-content-width` / `--dsh-composer-side-clearance`)。

> 前身是 `dsh-user-turn-rail`,自本版本起更名为 `dsh-session-ui-enhance`;功能不变,包名、组合行 id(`session-ui-enhance`)、client 条目 id 全部换新,旧名包装与新包互不相同,迁移时先 `dsh plugin remove dsh-user-turn-rail` 再按下文安装。

- 运行面:纯 client(browser UI),host 半边为有意为之的 no-op——行存在的意义是让 host Loader 挂载组合、让 client-modules 经 `dsh.client` 声明发现 `./client` bundle
- 槽位:注册进 `conversation.session.header.utilities`(由 `@deepseek-ai/dsh-client-ui-conversation` 声明并持有渲染权,本插件只贡献条目,不认领)
- 状态:全部取自框架会话套件(`useSession` / `sessionId`),不读写磁盘、不引入持久化

## 安装(推荐:tarball)

本包是标准 dsh 组合包(声明 `dsh.bundle.patch` 与 `dsh.client`),`dsh plugin add` 会自动写入 profile 依赖并追加 bundle 层,无需手动 patch。从 GitHub Release 下载的 tarball 安装(预构建产物,**无需构建授权**):

```sh
dsh plugin --profile <name> add https://github.com/Songmengdi/dp_harness_enhance/releases/download/dsh-session-ui-enhance-v1.0.0/dsh-session-ui-enhance-1.0.0.tgz
```

本地 tarball 同理:

```sh
dsh plugin --profile <name> add ./dsh-session-ui-enhance-1.0.0.tgz
```

> pnpm 9.x 用户:该版本对 dsh 生成的 workspace 布局会报 `ERR_PNPM_ADDING_TO_ROOT`,在 `add` 后追加 `-w` 即可(或在该 profile 目录写入 `.npmrc`:`ignore-workspace-root-check=true`);pnpm ≥10 直接执行上面的命令。

验证(应看到 `# == dsh-session-ui-enhance` 层与 `session-ui-enhance` 行):

```sh
dsh --profile <name> --dump-config
dsh --profile <name>
```

## 安装(备选:GitHub 源码,pin tag + 构建授权)

git 安装拉取的是源码,本包自带自包含的 `prepare` 构建(tsc + tsdown,不需要 monorepo 环境);pnpm ≥10 需要显式允许构建。**务必锁定 tag 或 commit**,防止后续推送改变实际运行内容(担心 tag 被移动时,可用 tag 对应的 commit SHA 替换 `#dsh-session-ui-enhance-v1.0.0`):

```sh
dsh plugin --profile <name> add 'github:Songmengdi/dp_harness_enhance#dsh-session-ui-enhance-v1.0.0&path:dsh-session-ui-enhance'
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
pnpm pack           # 打包发布 tarball
```

- 构建产物:`lib/index.js`(host 半边)、`lib/client.js`(+ sourcemap,标准 `window.__ModuleLoader__.load` client bundle)、`lib/types/**/*.d.ts`(类型)
- client bundle 只把平台模块表(`react`、`react/jsx-runtime` 等)留作 external,其余一律内联;跨包协作一律走 Cordis service,值 import 会触发纯度门禁
- CSS Modules 由 lightningcss 编译进 bundle,`<style data-plugin="dsh-session-ui-enhance">` 标签由 loader 在卸载时移除
