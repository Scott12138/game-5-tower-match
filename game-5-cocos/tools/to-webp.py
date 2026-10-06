#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 to-webp.py · 把 game-5-cocos/assets/resources 下的位图批量转为 WebP
--------------------------------------------------------------------------------
 为什么这么做（本工程实测结论，别删）：

 1) Cocos 3.8.8 的构建产物对位图是 **1:1 字节拷贝**，不做任何重编码。
    实测：源 coin.webp 4792B → 产物 native/7a/7a228bbe-....webp 4792B，完全一致。
    ⇒「源图多大，包体就多大」，体积完全由本脚本决定，构建不会偷偷帮你压。
 2) 微信小游戏 **主包上限 4096K**，超了本地预检直接抛 CODE_SIZE_EXCEED，
    预览和上传都过不去。
 3) 本工程实测预算（2026-10-06）：
        产物总量 9632K − resources 7560K = 2072K（引擎等，已极限裁剪，动不了）
        ⇒ resources 预算 = 4096 − 2072 = 2024K
        其中非图片开销（config.json + index.js + import/*.json）约 496K
        ⇒ 图片可用约 1528K，而原图合计 6889K。**必须砍 ~78%。**
 4) 实测可行档位（图片合计）：
        q=84 → 1018K   q=86 → 1106K   q=88 → 1219K   q=90 → 1356K   q=92 → ~1534K(贴线)
    ⇒ **q=90 是能进预算的最高质量档**（合计约 1852K，余量 172K），
       对应「保观感优先」的口径。

 5) ⚠️ 误差口径（踩过坑，别改）：
    WebP 的透明区 RGB 是无定义的。若在全图上算「最大通道差」，会得到
    "最大差 255" 的假象（那只是 alpha=0 的像素）。**统计必须只在 alpha>8
    的可见像素上做**，否则指标毫无意义。
    本脚本用 cwebp 自报的 Y-U-V-All-PSNR 作为参考值（它已按可见区计算）。

 6) ⚠️ 编码器必须用 **Cocos 自带的 cwebp**（同源，结果可预期）：
        /Applications/Cocos/Creator/<ver>/CocosCreator.app/Contents/Resources/
            tools/libwebp_darwin/bin/cwebp
    实测它与 PIL 的 WEBP 结果一致，但同源更稳。

 7) ⚠️ `-exact` 必须开：保留透明区 RGB，避免缩放时边缘渗色（保观感）。

 用法：
   python3 tools/to-webp.py --dry-run            # 只算体积、不写盘（先看数）
   python3 tools/to-webp.py                      # 执行转换（q=90, method=6）
   python3 tools/to-webp.py --q 88               # 换档位
   python3 tools/to-webp.py --restore <备份目录>  # 从备份还原原图
================================================================================
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC = os.path.join(PROJ, 'assets', 'resources')

BITMAP_EXT = ('.png', '.jpg', '.jpeg')
SKIP_DIRS = ()          # 目前无需跳过；audio/ 里是 mp3，不在 BITMAP_EXT 内


def find_cwebp():
    """在已安装的 Cocos Creator 里找自带的 cwebp（取版本号最大的）。"""
    root = '/Applications/Cocos/Creator'
    if not os.path.isdir(root):
        return None
    cands = []
    for ver in os.listdir(root):
        p = os.path.join(root, ver, 'CocosCreator.app', 'Contents', 'Resources',
                         'tools', 'libwebp_darwin', 'bin', 'cwebp')
        if os.path.isfile(p) and os.access(p, os.X_OK):
            cands.append((ver, p))
    if not cands:
        return None
    cands.sort(key=lambda x: [int(n) for n in x[0].split('.') if n.isdigit()] or [0])
    return cands[-1][1]


def collect():
    out = []
    for p in sorted(glob.glob(os.path.join(SRC, '**', '*'), recursive=True)):
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(p)[1].lower()
        if ext not in BITMAP_EXT:
            continue
        rel = os.path.relpath(p, SRC)
        top = rel.split(os.sep)[0]
        if top in SKIP_DIRS:
            continue
        out.append(p)
    return out


def kb(path):
    return os.path.getsize(path) / 1024.0


def encode(cwebp, src, dst, q, method):
    # -print_psnr：让 cwebp 自报可见区口径的 PSNR（透明区不参与，见文件头第 5 条）
    cmd = [cwebp, '-q', str(q), '-alpha_q', '100', '-exact',
           '-m', str(method), '-print_psnr', src, '-o', dst]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None, (r.stderr or r.stdout or '').strip()
    psnr = ''
    for line in (r.stdout + '\n' + r.stderr).splitlines():
        if 'PSNR' in line:
            # 形如 "Output: 4792 bytes Y-U-V-All-PSNR 43.93 41.21 41.44   42.88 dB"
            psnr = line.strip().replace('Output:', '').strip()
    return psnr, None


def do_restore(backup):
    if not os.path.isdir(backup):
        print('❌ 备份目录不存在：%s' % backup)
        return 1
    n = 0
    for p in sorted(glob.glob(os.path.join(backup, '**', '*'), recursive=True)):
        if not os.path.isfile(p):
            continue
        rel = os.path.relpath(p, backup)
        dst = os.path.join(SRC, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(p, dst)
        n += 1
    # 删掉转换期产生的 webp（备份里没有的）
    for p in sorted(glob.glob(os.path.join(SRC, '**', '*.webp'), recursive=True)):
        rel = os.path.relpath(p, SRC)
        if not os.path.exists(os.path.join(backup, rel)):
            os.remove(p)
    print('✅ 已从备份还原 %d 个文件：%s' % (n, backup))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--q', type=int, default=90, help='WebP 质量档（默认 90）')
    ap.add_argument('--method', type=int, default=6, help='cwebp -m，0..6（默认 6，最慢最小）')
    ap.add_argument('--dry-run', action='store_true', help='只算体积不写盘')
    ap.add_argument('--restore', metavar='DIR', help='从备份目录还原原图')
    args = ap.parse_args()

    if args.restore:
        return do_restore(args.restore)

    if not os.path.isdir(SRC):
        print('❌ 找不到资源目录：%s' % SRC)
        return 1

    cwebp = find_cwebp()
    if not cwebp:
        print('❌ 找不到 Cocos 自带的 cwebp。请确认 Cocos Creator 已安装到 /Applications/Cocos/Creator/')
        return 1
    print('==> 编码器：%s' % cwebp)
    v = subprocess.run([cwebp, '-version'], capture_output=True, text=True).stdout.strip().splitlines()
    print('    %s' % (v[0] if v else '?'))
    print('==> 资源目录：%s' % SRC)
    print('==> 档位：q=%d  method=%d  exact=on  alpha_q=100' % (args.q, args.method))
    print()

    files = collect()
    rows = []
    tmpdir = os.path.join('/tmp', 'g5-webp-tmp')
    os.makedirs(tmpdir, exist_ok=True)

    for src in files:
        rel = os.path.relpath(src, SRC)
        dst = os.path.join(tmpdir, rel.replace(os.sep, '__') + '.webp')
        psnr, err = encode(cwebp, src, dst, args.q, args.method)
        if err:
            print('❌ 编码失败 %s : %s' % (rel, err))
            return 1
        o, w = kb(src), kb(dst)
        rows.append((rel, o, w, psnr))

    rows.sort(key=lambda r: -r[1])
    print('%-46s %9s %9s %7s  %s' % ('path', '原KB', 'webpKB', '压缩到', 'PSNR'))
    print('-' * 104)
    for rel, o, w, psnr in rows:
        print('%-46s %9.1f %9.1f %6.1f%%  %s' % (rel, o, w, w / o * 100, psnr))

    to = sum(r[1] for r in rows)
    tw = sum(r[2] for r in rows)
    print('-' * 104)
    print('合计 原 %.0fK → webp %.0fK  （压缩到 %.1f%%，省 %.0fK）' % (to, tw, tw / to * 100, to - tw))
    print()
    print('预算参照：resources 预算 2024K ＝ 非图片开销约 496K ＋ 图片可用约 1528K')
    est = tw + 496
    print('预估 resources 成品 ≈ %.0fK  vs 预算 2024K  →  %s（余 %.0fK）'
          % (est, 'OK' if est <= 2024 else '超预算', 2024 - est))

    if args.dry_run:
        print()
        print('（--dry-run：未做任何写盘）')
        return 0

    print()
    print('==> 开始写盘（删除原图与其 .meta，写入 .webp）…')
    done = 0
    for rel, o, w, psnr in rows:
        src = os.path.join(SRC, rel)
        dst = os.path.join(SRC, rel + '.webp')
        shutil.copy2(os.path.join(tmpdir, rel.replace(os.sep, '__') + '.webp'), dst)
        os.remove(src)
        meta = src + '.meta'
        if os.path.exists(meta):
            os.remove(meta)
        done += 1
    print('✅ 已转换 %d 张' % done)

    # 自检：不残留原位图、webp 数量对得上
    left = [p for p in collect()]
    webs = glob.glob(os.path.join(SRC, '**', '*.webp'), recursive=True)
    print('   剩余原图 %d 个（应为 0）／ webp %d 个（应为 %d）' % (len(left), len(webs), done))
    if left:
        print('⚠️ 仍有未转换的原图：')
        for p in left:
            print('     ' + os.path.relpath(p, SRC))
    return 0


if __name__ == '__main__':
    sys.exit(main())
