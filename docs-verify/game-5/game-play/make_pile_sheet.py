#!/usr/bin/env python3
"""
A3 牌堆尺寸重校 · 验收板（第 28 轮）

把 verify_pile_geometry.mjs 拍下的「矢量 / 真母版」同角度截图拼成一张对照板：
  · 3 行 = 12 / 36 / 96 档；2 列 = 矢量占位 / 真母版
  · 真母版列在左上第一张牌上叠两个框：**占位 96×128（黄）** 与 **可见牌体 72×103（青）**
    —— 直接把"A2 归一化给母版留了 25% 透明边距"这件事画出来
  · 每行下方一行 ASCII 数据（占位 / 可见牌体 / 可点被压 / 安全区余量 / 层间重合）

标注一律 ASCII：PIL 默认位图字体不含中文，写中文会变成豆腐块（本项目既有纪律）。
用法：python3 make_pile_sheet.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, 'pile-geometry.json'), encoding='utf-8'))

DESIGN_W, DESIGN_H = 750, 1334
PAD = 18
TITLE_H = 74
ROW_LABEL_W = 220
ROW_GAP = 34
ROW_FOOT = 96
FOOT_H = 0

def font(sz, bold=False):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()

F_TITLE = font(30, True)
F_H = font(21, True)
F_L = font(17)
F_S = font(15)
F_XS = font(13)

rows = DATA['rows']

# 先量一下截图尺寸
samples = []
for r in rows:
    for k in ('img', 'svg'):
        p = os.path.join(HERE, r['shots'][k])
        im = Image.open(p)
        samples.append(im.size)
IMG_W, IMG_H = samples[0]
SCALE_D2I = IMG_W / DESIGN_W          # 设计值 → 图像 px

COL_W = IMG_W
SHEET_W = PAD + ROW_LABEL_W + COL_W * 2 + PAD * 3
SHEET_H = TITLE_H + sum(IMG_H + ROW_FOOT + ROW_GAP for _ in rows) + PAD

sheet = Image.new('RGB', (SHEET_W, SHEET_H), (26, 30, 34))
d = ImageDraw.Draw(sheet)

d.text((PAD, 18), 'A3  PILE GEOMETRY RE-CHECK  ·  VECTOR vs REAL-MASTER  (same layout box, same grid)',
       font=F_TITLE, fill=(255, 226, 150))
d.text((PAD, 50), 'tiles 192x256 @2x  ·  visible body = 75.0% x 80.5% of layout box  ·  safe zone 682x682  ·  real mouse events, frame scroll reset',
       font=F_XS, fill=(150, 160, 170))

y = TITLE_H
for r in rows:
    tgt = r['target']
    exp = r['exp']
    m = r['img']
    layers = len(m['layers'])

    # 行标签
    d.text((PAD, y + 8), f'{tgt}  TILES', font=font(28, True), fill=(255, 226, 150))
    d.text((PAD, y + 48), f'layout box  {exp["W"]}x{exp["H"]}', font=F_L, fill=(210, 218, 226))
    d.text((PAD, y + 70), f'layers      {layers}', font=F_L, fill=(210, 218, 226))
    d.text((PAD, y + 92), f'body        {m["bw"]}x{m["bh"]}', font=F_L, fill=(120, 220, 240))
    d.text((PAD, y + 114), f'live / dead {m["live"]} / {m["dead"]}', font=F_L, fill=(210, 218, 226))

    x0 = PAD * 2 + ROW_LABEL_W
    for ci, key in enumerate(('svg', 'img')):
        im = Image.open(os.path.join(HERE, r['shots'][key])).convert('RGB')
        cx = x0 + ci * (COL_W + PAD)
        sheet.paste(im, (cx, y))

        # 表头
        d.text((cx + 8, y + IMG_H + 6), 'VECTOR PLACEHOLDER' if key == 'svg' else 'REAL MASTER (27 pcs)',
               font=F_H, fill=(190, 200, 210) if key == 'svg' else (255, 226, 150))

        if key == 'img':
            # ★ 在第一张牌上叠「占位 / 可见牌体」双框
            # 第一张牌＝(c0,r0,L0)，恰好落在占位包围盒左上角（x0,y0）
            bx = m['minX'] * SCALE_D2I
            by = m['minY'] * SCALE_D2I
            bw = exp['W'] * SCALE_D2I
            bh = exp['H'] * SCALE_D2I
            d.rectangle([cx + bx, y + by, cx + bx + bw, y + by + bh], outline=(255, 210, 60), width=3)
            vbw, vbh = m['bw'] * SCALE_D2I, m['bh'] * SCALE_D2I
            vx = bx + (bw - vbw) / 2
            vy = by + (bh - vbh) / 2
            d.rectangle([cx + vx, y + vy, cx + vx + vbw, y + vy + vbh], outline=(90, 230, 250), width=3)
            # 图例放到图下标题行右侧（画在图内会压住牌面）
            gx = cx + COL_W - 310
            gy = y + IMG_H + 8
            d.rectangle([gx, gy + 3, gx + 26, gy + 17], outline=(255, 210, 60), width=3)
            d.text((gx + 34, gy), f'layout box  {exp["W"]}x{exp["H"]}', font=F_S, fill=(255, 210, 60))
            d.rectangle([gx, gy + 27, gx + 26, gy + 41], outline=(90, 230, 250), width=3)
            d.text((gx + 34, gy + 24), f'visible body  {m["bw"]}x{m["bh"]}', font=F_S, fill=(90, 230, 250))

        # 图下数据
        ty = y + IMG_H + 34
        lines = [
            f'box x {m["minX"]}~{m["maxX"]}   y {m["minY"]}~{m["maxY"]}',
            f'safe margin  top {m["minY"]-326:.1f} / bot {1008-m["maxY"]:.1f} / left {m["minX"]-34:.1f} / right {716-m["maxX"]:.1f}',
        ]
        if m['visualOverlap'] is None:
            lines.append('layer overlap  n/a (single layer)')
        else:
            lines.append(f'layer overlap  logical {m["logicalOverlap"]*100:.1f}%  /  visible {m["visualOverlap"]*100:.1f}%')
        if key == 'img' and m['cover']['splitDead']:
            sd = m['cover']['splitDead'][0]
            lines.append(f'split-dead {len(m["cover"]["splitDead"])} pc: #{sd["i"]} sum {sd["sumPct"]}% (max single {sd["maxPct"]}%)')
        for i, ln in enumerate(lines):
            d.text((cx + 8, ty + i * 21), ln, font=F_S, fill=(180, 190, 200))

    y += IMG_H + ROW_FOOT + ROW_GAP

out = os.path.join(HERE, '53-牌堆尺寸重校-矢量vs真母版-验收板.png')
sheet.save(out)
print(f'OK  {out}  {sheet.size[0]}x{sheet.size[1]}  {os.path.getsize(out)/1024:.0f} KB')
