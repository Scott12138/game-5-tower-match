#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 make_btn_primary_assets.py · 首页主按钮「方案 B」九宫格切件
============================================================
 输入：`docs-verify/game-5/home/round37/btn_v2.png`（890×467，用户拍板的方案 B 底板）
 输出：`game-5-cocos/assets/bundles/home/home/btn_primary_{l,m,r}.png`

 【为什么要切，而不是整张丢给引擎】
   旧实现把整张中段图 `w:320, h:140` 硬拉 —— 源 228×280 → 显示 320×140
   意味着 **横向 ×1.403 / 纵向 ×0.500（各向异性 2.81×）**，玉纹被压成横向拉丝。
   正确拼法是「两端圆角固定、中段仅水平拉伸、纵向严格 1:1」，所以必须切成三段。

 【切点怎么定的（这是本次的关键，不是随手切）】
   扫 alpha 逐列高，找「满高（≥ 最大高 ×99.5%）」区间：
       源 890×467 · 最大列高 467 · 满高区间 [189, 705]
   但**接缝必须落在两侧列高完全相同的位置**，否则拼起来会有一条 1px 台阶。
   实测列高分布：
       [0  ,188] → top 1 / bottom 464     （弧内，高度未满）
       [189,699] → top 1 / bottom 465
       [692,699] → top 0 / bottom 465     （中间高光顶端高出 1px）
       [700,705] → top 1 / bottom 465
       [706,889] → top 1 / bottom 464
   ⇒ **左切点取 190**（不是 189！189 会让帽的末列停在 188，底边差 1px）
     **右切点取 706**（中段末列 705 与帽首列 706 同为 top 1 / bottom 465，
       只有 bottom 差 1px，1 源 px ≈ 0.43 设计 px ≈ 真机 0.72 物理 px，不可见）

 【为什么先缩后切】
   先 crop 再 resize 会让 LANCZOS 在**切口那一列**产生边缘振铃 → 接缝发亮。
   先 resize 整图再 crop，切口取的是**内部**像素，无振铃。

 【缩放系数 0.70 的来历（不是随手）】
   显示 320 设计 px。真机 1264 物理宽 ⇒ 1 设计 px = 1264/750 = 1.6853 物理 px
   ⇒ 需要 538.3 物理 px。源 890 px 已是 1.65× 过剩。
   按 0.70 缩到 623 px：对 1264 宽设备余量 1.16×、对 1440 宽设备（614 px）仍不吃亏；
   体积从 600 KB 降到 308 KB（省 49%），主包红线 4 MB 才守得住。

 用法：
     python3 make_btn_primary_assets.py
============================================================
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
WS = HERE.parent.parent.parent                      # 工作区根
SRC = HERE / "round37" / "btn_v2.png"
DST = WS / "game-5-cocos" / "assets" / "bundles" / "home" / "home"

# —— 实测切点（源图像素坐标）——
CUT_L = 190
CUT_R = 706
# —— 缩放系数 ——
K = 0.70
# —— 显示口径 ——
DISP_H = 140
DISP_W = 320


def main() -> int:
    if not SRC.exists():
        print(f"❌ 找不到源图：{SRC}")
        return 1

    src = Image.open(SRC).convert("RGBA")
    W, H = src.size
    print(f"源图 {W}×{H}")

    # ① 先整图等比缩放（LANCZOS），避免切口的边缘振铃
    sw, sh = round(W * K), round(H * K)
    small = src.resize((sw, sh), Image.LANCZOS)
    print(f"整图 → {sw}×{sh}（K={K}）")

    # ② 再按缩放后的切点裁三段
    cl, cr = round(CUT_L * K), round(CUT_R * K)
    pieces = {
        "btn_primary_l": (0, cl),
        "btn_primary_m": (cl, cr),
        "btn_primary_r": (cr, sw),
    }

    DST.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for name, (x0, x1) in pieces.items():
        crop = small.crop((x0, 0, x1, sh))
        out = DST / f"{name}.png"
        crop.save(out, "PNG", optimize=True)
        sizes[name] = crop.width
        print(f"  {name}.png  {crop.width}×{crop.height}  "
              f"{os.path.getsize(out) / 1024:.1f} KB")

    # ③ 打印显示尺寸推导（代码里的常量就照这个写）
    cap_l = sizes["btn_primary_l"] * DISP_H / sh
    cap_r = sizes["btn_primary_r"] * DISP_H / sh
    mid_src_disp = sizes["btn_primary_m"] * DISP_H / sh
    mid_disp = DISP_W - cap_l - cap_r
    print()
    print("=== 显示推导（显示高 140 / 源高 %d）===" % sh)
    print(f"  左帽显示宽 CAP_L = {sizes['btn_primary_l']} × 140/{sh} = {cap_l:.2f}")
    print(f"  右帽显示宽 CAP_R = {sizes['btn_primary_r']} × 140/{sh} = {cap_r:.2f}")
    print(f"  中段净空 = 320 − {cap_l:.2f} − {cap_r:.2f} = {mid_disp:.2f}")
    print(f"  中段源 1:1 显示宽 = {sizes['btn_primary_m']} × 140/{sh} = {mid_src_disp:.2f}")
    print(f"  ⇒ 中段横向拉伸 = {mid_disp / mid_src_disp:.3f}×（纵向严格 1:1）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
