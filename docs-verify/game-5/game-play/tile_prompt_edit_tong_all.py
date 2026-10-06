#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""筒子牌 一~五 / 七~九 共八张 · 「甲式」出图提示词（图生图 · 外科式局部改）

与 tile_prompt_edit_tong.py 的关系
────────────────────────────────────────────────────────────────────────
tile_prompt_edit_tong.py  = **第 23 轮**（只出六筒那一张），底图是**九条候选甲**，
                           所以它的 CLEAR 是"擦掉九根竹"。
本文件                    = **第 24 轮**（出其余八张），底图换成**六筒 v4 成品原图**，
                           所以 CLEAR 必须改成"擦掉六枚圆饼"。

→ 这正是 tile_prompt_edit_tong.py 里标了【换底必改】的那一条，本轮兑现。

固定段来源（一律 import，绝不抄写）
────────────────────────────────────────────────────────────────────────
  HEAD / KEEP / STRICT  ← tile_prompt_edit.py      （第 22 轮定稿，整套牌唯一来源）
  RELIEF_DISC           ← tile_prompt_edit_tong.py （第 23 轮定稿的圆饼浮雕段）
  只有 CLEAR（随底图变）与「图案段 + 配色段」（随牌号变）写在本文件。

参考图实测（本轮用户提供的九张横排照片，1618×232）
────────────────────────────────────────────────────────────────────────
切格 + 目视逐张复核 + 颜色重心复核，得到九张的布局与配色真值：

  一筒  1 枚大盘      外环蓝 → 环绿 → 环红 → **中心是骨白空腔，没有中心点**
  二筒  竖排 1×2      上绿 / 下蓝
  三筒  斜排 ↘ 3 枚   左上绿 / 中红 / 右下蓝      （★ 是右下斜，不是左下）
  四筒  2×2           左上蓝 右上绿 左下绿 右下蓝
  五筒  X 形 5 枚     左上蓝 右上绿 **中红** 左下绿 右下蓝
  六筒  2 列 × 3 行   上排 2 绿 / 中下两排 4 红            ← 第 23 轮已出
  七筒  斜 3 绿 + 2×2 红   3 绿走左上→右下斜，4 红成方块在其下方
  八筒  2 列 × 4 行   全蓝
  九筒  3×3           上排 3 绿 / 中排 3 红 / 下排 3 蓝

尺寸口径（占**面心**宽/高的百分比，非占整牌）
────────────────────────────────────────────────────────────────────────
参考图是**普通白牌**（面心≈整块牌），而我们的牌有金框，玉面是内缩的。
故参考图上「图案 / 牌宽」≈ 我们「图案 / 玉面宽」，直接照搬即可，不另折算。
盘径一律给口径，不给像素：模型对绝对像素不敏感，对比例敏感。

★ 判据纪律：圆饼「枚数」不做机器断言（同竹节教训 —— 环槽会击穿投影/连通域法，
  实测把九条量成 7 列 21 行、把八筒的 8 枚量成 1 个大块）。枚数一律目视复核。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tile_prompt_edit as B            # ← HEAD / KEEP / STRICT 唯一来源
import tile_prompt_edit_tong as T23     # ← RELIEF_DISC 唯一来源（第 23 轮定稿）

HEAD = B.HEAD
KEEP = B.KEEP
STRICT = B.STRICT
RELIEF_DISC = T23.RELIEF_DISC

# 【换底必改】底图 = 六筒 v4 成品原图 → 面心旧图案是「六枚圆饼」
CLEAR = (
    "FIRST, ERASE the motif that is currently painted in the centre of the face — the SIX round green and red "
    "CIRCLE DISCS — completely and cleanly, leaving bare jade bone there; NOTHING of the old motif may remain, "
    "no leftover discs, no leftover rings, no leftover coloured marks, no ghost of the previous pattern.")

# ── 二~九筒 共用的「圆饼结构段」（一筒是特例，单独写） ──
DISC_STRUCTURE = (
    "EVERY DISC IS A CONCENTRIC BULLSEYE: each disc is built from perfectly concentric rings — a BROAD solid "
    "enamelled outer disc, then a NARROW ring of bare ivory jade bone, then a narrower enamelled ring, then a "
    "SECOND narrow ring of bare ivory jade bone, and a small solid enamelled dot at the dead centre of the disc; "
    "three enamelled rings separated by two ivory jade gaps, all perfectly circular and perfectly concentric "
    "about the disc centre. All the discs on this tile are the SAME size and are spaced with an even gap. ")

# ── 二~九筒 共用的「禁令尾巴」 ──
NO_BAMBOO = "Do NOT draw bamboo sticks or bamboo culms of any kind. "
REF_NOTE = ("Use the second reference ONLY for this colour layout and for the disc's concentric ring structure; "
            "ignore its blurry low-resolution phone-camera look, its background and its image quality.")


def _ban(nums):
    """把「不许画 N 枚」逐个点名 —— AI 对精确数量极不稳，必须逐项否定。"""
    return " ".join("Do NOT draw %s discs," % w for w in nums)


TONG = {}

# ══════════════════════════════════════════════════════════════════════
#  一筒 —— 特例：单枚大盘，三色同心环，中心是空的
# ══════════════════════════════════════════════════════════════════════
TONG['一筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'one of circles' "
        "(yi tong) motif — EXACTLY ONE single large carved CIRCLE DISC, centred both horizontally and vertically "
        "on the face, its diameter about 70% of the face width. This ONE disc is itself built from perfectly "
        "concentric rings: a BROAD solid enamelled OUTER ring, then a narrow ring of bare ivory jade bone, then a "
        "broad enamelled MIDDLE ring, then a narrow ring of bare ivory jade bone, then a narrower enamelled INNER "
        "ring — and the very centre of the disc is a plain bare ivory jade well, plain cream jade bone, with NO "
        "coloured dot in it. Three coloured rings separated by two ivory jade gaps, everything perfectly circular "
        "and perfectly concentric about the disc centre, and the centre stays empty. "
        "Do NOT draw a coloured dot at the centre. " + NO_BAMBOO +
        "Do NOT draw TWO discs, " + _ban(['THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']) +
        " Do NOT draw a grid of discs, do NOT draw a spiral, do NOT draw flat printed rings without any carved "
        "relief, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the broad OUTER ring is deep indigo "
        "blue (#26558C); the broad MIDDLE ring is deep jade green (#1F7A4D); the narrow INNER ring is deep "
        "vermilion red (#C0392B). The two thin rings between them and the whole centre well are bare ivory jade "
        "bone (#F3ECD9) — bone, not white, not grey, not gold, not metal. Blue outermost, then green, then red, "
        "with an empty ivory centre — exactly the colour layout of the first tile in the second reference. " + REF_NOTE),
    relief=(
        "THE SINGLE DISC and every one of its concentric rings is raised as a HIGH-RELIEF carved form standing "
        "proud of the jade face, with a real visible side wall and genuine thickness, its coloured enamel sitting "
        "in the carved recess with glossy wet highlights on the raised surfaces and deep shadow sinking into the "
        "grooves between the rings, so the outer ring, the middle ring and the inner ring each read as solid "
        "carved relief casting soft cast shadows on the face beside them — the same carved high-relief treatment, "
        "the same material feel, the same lighting and the same photographic realism as the input image."),
)

# ══════════════════════════════════════════════════════════════════════
#  二筒 —— 竖排 1×2，上绿下蓝
# ══════════════════════════════════════════════════════════════════════
TONG['二筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'two of circles' "
        "(liang tong) motif — EXACTLY TWO carved round CIRCLE DISCS arranged in ONE single VERTICAL column: one "
        "disc directly ABOVE the other on the same vertical centre line, evenly spaced with a small even gap. "
        "EXACTLY TWO discs in total — not three, not four. The pair is centred both horizontally and vertically "
        "on the face and spans about 42% of the face width and about 80% of the face height; each disc's diameter "
        "is about 40% of the face width. " + DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw ONE disc, " + _ban(['THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']) +
        " Do NOT put the two discs side by side horizontally, do NOT place them diagonally, do NOT draw one tall "
        "column of three or four discs, do NOT draw a grid, do NOT draw plain flat filled circles without the "
        "concentric rings, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the UPPER disc is deep jade green "
        "(#1F7A4D); the LOWER disc is deep indigo blue (#26558C). Within each disc the enamelled outer ring, the "
        "enamelled inner ring and the central dot are all the SAME one colour of that disc (green disc = all "
        "green, blue disc = all blue), and the two thin rings between them are bare ivory jade bone (#F3ECD9) — "
        "bone, not white, not grey, not gold, not metal. Green on top, blue below — exactly the colour layout of "
        "the second tile in the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  三筒 —— 斜排 ↘ 3 枚：左上绿 / 中红 / 右下蓝
# ══════════════════════════════════════════════════════════════════════
TONG['三筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'three of circles' "
        "(san tong) motif — EXACTLY THREE carved round CIRCLE DISCS arranged in ONE single straight DIAGONAL line "
        "that runs from the UPPER-LEFT down to the LOWER-RIGHT: the first disc sits at the upper-left, the second "
        "disc sits BELOW and TO THE RIGHT of it, and the third disc sits BELOW and FURTHER RIGHT again, all three "
        "on the same straight diagonal with even steps. EXACTLY THREE discs in total. The group is centred both "
        "horizontally and vertically on the face and spans about 70% of the face width and about 78% of the face "
        "height; each disc's diameter is about 30% of the face width. " + DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw ONE disc, Do NOT draw TWO discs, " + _ban(['FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']) +
        " Do NOT draw a straight vertical column, do NOT draw a straight horizontal row, do NOT draw an upright "
        "triangle or a pyramid, do NOT mirror the diagonal the other way, do NOT draw a grid, do NOT draw plain "
        "flat filled circles without the concentric rings, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the disc at the UPPER-LEFT is deep "
        "jade green (#1F7A4D); the MIDDLE disc is deep vermilion red (#C0392B); the disc at the LOWER-RIGHT is "
        "deep indigo blue (#26558C). Within each disc the enamelled outer ring, the enamelled inner ring and the "
        "central dot are all the SAME one colour of that disc, and the two thin rings between them are bare ivory "
        "jade bone (#F3ECD9) — bone, not white, not grey, not gold, not metal. Top-left green, centre red, "
        "bottom-right blue — exactly the colour layout of the third tile in the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  四筒 —— 2×2：对角同色（蓝主对角 / 绿副对角）
# ══════════════════════════════════════════════════════════════════════
TONG['四筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'four of circles' "
        "(si tong) motif — EXACTLY FOUR carved round CIRCLE DISCS arranged in a neat SQUARE of TWO columns and "
        "TWO rows, evenly spaced like the four spots of a square, with an even gap between the two columns and "
        "the same even gap between the two rows. EXACTLY FOUR discs in total. The square is centred both "
        "horizontally and vertically on the face and spans about 68% of the face width and about 64% of the face "
        "height; each disc's diameter is about 30% of the face width. " + DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw ONE disc, Do NOT draw TWO discs, Do NOT draw THREE discs, " +
        _ban(['FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']) +
        " Do NOT draw four discs in one horizontal row, do NOT draw four discs in one vertical column, do NOT "
        "draw a diamond, do NOT add a fifth disc in the middle, do NOT draw plain flat filled circles without "
        "the concentric rings, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the disc at the TOP-LEFT and the "
        "disc at the BOTTOM-RIGHT are deep indigo blue (#26558C); the disc at the TOP-RIGHT and the disc at the "
        "BOTTOM-LEFT are deep jade green (#1F7A4D) — a checkerboard, blue on one diagonal and green on the other. "
        "Within each disc the enamelled outer ring, the enamelled inner ring and the central dot are all the SAME "
        "one colour of that disc, and the two thin rings between them are bare ivory jade bone (#F3ECD9) — bone, "
        "not white, not grey, not gold, not metal. Exactly the colour layout of the fourth tile in the second "
        "reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  五筒 —— X 形 5 枚（四角 + 正中）
# ══════════════════════════════════════════════════════════════════════
TONG['五筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'five of circles' "
        "(wu tong) motif — EXACTLY FIVE carved round CIRCLE DISCS arranged in the classic QUINCUNX (the 'X' "
        "arrangement): FOUR discs form a square of two columns and two rows (top-left, top-right, bottom-left, "
        "bottom-right), and the FIFTH disc sits in the exact CENTRE of that square, halfway between the two "
        "columns and halfway between the two rows. EXACTLY FIVE discs in total. The group is centred both "
        "horizontally and vertically on the face and spans about 68% of the face width and about 70% of the face "
        "height; each disc's diameter is about 28% of the face width and all five are the same size. " +
        DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw ONE, TWO, THREE or FOUR discs, " +
        _ban(['SIX', 'SEVEN', 'EIGHT', 'NINE']) +
        " Do NOT draw five discs in one row, do NOT draw five discs in one column, do NOT draw five in a cross "
        "plus-shape of five, do NOT omit the centre disc, do NOT draw a grid, do NOT draw plain flat filled "
        "circles without the concentric rings, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the disc at the TOP-LEFT and the "
        "disc at the BOTTOM-RIGHT are deep indigo blue (#26558C); the disc at the TOP-RIGHT and the disc at the "
        "BOTTOM-LEFT are deep jade green (#1F7A4D); the ONE disc in the exact CENTRE is deep vermilion red "
        "(#C0392B). Within each disc the enamelled outer ring, the enamelled inner ring and the central dot are "
        "all the SAME one colour of that disc, and the two thin rings between them are bare ivory jade bone "
        "(#F3ECD9) — bone, not white, not grey, not gold, not metal. Blue on one diagonal, green on the other, "
        "red in the middle — exactly the colour layout of the fifth tile in the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  七筒 —— 斜 3 绿（左上→右下）+ 2×2 红方块在下
# ══════════════════════════════════════════════════════════════════════
TONG['七筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'seven of circles' "
        "(qi tong) motif — EXACTLY SEVEN carved round CIRCLE DISCS in TWO parts. UPPER PART: THREE discs in ONE "
        "straight DIAGONAL line running from the UPPER-LEFT down to the RIGHT — the first at the top-left, the "
        "second below and to its right, the third below and further right again, evenly stepped. LOWER PART: FOUR "
        "discs in a neat 2 x 2 SQUARE block placed DIRECTLY BELOW the diagonal, offset to the left half of the "
        "face, evenly spaced. EXACTLY SEVEN discs in total — three plus four. The whole group is centred both "
        "horizontally and vertically on the face and spans about 72% of the face width and about 88% of the face "
        "height; the three diagonal discs are slightly larger, about 30% of the face width, and the four block "
        "discs are about 28% of the face width. " + DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw SIX discs, do NOT draw EIGHT discs, do NOT draw NINE discs, do NOT draw a 3 x 3 grid, do NOT "
        "draw four discs on top and three below, do NOT draw the diagonal running the other way (top-right to "
        "bottom-left), do NOT draw all seven in one straight line, do NOT draw one column, do NOT draw plain flat "
        "filled circles without the concentric rings, do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the THREE discs of the diagonal "
        "UPPER part are ALL deep jade green (#1F7A4D); the FOUR discs of the 2 x 2 LOWER block are ALL deep "
        "vermilion red (#C0392B). Within each disc the enamelled outer ring, the enamelled inner ring and the "
        "central dot are all the SAME one colour of that disc, and the two thin rings between them are bare ivory "
        "jade bone (#F3ECD9) — bone, not white, not grey, not gold, not metal. Three green above, four red below — "
        "exactly the colour layout of the seventh tile in the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  八筒 —— 2 列 × 4 行，全蓝
# ══════════════════════════════════════════════════════════════════════
TONG['八筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'eight of circles' "
        "(ba tong) motif — EXACTLY EIGHT carved round CIRCLE DISCS arranged in a neat grid of TWO columns and "
        "FOUR rows (2 + 2 + 2 + 2 = 8), evenly spaced, with an even gap between the two columns and the same even "
        "gap between every pair of rows. EXACTLY EIGHT discs in total. The block is centred both horizontally and "
        "vertically on the face and spans about 60% of the face width and about 86% of the face height; each "
        "disc's diameter is about 26% of the face width and all eight are the same size. " + DISC_STRUCTURE +
        NO_BAMBOO +
        "Do NOT draw ONE, TWO, THREE, FOUR, FIVE, SIX or SEVEN discs, do NOT draw NINE discs, do NOT draw a 3 x 3 "
        "grid, do NOT draw FOUR columns, do NOT draw eight discs in one single row or one single column, do NOT "
        "arrange them in a diagonal pattern, do NOT draw plain flat filled circles without the concentric rings, "
        "do NOT draw any Chinese character or numeral."),
    colour=(
        "COLOUR: ALL EIGHT discs are deep indigo blue (#26558C), every one of them. Within each disc the "
        "enamelled outer ring, the enamelled inner ring and the central dot are all the SAME deep indigo blue, "
        "and the two thin rings between them are bare ivory jade bone (#F3ECD9) — bone, not white, not grey, not "
        "gold, not metal; absolutely no green, no red. This is exactly the colour layout of the eighth tile in "
        "the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

# ══════════════════════════════════════════════════════════════════════
#  九筒 —— 3×3：上绿 / 中红 / 下蓝
# ══════════════════════════════════════════════════════════════════════
TONG['九筒'] = dict(
    motif=(
        "CHANGE ONLY THIS: in the centre of the face, draw the traditional Chinese mahjong 'nine of circles' "
        "(jiu tong) motif — EXACTLY NINE carved round CIRCLE DISCS arranged in a neat SQUARE of THREE columns "
        "and THREE rows (3 + 3 + 3 = 9), evenly spaced with an even gap between every neighbouring pair. EXACTLY "
        "NINE discs in total. The square is centred both horizontally and vertically on the face and spans about "
        "80% of the face width and about 80% of the face height; each disc's diameter is about 26% of the face "
        "width and all nine are the same size. " + DISC_STRUCTURE + NO_BAMBOO +
        "Do NOT draw SIX discs, do NOT draw EIGHT discs, do NOT draw TWELVE discs, do NOT draw TWO columns, do "
        "NOT draw FOUR rows, do NOT draw a 3 x 2 grid, do NOT draw nine discs in one single row or one single "
        "column, do NOT draw plain flat filled circles without the concentric rings, do NOT draw any Chinese "
        "character or numeral."),
    colour=(
        "COLOUR (take the colour arrangement from the SECOND reference image): the THREE discs of the TOP row are "
        "ALL deep jade green (#1F7A4D); the THREE discs of the MIDDLE row are ALL deep vermilion red (#C0392B); "
        "the THREE discs of the BOTTOM row are ALL deep indigo blue (#26558C). Within each disc the enamelled "
        "outer ring, the enamelled inner ring and the central dot are all the SAME one colour of that disc, and "
        "the two thin rings between them are bare ivory jade bone (#F3ECD9) — bone, not white, not grey, not "
        "gold, not metal. Green row on top, red row in the middle, blue row at the bottom — exactly the colour "
        "layout of the ninth tile in the second reference. " + REF_NOTE),
    relief=RELIEF_DISC,
)

ORDER = ['一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒']
TODO = ['一筒', '二筒', '三筒', '四筒', '五筒', '七筒', '八筒', '九筒']   # 六筒已定稿，本轮出 8 张

NUMBER = {'一': 'ONE', '二': 'TWO', '三': 'THREE', '四': 'FOUR',
          '五': 'FIVE', '六': 'SIX', '七': 'SEVEN', '八': 'EIGHT', '九': 'NINE'}

# 每张的图案基准路径（image2 = 用户参考图切出的单张作物）
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
CROPS = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tile-samples', '_ref', 'crops')


def prompt(name):
    if name == '六筒':                 # 第 23 轮已定稿，提示词仍在旧模块（底图是九条）
        return T23.prompt('六筒')
    d = TONG[name]
    return '\n\n'.join([HEAD, KEEP, CLEAR, d['motif'], d['colour'], d['relief'], STRICT])


def selftest():
    """自证：① 固定段与来源模块是**同一对象**（逐字复用，非抄写）；
             ② 八张各自点到自己的数量词，且不误点别人的；
             ③ 八张的参考图作物都存在。"""
    bad = []
    if HEAD is not B.HEAD:            bad.append('HEAD 不是同一对象')
    if KEEP is not B.KEEP:            bad.append('KEEP 不是同一对象')
    if STRICT is not B.STRICT:        bad.append('STRICT 不是同一对象')
    if RELIEF_DISC is not T23.RELIEF_DISC: bad.append('RELIEF_DISC 不是同一对象')
    if CLEAR is B.CLEAR:              bad.append('CLEAR 忘了换底（仍是九条版本）')
    if 'SIX round green and red' not in CLEAR: bad.append('CLEAR 未点到"六枚圆饼"')
    for n in TODO:
        p = prompt(n)
        for seg, nm in [(KEEP, 'KEEP'), (CLEAR, 'CLEAR'), (STRICT, 'STRICT')]:
            if seg not in p:
                bad.append((n, '%s 缺失' % nm))
        # 浮雕段逐字相同（一筒是特例：单盘三色环，另写一段）
        want = RELIEF_DISC if n != '一筒' else TONG['一筒']['relief']
        if want not in p:
            bad.append((n, '%s 浮雕段缺失' % ('共用圆饼' if n != '一筒' else '一筒专用')))
        if n != '一筒' and TONG[n]['relief'] is not RELIEF_DISC:
            bad.append((n, '浮雕段不是共用对象（被抄成副本了）'))
        zh = NUMBER[n[0]]
        if zh not in p:
            bad.append((n, '未点到数量词 %s' % zh))
        crop = os.path.join(CROPS, '%s.png' % n)
        if not os.path.exists(crop):
            bad.append((n, '作物参考图缺失 %s' % crop))
        if 'CHANGE ONLY THIS' not in p:
            bad.append((n, '缺 CHANGE ONLY THIS 段首'))
    print('=' * 74)
    print('selftest：' + ('✅ 全部通过（固定段与来源同对象 · 数量词齐备 · 八张作物齐备）' if not bad
                          else '❌ ' + str(bad)))
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
