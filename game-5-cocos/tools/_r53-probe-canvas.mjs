#!/usr/bin/env node
/**
 * _r53-probe-canvas.mjs · 探针 2：画布几何与截图映射到底是不是一一对应
 *
 * 【为什么还要第二个探针】
 *   探针 1 说「Toast 在 CSS (216, 869)，opacity 255，父节点 Body，画布矩形 = (5,5,421,927)」，
 *   但同一时刻的截图里 y>=1600（图内坐标）**是纯黑**，按"图 = 2x CSS"换算 toast 应落在 1738。
 *   两边对不上 ⇒ 说明**我对截图映射的假设是错的**，而不是 toast 没画。
 *   这类"量测本身站不住"的情况必须先修量测（本项目判据 1：判据自身也要被验证）。
 *
 * 量四件事：
 *   ① window / document 的视口尺寸 vs `canvasRect()`
 *   ② 页面上**有几个 canvas**、每个的 buffer 尺寸 vs CSS 尺寸（有没有第二个隐藏画布）
 *   ③ 不带 clip 的全页截图（看真实版面到哪结束）
 *   ④ 带 clip 的截图（复现取证脚本那条路径）+ 已知点的实测落点
 *
 * 【用法】node tools/_r53-probe-canvas.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-probe2');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

async function save(name, params) {
    const r = await cdp.send('Page.captureScreenshot', params, 90000);
    const p = join(OUT, `${name}.png`);
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log(`  [shot] ${name} → ${p}`);
}

try {
    await navigateTo(cdp, 'game');
    await sleep(900);

    const geo = await cdp.ev(`(function () {
        var cs = document.querySelectorAll('canvas');
        var out = [];
        for (var i = 0; i < cs.length; i++) {
            var c = cs[i], r = c.getBoundingClientRect();
            out.push({ i: i, id: c.id || null, cls: c.className || null,
                       buf: c.width + 'x' + c.height,
                       css: Math.round(r.width) + 'x' + Math.round(r.height),
                       rect: { l: Math.round(r.left), t: Math.round(r.top),
                               w: Math.round(r.width), h: Math.round(r.height) },
                       vis: getComputedStyle(c).visibility, disp: getComputedStyle(c).display });
        }
        var gd = document.getElementById('GameDiv');
        var gr = gd ? gd.getBoundingClientRect() : null;
        return {
            inner: window.innerWidth + 'x' + window.innerHeight,
            client: document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight,
            dpr: window.devicePixelRatio,
            gameDiv: gr ? { l: Math.round(gr.left), t: Math.round(gr.top),
                            w: Math.round(gr.width), h: Math.round(gr.height) } : null,
            canvases: out,
            helperRect: window.__g5t.canvasRect(),
            visible: (function () { var s = cc.view.getVisibleSize();
                                    return Math.round(s.width) + 'x' + Math.round(s.height); })(),
        };
    })()`);

    console.log('\n===== 几何 =====');
    console.log(JSON.stringify(geo, null, 2));

    await save('full-noclip', { format: 'png', captureBeyondViewport: false, fromSurface: false });
    await save('clip-scale3', {
        format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: SCALE },
        captureBeyondViewport: false, fromSurface: false,
    });
    // ★ 对照：同一时刻换 scale / fromSurface，看"内容到哪结束"是否变化
    await save('clip-scale1', {
        format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
        captureBeyondViewport: false, fromSurface: false,
    });
    await save('clip-scale2', {
        format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 2 },
        captureBeyondViewport: false, fromSurface: false,
    });
    await save('clip-scale1-surface', {
        format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
        captureBeyondViewport: false, fromSurface: true,
    });

    // 已知点验证：把「分享」按钮的中心落到图上，看它实际出现在图里哪个 y
    const probe = await cdp.ev(`(function () {
        var n = window.__g5t.find('ShareReady') || window.__g5t.find('BtnStart') ||
                window.__g5t.find('Pause');
        if (!n) return null;
        var p = window.__g5t.worldToScreen(n);
        var u = n.getComponent('cc.UITransform');
        return { name: n.name, css: { x: Math.round(p.x), y: Math.round(p.y) },
                 w: u ? Math.round(u.width) : null, h: u ? Math.round(u.height) : null };
    })()`);
    console.log('\n===== 已知节点 =====');
    console.log(JSON.stringify(probe, null, 2));

    console.log('\n探针 2 完成');
} finally {
    await close();
    proc.kill();
}
