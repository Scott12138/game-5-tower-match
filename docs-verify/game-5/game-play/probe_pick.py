#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
探针：量化「后段开局可点率」的杠杆（第 32 轮 · 第 2 条落地前的实测）

不改可点判定口径（COVER_TH=0.18 恒定），只扫这四个**几何杠杆**：
  ① span  —— 层间纵向偏移总跨度（牌高倍数）：越大 → 层越"散" → 覆盖越低 → 可点越多
  ② ASP_HI—— 层网格长宽比窗口上限：放宽 → 允许更扁（更宽）的层 → 层高变小 → 腾出纵向空间给 span
  ③ FILL_MAX —— 牌堆包围盒占安全区上限：放宽 → 允许更大包围盒 → 支撑更大的 span
  ④ expo  —— 逐层张数衰减指数：越小越"平" → 各层铺位尺寸接近 → 均匀且上层盖得少

用法：python3 probe_pick.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ld', os.path.join(HERE, 'level_design.py'))
ld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ld)

ORIG_SPLIT = ld.split_layers
ORIG_FILL = ld.FILL_MAX
ORIG_ASPHI = ld.ASP_HI
ORIG_SPAN = ld.LAYER_DY_SPAN


def set_env(expo=None, fill=None, asp_hi=None):
    if expo is not None:
        ld.split_layers = lambda n, L, exponent=expo, floor=2: ORIG_SPLIT(n, L, exponent, floor)
    else:
        ld.split_layers = ORIG_SPLIT
    ld.FILL_MAX = ORIG_FILL if fill is None else fill
    ld.ASP_HI = ORIG_ASPHI if asp_hi is None else asp_hi


def run_level(lv, n, L, span=None, tries=12):
    """复刻 build() 的几何流程，返回 (w, nLive, ratio, bboxWu, span_used, wGeom)。"""
    seed = 20261005 + lv * 7717
    fp = ld.FOOTPRINTS[(lv - 1) // 10 % len(ld.FOOTPRINTS)][0]
    if span is None:                      # 自适应（与 build 同口径）
        sp = ORIG_SPAN
        for _ in range(16):
            probe, _c = ld.gen_pattern(n, L, seed, fp, 0, sp)
            px0, py0, px1, py1 = ld.bbox_wu(probe)
            wg = min(ld.SAFE * ld.FILL_MAX / (px1 - px0), ld.SAFE * ld.FILL_MAX / (py1 - py0))
            if wg >= ld.W_MIN or sp <= 0.08:
                break
            sp = max(0.08, sp * 0.93)
    else:
        sp = span
    best = None
    for v in range(tries):
        tiles, counts = ld.gen_pattern(n, L, seed, fp, v, sp)
        u = ld.uniformity(tiles)
        s = ld.uni_score(u)
        if best is None or s < best[0]:
            best = (s, tiles, counts, u)
    _, tiles, counts, u = best
    x0, y0, x1, y1 = ld.bbox_wu(tiles)
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    for t in tiles:
        t['x'] -= mx
        t['y'] -= my
    x0, y0, x1, y1 = ld.bbox_wu(tiles)
    bw, bh = x1 - x0, y1 - y0
    wg = min(ld.SAFE * ld.FILL_MAX / bw, ld.SAFE * ld.FILL_MAX / bh)
    w = max(ld.W_MIN, min(ld.W_MAX, min(wg, ld.CURVE_CAP[L])))
    cover = ld.cover_ratios(tiles)
    n_live, n_strict = ld.live_counts(cover)
    return dict(w=round(w), nLive=n_live, ratio=n_live / n, strict=n_strict,
                bbox=(round(bw, 2), round(bh, 2)), span=round(sp, 3),
                wg=round(wg, 1), cvn=round(u['cvNorm'], 3))


TARGETS = [(21, 120, 9), (25, 129, 9), (27, 132, 10), (30, 138, 10)]

print('=' * 112)
print('A · 基线（当前 v6 参数：expo=0.30 / FILL_MAX=0.90 / ASP_HI=1.42 / span 自适应）')
print('=' * 112)
set_env()
base = {}
for lv, n, L in TARGETS:
    r = run_level(lv, n, L)
    base[lv] = r
    print(f"  L{lv:<3} n={n:<4} L={L:<3} w={r['w']:<4} 可点={r['nLive']:<4} "
          f"({r['ratio']*100:5.1f}%) 严={r['strict']:<3} span={r['span']:<5} "
          f"bbox={r['bbox']} 几何解={r['wg']} 离散={r['cvn']}")

print()
print('=' * 112)
print('B · 单一杠杆扫描（其余保持基线）')
print('=' * 112)
for name, kwargs, sp in [
    ('ASP_HI 1.42→1.60', dict(asp_hi=1.60), None),
    ('ASP_HI 1.42→1.80', dict(asp_hi=1.80), None),
    ('FILL 0.90→0.94', dict(fill=0.94), None),
    ('FILL 0.90→0.96', dict(fill=0.96), None),
    ('expo 0.30→0.20', dict(expo=0.20), None),
    ('expo 0.30→0.12', dict(expo=0.12), None),
    ('span 固定 2.40', dict(), 2.40),
]:
    set_env(**kwargs)
    print(f"\n-- {name}")
    for lv, n, L in TARGETS:
        r = run_level(lv, n, L, span=sp)
        b = base[lv]
        d = r['nLive'] - b['nLive']
        print(f"  L{lv:<3} w={r['w']:<4} 可点={r['nLive']:<4} ({r['ratio']*100:5.1f}%) "
              f"Δ={d:+4d}  严={r['strict']:<3} span={r['span']:<5} "
              f"bbox={r['bbox']} 几何解={r['wg']} 离散={r['cvn']}")

set_env()
