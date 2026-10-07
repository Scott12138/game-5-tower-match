#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 48 轮 · 结算弹层标题版式修正的**对照板**（给用户拍板用）

小节：
  1 · 问题（用户真机原图）—— 标题大半悬在卡框之外、失败态压到 HUD
  2 · 改前 / 改后（同一裁剪区，胜态与失败态各一对）—— 一眼看出版式变化
  3 · 几何对账表（越卡外量、真源语义、厚底）
  4 · 判负口径小改（牌堆空 + 槽满 ⇒ 通关）

⚠️ 排版纪律（本项目踩过）：不用 emoji（中文字体渲染成豆腐块）；贴图用**局部坐标**；
   板高**先给足余量、画完按实际 y 裁**（用预算算术会静默裁掉末尾内容）。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.normpath(os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'ui', 'result-title-r48'))
os.makedirs(OUT, exist_ok=True)

# ---- 素材 ----
USER_WIN = '/Users/consli/.workbuddy/clipboard-images/clipboard-2026-10-07T02-43-55-318Z-5773d02b.png'
USER_FAIL = '/Users/consli/.workbuddy/clipboard-images/clipboard-2026-10-07T02-43-55-324Z-1a913e99.png'
BEFORE_WIN = '/tmp/g5-r48/r48-win.png'
BEFORE_FAIL = '/tmp/g5-r48/r48-fail.png'
AFTER_WIN = '/tmp/g5-r48v2/r48v-01-win.png'
AFTER_FAIL = '/tmp/g5-r48v2/r48v-02-fail.png'
NEW_WIN = '/tmp/g5-r48v2/r48v-03-empty-full-win.png'

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
MONO = '/System/Library/Fonts/Menlo.ttc'

C_BG = (16, 36, 28)
C_CARD = (26, 58, 45)
C_CREAM = (238, 232, 214)
C_GOLD = (222, 186, 110)
C_DIM = (150, 176, 160)
C_OK = (126, 214, 148)
C_NG = (232, 118, 108)

W = 1720
PAD = 56
H = 5200          # 先给足余量，画完按实际 y 裁


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def mono(sz):
    try:
        return ImageFont.truetype(MONO, sz)
    except Exception:
        return font(sz)


board = Image.new('RGB', (W, H), C_BG)
d = ImageDraw.Draw(board)
y = PAD


def head(title, sub=''):
    global y
    d.rectangle([PAD, y, PAD + 10, y + 40], fill=C_GOLD)
    d.text((PAD + 26, y), title, font=font(36, True), fill=C_CREAM)
    if sub:
        d.text((PAD + 26 + d.textlength(title, font=font(36, True)) + 24, y + 12), sub,
               font=font(22), fill=C_DIM)
    y += 62


def note(lines, color=None):
    global y
    for ln in lines:
        d.text((PAD + 26, y), ln, font=font(24), fill=color or C_DIM)
        y += 36
    y += 8


def paste_row(items, box_w, gap=18):
    """一行并排贴图；items = [(path, 标签, 标签色)]"""
    global y
    x = PAD
    hmax = 0
    for path, label, lc in items:
        im = Image.open(path).convert('RGB')
        # 裁剪区：设计 px [40,215]~[710,1310] → 截图物理 px。
        # ⚠️ 上边界必须**高于卡顶 145 px**（卡顶在设计 360）—— 骑缝版标题框顶在 248.7，
        #    早先写 300 会把要展示的"溢出那一截"整片裁掉，于是改前改后看着一样。
        sw, sh = im.size
        k = sw / 750.0
        crop = (int(40 * k), int(215 * k), int(710 * k), int(1310 * k))
        im = im.crop(crop)
        bh = int(box_w * im.size[1] / im.size[0])
        im = im.resize((box_w, bh), Image.LANCZOS)
        d.text((x + box_w / 2 - d.textlength(label, font=font(24, True)) / 2, y), label,
               font=font(24, True), fill=lc)
        board.paste(im, (x, y + 38))
        d.rectangle([x - 1, y + 37, x + box_w, y + 38 + bh], outline=(60, 96, 80))
        hmax = max(hmax, bh)
        x += box_w + gap
    y += 38 + hmax + 34


# ============================================================
#  题头
# ============================================================
d.text((PAD, y), '第 48 轮 · 结算弹层标题版式修正', font=font(48, True), fill=C_CREAM)
y += 66
d.text((PAD, y), '通关啦！ / 就差一点！ —— 从「骑缝缎带」改为「卡内题字」，并补上本来就没画出来的厚底',
       font=font(26), fill=C_DIM)
y += 58

# ============================================================
#  1 · 问题（真机原图）
# ============================================================
head('1 · 问题', '用户真机截图：标题大半悬在卡框之外')
row = []
for p, lab in ((USER_WIN, '真机 · 胜态'), (USER_FAIL, '真机 · 失败态（第 5 关）')):
    im = Image.open(p).convert('RGB')
    bw = 400
    bh = int(bw * im.size[1] / im.size[0])
    im = im.resize((bw, bh), Image.LANCZOS)
    row.append((im, lab, bw, bh))
x = PAD
for im, lab, bw, bh in row:
    d.text((x, y), lab, font=font(24, True), fill=C_NG)
    board.paste(im, (x, y + 38))
    d.rectangle([x - 1, y + 37, x + bw, y + 38 + bh], outline=(120, 72, 68))
    x += bw + 26
y += 38 + max(b[3] for b in row) + 20
note([
    '标题框高 154.6 设计 px，其中 111.3 px 悬在卡框之外（占 72%）—— 这就是「超出框外」的来源。',
    '失败态更明显：5 个字的标题横向 456 px，压住了 HUD 的倒计时与「已清」进度条。',
], C_NG)

# ============================================================
#  2 · 改前 / 改后
# ============================================================
head('2 · 改前 / 改后', '同一裁剪区（设计 40,215 ~ 710,1310，含卡顶上方 145 px），四张同宽并排')
paste_row([
    (BEFORE_WIN, '改前 · 胜态', C_NG),
    (BEFORE_FAIL, '改前 · 失败态', C_NG),
    (AFTER_WIN, '改后 · 胜态', C_OK),
    (AFTER_FAIL, '改后 · 失败态', C_OK),
], box_w=384)
note([
    '改前：标题骑在卡顶金框上、上半身整片落在卡外，与顶栏挤成一团（左两张，标题上沿明显越出卡框）。',
    '改后：标题整体落进卡内，成为卡顶的一行题字；上下留白对称，与 HUD 拉开约 80 px。',
])

# ============================================================
#  3 · 几何对账表
# ============================================================
head('3 · 几何对账', '口径：设计 px；坐标一律相对「卡顶中点」，向下为正')
cols = [('量测项', 470), ('改前', 400), ('改后', 400), ('判定', 300)]
rows = [
    ('标题框（88 号字 + 8px 描边）', '368 × 154.6', '368 × 154.6', '未变'),
    ('标题框顶（相对卡顶）', '−111.3', '+12.2', '上沿回到卡内'),
    ('标题框底（相对卡顶）', '+43.3', '+166.8', '整框进卡'),
    ('★ 标题越出卡框的量', '上 111.3', '0', '已消除'),
    ('标题中心相对卡顶', '上方 34', '下方 89.5', '语义修正'),
    ('标题宽 / 卡内容宽', '368 / 540', '368 / 540', '不溢出'),
    ('失败态标题宽（5 字）', '456 / 540', '456 / 540', '不溢出'),
    ('标题字形 → 吉祥物', '被压住', '30.4', '有呼吸量'),
    ('厚底（text-shadow 0 8px）', '空 Graphics，没画', '下层 Label 下偏 8', '补齐'),
    ('卡高（胜态 / 失败态）', '776.8 / 616.8', '897.8 / 737.8', '随版式增高'),
]
ty = y
d.rectangle([PAD, ty, PAD + sum(c[1] for c in cols), ty + 46], fill=(34, 74, 58))
cx = PAD
for name, cw in cols:
    d.text((cx + 14, ty + 10), name, font=font(24, True), fill=C_GOLD)
    cx += cw
ty += 46
for i, r in enumerate(rows):
    if i % 2 == 0:
        d.rectangle([PAD, ty, PAD + sum(c[1] for c in cols), ty + 44], fill=C_CARD)
    cx = PAD
    for k, (_, cw) in enumerate(cols):
        col = C_CREAM if k == 0 else C_DIM
        if k == 3:
            col = C_NG if ('修正' in r[3] or '改前' in r[3]) else C_OK if ('已消除' in r[3] or '补齐' in r[3]) else C_DIM
        d.text((cx + 14, ty + 10), r[k], font=font(23), fill=col)
        cx += cw
    ty += 44
y = ty + 20
note([
    '真源语义：CSS 里 .ribbonTop{top:-34px} 的 top 指的是「盒顶」偏移；旧代码当成「中心偏移」用，',
    '于是标题被整体抬高 77.3 px（= 半个框高）。修法不是挪卡片 —— 真机可视高 1651（设计稿只有 1334），',
    '卡顶距 HUD 底沿只剩 41 px，骑缝无论如何都会撞；只能把标题收进卡内。',
])

# ============================================================
#  4 · 判负口径小改
# ============================================================
head('4 · 判负口径小改', '牌堆没牌了 + 槽位刚好满（不溢出）⇒ 判成功通关')
im = Image.open(NEW_WIN).convert('RGB')
sw, _ = im.size
k = sw / 750.0
im = im.crop((int(40 * k), int(215 * k), int(710 * k), int(1310 * k)))
bw = 384
bh = int(bw * im.size[1] / im.size[0])
im = im.resize((bw, bh), Image.LANCZOS)
board.paste(im, (PAD, y))
d.rectangle([PAD - 1, y - 1, PAD + bw, y + bh], outline=(60, 96, 80))
tx = PAD + bw + 34
for ln, col in [
    ('新增分支：GamePage.settleSlotsFull()', C_CREAM),
    ('', C_DIM),
    ('判定：牌堆空 且 暂存架空 ⇒ 判胜；', C_DIM),
    ('      否则仍按原口径判负。', C_DIM),
    ('', C_DIM),
    ('为什么必须改：旧代码是 240 ms 直接判负，', C_DIM),
    ('而牌堆空的复查在 420 ms —— 判负抢跑，', C_DIM),
    ('于是「最后一手把牌点空、但没凑成组」', C_DIM),
    ('必然弹「就差一点」，玩家读作"我明明清完了"。', C_DIM),
    ('', C_DIM),
    ('自证（tools/_r48-verify.mjs）：', C_CREAM),
    ('判定前快照 remaining=0 / slots=8/8', C_OK),
    ('终局 cleared=12/12、弹层「通关啦！」', C_OK),
    ('负控：牌堆剩 4 张 + 槽满 ⇒ 仍判负', C_OK),
]:
    d.text((tx, y + 4), ln, font=font(24), fill=col)
    y += 36
y += 30

# ============================================================
#  落盘
# ============================================================
board = board.crop((0, 0, W, y + PAD - 20))
out = os.path.join(OUT, '00-结算标题版式修正-对照板.png')
board.save(out)
print('板：', out, board.size)
