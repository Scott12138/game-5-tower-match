#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""条子牌 · 「甲式」出图提示词（图生图 · 外科式局部改）

与 tile_prompt.py 的分工
────────────────────────────────────────────────────────────────────────
tile_prompt.py        = 文生图六段式模板（万字 / 六筒 / 九条 从零生成用）
tile_prompt_edit.py   = 图生图「甲式」模板（本文件）

为什么需要它（第 22 轮新沉淀）
────────────────────────────────────────────────────────────────────────
用户第 21 轮拍板：九条定稿取「候选甲」。候选甲的工艺是——
  image1 = 已定稿牌面原图（提供金框 / 玉体 / 视角 / 光照 / 背景）
  image2 = 用户的配色参考图（只提供图案的配色布局）
  提示词 = "保持其余一切不变，只把面心图案换掉" 的外科式局部改
结果：边框带与 image1 逐像素平均差仅 3.99 灰阶（≈1.6%），肉眼不可辨。

第 22 轮据此量产 一条~八条。为满足「金框与玉材质必须与九条候选甲完全一致」，
本轮 image1 直接改用「九条候选甲原图」而非一万——边框/玉体/光照/背景全部
继承定稿本身，九张整套同源。

关键工程点
────────────────────────────────────────────────────────────────────────
1. **KEEP 段必须逐字复用**：把「不许动」的部分写成一段完整的、按部位点名的
   清单（框 / 牌体 / 侧墙 / 视角 / 光照 / 背景 / 投影 / 构图）。少点名一项，
   模型就可能顺手重画它。
2. **先清空、再画新**：底图面心本来就有图案（候选甲是九根竹），必须先显式
   要求「把原图案彻底清掉、露出素玉面」，否则会出现残留笔画。
3. **数量逐项点名否定**：AI 对「精确数量」极不稳（第 20 轮六筒出成 8/9 枚、
   九条出成 12/18 根）。写法 = 正说 N 个 + 排列方式 + 把常见错数逐个点名禁止。
4. **配色单独成段 + 带 hex**：颜色不写 hex、不单独成段，模型会自作主张。
5. **一条是鸟不是竹**：一条（幺鸡）在参考图里是一只鸟，必须给鸟形描述与
   鸟的浮雕句，不能套用竹子那套 EACH STICK。
"""

# ══════════════════════════════════════════════════════════════════════
#  固定段（九张逐字相同 —— selftest 会自证）
# ══════════════════════════════════════════════════════════════════════

HEAD = ("Edit the provided mahjong tile photograph. This is a SURGICAL LOCAL EDIT: "
        "everything except the centre of the tile face must stay exactly as it is.")

KEEP = ("KEEP COMPLETELY UNCHANGED: the same warm ivory jade tile body and its fine natural grain; "
        "the SAME ornate gold frame with the sculpted curling-scroll corner ornaments surrounding the face "
        "— identical band thickness, identical ornament shapes, identical gold colour and patina; "
        "the same beveled chamfered rim; the same visible side-wall thickness along the right and bottom edges; "
        "the same straight-on upright front view and camera; the same soft studio key light from the upper left; "
        "the same clean near-white background; the same soft contact shadow under the tile. "
        "Do NOT redraw the frame, do NOT change the tile body, do NOT change the lighting, the background, "
        "the margins or the composition, do NOT move, scale or rotate the tile.")

CLEAR = ("FIRST, ERASE the motif that is currently painted in the centre of the face — the nine green and red "
         "bamboo sticks — completely and cleanly, leaving bare jade bone there; NOTHING of the old motif may "
         "remain, no leftover sticks, no leftover coloured marks, no ghost of the previous pattern.")

RELIEF_BAMBOO = ("EACH STICK: a slim upright bamboo culm with two visible darker node joints, softly rounded ends, "
                 "raised as a HIGH-RELIEF carved form standing proud of the jade face, with a real visible side wall "
                 "and genuine thickness, its coloured enamel sitting in the carved recess with glossy wet highlights "
                 "on the top surface and deep shadow sinking into the groove, casting a soft cast shadow on the face "
                 "beside it — the same carved high-relief treatment, the same material feel, the same lighting and "
                 "the same photographic realism as the input image.")

RELIEF_BIRD = ("THE BIRD is raised as a HIGH-RELIEF carved form standing proud of the jade face, with a real "
               "visible side wall and genuine thickness, its coloured enamel sitting in the carved recess with "
               "glossy wet highlights on the raised surfaces and deep shadow sinking into the grooves, so every "
               "feather group, the crest, the beak, the eye and the tail read as solid carved relief casting soft "
               "cast shadows on the face — the same carved high-relief treatment, the same material feel, the same "
               "lighting and the same photographic realism as the input image.")

STRICT = ("STRICT: NOT an illustration, NOT vector art, NOT flat design, no cartoon, no cel shading, no outlines, "
          "no sticker look, no text, no Chinese characters, no letters, no numerals, no Arabic numerals, no digits, "
          "no pinyin, no logo, no watermark, no brand mark, no multiple tiles, no hands, no table, no scenery. "
          "Keep the artistic quality, the sharpness and the resolution of the input image.")


# ══════════════════════════════════════════════════════════════════════
#  每条一张的「图案段 + 配色段」（只有这里随牌号变化）
# ══════════════════════════════════════════════════════════════════════

TIAO = {}

TIAO['一条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw a SINGLE carved SPARROW — the traditional Chinese "
           "mahjong 'one of bamboo' bird (yiao ji), NOT bamboo sticks. EXACTLY ONE bird, seen in side profile "
           "facing left, perched upright on a very short green bamboo twig: a stylised sparrow with a swept-back "
           "red crest on its head, a large round eye, a folded wing across its body, a long pointed red tail "
           "sweeping down and to the right, two small leaf-like shapes beside the body, and a small tuft at the "
           "breast. The bird alone is centred both horizontally and vertically on the face and spans about 62% of "
           "the face width and about 80% of the face height. Do NOT draw bamboo sticks around it, do NOT draw two "
           "birds, do NOT draw a pair of birds, do NOT draw any Chinese character or numeral."),
    colour=("COLOUR (take the colour arrangement from the SECOND reference image): the crest, the beak and the "
            "sweeping tail feathers are deep vermilion red (#C0392B); the folded wing, the ring around the eye and "
            "the two small leaf-like shapes are deep indigo blue (#26558C); the head, back, breast and the short "
            "bamboo twig it perches on are deep jade green (#1F7A4D). Red crest and tail, blue wing, green body — "
            "exactly the colour layout of the bird in the first tile of the second reference. Use the second "
            "reference ONLY for this colour layout and the bird's silhouette; ignore its blurry low-resolution "
            "phone-camera look, its background and its image quality."),
    relief=RELIEF_BIRD,
)

TIAO['二条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw TWO carved bamboo sticks forming ONE single vertical "
           "column — one stick directly above the other, both on the same vertical centre line, evenly spaced. "
           "EXACTLY TWO sticks in total, the pair centred both horizontally and vertically on the face and spanning "
           "about 26% of the face width and about 78% of the face height. Do NOT draw three sticks, do NOT draw four "
           "sticks, do NOT draw six sticks, do NOT draw nine sticks, do NOT draw two separate columns, do NOT draw "
           "any Chinese character or numeral."),
    colour=("COLOUR: BOTH sticks are deep jade green (#1F7A4D) with darker green node rings (#1B5E33) at every "
            "joint — all green, no red, no blue, not gold. This is exactly the colour layout of the second tile in "
            "the second reference. Use the second reference ONLY for this colour layout; ignore its blurry "
            "low-resolution phone-camera look, its background and its image quality."),
)

TIAO['三条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw THREE carved bamboo sticks forming an upright "
           "triangle — ONE stick centred at the TOP, and TWO sticks side by side at the BOTTOM directly below it "
           "(one sitting under the left half, one under the right half). EXACTLY THREE sticks in total, the group "
           "centred both horizontally and vertically on the face and spanning about 60% of the face width and about "
           "78% of the face height. Do NOT draw two sticks, do NOT draw four sticks, do NOT draw six sticks, do NOT "
           "draw a 2 x 2 block, do NOT draw three sticks in one column, do NOT draw any Chinese character or numeral."),
    colour=("COLOUR: ALL THREE sticks are deep jade green (#1F7A4D) with darker green node rings (#1B5E33) at every "
            "joint — all green, no red, no blue, not gold. This is exactly the colour layout of the third tile in "
            "the second reference. Use the second reference ONLY for this colour layout; ignore its blurry "
            "low-resolution phone-camera look, its background and its image quality."),
)

TIAO['四条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw FOUR carved bamboo sticks in a neat 2 x 2 block — "
           "TWO columns and TWO rows, the four sticks evenly spaced like the four spots of a square. EXACTLY FOUR "
           "sticks in total, the block centred both horizontally and vertically on the face and spanning about 44% "
           "of the face width and about 78% of the face height. Do NOT draw two sticks, do NOT draw three sticks, "
           "do NOT draw six sticks, do NOT draw nine sticks, do NOT draw one single column, do NOT draw any Chinese "
           "character or numeral."),
    colour=("COLOUR: ALL FOUR sticks are deep jade green (#1F7A4D) with darker green node rings (#1B5E33) at every "
            "joint — all green, no red, no blue, not gold. This is exactly the colour layout of the fourth tile in "
            "the second reference. Use the second reference ONLY for this colour layout; ignore its blurry "
            "low-resolution phone-camera look, its background and its image quality."),
)

TIAO['五条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw FIVE carved bamboo sticks — FOUR deep-coloured sticks "
           "at the four corners (two forming a vertical pair on the LEFT, two forming a vertical pair on the RIGHT) "
           "and ONE shorter stick standing in the exact CENTRE between them. EXACTLY FIVE sticks in total, the group "
           "centred both horizontally and vertically on the face and spanning about 60% of the face width and about "
           "78% of the face height; the single centre stick is clearly SHORTER than the four corner sticks and is "
           "vertically centred between them. Do NOT draw four sticks, do NOT draw six sticks, do NOT draw nine "
           "sticks, do NOT draw a 3 x 3 grid, do NOT draw any Chinese character or numeral."),
    colour=("COLOUR (take the colour arrangement from the SECOND reference image): the FOUR corner sticks are deep "
            "jade green (#1F7A4D) with darker green node rings; the ONE centre stick is deep vermilion red (#C0392B) "
            "with darker red node rings. Four green corners, one red centre — exactly the colour layout of the fifth "
            "tile in the second reference. Use the second reference ONLY for this colour layout; ignore its blurry "
            "low-resolution phone-camera look, its background and its image quality."),
)

TIAO['六条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw SIX carved bamboo sticks in a neat 3 x 2 block — "
           "THREE columns and TWO rows, the six sticks evenly spaced. EXACTLY SIX sticks in total, the block centred "
           "both horizontally and vertically on the face and spanning about 62% of the face width and about 78% of "
           "the face height. Do NOT draw three sticks, do NOT draw four sticks, do NOT draw nine sticks, do NOT draw "
           "twelve sticks, do NOT draw a 2 x 2 block, do NOT draw a single column, do NOT draw any Chinese character "
           "or numeral."),
    colour=("COLOUR: ALL SIX sticks are deep jade green (#1F7A4D) with darker green node rings (#1B5E33) at every "
            "joint — all green, absolutely no red, no blue, not gold. This is exactly the colour layout of the sixth "
            "tile in the second reference. Use the second reference ONLY for this colour layout; ignore its blurry "
            "low-resolution phone-camera look, its background and its image quality."),
)

TIAO['七条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw SEVEN carved bamboo sticks arranged in THREE columns: "
           "the MIDDLE column holds THREE sticks stacked vertically (top, middle, bottom); the LEFT column holds TWO "
           "sticks and the RIGHT column holds TWO sticks, and those four side sticks are aligned with the MIDDLE and "
           "the BOTTOM sticks of the centre column, so the whole group reads as one stick crowning two rows of "
           "three. EXACTLY SEVEN sticks in total, the group centred both horizontally and vertically on the face and "
           "spanning about 62% of the face width and about 78% of the face height. Do NOT draw six sticks, do NOT "
           "draw eight sticks, do NOT draw nine sticks, do NOT draw a 3 x 3 grid, do NOT draw any Chinese character "
           "or numeral."),
    colour=("COLOUR (take the colour arrangement from the SECOND reference image): in the centre column the TOPMOST "
            "stick is deep vermilion red (#C0392B) with darker red node rings, and the MIDDLE and BOTTOM sticks of "
            "that column are deep indigo blue (#26558C) with darker blue node rings; the four side sticks (the two "
            "of the left column and the two of the right column) are deep jade green (#1F7A4D) with darker green node "
            "rings. Red on top, blue below it in the centre column, green on both sides — exactly the colour layout "
            "of the seventh tile in the second reference. Use the second reference ONLY for this colour layout; "
            "ignore its blurry low-resolution phone-camera look, its background and its image quality."),
)

TIAO['八条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw EIGHT carved bamboo sticks forming the classic mahjong "
           "'eight of bamboo' geometric motif — a two-tier zig-zag that reads as a large capital letter M sitting "
           "above an upside-down M (a W). There are FOUR round-lobed bamboo tips along the TOP edge and FOUR "
           "round-lobed tips along the BOTTOM edge, and they are joined by thick diagonal bamboo bars that form two "
           "V-shaped valleys in the upper half and two inverted-V ridges in the lower half. EXACTLY EIGHT tips in "
           "total, the group centred both horizontally and vertically on the face and spanning about 70% of the face "
           "width and about 78% of the face height. Do NOT draw straight parallel vertical columns, do NOT draw six "
           "sticks, do NOT draw nine sticks, do NOT draw a 3 x 3 grid, do NOT draw any Chinese character or numeral."),
    colour=("COLOUR: ALL eight bamboo tips and ALL the diagonal connectors between them are deep jade green "
            "(#1F7A4D) with darker green node rings (#1B5E33) — all green, no red, no blue, not gold. This is "
            "exactly the colour layout of the eighth tile in the second reference. Use the second reference ONLY "
            "for this colour layout; ignore its blurry low-resolution phone-camera look, its background and its "
            "image quality."),
)

TIAO['九条'] = dict(
    motif=("CHANGE ONLY THIS: in the centre of the face, draw NINE carved bamboo sticks — EXACTLY NINE, arranged in "
           "THREE columns and THREE rows (3 + 3 + 3 = 9), evenly spaced, the group centred both horizontally and "
           "vertically on the face and spanning about 62% of the face width and about 78% of the face height. Do NOT "
           "draw eighteen sticks, do NOT draw six columns, do NOT draw twelve sticks, do NOT draw six or eight "
           "sticks — nine sticks in three columns only."),
    colour=("COLOUR (take the colour arrangement from the SECOND reference image): the LEFT column and the RIGHT "
            "column are deep jade green (#1F7A4D) with darker green node rings; the MIDDLE column is deep vermilion "
            "red (#C0392B) with darker red node rings. Left green, centre red, right green — exactly the colour "
            "layout of the ninth tile in the second reference. Use the second reference ONLY for this colour layout; "
            "ignore its blurry low-resolution phone-camera look, its background and its image quality."),
)

ORDER = ['一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条']
TODO = ['一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条']   # 九条已定稿，本轮出 8 张


def prompt(name):
    d = TIAO[name]
    return '\n\n'.join([HEAD, KEEP, CLEAR, d['motif'], d['colour'],
                        d.get('relief', RELIEF_BAMBOO), STRICT])


def selftest():
    """自证：固定段（KEEP / CLEAR / STRICT）与竹浮雕段必须九张逐字相同。"""
    ps = {n: prompt(n) for n in ORDER}
    bad = []
    for n, p in ps.items():
        if KEEP not in p:
            bad.append((n, 'KEEP 缺失'))
        if CLEAR not in p:
            bad.append((n, 'CLEAR 缺失'))
        if STRICT not in p:
            bad.append((n, 'STRICT 缺失'))
    # 竹浮雕段：除一条外八张逐字相同
    for n in ORDER:
        if n == '一条':
            if RELIEF_BIRD not in ps[n]:
                bad.append((n, 'RELIEF_BIRD 缺失'))
        else:
            if RELIEF_BAMBOO not in ps[n]:
                bad.append((n, 'RELIEF_BAMBOO 缺失'))
    # 每张必须点到自己的数量词，且不许出现别人的数量词
    for n in TODO:
        cnt = n[0]
        zh = {'一': 'ONE', '二': 'TWO', '三': 'THREE', '四': 'FOUR', '五': 'FIVE',
              '六': 'SIX', '七': 'SEVEN', '八': 'EIGHT', '九': 'NINE'}[cnt]
        if zh not in ps[n]:
            bad.append((n, '未点到数量词 %s' % zh))
    print('=' * 74)
    print('selftest：' + ('✅ 全部通过（固定段逐字一致，数量词齐备）' if not bad else '❌ ' + str(bad)))
    print('=' * 74)
    return not bad


if __name__ == '__main__':
    import sys
    if not selftest():
        sys.exit(1)
    args = sys.argv[1:]
    names = [a for a in args if a in TIAO] or TODO
    for n in names:
        print('=' * 74)
        print('### %s' % n)
        print('=' * 74)
        print(prompt(n))
        print()
