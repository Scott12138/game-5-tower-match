#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 r42-bg-build.py · 第 42 轮 · 主玩页底色「B 织锦经纬」定稿件生产
================================================================================
 用户拍板：底色选 B（织锦经纬）· 明度档「再提 20%」。

 ---------------------------------------------------------------------------
 【为什么不能直接把整页 PNG 塞进包】
   候选稿 B-page.png 是 1263×2781 的整页图，约 3.2 MB。主包红线 4 MB、
   当前已用 2.97 MB，而**本轮之后还要塞一条 BGM** ⇒ 整页烘焙这条路上不去。
   正解 = 「小图渐变 + 无缝平铺纹样」，总计几十 KB。

 ---------------------------------------------------------------------------
 【★★ 核心难点：普通 alpha 混合做不出「加法」的纹样】
   候选稿是 `page = 渐变 + v·amp`（**加法**，幅度绝对恒定 9.6×1.2）。
   而 Sprite 默认只有 normal 混合：`out = dst·(1-a) + src.rgb·a`。
     · 若 src.rgb 取黑 → out = dst·(1-a) ⇒ **乘性**，幅度正比于底色，
       在底部暗带（底色只有 9）纹样几乎消失 ⇒ 与定稿不符。
     · 若 src.rgb 取白 → out = dst + a·(255-dst)。因为**底色很暗（5~30）**
       而 255 远高于它，`(255-dst)` 在整页上只变化 ±4% ⇒ **近似加法**！

   ⇒ 取白墨 + 令 `底色图 = 目标 - D`（D = 纹样峰值幅度），可得恒等式：
        out = (B-D) + a·(255-(B-D))，  a = (dev+D)/(255-(B_top-D))
        ⇒ out = B + dev          （dev ∈ [-D, +D] 就是纹样的有符号偏移）
     除「底色被钳到 0」的底部暗带外，**逐像素等于候选稿**。

   ★ 这条是本轮最关键的结论：**白墨 + 单边 alpha = 近似加法**，
     不需要自定义材质 / 自定义 blendState（那段 API 在 3.8 里已是 deprecated，
     踩进去就是构建期与真机的双重不确定性）。
     误差实测：上带 0.0，底部暗带峰值 +25%（绝对量 5.7/255 = 2.2% 满量程）。

 ---------------------------------------------------------------------------
 【★★ 平铺尺度：为什么是 256×256 的贴图、27 个周期】
   TILED 装配器**按贴图原始像素尺寸**在节点局部空间里平铺（见引擎
   `cocos/2d/assembler/sprite/tiled.ts` 用 `frame.getRect()`），节点 scale=1 时
   1 texel = 1 设计 px。于是「贴图 256×256 铺在 256 设计 px 的格子里」：
       周期数 m 整数（保证无缝）且 m = 256/9.4815 ⇒ **m = 27**
       实际周期 = 256/27 = 9.4815 设计 px = 15.98 物理 px（候选稿 16.0，差 0.1%）
   ⚠️ 贴图**必须是 2 的整数幂**：引擎 `TextureBase.setWrapMode` 注释写明
      「非 2 的整数幂只允许 CLAMP_TO_EDGE」⇒ 非 POT 的 REPEAT 在 WebGL1
      （微信小游戏就是）上会直接失效 ⇒ 平铺退化成「只有一张」。

 用法：python r42-bg-build.py <outdir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/g5-r42-bg'
os.makedirs(OUT, exist_ok=True)

W, H = 1263, 2781                      # 真机物理像素
PX = 1263.0 / 750.0                    # 1 设计 px = 1.68533 物理 px

# ---- 明度档：用户拍板「再提 20%」 ----------------------------------------
GAIN = 1.20

# ---- 纹样幅度（设计口径：候选稿 B 的 amp=9.6 / 9.6 / 9.6，颗粒 1.5）------
AMP_WAVE = 9.6 * GAIN                  # 斜纹半幅
AMP_GRAIN = 1.5 * GAIN                 # 细颗粒半幅
D = AMP_WAVE + AMP_GRAIN               # 峰值总幅度（底色图 = 目标 - D）

# ---- 平铺件 --------------------------------------------------------------
TEX = 256                              # ★ 必须 POT（REPEAT 的前提）
M = 27                                 # 周期数（整数 ⇒ 无缝）；256/27 = 9.4815 设计 px
GRAIN_FREQ = 86                        # 颗粒中心频率（带限噪声；周期由 FFT 保证）
JITTER_FREQ = 40                       # 织纹抖动（同样用周期带限噪声）

# ★★ 对账用的「候选原图」—— 第 41 轮用户拍板的那张，**别再重建它**。
#    重建稿的渐变是对的，但纹样尺度曾经搞错（见下），拿它当"定稿"会让对账整体失真。
CAND = os.environ.get('G5_CAND', '/tmp/g5-r41-bg/B-page.png')

# ---------------------------------------------------------------------------
# ★★★ 引擎平铺口径（第 42 轮踩过的坑，务必记住）
#   TILED 装配器按**贴图原始像素**在节点局部空间重复，节点 scale=1 时
#   **1 texel = 1 设计 px** = PX 物理 px。
#   ⇒ 物理坐标 (x, y) 处的纹样 = 采样贴图坐标 (x/PX mod 256, y/PX mod 256)。
#   ⇒ 256 设计 px 的一个平铺块摊到真机上 = 256 × 1.68533 = 431.45 物理 px，
#      纹样周期 = 431.45 / 27 = **15.98 物理 px**（候选原图实测 16，差 0.1%）。
#
#   ⚠️ 曾经把 256 贴图按 **1:1 物理像素**平铺（`tv[arange(H)%256, arange(W)%256]`），
#      周期就变成 256/27 = **9.48 物理 px**，比候选原图细 **1.687×**。
#      阴险之处：纹样是零均值的，**上下带的亮度均值照样对得上**（25.20 / 30.23 分毫不差），
#      所以只看数字永远查不出来 —— 只有 4× 放大图并排看才露馅。
# ---------------------------------------------------------------------------
TEXPX = TEX * PX                       # 256 设计 px = 431.45 物理 px（一个平铺块的物理尺寸）


def tile_coords():
    """物理像素 → texel 坐标（含 −0.5 texel 中心偏移，与 GPU 采样一致；不预先 wrap）"""
    gx = ((np.arange(W, dtype=np.float32) / PX) - 0.5)
    gy = ((np.arange(H, dtype=np.float32) / PX) - 0.5)
    return np.meshgrid(gx, gy)


def tile_sample(t, X, Y):
    """双线性采样 + REPEAT wrap —— 模拟 GPU 的 GL_REPEAT + LINEAR。"""
    n = t.shape[0]
    x0 = np.floor(X); y0 = np.floor(Y)
    ax = (X - x0).astype(np.float32); ay = (Y - y0).astype(np.float32)
    x0i = x0.astype(np.int64) % n; y0i = y0.astype(np.int64) % n
    x1i = (x0i + 1) % n;           y1i = (y0i + 1) % n
    return (t[y0i, x0i] * (1 - ax) * (1 - ay) + t[y0i, x1i] * ax * (1 - ay)
            + t[y1i, x0i] * (1 - ax) * ay + t[y1i, x1i] * ax * ay).astype(np.float32)


def autopeaks(a, y, x0=100, x1=None):
    """单行亮度的一维自相关峰位（物理 px）—— 实测平铺周期。"""
    x1 = a.shape[1] - 100 if x1 is None else x1
    r = a[y, x0:x1].mean(axis=1).astype(np.float64)
    r -= r.mean()
    ac = np.correlate(r, r, 'full')[len(r) - 1:]
    ac /= (ac[0] + 1e-9)
    pk = []
    for i in range(6, min(len(ac) - 2, 90)):
        if ac[i] > ac[i - 1] and ac[i] >= ac[i + 1] and ac[i] > 0.25:
            pk.append((i, round(float(ac[i]), 2)))
    return pk[:5]


def blockmean(a, k):
    """k×k 盒滤波（去高频，只留低频明度场）—— 用 PIL 降采样再升采样。"""
    h, w = a.shape[:2]
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    small = im.resize((max(1, w // k), max(1, h // k)), Image.BOX)
    return np.asarray(small.resize((w, h), Image.BILINEAR), np.float32)


XX, YY = tile_coords()                 # 全页 texel 坐标（供 sim 与重建共用）


# ============================================================ 通用
def hexc(s):
    return np.array([int(s[j:j + 2], 16) for j in (1, 3, 5)], np.float32)


def radius_field(size, center=(0.5, 0.5), extent=(0.72, 0.82)):
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx / (w - 1) - center[0]) / extent[0]
    ny = (yy / (h - 1) - center[1]) / extent[1]
    return np.clip(np.sqrt(nx * nx + ny * ny), 0.0, 1.0)


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
    h = arr.shape[0]
    k = (np.arange(h, dtype=np.float32) / (h - 1)) ** power
    f = bot + (top - bot) * (1.0 - k)
    return arr * f[:, None, None]


def over(dst, src_rgba):
    a = src_rgba[:, :, 3:4] / 255.0
    return dst * (1 - a) + src_rgba[:, :, :3] * a


def vgrad(size, stops):
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
    m = np.asarray(a, np.float32).mean(axis=2)
    return {'mean': round(float(m.mean()), 2),
            'p99': round(float(np.percentile(m, 99)), 1),
            'std': round(float(m.std()), 2),
            'topband': round(float(m[300:500, 100:1160].mean()), 2),
            'botband': round(float(m[2545:2770, 100:1160].mean()), 2)}


report = {}

# ============================================================
#  一、目标页 = 候选稿 B 的算法 × 1.20
# ============================================================
B_stops = [(0.00, '#1A2A21'), (0.34, '#111E17'), (0.66, '#08100B'), (1.00, '#030604')]
b_page = vtilt(radial((W, H), B_stops, (0.5, 0.50), (0.74, 0.84)), 1.16, 0.72)


def weave_field(n, m, jitter=0.0, seed=0xB2):
    """
    斜纹织物场（**周期性由整数频率保证**，与候选稿同一条公式）。

    `sin(2π(m·x + m·y)/n)` 在 n×n 上以 n 为周期 ⇒ 平铺无缝。
    ⚠️ 候选稿写成 `sin(k(x+y))`，k 由「16 物理 px」反解 ⇒ 在 256 上不是整数
       周期、平铺会露接缝。这里改成**整数频率 m=27**，并把由此带来的
       0.1% 周期差当作可接受误差（16 物理 → 15.98 物理）。
    ⚠️ `jitter` 必须用**周期**噪声：`rng.normal` 是白噪、在接缝处不连续，
       会凭空造出一条 1px 的缝（实测 lr/innerX 从 1.00 涨到 1.23）。
    """
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    a1 = np.sin(2 * np.pi * m * (xx + yy) / n) + 0.30 * np.sin(2 * np.pi * 2 * m * (xx + yy) / n)
    a2 = np.sin(2 * np.pi * m * (xx - yy) / n) + 0.30 * np.sin(2 * np.pi * 2 * m * (xx - yy) / n)
    v = 0.74 * a1 + 0.26 * a2
    if jitter > 0:
        v = v + jitter * grain_field(n, JITTER_FREQ, seed=seed ^ 0x5A)
    v = v - v.mean()
    return v / (np.abs(v).max() + 1e-6)


def band_noise(n, f_lo, f_hi, seed):
    """
    **严格周期**的带限噪声（FFT 频域开窗 → 反变换）。

    为什么不用前两个版本：
      · `rng.normal` 白噪 —— 接缝处不连续，平铺会露 1px 缝；
      · 「若干根非整数周期正弦相加」—— 频谱太窄，叠出来是**规则点阵**
        （4× 放大看就是一格一格的网点，读起来是"编织网"不是"颗粒"）。
    频域开窗给出的是各向同性、频谱连续的颗粒，**且天然以 n 为周期**（DFT 的定义）。
    """
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.normal(0, 1, (n, n)).astype(np.float64))
    k = np.fft.fftfreq(n) * n
    r = np.sqrt(k[:, None] ** 2 + k[None, :] ** 2)
    f *= ((r >= f_lo) & (r <= f_hi)).astype(np.float64)
    out = np.real(np.fft.ifft2(f)).astype(np.float32)
    out -= out.mean()
    return out / (np.abs(out).max() + 1e-6)


def grain_field(n, freq, seed=0xB7):
    """细颗粒：中心频率 freq、带宽 ±42% 的周期带限噪声"""
    return band_noise(n, freq * 0.58, freq * 1.42, seed)


# 候选稿的低频（不可见区）+ 细颗粒（整页版）——**仅用于反解低频渐变**
# ⚠️⚠️ 这段重建出来的纹样尺度是 **1:1 物理像素**（周期 9.48 物理 px），
#      **不等于引擎尺度**（15.98 物理 px）。它能用，只是因为纹样零均值、
#      在 1263→128 的 BOX 降采样里会被平均掉，剩下的就是低频渐变。
#      ⇒ **禁止**拿 `recon-B-page.png` 当"定稿"做视觉/周期对账，那会差 1.687×。
#         视觉参照一律用候选原图 `CAND`。
v_full = np.zeros((H, W), np.float32)
tv = weave_field(TEX, M, jitter=0.07)
v_full = tv[np.ix_(np.arange(H) % TEX, np.arange(W) % TEX)]
b_page = b_page + v_full[:, :, None] * np.array([7.6, 8.0, 7.8], np.float32)
b_page = b_page + noise2d((H, W), 0xB7, [(2.6, 1.0)])[:, :, None] * 1.5
b_page = over(b_page, vgrad((W, H), [(0.0, (255, 247, 230, 20)), (0.24, (255, 247, 230, 0)),
                                     (0.90, (0, 0, 0, 0)), (1.0, (0, 0, 0, 88))]))
b_cand = np.clip(b_page, 0, 255)
to_img(b_cand).save(f'{OUT}/recon-B-page.png')

# ★ 明度档 +20%（这一支只喂养资产生产：grad-b.png / denom；不参与视觉对账）
b20 = np.clip(b_cand * GAIN, 0, 255)
to_img(b20).save(f'{OUT}/recon-B-page-x120.png')

# ============================================================
#  一·补、视觉参照 = **候选原图 × 1.20**（用户拍板的那张，不是重建稿）
# ============================================================
_cand = np.asarray(Image.open(CAND).convert('RGB'), np.float32)
if _cand.shape[:2] != (H, W):
    raise SystemExit(f'候选原图 {CAND} 尺寸 {_cand.shape[:2]} ≠ {(H, W)} —— 口径不符，拒绝出板')
tgt20 = np.clip(_cand * GAIN, 0, 255)
to_img(tgt20).save(f'{OUT}/target-page.png')
to_img(_cand).save(f'{OUT}/candidate-B-page.png')      # ×1.00 原图副本，供 4× 放大对照
report['candidate_ref'] = {'path': CAND, 'name': '候选原图 B（×1.00，用户拍板）',
                           '周期物理px': autopeaks(_cand, 650), **lum_stats(_cand)}
report['target'] = {'name': '候选原图 B ×1.20（视觉参照）',
                    '周期物理px': autopeaks(tgt20, 650), **lum_stats(tgt20)}
report['recon_scope'] = 'recon-B-page*.png 仅为资产反解路径，纹样尺度非引擎尺度，禁止用作视觉参照'

# ============================================================
#  二、底色渐变件：bgcol = max(0, 目标 - D)，再降采样
# ============================================================
bgcol = np.clip(b20 - D, 0, 255).astype(np.float32)

GW, GH = 128, 282                      # 1 texel ≈ 9.87 物理 px，对平滑渐变足够
gd = Image.fromarray(bgcol.astype(np.uint8), 'RGB').resize((GW, GH), Image.BOX)
gd.save(f'{OUT}/grad-b.png', optimize=True)
grad_up = np.asarray(gd.resize((W, H), Image.BILINEAR), np.float32)

# ============================================================
#  三、平铺件：白墨（RGB=255）+ 单边 alpha
# ============================================================
tile_v = weave_field(TEX, M, jitter=0.07)                  # ±1，mean 0
tile_n = grain_field(TEX, GRAIN_FREQ)                      # ±1，mean 0

# dev = 有符号亮度偏移（0~255 亮度单位）；D = 峰值幅度
tile_dev = tile_v * AMP_WAVE + tile_n * AMP_GRAIN          # ∈ ±D
tile_a_raw = tile_dev + D                                  # ∈ [0, 2D]，**单边**

# ---------------------------------------------------------------
# ★ 归一化分母 `denom`：取「上带精确」口径
#   恒等式 out = bgcol + (dev+D)/denom · (L-bgcol) 里，唯一破坏精确性的是
#   **底部暗带 bgcol 被钳到 0**（目标本身也钳到 0）。于是这是一个**取舍**：
#     · denom = L - bgcol_top ⇒ 上带（最大可见区、明度档最该准的地方）逐像素精确，
#       底部暗带均值 +4.8（满量程 1.9%）、纹样峰谷 +25%；
#     · denom 再放宽到 ~303（可见带 RMSE 最优）⇒ 底部均值精确，但**上带均值 -3.4**，
#       等于把用户要的「再提 20%」吃掉一半。
#   ⇒ 取前者。实测：denom=238 时上带 30.2/30.2、下带 14.3/9.5；
#           denom=303 时上带 26.9/30.2、下带 11.8/9.5（上带明显偏暗）。
# ---------------------------------------------------------------
bgcol_top = max(lum_stats(b20)['topband'] - D, 0.0)
denom = 255.0 - bgcol_top
tile_a01 = np.clip(tile_a_raw / denom, 0.0, 1.0)
tile_alpha = np.clip(tile_a01 * 255.0, 0, 255)

tile_rgba = np.zeros((TEX, TEX, 4), np.uint8)
tile_rgba[:, :, 0:3] = 255                                  # ★ 白墨
tile_rgba[:, :, 3] = np.round(tile_alpha).astype(np.uint8)
Image.fromarray(tile_rgba, 'RGBA').save(f'{OUT}/weave-b.png', optimize=True)

# 无缝自证：左右/上下边界差 vs 内部相邻列差（同时给「故意破周期」的对照组）
def seam(t):
    t = np.asarray(t, np.float32)
    lr = float(np.abs(t[:, 0] - t[:, -1]).mean())
    tb = float(np.abs(t[0, :] - t[-1, :]).mean())
    ix = float(np.abs(t[:, 1:] - t[:, :-1]).mean())
    iy = float(np.abs(t[1:, :] - t[:-1, :]).mean())
    return {'lr': round(lr, 4), 'tb': round(tb, 4),
            'innerX': round(ix, 4), 'innerY': round(iy, 4),
            'lr/innerX': round(lr / max(ix, 1e-9), 3), 'tb/innerY': round(tb / max(iy, 1e-9), 3)}


report['seam'] = {'weave+grains': seam(tile_v + tile_n),
                  'weave_only': seam(tile_v),
                  'grain_only': seam(tile_n),
                  'alpha_01': seam(tile_a01)}
# 对照组：故意用非整数周期（判据必须能抓到缝，否则判据本身没意义）
bad = np.sin(2 * np.pi * 13.4 * np.mgrid[0:TEX, 0:TEX][0] / TEX).astype(np.float32)
report['seam_control_bad'] = seam(bad)

# ============================================================
#  四、★ 正向仿真：按**引擎口径**采样贴图，预测真机会看到什么
#     sim = grad_up ∘ (1−a) + 255·a，其中 a 由 tile_sample 在
#     「1 texel = 1 设计 px」的坐标上取（REPEAT + 双线性），
#     而不是把 256 贴图按 1:1 物理像素铺 —— 后者会把周期算细 1.687×。
# ============================================================
a_engine = tile_sample(tile_a01, XX, YY)[:, :, None]
sim = grad_up * (1.0 - a_engine) + 255.0 * a_engine

# 逐带对账一律对「候选原图 ×1.20」（tgt20），不对重建稿
def band(a, y0, y1):
    return round(float(a[y0:y1, 100:1160].mean()), 2)


# 低频明度对账：把两边都做 16px 盒滤波，只比"用户要的明度档"，
# 避开"两条纹样公式本来就不一样"带来的高频差异。
lo_sim, lo_tgt = blockmean(sim, 16), blockmean(tgt20, 16)
lo_d = lo_sim - lo_tgt
report['sim'] = {
    'model': 'grad_up ∘ tile_sample(1 texel = 1 设计 px, REPEAT+LINEAR)',
    '低频RMSE(16px盒滤波)': round(float(np.sqrt((lo_d ** 2).mean())), 3),
    '低频p99abs': round(float(np.percentile(np.abs(lo_d), 99)), 2),
    '候选原图 topband': band(tgt20, 300, 500),
    '仿真 topband': band(sim, 300, 500),
    '候选原图 botband': band(tgt20, 2545, 2770),
    '仿真 botband': band(sim, 2545, 2770),
    '候选原图 全屏mean': round(float(tgt20.mean()), 2),
    '仿真 全屏mean': round(float(sim.mean()), 2),
    '候选原图 topband 纹样峰谷差': round(float(np.percentile(tgt20[300:500, 100:1160].mean(axis=2), 99)
                                          - np.percentile(tgt20[300:500, 100:1160].mean(axis=2), 1)), 1),
    '仿真 topband 纹样峰谷差': round(float(np.percentile(sim[300:500, 100:1160].mean(axis=2), 99)
                                        - np.percentile(sim[300:500, 100:1160].mean(axis=2), 1)), 1),
    '周期 物理px(自相关)': autopeaks(sim, 650),
    '期望周期 物理px': round(TEX / M * PX, 2),
}
to_img(sim).save(f'{OUT}/sim-page.png')

# 差值可视化（放大 6 倍，+128 偏置）—— 高频差异本就是两条不同纹样公式带来的，只看结构
diff = sim - tgt20
Image.fromarray(np.clip(diff * 6.0 + 128, 0, 255).astype(np.uint8), 'RGB').save(f'{OUT}/diff-x6.png')

report['params'] = {
    'GAIN': GAIN, 'AMP_WAVE': round(AMP_WAVE, 3), 'AMP_GRAIN': round(AMP_GRAIN, 3),
    'D': round(D, 3), 'TEX': TEX, 'M': M, 'GRAIN_FREQ': GRAIN_FREQ,
    '周期设计px': round(TEX / M, 4), '周期物理px': round(TEX / M * PX, 3),
    'denom': round(denom, 3), 'bgcol_top': round(bgcol_top, 2),
    'alpha_max_255': int(round(tile_alpha.max())),
}

with open(f'{OUT}/report.json', 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

for k in ('weave-b.png', 'grad-b.png', 'recon-B-page.png', 'sim-page.png',
          'target-page.png', 'candidate-B-page.png', 'diff-x6.png'):
    p = f'{OUT}/{k}'
    print(f'  {k:24s} {os.path.getsize(p):>9,d} B')
print(json.dumps(report, ensure_ascii=False, indent=2))
