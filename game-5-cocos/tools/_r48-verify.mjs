#!/usr/bin/env node
/**
 * ============================================================
 *  _r48-verify.mjs · 第 48 轮自证
 * ============================================================
 *  本轮两件事，本脚本一节证一件：
 *
 *  ① 结算弹层标题「通关啦！/ 就差一点！」的**版式修正**
 *     旧版把 HTML 真源 `.ribbonTop{top:-34px}` 的"盒顶偏移"当成"中心偏移"用
 *     ⇒ 标题被抬高 77.3 设计 px，实测 **111.3px 悬在卡框之外**（框高 154.6）。
 *     现在的判据是**几何断言**：标题框四边必须全部落在卡框之内、且宽度不超卡内容宽。
 *
 *  ② 判负口径的小改：**牌堆空 + 槽位刚好满（不溢出）⇒ 判胜**
 *     新分支写在 `GamePage.settleSlotsFull()`。这里既证"该胜的胜了"（段三），
 *     也证"该负的还负"（段四负控）——**没有负控的断言等于没断言**。
 *
 *  ────────────────────────────────────────────────────────────
 *  【段三的局面怎么造（重要，别以为是作弊）】
 *    第 1 关 = 12 张 = 4 个面 × 3 张；槽位 8 格。
 *    要同时满足「牌堆空」+「槽满」+「暂存架空」，唯一可能是
 *       12 = 槽里 8 张 + 离场 4 张，且这 8 张每面 ≤ 2（否则会成组消掉）。
 *    而赠礼道具**每局只给 1 个**（`GIFT_TABLE`，见 Gift.ts），凑不出 4 次「消除」。
 *    ⇒ 于是：**前 4 张进槽、后 8 张脏填**用真实鼠标（走完整入槽/判定链），
 *      中间那 4 次消除走 `eraseSlotAt()` —— **真实的消除业务函数**，
 *      只跳过"道具库存"这个前置条件。触发判定的**最后一手仍是真实鼠标**。
 *    脚本会把这一步在日志里点名，不藏着。
 *
 *  【用法】
 *    node tools/_r48-verify.mjs /tmp/g5-r48v
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    designToCss, navigateTo, openBrowser, seedAtLevel, sleep, startServer, waitFor,
} from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r48v');
mkdirSync(OUT, { recursive: true });

const LEVEL = Number(process.env.G5_LEVEL || 1);       // 第 1 关：12 张 / 槽 8 格
const W = 421, H = 927, SCALE = 3;

/** 版式期望值（与 `GamePage.RESULT` 同源；这里写死是为了"断言不复述代码"） */
const CARD_W = 620;
const CARD_TOP = 360;
const PAD_LR = 40;                    // 真源 padding 40px → 内容宽 = 620 − 80
const TITLE_DEPTH = 8;                // 厚底下偏
const TITLE_FONT = 88;

let pass = 0, fail = 0;
const judge = (ok, txt) => {
    console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt);
    if (ok) pass++; else fail++;
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`);
const j = (v) => JSON.stringify(v);
const r2 = (x) => Math.round(x * 100) / 100;

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

async function clickDesign(pt) {
    const [c] = await designToCss(cdp, [pt]);
    if (!c) throw new Error(`designToCss 失败：${j(pt)}`);
    await cdp.click(c.x, c.y);
    return c;
}

/**
 * 结算卡几何 —— 与 `tools/_r48-probe-result.mjs` 同一段探针（同口径，不是另写一份）。
 * dx/dy 相对**卡顶中点**；box 顶点同为该口径。
 */
const PROBE = '(function () {\n'
    + '  var s = cc.director.getScene(), card = null;\n'
    + '  (function walk(n) { if (card) return; if (n.name === "Card" && n.activeInHierarchy) { card = n; return; }\n'
    + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(s);\n'
    + '  if (!card) return { err: "no Card node" };\n'
    + '  function r2(x) { return Math.round(x * 100) / 100; }\n'
    + '  var v = window.__g5t.view();\n'
    + '  var ui0 = card.getComponent("cc.UITransform");\n'
    + '  var cw = card.worldPosition;\n'
    + '  var topD = v.h - cw.y, cxD = cw.x;\n'
    + '  var out = { view: v, cardW: ui0.width, cardH: ui0.height, cardTop: r2(topD),\n'
    + '    nodes: [] };\n'
    + '  (function walk2(n, d) {\n'
    + '    var ui = n.getComponent("cc.UITransform");\n'
    + '    var ws = n.worldScale || n.scale;\n'
    + '    var wp = n.worldPosition;\n'
    + '    var lbl = n.getComponent("cc.Label");\n'
    + '    var w = ui ? ui.width * (ws ? ws.x : 1) : null;\n'
    + '    var h = ui ? ui.height * (ws ? ws.y : 1) : null;\n'
    + '    var cx = wp.x, cy = v.h - wp.y;\n'
    + '    out.nodes.push({ name: n.name, depth: d, text: lbl ? lbl.string : null,\n'
    + '      font: lbl ? lbl.fontSize : null, dy: r2(cy - topD), w: w === null ? null : r2(w), h: h === null ? null : r2(h),\n'
    + '      box: w === null ? null : { left: r2(cx - w / 2 - cxD), right: r2(cx + w / 2 - cxD),\n'
    + '                                 top: r2(cy - h / 2 - topD), bottom: r2(cy + h / 2 - topD) } });\n'
    + '    for (var i = 0; i < n.children.length; i++) walk2(n.children[i], d + 1);\n'
    + '  })(card, 0);\n'
    + '  return out;\n'
    + '})()';

const pick = (geo, name) => geo?.nodes?.find((n) => n.name === name) ?? null;

/** 拿 GamePage 组件实例（段三要直调真实的 `eraseSlotAt`） */
const PAGE_EXPR = '(function () {\n'
    + '  var s = cc.director.getScene(), hit = null;\n'
    + '  (function walk(n) { if (hit) return;\n'
    + '    var c = n.getComponent && n.getComponent("GamePage");\n'
    + '    if (c) { hit = c; return; }\n'
    + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(s);\n'
    + '  window.__g5page = hit;\n'
    + '  return !!hit; })()';

const st = () => cdp.ev('globalThis.__game5.state()');
const pickables = () => cdp.ev('globalThis.__game5.pickables()');
const slotFaces = () => cdp.ev('globalThis.__game5.slotFaces()');

const labels = () => cdp.ev('(function () {\n'
    + '  var out = [], s = cc.director.getScene();\n'
    + '  (function walk(n) {\n'
    + '    if (!n) return;\n'
    + '    var l = n.getComponent && n.getComponent("cc.Label");\n'
    + '    if (l && l.string) out.push(l.string);\n'
    + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]);\n'
    + '  })(s);\n'
    + '  return out;\n'
    + '})()');

const hasWinText = async () => (await labels()).some((s) => s.includes('通关啦'));
const hasFailText = async () => (await labels()).some((s) => s.includes('就差一点'));

/** 脏填：绝不让槽里某一面凑到 3 张（否则会消掉，槽就腾空了） */
async function dirtyFill(maxClicks = 40) {
    let i = 0, stall = 0;
    while (i < maxClicks) {
        const s = await st();
        if (!s) return { stop: 'bridge-gone', i, s };
        if (s.over) return { stop: 'over', i, s };
        if (s.locked) { await sleep(120); continue; }
        const ps = await pickables();
        if (!ps.length) {
            if (++stall > 8) return { stop: 'nopick', i, s };
            await sleep(300);
            continue;
        }
        stall = 0;
        const faces = await slotFaces();
        const cnt = new Map();
        for (const f of faces) cnt.set(f, (cnt.get(f) || 0) + 1);
        const safe = ps.filter((p) => (cnt.get(p.face) || 0) < 2);
        const pool = safe.length ? safe : ps;
        const cand = pool.slice().sort((a, b) => (cnt.get(a.face) || 0) - (cnt.get(b.face) || 0))[0];
        await clickDesign({ x: cand.x, y: cand.y });
        i++;
        await sleep(320);
    }
    return { stop: 'maxclicks', i, s: await st() };
}

/**
 * 段一/段二共用的**版式断言**。
 *
 * ⚠️ 这里断言的是"标题相对**卡框**的几何"，不是"看着像不像"。
 *    卡框 = 卡宽 620 / 卡顶在卡内坐标 0；左内边距 PAD_LR = 40。
 */
function assertTitle(geo, tag, expectText) {
    const card = { w: geo.cardW, h: geo.cardH };
    const title = pick(geo, 'Title');
    const shade = pick(geo, 'TitleShade');
    const mascot = pick(geo, 'Mascot') || pick(geo, 'MascotFail');
    console.log(`      ${tag}：卡 ${r2(card.w)}×${r2(card.h)}（顶 ${r2(geo.cardTop)} 距屏顶）`);
    if (!title) { judge(false, `${tag}：结算卡里**没有** Title 节点`); return null; }
    console.log(`      Title      "${title.text}" f=${title.font} w=${title.w} h=${title.h}`)
    console.log(`                 box L=${title.box.left} R=${title.box.right}`
        + ` T=${title.box.top} B=${title.box.bottom}`);
    if (shade) {
        console.log(`      TitleShade "${shade.text}" w=${shade.w}`);
    }
    if (mascot) console.log(`      ${mascot.name} 框顶(卡内) = ${mascot.box.top}（含 ±12 浮动）`);

    // ★★ 核心断言：四边全部在卡框之内
    const overTop = Math.max(0, -title.box.top);
    const overBottom = Math.max(0, title.box.bottom - card.h);
    const overLeft = Math.max(0, -(card.w / 2) - title.box.left);
    const overRight = Math.max(0, title.box.right - card.w / 2);
    judge(overTop === 0, `${tag}：标题**上沿不越出卡框**（越出 ${overTop}）`);
    judge(overBottom === 0, `${tag}：标题**下沿不越出卡框**（越出 ${overBottom}）`);
    judge(overLeft === 0 && overRight === 0,
        `${tag}：标题**左右不越出卡框**（左 ${overLeft} / 右 ${overRight}）`);

    // 内容宽：不能顶到金框上（真源 padding 40px）
    const innerW = card.w - PAD_LR * 2;
    judge(title.w <= innerW, `${tag}：标题宽 ${title.w} ≤ 卡内容宽 ${innerW}`);

    // 标题落在卡内"顶部题字区"，且不贴卡顶
    judge(title.box.top >= 4 && title.box.top <= 60,
        `${tag}：标题框顶 ${title.box.top} ∈ [4, 60]（卡内题字区，不贴金框）`);

    // 厚底：在场、同文、字形中心低 TITLE_DEPTH
    if (!shade) {
        judge(false, `${tag}：**缺 TitleShade**（厚底）—— 标题会发飘`);
    } else {
        judge(shade.text === title.text, `${tag}：厚底与主标题**逐字相同**（${j(shade.text)}）`);
        const dTitle = title.box.top + title.box.bottom;
        const dShade = shade.box.top + shade.box.bottom;
        const delta = (dShade - dTitle) / 2;    // 两者框高不同（描边差 16），比中心差
        judge(Math.abs(delta - TITLE_DEPTH) <= 1.0,
            `${tag}：厚底下偏 ${r2(delta)}（期望 ${TITLE_DEPTH}±1）`);
    }

    // 标题字形下沿 → 吉祥物框顶 的视觉间隙（吉祥物浮动 ±12，按**最高位置**算最坏情况）
    if (mascot) {
        // 字形在 Label 框里垂直居中 ⇒ 字形底 = 框中心 + 字号/2，再叠厚底
        const glyphBottom = title.box.top + title.h / 2 + TITLE_FONT / 2 + TITLE_DEPTH;
        const gap = (mascot.box.top - 12) - glyphBottom;
        console.log(`      标题字形下沿 ${r2(glyphBottom)} → 吉祥物最高框顶 ${r2(mascot.box.top - 12)}`);
        judge(gap >= 20, `${tag}：标题字形 → 吉祥物 视觉间隙 ${r2(gap)} ≥ 20（含 -12 浮动补偿）`);
    }

    // 卡片整体不出屏
    judge(geo.cardTop + card.h <= geo.view.h - 60,
        `${tag}：卡底 ${r2(geo.cardTop + card.h)} ≤ 可视高 ${r2(geo.view.h)} − 60`);

    if (expectText) {
        judge(title.text === expectText, `${tag}：标题文案是 ${j(expectText)}（实为 ${j(title.text)}）`);
    }
    return title;
}

const RESULT = { level: LEVEL, phases: {} };

// ============================================================
//  第一段 · 胜态版式
// ============================================================
head('第一段 · 胜态版式（demoResult(true)：只走绘制路径量几何）');
await navigateTo(cdp, 'game');
await sleep(400);
judge(await cdp.ev('globalThis.__game5.demoResult(true)') === true, '胜态结算卡已绘制');
await sleep(1400);
const winGeo = await cdp.ev(PROBE);
RESULT.phases.win = winGeo;
assertTitle(winGeo, '胜态', '通关啦！');
await shot('r48v-01-win.png');

// ============================================================
//  第二段 · 负态版式（真实鼠标 → 槽满判负）
// ============================================================
head('第二段 · 负态版式（真实鼠标脏填 → slotsFull → 「就差一点！」）');
await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await waitFor(cdp, '!!window.__g5t', 30000, '页面助手 __g5t');
await navigateTo(cdp, 'game');
const s2 = await st();
judge(!!s2 && s2.over === false, `重进第 ${LEVEL} 关，局面干净（${j({ rem: s2?.remaining, slot: s2?.slotMax })}）`);
const run2 = await dirtyFill();
console.log(`      填槽结束：${j({ stop: run2.stop, clicks: run2.i, slots: run2.s?.slots, rem: run2.s?.remaining })}`);
judge(run2.stop === 'over', `对局已结束（stop=${run2.stop}）`);
await sleep(1000);
judge(await hasFailText(), '负态弹层出现「就差一点！」');
judge(!(await hasWinText()), '没有出现胜态文案（负控）');
const failGeo = await cdp.ev(PROBE);
RESULT.phases.fail = failGeo;
assertTitle(failGeo, '负态', '就差一点！');
await shot('r48v-02-fail.png');

// ============================================================
//  第三段 · 新分支：牌堆空 + 槽位刚好满 ⇒ 判胜
// ============================================================
head('第三段 · 新分支（牌堆空 + 槽位刚好满 ⇒ 应判**胜**）');
await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await waitFor(cdp, '!!window.__g5t', 30000, '页面助手 __g5t');
await navigateTo(cdp, 'game');
const s3 = await st();
console.log(`      第 ${LEVEL} 关：${s3.total} 张 · 槽位 ${s3.slotMax} 格`);
judge(s3.total === 12 && s3.slotMax === 8, `局面口径成立（12 张 / 8 格，构造前提）`);
judge(await cdp.ev(PAGE_EXPR), '取到 GamePage 实例（供下面调真实 eraseSlotAt）');

// ① 真实鼠标点 4 张**不同面**的牌进槽
const placed = [];
for (let k = 0; k < 4; k++) {
    const ps = await pickables();
    const faces = await slotFaces();
    const cand = ps.find((p) => !faces.includes(p.face));
    if (!cand) { judge(false, `第 ${k + 1} 张找不到"新面"的牌`); break; }
    await clickDesign({ x: cand.x, y: cand.y });
    placed.push(cand.face);
    await sleep(340);
}
const s3b = await st();
console.log(`      ① 真实鼠标点入 4 张：${j(placed)} ⇒ 槽 ${s3b.slots}/${s3b.slotMax} · 牌堆 ${s3b.remaining}`);
judge(s3b.slots === 4 && s3b.remaining === 8, '槽 4 / 牌堆剩 8（4 张各占一面）');

// ② 用**真实的** `eraseSlotAt` 消掉槽内 4 张 —— 只为腾格子，跳过"道具库存"前置
console.log('      ⚠ 下面 4 次消除走真实 eraseSlotAt()（跳过道具库存前置）—— 触发判定的最后一手仍是真实鼠标');
for (let k = 0; k < 4; k++) {
    const done = await cdp.ev('(function () {\n'
        + '  var p = window.__g5page;\n'
        + '  if (!p || p._slots.length === 0) return false;\n'
        + '  p.eraseSlotAt(p._slots.length - 1);\n'
        + '  return true; })()');
    if (!done) { judge(false, `第 ${k + 1} 次消除没执行`); break; }
    await sleep(420);
}
const s3c = await st();
console.log(`      ② 4 次消除后 ⇒ 槽 ${s3c.slots}/${s3c.slotMax} · 牌堆 ${s3c.remaining} · 已清 ${s3c.cleared}/${s3c.total}`);
judge(s3c.slots === 0 && s3c.remaining === 8 && s3c.cleared === 4, '槽已空 / 牌堆剩 8 / 已清 4');

// ③ 真实鼠标把剩下的 8 张全部点进槽（脏策略：不成组）
//
// ⚠️ **不能在循环结束后再读 `slots`**：判胜时 `settleLeftoversOnWin()` 已经把槽清空了，
//    事后读到的是 0 —— 那正是"现状即期望"的错断言（第 29 轮的教训）。
//    ⇒ 每手点完只等 60ms（判定要 240ms 才落地），**在判定之前**把快照抓下来。
let before = null, clicks = 0;
for (let k = 0; k < 20; k++) {
    const s = await st();
    if (!s || s.over) break;
    if (s.locked) { await sleep(120); continue; }
    const ps = await pickables();
    if (!ps.length) { await sleep(300); continue; }
    const faces = await slotFaces();
    const cnt = new Map();
    for (const f of faces) cnt.set(f, (cnt.get(f) || 0) + 1);
    const safe = ps.filter((p) => (cnt.get(p.face) || 0) < 2);
    const pool = safe.length ? safe : ps;
    const cand = pool.slice().sort((a, b) => (cnt.get(a.face) || 0) - (cnt.get(b.face) || 0))[0];
    await clickDesign({ x: cand.x, y: cand.y });
    clicks++;
    await sleep(60);
    const snap = await st();          // ★ 判定尚未落地的那一刻
    if (snap && !snap.over) before = snap;
    if (snap?.over) { before = before ?? snap; break; }
    await sleep(280);
}
const s3d = await st();
console.log(`      ③ 脏填：点了 ${clicks} 张 ⇒ 判定前快照 ${j(before)}`);
console.log(`         终局 state = ${j(s3d)}`);
judge(!!before && before.remaining === 0, `判定前**牌堆已空**（remaining=${before?.remaining}）`);
judge(!!before && before.slots === before.slotMax,
    `★★ 判定前**槽位刚好坐满**（${before?.slots}/${before?.slotMax}）—— 这就是本轮新分支的入口条件`);
judge(s3d.remaining === 0 && s3d.cleared === s3d.total,
    `残牌已一并结算（牌堆 ${s3d.remaining} · 已清 ${s3d.cleared}/${s3d.total}）`);

await sleep(900);
judge(await hasWinText(), '★★ 弹层是「通关啦！」—— 牌堆空 + 槽满 ⇒ **判胜**');
judge(!(await hasFailText()), '没有误弹「就差一点！」');
const winGeo2 = await cdp.ev(PROBE);
RESULT.phases.emptyFullWin = winGeo2;
if (winGeo2?.nodes) assertTitle(winGeo2, '新分支', '通关啦！');
await shot('r48v-03-empty-full-win.png');

// ============================================================
//  第四段 · 负控：牌堆**没空** + 槽满 ⇒ 仍判负
// ============================================================
head('第四段 · 负控（牌堆还剩 4 张 + 槽满 ⇒ 必须仍判**负**）');
await cdp.send('Page.reload', {});
cdp.logs.length = 0;
await waitFor(cdp, '!!window.__g5t', 30000, '页面助手 __g5t');
await navigateTo(cdp, 'game');
const run4 = await dirtyFill();
const s4 = await st();
console.log(`      脏填结束：${j({ stop: run4.stop, clicks: run4.i, slots: s4.slots, rem: s4.remaining })}`);
judge(run4.stop === 'over', '对局已结束');
judge(s4.remaining > 0, `牌堆**还有** ${s4.remaining} 张（牌没点完 ⇒ 这是真失败）`);
await sleep(900);
judge(await hasFailText(), '★★ 仍弹「就差一点！」—— 判负口径没被这次改动误伤');
judge(!(await hasWinText()), '没有误判为胜');

RESULT.judge = { pass, fail };
writeFileSync(resolve(OUT, '_r48-verify.json'), JSON.stringify(RESULT, null, 2));
console.log(`\n      → ${resolve(OUT, '_r48-verify.json')}`);

console.log(`\n══ 汇总：通过 ${pass} · 失败 ${fail} ══`);
try { proc.kill(); } catch { /* ignore */ }
await close();
process.exit(fail ? 1 : 0);
