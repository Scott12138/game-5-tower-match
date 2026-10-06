/**
 * 主玩页牌堆 · 真实关卡数据核校（第 32 轮 · #168 / #169）
 *
 * 背景：用户第 32 轮第 4 / 5 条拍板 ——
 *   ④ 主玩页演示档位必须**跟随真实牌数**变化（旧版写死 36 / 12 / 96，与关卡表脱钩）
 *   ⑤ **单关内每张牌的尺寸（大小 + 长宽比）必须一致**；跨关可调，单关内必须统一
 *      （补充口径：横竖两朝向保留，但**横牌旋转 90° 后必须与竖牌严格同尺寸**）
 *
 * 本脚本用**真实鼠标事件**驱动 #bPile 切换三个真实演示关卡，逐关对账：
 *   ① 卡位数 == levels.json 的 nTotal；层数 == layers
 *   ② ★ 单关内尺寸唯一：getBoundingClientRect 换算出的尺寸集合恒为 1 个 = {w×h}
 *   ③ ★ 横牌 = 纯旋转（本次的核心新增断言，三层证据）：
 *        (a) **布局盒** offsetWidth/offsetHeight 对**所有**牌恒为 w×h（横牌也一样）
 *            —— 旧版 bug 正是把横牌换成 h×w 再把 img 拉成 100%×100% ⇒ 牌面横向拉伸 1.33 倍
 *        (b) **变换矩阵** 是纯旋转：matrix(a,b,c,d,e,f) 满足 √(a²+b²)=1、e=f=0、行列式=1
 *            （无 scale、无 translate；rotate(90deg) ⇒ a≈0,b≈1,c≈-1,d≈0）
 *        (c) **可见外框** rect 恰好宽高互换（w×h ↔ h×w），面积相等 —— 正是"纯旋转"的定义
 *   ④ 逐张卡位对账：DOM 的 style.left/top 反算回「相对安全区中心的 px」，
 *      与 levels.json 的 px/py 逐张比对（容差 0.2px）
 *   ⑤ 可点 / 被压 == levels.json 的 nLive；并用**独立几何复算**（累加更高层重叠 ≥ 18%）对账
 *   ⑥ 牌堆仍完全落在安全区 682×682 内、不压底带
 *   ⑦ 跨关牌宽**单调不增**（关卡表曲线口径：层越多牌越小）
 *   ⑧ 运行期零 JS 异常；顺带每关出「真母版 / 矢量」两张实机截图
 *
 * ★★ 测量纪律（沿用第 28 轮踩坑）★★
 *   `scrollIntoView` 会连带滚动 `overflow:hidden` 的 `.frame` 手机壳，导致 `(r.top - sc.top)/SC`
 *   凭空差 20px —— 在安全区纵向只剩几 px 余量的关卡上会造出**假的越界失败**。
 *   → (1) 点击只滚 window，不碰 `.frame`；(2) 每次测量前强制 `.frame`.scrollTop = 0 并断言。
 *
 * 为什么必须真实事件：本项目既有教训 —— 截图 + 直接调函数会绕过事件层。
 * CDP 三重超时（命令 30s / 握手 10s / 端口 60s）：本机出现过握手静默挂死。
 *
 * 用法：node verify_pile_geometry.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const OUT = path.join(ROOT, 'docs-verify/game-5/game-play');
const PORT = 9363;
const PAGE = 'file://' + path.join(ROOT, 'game-5-主玩页-排版.html').split('/').map(encodeURIComponent).join('/');
const LEVELS = path.join(OUT, 'levels.json');
const JSON_OUT = path.join(OUT, 'pile-geometry.json');

/* ★ 第 33 轮改口径（L1 + L4）：画布 192×256 → **224×298**，占位 `OCC_H 0.804 → 1.0`（内切 contain）。
   旧值「条/筒 恒 144×206 / 192×256」已作废。内切下**没有单一比例**（宽或高必有一边贴满）：
     · 条 / 筒（18/27 张，多数）→ 可见 208×298 ⇒ W 0.9286 / H 1.0000   ← 取此为代表值
     · 万字（9/27 张）          → 宽贴满 224 × 高 273~298 ⇒ W 1.0000 / H 0.916~1.0
   本比值只用于**报告**「层间可视重合」，不参与任何断言（可见性判定一律按**盒** W×H，未变）。 */
const BODY_W_RATIO = 208 / 224;   // 0.9286（条/筒代表值）
const BODY_H_RATIO = 298 / 298;   // 1.0000
const COVER_TH = 0.18;            // 与页内一致
const SAFE = { x: 34, y: 326, r: 716, b: 1008 };

const lvData = JSON.parse(fs.readFileSync(LEVELS, 'utf8'));
const byLv = new Map(lvData.levels.map(l => [l.lv, l]));

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log('✅ ' + msg)) : (fail++, console.log('❌ ' + msg)); };
const note = msg => console.log('   ' + msg);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-pile-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=1400,1700', PAGE,
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;

const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时(${ms}ms)：${method}`)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function main() {
try {
  let targets = null, lastErr = null;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const all = (await r.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      targets = all.filter(t => (t.url || '').startsWith('file://'));
      if (!targets.length) targets = all;
      if (targets.length) break;
      lastErr = new Error('端口已开但暂无 page target');
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  if (!targets?.length) throw new Error(`devtools 未就绪 · ${lastErr?.message || lastErr}`);

  const wsUrl = targets[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('WebSocket 握手超时(10s)')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = e => { clearTimeout(t); rej(new Error('WebSocket 握手失败：' + (e?.message || 'non-101'))); };
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej, t } = pending.get(m.id); pending.delete(m.id); clearTimeout(t);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') { events.push(m); }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await sleep(2200);

  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('求值失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  /* ★ 只滚 window，绝不碰 .frame（.frame 是 overflow:hidden 的手机壳，scrollIntoView 会把它滚起来） */
  const clickSel = async (sel, waitMs = 600) => {
    const r = JSON.parse(await evalJS(`(() => {
      const e = document.querySelector('${sel}');
      let b = e.getBoundingClientRect();
      const vh = window.innerHeight, pad = 24;
      if (b.bottom > vh - pad) window.scrollBy(0, b.bottom - vh + pad);
      else if (b.top < pad) window.scrollBy(0, b.top - pad);
      b = e.getBoundingClientRect();
      return JSON.stringify({x:b.left+b.width/2, y:b.top+b.height/2});
    })()`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
    await sleep(50);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      await sleep(40);
    }
    await sleep(waitMs);
    return r;
  };

  // 进 play（载入时是赠礼过场，会盖住主界面）
  await clickSel('#btnStart', 1800);
  const phase = await evalJS('phase');
  ok(phase === 'play', `真实点「开始挑战」→ phase=${phase}`);

  /* 页内注入的演示关卡（应与 levels.json 派生的 DEMO_TIERS 一致） */
  const demo = JSON.parse(await evalJS(`JSON.stringify(PILE_DATA.levels.map(l => ({
    lv:l.lv, name:l.name, n:l.n, L:l.L, w:l.w, h:l.h, nl:l.nl, st:l.st })))`));
  note(`页内演示关卡：${demo.map(d => `${d.name}(L${d.lv}) ${d.n}张/${d.L}层/${d.w}x${d.h}`).join(' · ')}`);
  ok(demo.length >= 2, `页内注入演示关卡 ${demo.length} 关（≥2）`);

  const measure = async () => JSON.parse(await evalJS(`(() => {
    /* ★ 测量前先把手机壳容器的滚动复位（点击时可能被带上）——复位后读 rect 会强制重排 */
    const frame = document.querySelector('.frame');
    const frameScrollBefore = frame.scrollTop;
    if (frameScrollBefore) frame.scrollTop = 0;

    const sc = $('screen').getBoundingClientRect();
    const S = v => +((v) / SC).toFixed(1);
    const bx = __mp.pileBox();
    const lv = __mp.live();
    const tiles = [...document.querySelectorAll('#pile .tile')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; });

    /* ① 可见外框尺寸集合（rect，旋转后宽高会互换）—— 分竖 / 横两组
       注：offsetWidth/offsetHeight 是**未受祖先 transform 影响**的 CSS px，
           而本例整页是用 scale(var(--sc)) 缩放的，故 offsetWidth 恰 = 设计 px（与关卡表 w/h 同口径）。
           rect 则是缩放后的 px，除回 SC 才是设计 px。两条通道分别验：布局盒用 offset，外框用 rect。 */
    const rectsOf = els => [...new Set(els.map(el => { const r = el.getBoundingClientRect();
      return S(r.width) + 'x' + S(r.height); }))];
    /* ② 布局盒尺寸集合（旋转不影响）—— 判"单关尺寸唯一"的真凭据 */
    const boxSizes = [...new Set(tiles.map(el => el.offsetWidth + 'x' + el.offsetHeight))];
    /* ③ 变换矩阵分解：判"纯旋转（无 scale / 无 translate）" */
    const mat = el => {
      const t = getComputedStyle(el).transform;
      if (t === 'none') return { none:true, a:1,b:0,c:0,d:1,e:0,f:0 };
      const m = t.match(/matrix\\(([^)]+)\\)/);
      if (!m) return { bad:t };
      const [a,b,c,d,e,f] = m[1].split(',').map(Number);
      return { none:false, a,b,c,d,e,f,
        sx:+Math.hypot(a,b).toFixed(6), sy:+Math.hypot(c,d).toFixed(6),
        det:+(a*d-b*c).toFixed(6) };
    };

    const cross = tiles.filter(el => +el.dataset.r === 90);
    const upright = tiles.filter(el => +el.dataset.r === 0);
    const deg = m => m.none ? 0 : +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(2);

    /* ④ 逐张卡位反算：style.left/top → 「相对安全区中心的 px」（与 levels.json 的 px/py 同口径）
       注：PILE_CX / PILE_CY 是脚本顶层 const（全局词法绑定，故用裸标识符而不是 window.PILE_CX） */
    const lv0 = PILE_DATA.levels[pileIdx];
    const pos = tiles.map(el => ({ i:+el.dataset.idx,
      x:+(parseFloat(el.style.left) - PILE_CX + lv0.w/2).toFixed(2),
      y:+(parseFloat(el.style.top)  - PILE_CY + lv0.h/2).toFixed(2),
      z:+el.dataset.z, r:+el.dataset.r, live:el.classList.contains('live') }));

    const layers = {}; tiles.forEach(el => { const L = +el.dataset.z; layers[L] = (layers[L]||0)+1; });
    const W = boxSizes.length === 1 ? +boxSizes[0].split('x')[0] : 0;
    const H = boxSizes.length === 1 ? +boxSizes[0].split('x')[1] : 0;
    const bw = W * ${BODY_W_RATIO}, bh = H * ${BODY_H_RATIO};
    const Ls = Object.keys(layers).map(Number).sort((a,b)=>a-b);
    let visualOverlap = null, stepX = null, stepY = null;
    if (Ls.length >= 2) {
      const lo = {}, hi = {};
      const fold = (acc, el) => { const r = el.getBoundingClientRect();
        acc.minX = Math.min(acc.minX ?? 1e9, S(r.left - sc.left)); acc.maxX = Math.max(acc.maxX ?? -1e9, S(r.right - sc.left));
        acc.minY = Math.min(acc.minY ?? 1e9, S(r.top - sc.top));   acc.maxY = Math.max(acc.maxY ?? -1e9, S(r.bottom - sc.top)); };
      tiles.forEach(el => { const z = +el.dataset.z;
        if (z === Ls[Ls.length-2]) fold(lo, el); if (z === Ls[Ls.length-1]) fold(hi, el); });
      stepX = +(hi.minX - lo.minX).toFixed(1); stepY = +(hi.minY - lo.minY).toFixed(1);
      const ow = Math.max(0, bw - stepX), oh = Math.max(0, bh - stepY);
      visualOverlap = +((ow*oh)/(bw*bh)).toFixed(4);
    }

    /* ⑤ 独立几何复算（累加所有更高层重叠面积 ≥ 18% 判死）—— 与页内 t.c 口径对账 */
    const boxes = tiles.map(el => ({ z:+el.dataset.z,
      x:parseFloat(el.style.left), y:parseFloat(el.style.top) }));
    const area = W * H;
    let ruleLive = 0, maxLive = 0; const splitDead = [];
    boxes.forEach((a,i) => {
      let sum = 0, mx = 0; const parts = [];
      boxes.forEach((b,j) => {
        if(i === j || b.z <= a.z) return;
        const ow = Math.min(a.x+W, b.x+W) - Math.max(a.x, b.x);
        const oh = Math.min(a.y+H, b.y+H) - Math.max(a.y, b.y);
        if(ow > 0 && oh > 0){ const ar = ow*oh; sum += ar; if(ar > mx) mx = ar;
          parts.push({ z:b.z, pct:+(ar/area*100).toFixed(1) }); }
      });
      if(!(sum >= area * ${COVER_TH})) ruleLive++;
      if(!(mx >= area * ${COVER_TH})) maxLive++;
      if(sum >= area * ${COVER_TH} && mx < area * ${COVER_TH}) splitDead.push({ i, z:a.z,
        pts:parts, sumPct:+(sum/area*100).toFixed(1) });
    });

    return JSON.stringify({
      idx: pileIdx, lv: lv0.lv, name: lv0.name,
      pile: __mp.pile(), live: lv.live, dead: lv.dead,
      measured: bx.measured, minX:bx.minX, minY:bx.minY, maxX:bx.maxX, maxY:bx.maxY,
      insideSafe: bx.insideSafe, clearOfBand: bx.clearOfBand,
      boxSizes, W, H, bw:+bw.toFixed(1), bh:+bh.toFixed(1),
      uprightRects: rectsOf(upright), crossRects: rectsOf(cross),
      stepX, stepY, visualOverlap, mode: faceMode,
      logicalOverlap: (stepX !== null && W) ? +((Math.max(0,W-stepX)*Math.max(0,H-stepY))/(W*H)).toFixed(4) : null,
      nCross: cross.length, nUpright: upright.length,
      crossMats: cross.slice(0,4).map(el => ({ deg:deg(mat(el)), ...mat(el) })),
      crossBoxes: [...new Set(cross.map(el => el.offsetWidth + 'x' + el.offsetHeight))],
      uprightBoxes: [...new Set(upright.map(el => el.offsetWidth + 'x' + el.offsetHeight))],
      allMatsPure: tiles.every(el => { const m = mat(el); return m.none || (Math.abs(m.sx-1)<1e-4 && Math.abs(m.sy-1)<1e-4 && Math.abs(m.det-1)<1e-4 && m.e===0 && m.f===0); }),
      pos, layers, layerCount: Ls.length,
      cover: { ruleLive, maxLive, splitDead },
      mPile: $('mPile').textContent.trim(),
      lvNum: $('lvNum').textContent.trim(), clrN: $('clrN').textContent.trim(), clrM: $('clrM').textContent.trim(),
      segs: lv0.st, frameScrollBefore
    });
  })()`));

  const clipScreen = async name => {
    const r = JSON.parse(await evalJS(`(() => { const b = $('screen').getBoundingClientRect();
      return JSON.stringify({x:b.left, y:b.top, width:b.width, height:b.height}); })()`));
    const shot = await send('Page.captureScreenshot', { format: 'png',
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    return p;
  };

  const rows = [];
  let prevW = Infinity;

  for (const d of demo) {
    /* 用真实点击把档位切到该关（#bPile 是 (pileIdx+1) % N 循环） */
    for (let guard = 0; guard < demo.length + 2; guard++) {
      if (await evalJS('PILE_DATA.levels[pileIdx].lv') === d.lv) break;
      await clickSel('#bPile', 900);
    }
    if (await evalJS('faceMode') !== 'img') await clickSel('#bFace', 800);

    const m = await measure();
    const ref = byLv.get(d.lv);
    const shots = {};
    shots.img = await clipScreen(`59-主玩页牌堆-L${d.lv}-真母版.png`);

    console.log(`\n──────── ${d.name}（L${d.lv}）────────`);
    ok(m.idx === demo.indexOf(d) && m.lv === d.lv,
       `真实点「牌堆」切到 L${d.lv}（pileIdx=${m.idx} · 侧栏「${m.mPile}」）`);
    ok(m.pile === ref.nTotal && m.measured === ref.nTotal,
       `  张数 = 关卡表 nTotal = ${ref.nTotal}（页内 pileCount=${m.pile} · 实际渲染 ${m.measured} 张）`);
    ok(m.layerCount === ref.layers,
       `  层数 = 关卡表 layers = ${ref.layers}（实测 ${m.layerCount} 层：${JSON.stringify(m.layers)}）`);

    /* ★ 第 5 条：单关内尺寸唯一（三条证据） */
    ok(m.boxSizes.length === 1 && m.boxSizes[0] === `${ref.w}x${ref.h}`,
       `  ★ 单关尺寸唯一·布局盒：全部 ${ref.nTotal} 张 offsetWidth×offsetHeight 集合 = ${JSON.stringify(m.boxSizes)}（应只有 ${ref.w}x${ref.h}）`);
    const near = (str, a, b, tol = 0.6) => {
      const [x, y] = str.split('x').map(Number);
      return Math.abs(x - a) <= tol && Math.abs(y - b) <= tol;
    };
    ok(m.uprightRects.every(s => near(s, ref.w, ref.h)),
       `  ★ 竖牌可见外框（rect 换算回设计 px）= ${JSON.stringify(m.uprightRects)}（应 ${ref.w}x${ref.h} ±0.6）`);
    ok(Math.abs(ref.h / ref.w - 4 / 3) < 0.01,
       `  长宽比唯一 h/w = ${(ref.h / ref.w).toFixed(4)}（= 4/3 ± 0.01）`);

    /* ★ 第 5 条补充口径：横牌 = 纯旋转，与竖牌严格同尺寸 */
    ok(m.nCross > 0, `  含横牌 ${m.nCross} 张 / 竖牌 ${m.nUpright} 张（两朝向均保留）`);
    ok(m.crossBoxes.length === 1 && m.crossBoxes[0] === `${ref.w}x${ref.h}`,
       `  ★ 横牌布局盒 = 竖牌布局盒 = ${JSON.stringify(m.crossBoxes)}（旧 bug 会变成 ${ref.h}x${ref.w}）`);
    ok(JSON.stringify(m.crossBoxes) === JSON.stringify(m.uprightBoxes),
       `  ★ 横牌与竖牌**严格同尺寸**：横 ${JSON.stringify(m.crossBoxes)} vs 竖 ${JSON.stringify(m.uprightBoxes)}`);
    const crossDeg = m.crossMats.map(c => c.deg);
    ok(crossDeg.every(g => Math.abs(Math.abs(g) - 90) < 0.01),
       `  ★ 横牌变换 = rotate(±90°)：实测 ${JSON.stringify(crossDeg)}（矩阵 ${JSON.stringify(m.crossMats[0] && {a:m.crossMats[0].a,b:m.crossMats[0].b,c:m.crossMats[0].c,d:m.crossMats[0].d})}）`);
    ok(m.allMatsPure,
       `  ★ 全部牌变换为**纯旋转**（无 scale / 无 translate：√(a²+b²)=1 且 det=1 且 e=f=0）`);
    ok(m.crossRects.length === 1 && m.crossRects.every(s => near(s, ref.h, ref.w)),
       `  ★ 横牌可见外框恰好宽高互换 = ${JSON.stringify(m.crossRects)}（应 ${ref.h}x${ref.w} ⇒ 面积与 ${ref.w}x${ref.h} 严格相等 = 纯旋转的定义）`);

    /* ④ 逐张卡位对账 */
    let maxDX = 0, maxDY = 0, nMis = 0;
    for (const p of m.pos) {
      const t = ref.tiles[p.i];
      const dx = Math.abs(p.x - t.px), dy = Math.abs(p.y - t.py);
      maxDX = Math.max(maxDX, dx); maxDY = Math.max(maxDY, dy);
      if (dx > 0.2 || dy > 0.2 || p.z !== t.z || p.r !== t.rot) nMis++;
    }
    ok(nMis === 0,
       `  逐张卡位对账：${ref.nTotal} 张全部命中关卡表（最大偏差 x ${maxDX.toFixed(3)}px / y ${maxDY.toFixed(3)}px ≤ 0.2px；层号/朝向错配 ${nMis} 张）`);

    /* ⑤ 可点 / 被压 */
    ok(m.live === ref.nLive && m.dead === ref.nTotal - ref.nLive,
       `  可点 / 被压 = ${m.live} / ${m.dead}（关卡表 nLive=${ref.nLive} · 可点率 ${(100*ref.nLive/ref.nTotal).toFixed(1)}%）`);
    ok(m.cover.ruleLive === m.live,
       `  独立几何复算可点数 = ${m.cover.ruleLive}（与页内一致）`);

    /* 主玩页注入数据 == levels.json 原值 */
    ok(d.n === ref.nTotal && d.L === ref.layers && d.w === ref.w && d.h === ref.h && d.nl === ref.nLive
       && JSON.stringify(d.st) === JSON.stringify(ref.stages),
       `  页内注入数据与 levels.json **逐值一致**（n=${d.n} L=${d.L} ${d.w}x${d.h} nl=${d.nl} 分段=${JSON.stringify(d.st)}）`);

    /* ★ 顶带也必须跟着真实关卡走（旧版写死「第 3 关」+ 36 张，切档时只有侧栏变 ⇒ 自相矛盾） */
    ok(m.lvNum === String(ref.lv) && m.clrM === String(ref.nTotal) && m.clrN === String(Math.round(ref.nTotal * 0.42)),
       `  顶带同步真实关卡：关卡号 ${m.lvNum}（应 ${ref.lv}）· 已清 ${m.clrN}/${m.clrM}（应 ${Math.round(ref.nTotal*0.42)}/${ref.nTotal}）`);

    /* ⑥ 安全区 */
    ok(m.insideSafe,
       `  完全落在安全区 682×682 内（x ${m.minX}~${m.maxX} / y ${m.minY}~${m.maxY}；余量 上 ${(m.minY-SAFE.y).toFixed(1)} / 下 ${(SAFE.b-m.maxY).toFixed(1)} / 左 ${(m.minX-SAFE.x).toFixed(1)} / 右 ${(SAFE.r-m.maxX).toFixed(1)}）`);
    ok(m.clearOfBand, `  不压底带（maxY=${m.maxY} ≤ 1042）`);

    /* ⑦ 跨关牌宽单调不增 */
    ok(ref.w <= prevW, `  跨关牌宽单调不增：${prevW === Infinity ? '—' : prevW + ' → '}${ref.w}`);
    prevW = ref.w;

    note(`  可见牌体 ${m.bw}×${m.bh}（布局盒 ${ref.w}×${ref.h} × ${(BODY_W_RATIO*100).toFixed(1)}% / ${(BODY_H_RATIO*100).toFixed(1)}%）`
       + (m.stepX !== null ? ` · 最下两层包围盒错位 ${m.stepX},${m.stepY}（层间黄金角错位 R 生效 ⇒ 该值不再等于"层间距"，仅作旁证）` : ' · 单层'));
    note(`  分段（自顶向下）${JSON.stringify(m.segs)} ｜ 帧滚动复位 ${m.frameScrollBefore} → 0`);
    if (m.cover.splitDead.length) {
      note(`  ⚠ 「多张各压一点、累加越 18%」被判死 ${m.cover.splitDead.length} 张：`
        + m.cover.splitDead.slice(0,3).map(x => `#${x.i}(层${x.z}) 累加 ${x.sumPct}%`).join('；'));
    }

    /* 矢量模式对照（证明牌面模式不影响几何） */
    await clickSel('#bFace', 800);
    const mSvg = await measure();
    shots.svg = await clipScreen(`59-主玩页牌堆-L${d.lv}-矢量.png`);
    ok(mSvg.mode === 'svg', `  [对照] 真实点「牌面」→ ${mSvg.mode} 模式`);
    ok(mSvg.boxSizes[0] === m.boxSizes[0] && mSvg.crossBoxes[0] === m.crossBoxes[0]
       && mSvg.minX === m.minX && mSvg.maxX === m.maxX && mSvg.minY === m.minY && mSvg.maxY === m.maxY
       && mSvg.live === m.live,
       `  [对照] 矢量模式几何与真母版**逐值一致**（布局盒 ${mSvg.boxSizes[0]} · 横牌 ${mSvg.crossBoxes[0]} · 可点 ${mSvg.live}）`);
    await clickSel('#bFace', 800);

    rows.push({ lv: d.lv, name: d.name, ref: { n: ref.nTotal, L: ref.layers, w: ref.w, h: ref.h, nl: ref.nLive, st: ref.stages },
      img: m, svg: mSvg, shots: { img: path.basename(shots.img), svg: path.basename(shots.svg) } });
  }

  ok(events.length === 0, `运行期 JS 异常 ${events.length} 条`);

  /* ── 汇总表 ── */
  console.log('\n【主玩页真实牌堆档位汇总 · 真母版模式】');
  console.log('关卡 | 张数 | 层 | 尺寸(布局盒) | 横/竖 | 可点/被压 | 可点率 | 分段(自顶向下) | 安全区余量 上/下/左/右');
  for (const r of rows) {
    const m = r.img, R = r.ref;
    console.log(` L${String(r.lv).padStart(2)} | ${String(R.n).padStart(4)} | ${String(R.L).padStart(2)} | `
      + `${String(R.w + '×' + R.h).padEnd(12)} | ${String(m.nCross).padStart(2)}/${String(m.nUpright).padStart(3)} | `
      + `${String(R.nl).padStart(2)} / ${String(R.n - R.nl).padStart(2)}     | ${(100*R.nl/R.n).toFixed(1).padStart(5)}% | `
      + `${JSON.stringify(R.st).padEnd(18)} | ${(m.minY-SAFE.y).toFixed(1)}/${(SAFE.b-m.maxY).toFixed(1)}/${(m.minX-SAFE.x).toFixed(1)}/${(SAFE.r-m.maxX).toFixed(1)}`);
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify({
    at: new Date().toISOString(),
    ratios: { BODY_W_RATIO, BODY_H_RATIO, COVER_TH },
    rows: rows.map(r => ({ lv: r.lv, name: r.name, ref: r.ref, img: r.img, svg: r.svg, shots: r.shots })),
  }, null, 2));
  console.log(`\n测量明细 JSON：${path.relative(ROOT, JSON_OUT)}`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
}

console.log('════ 主玩页牌堆 · 真实关卡数据核校（第 32 轮 · 真实鼠标事件 · 帧滚动已复位）════');
main().then(() => {
  console.log(`\n断言 ${pass}/${pass + fail} 通过；运行期异常 ${events.length} 条`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('执行失败：', e.message); process.exit(1); });
