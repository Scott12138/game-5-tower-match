#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r45c-ring-pair.py · 金环 A/B 的同倍率合成 + 对账
============================================================
【输入】_r45c-ring-ab.mjs 出的 now.png（本轮，环已删）/ was.png（补画回原环）
        两张是**同一个 clip** ⇒ 天然逐像素对齐，不需要任何配准。

【量什么】
 1) 差异图：两张相减，非零像素的数量 + 包围盒 —— 证明"唯一变量就是金环"。
 2) 缘外暖金：在牌节点左缘（窗口 52.5% = 336 列）**左侧**统计暖金像素，
    改前/改后各一遍。口径与暖色判定同 r45c-edge-pair.py（通道差法，不用 HSV）。

【用法】python3 tools/r45c-ring-pair.py --now <png> --was <png> --out <png>
============================================================
"""
import argparse, sys

import numpy as np
from PIL import Image

OUT_W, OUT_H = 640, 960
EDGE_AT = int(round(OUT_W * 0.525))     # 336
CROP = (140, 700)                       # 纵向只留这一段（560 高）—— 环的圆弧 + 竖线都在里面，
                                        # 而 960 高整张会把这个页面撑过「单次截图高度上限」


def warm_mask(a):
    r, g, b = a[..., 0].astype(np.int16), a[..., 1].astype(np.int16), a[..., 2].astype(np.int16)
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    return (luma > 76) & (r > b + 20) & (r >= g - 2)


def load(p):
    im = Image.open(p).convert('RGB')
    return np.asarray(im.resize((OUT_W, OUT_H), Image.LANCZOS)).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--now', required=True)
    ap.add_argument('--was', required=True)
    ap.add_argument('--ref', help='可选：你的原始截图（会作为最左一联拼进来，仅作实况佐证）')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    NOW, WAS = load(args.now), load(args.was)
    REF = load(args.ref) if args.ref else None

    # ---- 差异图：两张唯一的差别 = 金环 ----
    d = np.abs(NOW.astype(np.int16) - WAS.astype(np.int16)).max(axis=2)
    nz = d > 10
    n = int(nz.sum())
    ys, xs = np.where(nz)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if n else None
    print(f'两张差异像素 {n}（占 {n/(OUT_W*OUT_H)*100:.2f}%）  包围盒 x[{bbox[0]},{bbox[2]}] y[{bbox[1]},{bbox[3]}]'
          if n else '两张完全一致')
    # 差异是否**全部落在目标牌周围**（牌缘 336 左右）
    left_of = int(nz[:, :EDGE_AT].sum())
    right_of = int(nz[:, EDGE_AT:].sum())
    print(f'  其中牌缘左侧 {left_of} px / 右侧 {right_of} px（环是绕牌一圈的，两侧都该有）')

    # ---- 缘外暖金 ----
    for tag, A in (('改后（本轮）', NOW), ('改前（补画环）', WAS)):
        wm = warm_mask(A)
        band = wm[:, :EDGE_AT - 2]                      # 牌缘左侧（留 2px 躲开抗锯齿）
        # 只看牌体的纵向区间：窗口 120 设计 px 高，牌上缘在 25 设计 px ⇒ y 200..960
        sub = band[200:OUT_H, EDGE_AT - 104:EDGE_AT - 2]
        colsum = sub.sum(axis=1)
        rows_hit = int((colsum > 0).sum())
        print(f'{tag}：缘外（0~13 设计 px）暖金像素 {int(sub.sum()):>6} 个，'
              f'命中扫描线 {rows_hit:>3} / {sub.shape[0]}，行内最宽 {int(colsum.max())} px')
    print(f'\n  ⇒ 每 8 输出 px = 1 设计 px；暖金带宽度换算：{int(warm_mask(WAS)[:, :EDGE_AT].sum()) and ""}')

    # ---- 合成：三联网（你的实况 | 补画环 | 本轮），纵向裁到 CROP ----
    # ⚠️ 标注别用"半透明色块盖住"：第一版拿品红填充盖了 102 px 宽的带子，
    #    正好把要给人看的那道金环糊掉了。改成**只画一根青色边界 + 一根橙色缘线**。
    y0, y1 = CROP
    PH = y1 - y0
    panels = ([REF, WAS, NOW] if REF is not None else [WAS, NOW])
    GAP, PAD, RULER = 26, 20, 44
    canvas = Image.new('RGB', (OUT_W * len(panels) + GAP * (len(panels) - 1) + PAD * 2,
                              PH + PAD * 2 + RULER), (9, 16, 12))
    for i, p in enumerate(panels):
        canvas.paste(Image.fromarray(p[y0:y1]), (PAD + i * (OUT_W + GAP), PAD))
    px = canvas.load()
    CY, ORANGE = (120, 235, 255), (255, 176, 60)        # 淡青 = 取数带外边界；橙 = 牌体左缘
    for i in range(len(panels)):
        ox = PAD + i * (OUT_W + GAP)
        for y in range(PAD + 2, PAD + PH - 2):          # 带子左边界（虚）
            if (y // 6) % 2 == 0:
                px[ox + EDGE_AT - 104, y] = CY
        for y in range(PAD + 2, PAD + PH - 2, 3):       # 牌体左缘（点划）
            px[ox + EDGE_AT, y] = ORANGE
    for k in range(0, 41):                              # 底部标尺：每 8 输出 px = 1 设计 px
        h = 14 if k % 5 == 0 else 7
        for i in range(len(panels)):
            x = PAD + i * (OUT_W + GAP) + k * 8
            if x >= PAD + i * (OUT_W + GAP) + OUT_W:
                break
            for y in range(PAD + PH + 10, PAD + PH + 10 + h):
                px[x, y] = (232, 216, 152)
    canvas.save(args.out)
    print(f'\n[v] 三联图 → {args.out}  {canvas.size[0]}×{canvas.size[1]}')
    print(f'    顺序：{"你的截图实况 | " if REF is not None else ""}补画环 | 本轮（都是 8 输出 px / 设计 px，纵向 {y0}~{y1}）')
    print('    橙色点划线 = 牌体左缘（窗口 52.5%）；淡青虚线 = 缘外取数带的外边界（13 设计 px）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
