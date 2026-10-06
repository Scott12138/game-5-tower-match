#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 牌面样张后处理 + 用途符合性对比
   ① 自动 trim 白边 → 统一裁成 3:4 → 输出 384x512 工程版（= 游戏内 96x128 的 @4x）
   ② 拼对比图：全尺寸观感 + 实际尺寸(96x128)放大模拟（检验小尺寸可读性）
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = '/Users/consli/WorkBuddy/2026-10-04-19-15-36/assets/_src/game-play/tile-samples'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG, PANEL, PANEL2, LINE = (12, 22, 18), (19, 34, 28), (23, 41, 34), (44, 68, 58)
CREAM, MUTE, GOLD, GOLD_HI, TEAL = (240, 245, 239), (146, 168, 156), (246, 196, 69), (255, 224, 138), (143, 227, 197)
ORANGE = (255, 158, 96)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

def trim_to_34(path, out, target=(384, 512), sat_thr=14):
    """按「饱和度」而非「亮度」找牌的边界。
       纯亮度阈值会把 AI 生成的浅灰背景渐变一起算进来（条子那张就踩了这个坑：
       bbox 量到 896x1316 几乎铺满整图，裁完牌反而变小）。
       牌的描边是金色、字是绿/红 —— 饱和度都高；背景是纯白 —— 饱和度≈0。"""
    im = Image.open(path).convert('RGB')
    s = im.convert('HSV').getchannel('S')
    m = s.point(lambda p: 255 if p > sat_thr else 0)
    m = m.filter(ImageFilter.MinFilter(3))        # 开运算去孤立噪点，避免 bbox 被噪点撑开
    bb = m.getbbox()
    if not bb:
        raise RuntimeError('找不到牌主体：' + path)
    x0, y0, x1, y1 = bb
    w, h = x1 - x0, y1 - y0
    pad = max(w, h) * 0.035                       # 留一点边，保住牌自身的外投影
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    cw, ch = x1 - x0, y1 - y0
    if cw / ch < 0.75:                            # 太窄 → 补宽
        need = ch * 0.75
        x0 -= (need - cw) / 2; x1 += (need - cw) / 2
    else:                                         # 太扁 → 补高
        need = cw / 0.75
        y0 -= (need - ch) / 2; y1 += (need - ch) / 2
    im2 = im.crop((round(x0), round(y0), round(x1), round(y1))).resize(target, Image.LANCZOS)
    im2.save(os.path.join(SRC, out))
    return im2, (bb[2] - bb[0], bb[3] - bb[1]), (round(x1 - x0), round(y1 - y0))

SPECS = [
    ('tile-wan-01.png',  'tile-wan-384.png',  '五 萬',  '万子（wan）'),
    ('tile-tong-01.png', 'tile-tong-384.png', '五 筒',  '筒子（tong）'),
    ('tile-tiao-01.png', 'tile-tiao-384.png', '三 条',  '条子（tiao）'),
]
print('── 裁切 ──')
made = []
for src, out, label, suit in SPECS:
    im2, bb, cropped = trim_to_34(os.path.join(SRC, src), out)
    made.append((im2, label, suit))
    print(f'  {src:18s} → {out:18s} 牌主体 {bb[0]}x{bb[1]}  裁框 {cropped[0]}x{cropped[1]}  → 384x512')

# ── 对比图 ──
W, PAD = 1440, 56
TW, TH = 300, 400              # 全尺寸展示
SW, SH = 192, 256              # 96x128 的 2x 放大模拟
H = 1560
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
for i in range(0, W, 6):
    d.line([(i, 0), (i, H)], fill=(BG[0] + 2, BG[1] + 3, BG[2] + 2))

d.text((PAD, 40), 'AI 牌面样张 · 用途符合性对比', font=F(40, True), fill=GOLD_HI)
d.text((PAD, 96), '用途：微信小游戏《麻麻大消除》主玩页 牌堆区牌面  ·  游戏内实际绘制尺寸 96 x 128 设计值（750 x 1334 画布）',
       font=F(19), fill=MUTE)
bb_ = '3 张样张  ·  已裁切到 3:4  ·  384x512 (@4x)'
bw = d.textlength(bb_, font=F(19, True)) + 32
d.rounded_rectangle((W - PAD - bw, 44, W - PAD, 86), radius=21, fill=(22, 62, 46), outline=(85, 183, 154), width=1)
d.text((W - PAD - bw + 16, 53), bb_, font=F(19, True), fill=TEAL)

# 行 1：全尺寸
d.text((PAD, 148), '① 全尺寸观感（384 x 512 缩略）', font=F(25, True), fill=GOLD)
d.line([(PAD, 188), (W - PAD, 188)], fill=LINE, width=1)
cols = [PAD + 40, PAD + 40 + TW + 90, PAD + 40 + 2 * (TW + 90)]
for (img, label, suit), x in zip(made, cols):
    d.rounded_rectangle((x - 8, 210, x + TW + 8, 210 + TH + 8), radius=14, fill=(8, 16, 12))
    im.paste(img.resize((TW, TH), Image.LANCZOS), (x, 214))
    d.rectangle([x, 214, x + TW, 214 + TH], outline=(60, 88, 74), width=1)
    d.text((x, 214 + TH + 20), suit, font=F(22, True), fill=CREAM)
    d.text((x + 150, 214 + TH + 24), label, font=F(19), fill=MUTE)

# 行 2：实际尺寸模拟
y2 = 780
d.text((PAD, y2), '② 实际尺寸模拟（先缩到 96 x 128，再放大 2 倍便于肉眼判断可读性）', font=F(25, True), fill=GOLD)
d.line([(PAD, y2 + 40), (W - PAD, y2 + 40)], fill=LINE, width=1)
for (img, label, suit), x in zip(made, cols):
    tiny = img.resize((96, 128), Image.LANCZOS)
    d.rounded_rectangle((x - 8, y2 + 58, x + 2 * SW + 8, y2 + 66 + 2 * SH), radius=12, fill=PANEL, outline=LINE, width=1)
    im.paste(tiny.resize((2 * SW, 2 * SH), Image.NEAREST), (x + 6, y2 + 72))
    d.text((x, y2 + 80 + 2 * SH), f'{suit} · 96x128', font=F(20, True), fill=CREAM)
    d.text((x, y2 + 110 + 2 * SH), '符号轮廓仍清晰可辨', font=F(17), fill=TEAL)

im.save(os.path.join(BASE, '09-牌面AI样张对比.png'))
print('✅ 对比图 →', os.path.join(BASE, '09-牌面AI样张对比.png'), im.size)
