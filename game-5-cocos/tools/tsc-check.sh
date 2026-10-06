#!/usr/bin/env bash
# ============================================================
#  tsc-check.sh · 用 Cocos 自带的 TypeScript 做类型检查
# ============================================================
#  为什么不用 `npx tsc`：
#    · 本机不保证有全局 typescript，且不应为了检查去装一份到用户环境；
#    · Cocos Creator 安装目录里**自带**一份与引擎 .d.ts 匹配的 tsc，
#      用它检查才和编辑器里的报错一致（版本不同会给出不一致的结论）。
#
#  为什么不用 `tsconfig.json`：见 `tsconfig.check.json` 顶部注释（lib / skipLibCheck）。
#
#  用法：
#      bash tools/tsc-check.sh          # 只报 assets/scripts 的错误
#      bash tools/tsc-check.sh --all    # 连引擎 d.ts 一起报（排查环境问题时才要）
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(dirname "$HERE")"

CREATOR="${CREATOR:-/Applications/Cocos/Creator/3.8.8}"
TSC="$CREATOR/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc"
NODE="${NODE:-$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin/node}"

if [ ! -f "$TSC" ]; then
    echo "[✗] 找不到 Cocos 自带的 tsc：$TSC"
    echo "    用 CREATOR=/path/to/Cocos/Creator/<版本> 指定，或改用 npx tsc。"
    exit 2
fi
if [ ! -x "$NODE" ]; then
    NODE="$(command -v node || true)"
fi
if [ -z "${NODE:-}" ]; then
    echo "[✗] 找不到 node"
    exit 2
fi

# temp/tsconfig.cocos.json 是引擎生成的；缺了就说明工程没被编辑器打开过
if [ ! -f "$PROJ/temp/tsconfig.cocos.json" ]; then
    echo "[✗] 缺少 temp/tsconfig.cocos.json —— 需先用 Cocos Creator 打开过一次该工程"
    exit 2
fi

cd "$PROJ" || exit 2

OUT="$("$NODE" "$TSC" -p tsconfig.check.json --noEmit 2>&1)"
RC=$?

if [ "${1:-}" = "--all" ]; then
    printf '%s\n' "$OUT"
fi

if [ $RC -eq 0 ]; then
    echo "[✓] 类型检查通过（0 错误）"
    exit 0
fi

# 只保留自己代码里的错误；引擎 d.ts 的噪声交给 --all
MINE="$(printf '%s\n' "$OUT" | grep -E '^assets/scripts/' || true)"
COUNT="$(printf '%s\n' "$MINE" | grep -c . || true)"

if [ "$COUNT" -eq 0 ]; then
    echo "[✓] assets/scripts 下无错误（引擎声明文件另有报错，用 --all 查看）"
    exit 0
fi

echo "[✗] assets/scripts 下有 $COUNT 条错误："
printf '%s\n' "$MINE"
exit 1
