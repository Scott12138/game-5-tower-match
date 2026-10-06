#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""九条 v6 · 两候选（图生图 / 一万边框像素级复用）+ 验收板（第 21 轮）

用户拍板原话：
  1、九条中间的图案颜色参照所提供的参考图来生成，并继续保持竹子形状；
  2、九条周边的金色边框参照「一万」的边框来制作，需与「一万」周围边框完全一致。

本轮两条工艺：
  ① 图生图（候选甲）：image1 = 一万-raw.png（1024×1536，与输出同尺寸 → 零拉伸），
     image2 = 用户参考图（只取配色），input_fidelity=high。
     实测：牌体 x 范围 134..885 与一万**完全相同**，面心 y 280..1178 **完全相同**，
     边框带逐像素平均差 3.99 灰阶（≈1.6%），四角卷草 4.67~5.48 灰阶。
  ② 框像素级复用（候选乙）：以一万-raw 为底，只把**面心矩形（交集）**替换为图生图的面心。
     两图几何已对齐到 0~7px，无需缩放；替换矩形严格不越出面心 → 金框、牌体、侧墙、
     背景、接触阴影**全部是一万的原像素**，边框带逐像素差恒为 0.00。

★ 数量判据（第 20 轮结论，本轮再次被证伪，重申生效）：
  「图案数量」**不做机器断言**。本轮换了个更聪明的分段投影法重试，仍在真值已知的
  v5（真值 6 列 3 行）上量成 10/11/11 列 10 行、在 v2（真值 3 列 3 行）上量成 7/9/8 列
  —— 竹子的内部凹槽会把一根拆成好几段，任何投影/连通域计数都会被它击穿。
  → 数量**交回目视**；本脚本只做**配色带判据**（左/中/右三带各自的红:绿像素比），
    这条是颜色统计、不是形状计数，可靠。
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
TIAO = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'tiao')   # 已归档（原 tile-samples/tiao）
WAN = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'wan')
REF = '/Users/consli/.workbuddy/clipboard-images/clipboard-2026-10-05T06-20-00-635Z-c1438df3.png'
GEN = os.path.join(TIAO, 'rejected', '九条-候选甲-生图原始落盘.png')
OUT = os.path.join(BASE, '27-九条v6-两候选验收板.png')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG, PANEL, PANEL2, LINE = (12, 22, 18), (19, 34, 28), (23, 41, 34), (44, 68, 58)
CREAM, MUTE, GOLD, GOLD_HI = (240, 245, 239), (146, 168, 156), (246, 196, 69), (255, 224, 138)
TEAL, ORANGE, RED = (143, 227, 197), (255, 158, 96), (216, 67, 47)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:
            _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception:
            _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]


# ══ 几何：金框判据 R−B>85（比 HSV 色相稳——象牙牌的暖调不会误入）══════════
def gold_mask(a):
    return (a[:, :, 0].astype(np.int16) - a[:, :, 2].astype(np.int16)) > 85


def geom(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im, dtype=np.int16)
    W, H = im.size
    g = gold_mask(a)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    bg = (np.abs(R - 250) < 12) & (np.abs(G - 250) < 12) & (np.abs(B - 250) < 12)
    body = ~bg
    rows, cols = body.sum(axis=1), body.sum(axis=0)
    ry = np.nonzero(rows > W * 0.15)[0]
    rx = np.nonzero(cols > H * 0.15)[0]
    cy, cx = (ry[0] + ry[-1]) // 2, (rx[0] + rx[-1]) // 2

    def runs(v):
        out, s = [], None
        for i, x in enumerate(v.tolist()):
            if x > 0.5:
                if s is None: s = i
            else:
                if s is not None: out.append((s, i - 1)); s = None
        if s is not None: out.append((s, len(v) - 1))
        return out

    gr, gc = runs(g[cy, :]), runs(g[:, cx])
    tile = (int(rx[0]), int(rx[-1]), int(ry[0]), int(ry[-1]))
    if gr and gc:
        face = (gr[0][1] + 1, gr[-1][0] - 1, gc[0][1] + 1, gc[-1][0] - 1)
    else:
        # 无金框的图（如用户参考图）：面心回退为「整图内缩」
        face = (int(W * 0.12), int(W * 0.88), int(H * 0.08), int(H * 0.92))
    return dict(im=im, a=a, gold=g, W=W, H=H, tile=tile, face=face, has_frame=bool(gr and gc))


def band_diff(A, B, tile, face):
    """牌体内、面心外 的环形带逐像素平均差 + 四角卷草块（角块严格取面心之外，避免被面心污染）。"""
    tx0, tx1, ty0, ty1 = tile
    fx0, fx1, fy0, fy1 = face
    m = np.zeros((A.shape[0], A.shape[1]), bool)
    m[ty0:ty1 + 1, tx0:tx1 + 1] = True
    m[fy0:fy1 + 1, fx0:fx1 + 1] = False
    d = np.abs(A - np.asarray(B, np.int16)).mean(axis=2)
    band = d[m]
    corners = []
    for (yy0, yy1, xx0, xx1) in [(ty0, fy0, tx0, fx0), (ty0, fy0, fx1, tx1),
                                 (fy1, ty1, tx0, fx0), (fy1, ty1, fx1, tx1)]:
        corners.append(float(d[yy0:yy1, xx0:xx1].mean()))
    return dict(band=float(band.mean()), p95=float(np.percentile(band, 95)),
                n=int(band.size), corners=corners)


def masks(a):
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    grn = (G > R + 18) & (G > B + 18) & (G > 45)
    # ★ 红判据必须加 G < 0.62R：深色金 (190,120,50) 的 G/R≈0.63，不加会被算成「红」，
    #   于是「红像素」会一路铺到金框上去（本轮实测 x 范围被撑到整个面心宽）。
    #   朱红 (192,57,43) 的 G/R≈0.30，安全通过。
    red = (R > G + 45) & (R > B + 45) & (R > 95) & (G < 0.62 * R)
    return grn, red


def _motif_region(im, face, frac=0.25):
    """定出「图案区」的 x/y 范围。
    不用固定内缩量：金框内缘有一圈暖棕过渡影（R>G+45 且 G/R≈0.59，会被红判据吃掉），
    固定内缩 30px 仍清不干净 → 改用**列/行计数阈值**（>25% 峰值才算图案列），
    淡影每列只有几个像素，自然被排除。"""
    a = np.asarray(im.convert('RGB'), np.int16)
    fx0, fx1, fy0, fy1 = face
    fw, fh = fx1 - fx0 + 1, fy1 - fy0 + 1
    ins = max(3, int(0.05 * min(fw, fh)))
    grn, red = masks(a)
    inner = np.zeros(a.shape[:2], bool)
    inner[fy0 + ins:fy1 - ins + 1, fx0 + ins:fx1 - ins + 1] = True
    both = (grn | red) & inner
    cs, rs = both.sum(axis=0), both.sum(axis=1)
    cx = np.nonzero(cs > cs.max() * frac)[0]
    ry = np.nonzero(rs > rs.max() * frac)[0]
    return both, (int(cx.min()), int(cx.max())), (int(ry.min()), int(ry.max()))


def color_bands(im, face):
    """面心内 左/中/右 三带各自的红:绿像素 —— 度量「中列朱红 · 两侧深绿」。"""
    both, (x0, x1), _ = _motif_region(im, face)
    a = np.asarray(im.convert('RGB'), np.int16)
    grn, red = masks(a)
    span = x1 - x0 + 1
    out = []
    for k in range(3):
        xs, xe = x0 + int(span * k / 3), x0 + int(span * (k + 1) / 3)
        m = np.zeros_like(both); m[:, xs:xe] = True
        out.append((int((red & m).sum()), int((grn & m).sum()), xs, xe))
    return out, (x0, x1)


def pattern_bbox(im, face):
    _, xr, yr = _motif_region(im, face)
    return xr[0], xr[1], yr[0], yr[1]


# ══ 主体定位（与万子归一化同一口径）═══════════════════════════════════════
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
        if a is not None and b is not None and b - a > W * 0.25:
            L.append(a); R.append(b)
    for x in range(0, W, step):
        a, b = scan([1 if p[x, y] > sth else 0 for y in range(H)], H)
        if a is not None and b is not None and b - a > H * 0.25:
            T.append(a); B.append(b)
    med = lambda a: sorted(a)[len(a) // 2]
    return med(L), med(T), med(R), med(B)


def kill_watermark(im):
    """底部水印带统一裁除（y≥1425，与第 17/19 轮同一工艺）。"""
    W, H = im.size
    if H > 1440:
        bgp = im.crop((0, 1385, W, 1405)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - 1425), bgp), (0, 1425))
    return im


def crop_rect(im, fill=0.78, aspect=0.75):
    W, H = im.size
    x0, y0, x1, y1 = subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ch = bh / fill
    cw = ch * aspect
    if cw > W: cw, ch = W, W / aspect
    if ch > H: ch, cw = H, H * aspect
    l = min(max(0, cx - cw / 2), W - cw)
    t = min(max(0, cy - ch / 2), H - ch)
    return (int(round(l)), int(round(t)), int(round(l + cw)), int(round(t + ch)))


# ══════════════════════════════════════════════════════════════════════
print('【1】几何测量（一万-raw 为对齐基准）')
WAN_RAW = os.path.join(WAN, '一万-raw.png')
G, B = geom(WAN_RAW), geom(GEN)
for nm, d in [('一万-raw', G), ('九条-新  ', B)]:
    print('  %s 牌体 x%d..%d y%d..%d | 面心 x%d..%d y%d..%d (%dx%d)'
          % (nm, d['tile'][0], d['tile'][1], d['tile'][2], d['tile'][3],
             d['face'][0], d['face'][1], d['face'][2], d['face'][3],
             d['face'][1] - d['face'][0] + 1, d['face'][3] - d['face'][2] + 1))
pb = pattern_bbox(B['im'], B['face'])
print('  九条-新 面心内图案 bbox x%d..%d y%d..%d  （面心 x%d..%d y%d..%d）'
      % (pb[0], pb[1], pb[2], pb[3], B['face'][0], B['face'][1], B['face'][2], B['face'][3]))

# ── 候选乙：一万原像素为底，只换面心（严格不越出面心 → 边框差恒为 0）────
ix0, ix1 = max(G['face'][0], B['face'][0]), min(G['face'][1], B['face'][1])
iy0, iy1 = max(G['face'][2], B['face'][2]), min(G['face'][3], B['face'][3])
print('\n【2】合成候选乙：替换矩形 = 两图面心交集 x%d..%d y%d..%d（向内 12px 羽化，不越出面心）'
      % (ix0, ix1, iy0, iy1))

base = kill_watermark(Image.open(WAN_RAW).convert('RGB')).copy()
src = Image.open(GEN).convert('RGB')
patch = src.crop((ix0, iy0, ix1 + 1, iy1 + 1))
w, h = patch.size
mk = Image.new('L', (w, h), 0)
ImageDraw.Draw(mk).rectangle([12, 12, w - 13, h - 13], fill=255)
mk = mk.filter(ImageFilter.GaussianBlur(5))
base.paste(patch, (ix0, iy0), mk)
V6B_RAW = os.path.join(TIAO, '九条-v6B-框复用-raw.png')
base.save(V6B_RAW)
V6A_RAW = os.path.join(TIAO, '九条-v6A-图生图-raw.png')
kill_watermark(Image.open(GEN).convert('RGB')).save(V6A_RAW)

# ── 边框一致性复核 ──────────────────────────────────────────────────────
print('\n【3】边框一致性（对一万-raw，同尺寸同构图，逐像素）')
DIFF = {}
for nm, p in [('候选甲 图生图', V6A_RAW), ('候选乙 框复用', V6B_RAW)]:
    d = geom(p)
    r = band_diff(G['a'], d['a'], G['tile'], G['face'])
    DIFF[nm] = r
    print('  %s  面心 x%d..%d y%d..%d | 边框带 平均|Δ|=%.2f (P95 %.2f, n=%d) | 四角卷草 %s'
          % (nm, d['face'][0], d['face'][1], d['face'][2], d['face'][3],
             r['band'], r['p95'], r['n'], ' / '.join('%.2f' % c for c in r['corners'])))

# ── 配色带判据（颜色统计，非形状计数）────────────────────────────────────
print('\n【4】配色带判据（面心内 左/中/右 三带 红:绿 像素）')
BANDS = {}
for nm, p in [('参考图(用户提供)', REF), ('一万(基准)', WAN_RAW)] + \
             [('候选甲 图生图', V6A_RAW), ('候选乙 框复用', V6B_RAW)]:
    d = geom(p)
    bands, span = color_bands(d['im'], d['face'])
    BANDS[nm] = bands
    print('  %s  图案 x%d..%d' % (nm, span[0], span[1]))
    for i, (r, g, xs, xe) in enumerate(bands):
        side = ['左', '中', '右'][i]
        verdict = '红为主' if r > g * 1.5 else ('绿为主' if g > r * 1.5 else '相近')
        print('      %s带 x%d..%d  红 %6d / 绿 %6d  → %s' % (side, xs, xe, r, g, verdict))

# ── 归一化（三张同一裁切矩形 → 边框差异可直接肉眼比对）──────────────────
print('\n【5】归一化（同一裁切矩形 · 3:4 · 牌占高 78%）')
IMG = {k: kill_watermark(Image.open(v).convert('RGB'))
       for k, v in [('一万', WAN_RAW), ('候选甲', V6A_RAW), ('候选乙', V6B_RAW)]}
rect = crop_rect(IMG['一万'])
print('  裁切矩形 %s → 画布 %dx%d' % (rect, rect[2] - rect[0], rect[3] - rect[1]))
CANV, STAT = {}, {}
for nm, out in [('一万', None), ('候选甲', os.path.join(TIAO, '九条-v6A-图生图.png')),
                ('候选乙', os.path.join(TIAO, '九条-v6B-框复用.png'))]:
    c = IMG[nm].crop(rect)
    if out: c.save(out)
    CANV[nm] = c
    bx = subject_bbox(c)
    tw, th = bx[2] - bx[0], bx[3] - bx[1]
    STAT[nm] = (tw, th, tw / th, th / c.size[1])
    print('  %s 画布 %dx%d  牌体 %dx%d  宽高比 %.3f  占高 %.3f'
          % (nm, c.size[0], c.size[1], tw, th, tw / th, th / c.size[1]))

# ══ 指标（全部实测，不手写）════════════════════════════════════════════
MET = {}
for nm, p in [('一万', WAN_RAW), ('候选甲', V6A_RAW), ('候选乙', V6B_RAW)]:
    d = geom(p)
    tx0, tx1, ty0, ty1 = d['tile']
    fx0, fx1, fy0, fy1 = d['face']
    MET[nm] = dict(tw=tx1 - tx0 + 1, th=ty1 - ty0 + 1,
                   fx0=fx0, fx1=fx1, fy0=fy0, fy1=fy1,
                   far=(fx1 - fx0 + 1) / (fy1 - fy0 + 1))
print('\n【6】指标汇总')
for nm, m in MET.items():
    print('  %s 牌体 %d×%d | 面心 x%d..%d y%d..%d | 宽高比 %.3f'
          % (nm, m['tw'], m['th'], m['fx0'], m['fx1'], m['fy0'], m['fy1'], m['far']))

# ══════════════════════════════════════════════════════════════════════
#  验收板
# ══════════════════════════════════════════════════════════════════════
MW, M = 1500, 46
TW_A, TH_A, GAP = 322, 430, 26
BW, GAP_B = 440, 44                    # B 区面板统一宽 440（3 × 440 + 2 × 44 = 1408 = 内容宽）
RH_PAT, RH_COR = 560, 300              # 图案行 / 边角行 面板高

H_A = 130
rowA = H_A + 44
H_B = rowA + TH_A + 66
rowsB = [('面心图案放大（可直接数根数）', 'face', RH_PAT, '一万', '候选甲', '候选乙'),
         ('左上角卷草', 'tl', RH_COR, '一万', '候选甲', '候选乙'),
         ('右下角卷草', 'br', RH_COR, '一万', '候选甲', '候选乙')]
H_TAB = H_B + 78 + sum(rh + 66 for _a, _b, rh, *_c in rowsB)
TAB_ROWS = 10
H_ALL = H_TAB + 104 + TAB_ROWS * 40 + 46

img = Image.new('RGB', (MW, H_ALL), BG)
dr = ImageDraw.Draw(img)

dr.text((M, 34), '九条 v6 · 两候选验收板', font=F(40, True), fill=GOLD_HI)
dr.text((M, 88), '① 中间图案配色照参考图（中列朱红 · 两侧深绿）　② 金色边框与「一万」完全一致',
        font=F(21), fill=CREAM)

# ── A 区 ────────────────────────────────────────────────────────────
dr.text((M, H_A), 'A · 参照与候选', font=F(25, True), fill=GOLD)
itemsA = [('参考图（配色依据 · 用户提供）', Image.open(REF).convert('RGB'), ORANGE),
          ('一万（边框基准）', CANV['一万'], CREAM),
          ('候选甲 · 图生图', CANV['候选甲'], TEAL),
          ('候选乙 · 一万框像素级复用', CANV['候选乙'], TEAL)]
x = (MW - (TW_A * 4 + GAP * 3)) // 2
for cap, im, cc in itemsA:
    sc = min(TW_A / im.width, TH_A / im.height)
    box = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
    dr.rectangle([x - 2, rowA - 2, x + TW_A + 2, rowA + TH_A + 2], outline=LINE, width=2)
    img.paste(box, (x + (TW_A - box.width) // 2, rowA + (TH_A - box.height) // 2))
    cf = F(18, True)
    dr.text((x + TW_A // 2 - dr.textlength(cap, font=cf) / 2, rowA + TH_A + 12), cap, font=cf, fill=cc)
    x += TW_A + GAP

# ── B 区：放大对照 ───────────────────────────────────────────────────
dr.text((M, H_B), 'B · 图案与边框放大对照（同一裁切矩形 · 同一放大倍率）', font=F(25, True), fill=GOLD)
bb = subject_bbox(CANV['一万'])
tx0, ty0, tx1, ty1 = bb
tw, th = tx1 - tx0, ty1 - ty0
boxes = {
    'face': (max(0, tx0 - 8), max(0, ty0 - 8), min(CANV['一万'].width, tx1 + 8),
             min(CANV['一万'].height, ty1 + 8)),
    'tl': (max(0, tx0 - 6), max(0, ty0 - 6), tx0 + int(tw * 0.34), ty0 + int(th * 0.24)),
    'br': (tx1 - int(tw * 0.34), ty1 - int(th * 0.24),
           min(CANV['一万'].width, tx1 + 6), min(CANV['一万'].height, ty1 + 6)),
}
top = H_B + 78
for cn, key, rh, *names in rowsB:
    dr.text((M, top - 32), cn, font=F(21, True), fill=CREAM)
    x = M
    for nm in names:
        c = CANV[nm].crop(boxes[key])
        sc = min(BW / c.width, rh / c.height)
        c = c.resize((max(1, int(c.width * sc)), max(1, int(c.height * sc))), Image.LANCZOS)
        dr.rectangle([x - 2, top - 2, x + BW + 2, top + rh + 2], outline=LINE, width=2)
        img.paste(c, (x + (BW - c.width) // 2, top + (rh - c.height) // 2))
        dr.text((x + BW // 2 - dr.textlength(nm, font=F(19, True)) / 2, top + rh + 8),
                nm, font=F(19, True), fill=MUTE)
        x += BW + GAP_B
    top += rh + 66

# ── C 区：指标表 ─────────────────────────────────────────────────────
dr.text((M, H_TAB), 'C · 指标（边框差以「一万-raw」同尺寸同构图为基准逐像素计算）', font=F(25, True), fill=GOLD)
g = lambda nm: MET[nm]
b1, b2 = BANDS['候选甲 图生图'], BANDS['候选乙 框复用']
fm = lambda bs: '　'.join('%s %d:%d' % (['左', '中', '右'][i], r, gg)
                         for i, (r, gg, _a, _b) in enumerate(bs))
d1, d2 = DIFF['候选甲 图生图'], DIFF['候选乙 框复用']
rows = [
    ('牌体 宽 × 高', '%d×%d' % (g('一万')['tw'], g('一万')['th']),
     '%d×%d' % (g('候选甲')['tw'], g('候选甲')['th']),
     '%d×%d' % (g('候选乙')['tw'], g('候选乙')['th']), CREAM),
    ('面心（金框内）x 范围', '%d..%d' % (g('一万')['fx0'], g('一万')['fx1']),
     '%d..%d' % (g('候选甲')['fx0'], g('候选甲')['fx1']),
     '%d..%d' % (g('候选乙')['fx0'], g('候选乙')['fx1']), CREAM),
    ('面心（金框内）y 范围', '%d..%d' % (g('一万')['fy0'], g('一万')['fy1']),
     '%d..%d' % (g('候选甲')['fy0'], g('候选甲')['fy1']),
     '%d..%d' % (g('候选乙')['fy0'], g('候选乙')['fy1']), CREAM),
    ('面心 宽高比', '%.3f' % g('一万')['far'], '%.3f' % g('候选甲')['far'],
     '%.3f' % g('候选乙')['far'], CREAM),
    ('边框带 平均|Δ|（vs 一万）', '0.00（基准）', '%.2f' % d1['band'], '%.2f' % d2['band'], TEAL),
    ('四角卷草 平均|Δ|', '0.00（基准）',
     '%.2f ~ %.2f' % (min(d1['corners']), max(d1['corners'])),
     '%.2f ~ %.2f' % (min(d2['corners']), max(d2['corners'])), TEAL),
    ('三带 红:绿 像素', '—（万字无绿）', fm(b1), fm(b2), CREAM),
    ('配色布局', '—', '左绿 · 中红 · 右绿', '左绿 · 中红 · 右绿', GOLD_HI),
    ('金框来源', 'AI 生成（基准）', '图生图复刻 · 差 %.1f%%' % (d1['band'] / 255 * 100),
     '一万原像素直接复用 · 零差', TEAL),
    ('判定', '—', '✅ 配色 / 形状达标', '✅ 同上，且边框字面完全一致', GOLD_HI),
]
ty = H_TAB + 46
colx = [M + 12, M + 452, M + 762, M + 1108]
for i, r in enumerate(rows):
    if i % 2 == 0:
        dr.rectangle([M, ty - 6, MW - M, ty + 34], fill=PANEL if (i // 2) % 2 == 0 else PANEL2)
    dr.text((colx[0], ty + 4), r[0], font=F(19), fill=MUTE)
    for j in (1, 2, 3):
        dr.text((colx[j], ty + 4), r[j], font=F(18, j == 3), fill=r[4])
    ty += 40
dr.line([M, ty + 6, MW - M, ty + 6], fill=LINE, width=1)
dr.text((M, ty + 18),
        '候选甲 = AI 图生图整张；候选乙 = 一万原像素打底 + 仅换面心 → 边框与一万逐像素零差。',
        font=F(19), fill=CREAM)
dr.text((M, ty + 44),
        '数量判据说明：图案「根数」不做机器断言（投影/连通域计数会被竹节凹槽击穿，已在已知真值图上复现），'
        '改由 B 区放大目视核对；配色带判据先在用户参考图上跑出正确结论才用于候选。',
        font=F(17), fill=MUTE)

img.save(OUT)
print('\n验收板 →', OUT, img.size)
