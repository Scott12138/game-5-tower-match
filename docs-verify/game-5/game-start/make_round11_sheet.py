#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 11 轮验收板：① 点数与赠礼规则  ② 音效×动画 对齐
数据来源：由真实浏览器 eval 导出的 /tmp/r11.json（赠礼表 / 压测 / 音效时间点）
         + 音频包络 proc/audio_env.json（实测录音，非合成）
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
ENVJ = os.path.join(ROOT, 'assets', '_src', 'game-start', 'audio-candidates', 'proc', 'audio_env.json')
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

d = json.load(open('/tmp/r11.json', encoding='utf-8'))
rows, st = d['rows'], d['stress']
cues = d['cues']

# ══════════════════ 板 ① 点数与赠礼 ══════════════════
W, H = 1420, 880
im = Image.new('RGB', (W, H), BG); dr = ImageDraw.Draw(im)
dr.rectangle([0, 0, W, 62], fill=(17, 31, 26))
dr.text((34, 17), '开局掷骰 · 点数与赠礼规则', font=F(27, True), fill=CREAM)
dr.text((432, 24), '第 11 轮 · 和值定档 · 每次进入都送', font=F(16), fill=MUTE)
dr.text((W-34, 24), '数据由真实浏览器导出', font=F(14), fill=MUTE, anchor='ra')

# ── 左：赠礼表 ──
x0, y = 34, 96
dr.text((x0, y), '和值 → 档位 → 赠送道具（两颗骰子，36 种等可能）', font=F(18, True), fill=GOLD_HI)
y += 32
hdr = [('和值', x0+8), ('概率', x0+88), ('档位', x0+196), ('赠送', x0+292), ('出现频次', x0+470)]
for t, tx in hdr:
    dr.text((tx, y), t, font=F(15, True), fill=MUTE)
y += 22
dr.line([x0, y, x0+700, y], fill=LINE, width=1)
y += 8
ROWH = 46
maxbar = 700
for r in rows:
    t = r['tier']
    lab = {'低档': MUTE, '中档': TEAL, '高档': GOLD, '顶档': GOLD_HI}[t]
    if r['sum'] in (2, 12): lab = GOLD_HI
    dr.rectangle([x0+2, y+2, x0+700, y+ROWH-4], fill=PANEL)
    dr.text((x0+8, y+13), str(r['sum']), font=F(21, True), fill=lab)
    dr.text((x0+88, y+17), '%d/36' % r['p'], font=F(15), fill=MUTE)
    dr.text((x0+196, y+16), t, font=F(16, True), fill=lab)
    gift = ' + '.join(i + '×1' for i in r['items'])
    dr.text((x0+292, y+16), gift, font=F(16), fill=CREAM)
    bw = int(r['p'] / 6 * 168)
    dr.rectangle([x0+470, y+15, x0+470+bw, y+31], fill=TEAL_D if r['p'] < 5 else GOLD)
    y += ROWH
# 三档小结
ys = y + 12
tiers = [('低档 2–4', '6/36 = 16.7%', '单件（消除/移出）', MUTE),
         ('中档 5–9', '24/36 = 66.7%', '单件（移出/洗牌/加槽/任选）', TEAL),
         ('高档 10–11', '5/36 = 13.9%', '双件组合', GOLD),
         ('顶档 12', '1/36 = 2.8%', '任选×2（双六彩蛋）', GOLD_HI)]
dr.text((x0, ys), '档位小结', font=F(16, True), fill=GOLD_HI)
ys += 28
for a, b, c, col in tiers:
    dr.text((x0, ys), a, font=F(15, True), fill=col)
    dr.text((x0+110, ys), b, font=F(15), fill=MUTE)
    dr.text((x0+250, ys), c, font=F(15), fill=CREAM)
    ys += 25

# ── 右：压测 ──
rx = 790
dr.text((rx, 96), '随机性压测 · %d 局（%d 次掷面）' % (st['n'], st['n']*2), font=F(18, True), fill=GOLD_HI)
yy = 134
exp = st['n']*2/6
for f in range(1, 7):
    c = st['bin'][f]
    dr.text((rx, yy-2), '点数 %d' % f, font=F(15, True), fill=CREAM)
    dr.text((rx+72, yy-2), '%d 次' % c, font=F(15), fill=TEAL)
    dr.text((rx+142, yy-2), '期望 %.0f' % exp, font=F(14), fill=MUTE)
    bw = int(min(c/exp, 1.4) / 1.4 * 300)
    dr.rectangle([rx+218, yy+1, rx+218+bw, yy+15], fill=TEAL_D)
    dr.line([rx+218+int(300/1.4), yy-2, rx+218+int(300/1.4), yy+18], fill=GOLD, width=1)
    yy += 30
ok = st['pass']
dr.rectangle([rx, yy+8, rx+560, yy+62], fill=PANEL)
dr.text((rx+14, yy+18), '面分布 χ2 = %.2f' % st['chi'], font=F(17, True), fill=GOLD_HI)
dr.text((rx+14, yy+42), '自由度 5 · 0.01 临界 15.09 → ' + ('通过：分布均匀，随机性稳定生效' if ok else '偏离'),
        font=F(14), fill=TEAL if ok else ORANGE)
yy += 78
dr.text((rx, yy), '和值分布 χ2 = %.2f（自由度 10 · 0.01 临界 23.21）' % st['chiSum'],
        font=F(15), fill=CREAM)
yy += 26
pc = st['sumCnt']
mx = max(pc.values())
for s in range(2, 13):
    dr.rectangle([rx+14+(s-2)*44, yy+50-int(pc[str(s)]/mx*50), rx+14+(s-2)*44+30, yy+50],
                 fill=TEAL_D if s not in (2, 12) else GOLD)
    dr.text((rx+14+(s-2)*44+15, yy+54), str(s), font=F(12), fill=MUTE, anchor='ma')
yy += 88
# 断言清单
dr.text((rx, yy), '真实浏览器断言（非自动演示）', font=F(16, True), fill=GOLD_HI)
yy += 26
checks = [
    '首次开局即掷：6 + 1 = 7 → 中档 → 任选×1',
    '落定点数：t=900/1200 时 faceOf = 目标点数',
    '终帧：骰子 opacity=0、相机 scale=0.99998',
    '种子复现：同种子同点数；相邻种子已扩散（100→11 / 101→15 / 102→65）',
    '音画偏差：补偿前 -55ms → 补偿后 -2 / 0 ms',
    '控件：重掷开局 / 音效开关 / 关卡绑定 / 清空累计 / 压测 全部生效',
]
for c in checks:
    dr.text((rx, yy), '· ' + c, font=F(14), fill=MUTE)
    yy += 23
dr.line([34, H-30, W-34, H-30], fill=LINE, width=1)
dr.text((34, H-24), '口径：点数真随机（crypto，含拒绝采样消除取模偏置）；给种子则走扩散后 LCG 可复现',
        font=F(13), fill=MUTE)
im.save(os.path.join(BASE, '13-点数与赠礼.png'))
print('13-点数与赠礼.png', im.size)

# ══════════════════ 板 ② 音效 × 动画 对齐 ══════════════════
env = json.load(open(ENVJ, encoding='utf-8'))['env']['サイコロを振る・二個.mp3']
TOTAL = 1200
W2, H2 = 1420, 640
im2 = Image.new('RGB', (W2, H2), BG); d2 = ImageDraw.Draw(im2)
d2.rectangle([0, 0, W2, 62], fill=(17, 31, 26))
d2.text((34, 17), '音效 × 动画 节拍对齐', font=F(27, True), fill=CREAM)
d2.text((402, 24), '候选 #3「サイコロを振る・二個」真实录音 · 与动画同一时基', font=F(16), fill=MUTE)
d2.text((W2-34, 24), '实测偏差 -2 / 0 ms', font=F(15, True), fill=TEAL, anchor='ra')

X0, X1 = 96, W2-96
px = lambda v: X0 + (v/TOTAL)*(X1-X0)

# 网格
for v in range(0, 1201, 100):
    xx = px(v)
    d2.line([xx, 92, xx, 458], fill=(26, 44, 37), width=1)
    d2.text((xx, 476), str(v), font=F(12), fill=MUTE, anchor='ma')
d2.text(((X0+X1)/2, 500), 't / ms', font=F(13), fill=MUTE, anchor='ma')

# 包络
EY0, EY1 = 300, 100
mx = max(env[:132]) or 1
pts = []
for i, v in enumerate(env[:132]):
    tt = i*10
    pts.append((px(tt), EY1 + (1 - v/mx)*(EY0-EY1)))
d2.line(pts, fill=TEAL, width=2, joint='curve')
d2.line([X0, EY0, X1, EY0], fill=LINE, width=1)
d2.text((X0, 74), '音频包络（每 10ms 一帧，峰值归一）', font=F(15, True), fill=TEAL)
# 音效有效段
d2.rectangle([px(0), EY0-14, px(cues['decay']), EY0-4], fill=TEAL_D)
d2.text((px(cues['decay'])+10, EY0-28), '有效段 80-630ms → 其后自然衰减到静音', font=F(13), fill=TEAL)
# 关键脉冲（标签放包络下方，避免与标题抢位）
for v, lab, col in [(cues['loud'], '最强撞击 80ms', GOLD_HI), (cues['main'], '主脉冲 310ms', TEAL)]:
    d2.line([px(v), EY1-4, px(v), EY0+6], fill=col, width=2)
    d2.text((px(v), EY0+12), lab, font=F(13, True), fill=col, anchor='ma')

# 动画节拍条
BY0, BY1 = 386, 414
bands = [(0, 70, '驱动反馈 0–70', (255,255,255), MUTE),
         (70, 740, '摇骰 70–740', GOLD, CREAM),
         (740, 1200, '镜头拉远 740–1200', TEAL_D, TEAL)]
for a, b, lab, col, tc in bands:
    if a == 0:
        d2.rectangle([px(a), BY0, px(b), BY1], fill=(34, 50, 44))
    else:
        d2.rectangle([px(a), BY0, px(b), BY1], fill=col)
    d2.text((px((a+b)/2), BY0-20), lab, font=F(14, True), fill=tc, anchor='ma')
marks = [(300, '追尾碰撞 300', GOLD_HI, 'ma', BY1+20),
         (950, '自转归零 950', TEAL, 'ra', BY1+20),
         (1020, '淡出起 1020', ORANGE, 'la', BY1+20),
         (1170, '淡出止 1170', ORANGE, 'ra', BY1+42)]
for v, lab, col, anc, ly in marks:
    d2.line([px(v), BY0-4, px(v), BY1+16], fill=col, width=2)
    d2.text((px(v), ly), lab, font=F(13, True), fill=col, anchor=anc)

# 对齐说明
ys = 520
d2.text((34, ys), '对齐口径', font=F(17, True), fill=GOLD_HI)
ys += 30
lines = [
    ('音效起播 = 动画 t=0；不做按钮层、不做电机层', MUTE),
    ('音频最强撞击 80ms 对 动画 70ms 起转（被驱动甩出）—— 差 10ms', CREAM),
    ('音频主脉冲 310ms 对 动画追尾碰撞 300ms —— 差 10ms', GOLD_HI),
    ('尾段自然衰减（630ms 后）对 惯性滑行减速；自转 950ms 归零、1020–1170ms 淡出', CREAM),
]
for t, col in lines:
    d2.text((34, ys), '· ' + t, font=F(14), fill=col)
    ys += 24
im2.save(os.path.join(BASE, '14-音画对齐.png'))
print('14-音画对齐.png', im2.size)
