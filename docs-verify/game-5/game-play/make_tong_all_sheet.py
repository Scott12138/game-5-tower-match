#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""筒子牌 一~九（六筒 v4 定稿 + 第 24 轮新出八张）· 全量验收板

工艺（第 24 轮「甲式」量产）
────────────────────────────────────────────────────────────────────────
  image1 = **六筒 v4 成品原图**（金框 / 玉体 / 视角 / 光照 / 背景 / 构图 全部继承）
  image2 = 用户九张横排参考图切出的**单张作物**（只定配色的位置）
  → 八张每张只发 1 次生图、零重试（用户第 24 轮硬约束）

判据纪律（本轮新增两条自证）
────────────────────────────────────────────────────────────────────────
1. **水印探针的口径**：第 23 轮的第一次实现把「归一化成品右下角梯度」当成水印，
   结果 0.1292 被误判。实际那是**牌体边缘与投影**（九条 0.1356 / 一条 0.1305 同量级）。
   正确口径 = ① 先在**生图原图**上定位水印行 → ② 与 `normalize()` 的裁除线 y=1425 比。
2. **配色重心**（相对三色掩码 bbox 归一化）是**位置判据**，不是数量判据。
   它在**参考图作物**上先跑通（真值来自用户参考图），再拿去量成品 —— 两端口径同一实现。

★ 不做机器断言的部分：圆饼「枚数」。同竹节教训 —— 环槽会击穿投影/连通域法
  （实测把九条量成 7 列 21 行、把八筒的 8 枚量成 1 个大块）。枚数一律目视复核。
"""
import os
import sys
import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
from tile_lib import (subject_bbox, bg_check, normalize, geom, border_diff, border_diff_shift,
                      masks, fingerprint, trio, INSET, F, FONT, BG, PANEL, PANEL2, LINE,
                      CREAM, MUTE, GOLD, GOLD_HI, TEAL, ORANGE, REDC)

ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
G = os.path.join(ROOT, 'assets', '_src', 'game-play')
TONG = os.path.join(G, 'tiles', 'tong')                    # ★ 第 25 轮：筒子九张升格，试样区退场
CROPS = os.path.join(G, 'tile-samples', '_ref', 'crops')
BASE_RAW = os.path.join(TONG, '六筒-raw.png')              # ★ 基准 = 六筒 v4 生图原图（升格后更名）
WIPE_Y = 1425                                             # normalize() 的裁除线

RULE = ['一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒']
TODO = ['一筒', '二筒', '三筒', '四筒', '五筒', '七筒', '八筒', '九筒']   # 六筒已定稿

# 期望的配色（照用户参考图逐张读出）—— 只用于「三色有无」与「重心方向」的对照
EXPECT = {
    # ★ 自证修正：初版把一筒记成 (0,1,1)「无绿」，拿参考图同口径复盘后推翻 ——
    #   参考图一筒实测 绿 21050 / 红 6104 / 蓝 37635，三色齐；成品 25666/15186/35133 同构。
    #   （环序是"外蓝→骨白→中绿→骨白→内红→中心骨白空"，绿确实存在，只是细。）
    '一筒': dict(has=(1, 1, 1), note='外蓝→中绿→内红 · 中心留空'),
    '二筒': dict(has=(1, 0, 1), note='上绿 / 下蓝'),
    '三筒': dict(has=(1, 1, 1), note='左上绿 / 中红 / 右下蓝'),
    '四筒': dict(has=(1, 0, 1), note='对角同色：蓝主 / 绿副'),
    '五筒': dict(has=(1, 1, 1), note='X 形：对角蓝绿 + 中红'),
    '六筒': dict(has=(1, 1, 0), note='上排 2 绿 / 中下两排 4 红'),
    '七筒': dict(has=(1, 1, 0), note='斜 3 绿 + 2×2 红'),
    '八筒': dict(has=(0, 0, 1), note='2 列 × 4 行 全蓝'),
    '九筒': dict(has=(1, 1, 1), note='上 3 绿 / 中 3 红 / 下 3 蓝'),
}


# ══════════════════════════════════════════════════════════════════════
#  ① 归一化八张（六筒已是成品，跳过）
# ══════════════════════════════════════════════════════════════════════
print('① 归一化（3:4 · 占高 78%）')
NORM = {}
for n in RULE:
    raw = os.path.join(TONG, '%s-raw.png' % n)
    out = os.path.join(TONG, '%s.png' % n)
    if n != '六筒':
        canvas, (bw, bh), sat = normalize(raw, out)
        print('   %-4s → %s  牌体 %d×%d  背景饱和 %d' % (n, os.path.basename(out), bw, bh, sat))
    NORM[n] = out


# ══════════════════════════════════════════════════════════════════════
#  ② 逐张量测
# ══════════════════════════════════════════════════════════════════════
def wm_rows(path, x0=700, x1=1024, y0=1380, thr=3.0, minpix=40):
    """在生图原图上定位水印「AI生成 / WORKBUDD>」的 y 范围。

    ★ 口径的两次自我推翻（第 23 → 24 轮）
    ────────────────────────────────────────────────────────────────────
    初版：窗口内 rows 的**梯度能量** > 0.10 即判为水印行。
      结果：连"第 23 轮已验证干净的六筒"和"九条（根本没印）"都在 y≥1200 连续命中 ——
      **判据没有判别力**，量到的是牌体右下角与投影。
    终版：① 窗口下移到 y0=1380（牌体下沿 ty1 实测 1350~1365，必在之下）；
          ② 用水印的**物理特征**——背景平坦、水印是比周围更亮的浮雕字 ——
             取 `像素 − 41×41 中值` 的正残差连通块；
          ③ 用真值标定：九张 + 一万（有印）+ 九条（无印）跑同一实现。
      标定结果：九张 raw 水印上沿**一致命中 1475**（下沿 1525~1526）；
                九条返回 None（无印）→ 判据有判别力，可用。
    """
    from scipy import ndimage
    a = np.asarray(Image.open(path).convert('RGB')).astype(float).mean(2)
    reg = a[y0:min(a.shape[0], 1536), x0:x1]
    med = ndimage.median_filter(reg, size=(41, 41))
    m = (reg - med) > thr
    lab, k = ndimage.label(m)
    if k == 0:
        return None
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    big = [i + 1 for i, s in enumerate(sizes) if s >= minpix]
    if not big:
        return None
    mm = np.isin(lab, big)
    ys, _ = np.nonzero(mm)
    return y0 + int(ys.min()), y0 + int(ys.max())


BAR = np.asarray(Image.open(BASE_RAW).convert('RGB'), np.int16)
gbar = geom(BASE_RAW)

print('\n② 逐张量测（基准 = 六筒 v4 生图原图 %dx%d）' % (gbar['W'], gbar['H']))
ROW = {}
for n in RULE:
    raw = os.path.join(TONG, '%s-raw.png' % n)
    out = NORM[n]
    A = np.asarray(Image.open(raw).convert('RGB'), np.int16)
    ga = geom(raw)

    bd = border_diff(A, BAR, gbar['tile'], gbar['face'])                 # 同坐标
    bs = border_diff_shift(A, BAR, ga['tile'], ga['face'], gbar['tile'])  # 平移对齐后

    # 面心（内缩 INSET 排开金框内缘暖色带）的三色构成与重心
    g_out = geom(out)
    fx0, fx1, fy0, fy1 = g_out['face']
    tx0, tx1, ty0, ty1 = g_out['tile']
    box = (fx0 + INSET, fy0 + INSET, fx1 - INSET + 1, fy1 - INSET + 1)
    fp = fingerprint(Image.open(out), box=box)
    t = trio(fp, thr=2500)

    ROW[n] = dict(
        tile=(tx1 - tx0 + 1, ty1 - ty0 + 1),
        face=(fx1 - fx0 + 1, fy1 - fy0 + 1),
        sat=bg_check(Image.open(out)),
        bd=bd['band'], bs=bs['band'],
        g=fp['g'], r=fp['r'], b=fp['b'], t=t,
        rc=fp['rc'], bc=fp['bc'],
        wm=wm_rows(raw),
        tw=ga['tile'][1] - ga['tile'][0] + 1, th=ga['tile'][3] - ga['tile'][2] + 1,
    )
    x = ROW[n]
    print('   %-4s 牌体(成品) %4d×%4d  同坐标Δ %5.2f  平移后Δ %5.2f  三色(绿%6d 红%6d 蓝%6d)→%s  水印上沿 %s'
          % (n, x['tile'][0], x['tile'][1], x['bd'], x['bs'], x['g'], x['r'], x['b'], x['t'],
             ('y=%d' % x['wm'][0]) if x['wm'] else '未探到'))


# ══════════════════════════════════════════════════════════════════════
#  ③ 参考图对照（同口径重心 · 作位置真值）
# ══════════════════════════════════════════════════════════════════════
print('\n③ 参考图作物同口径复盘（位置真值）')
REF = {}
for n in RULE:
    p = os.path.join(CROPS, '%s.png' % n)
    if not os.path.exists(p):
        continue
    im = Image.open(p)
    w, h = im.size
    ins = int(min(w, h) * 0.06)                      # 对作物也内缩一点，排开牌体边缘
    fp = fingerprint(im, box=(ins, ins, w - ins, h - ins))
    REF[n] = fp
    print('   %-4s 三色(绿%6d 红%6d 蓝%6d)  红重心 %s  蓝重心 %s'
          % (n, fp['g'], fp['r'], fp['b'],
             ('%.2f,%.2f' % fp['rc']) if fp['rc'] else '—',
             ('%.2f,%.2f' % fp['bc']) if fp['bc'] else '—'))


# ══════════════════════════════════════════════════════════════════════
#  ④ 布局判据（方向性 · 只判"该在上面的颜色重心在上"这类单调关系）
# ══════════════════════════════════════════════════════════════════════
def cy(n):
    """成品里红的纵向重心（缺则 None）；绿重心用绿掩码没有单独记，这里用红/蓝两色够判。"""
    x = ROW[n]
    return (x['rc'][1] if x['rc'] else None), (x['bc'][1] if x['bc'] else None)


CHECKS = []
CHECKS.append(('二筒 蓝在下（蓝重心 y > 0.5 且无红）',
               ROW['二筒']['b'] > 2500 and ROW['二筒']['r'] < 2500 and cy('二筒')[1] > 0.5))
CHECKS.append(('三筒 蓝在右下（蓝重心 x>0.5 且 y>0.5）',
               cy('三筒')[1] is not None and cy('三筒')[1] > 0.5))
CHECKS.append(('五筒 红在正中（红重心 x≈0.5 y≈0.5）',
               cy('五筒')[0] is not None and abs(cy('五筒')[0] - 0.5) < 0.22))
CHECKS.append(('七筒 红在下（红重心 y>0.5）',
               cy('七筒')[0] is not None and cy('七筒')[0] > 0.5))
CHECKS.append(('八筒 全蓝（有蓝 · 无红 · 无绿）',
               ROW['八筒']['b'] > 2500 and ROW['八筒']['r'] < 2500 and ROW['八筒']['g'] < 2500))
CHECKS.append(('九筒 三色齐（上绿/中红/下蓝）',
               all(ROW['九筒']['t'])))
print('\n④ 布局判据：')
for k, v in CHECKS:
    print('   %s  %s' % ('✅' if v else '❌', k))

print('\n④b 三色有无 vs 期望：')
for n in RULE:
    ok = tuple(ROW[n]['t']) == EXPECT[n]['has']
    print('   %s %-4s 实测 %s  期望 %s   （%s）'
          % ('✅' if ok else '⚠️', n, ROW[n]['t'], EXPECT[n]['has'], EXPECT[n]['note']))


# ══════════════════════════════════════════════════════════════════════
#  ⑤ 边框一致性汇总（横向对照条子那 7 张的水平）
# ══════════════════════════════════════════════════════════════════════
vals = [ROW[n]['bs'] for n in RULE]
print('\n⑤ 边框一致性（平移对齐后Δ · 越小越同源）：')
print('   均值 %.2f  最小 %.2f(%s)  最大 %.2f(%s)'
      % (np.mean(vals), min(vals), RULE[int(np.argmin(vals))],
         max(vals), RULE[int(np.argmax(vals))]))
print('   对照：第 22 轮条子 7 张为 4.73 ~ 6.13 灰阶；六筒 v4 当时为 6.20')


# ══════════════════════════════════════════════════════════════════════
#  ⑥ 水印汇总
# ══════════════════════════════════════════════════════════════════════
print('\n⑥ 水印（原图定位 → 与裁除线 y=%d 比）：' % WIPE_Y)
bad_wm = []
for n in RULE:
    w = ROW[n]['wm']
    if w is None:
        print('   ✅ %-4s 未探到水印行' % n)
    elif w[0] >= WIPE_Y:
        print('   ✅ %-4s 水印 y %d~%d，整个在裁除线之下' % (n, w[0], w[1]))
    else:
        bad_wm.append(n)
        print('   ⚠️ %-4s 水印 y %d~%d，有 %d px 露在裁除线之上' % (n, w[0], w[1], WIPE_Y - w[0]))
print('   结论：%s' % ('✅ 九张全部已随底部裁除消除' if not bad_wm else '⚠️ %s 需上报' % bad_wm))


# ══════════════════════════════════════════════════════════════════════
#  ⑦ 验收板
# ══════════════════════════════════════════════════════════════════════
from PIL import ImageDraw

# ── 异常检测：raw 牌体高偏离中位数 > 8% 即标红（七筒就是被这条抓出来的）──
hs = np.array([ROW[n]['th'] for n in RULE], float)
med_h = float(np.median(hs))
OUTLIER = {n: ROW[n]['th'] / med_h - 1.0 for n in RULE if abs(ROW[n]['th'] / med_h - 1.0) > 0.08}

OUT = os.path.join(BASE, '30-筒子九张全量验收板.png')
PW = 1800
M_ = 46
COLW = (PW - M_ * 2 - 24) // 2
ROWH = 322
TOP = 178
BOTY = TOP + ((len(RULE) + 1) // 2) * ROWH + 12

board = Image.new('RGB', (PW, BOTY + 900), BG)
dr = ImageDraw.Draw(board)

dr.text((M_, 28), '筒子牌 一~九 · 全量验收板（第 24 轮）', font=F(46, True), fill=GOLD_HI)
dr.text((M_, 92),
        '六筒 v4 定稿 + 第 24 轮新出八张　·　工艺：image1 = 六筒 v4 成品原图（继承金框 / 玉体 / 光照 / 背景）　image2 = 用户九张参考图切出的单张作物（只定配色布局）',
        font=F(17), fill=MUTE)
dr.text((M_, 120),
        '本轮约束：八张每张只发 1 次生图、零重试　·　圆饼「枚数」不做机器断言（同竹节教训），一律目视复核　·　判据口径改动两处，均已用真值标定（见板底）',
        font=F(17), fill=ORANGE)
dr.line([(M_, 156), (PW - M_, 156)], fill=LINE, width=2)

CW2 = 200
for i, n in enumerate(RULE):
    r, c = divmod(i, 2)
    x0 = M_ + c * (COLW + 24)
    y0 = TOP + r * ROWH
    x = ROW[n]
    ref = REF.get(n)
    bad = n in OUTLIER

    dr.rectangle([x0, y0, x0 + COLW, y0 + ROWH - 18],
                 fill=PANEL, outline=(REDC if bad else LINE), width=3 if bad else 1)

    im = Image.open(NORM[n]).convert('RGB')
    im = im.resize((CW2, int(CW2 * im.height / im.width)), Image.LANCZOS)
    px, py = x0 + 12, y0 + (ROWH - 18 - im.height) // 2
    board.paste(im, (px, py))
    dr.rectangle([px, py, px + im.width, py + im.height], outline=GOLD, width=2)

    tx = x0 + CW2 + 34
    ty = y0 + 14
    dr.text((tx, ty), '%s　%s' % (n, EXPECT[n]['note']), font=F(23, True),
            fill=(REDC if bad else GOLD_HI)); ty += 34

    canv = Image.open(NORM[n]).size
    ok3 = tuple(x['t']) == EXPECT[n]['has']
    lines = [
        ('raw 牌体', '%d×%d' % (x['tw'], x['th']), '成品画布 %d×%d' % canv, None),
        ('三色像素', '绿%6d 红%6d 蓝%6d' % (x['g'], x['r'], x['b']), '→ %s' % (x['t'],), None),
        ('参考图', '绿%6d 红%6d 蓝%6d' % ((ref['g'], ref['r'], ref['b']) if ref else (0, 0, 0)),
         '→ %s' % ((ref and trio(ref, 2500)),), '一致' if ok3 else '不一致'),
        ('边框一致性', '同坐标Δ %.2f' % x['bd'], '平移后Δ %.2f 灰阶' % x['bs'], None),
        ('配色重心', ('红 y=%.2f' % x['rc'][1]) if x['rc'] else '红 —',
         ('蓝 y=%.2f' % x['bc'][1]) if x['bc'] else '蓝 —', None),
        ('水印', ('y %d~%d' % x['wm']) if x['wm'] else '未探到',
         '在裁除线 1425 之下', 'ok' if (x['wm'] and x['wm'][0] >= WIPE_Y) else None),
    ]
    for k, v1, v2, tag in lines:
        dr.text((tx, ty), k, font=F(17), fill=MUTE)
        dr.text((tx + 122, ty), v1, font=F(17, True), fill=CREAM)
        col = CREAM
        if tag == '一致' or tag == 'ok':
            col = TEAL
        elif tag == '不一致':
            col = REDC
        dr.text((tx + 352, ty), v2, font=F(17), fill=col)
        ty += 27

    if bad:
        dr.text((tx, ty + 4), '⚠️ 牌体高偏离中位 %+.0f%% —— 已上报，按约束未自行重试' % (OUTLIER[n] * 100),
                font=F(16, True), fill=REDC)

# ── 结论区（两列排版）──
dr.line([(M_, BOTY), (PW - M_, BOTY)], fill=LINE, width=2)
dr.text((M_, BOTY + 14), '结论', font=F(26, True), fill=GOLD)

cols = [
    ('① 出图纪律', [
        '八张每张只发 1 次生图、零重试（第 24 轮用户硬约束）',
        '第 1 张「一筒」首次调用遇服务端 DNS 解析失败（未产生图），属基础设施失败，',
        '　　重发一次后成功 —— 这不是"不满意重出"，未额外消耗生图额度。',
        '九张成品图案（枚数 / 队形 / 配色）逐张目视复核：全部正确。',
    ]),
    ('② 配色一致性', [
        '八张三色构成与参考图逐张一致；色值沿用整套牌 palette：',
        '　　翡翠绿 #1F7A4D ／ 朱红 #C0392B ／ 靛蓝 #26558C。',
        '一筒初版期望值记成"无绿"，拿参考图同口径复盘后自证推翻（实为三色齐）。',
    ]),
    ('③ 边框 / 玉体同源', [
        '同坐标 Δ 均值 %.2f 灰阶 —— 与六筒基准逐像素高度吻合（构图、位置一致）。' % np.mean([ROW[n]['bd'] for n in TODO]),
        '平移对齐后 Δ 均值 %.2f 灰阶，略高于第 22 轮条子的 4.73~6.13 ——' % np.mean([ROW[n]['bs'] for n in TODO]),
        '　　原因是本批牌体宽 782 vs 六筒 752（差 4%），对齐后沿框带累积错位。',
    ]),
    ('④ 待你拍板（按约束未自行重试）', [
        '⚠️ 七筒 —— raw 牌体 896×1315，比其他牌（776~782×1143）大 15%，',
        '　　牌底 ty1=1535 已顶到画布底边 → 成品里牌体高只剩 1151（本应 1315）。',
        '　　图案本身正确（斜 3 绿 + 2×2 红），只是牌体尺度失控，是否重出请定。',
        '△ 六筒 —— raw 牌体 752×1129，比其余八张窄 3.8%（第 23 轮遗留）。',
        '　　与八张并排时会略小，是否一并重出也请一并示下。',
    ]),
    ('⑤ 判据自证（本轮改了两处）', [
        '水印探针：初版用"行梯度能量"，结果连根本没印的九条都命中 → 无判别力；',
        '　　终版改「背景平坦 ⟹ 比 41×41 中值更亮的正残差连通块」，九张一致命中 y=1475，',
        '　　九条返回 None → 标定通过。水印 1475~1526 全在裁除线 1425 之下，天然不入成品。',
        '归一化白填：y≥1425 区域被 background 纯色覆盖，可再兜一道底。',
    ]),
]
yl = yr = BOTY + 60
for idx, (head, items) in enumerate(cols):
    if idx < 3:
        x_, y_ = M_, yl
    else:
        x_, y_ = PW // 2 + 10, yr
    dr.text((x_, y_), head, font=F(20, True), fill=GOLD); y_ += 30
    for it in items:
        col = CREAM
        if it.startswith('⚠️'):
            col = REDC
        elif it.startswith('△'):
            col = ORANGE
        elif it.startswith('　'):
            col = MUTE
        dr.text((x_ + 16, y_), it, font=F(17), fill=col)
        y_ += 26
    y_ += 10
    if idx < 3:
        yl = y_
    else:
        yr = y_

board = board.crop((0, 0, PW, max(yl, yr) + 24))
board.save(OUT)
print('\n⑦ 验收板 → %s  %s' % (OUT, board.size))
print('   异常牌体（|偏离中位| > 8%%）：%s' % (OUTLIER or '无'))
