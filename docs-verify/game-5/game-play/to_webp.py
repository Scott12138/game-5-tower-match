#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L2 · 资产转 WebP（第 33 轮 · 新建）

用户第 33 轮拍板：
  「主包体积超限问题，先采用 **转 WebP** 方案处理，但**资产文件本身不得改动**，
    后续方案仍可能调整，需**保留替换空间**。」

因而本脚本的硬约束：
  ✅ **只读**源资产（PNG），一个字都不改；
  ✅ 产物另出到**独立目录**（`<dir>-webp/` 或 `--out` 指定），结构镜像源目录；
  ✅ **可回退**——想切回 PNG 只需把引用指回原目录 / 删掉 `-webp` 目录即完全复原；
  ✅ 默认**不碰任何 HTML**（切换是单独一步，见文末"切换方式"）。

⚠ 误差口径（第 33 轮踩过的坑）：
  直接比 `|src−dst|` 会得到 **最大通道差 255** ——那是**全透明像素的 RGB 无定义**
  （WebP 会把透明区 RGB 清零），并非画质问题。**只在 alpha>8 的可见像素上统计**才有意义。

用法：
  python3 to_webp.py --sweep                      # 只测不写：多档体积 + 可见像素误差
  python3 to_webp.py                              # 默认：tiles → tiles-webp，q=90
  python3 to_webp.py --q 88 --src <in> --out <out>
  python3 to_webp.py --report                     # 扫全 assets/，出「主包 WebP 投影」不写文件
"""
import os, sys, glob, time
import numpy as np
from PIL import Image

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
DEFAULT_SRC = os.path.join(ROOT, 'assets/game-play/tiles')
DEFAULT_OUT = os.path.join(ROOT, 'assets/game-play/tiles-webp')
DEFAULT_Q = 90
ALPHA_MIN = 8

SWEEP = '--sweep' in sys.argv
REPORT = '--report' in sys.argv
LOSSLESS = '--lossless' in sys.argv


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


Q = int(arg('--q', DEFAULT_Q))
SRC = arg('--src', DEFAULT_SRC)
OUT = arg('--out', DEFAULT_OUT)


def kb(n):
    return n / 1024.0


def pngs(d):
    return sorted(f for f in glob.glob(os.path.join(d, '**', '*.png'), recursive=True))


def kwargs():
    return dict(lossless=True, method=6) if LOSSLESS else dict(quality=Q, method=6)


def visible_err(im, back):
    """只在 alpha>8 的可见像素上比通道差（返回 max, mean, PSNR）。"""
    a = np.asarray(im).astype(np.float32)
    b = np.asarray(back).astype(np.float32)
    vis = a[..., 3] > ALPHA_MIN
    if not vis.any():
        return 0, 0.0, 99.0
    d = np.abs(a[..., :3][vis] - b[..., :3][vis])
    mse = float((d ** 2).mean())
    psnr = 99.0 if mse == 0 else 10 * np.log10(255.0 ** 2 / mse)
    return int(d.max()), float(d.mean()), psnr


def sweep():
    fs = pngs(SRC)
    tot_png = sum(os.path.getsize(f) for f in fs)
    print('══ WebP 档位扫描（%d 张 · 原 PNG 合计 %.1f KB）══' % (len(fs), kb(tot_png)))
    print('%-10s %-11s %-9s %-8s %-7s %-7s %s'
          % ('档位', '合计KB', '相对PNG', '节省KB', '可见MAX', '可见MEAN', 'PSNR'))
    tmp = '/tmp/_wbx.webp'
    for label, kw in [('q=80', dict(quality=80, method=6)),
                      ('q=85', dict(quality=85, method=6)),
                      ('q=90', dict(quality=90, method=6)),
                      ('q=93', dict(quality=93, method=6)),
                      ('lossless', dict(lossless=True, method=6))]:
        tot, mx, mn, ps = 0, 0, 0.0, []
        for f in fs:
            im = Image.open(f).convert('RGBA')
            im.save(tmp, 'WEBP', **kw)
            tot += os.path.getsize(tmp)
            if label != 'lossless':
                back = Image.open(tmp).convert('RGBA')
                a, b, p = visible_err(im, back)
                mx = max(mx, a); mn += b; ps.append(p)
        extra = ('' if label == 'lossless' else
                 '%-7d %-7.2f %.1f dB' % (mx, mn / len(fs), sum(ps) / len(ps)))
        print('%-10s %-11.1f %-9s %-8.1f %s'
              % (label, kb(tot), '%.0f%%' % (tot / tot_png * 100), kb(tot_png - tot), extra))
    print('\n※ 只测不写，未产生任何文件。可见MAX 为 alpha>8 像素上的最大通道差。')


def report():
    """扫全 assets/（排除 _src / *-bak / *-webp），出主包 WebP 投影。"""
    print('══ 主包 WebP 投影（q=%d · 只测不写）══\n' % Q)
    groups = [('game-play/tiles', os.path.join(ROOT, 'assets/game-play/tiles')),
              ('game-play/规则页', os.path.join(ROOT, 'assets/game-play')),
              ('home', os.path.join(ROOT, 'assets/home')),
              ('game-start', os.path.join(ROOT, 'assets/game-start')),
              ('splash', os.path.join(ROOT, 'assets/splash'))]
    tot_png = tot_web = 0
    print('%-22s %-8s %-12s %-12s %-8s %s' % ('目录', '张数', 'PNG KB', 'WebP KB', '占比', '节省'))
    tmp = '/tmp/_wbr.webp'
    for name, d in groups:
        if name.endswith('规则页'):
            fs = [os.path.join(d, 'rule-完整规则页.png')]
        else:
            fs = [f for f in glob.glob(os.path.join(d, '**', '*.png'), recursive=True)
                  if '-bak' not in f and '-webp' not in f]
        fs = [f for f in fs if os.path.exists(f)]
        sp_ = sum(os.path.getsize(f) for f in fs)
        sw_ = 0
        for f in fs:
            Image.open(f).convert('RGBA').save(tmp, 'WEBP', quality=Q, method=6)
            sw_ += os.path.getsize(tmp)
        tot_png += sp_; tot_web += sw_
        print('%-22s %-8d %-12.1f %-12.1f %-8s %.1f KB'
              % (name, len(fs), kb(sp_), kb(sw_), '%.0f%%' % (sw_ / sp_ * 100 if sp_ else 0),
                 kb(sp_ - sw_)))
    print('%-22s %-8s %-12.1f %-12.1f %-8s %.1f KB'
          % ('合计', '', kb(tot_png), kb(tot_web), '%.0f%%' % (tot_web / tot_png * 100),
             kb(tot_png - tot_web)))
    print('\n  主包上限 4096 KB  ⇒  PNG 方案 %.1f KB（%s）· WebP 方案 %.1f KB（%s）'
          % (kb(tot_png), '超限' if tot_png > 4096 * 1024 else '达标',
             kb(tot_web), '超限' if tot_web > 4096 * 1024 else '达标'))
    print('※ 只测不写，未产生任何文件。')


def convert():
    fs = pngs(SRC)
    kw = kwargs()
    tag = 'lossless' if LOSSLESS else 'q=%d' % Q
    tot_png = tot_web = 0
    print('══ 转 WebP（%s）══' % tag)
    print('   源：%s' % os.path.relpath(SRC, ROOT))
    print('   出：%s' % os.path.relpath(OUT, ROOT))
    print('   %-10s %-13s %-13s %-11s %s' % ('文件', '原 PNG KB', 'WebP KB', '节省 KB', '占比'))
    for f in fs:
        rel = os.path.relpath(f, SRC)
        op = os.path.join(OUT, rel[:-4] + '.webp')
        os.makedirs(os.path.dirname(op), exist_ok=True)
        im = Image.open(f).convert('RGBA')
        im.save(op, 'WEBP', **kw)
        sp_, sw = os.path.getsize(f), os.path.getsize(op)
        tot_png += sp_; tot_web += sw
        print('   %-10s %-13.1f %-13.1f %-11.1f %.0f%%' % (rel, kb(sp_), kb(sw), kb(sp_ - sw),
                                                          sw / sp_ * 100))
    print('\n   合计：%.1f KB → %.1f KB（省 %.1f KB · 保留 %.0f%%）'
          % (kb(tot_png), kb(tot_web), kb(tot_png - tot_web), tot_web / tot_png * 100))
    print('   ✅ 原 PNG 未被改动 · 回退：删除 %s 并把引用指回原目录'
          % os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    if REPORT:
        report()
    elif SWEEP:
        sweep()
    else:
        convert()
