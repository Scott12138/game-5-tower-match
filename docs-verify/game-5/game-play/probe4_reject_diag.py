#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断：为什么 L28~L30 没选到天际线抬升的候选。逐个 (ts,R) 打印门槛值。"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ld', os.path.join(HERE, 'level_design.py'))
ld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ld)

for lv, n, L in [(30, 138, 10), (28, 135, 10), (21, 120, 9), (15, 105, 8)]:
    seed = 20261005 + lv * 7717
    fp = ld.FOOTPRINTS[(lv - 1) // 10 % len(ld.FOOTPRINTS)][0]
    print('=' * 100)
    print(f"L{lv}  n={n} L={L}  footprint p={fp}")
    for ts in ld.TOP_SHARE_TRIES:
        counts, segs = ld.plan_segments(n, L, ts)
        row = f"  ts={ts:<5} 层分布={'/'.join(str(c) for c in counts):<34} 段={'+'.join(str(s['n']) for s in segs):<14}"
        for R in ld.SHIFT_TRIES:
            span, wg = ld.find_span(counts, L, seed, fp, R)
            bt = None
            for v in range(ld.MAX_PATTERN_TRY):
                t, _c = ld.gen_pattern(n, L, seed, fp, v, span, R, counts)
                ld.center_tiles(t)
                u = ld.uniformity(t)
                s = ld.uni_score(u)
                if bt is None or s < bt[0]:
                    bt = (s, t, u)
            _, t, u = bt
            cov = ld.cover_ratios(t)
            nl, ns = ld.live_counts(cov)
            ok_geo = wg >= ld.W_MIN - 1e-9
            ok_u = (u['cvNorm'] <= ld.CVN_LIMIT and u['qbal'] <= ld.QBAL_LIMIT)
            x0, y0, x1, y1 = ld.bbox_wu(t)
            row += (f"\n      R={R:<5} span={span:.3f} wg={wg:6.1f} "
                    f"{'geo✅' if ok_geo else 'geo❌'} "
                    f"可点={nl:>3}({nl/n*100:4.1f}%) cvn={u['cvNorm']:.3f}{'✅' if u['cvNorm']<=ld.CVN_LIMIT else '❌'} "
                    f"qbal={u['qbal']:.3f}{'✅' if u['qbal']<=ld.QBAL_LIMIT else '❌'} "
                    f"uni={'✅' if ok_u else '❌'} bbox=({x1-x0:.2f},{y1-y0:.2f})")
        print(row)
