#!/usr/bin/env node
/**
 * ============================================================
 *  _r46-verify.mjs · 第 46 轮六条需求的**真实浏览器（无头真机）自证**
 * ============================================================
 *  用户第 46 轮提了 6 条，全部落地后必须**用真实鼠标事件**验一遍
 *  （长期约定：能自证可用才交付；截图与"直接调函数"都绕过事件层，验不出问题）。
 *
 *  ① 消除 = 「点道具键 → 点槽里一张 → 强制消掉这 1 张」，两段式
 *  ② 移出 = 「槽里最靠前的 3 张 → 搬进临时 3 格暂存架」，且点架子里的牌能取回
 *  ③ 加槽到 9 格后**不能跑出屏幕**（格宽按容量重算）
 *  ④ 道具流程对齐 game-4：「先查可用性 → 再要权限（库存 / 广告 / 分享）→ 才执行」，
 *     且**广告/分享换来的那次不扣库存**；再加「3 秒没消 → 金环引导」
 *  ⑤ 分层：取消「当前段」限制 + 阈值 0.18 → 0.30 ⇒ **露出来的牌能点到**
 *  ⑥ 难度参数（`CFG.DIFF.BLOCK`）真的把**牌面**打散了
 *
 *  ────────────────────────────────────────────────────────────
 *  【两条把我坑过的口径，务必保持】
 *    ★ 库存断言一律读**增量**，不许写死绝对值。
 *      骰子赠礼本身就会随机给 MOVE / ERASE ×1（和值 5/7/9 给 ERASE、
 *      4/6/8/10 给 MOVE）⇒ "move 用完之后是 0"这种断言**在赠礼给 MOVE 时必假红**。
 *    ★ 暂存架里的牌**不是** `TempTile` 节点名 —— 「移出」是把槽内的
 *      `SlotTileN` 节点**原样 reparent** 到架子上（只有兜底补建的才叫 TempTile）。
 *      按名字找必然找不到，所以走 `__game5.tempPickables()` 拿坐标。
 *
 *  【用法】node tools/_r46-verify.mjs [输出目录]
 *    环境变量 G5_LEVEL 可换关卡（默认 9 —— 3 段、正是用户截图那一关）
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { designToCss, navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r46');
mkdirSync(OUT, { recursive: true });

const LEVEL = Number(process.env.G5_LEVEL || 9);
const W = 421, H = 927, SCALE = 3;

let fail = 0;
let pass = 0;
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

/** 设计 px 点位 → 真实鼠标点击（**必须过 designToCss**：设计 px ≠ CSS px） */
async function clickDesign(pt) {
    const [c] = await designToCss(cdp, [pt]);
    if (!c) throw new Error(`designToCss 失败：${j(pt)}`);
    await cdp.click(c.x, c.y);
    return c;
}
/**
 * 这一点上压着哪些节点（排障"点了没反应"用）。
 * ⚠️ `hit()` 是按**场景遍历顺序**（DFS 前序）返回的，全屏父节点永远排在最前面 ——
 *    只打印前几个等于什么都没看到（我自己就先踩了一次）。这里打**全部**名字。
 */
const hitStack = async (x, y) => {
    const [c] = await designToCss(cdp, [{ x, y }]);
    const h = await cdp.ev(`window.__g5t.hit(${c.x}, ${c.y})`);
    return { css: c, hit: h };
};
const hitNames = (h) => (h?.hit?.nodes ?? []).join(' ↑ ');

const st = () => cdp.ev('globalThis.__game5.state()');
const inv = () => cdp.ev('globalThis.__game5.runItems()');
const slots = () => cdp.ev('globalThis.__game5.slots()');
const slotPicks = () => cdp.ev('globalThis.__game5.slotPickables()');
const grant = async (id, n = 1) => cdp.ev(`globalThis.__game5.grantRunItem(${j(id)}, ${n})`);
/** 把某道具库存**置零**（用于逼出「库存空了才看广告」那条路） */
const zeroInv = async (id) => {
    const cur = await inv();
    const have = cur?.[id] ?? 0;
    if (have > 0) await grant(id, -have);
    return have;
};

/** 点可点的牌，直到槽里至少有 n 张（返回最终张数） */
async function ensureSlot(n) {
    for (let i = 0; i < 12; i++) {
        if ((await slots()).length >= n) break;
        const s = await st();
        if (s.over) break;
        const pk = await cdp.ev('globalThis.__game5.pickables()');
        if (!pk.length) break;
        await clickDesign({ x: pk[0].x, y: pk[0].y });
        await sleep(470);
    }
    return (await slots()).length;
}

/**
 * 把一串具名节点的 `UITransform` 换算到 **CSS 像素**再报左右缘。
 * ⚠️ `listNamed()` 的 x/y 是 CSS px，但 `w/h` 是**设计 px**（`ui.width`）——
 *    直接混用会把格宽算成实际值的 1.78 倍，于是"永远越屏"（假红）。
 */
async function rectsOf(reSource) {
    return await cdp.ev(`(function () {
  var r = window.__g5t.canvasRect(), v = window.__g5t.view();
  if (!r || !v) return null;
  var k = r.w / v.w;
  var re = ${reSource};
  var out = [];
  window.__g5t.listNamed().forEach(function (n) {
    if (!re.test(n.name) || n.active === false) return;
    var hw = (n.w / 2) * k, hh = (n.h / 2) * k;
    out.push({ name: n.name, cx: n.x, cy: n.y,
               left: n.x - hw, right: n.x + hw, top: n.y - hh, bottom: n.y + hh,
               wDesign: n.w, hDesign: n.h });
  });
  return { rect: r, view: v, k: k, nodes: out };
})()`);
}

// ============================================================
//  进场
// ============================================================
head('进场：首页 → 开局页 → 主玩页（全部真实鼠标）');
await navigateTo(cdp, 'game');
const s0 = await st();
const inv0 = await inv();
console.log(`      第 ${s0.level} 关 · 共 ${s0.total} 张 · 槽位 ${s0.slotMax} 格 · 剩余 ${s0.remaining}`);
console.log(`      本局骰子赠礼给的道具（这就是"库存"的真源）：${j(inv0)}`);
judge(s0.level === LEVEL && s0.total > 0, `主玩页已就绪（第 ${LEVEL} 关 / ${s0.total} 张）`);

// ------------------------------------------------------------
//  ⑥ 难度参数真的接在运行期上（只读）
// ------------------------------------------------------------
head('需求⑥ · 难度参数生效（牌面与关卡表逐位比对）');
const dcfg = await cdp.ev('globalThis.__game5.diffCfg()');
const fdiff = await cdp.ev('globalThis.__game5.faceDiff()');
console.log(`      DIFF = ${j(dcfg)}`);
console.log(`      牌面差异 = ${j(fdiff)}`);
judge(dcfg.enabled === true, '难度置换开关 `DIFF.ENABLED` = true');
judge(dcfg.effBlock === 6, `本关有效块大小 = 6（CFG.DIFF.BLOCK 默认值），实测 ${dcfg.effBlock}`);
judge(fdiff && fdiff.changed > 0 && fdiff.same === false,
    `牌面确实被置换打散（${fdiff?.changed}/${fdiff?.total} 张与关卡表不同）`);

// ------------------------------------------------------------
//  ⑤ 分层：段外露出来的牌也能点（**必须在动过局面之前测**）
// ------------------------------------------------------------
head('需求⑤ · 取消段限制 + 阈值 0.30 ⇒ 露出来的牌能点');
const diag = await cdp.ev('globalThis.__game5.tileDiag()');
const pickNow = await cdp.ev('globalThis.__game5.pickables()');
const activeSeg = s0.activeSeg;
// 旧口径（生成期）：既要在 activeSeg 段内、又要 cover < 0.18
const oldPick = diag.filter((t) => t.alive && t.cover < 0.18 && t.seg === activeSeg);
/**
 * ★ 这一条是「段限制的**净伤害**」——最有力的证据：
 *   牌**按旧的覆盖阈值 0.18 本就该可点**，却仅仅因为"不在当前段"而被判灰。
 *   （拿 `cover === 0` 当判据太苛刻：段间本来就会互相压一点。）
 */
const segOnlyBlocked = diag.filter((t) => t.alive && t.cover < 0.18 && t.seg !== activeSeg && t.seg >= 0);
// 旧阈值 0.18 与 0.30 之差带来的额外放宽
const thWidened = diag.filter((t) => t.alive && t.cover >= 0.18 && t.cover < 0.30);
console.log(`      当前段 = ${activeSeg} · 旧口径可点 ${oldPick.length} 张 · 现口径可点 ${pickNow.length} 张`);
console.log(`      仅因"不在当前段"而被挡住（旧阈值本就够） = ${segOnlyBlocked.length} 张`);
console.log(`      仅因阈值 0.18→0.30 而新放开的 = ${thWidened.length} 张`);
judge(pickNow.length > oldPick.length,
    `现口径可点张数 > 旧口径（${pickNow.length} > ${oldPick.length}）—— 段限制确实取消了`);
judge(segOnlyBlocked.length > 0,
    `存在 ${segOnlyBlocked.length} 张「旧阈值下本就够露、却只因不在当前段而被判灰」的牌（旧口径下它们点不动）`);

const target = segOnlyBlocked[0] ?? diag.filter((t) => t.pick && t.seg !== activeSeg)[0];
const targetPick = pickNow.find((p) => p.id === target?.id);
judge(!!targetPick, `目标牌 #${target?.id}（cover=${target?.cover} · seg=${target?.seg}）出现在 pickables 里`);
if (targetPick) {
    const hs = await hitStack(targetPick.x, targetPick.y);
    console.log(`      该点命中栈：${hitNames(hs)}（element=${hs.hit.el}）`);
    const before = (await slots()).length;
    const c = await clickDesign({ x: targetPick.x, y: targetPick.y });
    await sleep(540);
    const after = await slots();
    console.log(`      点击设计(${targetPick.x},${targetPick.y}) → CSS(${Math.round(c.x)},${Math.round(c.y)}) · 面部 ${targetPick.face}`);
    judge(after.includes(targetPick.id), `段外的牌 #${targetPick.id} 点一下就真的进槽了（槽 ${before} → ${after.length} 张）`);
}

// ------------------------------------------------------------
//  ① 消除：两段式 + 只删 1 张 + 取消不扣库存
// ------------------------------------------------------------
head('需求① · 「消除」= 点键 → 点槽里一张 → 只强消这 1 张');
let nSlot = await ensureSlot(1);
judge(nSlot >= 1, `槽内已有 ${nSlot} 张牌（「消除」的可点前提）`);

// (a) 取消：不消耗库存、不消牌
{
    await grant('erase', 1);
    const i0 = await inv();
    await tapNode(cdp, 'Tool_erase');
    await sleep(340);
    const armedA = await cdp.ev('globalThis.__game5.armed()');
    const i1 = await inv();
    await tapNode(cdp, 'Tool_erase');       // 二次点击 = 取消
    await sleep(340);
    const armedA2 = await cdp.ev('globalThis.__game5.armed()');
    const i2 = await inv();
    const sA = await st();
    console.log(`      点键 armed=${armedA}（erase ${i0.erase}→${i1.erase}）· 再点一次 armed=${armedA2}（erase ${i2.erase}）`);
    console.log(`      期间牌堆 remaining 仍是 ${sA.remaining}`);
    judge(armedA === true, '第一次点「消除」进入**就绪态**（armed=true）');
    judge(i1.erase === i0.erase, '仅仅进入就绪态**不扣库存**（扣减推迟到"真的选中牌"）');
    judge(armedA2 === false, '第二次点「消除」= 取消就绪态');
    judge(i2.erase === i0.erase, `取消**不消耗**库存（erase 仍是 ${i2.erase}）`);
}

// (b) 就绪 → 点槽内一张 → 只消 1 张，且扣 1 个库存
{
    const sp = await slotPicks();
    judge(sp.length > 0, `槽内有可选的牌 ${sp.length} 张（` + (sp[0]?.face ?? '') + `）`);
    if (sp.length > 0) {
        const one = sp[0];
        const sB = await st();
        const iB = await inv();
        await tapNode(cdp, 'Tool_erase');
        await sleep(320);
        const armedB = await cdp.ev('globalThis.__game5.armed()');
        const fromStockB = await cdp.ev('globalThis.__game5.eraseFromStock()');
        const hs = await hitStack(one.x, one.y);
        await clickDesign({ x: one.x, y: one.y });
        await sleep(680);
        const sC = await st();
        const iC = await inv();
        console.log(`      armed=${armedB} fromStock=${fromStockB} · 槽内第 ${one.i} 张(${one.face}) 命中栈：${hitNames(hs)}`);
        console.log(`      remaining ${sB.remaining}→${sC.remaining} · slots ${sB.slots}→${sC.slots} · cleared ${sB.cleared}→${sC.cleared}`);
        judge(armedB === true && fromStockB === true, '库存路径进入就绪态，且记账为「消耗库存」');
        // ⚠️ 口径：牌在被"点进槽"的那一刻就已经从牌堆离场了（`board.pick()` 把它
        //    置为非存活）⇒ 消掉它时 `remaining` **本来就不该变**。
        //    反过来，若这里变成 +1，说明误用了 `restore()`（那是「移出」的语义）——
        //    所以这条断言真正锁的是"**永久离场，不是退回牌堆**"。
        judge(sC.remaining === sB.remaining,
            `牌**永久离场而非退回牌堆**（remaining 保持 ${sB.remaining}；若走 restore 会 +1）`);
        judge(sC.slots === sB.slots - 1, `槽位**只摘 1 格**（${sB.slots} → ${sC.slots}）—— 方案 A：只删 1 张`);
        judge(sC.cleared === sB.cleared + 1, `「已清」计数 +1（${sB.cleared} → ${sC.cleared}）`);
        judge(iC.erase === iB.erase - 1, `走库存时**扣了** 1 个（erase 增量 = ${iC.erase - iB.erase}，期望 −1）`);
    }
}

// ------------------------------------------------------------
//  ② 移出：槽内最靠前 3 张 → 暂存架，再取回
// ------------------------------------------------------------
head('需求② · 「移出」= 槽里最靠前的 3 张 → 临时三槽（可取回 / 洗牌撒回）');
nSlot = await ensureSlot(3);
const slotBefore = await slots();
const facesBefore = await cdp.ev('globalThis.__game5.slotFaces()');
await grant('move', 1);
const iMove0 = await inv();
await tapNode(cdp, 'Tool_move');
await sleep(760);
const t1 = await cdp.ev('globalThis.__game5.temp()');
const slotAfter = await slots();
const iMove1 = await inv();
const expectN = Math.min(3, slotBefore.length);
console.log(`      移出前槽内 ${slotBefore.length} 张 ${j(facesBefore)} · 库存 move=${iMove0.move}`);
console.log(`      移出后暂存架 ${t1.count}/${t1.cap} 张 ${j(t1.faces)} · 显形=${t1.visible} · 槽内剩 ${slotAfter.length} 张`);
judge(t1.count === expectN, `暂存架收到 ${t1.count} 张（期望 ${expectN} = min(3, 槽内 ${slotBefore.length})）`);
judge(t1.visible === true, '暂存架**已显形**（第一次用「移出」才浮现）');
judge(slotAfter.length === slotBefore.length - expectN,
    `槽位同步减少 ${expectN} 张（${slotBefore.length} → ${slotAfter.length}）`);
judge(j(t1.faces) === j(facesBefore.slice(0, expectN)),
    `搬走的正是**最靠前**的那 ${expectN} 张（牌面逐个对上）`);
judge(iMove1.move === iMove0.move - 1, `走库存：move **扣了** 1 个（${iMove0.move} → ${iMove1.move}）`);

const rackGeom = await rectsOf('/^TempCell\\d+$/');
if (rackGeom) {
    const over = rackGeom.nodes.filter((n) => n.left < rackGeom.rect.l - 0.5 || n.right > rackGeom.rect.l + rackGeom.rect.w + 0.5);
    console.log(`      暂存架 3 格：设计宽 ${j([...new Set(rackGeom.nodes.map((n) => n.wDesign))])} · CSS 左右缘 ${rackGeom.nodes.map((n) => `${Math.round(n.left)}~${Math.round(n.right)}`).join(' ')}（画布宽 ${Math.round(rackGeom.rect.w)}）`);
    judge(rackGeom.nodes.length === 3, `暂存架确实是 3 格（实测 ${rackGeom.nodes.length}）`);
    judge(over.length === 0, `3 格全部在屏幕内（越界 ${over.length} 个）`);
}

// 取回：点架子里的牌 → 回主槽
{
    const tp = await cdp.ev('globalThis.__game5.tempPickables()');
    const before = await cdp.ev('globalThis.__game5.temp()');
    console.log(`      架内小牌坐标：${j(tp)}`);
    judge(tp.length === before.count, `架内 ${before.count} 张牌都拿得到坐标（实测 ${tp.length}）`);
        if (tp.length) {
        const hs = await hitStack(tp[0].x, tp[0].y);
        console.log(`      命中栈：${hitNames(hs)}`);
        await clickDesign({ x: tp[0].x, y: tp[0].y });
        await sleep(700);
        const after = await cdp.ev('globalThis.__game5.temp()');
        const sl = await slots();
        console.log(`      取回后暂存架 ${before.count} → ${after.count} · 槽内 ${sl.length} 张`);
        judge(after.count === before.count - 1, `点架子里的牌能**取回主槽**（暂存架 ${before.count} → ${after.count}）`);
    } else {
        judge(false, '架子里拿不到小牌坐标 —— 无法验证取回');
    }
}
await shot('r46-01-temp-rack.png');

// ------------------------------------------------------------
//  ③ 加槽：9 格也不能跑出屏幕
// ------------------------------------------------------------
head('需求③ · 加槽到上限后，槽位条不越屏（格宽按容量重算）');
const sBefore = await st();
const geom8 = await rectsOf('/^Slot\\d+$/');
await grant('addslot', 1);
await tapNode(cdp, 'Tool_addslot');
await sleep(700);
const sAfter = await st();
const geom9 = await rectsOf('/^Slot\\d+$/');
console.log(`      槽位 ${sBefore.slotMax} → ${sAfter.slotMax} 格`);
if (geom8 && geom9) {
    const w8 = [...new Set(geom8.nodes.map((n) => +n.wDesign.toFixed(2)))];
    const w9 = [...new Set(geom9.nodes.map((n) => +n.wDesign.toFixed(2)))];
    console.log(`      8 格设计宽 ${j(w8)} · 9 格设计宽 ${j(w9)}`);
    const over = geom9.nodes.filter((n) => n.right > geom9.rect.l + geom9.rect.w + 0.5 || n.left < geom9.rect.l - 0.5);
    const bl = Math.min(...geom9.nodes.map((n) => n.left));
    const br = Math.max(...geom9.nodes.map((n) => n.right));
    console.log(`      9 格整体（换算回设计 px）：左缘 ${Math.round((bl - geom9.rect.l) / geom9.k)} ～ 右缘 ${Math.round((br - geom9.rect.l) / geom9.k)} · 设计屏宽 750 / 槽位条 656`);
    judge(sAfter.slotMax === 9, `加槽生效：槽位 ${sBefore.slotMax} → ${sAfter.slotMax}`);
    judge(geom9.nodes.length === 9, `9 个格节点都在（实测 ${geom9.nodes.length}）`);
    judge(over.length === 0, `9 格**没有一个越出屏幕**（越界 ${over.length} 个）—— 正是用户截图右侧那处`);
    judge(w9[0] < w8[0], `格宽随容量变窄（${w8[0]} → ${w9[0]}，期望 (656−16×8)/9 = 58.67）`);
}

// ------------------------------------------------------------
//  ④ 广告 / 分享换来的道具：**立刻生效**、且**不扣库存**
// ------------------------------------------------------------
head('需求④ · 库存空了才看广告；换来的那一次**不扣库存**、且立刻生效');
{
    const hadErase = await zeroInv('erase');
    console.log(`      把 erase 库存置零（原有 ${hadErase} 个）→ 模拟"骰子赠礼已用光"`);
    await ensureSlot(1);
    const iBefore = await inv();
    await tapNode(cdp, 'Tool_erase');
    await sleep(520);
    const adOpen = await cdp.ev('!!window.__g5t.find("AdPanel")');
    console.log(`      库存 erase=${iBefore.erase} · 点「消除」→ 广告卡出现 = ${adOpen}`);
    judge(adOpen === true, '库存为空时点道具键 → 弹出「看广告 / 分享」卡');
    if (adOpen) {
        await shot('r46-02-ad-panel.png');
        await tapNode(cdp, 'Btn_分享给好友');
        await sleep(800);
        const armedAd = await cdp.ev('globalThis.__game5.armed()');
        const fromStockAd = await cdp.ev('globalThis.__game5.eraseFromStock()');
        const sp = await slotPicks();
        console.log(`      分享后：armed=${armedAd} fromStock=${fromStockAd}（期望 true / false）· 槽内可选 ${sp.length} 张`);
        judge(armedAd === true, '分享之后**立刻**推进「消除」就绪态（无需再点一次道具键）');
        judge(fromStockAd === false, '记账为「广告/分享得来」⇒ 消掉那张时**不得扣库存**');
        if (sp.length) {
            const sD = await st();
            const hs = await hitStack(sp[0].x, sp[0].y);
            await clickDesign({ x: sp[0].x, y: sp[0].y });
            await sleep(700);
            const sE = await st();
            const iAfter = await inv();
            console.log(`      槽内牌命中栈：${hitNames(hs)}`);
            console.log(`      slots ${sD.slots} → ${sE.slots} · cleared ${sD.cleared} → ${sE.cleared} · erase 库存 ${iBefore.erase} → ${iAfter.erase}`);
            judge(sE.slots === sD.slots - 1 || sE.cleared === sD.cleared + 1,
                `分享换来的「消除」确实生效（槽位 ${sD.slots} → ${sE.slots} · 已清 ${sD.cleared} → ${sE.cleared}）`);
            judge(iAfter.erase === 0 && iBefore.erase === 0,
                '广告/分享那次**没有凭空扣库存**（erase 恒为 0，未出现负数）—— 第 46 轮修的那个 bug');
        } else {
            judge(false, '分享后槽内拿不到可选的牌 —— 无法验证"立刻生效"');
        }
    }
}

// ------------------------------------------------------------
//  ④ 卡住提示（nudge）：金环出现 → 点环 → 道具生效
// ------------------------------------------------------------
head('需求④ · 「3 秒没消 → 主动引导看广告」的金环能出现、且点得动');
{
    await ensureSlot(1);                      // 槽里有牌 ⇒ 推荐必然是「消除」（优先级第一）
    await grant('erase', 1);                  // 造出确定的"有库存"路径
    const n0 = await cdp.ev('globalThis.__game5.nudge()');
    console.log(`      心跳状态（idle 可为负 = 开局宽限期内）：${j(n0)}`);
    const nudgedId = await cdp.ev('globalThis.__game5.forceNudge()');
    await sleep(500);
    const n1 = await cdp.ev('globalThis.__game5.nudge()');
    const hit = await cdp.ev('globalThis.__game5.nudgeHit()');
    console.log(`      推荐道具 = ${nudgedId} · nudge=${j(n1)}`);
    console.log(`      命中盒 = ${j(hit)}`);
    judge(nudgedId === 'erase', `槽里有牌 ⇒ 推荐的就是「消除」（优先级第一），实测「${nudgedId}」`);
    judge(n1.shown === true && n1.glowId === nudgedId, `金环已挂到该道具键上（glowId=${n1.glowId}）`);
    judge(n1.cool > 0, `同时进入冷却（cool=${n1.cool}s）—— 不会连环骚扰`);
    judge(!!hit, '引导的**命中盒**存在（含金环 + 「点这里 ▼」整片）');
    if (hit) {
        const halfW = hit.w / 2;
        console.log(`      命中盒 ${hit.w}×${hit.h} 设计 px · 半宽 ${halfW} · 键中心 (${hit.cellX},${hit.cellY})`);
        judge(halfW < 75, `命中盒半宽 ${halfW} < 75（相邻格中心距的一半）—— 不会抢隔壁键的点击`);
        const iG = await inv();
        const hs = await hitStack(hit.x, hit.y);
        console.log(`      命中盒中心命中栈：${hitNames(hs)}`);
        await clickDesign({ x: hit.x, y: hit.y });
        await sleep(700);
        const armedN = await cdp.ev('globalThis.__game5.armed()');
        const fromStockN = await cdp.ev('globalThis.__game5.eraseFromStock()');
        const n2 = await cdp.ev('globalThis.__game5.nudge()');
        const iH = await inv();
        console.log(`      点命中盒中心后：armed=${armedN} fromStock=${fromStockN} · nudge.shown=${n2.shown} · erase ${iG.erase} → ${iH.erase}`);
        judge(armedN === true, '点「金环 / 点这里」整片 → 与点道具键**同一条**链路（消除进入就绪态）');
        judge(n2.shown === false && n2.glowId === null, '玩家一动，金环立即收掉（不再挂在屏上）');
        // 收尾：把这次就绪态用掉，别挂着影响后面的收尾截图
        const sp = await slotPicks();
        if (sp.length) { await clickDesign({ x: sp[0].x, y: sp[0].y }); await sleep(680); }
    } else {
        judge(false, '拿不到引导命中盒 —— 无法证明「点环也生效」');
    }
}

// ------------------------------------------------------------
//  收尾
// ------------------------------------------------------------
head('收尾');
await shot('r46-03-final.png');
const sEnd = await st();
console.log(`      终局状态：${j(sEnd)}`);
if (sEnd.over) console.log('      （本局已结束 —— 说明上面的步骤用掉了不少槽位，属正常）');
// ⚠️ 只把**真异常**算作失败：本地静态服务器偶发 ERR_CONNECTION_RESET 是测试工装
//    自己的抖动（python http.server），与游戏代码无关；404 才是真的缺资源。
const errs = cdp.errors.filter((e) => !/favicon/i.test(e) && !/ERR_CONNECTION_RESET|ERR_ABORTED/.test(e));
const softErrs = cdp.errors.filter((e) => /ERR_CONNECTION_RESET|ERR_ABORTED/.test(e));
if (softErrs.length) console.log(`      （忽略本地服务器抖动 ${softErrs.length} 条：${softErrs[0].slice(0, 90)}…)`);
judge(errs.length === 0, `页面无非预期异常（实测 ${errs.length} 条${errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''}）`);

console.log(`\n============================================================`);
console.log(`  第 46 轮无头真机验证：${pass} 通过 / ${fail} 失败`);
console.log(`  截图目录：${OUT}`);
console.log(`============================================================`);

close();
proc.kill();
process.exit(fail ? 1 : 0);
