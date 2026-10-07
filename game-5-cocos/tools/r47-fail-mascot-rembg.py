#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 47 轮（续）· 失败吉祥物 **方案 C** —— 改用 rembg 重抠

【为什么换掉第一版抠底（根因，已取证）】
  第一版 = 「近白阈值 + 四边泛洪 + 填洞 + 最大连通域」。
  取证图 /tmp/g5-r47-diagnose-zoom.png（洋红=判成背景 / 青=误吃本体）显示：
  `bg_like = (min(RGB) ≥ 244) & (通道极差 ≤ 10)` 这条判据**分不开白背景与奶白本体最亮的高光带**——
  角色上沿有一条 20~40px 宽的受光高光带，其像素恰好落进"近白"区间，而它又通过抗锯齿过渡
  与画布边缘的白背景**连通** ⇒ 泛洪把整条高光带判成背景，于是**沿轮廓咬掉一条**。
  实测误吃 5,715 px / 本体 461,399 px = **1.24%**，外观 = 左上角缺口 + 上沿被削 + 黑边残留。
  ⇒ 阈值法在"白底 + 奶白主体"上是**结构性不可用**的，换神经网络显著性分割（rembg / u2net）。

【口径不变的部分】抠完仍归一化到与 splash/mascot.png **同画幅**（960×875）：
  主体高 867、底边 gap 8、水平居中 —— 否则结算卡的吉祥物尺寸会整体漂。

【本轮新增的两条判据（都自带对照，见 judge_report()）】
  · `hull_gap`   凸缺面积比 = (凸包 − 本体) / 本体 —— 轮廓被咬出缺口会让它变大
  · `top_jump`   上轮廓相邻列最大跳变（px）—— 缺口会在上轮廓上形成台阶
  ⚠️ 判据的**负控就是旧图 fail-C.png**（已知有缺口）与基准 splash/mascot.png（无缺口），
     两者读数必须拉开，否则判据没有判别力。

用法（模型放隔离目录，不污染用户 home）：
    U2NET_HOME=/Users/consli/.workbuddy/binaries/python/envs/default/u2net \
      python3 tools/r47-fail-mascot-rembg.py [模型名]
产出：
    rembg/C-cutout.png       264×264 缩略预览用不了 → 实际是原分辨率抠好的 RGBA（留档）
    fail-C-rembg.png         960×875 归一化成品
    _metrics-C-rembg.json    量测（含旧图 vs 新图 vs 基准三方读数）
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session, remove
from scipy import ndimage
from scipy.ndimage import binary_fill_holes, distance_transform_edt, gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
REF = os.path.join(PROJ, 'assets/resources/splash/mascot.png')
OUT = os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'ui', 'fail-mascot-r47')
RAW = os.path.join(OUT, 'ai-raw')
SRC_C = os.path.join(RAW, 'Image_to_image_edit__This_is_a_2026-10-07T01-05-21.png')  # 方案 C 原图
OLD_C = os.path.join(OUT, 'fail-C.png')                                                # 第一版（有缺口）作负控

MODEL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('R47_REMBG_MODEL', 'u2net')
ALPHA_EDGE = 8          # 量主体 bbox / 高占比时的 alpha 阈值（躲开抗锯齿尾巴）
BODY_T = 0.5            # 判"这里是本体"的 alpha 阈值


# ────────────────────────────────── 量测（判据）

def bbox_of(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def thresh_matte(rgb255):
    """第一版用的阈值法 —— 在这里**原样复刻**，只作为对照方法（不再用于成品）。

    ⚠️ 复刻的意义：让「漏抠了多少」这个量在**同一坐标系（原图 1024）**下可算，
       否则成品图已经缩放到 960×875，没法逐像素比。
    """
    mn = rgb255.min(axis=2)
    mx = rgb255.max(axis=2)
    bg_like = (mn >= 244) & ((mx - mn) <= 10)
    lbl, n = ndimage.label(bg_like)
    bl = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    bl.discard(0)
    bg_outer = np.isin(lbl, list(bl)) if bl else np.zeros_like(bg_like)
    subj = binary_fill_holes(~bg_outer)
    l2, n2 = ndimage.label(subj)
    if n2 > 1:
        sizes = ndimage.sum(subj, l2, range(1, n2 + 1))
        subj = l2 == (int(np.argmax(sizes)) + 1)
    return subj


def method_diff(m_old, m_new, rgb255, stem):
    """方法对照：阈值法 vs rembg（同一坐标系）。

    · `missed`（漏抠）= 阈值法判透明、rembg 判本体 —— **这就是"残缺"**
    · `over`  （误留）= 阈值法判本体、rembg 判透明 —— 反向误差（应≈0）
    ⇒ 判据与负控天然成对：missed 必须显著 > over，且 missed 的位置要落在轮廓上。
    """
    missed = (~m_old) & m_new
    over = m_old & (~m_new)
    base = max(1, int(m_new.sum()))
    # ★ 区分「厚块缺陷」与「边缘细线」：腐蚀 3 次后还剩下的才算真缺陷。
    #   实测：missed 是 20~30px 宽的高光带（腐蚀后仍大片残留）；
    #         over   是 1~2px 的轮廓细线（腐蚀后清零）——形态不同，不能只用面积比。
    miss_core = ndimage.binary_erosion(missed, iterations=3)
    over_core = ndimage.binary_erosion(over, iterations=3)
    vis = rgb255.astype(np.uint8).copy()
    vis[missed] = (0, 220, 255)      # 青 = 漏抠（残缺）
    vis[over] = (255, 210, 0)        # 黄 = 误留
    vis[m_new & ~missed & ~over] = (vis[m_new & ~missed & ~over] * 0.45).astype(np.uint8)
    Image.fromarray(vis).save(os.path.join(OUT, 'rembg', f'{stem}-method-diff.png'))
    return {
        'missed_px': int(missed.sum()),
        'over_px': int(over.sum()),
        'missed_core_px': int(miss_core.sum()),
        'over_core_px': int(over_core.sum()),
        'missed_ratio': round(missed.sum() / base, 4),
        'over_ratio': round(over.sum() / base, 4),
        'missed_core_ratio': round(miss_core.sum() / base, 4),
        'over_core_ratio': round(over_core.sum() / base, 4),
    }


def hull_gap(mask):
    """凸缺面积比 = (凸包 − 本体) / 本体。轮廓被咬出缺口 ⇒ 变大。

    ⚠️ 用 PIL 的 polygon 填空，别手写半平面判号（符号取错会恒得 0/恒得满，
       而且不报错 —— 属于"判据静默失效"。）
    """
    from scipy.spatial import ConvexHull
    ys, xs = np.where(mask)
    if len(ys) < 3:
        return float('nan')
    pts = np.stack([xs, ys], axis=1).astype(np.float64)
    hp = pts[ConvexHull(pts).vertices]
    x0, y0 = int(xs.min()), int(ys.min())
    w, h = int(xs.max()) + 1 - x0, int(ys.max()) + 1 - y0
    im = Image.new('1', (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(p[0] - x0), float(p[1] - y0)) for p in hp], fill=1)
    hull_area = int(np.asarray(im).sum())
    body = int(mask[y0:y0 + h, x0:x0 + w].sum())
    if body == 0:
        return float('nan')
    return max(0.0, (hull_area - body) / body)


def top_edge_jump(mask, thr=6):
    """上轮廓相邻列最大跳变（px）：对每列取第一个 True 的 y，量相邻列的 |Δy|。"""
    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    prof = []
    for x in range(x0, x1 + 1):
        col = np.where(mask[:, x])[0]
        prof.append(int(col.min()) if len(col) else -1)
    prof = np.array(prof)
    good = prof >= 0
    if good.sum() < 4:
        return 0
    p = prof[good]
    d = np.abs(np.diff(p))
    # 只统计"真跳变"（>thr），返回最大值
    mx = int(d.max()) if len(d) else 0
    return mx


def corner_residue(arr, m=40):
    a = arr[..., 3]
    h, w = a.shape
    q = np.concatenate([a[:m, :m].ravel(), a[:m, w - m:].ravel(),
                        a[h - m:, :m].ravel(), a[h - m:, w - m:].ravel()])
    return float((q > 0.5).mean())


def measure(path_or_arr):
    if isinstance(path_or_arr, str):
        im = Image.open(path_or_arr).convert('RGBA')
        arr = np.asarray(im).astype(np.float64) / 255.0
        H, W = arr.shape[:2]
    else:
        arr = path_or_arr
        H, W = arr.shape[:2]
    a = arr[..., 3]
    ys, xs = np.where(a > ALPHA_EDGE / 255.0)
    bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    body = a > BODY_T
    return {
        'canvas': [W, H],
        'bbox': list(bb),
        'subj': [bb[2] - bb[0], bb[3] - bb[1]],
        'h_ratio': round((bb[3] - bb[1]) / H, 4),
        'bottom_gap': H - bb[3],
        'hull_gap': round(hull_gap(body), 4),
        'top_jump': top_edge_jump(body),
        'corner': round(corner_residue(arr), 5),
    }


# ────────────────────────────────── 后处理

def finish_cutout(cut_rgba):
    """rembg 输出 → 干净成品（反预乘 / 最大连通域 / 补洞 / 羽化 / 去白边）。

    ★★★ **rembg 的输出是「预乘 alpha」的**（实测：各 alpha 档位上 rgb/原图 恒等于该档 alpha
        —— 0.269/0.424/0.601/0.811 逐一吻合）。不反预乘就把预乘色当直通色用，
        半透明边会被**压暗**（实测：原图 193 → 输出 61，缩略图上就是一块灰黑斑）。
        反预乘后边缘色与原图的平均绝对误差 144.9/255 → **0.6/255**。
    ★ 去白边只作用于**本体之外**那圈半透明边：本体内是画面内容（含固有阴影），不许改色。
    """
    a = cut_rgba[..., 3]
    rgb = np.clip(cut_rgba[..., :3] / np.maximum(a[..., None], 1e-3), 0.0, 1.0)

    hard = a > BODY_T
    hard = binary_fill_holes(hard)
    lbl, n = ndimage.label(hard)
    if n > 1:
        sizes = ndimage.sum(hard, lbl, range(1, n + 1))
        hard = lbl == (int(np.argmax(sizes)) + 1)

    # 保留 rembg 的软边，但把主体之外的碎片清零
    alpha = a * hard
    alpha = np.clip(gaussian_filter(alpha, 0.8), 0.0, 1.0)
    alpha[~hard] = 0.0

    solid = ndimage.binary_erosion(hard, iterations=2)
    if not solid.any():
        solid = hard
    _, idx = distance_transform_edt(~solid, return_indices=True)
    near = rgb[idx[0], idx[1]]

    out = np.zeros_like(cut_rgba)
    out[..., :3] = np.where(hard[..., None], rgb, near)
    out[..., 3] = alpha
    return out, hard


def resize_rgba(arr, size):
    """预乘 alpha 重采样（直接对 RGBA 做 LANCZOS 会在边缘渗进黑边）。"""
    a = arr[..., 3]
    p = arr[..., :3] * a[..., None]
    pi = Image.fromarray(np.clip(p * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB')
    ai = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    p2 = np.asarray(pi.resize(size, Image.LANCZOS)).astype(np.float64) / 255.0
    a2 = np.asarray(ai.resize(size, Image.LANCZOS)).astype(np.float64) / 255.0
    out = np.zeros((size[1], size[0], 4), np.float64)
    nz = a2 > 1e-4
    out[..., 3] = a2
    for c in range(3):
        out[..., c][nz] = np.clip(p2[..., c][nz] / a2[nz], 0, 1)
    return out


def normalize_to_ref(arr, hard, ref):
    """裁到主体 bbox → 缩放到基准的主体高 → 贴到 960×875 画布（底边 gap / 水平居中同基准）。"""
    x0, y0, x1, y1 = bbox_of(hard)
    sw, sh = x1 - x0, y1 - y0
    target_h = ref['subj'][1]
    scale = target_h / sh
    target_w = max(1, int(round(sw * scale)))
    crop = arr[y0:y1, x0:x1]
    crop_r = resize_rgba(crop, (target_w, target_h))

    CW, CH = ref['canvas']
    canvas = np.zeros((CH, CW, 4), np.float64)
    px = int(round((CW - target_w) / 2))
    py = CH - ref['bottom_gap'] - target_h
    if py < 0:
        py = 0
    canvas[py:py + target_h, px:px + target_w] = crop_r
    return canvas, (sw, sh), (target_w, target_h)


# ────────────────────────────────── 主流程

def main():
    os.makedirs(os.path.join(OUT, 'rembg'), exist_ok=True)

    ref_m = measure(REF)
    print(f"基准 {REF}")
    print(f"    主体 {ref_m['subj'][0]}×{ref_m['subj'][1]}  高占比 {ref_m['h_ratio']} "
          f"底 gap {ref_m['bottom_gap']}  凸缺 {ref_m['hull_gap']:.4f}  上沿跳变 {ref_m['top_jump']}px  "
          f"角残留 {ref_m['corner']:.5f}")

    # 负控：第一版抠的 C（已知有缺口）
    old_m = measure(OLD_C) if os.path.exists(OLD_C) else None
    if old_m:
        print(f"负控（第一版阈值法抠的 C）")
        print(f"    主体 {old_m['subj'][0]}×{old_m['subj'][1]}  高占比 {old_m['h_ratio']}  "
              f"凸缺 {old_m['hull_gap']:.4f}  上沿跳变 {old_m['top_jump']}px  "
              f"角残留 {old_m['corner']:.5f}")
        print(f"    ↑ 凸缺/跳变应明显大于基准，否则这两条判据没有判别力")

    # ── rembg 抠图
    print(f"\nrembg 模型 = {MODEL}  （首次会下载权重到 U2NET_HOME，"
          f"当前 = {os.environ.get('U2NET_HOME', '~/.u2net')}）")
    session = new_session(MODEL)
    src = Image.open(SRC_C).convert('RGB')
    cut = remove(src, session=session, alpha_matting=False).convert('RGBA')
    cut_arr = np.asarray(cut).astype(np.float64) / 255.0
    print(f"    rembg 输出 {cut.size[0]}×{cut.size[1]}  alpha 覆盖率 {(cut_arr[..., 3] > 0.5).mean() * 100:.2f}%")
    Image.fromarray(np.clip(cut_arr * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(
        os.path.join(OUT, 'rembg', 'C-rembg-raw.png'))

    fin, hard = finish_cutout(cut_arr)

    # ── ★ 修复靶向判据：预乘反演保真度
    #    取 hard 内半透明（0.55 < alpha < 0.95）的像素，颜色应 ≈ 原图颜色。
    #    不反预乘时 = 原图 × alpha ⇒ 误差很大（实测 ~147/255）；反预乘后应趋 0。
    src255 = np.asarray(src).astype(np.float64)
    aa = cut_arr[..., 3]
    sel = (aa > 0.55) & (aa < 0.95)
    err_now = float(np.abs(fin[..., :3][sel] - src255[sel] / 255.0).mean() * 255) if sel.sum() else float('nan')
    err_pre = float(np.abs(cut_arr[..., :3][sel] - src255[sel] / 255.0).mean() * 255) if sel.sum() else float('nan')
    print(f"\n半透明边颜色保真（n={int(sel.sum()):,}）：不反预乘 {err_pre:.1f}/255 → "
          f"反预乘后 {err_now:.1f}/255")

    canvas, raw_wh, out_wh = normalize_to_ref(fin, hard, ref_m)
    out_path = os.path.join(OUT, 'fail-C-rembg.png')
    Image.fromarray(np.clip(canvas * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(out_path)

    new_m = measure(canvas)
    print(f"\n新图 {out_path}")
    print(f"    原始主体 {raw_wh[0]}×{raw_wh[1]} → 输出主体 {new_m['subj'][0]}×{new_m['subj'][1]}")
    print(f"    高占比 {new_m['h_ratio']} (基准 {ref_m['h_ratio']})  "
          f"偏差 {abs(new_m['h_ratio'] - ref_m['h_ratio']) * 100:.2f}%")
    print(f"    凸缺 {new_m['hull_gap']:.4f}  上沿跳变 {new_m['top_jump']}px  角残留 {new_m['corner']:.5f}"
          f"   ⚠ 前两项**只记录、不断言**：实测基准凸缺 0.3582（最大）—— 它们量的是姿势，不是缺口")

    # ── ★ 方法对照（同一坐标系：原图 1024）—— 这是"残缺"的定量证据
    rgb255 = src255
    m_old = thresh_matte(rgb255)
    cmp = method_diff(m_old, hard, rgb255, 'C')
    print("\n方法对照（原图 1024 坐标系）：阈值法 vs rembg")
    print(f"    阈值法本体 {int(m_old.sum()):,} px   rembg 本体 {int(hard.sum()):,} px")
    print(f"    ★ 漏抠(missed) = {cmp['missed_px']:,} px  占 rembg 本体 {cmp['missed_ratio'] * 100:.2f}%"
          f"  ← 「残缺」")
    print(f"      其中腐蚀 3 次后仍残留（真·厚块缺陷）= {cmp['missed_core_px']:,} px "
          f"({cmp['missed_core_ratio'] * 100:.2f}%)")
    print(f"      误留(over)   = {cmp['over_px']:,} px  占 {cmp['over_ratio'] * 100:.2f}%"
          f"  （腐蚀后残留 {cmp['over_core_px']:,} px）")
    print(f"      差异可视化 → {os.path.join(OUT, 'rembg', 'C-method-diff.png')}")

    # ── 判据
    print("\n判据（每行都带对照口径）")
    j = {
        'scale_ok': abs(new_m['h_ratio'] - ref_m['h_ratio']) < 0.005,
        'corner_ok': new_m['corner'] < 0.005,
        'edge_ok': err_now < 4.0,
        'diff_ok': cmp['missed_core_ratio'] > 0.005,
        'neg_ok': cmp['over_core_ratio'] < cmp['missed_core_ratio'] / 4,
    }
    notes = {
        'scale_ok': '主体高占比与基准一致（±0.5%）',
        'corner_ok': '四角 40×40 无残留',
        'edge_ok': f'半透明边颜色保真（反预乘成功，{err_now:.1f}/255 < 4）',
        'diff_ok': '阈值法有「厚块状」漏抠 >0.5%（复现"残缺"这个现象）',
        'neg_ok': '反向误差腐蚀后远小于漏抠（方向性正确，不是边缘细线噪声）',
    }
    for k, ok in j.items():
        print(f"    {'OK' if ok else 'NG'}  {notes[k]}  [{k}]")

    metrics = {'model': MODEL, 'ref': ref_m, 'old_C': old_m, 'new_C': new_m,
               'raw_subj': list(raw_wh), 'out_subj': list(out_wh),
               'edge_color': {'n': int(sel.sum()), 'pre_err': round(err_pre, 2),
                              'now_err': round(err_now, 2)},
               'method_diff': cmp, 'judge': {k: bool(v) for k, v in j.items()}}
    with open(os.path.join(OUT, '_metrics-C-rembg.json'), 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print(f"\n量测 → {os.path.join(OUT, '_metrics-C-rembg.json')}")


if __name__ == '__main__':
    main()
