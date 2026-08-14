# 仓库介绍
**dsh plugin 多项目仓库,仓库间彼此独立**
- vision-bridge 视觉桥接(为无视觉Agent设计)
- dsh-session-ui-enhance dsh 会话优化plugin(导轨/排版/代码块卡片;自 v1.2.0 起融合 mermaid 图表渲染、v1.3.0 起改为浏览器本地 mermaid.js 渲染——会话内 ```mermaid 代码块 fence 闭合即原位替换为可交互 SVG 卡片,零网络依赖;原 dsh-mermaid-renderer 独立插件已废弃移除)
- dsh-fs-observation-persistence fs 观测状态持久化plugin(host-only;把每会话的 fs/observed 记录落盘,恢复会话后文件未变即可直接 write/edit 免重读,变过仍被版本 CAS 以 FS_STALE_VERSION 强制重读;intent 决策器 prepend 注册、仅在持久化命中时决策,其余 next() 委托官方 fs-observation-policy,卸载即无缝回到官方行为;v0.2.0 起 fork 会话无自己记录时一跳继承父会话记录,v0.2.1 修正 subagent 判据——凭 origin==='subagent' 或 delegationDepth>0,GUI fork 持久化的 delegationDepth:0 不再被误判;fork 观测到缺失时同步清父记录条目,避免继承死版本导致 write 死循环;可用 inheritForkObservations:false 关闭)
