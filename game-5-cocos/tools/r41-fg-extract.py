#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
r41-fg-extract.py · 从真机 3x 截图里抠出「前景层」(带 alpha)

原理：主玩页的桌外底色当前是 **纯 #000000 满铺**（GamePage.buildEnv 的 EnvFx），
所以「像素最大通道值」就是天然的 alpha 通道 —— 纯黑=全透明，其余按亮度渐进。
这样抠出来的前景（麻将桌 / 牌堆 / HUD / 槽位 / 道具栏）不带任何底色残留，
可以直接叠到任意候选样底上做对比。

用法：
    python r41-fg-extract.py <in.png> <out.png> [K]
      K = alpha 归一化阈值（最大通道 >= K 即完全不透明），默认 12
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 12

im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float32)
mx = a.max(axis=2)

# alpha：亮度线性 → 半透明过渡只出现在"很暗的边缘/光晕"上
alpha = np.clip(mx / float(K), 0.0, 1.0)

# 颜色保持不变（**不做 premultiply 反解**）：这些前景元素本身都远亮于 K，
# alpha 恒为 1，颜色不会失真；只有 <K 的极暗光晕会被压暗，那部分本来就该融进新底。
rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(dst)

# ---- 自检：统计 ----
tot = alpha.size
print('[i] %s -> %s' % (src, dst))
print('    alpha==0 : %6.2f%%' % (100 * (alpha <= 0.001).mean()))
print('    alpha==1 : %6.2f%%' % (100 * (alpha >= 0.999).mean()))
print('    0<a<1    : %6.2f%%' % (100 * ((alpha > 0.001) & (alpha < 0.999)).mean()))
print('    size     : %d x %d' % (im.size[0], im.size[1]))
