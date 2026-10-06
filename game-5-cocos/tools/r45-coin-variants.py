#!/usr/bin/env python
#
#  r45-coin-variants.py · 结算页金币雨「放大一倍 + 虚化」三版本试样
#  ============================================================
#  来源：`assets/resources/splash/coin.png` 112×104（金币雨现用素材，现显示 34 设计 px）。
#  目标：显示尺寸 **34 → 68 设计 px**（放大一倍），并轻微虚化。
#
#  ⚠️ 放大上限（判据 14）：1 设计 px = 1264/750 = 1.6853 物理 px
#     ⇒ 112 源 px 的 1:1 上限 = 112 / 1.6853 = **66.5 设计 px**。
#     目标 68 略超 1.5 px（≈2.3%），属可接受范围；若后续要更大必须换更大源图。
#
#  【为什么要先把 RGB 扩散再模糊】
#    PNG 的透明区里 RGB 是 0（黑）。直接对 RGBA 做高斯模糊，边缘会把"黑"拉进来，
#    出来一圈脏暗边（在深色结算蒙层上尤其明显）。所以先按 alpha 把 RGB 往透明区
#    **迭代扩散**，让边缘之外也是"金色"，再模糊，就干净了。
#
#  输出：每版 PNG
#     · 方案页对照用：`--out-size 204`（= 68 设计 px × 3）→ docs-verify/.../assets/coin-{a,b,c}.png
#     · **工程实装用**：`--out-size 136 --only b --game b` → 资源 `splash/coin_rain.png`
#       （68 设计 px × 2 = 136；真机物理是 68×1.6853 = 114.6，所以 136 是 1.19× 过采样）
#       ⚠️ 半径按画布等比缩放（`k = out_size / 204`），否则"缩了画布没缩半径"会把观感改掉。
#
#  用法：python tools/r45-coin-variants.py <输出目录> [--out-size N] [--only a|b|c] [--game a|b|c]
# ============================================================
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), '..', 'assets', 'resources', 'splash', 'coin.png')
OUT_SIZE = 204                      # 默认 = 68 设计 px × 3（方案页对照用）
OUT_DIR = '.'                       # 由 main 覆盖
PAD = 40                            # 模糊用的留白（最后裁掉）


def spread_rgb(rgb: np.ndarray, a: np.ndarray, rounds: int = 24) -> np.ndarray:
    """把不透明区域的颜色向外扩散填满透明区（避免模糊时拖出黑边）"""
    out = rgb.astype(np.float32).copy()
    for _ in range(rounds):
        avg = (np.roll(out, 1, 0) + np.roll(out, -1, 0)
               + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 4.0
        hole = (a < 0.5)
        out = np.where(hole[..., None], avg, out)
    return out


def variant(name, radius, glow=0.0, alpha=1.0, gain=1.0):
    im = Image.open(SRC).convert('RGBA')
    im = im.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    # ★ 必须留白再模糊：硬币几乎撑满画幅，贴着边做高斯会把 alpha 扩散到画布外被裁掉，
    #   出来是一圈**方形硬边**（第 45 轮第一版试样就长这样）。留 40px 余量后裁回即可。
    big = Image.new('RGBA', (OUT_SIZE + PAD * 2, OUT_SIZE + PAD * 2), (0, 0, 0, 0))
    big.paste(im, (PAD, PAD))
    im = big

    arr = np.array(im)
    rgb = arr[..., :3].astype(np.float32)
    a = arr[..., 3].astype(np.float32) / 255.0

    rgb = spread_rgb(rgb, a)
    base = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8), 'RGBA')

    if glow > 0:
        g = base.filter(ImageFilter.GaussianBlur(glow))
        ga = np.array(g)[..., 3].astype(np.float32) / 255.0
        # 光晕只取"外扩出来的那一圈"，本体仍用清晰版
        halo = np.clip(ga - a, 0, 1) * 0.75
        grgb = np.array(g)[..., :3].astype(np.float32)
        grgb[:, :, 0] = np.clip(grgb[:, :, 0] * 1.18 + 26, 0, 255)   # 暖金
        grgb[:, :, 1] = np.clip(grgb[:, :, 1] * 1.10 + 16, 0, 255)
        grgb[:, :, 2] = np.clip(grgb[:, :, 2] * 0.90, 0, 255)
        comp = Image.alpha_composite(Image.fromarray(np.dstack([grgb, halo * 255]).astype(np.uint8), 'RGBA'), base)
        base = comp

    if radius > 0:
        blurred = base.filter(ImageFilter.GaussianBlur(radius))
        ba = np.array(blurred)[..., 3].astype(np.float32) / 255.0
        brgb = np.array(blurred)[..., :3].astype(np.float32) * gain
        # 模糊会把 alpha 抹开 ⇒ 按能量归一，避免整体变淡
        out = np.dstack([np.clip(brgb, 0, 255), np.clip(ba * alpha * 255, 0, 255)])
        base = Image.fromarray(out.astype(np.uint8), 'RGBA')

    base = base.crop((PAD, PAD, PAD + OUT_SIZE, PAD + OUT_SIZE))
    dst = os.path.join(OUT_DIR, f'coin-{name}.png')
    base.save(dst, optimize=True)
    # 量：不透明像素占比 + 平均 alpha（给页面写参数用）
    aa = np.array(base)[..., 3].astype(np.float32) / 255.0
    print(f'  {name:10s} blur={radius:4.1f} glow={glow:4.1f} alpha={alpha:.2f} '
          f'→ {dst}  {base.size}  覆盖率 {aa.mean():.3f}')
    return dst


if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument('out', help='输出目录')
    ap.add_argument('--out-size', type=int, default=OUT_SIZE,
                    help=f'输出边长 px（默认 {OUT_SIZE}）。模糊半径按画布等比缩放，保证观感不变。')
    ap.add_argument('--only', default=None, choices=['a', 'b', 'c'], help='只出某一版')
    ap.add_argument('--game', default=None, choices=['a', 'b', 'c'],
                    help='把该版复制成工程资源 resources/splash/coin_rain.png')
    a = ap.parse_args()
    out = a.out
    globals()['OUT_DIR'] = out
    os.makedirs(out, exist_ok=True)
    print('源：', os.path.normpath(SRC))

    # 模糊半径按画布等比缩放：半径是"画布像素"口径，缩画布不缩半径 = 观感变了
    k = a.out_size / OUT_SIZE
    globals()['OUT_SIZE'] = a.out_size
    specs = {
        'a': dict(radius=1.6),
        'b': dict(radius=3.6, alpha=0.95),
        'c': dict(radius=6.6, glow=10.0, alpha=0.90),
    }
    picked = [a.only] if a.only else ['a', 'b', 'c']
    for name in picked:
        s = dict(specs[name])
        s['radius'] = s.get('radius', 0.0) * k
        s['glow'] = s.get('glow', 0.0) * k
        variant(name, **s)

    if a.game:
        import shutil
        src_png = os.path.join(out, f'coin-{a.game}.png')
        dst_png = os.path.normpath(os.path.join(
            os.path.dirname(__file__), '..', 'assets', 'resources', 'splash', 'coin_rain.png'))
        shutil.copyfile(src_png, dst_png)
        print(f'  → 写入工程资源 {dst_png}  ({os.path.getsize(dst_png)//1024} KB)')
