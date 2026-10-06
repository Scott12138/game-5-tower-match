#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成"开局页掷骰音效 · 候选试听页"（根目录 HTML，音频走 assets/_src 相对路径）。
指标与包络数据从 proc/audio_metrics.json + proc/audio_env.json 内嵌，不手抄。
输出：<项目根>/game-5-开局页-音效候选.html
"""
import base64, json, os

BASE = os.path.dirname(os.path.abspath(__file__))                 # docs-verify/game-5/game-start
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
CAND = os.path.join(ROOT, 'assets', '_src', 'game-start', 'audio-candidates')
PROC = os.path.join(CAND, 'proc')
OUT = os.path.join(ROOT, 'game-5-开局页-音效候选.html')

m = json.load(open(os.path.join(PROC, 'audio_metrics.json'), encoding='utf-8'))
e = json.load(open(os.path.join(PROC, 'audio_env.json'), encoding='utf-8'))
hop = e['hop_ms']
envs = e['env']

NOTE = {
    'チンチロ_サイコロを振る_小丼_その１.mp3': ('小碗内掷骰 · 碰撞密集', '骰子在碗/盘内连续弹跳，硬质撞击感'),
    'チンチロ_サイコロを振る_小丼_その２.mp3': ('小碗内掷骰 · 碰撞最密最脆', '碰撞次数最多、低频占比最低 → 最"脆"'),
    'チンチロ_サイコロを振る_小丼_その３.mp3': ('小碗内掷骰 · 尾音最长', '滚动尾部拖得更长，落定感更缓'),
    'サイコロを振る・二個.mp3': ('两颗骰同摇 · 碰撞多', '两颗骰一起摇，粒度与"双骰"设定一致'),
    'サイコロ二個を振る_その３.mp3': ('两颗骰 · 偏闷', '低频占比 0.24，撞击被包住，不够清脆'),
    'サイコロ二個を振る_その２.mp3': ('两颗骰 · 偏闷', '低频占比 0.28，闷'),
    'サイコロ二個を振る_その１.mp3': ('两颗骰 · 低频最厚（最闷）', '低频占比 0.38，像在布面/手里滚'),
    '麻雀牌.mp3': ('麻将牌单击 · 可作"落定"声', '0.31s 单次撞击，可叠在末段做落定'),
}
rank = sorted(m.keys(), key=lambda k: (-(m[k]['pulses']), m[k]['low_ratio']))
rec = {k: i + 1 for i, k in enumerate(rank)}

items = []
for name in sorted(m.keys(), key=lambda k: rec[k]):
    md = m[name]
    t, desc = NOTE.get(name, ('', ''))
    b64 = base64.b64encode(open(os.path.join(CAND, name), 'rb').read()).decode('ascii')
    items.append({
        'rank': rec[name], 'file': name, 'label': name.replace('.mp3', ''),
        'note': t, 'desc': desc, 'top': rec[name] <= 3,
        'pulses': md['pulses'], 'dur': round(md['dur_s'], 2), 'onset': round(md['onset_ms']),
        'low': round(md['low_ratio'], 2), 'zcr': round(md['zcr'], 3),
        'src': 'data:audio/mpeg;base64,' + b64,
        'env': [round(v, 4) for v in envs[name][:720]],
    })

DATA = json.dumps({'hop': hop, 'items': items}, ensure_ascii=False)

HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开局页掷骰音效 · 候选试听</title>
<style>
  :root{
    --bg:#0B0F0C; --panel:#131813; --panel2:#171D18; --line:#26302A;
    --gold:#F6C445; --gold-hi:#FFE08A; --cream:#E8EEE7; --dim:#B0BEB2;
    --mute:#78867A; --teal:#8FE3C5; --red:#FF8A7A;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--cream);
       font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
       -webkit-font-smoothing:antialiased}
  .wrap{max-width:1240px;margin:0 auto;padding:34px 26px 70px}
  h1{margin:0 0 6px;font-size:30px;letter-spacing:.5px;color:var(--gold-hi)}
  .sub{color:var(--dim);font-size:15px;line-height:1.7}
  .sub b{color:var(--gold)}
  .beats{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 26px}
  .beat{background:var(--panel);border:1px solid var(--line);border-radius:10px;
        padding:9px 14px;font-size:13.5px;color:var(--dim)}
  .beat b{color:var(--gold-hi);font-variant-numeric:tabular-nums}
  .row{display:grid;grid-template-columns:52px 296px 1fr 138px;gap:18px;align-items:center;
       background:var(--panel);border:1px solid var(--line);border-radius:14px;
       padding:16px 18px;margin-bottom:12px;cursor:pointer;transition:.16s}
  .row:hover{background:var(--panel2);border-color:#3A473D}
  .row.top{border-color:#5A4A18;background:linear-gradient(90deg,#1A1B10,#131813 42%)}
  .row.playing{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
  .rk{font-size:26px;font-weight:700;color:var(--mute);text-align:center;font-variant-numeric:tabular-nums}
  .row.top .rk{color:var(--gold-hi)}
  .nm{font-size:16.5px;font-weight:600;margin-bottom:4px}
  .row.top .nm{color:var(--gold-hi)}
  .nt{font-size:13.5px;color:var(--teal);margin-bottom:3px}
  .ds{font-size:12.5px;color:var(--mute);line-height:1.5}
  canvas{width:100%;height:66px;display:block;border-radius:8px;background:#0D110E}
  .mt{text-align:right;font-size:12.5px;color:var(--mute);line-height:1.75;font-variant-numeric:tabular-nums}
  .mt b{color:var(--dim)}
  .bar{display:flex;gap:12px;align-items:center;margin:26px 0 20px;flex-wrap:wrap}
  button{background:var(--panel);color:var(--gold-hi);border:1px solid #5A4A18;border-radius:10px;
         padding:11px 20px;font-size:14.5px;font-family:inherit;cursor:pointer;transition:.16s}
  button:hover{background:#1E1F12;border-color:var(--gold)}
  button.gh{color:var(--dim);border-color:var(--line)}
  button.gh:hover{color:var(--cream);border-color:#3A473D}
  .lg{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;
      margin-top:26px;font-size:13.5px;color:var(--dim);line-height:1.9}
  .lg h3{margin:0 0 8px;font-size:15px;color:var(--gold)}
  .lg code{background:#0D110E;padding:1px 6px;border-radius:5px;color:var(--teal);font-size:12.5px}
  .tip{color:var(--mute);font-size:13px;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>开局页掷骰音效 · 候选试听</h1>
  <div class="sub">
    来源：<b>tnosite（みんなの創作支援サイト T-STUDIO）</b> 桌游 / 麻将 / 赌场 免费音效库 ·
    <b>声明可免费下载、可用于商业用途</b>（商用前请再核对一次使用条款）。<br>
    全部为真实录音，非合成。本页仅做候选比对，<b>未嵌入动图</b>；你拍板后才做裁切 / 对齐 / 嵌入。
  </div>

  <div class="beats">
    <div class="beat">动画总长 <b>1200 ms</b></div>
    <div class="beat">按钮反馈静止 <b>0–70 ms</b></div>
    <div class="beat">骰子旋转段 <b>70–740 ms</b></div>
    <div class="beat">落定衰减 <b>740–1150 ms</b></div>
    <div class="beat">骰子淡出 <b>1020–1170 ms</b></div>
  </div>
  <div class="tip">点任意一行即可试听；波形上的金色竖线 = 上面的动画节拍，用来判断"密集碰撞段"能否落在 70–740 ms 的旋转段内。</div>

  <div class="bar">
    <button id="playAll">▶ 依次试听全部</button>
    <button id="stopAll" class="gh">■ 停止</button>
  </div>

  <div id="list" style="margin-top:4px"></div>

  <div class="lg">
    <h3>挑选口径（没有"耳朵"时的定量依据）</h3>
    · <b>碰撞次数</b>：包络过阈值的独立脉冲数 —— 越多越像"骰子在盘内连续弹跳"。<br>
    · <b>低频占比</b>：&lt;1kHz 能量占比 —— 越低说明高频越丰富，撞击越"脆"（密胺/塑料硬质）；越高越闷（像在布面或手里滚）。<br>
    · <b>ZCR</b>：过零率 —— 越高说明波形变化越快，听感越"沙"。<br>
    · 排序 = 碰撞次数 ↓ → 低频占比 ↑。三个指标都指向同一结论，但仍<b>必须以你的试听为准</b>。
    <div class="tip">文件：<code>assets/_src/game-start/audio-candidates/*.mp3</code> · 指标：<code>proc/audio_metrics.json</code></div>
  </div>
</div>
<script>
const D = __DATA__;
const BEATS = [70, 740, 1150, 1200];
const list = document.getElementById('list');
const audios = [];

function drawWave(cv, env, top){
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr,0,0,dpr,0,0);
  c.clearRect(0,0,w,h);
  const mx = Math.max(...env) || 1;
  const TMAX = 3600;
  const X = t => (Math.min(t,TMAX)/TMAX)*w;
  // 节拍竖线
  c.strokeStyle = '#4A4118';
  BEATS.forEach(b=>{ c.beginPath(); c.moveTo(X(b),0); c.lineTo(X(b),h); c.stroke(); });
  c.strokeStyle = '#2A352C'; c.strokeRect(X(70)+0.5,0.5,X(1150)-X(70),h-1);
  // 包络
  const base = h-4, amp = (h-8) * 0.95;
  c.beginPath();
  env.forEach((v,i)=>{ const x=X(i*D.hop), y=base-(v/mx)*amp;
    i? c.lineTo(x,y) : c.moveTo(x,y); });
  c.strokeStyle = top ? '#F6C445' : '#6E8A72';
  c.lineWidth = top ? 2 : 1.4; c.stroke();
}

D.items.forEach(it=>{
  const row = document.createElement('div');
  row.className = 'row' + (it.top ? ' top' : '');
  row.innerHTML = `
    <div class="rk">#${it.rank}</div>
    <div>
      <div class="nm">${it.label}</div>
      <div class="nt">${it.note}</div>
      <div class="ds">${it.desc}</div>
    </div>
    <canvas></canvas>
    <div class="mt">
      <b>碰撞</b> ${it.pulses} 次<br>
      <b>时长</b> ${it.dur}s<br>
      <b>低频</b> ${it.low} · <b>ZCR</b> ${it.zcr}
    </div>`;
  const cv = row.querySelector('canvas');
  list.appendChild(row);
  requestAnimationFrame(()=> drawWave(cv, it.env, it.top));
  window.addEventListener('resize', ()=> drawWave(cv, it.env, it.top));

  const a = new Audio(it.src);
  a.preload = 'auto';
  audios.push({a, row});
  const play = ()=>{ stopAll(); a.currentTime = 0; a.play(); row.classList.add('playing'); };
  row.addEventListener('click', play);
  a.addEventListener('ended', ()=> row.classList.remove('playing'));
});

window.__au = audios;   // 调试/自检接口：__au.map(o=>o.a.currentTime)

function stopAll(){ audios.forEach(o=>{ o.a.pause(); o.row.classList.remove('playing'); }); }
document.getElementById('stopAll').addEventListener('click', e=>{ e.stopPropagation(); stopAll(); });
document.getElementById('playAll').addEventListener('click', e=>{
  e.stopPropagation(); stopAll();
  let i = 0;
  const next = ()=>{
    if(i >= audios.length) return;
    const {a,row} = audios[i++];
    a.currentTime = 0; a.play(); row.classList.add('playing');
    a.onended = ()=>{ row.classList.remove('playing'); setTimeout(next, 420); };
  };
  next();
});
</script>
</body>
</html>
'''

open(OUT, 'w', encoding='utf-8').write(HTML.replace('__DATA__', DATA))
print('写出', OUT, os.path.getsize(OUT), 'B')
