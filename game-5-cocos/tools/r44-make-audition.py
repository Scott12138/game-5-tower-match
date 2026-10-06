#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r44-make-audition.py · 第 44 轮：试听件生成（含响度归一化）
============================================================
【为什么必须归一化】
本批 34 条音效的 RMS 从 −21.0 到 −41.2 dBFS，**差 20 dB**。
若把原始文件直接摆在一起试听，用户听到的"好/不好"里有一大半
只是**音量差**，而不是音色差 —— 那样的拍板是失真的。
所以：试听件一律**峰值归一化到 −1 dBFS**；
原始实测电平与"入库需要补偿多少增益"如实写在量测表里。
（绝不修改入库候选本体，只改试听副本。）

【输出】
  <out>/bgm/*.m4a      3 条首推=全曲 128 kbps；备选=中段 40 s 64 kbps 单声道
  <out>/sfx/*.m4a      各截前 2.5 s（或全曲），96 kbps
  <out>/bgm/*.png      波形缩略（沿用上一轮量测脚本产物）
  <out>/manifest.json  供拍板板使用

【用法】
  python3 tools/r44-make-audition.py <cat.json> <bgm分析.json> <sfx分析.json> <out> [rawdir]
============================================================
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

TARGET_PEAK_DBFS = -1.0
BGM_FULL = {'pt-taohua', 'pt-laidback3', 'am-yuanyaka'}      # 由调用方再覆盖
BGM_FULL_SEC = 40.0          # 备选片段长度
SFX_MAX_SEC = 2.5


def decode(src, wav, hz=44100):
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{hz}', '-c', '1', src, wav],
                   check=True, capture_output=True)
    with wave.open(wav, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert ch == 1 and sw == 2, f'解码口径不符 ch={ch} sw={sw}'
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0, rate


def write_wav(x, rate, dst):
    y = np.clip(x, -1.0, 1.0)
    with wave.open(dst, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((y * 32767.0).astype('<i2').tobytes())


def peek_normalize(x):
    """峰值归一化；返回施加的增益(dB)。"""
    pk = float(np.abs(x).max())
    if pk < 1e-6:
        return x, 0.0
    g = 10 ** (TARGET_PEAK_DBFS / 20) / pk
    return x * g, 20 * np.log10(g)


def to_m4a(src_wav, dst, br, sr=44100, ch=1):
    subprocess.run(['afconvert', '-f', 'm4af', '-d', f'aac@{sr}', '-b', str(br),
                    '-c', str(ch), src_wav, dst], check=True, capture_output=True)


def fade(x, rate, ms=12):
    """首尾各加一点淡入淡出，避免裁剪点爆音。"""
    n = max(1, int(rate * ms / 1000))
    if len(x) < 2 * n:
        return x
    x = x.copy()
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def main():
    cat_p, bgm_p, sfx_p, out = sys.argv[1:5]
    raw = sys.argv[5] if len(sys.argv) > 5 else '/tmp/r44/raw'
    cat = json.load(open(cat_p))
    bgm = json.load(open(bgm_p))
    sfx = json.load(open(sfx_p))
    os.makedirs(f'{out}/bgm', exist_ok=True)
    os.makedirs(f'{out}/sfx', exist_ok=True)

    full = set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                           '_r44', 'picks.json')))) \
        if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       '_r44', 'picks.json')) else set()

    man = {'bgm': [], 'sfx': []}
    tmp = '/tmp/_r44_aud.wav'

    print('════ BGM ════')
    for k, a in sorted(bgm.items()):
        src = f'{raw}/{k}.mp3'
        x, sr = decode(src, tmp)
        raw_rms = 20 * np.log10(float(np.sqrt((x ** 2).mean())) + 1e-9)
        info = cat.get(k, {})
        is_full = k in full
        if is_full:
            body = x
            gain_note = 'full'
        else:
            mid = max(0, len(x) // 2 - int(sr * BGM_FULL_SEC / 2))
            body = x[mid: mid + int(sr * BGM_FULL_SEC)]
            gain_note = f'excerpt{int(BGM_FULL_SEC)}s'
        body = fade(body, sr)
        body, g = peek_normalize(body)
        write_wav(body, sr, tmp)
        to_m4a(tmp, f'{out}/bgm/{k}.m4a', 128000 if is_full else 64000, sr, 1)
        man['bgm'].append(dict(id=k, kind='bgm', title=info.get('title', k),
                               artist=info.get('artist', ''), src=info.get('src', ''),
                               official=info.get('official', ''), tags=info.get('tags', ''),
                               page=info.get('page', ''), file=info.get('file', ''),
                               loop=info.get('loop', ''),
                               dur=a['dur'], bytes=a['bytes'], bpm=a['bpm_est'],
                               dyn=a['dyn_db'], centroid=a['centroid_hz'],
                               low=a['low_250'], mid=a['mid_250_2k'], high=a['high_2k'],
                               onset=a['onset_rate'], rms_raw=round(raw_rms, 1),
                               deliver=gain_note, gain_applied=round(g, 1),
                               audio=f'bgm/{k}.m4a', png=f'{k}.png'))
        print(f'  {k:<20} {gain_note:<12} +{g:5.1f} dB  → bgm/{k}.m4a')

    print('════ SFX ════')
    for k, a in sorted(sfx.items()):
        src = f'{raw}/{k}.mp3'
        x, sr = decode(src, tmp)
        body = x[:int(sr * min(a['dur'], SFX_MAX_SEC))]
        body = fade(body, sr)
        body, g = peek_normalize(body)
        write_wav(body, sr, tmp)
        to_m4a(tmp, f'{out}/sfx/{k}.m4a', 96000, sr, 1)
        man['sfx'].append(dict(id=k, cat=a['cat'], title=a['title'], src=a['src'],
                               official=a['official'], tags=a['tags'], note=a['note'],
                               page=a['page'], file=a['file'], dur=a['dur'],
                               peak=a['peak_dbfs'], rms=a['rms_dbfs'], crest=a['crest_db'],
                               attack=a['attack_ms'], decay=a['decay_to_-30db_ms'],
                               onsets=a['onsets'], first_share=a['first_hit_share'],
                               centroid=a['centroid_hz'], rolloff=a['rolloff95_hz'],
                               gain_peak=a['gain_to_peak_-1db'], gain_rms=a['gain_to_rms_-20db'],
                               gain_applied=round(g, 1),
                               audio=f'sfx/{k}.m4a', png=f'{k}.png'))
        print(f'  {a["cat"]:<5}{k:<24}+{g:5.1f} dB → sfx/{k}.m4a')

    with open(f'{out}/manifest.json', 'w') as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
    print()
    print(f'  [v] BGM {len(man["bgm"])} 条 · 音效 {len(man["sfx"])} 条 → {out}/manifest.json')


if __name__ == '__main__':
    main()
