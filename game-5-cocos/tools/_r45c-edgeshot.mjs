#!/usr/bin/env node
/**
 * ============================================================
 *  _r45c-edgeshot.mjs · 「牌左缘」定尺取样（给改前/改后做同倍率对照）
 * ============================================================
 *  【为什么需要它】
 *   第 45 轮删掉了牌周边的金环（drawRing：主环 w+4/3px + 三层外发光 w+8/16/24）。
 *   用户手上那张「改前」截图（672×680 的裁切）实测是 **1 截图 px ≈ 1 设计 px**，
 *   所以 80×120 的窗口 ×8 放大 = **8 输出 px / 设计 px**。
 *   要跟它并排比，改后这一侧必须**同一倍率、同一对位窗口**。
 *
 *  【窗口怎么定的 —— 与「你圈的位置-8x.png」严格一致】
 *   改前那张的来源：用户截图裁 x∈[160,240), y∈[150,270)（80×120 截图 px）再 ×8。
 *   在该窗口里，牌节点的左缘落在 **x = 202** ⇒ 距窗口左边 **42 px**（= 42 设计 px），
 *   牌节点上缘落在 **y ≈ 175** ⇒ 距窗口上边 **25 px**。
 *   于是本脚本对任一目标牌取窗口：
 *       designX ∈ [nodeLeft − 42, nodeLeft + 38]
 *       designY ∈ [nodeTop  − 25, nodeTop  + 95]
 *
 *  【倍率 —— 踩过的坑，别再动】
 *   `Page.captureScreenshot` 的 `clip.scale` **不是**最终倍率：实测 DPR=3、scale=14.25、
 *   clip 宽 44.907 CSS px 时，出图 **1881 px** 宽 = 23.51 输出 px / 设计 px，
 *   而 8 / 0.56133 = 14.25 才对 ⇒ 浏览器把 DPR 又乘进去了（还带个 ~0.98 的零头）。
 *   这种"文档没写清、实测又带零头"的换算**不适合当尺子**。
 *   ⇒ 本脚本改成：**按真机 DPR 3 出原尺寸窗口**（scale 1，出图 ≈ 1.684 px/设计 px），
 *     再由 Python 统一重采样到 8 输出 px / 设计 px。倍率只由 Python 那一处决定，
 *     浏览器怎么算都不影响结论。
 *
 *  【用法】node tools/_r45c-edgeshot.mjs [输出目录]
 *          （第二段重采样见 tools/r45c-edge-pair.py）
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r45c-edge');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, DPR = 3;          // DPR 3 = 真机口径
const WIN_D = { w: 80, h: 120 };          // 窗口（设计 px）= 改前那张的窗口
const ANCHOR_D = { x: 42, y: 25 };        // 牌左缘/上缘在窗口内的位置（设计 px）

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: DPR,
});

async function shot(file, clip) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, file);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    return p;
}

const SURVEY = `(function () {
  var g = globalThis.__game5, T = globalThis.__g5t;
  var v = T.view(), r = T.canvasRect();
  if (!v || !r) return { err: 'no view/canvas' };
  var k = r.w / v.w;                       // 设计 px → CSS px
  var live = {};
  g.pickables().forEach(function (p) { live[String(p.id)] = true; });
  var out = [];
  T.listNamed().forEach(function (o) {
    if (!/^T\\d+$/.test(o.name)) return;
    var n = T.find(o.name);
    if (!n) return;
    var ui = n.getComponent('cc.UITransform');
    var w = ui.width, h = ui.height;
    var ang = ((n.angle % 180) + 180) % 180;    // 0 = 竖牌，90 = 横牌
    var dw = ang === 90 ? h : w, dh = ang === 90 ? w : h;   // 屏幕上占的设计尺寸
    out.push({ name: o.name, id: +o.name.slice(1),
               cx: o.x / k, cy: o.y / k,          // 牌心（设计 px）
               nodeW: w, nodeH: h, dw: dw, dh: dh, rot: ang,
               live: !!live[String(+o.name.slice(1))] });
  });
  return { k: k, cssW: r.w, cssH: r.h, viewW: v.w, viewH: v.h, tiles: out,
           state: g.state(), pickables: g.pickables().map(function (p) { return { id: p.id, face: p.face }; }) };
})()`;

/**
 * ★ 干净度打分 —— 这一条是踩坑补的。
 *   第一版只按「最靠左上」选，结果 T29 的窗口左边压着一张**下层的灰阶牌**：
 *   它亮度够高（灰阶牌 ≈ 150 luma），Python 的「找牌体左缘」直接锁到了它身上
 *   （报 250/640，而真牌缘应在 336/640）⇒ 对账位置全错。
 *   所以改成：**牌缘左侧那一条带子里不许有别的牌**。带子 = [left−26, left] × 整高。
 *   顺带把上边也纳入（窗口顶盖上别的牌会让画面不像"干净的绒布 + 一道金线"）。
 */
const overlap = (a, b) => {
    const ax1 = a.cx - a.dw / 2, ax2 = a.cx + a.dw / 2;
    const ay1 = a.cy - a.dh / 2, ay2 = a.cy + a.dh / 2;
    const bx1 = b.cx - b.dw / 2, bx2 = b.cx + b.dw / 2;
    const by1 = b.cy - b.dh / 2, by2 = b.cy + b.dh / 2;
    const w = Math.min(ax2, bx2) - Math.max(ax1, bx1);
    const h = Math.min(ay2, by2) - Math.max(ay1, by1);
    return w > 0 && h > 0 ? w * h : 0;
};
function rank(tiles) {
    const fit = tiles.tiles.filter((t) => {
        if (!t.live || t.rot !== 0) return false;
        const left = t.cx - t.dw / 2 - ANCHOR_D.x;
        const top = t.cy - t.dh / 2 - ANCHOR_D.y;
        return left >= 2 && top >= 2 && left + WIN_D.w <= tiles.viewW - 2
            && top + WIN_D.h <= tiles.viewH - 2;
    });
    const score = (t) => {
        const left = t.cx - t.dw / 2, top = t.cy - t.dh / 2;
        const bandL = { cx: left - 13, cy: t.cy, dw: 26, dh: t.dh };      // 缘左 26 设计 px
        const bandT = { cx: t.cx, cy: top - 12, dw: t.dw, dh: 24 };       // 缘上 24 设计 px
        let s = 0;
        for (const o of tiles.tiles) {
            if (o.name === t.name) continue;
            s += overlap(bandL, o) + overlap(bandT, o);
        }
        return s;
    };
    for (const t of fit) t.pol = score(t);
    fit.sort((a, b) => (a.pol - b.pol) || (b.dw - a.dw) || (a.cy - b.cy));
    return fit;
}
/** 消掉一组「同牌面三连」把牌堆打开（用真实点击处理函数，不是旁路） */
async function clearTriple() {
    const ps = await cdp.ev(`globalThis.__game5.pickables()`);
    const byFace = new Map();
    for (const p of ps) {
        if (!byFace.has(p.face)) byFace.set(p.face, []);
        byFace.get(p.face).push(p.id);
    }
    for (const [face, ids] of byFace) {
        if (ids.length >= 3) {
            for (const id of ids.slice(0, 3)) {
                await cdp.ev(`globalThis.__game5.pick(${id})`);
                await sleep(320);
            }
            return { face, n: 3 };
        }
    }
    return null;
}

try {
    await navigateTo(cdp, 'game');
    await waitFor(cdp, 'typeof cc !== "undefined" && !!globalThis.__game5', 30000, '引擎 + 桥接');
    await sleep(2600);

    // 新开局牌堆太密，可点牌的左缘基本都被下层牌压着 ⇒ 先按真实点击消几组三连，
    // 把牌堆打开再取景。
    // ⚠️ 必须**每次普查完立刻截图**：第一版把最好的一轮快照存下来、循环结束后再截图，
    //    结果中间又消了一组三连，牌位已经变了 ⇒ 截出来一整张纯绿绒布（牌根本不在窗口里）。
    let best = null;
    let kCss = null;
    for (let round = 0; round < 5; round++) {
        const tiles = await cdp.ev(SURVEY);
        if (tiles.err) throw new Error(tiles.err);
        kCss = tiles.k;
        const fit = rank(tiles);
        const top = fit[0];
        console.log('第 %d 轮：候选 %d 张，最干净 %s（污染面积 %s）  剩 %d 张 / 槽 %d',
            round + 1, fit.length, top ? top.name : '无', top ? Math.round(top.pol) : '-',
            tiles.state.remaining, tiles.state.slots);
        if (!fit.length) break;

        const cw = WIN_D.w * kCss, ch = WIN_D.h * kCss;
        const shots = [];
        for (const t of fit.slice(0, 2)) {
            const leftD = t.cx - t.dw / 2 - ANCHOR_D.x;
            const topD = t.cy - t.dh / 2 - ANCHOR_D.y;
            const file = `r${round + 1}-${t.name}-w${Math.round(t.dw)}.png`;
            await shot(file, { x: leftD * kCss, y: topD * kCss, width: cw, height: ch });
            shots.push({ file, tile: t.name, designW: t.dw, pol: Math.round(t.pol),
                         leftD, topD, live: t.live, rot: t.rot });
        }
        if (!best || top.pol < best.pol) {
            best = { pol: top.pol, tile: top.name, round: round + 1, shots,
                     tiles: tiles.tiles, state: tiles.state, k: kCss };
            console.log('   → 记为当前最佳（%s，污染面积 %d）', top.name, Math.round(top.pol));
        }
        if (top.pol <= 200) { console.log('   —— 已经足够干净，停止开牌堆'); break; }
        const c = await clearTriple();
        if (!c) { console.log('   —— 没有可消的三连，停止开牌堆'); break; }
        console.log('   消掉一组同牌面三连（%s）', c.face);
        await sleep(900);
    }
    if (!best) throw new Error('始终没有窗口完全落在视口内的可点竖牌');

    console.log('\n→ 采用第 %d 轮的 %s（污染面积 %d）', best.round, best.tile, Math.round(best.pol));
    for (const s of best.shots) console.log('   %s  牌宽 %d 设计 px  窗口设计原点 (%s, %s)  污染 %d',
        s.tile, s.designW, s.leftD.toFixed(1), s.topD.toFixed(1), s.pol);

    const manifest = { k: best.k, dpr: DPR, win: WIN_D, anchor: ANCHOR_D,
                       state: best.state, tiles: best.tiles, chosen: best.shots };
    writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('\n[v] 窗口 = %d×%d 设计 px（scale 1 → 真机 DPR %d 原尺寸）',
        WIN_D.w, WIN_D.h, DPR);
} finally {
    close();
    proc.kill();
}
