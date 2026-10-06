/**
 * game-5 · 30 关关卡表与牌堆布局 · 真实浏览器验收（第 32 轮）
 * ==========================================================
 * 打开 56-关卡表与牌堆预览.html，用 **真实 DOM 几何 + 真实鼠标事件** 对账 levels.json。
 *
 * 断言（A 类 · 逐关 30×N，全部基于真实渲染，不看设计值自证）
 *   A1 渲染牌数 == 设计单堆张数
 *   A2 真实测得的牌数 == 设计卡位数
 *   A3 层号集合 == {0..L-1}
 *   A4 朝向集合 ⊆ {0,90}，且**逐张**与设计表一致（含横牌张数）
 *   A5 每张牌的真实设计包围盒都落在安全区 [0,682]² 内
 *   A6 每张牌的真实渲染外框 == 设计（横牌 = 竖牌宽高互换，即纯旋转后的包围盒）
 *   A7 开局可点数（真实 DOM data-live）== 设计 nLive
 *   A8 牌面 <img> 全部加载成功（无破图、无空 src）
 *   A9 ★ 满清可解：**在浏览器里用另一套实现独立复算**（不复用 Python 结论）
 *   A10 ★ 消除序列的连续 3 张同种（"碰"成组）逐关成立
 *   A11 ★ 单关尺寸唯一：每关 **元素自身** offsetWidth×offsetHeight 恒 = w×h（横牌也一样）
 *   A12 ★ 横牌 = 纯旋转：r=90 的牌变换矩阵是 rotate(±90°)（无 scale、无 translate）
 * B 类 · 跨关单调 / 难度曲线 / 均匀度 / 分段 / 可点率
 *   B1 整关张数单调不减    B2 单堆层数单调不减    B3 牌宽单调不增（且 ∈ [88,112]）
 *   B4 整关张数为 3 的倍数、张数上限 138
 *   B5 ★ 分段（第 32 轮恢复）：
 *        B5a 全堆同时在桌（nPile == nTotal）且 Σ段张数 == nTotal
 *        B5b 每段张数为 3 的倍数且 ≤ SEG_MAX(36)
 *        B5c Σ段层数 == 总层数
 *        B5d 段序**自顶向下**且严丝合缝（segs[0].hi == L / segs[-1].lo == 0 / 相邻 hi==lo）
 *        B5e 段内满清可解（segCleared）且每段开局都有可点牌
 *   B6 层数曲线：L1=2 / L2=3 / L3 起 ≥5 / 上限 10
 *   B7 满清可解 + 开局可凑 ≥2 组
 *   B8 均匀度（离散指数）· B9 四象限平衡（按样本量放宽）
 *   B10 ★ 后段（L21~L30）开局可点率下限（第 31 轮同段仅 7.2%~10.0%）
 *   B11 ★ 段内开局可点率（"轮到自己时"的更上段已清空口径）
 * C 类 · 真实交互（真实鼠标事件）
 *   C1 点第 1 关卡片 → 展开、逐层条层数 == L、条内张数合计 == 单堆张数
 *   C2 点第 30 关卡片 → 同上
 *   C3 勾「只留开局可点」→ 可见牌数 == 可点数
 *   C4 勾「显示层号」→ 层号标签数 == 单堆张数
 *   C5 取消全部 → 恢复
 * D 类
 *   D1 运行期零 JS 异常
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PAGE = 'file://' + path.join(HERE, '56-关卡表与牌堆预览.html').split('/').map(encodeURIComponent).join('/');
const JSONF = path.join(HERE, 'levels.json');
const PORT = 9371;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 76 - t.length))}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=1600,1400', PAGE,
], { stdio: 'ignore' });

let id = 0; const pending = new Map(); let ws;
const send = (m, p = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout ' + m)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});

try {
  let targets = null;
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const all = (await r.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      targets = all.filter(t => (t.url || '').startsWith('file://'));
      if (!targets.length) targets = all;
      if (targets.length) break;
    } catch { /* 还在启动 */ }
    await sleep(250);
  }
  if (!targets?.length) throw new Error('找不到页面 target');
  ws = new WebSocket(targets[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1'));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws 握手超时')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error('ws 错误')); };
  });
  const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description || 'exception');
    if (m.id && pending.has(m.id)) {
      const { res, rej, t } = pending.get(m.id);
      pending.delete(m.id); clearTimeout(t);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');

  const ev = async (expr, ms = 30000) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // 等页面就绪
  for (let i = 0; i < 80; i++) {
    if (await ev('!!window.__ready && document.querySelectorAll(".card").length === 30').catch(() => false)) break;
    await sleep(250);
  }

  const DESIGN = JSON.parse(fs.readFileSync(JSONF, 'utf8'));
  const byLv = new Map(DESIGN.levels.map(l => [l.lv, l]));

  head('A · 逐关逐值对账（真实 DOM 几何）');
  const perLevel = await ev(`JSON.stringify(window.__lv.levels.map(l => ({ ...window.__lv.measure(l.lv), lv: l.lv })))`, 60000);
  const measured = JSON.parse(perLevel);
  ok(measured.length === 30, `30 关全部渲染并可测量（实测 ${measured.length} 关）`);

  let allCount = 0, allLive = 0, allRot = 0;
  const bad = { count: [], n: [], z: [], rot: [], out: [], size: [], live: [], img: [] };
  for (const m of measured) {
    const d = byLv.get(m.lv);
    const tag = `第 ${m.lv} 关`;
    if (m.tiles !== d.nPile) bad.count.push(`${tag} 渲染 ${m.tiles}≠设计 ${d.nPile}`);
    if (m.tiles !== d.tiles.length) bad.n.push(`${tag} 卡位数 ${m.tiles}≠${d.tiles.length}`);
    const want = Array.from({ length: d.layers }, (_, i) => i).join(',');
    if (m.zset.join(',') !== want) bad.z.push(`${tag} 层号 [${m.zset}]≠[${want}]`);
    // 朝向逐张比对
    const mine = m.list;
    const cntRot = mine.filter(t => t.r === 90).length;
    if (cntRot !== d.crossN) bad.rot.push(`${tag} 横牌 ${cntRot}≠设计 ${d.crossN}`);
    if (!mine.every(t => t.r === 0 || t.r === 90)) bad.rot.push(`${tag} 出现非 0/90 朝向`);
    // 越界 + 尺寸
    const S = 682;
    const outT = mine.filter(t => t.x < -0.6 || t.y < -0.6 || t.x + t.w > S + 0.6 || t.y + t.h > S + 0.6);
    if (outT.length) bad.out.push(`${tag} ${outT.length} 张越安全区`);
    const wrongSize = mine.filter(t => {
      const w = t.r ? d.h : d.w, h = t.r ? d.w : d.h;
      return Math.abs(t.w - w) > 0.6 || Math.abs(t.h - h) > 0.6;
    });
    if (wrongSize.length) bad.size.push(`${tag} ${wrongSize.length} 张渲染尺寸不符`);
    if (m.live !== d.nLive) bad.live.push(`${tag} 可点 ${m.live}≠设计 ${d.nLive}`);
    if (m.faces.broken || m.faces.empty) bad.img.push(`${tag} 破图 ${m.faces.broken} / 空 src ${m.faces.empty}`);
    allCount += m.tiles; allLive += m.live; allRot += cntRot;
  }
  ok(!bad.count.length, `A1 渲染牌数逐关 == 设计单堆张数（合计 ${allCount} 张）${bad.count.slice(0, 3).join(' | ')}`);
  ok(!bad.n.length, `A2 真实 DOM 牌数 == 设计卡位数${bad.n.slice(0, 3).join(' | ')}`);
  ok(!bad.z.length, `A3 层号集合逐关 == {0..L-1}${bad.z.slice(0, 3).join(' | ')}`);
  ok(!bad.rot.length, `A4 朝向逐关 ∈ {0,90} 且横牌数一致（合计 ${allRot} 张横牌）${bad.rot.slice(0, 3).join(' | ')}`);
  ok(!bad.out.length, `A5 每张牌的真实包围盒都落在安全区 682×682 内${bad.out.slice(0, 3).join(' | ')}`);
  ok(!bad.size.length, `A6 每张牌的真实渲染尺寸 == 设计 w×h（±0.6px）${bad.size.slice(0, 3).join(' | ')}`);
  ok(!bad.live.length, `A7 开局可点数逐关 == 设计值（合计 ${allLive} 张）${bad.live.slice(0, 3).join(' | ')}`);
  ok(!bad.img.length, `A8 ${allCount} 张牌面全部加载成功（无破图 / 无空 src）${bad.img.slice(0, 3).join(' | ')}`);

  /* ── A11/A12 · 第 32 轮第 5 条：单关尺寸唯一 + 横牌纯旋转 ──────────────
     判据分两条通道，避免"看起来一样"的假绿：
       · **元素自身尺寸** offsetWidth/offsetHeight —— 不受 transform 影响，
         故它才是「单关尺寸唯一」的凭据（横牌也必须恒为 w×h）；
       · **变换矩阵** —— 横牌必须是 rotate(±90°) 的纯旋转（a²+b²=1、det=1、e=f=0）。
     旧 bug 正是「把横牌元素换成 h×w + 图片 100%×100%」⇒ 牌面横向拉伸 1.33 倍。 */
  const szBad = [], rotM = [];
  for (const m of measured) {
    const d = byLv.get(m.lv);
    const tag = `第 ${m.lv} 关`;
    const elSz = [...new Set(m.list.map(t => t.ow + 'x' + t.oh))];
    if (elSz.length !== 1 || elSz[0] !== `${d.w}x${d.h}`)
      szBad.push(`${tag} 元素尺寸集合 ${JSON.stringify(elSz)} ≠ ${d.w}×${d.h}`);
    const cross = m.list.filter(t => t.r === 90);
    const up = m.list.filter(t => t.r === 0);
    const cSz = [...new Set(cross.map(t => t.ow + 'x' + t.oh))];
    const uSz = [...new Set(up.map(t => t.ow + 'x' + t.oh))];
    if (JSON.stringify(cSz) !== JSON.stringify(uSz))
      szBad.push(`${tag} 横 ${JSON.stringify(cSz)} ≠ 竖 ${JSON.stringify(uSz)}`);
    /* 变换矩阵：r=0 → none；r=90 → 纯旋转 90° */
    const parse = tf => {
      if (tf === 'none' || !tf) return { none: true };
      const g = tf.match(/matrix\(([^)]+)\)/); if (!g) return { bad: tf };
      const [a, b, c, dd, e, f] = g[1].split(',').map(Number);
      return { a, b, c, d: dd, e, f, s1: Math.hypot(a, b), s2: Math.hypot(c, dd), det: a * dd - b * c };
    };
    const upBad = up.filter(t => !parse(t.tf).none).length;
    const crossBad = cross.filter(t => {
      const p = parse(t.tf);
      if (p.none || p.bad) return true;
      const deg = Math.abs(Math.atan2(p.b, p.a) * 180 / Math.PI);
      return Math.abs(p.s1 - 1) > 1e-4 || Math.abs(p.s2 - 1) > 1e-4
        || Math.abs(p.det - 1) > 1e-4 || p.e !== 0 || p.f !== 0 || Math.abs(deg - 90) > 0.01;
    }).length;
    if (upBad || crossBad) rotM.push(`${tag} 竖牌异常 ${upBad} / 横牌异常 ${crossBad}`);
  }
  ok(!szBad.length, `A11 ★ 单关尺寸唯一：30 关每关元素自身尺寸恒为设计 w×h（横牌同尺寸）${szBad.slice(0, 3).join(' | ')}`);
  ok(!rotM.length, `A12 ★ 横牌 = 纯旋转：30 关共 ${allRot} 张横牌全部为 rotate(90°)（无 scale / 无 translate），竖牌无变换${rotM.slice(0, 3).join(' | ')}`);

  /* ── A9/A10 · 满清可解：在浏览器里用**另一套实现**独立复算 ──────────────
     不复用 level_design.py 的结论，也不复用它的数据（只借 solveOrder 当作"解路径"）：
     逐张重算"当时是否可点"，再回放整条序列，看是否真能清空。 */
  const solPayload = JSON.stringify(DESIGN.levels.map(l => ({
    lv: l.lv,
    t: l.tiles.map(t => ({ x: t.x, y: t.y, z: t.z, r: t.rot })),
    f: l.faces.map(f => f[0] + '-' + f[1]),
    o: l.solveOrder,
  })));
  await ev(`window.__sol = ${solPayload}; 'ok'`, 60000);
  const solRaw = await ev(`(()=>{
    const AR = 4/3, TH = 0.18;
    const out = [];
    for (const L of window.__sol){
      const T = L.t, n = T.length;
      const box = t => { const hw=(t.r===90?AR:1)/2, hh=(t.r===90?1:AR)/2;
                         return [t.x-hw, t.y-hh, t.x+hw, t.y+hh]; };
      const B = T.map(box);
      const A = B.map(b => Math.max(0,b[2]-b[0]) * Math.max(0,b[3]-b[1]));
      const alive = new Array(n).fill(true);
      const ov = (a,b) => { const w=Math.min(a[2],b[2])-Math.max(a[0],b[0]),
                                h=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
                            return (w>0 && h>0) ? w*h : 0; };
      const cover = i => { let s=0; const bi=B[i];
                           for (let j=0;j<n;j++) if (alive[j] && T[j].z > T[i].z) s += ov(bi,B[j]);
                           return s / A[i]; };
      let tripleOk = true;
      for (let s=0; s+2<n; s+=3){
        const a=L.f[L.o[s]], b=L.f[L.o[s+1]], c=L.f[L.o[s+2]];
        if (!(a===b && b===c)) { tripleOk=false; break; }
      }
      let clearOk = true, failAt = -1;
      for (let k=0;k<n;k++){
        const i = L.o[k];
        if (!alive[i] || cover(i) >= TH) { clearOk=false; failAt=k; break; }
        alive[i] = false;
      }
      out.push({ lv:L.lv, n, tripleOk, clearOk, failAt });
    }
    return JSON.stringify(out);
  })()`, 180000);
  const sol = JSON.parse(solRaw);
  const solBad = sol.filter(s => !s.clearOk);
  ok(solBad.length === 0,
     `A9 满清可解（浏览器内独立复算 30 关）：${sol.length - solBad.length}/${sol.length} 关可清空` +
     solBad.slice(0, 3).map(s => ` | L${s.lv} fail@${s.failAt}`).join(''));
  ok(sol.every(s => s.tripleOk),
     `A10 消除序列连续 3 张同种（"碰"成组）逐关成立（${sol.length} 关）`);

  head('B · 跨关单调 / 难度曲线 / 均匀度');
  const nTot = DESIGN.levels.map(l => l.nTotal);
  const lay = DESIGN.levels.map(l => l.layers);
  const ws_ = DESIGN.levels.map(l => l.w);
  const cvn = DESIGN.levels.map(l => l.uni.cvNorm);
  const qb = DESIGN.levels.map(l => l.uni.qbal);
  const monoUp = a => a.every((v, i) => i === 0 || v >= a[i - 1]);
  const monoDown = a => a.every((v, i) => i === 0 || v <= a[i - 1]);
  ok(monoUp(nTot), `B1 整关张数单调不减：${nTot[0]} → ${nTot[29]}`);
  ok(monoUp(lay), `B2 单堆层数单调不减：${lay[0]} → ${lay[29]}`);
  ok(monoDown(ws_), `B3 牌宽单调不增：${ws_[0]} → ${ws_[29]}（极差 ${Math.max(...ws_) - Math.min(...ws_)}, 比值 ${(Math.max(...ws_) / Math.min(...ws_)).toFixed(2)}）`);
  ok(ws_.every(w => w >= 88 && w <= 112), `B3b 牌宽全落在 [88,112]（88 = 44pt 可点下限）`);
  ok(nTot.every(n => n % 3 === 0), `B4a 整关张数全为 3 的倍数`);
  ok(Math.max(...nTot) <= 138, `B4b 张数上限 ≤ 138（本轮由 96 提到 138 = 3×46，保证可分完）· 实测 ${Math.max(...nTot)}`);
  /* ── B5 · 分段（第 32 轮恢复：按层切、段序自顶向下、段内 ≤SEG_MAX 且 3 的倍数）── */
  const SEG_MAX = DESIGN.meta.segMax ?? 36;
  const s5 = { a: [], b: [], c: [], d: [], e: [] };
  for (const l of DESIGN.levels) {
    const tag = `L${l.lv}`;
    const sumSt = l.stages.reduce((x, y) => x + y, 0);
    if (l.nPile !== l.nTotal || sumSt !== l.nTotal
        || JSON.stringify(l.stages) !== JSON.stringify(l.segs.map(s => s.n)))
      s5.a.push(`${tag} nPile ${l.nPile}/nTotal ${l.nTotal}/Σstages ${sumSt}/segs ${JSON.stringify(l.segs.map(s => s.n))}`);
    if (!l.segs.every(s => s.n > 0 && s.n % 3 === 0 && s.n <= SEG_MAX))
      s5.b.push(`${tag} 段张数 ${JSON.stringify(l.segs.map(s => s.n))}（须为 3 的倍数且 ≤ ${SEG_MAX}）`);
    const nLay = l.segs.reduce((x, s) => x + s.layers, 0);
    if (nLay !== l.layers) s5.c.push(`${tag} Σ段层 ${nLay} ≠ 总层 ${l.layers}`);
    const his = l.segs.map(s => s.hi), los = l.segs.map(s => s.lo);
    if (l.segs[0].hi !== l.layers || los[los.length - 1] !== 0
        || JSON.stringify(his.slice(1)) !== JSON.stringify(los.slice(0, -1)))
      s5.d.push(`${tag} hi=[${his}] lo=[${los}] L=${l.layers}`);
    if (!l.segCleared) s5.e.push(`${tag} segCleared=false ${l.segMsg || ''}`);
    if (l.segs.some(s => s.openLive < 1)) s5.e.push(`${tag} 有段开局零可点`);
  }
  const nStageArr = DESIGN.levels.map(l => l.nStage);
  ok(!s5.a.length, `B5a 全堆同时在桌：nPile == nTotal 且 Σ段张数 == nTotal、段张数序列 == stages（段数 ${Math.min(...nStageArr)}~${Math.max(...nStageArr)}）${s5.a.slice(0, 2).join(' | ')}`);
  ok(!s5.b.length, `B5b 每段张数为 3 的倍数且 ≤ ${SEG_MAX}（第 1 轮拍板上限）${s5.b.slice(0, 2).join(' | ')}`);
  ok(!s5.c.length, `B5c Σ段层数 == 整关总层数（层不跨段重复计）${s5.c.slice(0, 2).join(' | ')}`);
  ok(!s5.d.length, `B5d 段序自顶向下且严丝合缝：segs[0].hi == L / segs[-1].lo == 0 / 相邻 hi==lo${s5.d.slice(0, 2).join(' | ')}`);
  ok(!s5.e.length, `B5e 段内满清可解 30/30 关 ✅ 且每段开局都有可点牌${s5.e.slice(0, 2).join(' | ')}`);

  ok(lay[0] === 2 && lay[1] === 3 && DESIGN.levels.slice(2).every(l => l.layers >= 5) && Math.max(...lay) <= 10,
     `B6 层数曲线：L1=2 / L2=3 / L3 起 ≥5 / 上限 10（实测 ${lay[0]},${lay[1]},…,${lay[29]}）`);
  ok(DESIGN.levels.every(l => l.cleared && l.nMatchOpen >= 2),
     `B7 满清可解 ✅ 且开局可凑 ≥2 组：${DESIGN.levels.filter(l => l.cleared).length}/30 关成立`
     + `（开局可凑 ${Math.min(...DESIGN.levels.map(l => l.nMatchOpen))}~${Math.max(...DESIGN.levels.map(l => l.nMatchOpen))} 组）`);
  ok(Math.max(...cvn) <= 1.25,
     `B8 均匀度：离散指数 ${Math.min(...cvn).toFixed(3)} ~ ${Math.max(...cvn).toFixed(3)}（均值 ${(cvn.reduce((a, b) => a + b, 0) / cvn.length).toFixed(3)}）全 ≤1.25，1.0 = 随机撒布`);
  /* 象限门槛按样本量放宽：象限期望仅 n/4，泊松相对噪声 ∝ √(4/n)（与 level_design.py 的 qbal_limit 同口径） */
  const qbalLim = n => n >= 60 ? 0.60 : 0.60 * Math.sqrt(60 / n);
  const qbBad = DESIGN.levels.filter(l => l.uni.qbal > qbalLim(l.nTotal) + 1e-9);
  ok(!qbBad.length,
     `B9 四象限平衡：最大不平衡 ${Math.max(...qb).toFixed(3)}（门槛按样本量放宽：n≥60 → 0.60，n<60 → 0.60·√(60/n)）`
     + `· 越限 ${qbBad.length} 关 ${qbBad.map(l => `L${l.lv}(q=${l.uni.qbal.toFixed(3)}>${qbalLim(l.nTotal).toFixed(3)})`).join(' ')}`);
  const lr = DESIGN.levels.map(l => l.nLive / l.nTotal);
  const tail = lr.slice(20);
  ok(Math.min(...tail) >= 0.14,
     `B10 ★ 后段（L21~L30）开局可点率 ${(Math.min(...tail) * 100).toFixed(1)}% ~ ${(Math.max(...tail) * 100).toFixed(1)}%，下限 ≥14%`
     + `（第 31 轮同段基线仅 7.2%~10.0% ⇒ 天际线抬升 + 层间黄金角错位的效果）`);
  const ors = DESIGN.levels.flatMap(l => l.segs.map(s => s.openRatio));
  ok(Math.min(...ors) >= 0.25,
     `B11 ★ 段内开局可点率（更上段视为已清空）${(Math.min(...ors) * 100).toFixed(1)}% ~ ${(Math.max(...ors) * 100).toFixed(1)}%（${ors.length} 段，下限 ≥25% —— 每段都是一个"有得选"的情绪单元）`);

  head('C · 真实鼠标事件交互');
  /* 点击前必须先把目标滚进视口 —— 否则 rect 落在窗口外，鼠标事件不会命中
     （第 30 关卡片在页面第 5 行，正是上一版 C2 失败的原因） */
  const cdpClick = async (sel, waitMs = 220) => {
    const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
      const r0=e.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, window.scrollY + r0.top + r0.height/2 - window.innerHeight/2));
      const r=e.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,inView:r.top>=0&&r.bottom<=window.innerHeight})})()`);
    if (!box) throw new Error('找不到元素 ' + sel);
    const { x, y, inView } = JSON.parse(box);
    await sleep(120);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
    await sleep(waitMs);
    return { x, y, inView };
  };

  await cdpClick('.card[data-lv="1"]');
  const open1 = await ev(`JSON.stringify({
    open: document.querySelector('.card[data-lv="1"]').classList.contains('open'),
    api: window.__lv.open(),
    layBoxes: document.querySelectorAll('.card[data-lv="1"] .layBox').length,
    layTiles: [...document.querySelectorAll('.card[data-lv="1"] .lStage')].reduce((a,b)=>a+b.querySelectorAll('.tk').length,0),
    bigTiles: document.querySelectorAll('.card[data-lv="1"] .bStage > .tk').length
  })`);
  const o1 = JSON.parse(open1);
  const d1 = byLv.get(1);
  ok(o1.open && o1.api === 1, `C1a 真实点击第 1 关卡片 → 展开（class=open, __lv.open()=${o1.api}）`);
  ok(o1.layBoxes === d1.layers, `C1b 逐层条层数 ${o1.layBoxes} == 设计层数 ${d1.layers}`);
  ok(o1.layTiles === d1.nPile && o1.bigTiles === d1.nPile,
     `C1c 放大视图 ${o1.bigTiles} 张 / 逐层条合计 ${o1.layTiles} 张 == 单堆 ${d1.nPile} 张`);

  const click30 = await cdpClick('.card[data-lv="30"]');
  const open30 = await ev(`JSON.stringify({
    open: document.querySelector('.card[data-lv="30"]').classList.contains('open'),
    layBoxes: document.querySelectorAll('.card[data-lv="30"] .layBox').length,
    layTiles: [...document.querySelectorAll('.card[data-lv="30"] .lStage')].reduce((a,b)=>a+b.querySelectorAll('.tk').length,0),
    bigTiles: document.querySelectorAll('.card[data-lv="30"] .bStage > .tk').length
  })`);
  const o30 = JSON.parse(open30);
  const d30 = byLv.get(30);
  ok(o30.open && o30.layBoxes === d30.layers && o30.layTiles === d30.nPile && o30.bigTiles === d30.nPile,
     `C2 真实点第 30 关（inView=${click30.inView}）：展开 · 逐层条 ${o30.layBoxes} 层 / 合计 ${o30.layTiles} 张 · 放大 ${o30.bigTiles} 张 == 设计 ${d30.layers} 层 / ${d30.nPile} 张`);

  await cdpClick('#cLive');
  const v = JSON.parse(await ev(`(()=>{
    let n=0,live=0;
    for(const c of document.querySelectorAll('.card')){
      for(const t of c.querySelectorAll('.mStage > .tk')){
        if(getComputedStyle(t).display !== 'none') n++;
        if(t.dataset.live==='1') live++;
      }
    }
    return JSON.stringify({visible:n, live});
  })()`));
  const designLive = DESIGN.levels.reduce((a, l) => a + l.nLive, 0);
  const designAll = DESIGN.levels.reduce((a, l) => a + l.tiles.length, 0);
  ok(v.live === designLive && v.visible === designLive,
     `C3 勾「只留开局可点」→ 概览可见 ${v.visible} 张 == 设计可点合计 ${designLive} 张（原 ${designAll} 张）`);

  await cdpClick('#cLayer');
  const layTags = JSON.parse(await ev(`JSON.stringify({
    mini: document.querySelectorAll('.mStage .lay').length,
    big: document.querySelectorAll('.bStage .lay').length,
    cards: document.querySelectorAll('.card.open').length
  })`));
  ok(layTags.mini === designAll && layTags.big === d1.nPile + d30.nPile && layTags.cards === 2,
     `C4 勾「显示层号」→ 概览层号 ${layTags.mini} 个 == 全部 ${designAll} 张；两张展开卡的放大视图 ${layTags.big} 个 == ${d1.nPile}+${d30.nPile}`);

  await cdpClick('#cFace');
  const nf = JSON.parse(await ev(`JSON.stringify({ imgs: document.querySelectorAll('.card .tk img').length, tiles: document.querySelectorAll('.card .tk').length })`));
  ok(nf.imgs === 0 && nf.tiles >= designAll,
     `C5 取消「显示牌面」→ 页内 <img> ${nf.imgs} 个（应为 0），牌体壳仍有 ${nf.tiles} 个`);

  head('D · 运行期');
  ok(errs.length === 0, `D1 运行期零 JS 异常（捕获 ${errs.length} 条）${errs.slice(0, 2).join(' | ')}`);

  console.log(`\n${'='.repeat(84)}`);
  console.log(`结果：${pass}/${pass + fail} 通过${fail ? ` · ❌ ${fail} 项未过` : ' · 全绿 ✅'}`);
  console.log('='.repeat(84));
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('运行失败：', e.message);
  process.exitCode = 2;
} finally {
  try { ws?.close(); } catch { }
  chrome.kill('SIGKILL');
  await sleep(250);
  fs.rmSync(dir, { recursive: true, force: true });
}
