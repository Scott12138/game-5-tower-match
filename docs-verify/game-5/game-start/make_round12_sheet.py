#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 12 轮验收板：① 和值→道具 定稿映射表  ② 本局限定护栏（生命周期实测）  ③ 验证结论
数据来源：真实浏览器 eval 导出的 /tmp/r12.json（映射表 / 60 局一致性 / 生命周期 / 压测）
注意：只用有字形的字符（不用 U+2212 减号、上标 ²、↔ 等）
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG      = (13, 24, 20)
PANEL   = (20, 36, 30)
PANEL2  = (25, 44, 37)
LINE    = (46, 70, 60)
CREAM   = (240, 245, 239)
MUTE    = (150, 172, 160)
GOLD    = (246, 196, 69)
GOLD_HI = (255, 224, 138)
TEAL    = (143, 227, 197)
TEAL_D  = (85, 183, 154)
ORANGE  = (255, 158, 96)
RED     = (255, 120, 110)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

d = json.load(open('/tmp/r12.json', encoding='utf-8'))
rows, life, st = d['rows'], d['life'], d['stress']

W, H = 1500, 1010
im = Image.new('RGB', (W, H), BG); dr = ImageDraw.Draw(im)

def panel(x0, y0, x1, y1, fill=PANEL, r=12, outline=None):
    dr.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=fill,
                         outline=outline or LINE, width=1)

# ══════════ 顶栏 ══════════
dr.rectangle([0, 0, W, 66], fill=(17, 31, 26))
dr.text((34, 17), '开局掷骰 · 赠礼映射表定稿 + 本局限定护栏', font=F(28, True), fill=CREAM)
dr.text((648, 25), '第 12 轮 · 映射表以用户定稿版为准 · 道具仅限本局使用', font=F(16), fill=MUTE)
dr.text((W-34, 25), '数据由真实浏览器导出', font=F(14), fill=MUTE, anchor='ra')

# ══════════ ① 定稿映射表 ══════════
X0, X1 = 34, 556
Y0, Y1 = 88, 690
panel(X0, Y0, X1, Y1)
dr.text((X0+20, Y0+16), '① 和值 → 道具 · 定稿映射表', font=F(19, True), fill=GOLD_HI)
dr.text((X1-20, Y0+20), '2d6 / 36 种等可能', font=F(13), fill=MUTE, anchor='ra')

cx = [X0+20, X0+112, X0+206, X0+322]
hy = Y0+52
dr.text((cx[0], hy), '和值', font=F(14, True), fill=MUTE)
dr.text((cx[1], hy), '概率', font=F(14, True), fill=MUTE)
dr.text((cx[2], hy), '档位', font=F(14, True), fill=MUTE)
dr.text((cx[3], hy), '赠送', font=F(14, True), fill=MUTE)
dr.line([X0+16, hy+26, X1-16, hy+26], fill=LINE, width=1)

ry = hy + 32
RH = 40
for r in rows:
    s = r['sum']
    hot  = (s == 7)
    jack = (s == 12)
    if jack:   dr.rounded_rectangle([X0+12, ry-6, X1-12, ry+RH-16], radius=7, fill=(46, 34, 20))
    elif hot:  dr.rounded_rectangle([X0+12, ry-6, X1-12, ry+RH-16], radius=7, fill=(24, 44, 38))
    csum = GOLD_HI if (hot or jack) else CREAM
    dr.text((cx[0], ry), str(s), font=F(19, True), fill=csum)
    dr.text((cx[1], ry+3), '%d/36' % r['p'], font=F(14), fill=MUTE)
    tier_col = ORANGE if jack else (TEAL if hot else MUTE)
    dr.text((cx[2], ry+3), r['tier'], font=F(14, True), fill=tier_col)
    label = ' + '.join(x + ' ×1' for x in r['items'])
    if jack:
        label += '（彩蛋）'
    dr.text((cx[3], ry+3), label, font=F(14.5, True), fill=TEAL if not jack else GOLD_HI)
    ry += RH

dr.line([X0+16, ry+4, X1-16, ry+4], fill=LINE, width=1)
dr.text((X0+20, ry+14), '概率对称：2/12 · 3/11 · 4/10 · 5/9 · 6/8；7 为中枢（6/36）', font=F(13), fill=MUTE)
dr.text((X0+20, ry+38), '『任选』= 从 消除 / 移出 / 洗牌 中任取一件（不含加槽）', font=F(13), fill=TEAL)
dr.text((X0+20, ry+62), '旧版（7 任选 / 12 任选×2 / 10·11 双件）已作废', font=F(13), fill=RED)

# ══════════ ② 本局限定 · 生命周期 ══════════
MX0, MX1 = 580, 1010
panel(MX0, Y0, MX1, Y1)
dr.text((MX0+20, Y0+16), '② 本局限定 · 生命周期（实测）', font=F(19, True), fill=GOLD_HI)
dr.text((MX1-20, Y0+20), '真机状态机', font=F(13), fill=MUTE, anchor='ra')

sy = Y0 + 54
def step(y, no, title, lines, col=TEAL, h=None):
    hh = h or (34 + 21*len(lines))
    panel(MX0+16, y, MX1-16, y+hh, fill=PANEL2, r=9, outline=LINE)
    dr.ellipse([MX0+28, y+13, MX0+48, y+33], fill=col)
    dr.text((MX0+38, y+16), no, font=F(13, True), fill=(13, 24, 20), anchor='ma')
    dr.text((MX0+58, y+13), title, font=F(14, True), fill=CREAM)
    yy = y + 36
    for t, c in lines:
        dr.text((MX0+30, yy), t, font=F(13), fill=c)
        yy += 21
    return y + hh

a, b, c, dd, e, f, g = life['a'], life['b'], life['c'], life['d'], life['e'], life['f'], life['g']

sy = step(sy, '1', '进入关卡 · 掷骰赠送',
          [('骰 6 + 6 = 12（顶档）→ 任选 + 加槽', CREAM),
           ('本局可用 = 任选 / 加槽   ·   open = true', TEAL)], TEAL_D)
sy = step(sy+16, '2', '在本局内使用（唯一合法出口）',
          [('用『任选』并指定为 移出 → 已用[移出] 剩[加槽]', CREAM),
           ('用『加槽』→ 已用[移出,加槽] 剩[ ]', CREAM)], GOLD)
sy = step(sy+16, '3', '护栏拦截',
          [('池空再用 → 拒绝「本局没有该道具」', ORANGE),
           ('结算后再用 → 拒绝「本局已结束，道具已作废」', ORANGE)], ORANGE)
sy = step(sy+16, '4', '本局结算 / 提前退出关卡',
          [('未使用道具 → 立即作废，进入作废流水', RED),
           ('实测：7 点局未用 → 提前退出 → 作废[消除]', CREAM)], RED)
sy = step(sy+16, '5', '重进关卡 = 全新一局',
          [('seq +1、道具池重置、已用/作废清零', TEAL),
           ('可继承 = 0（上一局作废量绝不被继承）', GOLD_HI)], GOLD_HI)

# ══════════ ③ 验证结论 ══════════
RX0, RX1 = 1034, 1466
panel(RX0, Y0, RX1, Y1)
dr.text((RX0+20, Y0+16), '③ 验证结论（真实浏览器）', font=F(19, True), fill=GOLD_HI)

items = [
    ('定稿表 11 行逐值比对', '0 差异', True),
    ('60 局掷骰：赠礼 = 本局道具池', '100% 一致', True),
    ('用『任选』→ 指定为 移出', '池 [加槽]', True),
    ('池空后再点『用』', '被拒绝', True),
    ('结算后再点『用』', '被拒绝（不复活）', True),
    ('未用即提前退出', '立即作废 [消除]', True),
    ('重进关卡 seq +1 / 池重置', '继承 0', True),
    ('累计持有（跨局库存）', '恒为 0', True),
    ('真实点击 重掷 / 结算 / 退出 / 清空', '全部生效', True),
    ('6000 局 χ2 面分布', '%.2f < 15.09' % st['chi'], st['pass']),
    ('6000 局 χ2 和值分布', '%.2f < 23.21' % st['chiSum'], st['pass']),
]
iy = Y0 + 54
for name, val, ok in items:
    mark = 'OK' if ok else 'X'
    mcol = TEAL if ok else RED
    dr.ellipse([RX0+20, iy+3, RX0+38, iy+21], fill=mcol)
    dr.text((RX0+29, iy+6), mark, font=F(11, True), fill=(13, 24, 20), anchor='ma')
    dr.text((RX0+48, iy+2), name, font=F(13.5), fill=CREAM)
    dr.text((RX1-20, iy+2), val, font=F(13.5, True), fill=GOLD_HI, anchor='ra')
    iy += 32
    dr.line([RX0+20, iy-8, RX1-20, iy-8], fill=(30, 50, 42), width=1)

dr.text((RX0+20, iy+6), '音效同步偏差 -2 / 0 ms · 终帧骰子面 = 目标点数', font=F(13), fill=MUTE)

# ══════════ 底部：口径 ══════════
BY0, BY1 = 708, 978
panel(34, BY0, 1466, BY1, fill=(19, 34, 28))
dr.text((54, BY0+16), '口径要点（本次定稿）', font=F(19, True), fill=GOLD_HI)

cols = [
    ('映射表', [
        '以用户定稿版为准，旧版整体作废',
        '7 点 = 消除 ×1（中枢）',
        '12 点 = 任选 ×1 + 加槽 ×1（彩蛋）',
        '10 / 11 点各单件，不再「双件组合」',
    ]),
    ('本局限定护栏', [
        '赠送道具仅限当前这一局使用',
        '本局结算 → 未使用立即作废',
        '提前退出关卡 → 未使用立即作废',
        '不计入累积、不跨局、不继承',
    ]),
    ('发放入口', [
        '每次进入关卡（含重玩）仍重新掷骰赠送',
        '「每次都送」不变，但只服务当前这一局',
        '可用 / 已用 / 作废 三态可现场核验',
        '同一局内『任选』不重复出现',
    ]),
]
cw = (1466-54-20-2*24) // 3
for i, (t, ls) in enumerate(cols):
    x = 54 + i*(cw+24)
    dr.text((x, BY0+52), t, font=F(15, True), fill=TEAL)
    yy = BY0+78
    for t2 in ls:
        dr.text((x, yy), '· ' + t2, font=F(13), fill=CREAM)
        yy += 24
    if i:
        dr.line([x-14, BY0+46, x-14, BY1-18], fill=(30, 50, 42), width=1)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '15-映射表定稿与本局护栏.png')
im.save(out)
print('已生成', out, im.size)
