#!/usr/bin/env node
/**
 * ============================================================
 *  _r58-probe-shot.mjs · 探针：**游戏页上哪条截图通道不会卡死渲染进程**
 * ============================================================
 *  背景（第 57 轮三实测）：
 *    `_r58-verify.mjs` 的 B 组（游戏页）两次卡死，**两次都从"截图"开始**：
 *      第一次：7 次点击之后再截 `verifiedShot`（无 clip）⇒ 60 s + 90 s 全挂，
 *              抛错把 B11/B12 两条负控整段吞掉；
 *      第二次：把截图挪到点击**之前** ⇒ 无 clip（60+90 s）+ 带 clip（45 s）**全挂**，
 *              且**紧接着的 `Runtime.evaluate` 也超时** ⇒ 渲染进程是真的被卡住了，
 *              不是"某一次调用偶发"。
 *    A 组（首页 / 商城弹层）用同一条无 clip 通道**秒过** ⇒ 变量是**页面**，不是代码。
 *
 *  本探针要回答的问题（每条都带对照组）：
 *    Q1 游戏页 `Runtime.evaluate` 本身通不通？（先证明"页面活着"这个前提）
 *    Q2 带 clip（scale:1，覆盖视口）在游戏页上能不能出图、耗时多少？
 *    Q3 出图**之后** `Runtime.evaluate` 还通不通？（这才是"卡死"的判据）
 *    Q4 对照组：同一构建的**首页**上，无 clip 通道通不通？
 *    Q5 若 Q3 挂了，换个新浏览器再来一次带 clip 的截图是否稳定？
 *
 *  【用法】node tools/_r58-probe-shot.mjs
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, sleep, startServer } from './g5-cdp.mjs';

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r58-probe');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const clock = () => Date.now();
async function timed(label, fn, ms) {
    const t0 = clock();
    try {
        const v = await fn();
        const dt = clock() - t0;
        console.log(`    ✓ ${label} → ${dt} ms`);
        return { ok: true, dt, v };
    } catch (e) {
        const dt = clock() - t0;
        console.log(`    ✗ ${label} → ${dt} ms · ${String(e?.message).slice(0, 90)}`);
        return { ok: false, dt, e };
    }
}

async function shot(cdp, mode, path, ms) {
    const clip = mode === 'clip';
    const r = await cdp.send('Page.captureScreenshot', clip
        ? { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }
        : { format: 'png', captureBeyondViewport: false }, ms);
    const buf = Buffer.from(r.data, 'base64');
    const gw = buf.readUInt32BE(16), gh = buf.readUInt32BE(20);
    writeFileSync(path, buf);
    return `${gw}×${gh}`;
}

const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

// ---------- 对照组：首页（静态场景）上的无 clip 通道 ----------
{
    console.log('\n══ 对照组 · 首页（静态）══');
    const { cdp, close } = await openBrowser(url, { width: W, height: H, scale: SCALE });
    try {
        await navigateTo(cdp, 'home');
        await sleep(1200);
        await timed('Q4 首页 · 无 clip 截图', () => shot(cdp, 'noclip', resolve(OUT, 'ctl-home-noclip.png'), 60000));
        await timed('Q4b 首页 · 截图后 evaluate 仍通', () => cdp.ev('1+1'));
    } finally { try { await close(); } catch { /* ignore */ } }
}

// ---------- 主组：游戏页（WebGL 持续渲染）----------
{
    console.log('\n══ 主组 · 游戏页（WebGL 持续渲染）══');
    const { cdp, close } = await openBrowser(url, { width: W, height: H, scale: SCALE });
    try {
        await navigateTo(cdp, 'game');
        await sleep(2000);
        const q1 = await timed('Q1 游戏页 · evaluate（证明页面本身活着）', () => cdp.ev('!!globalThis.__game5'));
        const q2 = await timed('Q2 游戏页 · **带 clip** 截图（45 s 上限）',
            () => shot(cdp, 'clip', resolve(OUT, 'game-clip.png'), 45000));
        const q3 = await timed('Q3 上面截图**之后** evaluate 还通不通', () => cdp.ev('!!globalThis.__game5'), 15000);
        if (q2.ok && q3.ok) {
            await timed('Q5 游戏页 · 再截一张带 clip（复现性）',
                () => shot(cdp, 'clip', resolve(OUT, 'game-clip2.png'), 45000), 45000);
            await timed('Q5b 之后再 evaluate', () => cdp.ev('!!globalThis.__game5'), 15000);
        } else {
            console.log('    · 带 clip 也不安全 ⇒ 不再试探无 clip（那是上一轮已知会挂的那条）');
        }
        console.log('\n  结论一览：Q1=' + (q1.ok ? '通' : '挂') + ' Q2=' + (q2.ok ? `通(${q2.dt}ms)` : '挂')
            + ' Q3=' + (q3.ok ? `通(${q3.dt}ms)` : '挂'));
    } finally { try { await close(); } catch { /* ignore */ } }
}

console.log(`\n证据图目录 → ${OUT}`);
process.exit(0);
