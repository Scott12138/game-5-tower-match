#!/usr/bin/env node
/**
 * ============================================================
 *  _r57-signshots.mjs · 第 57 轮 · 七日签到「领取」落点取证板
 * ============================================================
 *  用户 2026-10-07 拍板：**采用方案 A**（当天格子下沿骑一颗小「领取」胶囊）。
 *  本脚本把"落点到底在哪、三种交互态各长什么样"用**真实构建 + 真实鼠标**
 *  截下来，并顺手把几何量出来（板上的数字全是量出来的，没有一个手抄）。
 *
 *  ── 要证的三件事 ──────────────────────────────────────────
 *   ① **落点**：胶囊 83×42，水平 = **当天那格**的横向中线（不是整排中线），
 *      垂直 = 底边越过格底 **19** 设计 px。
 *   ② **三态互斥**：已领（青玉勾）/ 当天（暖金呼吸 + 胶囊）/ 未到（压暗 52%）。
 *   ③ **领完的变化**：当天直接翻 `done`（带勾）+ 胶囊**整颗消失**
 *      —— 视觉稿「稿 C · 今日已签」就是这个口径，稿 A 家族不带大按钮。
 *
 *  ── ⚠️ 两个必须绕开的坑 ────────────────────────────────────
 *   ① `Page.reload` 之后再调 `Page.captureScreenshot` 会**一直不返回**
 *      （见 `_r53-shots.mjs` 头部）。而签到状态只能靠"昨天签过"造出来，
 *      必然要重载存档 ⇒ 本脚本的解法是**每个状态各开一次浏览器**，
 *      `openBrowser({seedScript})` 在页面脚本之前就把存档铺好，**全程不 reload**。
 *   ② 截图一律走 `verifiedShot()`（带 IHDR 尺寸自证），
 *      绝不自己写 `captureScreenshot` 参数 —— 那个真值表是用已知色条称出来的。
 *
 *  【用法】node tools/_r57-signshots.mjs
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, sleep, startServer, tapNode, verifiedShot, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r57-signshots');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;
const LEVEL = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

/** 本地日期 YYYY-MM-DD（与 `SaveService.todayKey()` 故意各写一遍） */
function ymd(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 造存档的种子脚本（在页面脚本之前执行 ⇒ `SaveService` 模块加载时读到的就是它）。
 * `dateOffset = null` ⇒ `signDate` 空串 = 从未签到。
 */
function signSeed(streak, dateOffset) {
    const date = dateOffset === null ? '' : ymd(dateOffset);
    return `try { localStorage.setItem('game5.save.v1', JSON.stringify({
        level: ${LEVEL}, best: ${Math.max(0, LEVEL - 1)},
        inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
        coins: 0, plays: 0, cleared: 0,
        signDate: ${JSON.stringify(date)}, signStreak: ${streak},
        dailyDate: '', daily: {}
    })); } catch (e) {}`;
}

/** 量当前页面上的签到几何（设计 px） */
const GEO = `(function () {
    function g(n) {
        var x = window.__g5t.find(n);
        if (!x) return null;
        var u = x.getComponent('cc.UITransform');
        return { w: u.width, h: u.height, x: x.position.x, y: x.position.y,
                 p: x.parent ? x.parent.name : null };
    }
    function has(n) { return !!window.__g5t.find(n); }
    var ticks = [];
    for (var d = 1; d <= 7; d++) if (has('SignTick_' + d)) ticks.push(d);
    var glows = [];
    for (var e = 1; e <= 7; e++) if (has('SignGlow_' + e)) glows.push(e);
    return {
        card: g('SignCard'), grid: g('SignCells'),
        cell1: g('SignCell_1'), cell7: g('SignCell_7'),
        claim: g('SignClaim'),
        ticks: ticks, glows: glows,
        streak: (function () {
            var n = window.__g5t.find('SignStreak');
            if (!n) return null;
            var l = n.getComponentInChildren && n.getComponent('cc.Label');
            var kids = n.children;
            for (var i = 0; i < kids.length; i++) {
                var lb = kids[i].getComponent('cc.Label');
                if (lb) return lb.string;
            }
            return null;
        })(),
    };
})()`;

async function exists(cdp, name) {
    return await cdp.ev('!!window.__g5t.find(' + JSON.stringify(name) + ')');
}
async function tap(cdp, name) {
    try { await tapNode(cdp, name); return true; } catch { return false; }
}

/** 一个状态 = 一次独立会话（自带种子，全程不 reload） */
async function capture(id, title, { streak, dateOffset }, { open = true, after = null } = {}) {
    const { cdp, close } = await openBrowser(url, {
        seedScript: signSeed(streak, dateOffset), width: W, height: H, scale: SCALE,
    });
    try {
        await navigateTo(cdp, 'home');
        await waitFor(cdp, "!!(window.__g5t && window.__g5t.find('Fn_signin'))", 30000, '首页四入口');
        await sleep(700);

        const homeDots = await cdp.ev(`(function () {
            return { signin: !!window.__g5t.find('FnDot_signin'),
                     shop: !!window.__g5t.find('FnDot_shop'),
                     rank: !!window.__g5t.find('FnDot_rank') };
        })()`);

        let geo = null;
        if (open) {
            if (!(await tap(cdp, 'Fn_signin'))) throw new Error(`${id}: 点不到 Fn_signin`);
            await sleep(900);
            // ★ 先量再动：`after` 可能弹二级层把卡片盖住
            geo = await cdp.ev(GEO);
            if (after) { await after(cdp); await sleep(800); }
        }
        const png = join(OUT, `${id}.png`);
        await verifiedShot(cdp, png, { w: W, h: H, scale: SCALE });
        console.log(`[✓] ${id} · ${title} → ${png}`);
        return { id, title, png, geo, homeDots, seed: { streak, dateOffset } };
    } finally {
        try { await close(); } catch { /* ignore */ }
    }
}

const results = [];
try {
    // 00 首页 —— 今日未签 ⇒ 签到 / 商城各一颗红点（T13b）
    results.push(await capture('00-首页-今日未签-红点', '首页 · 今日未签（签到入口带红点）',
        { streak: 0, dateOffset: null }, { open: false }));

    // 01 当天可领 —— 稿 A 的正面：胶囊骑在第 3 格下沿正中
    results.push(await capture('01-今天可领-胶囊骑下沿', '当天可领 · 「领取」胶囊骑在第 3 格下沿',
        { streak: 2, dateOffset: -1 }));

    // 02 今日已领 —— 稿 C：第 1/2/3 格带勾，胶囊整颗消失
    results.push(await capture('02-今日已领-稿C', '今日已领（稿 C）· 第 3 格转勾，胶囊消失',
        { streak: 3, dateOffset: 0 }));

    // 03 第 7 日四选一 —— 点胶囊弹出的二级弹层
    results.push(await capture('03-第7日-四选一', '第 7 日 · 点胶囊弹「四选一」',
        { streak: 6, dateOffset: -1 },
        { after: async (cdp) => { await tap(cdp, 'SignClaim'); } }));

    // 04 已领满一轮 —— 循环回第 1 天
    results.push(await capture('04-满7循环回第1天', '满 7 天循环 · 当天回到第 1 格（无勾）',
        { streak: 7, dateOffset: -1 }));

    writeFileSync(join(OUT, 'shots.json'), JSON.stringify(results, null, 2));
    console.log(`\n取证 JSON → ${join(OUT, 'shots.json')}`);
    console.log(`共 ${results.length} 张`);
} finally {
    proc.kill();
}
