#!/usr/bin/env node
/**
 * 把验收板 / 报告类 HTML 整页截成 PNG，并做「自检三件套」。
 *
 * 用法：
 *   node tools/g5-shot-board.mjs <html绝对路径> <输出png> [宽度]
 *
 * ★ 第 36 轮教训（这个坑绕了很久，务必保留 injectHelper:false）
 *   `g5-cdp.mjs` 的 `PAGE_HELPER` 会往**每一个新文档**注入游戏页的 FILL_CSS，
 *   其中含 `html,body{overflow:hidden;background:#0b1f16}`。
 *   这对游戏页是必需的，但**截验收板 / 报告时会把它们的背景刷成深墨绿**，
 *   表现为「深底浅字、对比诡异」，而 CSS 明明是对的（computed style 全部正常）
 *   —— 于是你会去怀疑自己的 CSS，白绕一大圈。
 *   ⇒ 本脚本默认 `injectHelper: false`，并把**实测的页面背景色**打出来当自检。
 *
 * 自检项：
 *   ① scrollHeight/scrollWidth —— 有没有横向溢出（宽度被撑破）
 *   ② 图片总数 / 坏图数 / 原始像素 —— 内嵌图有没有加载失败
 *   ③ body 背景色 —— 若出现 #0b1f16 / 深色，说明被游戏 CSS 污染了
 */
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { openBrowser, sleep } from './g5-cdp.mjs';

const [, , HTML, OUT, W_ARG] = process.argv;
if (!HTML || !OUT) {
    console.error('用法: node tools/g5-shot-board.mjs <html> <out.png> [width]');
    process.exit(2);
}
const W = Number(W_ARG || 1660);

const { cdp, close } = await openBrowser('about:blank', {
    width: W, height: 900, scale: 1,
    injectHelper: false,          // ★ 关键：别把游戏页样式注入到验收板
});
await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
await sleep(2500);

const m = await cdp.ev(`(function () {
  var b = document.body, d = document.documentElement;
  var imgs = [].slice.call(document.images);
  var cs = getComputedStyle(b);
  return {
    scrollH: Math.max(b.scrollHeight, d.scrollHeight),
    scrollW: Math.max(b.scrollWidth, d.scrollWidth),
    imgs: imgs.length,
    broken: imgs.filter(function (i) { return !i.complete || !i.naturalWidth; }).length,
    natural: imgs.map(function (i) { return i.naturalWidth + 'x' + i.naturalHeight; }),
    bodyBg: cs.backgroundColor,
    htmlBg: getComputedStyle(d).backgroundColor,
  };
})()`);

console.log('页面尺寸: %dx%d', m.scrollW, m.scrollH);
console.log('图片: %d 张，坏图 %d 张', m.imgs, m.broken);
if (m.natural.length) console.log('原始像素:', m.natural.join('  '));
console.log('背景色: body=%s  html=%s', m.bodyBg, m.htmlBg);

// 自检③：背景被游戏 CSS 污染的话，这个值会是 rgb(11, 31, 22)
const polluted = /rgb\(11,\s*31,\s*22\)/.test(m.bodyBg) || /rgb\(11,\s*31,\s*22\)/.test(m.htmlBg);
if (polluted) {
    console.error('❌ 检测到游戏页样式污染（背景 = #0b1f16）—— 截图不可信，请检查 injectHelper');
    close();
    process.exit(3);
}
if (m.scrollW > W) {
    console.error('⚠️  横向溢出：scrollWidth %d > 视口宽 %d', m.scrollW, W);
}
console.log('✅ 自检通过（无样式污染 / 无坏图）');

const r = await cdp.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: W, height: m.scrollH, scale: 1 } }, 120000);
await writeFile(OUT, Buffer.from(r.data, 'base64'));
console.log('📷', OUT);
close();
process.exit(0);
