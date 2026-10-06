#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
game-5 · 30 关牌堆预览页生成器（第 32 轮）
==========================================
读 levels.json → 生成自包含（内联数据）的可交互验收页。

页面结构：
  ① 顶部：拍板常量表 + 一句话结论
  ② 30 关概览网格：每卡一张「安全区内的真实牌堆」（真母版 PNG，逐张绝对定位）
  ③ 点卡片 → 该卡放大 + 展开「逐层条」（每层单独画一遍，看层结构 / 看均匀度 / 看它属于哪一段）
  ④ 三个开关：显示牌面 / 高亮开局可点 / 显示层号

★ 自证接口：window.__lv 暴露逐关真实 DOM 几何与计数，供 verify_levels.mjs 断言

★ 第 32 轮两处关键变化
  ① **横牌改为纯旋转**：第 31 轮这里是「换宽高 + 图片 100%×100% 拉伸」——
     横牌牌面被横向拉伸 1.33 倍（非等比缩放）。现改为**元素始终是牌体自身尺寸 w×h**，
     用 `transform:rotate(90deg)` 纯旋转 ⇒ 横竖牌**严格同尺寸**。
     自证：元素 `offsetWidth/offsetHeight` 恒为 (w,h)，且变换矩阵是纯旋转（无 scale）。
  ② 牌堆恢复**分段**（按层切、段序自顶向下）；新增分段信息与「天际线/错位」字段。
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_REL = '../../../'          # docs-verify/game-5/game-play/ → 仓库根
CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
CN_SUIT = {'wan': '万', 'tiao': '条', 'tong': '筒'}
FACE = {}
for k in ('wan', 'tiao', 'tong'):
    for n in range(1, 10):
        FACE[f'{k}-{n}'] = f'{ROOT_REL}assets/game-play/tiles/{k}/{CN_NUM[n-1]}{CN_SUIT[k]}.png'


def slim(d):
    """压成页面用的最小结构。"""
    out = {'meta': d['meta'], 'levels': []}
    for L in d['levels']:
        tiles = []
        for i, t in enumerate(L['tiles']):
            fk, fn = L['faces'][i]
            tiles.append({
                'x': t['px'], 'y': t['py'], 'z': t['z'], 'r': t['rot'],
                'c': round(L['cover'][i], 3),
                's': f'{fk}-{fn}',
            })
        out['levels'].append({
            'lv': L['lv'], 'ch': L['chapter'], 'n': L['nTotal'], 'st': L['stages'],
            'sg': L['segs'], 'nst': L['nStage'],
            'np': L['nPile'], 'L': L['layers'], 'lc': L['layerCounts'],
            'sh': L['footprint'], 'pr': CN_SUIT[L['primary']],
            'w': L['w'], 'h': L['h'], 'a2': L['asset2x'],
            'bb': L['bboxPx'], 'nl': L['nLive'], 'ns': L['nStrict'],
            'lr': L['liveRatio'], 'nm': L['nMatchOpen'],
            'og': L['openGroups'], 'cl': L['cleared'], 'sc2': L['segCleared'],
            'cvn': L['uni']['cvNorm'], 'qb': L['uni']['qbal'],
            'dy': L['layerDy'], 'sp': L['layerSpan'],
            'lsh': L['layerShift'], 'ts': L['topShare'], 'tln': L['topLayerN'],
            'ur': L['uniRelaxed'],
            'cx': L['crossN'], 'tiles': tiles,
        })
    return out


HTML = r'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>game-5 · 30 关关卡表与牌堆预览（第 32 轮）</title>
<style>
:root{
  --bg:#0f1b16; --card:#16261f; --line:#2b4239; --ink:#e8f2ec; --dim:#8fae9f;
  --gilt:#d8b25a; --teal:#4fd1c5; --red:#e2574c; --green:#4fbf7a; --violet:#9d8cf0;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:13px/1.6 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;padding:22px 26px 60px}
h1{font-size:19px;margin:0 0 4px;letter-spacing:.02em}
h1 small{font-weight:400;color:var(--dim);font-size:12px;margin-left:8px}
.rule{height:1px;background:var(--line);margin:14px 0 16px}
.note{color:var(--dim);font-size:12px;margin:0 0 14px}
.note b{color:var(--ink)}
.note code{color:var(--gilt)}
.kv{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.kv span{background:var(--card);border:1px solid var(--line);border-radius:7px;
  padding:5px 10px;font-size:12px;color:var(--dim)}
.kv b{color:var(--ink);font-weight:600}
.bar{display:flex;gap:14px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.bar label{font-size:12px;color:var(--dim);cursor:pointer;user-select:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;
  padding:9px 9px 7px;cursor:pointer;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--gilt)}
.card.open{grid-column:span 3;border-color:var(--gilt)}
.card.open .mini{display:none}
.card.open .big{display:block}
.big{display:none}
.chip{display:flex;justify-content:space-between;align-items:baseline;
  font-size:11px;color:var(--dim);margin-bottom:6px}
.chip b{color:var(--ink);font-size:13px}
.chip .nn{color:var(--gilt)}
.stageWrap{position:relative;overflow:hidden;background:#0b1512;border-radius:6px;
  border:1px solid #21362e}
.stage{position:absolute;left:0;top:0;width:682px;height:682px;transform-origin:0 0}
.safe{position:absolute;left:0;top:0;width:682px;height:682px;
  border:1px dashed rgba(79,209,197,.35);border-radius:4px}
.tk{position:absolute;border-radius:3px;overflow:hidden}
.tk img{width:100%;height:100%;display:block}
.tk.noface{background:linear-gradient(160deg,#f4efe4,#dfd6c2);border:1px solid #cbbf9f}
.tk .lay{position:absolute;right:1px;bottom:0;font-size:9px;color:#8a6a1e;
  text-shadow:0 0 3px #fff}
.tk.live{outline:2px solid var(--teal);outline-offset:-1px}
.tk.dead{opacity:.42}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:5px 10px;
  margin-top:8px;font-size:11px;color:var(--dim)}
.meta i{font-style:normal;color:var(--ink)}
.meta .ok{color:var(--green)}
.segRow{margin-top:9px;display:flex;gap:6px;flex-wrap:wrap}
.segBox{background:#0b1512;border:1px solid #2f4a55;border-radius:5px;padding:4px 8px;
  font-size:11px;color:var(--dim)}
.segBox b{color:var(--teal)}
.segBox .r{color:var(--violet)}
.layers{margin-top:9px;display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.layBox{background:#0b1512;border:1px solid #21362e;border-radius:5px;padding:4px 5px;
  flex:0 0 auto;text-align:center}
.layBox .t{font-size:10px;color:var(--dim);margin-bottom:3px;line-height:1.5}
.layBox .t b{color:var(--teal)}
.layBox .t s{color:var(--violet);text-decoration:none}
.layStage{position:relative;width:190px;height:190px;overflow:hidden}
.tip{font-size:11px;color:var(--dim);margin-top:10px}
.foot{margin-top:22px;color:var(--dim);font-size:11px;line-height:1.9}
.foot code{color:var(--gilt)}
</style></head><body>

<h1>game-5 · 30 关关卡表与牌堆预览<small>第 32 轮 · 按层分段 · 天际线抬升 · 横牌纯旋转 · 数据源 level_design.py</small></h1>
<div class="rule"></div>
<p class="note">每张卡片里是<b>该关整堆牌</b>（用户拍板：<b>全堆同时在桌</b>）在 682×682 安全区内的真实排布；
<b>分段</b>是"生成 + 难度台阶"单位（段边界落在层边界、段内 ≤36 张且为 3 的倍数、<b>段序自顶向下</b>）。
牌面用已入库的 27 张真母版 PNG，坐标 1:1 取自 <code>levels.json</code>（可直抄 Cocos）。
点击卡片放大并展开「分段 + 逐层条」（<b>逐层条是看"分布是否均匀、天际线在哪"最直观的地方</b>）。</p>
<div class="kv" id="kv"></div>
<div class="bar">
  <label><input type="checkbox" id="cFace" checked> 显示牌面</label>
  <label><input type="checkbox" id="cLive"> 只留开局可点</label>
  <label><input type="checkbox" id="cLayer"> 显示层号</label>
  <span style="color:var(--dim);font-size:12px">虚线框 = 安全区 682×682 · 横牌 = 纯旋转（严格同尺寸）</span>
</div>
<div class="grid" id="grid"></div>
<div class="foot" id="foot"></div>

<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const FACE = __FACE__;
const SC = 682, MINI = 0.352, BIG = 0.66;
let OPEN = -1;

/* ── 断言接口（供 verify_levels.mjs）────────────────────────── */
window.__lv = {
  meta: DATA.meta,
  levels: DATA.levels.map(l => ({ lv:l.lv, n:l.n, np:l.np, L:l.L, lc:l.lc, w:l.w, h:l.h,
                                  nl:l.nl, ns:l.ns, nm:l.nm, st:l.st, a2:l.a2, sg:l.sg,
                                  nst:l.nst, tln:l.tln, lsh:l.lsh, ts:l.ts,
                                  cl:l.cl, sc2:l.sc2, og:l.og, cvn:l.cvn, qb:l.qb })),
  /* 真实 DOM 几何：安全区 + 每张牌的屏幕设计包围盒 + 元素自身尺寸/变换矩阵 */
  measure(lv){
    const card = document.querySelector(`.card[data-lv="${lv}"]`);
    if(!card) return null;
    const stage = card.querySelector('.mStage');
    if(!stage) return null;
    const k = stage.getBoundingClientRect().width / SC;
    const sr = stage.getBoundingClientRect();
    const safe = stage.querySelector('.safe').getBoundingClientRect();
    const tiles = [...stage.querySelectorAll('.tk')].map(el => {
      const r = el.getBoundingClientRect();
      return { z:+el.dataset.z, r:+el.dataset.r, live:el.dataset.live==='1',
               x:(r.left-sr.left)/k, y:(r.top-sr.top)/k,
               w:r.width/k, h:r.height/k,
               ow:el.offsetWidth, oh:el.offsetHeight,
               tf:getComputedStyle(el).transform };
    });
    const xs0 = tiles.map(t=>t.x), ys0 = tiles.map(t=>t.y);
    const xs1 = tiles.map(t=>t.x+t.w), ys1 = tiles.map(t=>t.y+t.h);
    let broken = 0, imgs = 0, empty = 0;
    for(const im of stage.querySelectorAll('img')){
      if(!im.getAttribute('src')) { empty++; continue; }
      imgs++;
      if(!(im.complete && im.naturalWidth>0)) broken++;
    }
    return {
      scale:k,
      safe:{ x:(safe.left-sr.left)/k, y:(safe.top-sr.top)/k, w:safe.width/k, h:safe.height/k },
      tiles:tiles.length, list:tiles, live:tiles.filter(t=>t.live).length,
      rot90:tiles.filter(t=>t.r===90).length,
      zset:[...new Set(tiles.map(t=>t.z))].sort((a,b)=>a-b),
      bbox:{ x0:Math.min(...xs0), y0:Math.min(...ys0), x1:Math.max(...xs1), y1:Math.max(...ys1) },
      faces:{ imgs, broken, empty },
    };
  },
  rect(){ const g = document.getElementById('grid').getBoundingClientRect(); return {w:g.width,h:g.height}; },
  open: () => OPEN,
  errors: window.__errs,
};
const __errs = []; window.__errs = __errs;
window.addEventListener('error', e => __errs.push(String(e.message)));

/* ── 渲染 ─────────────────────────────────────────────────── */
function faceHTML(t){
  if(!document.getElementById('cFace').checked) return '';
  const src = FACE[t.s];
  return src ? `<img src="${src}" alt="">` : '';
}
/* ★ 横牌 = 纯旋转：元素**恒为牌体自身尺寸 w×h**，只用 transform:rotate(90deg) 转过去。
   （第 31 轮这里是"换宽高"，会让牌面被非等比拉伸 1.33 倍 —— 已修） */
function placeTile(d, l, t){
  d.style.left = (SC/2 + t.x - l.w/2) + 'px';
  d.style.top  = (SC/2 + t.y - l.h/2) + 'px';
  d.style.width = l.w + 'px';
  d.style.height = l.h + 'px';
  if(t.r === 90) d.style.transform = 'rotate(90deg)';
}
function buildTiles(l, opts={}){
  const lay = document.getElementById('cLayer').checked;
  const onlyLive = document.getElementById('cLive').checked;
  const frag = document.createDocumentFragment();
  for(const t of l.tiles){
    const live = t.c < DATA.meta.coverTh;
    const d = document.createElement('div');
    d.className = 'tk' + (opts.noFace ? ' noface' : '') + (live ? ' live' : ' dead');
    d.dataset.z = t.z; d.dataset.r = t.r; d.dataset.live = live ? '1' : '0';
    if(onlyLive && !live) d.style.display = 'none';
    placeTile(d, l, t);
    d.style.zIndex = 10 + t.z * 10;
    if(!opts.noFace){
      d.innerHTML = faceHTML(t) + (lay ? `<span class="lay">${t.z}</span>` : '');
    }
    frag.appendChild(d);
  }
  return frag;
}
function mark(stage){
  const s = document.createElement('div'); s.className = 'safe'; stage.appendChild(s);
}
function segOf(l, z){
  for(const s of l.sg) if(z >= s.lo && z < s.hi) return s;
  return null;
}
function renderMini(card, l){
  const wrap = card.querySelector('.mini .stageWrap');
  wrap.style.width = (SC*MINI) + 'px'; wrap.style.height = (SC*MINI) + 'px';
  const st = card.querySelector('.mStage');
  st.className = 'stage mStage';
  st.innerHTML = ''; mark(st);
  st.appendChild(buildTiles(l));
  st.style.transform = `scale(${MINI})`;
}
function renderBig(card, l){
  const wrap = card.querySelector('.big > .stageWrap');
  wrap.style.width = (SC*BIG) + 'px'; wrap.style.height = (SC*BIG) + 'px';
  const st = card.querySelector('.bStage');
  st.className = 'stage bStage';
  st.innerHTML = ''; mark(st);
  st.appendChild(buildTiles(l));
  st.style.transform = `scale(${BIG})`;
  // 分段条
  const sb = card.querySelector('.segRow'); sb.innerHTML = '';
  for(const s of l.sg){
    const d = document.createElement('div'); d.className = 'segBox';
    d.innerHTML = `段 <b>${s.k}</b>（第 ${s.lo}~${s.hi-1} 层 · ${s.layers} 层）· <b>${s.n}</b> 张 · ` +
                  `轮到它时可点 <span class="r">${s.openLive}/${s.n}（${(s.openRatio*100).toFixed(0)}%）</span>`;
    sb.appendChild(d);
  }
  // 逐层条（看层结构 / 看均匀度 / 看它属于哪一段）
  const lb = card.querySelector('.layers'); lb.innerHTML = '';
  for(let z = 0; z < l.L; z++){
    const box = document.createElement('div'); box.className = 'layBox';
    const sub = l.tiles.filter(t => t.z === z);
    const sg = segOf(l, z);
    box.innerHTML = `<div class="t">第 <b>${z}</b> 层 · ${sub.length} 张` +
                    (sg ? `<br><s>段${sg.k}</s>` : '') + `</div>`;
    const ls = document.createElement('div'); ls.className = 'layStage';
    const s2 = document.createElement('div'); s2.className = 'stage lStage';
    const K = 190/SC;
    s2.style.transform = `scale(${K})`;
    for(const t of sub){
      const d = document.createElement('div');
      d.className = 'tk'; d.dataset.z = t.z; d.dataset.r = t.r;
      d.dataset.live = t.c < DATA.meta.coverTh ? '1':'0';
      placeTile(d, l, t);
      d.innerHTML = faceHTML(t);
      s2.appendChild(d);
    }
    ls.appendChild(s2); box.appendChild(ls); lb.appendChild(box);
  }
}
function metaHTML(l){
  return `<div class="meta">
    <div>整关 <i>${l.n}</i> 张 · 段 <i>${l.nst}</i>（${l.st.join('+')}）</div>
    <div>层数 <i>${l.L}</i>（${l.lc.join('/')}）</div>
    <div>牌体 <i>${l.w}×${l.h}</i>（关内唯一）</div><div>@2x <i>${l.a2[0]}×${l.a2[1]}</i></div>
    <div>包围盒 <i>${l.bb[0].toFixed(0)}×${l.bb[1].toFixed(0)}</i></div>
    <div>形态 <i>${l.sh}</i> · 主 <i>${l.pr}</i></div>
    <div>开局可点 <i>${l.nl}/${l.np}（${(l.lr*100).toFixed(0)}%）</i></div>
    <div>严格口径 <i>${l.ns}</i> 张</div>
    <div>开局可凑 <i>${l.nm}</i> 组</div>
    <div>顶层天际线 <i>${l.tln}</i> 张</div>
    <div>离散指数 <i>${l.cvn.toFixed(3)}</i></div>
    <div>层间步进 <i>${l.dy}</i>×牌高</div>
    <div>横牌 <i>${l.cx}</i> 张（纯旋转）</div>
    <div>层间错位 <i>${l.lsh}</i> · 天际线 <i>${(l.ts*100).toFixed(0)}%</i></div>
    <div>满清 <i class="ok">${l.cl ? '✅ 可清完' : '❌'}</i></div>
    <div>段内满清 <i class="ok">${l.sc2 ? '✅ 逐段可清' : '❌'}</i></div>
  </div>`;
}
function build(){
  const g = document.getElementById('grid'); g.innerHTML = '';
  for(const l of DATA.levels){
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.lv = l.lv;
    card.innerHTML = `<div class="chip"><b>第 ${l.lv} 关</b><span class="nn">${l.n} 张 · ${l.L} 层 · ${l.nst} 段 · ${l.sh}</span></div>
      <div class="mini"><div class="stageWrap"><div class="stage mStage"></div></div></div>
      <div class="big"><div class="stageWrap"><div class="stage bStage"></div></div>${metaHTML(l)}<div class="segRow"></div><div class="layers"></div></div>`;
    g.appendChild(card);
    renderMini(card, l);
  }
  const kv = document.getElementById('kv');
  const m = DATA.meta;
  const ws = DATA.levels.map(l=>l.w);
  const ns = DATA.levels.map(l=>l.n);
  const ls = DATA.levels.map(l=>l.L);
  const tail = DATA.levels.filter(l=>l.lv>=21).map(l=>l.lr);
  kv.innerHTML = [
    `安全区 <b>682×682</b>`, `牌体宽 <b>${Math.min(...ws)}~${Math.max(...ws)}</b>（比值 ${(Math.max(...ws)/Math.min(...ws)).toFixed(2)}）`,
    `比例 <b>3:4</b>（关内唯一）`, `层间跨度 ≤<b>${m.layerDySpan}</b>×牌高（逐关自适应）`,
    `判压阈值 <b>≥${(m.coverTh*100).toFixed(0)}%</b>`, `横牌占比 <b>${(m.crossRatio*100).toFixed(0)}%</b>（纯旋转）`,
    `张数 <b>${Math.min(...ns)}→${Math.max(...ns)}</b>`, `层数 <b>${Math.min(...ls)}→${Math.max(...ls)}</b>`,
    `段数 <b>${Math.min(...DATA.levels.map(l=>l.nst))}→${Math.max(...DATA.levels.map(l=>l.nst))}</b>（按层切）`,
    `可点下限 <b>${m.wMin}</b>（44pt）`,
    `后段可点率 <b>${(Math.min(...tail)*100).toFixed(0)}%~${(Math.max(...tail)*100).toFixed(0)}%</b>`,
    `满清可解 <b>${DATA.levels.filter(l=>l.cl).length}/${DATA.levels.length}</b>`,
    `段内满清 <b>${DATA.levels.filter(l=>l.sc2).length}/${DATA.levels.length}</b>`,
  ].map(s=>`<span>${s}</span>`).join('');
  document.getElementById('foot').innerHTML =
    `共 <b>${DATA.levels.length}</b> 关 · 卡位合计 <b>${DATA.levels.reduce((a,l)=>a+l.tiles.length,0)}</b> 个 · ` +
    `整关张数 ${DATA.levels[0].n} → ${DATA.levels[29].n} · 层数 ${DATA.levels[0].L} → ${DATA.levels[29].L} · ` +
    `牌宽 ${Math.min(...ws)} → ${Math.max(...ws)} · 段数 ${DATA.levels[0].nst} → ${DATA.levels[29].nst}<br>` +
    `可解性口径：<b>逆向构造 · 按段推进</b>（贪心可点剥离 → 连续三元组同种填充；段边界处槽位必然归零）⇒ 每关整关与逐段都必然可清完<br>` +
    `尺寸口径：<b>单关内牌体尺寸与长宽比唯一</b>，横牌 = 纯旋转（禁止非等比缩放）；跨关尺寸按表格 112 → 88<br>` +
    `数据源：<code>docs-verify/game-5/game-play/levels.json</code>（由 <code>level_design.py</code> 生成，改常量可重跑）`;
}
build();

/* 交互：点卡片放大 / 开关重绘 */
document.getElementById('grid').addEventListener('click', e => {
  const card = e.target.closest('.card'); if(!card) return;
  const lv = +card.dataset.lv; const l = DATA.levels.find(x=>x.lv===lv);
  card.classList.toggle('open');
  OPEN = card.classList.contains('open') ? lv : -1;
  if(card.classList.contains('open')) renderBig(card, l);
});
for(const id of ['cFace','cLive','cLayer']){
  document.getElementById(id).addEventListener('change', () => {
    for(const card of document.querySelectorAll('.card')){
      const l = DATA.levels.find(x=>x.lv===+card.dataset.lv);
      renderMini(card, l);
      if(card.classList.contains('open')) renderBig(card, l);
    }
  });
}
window.__ready = true;
</script></body></html>
'''

if __name__ == '__main__':
    with open(os.path.join(HERE, 'levels.json'), encoding='utf-8') as f:
        data = json.load(f)
    out = HTML.replace('__DATA__', json.dumps(slim(data), ensure_ascii=False, separators=(',', ':')))
    out = out.replace('__FACE__', json.dumps(FACE, ensure_ascii=False, separators=(',', ':')))
    p = os.path.join(HERE, '56-关卡表与牌堆预览.html')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'→ {p}  ({os.path.getsize(p)/1024:.1f} KB)')
