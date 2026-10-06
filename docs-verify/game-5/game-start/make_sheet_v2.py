# -*- coding: utf-8 -*-
"""骰子入盘实地检验 + 交付图：
① 边缘 8× 放大（深绿毡面底）—— 目视确认有无白圈/毛刺
② 骰盘特写 3× 放大 —— 确认骰子尺寸比例是否协调
③ 开局页终态 750×1334 —— 桌面落点 y=292 + 上下 HUD 区标注
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
OUT = ROOT + '/docs-verify/game-5/game-start/proc/final'
IMG = ROOT + '/docs-verify/game-5/game-start'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'

table = Image.open(OUT + '/table_C_750.jpg').convert('RGB')
dice_src = Image.open(OUT + '/dice_final_384.png').convert('RGBA')
CONTENT_RATIO = 0.7996                       # 内容占画布比例（定值）
TRAY_CX, TRAY_CY, TRAY_D = 373.0, 376.0, 228.4


def pm_resize(im, px):
    st = np.asarray(im).astype(np.float32)
    al = st[:, :, 3:4] / 255.0
    pm = np.dstack([st[:, :, :3] * al, st[:, :, 3]])
    pi = Image.fromarray(np.clip(pm, 0, 255).round().astype(np.uint8), 'RGBA').resize((px, px), Image.LANCZOS)
    q = np.asarray(pi).astype(np.float32)
    a2 = q[:, :, 3:4]
    q[:, :, :3] = q[:, :, :3] / np.maximum(a2 / 255.0, 0.004)
    low = (a2[:, :, 0] < 6)
    q[low, 0] = 0; q[low, 1] = 0; q[low, 2] = 0
    return Image.fromarray(np.clip(q, 0, 255).round().astype(np.uint8), 'RGBA')


def pm_rotate(im, ang):
    st = np.asarray(im).astype(np.float32)
    al = st[:, :, 3:4] / 255.0
    pm = np.dstack([st[:, :, :3] * al, st[:, :, 3]])
    pi = Image.fromarray(np.clip(pm, 0, 255).round().astype(np.uint8), 'RGBA') \
        .rotate(ang, resample=Image.BICUBIC, expand=False)
    q = np.asarray(pi).astype(np.float32)
    a2 = q[:, :, 3:4]
    q[:, :, :3] = q[:, :, :3] / np.maximum(a2 / 255.0, 0.004)
    low = (a2[:, :, 0] < 6)
    q[low, 0] = 0; q[low, 1] = 0; q[low, 2] = 0
    return Image.fromarray(np.clip(q, 0, 255).round().astype(np.uint8), 'RGBA')


def die_at(visual_px, ang):
    """按「视觉边长」出图：画布 = 视觉边长 / 内容占比。"""
    canvas_px = int(round(visual_px / CONTENT_RATIO))
    return pm_rotate(pm_resize(dice_src, canvas_px), ang)


# ========== ① 边缘 8× 放大（深绿底） ==========
DIE_VIS = 80
d1 = die_at(DIE_VIS, 0)
bg = Image.new('RGB', (260, 260), (11, 41, 32))          # 毡面典型色
bg.paste(d1, ((260 - d1.size[0]) // 2, (260 - d1.size[1]) // 2), d1)
bg.resize((260 * 3, 260 * 3), Image.NEAREST).save(IMG + '/proc/dice_on_felt_3x.png')
# 裁一块边缘 8×
# 裁骰子左上圆角边缘 8×（圆角最能暴露毛刺/白边）
edge_crop = bg.crop((84, 84, 124, 124)).resize((40 * 8, 40 * 8), Image.NEAREST)
edge_crop.save(IMG + '/proc/dice_edge_8x.png')

# ========== ② 骰盘特写 3× ==========
TRAY_INNER = int(round(TRAY_D * 0.72))                   # 盘内可用区（扣掉金环宽）
TRAY_VIS = 84                                            # 单颗骰子「视觉边长」设计值（约占盘径 37%）
for v in (68, 76, TRAY_VIS):
    print('骰子视觉边长 %d → 画布 %d px（内容占比 0.7996 换算）' % (v, int(round(v / CONTENT_RATIO))))

tw = min(int(TRAY_D * 1.9), 740)                          # 特写视野 ≈1.9×盘径，且必须夹进画布
cx0 = int(min(max(TRAY_CX - tw / 2, 0), 750 - tw))
cy0 = int(min(max(TRAY_CY - tw / 2, 0), 750 - tw))
tray = table.crop((cx0, cy0, cx0 + tw, cy0 + tw)).resize((tw * 3, tw * 3), Image.LANCZOS)
for off, ang in (((-TRAY_VIS * 0.50, -TRAY_VIS * 0.46), -14), ((TRAY_VIS * 0.52, TRAY_VIS * 0.50), 22)):
    dd = die_at(TRAY_VIS, ang)
    px = int((tw / 2 + off[0]) * 3 - dd.size[0] / 2)
    py = int((tw / 2 + off[1]) * 3 - dd.size[1] / 2)
    tray.paste(dd, (px, py), dd)
tray.save(IMG + '/proc/tray_closeup_3x.png')

# ========== ③ 开局页终态 750×1334 ==========
CANVAS = Image.new('RGB', (750, 1334), (10, 34, 26))
CANVAS.paste(table, (0, 292))
# 骰子放进骰盘（同一摆法）
for off, ang in (((-TRAY_VIS * 0.50, -TRAY_VIS * 0.46), -14), ((TRAY_VIS * 0.52, TRAY_VIS * 0.50), 22)):
    dd = die_at(TRAY_VIS, ang)
    px = int(TRAY_CX + off[0] - dd.size[0] / 2)
    py = int(292 + TRAY_CY + off[1] - dd.size[1] / 2)
    CANVAS.paste(dd, (px, py), dd)

d = ImageDraw.Draw(CANVAS, 'RGBA')
F = ImageFont.truetype(FONT, 22, index=0)
Fs = ImageFont.truetype(FONT, 18, index=0)


def label(x, y, text, font, fg, bg=(6, 22, 17, 205), padx=10, pady=6):
    bb = d.textbbox((0, 0), text, font=font)
    d.rectangle([x, y, x + (bb[2] - bb[0]) + padx * 2, y + (bb[3] - bb[1]) + pady * 2], fill=bg)
    d.text((x + padx, y + pady - bb[1]), text, font=font, fill=fg)


# HUD 区
d.rectangle([0, 0, 750 - 1, 292], outline=(246, 196, 69, 130), width=2)
d.rectangle([0, 1042, 750 - 1, 1334 - 1], outline=(246, 196, 69, 130), width=2)
label(14, 14, '顶部 HUD 区  y 0~292', F, (246, 196, 69, 255))
label(14, 50, '暂停 / 第 N 关 / 已清 n/m / 限时 / 规则', Fs, (205, 222, 205, 255))
label(14, 1056, '底部 HUD 区  y 1042~1334', F, (246, 196, 69, 255))
label(14, 1092, '槽位条 8(+1) 格 / 道具栏四件套', Fs, (205, 222, 205, 255))
# 桌面区
d.rectangle([0, 292, 750 - 1, 292 + 750 - 1], outline=(255, 255, 255, 80), width=1)
label(14, 292 + 500, '麻将桌 750×750（桌面 C）· 纯游玩区', Fs, (255, 255, 255, 235))
label(14, 292 + 532, '牌堆安全区 682×682（桌内缩 34）', Fs, (222, 232, 222, 210))
# 骰盘圆心十字
ccx, ccy = int(TRAY_CX), int(292 + TRAY_CY)
d.line([ccx - 16, ccy, ccx + 16, ccy], fill=(255, 80, 80, 230), width=2)
d.line([ccx, ccy - 16, ccx, ccy + 16], fill=(255, 80, 80, 230), width=2)
label(8, 292 + 750 - 46, '骰盘 直径 %.0f · 圆心 (%.0f, %.0f)' % (TRAY_D, TRAY_CX, TRAY_CY),
      Fs, (255, 160, 160, 235))
CANVAS.save(IMG + '/proc/start_page_final_750x1334.png')

print('已出：dice_on_felt_3x / dice_edge_8x / tray_closeup_3x / start_page_final_750x1334')
print('骰盘圆心 750 坐标 (%.0f, %.0f)  直径 %.1f  骰子视觉边长 %d 设计值（占盘径 %.0f%%）'
      % (TRAY_CX, TRAY_CY, TRAY_D, TRAY_VIS, TRAY_VIS / TRAY_D * 100))
