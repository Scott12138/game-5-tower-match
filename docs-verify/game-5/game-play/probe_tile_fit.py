#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L1 + L4 落地前的「溢出自检」（第 33 轮 · 新建）

背景（用户第 33 轮拍板）：
  · L1：27 张统一按 **224×298** 输出（各关由 CSS 缩，缩比 0.786~1.0，规格唯一）
  · L4：牌体占位口径 `OCC_H: 0.804 → 1.0`（牌体紧贴画布）

**风险**：`tile_normalize.py` 的归一化是「等比缩放到 *牌体高* = CANVAS_H × OCC_H」，于是

    牌体宽 tw = (bw/bh) × CANVAS_H × OCC_H

而 27 张牌体的**自身长宽比 bw/bh 并不一致**（条/筒 ≈ 0.699，万字 0.68~0.82）。
只要 `tw > CANVAS_W` 就会**横向溢出、被画布裁掉**（边缘啃掉一块，且不可逆）。

本脚本量出 27 张的真实 bw/bh，并给出：
  · 画布 224×298 下的**最大安全 OCC_H**
  · 若干 OCC_H 档位下，有哪几张会溢出、各溢出多少 px
  · 反解：若坚持 OCC_H = 1.0，画布至少要多少宽

用法：/usr/bin/python3 probe_tile_fit.py
"""
import os
import glob
import numpy as np
from PIL import Image

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
SRC = os.path.join(ROOT, 'assets/_src/game-play/tiles')
SPE = [('wan', '万'), ('tiao', '条'), ('tong', '筒')]
EDGE_T, EDGE_FRAC = 40, 0.45


def edge_bbox(a):
    """边缘密度法（与 tile_normalize.py 完全同源，保证口径一致）。"""
    H, W = a.shape[:2]
    dv = np.abs(a[6:] - a[:-6]).sum(2)
    dh = np.abs(a[:, 6:] - a[:, :-6]).sum(2)
    rowd = (dv > EDGE_T).sum(1)
    cold = (dh > EDGE_T).sum(0)
    rows = np.where(rowd > W * EDGE_FRAC)[0]
    cols = np.where(cold > H * EDGE_FRAC)[0]
    if not len(rows) or not len(cols):
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 6, int(rows[-1]) + 6


def measure():
    rows = []
    for sp, cn in SPE:
        for f in sorted(g for g in glob.glob(os.path.join(SRC, sp, '*.png'))
                        if '-raw' not in g):
            im = Image.open(f).convert('RGB')
            a = np.asarray(im).astype(np.int16)
            bb = edge_bbox(a)
            if bb is None:
                print('  ❌ %s 未检出 bbox' % f)
                continue
            x0, y0, x1, y1 = bb
            bw, bh = x1 - x0 + 1, y1 - y0 + 1
            rows.append({'sp': sp, 'cn': cn, 'nm': os.path.basename(f)[:-4],
                         'bw': bw, 'bh': bh, 'r': bw / bh})
    return rows


def main():
    rows = measure()
    n = len(rows)
    rs = [x['r'] for x in rows]
    rmin, rmax = min(rs), max(rs)

    print('══ ① 27 张牌体自身长宽比（源图 %s）══' % os.path.relpath(SRC, ROOT))
    print('%-4s %-8s %7s %7s %9s' % ('花色', '牌', 'bw', 'bh', 'bw/bh'))
    for x in rows:
        print('%-4s %-8s %7d %7d %9.3f' % (x['cn'], x['nm'], x['bw'], x['bh'], x['r']))
    print('\n  n=%d · bw/bh 区间 %.3f ~ %.3f（极差 %.3f）' % (n, rmin, rmax, rmax - rmin))
    for sp, cn in SPE:
        sub = [x['r'] for x in rows if x['sp'] == sp]
        print('  %s（%d 张）：%.3f ~ %.3f  %s'
              % (cn, len(sub), min(sub), max(sub),
                 '✅ 一致' if max(sub) - min(sub) < 1e-9 else '⚠ 不齐（L3 已知问题，本轮不处理）'))

    print('\n══ ② 画布 224×298 下的安全边界 ══')
    CW, CH = 224, 298
    print('  公式：tw = (bw/bh) × CH × OCC_H ；溢出条件 tw > CW')
    print('  ⇒ 最大安全 OCC_H = CW / (CH × max(bw/bh)) = %d / (%d × %.3f) = %.4f'
          % (CW, CH, rmax, CW / (CH * rmax)))
    print('  ★ 用户拍板的 OCC_H = 1.0 → 最宽那张 tw = %.1f px，超出画布 %.1f px ⇒ 会被裁'
          % (rmax * CH * 1.0, rmax * CH * 1.0 - CW))

    print('\n══ ③ 逐档验算（画布 224×298）══')
    print('%-8s %-8s %-10s %-10s %s' % ('OCC_H', '最宽tw', '溢出张数', '最大溢出px', '说明'))
    for occ in (1.00, 0.95, 0.92, 0.9167, 0.90, 0.85, 0.804):
        over = [(x['nm'], x['r'] * CH * occ - CW) for x in rows if x['r'] * CH * occ > CW]
        twmax = rmax * CH * occ
        note = '❌ 裁切' if over else '✅ 安全'
        if occ == 0.804:
            note += '（= 现口径）'
        print('%-8.4f %-8.1f %-10d %-10s %s'
              % (occ, twmax, len(over), ('%.1f' % max([o[1] for o in over])) if over else '0', note))

    print('\n  溢出明细（OCC_H = 1.0）：')
    over = [(x, x['r'] * CH * 1.0 - CW) for x in rows if x['r'] * CH * 1.0 > CW]
    if not over:
        print('    无')
    for x, o in over:
        print('    %-8s bw/bh %.3f → tw %.1f（超 %.1f px）' % (x['nm'], x['r'], x['r'] * CH, o))

    print('\n══ ④ 反解：坚持 OCC_H = 1.0，画布至少要多少宽 && 高 ══')
    print('  · 若高锁定 298：需要宽 ≥ %.0f px（实际取 264，留 4px 余量）'
          % (rmax * CH))
    print('  · 若宽锁定 224：需要高 ≤ %.0f px（= 224 / %.3f）' % (CW / rmax, rmax))
    print('  · 或：宽高都锁定 224×298，但改用「内切(contain)」口径 —— 宽牌按宽贴满、')
    print('    高牌按高贴满 ⇒ 不再裁切，代价是 **牌体高度会不齐**（与"高度一致、基线对齐"冲突）。')

    print('\n══ ⑤ 各档下「可见牌体」在页内的实际尺寸（供对账）══')
    for occ in (1.0, 0.9167):
        th = CH * occ
        print('  OCC_H=%.4f：牌体高 @2x %.1f → 页内高 %.1f' % (occ, th, th / 2))
        for lv, w in ((1, 112), (10, 88), (30, 88)):
            k = w / 112.0          # CSS 缩放比（L1：224×298 母版 → 该关牌位宽 w）
            print('     L%-2d 牌位 %d×%d：母版缩比 %.3f ⇒ 可见牌体宽 %.1f（居中匀分）'
                  % (lv, w, round(w * 4 / 3), k, rmin * CH * occ * k))


if __name__ == '__main__':
    main()
