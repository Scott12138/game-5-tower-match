#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规则弹层「碰 / 吃 示意图」牌面贴图裁切

【为什么需要这一步】
规则弹层卡片是**深墨绿底 + 金边**（#0E2A1F → #050D09）。
而 tiles/ 里的正式牌面是「3:4 画布 + 牌面占高 78% + 四周是白色桌面」，
直接把整张成品贴进弹层，会在牌周围留一圈白桌面 → 像贴纸，且与深底冲突。

所以按**牌体 bbox** 裁到牌体（外扩 2.5% 防切边），圆角交给 CSS 的 border-radius。
裁完以后：牌体之外只剩圆角处的极小空白，而麻将牌自身的侧面厚度本来就是米白，
所以贴到深底上不会有"白框"观感。

【纪律】
★ 只读 tiles/ 正式资产，不改写、不搬运；派生件一律落在 _src/game-play/rule-figs/。
★ 判据复用 tile_lib.subject_bbox（唯一实现），不另抄一份。
★ 不接生图：这一步是纯复用，零 token。

【为什么示意图不用"万"字牌】
实测 27 张牌体检测结果：
  筒 9 张 r=bw/bh = 0.703~0.708（σ 极小）；条 9 张 0.690~0.711；
  万 9 张 0.681~0.797（一万 0.712 / 二万 0.797 / 三万 0.762 / 六万 0.681）。
万字批次的牌体尺度不统一，三张并排会明显不齐（见探针图），
故「碰 / 吃」示意图统一用筒子（一二三筒 + 五筒），比例一致、排列整齐。
★ 万字口径不一致一事已如实上报，本轮不擅自返工（属"全量统一后处理"的活）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw                                      # noqa: E402
import tile_lib as L                                                 # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
TILES = os.path.join(ROOT, 'assets', '_src', 'game-play', 'tiles')
OUT = os.path.join(ROOT, 'assets', '_src', 'game-play', 'rule-figs')
SHEET = os.path.join(BASE, '32-规则图-牌面贴图裁切自证板.png')

PAD = 0.025          # 牌体 bbox 外扩比例（防圆角/描边切到牌体）
CATNAME = {'tong': '筒', 'tiao': '条', 'wan': '万'}

# 示意图需要的牌：碰 = 三张一模一样（五筒）；吃 = 同花色连号（一筒·二筒·三筒）
NEED = [('tong', '一筒'), ('tong', '二筒'), ('tong', '三筒'), ('tong', '五筒')]


def crop_tile(cat, name):
    """裁到牌体 bbox（外扩 PAD）。返回 (裁切图, 原图, bbox, 裁切框)。"""
    src = os.path.join(TILES, cat, name + '.png')
    im = Image.open(src).convert('RGB')
    x0, y0, x1, y1 = L.subject_bbox(im)
    bw, bh = x1 - x0, y1 - y0
    px, py = int(bw * PAD), int(bh * PAD)
    box = (max(0, x0 - px), max(0, y0 - py),
           min(im.width, x1 + px), min(im.height, y1 + py))
    return im.crop(box), im, (x0, y0, x1, y1), box


def main():
    os.makedirs(OUT, exist_ok=True)
    rows, report = [], []
    for cat, name in NEED:
        cut, src, bbox, box = crop_tile(cat, name)
        fn = 'fig-%s-%d.png' % (cat, '一二三四五六七八九'.index(name[0]) + 1)
        cut.save(os.path.join(OUT, fn))
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        report.append((fn, name, src.size, bbox, cut.size, bw / bh))
        rows.append((name, src, bbox, cut))

    # ── 自证板：逐张「原图 + bbox 框」→「裁切结果」→「目标显示尺寸预览」──
    TH = 300                                   # 统一展示高
    cw = int(TH * 0.72)
    gap, pad, hdr = 26, 22, 46
    W = pad * 2 + TH * 3 + gap * 2 + cw + pad
    H = hdr + len(rows) * (TH + gap) - gap + pad
    sh = Image.new('RGB', (W, H), L.BG)
    d = ImageDraw.Draw(sh)
    d.text((pad, 16), '规则图牌面贴图 · 裁切自证板   (左：原图+牌体bbox   中：裁切结果   右：目标显示尺寸)',
           font=L.F(20), fill=L.CREAM)
    y = hdr
    for name, src, bbox, cut in rows:
        s = src.copy()
        ImageDraw.Draw(s).rectangle(bbox, outline=(255, 80, 60), width=6)
        s = s.resize((int(s.width * TH / s.height), TH), Image.LANCZOS)
        sh.paste(s, (pad, y))
        sh.paste(cut.resize((int(cut.width * TH / cut.height), TH), Image.LANCZOS),
                 (pad + TH + gap, y))
        pv = cut.resize((cw, int(cw * cut.height / cut.width)), Image.LANCZOS)
        sh.paste(pv, (pad + (TH + gap) * 2, y))
        d.text((pad + (TH + gap) * 2, y + pv.height + 8),
               '显示 80×110', font=L.F(15), fill=L.MUTE)
        y += TH + gap
    sh.save(SHEET)

    print('输出目录 %s' % OUT)
    print('%-16s %-8s %-14s %-22s %-14s %s' % ('文件', '牌', '原图', '牌体bbox', '裁切尺寸', 'bw/bh'))
    for fn, name, ss, bb, cs, r in report:
        print('%-16s %-8s %-14s %-22s %-14s %.3f' % (fn, name, '%dx%d' % ss, str(bb), '%dx%d' % cs, r))
    print('自证板 %s  %s' % (SHEET, sh.size))


if __name__ == '__main__':
    main()
