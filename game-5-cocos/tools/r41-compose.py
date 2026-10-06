#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
r41-compose.py · 把真机前景层叠到三款候选样底上，出「同机位对照」图

输入：<bgdir>/A|B|C-page.png（候选样底 1263×2781）+ <fgpng>（真机前景 RGBA）
输出：<outdir>/now|A|B|C-page.png   合成页（候选样底 + **真实页面内容**）
      <outdir>/zoom-now|A|B|C.png   底色本身 1:1 裁片 190×190（判"细腻度"用）
      <outdir>/metrics.json         桌外 4 条空白带的亮度对账

【坐标口径】全部是**物理 px**（1263×2781）。桌子实测纵向占 788~2047，
空白带取在 HUD 与桌子之间 / 桌子与槽位之间（用前景 alpha 行占比核过）。
"""
import json
import os
import sys

import numpy as np
from PIL import Image

BG = sys.argv[1]
FG = sys.argv[2]
OUT = sys.argv[3]
os.makedirs(OUT, exist_ok=True)

fg = Image.open(FG).convert('RGBA')
W, H = fg.size

# 桌外空白带（物理 px）—— 均已核对过不含任何前景元素
ROIS = {
    '上带(表上方)': (100, 300, 1160, 500),
    '中带(表上方下)': (100, 590, 1160, 770),
    '下带(表下方)': (100, 2060, 1160, 2170),
    '底带(道具栏下)': (100, 2545, 1160, 2770),
    '左缘': (0, 800, 70, 2000),
    '右缘': (1195, 800, 1263, 2000),
}

metrics = {}


def compose(bg_img, name):
    arr = np.asarray(bg_img.convert('RGB'), np.float32).mean(axis=2)
    m = {k: round(float(arr[y0:y1, x0:x1].mean()), 2) for k, (x0, y0, x1, y1) in ROIS.items()}
    m['全屏均值'] = round(float(arr.mean()), 2)
    metrics[name] = m

    # 1:1 底色裁片（判纹理细腻度）—— 取"实际会被看见"的左中区域
    zx, zy, z = 60, 1300, 190
    bg_img.convert('RGB').crop((zx, zy, zx + z, zy + z)).save(os.path.join(OUT, f'zoom-{name}.png'))

    base = bg_img.convert('RGB').copy()
    base.paste(fg, (0, 0), fg)
    base.save(os.path.join(OUT, f'{name}-page.png'))


compose(Image.new('RGB', (W, H), (0, 0, 0)), 'now')
for k in ['A', 'B', 'C']:
    compose(Image.open(f'{BG}/{k}-page.png'), k)

with open(os.path.join(OUT, 'metrics.json'), 'w') as f:
    json.dump(metrics, f, ensure_ascii=False, indent=2)

print('%-6s %-9s %-9s %-9s %-9s' % ('', '上带', '中带', '下带', '左缘'))
for k in ['now', 'A', 'B', 'C']:
    m = metrics[k]
    print('%-6s %-9s %-9s %-9s %-9s  全屏 %s' % (
        k, m['上带(表上方)'], m['中带(表上方下)'], m['下带(表下方)'], m['左缘'], m['全屏均值']))
