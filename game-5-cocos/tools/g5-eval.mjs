#!/usr/bin/env node
/**
 * ============================================================
 *  g5-eval.mjs · 「加载页面 → 等一会儿 → 在页面里求值」的一次性开口
 * ============================================================
 *  专治"坐标口径到底是哪一层"这类问题：与其在 Node 侧猜，
 *  不如把三层的实测数字一次打出来对齐。
 *
 *  【用法】
 *    node tools/g5-eval.mjs <等待毫秒> '<JS 表达式>'
 *  例：
 *    node tools/g5-eval.mjs 6000 'JSON.stringify(cc.director.getScene().children.map(c=>c.name))'
 *
 *  为了省事，页面里已经预置了 `T` = window.__g5t（见 g5-cdp.mjs）。
 */

import { resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const WAIT_MS = Number(process.argv[2] || 6000);
const EXPR = process.argv[3] || 'JSON.stringify(window.__g5t.view())';
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
/** 环境变量 G5_LEVEL=N 时，开局直接落在第 N 关（跳关调试用） */
const LEVEL = Number(process.env.G5_LEVEL || 0) || null;

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { seedLevel: LEVEL });
if (LEVEL) console.log(`（存档已预置为第 ${LEVEL} 关）`);
try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, '!!(cc.director && cc.director.getScene())', 15000, '场景');

    // `--to <home|gameStart|game>`：先真实点击导航到目标页，再求值。
    // 全部走真实鼠标事件（与冒烟脚本同一套判据，不绕过事件层）。
    const to = (() => { const i = process.argv.indexOf('--to'); return i >= 0 ? process.argv[i + 1] : null; })();
    async function waitLog(sub, ms = 15000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (cdp.logs.some((l) => l.text.includes(sub))) return true;
            await sleep(150);
        }
        return false;
    }
    async function tap(name) {
        const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
        if (!p) throw new Error(`找不到节点 ${name}`);
        await cdp.click(p.x, p.y);
    }
    if (to) {
        console.log(`（导航到 ${to} …）`);
        if (!(await waitLog('[PageManager] → home', 20000))) throw new Error('没到首页');
        // ⚠️ 首页按钮是**上浮入场**的（settleIn：y 从 -26 推到 0）。入场没走完
        //    时算出来的中心点会偏 26px —— 点下去正好落在按钮外沿，"没反应"。
        await sleep(1600);
        if (to !== 'home') {
            await tap('BtnStart');
            if (!(await waitLog('[PageManager] → gameStart', 12000))) throw new Error('没到开局页');
            await sleep(4500);                       // 等掷骰 + 赠礼卡
            if (to === 'gameStart') { console.log('（已到开局页）'); }
        }
        if (to === 'game') {
            await tap('BtnGo');
            if (!(await waitLog('[PageManager] → game', 15000))) throw new Error('没到主玩页');
            await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');
            console.log('（已到主玩页）');
        }
    }
    await sleep(WAIT_MS);
    const out = await cdp.ev(`(function(){ const T = window.__g5t; ${EXPR} })()`);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} catch (e) {
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
} finally {
    const errs = cdp.errors.filter((e) => !e.includes('音频加载失败'));
    if (errs.length) {
        console.log(`\n===== 页面错误（${errs.length}）=====`);
        for (const e of errs.slice(0, 15)) console.log(`  ${e.split('\n')[0]}`);
    }
    close();
    srv.proc.kill();
}
