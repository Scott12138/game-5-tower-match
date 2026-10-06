#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一万 · 三风格样板对比交付板（第 17 轮）

输入：assets/_src/game-play/tile-samples/style/*-raw.png（AI 原始出图 1024×1536）
输出：
  ① 归一化牌面 style/一万-{A|B|C}-*.png  —— 统一裁到 3:4 画布、牌占高 78%（三张可比）
  ② docs-verify/game-5/game-play/22-一万三风格样板对比.png

判据来源：全部数值由 /tmp/probe_sat.py 实测（饱和度通道 + 连续段），不写死坐标。
"""
import os, statistics
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))                      # docs-verify/game-5/game-play
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', 'style')
OUT  = os.path.join(BASE, '22-一万三风格样板对比.png')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

# ── 与既有验收板同一套配色（保持交付物风格一致）────────────────────────
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

# ── 三方案元数据 ────────────────────────────────────────────────────────
SCHEMES = [
    dict(key='A', raw='一万-A-典藏瓷玉-raw.png', out='一万-A-典藏瓷玉.png',
         name='A · 典藏瓷玉', tag='素雅',
         one='象牙瓷面 · 哑光釉 · 淡金厚边 · 朱红字',
         mats='底：象牙瓷 #FDFAF0　字：朱红 #D8432F',
         note='最贴近传统麻将配色，与现有象牙系牌面基调同源'),
    dict(key='B', raw='一万-B-鎏金浮雕-raw.png', out='一万-B-鎏金浮雕.png',
         name='B · 鎏金浮雕', tag='奢华',
         one='暖骨底 · 全鎏金高浮雕字 · 卷草纹金框',
         mats='底：暖骨 #FFF7E6　字：鎏金 #F6C445',
         note='金属反光最强、最有"典藏"贵气；金饰与界面金线呼应'),
    dict(key='C', raw='一万-C-墨玉鎏金-raw.png', out='一万-C-墨玉鎏金.png',
         name='C · 墨玉鎏金', tag='同源',
         one='深墨绿玉底 · 玉纹通透 · 朱红字金线描边 · 金线内框',
         mats='底：墨玉 #20694E→#0A3327　字：朱红 #D8432F + 金边',
         note='与场景墨绿同源、暗底红字对比最强，牌堆上最"跳"'),
]


# ── 主体定位：饱和度通道 + 连续段（抗背景噪点与中性灰阴影）──────────────
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
    return med(L), med(T), med(R), med(B)


def normalize(src, dst, fill=0.78, aspect=0.75, wipe_bottom=1425):
    """裁到 aspect(=3:4) 画布，牌体占画布高 fill。返回 (画布, 实测牌体比例, bbox)"""
    im = Image.open(src).convert('RGB')
    W, H = im.size
    # 先抹掉底部可能的水印带（用邻近背景色填充，避免硬边）
    if wipe_bottom < H:
        bgp = im.crop((0, wipe_bottom - 40, W, wipe_bottom - 20)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - wipe_bottom), bgp), (0, wipe_bottom))
    x0, y0, x1, y1 = subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ch = bh / fill
    cw = ch * aspect
    # 视野必须先夹进画布（技能纪律：否则 PIL 会补黑边）
    if cw > W:
        cw, ch = W, W / aspect
    if ch > H:
        ch, cw = H, H * aspect
    l = min(max(0, cx - cw / 2), W - cw)
    t = min(max(0, cy - ch / 2), H - ch)
    box = (round(l), round(t), round(l + cw), round(t + ch))
    canvas = im.crop(box)
    canvas.save(dst)
    return canvas, bw / bh, (x0, y0, x1, y1)


# ── 生成归一化图 ────────────────────────────────────────────────────────
print('归一化（3:4 画布 · 牌占高 %.0f%%）：' % 78)
for s in SCHEMES:
    canvas, ratio, bb = normalize(os.path.join(SRC, s['raw']), os.path.join(SRC, s['out']))
    s['canvas'] = canvas
    s['ratio'] = ratio
    s['bbox'] = bb
    print('  %-12s 牌体 %dx%d  宽高比 %.3f  画布 %s' %
          (s['key'], bb[2] - bb[0], bb[3] - bb[1], ratio, canvas.size))

# ── 交付板 ──────────────────────────────────────────────────────────────
W = 1500
PAD, GAP = 50, 40
CW = (W - 2 * PAD - 2 * GAP) // 3          # 440
CH = round(CW * 4 / 3)                      # 587

TITLE_H   = 132
BIG_H     = 74 + CH + 74
SMALL_H   = 62 + 384 + 30
TABLE_ROW = 46
TABLE_N   = 10
TABLE_H   = 56 + TABLE_N * TABLE_ROW + 20
FOOT_H    = 210

Y_BIG   = TITLE_H + 24
Y_SMALL = Y_BIG + BIG_H + 34
Y_TABLE = Y_SMALL + SMALL_H + 34
Y_FOOT  = Y_TABLE + TABLE_H + 30
H = Y_FOOT + FOOT_H + 40

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 标题
d.text((PAD, 34), '一万 · 三风格样板对比', font=F(40, True), fill=CREAM)
d.text((PAD, 88), '第 17 轮 · AI 出图 · 用途 = 微信小游戏牌面（游戏中以 96×128 显示）· 三张仅「材质 / 字材」不同，结构 · 相机 · 光照 · 负向约束逐字相同',
       font=F(17), fill=MUTE)
d.line([(PAD, TITLE_H - 6), (W - PAD, TITLE_H - 6)], fill=LINE, width=1)

# 上区：三风格大图
for i, s in enumerate(SCHEMES):
    x = PAD + i * (CW + GAP)
    # 标签条（固定高，不按字形算）
    d.rounded_rectangle([x, Y_BIG, x + CW, Y_BIG + 58], 12, fill=PANEL2, outline=LINE)
    d.text((x + 16, Y_BIG + 8), s['name'], font=F(24, True), fill=GOLD_HI)
    tw = d.textlength(s['tag'], font=F(17))
    d.rounded_rectangle([x + CW - tw - 30, Y_BIG + 15, x + CW - 14, Y_BIG + 43], 8,
                        fill=(60, 40, 12), outline=(120, 92, 34))
    d.text((x + CW - tw - 22, Y_BIG + 18), s['tag'], font=F(17), fill=GOLD)
    # 主图（3:4）
    im = s['canvas'].resize((CW, CH), Image.LANCZOS)
    img.paste(im, (x, Y_BIG + 66))
    d.rectangle([x, Y_BIG + 66, x + CW - 1, Y_BIG + 66 + CH - 1], outline=LINE)
    yy = Y_BIG + 66 + CH + 10
    d.text((x, yy), s['one'], font=F(18), fill=CREAM)
    d.text((x, yy + 28), s['mats'], font=F(16), fill=MUTE)

# 中区：小尺寸可读性
d.line([(PAD, Y_SMALL - 18), (W - PAD, Y_SMALL - 18)], fill=LINE, width=1)
d.text((PAD, Y_SMALL - 6), '小尺寸可读性验证', font=F(24, True), fill=CREAM)
d.text((PAD + 230, Y_SMALL + 2), '左 = 游戏中真实显示尺寸 96×128（1:1 像素）　右 = 3× 放大观感',
       font=F(16), fill=MUTE)
SY = Y_SMALL + 44
for i, s in enumerate(SCHEMES):
    x = PAD + i * (CW + GAP)
    d.rounded_rectangle([x, SY, x + CW, SY + 384], 12, fill=PANEL, outline=LINE)
    t = s['canvas']
    real = t.resize((96, 128), Image.LANCZOS)
    big = t.resize((288, 384), Image.LANCZOS)
    img.paste(real, (x + 34, SY + 128))
    img.paste(big, (x + 150, SY))
    d.rectangle([x + 150, SY, x + 150 + 287, SY + 383], outline=LINE)
    d.text((x + 14, SY + 300), '96×128', font=F(19, True), fill=GOLD_HI)
    d.text((x + 14, SY + 326), '1:1 实尺', font=F(15), fill=MUTE)
    d.text((x + 150 + 8, SY + 8), '3×', font=F(15), fill=(0, 0, 0))
    d.rectangle([x + 150 + 2, SY + 2, x + 150 + 40, SY + 28], fill=(246, 196, 69))
    d.text((x + 150 + 9, SY + 4), '3×', font=F(17, True), fill=(50, 33, 8))

# 下区：用途符合性检查表
d.line([(PAD, Y_TABLE - 18), (W - PAD, Y_TABLE - 18)], fill=LINE, width=1)
d.text((PAD, Y_TABLE - 6), '用途符合性对比（逐项清单）', font=F(24, True), fill=CREAM)

ROWS = [
    ('比例 3:4（与 96×128 一致）', '✓ 已统一裁切到 3:4', '✓ 已统一裁切到 3:4', '✓ 已统一裁切到 3:4'),
    ('正视 90° 无透视', '△ 轻微侧视（见右厚边）', '△ 轻微侧视', '△ 轻微侧视'),
    ('底色 / 字色 合设计口径', '✓ 象牙底 + 朱红字', '✓ 暖骨底 + 鎏金字', '✓ 墨玉底 + 红字金边'),
    ('厚边 / 描边存在', '✓ 淡金厚边 + 棕细线', '✓ 卷草纹华丽金框', '✓ 金线内框'),
    ('与「墨绿典藏」界面协调', '✓✓ 与象牙牌面同基调', '✓ 金饰与界面金线呼应', '✓✓ 与场景绿同源'),
    ('单牌居中 / 构图占比一致', '✓ 已归一到 78%', '✓ 已归一到 78%', '✓ 已归一到 78%'),
    ('质感（细腻 / 立体 / 光影）', '✓✓ 釉面高光自然', '✓✓ 浮雕厚度真实', '✓✓ 玉纹通透有内光'),
    ('小尺寸下字可辨', '✓ 见上区左侧', '✓ 见上区左侧', '✓✓ 对比最强'),
    ('背景可抠（纯色）', '△ 浅灰渐变 + 接触阴影', '△ 浅灰渐变 + 接触阴影', '△ 浅灰渐变 + 接触阴影'),
    ('无杂字 / 无工具水印', '✓ 水印带已裁除', '✓ 无', '✓ 无'),
]
colx = [PAD, PAD + 300, PAD + 690, PAD + 1080]
d.rounded_rectangle([PAD, Y_TABLE + 34, W - PAD, Y_TABLE + TABLE_H - 6], 14, fill=PANEL, outline=LINE)
for r, row in enumerate(ROWS):
    ry = Y_TABLE + 48 + r * TABLE_ROW
    if r % 2 == 1:
        d.rectangle([PAD + 2, ry - 5, W - PAD - 2, ry + TABLE_ROW - 9], fill=PANEL2)
    d.text((colx[0] + 14, ry), row[0], font=F(16), fill=CREAM)
    for c in range(3):
        v = row[c + 1]
        col = TEAL if v.startswith('✓') else (ORANGE if v.startswith('△') else RED)
        d.text((colx[c + 1], ry), v, font=F(16), fill=col)
d.line([(PAD, Y_TABLE + 56), (W - PAD, Y_TABLE + 56)], fill=LINE, width=1)

# 底部：代价与拍板
d.rounded_rectangle([PAD, Y_FOOT, W - PAD, Y_FOOT + FOOT_H - 20], 14, fill=PANEL2,
                    outline=(120, 92, 34), width=1)
d.text((PAD + 20, Y_FOOT + 14), '已知代价（选定风格后再处理，不影响本轮风格判断）', font=F(21, True), fill=GOLD_HI)
CONS = [
    '△ 三张均带轻微侧视：AI 文生图画不出严格正交，但 96×128 下几乎看不出；定稿时可做一次视角校正或直接接受。',
    '△ 背景为浅灰渐变 + 接触阴影，非纯白：投产前需按饱和度通道抠底（与本脚本同一套判据）。',
    '△ 尺寸：AI 原始 1024×1536。27 张全量若走 AI，384×512 PNG ≈ 6.2 MB（超主包上限），需降规格或压 WebP。',
    '○ 本轮只出「一万」3 张样板用于选风格；风格拍板前不批量出图（资产处理原则）。',
]
for i, t in enumerate(CONS):
    d.text((PAD + 20, Y_FOOT + 50 + i * 32), t, font=F(16), fill=CREAM if i == 3 else MUTE)

img.save(OUT)
print('\n交付板 → %s  (%dx%d)' % (os.path.relpath(OUT, ROOT), W, H))
