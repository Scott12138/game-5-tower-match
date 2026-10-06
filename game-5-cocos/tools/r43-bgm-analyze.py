#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r43-bgm-analyze.py · 第 43 轮：BGM 候选「客观量测 + 试听板素材」
============================================================
【为什么需要它】
用户要「去市面上找 3 条麻将主题 BGM」，但**我没有耳朵**——
不能在无头环境里判断"好不好听"。所以我只做两件我能做到的事：
  ① 把每条候选的**客观特征**量出来（时长/体积/响度/亮度/低频厚度/活跃度/
     节拍），配上游源自己的情绪标签，供人快速形成第一印象；
  ② 把每条候选的**波形缩略图**画出来 —— 结构（有没有前奏/副歌/淡出）
     在波形上一眼可见，比只看时长有用得多。
"好听"与"契合场景"**必须由用户试听拍板**，脚本不做任何审美断言。

【判据纪律】不做"现状即期望"断言：所有数字都是**测量值**，
只有"能不能算出这个数"才判成败（解码失败必须报错，不许静默跳过）。

【用法】
  python3 tools/r43-bgm-analyze.py <候选目录> <输出目录>
============================================================
"""

import json
import os
import shutil
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw

# ------------------------------------------------------------
#  候选清单（标题 / 来源 / 授权 / 游源给的风格标签，均来自下载页原文）
# ------------------------------------------------------------
CATALOG = {
    'ts-kings-tile-draw': dict(
        title='嶺上開花 / King’s Tile Draw', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、**无需署名**、禁止二次分发音乐本体',
        tags='麻将役种命名(岭上开花) · Casino/Mahjong 分类 · 提供 intro/loop/outro 三件套',
        fit='麻将语义最正的一条 —— 曲名就是役种'),
    'ts-kokushi-musou': dict(
        title='国士無双 / Kokushi Musou', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='麻将役种命名(国士无双) · 提供 intro/loop/outro 三件套',
        fit='麻将语义正；名字里带"无双"，气质偏张扬'),
    'ts-jankis-lair': dict(
        title='雀鬼の巣窟 / Janki’s Lair', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='"雀鬼"(麻将狂人) 命名 · 提供 intro/loop；无 outro',
        fit='麻将语义正，但"巣窟"暗示偏阴森，可能不合休闲基调'),
    'ts-second-dealing': dict(
        title='Second Dealing', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Casino/Gambling 分类（赌场感，非麻将命名）',
        fit='赌场爵士味，和"中式玉牌"气质可能错位'),
    'ts-all-in-or-fold': dict(
        title='All-in or Fold', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Casino/Gambling 分类 · 提供 intro/loop/outro',
        fit='扑克语义，非麻将'),
    'ts-hypnotic-poison': dict(
        title='Hypnotic Poison', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Casino/Gambling 分类 · 提供 intro/loop',
        fit='名字带 Hypnotic，多半偏迷幻/悬疑'),
    'ts-trust-me': dict(
        title='Trust Me', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Casino/Gambling 分类 · 提供 intro/loop',
        fit='赌桌心理战气质'),
    'ts-fall-boogie': dict(
        title='Fall Boogie Street', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Casino/Gambling 分类 · intro/loop/outro 齐全',
        fit='Boogie 摇摆，偏西洋街区'),
    'ts-racks-highway': dict(
        title='racks highway', artist='T-STATION (Tスタ)',
        page='https://tnosite.com/en/casino-music-5', src='tnosite.com',
        license='站点自有条款：免费商用、无需署名、禁止二次分发音乐本体',
        tags='Phantom Thief 分类 · 提供 intro/loop',
        fit='怪盗主题，和麻将无关'),
    'pt-folk-chinese': dict(
        title='Folk Chinese', artist='PeriTune',
        page='https://peritune.com/blog/2018/01/14/folk_chinese/', src='peritune.com',
        license='CC BY 4.0（2026-02 前旧曲）· PeriTune 自身条款额外允许**署名可选** · 可商用',
        tags='Asian / Celebration / Chinese / World / Folk / Bright / Holiday',
        fit='中式民乐、明亮节庆 —— 最接近"茶馆里热热闹闹搓牌"的一条'),
    'pt-wuxia2-guzheng-pipa': dict(
        title='Wuxia2 (Guzheng & Pipa)', artist='PeriTune',
        page='https://peritune.com/wuxia2/', src='peritune.com',
        license='CC BY 4.0（2026-02 前旧曲）· 署名可选 · 可商用 · 官方提供 loop 打包',
        tags='Asian / Happy / Chinese / World / Positive / Upbeat · 古筝+琵琶',
        fit='官方给的就是古筝+琵琶，与"玉牌/织锦"视觉取向一致；有 loop 文件'),
    'pt-wuxia2': dict(
        title='Wuxia2 (Orchestra)', artist='PeriTune',
        page='https://peritune.com/wuxia2/', src='peritune.com',
        license='CC BY 4.0（2026-02 前旧曲）· 署名可选 · 可商用',
        tags='Asian / Chinese / World · 管弦乐版（同一主题的另一个配器）',
        fit='同上主题的管弦版，比古筝版更"大气"'),
    'km-shenyang': dict(
        title='Shenyang', artist='Kevin MacLeod',
        page='https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100500',
        src='incompetech.com',
        license='CC BY 4.0 · 可商用 · **必须署名**',
        tags='Kevin MacLeod 中式曲目 · 游源标注 Chinese / World',
        fit='老牌 CC 曲库，授权最稳；旋律偏"北方/苍凉"'),
}


def decode(mp3_path, wav_path, hz=22050):
    """用 macOS 自带 afconvert 解成单声道 16bit WAV（本机没有 ffmpeg）。"""
    subprocess.run(
        ['afconvert', '-f', 'WAVE', '-d', f'LEI16@{hz}', '-c', '1',
         mp3_path, wav_path],
        check=True, capture_output=True,
    )
    with wave.open(wav_path, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    assert ch == 1 and sw == 2, f'解码口径不符：ch={ch} sw={sw}'
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0, rate


def afinfo(path):
    txt = subprocess.run(['afinfo', path], check=True, capture_output=True, text=True).stdout
    import re
    dur = float(re.search(r'estimated duration:\s*([\d.]+)', txt).group(1))
    m = re.search(r'Data format:\s+(\d+) ch,\s+(\d+) Hz', txt)
    return {'dur': dur, 'ch': int(m.group(1)), 'hz': int(m.group(2))}


def frames(x, n, hop):
    """切成 (帧数, n) 的矩阵（末尾不足的丢掉）"""
    k = 1 + (len(x) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(k)[:, None]
    return x[idx]


def analyze(path, hz_target=22050):
    info = afinfo(path)
    x, sr = decode(path, '/tmp/_r43.wav', hz_target)

    n, hop = 1024, 512
    F = frames(x, n, hop)
    win = np.hanning(n).astype(np.float32)
    S = np.abs(np.fft.rfft(F * win, axis=1)) + 1e-9
    freqs = np.fft.rfftfreq(n, 1 / sr)

    rms = np.sqrt((F ** 2).mean(axis=1) + 1e-12)
    rdb = 20 * np.log10(rms + 1e-9)
    # 静音帧（首尾留白）不计入响度统计
    act = rdb > (rdb.max() - 40)

    centroid = float(np.median((S * freqs).sum(1) / S.sum(1)))
    band = S.sum(0)
    tot = band.sum()
    low = float(band[freqs < 250].sum() / tot)
    mid = float(band[(freqs >= 250) & (freqs < 2000)].sum() / tot)
    high = float(band[freqs >= 2000].sum() / tot)

    # 活跃度：能量包络的起伏 + 起音密度
    env = rms / (rms.max() + 1e-9)
    flux = np.maximum(0, np.diff(np.log(rms + 1e-9)))
    onset = flux > (flux.mean() + 1.2 * flux.std())
    # 起音后 120ms 内不重复计（去抖）
    keep = []
    last = -10 ** 9
    for i in np.where(onset)[0]:
        if i - last > max(1, int(0.12 * sr / hop)):
            keep.append(i)
            last = i
    dur_act = float(act.sum() * hop / sr) or 1e-6
    onset_rate = len(keep) / dur_act

    # BPM：起音包络自相关（60~200 拍/分）
    oi = np.zeros(len(rms), dtype=np.float32)
    oi[np.array(keep, dtype=int) if keep else [0]] = 1.0
    oi = np.convolve(oi, np.hanning(9) / 4.5, mode='same')
    oi -= oi.mean()
    if oi.std() > 0:
        ac = np.correlate(oi, oi, 'full')[len(oi) - 1:]
        lo, hi = int(60 / 200 / (hop / sr)), int(60 / 60 / (hop / sr))
        seg = ac[lo:hi]
        bpm = 60 / ((lo + int(np.argmax(seg))) * hop / sr) if len(seg) else 0.0
    else:
        bpm = 0.0

    head, tail = rms[:int(0.25 * sr)], rms[-int(0.25 * sr):]
    return {
        **info,
        'bytes': os.path.getsize(path),
        'rms_dbfs': round(float(20 * np.log10(rms[act].mean() + 1e-9)), 1),
        'peak_dbfs': round(float(20 * np.log10(np.abs(x).max() + 1e-9)), 1),
        'dyn_db': round(float(np.percentile(rdb[act], 95) - np.percentile(rdb[act], 10)), 1),
        'centroid_hz': round(centroid),
        'low_250': round(low, 3), 'mid_250_2k': round(mid, 3), 'high_2k': round(high, 3),
        'onset_rate': round(onset_rate, 2),
        'env_cv': round(float(env[act].std() / (env[act].mean() + 1e-9)), 3),
        'bpm_est': round(bpm),
        'head_tail_db': round(float(20 * np.log10(head.mean() / (tail.mean() + 1e-9))), 1),
    }


def wave_png(path, out_png, w=900, h=150, hz=22050):
    x, sr = decode(path, '/tmp/_r43b.wav', hz)
    n = len(x) // w or 1
    x = x[:n * w].reshape(w, n)
    hi = x.max(axis=1)
    lo = x.min(axis=1)
    im = Image.new('RGB', (w, h), (10, 23, 16))
    d = ImageDraw.Draw(im)
    mid = h // 2
    d.line([(0, mid), (w, mid)], fill=(60, 90, 74))
    for i in range(w):
        y0 = mid - hi[i] * (h * 0.46)
        y1 = mid - lo[i] * (h * 0.46)
        d.line([(i, y1), (i, y0)], fill=(198, 162, 88))
    im.save(out_png)


def main():
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    # ★ 第 44 轮起支持外部目录：catalog.json 里带 title/artist/tags/official/file/page，
    #   优先级高于文件内置的 CATALOG（内置那份只覆盖第 43 轮那 13 条）。
    catalog = dict(CATALOG)
    if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
        catalog.update(json.load(open(sys.argv[3])))
    os.makedirs(out_dir, exist_ok=True)
    rows = {}
    fails = []
    names = sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith('.mp3'))
    print(f'  候选 {len(names)} 条')
    print(f'  {"id":<26}{"时长":>7}{"体积MB":>8}{"响度dB":>8}{"动态dB":>8}'
          f'{"质心Hz":>8}{"低频":>7}{"中频":>7}{"高频":>7}{"起音/s":>8}{"BPM":>6}{"首尾差":>8}')
    for i, key in enumerate(names):
        mp3 = os.path.join(src_dir, key + '.mp3')
        try:
            a = analyze(mp3)
        except Exception as e:                                  # 解码失败必须报错，不许静默
            fails.append(f'{key}: {e}')
            continue
        a['id'] = key
        a.update(catalog.get(key, {}))
        a['png'] = f'{key}.png'
        wave_png(mp3, os.path.join(out_dir, a['png']))
        # 不再把整曲拷进出图目录（第 44 轮 14 条会撑到几十 MB）；试听件另出裁剪版
        rows[key] = a
        print(f'  {key:<26}{a["dur"]:>7.1f}{a["bytes"]/1048576:>8.2f}{a["rms_dbfs"]:>8.1f}'
              f'{a["dyn_db"]:>8.1f}{a["centroid_hz"]:>8d}{a["low_250"]:>7.3f}'
              f'{a["mid_250_2k"]:>7.3f}{a["high_2k"]:>7.3f}{a["onset_rate"]:>8.2f}'
              f'{a["bpm_est"]:>6d}{a["head_tail_db"]:>8.1f}')
    with open(os.path.join(out_dir, 'analysis.json'), 'w') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print()
    if fails:
        print(f'  [x] 解码失败 {len(fails)} 条：')
        for x in fails:
            print('      ' + x)
        sys.exit(1)
    print(f'  [v] {len(rows)} 条全部量测成功 → {out_dir}/analysis.json')


if __name__ == '__main__':
    main()
