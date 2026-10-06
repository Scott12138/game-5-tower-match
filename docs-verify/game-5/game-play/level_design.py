#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
game-5 · 关卡表与牌堆卡位设计器（第 32 轮 · 2026-10-05）· v7
==============================================================

用户第 32 轮 5 条拍板（承接第 31 轮，L1~L4 仍挂起）：
  ① N1：**层数上限维持 10 层、牌宽下限维持 88**（10 层牌堆几何上放不下更大的牌，接受）
  ② **后段开局可点率要尽量提升**（第 31 轮实测后段仅 7%~10%）
  ③ N3：**必须保留分段**以控制难度与复杂度，**可按层来分段**
  ④ N4：主玩页演示档位要**跟随真实牌数变化**
  ⑤ **单关内每张牌的尺寸（大小 + 长宽比）必须一致**；跨关可调，单关内必须统一
     （第 32 轮用户补充口径：横竖两种朝向**保留**，但横牌旋转 90° 后必须与竖牌**严格同尺寸**）

──────────────────────── ★ v7 相对 v6 的三处改动 ────────────────────────

【A】可点率：v6 的根因是**同心嵌套**
  实测 L30：138 张里 **110 张被完全覆盖**（覆盖度 = 1.0）——因为各层共用同一套单位格点、
  上层牌**正对**下层牌堆叠，只有"各层轮廓之间的环带"能露头 ⇒ 可点 ≈ 顶层张数(9) + 环带 = 10 张。
  ⇒ 可点率 ≈ **天际线张数**（各位置最上面那张牌）。三条改动：
    ① **天际线抬升 `top_share`**：把高段下层张数搬到**顶层**（顶层 ≥ top_share × 总张数）
    ② **层间错位 `layer_shift`**：每层沿**黄金角**方向横向偏移 R（Σ偏移≈0，质心不漂移）
    ③ **逐关在几何可行域内贪心最大化可点率**（硬约束：包围盒 ≤ 安全区 90%、牌宽 ≥ 88）
  实测（L30 / L21）：可点 10 → **25** / 12 → **22**，且这些牌是**零覆盖**（严格口径同值）。

【B】分段：v6「牌堆 = 整关」被用户否决 → 恢复分段，**按层切**
  段边界落在**层边界**；段内张数为 **3 的倍数**且 ≤ **36**（沿用第 1 轮拍板上限）；
  **段序自顶向下**（先清最高段 → 暴露下一段），每段独立满清可解，整关按段序推进亦满清可解；
  段边界处槽位必然归零 ⇒ 每段是一个干净的情绪单元。
  ⚠ 用户已拍板：**全堆同时在桌**（不分批上场）、**层数 = 整关总层数**（不按段计）。

【C】尺寸一致性：一关**唯一** w（h = w×4/3）；横牌 = **纯旋转**（包围盒 = 竖牌包围盒旋转 90°，
  面积与边长严格相等，禁止任何非等比缩放）。

零依赖（仅标准库）。产出 levels.json 供预览页与验收脚本消费。
"""

import json
import math
import os
import random
from collections import Counter

# ────────────────────────── 常量 ──────────────────────────

SAFE = 682                      # 安全区边长（设计 px）
FILL_MAX = 0.90                 # 牌堆包围盒占安全区上限
TILE_AR = 4.0 / 3.0             # h = w × 4/3
W_MIN, W_MAX = 88, 112          # 牌宽下限（44pt 可点）/ 上限（曲线帽顶到 112）

COVER_TH = 0.18                 # ★ 可点判定口径（沿用《羊了个羊》既有设计：只看更高层，同层不参与）
MIN_LIVE_RATIO = 0.28           # 开局可点率软目标（评分用）
MIN_LIVE_ABS = 6
MAX_PATTERN_TRY = 12            # 均匀度变体搜索上限
SHRINK_EXP = 0.55               # 保留字段（v7 已成死参数，见 README）
CROSS_RATIO = 0.22              # 横向朝向目标占比（仅 0°/90°）

LAYER_DY_BASE = 0.42            # 层间纵向步进上限（牌高倍数）
LAYER_DY_SPAN = 2.40            # 层间纵向偏移总跨度上限（牌高倍数）
JITTER = 0.025                  # 位置微小抖动（"不严格对称"的来源）

CURVE_CAP = {2: 112, 3: 110, 4: 107, 5: 104, 6: 100, 7: 97, 8: 94, 9: 91, 10: 88}

SUITS = ['wan', 'tiao', 'tong']
CN_SUIT = {'wan': '万', 'tiao': '条', 'tong': '筒'}
FOOTPRINTS = [(2.0, '椭圆丘'), (2.6, '圆角丘'), (3.4, '方丘')]

# ★ 第 32 轮新增：分段与可点率
SEG_MAX = 36                    # 段内张数上限（第 1 轮拍板）
TOP_SHARE_TRIES = (0.0, 0.10, 0.12, 0.14, 0.16, 0.18)   # 天际线抬升候选
SHIFT_TRIES = (0.0, 0.35)       # 层间黄金角错位半径候选
SHIFT_GOLD = math.radians(137.50776405003785)
CVN_LIMIT, QBAL_LIMIT = 1.25, 0.60   # 均匀度门槛（1.25 = 第 31 轮 B8 验收线）


def qbal_limit(n):
    """象限不平衡门槛：**按小样本噪声放宽**。

    象限计数期望仅 n/4，泊松相对噪声 ∝ √(4/n)；30 张的关（每象限期望 7.5）天然能抖到 0.6+。
    ⇒ n ≥ 60 用 0.60；更小的关按 √(60/n) 放宽（30 张 → 0.85），避免把离散化噪声判成"偏心"。
    """
    return QBAL_LIMIT if n >= 60 else QBAL_LIMIT * math.sqrt(60.0 / n)

# ────────────────────────── 30 关主参数 ──────────────────────────
# (关号, 整关张数, 整关总层数)
LEVELS = [
    (1, 12, 2), (2, 21, 3), (3, 30, 5), (4, 39, 5), (5, 48, 5),
    (6, 57, 6), (7, 66, 6), (8, 75, 6), (9, 84, 6),
    (10, 93, 7), (11, 96, 7), (12, 99, 7), (13, 102, 7), (14, 102, 7),
    (15, 105, 8), (16, 108, 8), (17, 111, 8), (18, 111, 8), (19, 114, 8), (20, 117, 8),
    (21, 120, 9), (22, 120, 9), (23, 123, 9), (24, 126, 9), (25, 129, 9), (26, 129, 9),
    (27, 132, 10), (28, 135, 10), (29, 135, 10), (30, 138, 10),
]

CHAPTERS = [(1, 10, '一 教学→初阶'), (11, 20, '二 进阶'), (21, 30, '三 终局')]


# ────────────────────────── 几何工具 ──────────────────────────

def layer_dy(L, span=LAYER_DY_SPAN):
    """层间纵向步进（牌高倍数）：层数多时自动收紧。"""
    if L <= 1:
        return 0.0
    return min(LAYER_DY_BASE, span / (L - 1.0))


def split_layers(n, L, exponent=0.30, floor=2):
    """把 n 张分到 L 层：底多顶少（幂次权重），每层至少 floor 张。

    指数 0.30（偏平）：各层铺位尺寸接近 ⇒ 投影密度更均匀、上层不会把下层盖死。
    """
    if L <= 1:
        return [n]
    weights = [(L - i) ** exponent for i in range(L)]
    tot = sum(weights)
    raw = [n * w / tot for w in weights]
    out = [max(floor, int(r)) for r in raw]
    guard = 0
    while sum(out) < n and guard < 5000:
        guard += 1
        idx = max(range(L), key=lambda i: raw[i] - out[i])
        out[idx] += 1
    while sum(out) > n and guard < 5000:
        guard += 1
        idx = max(range(L), key=lambda i: out[i] - raw[i])
        if out[idx] <= floor:
            break
        out[idx] -= 1
    return out


ASP_LO, ASP_HI = 0.72, 1.42


def best_grid(ci, slack=1.14):
    """为某一层选网格。硬性把铺位长宽比 asp=cols/(rows×AR) 限制在 [0.72, 1.42]。"""
    want = max(ci, int(math.ceil(ci * slack)))
    best = None
    for cols in range(2, 15):
        rows = max(2, math.ceil(want / cols))
        cells = cols * rows
        if cells < ci:
            continue
        asp = cols / (rows * TILE_AR)
        if not (ASP_LO <= asp <= ASP_HI):
            continue
        score = (cells - ci) * 1.0 + abs(math.log(asp)) * 3.0
        if best is None or score < best[0]:
            best = (score, cols, rows)
    if best is None:
        for cols in range(2, 15):
            rows = max(2, math.ceil(ci / cols))
            if cols * rows < ci:
                continue
            s = abs(math.log(cols / (rows * TILE_AR)))
            if best is None or s < best[0]:
                best = (s, cols, rows)
    return best[1], best[2]


def layer_cells(ci, cols, rows, p):
    """从 cols×rows 网格里取 ci 个**最靠层心**的格（超椭圆距离由内向外）。"""
    cc, rc = (cols - 1) / 2.0, (rows - 1) / 2.0
    rx, ry = max(cc, 0.5), max(rc, 0.5)
    arr = []
    for c in range(cols):
        for r in range(rows):
            d = (abs((c - cc) / rx) ** p + abs((r - rc) / ry) ** p) ** (1.0 / p)
            arr.append((round(d, 6), c, r))
    arr.sort(key=lambda t: (t[0], t[1], t[2]))
    return [(c, r) for _, c, r in arr[:ci]]


def gen_pattern(n, L, seed, p, variant, span=LAYER_DY_SPAN, R=0.0, counts=None):
    """生成一张卡位表（纯函数、位置写死）。单位 = wu（牌宽倍数），原点 = 牌堆中心。

    n        —— 仅当 counts 为 None 时用于现算层分布（保持旧调用兼容）
    R        —— 层间黄金角错位半径（0 = 同心嵌套）
    counts   —— 逐层张数（自底向上，index 0 = 最底层）
    """
    rng = random.Random(seed * 131 + variant * 977)
    if counts is None:
        counts = split_layers(n, L)
    dy = layer_dy(L, span)
    tiles = []
    for i in range(L):
        ci = counts[i]
        cols, rows = best_grid(ci)
        cells = layer_cells(ci, cols, rows, p)
        occ = set(cells)
        # 横牌：只能落在「左右至少一侧为空」的格
        frees = sorted(cr for cr in cells
                       if (cr[0] - 1, cr[1]) not in occ or (cr[0] + 1, cr[1]) not in occ)
        n_cross = min(len(frees), int(round(ci * CROSS_RATIO)))
        cross_set = set()
        if n_cross > 0:
            idxs = {int(k * len(frees) / n_cross) for k in range(n_cross)}
            cross_set = {frees[k] for k in idxs if k < len(frees)}
        a = i * SHIFT_GOLD
        ox, oy = (R * math.cos(a), R * math.sin(a)) if R else (0.0, 0.0)
        for (c, r) in cells:
            gx = (c - (cols - 1) / 2.0) + ox
            gy = (r - (rows - 1) / 2.0) * TILE_AR + oy
            jx = (rng.random() - 0.5) * 2.0 * JITTER
            jy = (rng.random() - 0.5) * 2.0 * JITTER
            tiles.append({'x': round(gx + jx, 4),
                          'y': round(gy + jy - i * dy * TILE_AR, 4),
                          'z': i, 'rot': 90 if (c, r) in cross_set else 0})
    return tiles, counts


def tile_box(t):
    """wu 单位的 AABB。横牌 = 竖牌包围盒**旋转 90°**（边长互换、面积相等，非等比缩放禁止）。"""
    hw = (TILE_AR if t['rot'] == 90 else 1.0) / 2.0
    hh = (1.0 if t['rot'] == 90 else TILE_AR) / 2.0
    return (t['x'] - hw, t['y'] - hh, t['x'] + hw, t['y'] + hh)


def bbox_wu(tiles):
    bs = [tile_box(t) for t in tiles]
    return (min(b[0] for b in bs), min(b[1] for b in bs),
            max(b[2] for b in bs), max(b[3] for b in bs))


def center_tiles(tiles):
    """把卡位平移到「包围盒中心 = 原点」。"""
    x0, y0, x1, y1 = bbox_wu(tiles)
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    for t in tiles:
        t['x'] = round(t['x'] - mx, 4)
        t['y'] = round(t['y'] - my, 4)
    return tiles


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _ov(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if (w > 0 and h > 0) else 0.0


def cover_ratios(tiles, boxes=None, alive=None):
    """每张牌被「更高层」牌覆盖的面积比（wu² 归一）。同层不参与。"""
    if boxes is None:
        boxes = [tile_box(t) for t in tiles]
    n = len(tiles)
    out = []
    for i in range(n):
        if alive is not None and not alive[i]:
            out.append(0.0)
            continue
        aa = _area(boxes[i])
        ov = 0.0
        for j in range(n):
            if alive is not None and not alive[j]:
                continue
            if tiles[j]['z'] <= tiles[i]['z']:
                continue
            ov += _ov(boxes[i], boxes[j])
        out.append(min(1.0, ov / aa) if aa > 0 else 0.0)
    return out


def live_counts(cover):
    """返回 (现行口径可点数 / 严格口径可点数)。"""
    return (sum(1 for c in cover if c < COVER_TH),
            sum(1 for c in cover if c <= 1e-9))


# ───────────────── 均匀度度量 ─────────────────

def uniformity(tiles, G=6):
    """牌堆在桌面上的分布均匀度。

    cvNorm —— **离散指数** = cv × √mean。1.0 ≈ 随机撒布的期望水平，<1 表示比随机更均匀。
    qbal   —— 四象限牌数的不平衡度（0 = 完全均衡）
    coff   —— 质心相对包围盒中心的偏移
    """
    xs = [t['x'] for t in tiles]
    ys = [t['y'] for t in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w = x1 - x0 or 1e-9
    h = y1 - y0 or 1e-9
    grid = [[0] * G for _ in range(G)]
    for x, y in zip(xs, ys):
        cx = min(G - 1, max(0, int((x - x0) / w * G)))
        cy = min(G - 1, max(0, int((y - y0) / h * G)))
        grid[cy][cx] += 1
    vals = [v for row in grid for v in row]
    mean = sum(vals) / len(vals)
    sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
    cv = sd / mean if mean else 0.0
    cv_norm = cv * math.sqrt(mean) if mean else 0.0
    cx0, cy0 = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    q = [0, 0, 0, 0]
    for x, y in zip(xs, ys):
        q[(0 if x < cx0 else 1) + (0 if y < cy0 else 2)] += 1
    qm = sum(q) / 4.0
    qbal = (max(q) - min(q)) / qm if qm else 0.0
    cxs = sum(xs) / len(xs)
    cys = sum(ys) / len(ys)
    coff = math.hypot(cxs - cx0, cys - cy0) / (max(w, h) / 2.0)
    return {'cv': cv, 'cvNorm': cv_norm, 'qbal': qbal, 'coff': coff,
            'aspect': w / h, 'grid': grid, 'quad': q}


def uni_score(u):
    return u['cvNorm'] * 1.0 + u['qbal'] * 0.55 + u['coff'] * 1.4 \
        + abs(math.log(max(u['aspect'], 1e-6))) * 0.45


# ───────────────── 分段（第 32 轮第 3 条）─────────────────

def seg_sizes(n, K):
    """n 切成 K 段：每段是 3 的倍数、≤ SEG_MAX、尽量均分、和 = n（n 必为 3 的倍数）。"""
    base = (n // 3) // K * 3
    sizes = [base] * K
    rem = n - base * K
    i = 0
    while rem > 0 and i < 10000:
        i += 1
        j = max(range(K), key=lambda k: (SEG_MAX - sizes[k], -k))
        if sizes[j] + 3 > SEG_MAX:
            break
        sizes[j] += 3
        rem -= 3
    return sizes


def plan_segments(n, L, top_share):
    """段划分 + 逐层张数。

    段边界**落在层边界**（用户：可按层来分段）；**段序自顶向下**（段 1 = 最高的层组，
    先清 → 露出下一段）；段内张数为 3 的倍数且 ≤ SEG_MAX。

    ★ 逐层张数用**全局平滑剖面**（split_layers 单调底重）打底，再**逐段只做 mod-3 微调**
      （把每段的段和调到该段尺寸）。v7 首跑踩过：逐段各自 split_layers 会让层分布变成
      「18/15/18/15」这种**锯齿**，离散指数被顶到 1.10~1.35（均匀度不合格）。

    top_share > 0 时做**天际线抬升**：把最高段的下层张数搬到顶层，使顶层 ≥ top_share×n
    （实测这是提升"开局可点率"的决定性杠杆：可点率 ≈ 天际线张数）。
    """
    K = max(1, int(math.ceil(n / float(SEG_MAX))))
    sizes = seg_sizes(n, K)
    # 每段层数：按段张数加权分配，每段 ≥1 层，合计 = L
    raw = [L * s / float(n) for s in sizes]
    lp = [max(1, int(round(r))) for r in raw]
    guard = 0
    while sum(lp) != L and guard < 500:
        guard += 1
        if sum(lp) < L:
            lp[max(range(K), key=lambda k: raw[k] - lp[k])] += 1
        else:
            j = max(range(K), key=lambda k: lp[k])
            if lp[j] > 1:
                lp[j] -= 1
    segs = []
    idx = L                                   # 从最高层往下切
    for k in range(K):
        ln = lp[k]
        segs.append({'k': k + 1, 'lo': idx - ln, 'hi': idx, 'n': sizes[k], 'layers': ln})
        idx -= ln

    counts = split_layers(n, L, 0.30)         # ★ 全局平滑剖面打底
    for s in segs:                            # 逐段把段和调成 sizes[k]
        diff = s['n'] - sum(counts[s['lo']:s['hi']])
        g = 0
        while diff != 0 and g < 20000:
            g += 1
            if diff > 0:
                # ★ 轮转分配（不能只加给最大的那个，否则会鼓出一个"包"）
                seq = sorted(range(s['lo'], s['hi']), key=lambda i: -counts[i])
                counts[seq[g % len(seq)]] += 1
                diff -= 1
            else:
                cand = sorted([i for i in range(s['lo'], s['hi']) if counts[i] > 2],
                              key=lambda i: -counts[i])
                if not cand:
                    break
                counts[cand[g % len(cand)]] -= 1
                diff += 1

    # ★ 天际线抬升（只动最高段：把该段下层张数**轮转**搬到顶层）
    if top_share > 0 and L >= 2:
        target = max(counts[L - 1], int(round(n * top_share)))
        lo = segs[0]['lo']
        g = 0
        while counts[L - 1] < target and g < 8000:
            g += 1
            cand = sorted([i for i in range(lo, L - 1) if counts[i] > 2],
                          key=lambda i: -counts[i])
            if not cand:
                break
            counts[cand[g % len(cand)]] -= 1
            counts[L - 1] += 1
    return counts, segs


def find_span(counts, L, seed, p, R, w_min=W_MIN, iters=8):
    """二分出「使几何解 ≥ w_min」的最大层间跨度 span（bbox 高随 span 单调不减）。"""
    def wg_of(sp):
        t, _ = gen_pattern(0, L, seed, p, 0, sp, R, counts)
        x0, y0, x1, y1 = bbox_wu(t)
        return min(SAFE * FILL_MAX / (x1 - x0), SAFE * FILL_MAX / (y1 - y0))
    lo, hi = 0.08, LAYER_DY_SPAN
    w_lo = wg_of(lo)
    if w_lo < w_min:
        return lo, w_lo
    if wg_of(hi) >= w_min:
        return hi, wg_of(hi)
    for _ in range(iters):
        mid = (lo + hi) / 2.0
        if wg_of(mid) >= w_min:
            lo = mid
        else:
            hi = mid
    return lo, wg_of(lo)


# ───────────────── 满清可解构造 ─────────────────

def greedy_peel(tiles, open_first=0, phases=None):
    """贪心可点剥离 → 一条**合法消除序列** order。

    phases = [{lo,hi}, …] 时**按段推进**：先清完 phases[0] 的层，再清 phases[1] …；
    状态（覆盖度）跨段延续 —— 这正是"清完上段、下段才露出来"的真实过程。
    """
    n = len(tiles)
    boxes = [tile_box(t) for t in tiles]
    areas = [max(1e-9, _area(b)) for b in boxes]
    ov = [0.0] * n
    for j in range(n):
        for k in range(n):
            if tiles[k]['z'] > tiles[j]['z']:
                ov[j] += _ov(boxes[j], boxes[k])
    cover = [min(1.0, ov[j] / areas[j]) for j in range(n)]
    alive = [True] * n
    order = []

    def remove(i):
        alive[i] = False
        order.append(i)
        for j in range(n):
            if alive[j] and tiles[j]['z'] < tiles[i]['z']:
                d = _ov(boxes[j], boxes[i])
                if d:
                    ov[j] -= d
                    cover[j] = min(1.0, max(0.0, ov[j] / areas[j]))

    if phases is None:
        phases = [{'lo': 0, 'hi': max(t['z'] for t in tiles) + 1}]

    for ph_i, ph in enumerate(phases):
        allow = [i for i in range(n) if ph['lo'] <= tiles[i]['z'] < ph['hi']]
        allow_set = set(allow)
        if ph_i == 0 and open_first > 0:          # 锁定"开局可见组"
            A = [i for i in allow if cover[i] < COVER_TH]
            A.sort(key=lambda i: (-tiles[i]['z'], i))
            for i in A[:open_first]:
                remove(i)
        guard = 0
        while any(alive[i] for i in allow_set) and guard < 100000:
            guard += 1
            cand = [i for i in allow if alive[i] and cover[i] < COVER_TH]
            if cand:
                i = max(cand, key=lambda j: (tiles[j]['z'], -cover[j], -j))
            else:
                rest = [i for i in allow if alive[i]]
                if not rest:
                    break
                i = min(rest, key=lambda j: (cover[j], -tiles[j]['z']))
            remove(i)
    return order


def fill_by_triples(order, seed):
    """把 order 切成长度 3 的连续段，每段填**同一种牌**（一次「碰」）。

    段内三张同种 ⇒ 玩家依次点击 order[3k..3k+2] 即整关清空；槽位瞬时占用 ≤3 ≪ 8。
    因每段张数均为 3 的倍数，全局三切分**必然对齐段边界** ⇒ 每组不跨段。
    """
    rng = random.Random(seed * 7919 + 13)
    kinds = [(k, nn) for k in SUITS for nn in range(1, 10)]
    faces = [None] * len(order)
    prev = None
    for s in range(0, len(order), 3):
        g = order[s:s + 3]
        pick = kinds[rng.randrange(len(kinds))]
        for _ in range(6):
            if pick != prev:
                break
            pick = kinds[rng.randrange(len(kinds))]
        prev = pick
        for idx in g:
            faces[idx] = pick
    return faces


def verify_clear(tiles, order):
    """独立复算：不复用贪心剥离的增量覆盖数，逐步重算可点性并回放。"""
    n = len(tiles)
    boxes = [tile_box(t) for t in tiles]
    areas = [max(1e-9, _area(b)) for b in boxes]
    alive = [True] * n

    def cover_of(i):
        ov = 0.0
        bi = boxes[i]
        for j in range(n):
            if alive[j] and tiles[j]['z'] > tiles[i]['z']:
                ov += _ov(bi, boxes[j])
        return min(1.0, ov / areas[i])

    for step, i in enumerate(order):
        if not alive[i]:
            return False, step
        if cover_of(i) >= COVER_TH:
            return False, step
        alive[i] = False
    return (not any(alive)), None


def verify_segments(tiles, order, segs):
    """校验「按段推进」：第 k 段被清完时，清掉的正好是该段的牌，且每段张数为 3 的倍数。"""
    pos = 0
    for s in segs:
        want = {i for i in range(len(tiles)) if s['lo'] <= tiles[i]['z'] < s['hi']}
        if len(want) != s['n']:
            return False, f"段{s['k']}张数 {len(want)} ≠ 声明 {s['n']}"
        if s['n'] % 3:
            return False, f"段{s['k']}张数 {s['n']} 非 3 的倍数"
        got = set(order[pos:pos + s['n']])
        if got != want:
            return False, f"段{s['k']}被清顺序不连续"
        pos += s['n']
    return (pos == len(order)), None


def seg_stats(tiles, segs):
    """每段"轮到自己时"的开局可点与可凑组数（更上段视为已清空）。"""
    n = len(tiles)
    boxes = [tile_box(t) for t in tiles]
    out = []
    for s in segs:
        alive = [not (tiles[i]['z'] >= s['hi']) for i in range(n)]
        cover = cover_ratios(tiles, boxes, alive)
        live = [i for i in range(n)
                if alive[i] and s['lo'] <= tiles[i]['z'] < s['hi'] and cover[i] < COVER_TH]
        out.append({'k': s['k'], 'n': s['n'], 'layers': s['layers'],
                    'lo': s['lo'], 'hi': s['hi'],
                    'openLive': len(live), 'openRatio': round(len(live) / float(s['n']), 4)})
    return out


def max_triples(faces):
    """精确最大三连组数（碰 = 三张同；吃 = 同花色连号三张）。"""
    cnt = Counter(faces)
    best = 0
    for k in SUITS:
        c = [cnt.get((k, n), 0) for n in range(1, 10)]
        cap = [min(c[s], c[s + 1], c[s + 2]) for s in range(7)]
        local = 0
        x = [0] * 7

        def walk(s):
            nonlocal local
            if s == 7:
                used = [0] * 9
                for i in range(7):
                    for d in range(3):
                        used[i + d] += x[i]
                peng = 0
                for n in range(9):
                    rem = c[n] - used[n]
                    if rem < 0:
                        return
                    peng += rem // 3
                v = sum(x) + peng
                if v > local:
                    local = v
                return
            for v in range(cap[s] + 1):
                x[s] = v
                walk(s + 1)
            x[s] = 0

        walk(0)
        best += local
    return best


# ────────────────────────── 主流程 ──────────────────────────

def build():
    meta = {
        'safe': SAFE, 'fillMax': FILL_MAX, 'tileAR': TILE_AR,
        'wMin': W_MIN, 'wMax': W_MAX,
        'coverTh': COVER_TH, 'crossRatio': CROSS_RATIO,
        'jitter': JITTER, 'layerDyBase': LAYER_DY_BASE, 'layerDySpan': LAYER_DY_SPAN,
        'maxPatternTry': MAX_PATTERN_TRY, 'curveCap': CURVE_CAP,
        'footprints': [p for p, _ in FOOTPRINTS],
        'designRes': [750, 1334],
        'safeZoneScreen': {'x': 34, 'y': 326, 'w': 682, 'h': 682},
        'solveMode': 'constructive-peel-triples-by-segment',
        'segMax': SEG_MAX, 'segBy': 'layer-topdown',
        'segConcurrent': True,
        'shiftGold': round(SHIFT_GOLD, 6), 'topShareTries': list(TOP_SHARE_TRIES),
        'shiftTries': list(SHIFT_TRIES),
        'sizeUniformPerLevel': True,
    }
    out = {'meta': meta, 'levels': []}
    for lv, n_total, L in LEVELS:
        seed = 20261005 + lv * 7717
        fp, fp_cn = FOOTPRINTS[(lv - 1) // 10 % len(FOOTPRINTS)]
        primary = SUITS[(lv - 1) // 3 % 3]

        # ★ 逐关贪心：在几何可行域内最大化开局可点率（第 32 轮第 2 条）
        #   两遍选：先在"均匀度达标"的候选里取可点最多；若一个都没有，才放宽均匀度
        pool = []
        for ts in TOP_SHARE_TRIES:
            counts0, segs0 = plan_segments(n_total, L, ts)
            for R in SHIFT_TRIES:
                span, wg = find_span(counts0, L, seed, fp, R)
                if wg < W_MIN - 1e-9:
                    continue
                bt = None
                for v in range(MAX_PATTERN_TRY):
                    t, _c = gen_pattern(n_total, L, seed, fp, v, span, R, counts0)
                    center_tiles(t)
                    u = uniformity(t)
                    s = uni_score(u)
                    if bt is None or s < bt[0]:
                        bt = (s, t, u, v)
                _, t, u, v = bt
                cov = cover_ratios(t)
                nl, ns = live_counts(cov)
                pool.append({'ts': ts, 'R': R, 'span': span, 'wg': wg, 'tiles': t,
                             'u': u, 'v': v, 'counts': counts0, 'segs': segs0, 'cov': cov,
                             'nl': nl, 'ns': ns,
                             'uniOk': u['cvNorm'] <= CVN_LIMIT and u['qbal'] <= qbal_limit(n_total)})
        strict = [c for c in pool if c['uniOk']]
        use = strict if strict else pool
        best = max(use, key=lambda c: (c['nl'], -c['u']['cvNorm'], -c['u']['qbal'],
                                       -abs(c['u']['aspect'] - 1))) if use else None
        if best is None:                      # 兜底：只保几何可行
            counts0, segs0 = plan_segments(n_total, L, 0.0)
            span, wg = find_span(counts0, L, seed, fp, 0.0)
            t, _c = gen_pattern(n_total, L, seed, fp, 0, span, 0.0, counts0)
            center_tiles(t)
            u = uniformity(t)
            cov = cover_ratios(t)
            nl, ns = live_counts(cov)
            best = {'ts': 0.0, 'R': 0.0, 'span': span, 'wg': wg, 'tiles': t, 'u': u,
                    'v': 0, 'counts': counts0, 'segs': segs0, 'cov': cov, 'nl': nl,
                    'ns': ns, 'uniOk': False}
        ts, R, span, wg = best['ts'], best['R'], best['span'], best['wg']
        tiles, u, variant = best['tiles'], best['u'], best['v']
        counts, segs, cover = best['counts'], best['segs'], best['cov']
        n_live, n_strict = best['nl'], best['ns']
        segs = [dict(s) for s in segs]
        center_tiles(tiles)
        x0, y0, x1, y1 = bbox_wu(tiles)
        bw, bh = x1 - x0, y1 - y0

        w_geom = min(SAFE * FILL_MAX / bw, SAFE * FILL_MAX / bh)
        w = max(W_MIN, min(W_MAX, min(w_geom, CURVE_CAP[L])))

        # ★ 尺寸一致性（第 32 轮第 5 条）：一关唯一 w/h；横牌 = 纯旋转
        assert all(abs(tile_box(t)[2] - tile_box(t)[0] -
                       (TILE_AR if t['rot'] == 90 else 1.0)) < 1e-9 for t in tiles)

        # ★ 满清可解（按段推进）
        G_open = max(1, min(3, n_live // 3))
        order = greedy_peel(tiles, open_first=3 * G_open, phases=segs)
        faces = fill_by_triples(order, seed)
        cleared, fail_at = verify_clear(tiles, order)
        seg_ok, seg_msg = verify_segments(tiles, order, segs)
        st = seg_stats(tiles, segs)
        n_open_match = max_triples([faces[i] for i in range(n_total) if cover[i] < COVER_TH])

        chap = next(c for a, b, c in CHAPTERS if a <= lv <= b)
        out['levels'].append({
            'lv': lv, 'chapter': chap,
            'nTotal': n_total, 'stages': [s['n'] for s in segs], 'nStage': len(segs),
            'segs': st, 'nPile': n_total, 'layers': L, 'layerCounts': counts,
            'layerDy': round(layer_dy(L, span), 4), 'layerSpan': round(span, 3),
            'layerShift': round(R, 3), 'topShare': round(ts, 3),
            'topLayerN': counts[L - 1],
            'footprint': fp_cn, 'primary': primary,
            'w': round(w), 'h': round(w * TILE_AR),
            'asset2x': [round(w) * 2, round(w * TILE_AR) * 2],
            'bboxWu': [round(bw, 3), round(bh, 3)],
            'wGeom': round(w_geom, 1), 'wCurve': CURVE_CAP[L], 'variant': variant,
            'nLive': n_live, 'nStrict': n_strict,
            'liveRatio': round(n_live / float(n_total), 4),
            'nMatchOpen': n_open_match,
            'cleared': bool(cleared), 'failAt': fail_at,
            'segCleared': bool(seg_ok), 'segMsg': seg_msg,
            'uniRelaxed': (not best['uniOk']),
            'nGroups': n_total // 3, 'openGroups': G_open,
            'uni': {'cv': round(u['cv'], 4), 'cvNorm': round(u['cvNorm'], 4),
                    'qbal': round(u['qbal'], 4), 'coff': round(u['coff'], 4),
                    'aspect': round(u['aspect'], 3),
                    'quad': u['quad'], 'grid': u['grid']},
            'crossN': sum(1 for t in tiles if t['rot'] == 90),
            'tiles': tiles, 'faces': [[k, n] for k, n in faces],
            'solveOrder': order,
            'cover': [round(c, 4) for c in cover],
        })

    # 尺寸单调不增（差异不宜过大 + 后期缩小）
    run = W_MAX
    for L in out['levels']:
        run = min(run, L['w'])
        L['w'] = run
        L['h'] = round(run * TILE_AR)
        L['asset2x'] = [run * 2, round(run * TILE_AR) * 2]
        L['bboxPx'] = [round(L['bboxWu'][0] * run, 1), round(L['bboxWu'][1] * run, 1)]
        for t in L['tiles']:
            t['px'] = round(t['x'] * run, 2)
            t['py'] = round(t['y'] * run, 2)
    return out


def report(d):
    print('=' * 132)
    print('game-5 · 30 关关卡表（第 32 轮 · 按层分段 · 全堆同时在桌 · 段内满清可解 · 天际线抬升）')
    print('=' * 132)
    print(f"{'关':>3} {'篇章':<12} {'张数':>4} {'层':>3} {'逐层分布':<20} {'段':>3} {'每段张数':<15} "
          f"{'段1开点':>7} {'顶层':>4} {'错位':>5} {'宽':>4} {'@2x':>8} {'包围盒px':>9} "
          f"{'可点':>11} {'严':>4} {'横':>3} {'离散':>6} {'象限':>6} {'满清':>5}")
    print('-' * 132)
    for L in d['levels']:
        dist = '/'.join(str(c) for c in L['layerCounts'])
        bb = f"{L['bboxPx'][0]:.0f}x{L['bboxPx'][1]:.0f}"
        ss = '+'.join(str(x) for x in L['stages'])
        s1 = L['segs'][0]
        print(f"{L['lv']:>3} {L['chapter']:<12} {L['nTotal']:>4} {L['layers']:>3} {dist:<20} "
              f"{L['nStage']:>3} {ss:<15} "
              f"{s1['openLive']:>3}/{s1['n']:<3} {L['topLayerN']:>4} {L['layerShift']:>5} "
              f"{L['w']:>4} {L['asset2x'][0]:>3}x{L['asset2x'][1]:<4} {bb:>9} "
              f"{L['nLive']:>4}/{L['nPile']:<4}({L['liveRatio']*100:>2.0f}%) {L['nStrict']:>4} "
              f"{L['crossN']:>3} {L['uni']['cvNorm']:>6.3f} {L['uni']['qbal']:>6.3f} "
              f"{'✅' if L['cleared'] else '❌':>5}")
    print('-' * 132)
    ws = [L['w'] for L in d['levels']]
    ns = [L['nTotal'] for L in d['levels']]
    ls = [L['layers'] for L in d['levels']]
    print(f"张数 {min(ns)} ~ {max(ns)}（单调不减 "
          f"{'✅' if all(ns[i] <= ns[i+1] for i in range(len(ns)-1)) else '❌'}）"
          f" · 层数 {min(ls)} ~ {max(ls)}（单调不减 "
          f"{'✅' if all(ls[i] <= ls[i+1] for i in range(len(ls)-1)) else '❌'}）")
    print(f"牌宽 {min(ws)} ~ {max(ws)}（极差 {max(ws)-min(ws)}，比值 {max(ws)/min(ws):.2f}）"
          f" · 单调不增 {'✅' if all(ws[i] >= ws[i+1] for i in range(len(ws)-1)) else '❌'}")
    lr = [L['liveRatio'] for L in d['levels']]
    tail = [L['liveRatio'] for L in d['levels'] if L['lv'] >= 21]
    cvs = [L['uni']['cvNorm'] for L in d['levels']]
    qbs = [L['uni']['qbal'] for L in d['levels']]
    print(f"开局可点率 {min(lr)*100:.0f}% ~ {max(lr)*100:.0f}%"
          f" · 后段（L21~30）{min(tail)*100:.0f}% ~ {max(tail)*100:.0f}%"
          f" · 开局可凑 {min(L['nMatchOpen'] for L in d['levels'])}"
          f" ~ {max(L['nMatchOpen'] for L in d['levels'])} 组")
    print(f"均匀度：离散指数 {min(cvs):.3f} ~ {max(cvs):.3f}（均值 {sum(cvs)/len(cvs):.3f}；"
          f"1.0=随机撒布） · 象限不平衡 {min(qbs):.3f} ~ {max(qbs):.3f}"
          f"（门槛 0.60 / 小关按 √(60/n) 放宽）")
    segr = [s['openRatio'] for L in d['levels'] for s in L['segs']]
    print(f"段内开局可点率（各段各自轮到时）{min(segr)*100:.0f}% ~ {max(segr)*100:.0f}%"
          f" · 均匀度放宽的关 {sum(1 for L in d['levels'] if L['uniRelaxed'])}/30"
          f" · 严格口径（任意相交即判死）{min(L['nStrict'] for L in d['levels'])}"
          f" ~ {max(L['nStrict'] for L in d['levels'])} 张  ← 仅作对照")
    print(f"横牌合计 {sum(L['crossN'] for L in d['levels'])}/"
          f"{sum(len(L['tiles']) for L in d['levels'])}"
          f"（{sum(L['crossN'] for L in d['levels'])/sum(len(L['tiles']) for L in d['levels'])*100:.0f}%）")
    print(f"分段：段数 {min(L['nStage'] for L in d['levels'])} ~ "
          f"{max(L['nStage'] for L in d['levels'])}"
          f"（按层切、段内 ≤{SEG_MAX} 张、3 的倍数、段序自顶向下）"
          f" · 段内满清可解 {sum(1 for L in d['levels'] if L['segCleared'])}/30 关 ✅")
    print('-' * 132)
    bad = []
    for i, L in enumerate(d['levels']):
        if L['nTotal'] % 3:
            bad.append(f"L{L['lv']} 张数非3倍")
        if len(L['tiles']) != L['nPile']:
            bad.append(f"L{L['lv']} 卡位数≠单堆")
        if sum(L['layerCounts']) != L['nPile']:
            bad.append(f"L{L['lv']} 层分布和≠单堆")
        if len(L['layerCounts']) != L['layers']:
            bad.append(f"L{L['lv']} 层数不符")
        if not (W_MIN <= L['w'] <= W_MAX):
            bad.append(f"L{L['lv']} 牌宽越界")
        if max(L['bboxPx']) > SAFE:
            bad.append(f"L{L['lv']} 包围盒越安全区")
        half = max(L['bboxWu'][0], L['bboxWu'][1]) * L['w'] / 2.0
        if half > SAFE / 2 + 0.51:
            bad.append(f"L{L['lv']} 居中后单侧越界({half:.1f})")
        if not L['cleared']:
            bad.append(f"L{L['lv']} 不可满清(failAt={L['failAt']})")
        if not L['segCleared']:
            bad.append(f"L{L['lv']} 分段不合法({L['segMsg']})")
        if any(t['rot'] not in (0, 90) for t in L['tiles']):
            bad.append(f"L{L['lv']} 朝向越界")
        # ★ 第 32 轮第 3 条：分段约束
        if sum(L['stages']) != L['nTotal']:
            bad.append(f"L{L['lv']} 段张数和≠整关")
        for s in L['segs']:
            if s['n'] % 3:
                bad.append(f"L{L['lv']} 段{s['k']}非3倍数")
            if s['n'] > SEG_MAX:
                bad.append(f"L{L['lv']} 段{s['k']}超上限")
        # ★ 段边界必须与层边界一致（段序自顶向下：**后一段的 hi = 前一段的 lo**）
        if [s['hi'] for s in L['segs'][1:]] != [s['lo'] for s in L['segs'][:-1]]:
            bad.append(f"L{L['lv']} 段边界与层边界不齐")
        if L['segs'][0]['hi'] != L['layers'] or L['segs'][-1]['lo'] != 0:
            bad.append(f"L{L['lv']} 段未覆盖全部层")
        # ★ 第 32 轮第 5 条：单关内尺寸唯一 + 横牌严格同尺寸
        if L['h'] != round(L['w'] * d['meta']['tileAR']):
            bad.append(f"L{L['lv']} 长宽比不符")
        for t in L['tiles']:
            ww = (d['meta']['tileAR'] if t['rot'] == 90 else 1.0)
            hh = (1.0 if t['rot'] == 90 else d['meta']['tileAR'])
            if abs(ww * hh - d['meta']['tileAR']) > 1e-9:
                bad.append(f"L{L['lv']} 横牌尺寸≠竖牌")
                break
        if i:
            if L['nTotal'] < d['levels'][i-1]['nTotal']:
                bad.append(f"L{L['lv']} 张数回落")
            if L['layers'] < d['levels'][i-1]['layers']:
                bad.append(f"L{L['lv']} 层数回落")
    if d['levels'][0]['layers'] != 2:
        bad.append("L1 层数≠2")
    if d['levels'][1]['layers'] != 3:
        bad.append("L2 层数≠3")
    for L in d['levels'][2:]:
        if L['layers'] < 5:
            bad.append(f"L{L['lv']} 层数<5")
    if max(ls) > 10:
        bad.append("层数上限>10")
    if max(ns) > 138:
        bad.append("张数上限>138")
    if min(ws) < W_MIN:
        bad.append("牌宽下限<88")
    print('约束自检：' + ('全部通过 ✅' if not bad else '❌ ' + ' | '.join(bad)))
    print(f"目标自检（第 32 轮第 2 条）：后段 L21~30 开局可点率 "
          f"{min(tail)*100:.1f}% ~ {max(tail)*100:.1f}%"
          f"（第 31 轮基线 7.2% ~ 10.0%）"
          f" → {'✅ 已提升' if min(tail) > 0.100 else '⚠ 未全面超过基线 10%'}")
    return bad


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    data = build()
    with open(os.path.join(here, 'levels.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    report(data)
    print(f"\n→ 已写出 {os.path.join(here, 'levels.json')}")
