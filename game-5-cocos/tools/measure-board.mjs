#!/usr/bin/env node
/**
 * measure-board.mjs · 只量验收板 HTML 的整页高度（截图前先量，避免撞上「单次截图高度上限」）
 * 用法：node tools/measure-board.mjs <html绝对路径> [宽度]
 */
import { pathToFileURL } from 'node:url';
import { openBrowser, sleep } from './g5-cdp.mjs';

const [, , HTML, W_ARG] = process.argv;
if (!HTML) { console.error('用法: node tools/measure-board.mjs <html> [width]'); process.exit(2); }
const W = Number(W_ARG || 1660);

const { cdp, close } = await openBrowser('about:blank', {
    width: W, height: 900, scale: 1, injectHelper: false,
});
try {
    await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
    await sleep(2000);
    const m = await cdp.ev(`(function () {
      var b = document.body, d = document.documentElement;
      var imgs = [].slice.call(document.images);
      var secs = [].slice.call(document.querySelectorAll('section')).map(function (s) {
        var r = s.getBoundingClientRect();
        return { h: s.querySelector('h2') ? s.querySelector('h2').textContent.trim().slice(0, 22) : '?',
                 y: Math.round(r.top + window.scrollY), h2: Math.round(r.height) };
      });
      return { scrollH: Math.max(b.scrollHeight, d.scrollHeight),
               scrollW: Math.max(b.scrollWidth, d.scrollWidth),
               imgs: imgs.length,
               broken: imgs.filter(function (i) { return !i.complete || !i.naturalWidth; }).length,
               natural: imgs.map(function (i) { return i.naturalWidth + 'x' + i.naturalHeight; }),
               secs: secs };
    })()`);
    console.log('页面 %dx%d   图片 %d 张，坏图 %d 张', m.scrollW, m.scrollH, m.imgs, m.broken);
    console.log('原始像素: %s', m.natural.join('  '));
    m.secs.forEach((s) => console.log('  @%5d  高 %5d   %s', s.y, s.h2, s.h));
    console.log(m.scrollH > 4500 ? '⚠️  高度 %d 超过单次截图安全上限（≈4500）' : '✅ 高度在安全范围内', m.scrollH);
} finally {
    close();
}
process.exit(0);
