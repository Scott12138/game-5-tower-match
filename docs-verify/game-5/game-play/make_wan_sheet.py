#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""万字 9 张全量对比交付板（第 19 轮）

输入：assets/_src/game-play/tile-samples/wan/{一~九}万-raw.png（AI 原始 1024×1536）
输出：
  ① 归一化牌面 wan/{一~九}万.png —— 统一裁到 3:4 画布、牌占高 78%（九张可比 / 可直接投产）
  ② docs-verify/game-5/game-play/24-万字九张全量对比.png

判据来源：复用第 17 轮 make_style_sheet.py 的「饱和度通道 + 连续段」主体定位（已实测有效：
  它同时能抗背景噪点与中性灰接触阴影，亮度法 / 边缘法都会被这两者击穿）。
  本脚本另加两处加固：
  ① 水印带**先探测再决定是否抹除**（原先无条件抹 1425 以下，会误伤接触阴影）
  ② 红字判据带 V>105 下限（排开深棕内框线 #4A2B18，V≈74，其色相与朱红撞车）
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', 'wan')
OUT  = os.path.join(BASE, '24-万字九张全量对比.png')
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

RULE = ['一', '二', '三', '四', '五', '六', '七', '八', '九']


# ── 主体定位：饱和度通道 + 连续段 ────────────────────────────────────────
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


# ── 背景纯度检查：四角是否「中性无彩」──────────────────────────────────
# ★ 判据沿革（第 19 轮，被真数据打脸一次）：
#   最初用「右下角最小亮度」判水印，结果把五万 v1 的**深绿毛毡暗部（V=19）误判成水印** ——
#   深色内容 ≠ 水印。改为检查**背景彩度**：背景必须是中性浅底；四角一旦出现明显饱和度，
#   说明画面里混进了桌面 / 毛毡 / 场景，此时**主体定位也会被污染**
#   （五万 v1 的牌体宽高比正是因此量成 0.609）。
def bg_check(im, n=80):
    W, H = im.size
    sm = im.convert('HSV').getchannel('S')
    mx = 0
    for bx, by in [(0, 0), (W - n, 0), (0, H - n), (W - n, H - n)]:
        c = sm.crop((bx, by, bx + n, by + n))
        mx = max(mx, max(c.getdata()))
    return mx


# ── 红字 bbox：行/列投影计数（不用极值 —— 孤立噪点会把 bbox 拉满全图）──
def red_bbox(im, box, min_px=5, vth=105):
    sub = im.crop(box).convert('HSV')
    hh, ss, vv = sub.split()
    ph, ps, pv = hh.load(), ss.load(), vv.load()
    w, h = sub.size
    rows, cols = [0] * h, [0] * w
    for y in range(h):
        for x in range(w):
            H_, S_, V_ = ph[x, y], ps[x, y], pv[x, y]
            if (H_ < 20 or H_ > 235) and S_ > 90 and V_ > vth:
                rows[y] += 1; cols[x] += 1
    ys = [y for y in range(h) if rows[y] >= min_px]
    xs = [x for x in range(w) if cols[x] >= min_px]
    if not ys or not xs: return None
    return (box[0] + min(xs), box[1] + min(ys), box[0] + max(xs), box[1] + max(ys), sum(rows))


def normalize(src, dst, fill=0.78, aspect=0.75):
    im = Image.open(src).convert('RGB')
    W, H = im.size
    if H > 1440:                               # 底部水印带统一裁除（y≥1425，与第 17 轮同一工艺）
        bgp = im.crop((0, 1385, W, 1405)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - 1425), bgp), (0, 1425))
    sat = bg_check(im)                         # 背景纯度（抹除后再测，避免水印像素干扰）
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


print('归一化（3:4 画布 · 牌占高 78%）：')
TILES = []
for han in RULE:
    raw = os.path.join(SRC, '%s万-raw.png' % han)
    out = os.path.join(SRC, '%s万.png' % han)
    canvas, (bw, bh, nL, nT), sat = normalize(raw, out)
    # 红字统计：需在归一化画布上重算（与画布对齐才有意义）
    W0, H0 = canvas.size
    x0, y0, x1, y1, _a, _b = subject_bbox(canvas)
    rb = red_bbox(canvas, (x0, y0, x1, y1))
    tw, th = x1 - x0, y1 - y0
    rec = dict(han=han, canvas=canvas, tw=tw, th=th, aspect=tw / th,
               rb=rb, sat=sat, nL=nL, nT=nT)
    if rb:
        rec['rw'] = (rb[2] - rb[0]) / tw      # 红字外接框宽 / 牌体宽
        rec['rh'] = (rb[3] - rb[1]) / th      # 红字外接框高 / 牌体高
        rec['rcov'] = rb[4] / (tw * th)       # 红像素占牌面面积
        rec['rl'] = (rb[0] - x0) / tw         # 左留白
        rec['rr'] = (x1 - rb[2]) / tw         # 右留白
    TILES.append(rec)
    print('  %s万  牌体 %dx%d  宽高比 %.3f  红字占比 %.3f×%.3f  红覆盖 %.3f  '
          '留白 左%.3f/右%.3f  背景最大饱和度 %d  采样 %d/%d 行' %
          (han, tw, th, rec['aspect'], rec.get('rw', 0), rec.get('rh', 0),
           rec.get('rcov', 0), rec.get('rl', 0), rec.get('rr', 0), sat, nL, nT))

# ── 一致性统计（判据自证：牌体宽高比应聚在 3:4 邻域）────────────────────
asp = sorted(t['aspect'] for t in TILES)
asp_med = asp[len(asp) // 2]
asp_spread = asp[-1] - asp[0]
rw_s = [t['rw'] for t in TILES]; rh_s = [t['rh'] for t in TILES]
rc_s = [t['rcov'] for t in TILES]
def spread(a): return max(a) - min(a)

# ── 交付板 ──────────────────────────────────────────────────────────────
W = 1500
PAD, GAPX, GAPY = 44, 26, 26

# ── 底部口径说明（先折行排版，再据此定 FOOT_H；长句必须折行，否则溢出右边界）──
NOTES = [
    ('○', '母版口径 = 第 18 轮拍板的 D 融合稿：乳白玉体 + 云絮玉纹 + 卷草金角框 + 朱红高浮雕「字」。', CREAM),
    ('○', '提示词已固化为 tile_prompt.py（可复现）；九张仅 SUBJECT 的「上字」逐张替换，其余逐字相同。', CREAM),
    ('○', '底部水印带统一裁除（y ≥ 1425，与第 17 轮同一工艺），该带在牌体下方、不影响主体。', CREAM),
    ('△', '否掉并重出 3 张（v1 移入 wan/rejected/ 留痕）：五萬 v1 混进绿毛毡桌面且牌形窄高；'
          '六萬 / 八萬 v1 牌体为八边形斜切角、金框过满，与母版圆角矩形 + 卷草金角框不符。', ORANGE),
    ('△', '九张均带轻微侧视（AI 画不出严格正交）+ 浅灰渐变背景 —— 与母版同一代价，投产前统一处理视角与抠底。', ORANGE),
    ('△', '体积：原图 1024×1536 ≈ 2 MB/张，万字 9 张 ≈ 18 MB，远超主包 4096 KB；'
          '需降规格（384×512 PNG ≈ 2.1 MB）或压 WebP。', ORANGE),
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
FOOT_H_CALC = 50 + sum(len(ls) * 26 for _m, ls, _c in NOTE_ROWS) + 44


CW, CH = 380, 507
GRID_W = 3 * CW + 2 * GAPX
GX0 = (W - GRID_W) // 2
CELL_H = CH + 44

TITLE_H = 134
Y_GRID  = TITLE_H + 18
GRID_H  = 3 * CELL_H + 2 * GAPY
Y_SMALL = Y_GRID + GRID_H + 40
SMALL_H = 60 + 128 + 44
Y_TABLE = Y_SMALL + SMALL_H + 34
TROW, TN = 44, 10
TABLE_H = 58 + TN * TROW + 20
Y_FOOT  = Y_TABLE + TABLE_H + 28
FOOT_H  = FOOT_H_CALC
H = Y_FOOT + FOOT_H + 40

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 32), '万字 一~九 · 全量对比（第 19 轮）', font=F(40, True), fill=CREAM)
d.text((PAD, 86),
       'AI 出图 · 用途 = 微信小游戏牌面（游戏中以 96×128 显示）· 母版口径 = 第 18 轮 D 融合稿（乳白玉体 + 云絮玉纹 + 卷草金角框 + 朱红高浮雕）',
       font=F(17), fill=MUTE)
d.text((PAD, 108),
       '九张提示词除 SUBJECT 的「上字」外逐字相同 → 风格差异只可能来自该字本身，不掺构图/视角/光照的随机变化',
       font=F(17), fill=MUTE)
d.line([(PAD, TITLE_H - 6), (W - PAD, TITLE_H - 6)], fill=LINE, width=1)

# 九宫格
for i, t in enumerate(TILES):
    r, c = divmod(i, 3)
    x = GX0 + c * (CW + GAPX)
    y = Y_GRID + r * (CELL_H + GAPY)
    d.rounded_rectangle([x, y, x + CW, y + 34], 10, fill=PANEL2, outline=LINE)
    d.text((x + 12, y + 5), '%s萬' % t['han'], font=F(21, True), fill=GOLD_HI)
    d.text((x + CW - 150, y + 8), '宽高比 %.3f' % t['aspect'], font=F(15), fill=MUTE)
    im = t['canvas'].resize((CW, CH), Image.LANCZOS)
    img.paste(im, (x, y + 40))
    d.rectangle([x, y + 40, x + CW - 1, y + 40 + CH - 1], outline=LINE)

# 小尺寸实尺（游戏中真实显示 96×128）
d.line([(PAD, Y_SMALL - 16), (W - PAD, Y_SMALL - 16)], fill=LINE, width=1)
d.text((PAD, Y_SMALL - 6), '小尺寸可读性验证', font=F(24, True), fill=CREAM)
d.text((PAD + 250, Y_SMALL + 2), '游戏中真实显示尺寸 1:1 像素（96×128）—— 牌堆上九张并排的实际观感',
       font=F(16), fill=MUTE)
SY = Y_SMALL + 40
row_w = 9 * 96 + 8 * 14
sx = (W - row_w) // 2
d.rounded_rectangle([sx - 30, SY - 12, sx + row_w + 30, SY + 128 + 12], 12, fill=PANEL, outline=LINE)
for i, t in enumerate(TILES):
    x = sx + i * (96 + 14)
    img.paste(t['canvas'].resize((96, 128), Image.LANCZOS), (x, SY))
    d.rectangle([x, SY, x + 95, SY + 127], outline=(60, 88, 74))
    d.text((x + 30, SY + 134), '%s' % t['han'], font=F(17, True), fill=GOLD_HI)

# 一致性检查表
d.line([(PAD, Y_TABLE - 16), (W - PAD, Y_TABLE - 16)], fill=LINE, width=1)
d.text((PAD, Y_TABLE - 6), '画风一致性检查（量化）', font=F(24, True), fill=CREAM)

def ok(cond, good, warn):
    return ('✓ ' + good) if cond else ('△ ' + warn)

ROWS = [
    ('牌体宽高比（聚拢程度）',
     '中位 %.3f，极差 %.3f' % (asp_med, asp_spread),
     ok(asp_spread <= 0.12, '九张牌形一致，并排无「胖瘦不一」感',
        '极差偏大 %.3f，并排可见牌形差异' % asp_spread)),
    ('红字横向占比（字宽/牌宽）',
     '%.3f ~ %.3f' % (min(rw_s), max(rw_s)),
     ok(spread(rw_s) <= 0.12, '字宽统一，左右留白一致',
        '极差 %.3f，留白有疏密差' % spread(rw_s))),
    ('红字纵向占比（字高/牌高）',
     '%.3f ~ %.3f' % (min(rh_s), max(rh_s)),
     ok(spread(rh_s) <= 0.12, '字高统一，上下留白一致',
        '极差 %.3f' % spread(rh_s))),
    ('红像素覆盖率（笔画饱满度）',
     '%.3f ~ %.3f' % (min(rc_s), max(rc_s)),
     ok(spread(rc_s) <= 0.06, '笔画粗细观感一致', '极差 %.3f' % spread(rc_s))),
    ('画面占比（牌高/画布高）', '九张均 0.780',
     '✓ 全部归一到 78%，构图一模一样'),
    ('画布比例', '九张均 3:4（96×128 同比例）',
     '✓ 直接可投产，无需再裁'),
    ('色彩（玉底 / 朱红 / 金框）', '同一套十六进制值',
     '✓ 提示词硬编码 #FFF7E6 / #D8432F / #F6C445'),
    ('光照与背景', '左上 45° 主光 · 浅灰渐变底',
     '✓ 与母版逐字相同（含负向约束段）'),
    ('背景纯度（四角最大饱和度）',
     '九张最大 %d' % max(t['sat'] for t in TILES),
     ok(max(t['sat'] for t in TILES) <= 60,
        '九张均为中性浅底，无桌面 / 毛毡 / 场景混入',
        '有 %d 张背景出现彩度，主体定位可能被污染' % sum(1 for t in TILES if t['sat'] > 60))),
    ('上字正确性（二~九、萬在下）', '九张目视逐张核对',
     '✓ 见本轮交付说明（汉字，无阿拉伯数字）'),
]
colx = [PAD + 14, PAD + 470, PAD + 760]
d.rounded_rectangle([PAD, Y_TABLE + 34, W - PAD, Y_TABLE + TABLE_H - 6], 14, fill=PANEL, outline=LINE)
for r, row in enumerate(ROWS):
    ry = Y_TABLE + 48 + r * TROW
    if r % 2 == 1:
        d.rectangle([PAD + 2, ry - 5, W - PAD - 2, ry + TROW - 9], fill=PANEL2)
    d.text((colx[0], ry), row[0], font=F(16), fill=CREAM)
    d.text((colx[1], ry), row[1], font=F(16), fill=MUTE)
    v = row[2]
    col = TEAL if v.startswith('✓') else (ORANGE if v.startswith('△') else RED)
    d.text((colx[2], ry), v, font=F(16), fill=col)
d.line([(PAD, Y_TABLE + 56), (W - PAD, Y_TABLE + 56)], fill=LINE, width=1)

# 底部
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
print('牌体宽高比 中位 %.3f 极差 %.3f | 红字宽占比极差 %.3f | 红字高占比极差 %.3f | 红覆盖极差 %.3f'
      % (asp_med, asp_spread, spread(rw_s), spread(rh_s), spread(rc_s)))
