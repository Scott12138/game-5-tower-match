#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 import-assets.py · 把定稿素材导入 Cocos 工程
============================================================
 源：`<workspace>/assets/`（设计稿目录，中文名，**不进主包**）
 目标：`game-5-cocos/assets/resources/`（运行时 resources.load 的根）

 为什么要有这一步（不是手动拖进去就行）：
  ① **牌面必须改成 ASCII 文件名**。`core/TileData.spritePath()` 返回
     `tiles/wan/wan3`，而素材叫 `三万.png`。中文资源名在 URL 编码 / 日志 /
     命令行 grep 三处都会引麻烦（本机 Bash 的 grep 对中文模式**静默返回空**，
     会让"验证资源是否入包"这件事变得不可信）。
  ② 素材目录里混着 .md / .html 设计稿，必须**只挑要用的**，
     否则整个设计稿会被打进小游戏主包。
  ③ 需要一份**可复现**的清单 —— 后续换素材只要重跑本脚本。

 用法：
     python3 tools/import-assets.py            # 只做同步，打印报告
     python3 tools/import-assets.py --verify   # 额外校验代码里引用的路径都存在
============================================================
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
WS = PROJ.parent                      # 工作区根
SRC = WS / "assets"                   # 设计稿素材根
DST = PROJ / "assets" / "resources"   # 工程资源根

# ------------------------------------------------------------
#  一、单文件映射（源 → 目标，均相对各自根目录）
# ------------------------------------------------------------
SINGLE: list[tuple[str, str]] = [
    # —— 启动页 ——
    ("splash/bg_felt.jpg",              "splash/felt.jpg"),
    ("splash/logo_b.png",               "splash/logo.png"),
    ("splash/mascot.png",               "splash/mascot.png"),
    ("splash/dice.png",                 "splash/dice.png"),
    ("splash/coin.png",                 "splash/coin.png"),
    ("splash/ui_progress_track@2x.png", "splash/bar_track.png"),
    ("splash/ui_progress_fill@2x.png",  "splash/bar_fill.png"),

    # —— 首页 ——
    ("home/settings.png",               "home/setting.png"),
    ("home/coin_icon.png",              "home/coin.png"),
    ("home/title_home.png",             "home/title.png"),
    # ⚠️ 主按钮九宫格三段**不在这里** —— 第 37 轮换成方案 B 之后，它由
    #    `docs-verify/game-5/home/make_btn_primary_assets.py` 直接从
    #    `round37/btn_v2.png`（**先整图缩 70%、再按实测切点 190/706 裁三段**）
    #    产出，落在 `assets/bundles/home/home/btn_primary_{l,m,r}.png`，
    #    不走"设计稿目录 → resources"这条链 —— 重跑本脚本**不会**动它们。
    #    旧素材 `home/btn9_*.png → home/btn_*.png` 已随本轮从工程删除
    #    （它是另一套美术，与方案 B 不同源；旧件备份在 /private/tmp/g5-btn9-bak）。
    ("home/mute_on.png",                "home/mute_on.png"),
    ("home/mute_off.png",               "home/mute_off.png"),
    ("home/icon_music.png",             "home/icon_music.png"),
    ("home/icon_signin.png",            "home/icon_signin.png"),
    ("home/icon_shop.png",              "home/icon_shop.png"),
    ("home/icon_rank.png",              "home/icon_rank.png"),
    ("home/icon_invite.png",            "home/icon_invite.png"),
    # 道具图标：文件名 icon_tool_* → 工程用 tool_*（CFG.TOOL_ICON 逐值对应）
    ("home/icon_tool_erase.png",        "home/tool_erase.png"),
    ("home/icon_tool_remove.png",       "home/tool_remove.png"),
    ("home/icon_tool_shuffle.png",      "home/tool_shuffle.png"),
    ("home/icon_tool_addslot.png",      "home/tool_addslot.png"),

    # —— 开局页 ——
    ("game-start/table_default.jpg",    "game-start/table.jpg"),
    ("game-start/audio/sfx-roll-dice.mp3", "audio/dice_roll.mp3"),

    # —— 主玩页 ——
    ("game-play/rule-完整规则页.png",    "game-play/rule_page.png"),
]

# 骰子六面：face_N.png → game-start/dice/face_N.png（同名，仅批量）
DICE = [f"game-start/dice/face_{n}.png" for n in range(1, 7)]

# ------------------------------------------------------------
#  二、牌面：中文名 → ASCII 名
# ------------------------------------------------------------
SUIT_DIR = {"wan": "万", "tiao": "条", "tong": "筒"}
NUM_CN = "一二三四五六七八九"


def tiles_map() -> list[tuple[str, str]]:
    """`game-play/tiles/wan/三万.png` → `tiles/wan/wan3.png`"""
    out: list[tuple[str, str]] = []
    for suit, cn in SUIT_DIR.items():
        for n in range(1, 10):
            out.append((
                f"game-play/tiles/{suit}/{NUM_CN[n - 1]}{cn}.png",
                f"tiles/{suit}/{suit}{n}.png",
            ))
    return out


ALL: list[tuple[str, str]] = SINGLE + [(p, p) for p in DICE] + tiles_map()


# ------------------------------------------------------------
#  三、执行
# ------------------------------------------------------------
def sync() -> int:
    if not SRC.is_dir():
        print(f"[✗] 找不到素材目录：{SRC}")
        return 1

    ok, missing = 0, []
    for rel_src, rel_dst in ALL:
        s = SRC / rel_src
        d = DST / rel_dst
        if not s.is_file():
            missing.append(rel_src)
            continue
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
        ok += 1

    print(f"[✓] 已同步 {ok}/{len(ALL)} 个文件 → {DST.relative_to(PROJ)}")
    if missing:
        print(f"[!] 缺失 {len(missing)} 个源文件：")
        for m in missing:
            print(f"    - {m}")
    return 0


def report() -> None:
    """按目录统计落盘结果（含尺寸，方便与契约对账）"""
    if not DST.is_dir():
        return
    print("\n落盘清单：")
    groups: dict[str, list[Path]] = {}
    for f in sorted(DST.rglob("*")):
        if f.is_file() and f.suffix.lower() != ".meta":
            groups.setdefault(str(f.parent.relative_to(DST)), []).append(f)
    total = 0
    for d in sorted(groups):
        files = groups[d]
        total += len(files)
        print(f"  {d or '.'}/  ({len(files)} 个)")
        for f in files:
            print(f"      {f.name}")
    print(f"  合计 {total} 个资源文件")


# ------------------------------------------------------------
#  四、校验：代码里引用的路径必须在 resources 里找得到
# ------------------------------------------------------------
def verify() -> int:
    """
    把 assets/scripts 里出现的资源路径收出来，逐个在 resources 里查。

    只查**字面量**路径（`'splash/felt'` 这种）；`tiles/<suit>/<suit><n>` 是
    拼出来的，单独用牌面 27 张的存在性来验。
    """
    scripts = PROJ / "assets" / "scripts"
    if not scripts.is_dir():
        print("[!] 没有 assets/scripts，跳过校验")
        return 0

    pat = re.compile(r"""['"]([a-z][a-z0-9_\-/]*?)['"]""")
    # 排除明显不是资源路径的
    noise = {
        "quadout", "quadin", "backout", "sineinout", "cubicout", "sineout",
        "circout", "expoout", "elasticout", "backin", "quadinout",
    }
    exts = {".png", ".jpg", ".jpeg", ".mp3", ".wav", ".ogg"}

    bad: list[str] = []
    checked: set[str] = set()

    for ts in sorted(scripts.rglob("*.ts")):
        text = ts.read_text(encoding="utf-8")
        for m in pat.finditer(text):
            p = m.group(1)
            if p.lower() in noise or "." in p or "/" not in p:
                continue
            # 资源路径一定形如 dir/name 且不是相对导入（相对导入以 . 开头，已排除）
            head = p.split("/")[0]
            if head not in ("splash", "home", "game-start", "game-play", "tiles", "audio"):
                continue
            checked.add(p)
            if not any((DST / (p + e)).is_file() for e in exts):
                bad.append(f"{p}   ←  {ts.relative_to(PROJ)}")

    print(f"\n代码引用路径校验：命中 {len(checked)} 条")
    if bad:
        print(f"[✗] {len(bad)} 条在 resources 里找不到：")
        for b in sorted(set(bad)):
            print(f"    - {b}")
    else:
        print("[✓] 全部都能找到对应文件")

    # 牌面 27 张单独验
    miss = [f"tiles/{s}/{s}{n}.png"
            for s in SUIT_DIR for n in range(1, 10)
            if not (DST / f"tiles/{s}/{s}{n}.png").is_file()]
    if miss:
        print(f"[✗] 牌面缺 {len(miss)} 张：{miss[:5]}…")
    else:
        print("[✓] 牌面 27 张齐全")

    return 1 if (bad or miss) else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="额外校验代码引用的路径")
    ap.add_argument("--quiet", action="store_true", help="不打印落盘清单")
    a = ap.parse_args()

    rc = sync()
    if not a.quiet:
        report()
    if a.verify:
        rc = max(rc, verify())
    return rc


if __name__ == "__main__":
    sys.exit(main())
