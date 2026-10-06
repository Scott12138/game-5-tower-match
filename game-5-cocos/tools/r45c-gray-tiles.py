#!/usr/bin/env python
#
#  r45c-gray-tiles.py · 被压牌「方案 C · 灰阶」贴图生成
#  ============================================================
#  用户第 45 轮拍板：被压牌用**方案 C（灰阶）**。
#  方案页里 C 的 CSS 口径 = `grayscale(.9) brightness(.66) contrast(.95)`。
#
#  【为什么不用运行时滤镜】
#   Cocos 的 `Sprite.color` 是**逐通道乘法**，只能整体压暗，**降不了饱和度**：
#   把 (190,60,50) 的红墨乘 0.66 得到 (125,40,33)，饱和度仍是 0.74 —— 红还是红。
#   3.8.8 也没有内置的 gray-sprite 材质（`effects/for2d/` 只有 spine / sprite /
#   sprite-renderer 三个）。所以走**离线烘贴图**：颜色改动一次算清，运行时零开销、
#   零风险，且与方案页看到的效果逐字节一致。
#
#  【分辨率取舍 —— 实测数据决策】
#    scale 1.00 RGBA = 2.30 MB（87 KB/张）  纹理 224×298，真机物理 188×252 ⇒ 1.19× 过采样
#    scale 0.75 RGBA = 1.45 MB（54 KB/张）  纹理 168×224 ⇒ **0.89×**，仍够锐  ← 取这档
#    scale 0.50 RGBA = 0.68 MB（25 KB/张）  纹理 112×149 ⇒ 1.69× 会被放大，会糊
#    同一档换 LA（colorType 4）还能再省一半，但灰度+alpha 属于"少见 PNG 格式"，
#    微信小游戏的解码链路没在我们这边验证过，**不拿格式做赌注**。
#  用法：python tools/r45c-gray-tiles.py [--scale 0.75] [--out-dir <目录>] [--dry-run]
# ============================================================
import argparse
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TILE_ROOT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'bundles', 'game', 'tiles'))
SUITS = ('wan', 'tiao', 'tong')

# 方案 C 的三个参数（与方案页 CSS 一一对应）
GS = 0.90
BRI = 0.66
CON = 0.95


def luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])


def to_dead(arr: np.ndarray) -> np.ndarray:
    """RGBA → 被压灰阶 RGBA"""
    rgb = arr[..., :3].astype(np.float32)
    a = arr[..., 3]
    g = luma(rgb)[..., None]
    rgb = rgb * (1.0 - GS) + g * GS          # grayscale(.9)
    rgb = rgb * BRI                          # brightness(.66)
    rgb = (rgb - 127.5) * CON + 127.5        # contrast(.95)
    out = np.dstack([np.clip(rgb, 0, 255), a]).astype(np.uint8)
    return out


def sat_of(im: Image.Image) -> float:
    """整图平均饱和（max-min)/max —— 用于回报\"灰得够不够\"，只看不透明像素"""
    arr = np.array(im.convert('RGBA')).astype(np.float32)
    m = arr[..., 3] > 200
    if not m.any():
        return 0.0
    px = arr[m][:, :3]
    mx = px.max(axis=1)
    mn = px.min(axis=1)
    mx[mx == 0] = 1
    return float(((mx - mn) / mx).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=float, default=0.75,
                    help='输出缩放（0.75 默认 / 1.0 全尺寸 / 0.5 半尺寸）')
    ap.add_argument('--out-dir', default=None, help='输出目录（默认与源图同目录）')
    ap.add_argument('--dry-run', action='store_true', help='只算体积，不落盘')
    args = ap.parse_args()

    if not os.path.isdir(TILE_ROOT):
        print(f'找不到牌面目录：{TILE_ROOT}', file=sys.stderr)
        return 1

    total = 0
    sat_before = sat_after = 0.0
    n = 0
    print(f'{"牌":<8}{"源":<12}{"输出":<12}{"源KB":>7}{"新KB":>7}  饱和 前→后')
    for suit in SUITS:
        d = os.path.join(TILE_ROOT, suit)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith('.png') or '_dead' in name:
                continue
            src = os.path.join(d, name)
            im = Image.open(src).convert('RGBA')
            before = sat_of(im)
            dead = to_dead(np.array(im))
            out_img = Image.fromarray(dead, 'RGBA')
            if args.scale != 1.0:
                out_img = out_img.resize(
                    (max(1, round(im.width * args.scale)), max(1, round(im.height * args.scale))),
                    Image.LANCZOS)

            out_dir = args.out_dir or d
            os.makedirs(out_dir, exist_ok=True)
            dst = os.path.join(out_dir, name.replace('.png', '_dead.png'))
            if not args.dry_run:
                out_img.save(dst, optimize=True)
            size = os.path.getsize(dst) if os.path.exists(dst) else 0

            after = sat_of(out_img)
            total += size
            sat_before += before
            sat_after += after
            n += 1
            print(f'{name[:-4]:<8}{str(im.size):<12}{str(out_img.size):<12}'
                  f'{os.path.getsize(src)//1024:>7}{size//1024:>7}  {before:.3f} → {after:.3f}')

    if not n:
        print('没有找到牌面 png', file=sys.stderr)
        return 1
    print(f'\n合计 {n} 张 · 新增 {total/1024/1024:.2f} MB'
          f'（平均 {total//n//1024} KB/张）')
    print(f'平均饱和：{sat_before/n:.3f} → {sat_after/n:.3f}'
          f'（降到 {(sat_after/sat_before*100) if sat_before else 0:.0f}%）')
    print('scale=%.2f  %s' % (args.scale, '（dry-run，未落盘）' if args.dry_run else ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
