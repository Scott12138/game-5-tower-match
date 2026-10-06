#!/usr/bin/env node
/**
 * ============================================================
 *  g5-px.mjs · 取样点像素（把"看着像灰底"变成具体数值）
 * ============================================================
 *  【用法】
 *    node tools/g5-px.mjs <等待ms> --rects "x,y,w,h:标签;…" [--do '<js>'] [--out 存档png]
 *  坐标一律用**设计 px（左上原点）**，脚本自己换算到 CSS 像素。
 *
 *  例：
 *    node tools/g5-px.mjs 6000 --rects "190,620,120,60:光束中部;40,620,60,60:光束外侧"
 *
 *  判读方法：比较"疑似出问题处"与"附近应无变化处"的亮度差。
 *  色差 < 2/255 属抖动噪声；> 6/255 就是肉眼可见的差异。
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';
import { avgRect, decodePNG, hexOf, luma } from './g5-png.mjs';

const argv = process.argv.slice(2);
const WAIT = Number(argv[0] || 6000);
const get = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const RECTS = get('--rects', '');
const DO = get('--do', null);
const OUT = get('--out', null);

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url);
try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手就绪');
    await sleep(WAIT);
    if (DO) {
        const r = await cdp.ev(`(function(){ const T = window.__g5t; ${DO} })()`);
        console.log(`--do → ${typeof r === 'string' ? r : JSON.stringify(r)}`);
        await sleep(800);
    }
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(r.data, 'base64');
    if (OUT) await writeFile(OUT, buf);

    const png = decodePNG(buf);
    const v = await cdp.ev('window.__g5t.view()');
    const rect = await cdp.ev('window.__g5t.canvasRect()');
    const toCss = (dx, dy) => [rect.l + (dx / v.w) * rect.w, rect.t + (dy / v.h) * rect.h];
    console.log(`截图 ${png.width}×${png.height} · 画布 ${JSON.stringify(rect)} · 可视 ${v.w}×${v.h}`);

    for (const item of RECTS.split(';').map((s) => s.trim()).filter(Boolean)) {
        const [c, label = ''] = item.split(':');
        const [x, y, w, h] = c.split(',').map(Number);
        const [cx0, cy0] = toCss(x, y);
        const [cx1, cy1] = toCss(x + w, y + h);
        // 截图是**整个视口**（不是只有画布），所以 CSS 像素 → 截图像素 的缩放
        // 是 png.width / window.innerWidth（devicePixelRatio 已经算在里面了）。
        const k = png.width / (await cdp.ev('window.innerWidth'));
        const px0 = Math.round(cx0 * k), py0 = Math.round(cy0 * k);
        const px1 = Math.round(cx1 * k), py1 = Math.round(cy1 * k);
        const avg = avgRect(png, px0, py0, px1 - 1, py1 - 1);
        console.log(`  ${String(label || c).padEnd(18)} 设计(${x},${y},${w}×${h}) → 像素(${px0},${py0})~(${px1},${py1})  ${hexOf(avg)}  亮度 ${luma(avg)}`);
    }
} catch (e) {
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
} finally {
    close();
    srv.proc.kill();
}
