# -*- coding: utf-8 -*-
"""终版：对每个方案，比较「原始直裁」与「单应校正后裁」的正交度，自动择优出工程版。
正交度判据 = 毡面左右边缘斜率的收敛差（px/100px）；0 = 两边缘平行 = 严格俯视。
"""
import os, json
import numpy as np
from PIL import Image

PROC = 'docs-verify/game-5/game-start/proc'
RAW = {
    'A': 'generated-images/game-start-table-v2/Photorealistic_top_down_orthog_2026-10-04T15-20-03.png',
    'B': 'generated-images/game-start-table-v2/Photorealistic_top_down_orthog_2026-10-04T15-20-27.png',
    'C': 'generated-images/game-start-table-v2/Photorealistic_top_down_orthog_2026-10-04T15-20-46.png',
}
LABEL = {'A': '窄木边·极简雅致', 'C': '錾刻金框·奢华'}


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0); v = mx
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def convergence(img):
    """毡面左右边缘斜率收敛差（越小越正交）。"""
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    h, s, v = hsv(a)
    m = (h > 95) & (h < 175) & (s > 0.22) & (v > 0.10)
    m[int(a.shape[0] * .92):, int(a.shape[1] * .78):] = 0
    ys, xs = np.where(m)
    if len(ys) < 100:
        return None, None
    y0, y1 = ys.min(), ys.max()
    Y, L, R = [], [], []
    for y in range(int(y0 + (y1 - y0) * .2), int(y0 + (y1 - y0) * .85), 6):
        xr = np.where(m[y])[0]
        if len(xr) > 60:
            Y.append(y); L.append(xr.min()); R.append(xr.max())
    if len(Y) < 12:
        return None, None
    Y = np.array(Y)
    kl = np.polyfit(Y, np.array(L), 1)[0] * 100
    kr = np.polyfit(Y, np.array(R), 1)[0] * 100
    return abs(kl - kr), (kl, kr)


def raw_crop(code):
    im = Image.open(RAW[code]).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    best, bs = None, 1e9
    for t in (0.10, 0.11, 0.12, 0.13, 0.14, 0.16):
        m = lum > t
        m[int(H * .92):, int(W * .78):] = False
        cs = m.sum(0)
        if cs.max() == 0: continue
        on = np.where(cs > .35 * cs.max())[0]; x0, x1 = int(on.min()), int(on.max())
        rs = m[:, x0:x1 + 1].sum(1); on2 = np.where(rs > .35 * rs.max())[0]
        y0, y1 = int(on2.min()), int(on2.max())
        w, hh = x1 - x0 + 1, y1 - y0 + 1
        sc = abs(w / hh - 1)
        if sc < bs:
            bs, best = sc, (x0, y0, x1, y1)
    x0, y0, x1, y1 = best
    side = min(int(max(x1 - x0 + 1, y1 - y0 + 1) * 1.03), W, H)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    cx0 = max(0, min(cx - side // 2, W - side)); cy0 = max(0, min(cy - side // 2, H - side))
    return im.crop((cx0, cy0, cx0 + side, cy0 + side))


def rect_crop(code):
    p = os.path.join(PROC, 'rect', 'rect_%s.png' % code)
    im = Image.open(p).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    h, s, v = hsv(a)
    m = (h > 95) & (h < 175) & (s > 0.22) & (v > 0.10)
    m[:int(H * .12), :] = 0; m[int(H * .88):, :] = 0; m[:, :int(W * .12)] = 0; m[:, int(W * .88):] = 0
    ys, xs = np.where(m)
    # 毡面外框 + 框宽 → 桌体
    fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
    cy, cx = (fy0 + fy1) // 2, (fx0 + fx1) // 2
    def ext(sample, start, step, lim, t=0.07):
        i, n = start, 0
        while (step > 0 and i < lim) or (step < 0 and i > lim):
            if sample(i) < t: break
            n += 1; i += step
        return n
    el = ext(lambda x: lum[cy, x], fx0 - 1, -1, 0); er = ext(lambda x: lum[cy, x], fx1 + 1, +1, W - 1)
    et = ext(lambda y: lum[y, cx], fy0 - 1, -1, 0); eb = ext(lambda y: lum[y, cx], fy1 + 1, +1, H - 1)
    tx0, tx1, ty0, ty1 = fx0 - el, fx1 + er, fy0 - et, fy1 + eb
    side = min(int(max(tx1 - tx0 + 1, ty1 - ty0 + 1) * 1.03), W, H)
    ccx, ccy = (tx0 + tx1) // 2, (ty0 + ty1) // 2
    x0 = max(0, min(ccx - side // 2, W - side)); y0 = max(0, min(ccy - side // 2, H - side))
    return im.crop((x0, y0, x0 + side, y0 + side))


rep = []
for code in ('A', 'C'):
    cands = {}
    for tag, fn in (('原始直裁', raw_crop), ('单应校正', rect_crop)):
        try:
            c = fn(code)
            cv, slopes = convergence(c)
            cands[tag] = (c, cv, slopes)
        except Exception as e:
            print('  %s %s 失败: %s' % (code, tag, e))
    win = min(cands, key=lambda k: cands[k][1] if cands[k][1] is not None else 1e9)
    crop = cands[win][0]
    for tag in cands:
        cv, sl = cands[tag][1], cands[tag][2]
        print('%s %-6s 收敛差 %5.2f px/100px  (左%+6.2f 右%+6.2f)%s'
              % (code, tag, cv, sl[0], sl[1], '   ← 采用' if tag == win else ''))
    mp = os.path.join(PROC, 'master', 'table_%s_1024.jpg' % code)
    ep = os.path.join(PROC, 'engine', 'table_%s_750.jpg' % code)
    crop.resize((1024, 1024), Image.LANCZOS).save(mp, 'JPEG', quality=88, optimize=True, progressive=True)
    crop.resize((750, 750), Image.LANCZOS).save(ep, 'JPEG', quality=84, optimize=True, progressive=True)

    ca = np.asarray(crop).astype(np.float32) / 255
    ch, cs, cvv = hsv(ca)
    cd = crop.size[0]
    gold = (ch > 26) & (ch < 64) & (cs > 0.28) & (cvv > 0.32)
    gold[:int(cd * .18), :] = 0; gold[int(cd * .82):, :] = 0
    gold[:, :int(cd * .18)] = 0; gold[:, int(cd * .82):] = 0
    gys, gxs = np.where(gold)
    gcx, gcy = float(gxs.mean()), float(gys.mean())
    rrx = np.percentile(np.abs(gxs - gcx), 99); rry = np.percentile(np.abs(gys - gcy), 99)
    ring_o = (rrx + rry) / 2
    yy, xx = np.mgrid[0:cd, 0:cd]
    dd = np.sqrt(((xx - cd / 2) / (cd / 2)) ** 2 + ((yy - cd / 2) / (cd / 2)) ** 2)
    felt_med = np.median(ca[(dd > .62) & (dd < .85)], 0) * 255
    tray_med = np.median(ca[dd < .13], 0) * 255
    corner = np.median(np.concatenate([ca[0:12, 0:12].reshape(-1, 3), ca[0:12, -12:].reshape(-1, 3)]), 0) * 255
    rep.append(dict(code=code, label=LABEL[code], path=win,
                    conv_before=cands['原始直裁'][1], conv_after=cands['单应校正'][1],
                    conv_used=round(float(cands[win][1]), 2), side_px=cd,
                    master=mp, engine=ep, master_kb=round(os.path.getsize(mp) / 1024, 1),
                    engine_kb=round(os.path.getsize(ep) / 1024, 1),
                    tray_cx=round(gcx / cd, 4), tray_cy=round(gcy / cd, 4), tray_r=round(ring_o / cd, 4),
                    tray_dia_pct=round(ring_o * 2 / cd * 100, 1), circle_ratio=round(float(rrx / rry), 4),
                    felt='#%02X%02X%02X' % tuple(felt_med.astype(int)),
                    tray_floor='#%02X%02X%02X' % tuple(tray_med.astype(int)),
                    surround='#%02X%02X%02X' % tuple(corner.astype(int))))
    r = rep[-1]
    print('   采用「%s」 圆盘长宽比 %.4f  直径 %.1f%% (=%.0f 设计值)  圆心 750 坐标 (%.0f, %.0f)  绝对 (%.0f, %.0f)'
          % (win, r['circle_ratio'], r['tray_dia_pct'], r['tray_r'] * 2 * 750,
             r['tray_cx'] * 750, r['tray_cy'] * 750, r['tray_cx'] * 750, 292 + r['tray_cy'] * 750))
    print('   毡面 %s  盘内 %s  工程版 %.0fKB' % (r['felt'], r['tray_floor'], r['engine_kb']))

json.dump(rep, open(os.path.join(PROC, 'metrics.json'), 'w'), ensure_ascii=False, indent=2)
print('\n已写 metrics.json（含择优结果）')
