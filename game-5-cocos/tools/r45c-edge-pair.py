#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r45c-edge-pair.py · 「牌左缘」改前/改后同倍率对照 + 定量对账
============================================================
【要回答的问题】
  第 45 轮删掉了代码画的「金环 + 三层外发光」（原 drawRing：主环 w+4/3px alpha132，
  外发光 w+8i/(2.5|1)px alpha 52/i，i=1..3）。用户圈的就是牌体左缘**外侧**那一道暖金线。
  ⇒ 要证的只有一句：**牌体左缘外侧，改前有暖金、改后没有。**

【为什么不是"抽个颜色蒙版看整板"】
  第一版做的整板暖色蒙版**没有区分度**：牌图自带的金饰也是暖色，
  改前 14.71% → 改后 15.94%（不降反升，因为两张图牌位不同）。
  所以必须**限定在"牌体左缘外侧"这一条带**里量，而且只统计
  「外侧确实是干净绒布」的扫描线 —— 邻牌压过来的那些行不参与，否则量到的是邻牌的金框。

【对齐】
  两张图各按**实测牌体左缘**平移到同一列（对齐目标 = 窗口 52.5% 处 = 336/640），
  ⇒ 视觉上并排时两道边严格重合，差异只能来自内容本身。

【用法】
  python3 tools/r45c-edge-pair.py \
      --before <你圈的位置-8x.png> --after <r5-T16-w104.png> \
      --manifest <manifest.json> --out <并排图.png>
============================================================
"""
import argparse, json, os, sys

import numpy as np
from PIL import Image

OUT_W, OUT_H = 640, 960          # 8 输出 px / 设计 px（窗口 80×120 设计 px）
ZOOM = 8                         # 输出 px / 设计 px
EDGE_AT = int(round(OUT_W * 0.525))   # 牌体左缘的目标列 = 336
BAND = 104                       # 量到缘外 104 输出 px = 13 设计 px
                                 #   ← 原金环几何：主环 x∈[−3.5,−0.5]、外发光 i=1..3 到 −12.5（设计 px）
                                 #     所以带子必须够宽；第一版只取 15 px 只能看到最内侧一条缝。
WIN_D = (80, 120)                # 窗口设计尺寸
ANCHOR = (42, 25)                # 牌左缘 / 上缘在窗口内的设计位置（与取样脚本一致）
ROW_LO, ROW_HI = 300, 830        # 只在这段输出行取数（躲开窗口顶部其它牌压过来的边缘）


def warm_mask(a):
    """暖金像素：R 不弱于 G、且明显高于 B、且够亮。
    ⚠️ 第一版写成 `r > g + 4`，把**金环半透明叠在绒布上**的颜色判掉了
       （GOLD alpha132 over 深绿绒布 ⇒ R≈G），于是"改前"只测到 76 行命中、看着像噪声。
       绒布本身是 g > r > b，用 `r >= g − 2` 就能把它排除，同时收得下叠色后的金环。"""
    r, g, b = a[..., 0].astype(np.int16), a[..., 1].astype(np.int16), a[..., 2].astype(np.int16)
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    return (luma > 76) & (r > b + 20) & (r >= g - 2)


def body_mask(a):
    """牌体（奶白/米色 + 灰阶牌）：够亮且**不暖**。用来找左缘。"""
    r, g, b = a[..., 0].astype(np.int16), a[..., 1].astype(np.int16), a[..., 2].astype(np.int16)
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    return (luma > 118) & (np.abs(r - b) < 34)


def load(path):
    im = Image.open(path).convert('RGB')
    if im.size != (OUT_W, OUT_H):
        im = im.resize((OUT_W, OUT_H), Image.LANCZOS)
    return np.asarray(im).astype(np.uint8)


def find_edge(a, rows):
    """在给定扫描线上找牌体左缘，返回中位数（找不到的行跳过）。"""
    es = []
    for y in rows:
        bm = body_mask(a[y:y + 1, :, :])[0]
        for x in range(6, OUT_W - 40):
            if bm[x] and bm[x:x + 12].mean() > 0.75:
                es.append(x)
                break
    return (float(np.median(es)), len(es)) if es else (None, 0)


def shift_to(a, e, target):
    """把牌缘列 e 平移到 target：整图横向滚动，空出来的边用最近列填充。"""
    d = target - int(round(e))
    if d == 0:
        return a.copy()
    out = np.empty_like(a)
    if d > 0:
        out[:, d:] = a[:, :OUT_W - d]
        out[:, :d] = a[:, :1]
    else:
        out[:, :OUT_W + d] = a[:, -d:]
        out[:, OUT_W + d:] = a[:, -1:]
    return out


def warm_profile(a, rows):
    """按列统计「缘外暖金」：返回 offsets[-20..-1] → 命中行数。"""
    wm = warm_mask(a)
    prof = np.zeros(BAND + 1, dtype=int)          # offset 1..BAND（1 = 紧贴牌缘）
    for y in rows:
        band = wm[y, EDGE_AT - BAND:EDGE_AT]
        for i in range(BAND):
            if band[i]:
                prof[BAND - i] += 1                   # 距牌缘的距离
    return prof


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--before', required=True)
    ap.add_argument('--after', required=True)
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--label', default='')
    args = ap.parse_args()

    mf = json.load(open(args.manifest))
    chosen = mf['chosen'][0]
    leftD, topD = chosen['leftD'], chosen['topD']
    allt = [t for t in mf['tiles'] if t['name'] != chosen['tile']]

    # ---- 哪些输出行在"缘外一带"是干净绒布（没有别的牌压过来）----
    band_x0 = leftD + ANCHOR[0] - BAND / ZOOM      # 带子最左（设计 px）
    band_x1 = leftD + ANCHOR[0]                    # 牌体左缘（设计 px）
    clean = []
    dirty = 0
    for y in range(ROW_LO, ROW_HI):
        dy = topD + y / ZOOM
        bad = False
        for o in allt:
            ox1, ox2 = o['cx'] - o['dw'] / 2, o['cx'] + o['dw'] / 2
            oy1, oy2 = o['cy'] - o['dh'] / 2, o['cy'] + o['dh'] / 2
            if oy1 <= dy <= oy2 and ox1 < band_x1 and ox2 > band_x0:
                bad = True
                break
        if bad:
            dirty += 1
        else:
            clean.append(y)
    print(f'取景牌 = {chosen["tile"]}（牌宽 {chosen["designW"]} 设计 px）')
    print(f'取数行 = 输出 y ∈ [{ROW_LO}, {ROW_HI})（= 牌顶往下 '
          f'{(ROW_LO-ANCHOR[1]*ZOOM)/ZOOM:.1f}~{(ROW_HI-ANCHOR[1]*ZOOM)/ZOOM:.1f} 设计 px）')
    print(f'其中「缘外一带」干净的扫描线 {len(clean)} / {ROW_HI-ROW_LO}'
          f'（被邻牌占住 {dirty} 行，不参与统计）')
    if len(clean) < 60:
        print('[!] 干净行太少，结论会不稳 —— 换一张取景再跑'); return 2

    B0 = load(args.before)
    A0 = load(args.after)

    eb, nb = find_edge(B0, clean)
    ea, na = find_edge(A0, clean)
    print(f'实测牌体左缘：改前 {eb} px（{nb} 行）/ 改后 {ea} px（{na} 行）  对齐目标 {EDGE_AT} px')
    if eb is None or ea is None:
        print('[x] 有一侧找不到牌缘'); return 2

    B, A = shift_to(B0, eb, EDGE_AT), shift_to(A0, ea, EDGE_AT)

    pb, pa = warm_profile(B, clean), warm_profile(A, clean)
    n = len(clean)
    print(f'\n缘外暖金：按「距牌缘的设计距离」汇总（共 {n} 条干净扫描线）')
    print('  距缘(设计px)   命中行数 改前 / 改后    占干净行')
    for d in range(0, 13):
        lo, hi = d * ZOOM, (d + 1) * ZOOM            # 输出 px 区间 [lo, hi)
        sb = int(pb[1 + lo:1 + hi].sum())
        sa = int(pa[1 + lo:1 + hi].sum())
        bar = '#' * min(40, sb // max(1, n // 8)) or ''
        print(f'   {d:>2}~{d+1:<2}           {sb:>5} / {sa:<5}        {sb/(n*ZOOM)*100:5.0f}%  {bar}')
    tot_b, tot_a = int(pb[1:].sum()), int(pa[1:].sum())
    print(f'\n  ⇒ 缘外 0~13 设计 px 内暖金像素总数：**改前 {tot_b}** / **改后 {tot_a}**'
          f'（面积口径：{n*BAND} 个采样像素）')
    print(f'  ⇒ 平均每行：改前 {tot_b/n/ZOOM:.2f} 设计 px 宽的暖金带 / 改后 {tot_a/n/ZOOM:.2f}')

    # ---- 并排 ----
    GAP, PAD, RULER = 30, 20, 40
    Wt = OUT_W * 2 + GAP + PAD * 2
    canvas = Image.new('RGB', (Wt, OUT_H + PAD * 2 + RULER), (9, 16, 12))
    canvas.paste(Image.fromarray(B), (PAD, PAD))
    canvas.paste(Image.fromarray(A), (PAD + OUT_W + GAP, PAD))
    px = canvas.load()

    # 缘外带子（半透明品红框）+ 牌缘竖线
    for ox in (PAD, PAD + OUT_W + GAP):
        for y in range(PAD + 4, PAD + OUT_H - 4, 2):
            for x in range(ox + EDGE_AT - BAND, ox + EDGE_AT):
                if x < ox or x >= ox + OUT_W:
                    continue
                r0, g0, b0 = px[x, y]
                px[x, y] = (int(r0 * .55 + 130 * .45), int(g0 * .55 + 30 * .45), int(b0 * .55 + 110 * .45))
        for y in range(PAD, PAD + OUT_H):
            px[ox + EDGE_AT, y] = (255, 0, 170)
    # 底部标尺：每 8 输出 px = 1 设计 px
    for k in range(0, 41):
        h = 14 if k % 5 == 0 else 7
        for ox in (PAD, PAD + OUT_W + GAP):
            x = ox + k * ZOOM
            if x >= ox + OUT_W:
                break
            for y in range(PAD + OUT_H + 8, PAD + OUT_H + 8 + h):
                px[x, y] = (232, 216, 152)
    canvas.save(args.out)
    print(f'\n[v] 并排图 → {args.out}  {canvas.size[0]}×{canvas.size[1]}')
    print(f'    倍率 {ZOOM} 输出 px / 设计 px；品红线 = 牌体左缘；品红带 = 本次取数的那 15 px')
    return 0


if __name__ == '__main__':
    sys.exit(main())
