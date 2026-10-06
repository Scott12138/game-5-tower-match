# -*- coding: utf-8 -*-
"""透视自检 + 最终裁切。
判据：严格俯视 90° 的桌面，毡面在任意高度上的宽度应基本恒定（上下宽度差 < 2%）。
      宽度差大 = 斜视/透视，直接淘汰（会导致主玩页牌堆与槽位对不上）。"""
import glob, os, json
import numpy as np
from PIL import Image
from scipy import ndimage

BASE = 'generated-images/game-start-table-v2'
PROC = 'docs-verify/game-5/game-start/proc'
for d in (os.path.join(PROC, 'master'), os.path.join(PROC, 'engine'), os.path.join(PROC, 'masks')):
    os.makedirs(d, exist_ok=True)
KEY = {'15-20-03': ('A', '窄木边·极简雅致'), '15-20-27': ('B', '胡桃木宽边·手作'),
       '15-20-46': ('C', '錾刻金框·奢华')}


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    v = mx
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def biggest(mask):
    lb, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, lb, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    return lb == k


report = []
for f in sorted(glob.glob(os.path.join(BASE, '*.png'))):
    code, label = KEY.get(f.split('T')[-1][:8], ('?', '?'))
    im = Image.open(f).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.float32) / 255.0
    h, s, v = hsv(a)
    fm = (h > 95) & (h < 175) & (s > 0.22) & (v > 0.10)
    fm[int(H * 0.92):, int(W * 0.78):] = False
    felt = biggest(fm)
    ys, xs = np.where(felt)
    y0, y1 = ys.min(), ys.max()
    rows = []
    for yy in range(y0, y1 + 1):
        xr = np.where(felt[yy])[0]
        if len(xr) > 5:
            rows.append((yy, xr.min(), xr.max()))
    ys_ = np.array([r[0] for r in rows]); ws = np.array([r[2] - r[1] + 1 for r in rows])
    q1 = ws[ys_ < y0 + (y1 - y0) * 0.15].mean()
    q9 = ws[ys_ > y1 - (y1 - y0) * 0.15].mean()
    taper = abs(q1 - q9) / max(q1, q9) * 100
    touch = (xs.min() <= 1) or (xs.max() >= W - 2) or (ys.min() <= 1) or (ys.max() >= H - 2)
    fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
    fw, fh = fx1 - fx0 + 1, fy1 - fy0 + 1

    print('%s 毡面 %d×%d 比%.3f  顶部宽%.0f 底部宽%.0f 上下宽差 %.2f%%  贴边裁切=%s'
          % (code, fw, fh, fw / fh, q1, q9, taper, '是' if touch else '否'))
    ok = (taper < 2.0) and (not touch) and (0.95 < fw / fh < 1.05)
    print('   → 严格俯视判定: %s' % ('✓ 通过' if ok else '✗ 淘汰'))
    if not ok:
        report.append(dict(code=code, label=label, pass_=False, taper=round(float(taper), 2),
                           felt_w=int(fw), felt_h=int(fh), clipped=bool(touch)))
        continue

    # ---- 桌面外框：从毡面四边向外扫到背景（亮度大幅下落）----
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    fcx, fcy = (fx0 + fx1) // 2, (fy0 + fy1) // 2

    def ext(sample, start, step, limit, base):
        i, n = start, 0
        while (step > 0 and i < limit) or (step < 0 and i > limit):
            if sample(i) < base:
                break
            n += 1; i += step
        return n
    base = 0.28 * np.median(lum[fcy, fx0:fx1 + 1])
    el = ext(lambda x: lum[fcy, x], fx0 - 1, -1, 0, base)
    er = ext(lambda x: lum[fcy, x], fx1 + 1, +1, W - 1, base)
    et = ext(lambda y: lum[y, fcx], fy0 - 1, -1, 0, base)
    eb = ext(lambda y: lum[y, fcx], fy1 + 1, +1, H - 1, base)
    print('   框宽 左%d 右%d 上%d 下%d' % (el, er, et, eb))

    tx0, tx1, ty0, ty1 = fx0 - el, fx1 + er, fy0 - et, fy1 + eb
    tw, th = tx1 - tx0 + 1, ty1 - ty0 + 1
    side = min(int(max(tw, th) * 1.03), W, H)
    ccx, ccy = (tx0 + tx1) // 2, (ty0 + ty1) // 2
    cx0 = max(0, min(ccx - side // 2, W - side))
    cy0 = max(0, min(ccy - side // 2, H - side))

    crop = im.crop((cx0, cy0, cx0 + side, cy0 + side))
    mp = os.path.join(PROC, 'master', 'table_%s_1024.jpg' % code)
    ep = os.path.join(PROC, 'engine', 'table_%s_750.jpg' % code)
    crop.resize((1024, 1024), Image.LANCZOS).save(mp, 'JPEG', quality=88, optimize=True, progressive=True)
    crop.resize((750, 750), Image.LANCZOS).save(ep, 'JPEG', quality=84, optimize=True, progressive=True)

    ca = np.asarray(crop).astype(np.float32) / 255.0
    ch, cs, cv = hsv(ca)
    gold = (ch > 26) & (ch < 64) & (cs > 0.28) & (cv > 0.32)
    gold[:int(side * .18), :] = False; gold[int(side * .82):, :] = False
    gold[:, :int(side * .18)] = False; gold[:, int(side * .82):] = False
    gys, gxs = np.where(gold)
    gcx, gcy = (float(gxs.mean()), float(gys.mean())) if len(gxs) > 50 else (float('nan'), float('nan'))
    rr = np.sqrt((gxs - gcx) ** 2 + (gys - gcy) ** 2) if len(gxs) > 50 else np.array([np.nan])
    ring_o = float(np.percentile(rr, 99))

    yy, xx = np.mgrid[0:side, 0:side]
    d = np.sqrt(((xx - side / 2) / (side / 2)) ** 2 + ((yy - side / 2) / (side / 2)) ** 2)
    felt_med = np.median(ca[(d > 0.62) & (d < 0.85)], 0) * 255
    tray_med = np.median(ca[d < 0.13], 0) * 255
    corner = np.median(np.concatenate([ca[0:12, 0:12].reshape(-1, 3),
                                       ca[0:12, -12:].reshape(-1, 3)]), 0) * 255
    rec = dict(code=code, label=label, pass_=True, taper=round(float(taper), 2),
               side_px=int(side), crop=[int(cx0), int(cy0), int(cx0 + side), int(cy0 + side)],
               master=mp, engine=ep,
               master_kb=round(os.path.getsize(mp) / 1024, 1),
               engine_kb=round(os.path.getsize(ep) / 1024, 1),
               tray_cx=round(gcx / side, 4), tray_cy=round(gcy / side, 4), tray_r=round(ring_o / side, 4),
               tray_dia_pct=round(ring_o * 2 / side * 100, 1),
               felt='#%02X%02X%02X' % tuple(felt_med.astype(int)),
               tray_floor='#%02X%02X%02X' % tuple(tray_med.astype(int)),
               surround='#%02X%02X%02X' % tuple(corner.astype(int)))
    report.append(rec)
    print('   裁 %d×%d → 母版 %.0fKB / 工程版 %.0fKB' % (side, side, rec['master_kb'], rec['engine_kb']))
    print('   圆盘 圆心(%.4f, %.4f) 直径 %.1f%% 桌面边长' % (rec['tray_cx'], rec['tray_cy'], rec['tray_dia_pct']))
    print('   毡面 %s  盘内 %s  外围 %s' % (rec['felt'], rec['tray_floor'], rec['surround']))

json.dump(report, open(os.path.join(PROC, 'metrics.json'), 'w'), ensure_ascii=False, indent=2)
print('\n已写 metrics.json')
