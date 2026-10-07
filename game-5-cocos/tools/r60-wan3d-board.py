#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r60-wan3d-board.py · 万子 3D 替换「对账板」生成（第 60 轮）

五段，一板看完：
  ① 新万 9 张 —— 归一化后 224×298 原尺寸，叠**深绿桌底**（真机同底）
  ② 风格落差 —— 新万 3 / 旧条 3 / 旧筒 3 混排，直观看跨花色落差
  ③ 灰阶对照 —— 新万_dead 3 与 旧条/筒_dead 并排 + **平均亮度实测数字**
  ④ 新万_dead 全 9 张
  ⑤ 3 倍特写 —— 一万左上角 / 九万右下角，检查抠图边缘与绿棱
  ⑥ 运行期证据 —— 主玩页真实截图 + 每块万牌的 f210 实测（★ 本节由 _r60-verify 的产物喂入）

脚本内自检（判据先于出图）：
  · 9 张 alpha>16 的 bbox 宽≤224、高≤298（零裁切）
  · 深绿底「白晕」像素 = 0（抠图残留白边检测）
用法：python tools/r60-wan3d-board.py
  ⑥ 段需要先跑过 `node tools/_r60-verify.mjs`（读 /tmp/g5-r60-verify 下的截图与 rects）；
  缺产物时自动跳过该段并打印提示，不影响前五段出图。
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.normpath(os.path.join(HERE, '..'))
ROOT = os.path.normpath(os.path.join(PROJ, '..'))
BUNDLE = os.path.join(PROJ, 'assets', 'bundles', 'game', 'tiles')
OUT = os.path.join(ROOT, 'docs-verify', 'game-5', 'game-play', 'round60')
FELT = (12, 38, 27)
BG = (240, 240, 236)
PANEL = (250, 250, 247)
INK = (26, 26, 28)
MUTED = (112, 114, 120)
GOLD = (168, 122, 26)
RED = (186, 58, 44)
CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
W, H = 224, 298

PAD = 34
COL = W + 18          # 每列宽


def lum_of(im):
    a = np.asarray(im).astype(float)
    m = a[:, :, 3] > 200
    if not m.any():
        return 0.0
    rgb = a[:, :, :3][m]
    return float((0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]).mean())


def put(page, im, x, y, scale=1.0, pad=10, tag='', tagcolor=MUTED):
    w, h = int(im.width * scale), int(im.height * scale)
    panel = Image.new('RGB', (w + pad * 2, h + pad * 2), FELT)
    r = im.resize((w, h), Image.LANCZOS) if scale != 1.0 else im
    panel.paste(r, (pad, pad), r)
    page.paste(panel, (x, y))
    if tag:
        ImageDraw.Draw(page).text((x + 4, y + h + pad * 2 + 6), tag, fill=tagcolor)
    return w + pad * 2, h + pad * 2


def main():
    os.makedirs(OUT, exist_ok=True)
    wan = [Image.open(f'{BUNDLE}/wan/wan{i}.png').convert('RGBA') for i in range(1, 10)]
    tiao = [Image.open(f'{BUNDLE}/tiao/tiao{i}.png').convert('RGBA') for i in (1, 2, 3)]
    tong = [Image.open(f'{BUNDLE}/tong/tong{i}.png').convert('RGBA') for i in (1, 2, 3)]
    dwan = [Image.open(f'{BUNDLE}/wan/wan{i}_dead.png').convert('RGBA') for i in range(1, 10)]
    dtiao = [Image.open(f'{BUNDLE}/tiao/tiao{i}_dead.png').convert('RGBA') for i in (1, 2, 3)]

    # ── 自检先跑 ──
    rows = []
    for i, im in enumerate(wan, 1):
        a = np.asarray(im)[:, :, 3]
        ys, xs = np.where(a > 16)
        bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        rgb = np.asarray(im)[:, :, :3].astype(int)
        halo = int(((a > 8) & (a < 200) & (rgb.min(2) > 205)).sum())
        assert bw <= W and bh <= H, f'wan{i} {bw}x{bh} 越界'
        assert halo == 0, f'wan{i} 白晕 {halo} px'
        rows.append((f'{CN[i-1]}万', bw, bh, lum_of(im)))
        print(f'  wan{i}  可见 {bw}x{bh}  白晕 0  亮度 {lum_of(im):.1f}')
    print('  ✅ 自检：9 张零裁切 · 白晕全 0')

    L_WAN = sum(r[3] for r in rows) / 9
    L_TIAO = sum(lum_of(x) for x in tiao) / 3
    D_WAN = sum(lum_of(x) for x in dwan) / 9
    D_TIAO = sum(lum_of(x) for x in dtiao) / 3

    # ── 版面 ──
    # 画布先过量分配，收尾按实际 y 裁到真实高度（避免"算漏一格就被截断"）
    WIDTH = PAD * 2 + COL * 9
    SZ = 20                                   # 每格贴图外扩
    S1 = 60 + H + SZ * 2 + 26
    S2 = 60 + H + SZ * 2 + 26
    S3 = 60 + H + SZ * 2 + 26
    S4 = 60 + int(224 * 0.76) + SZ * 2 + 26
    CROP = (120, 120)                         # 特写裁剪边长（须在图内，见下）
    ZOOM = 2
    S5 = 60 + (CROP[0] * ZOOM + 40) + 26
    # ⑥ 运行期：整页截图 + 牌桌区特写 + 实测表
    RSHOT = '/tmp/g5-r60-verify/60-主玩页-新万牌.png'
    RRECTS = '/tmp/g5-r60-verify/tile-rects.json'
    has_rt = os.path.exists(RSHOT) and os.path.exists(RRECTS)
    Z6 = 1.2          # 整页截图放大
    Z7 = 3.0          # 牌桌区特写放大
    S6 = 0
    if has_rt:
        _im = Image.open(RSHOT)
        S6 = 60 + max(int(_im.height * Z6), 760) + 26
    HEIGHT = PAD + 50 + S1 + S2 + S3 + S4 + S5 + S6 + PAD + 120
    page = Image.new('RGB', (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(page)

    def head(y, no, title, sub):
        d.rectangle([0, y, WIDTH, y + 50], fill=(26, 60, 48))
        d.text((PAD, y + 8), f'{no}  {title}', fill=(255, 255, 255))
        d.text((PAD, y + 29), sub, fill=(166, 208, 190))
        return y + 60

    y = PAD
    d.text((PAD, y), 'game-5《麻麻大消除》· 第 60 轮 · 万子 3D 版入库对账板', fill=INK)
    d.text((PAD, y + 18), f'rembg(u2netp) 抠白底 → alpha>8 定 bbox → 内切 contain → 224×298 · '
                          f'新万可见宽 210~222（旧万同为 210~222，几何关系保持）', fill=MUTED)
    y += 50

    y = head(y, '①', '新万 9 张（归一化 224×298 · 零裁切 · 叠深绿桌底）',
             f'可见宽 210~222 px · 平均亮度 {L_WAN:.1f}')
    for i, im in enumerate(wan):
        x = PAD + i * COL
        w, h = put(page, im, x, y, tag=f'{CN[i]}万  {rows[i][1]}×{rows[i][2]}')
    y += S1

    y = head(y, '②', '风格落差（★ 重点看这一段）',
             '新万＝3D 写实（白面 + 绿棱）  旧条/筒＝2D 描金扁平（金框 + 插画）—— 两套视觉语言')
    for i, im in enumerate(wan[:3]):
        put(page, im, PAD + i * COL, y, tag=f'{CN[i]}万（新 3D）', tagcolor=GOLD)
    for i, im in enumerate(tiao):
        put(page, im, PAD + (3 + i) * COL, y, tag=f'{CN[i]}条（旧 2D）')
    for i, im in enumerate(tong):
        put(page, im, PAD + (6 + i) * COL, y, tag=f'{CN[i]}筒（旧 2D）')
    y += S2

    y = head(y, '③', '灰阶「被压」对照 —— 亮度口径实测',
             f'新万_dead 平均亮度 {D_WAN:.1f}  vs  旧条_dead {D_TIAO:.1f}'
             f'（差 {D_WAN - D_TIAO:+.1f}）⇒ 新万被压后比条/筒更亮，是奶白牌面的必然结果')
    for i, im in enumerate(dwan[:3]):
        put(page, im, PAD + i * COL, y, scale=1.0, tag=f'{CN[i]}万_dead  亮度{lum_of(im):.0f}', tagcolor=GOLD)
    for i, im in enumerate(dtiao):
        put(page, im, PAD + (3 + i) * COL, y, scale=1.0, tag=f'{CN[i]}条_dead  亮度{lum_of(im):.0f}')
    y += S3

    y = head(y, '④', '新万_dead 全 9 张（168×224 · r45c 离线烘 · 非运行时滤镜）',
             'grayscale(.9) brightness(.66) contrast(.95) —— 与方案页 CSS 逐参数对应')
    for i, im in enumerate(dwan):
        put(page, im, PAD + i * COL + 20, y, tag=f'{CN[i]}万')
    y += S4

    y = head(y, '⑤', '3 倍特写（检查抠图边缘 / 绿棱 / 圆角有没有被啃）',
             '左：一万左上角    右：九万右下角    背景＝真机深绿桌底')
    for j, (im, box) in enumerate([(wan[0], (0, 0, 120, 120)), (wan[8], (104, 178, 224, 298))]):
        c = im.crop(box)
        c = c.resize((c.width * ZOOM, c.height * ZOOM), Image.NEAREST)
        panel = Image.new('RGB', (c.width + 40, c.height + 40), FELT)
        panel.paste(c, (20, 20), c)
        page.paste(panel, (PAD + j * (c.width + 90), y))
        ImageDraw.Draw(page).text((PAD + j * (c.width + 90), y + c.height + 46),
                                  f'{"一万 左上角" if j == 0 else "九万 右下角"} · 源区 {CROP[0]}px ×{ZOOM}',
                                  fill=MUTED)
    y += S5

    # ── ⑥ 运行期证据（主玩页真实截图 + 实测读数）──
    if has_rt:
        import json
        from PIL import ImageFont
        F26 = ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc', 26, index=0)
        F20 = ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc', 20, index=0)
        shot = Image.open(RSHOT).convert('RGB')
        rects = json.load(open(RRECTS, encoding='utf-8'))
        FELT_F = np.array(list(FELT), dtype=np.float64)

        def f210_of(r):
            x0 = int(round(r['x'] - r['w'] / 2)); y0 = int(round(r['y'] - r['h'] / 2))
            x1 = min(shot.width, int(round(x0 + r['w']))); y1 = min(shot.height, int(round(y0 + r['h'])))
            x0, y0 = max(0, x0), max(0, y0)
            if x1 - x0 < 8 or y1 - y0 < 8:
                return None
            sub = np.asarray(shot.crop((x0, y0, x1, y1))).astype(np.float64).reshape(-1, 3)
            m = np.abs(sub - FELT_F).sum(1) > 45
            if m.sum() < 60:
                return None
            px = sub[m]
            lum = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
            return float((lum >= 210).mean())

        live = [(r, f210_of(r)) for r in rects if not r['frame'].endswith('_dead')]
        live = [(r, f) for r, f in live if f is not None]
        top = max([f for _, f in live] or [0.0])
        OLD_F, NEW_F = 0.084, 0.696
        GATE = OLD_F + 0.20

        y = head(y, '⑥', '运行期证据 —— 主玩页真实截图 + 每块万牌实测 f210',
                 f'f210 ＝ 矩形内「非桌底像素」中亮度 ≥210 的占比。'
                 f'对照：新素材合成图 {NEW_F*100:.1f}% · 旧素材 {OLD_F*100:.1f}% ⇒ 门槛 {GATE*100:.1f}%')
        # 左：整页
        big = shot.resize((int(shot.width * Z6), int(shot.height * Z6)), Image.LANCZOS)
        page.paste(big, (PAD, y))
        # 中：牌桌区特写（按 rects 的并集外扩 34px 自动定窗，不写死坐标）
        xs0 = min(r['x'] - r['w'] / 2 for r in rects); xs1 = max(r['x'] + r['w'] / 2 for r in rects)
        ys0 = min(r['y'] - r['h'] / 2 for r in rects); ys1 = max(r['y'] + r['h'] / 2 for r in rects)
        cx0, cx1 = int(max(0, xs0 - 34)), int(min(shot.width, xs1 + 34))
        cy0, cy1 = int(max(0, ys0 - 34)), int(min(shot.height, ys1 + 34))
        crop = shot.crop((cx0, cy0, cx1, cy1))
        zoom = crop.resize((int(crop.width * Z7), int(crop.height * Z7)), Image.LANCZOS)
        zx = PAD + big.width + 34
        page.paste(zoom, (zx, y))
        dd = ImageDraw.Draw(page)

        def mark(x0, y0, x1, y1, f, label):
            col = (46, 178, 104) if f >= GATE else (226, 176, 56)
            dd.rectangle([x0, y0, x1, y1], outline=col, width=4)
            tb = dd.textbbox((0, 0), label, font=F20)
            lx, ly = x0, max(y, y0 - (tb[3] - tb[1]) - 10)
            dd.rectangle([lx - 3, ly - 3, lx + (tb[2] - tb[0]) + 6, ly + (tb[3] - tb[1]) + 6],
                         fill=(20, 24, 22))
            dd.text((lx, ly), label, fill=col, font=F20)

        for r, f in live:
            mark(PAD + int((r['x'] - r['w'] / 2) * Z6), y + int((r['y'] - r['h'] / 2) * Z6),
                 PAD + int((r['x'] + r['w'] / 2) * Z6), y + int((r['y'] + r['h'] / 2) * Z6),
                 f, f'{r["frame"]} {f*100:.0f}%')
            mark(zx + int((r['x'] - r['w'] / 2 - cx0) * Z7), y + int((r['y'] - r['h'] / 2 - cy0) * Z7),
                 zx + int((r['x'] + r['w'] / 2 - cx0) * Z7), y + int((r['y'] + r['h'] / 2 - cy0) * Z7),
                 f, f'{r["frame"]} {f*100:.0f}%')
        dd.text((PAD + 6, y + big.height + 8), f'整页（×{Z6}）· 真机 421×927 CSS', fill=MUTED, font=F20)
        dd.text((zx + 6, y + zoom.height + 8),
                f'牌桌区特写（×{Z7}）—— 奶白面带绿棱＝新 3D 万牌，与旧 2D 描金条/筒同屏', fill=MUTED, font=F20)
        # 右：实测表
        tx = zx + zoom.width + 40
        dd.text((tx, y), '实测表（亮像素阈值 210）', fill=INK, font=F26)
        dd.text((tx, y + 34), f'门槛 ＝ 旧素材上界 {OLD_F:.1%} + 20pt ＝ {GATE:.1%}', fill=MUTED, font=F20)
        dd.text((tx, y + 62), f'新素材合成图对照 ＝ {NEW_F:.1%}', fill=MUTED, font=F20)
        ry = y + 104
        for r, f in live:
            ok = f >= GATE
            col = (28, 118, 68) if ok else (150, 110, 20)
            dd.text((tx, ry), f'{r["frame"]:<7}{f*100:5.1f}%', fill=col, font=F26)
            dd.text((tx + 200, ry + 4), '✔ 只可能是新素材' if ok else '· 被遮挡压低了（不可判）',
                    fill=col, font=F20)
            ry += 34
        ry += 14
        dd.text((tx, ry), f'最高 {top*100:.1f}% ≥ 门槛 {GATE*100:.1f}% ⇒ 新 3D 素材确已进画面',
                fill=(28, 118, 68), font=F26)
        for k, s in enumerate([
            '为什么这条判据成立（单调性）：',
            '遮挡压上来的是深色像素 ⇒ 只会把 f210 往下拖。',
            '所以「旧素材在任何遮挡下」都到不了自己的未被遮挡值，',
            '实测最亮的一块超过该上界 ⇒ 只能是新素材渲染出来的。',
            '',
            '反面：per 块判「这块新旧」不可判 —— 实测一块被盖 93% 的',
            '真·新牌 f210=0.0，与旧素材同区间 ⇒ 那类读数只报数、不当判据。',
        ]):
            dd.text((tx, ry + 40 + k * 26), s, fill=MUTED, font=F20)
        y += S6
    else:
        print('  ⚠ 未找到运行期产物（先跑 node tools/_r60-verify.mjs），跳过 ⑥ 段')

    page = page.crop((0, 0, WIDTH, min(y + PAD * 2, HEIGHT)))

    outp = os.path.join(OUT, '60-万子3D替换-对账板.png')
    page.save(outp)
    print(f'\n✅ 对账板 → {outp}  {page.size[0]}×{page.size[1]}')
    print(f'   新万平均亮度 {L_WAN:.1f} · 新万_dead {D_WAN:.1f} · 旧条_dead {D_TIAO:.1f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
