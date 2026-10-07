#!/usr/bin/env node
/**
 * ============================================================
 *  _r49-verify.mjs · 第 49 轮 · 正式自证
 * ============================================================
 *  用户两条需求：
 *    ① 「看广告的提示正好盖住了槽位，把广告提示从道具上方换到道具下方」
 *    ② 「"通关啦"和"只差一点"结算字样在横向上都不太居中，看着偏左了一些」
 *
 *  ────────────────────────────────────────────────────────────
 *  【★ 口径与坑（读断言前先读这段）】
 *  1. `node.worldPosition.y` 在 fitWidth 下**就是"距屏幕底边的设计 px"**
 *     （Canvas 世界 (vw/2, vh/2)，而 `Layout.botY(v) = -vh/2 + v`）。
 *     ⇒ 不绕 `worldToScreen`（那条路先转 CSS 再反算，多两次舍入）。
 *  2. ⚠️ **Toast 的 contentSize 是假值**：`createNode('Toast', parent, {x,y})`
 *     没传 w/h ⇒ UITransform 默认 100×100，跟胶囊真实高度毫无关系。
 *     胶囊高度**只在 `toast()` 里**（h=76；阴影层 84）⇒ 断言用常量，不读节点。
 *  3. ⚠️ **结算标题的 contentSize 由引擎按文本重算**（`overflow: NONE`），
 *     传进去的 `w` 无效 ⇒ 量"标题偏左"必须在**像素**上量墨迹，
 *     光看节点几何只能证明"锚点是居中的"（那正是问题② 的**反面**证据）。
 *  4. 判"toast 没盖住谁"用**矩形相交**，而不是"中心不在某个区间"——
 *     后者在"中心刚好压在道具栏上沿外侧"时会漏报。
 *
 *  【用法】
 *    node tools/_r49-verify.mjs            # 全绿则 exit 0
 *    G5_LEVEL=3 node tools/_r49-verify.mjs
 * ============================================================
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r49-verify');
mkdirSync(OUT, { recursive: true });
const LEVEL = Number(process.env.G5_LEVEL || 3);
const W = 421, H = 927, SCALE = 3;
const PY = process.env.G5_PY
    || '/Users/consli/.workbuddy/binaries/python/envs/default/bin/python';

// ---- 真源常量（与代码同源，**不要**从截图里反推）----
//  ⚠️ 暂存架的**节点**高实测 90（不是 `LAYOUT.TEMP_RACK.cellH` 的 70 —— 格高与
//     节点高不是一回事，节点把「暂存」标签也算进去了）⇒ 带边界按**实测**写。
const SAFE_BOTTOM = 68;         // CFG.DEVICE.HOME_BAR
const TOOL_BAND = [157, 269];   // Layout.BOT: PAD=157，道具栏高 112（实测吻合）
const SLOT_BAND = [281, 361];   // 槽位条（实测吻合）
const TEMP_BAND = [357, 447];   // 暂存架（TEMP_RACK.fromBottom=402 ± 实测节点高 90/2）
const TOAST_C = 112.5;          // (SAFE_BOTTOM + PAD) / 2
const TOAST_H = 84;             // 胶囊 76 + 阴影外扩 8（**不是** contentSize）
const TOAST_BOX = [TOAST_C - TOAST_H / 2, TOAST_C + TOAST_H / 2];   // [70.5, 154.5]

const TITLE_SHIFT = 0.32 * 88;  // RESULT.TITLE_TRAIL_SHIFT_EM × TITLE_FONT = 28.16
const INK_TOL = 3.0;            // 像素墨迹中心的允许偏差（设计 px）

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(LEVEL), width: W, height: H, scale: 1,
});

let pass = 0, fail = 0;
const rows = [];
function assert(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✓ ${name}${detail ? '   ' + detail : ''}`); }
    else { fail++; console.log(`  ✗ ${name}   ${detail}`); }
    rows.push({ name, ok, detail });
}

function band(b) { return `[${b[0]}, ${b[1]}]`; }
/** 两个"距底闭区间"是否相交（容差 0.5 ⇒ 贴边不算相交） */
function overlap(a, b) {
    const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
    return hi - lo > 0.5 ? hi - lo : 0;
}

/** 页面侧：底带各层 + toast 的距底几何 */
const GEO = `(function () {
  var v = window.__g5t.view();
  var s = cc.director.getScene();
  function r2(x) { return Math.round(x * 100) / 100; }
  function walk(n, fn) { fn(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], fn); }
  var want = { ToolBar: 1, Tool_erase: 1, SlotBar: 1, TempRack: 1, Toast: 1 };
  var got = { toasts: [] };
  walk(s, function (n) {
    if (!want[n.name]) return;
    var ui = n.getComponent && n.getComponent('cc.UITransform');
    var ws = n.worldScale || n.scale;
    var p = n.worldPosition;
    var o = { fromBottom: r2(p.y), x: r2(p.x),
              w: ui ? r2(ui.width * (ws ? ws.x : 1)) : null,
              h: ui ? r2(ui.height * (ws ? ws.y : 1)) : null };
    if (n.name === 'Toast') {
      // 胶囊宽由内容决定：Graphics 画的 w 不在 UITransform 上 ⇒ 这里只报 x 与距底，
      // 宽高一律用真源常量（见脚本头第 2 条）。
      var lbl = null;
      for (var i = 0; i < n.children.length; i++) {
        var L = n.children[i].getComponent('cc.Label');
        if (L) { lbl = L.string; break; }
      }
      o.text = lbl;
      got.toasts.push(o);
      return;
    }
    if (!got[n.name]) got[n.name] = o;
  });
  got.view = v;
  return got;
})()`;

/** 页面侧：结算卡 + 标题的水平几何 */
const TITLE = `(function () {
  var s = cc.director.getScene();
  function r2(x) { return Math.round(x * 100) / 100; }
  function walk(n, fn) { fn(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], fn); }
  var card = null;
  walk(s, function (n) { if (!card && n.name === 'Card' && n.activeInHierarchy) card = n; });
  if (!card) return { err: 'no Card' };
  var v = window.__g5t.view();
  var cui = card.getComponent('cc.UITransform');
  var out = { view: v, cardTopFromBottom: r2(card.worldPosition.y),
              cardW: r2(cui.width), cardH: r2(cui.height),
              cardCx: r2(card.worldPosition.x), titles: [] };
  walk(card, function (n) {
    if (n.name !== 'Title' && n.name !== 'TitleShade') return;
    var ui = n.getComponent('cc.UITransform');
    var lb = n.getComponent('cc.Label');
    out.titles.push({ name: n.name, text: lb ? lb.string : null,
      worldX: r2(n.worldPosition.x), dxVsCard: r2(n.worldPosition.x - card.worldPosition.x),
      contentW: ui ? r2(ui.width) : null, contentH: ui ? r2(ui.height) : null,
      y: r2(n.worldPosition.y), hAlign: lb ? lb.horizontalAlign : null,
      overflow: lb ? lb.overflow : null });
  });
  return out;
})()`;

async function shot(name) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: SCALE },
        captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, name);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    return p;
}

const R = { level: LEVEL, phases: {}, checks: rows };

// ============================================================
//  第一段：toast 落点（走 forceNudge 的真实链路）
// ============================================================
console.log('\n=== ① 广告提示（toast）落点 ===');
await navigateTo(cdp, 'game');
await sleep(500);

const before = await cdp.ev(GEO);
console.log(`   可视 ${before.view.w} × ${before.view.h}`);
console.log('   ── 对照组：底带三层（本轮**不该动**）──');
for (const k of ['ToolBar', 'SlotBar', 'TempRack']) {
    const o = before[k];
    if (!o) { console.log(`     ${k}: 缺`); continue; }
    console.log(`     ${k.padEnd(10)} 距底 ${String(o.fromBottom).padStart(6)}  高 ${String(o.h).padStart(5)}`
        + `  ⇒ 占距离底 [${(o.fromBottom - o.h / 2).toFixed(1)}, ${(o.fromBottom + o.h / 2).toFixed(1)}]`);
}
assert('对照组 道具栏仍在距底 [157, 269]',
    Math.abs(before.ToolBar.fromBottom - 213) < 0.5, `实测 ${before.ToolBar.fromBottom}`);
assert('对照组 槽位条仍在距底 [281, 361]',
    Math.abs(before.SlotBar.fromBottom - 321) < 0.5, `实测 ${before.SlotBar.fromBottom}`);
assert('对照组 暂存架仍在距底 402',
    before.TempRack && Math.abs(before.TempRack.fromBottom - 402) < 0.5,
    `实测 ${before.TempRack?.fromBottom}`);

const nid = await cdp.ev('globalThis.__game5.forceNudge()');
console.log(`\n   forceNudge() → ${nid}`);
await sleep(500);
const g1 = await cdp.ev(GEO);
const t1 = g1.toasts[g1.toasts.length - 1];
if (!t1) {
    assert('触发出 1 条提示', false, '没找到 Toast 节点');
} else {
    const box = [t1.fromBottom - TOAST_H / 2, t1.fromBottom + TOAST_H / 2];
    console.log(`   ★ Toast「${t1.text}」`);
    console.log(`     距底中心 ${t1.fromBottom}（目标 ${TOAST_C}）`);
    console.log(`     视觉框 距底 ${band(box)}  （胶囊 ${TOAST_H}，**不是** contentSize ${t1.h}）`);
    assert('Toast 落点在底带下方空档（距底 112.5 ± 2）',
        Math.abs(t1.fromBottom - TOAST_C) <= 2, `实测 ${t1.fromBottom}`);
    assert('Toast 视觉框整体落在安全区之上（底边 ≥ SAFE_BOTTOM 68）',
        box[0] >= SAFE_BOTTOM - 0.5, `框底 ${box[0].toFixed(1)} vs ${SAFE_BOTTOM}`);
    const ovTool = overlap(box, TOOL_BAND);
    const ovSlot = overlap(box, SLOT_BAND);
    const ovTemp = overlap(box, TEMP_BAND);
    assert('Toast 不与「道具栏」相交', ovTool === 0, `重叠 ${ovTool.toFixed(2)} 设计 px`);
    assert('Toast 不与「槽位条」相交（用户问题① 的直接判据）', ovSlot === 0,
        `重叠 ${ovSlot.toFixed(2)} 设计 px`);
    assert('Toast 不与「暂存架」相交', ovTemp === 0, `重叠 ${ovTemp.toFixed(2)} 设计 px`);
}
await shot('r49v-01-toast-bottom.png');
R.phases.nudgeToast = { geo: g1, toast: t1 };

// ============================================================
//  第二段：真实鼠标点道具键 → 另一条 toast 也必须落同一空档
// ============================================================
console.log('\n=== ② 真实鼠标点道具键 → toast 同样落底部空档 ===');
//  ★ 不能直接调 `__game5` 的旁路 —— 必须走**真实事件**（本项目硬约定）。
//    「洗牌」在开局就可用（不依赖槽里有牌），点它必然出 toast。
const cell = await cdp.ev(`(function () {
  var found = null;
  (function walk(n) { if (found) return; if (n.name === 'Tool_shuffle') { found = n; return; }
    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(cc.director.getScene());
  if (!found) return null;
  var v = window.__g5t.view();
  var p = found.worldPosition;
  var r = window.__g5t.toScreen(p.x, v.h - p.y);      // 设计 px → CSS px
  return { x: Math.round(r.x), y: Math.round(r.y) };
})()`);
console.log(`   洗牌键屏幕位置 (CSS) = ${JSON.stringify(cell)}`);
if (cell) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cell.x, y: cell.y }, 8000);
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: cell.x, y: cell.y, button: 'left', clickCount: 1,
    }, 8000);
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: cell.x, y: cell.y, button: 'left', clickCount: 1,
    }, 8000);
    await sleep(500);
    const g2 = await cdp.ev(GEO);
    const t2 = g2.toasts[g2.toasts.length - 1];
    console.log(`   点击后 Toast「${t2?.text}」距底 ${t2?.fromBottom}`);
    assert('真实鼠标点击真的产生了提示（链路通）', !!t2 && t2.fromBottom !== undefined,
        t2 ? `"${t2.text}"` : '没有 Toast');
    if (t2) {
        const b2 = [t2.fromBottom - TOAST_H / 2, t2.fromBottom + TOAST_H / 2];
        assert('真实事件触发的提示同样不与槽位条相交', overlap(b2, SLOT_BAND) === 0,
            `重叠 ${overlap(b2, SLOT_BAND).toFixed(2)}`);
        assert('真实事件触发的提示仍落 112.5 ± 2',
            Math.abs(t2.fromBottom - TOAST_C) <= 2, `实测 ${t2.fromBottom}`);
    }
    await shot('r49v-02-toast-after-click.png');
    R.phases.clickToast = g2.toasts;
}

// ============================================================
//  第三段：连发两条 → 底部只留最新一条（retireToast 生效）
// ============================================================
console.log('\n=== ③ 连发两条 → 底部只留一条 ===');
const g3a = await cdp.ev(GEO);
const nA = g3a.toasts.length;
await cdp.ev('globalThis.__game5.forceNudge()');
await sleep(420);
const g3b = await cdp.ev(GEO);
console.log(`   连发前 ${nA} 条 → 连发后 ${g3b.toasts.length} 条`);
for (const t of g3b.toasts) console.log(`     「${t.text}」距底 ${t.fromBottom}`);
assert('底部同时最多只有 1 条提示（旧的立即退场）', g3b.toasts.length <= 1,
    `实测 ${g3b.toasts.length} 条`);
assert('留下的那条仍在 112.5 ± 2',
    g3b.toasts.every((t) => Math.abs(t.fromBottom - TOAST_C) <= 2),
    g3b.toasts.map((t) => t.fromBottom).join(','));
R.phases.stack = { nA, nB: g3b.toasts.length };

// ============================================================
//  第四段：结算标题的横向补偿
// ============================================================
console.log('\n=== ④ 结算标题：节点几何 + 像素墨迹 ===');
const COIN_CLEAR_MS = 3400;     // 金币雨最迟 2.8s 全销毁（见 coinRain）
async function titleCase(win, tag) {
    await cdp.send('Page.reload', {});
    cdp.logs.length = 0;
    await sleep(1200);
    await navigateTo(cdp, 'game');
    await sleep(400);
    await cdp.ev(`globalThis.__game5.demoResult(${win})`);
    await sleep(win ? COIN_CLEAR_MS : 1400);
    const info = await cdp.ev(TITLE);
    const png = await shot(tag);
    return { info, png };
}

const winPngs = [], failPngs = [];
const winCase = await titleCase(true, 'r49v-03-title-win.png');
const failCase = await titleCase(false, 'r49v-04-title-fail.png');
winPngs.push(winCase.png);
failPngs.push(failCase.png);

for (const [lab, c] of [['胜态', winCase], ['负态', failCase]]) {
    const o = c.info;
    console.log(`\n   ${lab}：卡中线 ${o.cardCx} 宽 ${o.cardW}`);
    for (const t of o.titles) {
        console.log(`     ${t.name.padEnd(11)} x=${t.worldX}  与卡中线差 ${t.dxVsCard}`
            + `  框 ${t.contentW}×${t.contentH}  hAlign=${t.hAlign} overflow=${t.overflow}`);
    }
    const [tt, ts] = [o.titles.find((x) => x.name === 'Title'),
        o.titles.find((x) => x.name === 'TitleShade')];
    assert(`${lab} Title 的 x 偏移 = ${TITLE_SHIFT.toFixed(2)}（尾部全角「！」补偿）`,
        tt && Math.abs(tt.dxVsCard - TITLE_SHIFT) < 0.5, `实测 ${tt?.dxVsCard}`);
    assert(`${lab} 厚底与主标题用**同一个** x（不错位半个补偿量）`,
        tt && ts && Math.abs(tt.dxVsCard - ts.dxVsCard) < 0.01,
        `主 ${tt?.dxVsCard} / 底 ${ts?.dxVsCard}`);
    assert(`${lab} hAlign=CENTER 且 overflow=NONE（证明补偿不是靠改对齐做的）`,
        tt && tt.hAlign === 1 && tt.overflow === 0, `hAlign=${tt?.hAlign} overflow=${tt?.overflow}`);
    // 第四段·b：像素墨迹居中（**最硬的判据**）
    try {
        const raw = execFileSync(PY, [resolve(import.meta.dirname, 'r49-title-ink.py'), c.png],
            { encoding: 'utf8', timeout: 120000 });
        const m = raw.match(/墨迹中心相对卡中线偏移\s*([+-]?\d+(?:\.\d+)?)\s*设计 px/);
        const span = raw.match(/框间距\s*([\d.]+)\s*设计 px/);
        const shift = m ? Number(m[1]) : NaN;
        console.log(`     像素墨迹：偏移 ${shift} 设计 px（框间距 ${span?.[1]}，应 ≈ 620）`);
        assert(`${lab} 像素墨迹中心居中（|偏移| ≤ ${INK_TOL} 设计 px）`,
            Number.isFinite(shift) && Math.abs(shift) <= INK_TOL, `实测 ${shift}`);
        assert(`${lab} 量法对照组通过（卡框间距 ≈ 620，比例可信）`,
            span && Math.abs(Number(span[1]) - 620) < 4, `实测 ${span?.[1]}`);
    } catch (e) {
        assert(`${lab} 像素墨迹量测`, false, String(e).slice(0, 120));
    }
}
R.phases.titleWin = winCase.info;
R.phases.titleFail = failCase.info;

// ============================================================
//  第五段：回归 —— 标题仍在卡内（第 48 轮的断言不能回归）
// ============================================================
console.log('\n=== ⑤ 回归：标题四边不越卡 + 卡底不出屏 ===');
for (const [lab, c] of [['胜态', winCase], ['负态', failCase]]) {
    const o = c.info;
    const tt = o.titles.find((x) => x.name === 'Title');
    const left = tt.worldX - tt.contentW / 2;
    const right = tt.worldX + tt.contentW / 2;
    const cardL = o.cardCx - o.cardW / 2, cardR = o.cardCx + o.cardW / 2;
    console.log(`   ${lab}：标题框 [${left.toFixed(2)}, ${right.toFixed(2)}]`
        + `  卡 [${cardL}, ${cardR}]  ⇒ 越卡 左 ${(cardL - left).toFixed(2)} 右 ${(right - cardR).toFixed(2)}`);
    assert(`${lab} 标题框不越卡左右边`, left > cardL && right < cardR,
        `左差 ${(cardL - left).toFixed(2)} / 右差 ${(right - cardR).toFixed(2)}`);
    assert(`${lab} 标题框在可视区内`, left > 0 && right < o.view.w,
        `[${left.toFixed(1)}, ${right.toFixed(1)}] in 0..${o.view.w}`);
}

// ---- 控制台错误 ----
const errs = cdp.logs.filter((l) => /error|Error/i.test(String(l)));
console.log(`\n   控制台 error ${errs.length} 条`);
for (const l of errs.slice(0, 6)) console.log(`     ! ${String(l).slice(0, 150)}`);
assert('运行期控制台无 error', errs.length === 0, `${errs.length} 条`);

// ============================================================
writeFileSync(resolve(OUT, '_r49-verify.json'), JSON.stringify(R, null, 2));
console.log(`\n${'='.repeat(64)}`);
console.log(`  结果：${pass} 通过 / ${fail} 失败   （共 ${pass + fail}）`);
console.log(`  取证目录：${OUT}`);
console.log(`${'='.repeat(64)}`);

try { proc.kill(); } catch { /* ignore */ }
await close();
process.exit(fail === 0 ? 0 : 1);
