#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开局页掷骰音效 · 候选定量分析
目的：在没有"耳朵"的条件下，用可复现的声学指标把候选排开——
     时长 / 起音时刻 / 包络形状 / 碰撞脉冲数 / 频谱重心（ZCR 近似）/ 低频占比 / 电平。
输出：proc/audio_metrics.json  +  proc/audio_env.json（包络，供画图与节拍对齐）
"""
import wave, json, os, math
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.abspath(os.path.join(BASE, '..', '..', '..', 'assets', '_src', 'game-start', 'audio-candidates'))
PROC = os.path.join(CAND, 'proc')
HOP_MS = 10.0


def load(path):
    with wave.open(path, 'rb') as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw == 2:
        a = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif sw == 4:
        a = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    else:
        a = np.frombuffer(raw, dtype='<u1').astype(np.float32) / 128.0 - 1.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def envelope(a, sr, hop_ms=HOP_MS):
    h = max(1, int(sr * hop_ms / 1000.0))
    k = len(a) // h
    if k == 0:
        return np.zeros(1, dtype=np.float32)
    seg = a[:k * h].reshape(k, h)
    return np.sqrt((seg ** 2).mean(axis=1)).astype(np.float32)


def zcr(a):
    if len(a) < 2:
        return 0.0
    return float(np.mean(np.abs(np.diff(np.sign(a))) > 0))


def low_ratio(a, sr):
    """低频(≈<1kHz)能量占比：简单移动平均近似低通后再比 RMS。"""
    if len(a) < 64:
        return 0.0
    w = max(2, int(sr / 1000.0))  # ~1kHz 截止
    kern = np.ones(w, dtype=np.float32) / w
    lp = np.convolve(a, kern, mode='same')
    e_all = float(np.sqrt((a ** 2).mean()) + 1e-12)
    e_lp = float(np.sqrt((lp ** 2).mean()))
    return float(min(1.0, e_lp / e_all))


def pulses(env, thr_ratio=0.35):
    """数"碰撞脉冲"：包络过阈值的独立峰（含峰间隔 >2 帧才算独立）。"""
    if len(env) == 0:
        return 0, []
    mx = float(env.max()) + 1e-12
    thr = thr_ratio * mx
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return 0, []
    groups, cur = [], [idx[0]]
    for i in idx[1:]:
        if i - cur[-1] <= 2:
            cur.append(i)
        else:
            groups.append(cur); cur = [i]
    groups.append(cur)
    return len(groups), [int(g[0]) for g in groups]


def main():
    files = sorted(f for f in os.listdir(CAND) if f.lower().endswith('.mp3'))
    metrics, envs = {}, {}
    for f in files:
        wp = os.path.join(PROC, os.path.splitext(f)[0] + '.wav')
        if not os.path.exists(wp):
            print('SKIP（无 wav）', f); continue
        a, sr = load(wp)
        env = envelope(a, sr)
        dur = len(a) / float(sr)
        mx = float(env.max()) + 1e-12
        nz = np.where(env > 0.15 * mx)[0]
        onset = float(nz[0] * HOP_MS) if len(nz) else 0.0
        tail = float((len(env) - 1 - nz[-1]) * HOP_MS) if len(nz) else 0.0
        npl, pidx = pulses(env)
        peak = float(np.abs(a).max())
        rms = float(np.sqrt((a ** 2).mean()))
        metrics[f] = dict(
            dur_s=round(dur, 3), sr=sr, samples=int(len(a)),
            peak=round(peak, 4), rms=round(rms, 4),
            peak_dbfs=round(20 * math.log10(peak + 1e-9), 1),
            rms_dbfs=round(20 * math.log10(rms + 1e-9), 1),
            onset_ms=round(onset, 1), tail_ms=round(tail, 1),
            pulses=npl, pulse_at_ms=pidx[:12],
            zcr=round(zcr(a), 4), low_ratio=round(low_ratio(a, sr), 4),
            env_len=len(env),
        )
        envs[f] = [round(float(v), 4) for v in env]
        print('%-40s dur=%.2fs onset=%.0fms tail=%.0fms pulses=%-3d zcr=%.3f low=%.2f peak=%.1fdB'
              % (f, dur, onset, tail, npl, metrics[f]['zcr'], metrics[f]['low_ratio'], metrics[f]['peak_dbfs']))

    os.makedirs(PROC, exist_ok=True)
    with open(os.path.join(PROC, 'audio_metrics.json'), 'w', encoding='utf-8') as fh:
        json.dump(metrics, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(PROC, 'audio_env.json'), 'w', encoding='utf-8') as fh:
        json.dump(dict(hop_ms=HOP_MS, env=envs), fh, ensure_ascii=False)
    print('\n写出 proc/audio_metrics.json / proc/audio_env.json')


if __name__ == '__main__':
    main()
