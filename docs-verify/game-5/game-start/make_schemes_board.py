#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「三方案横比」验收板：3 方案 × 8 相位，同相位并排 → 直接横比手感。
数据来自 proc/frames_default.json（浏览器逐帧实测导出，不手抄）。"""
import json, os
from PIL import Image, ImageDraw, ImageFont

BASE   = os.path.dirname(os.path.abspath(__file__))
PROC   = os.path.join(BASE, 'proc')
BOARDS = os.path.join(PROC, 'boards')
OUT    = os.path.join(BASE, '11-三方案对比.png')
FONT   = '/System/Library/Fonts/Hiragino Sans GB.ttc'

CROP = (100, 154, 475, 821)          # --sc=0.50 下手机屏（750x1334 缩一半）
CW, CH = 150, 267                    # 每格尺寸
GAP, LBL_W, PAD = 9, 106, 26
HEAD, PHASE_H, READ_H, FOOT = 104, 30, 24, 84

BG, PANEL = (11, 15, 12), (18, 23, 19)
GOLD, GOLD_HI = (246, 196, 69), (255, 224, 138)
CREAM, CREAM_DIM, CREAM_MUTE = (232, 238, 231), (176, 190, 178), (120, 134, 122)

SCHEMES = [
    ('A', '直撞', 'DIRECT',      '相向加速 → 盘心正面对撞 → 弹回贴边滑行', '撞 1 次'),
    ('B', '追尾', 'ORBIT-TAP',   '同向绕盘 → 追尾侧碰 → 咬合 → 惯性滑行', '撞 1 次'),
    ('C', '环壁对迎', 'RIM-CLASH', '甩到盘壁各撞一次 → 反向扫掠 → 迎头相撞', '撞 3 次'),
]
PHASES = ['静止', '驱动末', '撞前', '对撞点', '撞后', '滑行中', '拉远·淡出', '终帧']

_fc = {}
def F(sz):
    if sz not in _fc:
        _fc[sz] = ImageFont.truetype(FONT, sz)
    return _fc[sz]

def fit(d, txt, maxw, sz, minSz=7):
    while sz > minSz:
        f = F(sz)
        if d.textlength(txt, font=f) <= maxw:
            return f
        sz -= 1
    return F(minSz)

def main():
    data = json.load(open(os.path.join(PROC, 'frames_default.json'), encoding='utf-8'))
    W = PAD * 2 + LBL_W + 8 * CW + 7 * GAP
    ROW = CH + READ_H + 14
    H = HEAD + PHASE_H + 3 * ROW + 2 * GAP + FOOT
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)

    # ── 页头 ──
    d.text((PAD, 30), '开局页掷骰分镜 · 三方案横比', font=F(27), fill=CREAM)
    d.text((PAD, 66), '48 设计值 · 750x1334 · 每列同一相位、每行一套方案', font=F(14), fill=CREAM_MUTE)
    right = '全部通过几何校验：全程最远点 ≤ 81 · 全程零穿插'
    d.text((W - PAD - d.textlength(right, font=F(14)), 66), right, font=F(14), fill=GOLD_HI)
    d.line([(PAD, HEAD - 12), (W - PAD, HEAD - 12)], fill=(72, 82, 70), width=1)
    d.line([(PAD, HEAD - 12), (PAD + 92, HEAD - 12)], fill=GOLD, width=2)

    # ── 相位表头 ──
    for c, name in enumerate(PHASES):
        x = PAD + LBL_W + c * (CW + GAP)
        d.text((x, HEAD + 6), name, font=F(13), fill=GOLD_HI if c == 3 else CREAM_DIM)

    # ── 三行 ──
    for r, (key, cn, en, note, hits) in enumerate(SCHEMES):
        y0 = HEAD + PHASE_H + r * (ROW + GAP)
        # 行标签
        lx = PAD
        d.text((lx, y0 + 18), key, font=F(30), fill=GOLD)
        d.text((lx + 30, y0 + 24), cn, font=F(16), fill=CREAM)
        d.text((lx, y0 + 54), en, font=F(10), fill=CREAM_MUTE)
        d.text((lx, y0 + 70), hits, font=F(11), fill=GOLD_HI)
        # 说明（按行宽换行）
        words, line, ly = note, '', y0 + 90
        while words:
            i = 1
            while i <= len(words) and d.textlength(words[:i], font=F(10)) <= LBL_W - 6:
                i += 1
            d.text((lx, ly), words[:i - 1], font=F(10), fill=CREAM_MUTE)
            words = words[i - 1:]
            ly += 13
            if ly > y0 + 150:
                break

        rows = data[key]
        for c, fr in enumerate(rows):
            x = PAD + LBL_W + c * (CW + GAP)
            p = os.path.join(BOARDS, 's_%s_%d.png' % (key, fr['t']))
            cell = Image.open(p).convert('RGB').crop(CROP).resize((CW, CH), Image.LANCZOS)
            im.paste(cell, (x, y0))
            # 格边框（对撞点列高亮）
            hot = (c == 3)
            d.rectangle([x, y0, x + CW - 1, y0 + CH - 1],
                        outline=GOLD if hot else (58, 66, 58), width=2 if hot else 1)
            # 读数条
            ry = y0 + CH + 3
            d.rectangle([x, ry, x + CW - 1, ry + READ_H - 5], fill=PANEL)
            t1 = '%d ms' % fr['t']
            t2 = 'r %.1f · d/b %.2f · 远 %.1f' % (fr['r'], fr['sep'], fr['far'])
            d.text((x + 4, ry + 2), t1, font=F(10), fill=GOLD_HI if hot else CREAM_DIM)
            d.text((x + 4, ry + 13), t2, font=fit(d, t2, CW - 8, 9), fill=CREAM_MUTE)

    # ── 页脚判据 ──
    fy = H - FOOT + 8
    d.line([(PAD, fy - 8), (W - PAD, fy - 8)], fill=(72, 82, 70), width=1)
    lines = [
        '判据 ①  对撞点「两骰心距 ÷ 边长 = 1.000」→ 恰好贴合、零穿插（三方案三档全过）',
        '判据 ②  全程最远点 ≤ 盘内可用半径 81（1ms 步长扫全程，含挤压的各向异性拉伸）',
        '判据 ③  0–70ms 驱动期内骰子完全静止；终帧相机 scale = 1.000、骰子 opacity = 0（已退场）',
    ]
    for i, s in enumerate(lines):
        d.text((PAD, fy + 6 + i * 20), s, font=F(12), fill=CREAM_DIM)

    im.save(OUT)
    print('saved', OUT, im.size)

if __name__ == '__main__':
    main()
