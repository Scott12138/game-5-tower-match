# -*- coding: utf-8 -*-
"""骰子 6 个面（1~6 点）· 矢量批量出图

几何与材质参数与已定稿的「骨白 + 朱红 4 点」骰完全一致，只换顶面点阵：
  S=700 / 圆角 .17 / 侧壁厚 34（右下露出）/ 面板内缩 .115 / pip 直径 .215
  / 侧壁与顶面渐变、左上高光边、面板凹槽内阴影 —— 全部沿用。
输出：918 无损母版 + 384 工程版（内容占画布 0.7996，与定稿版同一定值）。
"""
import os
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

BASE = 'docs-verify/game-5/game-start'
OUT = BASE + '/proc/dice_faces'
os.makedirs(OUT, exist_ok=True)

C = 1024                                   # 绘制画布
S = 700                                    # 顶面边长
RAD = int(S * .17)                         # 圆角半径
FACE_XY = ((C - S) // 2, int(C * .085))
TH = 34                                    # 侧壁厚度（右下露出）
INS = int(S * .115)                        # 内嵌面板内缩
PW = S - INS * 2                           # 面板边长
PIP_PX = int(PW * .215)                    # 点直径
PAD_RATIO = 0.125                          # 内容四周等距留白（沿用定稿版）

# 标准骰子点阵（面板内归一化坐标，x 向右 y 向下）
PIPS = {
    1: [(.50, .50)],
    2: [(.28, .28), (.72, .72)],
    3: [(.28, .28), (.50, .50), (.72, .72)],
    4: [(.28, .28), (.72, .28), (.28, .72), (.72, .72)],
    5: [(.28, .28), (.72, .28), (.50, .50), (.28, .72), (.72, .72)],
    6: [(.28, .21), (.28, .50), (.28, .79), (.72, .21), (.72, .50), (.72, .79)],
}


def vgrad(size, c1, c2):
    w, h = size
    a = np.array(c1, float); b = np.array(c2, float)
    t = np.linspace(0, 1, h)[:, None, None]
    arr = np.repeat(a[None, None, :] * (1 - t) + b[None, None, :] * t, w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), 'RGB')


def rrmask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=r, fill=255)
    return m


def pip_sheet(px):
    """凸起朱红圆点：外圈暗 → 主体色 → 左上高光（与定稿版逐像素同参数）。"""
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ring, body, hi = (150, 38, 26), (216, 67, 47), (255, 158, 138)
    d.ellipse([0, 0, px - 1, px - 1], fill=ring + (255,))
    k = int(px * .10)
    d.ellipse([k, k, px - 1 - k, px - 1 - k], fill=body + (255,))
    h2 = int(px * .45)
    d.ellipse([px * .18, px * .14, px * .18 + h2, px * .14 + h2], fill=hi + (255,))
    return im


def make_die(n, pip_ratio=.215):
    """n 点面（骨白骰）。除点阵与点径外与定稿版完全同构。"""
    pip_px = int(PW * pip_ratio)
    canvas = Image.new('RGBA', (C, C), (0, 0, 0, 0))

    # 侧壁（右下）
    wall = vgrad((S, S), (198, 188, 166), (150, 140, 118))
    wall_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    wall_img.paste(wall, (0, 0), rrmask((S, S), RAD))
    canvas.alpha_composite(wall_img, (FACE_XY[0] + TH, FACE_XY[1] + TH))

    # 顶面
    face = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    face.paste(vgrad((S, S), (250, 244, 230), (216, 206, 184)), (0, 0), rrmask((S, S), RAD))

    # 内嵌面板
    panel = Image.new('RGBA', (PW, PW), (0, 0, 0, 0))
    panel.paste(vgrad((PW, PW), (252, 248, 238), (240, 232, 214)), (0, 0),
                rrmask((PW, PW), int(PW * .13)))

    # 点阵
    pip = pip_sheet(pip_px)
    for fx, fy in PIPS[n]:
        panel.alpha_composite(pip, (int(PW * fx) - pip_px // 2, int(PW * fy) - pip_px // 2))

    # 面板内阴影（凹槽感）
    sh = Image.new('RGBA', (PW, PW), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([0, 0, PW - 1, PW - 1], radius=int(PW * .13),
                                         outline=(120, 100, 60, 90), width=6)
    panel.alpha_composite(sh)
    face.alpha_composite(panel, (INS, INS))

    # 顶面左上高光边
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle([2, 2, S - 3, S - 3], radius=RAD,
                                         outline=(255, 250, 230, 150), width=4)
    face.alpha_composite(hl)
    canvas.alpha_composite(face, FACE_XY)
    return canvas


def fit_final(im, px):
    """预乘 alpha 缩放 + 反预乘 + 极低 alpha 归零（与定稿版逐字同流程）。"""
    st = np.asarray(im).astype(np.float32)
    alp = st[:, :, 3:4] / 255.0
    pm = np.dstack([st[:, :, :3] * alp, st[:, :, 3]])
    pi = Image.fromarray(np.clip(pm, 0, 255).round().astype(np.uint8), 'RGBA').resize((px, px), Image.LANCZOS)
    q = np.asarray(pi).astype(np.float32)
    al = q[:, :, 3:4]
    q[:, :, :3] = q[:, :, :3] / np.maximum(al / 255.0, 0.004)
    low = (al[:, :, 0] < 6)
    q[low, 0] = 0; q[low, 1] = 0; q[low, 2] = 0
    return Image.fromarray(np.clip(q, 0, 255).round().astype(np.uint8), 'RGBA')


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0); v = mx
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


def measure(eng):
    """对成品图量一组边缘质量指标。判据一律用「与已确认基准比对」，不用绝对阈值。"""
    dv = np.asarray(eng).astype(np.float32) / 255
    alv = dv[:, :, 3]
    op = alv > 0.98
    luma = dv[:, :, :3].mean(-1)
    band = (alv >= 0.16) & (alv <= 0.78)
    inner = ndimage.binary_erosion(op, iterations=5) & (~ndimage.binary_erosion(op, iterations=11))
    lum_edge = float(luma[band].mean()); lum_inner = float(luma[inner].mean())
    soft = float(band.sum() / max((alv > 0.04).sum(), 1) * 100)
    # 「亮边像素」= 抗锯齿带内比紧邻内部环更亮的像素（本资产里即顶面左上高光边，属设计元素）
    halo = int((band & (luma > lum_inner + 0.06)).sum())
    resid = int(((alv < 0.06) & (luma > 0.35)).sum())
    h2, s2, v2 = hsv(dv[:, :, :3])
    red = ((h2 < 22) | (h2 > 345)) & (s2 > 0.45) & (v2 > 0.30) & (alv > 0.5)
    lb2, n2 = ndimage.label(red)
    sz2 = ndimage.sum(red, lb2, range(1, n2 + 1))
    pips = len([s for s in sz2 if s > 40])
    ys2, xs2 = np.where(np.asarray(eng)[:, :, 3] > 8)
    bb = (int(xs2.max() - xs2.min() + 1), int(ys2.max() - ys2.min() + 1))
    return dict(pips=pips, bbox=bb, soft=soft, lum_edge=lum_edge, lum_inner=lum_inner,
                halo=halo, resid=resid)


# ---- 基准：已确认定稿版 assets/game-start/dice.png（原 4 点面）----
REF = measure(Image.open('assets/game-start/dice.png').convert('RGBA'))
print('=== 基准（已确认定稿版 dice.png，4 点）===')
print('点数 %d · bbox %dx%d · 软边 %.2f%% · 亮边像素 %d · 彩色残留 %d'
      % (REF['pips'], REF['bbox'][0], REF['bbox'][1], REF['soft'], REF['halo'], REF['resid']))
print('')

rows = []
bboxes = []
for n in range(1, 7):
    die = make_die(n)

    # ---- 与定稿版同流程：裁到内容 → 四周等距留白 → 定性为母版 ----
    dc = np.asarray(die)
    ys, xs = np.where(dc[:, :, 3] > 8)
    crop = die.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    cw, ch = crop.size
    side_c = max(cw, ch)
    pad = int(round(side_c * PAD_RATIO))
    cs = side_c + pad * 2
    master = Image.new('RGBA', (cs, cs), (0, 0, 0, 0))
    master.alpha_composite(crop, ((cs - cw) // 2, (cs - ch) // 2))
    master.save(OUT + '/face%d_master%d.png' % (n, cs))
    eng = fit_final(master, 384)
    eng.save(OUT + '/face%d_384.png' % n)

    # ---- 核验（与已确认基准比对，不用绝对阈值）----
    m = measure(eng)
    bboxes.append(m['bbox'])

    rows.append(dict(n=n, master=cs, content=(cw, ch), ratio=float(side_c / cs),
                     pips=m['pips'], bbox=m['bbox'], soft=m['soft'],
                     lum_edge=m['lum_edge'], lum_inner=m['lum_inner'],
                     halo=m['halo'], resid=m['resid'],
                     kb=os.path.getsize(OUT + '/face%d_384.png' % n) / 1024.0,
                     kb_master=os.path.getsize(OUT + '/face%d_master%d.png' % (n, cs)) / 1024.0))

# ---- 一致性断言：六面互为同构 + 与已确认基准逐指标等同 ----
print('=== 骰子六面核验（基准 = 已确认定稿版 dice.png）===')
print('%-4s %-8s %-11s %-9s %-6s %-9s %-9s %-8s %-8s %s'
      % ('面', '母版', '内容bbox', '占画布', '点数', '软边%', '亮边像素', '残留', '工程KB', '判定'))
ok = True
for r in rows:
    good = (r['pips'] == r['n']
            and r['soft'] == REF['soft'] and r['halo'] == REF['halo'] and r['resid'] == REF['resid'])
    ok = ok and good
    print('%-4d %-8d %-11s %-9.4f %-6d %-9.2f %-9d %-8d %-8.1f %s'
          % (r['n'], r['master'], '%dx%d' % r['content'], r['ratio'], r['pips'], r['soft'],
             r['halo'], r['resid'], r['kb'], '✓ 与基准一致' if good else '✗ 偏离基准'))

same_bb = len(set(bboxes)) == 1
same_ratio = len(set(round(r['ratio'], 4) for r in rows)) == 1
same_master = len(set(r['master'] for r in rows)) == 1
print('')
print('点数全部精确（1~6 连通域计数）  : %s' % all(r['pips'] == r['n'] for r in rows))
print('六面内容 bbox 一致              : %s  %s' % (same_bb, bboxes[0]))
print('六面内容占画布一致              : %s  %.4f' % (same_ratio, rows[0]['ratio']))
print('六面母版画布尺寸一致            : %s  %d' % (same_master, rows[0]['master']))
print('软边/亮边/残留 与基准逐项等同    : %s'
      % all(r['soft'] == REF['soft'] and r['halo'] == REF['halo'] and r['resid'] == REF['resid'] for r in rows))

json.dump(dict(pip_px=PIP_PX, panel=PW, master=rows[0]['master'], ratio=rows[0]['ratio'],
               bbox=bboxes[0], ref=REF, faces=rows),
          open(OUT + '/faces_meta.json', 'w'), ensure_ascii=False, indent=1)
print('\nmeta → %s/faces_meta.json' % OUT)
print('总判定：%s' % ('✓ 六面全部通过' if (ok and same_bb and same_ratio and same_master) else '✗ 有项不通过，需诊断'))
