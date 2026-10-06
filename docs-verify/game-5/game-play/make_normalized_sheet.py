#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""归一化后 27 张 · 验收板（第 28 轮 A2 建立 → **第 33 轮按 224×298 口径重做**）

⚙ 第 33 轮变更：画布 `192×256 → 224×298`、占位口径 `OCC_H 0.804 → 1.0`（**内切 contain**）。
  因此"每张占宽恒 75.0%"这条旧判据**已作废** —— 内切下**宽或高必有一边贴满**：
    · 条 / 筒（18 张）→ 高 100%、宽 90.6~93.3%
    · 万字（9 张）    → 宽 100%、高 91.6~100%（**两处除外**：一万 93.3% / 六万 90.6%，
                        这两张 bw/bh 偏窄，走的是贴高）

板面构成：
  ① 主矩阵：27 张（wan / tiao / tong 各一行）**叠在深绿牌桌底色上** —— 证明"抠底干净"：
     若抠底不到位，四角会出现白色/暖灰方块。
  ② 每张下方标注 **占宽/占高 %**（`W1 93/100`）—— 让"万字宽窄不一"（L3）**可见**。
  ③ 行尾给出该花色的 min / max / spread + 面积极差 + 判定。
  ④ 板尾给出「内切不变量」自检：**每张至少一条边贴满画布**。

⚠ 标注一律 ASCII（PIL 默认位图字体渲染中文会成豆腐块 —— 本项目既有纪律）。

用法：python make_normalized_sheet.py
产出：docs-verify/game-5/game-play/64-牌面归一化-224x298-验收板.png
"""
import os, glob
import numpy as np
from PIL import Image, ImageDraw

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
DST = os.path.join(ROOT, 'assets/game-play/tiles')
OUT = os.path.join(ROOT, 'docs-verify/game-5/game-play', '64-牌面归一化-224x298-验收板.png')
SPE = [('wan', 'WAN', 'W'), ('tiao', 'TIAO', 'T'), ('tong', 'TONG', 'G')]
FELT = (12, 38, 27)
BG = (238, 238, 234)
CONCERN = (168, 60, 40)      # 极差过大的警示色
GOOD = (28, 92, 64)

CW, CH = 150, 200            # 每格牌显示尺寸（224×298 等比缩，比例 0.750）
PAD, LAB, HEAD = 16, 28, 84


def tile_alpha_bbox(path):
    """返回 (画布 w,h, alpha 前景 bbox 宽, 高)。"""
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    a = np.asarray(im.split()[3])
    cols = np.where((a > 8).any(axis=0))[0]
    rows = np.where((a > 8).any(axis=1))[0]
    if not len(cols) or not len(rows):
        return W, H, 0, 0
    return W, H, int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1)


def main():
    rows = []
    for sp, tag, pre in SPE:
        fs = sorted(glob.glob(os.path.join(DST, sp, '*.png')))
        rows.append((tag, pre, fs))

    ncol = max(len(fs) for _, _, fs in rows)
    panelW, panelH = CW + PAD, CH + PAD
    cellW, cellH = panelW + 10, panelH + LAB + 10
    W = 46 + ncol * cellW + 210
    H = HEAD + len(rows) * cellH + 96
    c = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(c)

    d.text((46, 22), 'GAME-5  TILE NORMALIZE CHECK  --  27 tiles @2x 224x298', fill=(20, 60, 40))
    d.text((46, 40), 'felt-green backdrop => alpha(clear-cut) check ;   W1 93/100 = occW% / occH%', fill=(96, 106, 100))
    d.text((46, 58), 'mode = CONTAIN (OCC_H=1.0): every tile must touch >=1 canvas edge.  wan spread => L3, deferred.', fill=(96, 106, 100))

    invariants_ok = True
    for ri, (tag, pre, fs) in enumerate(rows):
        occws, occhs, areas, edges = [], [], [], []
        for ci, f in enumerate(fs):
            Wc, Hc, bw, bh = tile_alpha_bbox(f)
            occw, occh = bw / Wc * 100, bh / Hc * 100
            occws.append(occw); occhs.append(occh); areas.append(bw * bh)
            touch = (bw >= Wc - 2) or (bh >= Hc - 2)
            edges.append(touch)
            if not touch:
                invariants_ok = False

            im = Image.open(f).convert('RGBA').resize((CW, CH), Image.LANCZOS)
            x = 46 + ci * cellW
            y = HEAD + ri * cellH
            panel = Image.new('RGB', (panelW, panelH), FELT)
            panel.paste(im, ((panelW - CW) // 2, (panelH - CH) // 2), im)
            c.paste(panel, (x, y))
            col = (30, 70, 50) if touch else CONCERN
            d.text((x + 2, y + panelH + 5),
                   '%s%d %.0f/%.0f' % (pre, ci + 1, occw, occh), fill=col)

        sw, sh = max(occws) - min(occws), max(occhs) - min(occhs)
        amin, amax = min(areas), max(areas)
        sa = (amax - amin) / amax * 100
        # 内切下"占宽"对万字天然无意义（7 张恒 100%）→ 以占高极差与面积极差共同判定
        worst = max(sw, sh)
        col = GOOD if worst <= 3 else (CONCERN if worst > 6 else (150, 110, 30))
        verdict = 'OK' if worst <= 3 else ('MISMATCH' if worst > 6 else 'MINOR')
        tx = 46 + ncol * cellW + 8
        ty = HEAD + ri * cellH
        for k, line in enumerate(['%s  %d tiles' % (tag, len(fs)),
                                  'occW %.1f ~ %.1f' % (min(occws), max(occws)),
                                  'occH %.1f ~ %.1f' % (min(occhs), max(occhs)),
                                  'spreadW %.1f' % sw,
                                  'spreadH %.1f' % sh,
                                  'area spread %.1f%%' % sa,
                                  verdict]):
            d.text((tx, ty + k * 16), line, fill=col if k >= 5 else (60, 70, 64))

    d.text((46, HEAD + len(rows) * cellH + 16),
           'INVARIANT (contain): every tile touches >=1 edge  ->  %s'
           % ('PASS' if invariants_ok else 'FAIL'), fill=GOOD if invariants_ok else CONCERN)
    d.text((46, HEAD + len(rows) * cellH + 34),
           'canvas uniform 224x298 for all 27  ->  CSS scales per level (0.786~1.0), single spec', fill=(60, 70, 64))
    d.text((46, HEAD + len(rows) * cellH + 52),
           'if clear-cut failed you would see white/warm-grey squares in the felt corners.', fill=(96, 106, 100))

    c.save(OUT)
    print('产出：%s  %dx%d' % (OUT, c.width, c.height))
    print('内切不变量（每张至少贴一边）：%s' % ('PASS ✅' if invariants_ok else 'FAIL ❌'))
    for tag, pre, fs in rows:
        occws, occhs, areas = [], [], []
        for f in fs:
            Wc, Hc, bw, bh = tile_alpha_bbox(f)
            occws.append(bw / Wc * 100); occhs.append(bh / Hc * 100); areas.append(bw * bh)
        sa = (max(areas) - min(areas)) / max(areas) * 100
        print('  %-5s occW %.1f~%.1f (spread %.1f) · occH %.1f~%.1f (spread %.1f) · 面积极差 %.1f%%'
              % (tag, min(occws), max(occws), max(occws) - min(occws),
                 min(occhs), max(occhs), max(occhs) - min(occhs), sa))


if __name__ == '__main__':
    main()
