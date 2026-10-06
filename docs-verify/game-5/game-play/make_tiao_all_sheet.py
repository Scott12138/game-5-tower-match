#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""条子 一条~九条 · 归一化 + 全量验收板（第 22 轮「甲式」量产）

输入
  assets/_src/game-play/tile-samples/tiao/{一~九}条-raw.png     AI 原图 1024×1536
  assets/_src/game-play/tile-samples/_ref/crops/{一~九}条.png    用户配色参考（作物）

输出
  ① tiao/{一~九}条.png        归一化牌面（3:4 画布 · 牌占高 78%，与万子同一口径）
  ② docs-verify/game-5/game-play/28-条子九张全量验收板.png

两条判据的沿革（★ 都是被真数据打脸后改对的，别改回去）
────────────────────────────────────────────────────────────────────────
【判据一 · 配色三色构成】—— 第 22 轮首版用 HSV 色相带（绿 55~125°、蓝 125~200°），
**被参考图当场证伪**：参考图里「四条/六条/八条」明明是纯绿，却被量出 1.8~4.0 万「蓝」像素
—— 翡翠绿在暗部会偏青，色相漂进蓝色带。→ 改用**通道比值法**：
    红 R>G*1.45 且 R>B*1.35 且 R>80
    绿 G>R*1.18 且 G>B*1.12 且 G>45
    蓝 B>R*1.35 且 B>G*1.10 且 B>70
  先拿参考图作物（真值已知的九张）自证：九张全部与真值一致，才用于成品。
  （沿用 5.1b 口径：**判据自身也要被验证；一个总给出错结论的判据比没有判据更危险**。）

【判据二 · 边框一致性】—— 首版只在**同一像素坐标**上逐像素比。
但 AI 图生图会把牌体整体缩放 0~1%（实测二条/五条牌体 759~760 vs 基准 752），
这 1% 的错位会在金框高对比边缘上放大成 26~41 灰阶的假差异。
→ 增设**仅平移对齐**后的差（按牌体 bbox 左上角整像素平移，不缩放 ——
  缩放重采样本身会引入模糊，污染判据；实测"缩放到同尺寸再比"会把 7 张都抬到 11~17，
  那是重采样伪影，不是真实差异）。两个数一起看：同坐标差 =「构图」偏离，平移后差 =「画得一样不一样」。

【判据三 · 面心取样范围】—— 配色统计的面心矩形必须**内缩 80 px**。
实测二条（纯绿）在内缩 24 px 时被量出 **2683 个"红"像素**，其横向分布 [869,461,…,560,743]
全部贴在左右边界 —— 那是**金框内缘的暖色过渡带**被通道比值法判成红。
内缩量 → 假红像素：24px→2683、40px→1508、60px→81、80px→0；而真红牌同期仍有 12902+
—— 分离度 80 倍，判据可用。

【不做的事】图案"根数"仍不做机器断言 —— 投影法/连通域法都会被竹节凹槽与玉纹击穿
（第 20/21 轮实测：九条 v2 被量成 7 列 21 行、六筒被量成 3 列 4 行），数量交回目视。
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

from tile_lib import (subject_bbox, bg_check, normalize, geom, _ring_stats,
                      border_diff, border_diff_shift, masks, fingerprint, trio,
                      INSET, F, FONT, BG, PANEL, PANEL2, LINE, CREAM, MUTE,
                      GOLD, GOLD_HI, TEAL, ORANGE, REDC)

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'tiao')
REF = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', '_ref', 'crops')
OUT = os.path.join(BASE, '28-条子九张全量验收板.png')


RULE = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
# 真值（人工从用户参考图逐张读出）：(绿, 红, 蓝)
EXPECT = {'一': (1, 1, 1), '二': (1, 0, 0), '三': (1, 0, 0), '四': (1, 0, 0), '五': (1, 1, 0),
          '六': (1, 0, 0), '七': (1, 1, 1), '八': (1, 0, 0), '九': (1, 1, 0)}


# ══════════════════════════════════════════════════════════════════════
#  主流程
# ══════════════════════════════════════════════════════════════════════
print('⓪ 判据自证：配色三色构成判据先在用户参考图上跑（真值已知）')
selftest_ok = True
for h in RULE:
    t = trio(fingerprint(Image.open(os.path.join(REF, '%s条.png' % h))))
    hit = (t == EXPECT[h])
    selftest_ok &= hit
    print('   %s条 判据给%s 真值%s %s' % (h, t, EXPECT[h], '✅' if hit else '❌'))
print('   → ' + ('✅ 判据通过，结论可用' if selftest_ok else '❌ 判据未通过，其结论一律作废'))
assert selftest_ok, '配色判据自证未通过'

print('\n① 归一化（3:4 画布 · 牌占高 78%）：')
CANV = {}
for h in RULE:
    canvas, (bw, bh), sat = normalize(os.path.join(SRC, '%s条-raw.png' % h),
                                      os.path.join(SRC, '%s条.png' % h))
    CANV[h] = canvas
    print('  %s条  牌体 %dx%d  宽高比 %.3f  画布 %s  背景最大饱和度 %d'
          % (h, bw, bh, bw / bh, canvas.size, sat))

print('\n② 边框一致性（基准 = 九条·候选甲原图 1024×1536）：')
G0 = geom(os.path.join(SRC, '九条-raw.png'))
D1, D2, GT = {}, {}, {}
for h in RULE:
    G = geom(os.path.join(SRC, '%s条-raw.png' % h))
    GT[h] = G['tile']
    D1[h] = border_diff(G0['a'], G['a'], G0['tile'], G0['face'])
    D2[h] = border_diff_shift(G0['a'], G['a'], G0['tile'], G0['face'], G['tile'])
    tx0, tx1, ty0, ty1 = G['tile']
    print('  %s条  牌体 w=%d h=%d  同坐标Δ %.2f  平移后Δ %.2f（四角 %.2f~%.2f）'
          % (h, tx1 - tx0 + 1, ty1 - ty0 + 1, D1[h]['band'], D2[h]['band'],
             min(D2[h]['corners']), max(D2[h]['corners'])))

print('\n③ 配色指纹（成品 vs 参考）：')
FP, FPR = {}, {}
for h in RULE:
    G = geom(os.path.join(SRC, '%s条-raw.png' % h))
    fx0, fx1, fy0, fy1 = G['face']
    box = (fx0 + INSET, fy0 + INSET, fx1 - INSET + 1, fy1 - INSET + 1)
    FP[h] = fingerprint(Image.open(os.path.join(SRC, '%s条-raw.png' % h)), box)
    FPR[h] = fingerprint(Image.open(os.path.join(REF, '%s条.png' % h)))
    f, r = FP[h], FPR[h]
    fm = lambda c: '—' if c is None else '(%.2f,%.2f)' % c
    print('  %s条  成品 绿%6d 红%6d 蓝%6d 红重心%s 蓝重心%s  |  参考 绿%6d 红%6d 蓝%6d  %s'
          % (h, f['g'], f['r'], f['b'], fm(f['rc']), fm(f['bc']),
             r['g'], r['r'], r['b'], '✅构成一致' if trio(f) == EXPECT[h] else '❌构成不符'))

# ══════════════════════════════════════════════════════════════════════
#  出板
# ══════════════════════════════════════════════════════════════════════
print('\n④ 出验收板：')
MW, M = 1560, 46
CW, CH, GAP = 440, 587, 30
HDR = 150
h_row1 = HDR + 34
hB = h_row1 + 3 * CH + 2 * 30 + 74
REF_W, REF_H = 152, 203
hB_row = hB + 40
hC = hB_row + REF_H + 60
ROWS = 10
hC_tab = hC + 46
H_ALL = hC_tab + ROWS * 38 + 120

img = Image.new('RGB', (MW, H_ALL), BG)
dr = ImageDraw.Draw(img)
dr.text((M, 34), '条子 一条~九条 · 全量验收板（甲式量产）', font=F(40, True), fill=GOLD_HI)
dr.text((M, 90), '工艺：以「九条·候选甲」原图为底做外科式局部改（image2 = 用户配色参考）　·　本轮 8 张每张只发 1 次生图、零重试',
        font=F(21), fill=CREAM)

dr.text((M, HDR - 4), 'A · 成品九张（3:4 归一化 · 牌占高 78%）', font=F(25, True), fill=GOLD)
for i, h in enumerate(RULE):
    r, c = i // 3, i % 3
    x = M + c * (CW + GAP); y = h_row1 + r * (CH + 30)
    dr.rectangle([x - 2, y - 2, x + CW + 2, y + CH + 2], outline=LINE, width=2)
    img.paste(CANV[h].resize((CW, CH), Image.LANCZOS), (x, y))
    cap = '%s条' % h
    dr.text((x + CW // 2 - dr.textlength(cap, font=F(22, True)) / 2, y + CH + 6),
            cap, font=F(22, True), fill=CREAM)

dr.text((M, hB), 'B · 用户配色参考（作物）', font=F(25, True), fill=GOLD)
x = M
for h in RULE:
    c = Image.open(os.path.join(REF, '%s条.png' % h)).convert('RGB').resize((REF_W, REF_H), Image.LANCZOS)
    dr.rectangle([x - 2, hB_row - 2, x + REF_W + 2, hB_row + REF_H + 2], outline=LINE, width=1)
    img.paste(c, (x, hB_row))
    dr.text((x + REF_W // 2 - dr.textlength(h, font=F(17)) / 2, hB_row + REF_H + 5), h, font=F(17), fill=MUTE)
    x += REF_W + 18

dr.text((M, hC), 'C · 指标', font=F(25, True), fill=GOLD)
dr.text((M + 118, hC + 4),
        '边框差基准 = 九条·候选甲原图：「同坐标」量构图偏离，「平移后」量画得一样不一样；配色判据已先在参考图上自证（九张全对）',
        font=F(17), fill=MUTE)
colx = [M + 10, M + 96, M + 250, M + 470, M + 556, M + 640, M + 724, M + 908, M + 1150]
head = ['牌', '牌体 w×h', '边框Δ 同坐标 / 平移后', '绿 px', '红 px', '蓝 px', '红重心(x,y)', '判定', '']
ty = hC_tab
dr.rectangle([M, ty - 8, MW - M, ty + 30], fill=PANEL2)
for i, t in enumerate(head):
    dr.text((colx[i], ty), t, font=F(18, True), fill=GOLD)
ty += 40

for i, h in enumerate(RULE):
    tx0, tx1, ty0, ty1 = GT[h]
    f = FP[h]
    fm = lambda c: '—' if c is None else '%.2f, %.2f' % c
    okc = (trio(f) == EXPECT[h])
    cells = [h + '条',
             '%d×%d' % (tx1 - tx0 + 1, ty1 - ty0 + 1),
             '%.2f / %.2f' % (D1[h]['band'], D2[h]['band']),
             str(f['g']), str(f['r']), str(f['b']), fm(f['rc']),
             ('✅ 三色构成一致' if okc else '❌ 构成不符') + '　参考: ' + ''.join(
                 n for n, v in zip('绿红蓝', EXPECT[h]) if v)]
    if i % 2 == 0:
        dr.rectangle([M, ty - 6, MW - M, ty + 32], fill=PANEL if (i // 2) % 2 == 0 else PANEL2)
    for j, c in enumerate(cells):
        col = TEAL if j == 2 else (GOLD_HI if (j == 7 and okc) else (REDC if j == 7 else CREAM))
        dr.text((colx[j], ty + 2), c, font=F(17, j == 7), fill=col)
    ty += 38

dr.line([M, ty + 6, MW - M, ty + 6], fill=LINE, width=1)
dr.text((M, ty + 18),
        '九张彩色构成：一条=鸟(红冠蓝翅绿身)｜二/三/四/六/八条=全绿｜五条=四角绿+中心红｜七条=中列红蓝+两侧绿｜九条=两侧绿+中列红',
        font=F(18), fill=CREAM)
dr.text((M, ty + 44),
        '数量（几根竹）不做机器断言 —— 投影法与连通域法都会被竹节凹槽/玉纹击穿（第 20/21 轮实测），数量由 A 区目视复核。',
        font=F(17), fill=MUTE)
dr.text((M, ty + 70),
        '配色判据沿革：首版用 HSV 色相带，把参考图「四条/六条/八条」的纯绿量出上万「蓝」像素 → 判据被证伪 → 改用通道比值法并重自证通过。',
        font=F(17), fill=MUTE)
img.save(OUT)
print('  验收板 →', OUT, img.size)
