#!/usr/bin/env node
/**
 * ============================================================
 *  _r48-probe-result.mjs · 第 48 轮 · 结算弹层排版体检（只量，不改）
 * ============================================================
 *  背景：用户反馈「通关啦！/ 就差一点！」这两个结算标题**整体显示很奇怪，
 *        文字超出了框外**。两轮截图都在真机上，肉眼可见标题骑在卡片金框上、
 *        上半身悬在卡外，失败态那张还压到了顶部 HUD。
 *
 *  ────────────────────────────────────────────────────────────
 *  【本脚本只做一件事】把结算卡里每个元素的**真实几何**打出来：
 *     · 卡片顶边中点                —— 坐标系原点（设计 px，y 向下）
 *     · 每个子节点的 (dx, dy, w, h) —— dx/dy 相对卡顶中点
 *     · Label 的文字 / 字号 / 实测宽高
 *  然后把「缎带标题」的四边与卡框四边直接对比，得出**溢出量**。
 *
 *  ⚠️ 口径（踩过，别再猜）：
 *    `worldPosition` = 节点**锚点**所在点；Card 锚点 (0.5, 1) ⇒ 它指向**卡顶中点**。
 *    Label 锚点 (0.5, 0.5) ⇒ 它指向**文字框中心**。
 *    `__g5t.view().h` 是设计可视高（真机 1651.43），所以 `dy = (vh − wp.y) − 卡顶`。
 *
 *  【用法】
 *    node tools/_r48-probe-result.mjs /tmp/g5-r48
 *    G5_LEVEL=7 可选（默认 10）
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r48');
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

/**
 * 结算卡几何探针。
 *
 * ⚠️ 这是 **Node 侧拼出来的普通字符串**（不是模板字面量），
 *    但为与 `PAGE_HELPER` 口径一致，注释里同样不出现反引号。
 */
const PROBE = '(function () {\n'
    + '  var s = cc.director.getScene(), card = null;\n'
    + '  (function walk(n) { if (card) return; if (n.name === "Card" && n.activeInHierarchy) { card = n; return; }\n'
    + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(s);\n'
    + '  if (!card) return { err: "no Card node" };\n'
    + '  var v = window.__g5t.view();\n'
    + '  var ui0 = card.getComponent("cc.UITransform");\n'
    + '  var cw = card.worldPosition;\n'
    + '  var topD = v.h - cw.y;            // 卡顶（设计 y，向下为正）\n'
    + '  var cxD = cw.x;                   // 卡中线\n'
    + '  var out = {\n'
    + '    view: v, cardTopY: r2(topD), cardCx: r2(cxD),\n'
    + '    cardW: r2(ui0.width), cardH: r2(ui0.height),\n'
    + '    cardBox: { left: r2(cxD - ui0.width / 2), right: r2(cxD + ui0.width / 2),\n'
    + '               top: r2(topD), bottom: r2(topD + ui0.height) },\n'
    + '    nodes: [],\n'
    + '  };\n'
    + '  function r2(x) { return Math.round(x * 100) / 100; }\n'
    + '  var parents = [];\n'
    + '  (function walk2(n, d, path) {\n'
    + '    var ui = n.getComponent("cc.UITransform");\n'
    + '    var ws = n.worldScale || n.scale;\n'
    + '    var wp = n.worldPosition;\n'
    + '    var lbl = n.getComponent("cc.Label");\n'
    + '    var w = ui ? ui.width * (ws ? ws.x : 1) : null;\n'
    + '    var h = ui ? ui.height * (ws ? ws.y : 1) : null;\n'
    + '    var cx = wp.x, cy = v.h - wp.y;\n'
    + '    out.nodes.push({\n'
    + '      name: n.name, depth: d, path: path, text: lbl ? lbl.string : null,\n'
    + '      font: lbl ? lbl.fontSize : null, fh: lbl ? r2(lbl.lineHeight) : null,\n'
    + '      dx: r2(cx - cxD), dy: r2(cy - topD), w: w === null ? null : r2(w), h: h === null ? null : r2(h),\n'
    + '      box: w === null ? null : { left: r2(cx - w / 2 - cxD), right: r2(cx + w / 2 - cxD),\n'
    + '                                 top: r2(cy - h / 2 - topD), bottom: r2(cy + h / 2 - topD) },\n'
    + '    });\n'
    + '    for (var i = 0; i < n.children.length; i++) walk2(n.children[i], d + 1, path + "/" + n.children[i].name);\n'
    + '  })(card, 0, "Card");\n'
    + '  return out;\n'
    + '})()';

async function dump(tag) {
    const r = await cdp.ev(PROBE);
    if (!r || r.err) { console.log(`      ✗ ${r?.err || 'null'}`); return null; }
    console.log(`\n── ${tag} ──  可视 ${r.view.w}×${r.view.h}（设计 px）`);
    console.log(`   卡片：宽 ${r.cardW} 高 ${r.cardH} · 左 ${r.cardBox.left} 右 ${r.cardBox.right}`
        + ` 顶 ${r.cardBox.top} 底 ${r.cardBox.bottom}`);
    console.log('   节点（dx/dy 相对**卡顶中点**，y 向下为正；box 同上口径）：');
    for (const n of r.nodes) {
        const t = n.text ? ` "${n.text}"` : '';
        console.log(`     ${'  '.repeat(n.depth)}${n.name.padEnd(16)} dx=${String(n.dx).padStart(8)}`
            + ` dy=${String(n.dy).padStart(8)} w=${String(n.w).padStart(7)} h=${String(n.h).padStart(7)}`
            + ` f=${n.font ?? '-'}${t}`);
        if (n.box) {
            console.log(`     ${'  '.repeat(n.depth)}${''.padEnd(16)} box L=${n.box.left} R=${n.box.right}`
                + ` T=${n.box.top} B=${n.box.bottom}`
                + `  [越卡外 ${n.box.top < 0 ? -n.box.top : 0} · 超卡宽 ${Math.max(0, n.box.right - r.cardW / 2)}]`);
        }
    }
    return r;
}

const RESULT = { level: LEVEL, phases: {} };

// ---- 胜态 ----
console.log('\n=== 胜态 ===');
await navigateTo(cdp, 'game');
await sleep(400);
const okWin = await cdp.ev('globalThis.__game5.demoResult(true)');
console.log(`      demoResult(true) → ${okWin}`);
await sleep(1400);
RESULT.phases.win = await dump('胜态 结算卡');
await shot('r48-win.png');

// ---- 负态（同一绘制路径，只换文案；这里只为量标题更宽的 5 字）----
await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await sleep(1200);
await navigateTo(cdp, 'game');
await sleep(400);
const okFail = await cdp.ev('globalThis.__game5.demoResult(false)');
console.log(`\n      demoResult(false) → ${okFail}`);
await sleep(1400);
RESULT.phases.fail = await dump('负态 结算卡');
await shot('r48-fail.png');

// ---- 控制台告警（cardH/cur 自检就藏在这里）----
const warn = cdp.logs.filter((l) => /结算弹层|warn/i.test(String(l)));
console.log(`\n      控制台告警 ${warn.length} 条`);
for (const l of warn.slice(0, 10)) console.log(`      ! ${String(l).slice(0, 160)}`);

writeFileSync(resolve(OUT, '_r48-probe.json'), JSON.stringify(RESULT, null, 2));
console.log(`\n      → ${resolve(OUT, '_r48-probe.json')}`);

try { proc.kill(); } catch { /* ignore */ }
await close();
