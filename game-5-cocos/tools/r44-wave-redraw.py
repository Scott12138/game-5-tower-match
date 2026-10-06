#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r44-wave-redraw.py · 按「显示比例」重绘波形缩略图
================================================================
【为什么必须重绘，而不是改 CSS 拉伸】
  第 44 轮第一批波形图按 900×150（6:1）/ 760×150（5.07:1）渲染，
  而板子里 .wave 是固定 56px 高、width:100%（1660 视口下内容盒 819×54 = 15.17:1）。
  819×54 显示 6:1 的图 ⇒ 横向拉伸 2.53 倍。拉伸波形不改变振幅幅度的「真」，
  但把时间轴糊掉了（锯齿横向拉丝），属判据纪律里的「把图拉变形」。

【正解】让位图比例 = 显示比例
  统一渲染成 W×H = 1500×100（恰 15:1），CSS 改成 .wave{height:auto} + img{width:100%;height:auto}，
  于是显示比例恒等于源图比例 ⇒ 变形量 0，且行高仍是 ~54px（版面不变重）。

【判据】重绘后必须复量：源图宽高比 == 15.000，且分辨率足够（≥ 显示宽的 1.5 倍）
  用法: python3 tools/r44-wave-redraw.py <manifest.json> <catalog.json> <deliver_dir>
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw

W, H = 1500, 100          # ★ 15:1，与 CSS aspect 一致
RAWP = '/tmp/r44/raw'     # r44-fetch.py 的原始 mp3 落地目录
TMPW = '/tmp/_r44_wave.wav'


def decode(src, hz):
    """afconvert 解成单声道 16bit WAV（本机无 ffmpeg）。"""
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{hz}', '-c', '1', src, TMPW],
                   check=True, capture_output=True)
    with wave.open(TMPW, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert ch == 1 and sw == 2, f'解码口径不符 ch={ch} sw={sw}'
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0, rate


def wave_png(src, out_png, w=W, h=H, hz=44100):
    """峰值包络：每列一根竖线（峰值归一化）。"""
    x, _sp = decode(src, hz)
    if len(x) < w:
        x = np.pad(x, (0, w - len(x)))
    n = len(x) // w
    x = x[:n * w].reshape(w, n)
    hi, lo = x.max(axis=1), x.min(axis=1)
    pk = max(1e-6, float(max(hi.max(), -lo.min())))
    hi, lo = hi / pk, lo / pk                     # ★ 峰值归一化：波形只表形状，不表音量
    im = Image.new('RGB', (w, h), (10, 23, 16))
    d = ImageDraw.Draw(im)
    mid = h // 2
    d.line([(0, mid), (w, mid)], fill=(60, 90, 74))
    amp = h * 0.46
    for i in range(w):
        y0, y1 = mid - hi[i] * amp, mid - lo[i] * amp
        if y1 - y0 < 1.0:
            y1 = y0 + 1.0
        d.line([(i, y1), (i, y0)], fill=(198, 162, 88))
    im.save(out_png, optimize=True)


def main():
    man_p, cat_p, outd = sys.argv[1], sys.argv[2], sys.argv[3]
    man = json.load(open(man_p, encoding='utf-8'))
    cat = json.load(open(cat_p, encoding='utf-8'))
    ok = miss = 0
    for grp in ('bgm', 'sfx'):
        sub = grp
        os.makedirs(os.path.join(outd, sub), exist_ok=True)
        for r in man[grp]:
            rid = r['id']
            raw = os.path.join(RAWP, rid + '.mp3')
            if not os.path.exists(raw):
                cand = [p for p in os.listdir(RAWP) if p.startswith(rid)]
                if not cand:
                    print(f'  [x] {rid}: 缺原始 mp3，跳过')
                    miss += 1
                    continue
                raw = os.path.join(RAWP, cand[0])
            hz = 22050 if grp == 'bgm' else 44100
            out_png = os.path.join(outd, r['png'])
            wave_png(raw, out_png, hz=hz)
            with Image.open(out_png) as im:
                ratio = im.size[0] / im.size[1]
            assert abs(ratio - W / H) < 1e-6, f'{rid} 比例不符 {ratio}'
            ok += 1
    print(f'  重绘 OK {ok} / 缺源 {miss}（目标比例 {W}:{H} = {W/H:.3f}）')
    assert miss == 0, '有条目缺原始 mp3，波形图不完整'


if __name__ == '__main__':
    main()
