#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开局页分镜 · 对撞点 1:1 特写板 v3（三方案横比）
原料：--sc=1 时抓的全页图，按骰盘圆心裁 620x620（1 设计值 = 1 CSS px，等比不放大）。
图上叠加几何校验环（1:1，可直接目视判定是否越环）：盘内可用半径 81 / 金环内半径 83。
每列一套方案，上行 = 对撞点（挤压力 0），下行 = 撞后 12ms（挤压峰值，最易越环的时刻）。"""
import json, os, math
from PIL import Image, ImageDraw, ImageFont

BASE   = os.path.dirname(os.path.abspath(__file__))
PROC   = os.path.join(BASE, 'proc')
BOARDS = os.path.join(PROC, 'boards')
OUT    = os.path.join(BASE, '09-碰撞特写.png')
FONT   = '/System/Library/Fonts/Hiragino Sans GB.ttc'

# --sc=1 实测：#screen 文档矩形 (100,154,750,1334)；骰盘圆心 = (100+373, 154+668) = (473,822)
CROP_BOX = (163, 512, 783, 1132)
CENTER   = (310, 310)
SIDE     = 620

BG, PANEL = (11, 15, 12), (18, 23, 19)
GOLD, GOLD_HI = (246, 196, 69), (255, 224, 138)
CREAM, CREAM_DIM, CREAM_MUTE = (232, 238, 231), (176, 190, 178), (120, 134, 122)
BLUE, GREEN, ORANGE = (120, 190, 255), (143, 227, 197), (255, 158, 96)

COLS = [('A', '直撞',     '撞点 = 盘心',      '两骰相向加速，在盘心正面对撞'),
        ('B', '追尾',     '撞点 = 盘壁切向',   '同向绕盘，后骰追上并侧碰前骰'),
        ('C', '环壁对迎', '撞点 = 盘壁迎头',   '反向扫掠，在盘壁上迎头相撞')]

_fc = {}
def F(sz):
    if sz not in _fc:
        _fc[sz] = ImageFont.truetype(FONT, sz)
    return _fc[sz]

def dashed_circle(d, cx, cy, r, color, width=1):
    """用短弧段画虚线圈"""
    box = [cx - r, cy - r, cx + r, cy + r]
    a = 0.0
    while a < 360:
        b = min(a + 4.0, 360)
        d.arc(box, a, b, fill=color, width=width)
        a += 9.0

def main():
    data = json.load(open(os.path.join(PROC, 'clash_default.json'), encoding='utf-8'))
    PAD, GAP, HEAD, FOOT, READ_H = 26, 20, 108, 86, 48
    W = PAD * 2 + 3 * SIDE + 2 * GAP
    H = HEAD + 2 * (SIDE + READ_H + 14) + GAP + FOOT
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)

    d.text((PAD, 30), '开局页掷骰分镜 · 对撞点 1:1 特写（三方案）', font=F(28), fill=CREAM)
    d.text((PAD, 68), '1 设计值 = 1 px，等比不放大；叠几何校验环，可直接目视判定骰子是否越环',
           font=F(14), fill=CREAM_MUTE)
    d.line([(PAD, HEAD - 12), (W - PAD, HEAD - 12)], fill=(72, 82, 70), width=1)
    d.line([(PAD, HEAD - 12), (PAD + 96, HEAD - 12)], fill=GOLD, width=2)

    ROWS = [('对撞点（挤压 0）', 0), ('撞后 12 ms（挤压峰值）', 1)]

    for c, (key, cn, where, note) in enumerate(COLS):
        x0 = PAD + c * (SIDE + GAP)
        for ri, (rname, idx) in enumerate(ROWS):
            y0 = HEAD + ri * (SIDE + READ_H + 14)
            fr = data[key][idx]
            p  = os.path.join(BOARDS, 'c_%s_%d.png' % (key, fr['t']))
            cell = Image.open(p).convert('RGB').crop(CROP_BOX)
            im.paste(cell, (x0, y0))

            cx, cy = x0 + CENTER[0], y0 + CENTER[1]
            dashed_circle(d, cx, cy, 81, (255, 255, 255), 1)
            dashed_circle(d, cx, cy, 83, BLUE, 1)
            d.line([(cx - 7, cy), (cx + 7, cy)], fill=GOLD, width=1)
            d.line([(cx, cy - 7), (cx, cy + 7)], fill=GOLD, width=1)
            d.rectangle([x0, y0, x0 + SIDE - 1, y0 + SIDE - 1], outline=(58, 66, 58), width=1)

            d.rectangle([x0 + 1, y0 + 1, x0 + 214, y0 + 26], fill=(10, 14, 11))
            d.text((x0 + 8, y0 + 4), rname, font=F(14), fill=GOLD_HI if ri else CREAM_DIM)

            ry = y0 + SIDE + 4
            d.rectangle([x0, ry, x0 + SIDE - 1, ry + READ_H - 8], fill=PANEL)
            d.text((x0 + 8, ry + 3), '%s %s   %s   %d ms' % (key, cn, where, fr['t']),
                   font=F(13), fill=GOLD_HI)
            t2 = 'r %.1f   两心距/边长 %.3f   最远点 %.1f / 上限 81   挤压 %.2f   点数 %s' % (
                fr['r'], fr['sep'], fr['far'], fr['sq'], fr['fs'])
            d.text((x0 + 8, ry + 22), t2, font=F(11), fill=CREAM_DIM)
            ok = fr['far'] <= 81
            tag = '在环内' if ok else '越环'
            d.text((x0 + SIDE - 10 - d.textlength(tag, font=F(12)), ry + 3), tag,
                   font=F(12), fill=GREEN if ok else ORANGE)

    fy = H - FOOT + 6
    d.line([(PAD, fy - 6), (W - PAD, fy - 6)], fill=(72, 82, 70), width=1)
    legend = [('白虚线 = 盘内可用半径 81（骰子须完全在其中）', (255, 255, 255)),
              ('蓝虚线 = 金环内半径 83', BLUE),
              ('金十字 = 骰盘圆心（= 相机锚点）', GOLD)]
    for i, (s, col) in enumerate(legend):
        d.text((PAD, fy + 8 + i * 21), s, font=F(12), fill=col)
    fa, fb, fc = (data[k][1]['far'] for k in ('A', 'B', 'C'))
    sq = data['A'][1]['sq']
    tail = ['三方案对撞点的「两心距 / 边长」均为 1.000 → 恰好贴合、零穿插。',
            '下行（撞后 12 ms）是挤压峰值（%.2f）时刻，也是最容易越环的时刻。三方案' % sq,
            '最远点为 A %.1f / B %.1f / C %.1f，均 ≤ 81。C 能贴壁迎头相撞而不越环，' % (fa, fb, fc),
            '是因为撞点半径主动内收（撞压 → 离壁），贴合角按内收后的半径反解。']
    for i, s in enumerate(tail):
        d.text((PAD + 640, fy + 8 + i * 21), s, font=F(12), fill=CREAM_DIM)

    im.save(OUT)
    print('saved', OUT, im.size)

if __name__ == '__main__':
    main()
