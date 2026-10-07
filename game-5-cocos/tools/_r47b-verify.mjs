#!/usr/bin/env node
/**
 * ============================================================
 *  _r47b-verify.mjs · 第 47 轮（续）失败吉祥物「方案 C」接入自证
 * ============================================================
 *  需求：失败结算卡的吉祥物换成 AI 生图方案 C（懊恼不甘 · 抱头），
 *        抠图走 **rembg**（旧的"近白阈值 + 四边泛洪"会把上沿高光带整片吃掉）。
 *
 *  ────────────────────────────────────────────────────────────
 *  【本脚本要证的链条，一节一环，缺一环都不算过】
 *    ① 资产真进了 game 分包  —— 由构建产物 md5 对账（脚本外的 shell 已核）
 *    ② 失败弹层里**存在**叫 `MascotFail` 的节点，且 active
 *    ③ 它的 `spriteFrame` 是**另一张**（不是胜态那张）—— 用 uuid 比对，不靠肉眼
 *    ④ 尺寸仍 = 240 × 218.9 设计 px（两张素材同画幅的前提被守住）
 *    ⑤ 界面上**真的画出来了** —— 截图裁剪后与两张参考图做相关，2×2 矩阵
 *       方向必须成立：失败图 ↔ 方案C 高、失败图 ↔ 旧图 低；胜态相反
 *       （这就是**负控**：拿胜态那张当靶子，必须报低）
 *
 *  ────────────────────────────────────────────────────────────
 *  【为什么失败态要用真实鼠标走完整条链路】
 *    用户立的规矩：交付前必须**真实事件**自证，不能只看截图。
 *    所以失败态是「真点牌 → 槽位爆满 slotsFull → onFail → openResult(false)」，
 *    而不是调 `demoResult(false)` 抄近路。
 *    ⚠️ 胜态**只用** `demoResult(true)` 作**版式对照**（它走 `openResult()` 的绘制
 *       路径，不清盘不算分）—— 这里它只承担"负控靶子"的角色，不代表通关流程通过。
 *
 *  【脏策略填槽】要逼出 slotsFull，就得**绝不让槽里某个面凑到 3 张**：
 *    每手只挑"槽里这个面出现次数 < 2"的牌，且优先挑次数最少的。
 *    （贪心"优先凑三张"会一路消下去，永远到不了槽满。）
 *
 *  【用法】
 *    node tools/_r47b-verify.mjs /tmp/g5-r47b
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    designToCss, navigateTo, openBrowser, seedAtLevel, sleep, startServer, waitFor,
} from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r47b');
mkdirSync(OUT, { recursive: true });

const LEVEL = Number(process.env.G5_LEVEL || 10);
const W = 421, H = 927, SCALE = 3;
/** 构建产物里新贴图的 uuid（= `assets/bundles/game/game-play/mascot_fail.png.meta` 的 uuid） */
const FAIL_UUID = process.env.G5_FAIL_UUID || '39254cfc-53e8-42a7-beef-a2edf2902870';

let pass = 0, fail = 0;
const judge = (ok, txt) => {
    console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt);
    if (ok) pass++; else fail++;
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);
const j = (v) => JSON.stringify(v);

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

const st = () => cdp.ev('globalThis.__game5.state()');
const pickables = () => cdp.ev('globalThis.__game5.pickables()');
const slotFaces = () => cdp.ev('globalThis.__game5.slotFaces()');
const labels = () => cdp.ev(`(function () {
  var out = [], s = cc.director.getScene();
  (function walk(n) {
    if (!n) return;
    var l = n.getComponent && n.getComponent('cc.Label');
    if (l && l.string) out.push(l.string);
    for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  })(s);
  return out;
})()`);

/**
 * 吉祥物节点的**真实几何 + 贴图身份**。
 *
 * ⚠️ 这段是 Node 侧拼出来的**普通字符串**（不是模板字面量），
 *    但为了跟 `PAGE_HELPER` 的口径一致，里面**同样不许出现反引号**。
 */
function mascotExpr(name) {
    return '(function () {\n'
        + '  var NAME = ' + JSON.stringify(name) + ';\n'
        + '  var s = cc.director.getScene(), hit = null;\n'
        + '  (function walk(n) { if (hit) return; if (n.name === NAME && n.activeInHierarchy) { hit = n; return; }\n'
        + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(s);\n'
        + '  if (!hit) return null;\n'
        + '  var sp = hit.getComponent("cc.Sprite");\n'
        + '  var ui = hit.getComponent("cc.UITransform");\n'
        + '  var ws = hit.worldScale || hit.scale;\n'
        + '  var p = window.__g5t.worldToScreen(hit);\n'
        + '  var v = window.__g5t.view(), r = window.__g5t.canvasRect();\n'
        + '  var k = r.w / v.w;\n'
        + '  var sf = sp ? sp.spriteFrame : null;\n'
        + '  var tx = sf ? sf.texture : null;\n'
        + '  return {\n'
        + '    name: hit.name, active: hit.activeInHierarchy,\n'
        + '    parent: hit.parent ? hit.parent.name : null, grand: (hit.parent && hit.parent.parent) ? hit.parent.parent.name : null,\n'
        + '    x: p.x, y: p.y, sx: ws ? ws.x : 1, sy: ws ? ws.y : 1,\n'
        + '    designW: ui.width, designH: ui.height,\n'
        + '    cssW: ui.width * (ws ? ws.x : 1) * k, cssH: ui.height * (ws ? ws.y : 1) * k,\n'
        + '    sfName: sf ? sf.name : null, sfUuid: sf ? (sf._uuid || null) : null,\n'
        + '    sfW: sf ? sf.originalSize.width : null, sfH: sf ? sf.originalSize.height : null,\n'
        + '    texName: tx ? tx.name : null, texUuid: tx ? (tx._uuid || null) : null,\n'
        + '    texW: tx ? tx.width : null, texH: tx ? tx.height : null\n'
        + '  };\n'
        + '})()';
}

/** 该名字的节点在不在场（用来证"另一张不在"） */
function existsExpr(name) {
    return '(function () { var NAME = ' + JSON.stringify(name) + ';\n'
        + '  var s = cc.director.getScene(), hit = null;\n'
        + '  (function walk(n) { if (hit) return; if (n.name === NAME && n.activeInHierarchy) { hit = n; return; }\n'
        + '    for (var i = 0; i < n.children.length; i++) walk(n.children[i]); })(s);\n'
        + '  return !!hit; })()';
}

/**
 * 脏策略填槽：真实鼠标点牌，**绝不让槽内任意一面到 3 张** ⇒ 逼出 slotsFull。
 */
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
        await sleep(330);
        if (i % 5 === 0) {
            const s2 = await st();
            console.log(`      … 第 ${i} 手：牌堆 ${s2.remaining} · 槽 ${s2.slots}/${s2.slotMax}`);
        }
    }
    return { stop: 'maxclicks', i, s: await st() };
}

const RESULT = { level: LEVEL, phases: {} };

// ============================================================
//  第一段 · 胜态（**只作对照靶子**，走 demoResult(true) 的绘制路径）
// ============================================================
head('第一段 · 胜态吉祥物（负控靶子：它必须仍是原形象）');
await navigateTo(cdp, 'game');
const s0 = await st();
console.log(`      第 ${s0.level} 关 · ${s0.total} 张 · 槽位 ${s0.slotMax} 格`);
judge(s0.level === LEVEL, `主玩页已就绪（第 ${LEVEL} 关）`);

const okDemo = await cdp.ev('globalThis.__game5.demoResult(true)');
judge(okDemo === true, 'demoResult(true) 已把胜态结算卡绘制出来');
await sleep(1000);
const winInfo = await cdp.ev(mascotExpr('Mascot'));
console.log(`      胜态 Mascot = ${j(winInfo)}`);
judge(!!winInfo && winInfo.active, '胜态吉祥物节点 `Mascot` 在场且 active');
if (winInfo) {
    const okW = Math.abs(winInfo.designW - 240) < 1.5;
    const okH = Math.abs(winInfo.designH - 218.9) < 2.5;
    judge(okW && okH, `胜态吉祥物尺寸 ${winInfo.designW.toFixed(1)} × ${winInfo.designH.toFixed(1)}`
        + ` 设计 px（期望 240 × 218.9）`);
}
const winLabels = await labels();
console.log(`      胜态弹层文本：${j(winLabels)}`);
judge(winLabels.some((s) => s.includes('通关啦')), '胜态弹层出现「通关啦！」');
await shot('r47b-01-win-mascot.png');

// ============================================================
//  第二段 · 负态（**真实鼠标**点牌 → 槽位爆满 slotsFull）
// ============================================================
head('第二段 · 负态吉祥物（真实鼠标：点牌→槽位爆满→判负→结算卡）');
await cdp.send('Page.reload', {});
cdp.logs.length = 0;                       // ⚠️ 累计日志必须清空，否则会命中重载前那条
await waitFor(cdp, '!!window.__g5t', 30000, '页面助手 __g5t');
await navigateTo(cdp, 'game');
const s1 = await st();
judge(!!s1 && s1.over === false, `重进第 ${LEVEL} 关，局面干净（over=${s1?.over}）`);

const run = await dirtyFill();
console.log(`      填槽结束：${j({ stop: run.stop, clicks: run.i, slots: run.s?.slots })}`);
judge(run.stop === 'over', `对局已结束（stop=${run.stop}）`);
judge(s1.slotMax >= 8, `槽位上限 ${s1.slotMax}（逼近它能逼出 slotsFull）`);

await sleep(900);                          // 等判负 → openResult 的绘制落地
const sEnd = await st();
const failLabels = await labels();
console.log(`      终局 state = ${j(sEnd)}`);
console.log(`      负态弹层文本：${j(failLabels)}`);
judge(failLabels.some((s) => s.includes('就差一点')), '负态弹层出现「就差一点！」');
judge(!failLabels.some((s) => s.includes('通关啦')), '没有出现胜态文案');

const failInfo = await cdp.ev(mascotExpr('MascotFail'));
console.log(`      负态 MascotFail = ${j(failInfo)}`);
judge(!!failInfo && failInfo.active, '负态吉祥物节点 `MascotFail` 在场且 active（说明走的是负态分支）');
judge(!(await cdp.ev(existsExpr('Mascot'))), '负态下 `Mascot`（胜态那个节点名）**不在场**');

if (failInfo) {
    const okW = Math.abs(failInfo.designW - 240) < 1.5;
    const okH = Math.abs(failInfo.designH - 218.9) < 2.5;
    judge(okW && okH, `负态吉祥物尺寸 ${failInfo.designW.toFixed(1)} × ${failInfo.designH.toFixed(1)}`
        + ` 设计 px（期望 240 × 218.9 —— 与胜态同口径，卡面版式不动）`);
    judge(failInfo.sfW === 960 && failInfo.sfH === 875,
        `负态贴图原始尺寸 ${failInfo.sfW}×${failInfo.sfH}（期望 960×875，与基准同画幅）`);
    // ★ 贴图身份：不靠肉眼，靠 uuid
    const uuid = (failInfo.sfUuid || failInfo.texUuid || '');
    console.log(`      贴图身份：sfUuid=${failInfo.sfUuid}  texUuid=${failInfo.texUuid}  texName=${failInfo.texName}`);
    judge(uuid.includes(FAIL_UUID),
        `★ 负态贴图 uuid 命中构建产物里那张（${FAIL_UUID.slice(0, 8)}…）：${uuid}`);
    if (winInfo) {
        judge(failInfo.sfUuid !== winInfo.sfUuid,
            `★ 负态与胜态**不是同一张** spriteFrame（${(failInfo.sfUuid || '').slice(0, 8)} ≠ `
            + `${(winInfo.sfUuid || '').slice(0, 8)}）`);
    }
}
await shot('r47b-02-fail-mascot.png');

RESULT.phases = { win: winInfo, fail: failInfo, winLabels, failLabels, run: { stop: run.stop, clicks: run.i } };
RESULT.crop = {
    win: winInfo ? { x: winInfo.x, y: winInfo.y, w: winInfo.cssW, h: winInfo.cssH } : null,
    fail: failInfo ? { x: failInfo.x, y: failInfo.y, w: failInfo.cssW, h: failInfo.cssH } : null,
    shotScale: SCALE,
};
RESULT.judge = { pass, fail };
writeFileSync(resolve(OUT, '_r47b.json'), JSON.stringify(RESULT, null, 2));
console.log(`\n      → ${resolve(OUT, '_r47b.json')}`);

console.log(`\n══ 汇总：通过 ${pass} · 失败 ${fail} ══`);
try { proc.kill(); } catch { /* ignore */ }
await close();
process.exit(fail ? 1 : 0);
