#!/usr/bin/env node
/**
 * ============================================================
 *  _r49-probe.mjs · 第 49 轮 · 两个问题的几何体检（只量，不改）
 * ============================================================
 *  问题 ① 用户：「看广告的提示正好盖住了槽位，把广告提示从道具上方换到道具下方」
 *  问题 ② 用户：「"通关啦"和"只差一点"结算字样在横向上都不太居中，看着偏左了一些」
 *
 *  ────────────────────────────────────────────────────────────
 *  【★ 本脚本用的关键口径换算（别再猜）】
 *    `node.worldPosition.y` 在 fitWidth 下**就是「距屏幕底边的设计 px」**：
 *      Canvas 世界坐标 = (vw/2, vh/2)，而 `Layout.botY(v) = -vh/2 + v`
 *      ⇒ 节点世界 y = vh/2 + botY(v) = v。所以读 worldY 即得距底距离，
 *      不必绕 `__g5t.worldToScreen`（那条路会先转 CSS 像素再反算，多两次舍入）。
 *    ⚠️ 前提 = 该节点到 Canvas 之间**没有缩放**。带缩放的节点（槽内小牌等）
 *      这里会额外打出 sx/sy，非 1 时 worldY 需要除以缩放才还原。
 *
 *  【① 的量法】把底带四层（暂存架 / 槽位条 / 道具栏 / 新空档）各自
 *    「距底上沿、下沿」列出来，再叠上 toast 的实测框 ⇒ 直接读出"盖住了谁"。
 *    对照组 = 同一次运行里对一个**无关节点**（HudBar）的同样量法，
 *    证明量法本身没把坐标读错半屏。
 *
 *  【② 的量法】标题是 `overflow: NONE` 的 Label ⇒ contentSize **由引擎按文本重算**，
 *    传进去的 `w` 是无效的。所以这里同时打：
 *      · 节点 worldPosition.x 与卡的 worldPosition.x 之差（**锚点对齐量**）
 *      · Label 的 horizontalAlign / overflow / 实际 contentSize
 *      · 字形中心（用 Canvas 侧的像素墨迹另行量，见 r49-title-ink.py）
 *    三者若「锚点对齐量 ≈ 0 且 hAlign = CENTER」，那偏左就**不是排版参数问题**，
 *    而是「全角标点的 advance ≠ 墨迹宽」造成的视觉重心偏移 —— 这是两个完全
 *    不同的修法，必须先分清。
 *
 *  【用法】
 *    node tools/_r49-probe.mjs /tmp/g5-r49
 *    G5_LEVEL=10 可选
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r49');
mkdirSync(OUT, { recursive: true });
const LEVEL = Number(process.env.G5_LEVEL || 10);
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(LEVEL), width: W, height: H, scale: 1,
});

async function shot(file) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: W, height: H, scale: SCALE },
        captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, file);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    console.log(`      → ${p}`);
    return p;
}

/** 列出「按名字挑出的节点」的距底几何（worldY = 距底设计 px） */
const NODES_PROBE = `(function () {
  var NAMES = ${JSON.stringify([
    'Toast', 'ToolBar', 'Tool_erase', 'SlotBar', 'Slot0',
  ])};
  var v = window.__g5t.view();
  var s = cc.director.getScene();
  function r2(x) { return Math.round(x * 100) / 100; }
  function walk(n, fn) { fn(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], fn); }
  var all = {};
  walk(s, function (n) {
    if (NAMES.indexOf(n.name) < 0) return;
    var ui = n.getComponent && n.getComponent('cc.UITransform');
    var ws = n.worldScale || n.scale;
    var wp = n.worldPosition;
    var sx = ws ? ws.x : 1, sy = ws ? ws.y : 1;
    if (all[n.name]) return;                       // 只取第一个
    all[n.name] = {
      worldX: r2(wp.x), fromBottom: r2(wp.y),
      w: ui ? r2(ui.width * sx) : null, h: ui ? r2(ui.height * sy) : null,
      rawW: ui ? r2(ui.width) : null, rawH: ui ? r2(ui.height) : null,
      sx: sx, sy: sy,
    };
  });
  // 兜底：把底带里所有出现的名字打一遍，方便肉眼找（新加的节点也能看见）
  var names = [];
  walk(s, function (n) {
    var p = n.parent ? n.parent.name : '';
    if (p === 'Body' && names.indexOf(n.name) < 0) names.push(n.name);
  });
  return { view: v, nodes: all, bodyKids: names };
})()`;

/** 结算卡 + 标题的**水平**几何 */
const TITLE_PROBE = `(function () {
  var s = cc.director.getScene();
  function r2(x) { return Math.round(x * 100) / 100; }
  function walk(n, fn) { fn(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], fn); }
  var card = null;
  walk(s, function (n) { if (!card && n.name === 'Card' && n.activeInHierarchy) card = n; });
  if (!card) return { err: 'no Card' };
  var v = window.__g5t.view();
  var cui = card.getComponent('cc.UITransform');
  var out = {
    view: v,
    card: { worldX: r2(card.worldPosition.x), w: r2(cui.width), h: r2(cui.height),
            left: r2(card.worldPosition.x - cui.width / 2),
            right: r2(card.worldPosition.x + cui.width / 2) },
    titles: [],
  };
  walk(card, function (n) {
    if (n.name !== 'Title' && n.name !== 'TitleShade') return;
    var ui = n.getComponent('cc.UITransform');
    var lb = n.getComponent('cc.Label');
    var ol = n.getComponent('cc.LabelOutline');
    out.titles.push({
      name: n.name,
      text: lb ? lb.string : null,
      worldX: r2(n.worldPosition.x),
      dxVsCard: r2(n.worldPosition.x - card.worldPosition.x),
      contentW: ui ? r2(ui.width) : null,
      contentH: ui ? r2(ui.height) : null,
      anchorX: r2(ui ? ui.anchorX : 0),
      hAlign: lb ? lb.horizontalAlign : null,
      overflow: lb ? lb.overflow : null,
      fontSize: lb ? lb.fontSize : null,
      lineHeight: lb ? r2(lb.lineHeight) : null,
      isBold: lb ? lb.isBold : null,
      fontFamily: lb ? lb.fontFamily : null,
      outlineWidth: ol ? ol.width : null,
      y: r2(n.worldPosition.y),
    });
  });
  return out;
})()`;

const R = { view: null, levels: {}, phases: {} };

// ---- 第一段：主玩页底带 + 卡住提示 ----
console.log('\n=== ① 主玩页：底带四层 vs 卡住提示 ===');
await navigateTo(cdp, 'game');
await sleep(500);

const base = await cdp.ev(NODES_PROBE);
R.view = base.view;
console.log(`   可视 ${base.view.w} × ${base.view.h}（设计 px）`);
console.log(`   Body 直属子节点：${base.bodyKids.join(', ')}`);
console.log('   底带各层（worldY = 距屏幕底的设计 px）：');
for (const [k, n] of Object.entries(base.nodes)) {
    console.log(`     ${k.padEnd(14)} 距底 ${String(n.fromBottom).padStart(8)}  高 ${String(n.h).padStart(7)}`
        + `  ⇒ 占 [${(n.fromBottom - n.h / 2).toFixed(1)}, ${(n.fromBottom + n.h / 2).toFixed(1)}]`
        + `  x=${n.worldX} w=${n.w}${n.sx !== 1 ? ` (sx=${n.sx})` : ''}`);
}
R.phases.idle = base;

// 触发卡住提示（走的就是 tickNudge 那条真实链路）
const okNudge = await cdp.ev('globalThis.__game5.forceNudge()');
console.log(`\n   forceNudge() → ${okNudge}`);
await sleep(500);
const withToast = await cdp.ev(NODES_PROBE);
const t = withToast.nodes.Toast;
if (t) {
    console.log(`   ★ Toast 距底中心 ${t.fromBottom}  高 ${t.h}`
        + `  ⇒ 占距底 [${(t.fromBottom - t.h / 2).toFixed(1)}, ${(t.fromBottom + t.h / 2).toFixed(1)}]`);
} else {
    console.log('   ✗ 没找到 Toast 节点');
}
await shot('r49-board-toast-idle.png');
R.phases.toast = withToast;

// ---- 第二段：结算标题的水平几何 ----
console.log('\n=== ② 结算标题（水平） ===');
//  ★ 胜态有「金币雨」（`coinRain()`：26 枚，delay ≤0.9s + dur ≤1.9s ⇒ 最迟 2.8s 全销毁），
//    金币从屏幕上落到屏幕外，中途**正好穿过标题那一条 y 带** ⇒ 逐列扫墨迹会被金币的
//    暗边切成碎片（第一版量出 5 段、偏移 +22.57，方向都是反的）。
//    所以这里必须**等金币全部退场**再截图：3.4s > 2.8s。
const COIN_CLEAR_MS = 3400;
await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await sleep(1200);
await navigateTo(cdp, 'game');
await sleep(400);
await cdp.ev('globalThis.__game5.demoResult(true)');
console.log(`   胜态：等金币雨退场 ${COIN_CLEAR_MS}ms 再截…`);
await sleep(COIN_CLEAR_MS);
const win = await cdp.ev(TITLE_PROBE);
R.phases.titleWin = win;
await shot('r49-title-win.png');

await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await sleep(1200);
await navigateTo(cdp, 'game');
await sleep(400);
await cdp.ev('globalThis.__game5.demoResult(false)');
await sleep(1400);
const fail = await cdp.ev(TITLE_PROBE);
R.phases.titleFail = fail;
await shot('r49-title-fail.png');

for (const [tag, o] of [['胜', win], ['负', fail]]) {
    if (o.err) { console.log(`   ${tag} ✗ ${o.err}`); continue; }
    console.log(`\n   ${tag}态：卡 左 ${o.card.left} 右 ${o.card.right}（宽 ${o.card.w}）中线 ${o.card.worldX}`);
    for (const x of o.titles) {
        console.log(`     ${x.name.padEnd(12)} x=${String(x.worldX).padStart(8)} (与卡中线差 ${x.dxVsCard})`
            + `  框 ${x.contentW}×${x.contentH}  anchorX=${x.anchorX}`);
        console.log(`     ${''.padEnd(12)} "${x.text}"  hAlign=${x.hAlign} overflow=${x.overflow}`
            + ` f=${x.fontSize} lh=${x.lineHeight} bold=${x.isBold} outline=${x.outlineWidth}`);
        console.log(`     ${''.padEnd(12)} font="${x.fontFamily}"`);
    }
}

writeFileSync(resolve(OUT, '_r49-probe.json'), JSON.stringify(R, null, 2));
console.log(`\n      → ${resolve(OUT, '_r49-probe.json')}`);

try { proc.kill(); } catch { /* ignore */ }
await close();
