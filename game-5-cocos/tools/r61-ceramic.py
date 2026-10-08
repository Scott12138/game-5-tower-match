#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r61-ceramic.py · 「陶瓷麻将牌」入库管线（第 61 轮）

════════════════ 用户需求 ════════════════
「读取桌面『万筒条风』文件夹，依次打开『万子 / 条子 / 筒子』三个文件夹，仅提取其中的牌面图片文件，
  使用 rembg 工具抠图，抠出合适的牌面，将其封装成套，存入资产库并命名为『陶瓷麻将牌』，
  随后用这套新牌面替换当前正在使用的牌面；并把旧的整套（万 / 条 / 筒）收入资产库命名为『玉石麻将牌』。」

════════════════ ★ 抠图口径：用户当轮**明确改口** ════════════════
长期规则是「抠图一律 rembg」。但本轮实测：**这批素材本身已经是抠好的** ——
27 张全部自带 alpha（背景 α=0、牌体 α=255、`0<α<255` 的像素约 0.0~0.4% ⇒ 近乎二值硬边），
而 rembg 重抠会把它们切坏（实测 IoU：万 0.966 / **条 0.080** / 筒 0.982 或 0.439）：
根因是**条 / 筒是白瓷面，其透明区底下的 RGB 也是白的**（255,255,255）⇒ 压白底后白牌与白底
不可分，只有 alpha 通道知道牌在哪。报给用户后，用户当场拍板：
    「抠好了，就直接替换进去试试看」
⇒ 本轮**直接采用素材自带 alpha 定 bbox**，全程不调用 rembg。

════════════════ 落盘三处（缺一不可）════════════════
  A 源图库（设计母版，不进包）  <root>/assets/_src/game-play/tiles/<suit>/<中文数字><花色>.png   ← 裁切后全尺寸 RGBA
  B 成品库（工程版 @2x）        <root>/assets/game-play/tiles/<suit>/<中文数字><花色>.png        ← 224×298
  C 运行期 bundle               <proj>/assets/bundles/game/tiles/<suit>/<suit><n>.png              ← 224×298
    ⚠️ C 处**必须保留同名 .meta**（UUID 不变，引用才不断）—— 本脚本只覆盖 png，不碰 .meta。
  D 灰阶「被压」版由既有 `r45c-gray-tiles.py` 重烘（不在本脚本内重复实现）。
  另：命名套装库 <root>/assets/_src/game-play/tile-sets/{陶瓷麻将牌,玉石麻将牌}/

用法：
  python tools/r61-ceramic.py --probe          # 三花色各 1 张体检，不入库
  python tools/r61-ceramic.py --archive-old    # 把当前在用的整套归档为「玉石麻将牌」
  python tools/r61-ceramic.py                  # 全量 27 张入库（A/B/C）
  python tools/r61-ceramic.py --sets           # 生成/刷新命名套装目录（陶瓷 source+product）
"""
import argparse
import glob
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.normpath(os.path.join(HERE, '..'))      # game-5-cocos/
ROOT = os.path.normpath(os.path.join(PROJ, '..'))      # 工作区根

SRC_BASE = os.path.expanduser('~/Desktop/万筒条风')
A_ROOT = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles')          # A 源图库
B_ROOT = os.path.join(ROOT, 'assets', 'game-play', 'tiles')                 # B 成品库
C_ROOT = os.path.join(PROJ, 'assets', 'bundles', 'game', 'tiles')           # C 运行期 bundle
SET_ROOT = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-sets')   # 命名套装库

# (bundle 代号, 桌面文件夹名, 中文花色, 牌面中文名后缀)
SUITS = [
    ('wan',  '万子', '万', '万'),
    ('tiao', '条子', '条', '条'),
    ('tong', '筒子', '筒', '筒'),
]
CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

CANVAS_W, CANVAS_H = 224, 298     # ★ 第 33 轮口径（= 最大关牌位 112×149 @2x）
OCC_H = 1.0                       # ★ 内切：k = min(W/bw, H*OCC_H/bh)
TRIM = 8                          # alpha 阈值（定 bbox 用）


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
    """RGBA 缩放：RGB 用 LANCZOS、alpha 单独 LANCZOS —— 避免预乘色偏，并顺带得到抗锯齿软边。"""
    rgb = im.convert('RGB').resize(size, Image.LANCZOS)
    a = im.split()[3].resize(size, Image.LANCZOS)
    out = rgb.convert('RGBA')
    out.putalpha(a)
    return out


def src_path(suit_key, n):
    for key, folder, _cn, _sfx in SUITS:
        if key == suit_key:
            return os.path.join(SRC_BASE, folder, f'{n}_{suit_key}.png')
    raise KeyError(suit_key)


def process_one(suit_key, cn, sfx, n):
    src = src_path(suit_key, n)
    if not os.path.exists(src):
        print(f'  ❌ 缺源图：{src}')
        return None
    rgba = Image.open(src).convert('RGBA')
    bb = bbox_of(rgba)
    if bb is None:
        print(f'  ❌ {cn}{sfx}：alpha 全空')
        return None
    master = rgba.crop(bb)
    bw, bh = master.size
    tw, th = fit_contain(bw, bh)
    assert tw <= CANVAS_W and th <= CANVAS_H, f'内切失败：{tw}x{th} 超出画布'
    small = resize_rgba(master, (tw, th))
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ox, oy = (CANVAS_W - tw) // 2, (CANVAS_H - th) // 2
    canvas.paste(small, (ox, oy))
    return dict(suit=suit_key, n=n, cn=cn, sfx=sfx, src=src,
                master=master, canvas=canvas, bbox=bb,
                bw=bw, bh=bh, tw=tw, th=th, ox=ox, oy=oy, ratio=bw / bh)


def probe():
    print('── probe：三花色各 1 张，不入库 ──')
    picks = [('wan', '一', '万', 1), ('tiao', '二', '条', 2), ('tong', '一', '筒', 1)]
    outdir = '/tmp/r61-check'
    os.makedirs(outdir, exist_ok=True)
    tiles = []
    for key, cn, sfx, n in picks:
        r = process_one(key, cn, sfx, n)
        if not r:
            continue
        print(f'  {cn}{sfx}  源 {Image.open(r["src"]).size}  bbox {r["bbox"]} → 母版 {r["bw"]}x{r["bh"]}  '
              f'内切 {r["tw"]}x{r["th"]}（占宽 {r["tw"]/CANVAS_W*100:.1f}% · 占高 {r["th"]/CANVAS_H*100:.1f}%）'
              f'  长宽比 {r["ratio"]:.4f}')
        tiles.append(r)
    # 拼一张体检板：深绿桌底 + 3 倍 NEAREST 放大
    if tiles:
        pad, sc = 12, 3
        W = (CANVAS_W * len(tiles) + pad * (len(tiles) + 1)) * sc
        H = (CANVAS_H + pad * 2) * sc
        board = Image.new('RGB', (W, H), (12, 38, 27))
        for i, r in enumerate(tiles):
            big = r['canvas'].resize((CANVAS_W * sc, CANVAS_H * sc), Image.NEAREST)
            board.paste(big, ((pad + i * (CANVAS_W + pad)) * sc, pad * sc), big)
        p = os.path.join(outdir, 'probe-3suits.png')
        board.save(p)
        print(f'  体检板（3 倍 · 叠深绿桌底）→ {p}')
    return 0


# ─────────────────────────── 归档旧整套 ───────────────────────────
def archive_old():
    set_dir = os.path.join(SET_ROOT, '玉石麻将牌')
    src_dir, prod_dir = os.path.join(set_dir, 'source'), os.path.join(set_dir, 'product')
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(prod_dir, exist_ok=True)
    print(f'── archive-old：当前在用的整套 → {set_dir}')
    moved = copied = 0
    for key, _folder, _cn, _sfx in SUITS:
        a = os.path.join(A_ROOT, key)
        if os.path.isdir(a):
            dst = os.path.join(src_dir, key)
            if os.path.exists(dst):
                print(f'  ⚠️ 目标已存在，跳过移动 A/{key}（避免覆盖已有归档）')
            else:
                shutil.move(a, dst)
                cnt = sum(len(f) for _, _, f in os.walk(dst))
                moved += cnt
                print(f'  A 源图  {key}/  整体移入（{cnt} 件，含 _old2d / rejected 留痕）')
        b = os.path.join(B_ROOT, key)
        if os.path.isdir(b):
            os.makedirs(os.path.join(prod_dir, key), exist_ok=True)
            k = 0
            for f in sorted(os.listdir(b)):
                if f.endswith('.png'):
                    shutil.copy2(os.path.join(b, f), os.path.join(prod_dir, key, f))
                    k += 1
            copied += k
            print(f'  B 成品  {key}/  {k} 张复制归档')
    print(f'  ⇒ 源图移动 {moved} 件 · 成品复制 {copied} 张')
    return 0


# ─────────────────────────── 命名套装：陶瓷 ───────────────────────────
def build_ceramic_set():
    set_dir = os.path.join(SET_ROOT, '陶瓷麻将牌')
    src_dir, prod_dir = os.path.join(set_dir, 'source'), os.path.join(set_dir, 'product')
    os.makedirs(src_dir, exist_ok=True)
    os.makedirs(prod_dir, exist_ok=True)
    print(f'── sets：陶瓷麻将牌 → {set_dir}')
    ns = nc = 0
    for key, folder, cn_suit, sfx in SUITS:
        os.makedirs(os.path.join(src_dir, key), exist_ok=True)
        os.makedirs(os.path.join(prod_dir, key), exist_ok=True)
        for i, cn in enumerate(CN, 1):
            s = src_path(key, i)
            if os.path.exists(s):
                shutil.copy2(s, os.path.join(src_dir, key, f'{i}_{key}.png'))
                ns += 1
            b = os.path.join(B_ROOT, key, f'{cn}{sfx}.png')
            if os.path.exists(b):
                shutil.copy2(b, os.path.join(prod_dir, key, f'{cn}{sfx}.png'))
                nc += 1
    print(f'  原始素材 {ns} 张 · 成品 {nc} 张')
    return 0


# ─────────────────────────── 全量入库 ───────────────────────────
def import_all():
    for d in (A_ROOT, B_ROOT, C_ROOT):
        if not os.path.isdir(d):
            print(f'找不到目录：{d}', file=sys.stderr)
            return 1
    print(f'{"牌":<5}{"源图":<13}{"bbox":<26}{"母版":<12}{"内切":<10}{"占高":>7}   成品KB')
    rows = []
    for key, _folder, cn_suit, sfx in SUITS:
        bdir = os.path.join(B_ROOT, key)
        cdir = os.path.join(C_ROOT, key)
        adir = os.path.join(A_ROOT, key)
        os.makedirs(adir, exist_ok=True)
        for i, cn in enumerate(CN, 1):
            r = process_one(key, cn, sfx, i)
            if not r:
                continue
            # A 源图库：裁切后全尺寸 RGBA 母版（原始素材另存于命名套装的 source/）
            a_path = os.path.join(adir, f'{cn}{sfx}.png')
            r['master'].save(a_path, optimize=True)
            # B 成品库 224×298
            b_path = os.path.join(bdir, f'{cn}{sfx}.png')
            r['canvas'].save(b_path, optimize=True)
            # C 运行期 bundle（ASCII 名；只覆盖 png，.meta 原样保留）
            c_path = os.path.join(cdir, f'{key}{i}.png')
            assert os.path.exists(c_path + '.meta'), f'缺 .meta：{c_path}.meta（UUID 会断，停）'
            shutil.copyfile(b_path, c_path)

            sz = os.path.getsize(b_path)
            rows.append(r)
            print(f'{cn + sfx:<5}{str(Image.open(r["src"]).size):<13}{str(r["bbox"]):<26}'
                  f'{f"{r["bw"]}x{r["bh"]}":<12}{f"{r["tw"]}x{r["th"]}":<10}'
                  f'{r["th"] / CANVAS_H * 100:>6.1f}%   {sz / 1024:>6.0f}')
    if not rows:
        print('没有处理成功任何一张', file=sys.stderr)
        return 1
    tws = [r['tw'] for r in rows]
    areas = [r['tw'] * r['th'] for r in rows]
    print(f'\n共 {len(rows)} 张 · 成品合计 {sum(os.path.getsize(os.path.join(B_ROOT, r["suit"], f"{r["cn"]}{r["sfx"]}.png")) for r in rows) / 1024:.0f} KB')
    print(f'牌体宽 {min(tws)}~{max(tws)} px · 长宽比 {min(r["ratio"] for r in rows):.3f}~{max(r["ratio"] for r in rows):.3f}')
    print(f'可见面积极差 {100 * (max(areas) - min(areas)) / max(areas):.1f}%')
    print('✅ 内切保证：全部 tw≤224 且 th≤298，零裁切 · ✅ 每张 bundle .meta 均在位')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--probe', action='store_true', help='三花色各 1 张体检，不入库')
    ap.add_argument('--archive-old', action='store_true', help='当前整套归档为「玉石麻将牌」')
    ap.add_argument('--sets', action='store_true', help='生成/刷新「陶瓷麻将牌」命名套装')
    args = ap.parse_args()
    if args.probe:
        return probe()
    if args.archive_old:
        return archive_old()
    if args.sets:
        return build_ceramic_set()
    return import_all()


if __name__ == '__main__':
    raise SystemExit(main())
