#!/bin/bash
# ============================================================================
# 微信小游戏真机试玩码 · 「绕开代理」安全出码
# ----------------------------------------------------------------------------
# 【为什么需要它】（2026-10-06 第 36 轮 · 用户现象：扫码报「运行环境加载失败」）
#
# `cli preview` 的真实链路是「本地编译 → 把代码包**上传到微信服务器** → 服务端出码」，
# 上传走的是 **servicewechat.com**。而常见的代理规则集（Clash/Surge/Quantumult…）
# 通常只给 `qq.com` / `tencent.com` 配了 DIRECT 直连，**唯独漏了 servicewechat.com**
# ⇒ 该域名落到兜底的 MATCH 规则，被送去境外节点 ⇒ 连微信国内服务器时连接被重置。
#
# 本机实测对照（servicewechat.com，各 15 次）：
#     直连        15 / 15 成功   （0%  失败）
#     走代理      7  / 15 成功   （53% 失败）   ← ECONNRESET
#
# 上传失败时微信开发者工具**仍然打印 `✔ preview` 并给出二维码**，
# 但服务器上没有可用的包 ⇒ 用户扫码 = 「运行环境加载失败」。
#
# 【本脚本做什么】
#   ① 备份当前系统代理状态
#   ② 临时关闭 HTTP / HTTPS 代理
#   ③ 跑正常的 wechat-preview.sh（它会自动校验上传是否成功）
#   ④ **无论成败**（含 Ctrl-C / 报错 / 退出）都用 trap 把代理恢复原样
#
# 【用法】
#   bash tools/wechat-preview-safe.sh <工程目录> [debug|release] [归档目录]
#   bash tools/wechat-preview-safe.sh            # 用与 wechat-preview.sh 相同的默认值
#   NET_SERVICE="USB 10/100/1000 LAN" bash tools/wechat-preview-safe.sh   # 有线网络
#
# 【更优的长期做法（不折腾系统代理）】
#   在代理软件里给这些域名加 DIRECT 直连，一劳永逸：
#       DOMAIN-SUFFIX,servicewechat.com,DIRECT
#       DOMAIN-SUFFIX,weixin.qq.com,DIRECT      # 注意：weixin.qq.com 的 suffix 是 qq.com，
#       DOMAIN-SUFFIX,wechat.com,DIRECT         # 多数规则集已覆盖，但显式写更保险
#       DOMAIN-SUFFIX,qpic.cn,DIRECT
#   或在微信开发者工具 → 设置 → 代理设置 → 选「不使用任何代理」。
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="${NET_SERVICE:-Wi-Fi}"

echo "============================================================"
echo " 微信小游戏出码 · 绕开系统代理"
echo "   网络服务：$SERVICE"
echo "============================================================"

# ---------------------------------------------------------------- ⓪ 前置检查
if ! networksetup -listallnetworkservices 2>/dev/null | grep -qx "$SERVICE"; then
  echo "❌ 找不到网络服务「$SERVICE」。可用服务如下："
  networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | sed 's/^/     /'
  echo "   → 用 NET_SERVICE=\"<服务名>\" 重新执行本脚本"
  exit 1
fi

# ---------------------------------------------------------------- ① 备份原状态
http_state=$(networksetup -getwebproxy        "$SERVICE" 2>/dev/null | awk -F': ' '/^Enabled:/{print $2}')
https_state=$(networksetup -getsecurewebproxy "$SERVICE" 2>/dev/null | awk -F': ' '/^Enabled:/{print $2}')
http_state="${http_state:-No}"
https_state="${https_state:-No}"
echo "==> 当前代理状态：HTTP=$http_state  HTTPS=$https_state"

# ---------------------------------------------------------------- ② 恢复函数 + trap
# ★ 关键：任何退出路径都要恢复，否则会把用户的网络留在「无代理」状态。
PROXY_BACKEND="${PROXY_BACKEND:-}"
CLASH_MODE_BEFORE="${CLASH_MODE_BEFORE:-rule}"
RESTORED=0

# 找内核 RESTful API 端口（ClashX 默认 0.0.0.0:9090、secret 为空）
find_controller_port() {
  for p in 9090 9091 9097 9098; do
    if curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:${p}/configs" >/dev/null 2>&1; then
      echo "$p"; return 0
    fi
  done
  echo ""
}

restore_proxy() {
  [ "$RESTORED" = "1" ] && return 0
  RESTORED=1
  echo ""
  case "$PROXY_BACKEND" in
    kernel:*)
      # ★ 路径 B：只把内核运行模式切回去 —— 没动过 yaml、没重启过内核
      cp_="${PROXY_BACKEND#kernel:}"
      curl -s --noproxy '*' -X PATCH -d "{\"mode\":\"${CLASH_MODE_BEFORE}\"}" \
        "http://127.0.0.1:${cp_}/configs" >/dev/null 2>&1
      now="$(curl -s --noproxy '*' --max-time 3 "http://127.0.0.1:${cp_}/configs" \
             | python3 -c 'import sys,json;print(json.load(sys.stdin).get("mode","?"))' 2>/dev/null)"
      echo "==> 内核模式已切回 ${CLASH_MODE_BEFORE}（当前 ${now:-?}）"
      ;;
    system)
      echo "==> 恢复系统代理（HTTP=$http_state / HTTPS=$https_state）"
      if [ "$http_state" = "Yes" ]; then
        networksetup -setwebproxystate "$SERVICE" on        >/dev/null 2>&1
      else
        networksetup -setwebproxystate "$SERVICE" off       >/dev/null 2>&1
      fi
      if [ "$https_state" = "Yes" ]; then
        networksetup -setsecurewebproxystate "$SERVICE" on  >/dev/null 2>&1
      else
        networksetup -setsecurewebproxystate "$SERVICE" off >/dev/null 2>&1
      fi
      echo "    ✅ 已恢复：HTTP=$(networksetup -getwebproxy "$SERVICE" 2>/dev/null | awk -F': ' '/^Enabled:/{print $2}')" \
           "HTTPS=$(networksetup -getsecurewebproxy "$SERVICE" 2>/dev/null | awk -F': ' '/^Enabled:/{print $2}')"
      ;;
    *)
      echo "==> 未改动过代理（无需恢复）"
      ;;
  esac
}
trap restore_proxy EXIT INT TERM

# ---------------------------------------------------------------- ③ 绕开代理（两条路径）
#
# ★ 2026-10-07 第 48 轮补：本机 `networksetup` **没有管理员权限**，
#   路径 A 会直接报 `** Error: Command requires admin privileges.` 然后整脚本退出。
#   ⇒ 加一条**降级路径 B**：把代理内核的运行模式临时切成 `direct`。
#     只改**运行态** —— 不动 yaml、不重启内核、不碰系统代理，风险最低，
#     出码完立刻切回（见上面的 `restore_proxy`）。
#     实测：rule 模式 5/5 次预览失败（`read ECONNRESET`），切 direct 后成功。
#   ⚠️ 路径 B 期间是**全局直连**（所有流量），所以只在这几分钟内有效。
echo "==> 临时绕开代理"
PROXY_BACKEND=""
if networksetup -setwebproxystate "$SERVICE" off 2>/dev/null; then
  networksetup -setsecurewebproxystate "$SERVICE" off 2>/dev/null
  PROXY_BACKEND="system"
  echo "    路径 A：已关闭系统代理"
else
  echo "    路径 A 不可用（networksetup 需要管理员权限）→ 降级到路径 B"
  CTRL_PORT="$(find_controller_port)"
  if [ -n "$CTRL_PORT" ]; then
    CLASH_MODE_BEFORE="$(curl -s --noproxy '*' "http://127.0.0.1:${CTRL_PORT}/configs" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("mode","rule"))' 2>/dev/null)"
    CLASH_MODE_BEFORE="${CLASH_MODE_BEFORE:-rule}"
    if curl -s --noproxy '*' -X PATCH -d '{"mode":"direct"}' \
        "http://127.0.0.1:${CTRL_PORT}/configs" >/dev/null 2>&1; then
      PROXY_BACKEND="kernel:${CTRL_PORT}"
      echo "    路径 B：内核模式 ${CLASH_MODE_BEFORE} → direct（出码后自动切回）"
    fi
  fi
fi

if [ -z "$PROXY_BACKEND" ]; then
  echo "❌ 两条路径都不可用。"
  echo "   → 请改用「微信开发者工具 → 设置 → 代理设置 → 不使用任何代理」，"
  echo "     或在代理软件里给 servicewechat.com 加 DIRECT 规则后再跑 wechat-preview.sh。"
  exit 1
fi
sleep 1

# ---------------------------------------------------------------- ④ 连通性自检
echo "==> 直连连通性自检（servicewechat.com × 5）"
ok=0
for i in 1 2 3 4 5; do
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 8 https://servicewechat.com/ 2>/dev/null)
  [ "$code" = "404" ] || [ "$code" = "200" ] && ok=$((ok + 1))
done
echo "    成功 $ok / 5"
if [ "$ok" -lt 5 ]; then
  echo "    ⚠️  直连也不稳定 —— 大概率是运营商链路问题（换网络 / 换热点再试）。"
fi

# ---------------------------------------------------------------- ⑤ 出码
echo "==> 开始出码（wechat-preview.sh）"
bash "$SCRIPT_DIR/wechat-preview.sh" "$@"
RC=$?

trap - EXIT INT TERM   # 交给手动恢复，避免重复输出
restore_proxy

echo ""
if [ "$RC" = "0" ]; then
  echo "============================================================"
  echo "✅ 出码完成且**上传通道正常**，这张码可以扫。"
  echo "============================================================"
else
  echo "============================================================"
  echo "❌ 出码未通过（退出码 $RC）。若是 3 = 上传失败，见上方指引。"
  echo "============================================================"
fi
exit "$RC"
