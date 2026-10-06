#!/usr/bin/env node
/**
 * 方案页自检：把两件必须用实测说话的事一次断言完。
 *   ① 金币雨：16 枚必须**铺满整条坠落路径**（不能全挤在顶端被 overflow 裁掉）
 *      —— 通过 window.__rain.seek(0) 把这场雨定格到确定性相位再量，不靠"碰巧抓到的瞬间"。
 *   ② 牌堆：四块（BEFORE/A/B/C）必须同尺寸同坐标 —— 否则方案之间没法比。
 *      ⚠ 方案 B 的定义就是"改位移+缩放"，所以它的牌**本来就不该**和别块等大，
 *        断言要按各方案自己的定义写，不能拿"现状"当期望（判据 8）。
 */
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openBrowser, sleep } from './g5-cdp.mjs';

const HTML = process.argv[2];
const OUT = process.argv[3] || null;
const RECTS_JSON = process.argv[4] || null;      /* 把逐张牌矩形落盘，供 PIL 取像素 */
const W = 1660;

const { cdp, close } = await openBrowser('about:blank', {
    width: W, height: 900, scale: 1, injectHelper: false,
});
await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
await sleep(2000);

/* ★ 先把雨定格到确定性相位，之后的量测与截图才可复现 */
const seeked = await cdp.ev(`window.__rain ? window.__rain.seek(0) : -1`);
await sleep(300);

const out = await cdp.ev(`(function () {
  var res = {};
  var box = document.querySelector('.rain');
  var br = box.getBoundingClientRect();
  var coins = [].slice.call(box.querySelectorAll('i'));
  var buckets = [0,0,0,0,0,0,0,0,0,0];
  var visible = 0, hidden = 0;
  coins.forEach(function (c) {
    var r = c.getBoundingClientRect();
    /* ★ 判据 = 矩形与雨框**相交**（半枚正在入场/出场的也算看得见），
       不是"中心落在框内" —— 后者会把刚露头的金币误判成不可见。 */
    var hit = (r.y + r.height > br.y) && (r.y < br.y + br.height);
    if (hit) visible++; else hidden++;
    var p = (r.y + r.height / 2 - br.y) / br.height;
    buckets[Math.max(0, Math.min(9, Math.floor(p * 10)))]++;
  });
  res.rainBox = [Math.round(br.x), Math.round(br.y), Math.round(br.width), Math.round(br.height)];
  res.boxCount = document.querySelectorAll('.rain').length;
  res.totalCoins = window.__rain ? window.__rain.count() : -1;
  res.perBox = coins.length;
  res.visible = visible; res.fullyOutside = hidden;
  res.buckets = buckets;
  res.sizes = [].slice.call(box.querySelectorAll('i')).slice(0,3).map(function(c){
    return getComputedStyle(c).width + ' top=' + getComputedStyle(c).top;
  });

  res.piles = ['now','A','B','C'].map(function (id) {
    var st = document.querySelector('#' + id + ' .stage');
    var pil = document.querySelector('#' + id + ' .pile');
    var ts = pil ? [].slice.call(pil.querySelectorAll('.t')) : [];
    var sr = st.getBoundingClientRect();
    var dims = ts.map(function (t) { var r = t.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height); });
    /* 逐张牌的页坐标矩形 —— 供 PIL 在**同坐标**上取像素差（判据 3） */
    var byKey = {};
    ts.forEach(function (t) {
      var r = t.getBoundingClientRect();
      byKey[t.dataset.k] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    });
    return {
      id: id,
      stageWH: Math.round(sr.width) + 'x' + Math.round(sr.height),
      stageX: Math.round(sr.x),
      k: getComputedStyle(pil).getPropertyValue('--k').trim(),
      n: ts.length,
      coverDims: dims.slice(0, 5),
      pickDims: dims[5],
      byKey: byKey,
    };
  });
  res.pageH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  res.pageW = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
  res.bodyBg = getComputedStyle(document.body).backgroundColor;
  return res;
})()`);

console.log('→ seek() 命中雨框数:', seeked);
console.log(JSON.stringify(out, null, 2));

let bad = 0;
const J = (ok, msg) => { console.log((ok ? '✅ ' : '❌ ') + msg); if (!ok) bad++; };
console.log('\n--- 断言 ---');
J(out.boxCount === 3, `雨框 ${out.boxCount} 个（三版本各一）`);
J(out.totalCoins === 48, `合计 ${out.totalCoins} 枚金币（3 框 × 16）`);
/* 判据取自需求本身（"任意瞬间都像一场正在下的雨"）：
   主判据 = 高度十等分里每格都有金币（铺满整条路径）；
   副判据 = 完全落在框外的**只有**最上端刚进场、最下端将出场的那 2~3 枚 —— 
   这条不是在描述现状，而是在排除"金币全挤在一处"的失败态。 */
J(out.visible >= 13, `首个雨框内可见 ${out.visible}/${out.perBox} 枚；完全在框外仅 ${out.fullyOutside} 枚（进场/出场的边界枚）`);
const filled = out.buckets.filter((n) => n > 0).length;
J(filled >= 9, `十个高度分区里 ${filled} 个有金币（≥9 才算"铺满整条路径"）；分布 ${out.buckets.join('|')}`);
J(out.pageW <= W, `无横向溢出：scrollWidth ${out.pageW} ≤ ${W}`);
J(out.pageH <= 4500, `整页高 ${out.pageH} ≤ 4500（判据 21 的截图上限）`);
J(!/rgb\(11,\s*31,\s*22\)/.test(out.bodyBg), `背景未被游戏页样式污染（body=${out.bodyBg}）`);

const base = out.piles[0];
const same = (a, b) => a === b;
J(out.piles.every((p) => same(p.stageWH, base.stageWH)), `四块 stage 同尺寸 ${base.stageWH} —— 实际 ${out.piles.map((p) => p.stageWH).join(' / ')}`);
J(out.piles.every((p) => p.n === 6), `每块 6 张牌（实测 ${out.piles.map((p) => p.n).join('/')}）`);
const coverSets = out.piles.map((p) => p.coverDims.join(','));
J(new Set([coverSets[0], coverSets[1], coverSets[3]]).size === 1,
  `BEFORE/A/C 三块**被压牌尺寸完全一致** ${coverSets[0]}（三块可逐像素对账）`);
J(coverSets[2] !== coverSets[0], `方案 B 被压牌**确实缩了**（B=${coverSets[2]} vs 基准 ${coverSets[0]}）—— 这正是 B 的设计`);
const pickSets = out.piles.map((p) => p.pickDims);
J(pickSets[1] !== pickSets[0] || pickSets[2] !== pickSets[0], `可点牌尺寸随方案变化：${pickSets.join(' / ')}`);

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`);

if (RECTS_JSON) {
    await writeFile(RECTS_JSON, JSON.stringify({
        pageH: out.pageH, pageW: out.pageW,
        piles: out.piles.map((p) => ({ id: p.id, byKey: p.byKey })),
    }, null, 2));
    console.log('→ 矩形表已落盘:', RECTS_JSON);
}

if (OUT && bad === 0) {
    const r = await cdp.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: W, height: out.pageH, scale: 1 } }, 120000);
    await writeFile(OUT, Buffer.from(r.data, 'base64'));
    console.log('📷', OUT, `(${W}x${out.pageH})`);
}
close();
process.exit(bad === 0 ? 0 : 1);
