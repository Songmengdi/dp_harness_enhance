# vision-bridge 维护说明（Route C 本地交付）

> 本文件与源码同在项目内：`vision-bridge/`。架构说明见 `docs/architecture.md`。

## 文件清单

- Host 插件源码（TypeScript）：`src/` → 构建产物 `lib/`（`npm run build`；`lib/` 不入库）。
- Python runtime：`runtime/dsh_vision/`（独立 venv 内运行；`runtime/requirements.lock` 锁定依赖）。
- 打包 skill：`skills/vision-bridge/SKILL.md`（明眼人协议唯一来源，按 Agent 注册）。
- 测试/验证：
  - `npm run verify`（门禁 → typecheck → build → Python 语法检查 → 全量测试 → 打包 dry-run）
  - `npm run e2e`（真实 dsh host headless e2e，profile `vision-bridge-e2e`）
  - `node scripts/clean-home-e2e.mjs`（干净 DSH_HOME 全生命周期）
  - `node scripts/render-verify.mjs`（闭合示例，无 key）

## 运行时布局

- managed venv：`$DSH_HOME/storages/dsh-vision-bridge/venv`（或配置 `venvDir`）。
- 产物：`<工作区>/artifacts/vision-bridge/`；粘贴截图：`<工作区>/inputs/vision-bridge/`。
- 配置热更新（settings 段 `dsh-vision-bridge`）：先验证、staging 准备候选、原子切换 generation；
  失败保留旧运行时。

## 出厂补丁（粘贴通道，dsh 升级后会被覆盖，需重打）

dsh 宿主 `dsh-host-apiproxy` 在 `prompt` 与 `selectModel` 两个端点对不支持图片的模型
拒绝带图消息，Route C 的粘贴桥会被挡在插件之外。补丁让「装配行含 dsh-vision-bridge」
的 profile 放行图片（图片由插件 `agent/pre-step` 落地为路径，模型只看到路径文本）。

**目标文件：每个会启动该 profile 的进程所解析到的那份 `dsh-host-apiproxy` 都要打。**
实际存在多份副本——dsh 安装目录一份 + 每个 profile 的 pnpm store 一份。用 find 找全：

```bash
find /opt/homebrew/lib/node_modules/@deepseek-ai/dsh \
     ~/.dsh/profiles -path "*dsh-host-apiproxy/lib/index.js" 2>/dev/null
```

本机现状（已打）：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`
以及 `~/.dsh/profiles/web/node_modules/.pnpm/@deepseek-ai+dsh-host-apiproxy@*/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（两份）。
**教训：web 进程加载的是 profile 自己的 pnpm store 副本，不是 dsh 安装目录那份——只打一处会漏。**

三处修改（对每一份文件，可对照 grep `imageBridgeActive` 找回）：

1. 新增函数（放在 `selectionFor` 之前）：

```js
// vision-bridge 出厂补丁（Route C）：dsh-vision-bridge 装配行存在且未禁用时，
// 图片消息放行给插件（agent/pre-step 会把图片落地为路径，纯文本模型照常工作）。
function imageBridgeActive(ctx) {
	try {
		const loader = ctx.loader?.entries ? ctx.loader : ctx.get('loader');
		for (const entry of loader.entries()) {
			const id = String(entry.id);
			// 条目 id 会带根 include 前缀（形如 include:dsh-vision-bridge），两端都要匹配
			if ((id === 'dsh-vision-bridge' || id.endsWith(':dsh-vision-bridge')) && entry.disabled !== true) return true;
		}
	} catch (e) {
	}
	return false;
}
```

2. `prompt` 端点（`hasImage` 门槛）：条件尾部加 `&& imageBridgeActive(ctx) === false`
   才拒绝（否则 reason 为 `MODEL_DOES_NOT_SUPPORT_IMAGES`，插件永远收不到图片）。
3. `selectModel` 端点：会话已含图片、切到不支持图片的模型时同样放行 vision-bridge profile。

重打后 `node --check <该文件>` 验证语法。改动在 dsh 进程启动时加载：`dsh-web restart`。

## 卸载

`dsh plugin --profile web remove dsh-vision-bridge`。
插件卸载顺序：取消活动视觉操作并等待 → 逐 Agent 回收工具与 skill → 关运行时管理器；
卸载后装配清单与工具目录无残留。
