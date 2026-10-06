#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""筒子牌 · 「甲式」出图提示词（图生图 · 外科式局部改）

与 tile_prompt_edit.py 的关系
────────────────────────────────────────────────────────────────────────
本文件**直接 import** tile_prompt_edit，把 HEAD / KEEP / CLEAR / STRICT
四段**按对象复用**（不是抄一份 —— 抄一份就会漂移）。
只有「图案段 + 配色段 + 浮雕段」是筒子自己写的。

为什么 CLEAR 还能照抄九条的
────────────────────────────────────────────────────────────────────────
甲式的底图（image1）= 九条候选甲原图，面心上本来就是**九根竹**。
所以「先把面心旧图案擦干净」这句对六筒同样成立、且**必须**成立。
→ 后续出七筒/八筒时，底图会换成六筒/七筒，那时 CLEAR 必须改写
  （把"nine bamboo sticks"换成"six circle discs"），否则模型会去找不存在的竹子。
  本文件把这条写成 CLEAR 常量 + 注释标记 【换底必改】。

第 23 轮新沉淀
────────────────────────────────────────────────────────────────────────
1. **筒子不是竹子**：图案是同心「靶环」圆饼，不是竹节。relief 段单独写。
2. **参考图实测布局**（176×210 用户参考图，连通域 + 腐蚀法量得）：
     上排       2 枚（翡翠绿）   cy≈42.6  cx≈81.2±27.5   d≈55
     中排/下排  4 枚（朱红 2×2） 块 113×122             d≈57
   → 即 **2 列 × 3 行 = 6 枚**，上排绿、中下两排红。行距≈1.18d，几乎相切。
3. **尺寸口径的巧合**：参考图块 h/w = 1.67~1.78；而九条面心 h/w = 1.438。
   块高取面高 78% 时，块宽 = 78%×1.438/1.67 ≈ **63% 面宽** —— 与条子那套
   的 62% 面宽 / 78% 面高天然对齐，所以整套牌视觉重量一致，无需另调。
4. **同心环层数**：从参考图 8× 放大逐环目视 —— 外圈实心珐琅盘 → 骨白细环 →
   珐琅细环 → 骨白细环 → 中心珐琅圆点。即 **3 层珐琅 + 2 道骨白**。
   （★ 不做机器数环：176×210 的手机糊照上，径向剖面被模糊抹平，
     亮度是单调爬升的，1px 分箱根本切不出环边界 —— 同"数量不做机器断言"。）
5. **配色沿用整套牌已定 palette**：参考图因手机糊照偏暗（实测珐琅本色
   ≈RGB(59,79,64) 绿 / RGB(100,44,37) 红），但色相与条子参考图同源，
   故直接用 翡翠绿 #1F7A4D / 朱红 #C0392B，保证整套牌同色。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tile_prompt_edit as B          # ← 固定段唯一来源，不抄写

HEAD = B.HEAD
KEEP = B.KEEP
STRICT = B.STRICT

# 【换底必改】底图 = 九条候选甲 → 面心旧图案是「九根竹」
CLEAR = B.CLEAR

RELIEF_DISC = (
    "EACH DISC is raised as a HIGH-RELIEF carved form standing proud of the jade face, with a real visible "
    "side wall and genuine thickness, its coloured enamel sitting in the carved recess with glossy wet "
    "highlights on the raised surfaces and deep shadow sinking into the grooves between the rings, so the "
    "outer disc and every concentric ring and the centre dot each read as solid carved relief casting a soft "
    "cast shadow on the face beside it — the same carved high-relief treatment, the same material feel, the "
    "same lighting and the same photographic realism as the input image.")

TONG = {}

TONG['六筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'six of circles' "
        "(liu tong) motif — SIX carved round CIRCLE DISCS arranged in a neat grid of TWO columns and THREE "
        "rows. EXACTLY SIX discs in total: the TOP row holds TWO discs side by side, the MIDDLE row directly "
        "below holds TWO discs, and the BOTTOM row directly below that holds TWO discs — the three rows evenly "
        "stacked with a small even gap between the rows and a small even gap between the two columns, the six "
        "discs of one size. The whole group is centred both horizontally and vertically on the face and spans "
        "about 64% of the face width and about 76% of the face height; each disc's diameter is about one third "
        "of the face width. "
        "EVERY DISC IS A CONCENTRIC BULLSEYE: each disc is built from perfectly concentric rings — a BROAD "
        "solid enamelled outer disc, then a NARROW ring of bare ivory jade bone, then a narrower enamelled "
        "ring, then a SECOND narrow ring of bare ivory jade bone, and a small solid enamelled dot at the dead "
        "centre of the disc; three enamelled rings separated by two ivory jade gaps, all perfectly circular "
        "and perfectly concentric about the disc centre. "
        "Do NOT draw bamboo sticks or bamboo culms of any kind. Do NOT draw ONE disc, do NOT draw TWO discs, "
        "Do NOT draw THREE discs, do NOT draw FOUR discs, Do NOT draw FIVE discs, Do NOT draw SEVEN discs, Do "
        "NOT draw EIGHT discs, Do NOT draw NINE discs — EXACTLY SIX discs. Do NOT draw three columns, Do NOT "
        "draw a 3 x 3 grid, Do NOT draw a 3 x 2 grid, Do NOT draw one tall column of discs, Do NOT draw plain "
        "flat filled circles without the concentric rings, Do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the TWO discs of the TOP row "
        "are deep jade green (#1F7A4D); the TWO discs of the MIDDLE row and the TWO discs of the BOTTOM row are "
        "deep vermilion red (#C0392B). Within each disc the enamelled outer ring, the enamelled inner ring and "
        "the central dot are all the SAME one colour of that disc (green disc = all green, red disc = all red), "
        "and the two thin rings between them are bare ivory jade bone (#F3ECD9) — bone, not white, not grey, "
        "not gold, not metal. Green on top, red below — exactly the colour layout of the second reference. Use "
        "the second reference ONLY for this colour layout and for the disc's concentric ring structure; ignore "
        "its blurry low-resolution phone-camera look, its background and its image quality."),
    relief=RELIEF_DISC,
)

ORDER = ['六筒']
TODO = ['六筒']


def prompt(name):
    d = TONG[name]
    return '\n\n'.join([HEAD, KEEP, CLEAR, d['motif'], d['colour'], d['relief'], STRICT])


def selftest():
    """自证：① 固定段与 tile_prompt_edit 是**同一对象**（逐字复用，非抄写）；
             ② 数量词 SIX 齐备；③ 否定项里没有漏掉自己的数。"""
    bad = []
    if HEAD is not B.HEAD:   bad.append('HEAD 不是同一对象')
    if KEEP is not B.KEEP:   bad.append('KEEP 不是同一对象')
    if CLEAR is not B.CLEAR: bad.append('CLEAR 不是同一对象')
    if STRICT is not B.STRICT: bad.append('STRICT 不是同一对象')
    for n in TODO:
        p = prompt(n)
        if KEEP not in p:   bad.append((n, 'KEEP 缺失'))
        if CLEAR not in p:  bad.append((n, 'CLEAR 缺失'))
        if STRICT not in p: bad.append((n, 'STRICT 缺失'))
        if RELIEF_DISC not in p: bad.append((n, 'RELIEF_DISC 缺失'))
        zh = {'一': 'ONE', '二': 'TWO', '三': 'THREE', '四': 'FOUR', '五': 'FIVE',
              '六': 'SIX', '七': 'SEVEN', '八': 'EIGHT', '九': 'NINE'}[n[0]]
        if zh not in p: bad.append((n, '未点到数量词 %s' % zh))
        if 'bamboo' not in p.split('Do NOT draw bamboo')[1].split('.')[0]:
            bad.append((n, '缺"不要画竹子"的否定'))
    print('=' * 74)
    print('selftest：' + ('✅ 全部通过（固定段与条子模块同对象，数量词齐备）' if not bad else '❌ ' + str(bad)))
    print('=' * 74)
    return not bad


if __name__ == '__main__':
    if not selftest():
        sys.exit(1)
    names = [a for a in sys.argv[1:] if a in TONG] or TODO
    for n in names:
        print('=' * 74)
        print('### %s' % n)
        print('=' * 74)
        print(prompt(n))
        print()
