#!/usr/bin/env node
/**
 * ============================================================
 *  _r58-probe-shot2.mjs · 探针②：游戏页取图的三条**替代通道**
 * ============================================================
 *  探针① 已实测（`_r58-probe-shot.mjs`）：
 *    首页（静态）无 clip 截图 **820 ms** 成功；游戏页（WebGL 持续渲染）
 *    **带 clip / 不带 clip 都挂**（45 s / 150 s 超时），且**之后 `Runtime.evaluate` 也挂**
 *    ⇒ 渲染进程被卡死，且不可逆。变量 = 页面，不是调用方式。
 *
 *  本探针一次试三条路，**每条各开一个浏览器**（一条死了不影响下一条）：
 *    S1 `Page.startScreencast`（帧推送通道，走 ack 机制，与 captureScreenshot 不同路）
 *    S2 先把引擎主循环停掉（`cc.game.pause()` / `cc.director.pause()`）再 captureScreenshot
 *    S3 把视口缩到 200×440 再 captureScreenshot（少画几个像素）
 *  每条都记：**出没出图** + **之后 `evaluate` 还通不通**（后者才是"没卡死"的判据）。
 *
 *  【用法】node tools/_r58-probe-shot2.mjs
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, sleep, startServer } from './g5-cdp.mjs';

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r58-probe2');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927;
const ms = () => Date.now();

async function timed(label, fn, timeout) {
    const t0 = ms();
    try {
        const v = timeout ? await Promise.race([
            fn(),
            new Promise((_, rj) => setTimeout(() => rj(new Error(`外层超时 ${timeout}ms`)), timeout)),
        ]) : await fn();
        console.log(`    ✓ ${label} → ${ms() - t0} ms${v === undefined ? '' : ` · ${String(v).slice(0, 80)}`}`);
        return { ok: true, v };
    } catch (e) {
        console.log(`    ✗ ${label} → ${ms() - t0} ms · ${String(e?.message).slice(0, 90)}`);
        return { ok: false, e };
    }
}

/** 每次探测都放一个**独立的浏览器**，并跑同一套「进游戏 → 检验」前置 */
async function withGame(fn) {
    const { cdp, close } = await openBrowser(url, { width: W, height: H, scale: 3 });
    try {
        await navigateTo(cdp, 'game');
        await sleep(2000);
        const alive = await timed('前置：游戏页 evaluate 通', () => cdp.ev('!!globalThis.__game5'), 15000);
        if (!alive.ok) return;
        await fn(cdp);
    } finally { try { await close(); } catch { /* ignore */ } }
}

const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

// ---------------------------------------------------------------
console.log('\n══ S1 · `Page.startScreencast` 帧推送通道 ══');
await withGame(async (cdp) => {
    const frames = [];
    //  ⚠️ 不改 `g5-cdp.mjs`（它没订阅 screencast 事件）—— 直接在底层 ws 上挂一个旁听者。
    cdp.ws.addEventListener('message', (ev) => {
        try {
            const m = JSON.parse(ev.data);
            if (m.method === 'Page.screencastFrame') frames.push(m.params);
        } catch { /* ignore */ }
    });
    const started = await timed('S1a startScreencast（format=png, maxWidth=421）', () => cdp.send(
        'Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 }, 15000));
    if (!started.ok) return;
    //  每收到一帧都要 `screencastFrameAck`，否则推一帧就停（这是 screencast 的硬约定）
    let accepted = 0;
    const t0 = ms();
    while (ms() - t0 < 8000 && frames.length === 0) {
        //  eslint-disable-next-line no-await-in-loop
        await sleep(200);
    }
    while (accepted < frames.length) {
        const f = frames[accepted];
        accepted++;
        //  eslint-disable-next-line no-await-in-loop
        await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }, 10000).catch(() => { });
    }
    console.log(`    · 8 s 内收到 ${frames.length} 帧`);
    if (frames.length) {
        const buf = Buffer.from(frames[0].data, 'base64');
        writeFileSync(resolve(OUT, 'S1-screencast.png'), buf);
        console.log(`    · 首帧 ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)} → ${resolve(OUT, 'S1-screencast.png')}`);
    }
    await timed('S1b stopScreencast', () => cdp.send('Page.stopScreencast', {}, 10000));
    await timed('S1c **之后** evaluate 还通不通（判"没卡死"）', () => cdp.ev('!!globalThis.__game5'), 15000);
});

// ---------------------------------------------------------------
console.log('\n══ S2 · 先停引擎主循环，再 captureScreenshot ══');
await withGame(async (cdp) => {
    const probe = await cdp.ev(`(function () {
        var c = globalThis.cc;
        return { hasCC: !!c, hasGame: !!(c && c.game), hasDir: !!(c && c.director),
                 paused: !!(c && c.game && c.game.isPaused) };
    })()`);
    console.log(`    · 引擎全局：${JSON.stringify(probe)}`);
    const stop = await timed('S2a 停主循环（director.pause + game.pause，二者都试）', () => cdp.ev(`(function () {
        var c = globalThis.cc, done = [];
        try { if (c && c.director && c.director.pause) { c.director.pause(); done.push('director'); } } catch (e) {}
        try { if (c && c.game && c.game.pause) { c.game.pause(); done.push('game'); } } catch (e) {}
        return done.join('+') || 'NO_HOOK';
    })()`), 15000);
    if (!stop.ok) return;
    await sleep(800);
    const shot = await timed('S2b 停循环后 captureScreenshot（无 clip，30 s）', async () => {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
        const buf = Buffer.from(r.data, 'base64');
        writeFileSync(resolve(OUT, 'S2-paused.png'), buf);
        return `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
    }, 40000);
    await timed('S2c 先恢复主循环再 evaluate', () => cdp.ev(`(function () {
        var c = globalThis.cc;
        try { if (c && c.game && c.game.resume) c.game.resume(); } catch (e) {}
        try { if (c && c.director && c.director.resume) c.director.resume(); } catch (e) {}
        return 1;
    })()`), 15000);
    console.log(`    · S2 小结：停循环=${stop.ok ? stop.v : '挂'} / 截图=${shot.ok ? shot.v : '挂'}`);
});

// ---------------------------------------------------------------
console.log('\n══ S3 · 缩小视口再 captureScreenshot ══');
await withGame(async (cdp) => {
    await timed('S3a 视口 200×440', () => cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 200, height: 440, deviceScaleFactor: 3, mobile: true }, 15000));
    await sleep(900);
    const shot = await timed('S3b captureScreenshot（无 clip，30 s）', async () => {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
        const buf = Buffer.from(r.data, 'base64');
        writeFileSync(resolve(OUT, 'S3-small.png'), buf);
        return `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
    }, 40000);
    await timed('S3c 之后 evaluate', () => cdp.ev('1+1'), 15000);
    console.log(`    · S3 小结：截图=${shot.ok ? shot.v : '挂'}`);
});

proc.kill();
console.log(`\n证据图目录 → ${OUT}`);
process.exit(0);
