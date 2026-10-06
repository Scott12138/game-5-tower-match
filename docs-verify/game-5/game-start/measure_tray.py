# -*- coding: utf-8 -*-
"""量骰盘的径向结构：金环内外半径、盘底可用半径。
以圆心为原点沿 8 个方向径向采样，取中位数，避免单方向被云纹/高光污染。
"""
import numpy as np
from PIL import Image

a = np.asarray(Image.open('assets/game-start/table_default.jpg').convert('RGB')).astype(np.float32)
H, W = a.shape[:2]
CX, CY = 373.0, 376.0


def hsv(arr):
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx = arr.max(-1); mn = arr.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0); v = mx
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def sample(ang_deg, r):
    t = np.radians(ang_deg)
    x = int(round(CX + r * np.cos(t))); y = int(round(CY + r * np.sin(t)))
    if 0 <= x < W and 0 <= y < H:
        return a[y, x]
    return None


angles = list(range(0, 360, 15))
gold_r = {ang: [] for ang in angles}
prof = []
for r in range(6, 132, 1):
    row = [sample(ang, r) for ang in angles]
    row = [p for p in row if p is not None]
    if not row:
        continue
    arr = np.array(row)
    h, s, v = hsv(arr / 255.0)
    # 金色判据：暖色相 + 中高饱和 + 中高亮度
    is_gold = (h > 26) & (h < 66) & (s > 0.30) & (v > 0.30)
    gcount = int(is_gold.sum())
    prof.append((r, gcount, gcount / len(row)))
    for ang, p in zip([x for x in angles], row):
        pass

# 金环 = 多数方向判为金的半径区间
gold_ring = [r for r, c, f in prof if f > 0.55]
print('径向剖面（半径 : 判金方向占比）')
for r, c, f in prof:
    if r % 6 == 0:
        bar = '█' * int(f * 30)
        print('  r=%3d  %4.0f%%  %s' % (r, f * 100, bar))

if gold_ring:
    print('')
    print('金环半径区间：内 %d → 外 %d（环宽 %d）' % (min(gold_ring), max(gold_ring), max(gold_ring) - min(gold_ring)))
    r_in = min(gold_ring); r_out = max(gold_ring)
    print('盘内可用半径（金环内侧再让 8px 阴影过渡）：%d  → 可用直径 %d 设计值' % (r_in - 8, (r_in - 8) * 2))
    print('金环外半径 %d → 外径 %d 设计值（台账记 228.4 → 半径 114.2）' % (r_out, r_out * 2))

    # 几何约束：两颗骰子在盘内不重叠、不压金环
    R = r_in - 8
    print('')
    print('两颗骰子摆放的几何上限（盘内可用半径 R=%d）：' % R)
    print('  %-6s %-10s %-12s %-12s %s' % ('边长S', '中心距d', '布置', '最远点半径', '判定'))
    for S in (52, 56, 60, 64, 68, 72, 76, 84):
        for d in (int(S * 1.30), int(S * 1.45)):
            dx = d / 2 / np.sqrt(2)
            far = np.hypot(dx + S / 2, dx + S / 2)
            print('  %-6d %-10d %-12s %-12.1f %s'
                  % (S, d, '对角', far, '✓ 放得下' if far <= R else '✗ 压金环'))

# 盘内底实测色（用于对比度判断）
inner = a[int(CY - 30):int(CY + 30), int(CX - 30):int(CX + 30)].reshape(-1, 3).mean(0)
print('')
print('盘底实测色 #%02X%02X%02X' % tuple(inner.round().astype(int)))
