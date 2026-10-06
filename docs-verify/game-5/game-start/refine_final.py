# -*- coding: utf-8 -*-
"""定稿资产精修 v3（三处修正）：
  ① 裁切中心：改用「毡面中心」（正方、可靠），不再用被单行噪点带偏的桌体框中心。
  ② 桌框外扩量：改多行/多列采样取中位数，并对异常小值（< 其他三边中位数 30%）做修正。
  ③ 骰子判据：白晕改为「边缘带 vs 紧邻内部环」比较（核心含朱红点会压低均值，导致误报）；
     反预乘后清理极低 alpha 像素的 RGB（消除透明区彩色残留）。
"""
import os
import json
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
SRC_TABLE = ROOT + '/generated-images/game-start-table-v2/Photorealistic_top_down_orthog_2026-10-04T15-20-46.png'
PROC = ROOT + '/docs-verify/game-5/game-start/proc'
OUT = PROC + '/final'
os.makedirs(OUT, exist_ok=True)
rep = []

LUMW = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0); v = mx
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def felt_mask(a):
    h_, s_, v_ = hsv(a)
    m = (h_ > 95) & (h_ < 175) & (s_ > 0.22) & (v_ > 0.10)
    H, W = m.shape
    m[int(H * .93):, int(W * .80)] = False
    m[int(H * .93):, int(W * .80):] = False
    lb, n = ndimage.label(m)
    if n > 1:
        sz = ndimage.sum(m, lb, range(1, n + 1))
        m = (lb == int(np.argmax(sz)) + 1)
    return m


def orth(m):
    ys, xs = np.where(m)
    y0, y1 = ys.min(), ys.max()
    Y, L, R = [], [], []
    for y in range(int(y0 + (y1 - y0) * .20), int(y0 + (y1 - y0) * .85), 6):
        xr = np.where(m[y])[0]
        if len(xr) > 60:
            Y.append(y); L.append(xr.min()); R.append(xr.max())
    Y = np.array(Y); L = np.array(L); R = np.array(R)
    kl = np.polyfit(Y, L, 1)[0] * 100
    kr = np.polyfit(Y, R, 1)[0] * 100
    ws = R - L
    return abs(kl - kr), (ws.max() - ws.min()) / ws.mean() * 100


def fit_corners(m):
    ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    Y, L, R = [], [], []
    for y in range(int(y0 + (y1 - y0) * .15), int(y0 + (y1 - y0) * .86), 4):
        xr = np.where(m[y])[0]
        if len(xr) > 60:
            Y.append(y); L.append(xr.min()); R.append(xr.max())
    kl, bl = np.polyfit(np.array(Y), np.array(L), 1)
    kr, br = np.polyfit(np.array(Y), np.array(R), 1)
    X, T, B = [], [], []
    for x in range(int(x0 + (x1 - x0) * .15), int(x0 + (x1 - x0) * .86), 4):
        yc = np.where(m[:, x])[0]
        if len(yc) > 60:
            X.append(x); T.append(yc.min()); B.append(yc.max())
    kt, bt = np.polyfit(np.array(X), np.array(T), 1)
    kb, bb = np.polyfit(np.array(X), np.array(B), 1)

    def ix(kh, bh, kv, bv):
        y = (kh * bv + bh) / (1 - kh * kv)
        return np.array([kv * y + bv, y], np.float32)
    return np.array([ix(kt, bt, kl, bl), ix(kt, bt, kr, br), ix(kb, bb, kr, br), ix(kb, bb, kl, bl)])


def tray_metrics(a):
    h_, s_, v_ = hsv(a)
    cd = a.shape[0]
    gold = (h_ > 26) & (h_ < 64) & (s_ > 0.28) & (v_ > 0.32)
    gold[:int(cd * .18), :] = False; gold[int(cd * .82):, :] = False
    gold[:, :int(cd * .18)] = False; gold[:, int(cd * .82):] = False
    gy, gx = np.where(gold)
    cx, cy = gx.mean(), gy.mean()
    rx = np.percentile(np.abs(gx - cx), 99)
    ry = np.percentile(np.abs(gy - cy), 99)
    return cx / cd, cy / cd, rx / cd, rx / ry


# ==================== ① 桌图 C ====================
img = cv2.imread(SRC_TABLE)
rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
m0 = felt_mask(rgb)
o_b, t_b = orth(m0)
P = fit_corners(m0)
Lx = (P[0][0] + P[3][0]) / 2; Rx = (P[1][0] + P[2][0]) / 2
Ty = (P[0][1] + P[1][1]) / 2; By = (P[3][1] + P[2][1]) / 2
side = ((Rx - Lx) + (By - Ty)) / 2
cxx, cyy = (Lx + Rx) / 2, (Ty + By) / 2
Q = np.array([[cxx - side / 2, cyy - side / 2], [cxx + side / 2, cyy - side / 2],
              [cxx + side / 2, cyy + side / 2], [cxx - side / 2, cyy + side / 2]], np.float32)
M = cv2.getPerspectiveTransform(P, Q)
warp = np.clip(cv2.warpPerspective(rgb, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LANCZOS4), 0, 1)
m1 = felt_mask(warp)
o_a, t_a = orth(m1)

rep.append('=== ① 桌图 C · 手工单应校正 ===')
rep.append('正交度  %.2f → %.2f px/100px      毡面宽度波动  %.2f%% → %.2f%%'
           % (o_b, o_a, t_b, t_a))
use_rect = o_a < o_b
base = warp if use_rect else rgb
rep.append('择优：%s' % ('✅ 手工单应校正版（改善 %.0f%%）' % ((1 - o_a / o_b) * 100) if use_rect else '原始直裁版'))

# —— 裁切 v3：多行采样取中位数 + 异常值修正 + 以毡面中心裁切
a = base
H, W = a.shape[:2]
mm = felt_mask(a)
ys, xs = np.where(mm)
fx0, fx1, fy0, fy1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
lum = a @ LUMW
fcx, fcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2


def run_len(sample, start, step, lim, t=0.07):
    i, n = start, 0
    while (step > 0 and i < lim) or (step < 0 and i > lim):
        if sample(i) < t:
            break
        n += 1; i += step
    return n


hgt = fy1 - fy0
wdh = fx1 - fx0
rows = [int(fy0 + hgt * f) for f in np.linspace(.22, .78, 15)]
cols = [int(fx0 + wdh * f) for f in np.linspace(.22, .78, 15)]
el = int(np.median([run_len(lambda x, y=y: lum[y, x], fx0 - 1, -1, 0) for y in rows]))
er = int(np.median([run_len(lambda x, y=y: lum[y, x], fx1 + 1, +1, W - 1) for y in rows]))
et = int(np.median([run_len(lambda y, x=x: lum[y, x], fy0 - 1, -1, 0) for x in cols]))
eb = int(np.median([run_len(lambda y, x=x: lum[y, x], fy1 + 1, +1, H - 1) for x in cols]))
raw_ext = dict(L=el, R=er, T=et, B=eb)
med = float(np.median([el, er, et, eb]))
fixed = {}
for k, v in raw_ext.items():
    fixed[k] = int(med) if v < med * 0.30 else v
rep.append('桌框外扩量  原始 L%d R%d T%d B%d → 中位数 %.0f → 修正后 %s'
           % (el, er, et, eb, med, fixed))

body_w = (fx1 - fx0 + 1) + fixed['L'] + fixed['R']
body_h = (fy1 - fy0 + 1) + fixed['T'] + fixed['B']
side_px = int(max(body_w, body_h) * 1.03)
x0 = int(round(fcx - side_px / 2))
y0 = int(round(fcy - side_px / 2))
x0 = max(0, min(x0, W - side_px)); y0 = max(0, min(y0, H - side_px))
crop = Image.fromarray((base * 255).round().astype(np.uint8), 'RGB').crop((x0, y0, x0 + side_px, y0 + side_px))
rep.append('桌体 %.0f×%.0f → 裁切边长 %d，以毡面中心 (%.0f, %.0f) 为心 → 框 (%d, %d)'
           % (body_w, body_h, side_px, fcx, fcy, x0, y0))

im750 = crop.resize((750, 750), Image.LANCZOS)
im750.save(OUT + '/table_C_750.jpg', quality=88, optimize=True, progressive=True)
crop.resize((1024, 1024), Image.LANCZOS).save(OUT + '/table_C_1024.jpg', quality=90, optimize=True, progressive=True)

ca = np.asarray(im750).astype(np.float32) / 255
o_f, t_f = orth(felt_mask(ca))
tcx_n, tcy_n, tr_n, ratio = tray_metrics(ca)
# 居中度复检：毡面在成品图中的左右/上下留白
mf = felt_mask(ca)
yy, xx = np.where(mf)
plt_ = xx.min(); prt = 750 - 1 - xx.max(); ptop = yy.min(); pbot = 750 - 1 - yy.max()
rep.append('')
rep.append('【成品 750×750】%d KB   （毡面留白 左%d 右%d 上%d 下%d，对称性复检）'
           % (os.path.getsize(OUT + '/table_C_750.jpg') // 1024, plt_, prt, ptop, pbot))
rep.append('  正交度 %.2f   毡面宽度波动 %.2f%%' % (o_f, t_f))
rep.append('  骰盘圆心 归一化 (%.4f, %.4f) → 750 设计值 (%.0f, %.0f) → 屏绝对 y=292 (%.0f, %.0f)'
           % (tcx_n, tcy_n, tcx_n * 750, tcy_n * 750, tcx_n * 750, 292 + tcy_n * 750))
rep.append('  骰盘直径 %.1f 设计值（占桌面 %.1f%%）  长宽比 %.4f' % (tr_n * 2 * 750, tr_n * 2 * 100, ratio))

# ==================== ② 骰子 bone4 ====================
d = Image.open(PROC + '/dice/dice_vec_bone4_1024.png').convert('RGBA')
dc = np.asarray(d)
ys, xs = np.where(dc[:, :, 3] > 8)
crop_d = d.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
cw, ch = crop_d.size
side_c = max(cw, ch)
pad = int(round(side_c * 0.125))
cs = side_c + pad * 2
canvas = Image.new('RGBA', (cs, cs), (0, 0, 0, 0))
canvas.alpha_composite(crop_d, ((cs - cw) // 2, (cs - ch) // 2))


def fit_final(im, px):
    st = np.asarray(im).astype(np.float32)
    alp = st[:, :, 3:4] / 255.0
    pm = np.dstack([st[:, :, :3] * alp, st[:, :, 3]])
    pi = Image.fromarray(np.clip(pm, 0, 255).round().astype(np.uint8), 'RGBA').resize((px, px), Image.LANCZOS)
    q = np.asarray(pi).astype(np.float32)
    al = q[:, :, 3:4]
    q[:, :, :3] = q[:, :, :3] / np.maximum(al / 255.0, 0.004)
    low = (al[:, :, 0] < 6)                     # 极低 alpha → RGB 归零，消除彩色残留
    q[low, 0] = 0; q[low, 1] = 0; q[low, 2] = 0
    return Image.fromarray(np.clip(q, 0, 255).round().astype(np.uint8), 'RGBA')


fit_final(canvas, 1024).save(OUT + '/dice_final_1024.png')
fit_final(canvas, 384).save(OUT + '/dice_final_384.png')

dv = np.asarray(fit_final(canvas, 384)).astype(np.float32) / 255
alv = dv[:, :, 3]
op = alv > 0.98
luma = dv[:, :, :3].mean(-1)
band = (alv >= 0.16) & (alv <= 0.78)
inner = ndimage.binary_erosion(op, iterations=5) & (~ndimage.binary_erosion(op, iterations=11))
lum_edge = luma[band].mean()
lum_inner = luma[inner].mean()
soft = band.sum() / max((alv > 0.04).sum(), 1) * 100
halo = int((band & (luma > lum_inner + 0.06)).sum())
resid = int(((alv < 0.06) & (luma > 0.35)).sum())
h2, s2, v2 = hsv(dv[:, :, :3])
red = ((h2 < 22) | (h2 > 345)) & (s2 > 0.45) & (v2 > 0.30) & (alv > 0.5)
lb2, n2 = ndimage.label(red)
sz2 = ndimage.sum(red, lb2, range(1, n2 + 1))
pips = len([s for s in sz2 if s > 40])

rep.append('')
rep.append('=== ② 骰子 bone4 · 矢量定尺版 ===')
rep.append('内容 %d×%d → 居中、四边等距 %dpx，画布 %d×%d，内容占画布 %.4f（定值）'
           % (cw, ch, pad, cs, cs, side_c / cs))
rep.append('alpha 软边占比 %.2f%%（<6%% 正常）' % soft)
rep.append('边缘带亮度 %.4f  vs  紧邻内部环 %.4f   偏移 %+.4f（>+0.06 才算白晕）'
           % (lum_edge, lum_inner, lum_edge - lum_inner))
rep.append('白晕像素 %d   透明区彩色残留 %d  → %s'
           % (halo, resid, '✓ 边缘干净' if halo == 0 and resid == 0 else '⚠ 需复查'))
rep.append('朱红点数连通域 %d 个 → %s' % (pips, '✓ 4 点正确' if pips == 4 else '✗ 期望 4'))
wm = (dv[250:280, 250:280, :3].reshape(-1, 3).mean(0) * 255).round().astype(int)
rep.append('侧壁实测色 %s' % (tuple(int(x) for x in wm),))

json.dump(dict(table=dict(orth_used=float(o_f), taper=float(t_f), tray_cx=float(tcx_n), tray_cy=float(tcy_n),
                          tray_r=float(tr_n), tray_dia_design=float(tr_n * 2 * 750), tray_ratio=float(ratio),
                          pad_L=int(plt_), pad_R=int(prt), pad_T=int(ptop), pad_B=int(pbot),
                          path='hand_rectify' if use_rect else 'raw'),
               dice=dict(content_ratio=float(side_c / cs), pips=pips, halo=halo, residue=resid, soft_pct=float(soft))),
          open(OUT + '/meta_final.json', 'w'), ensure_ascii=False, indent=1)

txt = '\n'.join(rep)
print(txt)
open(ROOT + '/docs-verify/game-5/game-start/refine_final.txt', 'w', encoding='utf-8').write(txt)
