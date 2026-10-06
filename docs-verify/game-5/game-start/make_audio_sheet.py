#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开局页掷骰音效 · 候选包络对比板
把 8 个候选的振幅包络按同一时间轴对齐，叠加"动画节拍参考线"
（70ms 起转 / 740ms 落定起 / 1150ms 落定毕 / 1200ms 总长），
用于判定哪个候选的"密集碰撞段"与 B 追尾方案的节拍吻合。
输出：12-音效候选对比.png
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.abspath(os.path.join(BASE, '..', '..', '..', 'assets', '_src', 'game-start', 'audio-candidates'))
PROC = os.path.join(CAND, 'proc')
OUT = os.path.join(BASE, '12-音效候选对比.png')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG, PANEL, PANEL2 = (11, 15, 12), (18, 23, 19), (23, 29, 24)
GOLD, GOLD_HI = (246, 196, 69), (255, 224, 138)
CREAM, DIM, MUTE = (232, 238, 231), (176, 190, 178), (120, 134, 122)
TEAL, ORANGE, RED = (143, 227, 197), (255, 158, 96), (255, 118, 110)
GRID = (40, 48, 42)

_fc = {}
def F(sz, bold=False):
    k = (sz, bold)
    if k not in _fc:
        try:
            _fc[k] = ImageFont.truetype(FONT, sz, index=1 if bold else 0)
        except Exception:
            _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

W, H = 1620, 1180
TITLE_H, FOOT_H = 96, 128
LEFT_LAB = 372
PLOT_L = LEFT_LAB + 14
PLOT_R = W - 40
TMAX = 3600.0            # ms，横轴上限（最长候选 3.5s）
BEATS = [(70, '起转'), (740, '落定起'), (1150, '落定毕'), (1200, '总长')]

m = json.load(open(os.path.join(PROC, 'audio_metrics.json'), encoding='utf-8'))
e = json.load(open(os.path.join(PROC, 'audio_env.json'), encoding='utf-8'))
hop = e['hop_ms']
envs = e['env']

# 推荐序（依据定量特征：脉冲数多 + 低频占比低=硬质高频丰富 + ZCR 高=碰撞清脆）
rank = sorted(m.keys(), key=lambda k: (-(m[k]['pulses']), m[k]['low_ratio']))
rec = {k: i + 1 for i, k in enumerate(rank)}
NOTE = {
    'チンチロ_サイコロを振る_小丼_その１.mp3': '小碗内掷骰 · 碰撞密集',
    'チンチロ_サイコロを振る_小丼_その２.mp3': '小碗内掷骰 · 碰撞最密/最脆',
    'チンチロ_サイコロを振る_小丼_その３.mp3': '小碗内掷骰 · 尾音最长',
    'サイコロを振る・二個.mp3': '两颗骰同摇 · 碰撞多',
    'サイコロ二個を振る_その１.mp3': '两颗骰 · 低频厚(偏闷)',
    'サイコロ二個を振る_その２.mp3': '两颗骰 · 偏闷',
    'サイコロ二個を振る_その３.mp3': '两颗骰 · 偏闷',
    '麻雀牌.mp3': '麻将牌单击 · 可作"落定"声',
}

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

d.text((40, 30), '开局页掷骰音效 · 候选包络对比', font=F(38, True), fill=GOLD_HI)
d.text((40, 74), '同一时间轴对齐 · 金色竖线 = B「追尾」动画节拍参考（70 / 740 / 1150 / 1200 ms）',
       font=F(19), fill=DIM)
d.text((W - 40, 40), f'{len(m)} 个候选', font=F(22, True), fill=MUTE, anchor='ra')
d.text((W - 40, 72), '波幅归一化 · 采样间隔 10ms', font=F(17), fill=MUTE, anchor='ra')

# 时间刻度
n = len(m)
row_h = (H - TITLE_H - FOOT_H) / n
def X(ms): return PLOT_L + (min(ms, TMAX) / TMAX) * (PLOT_R - PLOT_L)

# 顶部刻度尺
for ms in range(0, 3601, 250):
    x = X(ms)
    d.line([(x, TITLE_H - 10), (x, TITLE_H - 2)], fill=GRID, width=1)
    if ms % 500 == 0:
        d.text((x, TITLE_H - 30), f'{ms}', font=F(15), fill=MUTE, anchor='ma')

for i, name in enumerate(sorted(m.keys(), key=lambda k: rec[k])):
    y0 = TITLE_H + i * row_h
    y1 = y0 + row_h
    d.rectangle([16, y0 + 3, W - 16, y1 - 5], fill=PANEL if i % 2 == 0 else PANEL2)

    md = m[name]
    is_top = rec[name] <= 3
    lab = GOLD_HI if is_top else CREAM
    d.text((36, y0 + 10), f'#{rec[name]}', font=F(23, True), fill=lab)
    d.text((82, y0 + 10), name.replace('.mp3', ''), font=F(20, True), fill=lab)
    d.text((82, y0 + 38), NOTE.get(name, ''), font=F(16), fill=TEAL if is_top else MUTE)
    d.text((82, y0 + 63), f"碰撞 {md['pulses']} 次 · 时长 {md['dur_s']:.2f}s · 起音 {md['onset_ms']:.0f}ms",
           font=F(15), fill=MUTE)
    d.text((82, y0 + 85), f"低频占比 {md['low_ratio']:.2f} · ZCR {md['zcr']:.3f}",
           font=F(15), fill=MUTE)

    # 节拍竖线（仅前 1.2s）
    for ms, lbl in BEATS:
        x = X(ms)
        d.line([(x, y0 + 6), (x, y1 - 8)], fill=(72, 60, 22) if ms > 70 else (96, 78, 26), width=1)
    xi, xj = X(70), X(1150)
    d.rectangle([xi, y0 + 6, xj, y1 - 8], outline=(70, 58, 20))

    # 包络曲线
    env = envs[name]
    mx = max(env) or 1.0
    base = y1 - 16
    top = y0 + 14
    amp = base - top
    pts = []
    for k, v in enumerate(env):
        t = k * hop
        if t > TMAX:
            break
        pts.append((X(t), base - (v / mx) * amp * 0.94))
    if len(pts) > 1:
        d.line(pts, fill=GOLD if is_top else (120, 152, 130), width=2 if is_top else 1)
        # 脉冲标记
        for pk in md['pulse_at_ms']:
            x = X(pk * hop)
            d.ellipse([x - 3, base - (env[pk] / mx) * amp * 0.94 - 3,
                       x + 3, base - (env[pk] / mx) * amp * 0.94 + 3],
                      fill=(255, 120, 110) if is_top else (150, 110, 100))
    d.line([(PLOT_L, base), (PLOT_R, base)], fill=GRID, width=1)

# 底部结论
fy = H - FOOT_H + 8
d.rectangle([16, fy, W - 16, H - 16], fill=PANEL)
d.text((36, fy + 12), '定量推断（无"耳朵"条件下的排序依据）', font=F(21, True), fill=GOLD)
d.text((36, fy + 44),
       '排序 = 碰撞脉冲数 ↓ → 低频占比 ↑。碰撞次数多 = 盘内连续弹跳；低频占比低 = 高频丰富 = 硬质（密胺/塑料）撞击，不闷。',
       font=F(17), fill=DIM)
d.text((36, fy + 70),
       '推荐：#1 小丼_その２ / #2 サイコロを振る・二個 / #3 小丼_その１ —— 最终须试听确认（见试听页）。',
       font=F(18, True), fill=TEAL)

img.save(OUT)
print('写出', OUT, img.size)
