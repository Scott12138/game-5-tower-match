#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r60-wan3d.py · 万子牌「3D 写实版」入库管线（第 60 轮）

════════════════ 用户需求 ════════════════
「读取桌面『万子』文件夹，将里面的万字牌 PNG 文件也录入到资产库，并替代当前的万字牌。」
用户补充硬约束：**所有抠图任务必须用 rembg，不得用其他工具**。

════════════════ 与既有管线（tile_normalize.py）的差异 ════════════════
旧管线为 **2D 描金扁平**牌面设计，走「边缘密度法测 bbox + 圆角遮罩 + 裁 bbox」。
新素材是 **3D 写实**牌（奶白面 + 绿色侧棱 + 柔和投影），背景**纯白 255,255,255**，
而牌面是 (244,240,237) —— **两者只差 11~18**，颜色阈值必然啃牌面；边缘密度法也因
牌体自带软边而失稳。故本脚本改走 **rembg 语义抠图 + alpha 定 bbox**：

    ① rembg(`u2netp`) 抠白底         → RGBA（软边/投影一并保留）
    ② alpha > TRIM 定 bbox           → 避开 rembg 的零星噪声像素
    ③ 内切(contain) 归一到 224×298   → 与第 33 轮口径一致（OCC_H=1.0，永不裁切）
    ④ **不加圆角遮罩**               → 3D 牌自带圆角 + 抗锯齿 alpha，再套遮罩会削掉绿棱

⭐ 为什么 bbox 取 alpha>8 而不是 alpha>0：
   实测底部剖面 alpha 由 252 平滑降到 0，跨度约 38px。alpha>0 会把「极淡尾晕」算进 bbox，
   使牌体在画布上偏小；alpha>8 已能滤掉零散噪声，且把余下 3~5px 的尾晕留在画布外沿
   （透明区，肉眼不可见）。

════════════════ 落盘三处（缺一不可）════════════════
  A 源图库（设计母版，不进包）  assets/_src/game-play/tiles/wan/<中文数字>万.png   ← 裁切后全尺寸 RGBA
  B 成品库（工程版 @2x）        assets/game-play/tiles/wan/<中文数字>万.png       ← 224×298
  C 运行期 bundle               game-5-cocos/assets/bundles/game/tiles/wan/wan<N>.png ← 224×298
    ⚠️ C 处**必须保留同名 .meta**（UUID 不变，引用才不断）—— 本脚本只覆盖 png，不碰 .meta。
  D 灰阶「被压」版由既有 `r45c-gray-tiles.py` 重烘（不在本脚本内重复实现）。

用法：
  python tools/r60-wan3d.py --probe        # 只处理 1 张并出体检数据，不入库
  python tools/r60-wan3d.py --archive      # 把旧 2D 万源图挪进 _old2d/（只跑一次）
  python tools/r60-wan3d.py               # 全量 9 张入库
"""
import argparse
import glob
import os
import re
import shutil
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.normpath(os.path.join(HERE, '..'))                 # game-5-cocos/
ROOT = os.path.normpath(os.path.join(PROJ, '..'))                 # 工作区根
SRC_DIR = os.path.expanduser('~/Desktop/万子')
SRC_MASTER = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles', 'wan')      # A
SRC_PRODUCT = os.path.join(ROOT, 'assets', 'game-play', 'tiles', 'wan')             # B
BUNDLE = os.path.join(PROJ, 'assets', 'bundles', 'game', 'tiles', 'wan')            # C

CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

CANVAS_W, CANVAS_H = 224, 298     # ★ 第 33 轮口径（= 最大关牌位 112×149 @2x）
OCC_H = 1.0                       # ★ 内切：k = min(W/bw, H*OCC_H/bh)
TRIM = 8                          # alpha 阈值（定 bbox 用）
MODEL = 'u2netp'                  # 已缓存于 ~/.u2net/u2netp.onnx（4.5MB），免下载


def cut(path):
    """rembg 抠底 → RGBA。用户硬约束：抠图只能用 rembg。"""
    from rembg import new_session, remove
    if not hasattr(cut, '_sess'):
        t0 = time.time()
        cut._sess = new_session(MODEL)
        print(f'  [rembg] session({MODEL}) 就绪 {time.time() - t0:.1f}s')
    return remove(Image.open(path).convert('RGB'), session=cut._sess, alpha_matting=False)


def bbox_of(rgba, trim=TRIM):
    a = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(a > trim)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_contain(bw, bh):
    """第 33 轮内切口径：取「宽贴满」与「高贴满」里更小的缩放比 ⇒ 永不裁切。"""
    k = min(CANVAS_W / bw, CANVAS_H * OCC_H / bh)
    return max(1, int(round(bw * k))), max(1, int(round(bh * k)))


def resize_rgba(im, size):
    """RGBA 缩放：RGB 用 LANCZOS、alpha 单独 LANCZOS —— 避免预乘色偏。"""
    rgb = im.convert('RGB').resize(size, Image.LANCZOS)
    a = im.split()[3].resize(size, Image.LANCZOS)
    out = rgb.convert('RGBA')
    out.putalpha(a)
    return out


def process_one(n):
    src = os.path.join(SRC_DIR, f'{n}_wan_raw.png')
    if not os.path.exists(src):
        return None
    t0 = time.time()
    rgba = cut(src)
    bb = bbox_of(rgba)
    if bb is None:
        print(f'  ❌ {n} 万：抠图后 alpha 全空')
        return None
    master = rgba.crop(bb)
    bw, bh = master.size
    tw, th = fit_contain(bw, bh)
    assert tw <= CANVAS_W and th <= CANVAS_H, f'内切失败：{tw}x{th} 超出画布'
    small = resize_rgba(master, (tw, th))
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ox, oy = (CANVAS_W - tw) // 2, (CANVAS_H - th) // 2
    canvas.paste(small, (ox, oy))
    return dict(n=n, src=src, master=master, canvas=canvas,
                bbox=bb, bw=bw, bh=bh, tw=tw, th=th, ox=ox, oy=oy,
                ratio=bw / bh, secs=time.time() - t0)


def probe():
    print(f'── probe：只跑 1 张，不入库（模型 {MODEL}）──')
    r = process_one(1)
    if not r:
        print('取不到素材'); return 1
    print(f'  源图     {Image.open(r["src"]).size}  {os.path.getsize(r["src"]) / 1024:.0f} KB')
    print(f'  bbox     {r["bbox"]} → 母版 {r["bw"]}x{r["bh"]}')
    print(f'  内切     {r["tw"]}x{r["th"]}  (占宽 {r["tw"] / CANVAS_W * 100:.1f}% · 占高 {r["th"] / CANVAS_H * 100:.1f}%)')
    print(f'  画布偏移 ({r["ox"]},{r["oy"]})   牌体长宽比 {r["ratio"]:.4f}   耗时 {r["secs"]:.1f}s')
    out = f'/tmp/wan-check/probe-wan1.png'
    os.makedirs('/tmp/wan-check', exist_ok=True)
    bg = Image.new('RGB', (CANVAS_W, CANVAS_H), (12, 38, 27))
    bg.paste(r['canvas'], (0, 0), r['canvas'])
    big = bg.resize((CANVAS_W * 3, CANVAS_H * 3), Image.NEAREST)
    big.save(out)
    print(f'  体检图（3 倍，叠深绿桌底）→ {out}')
    return 0


def archive_old():
    """旧 2D 万源图挪进 _old2d/ —— 不删除（记忆铁律：源图不得删除）。"""
    dst = os.path.join(SRC_MASTER, '_old2d')
    os.makedirs(dst, exist_ok=True)
    moved = 0
    for cn in CN:
        for suf in ('.png', '-raw.png'):
            p = os.path.join(SRC_MASTER, f'{cn}万{suf}')
            if os.path.exists(p):
                shutil.move(p, os.path.join(dst, os.path.basename(p)))
                moved += 1
    print(f'── archive：旧 2D 万源图 {moved} 个 → {dst}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--probe', action='store_true', help='只处理 1 张，不入库')
    ap.add_argument('--archive', action='store_true', help='把旧 2D 万源图挪进 _old2d/')
    ap.add_argument('--keep-raw', action='store_true', default=True,
                    help='把用户原始 JPEG 也归档进 _src（默认开）')
    args = ap.parse_args()

    if args.probe:
        return probe()
    if args.archive:
        return archive_old()

    os.makedirs(SRC_MASTER, exist_ok=True)
    os.makedirs(SRC_PRODUCT, exist_ok=True)
    os.makedirs(BUNDLE, exist_ok=True)

    print(f'{"万":<4}{"bbox":<26}{"母版":<12}{"内切":<10}{"占宽":>7}{"占高":>7}   {"成品KB":>7}{"母版KB":>8}')
    tot_prod = 0
    rows = []
    for i, cn in enumerate(CN, 1):
        r = process_one(i)
        if not r:
            print(f'  ❌ {cn}万 处理失败'); continue
        # A 源图库：裁切后全尺寸 RGBA；原始 JPEG 另存 -raw.jpg（保持小体积）
        a_path = os.path.join(SRC_MASTER, f'{cn}万.png')
        r['master'].save(a_path, optimize=True)
        shutil.copyfile(r['src'], os.path.join(SRC_MASTER, f'{cn}万-raw.jpg'))
        # B 成品库 224×298
        b_path = os.path.join(SRC_PRODUCT, f'{cn}万.png')
        r['canvas'].save(b_path, optimize=True)
        # C 运行期 bundle（ASCII 名；只覆盖 png，.meta 原样保留）
        c_path = os.path.join(BUNDLE, f'wan{i}.png')
        assert os.path.exists(c_path + '.meta'), f'缺 .meta：{c_path}.meta（UUID 会断，停）'
        shutil.copyfile(b_path, c_path)

        sz_p = os.path.getsize(b_path); sz_m = os.path.getsize(a_path)
        tot_prod += sz_p
        rows.append(r)
        print(f'{cn + "万":<4}{str(r["bbox"]):<26}{f"{r["bw"]}x{r["bh"]}":<12}'
              f'{f"{r["tw"]}x{r["th"]}":<10}{r["tw"] / CANVAS_W * 100:>6.1f}%{r["th"] / CANVAS_H * 100:>6.1f}%   '
              f'{sz_p / 1024:>7.0f}{sz_m / 1024:>8.0f}')

    if not rows:
        print('没有处理成功任何一张', file=sys.stderr); return 1
    tws = [r['tw'] for r in rows]
    print(f'\n共 {len(rows)} 张 · 成品合计 {tot_prod / 1024:.0f} KB')
    print(f'牌体宽度 {min(tws)}~{max(tws)} px（现有条/筒为 203~209）')
    print(f'可见面积极差 {100 * (max(t * r["th"] for t, r in zip(tws, rows)) - min(t * r["th"] for t, r in zip(tws, rows))) / max(t * r["th"] for t, r in zip(tws, rows)):.1f}%')
    print('✅ 内切保证：全部 tw≤224 且 th≤298，零裁切')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
