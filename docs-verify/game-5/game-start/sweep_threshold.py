# -*- coding: utf-8 -*-
"""阈值扫描：给三张桌图找出能把"桌面+桌框"与背景/桌腿分开的亮度阈值。"""
import glob, os
import numpy as np
from PIL import Image

BASE = 'generated-images/game-start-table-v2'
OUT = 'docs-verify/game-5/game-start/proc/masks'
os.makedirs(OUT, exist_ok=True)
KEY = {'15-20-03': 'A', '15-20-27': 'B', '15-20-46': 'C'}


def table_bbox(lum, t):
    H, W = lum.shape
    m = lum > t
    m[int(H * 0.92):, int(W * 0.78):] = False
    cs = m.sum(0)
    if cs.max() == 0:
        return None
    on = np.where(cs > 0.35 * cs.max())[0]
    x0, x1 = int(on.min()), int(on.max())
    rs = m[:, x0:x1 + 1].sum(1)
    on2 = np.where(rs > 0.35 * rs.max())[0]
    return x0, int(on2.min()), x1, int(on2.max())


for f in sorted(glob.glob(os.path.join(BASE, '*.png'))):
    code = KEY.get(f.split('T')[-1][:8], '?')
    im = Image.open(f).convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    print('=== ' + code)
    for t in (0.10, 0.14, 0.18, 0.22, 0.26, 0.30):
        bb = table_bbox(lum, t)
        if not bb:
            print('  t=%.2f  空' % t); continue
        x0, y0, x1, y1 = bb
        w, h = x1 - x0 + 1, y1 - y0 + 1
        flag = ' ✓方' if 0.95 < w / h < 1.05 else ''
        print('  t=%.2f  %4d×%4d  比%.3f  x %d~%d y %d~%d%s' % (t, w, h, w / h, x0, x1, y0, y1, flag))
    # 存一张 mask 便于目视（用 0.18）
    m = (lum > 0.18).astype(np.uint8) * 255
    m[int(lum.shape[0] * 0.92):, int(lum.shape[1] * 0.78):] = 0
    Image.fromarray(m).resize((512, 768)).save(os.path.join(OUT, 'mask_%s_t18.png' % code))
