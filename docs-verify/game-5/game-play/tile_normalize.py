#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""27 张牌面 · 统一后处理（第 28 轮 A2 建立 → **第 33 轮改口径**）

做四件事（对应 A2 的四步：视角校正 / 圆角遮罩 / 抠底 / 压规格）：
  ① **尺度归一（"视角校正"的落地口径）**：用**边缘密度法**检测牌体外轮廓 bbox，
     再等比缩放到「**内切**画布」（见下方〈第 33 轮口径变更〉），使 27 张基线对齐。
  ② **圆角遮罩**：按占宽比例给四角开圆角，四角外全透明（否则贴到深绿桌面上会露白点/灰点）。
  ③ **抠底**：整张图裁到牌体 bbox → 框外背景一并去掉；框内仅圆角处有极少量背景，
     由 ② 的遮罩处理。**不做逐像素颜色抠底** —— 万字批次背景偏暖、与牌体同色系，
     逐像素抠底会啃掉牌体边缘（第 28 轮实测）。
  ④ **压规格**：输出 @2x **224×298**（= 最大关 L1 的牌位 112×149 ×2）的 PNG。

为什么用"边缘密度法"而不是颜色阈值：
  牌体边界横跨整幅 → 在"垂直/水平相邻差分 > T"的计数上形成**密度峰**，
  对**渐变背景**与**偏暖背景**都鲁棒；而颜色阈值（色偏/距离背景）在万字上阈值敏感、
  同一张图换个阈值 bbox 就差 20%（实测）。

判据自洽性（判据先在已知合规的图上验证过）：
  一万（背景纯白）与 一条/一筒（背景纯白）三张给出**同一结果** 760×1086 · bw/bh 0.700 ·
  占宽 75.3% · 占高 80.7% —— 说明判据本身可靠，万字上的偏差是**真实不齐**，不是检测噪声。

════════ 第 33 轮口径变更（用户拍板 · L1 + L4）════════
用户第 33 轮拍板：
  · **L1**：27 张统一按 **224×298** 输出（各关由 CSS 缩，缩比 0.786~1.0，**规格唯一**）
  · **L4**：牌体占位口径 `OCC_H: 0.804 → 1.0`（牌体**紧贴画布**，不再留 20% 透明边距）
  · **L3**：万字 9 张形状不齐 —— 用户决定**暂不处理**（先试玩），本脚本**不做**任何形状修正

⭐ **关键：`OCC_H = 1.0` 不能字面实现为"每张都把牌体高拉到画布高"。**
   27 张牌体**自身长宽比并不一致**（`probe_tile_fit.py` 实测 `bw/bh` = 0.680 ~ 0.822）：
   若强行 `th = 298`，最宽的「九万」（0.822）牌体宽 = 244.9 > 画布 224
   ⇒ **被横向裁掉 20.9px**，且 7 张万字全部中招（裁切会真丢像素，不可逆）。

   故取 `OCC_H = 1.0` 的**无裁切语义 = 内切（contain）**：

       k = min(CANVAS_W / bw , CANVAS_H × OCC_H / bh)

   · 条 / 筒（bw/bh ≈ 0.699）→ **高贴满** th=298、tw 203~209（占高 100% / 占宽 90.6~93.3%）
   · 万字（bw/bh 0.681~0.822）→ **宽贴满** tw=224、th 273~298（7 张）

   实测：**贴高 20 张 / 贴宽 7 张 · 27 张全部零裁切**。

   副作用是**正面的**：内切让 27 张**可见面积极差 8.8%**（实测 60494 ~ 66304 px²），
   优于"强行等高 th=298 再让万字溢出被裁"的 15.1%；
   且条/筒 18 张的可见尺寸 ≈208×298 → 折回 192 画布等价 **178.3×255.5 ≈ 179×256**，
   与用户引用的「可见牌体 ≈179×256 / 页内 89.5×128」**逐值吻合**。

   ⚠ **代价（必须知晓）**：画布面积 ×1.358 且牌体填得更满 ⇒ 27 张 PNG 由
     **1690.3 KB 涨到 3290.6 KB（×1.95）**，会**加重主包超限**（L2）。
     这正是用户第 33 轮"先转 WebP"的原因 ⇒ 二者必须**一起落**，见 `to_webp.py`。

   ⚠ 画布长宽比必须 = 牌位长宽比（224/298 = 112/149 = 0.7517），否则页面里
     `img{width:100%;height:100%}` 会造成**非等比拉伸**（第 32 轮修过的 1.33 倍 bug 同源）。

用法：
  python tile_normalize.py --sample      # 只处理 3 张样张 → 输出对比图供目视
  python tile_normalize.py               # 处理全量 27 张 → 写入 assets/game-play/tiles/
"""
import sys, os, glob
import numpy as np
from PIL import Image, ImageDraw

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
SRC = os.path.join(ROOT, 'assets/_src/game-play/tiles')
DST = os.path.join(ROOT, 'assets/game-play/tiles')
VERIFY = os.path.join(ROOT, 'docs-verify/game-5/game-play')
SPE = [('wan', '万'), ('tiao', '条'), ('tong', '筒')]

CANVAS_W, CANVAS_H = 224, 298     # ★ 第 33 轮：192×256 → 224×298（= 最大关牌位 112×149 的 @2x）
OCC_H = 1.0                       # ★ 第 33 轮：0.804 → 1.0（紧贴画布；超宽牌走内切，见上）
RADIUS_RATIO = 0.085              # 圆角半径 / 牌体宽
EDGE_T = 40                       # 边缘差分阈值
EDGE_FRAC = 0.45                  # 行/列边缘密度占比阈值
SAMPLE = '--sample' in sys.argv


def edge_bbox(a):
    """边缘密度法：牌体边界横跨整幅 → 行/列边缘计数形成密度峰。"""
    H, W = a.shape[:2]
    dv = np.abs(a[6:] - a[:-6]).sum(2)
    dh = np.abs(a[:, 6:] - a[:, :-6]).sum(2)
    rowd = (dv > EDGE_T).sum(1)
    cold = (dh > EDGE_T).sum(0)
    rows = np.where(rowd > W * EDGE_FRAC)[0]
    cols = np.where(cold > H * EDGE_FRAC)[0]
    if not len(rows) or not len(cols):
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 6, int(rows[-1]) + 6


def rounded_mask(w, h, r):
    """圆角矩形遮罩（L 通道，白=保留）。"""
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return np.asarray(m)


def normalize(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    bb = edge_bbox(a)
    if bb is None:
        return None
    x0, y0, x1, y1 = bb
    sub = im.crop((x0, y0, x1 + 1, y1 + 1))
    bw, bh = sub.size
    # ★ 第 33 轮：内切(contain) —— 取"高贴满"与"宽贴满"里更小的那个缩放比 ⇒ 永不裁切
    k = min(CANVAS_W / bw, CANVAS_H * OCC_H / bh)
    tw = max(1, int(round(bw * k)))
    th = max(1, int(round(bh * k)))
    assert tw <= CANVAS_W and th <= CANVAS_H, '内切失败：%dx%d 超出画布' % (tw, th)
    sub = sub.resize((tw, th), Image.LANCZOS)
    # 居中贴到透明画布
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ox, oy = (CANVAS_W - tw) // 2, (CANVAS_H - th) // 2
    canvas.paste(sub, (ox, oy))
    # 圆角遮罩（只作用在牌体区域）
    r = max(2, int(round(tw * RADIUS_RATIO)))
    m = rounded_mask(tw, th, r)
    alpha = np.asarray(canvas.split()[3]).copy()
    region = alpha[oy:oy + th, ox:ox + tw]
    alpha[oy:oy + th, ox:ox + tw] = np.minimum(region, m)
    canvas.putalpha(Image.fromarray(alpha))
    return canvas, dict(bbox=(x0, y0, x1, y1), bw=bw, bh=bh, tw=tw, th=th, r=r,
                        ox=ox, oy=oy, occW=tw / CANVAS_W, occH=th / CANVAS_H,
                        ratio=bw / bh, fit=('宽' if tw >= CANVAS_W else '高'))


def collect():
    for sp, cn in SPE:
        for f in sorted(g for g in glob.glob(os.path.join(SRC, sp, '*.png')) if '-raw' not in g):
            yield sp, cn, f


def main():
    if SAMPLE:
        picks = [os.path.join(SRC, 'wan/一万.png'), os.path.join(SRC, 'wan/九万.png'),
                 os.path.join(SRC, 'tong/一筒.png')]
        rows = []
        for p in picks:
            r = normalize(p)
            nm = os.path.basename(p)[:-4]
            if r is None:
                print(nm, '未检出'); continue
            img, m = r
            print('%-4s bbox=%s 原牌体 %dx%d → 缩放 %dx%d · 贴%s · 圆角 %d · 占宽%.1f%% 占高%.1f%% bw/bh=%.3f'
                  % (nm, m['bbox'], m['bw'], m['bh'], m['tw'], m['th'], m['fit'], m['r'],
                     m['occW'] * 100, m['occH'] * 100, m['ratio']))
            rows.append((nm, Image.open(p).convert('RGB'), img))
        # 拼对比图：上排原图（缩到同高）、下排归一化结果（叠在深绿底上以便看抠底）
        TH = 300
        tiles = []
        for nm, src, out in rows:
            s = src.resize((int(src.width * TH / src.height), TH), Image.LANCZOS)
            o = out.resize((int(CANVAS_W * TH / CANVAS_H), TH), Image.NEAREST)
            bg = Image.new('RGB', o.size, (12, 38, 27))
            bg.paste(o, (0, 0), o)
            pair = Image.new('RGB', (s.width + bg.width + 10, TH), (240, 240, 240))
            pair.paste(s, (0, 0)); pair.paste(bg, (s.width + 10, 0))
            tiles.append(pair)
        W = sum(t.width for t in tiles) + 16 * (len(tiles) - 1)
        c = Image.new('RGB', (W, TH), (240, 240, 240))
        x = 0
        for t in tiles:
            c.paste(t, (x, 0)); x += t.width + 16
        outp = os.path.join(VERIFY, 'normalize-sample.png')
        c.save(outp)
        print('\n样张对比（左=原图 / 右=归一化后叠在深绿底上）：%s' % outp)
        return

    os.makedirs(DST, exist_ok=True)
    tot = 0
    fit_cnt = {'高': 0, '宽': 0}
    areas = []
    print('── 全量归一化（第 33 轮：画布 %d×%d · OCC_H=%.3f · 内切）──'
          % (CANVAS_W, CANVAS_H, OCC_H))
    for sp, cn, f in collect():
        r = normalize(f)
        nm = os.path.basename(f)
        if r is None:
            print('  ❌ %s 未检出 bbox' % nm); continue
        img, m = r
        od = os.path.join(DST, sp)
        os.makedirs(od, exist_ok=True)
        op = os.path.join(od, nm)
        img.save(op, optimize=True)
        sz = os.path.getsize(op)
        tot += sz
        fit_cnt[m['fit']] += 1
        areas.append(m['tw'] * m['th'])
        print('  %s %-8s %dx%d → %dx%d · 贴%s · 圆角%2d · 占宽%.1f%% · %5.1f KB'
              % (cn, nm[:-4], m['bw'], m['bh'], m['tw'], m['th'], m['fit'], m['r'],
                 m['occW'] * 100, sz / 1024))
    amin, amax = min(areas), max(areas)
    print('\n合计 %d 张 · %.1f KB（%.2f MB）' % (len(list(collect())), tot / 1024, tot / 1024 / 1024))
    print('贴高 %d 张 / 贴宽 %d 张 · 可见面积极差 %.1f%%（%d ~ %d px²）'
          % (fit_cnt['高'], fit_cnt['宽'], (amax - amin) / amax * 100, amin, amax))
    print('✅ 内切保证：27 张 tw≤%d 且 th≤%d，零裁切' % (CANVAS_W, CANVAS_H))


if __name__ == '__main__':
    main()
