#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""27 张牌面 · 统一几何框对齐检查（第 28 轮 · A2 实测）

目的：验证一条假设 —— 「27 张成品都遵循同一个构图规格：3:4 画布 + 牌体居中 +
占宽 75% / 占高 79.7%」。若成立，则归一化时**无需逐张检测 bbox**，
直接用统一几何框裁切即可（这对"背景不纯、无法可靠检测"的万字批次尤其关键）。

做法：每张缩到统一高度，叠加「占宽 75% / 占高 79.7% / 居中」的红框，
      万 / 条 / 筒 三行各 9 张拼成一张总图，供目视判断框是否正对牌体轮廓。

用法：python tile_frame_check.py
产出：frame-check-27.png（供目视 + 作为交付证据）
"""
import glob, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
BASE = os.path.join(ROOT, 'assets/_src/game-play/tiles')
OUT = os.path.join(ROOT, 'docs-verify/game-5/game-play', 'frame-check-27.png')
SPE = [('wan', 'W'), ('tiao', 'T'), ('tong', 'G')]
TH = 300          # 每张缩略图高度
OCC_W = 0.750     # 假设：牌体占画布宽
OCC_H = 0.797     # 假设：牌体占画布高
GAP = 8


def main():
    rows = []
    for sp, tag in SPE:
        fs = sorted(f for f in glob.glob(os.path.join(BASE, sp, '*.png')) if '-raw' not in f)
        row = []
        for i, f in enumerate(fs, 1):
            im = Image.open(f).convert('RGB')
            w, h = im.size
            nw = max(1, int(round(w * TH / h)))
            im = im.resize((nw, TH), Image.LANCZOS)
            d = ImageDraw.Draw(im)
            bw, bh = nw * OCC_W, TH * OCC_H
            x0, y0 = (nw - bw) / 2, (TH - bh) / 2
            d.rectangle([x0, y0, x0 + bw - 1, y0 + bh - 1], outline=(255, 0, 0), width=2)
            d.text((4, 4), '%s%d  %dx%d' % (tag, i, w, h), fill=(200, 0, 0))
            row.append(im)
        rows.append(row)

    W = max(sum(i.width for i in r) + GAP * (len(r) - 1) for r in rows)
    H = TH * len(rows) + GAP * (len(rows) - 1)
    canvas = Image.new('RGB', (W, H), (250, 250, 250))
    y = 0
    for r in rows:
        x = 0
        for im in r:
            canvas.paste(im, (x, y)); x += im.width + GAP
        y += TH + GAP
    canvas.save(OUT)
    print('产出：%s  %dx%d' % (OUT, canvas.width, canvas.height))
    print('红框 = 假设的统一几何框（占宽 %.1f%% / 占高 %.1f%% / 居中）' % (OCC_W * 100, OCC_H * 100))
    print('判读：框应正好贴住牌体外轮廓（含厚度侧面）；若某张明显偏离 → 该张构图不合规，需单独处理。')


if __name__ == '__main__':
    main()
