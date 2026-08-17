# dsh-fs-observation-persistence

**fs 观测状态持久化插件**(host-only):把每个会话的 `fs/observed` 观测记录落盘,让**恢复(resume)后的会话**在文件未变动的前提下直接 write/edit,不再强制先读一遍;文件变过则照旧被版本 CAS 拒绝(`FS_STALE_VERSION`),强制重读。

它补上的是官方 [`@deepseek-ai/dsh-fs-observation-policy`](https://www.npmjs.com/package/@deepseek-ai/dsh-fs-observation-policy) README「已知限制」第 1 条明确延期的事情:*已观察状态无法在会话恢复后保留,恢复的会话必须重新读取文件*。

## 语义

```
会话内读/改过文件 ──记录──▶ ~/.dsh/storages/dsh-fs-observation-persistence/<session-id>.json
                                        │
进程重启 + 会话恢复(同一 session id)  │
                                        ▼
                    write/edit intent ── 命中持久化记录 ──▶ 返回记录的版本作为 CAS 基准
                                                              │
                                              ┌── 文件未变:提供方放行(免读直接改)
                                              └── 文件变过:FS_STALE_VERSION → 强制重读
```

三条硬规则:

1. **持久化记录不作为新鲜度凭据**。插件返回的版本只是 CAS 基准,真正的判定在 `@deepseek-ai/dsh-fs-local` 的原子比较里:文件被外部修改、替换(inode 变化)、删除,都会以 `FS_STALE_VERSION` 拒绝,模型被指引重读。持久化只扩大「哪些编辑可以被尝试」,从不扩大「哪些编辑可以落地」。
2. **同进程行为与官方策略逐位一致**。intent 决策器以 `prepend` 注册,但只在「持久化记录命中」时决策;其余一切(无 owner、无记录、本进程已有更新状态)都 `next()` 交回官方监听器。卸载本插件后官方策略无缝接管——它的内存状态在插件运行期间一直被同步喂着,连同会话的观测都不丢。
3. **缺失观测使记录失效**。`fs/observed` 的 absent 事件会删除对应条目,避免「记录说存在、磁盘已删除」的死循环:下次 write intent 落回官方逻辑得 `createIfAbsent`,edit 得 `FS_NOT_OBSERVED`,均正常终止。
4. **fork 继承(一跳),子代理绝不继承**。fork 出的会话(新 id、header 带 `parentSession`、无 `origin: 'subagent'`)在**无自己的记录**时可查父会话的持久化记录——fork 的对话历史本就包含父会话的读文件结果,模型"认为"自己读过;CAS 防护照旧,文件变过仍强制重读。subagent 虽也设 `parentSession`,但凭 `origin === 'subagent'` 或 `delegationDepth > 0` 被显式排除(父会话读过不授权子代理;注意 GUI fork 会持久化 `delegationDepth: 0`,`delegationDepth` 单独存在不能作判据)。fork 自己的观测永远优先于继承;fork 观测到文件缺失时,同步从父记录中清掉该条目(缺失是文件系统事实,死版本对谁都是 CAS 死码),避免「继承死版本 → write 永远 FS_STALE_VERSION」的循环。可用 `inheritForkObservations: false` 关闭回到严格隔离。

## 安装

```sh
dsh plugin --profile web add dsh-fs-observation-persistence@latest
# 或本地 tarball:
dsh plugin --profile web add ./dsh-fs-observation-persistence-0.2.1.tgz
```

> 目标 profile 不是 `web` 时,把 `web` 换成你的 profile 名。

profile 的 `package.json` 会新增依赖,`dsh.profile.bundles` 自动收录本包(组合行由包内 `cordis.patch.yml` 提供,id 为 `fs-observation-persistence`)。重启 `dsh web` 生效(host 插件无热载)。

## 配置

按 id 覆盖(整段替换)于 profile 的 `cordis.patch.yml`:

```yaml
- id: fs-observation-persistence
  config:
    storageDir: ''            # 空 → $DSH_HOME/storages/dsh-fs-observation-persistence(回退 ~/.dsh)
    flushDelayMs: 250         # 观测后落盘的尾随去抖窗口
    maxAgeDays: 30            # 超过未动的会话记录文件在启动时修剪
    pruneOnStart: true
    maxEntriesPerSession: 2000  # 每会话记忆的目标数上限,最久未观测先淘汰
    maxSessionsInMemory: 64     # 内存中缓存的会话数上限(磁盘文件不受影响)
    inheritForkObservations: true  # fork 会话无自己记录时是否查父会话记录(子代理永不继承)
```

## 存储格式

每会话一个 JSON 文件(`<encodeURIComponent(sessionId)>.json`),内容 `{"v":1,"entries":{<targetKey>: <version>}}`;键序即近期使用序。写入走「临时文件 + rename」原子发布,flush 串行化;会话文件路径来自 realpath 稳定标识(`FsTargetKey`)。崩溃最多丢失最后去抖窗口内的观测——退化方向安全:退回强制重读。

版本串由提供方 stat 属性构成(`dev:ino:size:mtimeNs:ctimeNs`),跨重启稳定可比;上游若改格式,旧记录全部判为 stale → 重读,不会错误放行。

## 已知限制

- **子代理(subagent)各自独立**:记录按 session id 隔离,父会话读过不能授权子代理改(与官方语义一致;即使父会话记录存在也不继承)。
- **fork 继承只有一跳**:fork 的 fork 查不到祖父会话的记录(孙会话的 parent 指向子会话,而子会话记录只含它自己观测过的目标)。多级 fork 需重读一次,方向安全。
- **隐私足迹**:记录文件含被观测文件的绝对 realpath 与版本串(无内容)。会话 JSONL 本就包含完整工具结果,未新增实质暴露面;不需要时直接删目录即可。
- **并发进程**:同一会话被两个进程同时恢复属非常规操作,后写者胜;最坏情况一条过期版本 → `FS_STALE_VERSION` → 重读,方向安全。
- **依赖遮蔽**:本插件的 intent 决策器 `prepend` 抢在官方策略之前,官方若日内在策略层做出官方持久化,移除本插件行即回到官方实现。

## 开发

```sh
pnpm install
npm run verify   # typecheck + build + test(16 个用例:重启往返、外部改动拒绝、absent 失效、淘汰、修剪)
```

测试直接驱动真实组合(`dsh-fs-local` + 官方策略 + 本插件)的 `fs/*` waterfall;「重启」以同目录两个 cordis Context、同 session id 的全新会话对象模拟。
