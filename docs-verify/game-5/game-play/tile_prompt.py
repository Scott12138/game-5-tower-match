#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""game-5 · 麻将牌面出图提示词模板（第 19 轮固化）

为什么要有这个文件：
  第 17~18 轮的三风格样板与 D 融合稿，提示词只存在于对话里、没有落盘。
  结果本轮要「以 D 为标准出剩余 8 张」时，只能靠回溯上下文复述 —— 一旦有偏差，
  27 张全量就会出现「同风格不同批」的断层。故把模板固化成脚本。

用法：
  python3 tile_prompt.py            # 打印全部万字的提示词（供逐条投喂 ImageGen）
  python3 tile_prompt.py 二          # 只打印「二萬」

口径（★ 关键，改动前先读）：
  · 六段式：身份/用途 → 渲染方式 → SUBJECT → INK/COLOR → MATERIAL → CAMERA/LIGHTING/BACKGROUND → STRICT STYLE
  · 生成同一套牌时，**除 SUBJECT 里的「上字」之外一律逐字不动**，差异才可归因（技能纪律）
  · SUBJECT 里的「上字」= 数字汉字（一~九），「下字」恒为「萬」
  · 牌面朝向 / 构图占比 / 光照 / 背景 / 抠底口径 全套装统一，保证「画面连贯性」

沿革（护栏都是被真数据换来的，别删）：
  第 18 轮 出「一万」D 融合稿并拍板为母版。
  第 19 轮 量产 二~九萬。首轮 9 张里有 3 张不合格，据此补入两处**内容护栏**：
    ① SUBJECT 补「plain rounded-rectangle silhouette, NOT chamfered, NOT octagon」
       —— 六萬 / 八萬 首轮出来是不规则八边形斜切角，与母版圆角矩形不符；
    ② CAMERA 段补「no table / no felt / no green surface / no floor / no scenery」
       —— 五萬 首轮画面里混进了绿毛毡桌面，且主体定位因此被污染（牌体宽高比量成 0.609）。
  护栏只约束「内容与外形」，不改材质 / 光照 / 字色 → 故仅重出问题张，未重出已合格的 6 张。
  第 20 轮 筒 / 条样图（★ 三条护栏都是本轮换来的，别删）：
    ① **串行单发**：六筒 + 九条并行投喂 → 同秒撞名互相覆盖，两张只活下来一张
       → ImageGen 必须一张一张发，并行 = 白烧一次 token；
    ② **「精确数量」必须逐项点名否定**：六筒依次出成 8 / 9 / 6 枚，九条依次出成
       12 根 / 9 根无金框 / 背景混毛毡 / 18 根 → 只写 `EXACTLY NINE` 没用，要写成
       `Do NOT draw nine, do NOT draw a 3 by 3 block, do NOT draw eight, do NOT draw four`
       （把错误数量逐一点名）才略有效，即便如此仍会错；
    ③ **图案数量不做机器断言**：投影法 / 连通域法都被「牌体裂纹玉纹 + 竹节深色节环」击穿
       （九条 v2 量成 7 列 / 21 行，真值 3×3；六筒量成 3 列 / 4 行，真值 2×3）
       → **数量一律目视复核**，脚本只报背景纯度 / 主体宽高比这类几何量。
  用户同轮立下节奏硬约束（长期生效）：**一轮只发一次生图，出完即停、等用户拍板，不得自行重试；
  不合格版本移入 `rejected/` 留痕（不删）。**
"""

# ── 六段式模板 ────────────────────────────────────────────────────────────
# {han}  = 上字（汉字数字，如 一 / 二 / 九）
# {en}   = 该数字的英文拼写（只用于帮助模型理解，不要求出现在画面里）
TEMPLATE = """A game asset for a WeChat mini-game: the single tile FACE artwork for the mahjong tile "{han}万" ({en} of Characters), to be displayed at 96x128 px on a dark green felt playing table.

Photorealistic macro product photograph of ONE single mahjong tile, rendered as a real-time 3D engine render (PBR / ray-traced CGI, physically based materials, photoreal, ultra detailed 8k).

SUBJECT: a single square-front mahjong tile standing face-on toward the camera in a dead-on 90-degree orthographic front view, zero perspective, zero tilt, zero rotation. It is a thick solid block: a square cream face plate with a beveled chamfered rim, a visible side-wall thickness along the right and bottom edges, and softly rounded corners — a plain rounded-rectangle silhouette, NOT chamfered corners, NOT clipped corners, NOT an octagon, NOT a beveled polygon. On the face, two Chinese characters are stacked vertically: the upper is the numeral "{han}" and the lower is the character "萬". Both are perfectly centered horizontally, occupy the middle 60% of the face with balanced top and bottom margins, and the whole tile is centered in frame filling about 78% of the canvas height.

INK / COLOR: both Chinese characters are bright vermilion red (#D8432F) — RED, definitely not gold, not yellow, not black, not dark grey, not brown.

MATERIAL: the tile body is warm ivory bone (#FFF7E6) with a very fine natural grain, faintly translucent and softly glowing like fine warm mutton-fat jade; the two characters are raised as HIGH-RELIEF carved forms standing proud of the jade face, with real visible side walls and genuine thickness, richly filled in bright vermilion red (#D8432F) with glossy wet highlights (#FF8E76) riding on the top surfaces and deep dark red-brown shadow (#7A1F14) sinking into the recesses, so each stroke has real physical depth; an ornate heavy gold frame with sculpted curling-scroll corner ornaments surrounds the face; strong directional specular highlights rake across the raised red characters, casting a visible soft shadow beside every stroke.

CAMERA / LIGHTING / BACKGROUND: straight-on telephoto macro, orthographic feel, tile perfectly upright. Soft large key light from the upper left at 45 degrees, gentle fill, no harsh shadows. Background is pure flat white (#FFFFFF), seamless and evenly lit, with only a very soft minimal contact shadow directly under the tile. The tile stands alone on an invisible seamless studio sweep: absolutely NO table, NO felt, NO cloth, NO green surface, NO floor, NO horizon line, NO scenery of any kind is visible anywhere in the frame. Centered composition with generous, even margins on all four sides.

STRICT STYLE: NOT an illustration, NOT vector art, NOT flat design, no cartoon, no cel shading, no outlines, no sticker look, no text or symbols other than the two characters, no Arabic numerals, no digits, no pinyin, no Latin letters, no logo, no watermark, no brand mark, no multiple tiles, no hands, no table, no scenery."""

# ── 万字序列（一万已出为 D 融合稿；本轮出 二~九 共 8 张）────────────────
WAN = [
    ('一', 'One'),
    ('二', 'Two'),
    ('三', 'Three'),
    ('四', 'Four'),
    ('五', 'Five'),
    ('六', 'Six'),
    ('七', 'Seven'),
    ('八', 'Eight'),
    ('九', 'Nine'),
]

# 本轮要出的（跳过已完成的「一」）
TODO = WAN[1:]


def prompt(han, en):
    return TEMPLATE.format(han=han, en=en)


# ══════════════════════════════════════════════════════════════════════════
# 第 20 轮新增 · 筒 / 条 样图模板
#
# 用户第 20 轮口径：「对于条和筒，请先各出一张样图，分别选择六筒和九条，
#   麻将的质地表现需参考万子牌的风格」；并拍板「图案配色 = 传统多色」。
#
# 设计要点：**质地、光照、背景必须与万字逐字相同**，否则一整套 27 张会出现
#   「材质断层」。故下面 RENDER / SHAPE / CAMERA 三段**直接从 TEMPLATE 切片**，
#   而不是手抄 —— 手抄一旦差一个空格就再也对不上了。selftest() 可自证。
#
# 与万字的**唯一**差异：SUBJECT 的图案描述 + INK/COLOR 的配色 + STRICT 段的
#   「no text / no Chinese characters」（筒条牌面上没有字）。
# ══════════════════════════════════════════════════════════════════════════


def _seg(s, start_key, end_key, drop=0):
    i = s.index(start_key) + drop
    j = s.index(end_key, i)
    return s[i:j].rstrip('\n')


RENDER = _seg(TEMPLATE, 'Photorealistic macro product photograph', '\n\nSUBJECT:')
SHAPE = _seg(TEMPLATE, 'SUBJECT: ', ' On the face,', drop=len('SUBJECT: '))
CAMERA = _seg(TEMPLATE, 'CAMERA / LIGHTING / BACKGROUND:', 'STRICT STYLE:')

# 手写的两句：牌体 + 金框（断言其确实逐字存在于万字模板中，防止抄错）
MAT_BODY = ('the tile body is warm ivory bone (#FFF7E6) with a very fine natural grain, '
            'faintly translucent and softly glowing like fine warm mutton-fat jade;')
MAT_FRAME = ('an ornate heavy gold frame with sculpted curling-scroll corner ornaments '
             'surrounds the face;')

STRICT_SHAPE = ('STRICT STYLE: NOT an illustration, NOT vector art, NOT flat design, no cartoon, '
                'no cel shading, no outlines, no sticker look, no text, no Chinese characters, '
                'no letters, no numerals, no Arabic numerals, no digits, no pinyin, no logo, '
                'no watermark, no brand mark, no multiple tiles, no hands, no table, no scenery.')


def _compose(head, layout, colors, relief):
    return (
        head + '\n\n'
        + RENDER + '\n\n'
        + 'SUBJECT: ' + SHAPE + ' On the face, ' + layout
        + ', the whole motif group perfectly centered both horizontally and vertically and spanning '
          'about 60% of the face width; the whole tile is centered in frame filling about 78% of the '
          'canvas height.\n\n'
        + 'INK / COLOR: ' + colors + '.\n\n'
        + 'MATERIAL: ' + MAT_BODY + ' ' + relief + ' ' + MAT_FRAME
        + ' strong directional specular highlights rake across the raised coloured motifs, casting a '
          'visible soft shadow beside each one.\n\n'
        + CAMERA + '\n\n'
        + STRICT_SHAPE
    )


# ── 六筒（Six of Circles）：2 列 × 3 行 六个圆环 ────────────────────────────
# ★ 第 20 轮 v1 实测：配色写成「外环靛蓝 / 内环翡翠绿 / 中心朱红」的**同心**配色，
#   模型会把整组压成**单色绿**（v1 六个环全绿，移入 tong/rejected/ 留痕）。
#   → 改成「**按行分色**」（每行一整色），模型才画得出多彩。
#   （同技能坑 3：颜色必须单独成段 + 加否定，但"同心多层色"这层复杂度模型啃不动。）
TONG = _compose(
    'A game asset for a WeChat mini-game: the single tile FACE artwork for the mahjong tile "六筒" '
    '(Six of Circles / Six of Dots), to be displayed at 96x128 px on a dark green felt playing table.',
    "EXACTLY SIX pips — no more than six, no fewer than six. They form a TALL 2 x 3 block: TWO pips "
    "across and THREE pips down (three stacked rows, two pips in each row). Do NOT draw nine pips, do "
    "NOT draw a 3 by 3 square block, do NOT draw eight pips, do NOT draw four pips. Each pip is a "
    "single ring / donut motif with a small hollow centre dot",
    'each ROW of pips carries its own traditional colour: the TOP pair is deep indigo blue (#26558C), '
    'the MIDDLE pair is jade green (#1F7A4D), and the BOTTOM pair is bright vermilion red (#D8432F) — '
    'genuinely THREE-COLOUR in the same tile. Absolutely NOT six identical green rings, NOT monochrome '
    'green, NOT all gold',
    'the six pips are raised as HIGH-RELIEF carved forms standing proud of the jade face, each with a '
    'real visible side wall and genuine thickness, their coloured enamel sitting in the carved '
    'recesses with glossy wet highlights riding on the top surfaces and deep shadow sinking into the '
    'grooves, so every pip has real physical depth;',
)

# ── 九条（Nine of Bamboo）：3 列 × 3 行 九根竹 ─────────────────────────────
TIAO = _compose(
    'A game asset for a WeChat mini-game: the single tile FACE artwork for the mahjong tile "九条" '
    '(Nine of Bamboo / Nine of Strings), to be displayed at 96x128 px on a dark green felt playing '
    'table.',
    "EXACTLY NINE bamboo stems in total, standing upright in THREE columns ONLY — every column holds "
    "exactly THREE stems, one directly above the other, so the block is three stems wide and three "
    "stems tall (3 + 3 + 3 = 9). Do NOT draw four columns, do NOT draw five columns, do NOT draw twelve "
    "stems, do NOT draw eight stems, do NOT draw six stems. Each stem is a short upright green bamboo "
    "section with two visible darker node joints",
    'the nine bamboo stems are jade green (#2E7D4F) with darker green node rings (#1B5E33) at every '
    'joint, and each stem carries a small vermilion red (#D8432F) accent band near its centre — '
    'green-and-red, NOT monochrome, NOT all gold',
    'the nine bamboo stems are raised as HIGH-RELIEF carved forms standing proud of the jade face, '
    'each with a real visible side wall and genuine thickness, their coloured enamel sitting in the '
    'carved recesses with glossy wet highlights riding on the top surfaces and deep shadow sinking '
    'into the grooves, so every stem has real physical depth; the gold border frame of the tile '
    'carries sculpted curling-scroll ornaments at ALL FOUR CORNERS — NOT a plain rounded bar, NOT a '
    'bare recessed line;',
)

# ── 自证：质地 / 光照 / 背景必须与万字逐字相同 ─────────────────────────────
def selftest():
    for name, s in [('MAT_BODY', MAT_BODY), ('MAT_FRAME', MAT_FRAME), ('RENDER', RENDER),
                    ('SHAPE', SHAPE), ('CAMERA', CAMERA)]:
        assert s in TEMPLATE, '%s 与万字母版不一致' % name
    for t in (TONG, TIAO):
        assert _seg(t, 'CAMERA / LIGHTING / BACKGROUND:', 'STRICT STYLE:') == CAMERA
        assert _seg(t, 'SUBJECT: ', ' On the face,', drop=len('SUBJECT: ')) == SHAPE
        assert t.index(RENDER) > 0
    return True


if __name__ == '__main__':
    import sys
    assert selftest(), '质地段与万字母版不一致'
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg in ('筒', 'tong', '六筒'):
        print(TONG)
    elif arg in ('条', 'tiao', '九条'):
        print(TIAO)
    elif arg:
        hit = [w for w in WAN if w[0] == arg]
        if not hit:
            print('未找到：%s（可用 一~九 / 筒 / 条）' % arg); sys.exit(1)
        print(prompt(*hit[0]))
    else:
        for han, en in TODO:
            print('=' * 78)
            print('### %s万  (%s)' % (han, en))
            print('=' * 78)
            print(prompt(han, en))
            print()
