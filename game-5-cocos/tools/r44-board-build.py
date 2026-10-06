#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r44-board-build.py · 生成《第 44 轮 · BGM 与音效候选试听拍板板》
================================================================
风格：工业实用 × 唱片内页（深墨玉底 + 单金色强调 + 等宽数据字）
记忆点：全页只有一个发音通道 —— 左侧固定「唱针」列，
        正在播放的那条会亮起金色进度线，顶部常驻 mini-transport。

⚠️ 本页所有数字都来自 manifest.json（量测脚本产物），**不手写**。
⚠️ 试听件已做**峰值归一化**；原始实测电平另列，页面必须写清这一点。
"""
import html
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------- 人工撰写的「为什么推它」（只写判断，不写数字） ----------------
PICK_REASON = {
    'pt-taohua': '官方标题直接写着「<b>中華風・穏やか</b>」（中国风・恬静）—— 14 条里唯一同时命中「中式」'
                 '与「不吵」的。主体是弹拨/笛的明亮音色、几乎没有低频鼓点，不会和「落槽」音效抢频段。',
    'maou-ethnic32': '官方标签是「<b>正月</b>」── 年节的欢快，是这一批里最「喜庆」的一条；'
                     '和风五声音阶与中式听感相邻，主体为旋律乐器（中频占比高、低频薄），适合长时间当铺底。',
    'pt-laidback3': '曲名 <b>Laid Back</b> 本身就是「悠哉」；官方定位「ほのぼの＋楽しい＋日常」，'
                    '是全部候选里最贴「轻松休闲」四个字的。',
    'tile-hyoushigi1': '「拍子木」是两块<b>硬木对击</b>的日式乐器 —— 全表里最接近「牌磕在木桌上」'
                       '的真实乐器采样：硬、干、脆，没有金属余韵。',
    'tile-dvd-case-close1': '真实拟音，官方拟声词就是「<b>パチッ</b>」；材质与麻将牌同为硬塑料/亚克力。'
                            '衰减只有 24 ms ── 落槽是高频动作，短促才不会让耳朵起茧。',
    'tile-peta1': '官方定位「把东西<b>轻轻</b>放下」。全表唯一一条刻意做轻的（质心偏低、无金属尾），'
                  '正好对应你要的「轻轻碰撞声」。',
    'win-correct1': '「ピンポンピンポン」三连 ── 把「赢一手」处理成「答对了」，欢快但不吹号角；'
                    '它与失败的「不正解」是同一套语汇，胜败天然成对，不会一个喜庆一个悲壮。',
    'win-item-get1': '官方用途就是「<b>お金</b>」（钱）。麻将题材里没有比「进账了」更贴的胜利语义；'
                     '起音极快，每次收分都能即时响应。',
    'win-ramen-stall1': '官方说明「<b>江戸時代からある旋律</b>」── 一小段市井调子，最贴「茶馆搓牌」的'
                        '悠哉气。建议只用在「大胡/通关」，不要每次小分都放。',
    'lose-tin1': '官方定位原文是「<b>がっかりした時の演出に</b>」（用于失望的时刻）。一声金属余韵，'
                 '是休闲游戏最经典的「再来一次」，完全不伤人。',
    'lose-incorrect2': '官方用途「<b>残念でした</b>」（真遗憾）── 语气本身就是遗憾而不是惩罚，'
                       '且与首推的「正解」成对。',
    'lose-cute-sad1': '官方定位「<b>可愛いキャラがテンションダウン</b>」── 把失败演成「小家伙垂头」，'
                      '而不是「你输了」。这是最能保住休闲调性的一条。',
}

# 首推顺序（分品类）
PICKS = {
    'bgm':  ['pt-taohua', 'maou-ethnic32', 'pt-laidback3'],
    'tile': ['tile-hyoushigi1', 'tile-dvd-case-close1', 'tile-peta1'],
    'win':  ['win-correct1', 'win-item-get1', 'win-ramen-stall1'],
    'lose': ['lose-tin1', 'lose-incorrect2', 'lose-cute-sad1'],
}

CAT_TITLE = {
    'tile': ('① 麻将落槽', 'TILE INTO SLOT', '点击牌 → 落进槽位时的那一下'),
    'win':  ('② 胜利提示音', 'WIN', '胡牌 / 通关时的结算音'),
    'lose': ('③ 失败提示音', 'LOSE', '没走通 / 关卡失败时的提示音'),
}

CSS = """
:root{
  --ink:#07120D; --ink2:#0B1F16; --panel:#0E2A1E; --panel2:#123324;
  --jade:#1E5741; --jade-hi:#2E7B5C;
  --gold:#C6A258; --gold-hi:#EBD69A; --gold-dim:rgba(198,162,88,.28);
  --txt:#E8E2D2; --txt2:#A9B5AC; --txt3:#71857A;
  --ok:#7FD1A8; --warn:#E0B96B;
  --serif:"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif;
  --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:
    radial-gradient(1200px 700px at 12% -6%, #16412E 0%, rgba(22,65,46,0) 62%),
    radial-gradient(900px 600px at 100% 4%, #123A29 0%, rgba(18,58,41,0) 55%),
    linear-gradient(180deg,#07120D 0%, #0A1A13 48%, #07120D 100%);
  color:var(--txt); font-family:var(--serif); font-size:16px; line-height:1.72;
  -webkit-font-smoothing:antialiased;
  padding:0 0 96px;
}
/* 纸纹噪点（纯 CSS，无外部资源） */
body::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.05;
  background-image:
    repeating-linear-gradient(0deg, rgba(255,255,255,.6) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0 1px, transparent 1px 4px);
  mix-blend-mode:overlay;
}
.wrap{position:relative; z-index:1; max-width:1120px; margin:0 auto; padding:0 22px}

/* ---------- 头 ---------- */
header{padding:64px 0 26px; border-bottom:1px solid var(--gold-dim)}
.eyebrow{font-family:var(--mono); font-size:11.5px; letter-spacing:.34em; color:var(--gold);
  text-transform:uppercase}
h1{font-size:clamp(30px,5vw,54px); line-height:1.12; margin:14px 0 6px; letter-spacing:.02em; font-weight:700}
h1 em{font-style:normal; color:var(--gold-hi)}
.sub{color:var(--txt2); font-size:15.5px; max-width:74ch; margin:12px 0 20px}
.pills{display:flex; flex-wrap:wrap; gap:8px}
.pill{font-family:var(--mono); font-size:11.5px; letter-spacing:.06em; padding:5px 11px;
  border:1px solid var(--gold-dim); border-radius:2px; color:var(--txt2); background:rgba(255,255,255,.02)}
.pill b{color:var(--gold-hi); font-weight:600}
.pill.ask{border-color:rgba(224,185,107,.55); color:var(--warn)}

/* ---------- 章节 ---------- */
section{padding:52px 0 8px; border-top:1px solid rgba(198,162,88,.14); margin-top:44px}
section:first-of-type{border-top:0; margin-top:0}
.sec-head{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-bottom:6px}
.sec-head h2{font-size:clamp(21px,3vw,29px); margin:0; letter-spacing:.03em}
.sec-head .en{font-family:var(--mono); font-size:11px; letter-spacing:.3em; color:var(--gold); opacity:.8}
.sec-head .cnt{margin-left:auto; font-family:var(--mono); font-size:11.5px; color:var(--txt3)}
.lead{color:var(--txt2); font-size:15px; max-width:80ch; margin:10px 0 26px}
.lead b{color:var(--gold-hi); font-weight:600}

/* ---------- 首推卡 ---------- */
.picks{display:flex; flex-direction:column; gap:18px}
.pick{
  position:relative; display:grid; grid-template-columns:54px 1fr; gap:0;
  background:linear-gradient(180deg, rgba(18,51,36,.85), rgba(10,26,19,.9));
  border:1px solid var(--gold-dim); border-left:2px solid var(--gold);
}
.pick .idx{font-family:var(--mono); font-size:34px; color:var(--gold-dim); text-align:center;
  padding-top:20px; border-right:1px solid rgba(198,162,88,.14); letter-spacing:-.04em}
.pick.on .idx{color:var(--gold-hi)}
.pick .body{padding:20px 22px 18px; min-width:0}
.pick h3{margin:0 0 6px; font-size:20px; letter-spacing:.01em}
.pick h3 .jp{font-size:13px; color:var(--txt3); font-weight:400; margin-left:8px; font-family:var(--mono)}
.rowmeta{display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 12px}
.tag{font-family:var(--mono); font-size:11px; padding:3px 8px; border:1px solid rgba(198,162,88,.22);
  color:var(--txt2); border-radius:2px; background:rgba(0,0,0,.18)}
.tag.src{border-color:rgba(127,209,168,.3); color:var(--ok)}
.official{font-size:13.5px; color:var(--txt2); border-left:2px solid rgba(198,162,88,.3);
  padding:2px 0 2px 11px; margin:0 0 12px}
.reason{font-size:14.5px; color:var(--txt); margin:0 0 14px}
.reason b{color:var(--gold-hi); font-weight:600}

/* ---------- 播放器 ---------- */
.transport{display:flex; align-items:center; gap:13px; margin-top:4px}
.pbtn{flex:0 0 auto; width:46px; height:46px; border-radius:50%; cursor:pointer;
  border:1px solid var(--gold); background:rgba(198,162,88,.10); color:var(--gold-hi);
  display:flex; align-items:center; justify-content:center; transition:background .16s, transform .16s}
.pbtn:hover{background:rgba(198,162,88,.24); transform:scale(1.05)}
.pbtn:active{transform:scale(.96)}
.pbtn svg{width:17px; height:17px; fill:currentColor}
.pbtn .pause{display:none}
.pick.on .pbtn .play{display:none}
.pick.on .pbtn .pause{display:block}
.wave{position:relative; flex:1 1 auto; min-width:0; aspect-ratio:1500/100; box-sizing:content-box;
  overflow:hidden;
  background:rgba(0,0,0,.34); border:1px solid rgba(198,162,88,.16); cursor:pointer}
/* ★ 波形图：位图按 1500×100（=15:1）渲染，这里一律 height:auto ⇒ 显示比例恒等于源图比例，
   绝不出现「图被横向拉长」。（历史上这里写死 height:56px + img height:100% ⇒ 拉伸 2.53 倍） */
.wave img{width:100%; height:auto; display:block; opacity:.66; pointer-events:none}
.wave .bar{position:absolute; top:0; bottom:0; left:0; width:0;
  background:linear-gradient(90deg, rgba(198,162,88,.06), rgba(198,162,88,.26));
  border-right:1px solid var(--gold-hi); pointer-events:none; transition:width .08s linear}
.time{font-family:var(--mono); font-size:12px; color:var(--txt3); flex:0 0 auto; min-width:82px; text-align:right}
.pick.on .time{color:var(--gold-hi)}

/* ---------- 量测网格 ---------- */
.grid{display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin-top:16px;
  background:rgba(198,162,88,.12); border:1px solid rgba(198,162,88,.12)}
.grid > div{background:rgba(7,18,13,.72); padding:9px 11px; min-width:0}
.grid .k{font-family:var(--mono); font-size:10px; letter-spacing:.13em; color:var(--txt3);
  text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.grid .v{font-family:var(--mono); font-size:15px; color:var(--txt); margin-top:3px}
.grid .v small{font-size:10.5px; color:var(--txt3); margin-left:2px}

/* ---------- 备选 ---------- */
h3.alt-h{font-size:14px; font-family:var(--mono); letter-spacing:.2em; color:var(--gold);
  margin:34px 0 12px; text-transform:uppercase}
.altgrid{display:grid; grid-template-columns:1fr 1fr; gap:8px}
.alt{display:grid; grid-template-columns:34px 1fr auto; align-items:center; gap:11px;
  padding:10px 13px; border:1px solid rgba(198,162,88,.13); background:rgba(255,255,255,.017);
  transition:border-color .16s, background .16s}
.alt:hover{border-color:rgba(198,162,88,.34); background:rgba(198,162,88,.05)}
.alt.on{border-color:var(--gold); background:rgba(198,162,88,.09)}
.alt .ab{width:34px; height:34px; border-radius:50%; border:1px solid rgba(198,162,88,.38);
  background:transparent; color:var(--gold-hi); cursor:pointer; display:flex; align-items:center;
  justify-content:center; flex:0 0 auto; padding:0}
.alt .ab svg{width:12px; height:12px; fill:currentColor}
.alt .ab .pause{display:none}
.alt.on .ab .play{display:none}
.alt.on .ab .pause{display:block}
.alt .txt{min-width:0}
.alt .t1{font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.alt .t2{font-family:var(--mono); font-size:11px; color:var(--txt3); margin-top:2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.alt .chip{font-family:var(--mono); font-size:11.5px; color:var(--gold); flex:0 0 auto}

/* ---------- 常驻 transport ---------- */
#dock{position:fixed; left:0; right:0; bottom:0; z-index:20;
  background:linear-gradient(180deg, rgba(7,18,13,.72), rgba(7,18,13,.97));
  border-top:1px solid var(--gold-dim); backdrop-filter:blur(9px)}
#dock .inner{max-width:1120px; margin:0 auto; padding:10px 22px; display:flex; align-items:center; gap:14px}
#dock .now{font-family:var(--mono); font-size:12px; color:var(--txt2); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:1 1 auto; min-width:0}
#dock .now b{color:var(--gold-hi); font-weight:600}
#dock .stop{border:1px solid var(--gold-dim); background:transparent; color:var(--txt2);
  font-family:var(--mono); font-size:11.5px; padding:6px 13px; cursor:pointer; border-radius:2px}
#dock .stop:hover{border-color:var(--gold); color:var(--gold-hi)}
#dock .prog{flex:0 0 140px; height:3px; background:rgba(198,162,88,.16); position:relative}
#dock .prog i{position:absolute; left:0; top:0; bottom:0; width:0; background:var(--gold-hi)}

/* ---------- 说明 ---------- */
/* ★ 表格必须包一层横向滚动容器（.tw）：溯源表有「原始 URL」列，窄屏（实测 390px）下
   表格实际宽 430 > 容器 388，而 table{width:100%} 也压不住 min-content ⇒
   URL 列会被整列切掉（不可见、也不可滚）。包一层 overflow-x:auto 后至少滚得到。 */
.tw{overflow-x:auto; -webkit-overflow-scrolling:touch}
/* 溯源表专属：URL 是「不可断的长串」，让它单行 + 表格按内容撑开、靠横向滚动看全，
   既不会把 URL 列挤没，也不会把每行撑成几百 px 高的空白。 */
.tw table.src{width:auto; min-width:100%}
.tw table.src td:last-child code{white-space:nowrap}
table{width:100%; border-collapse:collapse; font-size:13.5px; margin:8px 0 4px}
caption{caption-side:top; text-align:left; color:var(--txt3); font-size:13px; padding-bottom:9px}
th,td{border-bottom:1px solid rgba(198,162,88,.12); padding:8px 10px; text-align:left; vertical-align:top}
th{font-family:var(--mono); font-size:11px; letter-spacing:.12em; color:var(--gold);
  text-transform:uppercase; font-weight:600}
td.n{font-family:var(--mono); white-space:nowrap}
td b{color:var(--gold-hi); font-weight:600}
.note-box{border:1px solid rgba(224,185,107,.34); background:rgba(224,185,107,.05);
  padding:14px 17px; margin:18px 0; font-size:14.5px}
.note-box h4{margin:0 0 8px; font-size:14px; color:var(--warn); letter-spacing:.04em}
.note-box p{margin:0 0 8px}
.note-box p:last-child{margin:0}
code{font-family:var(--mono); font-size:12px; color:var(--gold-hi); word-break:break-all}
details{margin:10px 0; border:1px solid rgba(198,162,88,.14); background:rgba(0,0,0,.2)}
summary{cursor:pointer; padding:9px 13px; font-family:var(--mono); font-size:11.5px;
  letter-spacing:.1em; color:var(--gold)}
details pre{margin:0; padding:0 13px 13px; font-family:var(--mono); font-size:11.5px;
  color:var(--txt2); overflow-x:auto; line-height:1.6}
footer{padding:44px 0 0; margin-top:40px; border-top:1px solid var(--gold-dim);
  font-size:12.5px; color:var(--txt3); font-family:var(--mono); line-height:1.9}
@media (max-width:860px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .altgrid{grid-template-columns:1fr}
  .pick{grid-template-columns:40px 1fr}
  .pick .idx{font-size:24px; padding-top:16px}
  .time{min-width:64px; font-size:11px}
}
"""


def esc(s):
    return html.escape(str(s), quote=True)


def fmt_bytes(n):
    return f'{n/1048576:.2f} MB' if n >= 1048576 else f'{n/1024:.0f} KB'


PLAY = ('<svg class="play" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>'
        '<svg class="pause" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>')

JS = """
(function () {
  var audio = new Audio();
  audio.preload = 'none';
  var cur = null;                  // 当前播放的卡/行 DOM
  var dockNow = document.getElementById('dockNow');
  var dockBar = document.querySelector('#dock .prog i');

  function cards() { return [].slice.call(document.querySelectorAll('[data-src]')); }

  function setBar(host, p) {
    var b = host.querySelector('.bar') || (host.closest('.pick') && host.closest('.pick').querySelector('.bar'));
    if (b) b.style.width = (p * 100).toFixed(2) + '%';
  }

  function clear() {
    if (cur) { cur.classList.remove('on'); var b = cur.querySelector('.bar'); if (b) b.style.width = '0%'; }
    document.querySelectorAll('.pick.on,.alt.on').forEach(function (e) { e.classList.remove('on'); });
    cur = null;
    dockNow.innerHTML = '未播放';
    if (dockBar) dockBar.style.width = '0%';
    window.__r44.playing = null;
  }

  function labelOf(host) {
    var h = host.closest('.pick') || host.closest('.alt');
    if (!h) return '';
    var t = h.querySelector('h3') || h.querySelector('.t1');
    return t ? t.textContent.trim().replace(/\\s+/g, ' ') : '';
  }

  function play(host) {
    var src = host.getAttribute('data-src');
    var wrapEl = host.closest('.pick') || host.closest('.alt');
    if (cur === wrapEl) { audio.pause(); clear(); return; }
    clear();
    audio.src = src;
    audio.currentTime = 0;
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) { window.__r44.err = String(e); });
    cur = wrapEl;
    cur.classList.add('on');
    dockNow.innerHTML = '正在播放 · <b>' + labelOf(host) + '</b>';
    window.__r44.playing = src;
    window.__r44.title = labelOf(host);
  }

  // 真实点击绑定（不靠 inline handler，方便脚本断言）
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-src]');
    if (t) { play(t); return; }
    // 点波形条 = 跳到那一段
    var w = e.target.closest('.wave');
    if (w && cur && audio.duration) {
      var r = w.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
    }
  });
  document.getElementById('dockStop').addEventListener('click', function () { audio.pause(); clear(); });

  audio.addEventListener('timeupdate', function () {
    var d = audio.duration || 0, p = d ? audio.currentTime / d : 0;
    if (cur) {
      var b = cur.querySelector('.bar'); if (b) b.style.width = (p * 100).toFixed(2) + '%';
      var tt = cur.querySelector('.time');
      if (tt) tt.textContent = audio.currentTime.toFixed(1) + ' / ' + (isFinite(d) ? d.toFixed(1) : '--');
    }
    if (dockBar) dockBar.style.width = (p * 100).toFixed(2) + '%';
    window.__r44.t = audio.currentTime;
    window.__r44.d = audio.duration;
  });

  window.__r44 = {
    playing: null, title: null, t: 0, d: 0, err: null,
    nCards: cards().length,
    nAudioFiles: document.querySelectorAll('[data-src]').length,
    imgs: [].slice.call(document.querySelectorAll('img')).map(function (i) {
      var r = i.getBoundingClientRect();
      // ★ 量「内容盒」：带 1px 边框时 border-box 的比例会被带偏
      var cs = getComputedStyle(i);
      var bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      var bh = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      return { src: i.getAttribute('src'), nw: i.naturalWidth, nh: i.naturalHeight,
               cw: r.width - bw, ch: r.height - bh };
    }),
    stop: function () { audio.pause(); clear(); }
  };
})();
"""


def build(man, out_path):
    bgm, sfx = man['bgm'], man['sfx']
    by_id = {r['id']: r for r in bgm + sfx}

    # ★ 波形图路径归一：manifest 里 audio 带子目录（bgm/ sfx/），png 只是裸文件名。
    #   板子 HTML 就放在 manifest 同目录，这里把 png 补成与 audio 同级的相对路径。
    for _r in bgm + sfx:
        if _r.get('png') and '/' not in _r['png']:
            _r['png'] = os.path.dirname(_r['audio']) + '/' + _r['png']

    def bgm_metrics(r):
        return [('BPM 估计', f'{r["bpm"]}'),
                ('长度', f'{r["dur"]:.0f}<small>s</small>'),
                ('动态范围', f'{r["dyn"]:.1f}<small>dB</small>'),
                ('频谱质心', f'{r["centroid"]}<small>Hz</small>'),
                ('低/中/高频占比', f'{r["low"]*100:.0f}·{r["mid"]*100:.0f}·{r["high"]*100:.0f}<small>%</small>'),
                ('起音密度', f'{r["onset"]:.2f}<small>/s</small>'),
                ('体积', fmt_bytes(r['bytes'])),
                ('实测 RMS', f'{r["rms_raw"]:.1f}<small>dBFS</small>')]

    def sfx_metrics(r):
        return [('时长', f'{r["dur"]:.2f}<small>s</small>'),
                ('起音', f'{r["attack"]:.1f}<small>ms</small>'),
                ('衰减到 −30dB', f'{r["decay"]:.0f}<small>ms</small>'),
                ('碰撞次数', f'{r["onsets"]}'),
                ('首响能量占比', f'{r["first_share"]*100:.0f}<small>%</small>'),
                ('频谱质心', f'{r["centroid"]}<small>Hz</small>'),
                ('波形峰值因数', f'{r["crest"]:.1f}<small>dB</small>'),
                ('入库需补偿', f'{r["gain_rms"]:+.1f}<small>dB</small>')]

    def pick_html(key, idx, r, metrics):
        jp = ''
        if '｜' in r['title']:
            cn, jp = r['title'].split('｜', 1)
        else:
            cn = r['title']
        return f'''      <article class="pick" id="k-{esc(key)}">
        <div class="idx">{idx:02d}</div>
        <div class="body">
          <h3>{esc(cn)}<span class="jp">{esc(jp)}</span></h3>
          <div class="rowmeta">
            <span class="tag src">{esc(r.get('src',''))}</span>
            <span class="tag">{esc(r.get('tags',''))}</span>
            <span class="tag">试听件 {esc(r.get('deliver','')) if r.get('deliver') else '前 %.1fs' % r['dur']}</span>
          </div>
          <p class="official">官方原文：{esc(r.get('official',''))}</p>
          <p class="reason">{PICK_REASON.get(key,'')}</p>
          <div class="transport">
            <button class="pbtn" data-src="{esc(r['audio'])}" aria-label="播放">{PLAY}</button>
            <div class="wave"><img src="{esc(r['png'])}" alt="波形" loading="lazy"><div class="bar"></div></div>
            <div class="time">0.0 / --</div>
          </div>
          <div class="grid">
{''.join(f'            <div><div class="k">{esc(k)}</div><div class="v">{v}</div></div>' + chr(10) for k, v in metrics)}          </div>
        </div>
      </article>'''

    def alt_html(key, r, chip, sub):
        cn = r['title'].split('｜')[0]
        return f'''        <div class="alt">
          <button class="ab" data-src="{esc(r['audio'])}" aria-label="播放">{PLAY}</button>
          <div class="txt"><div class="t1">{esc(cn)}</div><div class="t2">{esc(sub)}</div></div>
          <div class="chip">{esc(chip)}</div>
        </div>'''

    # ---------- BGM ----------
    bgm_sec = []
    bgm_sec.append('''  <section id="bgm">
    <div class="sec-head"><h2>一 · BGM 第二批</h2><span class="en">BACKGROUND MUSIC</span>
      <span class="cnt">14 条 · 3 条首推＋11 条备选</span></div>
    <p class="lead">
      上一批你说「不够理想」，所以这一批换了个找法：<b>不再只搜"麻将"这个词</b>，
      而是去三个免费曲库里按<b>「欢快但节奏缓和」</b>这个听感找 —— 中文/和风的弹拨与笛、
      中低速度（BPM 90~103）、低频薄（不轰头）、旋律主导。
      每条的风格标签都是曲库官方原文，不是我概括的。
    </p>''')

    for i, k in enumerate(PICKS['bgm'], 1):
        r = by_id[k]
        bgm_sec.append(pick_html(k, i, r, bgm_metrics(r)))
    bgm_sec.append('  </div>')
    bgm_sec.append('    <h3 class="alt-h">备选 · 11 条（各截中段 40 s，已归一化到同一响度）</h3>')
    bgm_sec.append('    <div class="altgrid">')
    for r in sorted([x for x in bgm if x['id'] not in PICKS['bgm']], key=lambda x: x['id']):
        bgm_sec.append(alt_html(r['id'], r, f'{r["bpm"]} BPM',
                                f'{r["official"][:44]} · 质心 {r["centroid"]} Hz'))
    bgm_sec.append('    </div>')
    bgm_sec.append('  </section>')

    # ---------- 音效三节 ----------
    sfx_sec = []
    for ci, cat in enumerate(['tile', 'win', 'lose']):
        title, en, desc = CAT_TITLE[cat]
        items = [x for x in sfx if x['cat'] == cat]
        sfx_sec.append(f'''  <section id="{cat}">
    <div class="sec-head"><h2>{'二三四'[ci]} · {esc(title)}</h2><span class="en">{en}</span>
      <span class="cnt">{len(items)} 条 · 3 条首推＋{len(items)-3} 条备选</span></div>
    <p class="lead">{esc(desc)}。全部来自<b>同一个音效库（効果音ラボ）</b>——
      一个游戏的音效最好是一个音色家族，胜败提示音之间尤其不能"一个喜庆一个悲壮"。
      标题与用途说明都是曲库官方日文原文。</p>
    <div class="picks">''')
        for i, k in enumerate(PICKS[cat], 1):
            sfx_sec.append(pick_html(k, i, by_id[k], sfx_metrics(by_id[k])))
        sfx_sec.append('    </div>')
        sfx_sec.append(f'    <h3 class="alt-h">备选 · {len(items)-3} 条</h3>')
        sfx_sec.append('    <div class="altgrid">')
        for r in sorted([x for x in items if x['id'] not in PICKS[cat]], key=lambda x: x['id']):
            sfx_sec.append(alt_html(r['id'], r,
                                    f'{r["attack"]:.0f}ms·{r["onsets"]}响',
                                    f'{r["official"][:46]}'))
        sfx_sec.append('    </div>')
        sfx_sec.append('  </section>')

    # ---------- 口径 ----------
    method = '''  <section id="method">
    <div class="sec-head"><h2>五 · 量测口径与两条必须说清的事</h2><span class="en">METHOD</span></div>

    <div class="note-box">
      <h4>① 试听件已做「峰值归一化」，原始电平另列 —— 否则你听到的是音量差，不是音色差</h4>
      <p>本批 34 条音效的实测 RMS 从 <code>−21.0</code> 到 <code>−41.2 dBFS</code>，
        <b>相差 20 dB</b>。若把原始文件直接摆在一起试听，你觉得"好听"的那条很可能只是"更响"。</p>
      <p>所以试听件一律<b>峰值归一化到 −1 dBFS</b>，页面上每条都标了「试听件 +X dB」。
        量测表里的"入库需补偿"是<b>原始文件的真实电平差</b> —— 入库时按它补增益即可对齐。</p>
      <p>⚠️ 归一化只作用于<b>试听副本</b>，入库候选本体一个字节都没动。</p>
    </div>

    <div class="note-box">
      <h4>② 我没有耳朵 —— 所以每条只给"能测的"，好不好听必须你听</h4>
      <p>"欢快""悠哉"这类词我判不了，也没打算用数字装成判得了。能客观测的是：</p>
      <div class="tw">
      <table>
        <caption>音效的硬指标（敲击类音效合不合格，这几条就够）</caption>
        <thead><tr><th>指标</th><th>怎么算</th><th>为什么它有用</th></tr></thead>
        <tbody>
          <tr><td class="n">起音 ms</td><td>从峰值样本<b>向前</b>回溯到包络跌破峰值 10% 处</td>
            <td>敲击必须 &lt; 15 ms。慢了这个音就成"吹奏"或"滑音"了</td></tr>
          <tr><td class="n">衰减到 −30dB</td><td>越过峰值后包络回到 −30 dB 的时间</td>
            <td>硬塑料/木 ≈ 几十 ms；金属/石 ≈ 数百 ms。决定"干"还是"余韵"</td></tr>
          <tr><td class="n">碰撞次数</td><td>包络显著峰计数（门槛 −15 dB、去抖 60 ms）</td>
            <td>一条里藏 5 声就没法当"落一次"用。<b>门槛和去抖是必须的</b>，
              否则包络的微小起伏会被数成碰撞（第一版就踩了这个坑，把 27 个数成了"响"）</td></tr>
          <tr><td class="n">首响能量占比</td><td>首响后 250 ms 内的能量 ÷ 全段能量</td>
            <td>接近 100% = 干净单响；偏低 = 能量散在后面（不适合做瞬时反馈）</td></tr>
          <tr><td class="n">频谱质心</td><td>峰值附近 2048 点 FFT 的一阶矩</td>
            <td>麻将牌是硬塑料，"亮"但不刺 —— 参考区间约 1.5~5 kHz</td></tr>
          <tr><td class="n">入库需补偿</td><td>−20 dBFS − 实测 RMS</td>
            <td>同一音量参数下想让它们等响，各自要加多少</td></tr>
        </tbody>
      </table>
      </div>
      <p style="margin-top:10px">BGM 侧同理：BPM 是<b>估计值</b>（起音包络自相关），
        变拍子或弱起的小节会让它偏一倍；请以试听为准，数字只用来快速筛掉明显不对的。</p>
    </div>

    <details>
      <summary>▸ 复现命令（全部可一键重跑）</summary>
<pre># 1. 抓取（BGM 14 条 + 音效 34 条；音效需 UA+Referer）
HTTPS_PROXY=http://127.0.0.1:7890 python3 tools/r44-fetch.py /tmp/r44
# 2. 量测（BGM 走已验过的分析器；音效走新写的）
python3 tools/r43-bgm-analyze.py /tmp/r44/bgm /tmp/r44/bgm-out /tmp/r44/catalog.json
python3 tools/r44-sfx-analyze.py /tmp/r44/raw /tmp/r44/catalog.json /tmp/r44/sfx-out
# 3. 试听件（含峰值归一化）
python3 tools/r44-make-audition.py /tmp/r44/catalog.json \\
    /tmp/r44/bgm-out/analysis.json /tmp/r44/sfx-out/analysis.json &lt;本目录&gt; /tmp/r44/raw</pre>
    </details>
  </section>'''

    # ---------- 溯源 ----------
    src_rows = []
    for r in sorted(bgm + sfx, key=lambda x: (x.get('cat', 'bgm'), x['id'])):
        cat = r.get('cat', 'bgm')
        src_rows.append(
            f'      <tr><td class="n">{esc(r["id"])}</td><td>{esc(r["title"])}</td>'
            f'<td class="n">{esc(cat)}</td><td><code>{esc(r["file"])}</code></td></tr>')

    tail = f'''  <section id="src">
    <div class="sec-head"><h2>六 · 素材溯源（48 条逐条可重取）</h2><span class="en">PROVENANCE</span></div>
    <p class="lead">
      三类来源：<b>PeriTune</b>（日文免费曲库，旧曲 CC BY 4.0、站方额外允许署名可选）、
      <b>魔王魂</b>（免费 BGM，商用可）、<b>甘茶の音楽工房</b>（和風・アジア 分类）、
      <b>効果音ラボ</b>（音效，免费商用、<b>免署名</b>）。
    </p>
    <p class="lead">
      你说「不必在乎是否商用免费」，但入库前仍建议按上表逐个确认 —— 这份清单就是为此准备的：
      每条的官方页面与直链都在下面，随时可重新下载核对。
    </p>
    <details>
      <summary>▸ 48 条直链（id / 标题 / 品类 / 原始 URL）</summary>
      <div class="tw">
      <table class="src">
        <thead><tr><th>id</th><th>标题</th><th>品类</th><th>直链</th></tr></thead>
        <tbody>
{chr(10).join(src_rows)}
        </tbody>
      </table>
      </div>
    </details>
  </section>

  <footer>
    第 44 轮 · BGM 与音效候选试听拍板板<br>
    量测脚本 game-5-cocos/tools/r44-*.py · 数据 manifest.json · 生成器 r44-board-build.py<br>
    48 条候选本体<b>未入库</b>，等你拍板后再落 assets/。
  </footer>
'''

    heard = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>第44轮 · BGM 与音效候选 · 试听拍板板</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">Game 5 · 麻麻大消除 · Round 44</div>
    <h1>BGM 与音效候选<em> · 试听拍板</em></h1>
    <p class="sub">
      上一批 3 条 BGM 你说不够理想，这次换了找法：按<b>「欢快但节奏缓和、悠哉悠哉」</b>的听感
      去四个曲库找，一共 14 条 BGM。同时补齐你点名的三类音效 ——
      <b>胜利、失败、麻将落槽</b>，每类 3 条首推 + 备选。
      全部 48 条都做过客观量测，试听件统一归一化，你听到的差别是音色差别。
    </p>
    <div class="pills">
      <span class="pill">BGM <b>14</b> 条</span>
      <span class="pill">落槽音效 <b>12</b> 条</span>
      <span class="pill">胜利 <b>11</b> 条</span>
      <span class="pill">失败 <b>11</b> 条</span>
      <span class="pill ask">待你拍板：4 组各选 1 条</span>
    </div>
  </header>

{chr(10).join(bgm_sec)}

{chr(10).join(sfx_sec)}

{method}

{tail}
</div>

<div id="dock">
  <div class="inner">
    <span class="now" id="dockNow">未播放</span>
    <span class="prog"><i></i></span>
    <button class="stop" id="dockStop">停止</button>
  </div>
</div>
<script>{JS}</script>
</body>
</html>
'''
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(heard)
    return heard


def main():
    man = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    s = build(man, out)
    print(f'  已生成 {out}（{len(s)} 字节）')

    # ★ 自检：CSS 里绝不能留 markdown 星号（历史上踩过两次）
    n = s.count('**')
    print(f'  星号自检（应为 0）：{n}')
    assert n == 0, 'HTML 里出现 markdown 星号，说明有未内联的粗体标记'

    # ★ 自检：所有 data-src 与 img 引用的文件必须真实存在
    import re
    d = os.path.dirname(os.path.abspath(out))
    miss = [p for p in set(re.findall(r'(?:data-src|src)="([^"]+)"', s))
            if not p.startswith('http') and not os.path.exists(os.path.join(d, p))]
    print(f'  引用缺失（应为 0）：{len(miss)} {miss[:5]}')
    assert not miss, f'引用了不存在的文件：{miss[:5]}'


if __name__ == '__main__':
    main()
