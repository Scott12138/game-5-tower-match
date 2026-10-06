#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""牌面验收 · 共用库（几何 / 归一化 / 判据）

抽出来只为一件事：**判据只能有一份**。
第 22 轮的血泪教训之一是 `make_tiao_sheet.py` 被同名新脚本覆盖、内容不可恢复；
另一条是判据抄成两份就会漂移 —— 一份修了、另一份没修，
于是两块验收板用"看起来一样"的两个数打架。

因此：
  tile_lib.py              ← 几何 / 归一化 / 边框差 / 配色指纹（唯一实现）
  make_tiao_all_sheet.py   ← 条子九张验收（改用本库）
  make_tong_v4_sheet.py    ← 六筒样图验收（改用本库）

本文件里的函数体是从 `make_tiao_all_sheet.py` **逐字切出来**的（不是重写），
以保证重构前后数值完全一致；重构后已复跑条子脚本核对，逐项数值不变。
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'


BG, PANEL, PANEL2, LINE = (12, 22, 18), (19, 34, 28), (23, 41, 34), (44, 68, 58)
CREAM, MUTE, GOLD, GOLD_HI = (240, 245, 239), (146, 168, 156), (246, 196, 69), (255, 224, 138)
TEAL, ORANGE, REDC = (143, 227, 197), (255, 158, 96), (216, 67, 47)



_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]




# ══════════════════════════════════════════════════════════════════════
#  归一化（口径与第 17/19/21 轮完全一致）
# ══════════════════════════════════════════════════════════════════════
def subject_bbox(im, sth=14, run=22, step=3):
    W, H = im.size
    sm = im.convert('HSV').getchannel('S').filter(ImageFilter.MedianFilter(5))
    p = sm.load()

    def scan(arr, n):
        c, a = 0, None
        for i, v in enumerate(arr):
            c = c + 1 if v else 0
            if c >= run: a = i - run + 1; break
        c, b = 0, None
        for i in range(n - 1, -1, -1):
            c = c + 1 if arr[i] else 0
            if c >= run: b = i + run - 1; break
        return a, b

    L, R, T, B = [], [], [], []
    for y in range(0, H, step):
        a, b = scan([1 if p[x, y] > sth else 0 for x in range(W)], W)
        if a is not None and b is not None and b - a > W * 0.25: L.append(a); R.append(b)
    for x in range(0, W, step):
        a, b = scan([1 if p[x, y] > sth else 0 for y in range(H)], H)
        if a is not None and b is not None and b - a > H * 0.25: T.append(a); B.append(b)
    med = lambda a: sorted(a)[len(a) // 2]
    return med(L), med(T), med(R), med(B)


def bg_check(im, n=80):
    W, H = im.size
    sm = im.convert('HSV').getchannel('S')
    mx = 0
    for bx, by in [(0, 0), (W - n, 0), (0, H - n), (W - n, H - n)]:
        mx = max(mx, max(sm.crop((bx, by, bx + n, by + n)).getdata()))
    return mx


def normalize(src, dst, fill=0.78, aspect=0.75):
    im = Image.open(src).convert('RGB')
    W, H = im.size
    if H > 1440:                       # 底部水印带统一裁除（y≥1425，与前几轮同工艺）
        bgp = im.crop((0, 1385, W, 1405)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - 1425), bgp), (0, 1425))
    sat = bg_check(im)
    x0, y0, x1, y1 = subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ch = bh / fill; cw = ch * aspect
    if cw > W: cw, ch = W, W / aspect
    if ch > H: ch, cw = H, H * aspect
    l = min(max(0, cx - cw / 2), W - cw)
    t = min(max(0, cy - ch / 2), H - ch)
    canvas = im.crop((round(l), round(t), round(l + cw), round(t + ch)))
    canvas.save(dst)
    return canvas, (bw, bh), sat




# ══════════════════════════════════════════════════════════════════════
#  金框几何
# ══════════════════════════════════════════════════════════════════════
def geom(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im, np.int16)
    W, H = im.size
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    gold = (R - B) > 85
    bg = (np.abs(R - 250) < 12) & (np.abs(G - 250) < 12) & (np.abs(B - 250) < 12)
    body = ~bg
    rows, cols = body.sum(axis=1), body.sum(axis=0)
    ry = np.nonzero(rows > W * 0.15)[0]
    rx = np.nonzero(cols > H * 0.15)[0]
    cy, cx = (ry[0] + ry[-1]) // 2, (rx[0] + rx[-1]) // 2

    def runs(v):
        o, s = [], None
        for i, x in enumerate(v.tolist()):
            if x > 0.5:
                if s is None: s = i
            else:
                if s is not None: o.append((s, i - 1)); s = None
        if s is not None: o.append((s, len(v) - 1))
        return o

    gr, gc = runs(gold[cy, :]), runs(gold[:, cx])
    return dict(im=im, a=a, W=W, H=H, gold=gold,
                tile=(int(rx[0]), int(rx[-1]), int(ry[0]), int(ry[-1])),
                face=(gr[0][1] + 1, gr[-1][0] - 1, gc[0][1] + 1, gc[-1][0] - 1))


def _ring_stats(d, tile, face):
    tx0, tx1, ty0, ty1 = tile
    fx0, fx1, fy0, fy1 = face
    m = np.zeros(d.shape, bool)
    m[ty0:ty1 + 1, tx0:tx1 + 1] = True
    m[fy0:fy1 + 1, fx0:fx1 + 1] = False
    band = d[m]
    cors = []
    for (y0, y1, x0, x1) in [(ty0, ty0 + (fy0 - ty0) * 2, tx0, tx0 + (fx0 - tx0) * 2),
                             (ty0, ty0 + (fy0 - ty0) * 2, tx1 - (tx1 - fx1) * 2, tx1),
                             (ty1 - (ty1 - fy1) * 2, ty1, tx0, tx0 + (fx0 - tx0) * 2),
                             (ty1 - (ty1 - fy1) * 2, ty1, tx1 - (tx1 - fx1) * 2, tx1)]:
        cors.append(float(d[y0:y1, x0:x1].mean()))
    return float(band.mean()), cors


def border_diff(A, B, tile, face):
    """同坐标逐像素差（衡量"构图"偏离）。"""
    d = np.abs(A - B).mean(axis=2)
    band, cors = _ring_stats(d, tile, face)
    return dict(band=band, corners=cors)


def border_diff_shift(A, B, tileA, faceA, tileB):
    """仅平移对齐后差：按牌体 bbox 左上角整像素平移 B 再比（不做缩放，避免重采样伪影）。"""
    dx = tileB[0] - tileA[0]
    dy = tileB[2] - tileA[2]
    Bs = np.roll(np.roll(B, -dy, axis=0), -dx, axis=1)
    d = np.abs(A - Bs).mean(axis=2)
    band, cors = _ring_stats(d, tileA, faceA)
    return dict(band=band, corners=cors)




# ══════════════════════════════════════════════════════════════════════
#  配色三色构成（通道比值法 · 已在参考图上自证）
# ══════════════════════════════════════════════════════════════════════
def masks(a):
    R = a[:, :, 0].astype(np.float32); G = a[:, :, 1].astype(np.float32); B = a[:, :, 2].astype(np.float32)
    red = (R > G * 1.45) & (R > B * 1.35) & (R > 80)
    grn = (G > R * 1.18) & (G > B * 1.12) & (G > 45)
    blu = (B > R * 1.35) & (B > G * 1.10) & (B > 70)
    return red, grn, blu


def fingerprint(im, box=None):
    a = np.asarray(im.convert('RGB'), np.int16)
    red, grn, blu = masks(a)
    keep = np.ones(a.shape[:2], bool)
    if box:
        x0, y0, x1, y1 = box
        keep = np.zeros(a.shape[:2], bool)
        keep[y0:y1, x0:x1] = True
    red &= keep; grn &= keep; blu &= keep
    both = red | grn | blu
    ys, xs = np.nonzero(both)
    if len(xs) == 0:
        return dict(g=0, r=0, b=0, rc=None, bc=None)
    gx0, gy0 = xs.min(), ys.min()
    gw = max(1, xs.max() - gx0); gh = max(1, ys.max() - gy0)

    def cen(m):
        ys2, xs2 = np.nonzero(m)
        if len(xs2) == 0: return None
        return ((xs2.mean() - gx0) / gw, (ys2.mean() - gy0) / gh)

    return dict(g=int(grn.sum()), r=int(red.sum()), b=int(blu.sum()), rc=cen(red), bc=cen(blu))


INSET = 80          # 面心内缩量：排开金框内缘暖色带（见文件头【判据三】）


def trio(fp, thr=3000):
    """三色存在性。阈 3000：内缩 80px 后全绿牌的假红像素为 0，真红牌 ≥12902，分离度 80 倍。"""
    return (int(fp['g'] > thr), int(fp['r'] > thr), int(fp['b'] > thr))

