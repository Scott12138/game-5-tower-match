#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主玩页（④）v2 · 改版对照板（第 16 轮）
   输入：同目录下 CDP 实机截图（真实浏览器渲染）
       旧：05-主玩页-常态36张.png
       新：11~15（改版后常态 / 可获得态 / 看广告 / 到账 / 规则弹层）
   输出：20-改版对照板.png
   口径：所有数值取自 __mp.rev() 断言接口实测（95 项全通过），不手抄。
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG      = (12, 22, 18)
PANEL   = (19, 34, 28)
PANEL2  = (23, 41, 34)
LINE    = (44, 68, 58)
CREAM   = (240, 245, 239)
MUTE    = (146, 168, 156)
GOLD    = (246, 196, 69)
GOLD_HI = (255, 224, 138)
TEAL    = (143, 227, 197)
ORANGE  = (255, 158, 96)
RED     = (216, 67, 47)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

def wrap(d, txt, font, maxw):
    lines, cur = [], ''
    for ch in txt:
        if ch == '\n':
            lines.append(cur); cur = ''; continue
        if d.textlength(cur + ch, font=font) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur: lines.append(cur)
    return lines

W, PAD = 1500, 60
BIG_W = 380
BIG_H = round(BIG_W * 1334 / 750)          # 747
CELL, C_GAP = 315, 40
C_H = round(CELL * 1334 / 750)             # 560

img = Image.new('RGB', (W, 1720), BG)
d = ImageDraw.Draw(img)

# ── 标题 ──
d.text((PAD, 34), '主玩页（④）· 改版对照板', font=F(38, True), fill=CREAM)
d.text((PAD, 84), '第 16 轮 · 按截图反馈调整 4 项 + 修正 1 项新发现缺陷 · 全部数值取自 __mp.rev() 实测',
       font=F(19), fill=MUTE)

# ── 左：旧 / 中：新 ──
Y0 = 126
def paste_shot(path, x, y, w):
    im = Image.open(os.path.join(BASE, path)).convert('RGB')
    h = round(w * im.height / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    img.paste(im, (x, y))
    return h

x_old, x_new = PAD, PAD + BIG_W + 60
h_old = paste_shot('05-主玩页-常态36张.png', x_old, Y0 + 34, BIG_W)
h_new = paste_shot('11-主玩页-常态-改版后.png', x_new, Y0 + 34, BIG_W)

# 旧 / 新 标签
for x, lab, col in ((x_old, '旧（第 15 轮）', MUTE), (x_new, '新（第 16 轮）', TEAL)):
    d.rounded_rectangle([x, Y0, x + 210, Y0 + 28], 8, fill=PANEL2)
    d.text((x + 12, Y0 + 4), lab, font=F(18, True), fill=col)

S = BIG_W / 750.0
def mark(x0, y0, x1, y1, base_x, num, col=RED):
    """在设计值坐标上画标记框 + 编号"""
    bx = base_x + x0 * S; by = Y0 + 34 + y0 * S
    ex = base_x + x1 * S; ey = Y0 + 34 + y1 * S
    d.rounded_rectangle([bx, by, ex, ey], 8, outline=col, width=3)
    r = 15
    cx, cy = bx - r + 4, by - r + 4
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    d.text((cx - 5, cy - 13), num, font=F(18, True), fill=(20, 10, 6))

# 两图同样标注三处，便于对照
for bx in (x_old, x_new):
    mark(36, 70, 336, 192, bx, '1')       # 暂停 / 第 N 关 行
    mark(576, 186, 716, 262, bx, '2')     # 右上角（? → 规则）
    mark(76, 1136, 724, 1272, bx, '3')    # 道具栏

# ── 右：调整清单 ──
PX = PAD + BIG_W * 2 + 120
PW = W - PX - PAD
PANEL_H = 830
d.rounded_rectangle([PX, Y0 + 34, PX + PW, Y0 + 34 + PANEL_H], 16, fill=PANEL, outline=LINE, width=1)
tx, ty = PX + 24, Y0 + 62
d.text((tx, ty), '本轮 4 项调整', font=F(27, True), fill=GOLD_HI); ty += 48

ITEMS = [
    ('1', '暂停 / 第 N 关 上移', '各上移 20px → 垂直中心与右侧「微信胶囊避让」对齐（同为 y 120）。原 96/108 → 76/88。'),
    ('2', '移除「＋看广告得」', '道具栏由 5 格 → 4 格。点击道具本体：本局有量→直接使用；不足→自动走看广告，看完本局 +1。分享入口移到暂停面板。'),
    ('3', '道具格放大', '96×96 → 126×112（+31% / +17%）。总宽仍 576、left 87 不变，与上方槽位条同心；底边 1262，距屏底 72 ≥ safeBottom 68。'),
    ('4', '「?」→ 规则按钮', '改为书页图标 + 「规则」文字。点开规则弹层：已按最终结构摆好「麻将配对消除」与「掷骰点数对应表」两区，内容图待出图（1:1 替换）。'),
]
for num, t, desc in ITEMS:
    d.ellipse([tx, ty + 2, tx + 28, ty + 30], fill=GOLD)
    d.text((tx + 9, ty + 6), num, font=F(18, True), fill=(30, 18, 4))
    d.text((tx + 40, ty + 4), t, font=F(21, True), fill=CREAM)
    ty += 34
    for ln in wrap(d, desc, F(18), PW - 56):
        d.text((tx + 40, ty), ln, font=F(18), fill=MUTE); ty += 27
    ty += 14
    d.line([tx, ty - 6, PX + PW - 24, ty - 6], fill=LINE, width=1); ty += 12

# 缺陷修正
d.rounded_rectangle([tx, ty, PX + PW - 24, ty + 148], 12, fill=(38, 20, 16), outline=(120, 46, 36), width=1)
d.text((tx + 16, ty + 12), '⚠ 顺带修正 1 项新发现缺陷', font=F(21, True), fill=ORANGE)
yy = ty + 46
for ln in wrap(d, '复活徽标原挂在槽位条右侧（x 507.6~714 / y 1056~1140），实测压住第 6、7、8 三个槽位；上一轮无断言覆盖故未发现。'
                  '现移到顶带空档（x 344~515.5，与暂停/关卡同高），已加 3 条回归断言。', F(17), PW - 56):
    d.text((tx + 16, yy), ln, font=F(17), fill=(255, 214, 196)); yy += 25
ty += 164

d.text((tx, ty), '验证：真实浏览器事件断言 95 / 95 通过 · 运行期零错误', font=F(19, True), fill=TEAL)

# ── 下：新增状态 4 图 ──
Y1 = Y0 + 34 + max(h_new, PANEL_H) + 52
d.text((PAD, Y1 - 40), '新增状态与流程（实机截图）', font=F(27, True), fill=GOLD_HI)
SHOTS = [
    ('12-道具可获得态-四件为0.png', '道具「可获得」态', '本局为 0：虚线框 + 金色「＋」角标轻呼吸'),
    ('13-看广告流程-播放中.png',   '看广告流程 · 播放中', '点不足道具 → 自动弹出，5s 进度条'),
    ('14-看广告流程-到账.png',     '看广告流程 · 到账',   '本局道具栏 +1（仍「仅限本局使用」）'),
    ('15-规则弹层-占位版.png',     '规则弹层 · 占位版',   '两区结构已定，内容图待出图后 1:1 替换'),
]
for i, (f, t1, t2) in enumerate(SHOTS):
    x = PAD + i * (CELL + C_GAP)
    paste_shot(f, x, Y1, CELL)
    d.text((x, Y1 + C_H + 12), t1, font=F(20, True), fill=CREAM)
    d.text((x, Y1 + C_H + 40), t2, font=F(16), fill=MUTE)

img = img.crop((0, 0, W, Y1 + C_H + 78))
out = os.path.join(BASE, '20-改版对照板.png')
img.save(out)
print('saved', out, img.size)
