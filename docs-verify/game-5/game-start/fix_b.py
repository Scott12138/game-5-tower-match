# -*- coding: utf-8 -*-
"""B 专项：用最大连通域把桌体与木地板/桌腿分开。"""
import numpy as np
from PIL import Image
from scipy import ndimage

f = 'generated-images/game-start-table-v2/Photorealistic_top_down_orthog_2026-10-04T15-20-27.png'
im = Image.open(f).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.float32) / 255.0
lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = a.max(-1); mn = a.min(-1); d = mx - mn
s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
h = np.zeros_like(mx); nz = d > 1e-6
i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
h[int(H * 0.92):, int(W * 0.78):] = 0

def largest_bbox(mask, name):
    lb, n = ndimage.label(mask)
    if n == 0:
        print('  %s: 空' % name); return None
    sizes = ndimage.sum(mask, lb, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    ys, xs = np.where(lb == k)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    print('  %s: 最大域 #%d 面积 %d (占全图 %.1f%%)  bbox %d×%d 比%.3f  x %d~%d y %d~%d'
          % (name, k, int(sizes[k - 1]), sizes[k - 1] / (W * H) * 100,
             x1 - x0 + 1, y1 - y0 + 1, (x1 - x0 + 1) / (y1 - y0 + 1), x0, x1, y0, y1))
    return x0, y0, x1, y1

print('B:')
# 毡面（绿）
largest_bbox((h > 95) & (h < 175) & (s > 0.22) & (lum > 0.10), '绿毡面')
# 桌体（比背景亮）
for t in (0.14, 0.18, 0.22):
    largest_bbox(lum > t, '亮部 t=%.2f' % t)
# 木框（暖褐 + 中等饱和 + 中等亮）
largest_bbox((h > 10) & (h < 50) & (s > 0.25) & (lum > 0.14) & (lum < 0.75), '暖褐木框')

Image.fromarray((((h > 95) & (h < 175) & (s > 0.22) & (lum > 0.10)) * 255).astype(np.uint8)).resize((512, 768)).save('docs-verify/game-5/game-start/proc/masks/B_felt.png')
Image.fromarray(((lum > 0.14) * 255).astype(np.uint8)).resize((512, 768)).save('docs-verify/game-5/game-start/proc/masks/B_lum014.png')
print('已存调试 mask')
