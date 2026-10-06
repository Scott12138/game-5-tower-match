#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r43-bgm-slice.py · 为「试听板」准备音频
============================================================
【为什么不全曲照搬】
3 条首推留**全曲**（要拍板就得听完整的）；其余 10 条备选只截
**中段 40 秒**并压到 56 kbps 单声道 —— 只为听"气质"，
把交付目录从 ~52 MB 压到 ~13 MB。页面上会如实标注"片段"。

【为什么不用 afconvert 直接裁】
afconvert 不支持按时间裁切。所以走「afconvert 解成 WAV → numpy 切片
→ 写 WAV → afconvert 编码 AAC(.m4a)」。本机没有 ffmpeg，这是唯一通路。
⚠️ macOS 自带 afconvert **不能编码 MP3**（只能解码），所以交付格式选
   AAC/M4A —— Chrome / Safari / 微信内置浏览器都支持。

【用法】python3 tools/r43-bgm-slice.py <候选目录> <输出目录> <full|excerpt> <id...>
============================================================
"""

import os
import subprocess
import sys
import wave

import numpy as np

HZ = 44100


def afconvert(src, dst, args):
    subprocess.run(['afconvert', '-f', dst[1], '-d', dst[2], *args, src, dst[0]],
                   check=True, capture_output=True)


def to_wav(src, wav):
    afconvert(src, (wav, 'WAVE', f'LEI16@{HZ}'), ['-c', '2'])


def read_wav(p):
    with wave.open(p, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype='<i2').reshape(-1, ch)
    assert sw == 2, sw
    return x, rate, ch


def write_wav(p, x, rate, ch):
    with wave.open(p, 'wb') as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(x.astype('<i2').tobytes())


def main():
    src_dir, out_dir, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    ids = sys.argv[4:]
    os.makedirs(out_dir, exist_ok=True)
    for key in ids:
        src = os.path.join(src_dir, key + '.mp3')
        tmp_wav, tmp_out = f'/tmp/_slice_{key}.wav', f'/tmp/_slice_{key}.wav'
        to_wav(src, tmp_wav)
        x, rate, ch = read_wav(tmp_wav)
        if mode == 'excerpt':
            # 取 25%~40% 区间里最"满"的那 40 秒（避开前奏留白，用 1s 窗 RMS 挑）
            total = len(x) // rate
            win = 40
            lo, hi = int(total * 0.20), max(int(total * 0.20) + 1, total - win)
            step = rate
            best, best_v = lo, -1
            for t in range(lo, hi, 5):
                seg = x[t * rate:(t + min(win, 4)) * rate].astype(np.float64)
                v = float((seg ** 2).mean())
                if v > best_v:
                    best_v, best = v, t
            x = x[best * rate:(best + win) * rate]
            t0, t1 = best, min(best + win, total)
            print(f'  {key}: 截取 {t0}~{t1}s（{t1 - t0}s）')
            write_wav(tmp_out, x, rate, ch)
            # 56 kbps 单声道（AAC）
            out = os.path.join(out_dir, key + '.m4a')
            afconvert(tmp_out, (out, 'm4af', 'aac'), ['-b', '56000', '-c', '1'])
        else:
            print(f'  {key}: 全曲 {len(x)/rate:.1f}s 原码率转 AAC')
            write_wav(tmp_out, x, rate, ch)
            out = os.path.join(out_dir, key + '.m4a')
            afconvert(tmp_out, (out, 'm4af', 'aac'), ['-b', '128000'])
        print(f'      → {os.path.basename(out)} {os.path.getsize(out)/1024:.0f} KB')


if __name__ == '__main__':
    main()
