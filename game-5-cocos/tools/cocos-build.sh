#!/bin/bash
# ============================================================================
# Cocos Creator 无头构建脚本（微信小游戏等）
# ----------------------------------------------------------------------------
# 封装了本机环境的 5 个坑，直接调 CocosCreator 一定会踩：
#   1) 环境继承了 ELECTRON_RUN_AS_NODE=1 / NODE_OPTIONS → Electron 壳被当纯 Node 跑，
#      报 `bad option: --project`  → env -u 清掉
#   2) Chromium 内嵌沙箱初始化失败 → exit 133 → 加 --no-sandbox --disable-gpu
#   3) 工程没有场景/没设启动场景 → `当前初始场景不存在...无法设置为初始场景`
#   4) 顶层 appid=xxx 与 JSON 字符串形式都被忽略 → 只能走 configPath
#   5) 【SIGTERM 假阳性坑】
#      日志里出现 `Error: Exit process with code:null, signal:SIGTERM in task
#      build-script` 是**常态噪音**（构建子进程回收）—— 它**同时**出现在
#      成功的构建里。别被它吓到、也别被"目录存在"骗过：唯一可靠的判据是
#      **产物根目录的入口文件在不在**（web 系 = application.js；微信 = game.js），
#      它是构建**最后一步**才落盘的。仅看目录是否存在会把"构建到一半就死"
#      误判成成功（脚本早期版本正是这么写的）。
#
# 用法：
#   bash cocos-build.sh [平台] [debug|release] <工程路径> [动作]
#     平台  默认 wechatgame
#     模式  默认 release
#     工程  绝对路径或相对路径
#     动作  默认 build（build | open | both）；open/both 仅 wechatgame 有效
#
# 若 <工程>/build-config/<平台>.json 存在，会自动读取并合并（AppID 写在里面）。
# ⚠️ 用 Bash 工具调用时需放开沙箱（前台运行），后台运行会丢权限。
# ============================================================================
set -uo pipefail

PLATFORM="${1:-wechatgame}"
MODE="${2:-release}"
PROJ_ARG="${3:-}"
ACTION="${4:-build}"

[ -n "$PROJ_ARG" ] || { echo "用法：bash cocos-build.sh [平台] [debug|release] <工程路径> [build|open|both]"; exit 1; }
[ -d "$PROJ_ARG" ] || { echo "❌ 找不到工程：$PROJ_ARG"; exit 1; }
PROJ="$(cd "$PROJ_ARG" && pwd)"

# 自动挑选本机已安装的最新 Creator
BIN=""
for d in $(ls -d /Applications/Cocos/Creator/*/ 2>/dev/null | sort -V -r); do
  cand="${d}CocosCreator.app/Contents/MacOS/CocosCreator"
  [ -x "$cand" ] && { BIN="$cand"; break; }
done
[ -n "$BIN" ] || { echo "❌ 没找到 Cocos Creator，请确认已安装到 /Applications/Cocos/Creator/"; exit 1; }

case "$MODE" in
  debug)   DEBUG_FLAG="true"  ;;
  release) DEBUG_FLAG="false" ;;
  *) echo "❌ 第二参数只能是 debug 或 release"; exit 1 ;;
esac

OUT="$PLATFORM"                                    # 固定输出目录名
LOG="/tmp/cocos-build-${OUT}-$(date +%H%M%S).log"

CFG_SRC="$PROJ/build-config/${PLATFORM}.json"
MERGED="/tmp/cocos-buildcfg-${PLATFORM}.json"
if [ -f "$CFG_SRC" ]; then
  python3 - "$CFG_SRC" "$MERGED" "$DEBUG_FLAG" "$OUT" <<'PY'
import json, sys
src, dst, dbg, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(src, encoding="utf-8"))
d.pop("_说明", None)
d["debug"] = (dbg == "true")
d["outputName"] = out
json.dump(d, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  echo "==> 构建配置：${CFG_SRC}（已合并 debug=${DEBUG_FLAG}）"
  grep -o '"appid"[^,]*' "$MERGED" | head -1 | sed 's/^/    /'
  BUILD_ARG="configPath=$MERGED"
else
  echo "==> 未找到 ${CFG_SRC}，使用内联参数（注意：AppID 无法这样传入）"
  BUILD_ARG="platform=${PLATFORM};debug=${DEBUG_FLAG};outputName=${OUT}"
fi

echo "==> Creator：$BIN"
echo "==> 工程：$PROJ"
echo "==> 平台：${PLATFORM}   模式：${MODE}   输出：build/${OUT}"
echo "==> 日志：$LOG"

env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
  "$BIN" --no-sandbox --disable-gpu \
  --project "$PROJ" \
  --build "$BUILD_ARG" > "$LOG" 2>&1
CODE=$?

grep -v -E "crash_report_database|gpu_process_host|network_service_instance|sandbox initialization|Failed to initialize sandbox|trackTimeEnd|^$" "$LOG" \
  | grep -E "Finished in|build task\(|error|Error|warn: Build" | tail -15

# ⚠️ 判据是**入口文件**，不是"目录存在"：
#    构建到一半就死时，build/<平台>/ 目录往往**已经建好了**（但里面是空的或残缺），
#    只看目录会把失败误判成成功。入口文件是构建最后一步才落盘的。
case "$PLATFORM" in
  wechatgame) ENTRY="$PROJ/build/$OUT/game.js" ;;
  web-*)      ENTRY="$PROJ/build/$OUT/application.js" ;;
  *)          ENTRY="$PROJ/build/$OUT/$OUT.json" ;;
esac
if [ ! -f "$ENTRY" ]; then
  echo "❌ 构建失败（退出码 ${CODE}）：缺少入口文件 $ENTRY"
  echo "   完整日志：$LOG"
  echo "   （注意：日志里的 'signal:SIGTERM in task build-script' 是常态噪音，"
  echo "     成功构建里也会出现，不要被它误导 —— 认入口文件。）"
  exit 1
fi

echo "✅ 构建成功：$PROJ/build/$OUT"
echo "   体积：$(du -sh "$PROJ/build/$OUT" | cut -f1)  （微信首包红线 4MB）"
du -sh "$PROJ/build/$OUT"/* 2>/dev/null | sort -rh | head -5

if [ "$PLATFORM" = "wechatgame" ] && [ -f "$PROJ/build/$OUT/project.config.json" ]; then
  echo -n "   产物 AppID："
  python3 -c "import json;print(json.load(open('$PROJ/build/$OUT/project.config.json')).get('appid'))" 2>/dev/null
fi

if [ "$ACTION" = "open" ] || [ "$ACTION" = "both" ]; then
  if [ "$PLATFORM" = "wechatgame" ]; then
    echo "==> 打开微信开发者工具…"
    bash "$(dirname "$0")/wechat-open.sh" "$PROJ/build/$OUT"
  else
    echo "⚠️  只有 wechatgame 平台能打开微信开发者工具，跳过"
  fi
fi
