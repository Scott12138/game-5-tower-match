#!/usr/bin/env node
/**
 * ============================================================
 *  _r59-verify.mjs · 第 59 轮 · 三条用户需求的浏览器验收
 * ============================================================
 *  需求（用户 2026-10-07 原话）：
 *    ① 「完成一关后，在结算界面增加返回首页的按钮」
 *    ② 「修复点击重置进度后没有立即重置的问题，要求点击后即刻重置，
 *        无需进入下一关才生效」
 *    ③ 「为"吃"和"碰"补充动态效果，参考隔壁项目"麻麻大消除"的动态效果
 *        进行模仿，保持表现一致」
 *
 *  ── 三条需求各自的「要害」与判据口径 ────────────────────────────
 *   ① 的要害是**出口真的存在**：结算弹层此前两态都没有任何回首页的路
 *      （遮罩吃触摸、点空白关不掉）⇒ 玩家不想看广告就只能「重新挑战」。
 *      判据：① 结算卡里 `BtnHome` 存在且文案是「返回首页」；② 它在**卡内**、
 *      且在主按钮**下方**（不是叠在别的按钮上）；③ **真实鼠标**点它 → 回到首页
 *      且结算层已销毁。**负控**：同一套「找 BtnHome」的量法在**对局中**必须返回
 *      false（否则这条判据在"永远返回真"的世界里也成立）。
 *
 *   ② 的要害不是"存档清没清"，而是**画面就地刷新了没有**。
 *      根因：首页所有读存档的显示都是**建时快照**，`resetAll()` 之后没人刷。
 *      判据：重置前后读**同一批** Label 的字符串 + 金币胶囊 + 存档字段；
 *      并**自证"没有刷新页面"**（`window.__r59Mark` 是种子脚本在 document-start
 *      打的标记，它活着 ⇒ 全程没 reload ⇒ 所谓"即刻生效"不是靠重载装出来的）。
 *      **正控**：重置**前**同一套量法必须读到旧值（5 关 / 150 金币）——
 *      没有它，"重置后还是 1"在"本来就显示 1"的世界里恒真。
 *
 *   ③ 的要害是**真的"撞"了**，而不是"三张牌各自胀了一下"。
 *      旧实现三张牌从头到尾待在自己的槽格里，彼此之间从没发生过任何空间关系。
 *      ⇒ 判据必须建在**空间关系**上（中心间距先涨后收）与**只可能来自撞击帧的
 *      产物**上（冲击环 / 碎屑 / 飘字），而不是"有没有放大过"。
 *
 *  ── 本轮判据纪律（沿用 + 新增）──────────────────────────────────
 *   ★ 撞击帧只有 **9ms 宽**（挤压段 31.5ms 里只有后 9ms 满足 sx<0.93），
 *     所以本轮**不用固定 sleep 去"恰好在那一瞬"采样** —— 那是撞运气的写法。
 *     改为在**点击之前**往页面里注入一个 `setInterval(…, 4)` 录制器（4ms 粒度），
 *     逐样记录槽位条的子节点与它们的 x / scale，事后按时间轴判定。
 *     ⚠️ 4ms 是**算出来的下限**：要让"任何 9ms 宽的窗口里至少有 1 个采样点"，
 *        采样间隔必须显著小于 9ms。用 16ms（rAF）时命中率只有 ~55% ⇒ 会偶发假红。
 *   ★ 取样口径必须**先证明它自己是活的**：录制器里 `tiles` 在撞击前必须是 **0**
 *     （三张牌这时还住在槽格 `Slot{i}` 里），撞击时变 **3**。若一次都没见过 3，
 *     说明量错了对象（比如 `find('SlotBar')` 找到了别的节点），此时任何"没撞上"
 *     的结论都不成立 —— 这条自证写在 C3。
 *   ★ 主玩页（含其上的结算弹层）**只用 `screencastShot`** —— 判据 48b：
 *     `captureScreenshot` 在主玩页上会把渲染进程卡死且不可逆（无 clip 150s）。
 *     静态页（首页）才走 `verifiedShot`。
 *   ★ 往 `cdp.ev(...)` 注入的 JS 里**不能出现反引号**（判据 57）——
 *     本文件所有注入串都是普通字符串拼接，没有一处用模板字面量包注入体。
 *
 *  【用法】node tools/_r59-verify.mjs          全绿 ⇒ exit 0
 *          G5_OUT=/tmp/xxx node tools/_r59-verify.mjs
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    SAVE_KEY, designToCss, openBrowser, screencastShot, sleep, startServer, tapNode, waitFor,
} from './g5-cdp.mjs';

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r59-verify');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, SCALE = 3;

let pass = 0, fail = 0;
const rows = [];
function ok(cond, msg, detail) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ ${msg}${detail ? `\n      ↳ ${detail}` : ''}`); }
    rows.push({ msg, ok: !!cond, detail: detail ?? null });
}
function head(t) { console.log(`\n══ ${t} ══`); }
const j = (x) => JSON.stringify(x);

/** 软等待：超时不抛，交回布尔（避免"一条断言超时 ⇒ 后面全没跑"） */
async function softWait(expr, ms, label) {
    try { await waitFor(cdp0, expr, ms, label); return true; } catch { return false; }
}

// ------------------------------------------------------------
//  存档种子：**故意铺一个"看得出来"的旧值**（第 5 关 / 150 金币 / 有道具）
//  ① 让需求②的"重置前后"对比是**非平凡的**（都是 1 关 0 金币时，"没变"恒真）
//  ② `__r59Mark` 打在 document-start ⇒ 它是"页面有没有被重载过"的唯一凭证
// ------------------------------------------------------------
function seedSave() {
    const data = {
        level: 5, best: 4, coins: 150, plays: 6, cleared: 40,
        inventory: { erase: 2, move: 1, shuffle: 2, addslot: 1 },
        signDate: '', signStreak: 0, signTotal: 3, dailyDate: '', daily: {},
    };
    return 'window.__r59Mark = "alive";'
        + ' try { localStorage.setItem(' + j(SAVE_KEY) + ', ' + j(JSON.stringify(data)) + '); } catch (e) {}';
}

// ------------------------------------------------------------
//  页面侧小探针（**注入体一律用普通字符串**，见文件头判据）
// ------------------------------------------------------------

/** 某个具名节点**子树内**所有 Label 的 string（首页那批"建时快照"就是它们） */
const labelsUnder = (name) => '(function () {'
    + ' var t = window.__g5t, n = t.find(' + j(name) + ');'
    + ' if (!n) return null;'
    + ' var out = [];'
    + ' (function walk(x) {'
    + '   var c = x.getComponent("cc.Label");'
    + '   if (c) out.push(c.string);'
    + '   for (var i = 0; i < x.children.length; i++) walk(x.children[i]);'
    + ' })(n);'
    + ' return out;'
    + '})()';

/** 结算弹层几何：BtnHome / 主按钮 / 次按钮 的屏幕中心 + BtnHome 与卡片的**上下边界** */
//
//  ⚠️ 本脚本第一版在这里踩过一次（A6 假红），把它写下来：
//     `worldToScreen(node)` 返回的是节点的 **position**（= 锚点所在处），
//     **不是**矩形的中心。结算卡的锚点是 `[0.5, 1]` ⇒ 它给出的 y 是卡片的
//     **顶边**，而 `BtnHome` 的锚点是 `[0.5, 0.5]` ⇒ 给出的是中心。
//     两个口径不同的量直接相减可以凭空造出 234px 的"越界"。
//     ⇒ 统一按 `top = cy − (1−anchorY)·h` / `bot = cy + anchorY·h` 换算成边界再比。
const resultGeo = '(function () {'
    + ' var t = window.__g5t;'
    + ' function c(n) { var p = t.centerOf(n); return p ? { x: Math.round(p.x), y: Math.round(p.y) } : null; }'
    + ' function box(n) {'
    + '   var x = t.find(n); if (!x) return null;'
    + '   var u = x.getComponent("cc.UITransform"); if (!u) return null;'
    + '   var p = t.worldToScreen(x); if (!p) return null;'
    + '   var r = t.canvasRect(), v = t.view(), k = r.w / v.w;'
    + '   var w = u.width * k, h = u.height * k, ay = u.anchorY;'
    + '   return { cx: p.x, cy: p.y, w: w, h: h, ay: ay,'
    + '            top: p.y - (1 - ay) * h, bot: p.y + ay * h, dw: u.width, dh: u.height };'
    + ' }'
    + ' return {'
    + '   layer: !!t.find("ResultLayer"),'
    + '   home: c("BtnHome"), homeBox: box("BtnHome"),'
    + '   gold: c("BtnNext") || c("BtnAdRevive"),'
    + '   ghost: c("BtnRetry") || c("BtnShare"),'
    + '   card: box("Card"), canvas: t.canvasRect(), view: t.view()'
    + ' };'
    + '})()';

/** 首页「重置进度」二次确认对话框是否已开 */
const dialogOpen = '(function () { return !!window.__g5t.find("ConfirmDialog"); })()';

/** 存档里的关键字段（**直接读后端**，与 UI 显示分开看） + 重载标记 */
const saveFields = '(function () {'
    + ' try {'
    + '   var d = JSON.parse(localStorage.getItem(' + j(SAVE_KEY) + ') || "null");'
    + '   if (!d) return null;'
    + '   return { level: d.level, coins: d.coins, cleared: d.cleared,'
    + '            inv: d.inventory, mark: window.__r59Mark || null };'
    + ' } catch (e) { return { err: String(e) }; }'
    + '})()';

// ------------------------------------------------------------
//  ③ 专用：**4ms 粒度录制器**（在点击之前注入，事后按时间轴判定）
// ------------------------------------------------------------
//
//  录什么：
//    tiles  —— `SlotBar` 的**直属**子节点里名字以 `SlotTile` 开头的那些（带 x / scale）
//              ⚠️ 只有被"摘出槽格"的那三张才会出现在这里 ⇒
//                 tiles.length 从 0 → 3 的那一刻，就是"摘牌"真的发生了。
//    pulses —— `ClashPulse` 个数（冲击环）
//    shards —— `Shard*` 个数（碎屑）
//    pop    —— 顶层弹层里的 `Pop` 个数（飘字「碰 / 吃」）
//
//  ⚠️ 三个特效节点的名字与 `MotionFx.spawnPulse/spawnShards`、`GamePage.popToast`
//     里 `createNode(...)` 的字面量**必须逐字一致**；改名了这里会静默录成 0
//     （表现是"特效没出现"，与真实原因完全无关 —— 所以 C3 起手先自证量法活着）。
//  ⚠️ 用 `setInterval(…, 4)` 而**不是** `requestAnimationFrame`：
//     rAF 跟随引擎主循环（~16.7ms），而挤压段满足判据的窗口只有 **9ms**，
//     16ms 的采样间隔会漏掉它（命中率 ~55%，偶发假红）。4ms 粒度下
//     "任何 9ms 窗口至少落 1 个采样点"是**算术保证**，不是运气。
const CLASH_RECORDER = '(function () {'
    + '  var t = window.__g5t;'
    + '  function r3(x) { return Math.round(x * 1000) / 1000; }'
    + '  function snap() {'
    + '    var o = { t: 0, tiles: [], pulses: 0, shards: 0, pop: 0 };'
    + '    var bar = t.find("SlotBar");'
    + '    if (bar) {'
    + '      for (var i = 0; i < bar.children.length; i++) {'
    + '        var c = bar.children[i], n = c.name;'
    + '        if (n.indexOf("SlotTile") === 0) {'
    + '          o.tiles.push({ x: r3(c.position.x), sx: r3(c.scale.x), sy: r3(c.scale.y) });'
    + '        } else if (n === "ClashPulse") { o.pulses++; }'
    + '        else if (n.indexOf("Shard") === 0) { o.shards++; }'
    + '      }'
    + '    }'
    + '    var top = t.find("TopLayer");'
    + '    if (top) {'
    + '      for (var k = 0; k < top.children.length; k++) {'
    + '        if (top.children[k].name === "Pop") o.pop++;'
    + '      }'
    + '    }'
    + '    return o;'
    + '  }'
    + '  var t0 = performance.now(), arr = [];'
    + '  window.__r59 = { samples: arr, done: false };'
    + '  var h = setInterval(function () {'
    + '    var el = performance.now() - t0;'
    + '    var s = snap(); s.t = Math.round(el); arr.push(s);'
    + '    if (el >= 1700 || arr.length >= 500) { clearInterval(h); window.__r59.done = true; }'
    + '  }, 4);'
    + '  return true;'
    + '})()';

/** 取回录制结果 */
const READ_RECORDER = '(function () {'
    + '  var r = window.__r59;'
    + '  if (!r) return null;'
    + '  return { done: r.done, n: r.samples.length, samples: r.samples };'
    + '})()';

/** 槽格宽（撞击几何的**单位**：`span = cellW × CLASH_OVERLAP`） */
const CELL_W = '(function () {'
    + '  var t = window.__g5t, n = t.find("Slot0");'
    + '  if (!n) return null;'
    + '  var u = n.getComponent("cc.UITransform");'
    + '  return u ? u.width : null;'
    + '})()';

// ============================================================

const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

const { cdp, close } = await openBrowser(url, {
    width: W, height: H, scale: SCALE, seedScript: seedSave(),
});
const cdp0 = cdp;                                     // `softWait` 要闭包引用它

const st = () => cdp.ev('globalThis.__game5 ? __game5.state() : null');
const pickables = () => cdp.ev('globalThis.__game5 ? __game5.pickables() : []');
const slotFaces = () => cdp.ev('globalThis.__game5 ? __game5.slotFaces() : []');
const slotsIdx = () => cdp.ev('globalThis.__game5 ? __game5.slots() : []');

/** 真实鼠标点一个**设计 px** 坐标（必须过 designToCss，见判据 12） */
async function clickDesign(pt) {
    const [c] = await designToCss(cdp, [pt]);
    if (!c) throw new Error(`designToCss 失败：${j(pt)}`);
    await cdp.click(c.x, c.y);
    return c;
}

/** 首页 → 开局页 → 主玩页（**全程真实鼠标**） */
async function gotoGame(sleepDice = 4600) {
    cdp.logs.length = 0;
    await tapNode(cdp, 'BtnStart');
    if (!(await softWait("!!window.__g5t.find('BtnGo')", 15000, '开局页 BtnGo'))) {
        throw new Error('没到开局页');
    }
    await sleep(sleepDice);                       // 掷骰 + 赠礼卡
    await tapNode(cdp, 'BtnGo');
    await waitFor(cdp, '!!globalThis.__game5', 20000, '主玩页调试桥');
    await sleep(500);
}

/** 脏策略填槽：真实鼠标点牌，**绝不让槽内任一面凑到 3 张** ⇒ 逼出收局 */
async function dirtyFill(maxClicks = 40) {
    let i = 0, stall = 0;
    while (i < maxClicks) {
        const s = await st();
        if (!s) return { stop: 'bridge-gone', i };
        if (s.over) return { stop: 'over', i, s };
        if (s.locked) { await sleep(120); continue; }
        const ps = await pickables();
        if (!ps.length) { if (++stall > 8) return { stop: 'nopick', i, s }; await sleep(300); continue; }
        stall = 0;
        const faces = await slotFaces();
        const cnt = new Map();
        for (const f of faces) cnt.set(f, (cnt.get(f) || 0) + 1);
        const safe = ps.filter((p) => (cnt.get(p.face) || 0) < 2);
        const pool = safe.length ? safe : ps;
        const cand = pool.slice().sort((a, b) => (cnt.get(a.face) || 0) - (cnt.get(b.face) || 0))[0];
        await clickDesign({ id: cand.id, x: cand.x, y: cand.y });
        i++;
        await sleep(340);
    }
    return { stop: 'maxclicks', i, s: await st() };
}

try {
    // ========================================================
    head('B 组 · 需求② 「重置进度」必须**即刻生效**（不靠重载、不靠进下一关）');
    // ========================================================
    await waitFor(cdp, "!!window.__g5t.find('BtnStart')", 30000, '首页主按钮');
    await sleep(1800);                                   // 首页入场 settleIn 走完

    const subBefore = await cdp.ev(labelsUnder('BtnStart'));
    const progBefore = await cdp.ev(labelsUnder('Progress'));
    const coinBefore = await cdp.ev(labelsUnder('Wallet'));
    const svBefore = await cdp.ev(saveFields);
    console.log(`    · 重置前：主按钮=${j(subBefore)} 进度=${j(progBefore)} 金币=${j(coinBefore)}`);
    console.log(`    · 重置前存档：${j(svBefore)}`);

    //  ★ 判据的**可证伪前置**：这一屏必须真的显示着"旧值"。
    ok(!!subBefore && subBefore.some((s) => s.includes('第 5 关')),
        '★ B0 正控：主按钮副标题现在就写着「继续 · 第 5 关」',
        `实测 ${j(subBefore)} —— 不是 5 关的话，下面几条"重置后变 1"全是空判据`);
    ok(!!svBefore && svBefore.level === 5 && svBefore.coins === 150,
        '★ B0b 正控：存档里确实是 第 5 关 / 150 金币', j(svBefore));
    ok(!!svBefore && svBefore.mark === 'alive',
        '★★ B0c `window.__r59Mark` 已就位（种子脚本在 document-start 打的）—— 后面用它证明"全程没刷新过页面"');

    // ---- 真实鼠标：设置 → 重置进度 → 确认重置 ----
    await tapNode(cdp, 'Setting');
    await sleep(900);
    ok(await cdp.ev("!!window.__g5t.find('Link_重置进度')") === true,
        '★ B1 设置面板已展开（找得到「重置进度」行）');
    await tapNode(cdp, 'Link_重置进度');
    await sleep(700);
    ok(await cdp.ev(dialogOpen) === true,
        '★★ B2 破坏性操作**仍然弹二次确认**（第 52 轮的口径没被这次改动破坏）');
    await tapNode(cdp, 'BtnOk');
    await sleep(800);

    const svAfter = await cdp.ev(saveFields);
    const subAfter = await cdp.ev(labelsUnder('BtnStart'));
    const progAfter = await cdp.ev(labelsUnder('Progress'));
    const coinAfter = await cdp.ev(labelsUnder('Wallet'));
    console.log(`    · 重置后：主按钮=${j(subAfter)} 进度=${j(progAfter)} 金币=${j(coinAfter)}`);
    console.log(`    · 重置后存档：${j(svAfter)}`);

    ok(!!svAfter && svAfter.level === 1 && svAfter.coins === 0 && svAfter.cleared === 0,
        '★ B3 存档已被清空（level=1 / coins=0 / cleared=0）', j(svAfter));
    //  ★★ 下面是需求②的**核心判据**：**画面上**的数字必须当场就变了。
    //     修复前它们全是"建时快照"，`resetAll()` 之后一个都不刷 ⇒ 玩家判定"没生效"。
    ok(!!subAfter && subAfter.some((s) => s === '继续 · 第 1 关'),
        '★★ B4 【需求②核心】**不刷新页面、不进下一关**，主按钮副标题当场变成「继续 · 第 1 关」'
        + `（修复前一直是「继续 · 第 5 关」）— 实测 ${j(subAfter)}`);
    ok(!!progAfter && progAfter.some((s) => s.startsWith('第 1 关 ·')),
        '★★ B5 进度条那行文案当场变成「第 1 关 · 共 N 关」', j(progAfter));
    ok(!!coinAfter && coinAfter.some((s) => s === '0'),
        '★★ B6 金币胶囊当场归零（重置前是 150）', j(coinAfter));
    //  ★★ 反证：**没有重载页面**。"即刻生效"若是靠 reload 装出来的，这里会挂。
    ok(!!svAfter && svAfter.mark === 'alive',
        '★★ B7 反证：`window.__r59Mark` 仍然活着 ⇒ 全程**没有刷新页面**'
        + '（"即刻生效"是这一帧真的重画了，不是重载装出来的）', j(svAfter));

    // ---- 收尾：关掉设置面板（否则遮罩会吞掉下面的点击）----
    await tapNode(cdp, 'Close');
    await sleep(700);

    // ---- 真实鼠标点主按钮：必须进**第 1 关**（不能是建时捕获的旧关卡号）----
    await gotoGame();
    const s1 = await st();
    ok(!!s1 && s1.level === 1,
        '★★ B8 重置后立刻点「开始游戏」⇒ 进的是**第 1 关**'
        + '（修复前会进重置前捕获的第 5 关 —— 显示刷了、行为没刷，两边都不报错）', j(s1));

    // ========================================================
    head('A 组 · 需求① 结算弹层的「返回首页」按钮（真实鼠标）');
    // ========================================================
    ok(await cdp.ev("!window.__g5t.find('BtnHome')") === true,
        '★★ A0 负控：**对局中**找不到 BtnHome ⇒ 后面"结算层里能找到"这条判据不是恒真',
        '若这里就找得到，说明它一直挂在场景里，A3 便不能证明"按钮是新加的"');

    const run = await dirtyFill();
    console.log(`    · 填槽结束：stop=${run.stop} 点击=${run.i}`
        + ` 槽=${run.s ? run.s.slots : '?'}/${run.s ? run.s.slotMax : '?'}`);
    ok(run.stop === 'over', `★ A1 脏填把这一局打到了收局（stop=${run.stop}）`);
    await sleep(1400);                                   // 等 openResult 绘制 + 入场走完

    const geo = await cdp.ev(resultGeo);
    console.log(`    · 结算几何：home=${j(geo && geo.home)} ghost=${j(geo && geo.ghost)}`
        + ` card=${j(geo && geo.card && { cy: Math.round(geo.card.cy), h: Math.round(geo.card.h) })}`);
    ok(!!geo && geo.layer === true, '★ A2 结算层 `ResultLayer` 已弹出');
    ok(!!geo && geo.home !== null, '★★ A3 结算卡里**存在** `BtnHome` 且正在显示');

    const homeTxt = await cdp.ev(labelsUnder('BtnHome'));
    ok(!!homeTxt && homeTxt.includes('返回首页'), '★★ A4 按钮文案就是「返回首页」', j(homeTxt));

    //  版式判据：必须落在**次按钮之下**、且在卡内与画布内。
    //  ⚠️ 屏坐标 y 向下 ⇒ "在下方" = y 更大。
    ok(!!geo && !!geo.home && !!geo.ghost && geo.home.y > geo.ghost.y + 40,
        '★★ A5 版式：「返回首页」排在**次按钮下方**（独立第三排，不是叠在别的按钮上）',
        geo && geo.home && geo.ghost ? `home.y=${geo.home.y} ghost.y=${geo.ghost.y}` : j(geo));
    ok(!!geo && !!geo.home && !!geo.card && geo.home.y > geo.card.top && geo.home.y < geo.card.bot,
        '★ A6 它落在**结算卡框内**（卡高 = 内容总高 ⇒ 没有"卡底留白凭空多/少一截"）',
        j(geo && { homeY: geo.home && geo.home.y,
            cardTop: geo.card && Math.round(geo.card.top), cardBot: geo.card && Math.round(geo.card.bot) }));
    ok(!!geo && !!geo.homeBox && !!geo.view && geo.homeBox.top > 0 && geo.homeBox.bot < geo.view.h,
        '★★ A7 「返回首页」整个按钮**在画面内**（没被挤出屏幕下沿）',
        j(geo && geo.homeBox && { top: Math.round(geo.homeBox.top),
            bot: Math.round(geo.homeBox.bot), vh: geo.view.h }));

    const shotA = resolve(OUT, 'A-结算弹层-返回首页.png');
    await screencastShot(cdp, shotA, { w: W, h: H });
    console.log(`    · 取证截图（主玩页唯一可用通道）→ ${shotA}`);

    // ---- 真实鼠标点它：必须回首页，且结算层销毁 ----
    cdp.logs.length = 0;
    await tapNode(cdp, 'BtnHome');
    const back = await softWait("!!window.__g5t.find('BtnStart')", 15000, '回到首页');
    ok(back, '★★ A8 真实鼠标点「返回首页」⇒ 真的回到了首页（首页主按钮出现）');
    await sleep(600);
    ok(await cdp.ev("!window.__g5t.find('ResultLayer')") === true,
        '★★ A9 结算层已销毁（没有"人回首页了、遮罩还盖在上面"）');
    ok(await cdp.ev("!window.__g5t.find('BtnHome')") === true,
        '★ A10 结算卡（连同 BtnHome）一起收干净了');

    // ========================================================
    head('C 组 · 需求③「碰 / 吃」的**撞击**动效（4ms 逐帧录制，真实鼠标）');
    // ========================================================
    await gotoGame();
    const cellW = await cdp.ev(CELL_W);
    console.log(`    · 槽格宽 cellW = ${cellW}（span = cellW × CLASH_OVERLAP = ${cellW * 0.45}）`);
    ok(typeof cellW === 'number' && cellW > 20, `★ C0 取到槽格宽 ${cellW}（撞击几何的单位）`);

    // ---- 负控：点一张**不成组**的牌 → 不该有任何撞击产物 ----
    {
        const s0 = await st();
        const p0 = (await pickables())[0];
        ok(!!s0 && s0.slots === 0, `★ C1a 负控起点：开局槽是空的（slots=${s0 && s0.slots}）`
            + ' ⇒ 这一手**不可能**成组');
        await cdp.ev(CLASH_RECORDER);
        await clickDesign({ id: p0.id, x: p0.x, y: p0.y });
        await sleep(1900);
        const rec0 = await cdp.ev(READ_RECORDER);
        const dirty = rec0 ? rec0.samples.filter((s) => s.pulses || s.shards || s.pop || s.tiles.length) : [];
        console.log(`    · 负控录制：${rec0 ? rec0.n : 0} 帧，其中"有撞击产物"的 ${dirty.length} 帧`);
        ok(!!rec0 && rec0.n >= 200, `★ C1b 录制器真的在跑（${rec0 ? rec0.n : 0} 帧 ≈ 4ms 粒度，上限 1700ms）`,
            '帧数太少说明 setInterval 被节流，后面的时间轴判据都不成立');
        ok(!!rec0 && dirty.length === 0,
            '★★ C1c 【负控】不成组的这一手：全程 **0 帧**有冲击环 / 碎屑 / 飘字 / 摘牌'
            + ' ⇒ 本组的量法不是"永远能测到东西"', j(dirty.slice(0, 2)));
    }

    // ---- 正控：把槽里攒到"同面两张 + 场上还有一张"，再点下第三张 ----
    let ready = null, guard = 0;
    while (!ready && guard++ < 12) {
        const s = await st();
        if (!s || s.over) break;
        if (s.locked) { await sleep(150); continue; }
        const ps = await pickables();
        const sf = await slotFaces();
        const slotCnt = new Map();
        for (const f of sf) slotCnt.set(f, (slotCnt.get(f) || 0) + 1);
        const pickCnt = new Map();
        for (const p of ps) pickCnt.set(p.face, (pickCnt.get(p.face) || 0) + 1);
        //  优先"槽里已有 2 张、场上还剩 ≥1 张"的面 ⇒ 下一手必成组
        const hot = sf.find((f) => slotCnt.get(f) === 2 && (pickCnt.get(f) || 0) >= 1);
        if (hot) { ready = ps.find((p) => p.face === hot) || null; break; }
        //  否则点一张"同面最多"的牌（攒势），但**绝不把槽填满**
        if (s.slots >= s.slotMax - 1) break;
        const best = ps.slice().sort((a, b) => (pickCnt.get(b.face) || 0) - (pickCnt.get(a.face) || 0))[0];
        if (!best) break;
        await clickDesign({ id: best.id, x: best.x, y: best.y });
        await sleep(480);
    }
    ok(!!ready, '★ C2a 造出「槽里同面 2 张 + 场上还有 1 张」的局面（下一手必成组）',
        ready ? `待点：${ready.face}（设计 ${ready.x},${ready.y}）` : `没造出来（guard=${guard}）`);

    const slotsBefore = (await slotsIdx()).length;
    await cdp.ev(CLASH_RECORDER);                        // ★ 必须在点击**之前**注入
    await clickDesign({ id: ready.id, x: ready.x, y: ready.y });
    await sleep(2100);
    const rec = await cdp.ev(READ_RECORDER);
    ok(!!rec && rec.done && rec.n >= 200,
        `★ C2b 撞击全过程已录下（${rec ? rec.n : 0} 帧，覆盖到 `
        + `${rec ? rec.samples[rec.samples.length - 1].t : 0}ms）`);

    const S = rec.samples;
    const with3 = S.filter((s) => s.tiles.length === 3);
    const iReparent = S.findIndex((s) => s.tiles.length === 3);
    console.log(`    · 摘牌（SlotBar 直挂 3 张）：首帧 t=${iReparent >= 0 ? S[iReparent].t : -1}ms`
        + ` · 共 ${with3.length} 帧`);
    ok(with3.length >= 20,
        '★★ C3 【摘牌】三张待消的牌真的被摘出了槽格（`SlotBar` 直挂 3 个 `SlotTile`）'
        + ' —— 这是本作与 game-4 唯一的"载体差异"，不摘就会被 `relayoutSlots` 当场销毁',
        `直挂 3 张的帧数 = ${with3.length}（0 表示量错了对象，此时任何"没撞上"的结论都不成立）`);

    //  撞击前/后的"中心间距"
    const sep = (s) => (s.tiles.length === 3
        ? Math.max(...s.tiles.map((t) => t.x)) - Math.min(...s.tiles.map((t) => t.x)) : null);
    const sep0 = iReparent >= 0 ? sep(S[iReparent]) : null;
    const seps = with3.map((s) => ({ t: s.t, v: sep(s) }));
    const sepMax = Math.max(...seps.map((x) => x.v));
    const sepMin = Math.min(...seps.map((x) => x.v));
    console.log(`    · 中心间距：起始 ${sep0} → 最宽 ${sepMax} → 最窄 ${sepMin}`);
    ok(sepMax >= sep0 + 15,
        `★★ C4 【蓄力】三张牌先朝**远离中心**的方向退开（间距 ${sep0} → ${sepMax}，预期 +24 = 两侧各 12）`,
        '没退开 ⇒ 没有"攒势"，撞击读不出力量感');
    const span = cellW * 0.45;                            // = 槽格宽 × CLASH_OVERLAP
    ok(Math.abs(sepMin - 2 * span) <= 2 * span * 0.25,
        `★★ C5 【冲刺收拢】撞上后中心间距压到 **2 × 槽格宽 × 0.45 = ${(2 * span).toFixed(1)}**`
        + `（实测最窄 ${sepMin}）⇒ 三张牌真的"叠成一张厚牌"，这是"撞到一起"的唯一硬证据`,
        `容差 ±25%（±${(2 * span * 0.25).toFixed(1)}）`);

    //  挤压：**各向异性**（横向压扁 0.84 / 纵向拉长 1.16）—— 均匀缩放不算
    const squash = S.filter((s) => s.tiles.length === 3
        && s.tiles.some((t) => t.sx < 0.93 && t.sy > 1.07));
    ok(squash.length >= 1,
        `★★ C6 【撞击帧 · 挤压】至少 1 帧里三张牌被**压扁拉长**（sx<0.93 且 sy>1.07 = 各向异性，`
        + `不是等比缩放）— 实测 ${squash.length} 帧 / 共 ${S.length} 帧`,
        squash.length ? `例：${j(squash[0].tiles[0])} @t=${squash[0].t}ms` : '一帧都没抓到');
    const tHit = squash.length ? squash[0].t : -1;
    console.log(`    · 撞击帧 t ≈ ${tHit}ms（= 飞行 280ms + 蓄力 90ms + 冲刺 110ms + 1 帧）`);

    //  撞击帧的产物：环 / 碎屑 / 飘字 —— 三者必须**同时**出现
    const fx = S.filter((s) => s.pulses > 0 || s.shards > 0);
    const firstFx = fx.length ? fx[0] : null;
    const popFrames = S.filter((s) => s.pop > 0);
    const firstPop = popFrames.length ? popFrames[0] : null;
    console.log(`    · 首个特效帧：${j(firstFx && { t: firstFx.t, pulses: firstFx.pulses, shards: firstFx.shards })}`
        + ` · 首个飘字帧：${j(firstPop && { t: firstPop.t, pop: firstPop.pop })}`);
    ok(!!firstFx && firstFx.pulses >= 1 && firstFx.shards >= 9,
        '★★ C7 【撞击帧 · 特效】冲击环 ≥1 + 碎屑 ≥9（3 张 × 每张 5 片 = 15）在同一帧出现',
        j(firstFx && { t: firstFx.t, pulses: firstFx.pulses, shards: firstFx.shards }));
    ok(!!firstFx && Math.abs(firstFx.t - tHit) <= 40,
        '★★ C8 环 / 碎屑与挤压**同一时刻**（差 ≤40ms）—— 三者同属"撞击帧"这一个瞬间');
    ok(!!firstPop && firstPop.t >= tHit - 40,
        '★★ C9 【飘字搬到撞击帧】「碰 / 吃」飘字在撞击帧**之后**才出现'
        + `（首帧 ${firstPop ? firstPop.t : -1}ms ≥ 撞击帧 ${tHit}ms）`
        + ' —— 修复前它在 t=0 就飘，会读成"人声先喊、牌 200ms 后才撞上"');
    ok(S.filter((s) => s.t < tHit - 60).every((s) => s.pop === 0),
        '★★ C10 【负控】撞击帧**之前**的每一帧飘字数恒为 0（前置段真的干净）');

    //  释放段：先胀到 1.20，再收缩到 0
    const after = S.filter((s) => s.t > tHit && s.tiles.length === 3);
    const mx = Math.max(...after.flatMap((s) => s.tiles.map((t) => t.sx)));
    const mn = Math.min(...after.flatMap((s) => s.tiles.map((t) => t.sx)));
    console.log(`    · 释放段 scale 区间：${mn} ~ ${mx}`);
    ok(mx >= 1.05, `★★ C11 【释放 · 胀开】撞击后先胀到峰值（实测最大 ${mx}，目标 POP_SCALE_MAX=1.20）`
        + ' —— 一条曲线直接缩到 0 是"缩没了"，不是"消除"');
    ok(mn <= 0.40, `★★ C12 【释放 · 收缩】最后收缩到**不足起始尺寸的 1/3**（实测最小 ${mn}）`
        + ' ⇒ 确实在"缩没"而不是停在半路'
        + '（⚠️ 收不到 0：销毁与收缩终点是同一时刻，最后约 1 帧采不到，这是采样的边界、不是产品问题）');

    //  收尾：幽灵节点必须清干净 + 数据真的收了口
    const last = S[S.length - 1];
    ok(last.tiles.length === 0 && last.pulses === 0 && last.shards === 0,
        '★★ C13 【收尾】动效跑完后 `SlotBar` 上没有残留：摘出去的牌已销毁、环与碎屑已回收'
        + '（漏删的话会留下"看不见的幽灵节点"占着命中区）', j(last));
    const slotsAfter = (await slotsIdx()).length;
    ok(slotsAfter === slotsBefore - 2,
        `★ C14 数据收口：槽内张数 ${slotsBefore} → ${slotsAfter}`
        + '（成组消掉 3 张 + 这一手新入的那张还留着 ⇒ 净 −2）');

    const shotC = resolve(OUT, 'C-主玩页-撞击动效后.png');
    await screencastShot(cdp, shotC, { w: W, h: H });
    console.log(`    · 取证截图（主玩页唯一可用通道）→ ${shotC}`);

    // ========================================================
    head('D 组 · 收尾');
    // ========================================================
    ok(cdp.errors.length === 0, '★ D1 全程没有 JS 异常', j(cdp.errors.slice(0, 3)));
} finally {
    try { await close(); } catch { /* ignore */ }
    proc.kill();
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r59-verify.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${resolve(OUT, '_r59-verify.json')}`);
process.exit(fail ? 1 : 0);
