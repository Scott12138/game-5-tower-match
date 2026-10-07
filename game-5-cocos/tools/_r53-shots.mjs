#!/usr/bin/env node
/**
 * ============================================================
 *  _r53-shots.mjs · 第 53 轮 · 取证截图（给对照板用）
 * ============================================================
 *  只做一件事：把本轮**新出现的七个界面态**用真实鼠标走到、再截图。
 *    01 失败结算弹层 ·「看广告复活」位
 *    02 替身广告面板（如实标「演示用 · 当前尚未接入广告位」）
 *    03 **真广告播放中 —— 没有任何面板**（真分支的唯一可见特征）
 *    04 排行榜 · 浏览器降级态（无开放数据域）
 *    05 排行榜 · 开放数据域视窗（有 wx ⇒ 建出 OpenDataView 640×960）
 *    06 胜态结算弹层 ·「分享」（纯传播入口）
 *    07 分享 · 浏览器降级提示
 *
 *  ⚠️ 两个已知坑：
 *    ① `Page.reload` 之后再调 `Page.captureScreenshot` 会**一直不返回**
 *       ⇒ 本脚本全程**不重载**，靠"一次走完"的顺序安排替代。
 *    ② ★★ **截图必须走 `verifiedShot()`，绝不自己写 `captureScreenshot` 参数。**
 *       第 53 轮本脚本**第一版**传了 `fromSurface:false`（沿用 `_r52-shots.mjs` 的旧结论），
 *       出来的图是 **842×1854 的残图**：底部 15.5% 直接没有，图内上部的已知色条也会丢。
 *       后果是"07 分享降级提示里看不到 toast"被当成了产品问题，白查了两轮。
 *       真值表见 `g5-cdp.mjs` 的 `verifiedShot` 注释（那是插已知色条称出来的，不是猜的）。
 *
 *  【用法】node tools/_r53-shots.mjs
 * ============================================================
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode, verifiedShot,
} from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-shots');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

/** 与 `_r53-verify.mjs` 里那份**刻意保持一致**（两份都改了就要一起改） */
const RUNTIME_WX = `
(function () {
  var S = globalThis.__r53 = {
    create: 0, show: 0, load: 0, onClose: 0, onError: 0,
    kv: [], posted: [], shares: [], adMode: 'ok', _closeCb: null, _errCb: null,
  };
  globalThis.__r53Ad = {
    show: function () { S.show++; return Promise.resolve(); },
    load: function () { S.load++; return Promise.resolve(); },
    onClose: function (cb) { S.onClose++; S._closeCb = cb; },
    onError: function (cb) { S.onError++; S._errCb = cb; },
  };
  globalThis.wx = {
    createRewardedVideoAd: function () { S.create++; return globalThis.__r53Ad; },
    showShareMenu: function () {}, onShareAppMessage: function () {},
    shareAppMessage: function (o) { S.shares.push(o); },
    setUserCloudStorage: function (o) { S.kv.push(o); },
    getOpenDataContext: function () { return { postMessage: function (m) { S.posted.push(m); } }; },
    getLaunchOptionsSync: function () { return { query: {} }; },
  };
  return true;
})()`;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

async function exists(name) {
    return await cdp.ev('!!window.__g5t.find(' + JSON.stringify(name) + ')');
}
async function tap(name) {
    try { await tapNode(cdp, name); return true; } catch { return false; }
}
async function shot(name) {
    const out = await verifiedShot(cdp, join(OUT, `${name}.png`), { w: W, h: H, scale: SCALE });
    console.log(`[✓] ${name} → ${out}`);
}

/** 等某个日志出现在缓冲里（不做 reload，所以日志缓冲是全程累积的） */
async function waitLog(sub, timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (cdp.logs.some((l) => l.text.includes(sub))) return true;
        await sleep(150);
    }
    return false;
}

try {
    // ============================================================
    //  A · 首页（先截"无 wx 的降级态"，再注入 wx 截"真分支"）
    // ============================================================
    await navigateTo(cdp, 'home');
    await sleep(600);

    // ---- 04 排行榜 · 降级态 ----
    if (!(await tap('Fn_rank'))) throw new Error('点不到排行榜入口');
    await sleep(800);
    if (!(await exists('RankLayer'))) throw new Error('排行榜浮层没起来');
    if (await exists('OpenDataView')) throw new Error('无 wx 时不该建 OpenDataView');
    await shot('04-排行榜-浏览器降级态');
    await tap('RankClose');
    await sleep(600);

    // ---- 05 排行榜 · 开放数据域视窗 ----
    await cdp.ev(RUNTIME_WX);
    if (!(await tap('Fn_rank'))) throw new Error('点不到排行榜入口（第二次）');
    await sleep(900);
    if (!(await exists('OpenDataView'))) throw new Error('有 wx 时应当建出 OpenDataView');
    await shot('05-排行榜-开放数据域视窗');
    await tap('RankClose');
    await sleep(600);

    // ============================================================
    //  B · 主玩页 · 胜态（分享）
    // ============================================================
    await navigateTo(cdp, 'game');
    await sleep(800);

    await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
    await sleep(800);
    if (!(await exists('BtnShare'))) throw new Error('胜态没出现 BtnShare');
    await shot('06-胜态结算-分享入口');

    // ---- 07 分享 · 降级提示（先把 wx 摘掉）----
    await cdp.ev('(function () { delete globalThis.wx; return true; })()');
    await tap('BtnShare');
    await sleep(420);
    await shot('07-分享-浏览器降级提示');

    // ============================================================
    //  C · 回主玩页 · 失败态（复活 / 替身面板 / 真分支）
    // ============================================================
    // ⚠️ 不能 `Page.reload`（截图会挂死）⇒ 用胜态卡上的「下一关」出局，
    //    再照 `navigateTo` 的后半段重新进一局（开局页掷骰 4.5s + BtnGo）。
    await cdp.ev(RUNTIME_WX);
    if (!(await tap('BtnNext'))) throw new Error('点不到「下一关」');
    if (!(await waitLog('[PageManager] → gameStart'))) throw new Error('没回开局页');
    await sleep(4600);
    if (!(await tap('BtnGo'))) throw new Error('点不到「开始挑战」');
    if (!(await waitLog('[PageManager] → game'))) throw new Error('没回主玩页');
    await sleep(1200);

    // ---- 01 失败结算弹层 ----
    await cdp.ev('(function () { __game5.demoResult(false); return true; })()');
    await sleep(800);
    if (!(await exists('BtnAdRevive'))) throw new Error('失败态没出现 BtnAdRevive');
    await shot('01-失败结算-看广告复活位');

    // ---- 02 替身广告面板（mock：把开关关掉即可）----
    await cdp.ev('__game5.adConfig({ REAL_ENABLED: false })');
    await tap('BtnAdRevive');
    await sleep(900);
    if (!(await exists('AdPanel'))) throw new Error('替身面板没起来');
    await shot('02-替身广告面板-演示用');
    await tap('Btn_跳过');
    await sleep(800);

    // ---- 03 真广告播放中（无面板）----
    await cdp.ev("__game5.adConfig({ REAL_ENABLED: true, AD_UNIT: { revive: 'adunit-r53' } })");
    const st = await cdp.ev('__game5.platform()');
    if (st.ad.revive !== 'real') throw new Error('没切到 real 分支：' + JSON.stringify(st.ad));
    await tap('BtnAdRevive');
    await sleep(900);
    if (await exists('AdPanel')) throw new Error('真分支不该有替身面板');
    const during = await cdp.ev('__game5.platform()');
    console.log('    真分支播放中 platform =', JSON.stringify(during));
    await shot('03-真广告播放中-无面板');
    // 收口，别让页面留着 pending
    await cdp.ev('globalThis.__r53._closeCb({ isEnded: false })');
    await sleep(700);
    await cdp.ev('__game5.adConfig({ REAL_ENABLED: false })');

    console.log('\n全部截图完成：' + OUT);
} finally {
    await close();
    proc.kill();
}
