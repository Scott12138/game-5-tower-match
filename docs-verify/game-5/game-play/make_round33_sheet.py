#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 33 轮交付板（L1 画布 224×298 / L2 WebP / L4 OCC_H=1.0）

四个区块：
  A 占位口径对照：**把两个画布的"外框"画出来**，直接看牌体在画布里占多大（旧 75.0%/80.5% vs 新 92.9%/100%）
  B 新母版 27 张矩阵 + 逐花色占宽/占高/面积极差（万字 MISMATCH = L3，用户已决定暂不处理）
  C L2 体积对账：逐目录 PNG vs WebP（q=92）+ 主包 4096 KB 达标判定
  D 数值对照表：旧口径 vs 新口径

⚠ 标注一律 ASCII（PIL 默认位图字体渲染中文会成豆腐块）。

用法：python3 make_round33_sheet.py
产出：docs-verify/game-5/game-play/65-第33轮-L1L2L4-交付板.png
"""
import os, glob
import numpy as np
from PIL import Image, ImageDraw

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
OLD = os.path.join(ROOT, 'assets/game-play/tiles-192x256-bak')
NEW = os.path.join(ROOT, 'assets/game-play/tiles')
OUT = os.path.join(ROOT, 'docs-verify/game-5/game-play', '65-第33轮-L1L2L4-交付板.png')
SPE = [('wan', 'WAN', 'W', '万'), ('tiao', 'TIAO', 'T', '条'), ('tong', 'TONG', 'G', '筒')]
FELT = (12, 38, 27)
BG = (240, 240, 236)
GREY = (150, 150, 146)
DARK = (34, 44, 38)
GOOD = (28, 92, 64)
WARN = (168, 60, 40)
BLUE = (40, 78, 130)

W, H = 1500, 1034


def abbox(p):
    im = Image.open(p).convert('RGBA')
    a = np.asarray(im.split()[3])
    cols = np.where((a > 8).any(axis=0))[0]
    rows = np.where((a > 8).any(axis=1))[0]
    if not len(cols) or not len(rows):
        return im.size[0], im.size[1], 0, 0
    return im.size[0], im.size[1], int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1)


def dashed(d, box, color, dash=6, gap=4, width=1):
    x0, y0, x1, y1 = box
    for x in range(x0, x1, dash + gap):
        d.line([x, y0, min(x + dash, x1), y0], fill=color, width=width)
        d.line([x, y1, min(x + dash, x1), y1], fill=color, width=width)
    for y in range(y0, y1, dash + gap):
        d.line([x0, y, x0, min(y + dash, y1)], fill=color, width=width)
        d.line([x1, y, x1, min(y + dash, y1)], fill=color, width=width)


def size_of(fs):
    return sum(os.path.getsize(f) for f in fs)


def main():
    c = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(c)

    d.text((46, 24), 'GAME-5   ROUND-33   DELIVERY SHEET', fill=DARK)
    d.text((46, 42), 'L1 master canvas 192x256 -> 224x298 (re-export from src, NO re-draw)  |  L2 WebP  |  L4 OCC_H 0.804 -> 1.0 (contain)', fill=(96, 106, 100))
    d.text((46, 60), 'L3 (wan shape mismatch) = DEFERRED by user.   contain fit => zero clipping, verified on all 27 tiles.', fill=(96, 106, 100))

    # ───────── A 占位口径对照 ─────────
    d.text((46, 92), 'A.  PLACEMENT OCCUPANCY   old vs new   (dashed = asset canvas, solid = visible tile body)', fill=BLUE)
    for i, (dirp, tag, note) in enumerate([
            (OLD, 'OLD', 'canvas 192x256   body 144x206   75.0% / 80.5%'),
            (NEW, 'NEW', 'canvas 224x298   body 208x298   92.9% / 100.0%')]):
        x = 60 + i * 300
        y = 116
        cw, ch = 150, 200
        d.rectangle([x, y, x + cw, y + ch], fill=(250, 250, 248))
        im = Image.open(os.path.join(dirp, 'tiao', '一条.png')).convert('RGBA').resize((cw, ch), Image.LANCZOS)
        felt = Image.new('RGB', (cw, ch), FELT)
        felt.paste(im, (0, 0), im)
        c.paste(felt, (x, y))
        dashed(d, (x, y, x + cw, y + ch), (220, 90, 60) if i == 0 else GOOD)
        d.text((x, y + ch + 8), '%s   %s' % (tag, note), fill=(DARK if i else (150, 70, 50)))
    d.text((660, 130), 'visible body AREA / layout box  =  0.750 x 0.8047 = 60.3%  ->  0.9286 x 1.0000 = 92.9%', fill=DARK)
    d.text((660, 150), '(the tile body filled +54% more of its box: much denser pile, matches game-4 look)', fill=(96, 106, 100))
    d.text((660, 178), 'BODY_W 144/192 = 0.7500   ->   208/224 = 0.9286', fill=DARK)
    d.text((660, 196), 'BODY_H 206/256 = 0.8047   ->   298/298 = 1.0000', fill=DARK)
    d.text((660, 224), 'why contain: literal "height=canvas" makes the widest wan tile 244.9px > 224px canvas', fill=WARN)
    d.text((660, 242), '=> 7 wan tiles would be CLIPPED (up to 20.9px of pixels lost). contain = only lossless reading.', fill=WARN)
    d.text((660, 270), 'side effect (good): 27-tile visible-AREA spread is only 8.8%  (vs 15.1% if clipped to equal height)', fill=GOOD)
    d.text((660, 288), 'and tiao/tong 208x298  ==  178.3x255.5 on a 192 canvas  ==  the "179x256" you quoted.', fill=GOOD)

    # ───────── B 27 张矩阵 ─────────
    d.text((46, 336), 'B.  NEW MASTER 27 TILES   (224x298, contain fit)', fill=BLUE)
    TW, TH = 54, 72
    for ri, (sp, tag, pre, cn) in enumerate(SPE):
        fs = sorted(glob.glob(os.path.join(NEW, sp, '*.png')))
        occw, occh, ar = [], [], []
        for ci, f in enumerate(fs):
            cw, ch, bw, bh = abbox(f)
            occw.append(bw / cw * 100); occh.append(bh / ch * 100); ar.append(bw * bh)
            x = 60 + ci * (TW + 10)
            y = 356 + ri * 100
            pic = Image.open(f).convert('RGBA').resize((TW, TH), Image.LANCZOS)
            pan = Image.new('RGB', (TW, TH), FELT)
            pan.paste(pic, (0, 0), pic)
            c.paste(pan, (x, y))
        sw, sh = max(occw) - min(occw), max(occh) - min(occh)
        sa = (max(ar) - min(ar)) / max(ar) * 100
        col = GOOD if max(sw, sh) <= 3 else (WARN if max(sw, sh) > 6 else (150, 110, 30))
        ver = 'OK' if max(sw, sh) <= 3 else ('MISMATCH  <- L3, deferred' if max(sw, sh) > 6 else 'MINOR')
        tx = 60 + 9 * (TW + 10) + 14
        ty = 356 + ri * 100
        d.text((tx, ty + 2), '%s  %d tiles' % (tag, len(fs)), fill=col)
        d.text((tx, ty + 18), 'occW %.1f ~ %.1f  (spread %.1f)' % (min(occw), max(occw), sw), fill=(70, 80, 74))
        d.text((tx, ty + 34), 'occH %.1f ~ %.1f  (spread %.1f)' % (min(occh), max(occh), sh), fill=(70, 80, 74))
        d.text((tx, ty + 50), 'area spread %.1f%%' % sa, fill=(70, 80, 74))
        d.text((tx, ty + 66), ver, fill=col)

    # ───────── C L2 体积对账 ─────────
    d.text((46, 668), 'C.  L2  PACKAGE SIZE   PNG vs WebP q=92   (originals untouched - md5 verified)', fill=BLUE)
    groups = [
        ('game-play/tiles', glob.glob(os.path.join(NEW, '**', '*.png'), recursive=True),
         glob.glob(os.path.join(ROOT, 'assets/game-play/tiles-webp/**/*.webp'), recursive=True)),
        ('game-play/rule page', [os.path.join(ROOT, 'assets/game-play/rule-完整规则页.png')],
         [os.path.join(ROOT, 'assets/game-play-webp/rule-完整规则页.webp')]),
        ('home', glob.glob(os.path.join(ROOT, 'assets/home/**/*.png'), recursive=True),
         glob.glob(os.path.join(ROOT, 'assets/home-webp/**/*.webp'), recursive=True)),
        ('game-start', glob.glob(os.path.join(ROOT, 'assets/game-start/**/*.png'), recursive=True),
         glob.glob(os.path.join(ROOT, 'assets/game-start-webp/**/*.webp'), recursive=True)),
        ('splash', glob.glob(os.path.join(ROOT, 'assets/splash/**/*.png'), recursive=True),
         glob.glob(os.path.join(ROOT, 'assets/splash-webp/**/*.webp'), recursive=True)),
    ]
    ty = 692
    d.text((60, ty), '%-22s %-7s %-13s %-13s %-9s %s' % ('dir', 'files', 'PNG KB', 'WebP KB', 'ratio', 'saved KB'), fill=(70, 80, 74))
    tot_p = tot_w = 0
    for i, (nm, ps, ws) in enumerate(groups):
        sp_, sw_ = size_of(ps), size_of(ws)
        tot_p += sp_; tot_w += sw_
        d.text((60, ty + 18 + i * 17), '%-22s %-7d %-13.1f %-13.1f %-9s %.1f'
               % (nm, len(ps), sp_ / 1024, sw_ / 1024, '%.0f%%' % (sw_ / sp_ * 100 if sp_ else 0),
                  (sp_ - sw_) / 1024), fill=(50, 60, 54))
    yy = ty + 18 + len(groups) * 17
    d.text((60, yy), '%-22s %-7s %-13.1f %-13.1f %-9s %.1f'
           % ('TOTAL', '', tot_p / 1024, tot_w / 1024, '%.0f%%' % (tot_w / tot_p * 100),
              (tot_p - tot_w) / 1024), fill=DARK)
    d.text((60, yy + 22), 'budget 4096 KB  =>  PNG %.0f KB (%s)   |   WebP %.0f KB (%s)   =>   PLAN: ship WebP'
           % (tot_p / 1024, 'OVER' if tot_p > 4096 * 1024 else 'OK', tot_w / 1024,
              'OVER' if tot_w > 4096 * 1024 else 'OK'), fill=GOOD)
    d.text((760, ty), 'WebP q=92 quality evidence (visible pixels only, alpha>8):', fill=BLUE)
    d.text((760, ty + 18), 'tiles 3290.6 KB -> 469.0 KB (14%)', fill=(50, 60, 54))
    d.text((760, ty + 35), 'visible max channel diff 67  /  mean 2.58  /  PSNR 36.4 dB', fill=(50, 60, 54))
    d.text((760, ty + 52), 'displayed at HALF size (112x149 from 224x298) => imperceptible', fill=(96, 106, 100))
    d.text((760, ty + 76), 'rollback: delete the *-webp dirs, point refs back to *.png. Nothing was overwritten.', fill=GOOD)

    # ───────── D 数值对照 ─────────
    d.text((46, 848), 'D.  VALUE TABLE   old vs new', fill=BLUE)
    rows = [
        ('master canvas', '192 x 256', '224 x 298'),
        ('body (tiao/tong)', '144 x 206', '208 x 298'),
        ('occW / occH', '75.0% / 80.5%', '92.9% / 100.0%'),
        ('body area / box', '60.3%', '92.9%'),
        ('scaling mode', 'height fixed', 'contain (min of w,h)'),
        ('CSS scale per level', 'n/a (self-made)', 'w/112  = 1.000 ~ 0.786'),
        ('27-tile PNG total', '1690.3 KB', '3290.6 KB  ->  469.0 KB (webp)'),
        ('package total', '~4952 KB (OVER)', '1115.6 KB (OK, 27% of 4096)'),
        ('clipping', 'none (safe)', 'none (contain, 27/27 verified)'),
    ]
    for i, (k, a, b) in enumerate(rows):
        y = 872 + i * 17
        d.text((60, y), '%-22s %-24s %s' % (k, a, b), fill=(50, 60, 54))

    c.save(OUT)
    print('产出：%s  %dx%d' % (OUT, c.width, c.height))
    print('  区块B 逐花色：')
    for sp, tag, pre, cn in SPE:
        fs = sorted(glob.glob(os.path.join(NEW, sp, '*.png')))
        occw, occh, ar = [], [], []
        for f in fs:
            cw, ch, bw, bh = abbox(f)
            occw.append(bw / cw * 100); occh.append(bh / ch * 100); ar.append(bw * bh)
        print('    %-5s occW %.1f~%.1f · occH %.1f~%.1f · 面积极差 %.1f%%'
              % (tag, min(occw), max(occw), min(occh), max(occh), (max(ar) - min(ar)) / max(ar) * 100))


if __name__ == '__main__':
    main()
