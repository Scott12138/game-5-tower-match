#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_r60-sig.py · 牌面「亮度 / 饱和」签名（供 _r60-verify.mjs 做新旧差分）

口径与运行期探针**逐字一致**（否则两侧数字没有可比性）：
  · 只统计 alpha > 200 的不透明像素
  · 亮度 = 0.2126R + 0.7152G + 0.0722B（sRGB 编码值上直接算，不转线性）
  · 饱和 = (max-min)/max，逐像素后取均值
用法：python tools/_r60-sig.py <png> [png...]   → 每行一个 JSON
"""
import json
import sys

import numpy as np
from PIL import Image


def sig(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)
    m = a[:, :, 3] > 200
    if not m.any():
        return {'path': path, 'err': 'no-opaque-pixel'}
    rgb = a[:, :, :3][m]
    lum = float((0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]).mean())
    mx = rgb.max(1)
    mn = rgb.min(1)
    mx[mx == 0] = 1
    sat = float(((mx - mn) / mx).mean())
    return {'path': path, 'lum': lum, 'sat': sat, 'px': int(m.sum())}


for p in sys.argv[1:]:
    print(json.dumps(sig(p), ensure_ascii=False))
