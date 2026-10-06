# -*- coding: utf-8 -*-
"""皮肤三案对比图：A（可投产） / B（待重做） / C（定稿默认）"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
A = ROOT + '/assets'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

ITEMS = [
    dict(code='C', name='錾刻金框', sub='★ 定稿 · 默认皮肤',
         path=A + '/game-start/table_default.jpg', crop=None,
         kpi=['正交度 0.08 px/100px', '骰盘直径 228.4 设计值', '750×750 · 132 KB'],
         col=(246, 196, 69), note='与首页金色角饰同族'),
    dict(code='A', name='窄木边·极简', sub='○ 皮肤储备 · 可投产',
         path=A + '/_src/game-start/skins/skin_A_minimal/table_750.jpg', crop=None,
         kpi=['正交度 6.62 px/100px（校正后）', '骰盘直径 213 设计值', '750×750 · 70 KB'],
         col=(150, 214, 190), note='留白最干净，最省体积'),
    dict(code='B', name='胡桃木宽边', sub='△ 皮肤储备 · 待重做',
         path=A + '/_src/game-start/skins/skin_B_walnut/raw_ai_1024x1536.png',
         crop=(0, 256, 1024, 1280),
         kpi=['透视 3.0%（非严格俯视）', '桌面左右被画幅裁切', '骰盘椭圆度 1.29'],
         col=(240, 130, 120), note='需按正方形提示词重出'),
]

FF = ImageFont.truetype(FONT, 30, index=0)
FS = ImageFont.truetype(FONT, 22, index=0)
FK = ImageFont.truetype(FONT, 20, index=0)
FT = ImageFont.truetype(FONT, 40, index=0)


def fit(d, txt, w, size, path=FONT):
    f = ImageFont.truetype(path, size, index=0)
    while size > 12 and d.textbbox((0, 0), txt, font=f)[2] > w:
        size -= 1
        f = ImageFont.truetype(path, size, index=0)
    return f


PAD = 44
W = 344
GAP = 30
IMG_H = W
LAB_H = 46
KPI_H = 34 * 3 + 14
NOTE_H = 36
canv_w = PAD * 2 + W * 3 + GAP * 2
head_h = 104
canv_h = head_h + LAB_H + IMG_H + KPI_H + NOTE_H + PAD
canvas = Image.new('RGB', (canv_w, canv_h), (14, 30, 24))
d = ImageDraw.Draw(canvas)
d.text((PAD, 28), '麻将桌皮肤三案 · 定稿与储备', font=FT, fill=(255, 247, 230))
d.text((PAD, 76), 'game-5《麻麻大消除》· 开局页 / 主玩页共用底图（一图两用）',
       font=FS, fill=(150, 172, 155))

for i, it in enumerate(ITEMS):
    x = PAD + i * (W + GAP)
    y = head_h
    im = Image.open(it['path']).convert('RGB')
    if it['crop']:
        im = im.crop(it['crop'])
    im = im.resize((W, IMG_H), Image.LANCZOS)
    canvas.paste(im, (x, y + LAB_H))
    d.rectangle([x - 1, y + LAB_H - 1, x + W, y + LAB_H + IMG_H], outline=(62, 88, 72))
    # 标签（图上角）
    d.rectangle([x, y, x + W, y + LAB_H - 4], fill=(20, 44, 34))
    d.text((x + 8, y + 7), it['sub'], font=fit(d, it['sub'], W - 20, 24), fill=it['col'])
    d.text((x + 8, y + LAB_H - 4 + 4), '', font=FS, fill=(0, 0, 0))
    # 名称
    ny = y + LAB_H + IMG_H + 10
    d.text((x, ny), '%s · %s' % (it['code'], it['name']), font=FF, fill=(240, 246, 236))
    # KPI
    ky = ny + 40
    for k in it['kpi']:
        d.text((x, ky), '· ' + k, font=fit(d, '· ' + k, W, 20), fill=(186, 202, 188))
        ky += 32
    d.text((x, ky + 2), it['note'], font=fit(d, it['note'], W, 20), fill=it['col'])

out = ROOT + '/docs-verify/game-5/game-start/03-皮肤三案.png'
canvas.save(out)
print('saved', out, canvas.size)
