#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""27 张牌面成品 · 几何实测（第 28 轮 · A2 的第一步）

量什么（每张一张）：
  · 画布尺寸 W×H
  · 牌体 bbox（不含背景白与投影）
  · 牌体在画布中的占比（bw/W, bh/H）
  · 牌体宽高比 bw/bh          ← 这一项是"三张并排不齐"的直接原因
  · 背景色（四角中位数）
  · 牌体占高（bh/H）与"上/下留白"（用于决定归一化时的对齐基线）

判据口径：
  背景 = 四角 24×24 区域的中位数色。
  ★ 前景主判据 = **色偏（max(R,G,B) − min(R,G,B)）> DEV_T**（默认 7）。
     为什么不用"与背景色距离"：牌面下方/右侧的**投影是中性灰**，与背景的 L1 距离可达 150+，
     会被误判成牌体 → bbox 虚胖、右侧留白恒为 0（第 28 轮踩过）。
     而牌体无论米白玉体、金色框、朱红/墨绿图案，**色偏都 ≥ 20**，阴影色偏仅 2~4 → 天然分离。
  填补 = 闭运算（膨胀后腐蚀），补回米白高光处的细小孔洞。
  投影统计用"该列/行前景像素数 > 画布 1.5%"。

用法：
  python tile_measure.py            # 打印 27 张表格 + 分花色汇总
  python tile_measure.py --mask 3   # 另存前 3 张的 mask 预览图（目视验证判据）
"""
import sys, glob, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
BASE = os.path.join(ROOT, 'assets/_src/game-play/tiles')
SPE = [('wan', '万'), ('tiao', '条'), ('tong', '筒')]
DEV_T = 7       # 色偏阈值（牌体暖色 ≥20，阴影/背景 ≤4）
NOISE = 0.015   # 列/行前景占比阈值
SAVE_MASK = '--mask' in sys.argv


def measure(path):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int16)

    # 背景色 = 四角 24×24 中位数（仅用于报告，不参与判定）
    corners = np.concatenate([
        a[:24, :24].reshape(-1, 3), a[:24, -24:].reshape(-1, 3),
        a[-24:, :24].reshape(-1, 3), a[-24:, -24:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)

    # 前景掩码：色偏 > DEV_T
    dev = a.max(axis=2) - a.min(axis=2)
    m = (dev > DEV_T).astype(np.uint8) * 255

    # 闭运算填补（先膨胀后腐蚀），消掉高光造成的小孔
    mi = Image.fromarray(m).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    m = (np.asarray(mi) > 127)

    colsum = m.sum(axis=0); rowsum = m.sum(axis=1)
    cols = np.where(colsum > H * NOISE)[0]
    rows = np.where(rowsum > W * NOISE)[0]
    if not len(cols) or not len(rows):
        return None
    x0, x1 = int(cols[0]), int(cols[-1])
    y0, y1 = int(rows[0]), int(rows[-1])
    bw, bh = x1 - x0 + 1, y1 - y0 + 1

    return dict(W=W, H=H, bg=tuple(int(v) for v in bg), x0=x0, x1=x1, y0=y0, y1=y1,
                bw=bw, bh=bh, ratio=bw / bh, occW=bw / W, occH=bh / H,
                topPad=y0 / H, botPad=(H - 1 - y1) / H,
                leftPad=x0 / W, rightPad=(W - 1 - x1) / W), m


def main():
    all_rows = []
    saved = 0
    print('════ 27 张牌面 · 几何实测（色偏阈值 %d）════\n' % DEV_T)
    for sp, cn in SPE:
        fs = sorted(glob.glob(os.path.join(BASE, sp, '*.png')))
        fs = [f for f in fs if '-raw' not in os.path.basename(f)]
        print(f'── {cn}（{len(fs)} 张）' + '─' * 46)
        print('   %-8s %-12s %-12s %-7s %-7s %-7s %s' %
              ('牌', '画布', '牌体 bbox', 'bw/bh', '占宽', '占高', '左右留白'))
        for f in fs:
            r, m = measure(f)
            nm = os.path.basename(f).replace('.png', '')
            if r is None:
                print('   %-8s 未检出前景！' % nm); continue
            all_rows.append((cn, nm, r))
            print('   %-8s %-12s %-12s %-7.3f %-7.1f%% %-7.1f%% %.1f%%/%.1f%%' % (
                nm, '%d×%d' % (r['W'], r['H']), '%d×%d' % (r['bw'], r['bh']),
                r['ratio'], r['occW'] * 100, r['occH'] * 100,
                r['leftPad'] * 100, r['rightPad'] * 100))
            if SAVE_MASK and saved < 3:
                outp = os.path.join(ROOT, 'docs-verify/game-5/game-play',
                                    'mask-preview-%d-%s.png' % (saved + 1, nm))
                Image.fromarray((m * 255).astype(np.uint8)).save(outp)
                saved += 1
        print()

    # ── 汇总：分花色 bw/bh 的极差（"齐不齐"的量化）─────────────────────────
    print('════ 汇总 · 牌体宽高比 bw/bh 的一致性 ════')
    print('   %-6s %-9s %-9s %-9s %-9s' % ('花色', '最小', '最大', '极差', '标准差'))
    for cn in ['万', '条', '筒']:
        rs = [r['ratio'] for c, _, r in all_rows if c == cn]
        print('   %-6s %-9.3f %-9.3f %-9.3f %-9.4f' % (cn, min(rs), max(rs), max(rs) - min(rs), float(np.std(rs))))

    print('\n════ 汇总 · 画布尺寸 ════')
    for cn in ['万', '条', '筒']:
        ws = [(r['W'], r['H']) for c, _, r in all_rows if c == cn]
        print('   %-6s %d 种尺寸：%s' % (cn, len(set(ws)), sorted(set(ws))))

    print('\n════ 汇总 · 牌体占高 occH（归一化的目标比例）════')
    for cn in ['万', '条', '筒']:
        os_ = [r['occH'] * 100 for c, _, r in all_rows if c == cn]
        print('   %-6s min %.1f%% · max %.1f%% · mean %.1f%%' % (cn, min(os_), max(os_), float(np.mean(os_))))

    print('\n计：27 张实测完成')


if __name__ == '__main__':
    main()
