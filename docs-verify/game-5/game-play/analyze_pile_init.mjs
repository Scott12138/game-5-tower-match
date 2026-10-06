/**
 * 牌堆初始化现状体检（第 29 轮）
 *
 * 目的：把用户报的「牌的摆放太有规律、显得很假」**量化**成可对齐的数字，
 *      并顺带体检**发牌是否可解**（这是"牌堆初始化方案"的另一半 ——
 *      羊了个羊的核心不只是位置，还有"每种牌的数量必为 3 的倍数"）。
 *
 * 只读：不改页面、不写产物。纯 Node，零依赖。
 * 用法：node analyze_pile_init.mjs
 */

/* ── 与页面逐字同源的 RNG（scramble + LCG）────────────────────────── */
function scramble(x) {
  x = (x >>> 0) + 0x9E3779B9;
  x ^= x >>> 16; x = Math.imul(x, 0x85EBCA6B) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35) >>> 0;
  x ^= x >>> 16; return x >>> 0;
}
function makeRng(seed) {
  let s = scramble(seed) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* ── 与页面逐字同源的牌堆生成（第 29 轮修正版：只从 DECK 抽）────────── */
const SUITS = ['wan', 'tiao', 'tong'];
const DECK = [];
for (const k of SUITS) for (let n = 1; n <= 9; n++) DECK.push({ k, n });

const COL_STEP = { 36: 128, 12: 128, 96: 108 };
const ROW_STEP = { 36: 150, 12: 150, 96: 116 };
const LAYER_OFF = { 36: 46, 12: 46, 96: 34 };

function buildPile(count) {
  const rng = makeRng(20261005);
  const mk = () => DECK[Math.floor(rng() * DECK.length) % DECK.length];
  let perLayer, layers;
  if (count <= 12) { layers = 1; perLayer = 12; }
  else if (count <= 36) { layers = 3; perLayer = 12; }
  else { layers = 4; perLayer = 25; }
  const cols = count > 36 ? 5 : 4;
  const rows = count > 36 ? 5 : 3;
  const out = [];
  for (let L = 0; L < layers; L++) {
    for (let i = 0; i < perLayer; i++) {
      if (out.length >= count) break;
      const c = i % cols, r = Math.floor(i / cols) % rows;
      out.push({ ...mk(), L, c, r, z: L, cols, rows, layers });
    }
  }
  return out;
}

/* ── ① 几何规律度 ─────────────────────────────────────────────── */
function geometryReport(count) {
  const list = buildPile(count);
  const cs = COL_STEP[count], rs = ROW_STEP[count], off = LAYER_OFF[count];
  const pos = list.map(t => ({ x: t.c * cs + t.L * off, y: t.r * rs + t.L * off, z: t.z, L: t.L }));

  // 相邻牌（同层）之间出现的位移向量种类
  const vecs = new Set();
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if (i === j || pos[i].L !== pos[j].L) continue;
      vecs.add((pos[i].x - pos[j].x) + ',' + (pos[i].y - pos[j].y));
    }
  }
  // 每层的 x/y 坐标集合（看层与层是否只是整体平移）
  const perLayer = {};
  for (const p of pos) (perLayer[p.L] ||= []).push([p.x, p.y]);
  const layerShapes = Object.entries(perLayer).map(([L, arr]) => {
    const xs = [...new Set(arr.map(a => a[0]))].sort((a, b) => a - b);
    const ys = [...new Set(arr.map(a => a[1]))].sort((a, b) => a - b);
    return { L: +L, n: arr.length, xs, ys, spanX: xs.at(-1) - xs[0], spanY: ys.at(-1) - ys[0] };
  });
  // 层间偏移是否恒定
  const deltas = [];
  for (let k = 1; k < layerShapes.length; k++) {
    deltas.push([layerShapes[k].xs[0] - layerShapes[k - 1].xs[0], layerShapes[k].ys[0] - layerShapes[k - 1].ys[0]]);
  }
  return { count, tiles: list.length, uniqueOffsets: vecs.size, layerShapes, layerDeltas: deltas,
           rotations: [...new Set(list.map(t => t.rot || 0))] };
}

/* ── ② 发牌可解性（碰 = 三张同；吃 = 同花色连号三张）────────────────
   ★ 精确解，不是估算。关键在于**问题天然按花色分解**：
      · 「碰」只涉及同一种牌 → 该种牌属于唯一花色；
      · 「吃」只涉及同一花色的三个连号；
      ⇒ 三个花色互不干涉，各自 9 个计数 + 7 个「吃」档 → 每花色只有 3^7 = 2187 种组合。
   枚举某花色「吃」各用几张（0/1/2），剩下的张数**必须都是 3 的倍数**才能全用「碰」消化；
   于是该花色的最大组数 = Σ吃 + Σ(剩余/3)。三花色求和即全局最大。
   若这个最大值 < 总张数/3 ⇒ **这局无论在怎么打都清不完**（与玩家水平无关）。 */
function maxTriplesExact(tiles) {
  const cnt = new Map();
  for (const t of tiles) {
    const key = t.k + '-' + t.n;
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  let best = 0;
  const detail = {};
  for (const k of SUITS) {
    const c = [];
    for (let n = 1; n <= 9; n++) c.push(cnt.get(k + '-' + n) || 0);
    /* 第 s 档「吃」最多能用几次 = 它涉及的三张牌里最少的那一张的张数。
       ⚠ 不能卡在 2：三张都够时同一档「吃」用 3 次是合法的（等价于三组连号），卡 2 会低估。 */
    const cap = [];
    for (let s = 0; s < 7; s++) cap.push(Math.min(c[s], c[s + 1], c[s + 2]));
    let local = 0, plan = { eat: 0, peng: 0, x: new Array(7).fill(0), leftover: 0 };
    const x = new Array(7).fill(0);
    const walk = s => {
      if (s === 7) {
        const used = new Array(9).fill(0);
        for (let i = 0; i < 7; i++) for (let d = 0; d < 3; d++) used[i + d] += x[i];
        let peng = 0, leftover = 0;
        for (let n = 0; n < 9; n++) {
          const rem = c[n] - used[n];
          if (rem < 0) return;
          peng += Math.floor(rem / 3);
          leftover += rem % 3;
        }
        let eat = 0;
        for (let i = 0; i < 7; i++) eat += x[i];
        if (eat + peng > local) { local = eat + peng; plan = { eat, peng, x: x.slice(), leftover }; }
        return;
      }
      for (let v = 0; v <= cap[s]; v++) { x[s] = v; walk(s + 1); }
    };
    walk(0);
    detail[k] = { counts: c, ...plan };
    best += local;
  }
  const clearedTiles = best * 3;
  return { triples: best, clearedTiles, detail, fullClear: clearedTiles === tiles.length };
}

console.log('════ 牌堆初始化现状体检（第 29 轮）════\n');
for (const count of [12, 36, 96]) {
  const g = geometryReport(count);
  const list = buildPile(count);
  const hist = new Map();
  for (const t of list) hist.set(t.k + '-' + t.n, (hist.get(t.k + '-' + t.n) || 0) + 1);
  const m = maxTriplesExact(list);
  console.log(`── ${count} 档 ─────────────────────────────`);
  console.log(`  张数 ${g.tiles} · 层数 ${g.layerShapes.length}`);
  console.log(`  ★ 朝向取值集合 = ${JSON.stringify(g.rotations)}  ← 只有 0°（全部正放，无一张歪着）`);
  console.log(`  ★ 同层两两位移向量只有 ${g.uniqueOffsets} 种  ← 纯网格，无任何抖动`);
  for (const s of g.layerShapes) {
    console.log(`     层 ${s.L}：${s.n} 张 · x 共 ${s.xs.length} 列 [${s.xs[0]}..${s.xs.at(-1)}] · y 共 ${s.ys.length} 行 [${s.ys[0]}..${s.ys.at(-1)}]`);
  }
  console.log(`  ★ 层与层起始点偏移 = ${JSON.stringify(g.layerDeltas)}  ← 恒定值，层只是整体平移`);
  console.log(`  ★ 发牌：不同牌种 ${hist.size} 种 / 27；每种张数 = ${[...hist.values()].sort((a, b) => b - a).join(',')}`);
  const mult3 = [...hist.values()].filter(v => v % 3 === 0).length;
  console.log(`    其中张数为 3 的倍数的牌种：${mult3} / ${hist.size}  ← 羊了个羊要求「全部」为 3 的倍数`);
  const full = g.tiles / 3;
  console.log(`  ★ 可凑三连（碰/吃）**精确最大值** = ${m.triples} 组 = ${m.clearedTiles} 张 / ${g.tiles} 张` +
              `（满清需 ${full} 组）`);
  console.log(`    ⇒ **这局最多只能清掉 ${(m.clearedTiles / g.tiles * 100).toFixed(0)}%**` +
              `，剩余 ${g.tiles - m.clearedTiles} 张无论怎么打都消不掉  ·  能否满清 = ${m.fullClear ? '可' : '不可'}`);
  for (const k of SUITS) {
    const d = m.detail[k];
    console.log(`     ${k}：计数 [${d.counts.join(',')}] → 吃 ${d.eat} 组 + 碰 ${d.peng} 组 = ${d.eat + d.peng} 组`);
  }
  console.log('');
}
