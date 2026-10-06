# -*- coding: utf-8 -*-
"""量麻将桌出图的几何：桌面 bbox / 正方形度 / 毡面色 / 圆盘圆心与半径 / 外围底色。
用途：定裁切框、定圆盘在游戏坐标里的落点、给代码层背景取色。"""
import glob, os
import numpy as np
from PIL import Image

BASE = 'generated-images/game-start-table-v2'

def hsv(rgb):
    """rgb: (N,3) 0-1 -> h(0-360) s v"""
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    mx = rgb.max(1); mn = rgb.min(1); d = mx - mn
    v = mx; s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    nz = d > 1e-6
    idx = nz & (mx == r); h[idx] = (60 * ((g[idx] - b[idx]) / d[idx])) % 360
    idx = nz & (mx == g); h[idx] = 60 * ((b[idx] - r[idx]) / d[idx]) + 120
    idx = nz & (mx == b); h[idx] = 60 * ((r[idx] - g[idx]) / d[idx]) + 240
    return h, s, v

for f in sorted(glob.glob(os.path.join(BASE, '*.png'))):
    im = Image.open(f).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mask = lum > 0.12
    # 屏蔽右下角水印带（亮字会污染 bbox）
    mask[int(H * 0.93):, int(W * 0.80):] = False
    ys, xs = np.where(mask)
    bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = bx1 - bx0 + 1, by1 - by0 + 1

    cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
    # 圆盘：在桌面中央 60% 区域内找金色像素
    x0, x1 = int(cx - bw * 0.30), int(cx + bw * 0.30)
    y0, y1 = int(cy - bh * 0.30), int(cy + bh * 0.30)
    sub = a[y0:y1, x0:x1]
    h_, s_, v_ = hsv(sub.reshape(-1, 3))
    gold = ((h_ > 28) & (h_ < 62) & (s_ > 0.30) & (v_ > 0.35)).reshape(sub.shape[:2])
    gys, gxs = np.where(gold)
    if len(gxs):
        gcx, gcy = x0 + gxs.mean(), y0 + gys.mean()
        # 环外径 = 距圆心最远金色像素
        rr = np.sqrt((x0 + gxs - gcx) ** 2 + (y0 + gys - gcy) ** 2)
        ring_r = np.percentile(rr, 99)
    else:
        gcx = gcy = ring_r = float('nan')

    # 毡面色：圆盘外侧一圈（0.42~0.50 半边宽的方环）
    yy, xx = np.mgrid[by0:by1, bx0:bx1]
    d = np.sqrt(((xx - (bx0 + bx1) / 2) / (bw / 2)) ** 2 + ((yy - (by0 + by1) / 2) / (bh / 2)) ** 2)
    felt = a[by0:by1, bx0:bx1][(d > 0.30) & (d < 0.55)]
    felt_med = np.median(felt, 0) * 255
    # 外围底色：画面四角
    corner = np.median(np.concatenate([
        a[0:20, 0:20].reshape(-1, 3), a[0:20, -20:].reshape(-1, 3),
        a[-20:, 0:20].reshape(-1, 3)]), 0) * 255

    print('=== ' + os.path.basename(f))
    print('  画布 %dx%d  桌面 bbox=(%d,%d)-(%d,%d)  %dx%d  宽高比 %.4f'
          % (W, H, bx0, by0, bx1, by1, bw, bh, bw / bh))
    print('  桌面占画布宽 %.1f%%  垂直居中偏移 %+d px' % (bw / W * 100, cy - H // 2))
    print('  圆盘 圆心=(%.0f,%.0f)  外半径=%.0f  直径=%.0f  占桌面边长 %.1f%%'
          % (gcx, gcy, ring_r, ring_r * 2, ring_r * 2 / bw * 100))
    print('  圆盘圆心相对桌面中心偏移 (%+.0f, %+.0f)' % (gcx - (bx0 + bx1) / 2, gcy - (by0 + by1) / 2))
    print('  毡面中位色 rgb(%.0f,%.0f,%.0f)  #%02X%02X%02X' % (*felt_med, *felt_med.astype(int)))
    print('  外围底色   rgb(%.0f,%.0f,%.0f)  #%02X%02X%02X' % (*corner, *corner.astype(int)))
