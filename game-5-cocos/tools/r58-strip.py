#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r58-strip.py · 在截图上按**像素矩形**取一条竖带，均分成 N 段，打印每段均值 RGB。

【为什么需要它（第 57 轮三）】
  「道具商城弹窗背景完全透明」这件事**必须在像素上量**：
  节点树、`fillColor`、computed style 全都"看着正常"，只有画面知道真相。
  而 CDP 的 `Page.captureScreenshot` 只能给出 PNG ⇒ 需要一个解码端。

【为什么不用页面里 `canvas.getContext('2d').drawImage(canvas)` 读回】
  游戏画布是 WebGL，**没有开 `preserveDrawingBuffer`** ⇒ 合成之后缓冲区就没了，
  读回来是一整片透明黑（实测 (0,0,0,255)），看着像"全黑"，与真实画面毫无关系。
  截图走的是**合成器**，绕过这个限制 —— 所以判据只能建在截图上。

【用法】
  python3 tools/r58-strip.py <png> <x> <y> <w> <h> <bands>
  输出 JSON：{"w":…,"h":…,"bands":[{"i":0,"r":…,"g":…,"b":…}, …]}
  ⚠️ 坐标是**图片像素**（不是 CSS px、不是设计 px）—— 调用方自己换算。
  越界会**直接退出 2**，绝不"截断后照常输出"（静默截断是最难查的一类）。
"""
import json
import sys

from PIL import Image


def main() -> int:
    #  argv = [脚本, png, x, y, w, h, bands] ⇒ 共 7 个
    if len(sys.argv) != 7:
        print(__doc__)
        return 2
    png = sys.argv[1]
    x, y, w, h, bands = (int(v) for v in sys.argv[2:7])
    if bands < 1:
        print('bands 必须 >= 1', file=sys.stderr)
        return 2

    im = Image.open(png).convert('RGB')
    W, H = im.size
    if x < 0 or y < 0 or w < 1 or h < 1 or x + w > W or y + h > H:
        print(f'取样矩形越界：({x},{y},{w},{h}) 图片 {W}x{H}', file=sys.stderr)
        return 2

    px = im.load()
    band_h = h / bands
    out = []
    for i in range(bands):
        y0 = int(round(y + band_h * i))
        y1 = max(y0 + 1, int(round(y + band_h * (i + 1))))
        sr = sg = sb = n = 0
        for yy in range(y0, y1):
            for xx in range(x, x + w):
                r, g, b = px[xx, yy]
                sr += r
                sg += g
                sb += b
                n += 1
        out.append({'i': i, 'r': round(sr / n, 1), 'g': round(sg / n, 1), 'b': round(sb / n, 1)})

    print(json.dumps({'w': W, 'h': H, 'bands': out}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
