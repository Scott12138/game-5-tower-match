#!/usr/bin/env node
/**
 * ============================================================
 *  _r47-verify.mjs · 第 47 轮前两条需求的**真实浏览器（无头真机）自证**
 * ============================================================
 *  ① 判胜口径：**牌堆清空 + 暂存架空 ⇒ 判成功**，槽内残牌不再判负
 *  ② 暂存架：里面的牌**不再被重复缩放**（可见尺寸 30.6×40.5 → 48.4×64.0 设计 px）
 *  ③ 失败吉祥物三方案（AI 生图）走 Python 拍板板，不在本脚本
 *
 *  ────────────────────────────────────────────────────────────
 *  【口径纪律，别改回去】
 *    ★ 一切点击走 `designToCss()`（设计 px ≠ CSS px；本机视口 421×927）。
 *    ★ 「小牌」的实际大小挂在**节点 scale** 上，`listNamed()` 的 `w/h` 是
 *      **未乘缩放**的 contentSize ⇒ 必须 `w * sx`。只看 w/h 会把主槽位牌与
 *      暂存架牌看成一样大 —— 这恰恰就是原 bug 藏了这么多轮的原因。
 *    ★ 判据必须能**区分**对与错：② 的比值门限 [0.82, 0.91] 要把修复前的
 *      0.547 判红；① 的判别性事实是"**板空的那一刻槽里还有牌**"
 *      （旧代码要求 `slots.length === 0` 才算赢）。
 *
 *  ────────────────────────────────────────────────────────────
 *  【① 的局面怎么造】为什么不能靠"自动试玩到通关"：
 *    关卡表是**满清可解**的（每面张数都是 3 的倍数）⇒ 任何一次完美收官，
 *    槽里必然是 0 张 —— 旧判据同样判胜，**验不出东西**。
 *    要造出"板空 + 槽里有残牌"，必须**故意拆散一组三张**：
 *      先取 1 张 → 用「消除」把它消掉 → 那一面只剩 2 张
 *      ⇒ 这 2 张永远配不成组，只能留在槽里 ⇒ 板清空时槽必有残牌。
 *    ⚠️ 另一条弯路：用"贪心自动试玩"去打第 10 关（93 张）会**第 15 手就槽位爆满**
 *      （实测 slots=8/8 ⇒ slotsFull）。所以本段默认跑**小关**（G5_LEVEL=1，12 张）。
 *
 *  【用法】
 *    G5_ONLY=temp G5_LEVEL=10 node tools/_r47-verify.mjs /tmp/g5-r47   # ②
 *    G5_ONLY=win  G5_LEVEL=1  node tools/_r47-verify.mjs /tmp/g5-r47   # ①
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { designToCss, navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r47');
mkdirSync(OUT, { recursive: true });

const LEVEL = Number(process.env.G5_LEVEL || 10);
/** 只跑其中一段：`temp`（② 暂存架）/ `win`（① 判胜）/ `both`。两段各自独立起页更干净。 */
const MODE = process.env.G5_ONLY || 'both';
const W = 421, H = 927, SCALE = 3;

let fail = 0, pass = 0;
const judge = (ok, txt) => {
    console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt);
    if (ok) pass++; else fail++;
};
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);
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

/** 设计 px 点位 → 真实鼠标点击（**必须过 designToCss**） */
async function clickDesign(pt) {
    const [c] = await designToCss(cdp, [pt]);
    if (!c) throw new Error(`designToCss 失败：${j(pt)}`);
    await cdp.click(c.x, c.y);
    return c;
}

const st = () => cdp.ev('globalThis.__game5.state()');
const inv = () => cdp.ev('globalThis.__game5.runItems()');
const slots = () => cdp.ev('globalThis.__game5.slots()');
const tempApi = () => cdp.ev('globalThis.__game5.temp()');
const pickables = () => cdp.ev('globalThis.__game5.pickables()');
const grant = async (id, n = 1) => cdp.ev(`globalThis.__game5.grantRunItem(${j(id)}, ${n})`);

/** 点可点的牌，直到槽里至少有 n 张 */
async function ensureSlot(n) {
    for (let i = 0; i < 15; i++) {
        if ((await slots()).length >= n) break;
        if ((await st()).over) break;
        const pk = await pickables();
        if (!pk.length) break;
        await clickDesign({ x: pk[0].x, y: pk[0].y });
        await sleep(470);
    }
    return (await slots()).length;
}

/**
 * 全场景 Label 文本（判定弹层到底是「通关啦！」还是「就差一点！」）。
 * ⚠️ 缎带标题**没有专属节点名**（默认叫 Label），只能按文本找。
 */
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
 * 节点表（含 **父名** 与 **worldScale**）—— 量"看上去多大"用。
 * `w/h` 是未乘缩放的 contentSize（设计 px）⇒ 实际尺寸 = `w * sx`。
 */
const nodes = () => cdp.ev('window.__g5t.listNamed()');

/**
 * 真实鼠标自动对局：**优先挑"会凑成"的牌**。
 *
 * `slotFaces()` 是槽内真实牌面（不是本地记账）：
 *   ① 槽里已有 2 张同面 ⇒ 这一张直接凑成三张（最优）
 *   ② 否则挑"可点牌面里同面张数最多"的那个（三张都露出来了，早配早消）
 *   ③ 再否则挑槽里已有 1 张的
 * ⚠️ 这条启发式在**大关**上会输（第 10 关实测第 15 手就槽满）——
 *    它没有前瞻，槽位一紧就回不了头。小关足够。
 */
async function autoPlayRealMouse(maxClicks = 240) {
    let i = 0, stall = 0;
    /**
     * ★★ 必须在"板空但还没结算"那一瞬取样。
     *   判胜走的是 `checkBoardEmpty()` → 延迟 `PLAY.END_SETTLE_MS(420)` 复查 →
     *   `settleLeftoversOnWin()` **把槽内残牌销毁并置空 `_slots`** → `onWin()`。
     *   所以**结算之后**再读 `state().slots` 恒为 0（我第一版就是这么写的 ⇒ 假红），
     *   这恰恰会抹掉本需求要证的那件事。
     */
    let atBoardEmpty = null;
    const t0 = Date.now();
    while (i < maxClicks && Date.now() - t0 < 240000) {
        const s = await st();
        if (!s) return { stop: 'bridge-gone', i, s, atBoardEmpty };
        if (s.over) return { stop: 'over', i, s, ms: Date.now() - t0, atBoardEmpty };
        if (s.locked) { await sleep(110); continue; }
        const ps = await pickables();
        if (!ps.length) {
            if (++stall > 8) return { stop: 'nopick', i, s, ms: Date.now() - t0, atBoardEmpty };
            await sleep(300);
            continue;
        }
        stall = 0;
        const faces = await cdp.ev('globalThis.__game5.slotFaces()');
        const cnt = new Map();
        for (const f of faces) cnt.set(f, (cnt.get(f) || 0) + 1);
        const avail = new Map();
        for (const p of ps) avail.set(p.face, (avail.get(p.face) || 0) + 1);

        let cand = ps.find((p) => (cnt.get(p.face) || 0) === 2);
        if (!cand) {
            const rank = (p) => (avail.get(p.face) || 0) * 10 + (cnt.get(p.face) || 0);
            cand = ps.slice().sort((a, b) => rank(b) - rank(a))[0];
        }
        await clickDesign({ x: cand.x, y: cand.y });
        i++;
        // 紧贴点击后高频采样：抓"remaining 归零、但结算还没落地"的那一帧
        await sleep(150);
        let s2 = await st();
        for (let k = 0; k < 10 && s2 && !s2.over; k++) {
            if (s2.remaining === 0) atBoardEmpty = { slots: s2.slots, cleared: s2.cleared, after: i };
            await sleep(70);
            s2 = await st();
        }
        if (s2?.over) return { stop: 'over', i, s: s2, ms: Date.now() - t0, atBoardEmpty };
        if (i % 20 === 0) {
            console.log(`      … 第 ${i} 手：剩余 ${s2.remaining} · 槽 ${s2.slots} · 已消 ${s2.cleared}`);
        }
    }
    return { stop: 'maxclicks', i, s: await st(), ms: Date.now() - t0, atBoardEmpty };
}

// ============================================================
//  进场
// ============================================================
head('进场：首页 → 开局页 → 主玩页（全部真实鼠标）');
await navigateTo(cdp, 'game');
const s0 = await st();
console.log(`      第 ${s0.level} 关 · 共 ${s0.total} 张 · 槽位 ${s0.slotMax} 格 · 剩余 ${s0.remaining}`);
console.log(`      本局骰子赠礼给的道具（"库存"的真源）：${j(await inv())}`);
judge(s0.level === LEVEL && s0.total > 0, `主玩页已就绪（第 ${LEVEL} 关 / ${s0.total} 张）`);

// ============================================================
//  ② 暂存架：不再被重复缩放
// ============================================================
if (MODE === 'temp' || MODE === 'both') {
    head('需求② · 暂存架里的牌「不再被重复缩放」（真实鼠标走完整条链路）');

    const nSlot0 = await ensureSlot(3);
    judge(nSlot0 >= 3, `槽内已备好 ${nSlot0} 张牌（「移出」的可点前提）`);

    // 量主槽位牌的"看上去多大"（对照组）
    const listA = await nodes();
    const slotTiles = listA.filter((n) => /^SlotTile\d+$/.test(n.name) && n.parent !== 'TempRack' && n.active);
    const imgOf = (list, parentName) => list.find((n) => n.name === 'Img' && n.parent === parentName);
    const slotImg = slotTiles.length ? imgOf(listA, slotTiles[0].name) : null;
    const slotW = slotImg ? slotImg.w * slotImg.sx : 0;
    const slotH = slotImg ? slotImg.h * slotImg.sy : 0;
    console.log(`      主槽位牌「Img」：contentSize ${slotImg?.w}×${slotImg?.h} · scale ${slotImg?.sx}` +
        ` ⇒ 实际 ${slotW.toFixed(1)}×${slotH.toFixed(1)} 设计 px`);
    judge(slotW > 0, '量到主槽位牌的实际尺寸（对照基准）');

    // 真实鼠标点「移出」（库存只保证"有"，断言仍读增量）
    await grant('move', 1);
    await tapNode(cdp, 'Tool_move');
    await sleep(700);
    const t1 = await tempApi();
    console.log(`      移出后暂存架：${j(t1)}`);
    judge(t1.count === 3 && t1.visible === true,
        `「移出」把 3 张搬进了暂存架且架子显形（count=${t1.count} visible=${t1.visible}）`);

    const listB = await nodes();
    const tempTiles = listB.filter((n) => /^(SlotTile\d+|TempTile)$/.test(n.name) && n.parent === 'TempRack' && n.active);
    console.log(`      暂存架内节点：${tempTiles.map((n) => `${n.name}@${n.parent}`).join(', ') || '（无）'}`);
    judge(tempTiles.length === 3, '架子里确实有 3 个牌节点（reparent 过来的，仍叫 SlotTileN）');

    const timg = tempTiles.length ? imgOf(listB, tempTiles[0].name) : null;
    const tempW = timg ? timg.w * timg.sx : 0;
    const tempH = timg ? timg.h * timg.sy : 0;
    const ratio = slotW ? tempW / slotW : 0;
    console.log(`      暂存架牌「Img」：contentSize ${timg?.w}×${timg?.h} · scale ${timg?.sx}` +
        ` ⇒ 实际 ${tempW.toFixed(1)}×${tempH.toFixed(1)} 设计 px`);

    // ★ 判别性断言：修复前这里乘了**两次**缩放（比值 0.547）⇒ 只剩约 30.6 宽。
    judge(tempW >= 44, `暂存架里的牌宽 ${tempW.toFixed(1)} ≥ 44 设计 px（修复前的重复缩放只剩约 30.6）`);
    judge(ratio > 0.82 && ratio < 0.91,
        `暂存架牌 / 主槽位牌 = ${ratio.toFixed(3)} 落在 [0.820, 0.910]（修复前 0.547 —— 会被判红）`);
    const cardAspect = tempH ? tempW / tempH : 0;
    console.log(`      架内牌宽高比 = ${cardAspect.toFixed(3)}（牌面母版 88/117 = 0.752，等比才对）`);
    judge(Math.abs(cardAspect - 0.752) < 0.05, `架内牌没有被非等比拉伸（宽高比 ${cardAspect.toFixed(3)} ≈ 0.752）`);

    // 边界：三个架格 + 牌是否都在屏内（设计 px 0..750）
    const cells = listB.filter((n) => /^TempCell\d$/.test(n.name) && n.active);
    const view = await cdp.ev('window.__g5t.view()');
    const halfW = (n) => (n.w * n.sx) / 2;
    const outOfScreen = cells.filter((c) => c.x - halfW(c) < 0 || c.x + halfW(c) > view.w);
    console.log(`      架格共 ${cells.length} 个，横向范围 ${cells.map((c) =>
        `${Math.round(c.x - halfW(c))}~${Math.round(c.x + halfW(c))}`).join(' / ')}（屏宽 ${view.w}）`);
    judge(cells.length === 3 && outOfScreen.length === 0, '3 个架格都完整落在屏内，没有越界');

    const fitIssues = tempTiles.filter((n, i) => {
        const c = cells[i];
        const im = imgOf(listB, n.name);
        if (!c || !im) return true;
        return im.w * im.sx > c.w * c.sx + 1 || im.h * im.sy > c.h * c.sy + 1;
    });
    judge(fitIssues.length === 0, `架内的牌都装得进架格（${tempTiles.length} 张，无溢出）`);

    await shot('r47-01-temp-rack.png');

    // 回归：真实鼠标点架子里第一张 ⇒ 取回主槽（第 46 轮修的分派器）
    const tp = await cdp.ev('globalThis.__game5.tempPickables()');
    const before = (await slots()).length;
    if (tp.length) {
        const c = await clickDesign({ x: tp[0].x, y: tp[0].y });
        await sleep(600);
        const after = (await slots()).length;
        const t2 = await tempApi();
        console.log(`      点架内第 1 张 设计(${tp[0].x},${tp[0].y}) → CSS(${Math.round(c.x)},${Math.round(c.y)})`);
        judge(after === before + 1 && t2.count === 2,
            `架内牌点一下就回到主槽（槽 ${before} → ${after}，架 ${t1.count} → ${t2.count}）`);
    } else {
        judge(false, 'tempPickables() 为空 —— 架里的牌点不到');
    }
}

// ============================================================
//  ① 判胜：牌堆清空 + 槽里有残牌 ⇒ 胜
// ============================================================
if (MODE === 'win' || MODE === 'both') {
    head('需求① · 牌堆清空 + 槽里还有残牌 ⇒ 判**胜**（真实鼠标）');

    // ── 构造"残牌"：取 1 张 → 用「消除」把它消掉 → 那一面只剩 2 张，永远配不成组
    await ensureSlot(1);
    const before = await slots();
    judge(before.length >= 1, `槽内已有 ${before.length} 张（「消除」的可点前提）`);

    const facePicked = (await cdp.ev('globalThis.__game5.slotFaces()'))[0];
    await grant('erase', 1);
    await tapNode(cdp, 'Tool_erase');
    await sleep(340);
    const armedA = await cdp.ev('globalThis.__game5.armed()');
    const sp = await cdp.ev('globalThis.__game5.slotPickables()');
    console.log(`      「消除」就绪态 = ${armedA} · 槽内可点：${j(sp)}`);
    if (armedA && sp.length) {
        await clickDesign({ x: sp[0].x, y: sp[0].y });
        await sleep(600);
        const after = await slots();
        console.log(`      消掉「${facePicked}」这一张：槽 ${before.length} → ${after.length} 张`);
        judge(after.length === before.length - 1,
            `真实鼠标点槽内牌 ⇒ 确实强消 1 张（「${facePicked}」这一面只剩 2 张，从此配不成组）`);
    } else {
        judge(false, `「消除」没进入就绪态（armed=${armedA}）`);
    }

    // ── 真实鼠标清盘
    const run = await autoPlayRealMouse();
    console.log(`      自动对局结束：${j({ stop: run.stop, clicks: run.i, ms: run.ms })}`);
    await sleep(900);                                  // 让 END_SETTLE_MS(420) 的复查跑完
    const sEnd = await st();
    const tEnd = await tempApi();
    console.log(`      终局 state = ${j(sEnd)}   ← ⚠️ 结算后 slots 已被 settleLeftoversOnWin 置空`);
    console.log(`      终局暂存架 = ${j(tEnd)}`);
    console.log(`      ★ 板空那一瞬的取样 = ${j(run.atBoardEmpty)}`);

    judge(sEnd.over === true, '对局已结束（over=true）');
    judge(sEnd.remaining === 0, `牌堆已清空（remaining=${sEnd.remaining}）`);
    judge(tEnd.count === 0, `暂存架是空的（temp=${tEnd.count}）`);
    // ★★ 判别性事实：板空的那一刻**槽里还有牌** —— 旧代码要求 slots.length === 0 才算赢
    const slEmpty = run.atBoardEmpty ? run.atBoardEmpty.slots : 0;
    judge(slEmpty > 0, `★ 板空那一刻槽里仍有 ${slEmpty} 张残牌（这正是旧代码判负的场景）`);
    const lbs = await labels();
    console.log(`      弹层文本：${j(lbs)}`);
    const isWin = lbs.some((s) => s.includes('通关啦'));
    const isLose = lbs.some((s) => s.includes('就差一点'));
    const legacy = lbs.some((s) => s.includes('牌出完了'));
    judge(isWin, '结算弹层是**胜**态（出现「通关啦！」）');
    judge(!isLose && !legacy, '没有出现败态文案（「就差一点！」/「牌出完了 · 槽里没消掉」都未出现）');

    await shot('r47-02-win-board-empty.png');

    // 负控：把旧判据照抄一遍，证明它在本局会判负
    const wouldOldFail = sEnd.remaining === 0 && slEmpty > 0;
    console.log(`      负控：若沿用旧判据「remaining===0 && slots.length===0 才赢」，` +
        `本局板空时 slots=${slEmpty} ⇒ ${wouldOldFail ? '会判负' : '仍会判胜'}（应"会判负"）`);
    judge(wouldOldFail, "负控成立：旧判据在本局会走 onFail('boardEmptySlotsLeft')，新判据判胜");
}

console.log(`\n══ 汇总：通过 ${pass} · 失败 ${fail} ══`);
try { proc.kill(); } catch { /* ignore */ }
await close();
process.exit(fail ? 1 : 0);
