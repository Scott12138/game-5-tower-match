#!/usr/bin/env node
/**
 * _r53-probe-shot.mjs · 探针 3：截图到底覆盖了视口的哪一段（**自证式**）
 *
 * 【为什么要第三个探针 —— 前两个都倒在这一步】
 *   探针 1：Toast 在 CSS (216, 869)（视口 421x927 之内）、opacity 255、在命中栈里。
 *   探针 2：截图恒为 842x1854（= CSS 421x927 的 2 倍），但**内容只到 y=1567（84.5%）**，
 *           下面 15.5% 是纯黑；而且换 clip{scale:1/2/3} / fromSurface 出来的图**一模一样**。
 *   两个探针都在**猜**"图 = k x CSS"，从没验过这个换算本身。
 *
 * 【判据 1 的正面用法】先造**已知真值**再看它落在哪 —— 而不是拿猜的换算去解释画面。
 *   往页面里插三条已知颜色的 DOM 横条（DOM 走普通合成，和 canvas 是两条路）：
 *     green  @ CSS y= 200（上对照）
 *     blue   @ CSS y= 500（中对照）
 *     red    @ CSS y= 900（**关键**：在视口内、但在"黑带"里）
 *   再把 body 背景刷成洋红 —— 这样"黑"就不再是"没画"的同义词：
 *     黑带处 = 洋红  ⇒ 画布根本没铺到那儿（页面背景露出来）
 *     黑带处 = 黑    ⇒ 截图区域越过了真实绘制面（合成/截图路径问题）
 *
 * 【用法】node tools/_r53-probe-shot.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-probe3');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: 3,
});

async function save(name, params) {
    const r = await cdp.send('Page.captureScreenshot', params, 60000);
    const p = join(OUT, `${name}.png`);
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log(`  [shot] ${name} → ${p}`);
    return p;
}

try {
    await navigateTo(cdp, 'game');
    await sleep(900);

    // ① 先落标尺（DOM 层，与 canvas 合成路径不同）
    const marked = await cdp.ev(`(function () {
        var bars = [[200,'#00ff00'],[500,'#0000ff'],[900,'#ff0000']];
        document.body.style.background = '#ff00ff';
        var made = [];
        for (var i = 0; i < bars.length; i++) {
            var d = document.createElement('div');
            d.id = 'probe-' + bars[i][0];
            d.style.cssText = 'position:absolute;left:0;width:100%;height:16px;z-index:2147483647;' +
                              'background:' + bars[i][1] + ';';
            d.style.top = bars[i][0] + 'px';
            document.body.appendChild(d);
            var r = d.getBoundingClientRect();
            made.push({ id: d.id, cssTop: Math.round(r.top), cssBottom: Math.round(r.bottom) });
        }
        return { bars: made, viewport: window.innerWidth + 'x' + window.innerHeight,
                 docH: document.documentElement.scrollHeight,
                 scrollY: Math.round(window.scrollY) };
    })()`);
    console.log('\n===== 标尺（DOM 真值）=====');
    console.log(JSON.stringify(marked, null, 2));

    const layout = await cdp.send('Page.getLayoutMetrics');
    console.log('\n===== Page.getLayoutMetrics =====');
    console.log(JSON.stringify({
        cssLayoutViewport: layout.cssLayoutViewport,
        cssVisualViewport: layout.cssVisualViewport,
        cssContentSize: layout.cssContentSize,
        layoutViewport: layout.layoutViewport,
        contentSize: layout.contentSize,
    }, null, 2));

    // ② 三条路径各截一张（都不带 clip）
    await save('A-noclip-default', { format: 'png' });
    await save('B-noclip-noSurface', { format: 'png', captureBeyondViewport: false, fromSurface: false });
    await save('C-clip-full', {
        format: 'png',
        clip: { x: 0, y: 0, width: W, height: H, scale: 1, _note: 'y 起在 0' },
        captureBeyondViewport: false, fromSurface: false,
    });

    // ③ 同时再读一次几何（确认标尺还在、页面没滚）
    const after = await cdp.ev(`(function () {
        var out = {};
        var ids = ['probe-200','probe-500','probe-900'];
        for (var i = 0; i < ids.length; i++) {
            var e = document.getElementById(ids[i]);
            if (!e) { out[ids[i]] = null; continue; }
            var r = e.getBoundingClientRect();
            out[ids[i]] = { top: Math.round(r.top), bottom: Math.round(r.bottom) };
        }
        return { bars: out, scrollY: Math.round(window.scrollY),
                 inner: window.innerWidth + 'x' + window.innerHeight };
    })()`);
    console.log('\n===== 截图后复读标尺 =====');
    console.log(JSON.stringify(after, null, 2));

    console.log('\n探针 3 完成');
} finally {
    await close();
    proc.kill();
}
