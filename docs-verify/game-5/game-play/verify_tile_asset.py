#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 33 轮 · 牌面资产断言（224×298 母版 / 内切口径 / 零裁切）

为什么需要它：
  第 33 轮把画布从 192×256 抬到 224×298、占位口径从 `OCC_H=0.804` 提到 `1.0`。
  **危险点**：若字面按"牌体高 = 画布高"实现，7 张万字（bw/bh 0.757~0.822）会
  横向溢出画布被**裁掉**（最宽「九万」超 20.9px）—— 裁切真丢像素且不可逆。
  本脚本用**源图长宽比**反查成品是否被裁/被拉伸，作为"零裁切"的独立证据。

断言（全部自动，非目视）：
  A1 画布规格唯一 == 224×298（27/27）
  A2 每张可见宽 ≤ 224 且 可见高 ≤ 298（不越界）
  A3 **内切不变量**：每张至少一条边贴满（宽 100% 或 高 100%，±2px 容差）
  A4 **零裁切/零变形**：|成品 bw/bh − 源图 bw/bh| ≤ 0.012
  A5 旧母版已归档：`tiles-192x256-bak/` 存在且为 27 张 192×256（保留替换空间）
  A6 源图未被改动：`_src/.../tiles/*/*.png` 仍为 27 张且 ≥1024×1536
  A7 单画布规格 ⇒ 各关 CSS 缩比 = w/112（L1=1.000 · L10/L30=0.786）

用法：python3 verify_tile_asset.py        # 退出码 0 = 全绿
"""
import os, sys, glob
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tile_normalize import edge_bbox, CANVAS_W, CANVAS_H  # noqa: E402

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
SRC = os.path.join(ROOT, 'assets/_src/game-play/tiles')
DST = os.path.join(ROOT, 'assets/game-play/tiles')
BAK = os.path.join(ROOT, 'assets/game-play/tiles-192x256-bak')
SPE = [('wan', '万'), ('tiao', '条'), ('tong', '筒')]
RTOL = 0.012

fails = []


def chk(no, desc, ok, detail=''):
    print('  %-3s %-46s %s%s' % (no, desc, '✅' if ok else '❌', ('  ' + detail) if detail else ''))
    if not ok:
        fails.append('%s %s %s' % (no, desc, detail))


def out_bbox(p):
    im = Image.open(p).convert('RGBA')
    W, H = im.size
    a = np.asarray(im.split()[3])
    cols = np.where((a > 8).any(axis=0))[0]
    rows = np.where((a > 8).any(axis=1))[0]
    if not len(cols) or not len(rows):
        return W, H, 0, 0
    return W, H, int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1)


def src_bbox(p):
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.int16)
    bb = edge_bbox(a)
    if bb is None:
        return None
    x0, y0, x1, y1 = bb
    return x1 - x0 + 1, y1 - y0 + 1


def main():
    print('════ 第 33 轮 · 牌面资产断言（画布 %d×%d · OCC_H=1.0 内切）════\n'
          % (CANVAS_W, CANVAS_H))
    rows = []
    for sp, cn in SPE:
        for f in sorted(g for g in glob.glob(os.path.join(SRC, sp, '*.png')) if '-raw' not in g):
            nm = os.path.basename(f)
            op = os.path.join(DST, sp, nm)
            W, H, obw, obh = out_bbox(op)
            sb = src_bbox(f)
            rows.append((cn, nm, W, H, obw, obh, sb))

    print('① 逐张对账（成品 vs 源图）')
    print('   %-4s %-8s %-11s %-11s %-8s %-8s %s'
          % ('花色', '牌', '画布', '成品 bbox', '成品比', '源图比', '差'))
    for cn, nm, W, H, obw, obh, sb in rows:
        orat = obw / obh if obh else 0
        srat = sb[0] / sb[1] if sb else 0
        print('   %-4s %-8s %-11s %-11s %-8.4f %-8.4f %+.4f'
              % (cn, nm[:-4], '%d×%d' % (W, H), '%d×%d' % (obw, obh), orat, srat, orat - srat))
    print()

    print('② 断言')
    sizes = set((W, H) for _, _, W, H, _, _, _ in rows)
    chk('A1', '画布规格唯一 == %d×%d（%d 张）' % (CANVAS_W, CANVAS_H, len(rows)),
        sizes == {(CANVAS_W, CANVAS_H)}, '实测 %s' % sorted(sizes))

    over = [(nm, obw, obh) for _, nm, W, H, obw, obh, _ in rows if obw > W or obh > H]
    chk('A2', '每张可见尺寸不越画布', not over, '越界 %d 张' % len(over))

    no_touch = [(nm, obw, obh) for _, nm, W, H, obw, obh, _ in rows
                if not (obw >= W - 2 or obh >= H - 2)]
    chk('A3', '内切不变量：每张至少贴满一边', not no_touch, '未贴边 %d 张 %s' % (len(no_touch), no_touch))

    drift = [(nm, abs((obw / obh) - (sb[0] / sb[1])))
             for _, nm, W, H, obw, obh, sb in rows if sb and abs((obw / obh) - (sb[0] / sb[1])) > RTOL]
    chk('A4', '零裁切/零变形：|成品比 − 源图比| ≤ %.3f' % RTOL, not drift,
        '超差 %d 张 %s' % (len(drift), [(n, round(v, 4)) for n, v in drift]))

    baks = sorted(glob.glob(os.path.join(BAK, '*', '*.png')))
    baksz = set(Image.open(f).size for f in baks) if baks else set()
    chk('A5', '旧母版已归档且为 27 张 192×256', len(baks) == 27 and baksz == {(192, 256)},
        '实测 %d 张 %s' % (len(baks), sorted(baksz)))

    srcs = [f for sp, _ in SPE for f in glob.glob(os.path.join(SRC, sp, '*.png')) if '-raw' not in f]
    minw = min(Image.open(f).size[0] for f in srcs) if srcs else 0
    dts = [os.path.getmtime(f) for sp, _ in SPE for f in glob.glob(os.path.join(DST, sp, '*.png'))]
    untouched = max(os.path.getmtime(f) for f in srcs) < min(dts) if srcs and dts else False
    chk('A6', '源图未被改动（27 张 · ≥2× 画布宽 · mtime 早于成品）',
        len(srcs) == 27 and minw >= 2 * CANVAS_W and untouched,
        '实测 %d 张 · 最小宽 %d（需 ≥%d）· 源图早于成品 %s'
        % (len(srcs), minw, 2 * CANVAS_W, untouched))

    import json
    lv = json.load(open(os.path.join(ROOT, 'docs-verify/game-5/game-play/levels.json'), encoding='utf-8'))['levels']
    scale = {l['lv']: round(l['w'] / (CANVAS_W / 2), 3) for l in lv}
    ok7 = abs(scale[1] - 1.0) < 1e-6 and abs(scale[10] - 0.786) < 1e-3 and abs(scale[30] - 0.786) < 1e-3
    chk('A7', '各关 CSS 缩比 = w/112（1.000~0.786）', ok7,
        'L1=%.3f L10=%.3f L30=%.3f · 区间 %.3f~%.3f' % (scale[1], scale[10], scale[30],
                                                        min(scale.values()), max(scale.values())))

    print('\n%s' % ('════ 全绿 %d/%d ════' % (7 - len(fails), 7) if not fails
                    else '════ ❌ 失败 %d 项 ════\n' % len(fails)))
    for f in fails:
        print('  ❌ ' + f)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
