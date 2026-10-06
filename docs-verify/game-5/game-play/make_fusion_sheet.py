#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一万 · 融合稿验收板（第 18 轮）

拍板口径：取 A 的文字内容（朱红「一」「萬」）× B 的玉石质感（乳白玉体 + 卷草金角框 + 高浮雕工艺）
输入：assets/_src/game-play/tile-samples/style/*-raw.png
输出：① 归一化 style/一万-D-融合稿-玉质高浮雕朱红.png
      ② docs-verify/game-5/game-play/23-一万融合稿-验收板.png

判据来源：全部数值由 /tmp/probe_d.py 实测（饱和度通道 + 连续段 + 行/列投影计数），不写死坐标。
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))                      # docs-verify/game-5/game-play
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', 'style')
OUT  = os.path.join(BASE, '23-一万融合稿-验收板.png')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

# ── 与既有验收板同一套配色 ──────────────────────────────────────────────
BG, PANEL, PANEL2, LINE = (12, 22, 18), (19, 34, 28), (23, 41, 34), (44, 68, 58)
CREAM, MUTE, GOLD, GOLD_HI = (240, 245, 239), (146, 168, 156), (246, 196, 69), (255, 224, 138)
TEAL, ORANGE, RED = (143, 227, 197), (255, 158, 96), (216, 67, 47)
TABLE_GREEN = (32, 105, 78)            # 场景绿 #20694E

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]


# ── 主体定位（与 probe_d.py 同一套判据）─────────────────────────────────
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
    im = Image.open(src).convert('RGB')
    W, H = im.size
    if wipe_bottom < H:
        bgp = im.crop((0, wipe_bottom - 40, W, wipe_bottom - 20)).resize((1, 1)).getpixel((0, 0))
        im.paste(Image.new('RGB', (W, H - wipe_bottom), bgp), (0, wipe_bottom))
    x0, y0, x1, y1 = subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ch, cw = bh / fill, bh / fill * aspect
    if cw > W: cw, ch = W, W / aspect
    if ch > H: ch, cw = H, H * aspect
    l = min(max(0, cx - cw / 2), W - cw)
    t = min(max(0, cy - ch / 2), H - ch)
    canvas = im.crop((round(l), round(t), round(l + cw), round(t + ch)))
    canvas.save(dst)
    return canvas, bw / bh


# ── 归一化 ──────────────────────────────────────────────────────────────
SCHEMES = [
    dict(key='A', raw='一万-A-典藏瓷玉-raw.png', out='一万-A-典藏瓷玉.png',
         name='A · 典藏瓷玉', tag='原方案',
         one='象牙瓷面 · 哑光釉 · 淡金厚边 · 朱红字',
         mats='底：象牙瓷 #FDFAF0　字：朱红 #D8432F'),
    dict(key='B', raw='一万-B-鎏金浮雕-raw.png', out='一万-B-鎏金浮雕.png',
         name='B · 鎏金浮雕', tag='原方案',
         one='暖骨底 · 全鎏金高浮雕字 · 卷草纹金框',
         mats='底：暖骨 #FFF7E6　字：鎏金 #F6C445'),
    dict(key='D', raw='一万-D-融合稿-玉质高浮雕朱红-raw.png', out='一万-D-融合稿-玉质高浮雕朱红.png',
         name='D · 融合稿', tag='★ 本轮',
         one='乳白玉体 · 天然玉纹 · 卷草金角框 · 朱红高浮雕字',
         mats='底：乳白玉 #FFF7E6　字：朱红 #D8432F（高浮雕）'),
]

print('归一化（3:4 画布 · 牌占高 78%）：')
for s in SCHEMES:
    canvas, ratio = normalize(os.path.join(SRC, s['raw']), os.path.join(SRC, s['out']))
    s['canvas'] = canvas
    s['ratio'] = ratio
    print('  %-3s 牌体宽高比 %.3f  画布 %s' % (s['key'], ratio, canvas.size))

D = [s for s in SCHEMES if s['key'] == 'D'][0]

# ── 版式 ────────────────────────────────────────────────────────────────
W = 1500
PAD, GAP = 50, 40
CW = (W - 2 * PAD - 2 * GAP) // 3          # 440
CH = round(CW * 4 / 3)                      # 587

TITLE_H = 126
BIG_H   = 58 + 66 + CH + 78
MID_H   = 50 + 402
TBL_ROW, TBL_N = 46, 11
TBL_H   = 56 + TBL_N * TBL_ROW + 20

# 底部文案需先折行才能定面板高（★ 长句直接画会冲出右边界）
_probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
FOOT_TXT_W = W - PAD * 2 - 100

def _wrap(text, sz=16):
    f = F(sz)
    lines, cur = [], ''
    for ch in text:
        if _probe.textlength(cur + ch, font=f) <= FOOT_TXT_W:
            cur += ch
        else:
            lines.append(cur); cur = ch
    if cur: lines.append(cur)
    return lines

FOOT_SRC = [
    ('○', '与 B 相比，只改了提示词里「INK/COLOR」与「MATERIAL」中"字"的两句（鎏金 → 朱红）；'
          'SUBJECT / CAMERA / LIGHTING / STRICT STYLE 与 B 逐字相同 → 差异可完全归因到"字材"这一项。', CREAM),
    ('△', '实测字占比：本稿红字宽 / 牌体宽 = 0.571、高 / 牌体高 = 0.656（A 为 0.644 / 0.805）；'
          '红像素 95,129 个 vs A 的 62,420 → 笔画更粗壮饱满（高浮雕需要更厚的笔画支撑体积）。', ORANGE),
    ('△', '本稿牌体宽高比实测 0.711（A 0.786 / B 0.762）：本张牌形偏瘦长，已归一化到统一 3:4 画布。', ORANGE),
    ('○', '若你偏好更"疏朗"的留白，可再出一版把字缩到约 90% —— 按流程最多再调 3 轮。', TEAL),
]
FOOT_ROWS = []
for _m, _t, _c in FOOT_SRC:
    _ls = _wrap(_t)
    for _i, _l in enumerate(_ls):
        FOOT_ROWS.append((_m if _i == 0 else '', _l, _c))
FOOT_H = 60 + len(FOOT_ROWS) * 32 + 22

Y_BIG  = TITLE_H + 24
Y_MID  = Y_BIG + BIG_H + 34
Y_TBL  = Y_MID + MID_H + 34
Y_FOOT = Y_TBL + TBL_H + 30
H      = Y_FOOT + FOOT_H + 40

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 标题
d.text((PAD, 30), '一万 · 融合稿验收板', font=F(40, True), fill=CREAM)
d.text((PAD, 84), '拍板口径：取 A 的文字内容（朱红「一」「萬」）× B 的玉石质感（乳白玉体 + 卷草金角框 + 高浮雕工艺）'
                  '　·　第 18 轮 · 2026-10-05',
       font=F(17), fill=MUTE)
d.line([(PAD, TITLE_H - 6), (W - PAD, TITLE_H - 6)], fill=LINE, width=1)

# 上区：三风格并排（D 高亮）
for i, s in enumerate(SCHEMES):
    x = PAD + i * (CW + GAP)
    hot = (s['key'] == 'D')
    d.rounded_rectangle([x, Y_BIG, x + CW, Y_BIG + 58], 12,
                        fill=(46, 36, 10) if hot else PANEL2,
                        outline=GOLD if hot else LINE, width=2 if hot else 1)
    d.text((x + 16, Y_BIG + 8), s['name'], font=F(24, True), fill=GOLD_HI if hot else CREAM)
    tw = d.textlength(s['tag'], font=F(17))
    d.rounded_rectangle([x + CW - tw - 30, Y_BIG + 15, x + CW - 14, Y_BIG + 43], 8,
                        fill=(96, 64, 12) if hot else (60, 40, 12),
                        outline=GOLD if hot else (120, 92, 34))
    d.text((x + CW - tw - 22, Y_BIG + 18), s['tag'], font=F(17), fill=GOLD_HI if hot else GOLD)
    im = s['canvas'].resize((CW, CH), Image.LANCZOS)
    img.paste(im, (x, Y_BIG + 66))
    d.rectangle([x, Y_BIG + 66, x + CW - 1, Y_BIG + 66 + CH - 1],
                outline=GOLD if hot else LINE, width=3 if hot else 1)
    yy = Y_BIG + 66 + CH + 12
    d.text((x, yy), s['one'], font=F(18), fill=CREAM if hot else MUTE)
    d.text((x, yy + 30), s['mats'], font=F(16), fill=MUTE)

# 中区：小尺寸可读性 + 场景配色关系
d.line([(PAD, Y_MID - 18), (W - PAD, Y_MID - 18)], fill=LINE, width=1)
d.text((PAD, Y_MID - 6), '小尺寸可读性与场景配色', font=F(24, True), fill=CREAM)
d.text((PAD + 300, Y_MID + 2), '左 = 游戏中真实显示尺寸 96×128（1:1 像素）　右 = 3× 放大观感',
       font=F(16), fill=MUTE)
SY = Y_MID + 44
RX = PAD + 520
d.rounded_rectangle([PAD, SY, RX - 40, SY + 402], 12, fill=PANEL, outline=LINE)
t = D['canvas']
img.paste(t.resize((96, 128), Image.LANCZOS), (PAD + 40, SY + 137))
img.paste(t.resize((288, 384), Image.LANCZOS), (PAD + 168, SY + 9))
d.rectangle([PAD + 168, SY + 9, PAD + 168 + 287, SY + 9 + 383], outline=LINE)
d.rectangle([PAD + 170, SY + 11, PAD + 208, SY + 37], fill=GOLD)
d.text((PAD + 177, SY + 13), '3×', font=F(17, True), fill=(50, 33, 8))
d.text((PAD + 20, SY + 310), '96×128', font=F(19, True), fill=GOLD_HI)
d.text((PAD + 20, SY + 336), '1:1 实尺', font=F(15), fill=MUTE)

# 右侧：配色关系
d.rounded_rectangle([RX, SY, W - PAD, SY + 402], 12, fill=PANEL, outline=LINE)
d.text((RX + 20, SY + 16), '与「墨绿典藏」界面的配色关系', font=F(21, True), fill=GOLD_HI)
SW = 84
swatches = [
    ('场景绿 · 桌面', TABLE_GREEN, '#20694E', '牌堆所在底色'),
    ('玉底 · 牌面', (255, 247, 230), '#FFF7E6', '乳白玉体'),
    ('朱红 · 字', RED, '#D8432F', '同界面朱红'),
    ('点缀金 · 框', GOLD, '#F6C445', '同界面金线'),
]
for i, (nm, rgb, hexs, note) in enumerate(swatches):
    yy = SY + 62 + i * 76
    d.rounded_rectangle([RX + 20, yy, RX + 20 + SW, yy + 58], 8, fill=rgb, outline=LINE)
    d.text((RX + 20 + SW + 18, yy + 6), nm, font=F(19, True), fill=CREAM)
    d.text((RX + 20 + SW + 18, yy + 32), '%s　%s' % (hexs, note), font=F(15), fill=MUTE)
d.text((RX + 20, SY + 62 + 4 * 76 + 10),
       '→ 红字即界面朱红、金框即界面金线，玉底与象牙牌面同族 —— 三色都在既有色板内',
       font=F(16), fill=TEAL)

# 下区：用途符合性
d.line([(PAD, Y_TBL - 18), (W - PAD, Y_TBL - 18)], fill=LINE, width=1)
d.text((PAD, Y_TBL - 6), '用途符合性对比（针对融合稿 D）', font=F(24, True), fill=CREAM)

ROWS = [
    ('比例 3:4（与 96×128 一致）', '✓', '已统一裁切到 3:4 画布、牌占高 78%'),
    ('正视 90° 无透视', '△', '轻微侧视（可见右侧厚边）—— 96×128 下几乎看不出'),
    ('字色 = A 的朱红', '✓', '#D8432F，与 A / 界面朱红同源'),
    ('字工艺 = B 的高浮雕', '✓', '凸起有厚度、侧壁投影、顶面高光（照 B 的厚度）'),
    ('边框 = B 的卷草金角框', '✓', '四角雕花卷草饰保留'),
    ('底质 = B 的玉石质感', '✓', '乳白玉体 + 天然云絮玉纹，微透光'),
    ('与「墨绿典藏」协调', '✓✓', '红 / 金 / 玉三色全在既有色板内（见中区右侧）'),
    ('质感：细腻 · 立体 · 光影', '✓✓', '高浮雕侧壁 + 玉纹通透，光影层次最丰富'),
    ('小尺寸下字可辨', '✓', '见中区 96×128 实尺'),
    ('背景可抠（纯色）', '△', '浅灰渐变 + 接触阴影，非纯白 —— 定稿阶段处理'),
    ('无杂字 / 无工具水印', '✓', '已核：右下角最小 V=249，无暗像素（三张同）'),
]
colx = [PAD + 20, PAD + 430, PAD + 500]
d.rounded_rectangle([PAD, Y_TBL + 34, W - PAD, Y_TBL + TBL_H - 6], 14, fill=PANEL, outline=LINE)
for r, row in enumerate(ROWS):
    ry = Y_TBL + 48 + r * TBL_ROW
    if r % 2 == 1:
        d.rectangle([PAD + 2, ry - 5, W - PAD - 2, ry + TBL_ROW - 9], fill=PANEL2)
    d.text((colx[0] + 14, ry), row[0], font=F(16), fill=CREAM)
    col = TEAL if row[1].startswith('✓') else ORANGE
    d.text((colx[1], ry), row[1], font=F(17, True), fill=col)
    d.text((colx[2], ry), row[2], font=F(16), fill=MUTE)
d.line([(PAD, Y_TBL + 56), (W - PAD, Y_TBL + 56)], fill=LINE, width=1)
d.text((W - PAD - 340, Y_TBL - 6), '✓ = 通过（9）　△ = 已知代价（2）', font=F(16), fill=MUTE)

# 底部：改动说明 + 待确认
d.rounded_rectangle([PAD, Y_FOOT, W - PAD, Y_FOOT + FOOT_H - 20], 14, fill=PANEL2,
                    outline=(120, 92, 34), width=1)
d.text((PAD + 20, Y_FOOT + 14), '本轮改动口径与实测差异', font=F(21, True), fill=GOLD_HI)
for i, (mark, txt, col) in enumerate(FOOT_ROWS):
    yy = Y_FOOT + 50 + i * 32
    if mark:
        d.text((PAD + 20, yy), mark, font=F(17, True), fill=col)
    d.text((PAD + 48, yy), txt, font=F(16), fill=MUTE if col is ORANGE else CREAM)

img.save(OUT)
print('\n验收板 → %s  (%dx%d)' % (os.path.relpath(OUT, ROOT), W, H))
