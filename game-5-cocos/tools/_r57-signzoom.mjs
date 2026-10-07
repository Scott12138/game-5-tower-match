#!/usr/bin/env node
/**
 * ============================================================
 *  _r57-signzoom.mjs · 第 57 轮 · 「领取」胶囊骑边特写
 * ============================================================
 *  为什么单独一个脚本：`verifiedShot()` 是**不带 clip** 的全屏取证通道
 *  （它的尺寸自证依赖"图 = 视口 CSS × DPR"这个恒等式，加了 clip 就废了）。
 *  而"胶囊到底有没有骑在格沿上、骑了几像素、发光是什么颜色"这类判断
 *  **必须在放大图上做** —— 全屏图上 19 设计 px ≈ 10 CSS px，根本看不清。
 *
 *  所以这里走的是 `g5-shot.mjs` 那条老路：
 *    **浏览器开 DPR1** + `captureScreenshot({clip:{…,scale:3}})` ⇒ 3× 放大裁切。
 *  为什么必须 DPR1：真值表（`g5-cdp.mjs` 的 `verifiedShot` 注释，插已知色条称出来的）
 *  说 DPR3 下 `clip{scale:3}` = 重渲染 9× 像素，**150s 也不返回**；
 *  而 DPR1 下 `clip{scale:3}` 只是 3× 像素，正常出图。
 *
 *  ⚠️ 本脚本出的图是**放大特写**，不是"取证图" —— 不许拿它当尺寸判据
 *     （尺寸判据只认 `verifiedShot` 出的那张）。
 *
 *  【用法】node tools/_r57-signzoom.mjs
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, sleep, startServer, tapNode, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r57-signzoom');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

function ymd(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function signSeed(streak, dateOffset) {
    const date = dateOffset === null ? '' : ymd(dateOffset);
    return `try { localStorage.setItem('game5.save.v1', JSON.stringify({
        level: 3, best: 2, inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
        coins: 0, plays: 0, cleared: 0,
        signDate: ${JSON.stringify(date)}, signStreak: ${streak},
        dailyDate: '', daily: {}
    })); } catch (e) {}`;
}

/** 就某节点中心裁一块 `w×h` CSS、放大 `z` 倍 */
async function zoom(cdp, name, out, { w = 160, h = 150, z = 3, dy = 0, dx = 0 } = {}) {
    const c = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
    if (!c) throw new Error(`找不到节点 ${name}`);
    const clip = { x: Math.round(c.x + dx - w / 2), y: Math.round(c.y + dy - h / 2), width: w, height: h, scale: z };
    const r = await cdp.send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false, clip }, 60000);
    writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log(`[✓] ${name} 特写 → ${out}   clip=${JSON.stringify(clip)}`);
    return clip;
}

async function session(streak, dateOffset, fn) {
    const { cdp, close } = await openBrowser(url, {
        seedScript: signSeed(streak, dateOffset), width: W, height: H, scale: 1,
    });
    try {
        await navigateTo(cdp, 'home');
        await waitFor(cdp, "!!(window.__g5t && window.__g5t.find('Fn_signin'))", 30000, '首页四入口');
        await sleep(600);
        await tapNode(cdp, 'Fn_signin');
        await sleep(900);
        return await fn(cdp);
    } finally {
        try { await close(); } catch { /* ignore */ }
    }
}

const meta = [];
try {
    // Z1 当天可领：胶囊骑在第 3 格下沿正中（连格沿一起裁进来）
    meta.push({ id: 'Z1-当天-胶囊骑边', clip: await session(2, -1, (cdp) =>
        zoom(cdp, 'SignCell_3', join(OUT, 'Z1-当天-胶囊骑边.png'), { w: 170, h: 150, z: 3 })) });

    // Z2 今日已领：同一格 —— 勾在、胶囊没了（与 Z1 同机位，可直接对看）
    meta.push({ id: 'Z2-已领-勾在无胶囊', clip: await session(3, 0, (cdp) =>
        zoom(cdp, 'SignCell_3', join(OUT, 'Z2-已领-勾在无胶囊.png'), { w: 170, h: 150, z: 3 })) });

    // Z3 未到格：整格压暗（对照组 —— 三态真的分得开）
    meta.push({ id: 'Z3-未到-整格压暗', clip: await session(2, -1, (cdp) =>
        zoom(cdp, 'SignCell_4', join(OUT, 'Z3-未到-整格压暗.png'), { w: 170, h: 150, z: 3 })) });

    writeFileSync(join(OUT, 'zoom.json'), JSON.stringify(meta, null, 2));
    console.log(`\n共 ${meta.length} 张特写`);
} finally {
    proc.kill();
}
