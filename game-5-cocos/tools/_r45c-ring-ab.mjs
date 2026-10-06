#!/usr/bin/env node
/**
 * ============================================================
 *  _r45c-ring-ab.mjs · 金环 A/B（**同一相机、同一帧位**的唯一变量对照）
 * ============================================================
 *  【为什么不用"用户截图 vs 本轮截图"直接并排】
 *   用户那张 672×680 的截图是**手机截图再裁切**出来的，它到底多少 px / 设计 px
 *   无法从图里反解（我用"牌体左缘相对窗口的位置"推，两次推出来差 9.5 设计 px，
 *   说明两张图**不同比例尺**）。把不同比例尺的两张图并排、再拿同一把尺子量暖金像素，
 *   量出来的差值是尺子造成的，不是代码造成的 —— 这种"A/B"比不做还糟。
 *
 *  【做法】
 *   在本轮构建上，**把被删掉的那段 drawRing 按原参数在页面里补画回去**，
 *   同一节点、同一相机、同一帧位截两张 ⇒ 两张图**唯一的差异就是金环本身**。
 *   原参数（`git show HEAD:./assets/scripts/ui/TileRenderer.ts`，本轮已删）：
 *       const r = Math.max(6, w * 0.12);
 *       for (let i = 3; i >= 1; i--)                                   // 三层外发光
 *           strokeRoundRect(g, 0, 0, w + i*8, h + i*8, r + i*4,
 *                           COLOR.GOLD, i === 1 ? 2.5 : 1.0, Math.round(52 / i));
 *       strokeRoundRect(g, 0, 0, w + 4, h + 4, r + 2, COLOR.GOLD, 3, 132);   // 主环
 *   COLOR.GOLD = '#F6C445'。
 *
 *  【怎么读这张 A/B】
 *   right = 本轮构建（真；环已删）        left = 同上 + 补画回原环（复原）
 *   两张都**不是**"改前的真实构建"，而是"改后构建 ± 那段代码的效果"。
 *   用户自己那张截图另列为实况佐证（见对照页）。
 *
 *  【用法】node tools/_r45c-ring-ab.mjs [输出目录]
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r45c-ringab');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, DPR = 3;      // 真机口径
const WIN_D = { w: 80, h: 120 };      // 与「你圈的位置-8x.png」同一窗口（设计 px）
const ANCHOR_D = { x: 42, y: 25 };    // 牌左缘 / 上缘在窗口内的设计位置

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: DPR,
});

const SURVEY = `(function () {
  var g = globalThis.__game5, T = globalThis.__g5t;
  var v = T.view(), r = T.canvasRect();
  if (!v || !r) return { err: 'no view/canvas' };
  var k = r.w / v.w;
  var live = {};
  g.pickables().forEach(function (p) { live[String(p.id)] = true; });
  var out = [];
  T.listNamed().forEach(function (o) {
    if (!/^T\\d+$/.test(o.name)) return;
    var n = T.find(o.name); if (!n) return;
    var ui = n.getComponent('cc.UITransform');
    var ang = ((n.angle % 180) + 180) % 180;
    out.push({ name: o.name, cx: o.x / k, cy: o.y / k,
               dw: ang === 90 ? ui.height : ui.width,
               dh: ang === 90 ? ui.width : ui.height, rot: ang,
               nodeW: ui.width, nodeH: ui.height,
               live: !!live[String(+o.name.slice(1))] });
  });
  return { k: k, viewW: v.w, viewH: v.h, tiles: out, state: g.state() };
})()`;

/** 把被删的 drawRing 按原参数补画回去（只加一个临时子节点，不动任何既有节点） */
const ADD_RING = (name) => `(function () {
  var cc = globalThis.cc, T = globalThis.__g5t;
  var n = T.find(${JSON.stringify(name)});
  if (!n) return 'no node';
  var old = n.getChildByName('RingProbe');
  if (old) { old.removeFromParent(); old.destroy(); }
  var ui = n.getComponent('cc.UITransform');
  var w = ui.width, h = ui.height;
  var gn = new cc.Node('RingProbe');
  n.addChild(gn);
  var g = gn.addComponent('cc.Graphics');
  if (!g) return 'no graphics';
  var r = Math.max(6, w * 0.12);
  function stroke(cw, ch, rr, lw, al) {
    g.lineWidth = lw;
    g.strokeColor = new cc.Color(246, 196, 69, al);      // COLOR.GOLD = #F6C445
    g.roundRect(-cw / 2, -ch / 2, cw, ch, rr);
    g.stroke();
  }
  for (var i = 3; i >= 1; i--) stroke(w + i * 8, h + i * 8, r + i * 4, i === 1 ? 2.5 : 1.0, Math.round(52 / i));
  stroke(w + 4, h + 4, r + 2, 3, 132);
  return 'ok w=' + w + ' h=' + h + ' r=' + r;
})()`;

async function shot(file, clip) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, file);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    return p;
}

const overlap = (a, b) => {
    const ax1 = a.cx - a.dw / 2, ax2 = a.cx + a.dw / 2;
    const ay1 = a.cy - a.dh / 2, ay2 = a.cy + a.dh / 2;
    const bx1 = b.cx - b.dw / 2, bx2 = b.cx + b.dw / 2;
    const by1 = b.cy - b.dh / 2, by2 = b.cy + b.dh / 2;
    const w = Math.min(ax2, bx2) - Math.max(ax1, bx1);
    const h = Math.min(ay2, by2) - Math.max(ay1, by1);
    return w > 0 && h > 0 ? w * h : 0;
};
/** 只关心「牌左缘上半段」那一片是否干净 —— 用户圈的就是牌体左上角外侧那一块 */
function rank(tiles) {
    const fit = tiles.tiles.filter((t) => {
        if (!t.live || t.rot !== 0) return false;
        const left = t.cx - t.dw / 2 - ANCHOR_D.x;
        const top = t.cy - t.dh / 2 - ANCHOR_D.y;
        return left >= 2 && top >= 2 && left + WIN_D.w <= tiles.viewW - 2
            && top + WIN_D.h <= tiles.viewH - 2;
    });
    for (const t of fit) {
        const left = t.cx - t.dw / 2, top = t.cy - t.dh / 2;
        const bandL = { cx: left - 13, cy: top + 32, dw: 26, dh: 64 };    // 缘左、上半段
        const bandT = { cx: t.cx, cy: top - 12, dw: t.dw, dh: 24 };       // 缘上
        let s = 0;
        for (const o of tiles.tiles) {
            if (o.name === t.name) continue;
            s += overlap(bandL, o) + overlap(bandT, o);
        }
        t.pol = s;
    }
    fit.sort((a, b) => (a.pol - b.pol) || (b.dw - a.dw) || (a.cy - b.cy));
    return fit;
}
async function clearTriple() {
    const ps = await cdp.ev(`globalThis.__game5.pickables()`);
    const byFace = new Map();
    for (const p of ps) { if (!byFace.has(p.face)) byFace.set(p.face, []); byFace.get(p.face).push(p.id); }
    for (const [face, ids] of byFace) {
        if (ids.length >= 3) {
            for (const id of ids.slice(0, 3)) { await cdp.ev(`globalThis.__game5.pick(${id})`); await sleep(320); }
            return { face, n: 3 };
        }
    }
    return null;
}

try {
    await navigateTo(cdp, 'game');
    await waitFor(cdp, 'typeof cc !== "undefined" && !!globalThis.__game5', 30000, '引擎 + 桥接');
    await sleep(2600);

    let best = null;
    for (let round = 0; round < 5; round++) {
        const tiles = await cdp.ev(SURVEY);
        if (tiles.err) throw new Error(tiles.err);
        const fit = rank(tiles);
        const top = fit[0];
        console.log('第 %d 轮：候选 %d 张，左上角最干净 %s（污染 %s）  剩 %d 张',
            round + 1, fit.length, top ? top.name : '无', top ? Math.round(top.pol) : '-', tiles.state.remaining);
        if (top && (!best || top.pol < best.pol)) best = { tiles, fit, pol: top.pol, round: round + 1 };
        if (top && top.pol <= 60) break;
        const c = await clearTriple();
        if (!c) break;
        console.log('   消掉一组同牌面三连（%s）', c.face);
        await sleep(900);
    }
    if (!best) throw new Error('没有可用取景');

    // ⚠️ 必须在**决定取景之后立刻**重新普查一次拿当前坐标（中间消过牌，位置会变）
    const tiles = await cdp.ev(SURVEY);
    const fit = rank(tiles);
    const t = fit[0];
    if (!t) throw new Error('最后一遍普查没有可用取景');
    console.log('\n→ 实际取景：%s（第 %d 轮快照，当前污染 %d）', t.name, best.round, Math.round(t.pol));

    const k = tiles.k;
    const leftD = t.cx - t.dw / 2 - ANCHOR_D.x;
    const topD = t.cy - t.dh / 2 - ANCHOR_D.y;
    const clip = { x: leftD * k, y: topD * k, width: WIN_D.w * k, height: WIN_D.h * k };

    const now = await shot('now.png', clip);
    const info = await cdp.ev(ADD_RING(t.name));
    console.log('补画金环：%s', info);
    if (info !== 'ok' && !String(info).startsWith('ok ')) throw new Error('补画失败：' + info);
    await sleep(320);
    const was = await shot('was.png', clip);
    await cdp.ev(`(function(){ var n = globalThis.__g5t.find(${JSON.stringify(t.name)});
        var o = n && n.getChildByName('RingProbe'); if (o) { o.removeFromParent(); o.destroy(); } return true; })()`);

    writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify({
        tile: t.name, designW: t.dw, nodeW: t.nodeW, nodeH: t.nodeH,
        k, dpr: DPR, win: WIN_D, anchor: ANCHOR_D, clip,
        ringParams: '主环 w+4/3px/a132 + 外发光 i=1..3 (w+8i, 2.5|1px, a=52/i)  GOLD=#F6C445',
        files: { now, was },
    }, null, 2));
    console.log('\n[v] now（本轮） → %s', now);
    console.log('[v] was（补画环）→ %s', was);
} finally {
    close();
    proc.kill();
}
