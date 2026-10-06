#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r44-sfx-analyze.py · 第 44 轮：音效候选「客观量测 + 试听素材」
============================================================
【为什么需要它】
我没有耳朵，判不了"好不好听"。但**能判的必须判**：
一个"麻将落槽"音效是不是合适，有几条是硬指标，不靠耳朵：
  · 是不是**单次**碰撞（onset 数）—— 一条里藏 5 声就没法当"落一次"用
  · 起音有多快（attack ms）—— 敲击类必须 < 15 ms，慢了就成"吹奏"
  · 衰减有多快（decay ms）—— 塑料/木 ≈ 短；金属/石 ≈ 长
  · 频谱重心（centroid）—— 麻将牌是硬塑料，"亮"但不刺（约 1.5~5 kHz）
  · 峰值/RMS —— 入库前必须知道要不要补偿增益，否则混在 BGM 上听不见

【判据纪律】
- 只输出**测量值**，不做审美断言；"好听"交给用户试听。
- 解不出 PCM 就报错退出，**不许静默跳过**（否则会把"解码失败"当成"素材不行"）。
- 每条都出：波形图（看包络）+ 裁剪试听件（AAC）——试听件只截前 N 秒。

【用法】
  python3 tools/r44-sfx-analyze.py <raw目录> <catalog.json> <输出目录>
============================================================
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw

EXCERPT_SEC = 2.4          # 试听件长度（够听到完整一击 + 少许余韵）
EXCERPT_BR = 64000         # AAC 码率（试听用，入库另议）


def decode(src, wav, hz=44100):
    """afconvert 解成单声道 16bit WAV（本机无 ffmpeg）。"""
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{hz}', '-c', '1', src, wav],
                   check=True, capture_output=True)
    with wave.open(wav, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert ch == 1 and sw == 2, f'解码口径不符 ch={ch} sw={sw}'
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0, rate


def db(x):
    return 20 * np.log10(max(float(x), 1e-9))


def envelope(x, sr, win_ms=4):
    """短窗 RMS 包络（每 win_ms 一个点）。"""
    n = max(1, int(sr * win_ms / 1000))
    k = len(x) // n
    if k < 4:                                    # 极短样本兜底
        return np.abs(x), 1.0 / sr
    e = np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12)
    return e, n / sr


def analyze(src, sr_target=44100):
    x, sr = decode(src, '/tmp/_r44.wav', sr_target)
    env, hop = envelope(x, sr)
    pk = float(np.abs(x).max()) or 1e-9
    peaki = int(np.argmax(np.abs(x)))

    # —— 起音：必须**从峰值往回找** ——
    #    ✗ 错法：从 0 开始找第一个超过 10% 峰值的样本 → 峰值靠后的文件会算出 1000 ms+
    #      （那是"到峰值还有多久"，不是"起音有多快"）
    #    ✓ 正法：定位峰值样本，向前回溯到包络首次跌破峰值 10% 的位置
    i_pk = peaki
    thr10 = pk * 0.10
    j = i_pk
    while j > 0 and abs(x[j]) > thr10:
        j -= 1
    attack_ms = (i_pk - j) / sr * 1000

    # 峰值位置在整段里的相对位置：能区分"一开头就响"与"后面才响"
    peak_at = round(i_pk / sr, 3)

    # —— 衰减：越过 -6 dB 之后，回到 -30 dB 所需时间（相对峰值帧）——
    epk = env.max() or 1e-9
    ipk = int(np.argmax(env))
    tail = env[ipk:]
    below = np.where(tail <= epk * 10 ** (-30 / 20))[0]
    decay_ms = (below[0] * hop * 1000) if len(below) else len(tail) * hop * 1000

    # —— 连续性：包络里显著峰的数量（判断"单响"还是"一串"）——
    #    阈值 -15 dB + 60 ms 去抖：包络的微小起伏不该被数成一次碰撞
    thr = epk * 10 ** (-15 / 20)
    on = []
    last = -99
    for i in range(1, len(env) - 1):
        if env[i] > thr and env[i] > env[i - 1] and env[i] >= env[i + 1]:
            if i - last > max(1, int(0.060 / hop)):
                on.append(i)
                last = i
    n_onsets = len(on)
    # 第一响占总能量的比例（越高越"单发"）
    if n_onsets:
        w = int(0.25 / hop)                                # 首响后 250 ms 内
        e0 = float((env[:min(len(env), on[0] + w)] ** 2).sum())
        first_share = e0 / float((env ** 2).sum() + 1e-12)
    else:
        first_share = 1.0

    # —— 频谱 ——
    n = 2048
    seg = x[max(0, peaki - n // 4): max(0, peaki - n // 4) + n]
    if len(seg) < n:
        seg = np.pad(seg, (0, n - len(seg)))
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) + 1e-9
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    centroid = float((S * f).sum() / S.sum())
    cum = np.cumsum(S) / S.sum()
    roll95 = float(f[np.searchsorted(cum, 0.95)])
    band = S.sum() and {
        'low200': float(S[f < 200].sum() / S.sum()),
        'mid200_2k': float(S[(f >= 200) & (f < 2000)].sum() / S.sum()),
        'high2k': float(S[f >= 2000].sum() / S.sum()),
    }

    # —— 立体声/亮度粗判 ——
    zcr = float(np.mean(np.abs(np.diff(np.sign(x))) > 0) * sr / 2)
    rms = float(np.sqrt((x ** 2).mean()))
    return {
        'dur': round(len(x) / sr, 3),
        'peak_dbfs': round(db(pk), 1),
        'rms_dbfs': round(db(rms), 1),
        'crest_db': round(db(pk) - db(rms), 1),
        'peak_at_s': peak_at,
        'attack_ms': round(attack_ms, 1),
        'decay_to_-30db_ms': round(decay_ms, 0),
        'onsets': n_onsets,
        'first_hit_share': round(first_share, 3),
        'centroid_hz': round(centroid),
        'rolloff95_hz': round(roll95),
        'zcr_hz': round(zcr),
        # ★ 入库前要知道的两个增益：本批素材的峰值差到 10 dB 以上，
        #   不补偿的话同一个音量参数下有的听得见、有的听不见
        'gain_to_peak_-1db': round(-1 - db(pk), 1),
        'gain_to_rms_-20db': round(-20 - db(rms), 1),
        **{k: round(v, 3) for k, v in (band or {}).items()},
    }


def wave_png(src, out, w=760, h=150, hz=44100):
    x, sr = decode(src, '/tmp/_r44b.wav', hz)
    x = x[:int(EXCERPT_SEC * sr)]
    n = max(1, len(x) // w)
    x = x[:n * w].reshape(w, n)
    hi, lo = x.max(axis=1), x.min(axis=1)
    im = Image.new('RGB', (w, h), (10, 23, 16))
    d = ImageDraw.Draw(im)
    mid = h // 2
    d.line([(0, mid), (w, mid)], fill=(60, 90, 74))
    for i in range(w):
        y0 = mid - hi[i] * (h * 0.46)
        y1 = mid - lo[i] * (h * 0.46)
        d.line([(i, y1), (i, y0)], fill=(198, 162, 88))
    im.save(out)


def excerpt(src, out, sec=EXCERPT_SEC):
    """试听件：从头裁 sec 秒转 AAC。"""
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(EXCERPT_BR),
                    '-c', '1', src, out], check=True, capture_output=True)


def main():
    raw, cat_p, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    cat = json.load(open(cat_p))
    rows, fails = {}, []
    # ★ 只处理音效：合并后的 catalog 里还有 BGM，别把它们当音效量
    only = [r for r in cat.values() if r.get('cat') in ('tile', 'win', 'lose')]
    order = sorted(only, key=lambda r: (r['cat'], r['id']))
    print(f'  {"cat":<5}{"id":<24}{"时长":>7}{"峰dB":>7}{"RMS":>7}{"crest":>7}'
          f'{"起音ms":>8}{"衰减ms":>8}{"响数":>5}{"首响占比":>9}{"质心Hz":>8}{"95%滚降":>9}')
    for rec in order:
        k = rec['id']
        src = rec['local']
        try:
            a = analyze(src)
            wave_png(src, f'{out}/{k}.png')
            excerpt(src, f'{out}/{k}.m4a')
        except Exception as e:                                   # 解码失败必须报错
            fails.append(f'{k}: {e}')
            continue
        a.update(cat=rec['cat'], title=rec.get('title', ''), kind=rec.get('kind', 'sfx'),
                 note=rec.get('note', ''), official=rec.get('official', ''),
                 tags=rec.get('tags', ''), src=rec.get('src', ''),
                 page=rec.get('page', ''), file=rec.get('file', ''),
                 bytes=os.path.getsize(src))
        rows[k] = a
        print(f'  {a["cat"]:<5}{k:<24}{a["dur"]:>7.2f}{a["peak_dbfs"]:>7.1f}{a["rms_dbfs"]:>7.1f}'
              f'{a["crest_db"]:>7.1f}{a["attack_ms"]:>8.1f}{a["decay_to_-30db_ms"]:>8.0f}'
              f'{a["onsets"]:>5}{a["first_hit_share"]:>9.2f}{a["centroid_hz"]:>8d}'
              f'{a["rolloff95_hz"]:>9d}')
    with open(f'{out}/analysis.json', 'w') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print()
    if fails:
        print(f'  [x] 解码失败 {len(fails)} 条：')
        for x in fails:
            print('      ' + x)
        sys.exit(1)
    print(f'  [v] {len(rows)} 条全部量测成功 → {out}/analysis.json')


if __name__ == '__main__':
    main()
