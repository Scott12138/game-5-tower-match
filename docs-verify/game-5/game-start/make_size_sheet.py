# -*- coding: utf-8 -*-
"""骰子入盘·尺寸档位对比：按骰盘实测几何（金环内半径 83）给出可放下的上限。"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = 'docs-verify/game-5/game-start'
D = BASE + '/proc/dice_faces'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
CR = 0.7996                     # 内容占画布（定值）
CX, CY = 373, 376               # 骰盘圆心（桌图坐标系）
R_IN = 81                       # 金环内侧半径（实测 83，再让 2px）
GOLD = (246, 196, 69); OKC = (140, 220, 170); BADC = (240, 130, 120)
TXT = (232, 240, 232); DIM = (152, 172, 156); BG = (10, 24, 19)


def ft(s): return ImageFont.truetype(FONT, s, index=0)


def fit(d, t, mw, s, mn=11):
    while s > mn:
        f = ft(s)
        if d.textlength(t, font=f) <= mw: return f
        s -= 1
    return ft(mn)


def die(n, s_vis, scale):
    px = int(round(s_vis / CR * scale))
    return Image.open(D + '/face%d_384.png' % n).convert('RGBA').resize((px, px), Image.LANCZOS)


table = Image.open('assets/game-start/table_default.jpg').convert('RGBA')
CROP = 344                     # 骰盘特写边长（桌图坐标）
CELL = 300
scale = CELL / CROP

cases = [48, 52, 56, 64, 84]
PAD, GAP, TH, FH = 40, 22, 92, 118
W = PAD * 2 + CELL * len(cases) + GAP * (len(cases) - 1)
H = PAD + TH + CELL + FH
canvas = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(canvas)
d.text((PAD, PAD), '骰子入盘 · 尺寸档位（按骰盘实测几何判定）', font=ft(32), fill=GOLD)
sub = '骰盘：金环内半径 83 · 环宽 32 · 盘内可用半径 81 → 两颗骰子「对角摆放且不压金环」的边长上限约 56'
d.text((PAD, PAD + 44), sub, font=fit(d, sub, W - PAD * 2, 19), fill=DIM)

for i, S in enumerate(cases):
    x = PAD + i * (CELL + GAP)
    y = PAD + TH
    tile = table.crop((CX - CROP // 2, CY - CROP // 2, CX + CROP // 2, CY + CROP // 2)).resize((CELL, CELL), Image.LANCZOS)
    # 盘内可用圆（判定线）
    dt = ImageDraw.Draw(tile)
    rr = R_IN * scale
    dt.ellipse([CELL / 2 - rr, CELL / 2 - rr, CELL / 2 + rr, CELL / 2 + rr], outline=(255, 255, 255, 110), width=1)
    # 两颗骰子（对角）
    dd = int(S * 1.35)
    dx = dd / 2 / np.sqrt(2)
    far = float(np.hypot(dx + S / 2, dx + S / 2))
    gate = '✓ 放得下' if far <= R_IN else '✗ 压金环'
    for n, sx, sy in ((1, -1, -1), (6, 1, 1)):
        im = die(n, S, scale)
        tile.alpha_composite(im, (int(CELL / 2 + sx * dx * scale - im.size[0] / 2),
                                  int(CELL / 2 + sy * dx * scale - im.size[1] / 2)))
    canvas.paste(tile.convert('RGB'), (x, y))

    d.rounded_rectangle([x, y, x + CELL - 1, y + CELL - 1], radius=14, outline=(60, 90, 76), width=1)
    t = '边长 %d' % S
    d.text((x + 8, y - 34), t, font=ft(23), fill=GOLD if S == 52 else TXT)
    t2 = '占盘径 %.0f%%' % (S / 228.4 * 100)
    d.text((x + 8, y + CELL + 10), t2, font=ft(17), fill=DIM)
    t3 = '最远点半径 %.0f / 可用 %.0f' % (far, R_IN)
    d.text((x + 8, y + CELL + 34), t3, font=ft(16), fill=DIM)
    d.text((x + 8, y + CELL + 58), gate, font=ft(19), fill=OKC if far <= R_IN else BADC)
    if S == 84:
        d.text((x + 8, y + CELL + 84), '（上一轮建议值·超界）', font=ft(15), fill=BADC)

d.text((PAD, H - FH + 96), '判定线 = 白圈（盘内可用半径 81）；两颗骰子按对角摆放、中心距 1.35× 边长',
       font=fit(d, '判定线 = 白圈（盘内可用半径 81）；两颗骰子按对角摆放、中心距 1.35× 边长', W - PAD * 2, 18), fill=DIM)
canvas.save(BASE + '/07-骰子尺寸档位.png')
print('saved', canvas.size)
for S in cases:
    dd = int(S * 1.35); dx = dd / 2 / np.sqrt(2)
    print('  S=%-3d  最远点 %.1f  %s' % (S, np.hypot(dx + S / 2, dx + S / 2), '放得下' if np.hypot(dx + S / 2, dx + S / 2) <= R_IN else '压金环'))
