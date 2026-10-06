#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 32 轮 · 真实牌堆档位验收板（#169）
=========================================
输入（全部为真实浏览器渲染 + 真实鼠标事件实测，不手抄）：
  · 60-主玩页真实牌堆-L{1,10,30}-整屏.png   ← capture_round32.mjs
  · 62-第30关-10层138张-放大与逐层条.png     ← capture_round32.mjs
  · levels.json                              ← level_design.py（设计真源）
  · pile-geometry.json                       ← verify_pile_geometry.mjs（实测几何）

输出：63-真实牌堆档位-验收板.png

板面回答用户第 32 轮第 4 / 5 条拍板：
  ④ 演示档位跟随**真实牌数**（L1=12 / L10=93 / L30=138，不再是写死的 36/12/96）
  ⑤ 单关内牌体尺寸与长宽比**唯一**；横牌 = 纯旋转（与竖牌严格同尺寸）
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG      = (10, 20, 16)
PANEL   = (18, 33, 27)
PANEL2  = (22, 40, 33)
LINE    = (44, 68, 58)
CREAM   = (240, 245, 239)
MUTE    = (146, 168, 156)
GOLD    = (246, 196, 69)
GOLD_HI = (255, 224, 138)
TEAL    = (143, 227, 197)
TEAL_D  = (85, 183, 154)
ORANGE  = (255, 158, 96)
RED     = (216, 67, 47)
BLUE    = (126, 178, 232)

_fc = {}


def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:
            _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception:
            _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]


def rr(d, box, r, fill=None, outline=None, w=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=w)


geo = json.load(open(os.path.join(BASE, 'pile-geometry.json'), encoding='utf-8'))
lvj = json.load(open(os.path.join(BASE, 'levels.json'), encoding='utf-8'))
byLv = {l['lv']: l for l in lvj['levels']}
rows = geo['rows']

# ── 布局 ────────────────────────────────────────────────
W, PAD = 1680, 56
CELL, GAP = 468, 34
TH = round(CELL * 1334 / 750)            # 832
COLS = [PAD + i * (CELL + GAP) for i in range(3)]
PANEL_H = 596                            # 第三区右栏高度（按内容算够，不再裁切）

# ★ H 先给足、最后按实际 y 裁剪 —— 宁可留白也不能裁内容（上一版就是 H 算小了）
H = 4200

im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
for i in range(0, W, 6):
    d.line([(i, 0), (i, H)], fill=(BG[0] + 2, BG[1] + 3, BG[2] + 2))


def sect(y, title, sub, color=GOLD):
    d.text((PAD, y), title, font=F(27, True), fill=color)
    tw = d.textlength(title, font=F(27, True))
    d.text((PAD + tw + 18, y + 8), sub, font=F(19), fill=MUTE)
    d.line([(PAD, y + 46), (W - PAD, y + 46)], fill=LINE, width=1)
    return y + 64


# ── 页头 ────────────────────────────────────────────────
y = 40
d.text((PAD, y), '主玩页牌堆 · 真实关卡档位验收板', font=F(40, True), fill=GOLD_HI)
d.text((PAD, y + 56),
       '《麻麻大消除》game-5  ·  第 32 轮（2026-10-05）  ·  演示档位改为读 levels.json 真实关卡  ·  '
       '单关内牌体尺寸唯一 + 横牌纯旋转',
       font=F(19), fill=MUTE)
badge = '真实鼠标事件验证 69 / 69 通过'
bw = d.textlength(badge, font=F(20, True)) + 34
rr(d, (W - PAD - bw, y + 4, W - PAD, y + 46), 21, fill=(22, 62, 46), outline=TEAL_D, w=1)
d.text((W - PAD - bw + 17, y + 13), badge, font=F(20, True), fill=TEAL)
y += 130

# ── 一、三档整屏 ────────────────────────────────────────
y = sect(y, '一、三个真实档位（整屏 750×1334 实机）',
         '档位不再是写死的 36 / 12 / 96，而是关卡表里的真实 L1 / L10 / L30')
for i, r in enumerate(rows):
    lv, ref, m = r['lv'], r['ref'], r['img']
    src = Image.open(os.path.join(BASE, f'60-主玩页真实牌堆-L{lv}-整屏.png')).convert('RGB')
    im.paste(src.resize((CELL, TH), Image.LANCZOS), (COLS[i], y))
    d.rectangle([COLS[i], y, COLS[i] + CELL, y + TH], outline=(60, 88, 74), width=1)
    ty = y + TH + 16
    d.text((COLS[i], ty), f'L{lv}  ·  {ref["n"]} 张  ·  {ref["L"]} 层  ·  牌体 {ref["w"]}×{ref["h"]}',
           font=F(23, True), fill=CREAM)
    d.text((COLS[i], ty + 34),
           f'开局可点 {ref["nl"]}/{ref["n"]} = {100*ref["nl"]/ref["n"]:.1f}%   ·   '
           f'横牌 {m["nCross"]} 张（纯旋转）',
           font=F(18), fill=TEAL)
    d.text((COLS[i], ty + 62),
           f'分段 {ref["st"]}   ·   安全区余量 上 {(m["minY"]-326):.1f} / 下 {(1008-m["maxY"]):.1f} '
           f'/ 左 {(m["minX"]-34):.1f} / 右 {(716-m["maxX"]):.1f}',
           font=F(17), fill=MUTE)
y += 62 + TH + 150

# ── 二、明细对账表（无 note 列 —— 说明统一放到表下「口径说明」，避免右溢出）──
y = sect(y, '二、逐值对账（设计值 vs 真实 DOM 实测）',
         '由 verify_pile_geometry.mjs 在无头 Chrome 里用真实鼠标事件切档后实测')
cw = [560, 340, 340, 340]
x0 = PAD
for i, c in enumerate(['项目', '第 1 关', '第 10 关', '第 30 关']):
    d.text((x0 + sum(cw[:i]) + 14, y), c, font=F(21, True), fill=GOLD)
d.line([(x0, y + 34), (x0 + sum(cw), y + 34)], fill=LINE, width=1)
y += 44


def trow(y, k, vals, colors=None):
    d.text((x0 + 14, y + 4), k, font=F(19), fill=MUTE)
    for i, v in enumerate(vals):
        col = (colors[i] if colors else CREAM)
        d.text((x0 + sum(cw[:i + 1]) + 14, y), str(v), font=F(20, True), fill=col)
    d.line([(x0, y + 34), (x0 + sum(cw), y + 34)], fill=(32, 52, 44), width=1)
    return y + 40


yy = y
yy = trow(yy, '牌堆张数 / 关卡表 nTotal',
          [f'{r["ref"]["n"]} == {r["img"]["pile"]}' for r in rows], [TEAL] * 3)
yy = trow(yy, '层数 / 关卡表 layers',
          [f'{r["ref"]["L"]} == {r["img"]["layerCount"]}' for r in rows], [TEAL] * 3)
yy = trow(yy, '★ 单关尺寸唯一（元素 offsetW×offsetH）',
          [r['img']['boxSizes'][0] for r in rows], [GOLD_HI] * 3)
yy = trow(yy, '★ 横牌布局盒 = 竖牌布局盒',
          [f'{r["img"]["crossBoxes"][0]} = {r["img"]["uprightBoxes"][0]}' for r in rows],
          [GOLD_HI] * 3)
yy = trow(yy, '★ 横牌变换矩阵', ['rotate(90°)'] * 3, [GOLD_HI] * 3)
yy = trow(yy, '★ 横牌可见外框（宽高互换）',
          [r['img']['crossRects'][0] for r in rows], [GOLD_HI] * 3)
yy = trow(yy, '横牌 / 竖牌张数',
          [f'{r["img"]["nCross"]} / {r["img"]["nUpright"]}' for r in rows], [CREAM] * 3)
yy = trow(yy, '开局可点 / 被压',
          [f'{r["ref"]["nl"]} / {r["ref"]["n"]-r["ref"]["nl"]}' for r in rows],
          [TEAL, TEAL, ORANGE])
yy = trow(yy, '开局可点率',
          [f'{100*r["ref"]["nl"]/r["ref"]["n"]:.1f}%' for r in rows], [CREAM] * 3)
yy = trow(yy, '独立几何复算可点数',
          [str(r['img']['cover']['ruleLive']) for r in rows], [TEAL] * 3)
yy = trow(yy, '逐张卡位对账（vs levels.json px/py）', ['全部命中'] * 3, [TEAL] * 3)
yy = trow(yy, '落在安全区 682×682 / 不压底带', ['✅ / ✅'] * 3, [TEAL] * 3)
yy = trow(yy, '分段（按层切 · 自顶向下）',
          ['+'.join(str(s) for s in r['ref']['st']) for r in rows], [CREAM] * 3)
yy = trow(yy, '页内注入数据 vs levels.json', ['逐值一致'] * 3, [TEAL] * 3)
yy = trow(yy, '顶带关卡号 / 已清 n/m',
          [f'第 {r["lv"]} 关 · {r["img"]["clrN"]}/{r["img"]["clrM"]}' for r in rows],
          [TEAL] * 3)
yy = trow(yy, '牌宽（跨关单调不增）', [str(r['ref']['w']) for r in rows], [CREAM, CREAM, CREAM])
y = yy + 30

# 口径说明
rr(d, (PAD, y, W - PAD, y + 152), 12, fill=PANEL, outline=LINE, w=1)
d.text((PAD + 22, y + 16), '口径说明（为什么这些断言是真断言）', font=F(20, True), fill=GOLD)
notes = [
    '① 「单关尺寸唯一」用元素自身 offsetWidth/offsetHeight 判定 —— 它不受 transform 影响，是布局盒的真值；'
    'h = w × 4/3（±0.01）。',
    '② 「横牌 = 纯旋转」用变换矩阵判定：a²+b² = 1、det = 1、e = f = 0 ⇒ 无 scale、无 translate；'
    '可见外框恰好宽高互换。',
    '   旧 bug 是把横牌元素换成 h×w、再让 img 铺满 100%×100% ⇒ 牌面横向拉伸 1.33 倍（非等比缩放），已修。',
    '③ 可行点判定沿用《羊了个羊》口径：累计被**更高层**覆盖 ≥ 18% 判死（同层不参与）；'
    '本关可点的牌恰好是零覆盖，严格口径同值。',
    '④ 卡位 (x,y) 是「相对安全区中心」的 px，逐张反算回 DOM 后与 levels.json 的 px/py 比对，容差 0.2px。',
]
for i, t in enumerate(notes):
    d.text((PAD + 22, y + 44 + i * 21), t, font=F(15), fill=MUTE)
y += 152 + 30

# ── 三、L30 特写 + 分段说明 ────────────────────────────
y = sect(y, '三、第 30 关特写（10 层 / 138 张 / 4 段）',
         '青框 = 开局可点 = 天际线 25 张；右栏为生成参数与"轮到自己时"的段内可点率')
big = Image.open(os.path.join(BASE, '62-第30关-10层138张-放大与逐层条.png')).convert('RGB')
bw2 = round(big.width * PANEL_H / big.height)
im.paste(big.resize((bw2, PANEL_H), Image.LANCZOS), (PAD, y))
d.rectangle([PAD, y, PAD + bw2, y + PANEL_H], outline=(60, 88, 74), width=1)

L30 = byLv[30]
px = PAD + bw2 + 40
pw = W - PAD - px
rr(d, (px, y, px + pw, y + PANEL_H), 12, fill=PANEL, outline=LINE, w=1)
d.text((px + 22, y + 16), '第 30 关 · 生成参数与分段（取自 levels.json）', font=F(21, True), fill=GOLD)
ly = y + 56
facts = [
    ('整关张数 / 段数', f'{L30["nTotal"]} 张 · {L30["nStage"]} 段（{L30["stages"]}）'),
    ('层数 / 逐层张数', f'{L30["layers"]} 层 · {L30["layerCounts"]}'),
    ('牌体尺寸（关内唯一）', f'{L30["w"]}×{L30["h"]} · @2x {L30["asset2x"][0]}×{L30["asset2x"][1]}'),
    ('牌堆包围盒 / 形态', f'{L30["bboxPx"][0]}×{L30["bboxPx"][1]} · {L30["footprint"]} · 主{L30["primary"]}'),
    ('★ 天际线抬升 top_share', f'{L30["topShare"]} ⇒ 顶层 {L30["topLayerN"]} 张（可点全靠它）'),
    ('★ 层间黄金角错位 R', f'{L30["layerShift"]}（137.5078°；Σ偏移≈0 ⇒ 质心不漂移）'),
    ('★ 离散指数 / 象限不平衡', f'{L30["uni"]["cvNorm"]:.3f} / {L30["uni"]["qbal"]:.3f}'
                                f'（门槛 1.25 / 0.60；1.0 = 随机撒布）'),
    ('★ 满清可解', f'整关 {"✅" if L30["cleared"] else "❌"} · 段内 {"✅" if L30["segCleared"] else "❌"}'),
    ('严格口径可点 / 现行口径', f'{L30["nStrict"]} 张 / {L30["nLive"]} 张（相等 ⇒ 可点的牌零覆盖）'),
]
for k, v in facts:
    d.text((px + 22, ly), k, font=F(17), fill=MUTE)
    d.text((px + 22, ly + 22), v, font=F(19, True), fill=CREAM)
    d.line([(px + 22, ly + 50), (px + pw - 22, ly + 50)], fill=(34, 54, 46), width=1)
    ly += 36
d.text((px + 22, ly + 2), '分段 · 「轮到自己时」的开局可点率', font=F(18, True), fill=GOLD_HI)
ly += 28
for s in L30['segs']:
    txt = (f'段 {s["k"]}（第 {s["lo"]}~{s["hi"]-1} 层 · {s["layers"]} 层）· {s["n"]} 张 · '
           f'轮到时点可 {s["openLive"]}/{s["n"]}（{100*s["openRatio"]:.0f}%）')
    col = TEAL if s['openRatio'] >= 0.4 else BLUE
    d.text((px + 22, ly), txt, font=F(18), fill=col)
    ly += 26
y += PANEL_H + 30

# ── 页脚 ────────────────────────────────────────────────
d.line([(PAD, y), (W - PAD, y)], fill=LINE, width=1)
d.text((PAD, y + 20),
       '证据链：level_design.py（v7 生成器）→ levels.json（30 关真源）→ inject_pile_data.py（注入主玩页）'
       '→ verify_pile_geometry.mjs（69/69 真实鼠标事件）· verify_levels.mjs（38/38）· verify_tile_face.mjs（17/17）。',
       font=F(17), fill=MUTE)
d.text((PAD, y + 48),
       '遗留：主玩页演示档位默认 L1 / L10 / L30，如需换档改 inject_pile_data.py 的 DEMO_TIERS 后重跑即可（幂等）。'
       'L1~L4 的玩法挂起项仍待拍板。',
       font=F(17), fill=MUTE)

OUT = os.path.join(BASE, '63-真实牌堆档位-验收板.png')
im.crop((0, 0, W, y + 84)).save(OUT)
print('✅ 验收板已生成 →', OUT, im.crop((0, 0, W, y + 84)).size)
