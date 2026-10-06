# -*- coding: utf-8 -*-
"""骰子资产：
① AI 骨白骰 → 抠掉"假透明"棋盘格 → 透明 PNG
② 矢量骰 ×2（金质5点 / 骨白4点）—— 严格俯视、点数精确、主包零成本
"""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw
from scipy import ndimage

RAW = 'generated-images/game-start-dice-v1'
PROC = 'docs-verify/game-5/game-start/proc/dice'
os.makedirs(PROC, exist_ok=True)

# ---------- ① AI 骨白骰：去棋盘格 ----------
# 骨白那张的棋盘格是深灰两色；抽样四角取两色，色距阈值判背景，再取最大连通域
f = os.path.join(RAW, 'Photorealistic_3D_product_rend_2026-10-04T15-22-06.png')
bgr = cv2.imread(f)
H, W = bgr.shape[:2]
rgb = bgr[:, :, ::-1].astype(np.float32)
c1 = np.median(rgb[0:40, 0:40].reshape(-1, 3), 0)
c2 = np.median(rgb[0:40, 40:80].reshape(-1, 3), 0)
d1 = np.linalg.norm(rgb - c1, axis=-1)
d2 = np.linalg.norm(rgb - c2, axis=-1)
bg = (np.minimum(d1, d2) < 26)
fg = ~bg
fg = ndimage.binary_fill_holes(fg)
fg = ndimage.binary_opening(fg, np.ones((5, 5)))
lb, n = ndimage.label(fg)
if n:
    sizes = ndimage.sum(fg, lb, range(1, n + 1))
    fg = (lb == (int(np.argmax(sizes)) + 1))
alpha = (fg * 255).astype(np.uint8)
alpha = cv2.GaussianBlur(alpha, (5, 5), 0)
ys, xs = np.where(alpha > 8)
bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
pad = 12
bx0, by0 = max(0, bx0 - pad), max(0, by0 - pad)
bx1, by1 = min(W - 1, bx1 + pad), min(H - 1, by1 + pad)
out = np.dstack([rgb[by0:by1 + 1, bx0:bx1 + 1], alpha[by0:by1 + 1, bx0:bx1 + 1]]).astype(np.uint8)
im1 = Image.fromarray(out, 'RGBA')
side = max(im1.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(im1, ((side - im1.size[0]) // 2, (side - im1.size[1]) // 2), im1)
sq.resize((1024, 1024), Image.LANCZOS).save(os.path.join(PROC, 'dice_bone_ai_1024.png'))
sq.resize((320, 320), Image.LANCZOS).save(os.path.join(PROC, 'dice_bone_ai_320.png'))
print('① AI 骨白骰抠图完成  原始色 c1=%s c2=%s  不透明占比 %.1f%%'
      % (c1.astype(int), c2.astype(int), (alpha > 128).mean() * 100))


# ---------- ② 矢量骰 ----------
def vgrad(size, c1, c2):
    w, h = size
    a = np.array(c1, float); b = np.array(c2, float)
    t = np.linspace(0, 1, h)[:, None, None]
    arr = np.repeat(a[None, None, :] * (1 - t) + b[None, None, :] * t, w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), 'RGB')


def rrmask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=r, fill=255)
    return m


def pip_sheet(px, mode):
    """生成一颗凸起圆点：外圈暗 → 主体色 → 左上高光。"""
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if mode == 'gold':
        ring, body, hi = (150, 104, 26), (233, 186, 74), (255, 246, 214)
    else:
        ring, body, hi = (150, 38, 26), (216, 67, 47), (255, 158, 138)
    d.ellipse([0, 0, px - 1, px - 1], fill=ring + (255,))
    k = int(px * .10)
    d.ellipse([k, k, px - 1 - k, px - 1 - k], fill=body + (255,))
    h2 = int(px * .45)
    d.ellipse([px * .18, px * .14, px * .18 + h2, px * .14 + h2], fill=hi + (255,))
    return im


def make_die(kind):
    C = 1024
    canvas = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    S = 700                                    # 顶面边长
    rad = int(S * .17)
    face_xy = ((C - S) // 2, int(C * .085))
    th = 34                                    # 侧壁厚度（右下）
    # 侧壁
    if kind == 'gold':
        wall = vgrad((S, S), (120, 82, 22), (74, 48, 12))
        face_c1, face_c2 = (255, 232, 158), (168, 118, 34)
        panel_c1, panel_c2 = (253, 247, 232), (238, 226, 199)
        pip_mode = 'gold'
    else:
        wall = vgrad((S, S), (198, 188, 166), (150, 140, 118))
        face_c1, face_c2 = (250, 244, 230), (216, 206, 184)
        panel_c1, panel_c2 = (252, 248, 238), (240, 232, 214)
        pip_mode = 'red'
    wall_img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    wall_img.paste(wall, (0, 0), rrmask((S, S), rad))
    canvas.alpha_composite(wall_img, (face_xy[0] + th, face_xy[1] + th))

    # 顶面
    face = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    face.paste(vgrad((S, S), face_c1, face_c2), (0, 0), rrmask((S, S), rad))
    # 内嵌面板
    ins = int(S * .115)
    pw = S - ins * 2
    panel = Image.new('RGBA', (pw, pw), (0, 0, 0, 0))
    panel.paste(vgrad((pw, pw), panel_c1, panel_c2), (0, 0), rrmask((pw, pw), int(pw * .13)))
    # 点阵
    faces = {'gold': [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],   # 5
             'red': [[.28, .28], [.72, .28], [.28, .72], [.72, .72]]}              # 4
    px = int(pw * .215)
    pip = pip_sheet(px, pip_mode)
    pd = ImageDraw.Draw(panel)
    for fx, fy in faces[kind]:
        cxp, cyp = int(pw * fx), int(pw * fy)
        panel.alpha_composite(pip, (cxp - px // 2, cyp - px // 2))
    # 面板内阴影（凹槽感）
    sh = Image.new('RGBA', (pw, pw), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([0, 0, pw - 1, pw - 1], radius=int(pw * .13),
                                         outline=(120, 100, 60, 90), width=6)
    panel.alpha_composite(sh)
    face.alpha_composite(panel, (ins, ins))
    # 顶面左上高光边
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle([2, 2, S - 3, S - 3], radius=rad,
                                         outline=(255, 250, 230, 150), width=4)
    face.alpha_composite(hl)
    canvas.alpha_composite(face, face_xy)
    return canvas


for kind, name in (('gold', 'dice_vec_gold5'), ('red', 'dice_vec_bone4')):
    die = make_die(kind)
    die.save(os.path.join(PROC, name + '_1024.png'))
    die.resize((320, 320), Image.LANCZOS).save(os.path.join(PROC, name + '_320.png'))
    aa = np.asarray(die)[:, :, 3]
    ys, xs = np.where(aa > 8)
    print('② %s  %dx%d  不透明区 bbox %dx%d  尺寸 %dKB'
          % (name, *die.size, xs.max() - xs.min() + 1, ys.max() - ys.min() + 1,
             os.path.getsize(os.path.join(PROC, name + '_1024.png')) // 1024))

# 预览拼图：AI 骨白 / 矢量金 / 矢量骨白
sheet = Image.new('RGB', (320 * 3 + 40 * 4, 320 + 40 * 2), (11, 41, 32))
for i, nm in enumerate(['dice_bone_ai_320.png', 'dice_vec_gold5_320.png', 'dice_vec_bone4_320.png']):
    t = Image.open(os.path.join(PROC, nm)).convert('RGBA').resize((320, 320), Image.LANCZOS)
    sheet.paste(t, (40 + i * (320 + 40), 40), t)
sheet.save(os.path.join(PROC, 'dice_compare.png'))
print('骰子对照图 dice_compare.png')
