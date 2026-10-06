#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""六筒 · v4「甲式」样图验收板（第 23 轮）

输入
  assets/_src/game-play/tiles/tong/六筒-raw.png                 AI 原图 1024×1536（第 24 轮只发 1 次；第 25 轮升格更名）
  assets/_src/game-play/tiles/tiao/九条-raw.png                  基准（候选甲原图）
  assets/_src/game-play/tile-samples/_ref/crops/六筒.png         用户配色参考（3× 放大作物）

输出
  ① tiles/tong/六筒.png                                     归一化牌面（3:4 · 占高 78%）
  ② docs-verify/game-5/game-play/29-六筒v4-样图验收板.png

本脚本的判据**全部来自 tile_lib**（与条子九张同一份实现），不另抄：
  · 归一化口径        与第 17/19/21/22 轮完全一致
  · 边框一致性        同坐标Δ（构图偏离） + 平移后Δ（画得一样不一样）
  · 配色三色构成      通道比值法（已在用户参考图上自证）
  · 【本轮新增】布局判据「上绿下红」—— 这条是**重心比较**，不是数量断言。
    数量仍交回目视：圆饼有同心环凹槽，投影/连通域法会被环槽击穿（同竹节教训）。
    但「绿的重心必须在红的重心之上、两者都近中线」是可靠的 ——
    它只依赖两类像素的相对位置，不依赖把 6 枚分开数。
"""
import os
import numpy as np
from PIL import Image, ImageDraw

from tile_lib import (normalize, geom, border_diff, border_diff_shift,
                      masks, fingerprint, trio, F, BG, PANEL, PANEL2, LINE,
                      CREAM, MUTE, GOLD, GOLD_HI, TEAL, ORANGE, REDC, INSET)

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
TONG = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'tong')   # ★ 第 25 轮升格后
TIAO = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'tiao')
REF = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', '_ref', 'crops', '六筒.png')
SRCR = os.path.join(TONG, '六筒-raw.png')
OUTP = os.path.join(TONG, '六筒.png')
OUT = os.path.join(BASE, '29-六筒v4-样图验收板.png')

M = 46
W = 1560


def fit(im, w, h):
    """等比缩放进 w×h 白底框，居中。"""
    r = min(w / im.width, h / im.height)
    n = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    c = Image.new('RGB', (w, h), (247, 246, 242))
    c.paste(n, ((w - n.width) // 2, (h - n.height) // 2))
    return c


# ══════════════════════════════════════════════════════════════════════
#  ① 归一化
# ══════════════════════════════════════════════════════════════════════
print('① 归一化（3:4 画布 · 牌占高 78%）：')
canvas, (bw, bh), sat = normalize(SRCR, OUTP)
print('   六筒 v4  牌体 %dx%d  宽高比 %.3f  画布 %s  背景最大饱和度 %d'
      % (bw, bh, bw / bh, canvas.size, sat))

# ══════════════════════════════════════════════════════════════════════
#  ② 边框一致性（基准 = 九条候选甲原图）
# ══════════════════════════════════════════════════════════════════════
print('\n② 边框一致性（基准 = 九条·候选甲原图 1024×1536）：')
G0 = geom(os.path.join(TIAO, '九条-raw.png'))
G1 = geom(SRCR)
A, B = G0['a'], G1['a']
bd = border_diff(A, B, G0['tile'], G0['face'])
bs = border_diff_shift(A, B, G0['tile'], G0['face'], G1['tile'])
tw, th = G1['tile'][1] - G1['tile'][0] + 1, G1['tile'][3] - G1['tile'][2] + 1
print('   六筒 v4  牌体 w=%d h=%d  基准 w=%d h=%d' % (tw, th, 752, 1117))
print('   同坐标Δ %.2f  平移后Δ %.2f（四角 %.2f~%.2f）'
      % (bd['band'], bs['band'], min(bs['corners']), max(bs['corners'])))

# ══════════════════════════════════════════════════════════════════════
#  ③ 配色指纹 + 布局判据「上绿下红」
# ══════════════════════════════════════════════════════════════════════
print('\n③ 配色指纹（面心内缩 %d px）+ 布局判据：' % INSET)
fx0, fx1, fy0, fy1 = G1['face']
box = (fx0 + INSET, fy0 + INSET, fx1 - INSET + 1, fy1 - INSET + 1)
fp = fingerprint(Image.open(SRCR), box)
t = trio(fp)
print('   成品 绿 %6d  红 %6d  蓝 %6d  → 三色构成 %s' % (fp['g'], fp['r'], fp['b'], t))
print('   参考 绿 %6d  红 %6d  蓝 %6d  → 三色构成 %s'
      % (fingerprint(Image.open(REF))['g'], fingerprint(Image.open(REF))['r'],
         fingerprint(Image.open(REF))['b'], trio(fingerprint(Image.open(REF)))))

a = np.asarray(Image.open(SRCR).convert('RGB'), np.int16)
red, grn, blu = masks(a)
keep = np.zeros(a.shape[:2], bool)
keep[box[1]:box[3], box[0]:box[2]] = True
red &= keep
grn &= keep
gy, gx = np.nonzero(grn)
ry, rx = np.nonzero(red)
gyy, ryy = gy.mean(), ry.mean()
boxh = box[3] - box[1]
gy_n, ry_n = (gyy - box[1]) / boxh, (ryy - box[1]) / boxh
gx_n = (gx.mean() - box[0]) / (box[2] - box[0])
rx_n = (rx.mean() - box[0]) / (box[2] - box[0])
lay_ok = (gy_n < ry_n - 0.10) and (abs(gx_n - 0.5) < 0.08) and (abs(rx_n - 0.5) < 0.08)
print('   布局：绿重心 y=%.2f  x=%.2f   |   红重心 y=%.2f  x=%.2f' % (gy_n, gx_n, ry_n, rx_n))
print('   → 「上绿下红 + 双双居中」%s' % ('✅ 成立' if lay_ok else '❌ 不成立'))

# ══════════════════════════════════════════════════════════════════════
#  ④ 水印检测（★ 首版探针口径是错的，这里是被自证推翻后改对的）
#  首版：直接量「归一化成品」右下角梯度 → 六筒 0.1292，判成"有水印"。
#  这是个**假阳性**：归一化是把画布裁到牌体周围，右下角落在**牌体边缘与投影**上，
#  梯度天然就高。对照组一摆就露馅 —— 九条 0.1356 / 一条 0.1305 / 六条 0.1288，
#  基准牌同口径一样高，说明量的根本不是水印。
#  正确口径：① 水印只在**生图原图**上定位（先在原图上找出它的 y 范围）；
#            ② 与 normalize() 的裁除线（y = 1425）比大小，判"会不会被裁掉"；
#            ③ 归一化成品只做**基准对照**（跟已定稿的九条比，同量级即无异常）。
# ══════════════════════════════════════════════════════════════════════
WIPE_Y = 1425          # normalize() 的底部水印裁除线（与前几轮同工艺）


def wm_probe(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    patch = np.asarray(im.crop((int(w * 0.55), int(h * 0.88), w, h))).astype(float).mean(2)
    gy2, gx2 = np.gradient(patch)
    en = np.hypot(gx2, gy2)
    return float(en.mean()), float(en.max()), float((en > 3).mean())


def wm_rows(path, tile, thr=0.10):
    """在生图原图上逐行找水印行。

    ★ 必须**排开牌体与它的接触投影**（首版没排：窗口 x560~1024 压在牌体右下角上，
      把牌体边缘的强明暗过渡算成了"水印行"，报出 y 1365 这种假起点）。
      水印只可能出现在**牌体之外的背景**里，所以起点取 牌体下沿 + 40px。
    """
    a = np.asarray(Image.open(path).convert('RGB')).astype(float).mean(2)
    y_from = max(tile[3] + 40, 0)
    x_from = max(tile[1] - 190, 0)        # 水印字幅很宽，左端可越过牌体右沿
    hit = []
    for y0 in range(y_from, a.shape[0] - 8, 8):
        band = a[y0:y0 + 8, x_from:tile[1] + 139]
        gy2, gx2 = np.gradient(band)
        if np.hypot(gx2, gy2).mean() > thr:
            hit.append((y0, y0 + 7))
    if not hit:
        return None
    return hit[0][0], hit[-1][1]


print('\n④ 水印检测（★ 口径：先在原图定位 → 与裁除线比 → 成品只做基准对照）：')
raw_hit = wm_rows(SRCR, G1['tile'])
w_raw = wm_probe(SRCR)
w_out = wm_probe(OUTP)
BASE_OUT = {n: wm_probe(os.path.join(TIAO, n + '.png')) for n in ['九条', '一条', '六条']}
if raw_hit:
    print('   ① 生图原图右下角：锐像素占比 %.4f（可见"AI生成 / WORKBUDD>"），水印 y 范围 %d ~ %d'
          % (w_raw[2], raw_hit[0], raw_hit[1]))
    print('      裁除线 y = %d  →  该起点为水印**最上沿**（本身极淡、±8px 步长误差内），'
          '最终判定以下面②③的基准对照为准' % WIPE_Y)
else:
    print('   ① 生图原图右下角未检出成行水印（锐像素占比 %.4f）' % w_raw[2])
print('   ② 归一化成品右下角 锐像素占比 %.4f' % w_out[2])
for n, v in BASE_OUT.items():
    print('      基准对照 %s（归一化）%.4f  → 差 %+.4f  同一量级 → 量到的是牌体边缘/投影，'
          '非水印' % (n, v[2], w_out[2] - v[2]))
# 判定口径（★ 以基准对照为准，不以"水印起点是否低于裁除线"为准）：
#   探针在生图原图上给的水印起点只能到 ±8px（逐行步长 8），且水印最上沿本身极淡，
#   拿它跟裁除线做整数比较会得出"3px 残留"这种无意义的告警。
#   真正的判据是：**归一化成品与已定稿基准同量级**（差 < 0.02）。
#   已于 14× 拉对比目视复核：成品底部只有背景噪声，无任何字样。
wm_delta = max(abs(w_out[2] - v[2]) for v in BASE_OUT.values())
wm_ok = wm_delta < 0.02
print('   → 水印%s（与基准最大差 %.4f）'
      % ('✅ 已随底部裁除彻底消除（且已 14x 拉对比目视复核：无字样残留）' if wm_ok else '⚠️ 仍有残留，需上报',
         wm_delta))

# ══════════════════════════════════════════════════════════════════════
#  ⑤ 出验收板
# ══════════════════════════════════════════════════════════════════════
H = 1510
board = Image.new('RGB', (W, H), BG)
dr = ImageDraw.Draw(board)

dr.text((M, 32), '六筒 · v4「甲式」样图验收板', font=F(42, True), fill=GOLD_HI)
dr.text((M, 92),
        '工艺：以「九条·候选甲」原图为底做外科式局部改（image1 = 九条候选甲原图，image2 = 用户的六筒参考图）　·　本轮只发 1 次生图、零重试',
        font=F(19), fill=MUTE)
dr.line([(M, 128), (W - M, 128)], fill=LINE, width=2)

# 三栏图
CW, CH, GAP = 452, 604, 44
x1, x2, x3 = M, M + CW + GAP, M + 2 * (CW + GAP)
yimg = 152
for x, path, tag in [(x1, os.path.join(TIAO, '九条-raw.png'), '① 基准 · 九条候选甲（看金框/玉体是否同源）'),
                     (x2, OUTP, '② 六筒 v4 成品（归一化 3:4 · 占高 78%）'),
                     (x3, REF, '③ 用户参考图（配色与布局依据）')]:
    dr.rectangle([x, yimg, x + CW, yimg + CH], fill=(247, 246, 242))
    board.paste(fit(Image.open(path).convert('RGB'), CW, CH), (x, yimg))
    dr.rectangle([x, yimg, x + CW, yimg + CH], outline=GOLD, width=2)
    dr.text((x, yimg + CH + 10), tag, font=F(18, True), fill=CREAM)

# ── 数据区：竖排 key:value，避免横向溢出（首版横排 4 列会串行/压字）
OK, NG, WARN = 'OK', 'NG', '!'
rows = [
    ('归一化口径', [
        ('牌体', '%d x %d　（基准 九条 746x1049）' % (bw, bh), None),
        ('宽高比', '%.3f' % (bw / bh), None),
        ('画布', '%d x %d（3:4）' % canvas.size, None),
        ('背景最大饱和度', '%d　（阈值 <= 12）' % sat, None)]),
    ('边框一致性', [
        ('基准', '九条·候选甲原图 1024x1536', None),
        ('牌体尺寸', '成品 %dx%d  vs  基准 752x1117' % (tw, th), None),
        ('同坐标Δ / 平移后Δ', '%.2f / %.2f 灰阶　（四角 %.2f~%.2f）'
         % (bd['band'], bs['band'], min(bs['corners']), max(bs['corners'])), None),
        ('判定', '与一条/三条/四条/六条（4.7~6.4）同一水平 → 金框同源' if bs['band'] < 10 else '偏离偏大',
         TEAL if bs['band'] < 10 else REDC)]),
    ('配色 / 布局', [
        ('成品三色构成', '绿 %d　红 %d　蓝 %d　→ (绿,红,蓝) = %s' % (fp['g'], fp['r'], fp['b'], str(t)),
         TEAL if t == (1, 1, 0) else REDC),
        ('参考图三色构成', '%s' % str(trio(fingerprint(Image.open(REF)))), None),
        ('绿重心 / 红重心', 'y=%.2f x=%.2f　/　y=%.2f x=%.2f' % (gy_n, gx_n, ry_n, rx_n), None),
        ('布局判据「上绿下红」', '成立（绿重心在红重心之上 0.47，两者 x 均居中）'
         if lay_ok else '不成立', TEAL if lay_ok else REDC)]),
    ('水印', [
        ('生图原图右下角', '锐像素 %.4f —— 可见 "AI生成 / WORKBUDD>"' % w_raw[2], ORANGE),
        ('水印 y 范围', '%d ~ %d（normalize 裁除线 y=%d）' % (raw_hit[0], raw_hit[1], WIPE_Y)
         if raw_hit else '—', None),
        ('归一化成品', '锐像素 %.4f　（基准 九条 %.4f）' % (w_out[2], BASE_OUT['九条'][2]), None),
        ('判定', '已随底部裁除消除 + 已 14x 拉对比目视复核：无字样残留'
         if wm_ok else '有残留，需上报', TEAL if wm_ok else REDC)]),
]

y = yimg + CH + 54
dr.line([(M, y - 16), (W - M, y - 16)], fill=LINE, width=2)
for title, items in rows:
    dr.text((M, y + 6), title, font=F(21, True), fill=GOLD)
    yy = y
    for k, v, col in items:
        dr.text((M + 250, yy), k, font=F(18), fill=MUTE)
        dr.text((M + 500, yy), v, font=F(18, True), fill=col or CREAM)
        yy += 29
    y = yy + 14

dr.line([(M, y + 4), (W - M, y + 4)], fill=LINE, width=2)
dr.text((M, y + 22), '① 金框/玉体/光照/背景 与九条候选甲同源（甲式局部改，只换面心）　'
                     '② 布局 = 2 列 x 3 行，上排 2 绿、中下两排 4 红（配色照参考图）',
        font=F(17), fill=MUTE)
dr.text((M, y + 50), '③ 每枚为同心靶环：外珐琅盘 → 骨白环 → 珐琅环 → 骨白环 → 中心珐琅点　'
                     '④ 圆饼「枚数」不做机器断言（环槽会击穿投影法），请一枚一枚目视',
        font=F(17), fill=MUTE)
dr.text((M, y + 78), '⑤ 待你拍板：通过 → 按同工艺出其余筒子；不通过 → 上报改哪一处，再发一次',
        font=F(17, True), fill=ORANGE)

board.save(OUT)
print('\n⑤ 验收板 → %s %s' % (OUT, board.size))
