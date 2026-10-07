#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 47 轮 · 失败吉祥物三方案：**拍板对比板**

产出 `00-方案试样一览.png` —— 一页看完就能拍板：
  · 四个形象并排（原形象 + A/B/C），棋盘格衬底 —— 看**气质**与**一致不一致**
  · 放进「就差一点！」失败弹层的**真实版式** —— 看**用途符合性**
    （卡 620×616.9 设计 px 等比缩到 386px；吉祥物宽 240 设计 px = **卡宽 38.7%**）
  · 判据表（尺度 / 「中」字 / 边缘白晕 / 背景残留）—— 看**能不能直接用**
  · 已知代价（必读）

排版纪律（都是踩过的，别改回去）：
  · 禁用 emoji（中文字体渲染成豆腐块），状态标记一律 ASCII `OK` / `NG` / `--`
  · 文字层最后画；长句按**像素宽**折行，面板高按**实际行数**算
  · 标签胶囊高度**写死**，不按字形 bbox 算（否则某列会把说明顶进图里）
  · 图一律等比缩放，绝不 resize 到非等比框
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'ui', 'fail-mascot-r47')
REF = os.path.join(PROJ, 'assets/resources/splash/mascot.png')

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
W = 1720
PAD = 40

MASCOT_W_DESIGN = 240                 # RESULT.MASCOT_W
CANVAS_ASPECT = 960 / 875
DPR = 3
DISPLAY_W = int(round(MASCOT_W_DESIGN * DPR))
DISPLAY_H = int(round(MASCOT_W_DESIGN / CANVAS_ASPECT * DPR))

C_BG = (10, 23, 16)
C_CARD = (18, 40, 31)
C_CARD2 = (27, 96, 71)
C_GOLD = (246, 196, 69)
C_CREAM = (255, 247, 230)
C_DIM = (176, 198, 186)
C_OK = (126, 217, 158)
C_NG = (232, 116, 95)
C_WARN = (240, 196, 110)

VARIANTS = [
    ('ref', '原形象', '胜利 / 通用', REF),
    ('A', 'A', '委屈巴巴 · 含泪', os.path.join(OUT, 'fail-A.png')),
    ('B', 'B', '垂头丧气 · 叹气', os.path.join(OUT, 'fail-B.png')),
    ('C', 'C', '懊恼不甘 · 抱头', os.path.join(OUT, 'fail-C.png')),
]

_cache = {}


def font(sz, bold=False):
    key = (sz, bold)
    if key not in _cache:
        try:
            _cache[key] = ImageFont.truetype(FONT, sz, index=1 if bold else 0)
        except Exception:
            _cache[key] = ImageFont.truetype(FONT, sz)
    return _cache[key]


def wrap(d, s, f, maxw):
    lines, cur = [], ''
    for ch in s:
        if ch == '\n':
            lines.append(cur)
            cur = ''
            continue
        if d.textlength(cur + ch, font=f) <= maxw:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def checker(w, h, cell=18):
    im = Image.new('RGB', (w, h), (238, 240, 242))
    d = ImageDraw.Draw(im)
    for yy in range(0, h, cell):
        for xx in range(0, w, cell):
            if ((xx // cell) + (yy // cell)) % 2:
                d.rectangle([xx, yy, xx + cell - 1, yy + cell - 1], fill=(216, 220, 224))
    return im


def fit(name, box_w, box_h):
    im = Image.open(name).convert('RGBA')
    k = min(box_w / im.width, box_h / im.height)
    nw, nh = max(1, int(round(im.width * k))), max(1, int(round(im.height * k)))
    return im.resize((nw, nh), Image.LANCZOS)


def overlay_checker(im):
    bg = checker(im.width, im.height)
    bg.paste(im, (0, 0), im)
    return bg


def metrics_for(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float64) / 255.0
    alpha, rgb = a[..., 3], a[..., :3]
    ys, xs = np.where(alpha > 8 / 255)
    bb = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]

    c = rgb * 255
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    # ⚠️ 这是"暖色像素数"（中 + 手脚 + 草莓 + 腮红），**不是**「中」字像素数。
    #    只作记录、不作断言 —— 名字必须诚实（本轮踩过：原名写成「红「中」像素数」）。
    warm = int(((R > G * 1.45) & (R > B * 1.35) & (R > 80) & (alpha > 0.5)).sum())

    # 「中」字几何 —— 身体尺度的代理量（见 `zhong_mask` 的说明）
    zm = zhong_mask(a)
    if zm is None:
        zhong_h, zhong_r = 0, 0.0
    else:
        zy, _ = np.where(zm)
        zhong_h = int(zy.max() - zy.min() + 1)
        zhong_r = zhong_h / max(1, bb[3] - bb[1])

    # ★★ 边缘白晕：**必须带对照组**。
    #   最初写成"半透明环里的近白像素占比"，结果**基准图自己就报 7.12%** ——
    #   因为这个角色本体就是奶白色，它自己的剪影边天然是近白 ⇒ 判据没有判别力。
    #   改成**相对量**：把形象叠到深绿卡面上，比较"半透明环"与"紧邻的内部环"的亮度差。
    #   有白晕 ⇒ 环比内部亮；干净 ⇒ 两者接近。基准图（手工抠的）就是这里的对照组。
    #   ⚠️ 判据实现**只有一份**（`halo_of`），负控也复用它 —— 两处各写一份必然漂移。
    halo, ring_n = halo_of(a)
    halo = 0.0 if halo is None else halo

    # 角区残留：四角 40×40 应该**完全**透明（主体是贴边的，用整条边带会误报）
    k = 40
    corners = np.concatenate([
        alpha[:k, :k].ravel(), alpha[:k, -k:].ravel(),
        alpha[-k:, :k].ravel(), alpha[-k:, -k:].ravel(),
    ])
    residue = float((corners > 0.5).mean())

    return {
        'w': im.width, 'h': im.height, 'bbox': bb,
        'subj': [bb[2] - bb[0], bb[3] - bb[1]],
        'h_ratio': (bb[3] - bb[1]) / im.height,
        'aspect': (bb[2] - bb[0]) / (bb[3] - bb[1]),
        'warm_px': warm, 'zhong_h': zhong_h, 'zhong_r': zhong_r,
        'halo': halo, 'residue': residue,
        'ring_px': ring_n,
    }


def zhong_mask(a):
    """
    隔离牌面正中的红色「中」字 —— **身体尺度的代理量**。

    ⚠️ 为什么不能直接用"红像素总数 / 红 bbox"：
      最初写的 `R>G*1.45 & R>B*1.35` 会把**手脚、草莓、腮红**一起算进去
      （这些是蜜桃暖色，比值就过线）。实测基准图"红 bbox"宽 **936 ≈ 整个主体宽 953**
      ⇒ 那根本不是「中」，量出来的是"暖色分布"。**判据名与所量之物不符**，
      在板上写「红「中」像素数」是名不副实的（本轮自查发现，已改）。
    ⚠️ 也不能只收紧阈值：草莓、嘴内、手脚描边仍是同色系，bbox 依旧横跨全身。

    本版 = ① 饱和红判据（R>140 / G,B<95 / R−max(G,B)>70）
           ② **只保留下半身**（掐掉 top+0.42H 以上，滤掉草莓/嘴/头）
           ③ 取最大连通域 ⇒ 剩下的就是「中」
    返回二值掩码；找不到返回 None。
    """
    from scipy import ndimage
    c, al = a[..., :3] * 255, a[..., 3]
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    m = (R > 140) & (G < 95) & (B < 95) & ((R - np.maximum(G, B)) > 70) & (al > 0.5)
    ys, _ = np.where(al > 8 / 255)
    if not len(ys):
        return None
    top, bot = ys.min(), ys.max()
    m[:int(top + 0.42 * (bot - top + 1))] = False
    lab, n = ndimage.label(m)
    if n == 0:
        return None
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def halo_of(rgba_arr, ink_from=None):
    """
    「抠底残留把卡面染白」—— 唯一可解释的量。

    ★★ 这条判据改了两版才站住，两版都栽在**量错了东西**上，留档免得后人再走：
      ① 首版「半透明环里的近白像素占比」⇒ **基准图自己就报 7.12%**。这个角色本体就是
         奶白色，它自己的剪影边天然近白 ⇒ 判据没有判别力。
      ② 次版「环亮度 − 内环亮度」⇒ 全部报 **−22%**（含基准）。环是半透明的，
         它必然被深绿卡面压暗，量到的是 **alpha 斜坡**，跟白边没关系。
      ③ 本版：只看**轮廓外**。把形象按真 alpha 叠到深绿卡面（#123F30）上，
         取"紧贴轮廓外侧 2px"那一条带，量它比**纯卡面亮度**高出多少。
         干净 ⇒ 增量≈0；有白晕 ⇒ 那条带被抬亮。**基准图（手工抠的）同口径做锚**。

    ⚠️ `ink_from`：判"轮廓在哪"用的 alpha。负控会**改动采样带本身**的 alpha，
      那时必须传**原图**的 alpha —— 否则轮廓会跟着采样带走，
      `dilate(ink) & ~ink` 永远取在"更外面那一圈没被污染的地方" ⇒ **负控恒不红**
      （本轮实测踩到：负控报 +0.00%）。默认用自身 alpha，只有负控要传参。

    返回：(相对纯卡面的亮度增量 0~1, 参与统计的像素数)
    """
    from scipy import ndimage
    alpha, rgb = rgba_arr[..., 3], rgba_arr[..., :3]
    src = alpha if ink_from is None else ink_from
    ink = src > 0.02
    if not ink.any():
        return None, 0
    outside = ndimage.binary_dilation(ink, iterations=2) & ~ink
    if not outside.any():
        return None, 0
    card = np.array([0x12 / 255, 0x3F / 255, 0x30 / 255])       # #123F30
    comp = rgb * alpha[..., None] + card * (1 - alpha[..., None])
    lum = comp @ np.array([0.2126, 0.7152, 0.0722])
    card_lum = float(card @ np.array([0.2126, 0.7152, 0.0722]))
    return float(lum[outside].mean() - card_lum), int(outside.sum())


def negative_control():
    """
    ★★ 负控 —— 证明上面那条判据**真的会红**。

    没有这一步就不能说"三张都干净"：一条永远为 0 的判据等于没有判据
    （项目判据 8 的同款要求）。

    做法 = **模拟"抠底没抠干净"的真实症状**：在紧贴轮廓外侧那条带上，
    点上 alpha 0.5 的**白色**。这正是"白底混色残留"在卡面上的样子。
    ⚠️ 首版负控写的是"把半透明环染白" —— **不红（+0.21%）**：因为判据只看轮廓**外**，
    而半透明环在轮廓**内**。负控必须打在判据真正取样的那一片上，否则等于没控。
    """
    p = os.path.join(OUT, 'fail-A.png')
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.float64) / 255.0
    from scipy import ndimage
    ink = a[..., 3] > 0.02
    band = ndimage.binary_dilation(ink, iterations=2) & ~ink
    poisoned = a.copy()
    poisoned[..., :3][band] = 1.0          # 白
    poisoned[..., 3][band] = 0.5           # 半透明
    # ⚠️ 传**原图 alpha**：采样带被改动过，再用它自己的 alpha 找轮廓就永远量不到污染
    h, n = halo_of(poisoned, ink_from=a[..., 3])
    return h, n


def main():
    M = {k: metrics_for(p) for k, _, _, p in VARIANTS}
    ref = M['ref']

    neg_h, neg_n = negative_control()
    print(f"负控（在 A 的轮廓外点一圈白）：轮廓外亮度增量 = {neg_h * 100:+.2f}%（门限 +2.00%）"
          f" ⇒ {'会红 OK' if neg_h >= 0.02 else '不红，判据无效 NG'}  带内像素 {neg_n}")

    f_title, f_sub = font(46, True), font(22)
    f_h = font(28, True)
    f_chip, f_cap, f_body, f_mono, f_note = font(22, True), font(21), font(21), font(20), font(21)

    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))

    notes = [
        '「中」字位置：A 的双手交握挡住了肚子上「中」的下半部分，B / C 完整可见。'
        '机器也量到了同一件事（判据表「中」字高那一行）：基准 188px（占主体高 0.217）、C 186（0.215）、B 178（0.205）、'
        'A 只有 134（0.155）—— A 的「中」被遮掉三成。你若要「中」永远全露，A 需要重出。',
        '字形不是逐像素一致：三张的「中」都由 AI 重画过（比参考略圆），不是复用参考图原像素；'
        '身体尺度以「中」字高为代理量核过 —— C 与基准只差 0.9%、B 差 5.5%，都在可用范围。'
        '身体比例、配色、材质、光照、镜头与参考一致。'
        '（表里「暖色像素数」把「中」、手脚、草莓、腮红都算进去了 —— 它只作记录、不作断言，别拿它当「中」字的尺寸。）',
        '抠底是我做的：出图回传的是 1024×1024 白底（background:transparent 不生效），已用「四边泛洪 + 去白边」抠成透明，'
        '并归一化到与 splash/mascot.png 同画幅（960×875、主体高占比一致）⇒ 可直接替换，卡面版式不会动。',
        '已查过：抠底后叠到深绿卡面上量了边缘白晕（判据表那一行），三张都干净；四角无残留。'
        f'这条判据做过负控 —— 在 A 的轮廓外点一圈半透明白之后它报 {neg_h * 100:+.2f}%（门限 +2.00%），证明它真的会红，不是恒绿。',
        '剪影宽度四张不同（基准 953 / A 573 / B 663 / C 631）是**姿势本身**的差异：基准双臂张开、A 双手交握、'
        'B 双臂垂下、C 双手抱头。游戏按**画幅等比**显示（固定 240 设计 px 宽），所以身体一样大、只是臂展不同。',
        '本轮每张只发 1 次生图，没有自行重试、没有多出图（按你定的纪律）。要改哪一张请点名。',
    ]
    note_lines = []
    for s in notes:
        note_lines += wrap(probe, s, f_note, W - PAD * 2 - 60)
        note_lines.append('')

    TILE_W, TILE_H = 386, 352
    # ★ 小节 2 的面板 = **结算卡的等比缩小**，不是"随便一个框"。
    #   真值取自 GamePage.ts 的 `RESULT` 表：CARD_W 620、MASCOT_W 240、
    #   负态卡高 = PAD_TOP44 + MASCOT_MT30 + MASCOT_H218.9 + MASCOT_MB18
    #               + DESC_H40 + DESC_MB30 + BTN_GOLD_H100 + BTN_GOLD_MB20
    #               + BTN_GHOST_H76 + PAD_BOTTOM40 = **616.9**。
    #   ⇒ 吉祥物只占**卡宽 240/620 = 38.7%**。旧版按"面板宽的 60%"画 = 把吉祥物
    #     放大了 1.55 倍 ⇒ 会让人误判它在真机上的存在感。（面板 386px 也不代表 720 物理 px）
    CARD_W_D, CARD_H_D = 620.0, 616.9
    PANEL_W = 386
    PANEL_K = PANEL_W / CARD_W_D
    CARD_H_PX = CARD_H_D * PANEL_K
    PAD_CAP = 52                                   # 面板内卡顶之上留给缎带标题
    PANEL_H = int(round(PAD_CAP + CARD_H_PX + 10))
    NROW = len(VARIANTS)
    ROWS_N = 8                                     # 小节 3 的判据行数（与下面 row() 调用**必须**一致）

    y = PAD
    y += 62 + 8 + 34 + 24                      # 标题 + 副标
    y += 40 + 30 + (34 + 12 + TILE_H + 12 + 22 + 22) + 24          # 小节 1
    y += 40 + 30 + (PANEL_H + 12 + 22) + 24                        # 小节 2
    y += 40 + 30 + 30 + 16 + ROWS_N * 46 + 6 + 24                  # 小节 3
    y += 40 + 30 + len(note_lines) * 32 + 20 + 30 + PAD            # 小节 4 + 页脚

    # ★ 板高**只用来给个够大的画布**，最终按实际画到的 y 裁 —— 预算算术一旦写错，
    #   表现是"末尾内容被静默裁掉"，不报错、只能靠眼看（踩过）。先给 500 的余量。
    board = Image.new('RGB', (W, y + 500), C_BG)
    d = ImageDraw.Draw(board)

    # ================================================ 标题
    y = PAD
    d.text((PAD, y), '第 47 轮 · 失败吉祥物三方案', font=f_title, fill=C_GOLD)
    y += 62 + 8
    d.text((PAD, y), '形象不变，只换「失败」的动作与表情 · AI 图生图（以 splash/mascot.png 为底，input_fidelity = high）',
           font=f_sub, fill=C_DIM)
    y += 34 + 24

    # ================================================ 小节 1
    d.text((PAD, y), '1 · 四个形象并排（棋盘格只为看清透明边界，不参与任何判据）', font=f_h, fill=C_CREAM)
    y += 40 + 30
    top = y
    for i, (k, short, cn, p) in enumerate(VARIANTS):
        x0 = PAD + i * (TILE_W + 24)
        cx = x0 + TILE_W / 2
        if k == 'ref':
            d.rounded_rectangle([x0, top, x0 + TILE_W, top + 34], radius=17, outline=C_DIM, width=2)
        else:
            d.rounded_rectangle([x0, top, x0 + TILE_W, top + 34], radius=17, fill=(24, 62, 47), outline=C_GOLD, width=2)
        lab = '原形象（胜利 / 通用）' if k == 'ref' else f'方案 {short}'
        d.text((cx - d.textlength(lab, font=f_chip) / 2, top + 4), lab, font=f_chip,
               fill=C_CREAM if k == 'ref' else C_GOLD)

        iy = top + 34 + 12
        img = overlay_checker(fit(p, TILE_W, TILE_H))
        board.paste(img, (int(cx - img.width / 2), int(iy)))

        cap = cn
        d.text((cx - d.textlength(cap, font=f_cap) / 2, iy + TILE_H + 12), cap, font=f_cap, fill=C_CREAM)
        m = M[k]
        sub = f"主体 {m['subj'][0]}×{m['subj'][1]} · 占画幅高 {m['h_ratio'] * 100:.1f}%"
        d.text((cx - d.textlength(sub, font=f_cap) / 2, iy + TILE_H + 12 + 22), sub, font=f_cap, fill=C_DIM)
    y = top + 34 + 12 + TILE_H + 12 + 22 + 22 + 24

    # ================================================ 小节 2
    d.text((PAD, y), f'2 · 放进「就差一点！」失败弹层的真实版式（卡 620×616.9 设计 px，整体等比缩到 {PANEL_W}px 展示）',
           font=f_h, fill=C_CREAM)
    y += 40 + 30
    top = y
    f_rb = font(40, True)
    f_sm = font(17)
    bw = (CARD_W_D - 80) * PANEL_K                    # 两个按钮同宽 = CARD_W − 80
    for i, (k, short, cn, p) in enumerate(VARIANTS):
        x0 = PAD + i * (PANEL_W + 24)
        cx = x0 + PANEL_W / 2
        panel = Image.new('RGB', (PANEL_W, PANEL_H), C_BG)
        pd = ImageDraw.Draw(panel)
        ct, cb = PAD_CAP, PAD_CAP + CARD_H_PX         # 卡顶 / 卡底（面板内坐标）

        # 卡面垂直渐变 #1B6047 → #123F30（与 fillVGradient 同口径，圆角裁剪）
        gh = max(1, int(CARD_H_PX))
        grad = Image.new('RGB', (1, gh))
        gd = ImageDraw.Draw(grad)
        for yy in range(gh):
            t = yy / max(1.0, gh - 1)
            gd.point((0, yy), fill=tuple(int(C_CARD2[c] + (0x12 - C_CARD2[c]) * t) for c in range(3)))
        grad = grad.resize((PANEL_W - 1, gh))
        mask = Image.new('L', (PANEL_W - 1, gh), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, PANEL_W - 2, gh - 1],
                                               radius=int(36 * PANEL_K), fill=255)
        panel.paste(grad, (0, int(ct)), mask)
        # 外深绿描边环（box-shadow 0 0 0 3px #0A3327）+ 金色粗边
        pd.rounded_rectangle([-2, ct - 3, PANEL_W + 1, cb + 3], radius=int(39 * PANEL_K),
                             outline=(0x0A, 0x33, 0x27), width=4)
        pd.rounded_rectangle([0, ct, PANEL_W - 1, cb], radius=int(36 * PANEL_K),
                             outline=C_GOLD, width=3)
        # 缎带标题（骑缝：中心落在卡顶之上 34 设计 px）
        rby = ct - 34 * PANEL_K
        pd.text((PANEL_W / 2 - pd.textlength('就差一点！', font=f_rb) / 2, max(4, rby - 26)),
                '就差一点！', font=f_rb, fill=C_CREAM)
        # 吉祥物：宽 240 设计 px、顶边距卡顶 74 设计 px
        mw = max(1, int(round(240 * PANEL_K)))
        mh = max(1, int(round(240 / CANVAS_ASPECT * PANEL_K)))
        mk = Image.open(p).convert('RGBA').resize((mw, mh), Image.LANCZOS)
        panel.paste(mk, (int(PANEL_W / 2 - mw / 2), int(ct + 74 * PANEL_K)), mk)
        # 副标题（负态那一行）
        pd.text((PANEL_W / 2 - pd.textlength('就差一点，再接再厉', font=f_sm) / 2, ct + 314 * PANEL_K),
                '就差一点，再接再厉', font=f_sm, fill=C_DIM)
        # 主按钮（金）+ 次按钮（幽灵）
        by = ct + 380.9 * PANEL_K
        pd.rounded_rectangle([PANEL_W / 2 - bw / 2, by, PANEL_W / 2 + bw / 2, by + 100 * PANEL_K],
                             radius=int(50 * PANEL_K), fill=(0xD8, 0xA4, 0x3C))
        by2 = ct + 500.9 * PANEL_K
        pd.rounded_rectangle([PANEL_W / 2 - bw / 2, by2, PANEL_W / 2 + bw / 2, by2 + 76 * PANEL_K],
                             radius=int(38 * PANEL_K), outline=C_GOLD, width=2)
        board.paste(panel, (int(x0), int(top)))

        lab = f'方案 {short}' if k != 'ref' else '原形象'
        d.text((cx - d.textlength(lab, font=f_cap) / 2, top + PANEL_H + 10), lab, font=f_cap, fill=C_DIM)
    y = top + PANEL_H + 12 + 22 + 24

    # ================================================ 小节 3
    d.text((PAD, y), '3 · 判据（尺度 / 抠底质量）—— 每一行都带对照，不写死绝对阈值', font=f_h, fill=C_CREAM)
    y += 40 + 30
    cols = [('项目', 340), ('基准 原形象', 210), ('A 委屈', 180), ('B 垂头', 180), ('C 懊恼', 180), ('结论', 180)]
    x = PAD
    for name, cw in cols:
        d.text((x, y), name, font=f_body, fill=C_GOLD)
        x += cw
    y += 30
    d.line([(PAD, y), (W - PAD, y)], fill=(60, 96, 80), width=2)
    y += 16

    _overflow = []

    def row(label, getter, judge=None):
        nonlocal y
        # ★ 标签溢出**必须喊**：项目列是固定宽，长标签会直接压进数值列，
        #   而 PIL 不会报错、看着只是"文字挤在一起"。踩过（本轮 336 > 300）。
        lw = d.textlength(label, font=f_body)
        if lw > cols[0][1] - 10:
            _overflow.append((label, lw))
        x = PAD
        d.text((x, y), label, font=f_body, fill=C_CREAM)
        x += cols[0][1]
        for i, (k, _, _, _) in enumerate(VARIANTS):
            d.text((x, y), getter(M[k]), font=f_mono, fill=C_DIM if i == 0 else C_CREAM)
            x += cols[i + 1][1]
        if judge is not None:
            ok = judge()
            d.text((x, y), 'OK' if ok else 'NG', font=f_body, fill=C_OK if ok else C_NG)
        y += 46

    def all_ok(fn):
        return all(fn(M[k]) for k, _, _, _ in VARIANTS)

    row('主体高占画幅比', lambda m: f"{m['h_ratio']:.4f}",
        lambda: all_ok(lambda m: abs(m['h_ratio'] - ref['h_ratio']) < 0.005))
    row('主体像素尺寸', lambda m: f"{m['subj'][0]}×{m['subj'][1]}", None)
    row('与基准的高占比偏差', lambda m: f"{abs(m['h_ratio'] - ref['h_ratio']) * 100:.2f}%",
        lambda: all_ok(lambda m: abs(m['h_ratio'] - ref['h_ratio']) < 0.005))
    row('剪影宽高比（只记录）', lambda m: f"{m['aspect']:.3f}", None)
    row('「中」字高 / 主体高', lambda m: f"{m['zhong_h']:d} / {m['zhong_r']:.3f}",
        lambda: all_ok(lambda m: m['zhong_r'] >= 0.20))
    row('暖色像素数（只记录）', lambda m: f"{m['warm_px']}", None)
    row('轮廓外 2px 亮度增量', lambda m: f"{m['halo'] * 100:+.2f}%",
        lambda: all_ok(lambda m: m['halo'] < 0.02))
    row('四角 40×40 不透明残留', lambda m: f"{m['residue'] * 100:.2f}%",
        lambda: all_ok(lambda m: m['residue'] < 0.005))
    y += 6
    if _overflow:
        for lb, lw in _overflow:
            print(f'⚠️ 判据表标签溢出：{lb!r} 宽 {lw:.0f} > 列宽 {cols[0][1] - 10} —— 会压进数值列，请缩短')
    print(f'判据表标签长度自检：{"OK" if not _overflow else "NG"}')

    # ================================================ 小节 4
    d.text((PAD, y), '4 · 已知代价（必读）', font=f_h, fill=C_CREAM)
    y += 40 + 30
    for ln in note_lines:
        if ln:
            d.text((PAD, y), ln, font=f_note, fill=C_WARN if ln.startswith('「中」字位置') else C_DIM)
        y += 32
    y += 20
    d.text((PAD, y), '复现： python3 tools/r47-fail-mascot-prep.py   →   python3 tools/r47-fail-mascot-board.py',
           font=f_mono, fill=(120, 148, 134))

    # ★ 按**实际**画到的高度裁掉预留余量（预算算术错了也不会静默裁内容）
    end = y + 24 + PAD
    board = board.crop((0, 0, W, end))

    out_png = os.path.join(OUT, '00-方案试样一览.png')
    board.save(out_png)
    print(f'板  {out_png}  {board.width}×{board.height}')
    for k, _, _, _ in VARIANTS:
        m = M[k]
        print(f"  {k:3s} 高占比 {m['h_ratio']:.4f}  白晕 {m['halo'] * 100:+6.2f}%  "
              f"角残留 {m['residue'] * 100:5.2f}%  「中」高 {m['zhong_h']:3d}({m['zhong_r']:.3f})  "
              f"暖色 {m['warm_px']:6d}  主体 {m['subj'][0]}×{m['subj'][1]}")


if __name__ == '__main__':
    main()
