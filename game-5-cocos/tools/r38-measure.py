#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r38-measure.py · 第 38 轮：四张真机截图的**关键元素几何实测**。

【为什么不能目测】
  用户给的 4 张图是 1264×2780 真机物理截图，缩小到聊天窗口后目测误差可达 ±80 物理 px
  （= ±47 设计 px），而本轮要判的恰恰是"偏了多少"——目测给出的数会直接把结论带偏。

【口径】
  物理 px → 设计 px：k = 750 / 1264 = 0.59335（fitWidth，可视宽恒为 750）
  ⚠️ 真机可视高 = 750 / (1264/2780) = 1651.43 设计 px，**不是**设计稿的 1334。
  所有"设计 y"都是**真机口径**（屏幕顶 = 0）。
"""
import sys
import numpy as np
from PIL import Image

K = 750.0 / 1264.0
VIS_H = 750.0 / (1264.0 / 2780.0)


def design(px_val):
    return round(px_val * K, 1)


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)


def masks(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    green = (g > r + 16) & (g > b + 6) & (lum > 30)
    gold = (r > 110) & (r > b + 28) & (g > b + 8) & (lum > 95)
    white = (r > 195) & (g > 190) & (b > 175)
    return green, gold, white, lum


def rowspan(m, thresh=6):
    """返回 mask 按行统计 > thresh 的首/末行"""
    rows = m.sum(axis=1)
    idx = np.nonzero(rows > thresh)[0]
    if len(idx) == 0:
        return None
    return int(idx[0]), int(idx[-1])


def band_report(name, m, thresh=6, step=20):
    rows = m.sum(axis=1)
    out = []
    idx = np.nonzero(rows > thresh)[0]
    if len(idx) == 0:
        return f'{name}: (none)'
    # 找连续段
    segs = []
    s = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i - prev > 12:
            segs.append((s, prev))
            s = i
        prev = i
    segs.append((s, prev))
    for a, b in segs:
        if b - a < 8:
            continue
        out.append(f'   物理 y {a:5d}–{b:5d}  设计 y {design(a):7.1f}–{design(b):7.1f}  高 {design(b-a):6.1f}')
    return f'{name}:\n' + ('\n'.join(out) if out else '    (too thin)')


def report(path, tag):
    a = load(path)
    green, gold, white, lum = masks(a)
    print(f'\n===== {tag} =====  {path.split("/")[-1]}  {a.shape[1]}×{a.shape[0]}  可视高设计 {VIS_H:.1f}')
    print(band_report('绿绒带', green))
    print(band_report('金色带', gold, thresh=30))
    print(band_report('亮白带', white, thresh=20))


if __name__ == '__main__':
    for p, t in zip(sys.argv[1::2], sys.argv[2::2]):
        report(p, t)
