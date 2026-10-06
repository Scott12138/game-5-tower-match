#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
探针 3：可点率的**结构方案组合**扫描（第 32 轮 · 第 2 条）

探针 2 结论：可点率 ≈ "天际线张数"（各位置最上面那张牌）。
  v6 同心嵌套 ⇒ 天际线 = 顶层张数(9) + 环带 ⇒ 10 张（7.2%）。
  ⇒ 提升方向只有三条：① 抬高天际线（顶层张数下限）② 层间横向错位（露边）
     ③ 层内间距>1（让上层落进缝里，打破"同格堆叠"）

本探针扫这三条的**组合**，并同时给出：
  可点率 / 严格口径 / 均匀度（离散指数、象限）/ 包围盒 / 牌宽 / 几何解
用法：python3 probe3_pick_combo.py
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


def profile(counts, top_share):
    """把底层张数搬到顶层，使顶层 ≥ top_share × 总数（抬高天际线）。"""
    out = counts[:]
    tgt = max(out[-1], int(round(sum(out) * top_share)))
    guard = 0
    while out[-1] < tgt and guard < 10000:
        guard += 1
        i = max(range(len(out) - 1), key=lambda k: out[k])
        if out[i] <= 2:
            break
        out[i] -= 1
        out[-1] += 1
    return out


def gen(n, L, seed, p, variant, span, R, pitch, top_share):
    counts = ld.split_layers(n, L)
    if top_share > 0:
        counts = profile(counts, top_share)
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
        cs = set()
        if n_cross:
            cs = {frees[int(k * len(frees) / n_cross)] for k in range(n_cross)}
        a = i * GOLD
        ox, oy = (R * math.cos(a), R * math.sin(a)) if R else (0.0, 0.0)
        for (c, r) in cells:
            gx = (c - (cols - 1) / 2.0) * pitch + ox
            gy = (r - (rows - 1) / 2.0) * ld.TILE_AR * pitch + oy
            jx = (rng.random() - 0.5) * 2.0 * ld.JITTER
            jy = (rng.random() - 0.5) * 2.0 * ld.JITTER
            tiles.append({'x': round(gx + jx, 4),
                          'y': round(gy + jy - i * dy * ld.TILE_AR, 4),
                          'z': i, 'rot': 90 if (c, r) in cs else 0})
    return tiles


def evaluate(n, L, seed, p, R, pitch, top_share, tries=8):
    sp = ld.LAYER_DY_SPAN
    for _ in range(20):
        pr = gen(n, L, seed, p, 0, sp, R, pitch, top_share)
        x0, y0, x1, y1 = ld.bbox_wu(pr)
        wg = min(ld.SAFE * ld.FILL_MAX / (x1 - x0), ld.SAFE * ld.FILL_MAX / (y1 - y0))
        if wg >= ld.W_MIN or sp <= 0.08:
            break
        sp = max(0.08, sp * 0.93)
    best = None
    for v in range(tries):
        t = gen(n, L, seed, p, v, sp, R, pitch, top_share)
        xs = [q['x'] for q in t]; ys = [q['y'] for q in t]
        mx, my = (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0
        for q in t:
            q['x'] = round(q['x'] - mx, 4); q['y'] = round(q['y'] - my, 4)
        u = ld.uniformity(t)
        s = ld.uni_score(u)
        if best is None or s < best[0]:
            best = (s, t, u)
    _, t, u = best
    x0, y0, x1, y1 = ld.bbox_wu(t)
    bw, bh = x1 - x0, y1 - y0
    wg = min(ld.SAFE * ld.FILL_MAX / bw, ld.SAFE * ld.FILL_MAX / bh)
    w = max(ld.W_MIN, min(ld.W_MAX, min(wg, ld.CURVE_CAP[L])))
    cover = ld.cover_ratios(t)
    n_live, n_strict = ld.live_counts(cover)
    return dict(nLive=n_live, ratio=n_live / n, strict=n_strict, w=round(w),
                span=round(sp, 3), bbox=(round(bw, 2), round(bh, 2)), wg=round(wg, 1),
                cvn=round(u['cvNorm'], 3), qbal=round(u['qbal'], 3), asp=round(u['aspect'], 3))


COMBOS = [
    ('v6 基线',                       0.0,  1.0,  0.0),
    ('错位 R=0.35',                   0.35, 1.0,  0.0),
    ('错位 R=0.60',                   0.60, 1.0,  0.0),
    ('间距 1.15',                     0.0,  1.15, 0.0),
    ('间距 1.30',                     0.0,  1.30, 0.0),
    ('天际线 12%（顶层≥17张）',        0.0,  1.0,  0.12),
    ('天际线 18%（顶层≥25张）',        0.0,  1.0,  0.18),
    ('错位0.35 + 天际线12%',          0.35, 1.0,  0.12),
    ('错位0.35 + 间距1.15 + 天际线12%', 0.35, 1.15, 0.12),
    ('错位0.60 + 间距1.15 + 天际线18%', 0.60, 1.15, 0.18),
    ('错位0.60 + 间距1.30 + 天际线12%', 0.60, 1.30, 0.12),
    ('错位0.35 + 间距1.30 + 天际线18%', 0.35, 1.30, 0.18),
]

print('=' * 124)
print('可点率结构方案组合扫描（COVER_TH=0.18 恒定，不改口径）')
print('=' * 124)
print(f"{'关':<5}{'方案':<34}{'可点':>5}{'占比':>8}{'严':>5}{'span':>7}{'牌宽':>6}"
      f"{'包围盒':>14}{'几何解':>8}{'离散':>7}{'象限':>7}{'长宽比':>8}")
for lv, n, L in [(21, 120, 9), (30, 138, 10)]:
    seed = 20261005 + lv * 7717
    fp = ld.FOOTPRINTS[(lv - 1) // 10 % len(ld.FOOTPRINTS)][0]
    for label, R, pitch, ts in COMBOS:
        e = evaluate(n, L, seed, fp, R, pitch, ts)
        print(f"L{lv:<4}{label:<34}{e['nLive']:>5}{e['ratio']*100:>7.1f}%{e['strict']:>5}"
              f"{e['span']:>7}{e['w']:>6}{str(e['bbox']):>14}{e['wg']:>8}{e['cvn']:>7}"
              f"{e['qbal']:>7}{e['asp']:>8}")
    print('-' * 124)
