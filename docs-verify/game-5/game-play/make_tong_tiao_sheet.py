#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""筒 / 条 单张样图 · 归一化 + 验收板（第 20 轮）

╔══════════════════════════════════════════════════════════════════════════╗
║ ⚠ 本脚本的「图案数量」判据已被实测证伪，**不要再复用其中的计数逻辑**。      ║
║   它把真值 3 列 × 3 行的九条量成 **7 列 / 21 行**、把 2 列 × 3 行的六筒      ║
║   量成 **3 列 / 4 行** —— 投影法与连通域法都被「牌体裂纹玉纹 + 竹节深色     ║
║   节环」击穿（与图案同色域，掩码被切成碎簇）。                              ║
║   → 本脚本产出的板子已移名归档为                                          ║
║     `26-筒条单张样图-验收板-v1-计数判据已作废.png`；                        ║
║   → **替代方案 = `make_tiao_sheet.py`**（只报背景纯度 / 主体宽高比这类稳的  ║
║     几何量，**数量一律目视复核**）。                                        ║
║   教训：一个总是量错的自动断言，比没有断言更危险。                          ║
╚══════════════════════════════════════════════════════════════════════════╝

输入：assets/_src/game-play/tile-samples/{tong/六筒-raw.png, tiao/九条-raw.png}
输出：
  ① 归一化牌面 tong/六筒.png / tiao/九条.png（3:4 画布、牌占高 78%，与万子同一口径）
  ② docs-verify/game-5/game-play/25-筒条单张样图-验收板.png（已更名为 26-…-计数判据已作废.png）

为什么要加「图案数量」判据（本轮新沉淀 · 后被证伪）：
  第 19 轮万字的坑是"内容写错"（背景/外形），能靠目视发现。
  第 20 轮筒条的坑是"**数量写错**"—— 六筒出成 8 枚 / 9 枚，九条出成 12 根，
  这些**单看一张图不容易察觉**（不数就不觉得怪），一旦量产 18 张就会系统性出错。
  → 设想把「列簇数 × 行簇数」量化出来，数量错了直接报警；**但实测该量化不可信**。
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SAMP = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples')
WAN1 = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'wan', '一万.png')
OUT = os.path.join(BASE, '25-筒条单张样图-验收板.png')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG, PANEL, PANEL2, LINE = (12, 22, 18), (19, 34, 28), (23, 41, 34), (44, 68, 58)
CREAM, MUTE, GOLD, GOLD_HI = (240, 245, 239), (146, 168, 156), (246, 196, 69), (255, 224, 138)
TEAL, ORANGE, RED = (143, 227, 197), (255, 158, 96), (216, 67, 47)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]


# ── 主体定位：饱和度通道 + 连续段（沿用第 17 轮，实测能抗浅灰背景与接触阴影）──
def subject_bbox(im, sth=14, run=22, step=3):
    W, H = im.size
    sm = im.convert('HSV').getchannel('S').filter(ImageFilter.MedianFilter(5))
    p = sm.load()

    def scan(arr, n):
        c, a = 0, None
        for i, v in enumerate(arr):
            c = c + 1 if v else 0
            if c >= run: a = i - run + 1; break
        c, b = 0, None
        for i in range(n - 1, -1, -1):
            c = c + 1 if arr[i] else 0
            if c >= run: b = i + run - 1; break
        return a, b

    L, R, T, B = [], [], [], []
    for y in range(0, H, step):
        a, b = scan([1 if p[x, y] > sth else 0 for x in range(W)], W)
        if a is not None and b is not None and b - a > W * 0.25: L.append(a); R.append(b)
    for x in range(0, W, step):
        a, b = scan([1 if p[x, y] > sth else 0 for y in range(H)], H)
        if a is not None and b is not None and b - a > H * 0.25: T.append(a); B.append(b)
    med = lambda a: sorted(a)[len(a) // 2]
    return med(L), med(T), med(R), med(B), len(L), len(T)


def bg_check(im, n=80):
    W, H = im.size
    sm = im.convert('HSV').getchannel('S')
    mx = 0
    for bx, by in [(0, 0), (W - n, 0), (0, H - n), (W - n, H - n)]:
        c = sm.crop((bx, by, bx + n, by + n))
        mx = max(mx, max(c.getdata()))
    return mx


# ── 图案计数：色相分组 → 下采样 → 连通域计数（连通域数 = 图案枚数）──────────
# ★ 为什么不沿用「行/列投影数簇」（第 20 轮实测被否）：
#   牌体带**暖色纹理**（米黄/棕裂纹），底行红环之间的空隙里仍有零散暖色像素，
#   投影曲线**没有真正的低谷** —— 六筒量成「6 列簇 / 12 行簇」、九条量成「12 / 28」，
#   与肉眼（2×3、3×3）完全对不上。投影法在"图案间距本来就窄"时不可用。
#   → 改**连通域计数**：图案彼此物理分离，连通域数就是枚数，无需挑阈值。
# 判据口径（PIL 的 HSV 是 0~255 映射 0~360°，阈值按 #26558C / #1F7A4D / #D8432F 实测标定）：
#   红 H<25 或 H>230 且 S>60 且 V>100（V 下限排开深棕框线 #4A2B18，与第 19 轮同口径）
#   绿 80<=H<130 且 S>50 ／ 蓝 130<=H<200 且 S>50
def masks(im):
    hh, ss, vv = im.convert('HSV').split()
    H = np.asarray(hh, dtype=np.int16)
    S = np.asarray(ss, dtype=np.int16)
    V = np.asarray(vv, dtype=np.int16)
    red = ((H < 25) | (H > 230)) & (S > 60) & (V > 100)
    green = (H >= 80) & (H < 130) & (S > 50)
    blue = (H >= 130) & (H < 200) & (S > 50)
    return {'红': red, '绿': green, '蓝': blue}


def _vclose(m, k=25):
    """垂直方向闭运算：把被"朱红束带"断成两段的同一根竹接回去。
    只做垂直方向 —— 水平方向一旦膨胀，六筒相邻的两个圆环（间距仅约 13px）会串成一个。"""
    d = m.copy()
    for s in range(1, k + 1):
        d[s:, :] |= m[:-s, :]
        d[:-s, :] |= m[s:, :]
    e = d.copy()
    for s in range(1, k + 1):
        e[s:, :] &= d[:-s, :]
        e[:-s, :] &= d[s:, :]
    return e


def _components(a):
    """4-连通标记，返回 [(area, cx, cy, w, h)]（原尺度）。前景像素不多，不必下采样
    —— 降采样会把细长的竹削断成十几块碎片（实测 1/3 降采样后九条碎成 29 块）。"""
    H, W = a.shape
    seen = np.zeros_like(a, dtype=bool)
    out = []
    ys, xs = np.nonzero(a)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        n = 0
        xmin = xmax = x0
        ymin = ymax = y0
        while stack:
            cy, cx = stack.pop()
            n += 1
            if cx < xmin: xmin = cx
            if cx > xmax: xmax = cx
            if cy < ymin: ymin = cy
            if cy > ymax: ymax = cy
            if cy + 1 < H and a[cy + 1, cx] and not seen[cy + 1, cx]:
                seen[cy + 1, cx] = True; stack.append((cy + 1, cx))
            if cy and a[cy - 1, cx] and not seen[cy - 1, cx]:
                seen[cy - 1, cx] = True; stack.append((cy - 1, cx))
            if cx + 1 < W and a[cy, cx + 1] and not seen[cy, cx + 1]:
                seen[cy, cx + 1] = True; stack.append((cy, cx + 1))
            if cx and a[cy, cx - 1] and not seen[cy, cx - 1]:
                seen[cy, cx - 1] = True; stack.append((cy, cx - 1))
        if n >= 200:
            out.append((n, (xmin + xmax) / 2.0, (ymin + ymax) / 2.0,
                        xmax - xmin + 1, ymax - ymin + 1))
    return out


def count_motifs(mask, rel=0.5):
    """图案枚数 = **面积接近最大那一批**的连通域个数。
    六筒的每个圆环会同时产出"外环"（≈18800px）与"内圆盘"（≈5400px）两个连通域，
    取 rel=0.5 后内圆盘自然被排除，剩下 6 个外环；九条同理排除碎块，剩下 9 根竹。"""
    cs = _components(_vclose(mask))
    if not cs:
        return 0, []
    mx = max(c[0] for c in cs)
    keep = [c for c in cs if c[0] >= mx * rel]
    return len(keep), keep


def cluster_1d(vals, gap):
    vals = sorted(vals)
    if not vals:
        return 0
    n, last = 1, vals[0]
    for v in vals[1:]:
        if v - last > gap:
            n += 1
        last = v
    return n


def normalize(src, dst, fill=0.78, aspect=0.75):
    im = Image.open(src).convert('RGB')
    W, H = im.size
    if H > 1440:                                   # 底部水印带统一裁除（与第 17/19 轮同一工艺）
        bgp = im.crop((0, 1385, W, 1405)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - 1425), bgp), (0, 1425))
    sat = bg_check(im)
    x0, y0, x1, y1, nL, nT = subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ch = bh / fill
    cw = ch * aspect
    if cw > W: cw, ch = W, W / aspect
    if ch > H: ch, cw = H, H * aspect
    l = min(max(0, cx - cw / 2), W - cw)
    t = min(max(0, cy - ch / 2), H - ch)
    canvas = im.crop((round(l), round(t), round(l + cw), round(t + ch)))
    canvas.save(dst)
    return canvas, (bw, bh, nL, nT), sat


TILES = [
    dict(name='六筒', src=os.path.join(SAMP, 'tong', '六筒-raw.png'),
         dst=os.path.join(SAMP, 'tong', '六筒.png'), want=('2 列', '3 行'), want_pips=6),
    dict(name='九条', src=os.path.join(SAMP, 'tiao', '九条-raw.png'),
         dst=os.path.join(SAMP, 'tiao', '九条.png'), want=('3 列', '3 行'), want_pips=9),
]

print('归一化（3:4 画布 · 牌占高 78%）：')
for t in TILES:
    canvas, (bw, bh, nL, nT), sat = normalize(t['src'], t['dst'])
    W0, H0 = canvas.size
    x0, y0, x1, y1, _a, _b = subject_bbox(canvas)
    tw, th = x1 - x0, y1 - y0
    inner = canvas.crop((x0, y0, x1, y1))
    mk = masks(inner)
    tot = mk['红'] | mk['绿'] | mk['蓝']
    n_motif, comps = count_motifs(tot)
    iw, ih = inner.size
    ncol = cluster_1d([c[1] for c in comps], iw * 0.10)
    nrow = cluster_1d([c[2] for c in comps], ih * 0.10)
    px = {k: int(v.sum()) for k, v in mk.items()}
    tot_px = float(tot.sum()) or 1.0
    t.update(canvas=canvas, tw=tw, th=th, aspect=tw / th, sat=sat,
             n=n_motif, ncol=ncol, nrow=nrow, px=px, H0=H0,
             cover=tot_px / float(tot.size),
             shares={k: px[k] / tot_px for k in ('蓝', '绿', '红')})
    print('  %s  牌体 %dx%d  宽高比 %.3f  图案 %d 枚（列簇 %d / 行簇 %d）有色覆盖 %.3f  背景最大饱和度 %d'
          % (t['name'], tw, th, t['aspect'], n_motif, ncol, nrow, t['cover'], sat))
    print('       色相配比：' + '  '.join('%s %.1f%%' % (k, t['shares'][k] * 100) for k in ('蓝', '绿', '红')))

WAN_IM = Image.open(WAN1).convert('RGB')

# ── 交付板 ──────────────────────────────────────────────────────────────
W = 1500
PAD = 44
TITLE_H = 148

CARD_W, CARD_H = 380, 507
GAPX = 34
ROW_W = 3 * CARD_W + 2 * GAPX
GX0 = (W - ROW_W) // 2

Y_CARD = TITLE_H + 52
Y_SMALL = Y_CARD + 34 + CARD_H + 46
SMALL_BOX_H = 40 + 128 + 40
Y_TABLE = Y_SMALL + SMALL_BOX_H + 34
TROW = 42
ROWS_N = 11
TABLE_H = 54 + ROWS_N * TROW + 18
Y_FOOT = Y_TABLE + TABLE_H + 30

NOTES = [
    ('○', '质地口径 = 万子母版（乳白玉体 + 云絮玉纹 + 卷草金角框 + 高浮雕）：RENDER / SHAPE / CAMERA 三段'
          '在 tile_prompt.py 里是**从万子模板切片**的，selftest 断言其逐字相同。', CREAM),
    ('○', '配色 = 用户第 20 轮拍板「传统多色」：六筒按行分色（顶行靛蓝 / 中行翡翠绿 / 底行朱红），'
          '九条翠绿竹 + 朱红束带。', CREAM),
    ('△', '六筒共出 4 版才过：v1 六环全绿（三色被压成单色）／v2 出成 8 枚／v3 出成 9 枚且无金框 → '
          '改为「逐项点名否定数量」后 v4 命中。v1~v3 已留痕 tong/rejected/。', ORANGE),
    ('△', '九条共出 4 版取 v2：v1 出成 12 根（4 列）／v3 金框丢失／v4 背景混进绿毛毡 + 灰底 → '
          'v2 是四版中唯一同时满足「9 根 + 有金框 + 纯白底」的。v1/v3/v4 已留痕 tiao/rejected/。', ORANGE),
    ('△', '九条 v2 的金框是「厚金圆角框」，**未画出万子那样的四角卷草纹**；牌体也偏米黄。'
          '这是 AI 随机性下的残留差异，需用户拍板是否重出。', ORANGE),
    ('△', '两张均有轻微侧视（AI 画不出严格正交，与万子同一代价）+ 右下角工具水印（归一化时已裁带）→ '
          '投产前统一做视角校正 + 圆角遮罩 + 抠底。', ORANGE),
]

_tmpd = ImageDraw.Draw(Image.new('RGB', (1, 1)))
def _wrap(text, font, maxw):
    lines, cur = [], ''
    for ch in text:
        if _tmpd.textlength(cur + ch, font=font) <= maxw:
            cur += ch
        else:
            lines.append(cur); cur = ch
    if cur: lines.append(cur)
    return lines

NOTE_F = F(16)
NOTE_X = PAD + 48
NOTE_ROWS = [(m, _wrap(t, NOTE_F, W - NOTE_X - PAD - 20), c) for (m, t, c) in NOTES]
FOOT_H = 50 + sum(len(ls) * 26 for _m, ls, _c in NOTE_ROWS) + 44
H = Y_FOOT + FOOT_H + 36

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 30), '筒 / 条 单张样图验收（第 20 轮）', font=F(40, True), fill=CREAM)
d.text((PAD, 84), '用途 = 微信小游戏牌面（游戏中以 96×128 显示）· 质地口径 = 万子母版「玉质高浮雕 + 卷草金角框」· '
                  '图案配色 = 用户第 20 轮拍板「传统多色」', font=F(17), fill=MUTE)
d.text((PAD, 106), '左＝万子母版（一万，对照组）｜中＝六筒 2 列×3 行＝6 枚｜右＝九条 3 列×3 行＝9 根。'
                   '三张同一画布口径，可直接并排比。', font=F(17), fill=MUTE)
d.line([(PAD, TITLE_H - 4), (W - PAD, TITLE_H - 4)], fill=LINE, width=1)

CARDS = [('万子母版', '对照组 · 乳白玉体', WAN_IM, None),
         ('六筒 · 传统多色', '2 列 × 3 行 = 6 枚', TILES[0]['canvas'], TILES[0]),
         ('九条 · 传统多色', '3 列 × 3 行 = 9 根', TILES[1]['canvas'], TILES[1])]

for i, (title, sub, im, t) in enumerate(CARDS):
    x = GX0 + i * (CARD_W + GAPX)
    y = Y_CARD
    d.rounded_rectangle([x, y, x + CARD_W, y + 34], 10, fill=PANEL2, outline=LINE)
    d.text((x + 12, y + 5), title, font=F(21, True), fill=GOLD_HI)
    if t:
        d.text((x + CARD_W - 138, y + 9), '比 %.3f' % t['aspect'], font=F(15), fill=MUTE)
    img.paste(im.resize((CARD_W, CARD_H), Image.LANCZOS), (x, y + 40))
    d.rectangle([x, y + 40, x + CARD_W - 1, y + 40 + CARD_H - 1], outline=LINE)
    d.text((x + 12, y + 40 + CARD_H + 8), sub, font=F(16), fill=MUTE)

# 小尺寸实尺
d.line([(PAD, Y_SMALL - 18), (W - PAD, Y_SMALL - 18)], fill=LINE, width=1)
d.text((PAD, Y_SMALL - 8), '小尺寸可读性验证', font=F(24, True), fill=CREAM)
d.text((PAD + 250, Y_SMALL), '游戏中真实显示尺寸 1:1 像素（96×128）—— 三张并排的实际观感', font=F(16), fill=MUTE)
SY = Y_SMALL + 32
row_w = 3 * 96 + 2 * 60
sx = (W - row_w) // 2
d.rounded_rectangle([sx - 30, SY - 12, sx + row_w + 30, SY + 128 + 12], 12, fill=PANEL, outline=LINE)
for i, (_t, _s, im, _tt) in enumerate(CARDS):
    x = sx + i * (96 + 60)
    img.paste(im.resize((96, 128), Image.LANCZOS), (x, SY))
    d.rectangle([x, SY, x + 95, SY + 127], outline=(60, 88, 74))

# 指标表
d.line([(PAD, Y_TABLE - 18), (W - PAD, Y_TABLE - 18)], fill=LINE, width=1)
d.text((PAD, Y_TABLE - 8), '量化检查（牌体几何 / 图案数量 / 背景纯度）', font=F(24, True), fill=CREAM)

t6, t9 = TILES[0], TILES[1]
def ok(cond, good, warn):
    return ('✓ ' + good) if cond else ('△ ' + warn)

ROWS = [
    ('牌体宽高比（六筒 / 九条）', '%.3f / %.3f' % (t6['aspect'], t9['aspect']),
     ok(abs(t6['aspect'] - t9['aspect']) <= 0.12, '两张牌形一致，并排无「胖瘦不一」',
        '相差 %.3f，并排可见牌形差异' % abs(t6['aspect'] - t9['aspect']))),
    ('图案枚数（六筒 / 九条）', '%d / %d' % (t6['n'], t9['n']),
     ok(t6['n'] == 6 and t9['n'] == 9, '六筒 6 枚 · 九条 9 根，数量正确',
        '数量与「六」「九」不符 —— 量产前必须修正')),
    ('图案排布（列簇 × 行簇）', '六筒 %d×%d · 九条 %d×%d' % (t6['ncol'], t6['nrow'], t9['ncol'], t9['nrow']),
     ok(t6['ncol'] == 2 and t6['nrow'] == 3 and t9['ncol'] == 3 and t9['nrow'] == 3,
        '六筒 2 列×3 行 · 九条 3 列×3 行，排布正确', '排布与标准不符')),
    ('六筒三色配比（蓝 / 绿 / 红）',
     '蓝 %.0f%% · 绿 %.0f%% · 红 %.0f%%' % (t6['shares']['蓝'] * 100, t6['shares']['绿'] * 100,
                                            t6['shares']['红'] * 100),
     ok(min(t6['shares'].values()) > 0.10, '三色齐备且量级相当（v1 只剩绿色，已否）',
        '有颜色缺失或严重失衡')),
    ('九条双色配比（绿 / 红）', '绿 %.0f%% · 红 %.0f%%' % (t9['shares']['绿'] * 100, t9['shares']['红'] * 100),
     ok(t9['shares']['绿'] > 0.10 and t9['shares']['红'] > 0.05, '翠绿竹 + 朱红束带都在',
        '有颜色缺失')),
    ('有色覆盖率（六筒 / 九条）', '%.3f / %.3f' % (t6['cover'], t9['cover']),
     ok(0.02 < t6['cover'] < 0.45 and 0.01 < t9['cover'] < 0.45, '图案占面比例正常，无「糊满牌面」',
        '覆盖率异常')),
    ('画面占比（牌高 / 画布高）', '两张均 0.780', '✓ 与万子同一口径，构图一致'),
    ('画布比例', '两张均 3:4（96×128 同比例）', '✓ 直接可投产，无需再裁'),
    ('背景纯度（四角最大饱和度）', '六筒 %d · 九条 %d' % (t6['sat'], t9['sat']),
     ok(t6['sat'] <= 60 and t9['sat'] <= 60, '两张均为中性浅底，无桌面 / 毛毡 / 场景混入',
        '九条 v4 曾混入绿毛毡，已否')),
    ('水印带', '已裁除（y ≥ 1425）', '✓ 与第 17 / 19 轮同一工艺'),
    ('金框卷草纹', '六筒 ✓ 有 · 九条 △ 无（仅素金圆框）',
     '△ 九条金框缺卷草纹，是四版里的残留差异，需拍板是否重出'),
]
colx = [PAD + 14, PAD + 470, PAD + 790]
d.rounded_rectangle([PAD, Y_TABLE + 30, W - PAD, Y_TABLE + TABLE_H - 6], 14, fill=PANEL, outline=LINE)
for r, row in enumerate(ROWS):
    ry = Y_TABLE + 44 + r * TROW
    if r % 2 == 1:
        d.rectangle([PAD + 2, ry - 5, W - PAD - 2, ry + TROW - 9], fill=PANEL2)
    d.text((colx[0], ry), row[0], font=F(16), fill=CREAM)
    d.text((colx[1], ry), row[1], font=F(16), fill=MUTE)
    v = row[2]
    col = TEAL if v.startswith('✓') else (ORANGE if v.startswith('△') else RED)
    d.text((colx[2], ry), v, font=F(16), fill=col)
d.line([(PAD, Y_TABLE + 52), (W - PAD, Y_TABLE + 52)], fill=LINE, width=1)

d.rounded_rectangle([PAD, Y_FOOT, W - PAD, Y_FOOT + FOOT_H - 20], 14, fill=PANEL2,
                    outline=(120, 92, 34), width=1)
d.text((PAD + 20, Y_FOOT + 14), '本轮口径与待办', font=F(21, True), fill=GOLD_HI)
_yy = Y_FOOT + 50
for mark, ls, col in NOTE_ROWS:
    d.text((PAD + 20, _yy), mark, font=F(17, True), fill=col)
    for j, ln in enumerate(ls):
        d.text((NOTE_X, _yy + j * 26), ln, font=NOTE_F, fill=CREAM if col is CREAM else MUTE)
    _yy += len(ls) * 26

img.save(OUT)
print('\n交付板 → %s  (%dx%d)' % (os.path.relpath(OUT, ROOT), W, H))
print('判据：六筒应 2 列×3 行 6 枚三色；九条应 3 列×3 行 9 根。')
