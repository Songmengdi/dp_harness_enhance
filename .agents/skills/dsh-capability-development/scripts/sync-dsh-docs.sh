#!/usr/bin/env bash
# 同步官方 deepseek-harness 插件开发文档(中文版)到 references/deepseek-harness/
# 用法: bash .agents/skills/dsh-capability-development/scripts/sync-dsh-docs.sh (任意目录执行均可,脚本自行定位)
# 升级快照版本: 修改下方 PIN 为新的上游 commit
set -euo pipefail

PIN=47f943859bef60e4160492346772ded9b24f765a
BASE=https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/$PIN/docs

cd "$(dirname "$0")/.."
DEST=references/deepseek-harness

# 纳入的文档清单(相对上游 docs/)。默认拉取 .zh.md 中文版并落为 <name>.md
FILES=(
  architecture capability-seams cordis-primer
  cookbook/adding-a-conversation-node cookbook/adding-a-package cookbook/adding-a-tool
  cookbook/adding-an-llm-adapter cookbook/extension-cookbook
  cordis-api/context cordis-api/events cordis-api/fiber cordis-api/registry cordis-api/service
  cordis-tutorial/index cordis-tutorial/01-first-plugin cordis-tutorial/02-lifecycle-and-effects
  cordis-tutorial/03-services cordis-tutorial/04-events cordis-tutorial/05-config
  cordis-tutorial/06-composition-and-hmr cordis-tutorial/07-into-the-harness
  subsystems/approval subsystems/client-modules subsystems/core subsystems/skills subsystems/tools subsystems/web
  user/develop/basic/config user/develop/basic/index user/develop/basic/publish user/develop/basic/tool
  user/develop/framework/events user/develop/framework/index user/develop/framework/service
  user/develop/practice/index user/develop/practice/llm-adapter
)
# 上游未提供中文版的文件(拉取英文版并落为 <name>.md)
EN_ONLY=(
  cordis-api/inherited
)

mkdir -p "$DEST"/{cookbook,cordis-api,cordis-tutorial,subsystems,user/develop/{basic,framework,practice}}

# 并行拉取
for f in "${FILES[@]}"; do
  curl -fsSL --max-time 60 "$BASE/$f.zh.md" -o "$DEST/$f.md" &
done
for f in "${EN_ONLY[@]}"; do
  curl -fsSL --max-time 60 "$BASE/$f.md" -o "$DEST/$f.md" &
done
wait

# 失败检查(任一文件为空即中止)
empty=$(find "$DEST" -name '*.md' -size 0 | wc -l | tr -d ' ')
if [ "$empty" != "0" ]; then
  echo "同步失败:$empty 个文件为空,请检查网络或 PIN 是否有效" >&2
  exit 1
fi

# 链接改写:上游中文页内部互链用 .zh.md 后缀 → 改回 .md;去掉语言切换行
find "$DEST" -name '*.md' -exec sed -i '' \
  -e 's/\.zh\.md/.md/g' \
  -e 's/^\[English\]([^)]*) | //' \
  -e '/^中文$/d' \
  {} +
# 指向上游仓库根 README 的链接在本地会误解析到 docs/README.md,改写为上游绝对 URL
find "$DEST" -name '*.md' -exec sed -i '' \
  -e "s#\](../../../../README\.md#](https://github.com/deepseek-ai/deepseek-harness/blob/$PIN/README.md#g" \
  {} +

echo "同步完成:$(find "$DEST" -name '*.md' | wc -l | tr -d ' ') 篇 → $DEST (commit $PIN)"
