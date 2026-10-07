#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 47 轮 · 失败吉祥物三方案：**抠底 + 画幅归一化**

【为什么需要这一步（两条都是实测踩出来的）】
 ① `ImageGen` 的 `background:"transparent"` **不生效**：回传的是 `RGB`（mode 不是 RGBA），
    四角像素 `(254,255,255)` —— 白底。必须自己抠。
 ② 出图是 **1024×1024 方图**，而游戏里的吉祥物位按 `RESULT.MASCOT_W = 240`
    + **素材宽高比** 反算高（`MASCOT_H = 240 / (960/875)`）。宽高比一变，结算卡的
    版式会整体错位。所以必须归一化回**与 `splash/mascot.png` 同画幅（960×875）
    且主体占比一致**，三个方案才**互相可比**、也才**能直接替换**。

【抠底口径】背景是"近白 + 中性"（RGB 三通道都 ≥244 且极差 ≤10）。
  ⚠️ **不能只用阈值**：角色本体是奶油白（约 247,240,225），最亮的高光也会接近白。
  ⇒ 用「**从四边泛洪**」：只有**与画布边缘连通**的近白区才算背景；
    被本体包住的亮高光（不与边缘连通）自然保留。这一步是关键，别改回纯阈值。

【画幅归一化口径】以**主体高度占画幅的比例**对齐到基准图（`splash/mascot.png`），
  底边贴齐、水平居中。这样"角色在卡里多大"与原图一致，换上去不会忽大忽小。

用法：
    python3 tools/r47-fail-mascot-prep.py
产出（与 ai-raw 同级）：
    fail-A.png / fail-B.png / fail-C.png      ← 归一化后的 960×875 透明 PNG
    _metrics.json                             ← 给验收板读的量测
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.ndimage import binary_fill_holes, distance_transform_edt, gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
REF = os.path.join(PROJ, 'assets/resources/splash/mascot.png')
OUT = os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'ui', 'fail-mascot-r47')
RAW = os.path.join(OUT, 'ai-raw')

# 出图的三张（按时间戳排序 = A/B/C 的生成顺序）
RAW_FILES = [
    ('A', '委屈巴巴（含泪）', 'Image_to_image_edit__This_is_a_2026-10-07T01-04-16.png'),
    ('B', '垂头丧气（叹气）', 'Image_to_image_edit__This_is_a_2026-10-07T01-05-01.png'),
    ('C', '懊恼不甘（抱头）', 'Image_to_image_edit__This_is_a_2026-10-07T01-05-21.png'),
]

# 抠底判据（实测标定，见文件头）
BG_MIN_CH = 244          # 三通道最小值 ≥ 244
BG_SPREAD = 10           # 通道极差 ≤ 10（中性色）
ALPHA_EDGE = 8           # 判主体 bbox 时的 alpha 阈值（躲开抗锯齿尾巴）


def subject_mask_from_alpha(rgba):
    a = np.asarray(rgba)[..., 3]
    return a > ALPHA_EDGE


def bbox_of(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def matte(path):
    """近白底 → 透明。返回 (RGBA float 0~1, 主体 mask)。"""
    im = Image.open(path).convert('RGB')
    rgb = np.asarray(im).astype(np.float64)
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    bg_like = (mn >= BG_MIN_CH) & ((mx - mn) <= BG_SPREAD)

    # ★ 关键步：只把**与画布边缘连通**的近白区判成背景。
    #   `binary_fill_holes` 反过来用：先把 bg_like 里"被本包住的亮高光"填掉，
    #   剩下与边缘连通的才是真背景。
    lbl, n = ndimage.label(bg_like)
    border_labels = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border_labels.discard(0)
    bg_outer = np.isin(lbl, list(border_labels)) if border_labels else np.zeros_like(bg_like)

    subj = ~bg_outer
    subj = binary_fill_holes(subj)
    # 只留最大连通域（去掉零星噪点碎片）
    lbl2, n2 = ndimage.label(subj)
    if n2 > 1:
        sizes = ndimage.sum(subj, lbl2, range(1, n2 + 1))
        subj = lbl2 == (int(np.argmax(sizes)) + 1)

    # 边缘羽化
    alpha = np.clip(gaussian_filter(subj.astype(np.float64), 1.1), 0.0, 1.0)

    # 去白边：把"半透明外圈"的颜色换成**最近的实心内部像素**的颜色。
    # 不做这一步，深绿卡面上会看到一圈白晕（白底混色残留）。
    solid = ndimage.binary_erosion(subj, iterations=2)
    if not solid.any():
        solid = subj
    _, idx = distance_transform_edt(~solid, return_indices=True)
    col = rgb[idx[0], idx[1]] / 255.0

    out = np.zeros(rgb.shape[:2] + (4,), np.float64)
    out[..., :3] = col
    out[..., 3] = alpha
    return out, subj


def resize_rgba(arr, size):
    """预乘 alpha 重采样 —— 直接对 RGBA 做 LANCZOS 会在边缘渗进黑边。"""
    h, w = arr.shape[:2]
    a = arr[..., 3]
    p = arr[..., :3] * a[..., None]
    pi = Image.fromarray(np.clip(p * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB')
    ai = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    p2 = np.asarray(pi.resize(size, Image.LANCZOS)).astype(np.float64) / 255.0
    a2 = np.asarray(ai.resize(size, Image.LANCZOS)).astype(np.float64) / 255.0
    out = np.zeros((size[1], size[0], 4), np.float64)
    nz = a2 > 1e-4
    out[..., 3] = a2
    for c in range(3):
        out[..., c][nz] = np.clip(p2[..., c][nz] / a2[nz], 0, 1)
    return out


def red_pixels(arr, roi=None):
    """通道比值法数"红"（不要用 HSV 色相带 —— 会把翡翠绿判成蓝，见项目判据 2）。"""
    c = arr[..., :3] * 255.0
    a = arr[..., 3]
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    m = (R > G * 1.45) & (R > B * 1.35) & (R > 80) & (a > 0.5)
    if roi:
        x0, y0, x1, y1 = roi
        q = np.zeros_like(m)
        q[y0:y1, x0:x1] = True
        m = m & q
    return int(m.sum())


def main():
    ref_im = Image.open(REF).convert('RGBA')
    CW, CH = ref_im.size
    ref_mask = subject_mask_from_alpha(ref_im)
    rx0, ry0, rx1, ry1 = bbox_of(ref_mask)
    ref_h = ry1 - ry0
    ref_h_ratio = ref_h / CH
    ref_bottom_gap = CH - ry1
    ref_w = rx1 - rx0

    metrics = {
        'canvas': [CW, CH],
        'ref': {
            'bbox': [rx0, ry0, rx1, ry1],
            'subj_w': ref_w, 'subj_h': ref_h,
            'h_ratio': round(ref_h_ratio, 4),
            'bottom_gap': ref_bottom_gap,
            'red_px': red_pixels(np.asarray(ref_im).astype(np.float64) / 255.0),
        },
        'variants': [],
    }

    for key, cn, fn in RAW_FILES:
        src = os.path.join(RAW, fn)
        arr, subj = matte(src)
        x0, y0, x1, y1 = bbox_of(subj)
        sw, sh = x1 - x0, y1 - y0

        # 目标：主体高 = 基准图的主体高（同画幅、同占比）
        target_h = ref_h
        scale = target_h / sh
        target_w = max(1, int(round(sw * scale)))

        crop = arr[y0:y1, x0:x1]
        crop_r = resize_rgba(crop, (target_w, target_h))

        canvas = np.zeros((CH, CW, 4), np.float64)
        px = int(round((CW - target_w) / 2))
        py = CH - ref_bottom_gap - target_h      # 底边与基准图对齐
        if py < 0:                                # 太高就上顶裁掉（理论上不会）
            py = 0
        canvas[py:py + target_h, px:px + target_w] = crop_r

        out_im = Image.fromarray(np.clip(canvas * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
        out_path = os.path.join(OUT, f'fail-{key}.png')
        out_im.save(out_path)

        nb = bbox_of(subject_mask_from_alpha(out_im))
        m = {
            'key': key, 'cn': cn, 'file': f'fail-{key}.png',
            'raw': [sw, sh], 'raw_aspect': round(sw / sh, 4),
            'out_bbox': list(nb),
            'out_subj': [nb[2] - nb[0], nb[3] - nb[1]],
            'h_ratio': round((nb[3] - nb[1]) / CH, 4),
            'bottom_gap': CH - nb[3],
            'red_px': red_pixels(canvas),
        }
        metrics['variants'].append(m)
        print(f"[{key}] {cn}")
        print(f"    原始主体 {sw}×{sh} (宽高比 {sw/sh:.3f}) → 输出主体 "
              f"{m['out_subj'][0]}×{m['out_subj'][1]}  高占比 {m['h_ratio']:.4f} (基准 {ref_h_ratio:.4f})")
        print(f"    红像素 {m['red_px']}（基准 {metrics['ref']['red_px']}）  bbox {m['out_bbox']}")
        print(f"    → {out_path}")

    # 变异检查（尺度类判据，见生图技能 14 条）：主体高度必须与基准一致
    hset = {v['h_ratio'] for v in metrics['variants']}
    print()
    print(f"尺度一致性：三方案高占比 = {sorted(hset)}  (基准 {ref_h_ratio:.4f})  偏差 "
          f"{max(abs(h - ref_h_ratio) for h in hset) * 100:.2f}%")

    with open(os.path.join(OUT, '_metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print(f"量测已写入 {os.path.join(OUT, '_metrics.json')}")


if __name__ == '__main__':
    main()
