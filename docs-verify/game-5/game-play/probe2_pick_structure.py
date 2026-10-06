#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
探针 2：可点率的**结构性**根因与杠杆（第 32 轮 · 第 2 条）

探针 1 证明"调 span / 长宽比 / 填充率"最多只能把后段可点率从 7% 抬到 12%。
本探针回答"为什么低"，并试**结构方案**：

根因假设：v6 的层是**同心嵌套**的（每层取"最靠层心"的格，且各层共用同一套单位格点）
  ⇒ 上层牌**正对**下层牌 ⇒ 任意一张下层牌只要被任一层覆盖 ≥18% 就不可点，
  而同心嵌套 ⇒ 只有"各层轮廓之间那圈环带"上的牌可点 ⇒ 可点 ≈ 层数（≈10 张）。

结构方案：给每层一个**层间横向错位**（黄金角分布、质心不漂移）
  ⇒ 每层朝不同方向"探出去"，把下层的一大片边缘露出来 ⇒ 可点大幅上升。
  代价：轮廓不再严格同心（用户口径 = "均匀但不严格对称"，需核对均匀度指标）。

用法：python3 probe2_pick_structure.py
"""
import importlib.util
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ld', os.path.join(HERE, 'level_design.py'))
ld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ld)

GOLD = math.radians(137.50776405003785)


def shift(i, mode, R):
    if mode == 'concentric' or R == 0:
        return 0.0, 0.0
    if mode == 'gold':
        a = i * GOLD
        return R * math.cos(a), R * math.sin(a)
    if mode == 'alt':
        s = 1.0 if i % 2 == 0 else -1.0
        return s * R, -s * R
    raise ValueError(mode)


def gen(n, L, seed, p, variant, span, mode, R):
    counts = ld.split_layers(n, L)
    dy = ld.layer_dy(L, span)
    rng = random.Random(seed * 131 + variant * 977)
    tiles = []
    for i in range(L):
        ci = counts[i]
        cols, rows = ld.best_grid(ci)
        cells = ld.layer_cells(ci, cols, rows, p)
        occ = set(cells)
        frees = sorted(cr for cr in cells
                       if (cr[0] - 1, cr[1]) not in occ or (cr[0] + 1, cr[1]) not in occ)
        n_cross = min(len(frees), int(round(ci * ld.CROSS_RATIO)))
        cross_set = set()
        if n_cross > 0:
            idxs = {int(k * len(frees) / n_cross) for k in range(n_cross)}
            cross_set = {frees[k] for k in idxs if k < len(frees)}
        ox, oy = shift(i, mode, R)
        for (c, r) in cells:
            gx = (c - (cols - 1) / 2.0) + ox
            gy = (r - (rows - 1) / 2.0) * ld.TILE_AR + oy
            jx = (rng.random() - 0.5) * 2.0 * ld.JITTER
            jy = (rng.random() - 0.5) * 2.0 * ld.JITTER
            tiles.append({'x': round(gx + jx, 4),
                          'y': round(gy + jy - i * dy * ld.TILE_AR, 4),
                          'z': i, 'rot': 90 if (c, r) in cross_set else 0})
    return tiles


def evaluate(n, L, seed, p, mode, R, tries=12, fill=None):
    """自适应 span（保证几何解 ≥ W_MIN）→ 选最均匀 variant → 返回指标。"""
    fill = ld.FILL_MAX if fill is None else fill
    sp = ld.LAYER_DY_SPAN
    for _ in range(20):
        pr = gen(n, L, seed, p, 0, sp, mode, R)
        x0, y0, x1, y1 = ld.bbox_wu(pr)
        wg = min(ld.SAFE * fill / (x1 - x0), ld.SAFE * fill / (y1 - y0))
        if wg >= ld.W_MIN or sp <= 0.08:
            break
        sp = max(0.08, sp * 0.93)
    best = None
    for v in range(tries):
        t = gen(n, L, seed, p, v, sp, mode, R)
        y0s = [q['y'] for q in t]
        x0s = [q['x'] for q in t]
        mx, my = (min(x0s) + max(x0s)) / 2.0, (min(y0s) + max(y0s)) / 2.0
        for q in t:
            q['x'] = round(q['x'] - mx, 4)
            q['y'] = round(q['y'] - my, 4)
        u = ld.uniformity(t)
        s = ld.uni_score(u)
        if best is None or s < best[0]:
            best = (s, t, u)
    _, t, u = best
    x0, y0, x1, y1 = ld.bbox_wu(t)
    bw, bh = x1 - x0, y1 - y0
    wg = min(ld.SAFE * fill / bw, ld.SAFE * fill / bh)
    w = max(ld.W_MIN, min(ld.W_MAX, min(wg, ld.CURVE_CAP[L])))
    cover = ld.cover_ratios(t)
    n_live, n_strict = ld.live_counts(cover)
    hist = [0] * 6
    for c in cover:
        hist[min(5, int(c / 0.2))] += 1
    return dict(nLive=n_live, ratio=n_live / n, strict=n_strict, w=round(w),
                span=round(sp, 3), bbox=(round(bw, 2), round(bh, 2)),
                wg=round(wg, 1), cvn=round(u['cvNorm'], 3), qbal=round(u['qbal'], 3),
                coff=round(u['coff'], 3), asp=u['aspect'], hist=hist, tiles=t)


TARGETS = [(21, 120, 9), (30, 138, 10)]
print('=' * 118)
print('A · 覆盖分布（基线 L30）：每张牌被"更高层"覆盖的面积比 → 分箱计数')
print('=' * 118)
seedL = 20261005 + 30 * 7717
r = evaluate(138, 10, seedL, ld.FOOTPRINTS[2][0], 'concentric', 0.0)
print(f"  基线 L30：可点 {r['nLive']}（{r['ratio']*100:.1f}%）  覆盖分箱 "
      f"[0~20% / 20~40% / 40~60% / 60~80% / 80~100% / =100%] = {r['hist']}")

print()
print('=' * 118)
print('B · 结构方案对比：层间横向错位（黄金角分布，质心不漂移）')
print('=' * 118)
print(f"{'关':<5}{'方案':<26}{'可点':>5}{'占比':>8}{'严':>5}{'span':>7}{'牌宽':>6}"
      f"{'包围盒':>14}{'离散':>7}{'象限':>7}{'质心':>7}{'覆盖分箱':>26}")
for lv, n, L in TARGETS:
    seed = 20261005 + lv * 7717
    fp = ld.FOOTPRINTS[(lv - 1) // 10 % len(ld.FOOTPRINTS)][0]
    for mode, R, label in [('concentric', 0.0, '基线 · 同心嵌套'),
                           ('gold', 0.30, '黄金角错位 R=0.30'),
                           ('gold', 0.50, '黄金角错位 R=0.50'),
                           ('gold', 0.70, '黄金角错位 R=0.70'),
                           ('gold', 0.90, '黄金角错位 R=0.90'),
                           ('alt', 0.60, '交替错位 R=0.60')]:
        e = evaluate(n, L, seed, fp, mode, R)
        print(f"L{lv:<4}{label:<26}{e['nLive']:>5}{e['ratio']*100:>7.1f}%{e['strict']:>5}"
              f"{e['span']:>7}{e['w']:>6}{str(e['bbox']):>14}{e['cvn']:>7}{e['qbal']:>7}"
              f"{e['coff']:>7}{str(e['hist']):>26}")
    print('-' * 118)
