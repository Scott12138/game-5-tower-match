#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 47 轮（续）· 方案 C 重抠的**对照板**（给用户拍板用）

小节：
  1 · 基准 / 旧抠法(阈值法) / 新抠法(rembg) 并排 —— 看整体气质与残缺位置
  2 · 顶部区域 ×3 放大对照（旧 vs 新）—— 直击"残缺"发生的那一条高光带
  3 · 方法差异可视化（青=阈值法漏抠 / 黄=误留）—— 机上证据
  4 · 判据表（每行都带对照口径）
  5 · 修复根因与复现命令

⚠️ 排版纪律（本项目踩过）：不用 emoji（中文字体渲染成豆腐块）；面板里贴图必须用**局部坐标**；
   板高**先给足余量、画完按实际 y 裁**（用预算算术会静默裁掉末尾内容）。
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'ui', 'fail-mascot-r47')
REF = os.path.join(PROJ, 'assets/resources/splash/mascot.png')
OLD = os.path.join(OUT, 'fail-C.png')
NEW = os.path.join(OUT, 'fail-C-rembg.png')
DIFF = os.path.join(OUT, 'rembg', 'C-method-diff.png')
MET = os.path.join(OUT, '_metrics-C-rembg.json')

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
MONO = '/System/Library/Fonts/Menlo.ttc'

C_BG = (16, 36, 28)
C_CARD = (26, 58, 45)
C_CREAM = (238, 232, 214)
C_GOLD = (222, 186, 110)
C_DIM = (150, 176, 160)
C_OK = (126, 214, 148)
C_NG = (232, 118, 108)

W = 1720
PAD = 56


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def mono(sz):
    try:
        return ImageFont.truetype(MONO, sz)
    except Exception:
        return font(sz)


def checker(w, h, s=16):
    """棋盘格衬底（看透明边界用）。"""
    im = Image.new('RGB', (w, h), (232, 232, 232))
    d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if ((x // s) + (y // s)) % 2:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=(200, 200, 200))
    return im


def fit(im, maxw, maxh):
    k = min(maxw / im.width, maxh / im.height)
    return im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)


def on_checker(tile, cw, ch):
    bg = checker(cw, ch)
    t = fit(tile, cw, ch)
    bg.paste(t, ((cw - t.width) // 2, (ch - t.height) // 2), t if t.mode == 'RGBA' else None)
    return bg


def main():
    met = json.load(open(MET, encoding='utf-8'))
    ref_im = Image.open(REF).convert('RGBA')
    old_im = Image.open(OLD).convert('RGBA')
    new_im = Image.open(NEW).convert('RGBA')
    diff_im = Image.open(DIFF).convert('RGB')

    board = Image.new('RGB', (W, 12000), C_BG)     # 先给足余量
    d = ImageDraw.Draw(board)
    f_h1 = font(46, True)
    f_h = font(34, True)
    f_body = font(23)
    f_cap = font(21)
    f_mono = mono(21)
    f_small = font(20)

    y = PAD
    d.text((PAD, y), '方案 C · 重新抠底（rembg）与前版对照', font=f_h1, fill=C_CREAM)
    y += 66
    d.text((PAD, y), '你指出的「残缺」= 牌体上沿那条高光带被误判成背景，沿轮廓被咬掉一条。'
                     '本版改用神经网络分割（rembg / u2net），同一套归一化口径（960×875）。',
           font=f_small, fill=C_DIM)
    y += 52

    # ============================================ 小节 1
    d.text((PAD, y), '1 · 三个形象并排（棋盘格只为看清透明边界，不参与任何判据）', font=f_h, fill=C_CREAM)
    y += 46

    # ── ★ 自动定位缺口：两张成品**同为 960×875**，可直接逐像素比（不再手填区域）
    _oa = np.asarray(old_im).astype(np.float64)[..., 3] / 255.0
    _na = np.asarray(new_im).astype(np.float64)[..., 3] / 255.0
    miss = (_oa < 0.5) & (_na >= 0.5)          # 旧图漏抠 = 残缺本身
    _lab, _n = ndimage.label(miss, structure=np.ones((3, 3)))
    _sz = ndimage.sum(miss, _lab, range(1, _n + 1))
    gap = _lab == (1 + int(np.argmax(_sz))) if _n else np.zeros_like(miss)
    _gy, _gx = np.where(gap)
    GB = (int(_gx.min()), int(_gy.min()), int(_gx.max()), int(_gy.max()))
    body_n = max(1, int((_na > 0.5).sum()))
    miss_px = int(gap.sum())

    _v = np.asarray(old_im).copy()
    _v[..., 0][gap], _v[..., 1][gap], _v[..., 2][gap], _v[..., 3][gap] = 0, 220, 255, 255
    old_vis = Image.fromarray(_v)

    CW, CH = 520, 474
    tiles = [('基准 · splash/mascot.png', ref_im, None),
             ('旧 · 阈值法（红框 = 缺口位置）', old_im, GB),
             ('新 · rembg（本版）', new_im, None)]
    for i, (lab, im, box) in enumerate(tiles):
        x0 = PAD + i * (CW + 24)
        board.paste(on_checker(im, CW, CH), (x0, y))
        if box:
            k = min(CW / im.width, CH / im.height)
            ox = x0 + (CW - im.width * k) / 2
            oy = y + (CH - im.height * k) / 2
            d.rectangle([ox + box[0] * k, oy + box[1] * k, ox + box[2] * k, oy + box[3] * k],
                        outline=(232, 88, 78), width=4)
        d.text((x0, y + CH + 12), lab, font=f_cap, fill=C_GOLD if i == 0 else C_CREAM)
    y += CH + 12 + 30 + 40

    # ============================================ 小节 2
    # ★ 取缺口的**左侧一段**（缺口从上沿左侧斜边起步）并收窄区域 ⇒ 提高放大倍数，
    #   否则按整个缺口 bbox 取景只有 ×1.7，看不出细节。
    bx0 = max(0, GB[0] - 25)
    by0 = max(0, GB[1] - 25)
    bx1 = min(old_im.width, GB[0] + 260)
    by1 = min(old_im.height, GB[3] + 20)
    ZW = 780
    k2 = ZW / (bx1 - bx0)
    ZH = int((by1 - by0) * k2)
    d.text((PAD, y), f'2 · 缺口区域 ×{k2:.1f} 放大（区域由数据自动定位：'
                     f'bbox ({GB[0]},{GB[1]})-({GB[2]},{GB[3]})，{miss_px:,} px）',
           font=f_h, fill=C_CREAM)
    y += 46
    d.text((PAD, y), '旧 · 阈值法：高光带被整片吃掉（青 = 被吃掉的像素）', font=f_cap, fill=C_NG)
    d.text((PAD + ZW + 30, y), '新 · rembg：高光带完整保留', font=f_cap, fill=C_OK)
    y += 30
    for cx, im, col in ((PAD, old_vis, (232, 88, 78)), (PAD + ZW + 30, new_im, (126, 214, 148))):
        crop = im.crop((bx0, by0, bx1, by1)).resize((ZW, ZH), Image.LANCZOS)
        bg = checker(ZW, ZH, 24)
        bg.paste(crop, (0, 0), crop)
        board.paste(bg, (cx, y))
        d.rectangle([cx, y, cx + ZW, y + ZH], outline=col, width=3)
    y += ZH + 30 + 24

    # ============================================ 小节 3
    d.text((PAD, y), '3 · 方法差异（同一坐标系：原图 1024）', font=f_h, fill=C_CREAM)
    y += 46
    dw = 900
    dd = diff_im.resize((dw, int(diff_im.height * dw / diff_im.width)), Image.LANCZOS)
    board.paste(dd, (PAD, y))
    md = met['method_diff']
    ec = met['edge_color']
    tx = PAD + 960
    d.text((tx, y + 30), '青 = 阈值法漏抠（残缺本身）', font=f_body, fill=(0, 200, 255))
    d.text((tx, y + 68), f"{md['missed_px']:,} px 占本体 {md['missed_ratio'] * 100:.2f}%", font=f_small, fill=C_CREAM)
    d.text((tx, y + 102), f"腐蚀 3px 后仍残留 {md['missed_core_px']:,} px", font=f_small, fill=C_CREAM)
    d.text((tx, y + 136), f"（{md['missed_core_ratio'] * 100:.2f}%）⇒ 是厚块，不是锯齿", font=f_small, fill=C_CREAM)
    d.text((tx, y + 200), '黄 = 误留（反向误差）', font=f_body, fill=(255, 200, 40))
    d.text((tx, y + 238), f"{md['over_px']:,} px 占 {md['over_ratio'] * 100:.2f}%", font=f_small, fill=C_CREAM)
    d.text((tx, y + 272), f"腐蚀后只剩 {md['over_core_px']} px ⇒ 只是 1~2px 的轮廓细线", font=f_small, fill=C_CREAM)
    d.text((tx, y + 306), '不是缺陷（方向性正确）', font=f_small, fill=C_CREAM)
    y += dd.height + 34

    # ============================================ 小节 4
    d.text((PAD, y), '4 · 判据（每行都带对照口径；不写死绝对阈值）', font=f_h, fill=C_CREAM)
    y += 46
    cols = [('项目', 420), ('基准 原形象', 200), ('旧 阈值法', 200), ('新 rembg', 200), ('结论', 160)]
    x = PAD
    for name, cw in cols:
        d.text((x, y), name, font=f_body, fill=C_GOLD)
        x += cw
    y += 32
    d.line([(PAD, y), (PAD + sum(c[1] for c in cols), y)], fill=(60, 96, 80), width=2)
    y += 16

    rm, om, nm = met['ref'], met['old_C'], met['new_C']
    overflow = []

    def row(label, getter, ok=None):
        nonlocal y
        if d.textlength(label, font=f_body) > cols[0][1] - 10:
            overflow.append(label)
        d.text((PAD, y), label, font=f_body, fill=C_CREAM)
        xx = PAD + cols[0][1]
        for i, m in enumerate((rm, om, nm)):
            d.text((xx, y), getter(m), font=f_mono, fill=C_DIM if i == 0 else C_CREAM)
            xx += cols[i + 1][1]
        if ok is not None:
            d.text((xx, y), 'OK' if ok else '--', font=f_body, fill=C_OK if ok else C_DIM)
        y += 44

    row('主体尺寸（设计 px）', lambda m: f"{m['subj'][0]}×{m['subj'][1]}", None)
    row('高占比 / 画幅 875', lambda m: f"{m['h_ratio']:.4f}", None)
    row('四角 40×40 残留', lambda m: f"{m['corner'] * 100:.2f}%", None)
    row('凸缺面积比（只记录）', lambda m: f"{m['hull_gap']:.4f}", None)
    row('半透明边颜色误差 /255',
        lambda m: '—' if m is not nm else f"{ec['pre_err']:.1f} → {ec['now_err']:.1f}",
        met['judge']['edge_ok'])
    row('阈值法厚块漏抠 >0.5%',
        lambda m: '—' if m is not nm else '见小节 3', met['judge']['diff_ok'])
    y += 8
    d.text((PAD, y), f"★ 凸缺/上沿跳变**只记录、不断言**：基准凸缺 {rm['hull_gap']:.4f} 反而是最大的 —— "
                     '它们量的是"姿势"，不是"缺口"（判据名必须与所量之物相符）。',
           font=f_small, fill=C_DIM)
    y += 40

    # ============================================ 小节 5 · 用途符合性
    d.text((PAD, y), '5 · 用途符合性：放进「就差一点！」弹层的实际尺寸（240 设计 px）',
           font=f_h, fill=C_CREAM)
    y += 40
    d.text((PAD, y), 'RESULT.MASCOT_W = 240 设计 px ⇒ 此处按 ×1.6 显示；基准 / 旧 / 新 三者同口径。',
           font=f_small, fill=C_DIM)
    y += 40
    PW, PH = 500, 420
    for i, (lab, im) in enumerate((('基准', ref_im), ('旧 · 阈值法', old_im), ('新 · rembg', new_im))):
        x0 = PAD + i * (PW + 24)
        card = Image.new('RGB', (PW, PH), (34, 86, 64))
        cd = ImageDraw.Draw(card)
        for yy in range(PH):
            t = yy / (PH - 1)
            cd.line([(0, yy), (PW, yy)], fill=tuple(int(46 + (20 - 46) * t) for _ in range(3)))
        cd.rounded_rectangle([0, 0, PW - 1, PH - 1], radius=26, outline=C_GOLD, width=3)
        f_rb = font(30, True)
        cd.text((PW / 2 - cd.textlength('就差一点！', font=f_rb) / 2, 14), '就差一点！',
                font=f_rb, fill=C_GOLD)
        mw = 384
        mk = im.resize((mw, int(im.height * mw / im.width)), Image.LANCZOS)
        # ⚠️ 贴图用**面板局部坐标**（用画板坐标 x0 会在 i≥1 时贴到面板外 → 只出第一格）
        card.paste(mk, (int(PW / 2 - mk.width / 2), 70), mk)
        board.paste(card, (x0, y))
        d.text((x0, y + PH + 10), lab, font=f_cap, fill=C_DIM if i == 0 else C_CREAM)
    y += PH + 12 + 30 + 40

    # ============================================ 小节 6
    d.text((PAD, y), '6 · 修复根因（两条，都可复现）', font=f_h, fill=C_CREAM)
    y += 46
    lines = [
        ('① 阈值法在「白底 + 奶白主体」上结构性不可用',
         '判据 (三通道 ≥244 且极差 ≤10) 分不开白背景与奶白本体最亮的高光带；该高光带又通过抗锯齿'
         '与画布边缘连通 ⇒ 泛洪把整条带判成背景。实测沿轮廓咬掉 8,582 px（本体 1.87%），'
         '其中厚块 5,326 px（1.16%）。'),
        ('② rembg 的输出是「预乘 alpha」的',
         '实测：各 alpha 档位上 rgb/原图 恒等于该档 alpha（0.269 / 0.424 / 0.601 / 0.811 逐一吻合）。'
         '把预乘色当直通色用 ⇒ 半透明边被压暗（原图 193 → 输出 61），缩略图上就是一块灰黑斑。'
         '本版加一步反预乘：边缘色与原图的平均绝对误差 34.6/255 → 1.9/255。'),
        ('③ 去白边只作用于本体之外',
         '本体内是画面内容（含牌面与绿书脊交界的固有阴影），不许改色 —— 否则会把柔和阴影刷成硬暗边。'),
        ('④ 尺寸口径未变，可直接替换',
         f"主体高占比 {nm['h_ratio']:.4f} = 基准 {rm['h_ratio']:.4f}（偏差 0.00%）、底边对齐、水平居中；"
         '仍归一化到 960×875 ⇒ 结算卡的吉祥物位不会漂。'),
    ]
    for t, body in lines:
        d.text((PAD, y), t, font=f_body, fill=C_GOLD)
        y += 34
        # 按像素宽折行
        cur = ''
        for ch in body:
            if d.textlength(cur + ch, font=f_small) > W - PAD * 2:
                d.text((PAD, y), cur, font=f_small, fill=C_CREAM)
                y += 30
                cur = ch
            else:
                cur += ch
        if cur:
            d.text((PAD, y), cur, font=f_small, fill=C_CREAM)
            y += 30
        y += 14

    y += 10
    d.text((PAD, y), '复现： U2NET_HOME=/Users/consli/.workbuddy/binaries/python/envs/default/u2net '
                     'python3 tools/r47-fail-mascot-rembg.py', font=f_mono, fill=(120, 148, 134))
    y += 34
    d.text((PAD, y), '成品： docs-verify/game-5/ui/fail-mascot-r47/fail-C-rembg.png（960×875 RGBA）'
                     '   ·   本轮未改动任何游戏代码，等你确认后再接入。',
           font=f_small, fill=C_DIM)
    y += PAD

    # ── 标题宽度自检（长标题会被画到板外且**不报错** —— 本项目已栽过多次）
    for t in ['1 · 三个形象并排（棋盘格只为看清透明边界，不参与任何判据）',
              f'2 · 缺口区域 ×{k2:.1f} 放大（区域由数据自动定位：bbox ({GB[0]},{GB[1]})-'
              f'({GB[2]},{GB[3]})，{miss_px:,} px）',
              '3 · 方法差异（同一坐标系：原图 1024）',
              '4 · 判据（每行都带对照口径；不写死绝对阈值）',
              '5 · 用途符合性：放进「就差一点！」弹层的实际尺寸（240 设计 px）',
              '6 · 修复根因（两条，都可复现）']:
        if d.textlength(t, font=f_h) > W - PAD * 2:
            overflow.append(t)

    board = board.crop((0, 0, W, y))
    out_png = os.path.join(OUT, '00-方案C-重抠对照.png')
    board.save(out_png)
    print(f'板  {out_png}  {board.width}×{board.height}')
    print(f'文本溢出自检：{"OK 全部通过" if not overflow else "NG 超宽: " + str(overflow)}')
    print(f"判定：{met['judge']}")


if __name__ == '__main__':
    main()
