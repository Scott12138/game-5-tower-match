# -*- coding: utf-8 -*-
"""开局页拍板交付图 v3（自动字号适配 + 严格分带，绝不压字/截字）。
01-桌图方案对比.png    A/C 并排 + 中央圆盘 1:1 方形细节 + 骰子候选
02-开局页终态预览.png  A/C 各一张 750×1334 真实落位 + 运镜三帧时序
"""
import os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PROC = 'docs-verify/game-5/game-start/proc'
OUT = 'docs-verify/game-5/game-start'
MET = {r['code']: r for r in json.load(open(os.path.join(PROC, 'metrics.json')))}
FB = '/System/Library/Fonts/Hiragino Sans GB.ttc'
_F = {}
def F(s):
    if s not in _F: _F[s] = ImageFont.truetype(FB, s, index=0)
    return _F[s]

def fit(d, txt, maxw, start=30, floor=15):
    """自动挑一个能塞进 maxw 的字号。"""
    s = start
    while s > floor and d.textlength(txt, font=F(s)) > maxw:
        s -= 1
    return F(s)

GOLD = (246, 196, 69); CREAM = (243, 236, 220); DIM = (146, 160, 146)
BLUE = (79, 163, 224); RED = (226, 122, 106)
ENV_TOP = (16, 26, 22); ENV_BOT = (5, 9, 8)
ENG = lambda c: os.path.join(PROC, 'engine', 'table_%s_750.jpg' % c)
MAS = lambda c: os.path.join(PROC, 'master', 'table_%s_1024.jpg' % c)
DICE = os.path.join(PROC, 'dice')
PAD = 46


def env(w, h):
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.repeat(np.array(ENV_TOP, np.float32)[None, None] * (1 - t)
                  + np.array(ENV_BOT, np.float32)[None, None] * t, w, axis=1)
    return Image.fromarray(a.astype(np.uint8), 'RGB')


# ============================== 01 ==============================
def build_compare():
    TW, DH = 430, 300
    Wc = PAD * 2 + TW * 2 + 30
    USABLE = Wc - PAD * 2
    y_title = PAD
    y_r1lab = y_title + 46
    y_r1 = y_r1lab + 66
    y_r1note = y_r1 + TW + 8
    y_r2lab = y_r1note + 32
    y_r2 = y_r2lab + 34
    y_r3lab = y_r2 + DH + 40
    y_r3 = y_r3lab + 34
    y_foot = y_r3 + 150 + 104
    Hc = y_foot + 30 + PAD
    cv = env(Wc, Hc)
    d = ImageDraw.Draw(cv)
    t1 = 'game-5 · 开局页桌图方案（正方形麻将桌 · 已做单应校正拉回严格俯视）'
    d.text((PAD, y_title), t1, font=fit(d, t1, USABLE, 28), fill=GOLD)

    for i, (c, lab, sub) in enumerate([
            ('A', '方案 A · 窄木边', '深木细框 + 单道金线 · 极简雅致'),
            ('C', '方案 C · 錾刻金框', '錾刻金框 + 四角云纹 · 与首页金饰同族')]):
        x = PAD + i * (TW + 30)
        d.text((x, y_r1lab), lab, font=fit(d, lab, TW, 26), fill=GOLD)
        d.text((x, y_r1lab + 32), sub, font=fit(d, sub, TW, 19), fill=DIM)
        t = Image.open(ENG(c)).convert('RGB').resize((TW, TW), Image.LANCZOS)
        cv.paste(t, (x, y_r1))
        d.rectangle([x - 1, y_r1 - 1, x + TW, y_r1 + TW], outline=(70, 92, 72))
        r = MET[c]['tray_r'] * TW
        cx, cy = x + MET[c]['tray_cx'] * TW, y_r1 + MET[c]['tray_cy'] * TW
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), width=1)
        d.line([cx - 9, cy, cx + 9, cy], fill=(255, 110, 80), width=2)
        d.line([cx, cy - 9, cx, cy + 9], fill=(255, 110, 80), width=2)
        note = '圆盘直径 %.1f%% 桌面边长 · 工程版 %.0fKB' % (MET[c]['tray_dia_pct'], MET[c]['engine_kb'])
        d.text((x, y_r1note), note, font=fit(d, note, TW, 18), fill=DIM)

    t2 = '中央骰盘 1:1 方形细节（从 1024 母版按实测圆心裁 44%，等比未变形）'
    d.text((PAD, y_r2lab), t2, font=fit(d, t2, USABLE, 21), fill=CREAM)
    for i, c in enumerate(['A', 'C']):
        x = PAD + i * (TW + 30)
        m = Image.open(MAS(c)).convert('RGB'); w, h = m.size
        cx, cy = int(MET[c]['tray_cx'] * w), int(MET[c]['tray_cy'] * h)
        s = int(w * 0.44)
        x0 = max(0, min(cx - s // 2, w - s)); y0 = max(0, min(cy - s // 2, h - s))
        cv.paste(m.crop((x0, y0, x0 + s, y0 + s)).resize((DH, DH), Image.LANCZOS), (x, y_r2))
        d.rectangle([x - 1, y_r2 - 1, x + DH, y_r2 + DH], outline=(70, 92, 72))

    t3 = '骰子候选（独立图层叠进圆盘；碰撞动画要求骰子能单独运动，故不能画进桌图）'
    d.text((PAD, y_r3lab), t3, font=fit(d, t3, USABLE, 21), fill=CREAM)
    for i, (fn, lab, n1, n2) in enumerate([
            ('dice_bone_ai_320.png', '① AI 骨白 3D', '材质最真；但 45° 斜视、', '点数不可控、抠图有毛边'),
            ('dice_vec_gold5_320.png', '② 矢量金质 5 点', '严格俯视 · 点数精确 ·', '与启动页金骰同族 · 18KB'),
            ('dice_vec_bone4_320.png', '③ 矢量骨白 4 点', '严格俯视 · 朱红呼应中牌 ·', '边缘锐利 · 14KB')]):
        x = PAD + i * 245
        im = Image.open(os.path.join(DICE, fn)).convert('RGBA').resize((150, 150), Image.LANCZOS)
        bg = Image.new('RGB', (150, 150), (14, 44, 34)); bg.paste(im, (0, 0), im)
        cv.paste(bg, (x, y_r3))
        d.rectangle([x - 1, y_r3 - 1, x + 150, y_r3 + 150], outline=(60, 84, 66))
        d.text((x, y_r3 + 160), lab, font=fit(d, lab, 230, 20), fill=GOLD)
        for k, ln in enumerate((n1, n2)):
            d.text((x, y_r3 + 186 + k * 22), ln, font=fit(d, ln, 230, 16), fill=DIM)
    t4 = '已淘汰：方案 B 胡桃木宽边 —— 毡面上下宽度差 3.0%（非严格俯视）且左右被画幅裁切，整桌不完整'
    d.text((PAD, y_foot), t4, font=fit(d, t4, USABLE, 18), fill=RED)
    cv.save(os.path.join(OUT, '01-桌图方案对比.png'))
    print('01', cv.size)


# ============================== 02 ==============================
def build_preview():
    SW, SH, TAB, TAB_Y = 750, 1334, 750, 292
    sc = 0.44
    cw, ch = int(SW * sc), int(SH * sc)
    FR = 170
    Wc = PAD * 2 + cw * 2 + 30
    USABLE = Wc - PAD * 2
    y_title = PAD
    y_lab = y_title + 46
    y_card = y_lab + 30
    y_seq_lab = y_card + ch + 40
    y_seq = y_seq_lab + 34
    Hc = y_seq + (FR + 28) * 2 + PAD
    cv = env(Wc, Hc)
    d = ImageDraw.Draw(cv)
    d.text((PAD, y_title), 'game-5 · 开局页「拉远结束」终态预览', font=fit(d, 'game-5 · 开局页「拉远结束」终态预览', USABLE, 28), fill=GOLD)

    DZ = {'A': 'dice_bone_ai_320.png', 'C': 'dice_vec_bone4_320.png'}
    for i, c in enumerate(['A', 'C']):
        scr = env(SW, SH)
        tab = Image.open(ENG(c)).convert('RGB').resize((TAB, TAB), Image.LANCZOS)
        scr.paste(tab, (0, TAB_Y))
        tcx, tcy = MET[c]['tray_cx'] * TAB, TAB_Y + MET[c]['tray_cy'] * TAB
        dz = Image.open(os.path.join(DICE, DZ[c])).convert('RGBA').resize((146, 146), Image.LANCZOS)
        scr.paste(dz, (int(tcx - 132), int(tcy - 96)), dz)
        dz2 = dz.rotate(-26, resample=Image.BICUBIC, expand=True)
        scr.paste(dz2, (int(tcx + 26), int(tcy - 22)), dz2)
        ov = Image.new('RGBA', (SW, SH), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.rectangle([0, 0, SW - 1, TAB_Y - 1], fill=(246, 196, 69, 30), outline=(246, 196, 69, 160), width=2)
        od.rectangle([0, TAB_Y + TAB, SW - 1, SH - 1], fill=(79, 163, 224, 30), outline=(79, 163, 224, 160), width=2)
        od.rectangle([34, TAB_Y + 34, SW - 35, TAB_Y + TAB - 34], outline=(255, 255, 255, 80), width=2)
        scr = Image.alpha_composite(scr.convert('RGBA'), ov).convert('RGB')
        sd = ImageDraw.Draw(scr)
        sd.text((24, 14), '顶部信息区（桌外深色区）', font=F(26), fill=GOLD)
        sd.text((24, 48), '暂停 / 第 N 关 / 已清 n/m / 限时 / 规则', font=F(18), fill=(228, 216, 182))
        sd.text((24, TAB_Y + TAB + 14), '底部交互区（桌外深色区）', font=F(26), fill=BLUE)
        sd.text((24, TAB_Y + TAB + 48), '槽位条 8(+1) 格 / 道具栏四件套', font=F(18), fill=(202, 224, 242))
        sd.text((46, TAB_Y + 44), '桌面内牌堆安全区 750×682', font=F(17), fill=(238, 238, 238))
        x = PAD + i * (cw + 30)
        d.text((x, y_lab), '方案 %s · %s' % (c, MET[c]['label']), font=fit(d, '方案 %s · %s' % (c, MET[c]['label']), cw, 24), fill=GOLD)
        cv.paste(scr.resize((cw, ch), Image.LANCZOS), (x, y_card))
        d.rectangle([x - 1, y_card - 1, x + cw, y_card + ch], outline=(70, 92, 72))

    d.text((PAD, y_seq_lab), '运镜时序（相机纯缩放、无位移；0.00s 碰撞+聚焦 → 1.20s 拉远至整桌）',
           font=fit(d, '运镜时序（相机纯缩放、无位移；0.00s 碰撞+聚焦 → 1.20s 拉远至整桌）', USABLE, 21), fill=CREAM)
    for r, c in enumerate(['A', 'C']):
        yy = y_seq + r * (FR + 28)
        d.text((PAD, yy + FR // 2 - 12), '方案 %s' % c, font=F(22), fill=GOLD)
        tab = Image.open(ENG(c)).convert('RGB')
        cx, cy = int(MET[c]['tray_cx'] * TAB), int(MET[c]['tray_cy'] * TAB)
        for j, (zs, lab) in enumerate([(2.1, '0.00s  聚焦骰盘'), (1.5, '0.60s  开始拉远'), (1.0, '1.20s  露出整桌')]):
            w = int(TAB / zs)
            x0 = max(0, min(cx - w // 2, TAB - w)); y0 = max(0, min(cy - w // 2, TAB - w))
            f = tab.crop((x0, y0, x0 + w, y0 + w)).resize((FR, FR), Image.LANCZOS)
            fx = PAD + 116 + j * (FR + 14)
            cv.paste(f, (fx, yy))
            d.rectangle([fx - 1, yy - 1, fx + FR, yy + FR], outline=(70, 92, 72))
            d.text((fx, yy + FR + 5), lab, font=F(16), fill=DIM)
    cv.save(os.path.join(OUT, '02-开局页终态预览.png'))
    print('02', cv.size)


build_compare()
build_preview()
