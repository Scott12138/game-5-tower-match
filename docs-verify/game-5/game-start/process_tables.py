# -*- coding: utf-8 -*-
"""开局页桌图处理 v2：投影法测桌面外框 → 裁正方形 → 母版1024 + 工程版750(JPEG)。
输出圆盘圆心/直径、毡面色、外围底色，供 Cocos 工程直接落坐标。"""
import glob, os, json
import numpy as np
from PIL import Image

BASE = 'generated-images/game-start-table-v2'
PROC = 'docs-verify/game-5/game-start/proc'
OUT_M = os.path.join(PROC, 'master')
OUT_E = os.path.join(PROC, 'engine')
for d in (OUT_M, OUT_E):
    os.makedirs(d, exist_ok=True)

KEY = {'15-20-03': ('A', '窄木边·极简雅致'),
       '15-20-27': ('B', '胡桃木宽边·手作'),
       '15-20-46': ('C', '錾刻金框·奢华')}


def hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    v = mx
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    h = np.zeros_like(mx)
    nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def table_bbox(a, lum):
    """投影法：桌面+桌框比近黑背景亮得多；桌腿只占很窄的列，用占比阈值切掉。"""
    H, W = lum.shape
    m = lum > 0.10
    m[int(H * 0.92):, int(W * 0.78):] = False                 # 屏蔽水印
    cs = m.sum(0)
    if cs.max() == 0:
        return None
    on = np.where(cs > 0.35 * cs.max())[0]
    x0, x1 = int(on.min()), int(on.max())
    rs = m[:, x0:x1 + 1].sum(1)
    on2 = np.where(rs > 0.35 * rs.max())[0]
    y0, y1 = int(on2.min()), int(on2.max())
    return x0, y0, x1, y1


report = []
for f in sorted(glob.glob(os.path.join(BASE, '*.png'))):
    key = f.split('T')[-1][:8]
    code, label = KEY.get(key, (key, key))
    im = Image.open(f).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

    bb = table_bbox(a, lum)
    x0, y0, x1, y1 = bb
    tw, th = x1 - x0 + 1, y1 - y0 + 1
    print('%s 桌面外框 %d×%d  宽高比 %.4f  (x %d~%d, y %d~%d)'
          % (code, tw, th, tw / th, x0, x1, y0, y1))

    side = int(max(tw, th) * 1.03)
    side = min(side, W, H)                                     # ★ 越界夹取
    ccx, ccy = (x0 + x1) // 2, (y0 + y1) // 2
    cx0 = max(0, min(ccx - side // 2, W - side))
    cy0 = max(0, min(ccy - side // 2, H - side))

    crop = im.crop((cx0, cy0, cx0 + side, cy0 + side))
    master = crop.resize((1024, 1024), Image.LANCZOS)
    engine = crop.resize((750, 750), Image.LANCZOS)
    mp = os.path.join(OUT_M, 'table_%s_1024.jpg' % code)
    ep = os.path.join(OUT_E, 'table_%s_750.jpg' % code)
    master.save(mp, 'JPEG', quality=88, optimize=True, progressive=True)
    engine.save(ep, 'JPEG', quality=84, optimize=True, progressive=True)

    ca = np.asarray(crop).astype(np.float32) / 255.0
    ch, cs_, cv = hsv(ca)
    gold = (ch > 26) & (ch < 64) & (cs_ > 0.28) & (cv > 0.32)
    gold[:int(side * .18), :] = False; gold[int(side * .82):, :] = False
    gold[:, :int(side * .18)] = False; gold[:, int(side * .82):] = False
    gys, gxs = np.where(gold)
    if len(gxs) > 50:
        gcx, gcy = float(gxs.mean()), float(gys.mean())
        rr = np.sqrt((gxs - gcx) ** 2 + (gys - gcy) ** 2)
        ring_o = float(np.percentile(rr, 99))
    else:
        gcx = gcy = ring_o = float('nan')

    yy, xx = np.mgrid[0:side, 0:side]
    d = np.sqrt(((xx - side / 2) / (side / 2)) ** 2 + ((yy - side / 2) / (side / 2)) ** 2)
    felt_med = np.median(ca[(d > 0.62) & (d < 0.85)], 0) * 255
    tray_med = np.median(ca[d < 0.13], 0) * 255
    corner = np.median(np.concatenate([ca[0:12, 0:12].reshape(-1, 3),
                                       ca[0:12, -12:].reshape(-1, 3)]), 0) * 255

    rec = dict(code=code, label=label, side_px=int(side),
               crop=[int(cx0), int(cy0), int(cx0 + side), int(cy0 + side)],
               master=mp, engine=ep,
               master_kb=round(os.path.getsize(mp) / 1024, 1),
               engine_kb=round(os.path.getsize(ep) / 1024, 1),
               tray_cx=round(gcx / side, 4), tray_cy=round(gcy / side, 4),
               tray_r=round(ring_o / side, 4),
               tray_dia_pct=round(ring_o * 2 / side * 100, 1),
               felt='#%02X%02X%02X' % tuple(felt_med.astype(int)),
               tray_floor='#%02X%02X%02X' % tuple(tray_med.astype(int)),
               surround='#%02X%02X%02X' % tuple(corner.astype(int)))
    report.append(rec)
    print('   裁 %d×%d → 母版 %.0fKB / 工程版 %.0fKB' % (side, side, rec['master_kb'], rec['engine_kb']))
    print('   圆盘 归一化圆心 (%.4f, %.4f) 半径 %.4f → 直径 %.1f%% 桌面边长'
          % (rec['tray_cx'], rec['tray_cy'], rec['tray_r'], rec['tray_dia_pct']))
    print('   毡面 %s  盘内 %s  外围 %s' % (rec['felt'], rec['tray_floor'], rec['surround']))

json.dump(report, open(os.path.join(PROC, 'metrics.json'), 'w'), ensure_ascii=False, indent=2)
print('\n已写 metrics.json')

# 三方案裁切结果并排（自检用）
Wt = 300
sheet = Image.new('RGB', (Wt * 3 + 40 * 4, Wt + 80), (14, 18, 16))
for i, r in enumerate(report):
    t = Image.open(r['engine']).convert('RGB').resize((Wt, Wt), Image.LANCZOS)
    sheet.paste(t, (40 + i * (Wt + 40), 60))
sheet.save(os.path.join(PROC, 'crops_check.png'))
print('自检图 crops_check.png')
