#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 49 轮 · 「广告提示落点」+「结算标题横向居中」修正的对照板（给用户拍板用）

小节：
  1 · 问题（用户真机原图）—— 提示条压在槽位条上 / 标题看着偏左
  2 · 广告提示落点：改前 / 改后（同一裁剪区）
  3 · 结算标题横向：改前 / 改后（同一裁剪区 + 卡中线标尺）
  4 · 几何对账表
  5 · 结论摘要

⚠️ 排版纪律（本项目踩过）：不用 emoji（中文字体渲染成豆腐块）；不用 markdown 星号
   （PIL 原样画出）；板高先给足余量、画完按实际 y 裁。
⚠️ 判据纪律：两张图**各自按自己的比例缩放**用于目视，不做"缩放到同尺寸再逐像素比"
   （那种比较见 `r49-title-ink.py`，它是在原分辨率上量的）。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROOT = os.path.normpath(os.path.join(PROJ, '..'))
OUT = os.path.join(ROOT, 'docs-verify', 'game-5', 'ui', 'r49-nudge-title')
os.makedirs(OUT, exist_ok=True)

# ---- 素材 ----
USER_NUDGE = '/Users/consli/.workbuddy/clipboard-images/clipboard-2026-10-07T03-17-58-010Z-7f8a440c.jpg'
USER_TITLE = '/Users/consli/.workbuddy/clipboard-images/clipboard-2026-10-07T03-17-58-012Z-79254cce.png'
B_TOAST = '/tmp/g5-r49/r49-board-toast-idle.png'          # 改前：提示在道具栏上方（压槽位条）
A_TOAST = '/tmp/g5-r49-verify/r49v-01-toast-bottom.png'  # 改后：提示在道具栏下方
B_TITLE = '/tmp/g5-r49/r49-title-fail.png'               # 改前：标题偏左
A_TITLE = '/tmp/g5-r49-verify/r49v-04-title-fail.png'    # 改后：标题居中
A_WIN = '/tmp/g5-r49-verify/r49v-03-title-win.png'       # 改后胜态

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
MONO = '/System/Library/Fonts/Menlo.ttc'

C_BG = (16, 36, 28)
C_CARD = (26, 58, 45)
C_CREAM = (238, 232, 214)
C_GOLD = (222, 186, 110)
C_DIM = (150, 176, 160)
C_OK = (126, 214, 148)
C_NG = (232, 118, 108)
C_MARK = (255, 92, 74)      # 卡中线（红）
C_INK = (86, 220, 232)      # 墨迹边界（青）

W = 1720
PAD = 56
H = 5200                    # 先给足余量，画完按实际 y 裁

board = Image.new('RGB', (W, H), C_BG)
d = ImageDraw.Draw(board)
y = PAD


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def mono(sz, bold=False):
    try:
        return ImageFont.truetype(MONO, sz, index=1 if bold else 0)
    except Exception:
        return font(sz, bold)


def head(no, title, sub=''):
    global y
    d.rectangle([PAD, y, PAD + 10, y + 40], fill=C_GOLD)
    d.text((PAD + 26, y - 6), f'{no} · {title}', font=font(38, True), fill=C_CREAM)
    y += 46
    if sub:
        d.text((PAD + 26, y), sub, font=font(25), fill=C_DIM)
        y += 34
    y += 16


def note(txt, color=C_DIM, size=24, indent=0):
    global y
    d.text((PAD + 26 + indent, y), txt, font=font(size), fill=color)
    y += size + 12


def dashed_v(x, y0, y1, color, w=3, dash=18, gap=13):
    yy = y0
    while yy < y1:
        d.rectangle([x - w // 2, yy, x + w // 2, min(yy + dash, y1)], fill=color)
        yy += dash + gap


def fit_w(im, w):
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def fit_h(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def paste(im, x=None):
    global y
    if x is None:
        x = PAD + (W - 2 * PAD - im.width) // 2
    board.paste(im, (x, y))
    y += im.height


def label(text, x, yy, color=C_CREAM, size=27, bold=True):
    d.text((x, yy), text, font=font(size, bold), fill=color)


def crop_phys(src, y0, y1):
    """按**物理像素**裁一条横带（全宽）"""
    im = Image.open(src).convert('RGB')
    y1 = min(y1, im.height)
    return im.crop((0, y0, im.width, y1)), im.width


# ============================================================
head('①', '问题（用户真机原图）',
     '左：提示条正好压在槽位条上；右：通关啦 / 就差一点 看着偏左')
ui1 = Image.open(USER_NUDGE).convert('RGB')
ui2 = Image.open(USER_TITLE).convert('RGB')
HH = 620
a, b = fit_h(ui1, HH), fit_h(ui2, HH)
gap = 40
x0 = PAD + (W - 2 * PAD - a.width - b.width - gap) // 2
board.paste(a, (x0, y))
board.paste(b, (x0 + a.width + gap, y))
d.rectangle([x0 - 2, y - 2, x0 + a.width + 2, y + HH + 2], outline=(70, 100, 84), width=2)
d.rectangle([x0 + a.width + gap - 2, y - 2, x0 + a.width + gap + b.width + 2, y + HH + 2],
            outline=(70, 100, 84), width=2)
y += HH + 30
label('用户原图 1', x0, y, C_DIM, 23, False)
label(f'用户原图 2', x0 + a.width + gap, y, C_DIM, 23, False)
y += 52

# ============================================================
head('②', '广告提示落点：从「道具栏上方」搬到「道具栏下方」',
     '同一裁剪区（物理 y 1900~2781，全宽）—— 提示条位置一目了然')

# toast 裁剪：底部 881 物理 px（含槽位条 / 暂存架下半 / 道具栏 / 新空档）
crop0, _ = crop_phys(B_TOAST, 1900, 2781)
crop1, _ = crop_phys(A_TOAST, 1900, 2781)
IW = 780
ci0, ci1 = fit_w(crop0, IW), fit_w(crop1, IW)
sy = ci0.height / crop0.height        # 裁剪带内的缩放比
# 距底换算：裁剪带底边 = 屏幕底。带内 y 像素 → 距底设计 px = (带高 − y) / 1.684
band_h_phys = 2781 - 1900
scale_design = 1263 / 750.0           # 物理 px / 设计 px

def yband(im, from_lo, from_hi, y_top):
    """距底区间 [from_lo, from_hi]（设计 px）→ 图上 [y0, y1]"""
    def to_y(fb):
        return y_top + round((band_h_phys - fb * scale_design) * sy)
    return to_y(from_hi), to_y(from_lo)


for im, x_left, tag, is_after in ((ci0, PAD, '改前', False), (ci1, PAD + IW + 48, '改后', True)):
    board.paste(im, (x_left, y))
    col = C_OK if is_after else C_NG
    label(f'{tag}', x_left, y - 40, col, 30)
    # 槽位条带 [281, 361]
    t, b = yband(im, 281, 361, y)
    d.rectangle([x_left, t, x_left + IW, b], outline=C_NG, width=3)
    label('槽位条 距底 281~361', x_left + 10, t + 6, C_NG, 22, False)
    # 道具栏 [157, 269]
    t2, b2 = yband(im, 157, 269, y)
    d.rectangle([x_left, t2, x_left + IW, b2], outline=C_GOLD, width=3)
    label('道具栏 距底 157~269', x_left + 10, t2 + 6, C_GOLD, 22, False)
    # 安全区 [0, 68]
    t3, b3 = yband(im, 0, 68, y)
    dashed_v(x_left + IW - 16, t3, b3, (255, 150, 120), 3, 14, 10)
    label('安全区 0~68', x_left + IW - 210, b3 - 28, (255, 150, 120), 22, False)
    # 提示条实际位置（改前 330.29 / 改后 112.5，高 84）
    tc = 330.29 if not is_after else 112.5
    t4, b4 = yband(im, tc - 42, tc + 42, y)
    d.rectangle([x_left, t4, x_left + IW, b4], outline=(120, 230, 255), width=4)
    label(f'提示条 距底 {tc:.1f}', x_left + 10, t4 + 6, (120, 230, 255), 22, False)
y += ci0.height + 16

note('改前：提示条框 距底 [288.3, 372.3]，与槽位条 [281, 361] 重叠 72.71 设计 px（整条压住）', C_NG)
note('改后：提示条框 距底 [70.5, 154.5]，与槽位条重叠 0.00 —— 落在道具栏下沿(157)与安全区上沿(68)之间的空档',
     C_OK)
y += 26

# ============================================================
head('③', '结算标题横向：把「按字宽居中」补成「按墨迹居中」',
     '同一裁剪区（物理 y 540~1500，全宽）· 红线 = 卡中线（设计 x 375）')

crop2, _ = crop_phys(B_TITLE, 540, 1500)
crop3, _ = crop_phys(A_TITLE, 540, 1500)
cj0, cj1 = fit_w(crop2, IW), fit_w(crop3, IW)
sx = IW / crop2.width
CARD_CX_PHYS = 375 * scale_design      # 631.5
# 墨迹左右边界（原图 1263 坐标，来自 r49-title-ink.py 的列扫描）
INK_B = (271, 926)     # 改前「就差一点！」
INK_A = (319, 973)     # 改后「就差一点！」
TITLE_Y0, TITLE_Y1 = (626 - 540), (887 - 540)   # 标题框在裁剪带内的物理 y

for im, x_left, tag, is_after in ((cj0, PAD, '改前', False), (cj1, PAD + IW + 48, '改后', True)):
    board.paste(im, (x_left, y))
    col = C_OK if is_after else C_NG
    label(tag, x_left, y - 40, col, 30)
    # 卡中线
    cx = x_left + round(CARD_CX_PHYS * sx)
    dashed_v(cx, y, y + im.height, C_MARK, 4, 20, 14)
    label('卡中线', cx + 10, y + 8, C_MARK, 24)
    # 墨迹左右边界
    lo, hi = (INK_A if is_after else INK_B)
    for xx, nm in ((lo, '墨迹左'), (hi, '墨迹右')):
        px = x_left + round(xx * sx)
        dashed_v(px, y + round(TITLE_Y0 * sy), y + round(TITLE_Y1 * sy), C_INK, 3, 12, 9)
    px_lo = x_left + round(lo * sx)
    px_hi = x_left + round(hi * sx)
    label('墨迹左', px_lo - 78, y + im.height - 46, C_INK, 22, False)
    label('墨迹右', px_hi - 20, y + im.height - 46, C_INK, 22, False)
    # 墨迹中心
    mc = x_left + round((lo + hi) / 2 * sx)
    d.polygon([(mc, y + im.height - 22), (mc - 11, y + im.height - 44),
               (mc + 11, y + im.height - 44)], fill=(255, 226, 150))
y += cj0.height + 16

note('改前：墨迹中心比卡中线偏左 28.21 设计 px（= 0.321 em）—— 左右边距 87.29 : 143.71，差 56.41', C_NG)
note('改后：墨迹中心偏移 0.00 设计 px —— 左右边距 115.80 : 115.80，差 0.00', C_OK)
note('原因：Label 按「字符 advance 之和」居中，而全角「！」的 advance = 1 em、墨迹只占 0.297 em',
     C_DIM)
note('     ⇒ 右侧凭空多出 0.70 em 的空档没被计入，墨迹重心被整体推向左。修法 = 右移 0.32 em。',
     C_DIM)
y += 22

# 改后胜态（顺带看一眼另一态）
im_win = fit_w(crop_phys(A_WIN, 540, 1500)[0], IW // 2 + 60)
label('改后 · 胜态「通关啦！」（同一补偿，另一态）', PAD, y, C_OK, 27)
y += 40
board.paste(im_win, (PAD, y))
d.rectangle([PAD, y, PAD + im_win.width, y + im_win.height], outline=(70, 100, 84), width=2)
y += im_win.height + 34

# ============================================================
head('④', '几何对账表（设计 px · 与代码常量同源）')
ROWS = [
    ('项', '改前', '改后', '判据'),
    ('提示条 距底中心', '330.29', '112.5', '(68+157)/2 = 112.5'),
    ('提示条 视觉框（距底）', '[288.3, 372.3]', '[70.5, 154.5]', '胶囊 76 + 阴影 8 = 84'),
    ('与槽位条 [281,361] 重叠', '72.71', '0.00', '必须 = 0'),
    ('与道具栏 [157,269] 重叠', '0.00', '0.00', '必须 = 0'),
    ('提示条框底 vs 安全区 68', '288.3', '70.5', '≥ 68（余量 2.5 = 数学必然）'),
    ('底部同时存在条数', '可堆叠到 4', '≤ 1', '新替旧（retireToast）'),
    ('标题 x 偏移', '0', '28.16', '0.32 em × 字号 88'),
    ('标题墨迹中心偏移', '-28.21', '0.00', '|偏移| ≤ 3'),
    ('标题左右边距差', '+56.41', '+0.00', '≈ 0'),
    ('标题 hAlign / overflow', '1 / 0', '1 / 0', '未改对齐参数（只加补偿）'),
]
cw = [430, 300, 300, 480]
x = PAD + 20
for i, row in enumerate(ROWS):
    xx = x
    hd = i == 0
    for j, cell in enumerate(row):
        col = C_GOLD if hd else (C_CREAM if j == 0 else C_DIM)
        if not hd and j == 2 and row[0] in ('与槽位条 [281,361] 重叠', '标题墨迹中心偏移',
                                            '标题左右边距差', '底部同时存在条数'):
            col = C_OK
        if not hd and j == 1 and row[0] in ('与槽位条 [281,361] 重叠', '标题墨迹中心偏移',
                                            '标题左右边距差'):
            col = C_NG
        d.text((xx, y), cell, font=mono(25, hd), fill=col)
        xx += cw[j]
    y += 40
    if hd:
        d.line([PAD + 20, y - 10, PAD + 20 + sum(cw), y - 10], fill=(70, 100, 84), width=2)
y += 26

# ============================================================
head('⑤', '结论（自证结果）')
for t, c in [
    ('自证：tools/_r49-verify.mjs —— 28 通过 / 0 失败', C_OK),
    ('回归：g5-smoke 25/25 · _r48-verify 48/48 · _r47b-verify 16/16 · tsc 0 错误', C_OK),
    ('量法自身有对照组：卡金框间距实测 619.95 ≈ 设计卡宽 620（比例可信才敢用墨迹数字）', C_DIM),
    ('真实事件自证：第二段用**真实鼠标**点「洗牌」键产生提示，落点同样 112.5', C_DIM),
    ('负控：底部连发两条 → 只留一条（旧条淡出退场）；底带三层位置一律未动', C_DIM),
]:
    note(t, c, 26)
    y += 4

# ---------------- 裁掉底部空白 ----------------
y += PAD
final = board.crop((0, 0, W, y))
out = os.path.join(OUT, '00-广告提示落点与标题居中-对照板.png')
final.save(out)
print(f'{out}   {final.width}x{final.height}')
