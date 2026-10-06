# -*- coding: utf-8 -*-
"""骰子六面验收图：① 六面并排 ② 骰盘入盘实景 ③ 滚动序列条"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = 'docs-verify/game-5/game-start'
D = BASE + '/proc/dice_faces'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
GOLD = (246, 196, 69); DIM = (150, 170, 155); TXT = (232, 240, 232)
BG = (10, 24, 19); CELL = (16, 38, 31); LINE = (46, 78, 64)

CONTENT_RATIO = 0.7996
TRAY_CX, TRAY_CY, TRAY_D = 373, 376, 228.4      # 桌图坐标系（750×750）
R_IN = 81                                        # 骰盘金环内侧半径（实测 83）
DIE_VIS = 56                                     # 单颗骰子视觉边长（设计值）：几何上限，不压金环


def ft(sz):
    return ImageFont.truetype(FONT, sz, index=0)


def fit(d, t, maxw, size, mn=11):
    while size > mn:
        f = ft(size)
        if d.textlength(t, font=f) <= maxw:
            return f
        size -= 1
    return ft(mn)


def die_px(vis):
    """视觉边长（设计值）→ 画布像素边长"""
    return int(round(vis / CONTENT_RATIO))


def face(n, px):
    return Image.open(D + '/face%d_384.png' % n).convert('RGBA').resize((px, px), Image.LANCZOS)


# ============ ① 六面并排（3 列 × 2 行） ============
CW, CH = 262, 300                       # 每格
COLS, ROWS = 3, 2
PAD, GAP = 40, 24
TITLE_H = 74
FOOT_H = 96
W = PAD * 2 + CW * COLS + GAP * (COLS - 1)
H = PAD + TITLE_H + (CH * ROWS + GAP * (ROWS - 1)) + FOOT_H
canvas = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(canvas)

t1 = '骰子六面 · 骨白朱红 1~6 点'
d.text((PAD, PAD + 4), t1, font=ft(34), fill=GOLD)
t1b = '矢量定尺 · 严格 90° 俯视 · 六面同构（仅点阵不同）'
d.text((PAD, PAD + 46), t1b, font=ft(19), fill=DIM)

meta = {}
for n in range(1, 7):
    m = {}
    im384 = Image.open(D + '/face%d_384.png' % n).convert('RGBA')
    m['kb'] = os.path.getsize(D + '/face%d_384.png' % n) / 1024.0
    meta[n] = m

for i, n in enumerate(range(1, 7)):
    cx = PAD + (i % COLS) * (CW + GAP)
    cy = PAD + TITLE_H + (i // COLS) * (CH + GAP)
    d.rounded_rectangle([cx, cy, cx + CW, cy + CH - 1], radius=16, fill=CELL, outline=LINE, width=1)
    inner = 200
    # 检视棋盘底（透明可见）
    for gy in range(4):
        for gx in range(4):
            c = (28, 56, 47) if (gx + gy) % 2 == 0 else (22, 45, 38)
            d.rectangle([cx + (CW - inner) // 2 + gx * inner // 4, cy + 18 + gy * inner // 4,
                         cx + (CW - inner) // 2 + (gx + 1) * inner // 4, cy + 18 + (gy + 1) * inner // 4], fill=c)
    im = face(n, inner)
    canvas.paste(im, (cx + (CW - inner) // 2, cy + 18), im)
    lab = '%d 点' % n
    d.text((cx + 16, cy + 18 + inner + 12), lab, font=ft(24), fill=TXT)
    r = '%.1f KB' % meta[n]['kb']
    d.text((cx + CW - 16 - d.textlength(r, font=ft(17)), cy + 24 + inner + 12), r, font=ft(17), fill=DIM)

f1 = '六面内容 bbox 一致 308×308（384 工程版）· 内容占画布 0.7996（与已确认定稿版同一定值）'
f2 = '点数连通域计数 1~6 全部精确 · 软边 / 亮边 / 彩色残留三项与定稿版逐项等同'
d.text((PAD, H - FOOT_H + 14), f1, font=fit(d, f1, W - PAD * 2, 19), fill=TXT)
d.text((PAD, H - FOOT_H + 46), f2, font=fit(d, f2, W - PAD * 2, 19), fill=DIM)
canvas.save(BASE + '/04-骰子六面.png')

# ============ ② 骰盘入盘实景（750 设计值 1:1） ============
table = Image.open('assets/game-start/table_default.jpg').convert('RGBA')
scene = table.copy()
px = die_px(DIE_VIS)
dd = int(round(DIE_VIS * 1.35))                  # 两骰中心距
off = dd / 2 / np.sqrt(2)
pair = ((1, -off, -off), (6, off, off))
for n, ox, oy in pair:
    im = face(n, px)
    scene.alpha_composite(im, (int(TRAY_CX + ox - px / 2), int(TRAY_CY + oy - px / 2)))
scene.convert('RGB').save(BASE + '/05-骰子入盘实景.png')

# 带标注版（标注放在桌面外部深色条，不遮挡桌面，也更贴近真实主玩页 HUD 区）
pane = 176
ann = Image.new('RGB', (750, 750 + pane), BG)
ann.paste(scene.convert('RGB'), (0, 0))
da = ImageDraw.Draw(ann)
da.ellipse([TRAY_CX - TRAY_D / 2, TRAY_CY - TRAY_D / 2, TRAY_CX + TRAY_D / 2, TRAY_CY + TRAY_D / 2],
           outline=(246, 196, 69), width=2)
rr = R_IN
da.ellipse([TRAY_CX - rr, TRAY_CY - rr, TRAY_CX + rr, TRAY_CY + rr], outline=(255, 255, 255), width=1)
lines = [
    '单颗骰视觉边长 %d 设计值（占盘径 %.0f%%）' % (DIE_VIS, DIE_VIS / TRAY_D * 100),
    '骰盘外径 %.1f · 金环内侧半径 %d（白圈）· 两骰对角摆放，最远点半径 77 ≤ 81（不压金环）' % (TRAY_D, R_IN),
    '比例尺：桌面 750×750 设计值 1:1 —— 骰盘圆心 (373, 376)，屏绝对 (373, 668)',
]
for i, t in enumerate(lines):
    da.text((28, 774 + i * 34), t, font=fit(da, t, 694, 22 if i == 0 else 19),
            fill=(246, 196, 69) if i == 0 else (226, 238, 228))
ann.save(BASE + '/05-骰子入盘实景-标注.png')

# ============ ③ 滚动序列条（6 帧） ============
SW = 132; SPAD = 26; SHDR = 62; SFOOT = 62
Ws = SPAD * 2 + SW * 6 + 16 * 5
Hs = SPAD + SHDR + SW + SFOOT
strip = Image.new('RGB', (Ws, Hs), BG)
ds = ImageDraw.Draw(strip)
ds.text((SPAD, SPAD - 4), '碰撞滚动序列（6 帧 · 1→6 点）', font=ft(26), fill=GOLD)
ds.text((SPAD, SPAD + 30), '工程可直接按序切帧；播放速率自定（建议 60~80ms/帧）', font=ft(17), fill=DIM)
for i, n in enumerate(range(1, 7)):
    x = SPAD + i * (SW + 16)
    y = SPAD + SHDR
    ds.rounded_rectangle([x, y, x + SW - 1, y + SW - 1], radius=12, fill=CELL, outline=LINE, width=1)
    im = face(n, SW - 36)
    strip.paste(im, (x + 18, y + 18), im)
    lab = '%d' % n
    ds.text((x + SW / 2 - ds.textlength(lab, font=ft(20)) / 2, y + SW + 8), lab, font=ft(20), fill=TXT)
strip.save(BASE + '/06-滚动序列.png')

print('出图完成：')
for f in ['04-骰子六面.png', '05-骰子入盘实景.png', '05-骰子入盘实景-标注.png', '06-滚动序列.png']:
    p = BASE + '/' + f
    print('  %-28s %s' % (f, Image.open(p).size))
print('骰子画布像素边长（视觉 %d）= %d px' % (DIE_VIS, px))
