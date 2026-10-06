#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主玩页（④）v1 + 赠礼界面 · 验收板【第 15 轮历史产物 · 勿再视为当前口径】
   输入：同目录下 CDP 截取的 8 张 750x1334 实机图（真实浏览器渲染，非手绘）
   输出：00-主玩页与赠礼层-验收板.png
   口径：所有数值取自 __mp 断言接口实测（61 项全通过），不手抄。

⚠⚠ 第 32 轮（2026-10-05）起本板的**档位口径已作废**，仅作设计期留痕：
   · 板上的「常态 36 张 / 3 层」「大关 96 张 / 4 层」「牌面自动缩至 80x107」
     是**写死档位时代**的口径。第 32 轮用户第 4 条拍板后，主玩页档位已改为
     读 levels.json 的**真实关卡**（默认 L1=12 张 / L10=93 张 / L30=138 张），
     牌体尺寸也改为「单关内唯一」（L30 为 88×117，不是 80×107）。
   · 现口径的验收板请看 **63-真实牌堆档位-验收板.png**（由 make_round32_sheet.py 生成）。
   · 本脚本依赖的 05/06/07/08 四张截图属于第 15 轮回放素材，已无法由当前页面重现
     —— 因此**不要重跑本脚本**（重跑只会把历史截图重新贴一遍，无法反映现状）。
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

BG      = (12, 22, 18)
PANEL   = (19, 34, 28)
PANEL2  = (23, 41, 34)
LINE    = (44, 68, 58)
CREAM   = (240, 245, 239)
MUTE    = (146, 168, 156)
GOLD    = (246, 196, 69)
GOLD_HI = (255, 224, 138)
TEAL    = (143, 227, 197)
TEAL_D  = (85, 183, 154)
ORANGE  = (255, 158, 96)
RED     = (216, 67, 47)

_fc = {}
def F(sz, b=False):
    k = (sz, b)
    if k not in _fc:
        try:    _fc[k] = ImageFont.truetype(FONT, sz, index=1 if b else 0)
        except Exception: _fc[k] = ImageFont.truetype(FONT, sz)
    return _fc[k]

W, PAD = 1500, 60
CELL, GAP = 315, 40
COLS = [PAD + i * (CELL + GAP) for i in range(4)]
TH = round(CELL * 1334 / 750)          # 560

SHOTS = [
    ('05-主玩页-常态36张.png',   '主玩页 · 常态（36 张 / 3 层）',  '可点带上浮金边，被压无影'),
    ('06-主玩页-审查叠加.png',   '审查叠加：三带几何',             '桌面 750x750 / 安全区 682x682'),
    ('07-主玩页-96张大关.png',   '大关档位（96 张 / 4 层）',       '牌面自动缩至 80x107'),
    ('08-主玩页-槽位告警.png',   '槽位告警（7 张）',               '色 + 抖动 + 心跳音 三通道'),
]
GIFTS = [
    ('01-赠礼过场-常规档.png',   '赠礼过场 · 常规档（和值 8）',    '3+5=8 → 移出 x1'),
    ('02-赠礼过场-复活档.png',   '赠礼过场 · 复活档（和值 2）',    '1+1=2 → 复活机会 x1（不入栏）'),
    ('03-赠礼落位-飞行中.png',   '落位飞行中',                     '赠礼卡 → 道具栏，780ms'),
    ('04-赠礼落位-到账后.png',   '落位到账',                       '角标 +1，提示「仅限本局使用」'),
]

def img(name):
    im = Image.open(os.path.join(BASE, name)).convert('RGB')
    return im.resize((CELL, TH), Image.LANCZOS)

def rr(d, box, r, fill=None, outline=None, w=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=w)

def row(d, y, items, title, sub):
    d.text((PAD, y), title, font=F(28, True), fill=GOLD)
    d.text((PAD + d.textlength(title, font=F(28, True)) + 18, y + 8), sub, font=F(19), fill=MUTE)
    d.line([(PAD, y + 46), (W - PAD, y + 46)], fill=LINE, width=1)
    y += 66
    for i, (fn, cap, note) in enumerate(items):
        x = COLS[i]
        rr(d, (x - 4, y - 4, x + CELL + 4, y + TH + 4), 14, fill=(6, 12, 9))
        d._image.paste(img(fn), (x, y))
        d.rectangle([x, y, x + CELL, y + TH], outline=(60, 88, 74), width=1)
        d.text((x, y + TH + 14), cap, font=F(21, True), fill=CREAM)
        d.text((x, y + TH + 44), note, font=F(17), fill=MUTE)
    return y + TH + 84

# 计算总高
H = 0
H += 150
H += 66 + TH + 84
H += 66 + TH + 84
H += 600
H += 90

im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
d._image = im

# 背景纹理
for i in range(0, W, 6):
    d.line([(i, 0), (i, H)], fill=(BG[0] + 2, BG[1] + 3, BG[2] + 2))

# ── 页头 ──
y = 46
d.text((PAD, y), '主玩页（④）v1  ·  排版稿与赠礼界面', font=F(42, True), fill=GOLD_HI)
d.text((PAD, y + 60), '《麻麻大消除》game-5   ·   设计画布 750 x 1334   ·   第 15 轮   ·   2026-10-05',
       font=F(20), fill=MUTE)
badge = '真实浏览器事件验证 61 / 61 通过'
bw = d.textlength(badge, font=F(20, True)) + 34
rr(d, (W - PAD - bw, y + 6, W - PAD, y + 48), 21, fill=(22, 62, 46), outline=TEAL_D, w=1)
d.text((W - PAD - bw + 17, y + 15), badge, font=F(20, True), fill=TEAL)
y += 110

# ── 区块 1：主玩页 ──
y = row(d, y, SHOTS, '一、主玩页排版（6 区 · 21 项功能要素）', '点击牌 → 飞入槽位；点道具 → 计数实时变化；槽位满 7 张进告警态')

# ── 区块 2：赠礼层 ──
y = row(d, y, GIFTS, '二、本局赠礼（过场 + 落位，两段连贯）', '开局页骰子结果 → 进入主玩页时先触发；赠礼仅限本局使用')

# ── 区块 3：底带剖面 + 尺寸表 ──
d.text((PAD, y), '三、底带高度冲突 · 解法与实测', font=F(28, True), fill=GOLD)
d.text((PAD + d.textlength('三、底带高度冲突 · 解法与实测', font=F(28, True)) + 18, y + 8),
       '桌面 750x750 零改动，两栏在 224 内重新分配', font=F(19), fill=MUTE)
d.line([(PAD, y + 46), (W - PAD, y + 46)], fill=LINE, width=1)
y += 66

# 左：剖面图
PX, PY, PW, PH = PAD, y, 470, 452
rr(d, (PX, PY, PX + PW, PY + PH), 14, fill=PANEL, outline=LINE, w=1)
scale = PH / 292.0
LBL_X, BLK_X, BLK_R = PX + 18, PX + 208, PX + PW - 26
def band(y0, y1, label, val, color, txt=(20, 30, 26)):
    a, b2 = PY + (y0 - 1042) * scale, PY + (y1 - 1042) * scale
    if b2 - a < 6:
        d.line([(BLK_X, (a + b2) / 2), (BLK_R, (a + b2) / 2)], fill=color, width=3)
    else:
        rr(d, (BLK_X, a + 2, BLK_R, b2 - 2), 6, fill=color)
        if b2 - a > 22:
            d.text((BLK_R - 14 - d.textlength(val, font=F(16, True)), (a + b2) / 2 - 10),
                   val, font=F(16, True), fill=txt)
    d.text((LBL_X, (a + b2) / 2 - 11), label, font=F(17), fill=CREAM)
band(1042, 1058, '间距', '16', (52, 84, 70))
band(1058, 1138, '槽位条  68x80 x8', '80', TEAL_D)
band(1138, 1154, '间距', '16', (52, 84, 70))
band(1154, 1250, '道具栏  96x96 x5', '96', (196, 150, 60))
band(1250, 1334, '底部余量', '84', (44, 58, 50), MUTE)
d.text((PX, PY - 28), '底带剖面  y 1042 → 1334（共 292）', font=F(17, True), fill=MUTE)
d.text((LBL_X, PY + PH - 26), 'y 1334（屏底，含 safeBottom 68）', font=F(15), fill=MUTE)
d.line([(PX + 14, PY + 2 * scale), (PX + PW - 14, PY + 2 * scale)], fill=(90, 130, 108), width=1)

# 右：表
TX = PX + PW + 40
TW = W - PAD - TX
rr(d, (TX, PY, TX + TW, PY + PH), 14, fill=PANEL2, outline=LINE, w=1)
d.text((TX + 22, PY + 18), '尺寸台账与判据', font=F(21, True), fill=GOLD)
rows = [
    ('底带总高', '292', 'y 1042 - 1334', CREAM),
    ('减 safeBottom', '-68', 'iPhone 类 34pt = 68px', CREAM),
    ('可用高度', '224', '这才是真正的预算', CREAM),
    ('四段合计（间距/槽位条/间距/道具栏）', '16+80+16+96', '= 208', CREAM),
    ('占用 vs 可用', '208 <= 224', '余 16   通过', TEAL),
    ('底部余量', '84 >= 68', '通过', TEAL),
    ('桌面', '750 x 750 不动', '开局页运镜与时序零改动', TEAL),
    ('旧口径作废', '距底 safeBottom+200', '实测会顶进桌面 68px', ORANGE),
]
ry = PY + 66
for k, v, note, col in rows:
    d.text((TX + 22, ry), k, font=F(17), fill=MUTE)
    d.text((TX + 22, ry + 24), v, font=F(21, True), fill=col)
    d.text((TX + TW - 22 - d.textlength(note, font=F(16)), ry + 26), note, font=F(16), fill=MUTE)
    ry += 44
    d.line([(TX + 22, ry - 5), (TX + TW - 22, ry - 5)], fill=(34, 54, 46), width=1)

y += PH + 40

# ── 页脚 ──
d.line([(PAD, y), (W - PAD, y)], fill=LINE, width=1)
d.text((PAD, y + 22),
       '资产口径：复用 game-start/table_default.jpg、dice/face_1~6.png、home/icon_tool_*.png、splash/ui_progress_*@2x.png；'
       '赠礼主视觉不新增出图资产（现有图标 + 矢量）；牌面 27 张为占位版，待 AI 样图拍板后替换。',
       font=F(17), fill=MUTE)
d.text((PAD, y + 50), '本轮仅交付排版稿，未写游戏代码；主玩页交互逻辑待规格确认后实现。', font=F(17), fill=MUTE)

im.crop((0, 0, W, y + 84)).save(os.path.join(BASE, '00-主玩页与赠礼层-验收板.png'))
print('✅ 验收板已生成 →', os.path.join(BASE, '00-主玩页与赠礼层-验收板.png'), im.crop((0, 0, W, y + 84)).size)
