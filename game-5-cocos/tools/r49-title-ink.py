#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r49-title-ink.py · 第 49 轮 · 结算标题的**像素级墨迹边界**量测
============================================================
问题：用户反馈「"通关啦"和"只差一点"结算字样横向上不太居中，看着偏左」。

探针 `_r49-probe.mjs` 已经把**排版参数**排除了：
  · Title 与 TitleShade 的 `worldPosition.x` 与卡中线差 = **0**
  · `horizontalAlign = 1`(CENTER) · `overflow = 0`(NONE) · `anchorX = 0.5`
  ⇒ 节点是精确居中的，所以「看起来偏左」只可能来自**字形**。

本脚本要回答的就一个问题：
  **按 advance（字宽和）居中，和按墨迹（真正画出来的笔画）居中，差多少？**

────────────────────────────────────────────────────────────
【量法】
1. 载入无头截图（CSS 421×927 @3 ⇒ 1263×2781 物理像素）
2. **对照组**：在标题所在的 y 带里找**卡的金色竖框**，用它的左右边界反算卡中心。
   期望 = 375 设计 px。**如果这一步不准，后面所有数字都不可信** ——
   这是"判据自身也要被验证"（项目判据 1）：先在一个已知真值的对象上跑通量法。
3. **被测对象**：同一 y 带内逐列统计 ink 像素，拼出"墨迹横向直方图"。
4. 把 ink 直方图切成**连续区段** —— 每个区段 ≈ 一个汉字。
   「通关啦！」应出 4 段、末尾那段的宽度会明显小于前三段，
   这正是「全角叹号 advance = 1 em、但墨迹只占一小条」的直接证据。

【判据（通道比值法 —— 项目判据 2，不用 HSV 色相带）】
  背景（玉质卡面渐变 #1B6047→#123F30）：G 通道**明显**大于 R
  ink（奶白字 / 深棕厚底 / 深墨描边）：G ≤ R + 10
  金色（卡框 / 金币）：R > 140 且 R − B > 60 且 G > B  ⇒ **单独排除**，
      否则飘过的金币会把墨迹右边界一路拉到屏幕边（负态截图上确实有金币）。
  奶白 #F3E7CE: R−B=37 <60 ⇒ 不算金 ✓；深棕 #5C361D: R=92 <140 ⇒ 不算金 ✓

【用法】
  python3 tools/r49-title-ink.py /tmp/g5-r49/r49-title-win.png /tmp/g5-r49/r49-title-fail.png
============================================================
"""

import sys

import numpy as np
from PIL import Image

# ---- 设计 px 基准（与 GamePage.ts 的 RESULT / Layout.topY 同口径）----
DESIGN_W = 750.0
CARD_TOP_FROM_SCREEN_TOP = 360.0        # RESULT.TOP
CARD_W = 620.0                          # RESULT.CARD_W
CARD_CX = 375.0                         # 屏幕中线
TITLE_PAD_TOP = 12.0                    # RESULT.PAD_TOP
TITLE_H = 154.6                         # 实测标题框高
TITLE_FONT = 88.0


def load(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    return im, a


def gold_mask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 140) & ((r - b) > 60) & (g > b)


def ink_mask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g <= r + 10) & ~gold_mask(a)


def segments(cols_hit, min_gap=6, min_w=3):
    """把"有 ink 的列"切成连续区段（段间允许 min_gap 列的空隙）"""
    segs = []
    start = None
    last = None
    for i, hit in enumerate(cols_hit):
        if hit:
            if start is None:
                start = i
            last = i
        else:
            if start is not None and (i - last) > min_gap:
                if (last - start + 1) >= min_w:
                    segs.append((start, last))
                start = None
    if start is not None and (last - start + 1) >= min_w:
        segs.append((start, last))
    return segs


def analyse(path, tag):
    im, a = load(path)
    W, H = im.size
    s = W / DESIGN_W                      # 设计 px → 图像 px
    print(f"\n{'=' * 74}")
    print(f"  {tag}   {path}")
    print(f"  图像 {W}×{H}   scale = {s:.4f} img px / 设计 px")
    print(f"{'=' * 74}")

    # ---- 标题所在的 y 带（设计 px → 图像 px）----
    # 字形主体中心 = 卡顶 + PAD_TOP + TITLE_H/2；再按字号内缩一点点取主体
    y_c = CARD_TOP_FROM_SCREEN_TOP + TITLE_PAD_TOP + TITLE_H / 2
    y0 = int((y_c - TITLE_FONT * 0.42) * s)
    y1 = int((y_c + TITLE_FONT * 0.42) * s)
    print(f"  标题字形带：设计 y ∈ [{y_c - TITLE_FONT * 0.42:.1f}, {y_c + TITLE_FONT * 0.42:.1f}]"
          f"  → 图像 y ∈ [{y0}, {y1}]")

    band = a[y0:y1, :, :]

    # ---- ① 对照组：卡的金色竖框 ----
    #
    #  ★★ 第 49 轮踩的坑（写在这里防止后人重犯）：
    #     第一版把「墨迹中心（**图像换算**出来的）」直接与 `CARD_CX = 375`
    #     （**设计常量**）相减 —— 两套坐标系混用，结果全错。
    #     真正的问题不在卡上：卡框间距实测 619.95 ≈ CARD_W 620（比例正确），
    #     但框中心落在 383.61 而**不是** 375 ⇒ 说明「图像 x → 设计 x」的换算
    #     里含一个**系统性平移 +8.61 设计 px**（画布 CSS rect 的左边不等于 0）。
    #     ⇒ 正确口径：**所有横向比较都在图像坐标系里做**（墨迹 vs 卡框），
    #       那个系统平移会自动抵消；只有最后输出给人看时才换算成设计 px。
    #     这也正是项目判据 1 的用法 —— 先在一个**已知真值**的对象（卡框）上
    #     跑通量法，量法没通过就不许去量被测对象。
    gm = gold_mask(band)
    col_gold = gm.sum(axis=0)
    thr = (y1 - y0) * 0.55
    gold_cols = np.where(col_gold > thr)[0]
    if len(gold_cols) == 0:
        print("  ✗ 对照组失败：这条 y 带里没找到卡的金框")
        return None
    left_cluster = gold_cols[gold_cols < W / 2]
    right_cluster = gold_cols[gold_cols >= W / 2]
    if len(left_cluster) == 0 or len(right_cluster) == 0:
        print("  ✗ 对照组失败：金框只有单侧")
        return None
    l_img = left_cluster.mean()     # 图像 px，下同
    r_img = right_cluster.mean()
    ctrl_cx_img = (l_img + r_img) / 2
    # 卡宽是硬事实（RESULT.CARD_W = 620）：用它校验比例，而不是用位置
    span_design = (r_img - l_img) / s
    # 真值卡的**图像**中线：由 `card.worldX = 375` 反推 ⇒ 375 * s + 平移
    #   而平移 = ctrl_cx_img - 375 * s ⇒ 恒等。所以这里只用 span 判断比例，
    #   位置平移量单独算出来当作"量法的系统偏移"记录。
    ctrl_off_img = ctrl_cx_img - CARD_CX * s
    print(f"\n  ── ① 对照组（卡金框）──")
    print(f"     左框 {l_img:.1f} 图 px = {l_img / s:.2f} 设计 px"
          f"   右框 {r_img:.1f} 图 px = {r_img / s:.2f} 设计 px")
    print(f"     框间距 {span_design:.2f} 设计 px（设计卡宽 {CARD_W}）")
    print(f"     框中心 {ctrl_cx_img:.1f} 图 px · 与「设计中线×scale」的差 ="
          f" {ctrl_off_img:+.1f} 图 px = {ctrl_off_img / s:+.2f} 设计 px")
    print(f"     ⇒ 这是**量法的系统平移**，下面所有横向比较都用图像系，自动抵消")
    if abs(span_design - CARD_W) > 4:
        print(f"     ⚠️ 框间距与设计卡宽差 {span_design - CARD_W:+.2f} > 4 ⇒ scale 有问题，先修量法")

    # ---- ② 被测：标题墨迹 ----
    km = ink_mask(band)
    # 只在卡内扫（卡框再内缩 10 设计 px，避开金框自身的抗锯齿）
    x_lo = int(l_img + 10 * s)
    x_hi = int(r_img - 10 * s)
    km[:, :x_lo] = False
    km[:, x_hi:] = False

    col_ink = km.sum(axis=0)
    hit = col_ink >= 3
    segs = segments(hit, min_gap=6, min_w=3)

    print(f"\n  ── ② 标题墨迹（列扫描，ink 列阈值 3 像素）──")
    if not segs:
        print("     ✗ 没扫到墨迹")
        return None
    for i, (p, q) in enumerate(segs):
        print(f"     段{i + 1}: 图 x [{p:5d}, {q:5d}]  宽 {q - p + 1:4d} px"
              f"  = 设计 [{p / s:7.2f}, {q / s:7.2f}]  宽 {(q - p + 1) / s:6.2f} 设计 px"
              f"  = {((q - p + 1) / s) / TITLE_FONT:.3f} em")

    ink_l_img = segs[0][0]
    ink_r_img = segs[-1][1]
    ink_cx_img = (ink_l_img + ink_r_img) / 2
    # ★ 减掉量法的系统平移 ⇒ 折算成"相对卡中线的偏移"
    shift_img = ink_cx_img - ctrl_cx_img
    shift = shift_img / s

    print(f"\n     墨迹整体：左 {ink_l_img / s:.2f}  右 {ink_r_img / s:.2f}"
          f"  宽 {(ink_r_img - ink_l_img) / s:.2f}（设计 px，含 8px 描边外扩）")
    print(f"     墨迹中心 {ink_cx_img / s:.2f}  卡框中心 {ctrl_cx_img / s:.2f}（同为图像系换算）")
    print(f"     ⇒ 墨迹中心相对卡中线偏移 {shift:+.2f} 设计 px"
          f"（{'偏左' if shift < 0 else '偏右'} {abs(shift):.2f}）")
    print(f"     ⇒ 该偏移 = {shift / TITLE_FONT:+.4f} em（字号 {TITLE_FONT}）")
    print(f"     左边距 {ink_l_img / s - l_img / s:.2f}  右边距 {r_img / s - ink_r_img / s:.2f}"
          f"  ⇒ 右 − 左 = {(r_img - ink_r_img) / s - (ink_l_img - l_img) / s:+.2f}")
    return {
        "ctrl": {"l": l_img / s, "r": r_img / s, "cx": ctrl_cx_img / s, "span": span_design},
        "ink": {"l": ink_l_img / s, "r": ink_r_img / s, "cx": ink_cx_img / s, "segs": segs},
        "shift": shift,
        "scale": s,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    tags = ["胜态「通关啦！」", "负态「就差一点！」", "（第 3 张）"]
    out = {}
    for i, p in enumerate(args):
        r = analyse(p, tags[i] if i < len(tags) else f"图 {i + 1}")
        out[p] = r
    print(f"\n{'=' * 74}")
    print("  小结")
    print(f"{'=' * 74}")
    for p, r in out.items():
        if not r:
            print(f"  {p}: 量测失败")
            continue
        print(f"  {p.split('/')[-1]:24s} 卡框间距 {r['ctrl']['span']:6.2f}"
              f"   墨迹中心偏移 {r['shift']:+7.2f} 设计 px"
              f"（{r['shift'] / TITLE_FONT:+.3f} em）"
              f"  ⇒ 视觉补偿需右移 {max(0.0, -r['shift']):.2f} px")
