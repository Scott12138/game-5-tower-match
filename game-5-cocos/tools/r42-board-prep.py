#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 r42-board-prep.py · 第 42 轮验收板：底色 B×1.20 的「定稿 ↔ 真机」对账
================================================================================
 【为什么不用「缩放到同尺寸再比」】
 定稿候选稿是 1263×2781、真机截图也是 1263×2781 —— 尺寸本来就一致，
 可以直接**同坐标**比。一旦去缩放比对，就把"位置对不对"这件事比没了
 （项目记忆里明写：绝不用「缩放到同尺寸再比」）。

 【量测口径与 r42-bg-build.py 完全一致】这样两张表的数才可比：
     topband = 行 300:500, 列 100:1160 的均值
     botband = 行 2545:2770, 列 100:1160 的均值
   （这两个带都落在**桌面之外**的桌外底色区，避开了金框与牌堆。）

 【额外几项】
   · maxchannel==0 占比 —— 直接量化"死黑"还剩多少（旧版是纯黑满铺）。
   · 单行自相关峰位 —— 平铺周期的**物理 px 实测值**（期望 15.97 / 31.93 / 47.85）。
     只看"贴图 wrap=REPEAT"是不够的：REPEAT 生效了但平铺尺度错了，
     肉眼同样难判。
   · 纵向拼接缝比值 —— 同一行内 x=431/432 与 x=862/863 处的水平差分
     与"干净区差分中位数"比。比值 ≈1 表示看不出缝。

【★★ 第 42 轮修正：视觉参照必须是「候选原图」，不能是重建稿】
  原本拿 `r42-bg-build.py` 的**重建稿**当"定稿"，而那条路径把 256 贴图按
  **1:1 物理像素**平铺 ⇒ 周期 9.48 物理 px，比候选原图（**16** 物理 px）细 1.687×。
  阴险之处：纹样是零均值的，**上下带亮度均值照样对得上**（25.20 / 30.23 分毫不差），
  只看数字永远查不出来。修正后三方周期都是 **16**：候选原图 16 / 仿真 16 / 真机 16。

  ⇒ 本脚本的「定稿」列 = **候选原图 ×1.20**（`target-page.png`，由候选原图 B-page.png 乘 1.20 得到）
  ⇒ 4× 放大图做成**四联**：候选原图×1.00 → 定稿×1.20 → 仿真 → 真机

 用法：python3 tools/r42-board-prep.py <outdir> [底色目录] [真机截图]
================================================================================
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/g5-r42-board'
BG = sys.argv[2] if len(sys.argv) > 2 else '/tmp/g5-r42-bg'
IMPL = sys.argv[3] if len(sys.argv) > 3 else '/tmp/g5-r42-shot/game-3x.png'
CAND = f'{BG}/candidate-B-page.png'
TGT = f'{BG}/target-page.png'
SIM = f'{BG}/sim-page.png'
os.makedirs(OUT, exist_ok=True)

W, H = 1263, 2781
PX = W / 750.0                      # 1 设计 px = 1.68533 物理 px


def load(p):
    im = Image.open(p).convert('RGB')
    if im.size != (W, H):
        raise SystemExit(f'{p} 尺寸 {im.size}，期望 {(W, H)} —— 口径不符，拒绝出板')
    return np.asarray(im, np.float32)


def stats(a):
    m = a.mean(axis=2)          # ★ 一律先转亮度再统计 —— 混着 RGB 三通道算百分位口径不一致
    b = m[300:500, 100:1160]    # 桌外上带
    return {
        'topband': round(float(b.mean()), 2),
        'botband': round(float(m[2545:2770, 100:1160].mean()), 2),
        'screen': round(float(m.mean()), 2),
        'dead_black': round(float((a.max(axis=2) == 0).mean() * 100), 2),
        # 纹样幅度：上带 p99−p1。周期对得上、幅度差很多，同样说明平铺件不对。
        'amp_p99p1': round(float(np.percentile(b, 99) - np.percentile(b, 1)), 1),
        'amp_std': round(float(b.std()), 2),
    }


def autopeaks(a, y):
    """单行亮度的一维自相关峰位（物理 px）—— 实测平铺周期。"""
    r = a[y, 100:1160].mean(axis=1).astype(np.float64)
    r -= r.mean()
    ac = np.correlate(r, r, 'full')[len(r) - 1:]
    ac /= (ac[0] + 1e-9)
    peaks = []
    for i in range(6, min(len(ac) - 2, 90)):
        if ac[i] > ac[i - 1] and ac[i] >= ac[i + 1] and ac[i] > 0.25:
            peaks.append((i, round(float(ac[i]), 2)))
    return peaks[:5]


def seam(a, y0, y1):
    """干净带内的水平差分：中位数基线 vs 拼接缝所在列。"""
    band = a[y0:y1, :, :].mean(axis=2)
    d = np.abs(np.diff(band, axis=1)).mean(axis=0)
    base = float(np.median(d))
    return {'base': round(base, 3),
            'x431_432': round(float(d[431] / base), 2),
            'x862_863': round(float(d[862] / base), 2)}


impl, tgt, sim = load(IMPL), load(TGT), load(SIM)
cand = load(CAND)
rep = {
    'candidate': stats(cand),                       # 候选原图 ×1.00（用户拍板）
    'target': stats(tgt),                           # 候选原图 ×1.20
    'sim': stats(sim),                              # 引擎口径正向仿真
    'impl': stats(impl),                            # 真机截图
    # ★ 四者同坐标、同行带各测一次自相关峰位 —— 把「肉眼看着一致」变成可比的数。
    #   这就是本轮抓出 1.687× 尺度差的判据：只比亮度均值永远看不出来（零均值纹样）。
    'period_candidate': autopeaks(cand, 650),
    'period_target': autopeaks(tgt, 650),
    'period_sim': autopeaks(sim, 650),
    'period_impl': autopeaks(impl, 650),
    'seam_impl': seam(impl, 620, 770),
    # ⚠️ 周期换算别搞错层：候选原图的「16」是**物理 px**（候选稿按物理 px 出图），
    #    对应**设计**周期 16 / 1.68533 = 9.4931；贴图里取整数 27 周期 ⇒
    #    256/27 = 9.4815 设计 px = **15.98 物理 px**。
    #    写成 `16.0 * PX` 会得到 26.94 —— 那是把物理 px 又乘了一次缩放，整层搞反。
    'expect_period_px': round(256 / 27 * PX, 2),
    'expect_period_design': round(256 / 27, 4),
    'files': {'candidate': CAND, 'impl': IMPL, 'target': TGT, 'sim': SIM},
}

# ── 周期一致性硬判据：四张图的实测首峰必须落在同一个整数上 ──
_peak = {}
for tag in ('candidate', 'target', 'sim', 'impl'):
    pk = rep[f'period_{tag}']
    _peak[tag] = pk[0][0] if pk else None
rep['period_consistency'] = {
    'first_peak': _peak,
    'all_equal': len(set(_peak.values())) == 1 and None not in _peak.values(),
    'expect': rep['expect_period_px'],
}
assert rep['period_consistency']['all_equal'], (
    f'❌ 平铺周期不一致 {_peak} —— 说明有一方的平铺尺度搞错了，拒绝出板')

# ---------------- 出图 ----------------
def crop_zoom(a, x, y, w, h, z, name):
    im = Image.fromarray(a[y:y + h, x:x + w].astype(np.uint8))
    im = im.resize((w * z, h * z), Image.NEAREST)
    im.save(os.path.join(OUT, name))
    return im


# 整页缩略（420 宽）——同尺寸同坐标，直接并排比
for tag, a in [('impl', impl), ('target', tgt)]:
    Image.fromarray(a.astype(np.uint8)).resize((420, int(H * 420 / W)), Image.LANCZOS) \
        .save(os.path.join(OUT, f'page-{tag}.png'))

# 桌外上/下带 1:1 长条（行 300:500 / 2020:2220）——肉眼判"有没有出现暗带/条纹"
for tag, p in [('impl', IMPL), ('target', TGT), ('sim', SIM)]:
    a = load(p)
    Image.fromarray(a[300:500, 60:1203].astype(np.uint8)) \
        .save(os.path.join(OUT, f'band-top-{tag}.png'))
    Image.fromarray(a[2020:2220, 60:1203].astype(np.uint8)) \
        .save(os.path.join(OUT, f'band-bot-{tag}.png'))

# 4× 放大看纹样走向（取一块**干净的桌外区**：行 340~460 落在上带内，
# 列 600~720 避开左右功能键与金框）
ZOOM = dict(x=600, y=340, w=120, h=120, z=4)
for tag, a in [('impl', impl), ('target', tgt), ('sim', sim), ('candidate', cand)]:
    crop_zoom(a, ZOOM['x'], ZOOM['y'], ZOOM['w'], ZOOM['h'], ZOOM['z'], f'zoom-{tag}.png')


# ── 四联放大图（含 ASCII 标号 + 实测周期）——
#    ★ 标号一律 ASCII：PIL 默认位图字体渲染不了中文，会变成豆腐块（判据 5）。
#    ★ 这一张是「平铺尺度对不对」最直观的判据：四方必须同为 16 物理 px。
def quad_zoom():
    panels = [
        ('candidate', 'candidate B x1.00  (approved)'),
        ('target',    'target  B x1.20'),
        ('sim',       'sim  (engine scale)'),
        ('impl',      'device screenshot'),
    ]
    z = ZOOM['z']
    pw, ph = ZOOM['w'] * z, ZOOM['h'] * z
    pad, cap = 10, 26
    cols = 2                       # ★ 2×2 而不是 1×4 —— 一行四格在板上会被压到 251px，
    rows = (len(panels) + cols - 1) // cols          # 斜纹细节就吃不出来了
    Wc = cols * pw + (cols + 1) * pad
    Hc = rows * (ph + cap) + (rows + 1) * pad
    canvas = Image.new('RGB', (Wc, Hc), (7, 18, 12))
    d = ImageDraw.Draw(canvas)
    for i, (tag, label) in enumerate(panels):
        c, r = i % cols, i // cols
        x = pad + c * (pw + pad)
        y = pad + r * (ph + cap + pad)
        canvas.paste(Image.open(os.path.join(OUT, f'zoom-{tag}.png')), (x, y))
        pk = rep[f'period_{tag}']
        period = f'period {pk[0][0]}px' if pk else 'period n/a'
        d.text((x + 2, y + ph + 7), f'{label}   |   {period}', fill=(235, 212, 154))
    canvas.save(os.path.join(OUT, 'zoom-quad.png'))
    return 'zoom-quad.png'


rep['zoom_quad'] = quad_zoom()

with open(os.path.join(OUT, 'board.json'), 'w') as f:
    json.dump(rep, f, ensure_ascii=False, indent=2)

print(json.dumps(rep, ensure_ascii=False, indent=2))
