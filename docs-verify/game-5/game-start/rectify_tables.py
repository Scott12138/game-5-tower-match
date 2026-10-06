# -*- coding: utf-8 -*-
"""单应校正（homography rectify）：把 AI 出图的轻微透视拉回严格俯视 90°。
原理：桌面是一个平面 → 用毡面四角求 H，把毡面映射成正方形，则整个桌面平面（含桌框、圆盘）
      同时被校正；圆盘也会由椭圆回归正圆。
判据：校正后毡面上下宽度差 < 1%、圆盘 长宽比 ≈ 1。
"""
import glob, os, json
import numpy as np
import cv2
from PIL import Image

BASE = 'generated-images/game-start-table-v2'
PROC = 'docs-verify/game-5/game-start/proc'
for d in ('master', 'engine', 'rect', 'masks'):
    os.makedirs(os.path.join(PROC, d), exist_ok=True)
KEY = {'15-20-03': ('A', '窄木边·极简雅致'), '15-20-27': ('B', '胡桃木宽边·手作'),
       '15-20-46': ('C', '錾刻金框·奢华')}
S = 900; PAD = 240; CAN = S + 2 * PAD


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


def order4(pts):
    p = np.array(pts, dtype=np.float32).reshape(4, 2)
    s = p.sum(1); d = np.diff(p, axis=1).ravel()
    return np.array([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]], dtype=np.float32)


report = []
for f in sorted(glob.glob(os.path.join(BASE, '*.png'))):
    code, label = KEY.get(f.split('T')[-1][:8], ('?', '?'))
    bgr = cv2.imread(f)
    H_, W_ = bgr.shape[:2]
    a = (bgr[:, :, ::-1].astype(np.float32) / 255.0)
    h, s, v = hsv(a)
    fm = ((h > 95) & (h < 175) & (s > 0.22) & (v > 0.10)).astype(np.uint8)
    fm[int(H_ * 0.92):, int(W_ * 0.78):] = 0
    fm = cv2.morphologyEx(fm, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    fm = cv2.morphologyEx(fm, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(fm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    quad = None
    for eps in np.arange(0.008, 0.06, 0.002):
        ap = cv2.approxPolyDP(c, eps * peri, True)
        if len(ap) == 4:
            quad = ap.reshape(4, 2)
            break
    if quad is None:
        print('%s 找不到四角，跳过' % code); continue
    src = order4(quad)
    dst = np.array([[PAD, PAD], [PAD + S, PAD], [PAD + S, PAD + S], [PAD, PAD + S]], dtype=np.float32)
    Hm = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(bgr, Hm, (CAN, CAN), flags=cv2.INTER_LANCZOS4,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    cv2.imwrite(os.path.join(PROC, 'rect', 'rect_%s.png' % code), warped)

    wa = warped[:, :, ::-1].astype(np.float32) / 255.0
    lum = wa @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

    # 校正后毡面宽度应恒定（复检）
    wh, wsu, wv = hsv(wa)
    wfelt = (wh > 95) & (wh < 175) & (wsu > 0.22) & (wv > 0.10)
    ws = []
    for yy in range(PAD + 40, PAD + S - 40, 40):
        row = np.where(wfelt[yy])[0]
        row = row[(row > PAD - 60) & (row < PAD + S + 60)]
        ws.append(row.max() - row.min() + 1 if len(row) > 5 else np.nan)
    ws = np.array([x for x in ws if not np.isnan(x)])
    taper = (ws.max() - ws.min()) / ws.mean() * 100 if len(ws) else float('nan')

    # 桌体外框：从毡面方框向外扫到背景
    cy = PAD + S // 2; cx = PAD + S // 2
    def ext(sample, start, step, lim, t=0.07):
        i, n = start, 0
        while (step > 0 and i < lim) or (step < 0 and i > lim):
            if sample(i) < t: break
            n += 1; i += step
        return n
    el = ext(lambda x: lum[cy, x], PAD - 1, -1, 0)
    er = ext(lambda x: lum[cy, x], PAD + S, +1, CAN - 1)
    et = ext(lambda y: lum[y, cx], PAD - 1, -1, 0)
    eb = ext(lambda y: lum[y, cx], PAD + S, +1, CAN - 1)
    tx0, tx1, ty0, ty1 = PAD - el, PAD + S - 1 + er, PAD - et, PAD + S - 1 + eb
    tw, th = tx1 - tx0 + 1, ty1 - ty0 + 1
    side = min(max(tw, th) + int(max(tw, th) * 0.03), CAN)
    ccx, ccy = (tx0 + tx1) // 2, (ty0 + ty1) // 2
    x0 = max(0, min(ccx - side // 2, CAN - side)); y0 = max(0, min(ccy - side // 2, CAN - side))
    crop = warped[y0:y0 + side, x0:x0 + side]
    crop_rgb = Image.fromarray(crop[:, :, ::-1])

    mp = os.path.join(PROC, 'master', 'table_%s_1024.jpg' % code)
    ep = os.path.join(PROC, 'engine', 'table_%s_750.jpg' % code)
    crop_rgb.resize((1024, 1024), Image.LANCZOS).save(mp, 'JPEG', quality=88, optimize=True, progressive=True)
    crop_rgb.resize((750, 750), Image.LANCZOS).save(ep, 'JPEG', quality=84, optimize=True, progressive=True)

    ca = (crop[:, :, ::-1].astype(np.float32) / 255.0)
    ch, cs, cv = hsv(ca)
    gold = (ch > 26) & (ch < 64) & (cs > 0.28) & (cv > 0.32)
    cd = side
    gold[:int(cd * .18), :] = False; gold[int(cd * .82):, :] = False
    gold[:, :int(cd * .18)] = False; gold[:, int(cd * .82):] = False
    gys, gxs = np.where(gold)
    if len(gxs) > 50:
        gcx, gcy = float(gxs.mean()), float(gys.mean())
        rrx = np.percentile(np.abs(gxs - gcx), 99); rry = np.percentile(np.abs(gys - gcy), 99)
        ring_o = (rrx + rry) / 2; circ = rrx / max(rry, 1e-6)
    else:
        gcx = gcy = ring_o = circ = float('nan')
    yy, xx = np.mgrid[0:cd, 0:cd]
    dd = np.sqrt(((xx - cd / 2) / (cd / 2)) ** 2 + ((yy - cd / 2) / (cd / 2)) ** 2)
    felt_med = np.median(ca[(dd > 0.62) & (dd < 0.85)], 0) * 255
    tray_med = np.median(ca[dd < 0.13], 0) * 255
    corner = np.median(np.concatenate([ca[0:12, 0:12].reshape(-1, 3), ca[0:12, -12:].reshape(-1, 3)]), 0) * 255

    rec = dict(code=code, label=label, taper_after=round(float(taper), 2),
               quad_src=src.astype(int).tolist(), side_px=int(side),
               master=mp, engine=ep, master_kb=round(os.path.getsize(mp) / 1024, 1),
               engine_kb=round(os.path.getsize(ep) / 1024, 1),
               tray_cx=round(gcx / cd, 4), tray_cy=round(gcy / cd, 4), tray_r=round(ring_o / cd, 4),
               tray_dia_pct=round(ring_o * 2 / cd * 100, 1), circle_ratio=round(float(circ), 4),
               felt='#%02X%02X%02X' % tuple(felt_med.astype(int)),
               tray_floor='#%02X%02X%02X' % tuple(tray_med.astype(int)),
               surround='#%02X%02X%02X' % tuple(corner.astype(int)))
    report.append(rec)
    print('%s 校正后毡面宽度波动 %.2f%%  圆盘长宽比 %.4f' % (code, taper, circ))
    print('   裁 %d×%d → 母版 %.0fKB / 工程版 %.0fKB' % (side, side, rec['master_kb'], rec['engine_kb']))
    print('   圆盘 圆心(%.4f, %.4f) 直径 %.1f%% 桌面边长' % (rec['tray_cx'], rec['tray_cy'], rec['tray_dia_pct']))
    print('   毡面 %s  盘内 %s  外围 %s' % (rec['felt'], rec['tray_floor'], rec['surround']))

json.dump(report, open(os.path.join(PROC, 'metrics.json'), 'w'), ensure_ascii=False, indent=2)
print('\n已写 metrics.json')
