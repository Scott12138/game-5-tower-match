#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
r41-bg-candidates.py · 主玩页「桌外底色」三款候选样底生成器

【背景】主玩页桌外底色当前是纯 #000000（GamePage.buildEnv 里 EnvFx 拿纯黑
把 Env 的渐变整片盖掉），观感死黑。本轮出三款「有质感、细腻」的替代样底。

【三款的性格差异（不是同一张图换色）】
  A 墨玉凝霜  无方向 · 极细玉屑磨砂 + 玉绿柔光        → 最稳、最干净
  B 织锦经纬  有方向 · 45° 细斜纹织锦 + 顶部暖光      → 与桌面绒布同族、最有布感
  C 回纹锦地  有图形 · 暗刻回纹锦地 + 四角金芒        → 呼应桌面金框、最有仪式感

【两条设计约束（都是被真实数据逼出来的）】
  ① **主玩页只有"上带(约 260 CSS px) + 下带(约 240 CSS px) + 极窄左右缝"是可见的**
     （桌子纵向占 788~2047 物理 px，几乎顶满宽度）。所以渐变必须做成
     **纵向大尺度**（上亮下暗），而不是"中心亮四周暗"——后者的亮部恰好被桌子全挡住。
  ② 亮度不能抬太高：槽位空框 / 暂停胶囊本身是深玉底（实测填充亮度 ≈ 8~12），
     底色一抬它们的轮廓对比就掉（第 39 轮已记过"槽位对比度偏低"）。
     ⇒ 控制在 **上带均值 ≈ 20 / 下带均值 ≈ 10** 这个量级，先把纹样做出来再谈亮度。

【产出】<outdir>/A|B|C-page.png（整页 1263×2781）+ A|B|C-tile.png（无缝平铺小图）+ report.json
用法：python r41-bg-candidates.py <outdir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/g5-r41-bg'
os.makedirs(OUT, exist_ok=True)

W, H = 1263, 2781                      # 真机物理像素（1264×2780 差 1px）
PX = 1263.0 / 750.0                    # 1 设计 px = 1.6853 物理 px


# ---------------------------------------------------------------- 基础工具
def radius_field(size, center=(0.5, 0.5), extent=(0.72, 0.82)):
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx / (w - 1) - center[0]) / extent[0]
    ny = (yy / (h - 1) - center[1]) / extent[1]
    return np.clip(np.sqrt(nx * nx + ny * ny), 0.0, 1.0)


def hexc(s):
    return np.array([int(s[j:j + 2], 16) for j in (1, 3, 5)], np.float32)


def radial(size, stops, center=(0.5, 0.5), extent=(0.72, 0.82)):
    t = radius_field(size, center, extent)
    out = np.zeros((size[1], size[0], 3), np.float32)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        c0, c1 = hexc(c0), hexc(c1)
        m = (t >= t0) & (t <= t1)
        if not m.any():
            continue
        k = ((t[m] - t0) / max(t1 - t0, 1e-6))[:, None]
        out[m] = c0 * (1 - k) + c1 * k
    return out


def vtilt(arr, top=1.18, bot=0.78, power=1.0):
    """纵向明暗倾斜：顶部乘 top、底部乘 bot（线性插值）"""
    h = arr.shape[0]
    k = (np.arange(h, dtype=np.float32) / (h - 1)) ** power
    f = bot + (top - bot) * (1.0 - k)
    return arr * f[:, None, None]


def over(dst, src_rgba):
    a = src_rgba[:, :, 3:4] / 255.0
    return dst * (1 - a) + src_rgba[:, :, :3] * a


def vgrad(size, stops):
    """纵向 RGBA 渐变覆盖层"""
    h = size[1]
    out = np.zeros((h, 1, 4), np.float32)
    ys = np.arange(h, dtype=np.float32) / (h - 1)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        m = (ys >= t0) & (ys <= t1)
        if not m.any():
            continue
        k = ((ys[m] - t0) / max(t1 - t0, 1e-6))[:, None]
        out[m, 0, :] = np.array(c0, np.float32) * (1 - k) + np.array(c1, np.float32) * k
    return np.repeat(out, size[0], axis=1)


def noise2d(shape, seed, octaves):
    """多频白噪（值域 ≈ ±1）。octaves = [(周期px, 幅度), ...]"""
    h, w = shape
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    for period, amp in octaves:
        ph = max(2, int(round(h / period)))
        pw = max(2, int(round(w / period)))
        small = rng.normal(0, 1, (ph, pw)).astype(np.float32)
        up = np.asarray(Image.fromarray(small, 'F').resize((w, h), Image.BICUBIC), np.float32)
        acc += up * amp
    acc -= acc.mean()
    s = acc.std()
    return acc / s if s > 1e-6 else acc


def to_img(a):
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGB')


def lum_stats(a):
    m = a.mean(axis=2)
    return {'mean': round(float(m.mean()), 2), 'p99': round(float(np.percentile(m, 99)), 1),
            'std': round(float(m.std()), 2),
            'topband': round(float(m[300:500, 100:1160].mean()), 2),
            'botband': round(float(m[2545:2770, 100:1160].mean()), 2)}


report = {}

# ================================================================ A 墨玉凝霜
A_stops = [(0.00, '#17251E'), (0.34, '#0F1B15'), (0.66, '#070E0A'), (1.00, '#020503')]

a_page = vtilt(radial((W, H), A_stops, (0.5, 0.50), (0.72, 0.82)), 1.20, 0.76)
# 玉屑磨砂：4px + 1.6px 双频，幅度 ±4.4 —— "细腻"靠高频小幅度
a_n = noise2d((H, W), 0xA1, [(4.0, 1.0), (1.6, 0.52)])
a_page += a_n[:, :, None] * np.array([4.4, 4.9, 4.7], np.float32)
# ★ 玉絮：40px 低频絮状起伏（±3.2）—— 没有它就只有"电视机雪花"，
#   看不出是块料；有了它才像"玉里有絮"，这是"质感"与"噪点"的分界。
a_page += noise2d((H, W), 0xA9, [(46.0, 1.0), (23.0, 0.5)])[:, :, None] * np.array([3.0, 3.4, 3.2], np.float32)
# 玉绿柔光：只在桌子背后（不可见）与外圈之间做过渡，让"上带"偏玉而非偏灰
glow = radial((W, H), [(0.0, '#2C6B4C'), (0.55, '#143524'), (1.0, '#000000')], (0.5, 0.50), (0.72, 0.82))
gm = ((1.0 - radius_field((W, H), (0.5, 0.50), (0.72, 0.82))) ** 1.5 * 0.13)[:, :, None]
a_page = a_page * (1 - gm) + glow * gm
a_page = over(a_page, vgrad((W, H), [(0.0, (0, 0, 0, 40)), (0.11, (0, 0, 0, 0)),
                                     (0.93, (0, 0, 0, 0)), (1.0, (0, 0, 0, 96))]))
# ---- 生产用资产（**不是整页大图**：整页 PNG 3.6MB，远超主包红线）----
# 高频颗粒 → 无缝小图 TILED；低频玉絮 → 1/8 分辨率整页图（拉伸，无重复感）
A_TILE = 128
a_tile = noise2d((A_TILE, A_TILE), 0xA1, [(4.0, 1.0), (1.6, 0.52)])[:, :, None] * np.array([4.4, 4.9, 4.7], np.float32)
to_img(a_page).save(f'{OUT}/A-page.png')
to_img(np.clip(a_tile + 8, 0, 255)).save(f'{OUT}/A-tile.png')       # 偏置 +8：PNG 表达不了负值
cloud = noise2d((H // 8, W // 8), 0xA9, [(46.0 / 8, 1.0), (23.0 / 8, 0.5)])[:, :, None] * np.array([3.0, 3.4, 3.2], np.float32)
to_img(np.clip(cloud + 8, 0, 255)).save(f'{OUT}/A-cloud.png')
report['A'] = {'name': '墨玉凝霜', **lum_stats(np.clip(a_page, 0, 255))}

# ================================================================ B 织锦经纬
B_TILE = 128
B_PITCH = 16                    # 128 / 16 = 8 周期 ⇒ 无缝（8px 太细，在噪点里读不出"织"）
B_stops = [(0.00, '#1A2A21'), (0.34, '#111E17'), (0.66, '#08100B'), (1.00, '#030604')]

b_page = vtilt(radial((W, H), B_stops, (0.5, 0.50), (0.74, 0.84)), 1.16, 0.72)


def weave_tile(n, pitch, seed, jitter=0.0):
    """
    斜纹织物：主族（↗）+ 副族（↘，幅 0.26）。

    ⚠️ 第一版用的是「棋盘交替选两族」⇒ 出来是**菱形网格**（像铁丝网，不像布）。
    真正的斜纹布是**一路斜着走的主脊**，副族只在纬纱处微微交叠，
    所以改成"主族 0.74 + 副族 0.26"的加权叠加。
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    k = 2 * np.pi / pitch
    a1 = np.sin(k * (xx + yy)) + 0.30 * np.sin(2 * k * (xx + yy))
    a2 = np.sin(k * (xx - yy)) + 0.30 * np.sin(2 * k * (xx - yy))
    v = 0.74 * a1 + 0.26 * a2
    if jitter > 0:
        v = v + rng.normal(0, jitter, (n, n)).astype(np.float32)
    v = v - v.mean()
    return v / (np.abs(v).max() + 1e-6)


b_tv = weave_tile(B_TILE, B_PITCH, 0xB2, jitter=0.07)
v_full = b_tv[np.ix_(np.arange(H) % B_TILE, np.arange(W) % B_TILE)]
b_page += v_full[:, :, None] * np.array([7.6, 8.0, 7.8], np.float32)
b_page += noise2d((H, W), 0xB7, [(2.6, 1.0)])[:, :, None] * 1.5
b_page = over(b_page, vgrad((W, H), [(0.0, (255, 247, 230, 20)), (0.24, (255, 247, 230, 0)),
                                     (0.90, (0, 0, 0, 0)), (1.0, (0, 0, 0, 88))]))
b_tile = b_tv[:, :, None] * np.array([7.6, 8.0, 7.8], np.float32) \
    + noise2d((B_TILE, B_TILE), 0xB7, [(2.6, 1.0)])[:, :, None] * 1.5
to_img(b_page).save(f'{OUT}/B-page.png')
to_img(b_tile).save(f'{OUT}/B-tile.png')
report['B'] = {'name': '织锦经纬', **lum_stats(np.clip(b_page, 0, 255))}

# ================================================================ C 回纹锦地
C_TILE = 156                    # ≈ 92.5 设计 px，一屏 8 格 —— 大字回纹才读得出来
C_stops = [(0.00, '#142018'), (0.34, '#0D1812'), (0.66, '#060D09'), (1.00, '#020503')]

c_page = vtilt(radial((W, H), C_stops, (0.5, 0.50), (0.72, 0.82)), 1.18, 0.74)
c_page += noise2d((H, W), 0xC3, [(3.0, 1.0), (1.4, 0.45)])[:, :, None] * np.array([3.0, 3.3, 3.1], np.float32)


def fret_tile(n, ink=(15.5, 16.8, 15.6)):
    """
    一个"回"字锦地单元 = **真·方形回旋**（2.5 圈的方螺旋，线宽 2.4px）。

    ⚠️ 第一版画的是"外方框 + 内方框 + 短划"⇒ 出来是菱形/方格网，
    读成"坐标纸"而不是回纹。回纹的本质是**一根线盘进去**，所以必须画螺旋。
    """
    ss = 4
    m = n * ss
    d = 0.14 * m                     # 外边距
    step = (m - 2 * d) / 5.0         # 每圈内缩 2*step
    lw = int(round(2.4 * ss))
    pts = []
    x0, y0 = d, d
    x1, y1 = m - d, m - d
    pts += [(x0, y1), (x0, y0), (x1, y0), (x1, y1)]        # 第 1 圈（留右边缺口）
    pts += [(x0 + step, y1), (x0 + step, y0 + step), (x1 - step, y0 + step), (x1 - step, y1 - step)]
    pts += [(x0 + 2 * step, y1 - step), (x0 + 2 * step, y0 + 2 * step), (x1 - 2 * step, y0 + 2 * step)]

    im = Image.new('F', (m, m), 0.0)
    ImageDraw.Draw(im).line(pts, fill=1.0, width=lw, joint='curve')
    return np.asarray(im.resize((n, n), Image.LANCZOS), np.float32)[:, :, None] * np.array(ink, np.float32)


c_tile = fret_tile(C_TILE)
c_page += c_tile[np.ix_(np.arange(H) % C_TILE, np.arange(W) % C_TILE)]
for (cx, cy) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]:
    g = radial((W, H), [(0.0, '#F6C445'), (0.6, '#5A4520'), (1.0, '#000000')], (cx, cy), (0.30, 0.17))
    gm = ((1.0 - radius_field((W, H), (cx, cy), (0.30, 0.17))) ** 1.7 * 40)[:, :, None]
    c_page = over(c_page, np.dstack([g, np.repeat(gm, 3, axis=2)]).astype(np.float32))
c_page = over(c_page, vgrad((W, H), [(0.0, (255, 247, 230, 16)), (0.22, (255, 247, 230, 0)),
                                     (0.90, (0, 0, 0, 0)), (1.0, (0, 0, 0, 92))]))
to_img(c_page).save(f'{OUT}/C-page.png')
to_img(c_tile).save(f'{OUT}/C-tile.png')
report['C'] = {'name': '回纹锦地', **lum_stats(np.clip(c_page, 0, 255))}

report['now'] = {'name': '现状（纯黑铺满）', **lum_stats(np.zeros((H, W, 3), np.float32))}

with open(f'{OUT}/report.json', 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
for k, v in report.items():
    print('%-4s %-12s mean=%-6s p99=%-6s std=%-6s 上带=%-6s 下带=%s'
          % (k, v['name'], v['mean'], v['p99'], v['std'], v['topband'], v['botband']))
