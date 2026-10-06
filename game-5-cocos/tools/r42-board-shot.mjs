#!/usr/bin/env node
/**
 * 第 42 轮验收板：真实浏览器分段截图 + 版面自检。
 *
 * 用法: node tools/r42-board-shot.mjs <html绝对路径> <输出目录> [视口宽=1660]
 *
 * ★ 为什么必须分段（判据 21）：
 *   本板内嵌 page-impl.png（420×924）两列并排 ⇒ 紧排后整页 scrollHeight ≈ 5400，
 *   而「单次 Page.captureScreenshot 高度上限实测 ≈4500px」，
 *   4496 成功 / 5125 超时 120s，且**超时前自检三件套全绿** ⇒ 极难归因。
 *   ⇒ 一律切片，每片 ≤ 2600px。
 *
 * ★ 为什么 injectHelper:false（判据 18）：
 *   g5-cdp.mjs 的 PAGE_HELPER 会往每个新文档注入 `html,body{background:#0b1f16}`，
 *   截验收板/报告时会把背景刷成深墨绿，computed style 看着却正常 ⇒ 极易误判成自己 CSS 坏了。
 *
 * 自检:
 *   ① 背景色（若 = rgb(11,31,22) 说明被游戏 CSS 污染 → 直接失败）
 *   ② 横向溢出 scrollWidth > 视口宽
 *   ③ 坏图数 / 图片总数 / 原始像素
 *   ④ 每个 figure 的显示宽高比 vs 源图宽高比（图被拉变形就会露出来）
 *   ⑤ .chk 行高度分布（有没有某行被挤成一条缝）
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openBrowser, sleep } from './g5-cdp.mjs';

const [, , HTML, OUT, W_ARG] = process.argv;
if (!HTML || !OUT) {
    console.error('用法: node tools/r42-board-shot.mjs <html> <outdir> [width]');
    process.exit(2);
}
const W = Number(W_ARG || 1660);
const SLICE = 2400;   // 单张上限实测 ≈4500，留足余量
await mkdir(OUT, { recursive: true });

const { cdp, close } = await openBrowser('about:blank', {
    width: W, height: 900, scale: 1,
    injectHelper: false,        // ★ 判据 18
});
await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
await sleep(2600);

// ★ 先「护送」所有图片解码完成再量（第 44 轮踩到）：
//   板子里有大量 <img loading="lazy">，屏外图根本还没开始加载 ⇒ img.complete=false、
//   naturalWidth=0 ⇒ 被数成「坏图」（实测 12 张里报 9 张坏，其实一张也没坏）。
//   这属于「判据本身没被验证」—— 假红会让人去改本来正确的 CSS。
//   做法：分段滚到底触发懒加载 → 回顶 → 逐张 await img.decode()。
const relay = await cdp.ev(`(async function () {
  var imgs = [].slice.call(document.images);
  var H = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  for (var y = 0; y < H; y += 700) { window.scrollTo(0, y); await new Promise(function (r) { setTimeout(r, 70); }); }
  window.scrollTo(0, 0);
  await new Promise(function (r) { setTimeout(r, 150); });
  var fails = 0;
  await Promise.all(imgs.map(function (i) {
    return (i.decode ? i.decode() : Promise.resolve()).then(function () {}, function () { fails++; });
  }));
  return { n: imgs.length, fails: fails };
})()`);
console.log('图片护送 : %d 张，解码失败 %d 张', relay.n, relay.fails);

const m = await cdp.ev(`(function () {
  var b = document.body, d = document.documentElement;
  var imgs = [].slice.call(document.images);
  // ④ 变形检查：显示宽高比 vs 源图宽高比
  // ★ 必须用**内容盒 + 浮点**：给 <img> 加 1px 边框时边框盒比例会被带偏（6.000 → 6.076，假红 1.27%）；
  //   而 clientWidth/clientHeight 是**取整**的整数，窄小元素上取整误差同样会假红
  //   （实测 817/54 vs 真值 817/54.47 ⇒ 0.87%，逼近 1% 允差）。
  //   ⇒ 用 getBoundingClientRect（浮点）再减掉 img 自身的边框 = 精确内容盒。
  var deform = imgs.map(function (i) {
    var rr = i.getBoundingClientRect();
    var cs = getComputedStyle(i);
    var bx = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    var by = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    var w = rr.width - bx, h = rr.height - by;
    if (!(w > 0) || !(h > 0) || !i.naturalWidth) return null;
    var dispAR = w / h, srcAR = i.naturalWidth / i.naturalHeight;
    var dev = Math.abs(dispAR - srcAR) / srcAR;
    return { src: i.getAttribute('src'), dispAR: +dispAR.toFixed(4),
             srcAR: +srcAR.toFixed(4), dev: +(dev * 100).toFixed(2),
             fit: cs.objectFit, box: w.toFixed(1) + 'x' + h.toFixed(1) };
  }).filter(Boolean);
  // ⑤ .chk 行高分布
  var rows = [].slice.call(document.querySelectorAll('.chk')).map(function (e) {
    return Math.round(e.getBoundingClientRect().height);
  });
  var emptyRow = [].slice.call(document.querySelectorAll('.chk')).filter(function (e) {
    return e.scrollWidth > e.clientWidth + 1;   // 行内横向溢出
  }).map(function (e) { return (e.textContent || '').trim().slice(0, 30); });
  // ⑥ 本板（r44 BGM/音效拍板板）结构断言：
  //    ★ 判据纪律 —— 「空转的断言等于没断言」：.chk 是本板不存在的类，
  //      上面那两条在本题永远 0 行、必然通过，必须补真正会红的量。
  //    a) 首推卡数 .pick       b) 音频按钮数 [data-src]（应 = 48）
  //    c) 波形图有没有被容器裁掉（aspect-ratio 若按 border-box 生效就会裁 1px 级）
  var picks = document.querySelectorAll('.pick').length;
  var btns = document.querySelectorAll('[data-src]').length;
  var clipped = [];
  [].slice.call(document.querySelectorAll('.wave')).forEach(function (w) {
    var im = w.querySelector('img');
    if (!im) return;
    var cs = getComputedStyle(w);
    var ch = w.clientHeight;
    if (im.getBoundingClientRect().height > ch + 1) {
      clipped.push((im.getAttribute('src') || '') + ' img=' +
        im.getBoundingClientRect().height.toFixed(1) + ' box=' + ch);
    }
  });
  return {
    scrollH: Math.max(b.scrollHeight, d.scrollHeight),
    scrollW: Math.max(b.scrollWidth, d.scrollWidth),
    imgs: imgs.length,
    broken: imgs.filter(function (i) { return !i.complete || !i.naturalWidth; }).length,
    bodyBg: getComputedStyle(b).backgroundColor,
    htmlBg: getComputedStyle(d).backgroundColor,
    deform: deform,
    picks: picks, btns: btns, clipped: clipped,
    chkCount: rows.length,
    chkMin: rows.length ? Math.min.apply(null, rows) : 0,
    chkMax: rows.length ? Math.max.apply(null, rows) : 0,
    chkOverflow: emptyRow,
  };
})()`);

console.log('页面尺寸 : %d × %d', m.scrollW, m.scrollH);
console.log('背景色   : body=%s  html=%s', m.bodyBg, m.htmlBg);
console.log('图片     : %d 张，坏图 %d 张', m.imgs, m.broken);
console.log('自检行数 : %d 行，行高 %d ~ %d px', m.chkCount, m.chkMin, m.chkMax);

let fail = 0;
function judge(ok, txt) { console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt); if (!ok) fail++; }

judge(!/rgb\(11,\s*31,\s*22\)/.test(m.bodyBg) && !/rgb\(11,\s*31,\s*22\)/.test(m.htmlBg),
    `背景未被游戏 CSS 污染（实测 body=${m.bodyBg}）`);
judge(m.scrollW <= W, `无横向溢出（scrollWidth ${m.scrollW} ≤ 视口 ${W}）`);
judge(m.broken === 0, `无坏图（${m.imgs} 张全部解码）`);

console.log('── 图变形检查（内容盒比例 vs 源图比例，允差 1%）──');
for (const d of m.deform) {
    const ok = d.dev <= 1.0;
    if (!ok) fail++;
    // ★ Node 的 console.log 不支持 %-24s 这类宽度填充（会原样打印字面量）
    console.log('  %s %s 内容盒 %s  fit=%s  显示比 %s / 源比 %s  偏差 %s%%',
        ok ? '✓' : '✗',
        String(d.src).replace('./', '').padEnd(22),
        d.box.padEnd(9), d.fit.padEnd(5), d.dispAR, d.srcAR, d.dev);
}
judge(m.chkOverflow.length === 0,
    `自检清单无横向溢出${m.chkOverflow.length ? ' —— ' + JSON.stringify(m.chkOverflow) : ''}`);
if (m.picks || m.btns) {
    console.log('结构     : 首推卡 %d 张，音频按钮 %d 个', m.picks, m.btns);
    judge(m.picks === 12, `首推卡 12 张（实测 ${m.picks}）`);
    judge(m.btns === 48, `音频条目 48 条（实测 ${m.btns}）`);
    judge(m.clipped.length === 0,
        `波形图未被容器裁剪${m.clipped.length ? ' —— ' + JSON.stringify(m.clipped.slice(0, 3)) : ''}`);
}

// ── 分段截图 ──
const n = Math.ceil(m.scrollH / SLICE);
console.log('── 分段截图 %d 片（每片 ≤ %d px）──', n, SLICE);
const files = [];
for (let i = 0; i < n; i++) {
    const y = i * SLICE;
    const h = Math.min(SLICE, m.scrollH - y);
    const p = join(OUT, `seg-${String(i + 1).padStart(2, '0')}.png`);
    const r = await cdp.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y, width: W, height: h, scale: 1 } }, 120000);
    await writeFile(p, Buffer.from(r.data, 'base64'));
    files.push(p);
    console.log('  📷 seg-%s  y=%d h=%d  → %s', String(i + 1).padStart(2, '0'), y, h, p);
}

await writeFile(join(OUT, 'shot-report.json'),
    JSON.stringify({ ...m, slices: files.length }, null, 2));

console.log(fail === 0 ? '\n[v] 版面自检全部通过' : `\n[x] ${fail} 项未通过`);
close();
process.exit(fail === 0 ? 0 : 3);
