#!/usr/bin/env node
/**
 * ============================================================
 *  g5-shot.mjs · 定点截图 / 裁切放大（零依赖）
 * ============================================================
 *  【为什么不用 sips】本机没有 PIL / ffmpeg / imagemagick，
 *  唯一能"裁一小块并放大"的现成通道就是 CDP 自己的
 *  `Page.captureScreenshot({ clip: {x,y,width,height,scale} })`。
 *  低分辨率全屏图看不清细节，"是不是有一块灰底"这种判断必须放大看。
 *
 *  【用法】
 *    node tools/g5-shot.mjs <输出png> [等待ms] [选项]
 *  选项：
 *    --clip x,y,w,h      只截这块（CSS 像素，含画布左上偏移）
 *    --scale n           clip 的放大倍率（默认 1）
 *    --dev x,y           **设计 px**（左上原点）中心点，自动换算成 ~240×240 的裁切窗
 *    --do '<js>'         截图前先在页面里求值（做开关/隐藏等准备）
 *    --path sprite|graphics|all
 *                        只保留某类渲染组件（排查"这块灰底是谁画的"用）
 *
 *  例：
 *    node tools/g5-shot.mjs /tmp/zoom.png 6000 --dev 380,626 --scale 3
 *    node tools/g5-shot.mjs /tmp/nogs.png 6000 --path sprite
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { navigateTo, openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const argv = process.argv.slice(2);
const OUT = resolve(argv[0] || '/tmp/g5-shot.png');
const WAIT = Number(argv[1] || 6000);
function opt(name, def) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : def;
}
const CLIP = opt('--clip', null);
const SCALE = Number(opt('--scale', 1));
const DEV = opt('--dev', null);
const DO = opt('--do', null);
const PATH = opt('--path', 'all');
const TO = opt('--to', null);
const SCALE_OVERRIDE = opt('--dsf', null);

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, {
    seedLevel: Number(process.env.G5_LEVEL || 0) || null,
    scale: SCALE_OVERRIDE ? Number(SCALE_OVERRIDE) : 2,
});
try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, '!!(cc.director && cc.director.getScene())', 15000, '场景');
    if (TO) await navigateTo(cdp, TO);
    await sleep(WAIT);

    // 只留某一类渲染组件：用来判断"这一块是谁画的"
    if (PATH !== 'all') {
        const keep = PATH === 'sprite' ? 'cc.Sprite' : 'cc.Graphics';
        const cut = PATH === 'sprite' ? 'cc.Graphics' : 'cc.Sprite';
        const n = await cdp.ev(`(() => {
            let cnt = 0;
            (function walk(x){ const c = x.getComponent('${cut}'); if (c) { c.enabled = false; cnt++; }
                x.children.forEach(walk); })(cc.director.getScene());
            return cnt;
        })()`);
        console.log(`==> 已关闭 ${n} 个 ${cut}`);
        await sleep(900);
    }

    if (DO) {
        const r = await cdp.ev(`(function(){ const T = window.__g5t; ${DO} })()`);
        console.log('==> --do 结果：', typeof r === 'string' ? r : JSON.stringify(r));
        await sleep(700);
    }

    // 设计 px → CSS px 的裁切窗换算
    let clip = null;
    if (DEV) {
        const [dx, dy] = DEV.split(',').map(Number);
        const { l, t, w, h } = await cdp.ev('JSON.stringify(T.canvasRect())').then(JSON.parse)
            .catch(() => cdp.ev('T.canvasRect()'));
        const v = await cdp.ev('T.view()');
        const cx = l + (dx / v.w) * w, cy = t + (dy / v.h) * h;
        clip = { x: Math.round(cx - 120), y: Math.round(cy - 120), width: 240, height: 240 };
        console.log(`==> 设计点 (${dx},${dy}) → CSS (${cx.toFixed(0)},${cy.toFixed(0)})，裁切窗 ${JSON.stringify(clip)}`);
    } else if (CLIP) {
        const [x, y, w, h] = CLIP.split(',').map(Number);
        clip = { x, y, width: w, height: h };
    }

    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: SCALE };
    const r = await cdp.send('Page.captureScreenshot', params);
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, Buffer.from(r.data, 'base64'));
    console.log(`==> 截图：${OUT}`);
} catch (e) {
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
} finally {
    close();
    srv.proc.kill();
}
