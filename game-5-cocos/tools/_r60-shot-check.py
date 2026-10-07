#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_r60-shot-check.py · 从主玩页截图里验「万牌真的换成了 3D 版」

为什么不在页面里读纹理像素：Cocos web 构建把牌面打进 **2048×2048 动态图集**，
`spriteFrame.texture.image` 为 **null**（纹理是原生 GL 纹理）⇒ JS 侧读不到。
所以改从**真正渲染出来的截图**上量，并且用**同一套量法打在旧素材的合成图上**
做对照 —— 没有对照，"测到新值"与"测法本身只会给新值"分不开。

── 口径（第二版；第一版的中位亮度被遮挡打死了）────────────────────
关键量 **`f210` = 矩形内「非桌底像素」中亮度 ≥210 的**占比**。

为什么它是**单调量**（这是它能当判据的全部理由）：
  · 3D 万牌是**奶白面**（实测中位亮度 236.8），旧 2D 万牌是**描金扁平**
    （实测中位亮度 163.4）⇒ 新素材 f210≈0.70，旧素材 f210≈0.08。
  · 一块牌被别的牌 / 别的花色压住时，压上来的是**深色**像素 ⇒ 只会把
    f210 **往下拖**，绝不可能凭空造出亮像素。
  · ⇒ **旧素材在「任何」遮挡下都到不了它自己未被遮挡时的 f210**。所以
    「实测最亮的一块 > 旧素材上界 + 余量」就是一个**只能由新素材满足**的
    存在性证明。反过来，per-tile 判"这块是不是新的"是**不可判**的
    （实测一块被盖 93% 的牌 f210=0.0，与旧素材同区间）—— 那类读数只报数、
    不当判据。

被否掉的尝试（留个警示，别再走一遍）：
  · 中位亮度：一块被盖 93% 的真·新牌中位掉到 163.9，与旧素材 163.4 重合 ⇒ 假红。
  · 「独占区」（本牌矩形扣掉其它牌的矩形）：露出来的恰好是**深色侧棱 + 投影**
    （实测独占区中位 89~128）⇒ 越"独占"越暗，方向反了。

用法：python tools/_r60-shot-check.py <shot.png> <rects.json> <new.png> <old.png>
输出：一行 JSON
"""
import json
import sys

import numpy as np
from PIL import Image

FELT = np.array([12, 38, 27])      # 桌底色（实测）
BRIGHT = 210                        # 「亮像素」门槛：新素材面 ≈236，旧素材面 ≈163
MIN_PX = 60                         # 少于这么多非桌底像素 ⇒ 不判（样本太小）


def metrics(rgb: np.ndarray) -> dict:
    """rgb: HxWx3 uint8；返回非桌底像素的亮度分位与亮像素占比"""
    f = rgb.reshape(-1, 3).astype(np.float64)
    m = np.abs(f - FELT).sum(1) > 45              # 排除桌底
    if m.sum() < MIN_PX:
        return {'face_lum': None, 'lum_p90': None, 'f210': None, 'n': int(m.sum())}
    px = f[m]
    lum = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
    return {
        'face_lum': float(np.median(lum)),
        'lum_p90': float(np.percentile(lum, 90)),
        'f210': float((lum >= BRIGHT).mean()),
        'n': int(m.sum()),
    }


def composite(tile_png: str, w: int, h: int) -> np.ndarray:
    """把牌面（RGBA）贴到桌底色上，尺寸 (w,h) —— 复刻引擎里的合成结果"""
    bg = Image.new('RGB', (w, h), tuple(int(v) for v in FELT))
    t = Image.open(tile_png).convert('RGBA').resize((w, h), Image.LANCZOS)
    bg.paste(t, (0, 0), t)
    return np.asarray(bg)


def main() -> int:
    shot, rects_p, new_p, old_p = sys.argv[1:5]
    page = Image.open(shot).convert('RGB')
    rects = json.load(open(rects_p, encoding='utf-8'))

    # ── 对照：同一套量法、同一尺寸，分别打在「新素材」与「旧素材」的合成图上 ──
    r0 = rects[0] if rects else {'w': 63, 'h': 84}
    w, h = max(8, int(round(r0['w']))), max(8, int(round(r0['h'])))
    ctl = {tag: metrics(composite(p, w, h)) for tag, p in (('new', new_p), ('old', old_p))}

    new_f = ctl['new']['f210'] if ctl['new']['f210'] is not None else 1.0
    old_f = ctl['old']['f210'] if ctl['old']['f210'] is not None else 0.0

    # ── 实测：截图里每一块「非被压」万牌（被压的是灰阶，本来就不该亮）──
    live = []
    for r in rects:
        if r['frame'].endswith('_dead'):
            continue
        x0 = int(round(r['x'] - r['w'] / 2)); y0 = int(round(r['y'] - r['h'] / 2))
        x1 = min(page.width, int(round(x0 + r['w']))); y1 = min(page.height, int(round(y0 + r['h'])))
        x0, y0 = max(0, x0), max(0, y0)
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue
        m = metrics(np.asarray(page.crop((x0, y0, x1, y1))))
        m.update({'frame': r['frame'], 'node': r['node'], 'rect': [x0, y0, x1, y1]})
        live.append(m)

    live_ok = [m for m in live if m['f210'] is not None]
    top = max([m['f210'] for m in live_ok] or [None])

    out = {
        'control': ctl,
        'bright_gate': BRIGHT,
        # ★ 决定性门槛 = 「旧素材**未**被遮挡时自己的 f210」+ 余量。
        #   遮挡只会更暗 ⇒ 旧素材在任何情况下都过不去 ⇒ 过了就只能是新素材。
        'ceiling': old_f + 0.20,
        # 分辨力：新素材必须是旧素材的若干倍（两侧没分开的话，后面全部结论作废）
        'control_ok': new_f >= max(0.30, old_f * 5),
        'live': live,
        'live_n': len(live_ok),
        'live_pass': sum(1 for m in live_ok if m['f210'] >= old_f + 0.20),
        'live_max': top,
        'old_f210': old_f,
        'new_f210': new_f,
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
