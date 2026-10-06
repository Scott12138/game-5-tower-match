#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开局页分镜 · A 方案（直撞）八相位细读板 v3

原料：agent-browser 在 seek(t) 定格后抓的全页图，按 #screen 的实测文档矩形
      (100,154,475,821) 裁出手机屏（375x667 CSS px = 750x1334 设计值 @0.5）。
数据：proc/frames_default.json（浏览器 measure() 实测导出，不手抄）。
排版纪律：标签按列宽自适应字号（fit），长文本按列宽换行（wrap），画面一律等比缩放。
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

BASE   = os.path.dirname(os.path.abspath(__file__))
PROC   = os.path.join(BASE, 'proc')
BOARDS = os.path.join(PROC, 'boards')
OUT    = os.path.join(BASE, '08-分镜关键帧.png')
FONT   = '/System/Library/Fonts/Hiragino Sans GB.ttc'

CROP = (100, 154, 475, 821)
CW, CH = 216, 384
GAP, PAD = 10, 26
HEAD, LABEL_H, READ_H, NOTE_H, FOOT = 118, 26, 46, 100, 52

BG, PANEL = (11, 15, 12), (18, 23, 19)
GOLD, GOLD_HI = (246, 196, 69), (255, 224, 138)
CREAM, CREAM_DIM, CREAM_MUTE = (232, 238, 231), (176, 190, 178), (120, 134, 122)
GREEN = (143, 227, 197)

PHASES = [
    ('静止', '驱动接通前\n完全不动'),
    ('驱动末', '盘底金环亮起\n骰子仍静止'),
    ('撞前', '相向加速\n自转 ±90°'),
    ('对撞点', '盘心正面对撞\n两心距 = 边长'),
    ('撞后', '弹性弹开\n向盘壁回退'),
    ('滑行中', '弹回盘壁\n贴金环同向滑'),
    ('拉远·淡出', '相机 easeOut\n骰子渐隐'),
    ('终帧', 'scale 1.000\n骰子已退场'),
]

_fc = {}
def F(sz):
    if sz not in _fc:
        _fc[sz] = ImageFont.truetype(FONT, sz)
    return _fc[sz]

def fit(d, txt, maxw, sz, minSz=8):
    while sz > minSz:
        f = F(sz)
        if d.textlength(txt, font=f) <= maxw:
            return f
        sz -= 1
    return F(minSz)

def wrap_cn(d, txt, maxw, sz, gap=2):
    """按列宽逐字换行（中文无空格，按字符切）"""
    f = F(sz); out, cur = [], ''
    for ch in txt:
        if d.textlength(cur + ch, font=f) <= maxw:
            cur += ch
        else:
            out.append(cur); cur = ch
    if cur:
        out.append(cur)
    return out

def main():
    data = json.load(open(os.path.join(PROC, 'frames_default.json'), encoding='utf-8'))['A']
    W = PAD * 2 + 8 * CW + 7 * GAP
    H = HEAD + LABEL_H + CH + READ_H + NOTE_H + FOOT
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)

    d.text((PAD, 26), '开局页分镜 · 方案 A「直撞」八相位细读', font=F(27), fill=CREAM)
    d.text((PAD, 64), '1.2s / 750x1334 / 骰子视觉边长 48 · 三段：相向加速 → 盘心对撞 → 弹回滑行（每格数字为浏览器实测值）',
           font=F(13), fill=CREAM_MUTE)
    d.line([(PAD, HEAD - 14), (W - PAD, HEAD - 14)], fill=(72, 82, 70), width=1)
    d.line([(PAD, HEAD - 14), (PAD + 88, HEAD - 14)], fill=GOLD, width=2)

    for i, fr in enumerate(data):
        name, note = PHASES[i]
        x = PAD + i * (CW + GAP)
        y = HEAD

        hot = (name == '对撞点')
        d.text((x, y + 4), name, font=F(15), fill=GOLD_HI if hot else CREAM)
        d.text((x + CW - d.textlength('%d ms' % fr['t'], font=F(13)), y + 6),
               '%d ms' % fr['t'], font=F(13), fill=CREAM_MUTE)

        cy = y + LABEL_H
        p = os.path.join(BOARDS, 's_A_%d.png' % fr['t'])
        cell = Image.open(p).convert('RGB').crop(CROP).resize((CW, CH), Image.LANCZOS)
        im.paste(cell, (x, cy))
        d.rectangle([x, cy, x + CW - 1, cy + CH - 1],
                    outline=GOLD if hot else (58, 66, 58), width=2 if hot else 1)

        ry = cy + CH + 4
        d.rectangle([x, ry, x + CW - 1, ry + READ_H - 8], fill=PANEL)
        t1 = 'r %.1f · d/b %.2f' % (fr['r'], fr['sep'])
        t2 = '最远 %.1f/81 · 点 %s · 不透明 %.2f' % (fr['far'], fr['fs'], fr['op'])
        d.text((x + 5, ry + 3), t1, font=fit(d, t1, CW - 10, 12), fill=CREAM_DIM)
        d.text((x + 5, ry + 20), t2, font=fit(d, t2, CW - 10, 11), fill=CREAM_MUTE)

        nlines = []
        for chunk in note.split('\n'):
            nlines += wrap_cn(d, chunk, CW - 6, 11)
        for k, ln in enumerate(nlines):
            d.text((x, ry + READ_H + 4 + k * 15), ln, font=F(11), fill=CREAM_MUTE)

    fy = H - FOOT + 4
    d.line([(PAD, fy - 6), (W - PAD, fy - 6)], fill=(72, 82, 70), width=1)
    d.text((PAD, fy + 6),
           '判据 · 0–70ms 驱动期内骰子完全静止；对撞点「两心距 ÷ 边长 = 1.000」零穿插；'
           '全程最远点 ≤ 81；终帧相机 scale = 1.000、骰子 opacity = 0',
           font=F(12), fill=CREAM_DIM)

    im.save(OUT)
    print('saved', OUT, im.size)

if __name__ == '__main__':
    main()
