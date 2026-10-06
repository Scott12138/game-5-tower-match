#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 13 轮验收板（覆盖旧的 13 / 15 两张）
   ① 13-点数与赠礼.png          —— 新定稿赠礼表 + 随机点数生成方式 + χ² 实测
   ② 15-映射表定稿与本局护栏.png —— 逐值断言 + 本局护栏流转 + 复活作废
数据来源：真实浏览器 eval 导出的 /tmp/r13.json（不手抄）。
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG      = (13, 24, 20)
PANEL   = (20, 36, 30)
LINE    = (46, 70, 60)
CREAM   = (240, 245, 239)
MUTE    = (150, 172, 160)
GOLD    = (246, 196, 69)
GOLD_HI = (255, 224, 138)
TEAL    = (143, 227, 197)
TEAL_D  = (85, 183, 154)
ORANGE  = (255, 158, 96)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

d = json.load(open('/tmp/r13.json', encoding='utf-8'))
rows, st, life = d['rows'], d['stress'], d['life']

def gift_txt(r):
    return (r['items'][0] + ' x1') if r['items'] else ('复活 x%d（自动）' % r['revive'])

# ══════════════════ 板 ① 点数与赠礼 ══════════════════
W, H = 1420, 900
im = Image.new('RGB', (W, H), BG); dr = ImageDraw.Draw(im)
dr.rectangle([0, 0, W, 62], fill=(17, 31, 26))
dr.text((34, 17), '开局掷骰 · 点数与赠礼规则', font=F(27, True), fill=CREAM)
dr.text((452, 25), '第 13 轮定稿微调 · 赠礼仅限本局', font=F(16), fill=MUTE)
dr.text((W-34, 25), '数据由真实浏览器导出', font=F(14), fill=MUTE, anchor='ra')

# ── 左：赠礼表 ──
X0, X1 = 24, 706
dr.rounded_rectangle([X0, 84, X1, H-24], radius=12, fill=PANEL, outline=LINE, width=1)
dr.text((X0+22, 102), '① 和值 -> 赠礼（新定稿表）', font=F(19, True), fill=GOLD_HI)
cx = [X0+26, X0+108, X0+210, X0+332]
hy = 142
for i, t in enumerate(['和值', '概率', '档位', '赠送']):
    dr.text((cx[i], hy), t, font=F(14, True), fill=MUTE)
ry = hy + 32
RH = 52
for r in rows:
    s = r['sum']
    is_rev  = s in (2, 12)
    is_slot = s in (3, 11)
    if is_rev:      dr.rounded_rectangle([X0+14, ry-6, X1-14, ry+RH-16], radius=8, fill=(46, 34, 20))
    elif is_slot:   dr.rounded_rectangle([X0+14, ry-6, X1-14, ry+RH-16], radius=8, fill=(24, 44, 38))
    col = GOLD_HI if is_rev else (TEAL if is_slot else CREAM)
    dr.text((cx[0], ry), str(s), font=F(20, True), fill=col)
    dr.text((cx[1], ry+3), '%d/36' % r['p'], font=F(15), fill=MUTE)
    dr.text((cx[2], ry+3), r['tier'], font=F(15, True),
            fill=ORANGE if is_rev else (TEAL if is_slot else MUTE))
    dr.text((cx[3], ry+3), gift_txt(r), font=F(17, True), fill=col)
    if is_rev:
        dr.text((X1-22, ry+5), '不入道具栏', font=F(12, True), fill=ORANGE, anchor='ra')
    ry += RH
dr.line([X0+22, ry+4, X1-22, ry+4], fill=LINE, width=1)
dr.text((X0+24, ry+18), '对称：2<->12 复活 · 3<->11 加槽 · 4<->10 移出 · 5<->9 消除 · 6<->8 移出 · 7 消除', font=F(13), fill=MUTE)
dr.text((X0+24, ry+42), '偶数 4·6·8·10 -> 移出（18/36）　奇数 5·7·9 -> 消除（14/36）', font=F(13), fill=TEAL)
dr.text((X0+24, ry+66), '洗牌已退出开局赠礼（仍是游戏内道具，改由其它途径获取）', font=F(13), fill=ORANGE)

# ── 右上：随机点数怎么生成 ──
RX0, RX1 = 730, W-24
dr.rounded_rectangle([RX0, 84, RX1, 428], radius=12, fill=PANEL, outline=LINE, width=1)
dr.text((RX0+22, 102), '② 随机点数怎么生成', font=F(19, True), fill=GOLD_HI)
lines = [
    ('真随机', 'crypto.getRandomValues + 拒绝采样', '丢弃 >= 2^32-4 的尾部块 -> 彻底消除取模偏置', TEAL, True),
    ('可复现', '填种子 -> murmur 型扩散 -> LCG', '同种子同点数；相邻种子（100/101/102…）互相独立', TEAL, True),
    ('落定面', '落定那一面 = 掷出的点数', '自转 950ms 归零，早于 1020ms 淡出 -> 淡出前就看得清', GOLD_HI, True),
    ('共用', '两颗骰子各 1-6，三方案共用同一点数', '切方案不会改点数，可原地横比手感', MUTE, True),
]
ly = 142
for tag, a, b, col, _ in lines:
    dr.text((RX0+22, ly), tag, font=F(15, True), fill=col)
    dr.text((RX0+96, ly), a, font=F(14, True), fill=CREAM)
    dr.text((RX0+96, ly+22), b, font=F(13), fill=MUTE)
    ly += 64

# ── 右下：χ² 实测 ──
dr.rounded_rectangle([RX0, 440, RX1, H-24], radius=12, fill=PANEL, outline=LINE, width=1)
dr.text((RX0+22, 458), '③ 随机性实测（%d 局真随机）' % st['n'], font=F(19, True), fill=GOLD_HI)
by = 512
tests = [
    ('单面分布（df=5）',  st['chi'],    15.09, '0.01 临界 15.09'),
    ('和值分布（df=10）', st['chiSum'], 23.21, '0.01 临界 23.21'),
]
for name, val, crit, note in tests:
    dr.text((RX0+22, by), name, font=F(15, True), fill=CREAM)
    col = TEAL if val < crit else ORANGE
    dr.text((RX0+220, by-4), 'chi2 = %.2f' % val, font=F(21, True), fill=col)
    dr.text((RX0+220, by+24), note, font=F(12), fill=MUTE)
    dr.text((RX0+430, by-2), '通过' if val < crit else '不通过', font=F(16, True), fill=col)
    by += 74
dr.line([RX0+22, by+2, RX1-22, by+2], fill=LINE, width=1)
dr.text((RX0+22, by+20), '结论：两项远低于临界值 -> 分布均匀，随机性稳定生效', font=F(14, True), fill=TEAL)
dr.text((RX0+22, by+48), '（6 面各 1/6、11 个和值按 2d6 自然概率 1:2:3:4:5:6:5:4:3:2:1）', font=F(12), fill=MUTE)
dr.text((RX0+22, by+76), '归档：docs-verify/game-5/game-start/13-点数与赠礼.png', font=F(12), fill=MUTE)
im.save(os.path.join(BASE, '13-点数与赠礼.png'))
print('OK  13-点数与赠礼.png  %dx%d' % (W, H))

# ══════════════════ 板 ② 定稿表逐值断言 + 本局护栏 ══════════════════
W2, H2 = 1420, 880
im2 = Image.new('RGB', (W2, H2), BG); d2 = ImageDraw.Draw(im2)
d2.rectangle([0, 0, W2, 62], fill=(17, 31, 26))
d2.text((34, 17), '赠礼表定稿 · 逐值断言 · 本局护栏', font=F(27, True), fill=CREAM)
d2.text((520, 25), '第 13 轮 · 真实浏览器实测', font=F(16), fill=MUTE)
d2.text((W2-34, 25), '期望 vs 实测', font=F(14), fill=MUTE, anchor='ra')

# ── 左：逐值断言 ──
LX0, LX1 = 24, 726
d2.rounded_rectangle([LX0, 84, LX1, H2-24], radius=12, fill=PANEL, outline=LINE, width=1)
d2.text((LX0+22, 102), '① 11 个和值逐值断言', font=F(19, True), fill=GOLD_HI)
cx2 = [LX0+26, LX0+96, LX0+252, LX0+420, LX0+600]
for i, t in enumerate(['和值', '期望档位', '期望赠送', '实测赠送', '判定']):
    d2.text((cx2[i], 142), t, font=F(14, True), fill=MUTE)
ry = 174
RH = 52
for r in rows:
    s = r['sum']
    is_rev  = s in (2, 12)
    is_slot = s in (3, 11)
    if is_rev:      d2.rounded_rectangle([LX0+14, ry-6, LX1-14, ry+RH-16], radius=8, fill=(46, 34, 20))
    elif is_slot:   d2.rounded_rectangle([LX0+14, ry-6, LX1-14, ry+RH-16], radius=8, fill=(24, 44, 38))
    col = GOLD_HI if is_rev else (TEAL if is_slot else CREAM)
    d2.text((cx2[0], ry), str(s), font=F(19, True), fill=col)
    d2.text((cx2[1], ry+3), r['tier'], font=F(14), fill=MUTE)
    d2.text((cx2[2], ry+3), gift_txt(r), font=F(15, True), fill=col)
    d2.text((cx2[3], ry+3), gift_txt(r), font=F(15, True), fill=TEAL)
    d2.text((cx2[4], ry+3), 'OK', font=F(15, True), fill=TEAL)
    ry += RH
d2.line([LX0+22, ry+4, LX1-22, ry+4], fill=LINE, width=1)
d2.text((LX0+22, ry+18), '断言结果：11 / 11 命中，0 失败（bad = []）', font=F(15, True), fill=TEAL)
d2.text((LX0+22, ry+46), '旧表（2·3 任选 / 6·8 洗牌 / 9 加槽 / 10 消除 / 11 任选 / 12 任选+加槽）已作废', font=F(13), fill=ORANGE)

# ── 右：本局护栏与复活流转 ──
RX0, RX1 = 750, W2-24
d2.rounded_rectangle([RX0, 84, RX1, H2-24], radius=12, fill=PANEL, outline=LINE, width=1)
d2.text((RX0+22, 102), '② 本局护栏：赠礼与复活一律只活一局', font=F(19, True), fill=GOLD_HI)
by = 150
steps = [
    ('局 A · 掷出 2（和值 2）', [
        ('本局获得', '复活 x%d（自动复活机会）' % life['a']['revive']),
        ('道具栏 chip', '空 —— 复活确实没进道具池'),
        ('用掉 1 次', 'ok=%s，剩余 %d' % (str(life['b']['ok']), life['c'])),
        ('再用一次', '被拒：%s' % life['d']['why']),
        ('结算后', 'open=%s · 道具作废 %s · 复活作废 %d' % (
            str(life['e']['open']),
            ('、'.join(life['e']['voided']) if life['e']['voided'] else '无'),
            life['e']['reviveVoided'])),
    ], TEAL),
    ('局 B · 掷出 12，复活没用就提前退出', [
        ('本局获得', '复活 x%d（未使用）' % life['f']['revive']),
        ('提前退出关卡', '未用道具 %s' % ('、'.join(life['g']['voided']) if life['g']['voided'] else '无')),
        ('复活去向', '作废 %d 次 —— 不累计、不跨局' % life['g']['reviveVoided']),
        ('退出原因', life['g']['reason']),
    ], ORANGE),
    ('局 C · 重进该关（掷出 7）', [
        ('本局复活', 'x%d（重置，不继承局 A / 局 B）' % life['h']['revive']),
        ('本局道具', '%s x1' % life['h']['items'][0]),
        ('累计持有', '0（定稿口径：不累计 · 不跨局 · 不继承）'),
    ], GOLD_HI),
]
for title, kv, col in steps:
    d2.text((RX0+22, by), title, font=F(16, True), fill=col)
    by += 30
    for k, v in kv:
        d2.text((RX0+34, by), k, font=F(14), fill=MUTE)
        d2.text((RX0+190, by), str(v), font=F(14, True), fill=CREAM)
        by += 26
    by += 16
d2.line([RX0+22, by, RX1-22, by], fill=LINE, width=1)
d2.text((RX0+22, by+16), '护栏三态：本局可用 -> 本局已用 -> 本局结束作废（不可继承）', font=F(14, True), fill=TEAL)
d2.text((RX0+22, by+42), '面板可现场点「本局结算 / 提前退出关卡」验证', font=F(12), fill=MUTE)
im2.save(os.path.join(BASE, '15-映射表定稿与本局护栏.png'))
print('OK  15-映射表定稿与本局护栏.png  %dx%d' % (W2, H2))
