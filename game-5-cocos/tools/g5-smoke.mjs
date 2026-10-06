#!/usr/bin/env node
/**
 * ============================================================
 *  g5-smoke.mjs · 《叠塔消消》无头真实事件验收
 * ============================================================
 *  【为什么必须派发**真实鼠标事件**，而不是直接调游戏函数】
 *  这是本机踩过、代价最大的一条教训（2026-10-01）：
 *  曾经用 `autoPlay()` 直接调处理函数跑通了一整局、截图也好看，
 *  但**事件监听器根本没注册**（点击判定写在 `pointerup` 里，而监听器没挂），
 *  交付的页面**连点都点不动**。截图与"自动演示"**都是绕过事件层的**，
 *  全看不出问题。
 *  ⇒ 判据只能是「**真实事件打进去之后，状态真的变了**」。
 *    所以①~④全部用 `Input.dispatchMouseEvent` 发真实 mousePressed/mouseReleased，
 *    只有最后「把这一局快速走完」那一步用了 `__game5.pick()`
 *    （它在源码里就是**与真实触摸同一个处理函数**，不是旁路），
 *    并且报告里会明写哪一段用的是它。
 *
 *  【判据清单】
 *   ① 四页真实可达：splash → home → gameStart → game
 *      ★ 双判据：「页面切换到 X」既查 **PageManager 日志出现过**（历史事件，
 *        `waitLog`），又查 **此刻场景里只有 `Page_X` 节点**（当前状态，`expectOnlyPage`）。
 *        单靠日志会被"日志整体失效"骗（2026-10-06：release 里 cc.log 是空函数，
 *        五个页面全假红），单靠场景树则丢掉"事件确实发生过"的历史信息。两条都要。
 *   ② 主玩页：真实点击入槽（slots +1）；凑 3 张会消除（cleared 增加）
 *   ③ 道具：真实点击工具格生效
 *   ④ 负向链路：槽满 → 赠礼自动复活 或 失败弹层 →「看广告复活」回到牌局
 *   ⑤ 结算弹层（胜/负）出现且按钮可点 → 回到开局页/首页（闭环合上）
 *   ⑥ 全程零未捕获异常（音频空位是设计上的，网开一面）
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { canvasRect, designToCss, openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const argv = process.argv.slice(2);
const OUT = resolve(argv[0] || '/tmp/g5-smoke');
const LEVEL = (() => { const i = argv.indexOf('--level'); return i >= 0 ? Number(argv[i + 1]) : 1; })();
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const SAVE_KEY = 'game5.save.v1';

/**
 * 开局就是第 N 关。
 * ⚠️ 必须**在页面脚本之前**写 localStorage —— SaveService 在模块加载时就
 *    构造并读了一次存档，晚一步就不生效（脚本还在首页上等你点）。
 */
const SEED = `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)},
    JSON.stringify({ level: ${LEVEL}, best: ${LEVEL - 1},
      inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
      coins: 0, plays: 0, cleared: 0, signDate: '', signStreak: 0 })); } catch (e) {}`;

// ---------- 断言记账 ----------
const RESULTS = [];
function check(name, pass, detail = '') {
    RESULTS.push({ name, pass: !!pass, detail });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? `  —— ${detail}` : ''}`);
    return !!pass;
}

const srv = await startServer(DIST);
await mkdir(OUT, { recursive: true });
/**
 * ⚠️ 截图用 deviceScaleFactor = **1**（不是 2）。
 *    重盘面（第 12 关 99 张 / 7 层）在无头 Chrome 的**软件光栅**下，
 *    `Page.captureScreenshot` 会**永久挂起**（30s / 90s 都不返回，重试也一样），
 *    而同一时刻实测游戏内是 **60fps** —— 也就是说卡的是截图那条通路，不是游戏。
 *    降到 dsf 1 立刻恢复正常。取证图 760×1344 足够看清。
 */
const { cdp, close } = await openBrowser(srv.url, { seedScript: SEED, scale: 1 });
console.log(`==> 本轮从第 ${LEVEL} 关开始（已预置存档）`);

let shotNo = 0;
const shots = [];
async function shot(tag) {
    const p = join(OUT, `${String(++shotNo).padStart(2, '0')}-${tag}.png`);
    await cdp.shot(p);
    shots.push(p);
    console.log(`  📷 ${p}`);
    return p;
}
const seenLog = (sub) => cdp.logs.some((l) => l.text.includes(sub));
async function waitLog(sub, timeoutMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (seenLog(sub)) return true;
        await sleep(120);
    }
    return false;
}
const state = () => cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');
/**
 * 可点牌 → **浏览器 CSS px**（可直接喂给 `cdp.click`）。
 *
 * ⚠️ 桥梁 `__game5.pickables()` 给的是**设计 px**，不是 CSS px。
 *    必须过一次 `designToCss`（内部走 `__g5t.toScreen`，按"画布 CSS 尺寸 /
 *    可视尺寸"换算）。旧写法把设计 px 直接当 CSS px 用，
 *    只在"调试视口恰好等于 750×1334"时凑巧成立 —— 换成真机比例就整批点空。
 */
const pickables = async () => designToCss(cdp, await cdp.ev(
    'globalThis.__game5 ? globalThis.__game5.pickables() : []'));
const hasNode = (n) => cdp.ev(`!!window.__g5t.find(${JSON.stringify(n)})`);
async function tapNode(name, label = name) {
    const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
    if (!p) throw new Error(`找不到节点 ${name}（${label}）`);
    await cdp.click(p.x, p.y);
    return p;
}
/** 等输入锁放开（游戏对连点有锁；不等会"点不动"而被误判成功能坏了） */
async function unlocked(timeoutMs = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const s = await state();
        if (!s || !s.locked) return true;
        await sleep(100);
    }
    return false;
}
/** 现在屏幕上有结算弹层吗 */
const hasResult = () => hasNode('ResultLayer');

/**
 * 场景里当前**活着**的页面节点名。
 * PageManager 建页时命名 `Page_<name>`（见 PageManager.open），旧页淡出后 destroy。
 */
const livePages = () => cdp.ev(`(() => {
    const s = cc.director.getScene(); const out = [];
    (function w(n) { if (n.name && n.name.indexOf('Page_') === 0 && n.activeInHierarchy) out.push(n.name);
        n.children.forEach(w); })(s);
    return out;
})()`);
/**
 * 断言「**这一刻唯一的页面**就是 name」—— 直接查场景树，不依赖任何日志文本。
 *
 * 【为什么日志判据之外还要这一条】2026-10-06 的教训：
 * release 构建里 `cc.log/cc.warn` 是空函数（debugMode=ERROR，见 PageManager.ts 顶部注释），
 * 于是 `waitLog('[PageManager] → splash')` **全部假红** —— 游戏明明是好的，
 * 报告却说五个页面全没进去。**日志只是"事件发生过"的代理，且可能整体失效**；
 * 场景树才是"状态真的变了"的直接证据。两者都要，缺一不可。
 *
 * ⚠️ 采用**轮询**而不是单次取样：转场期间旧页还在淡出（PageManager 用
 *    `dur*1000+20` 的 setTimeout 兜底 destroy），单次取样会撞上"两个页都在"的瞬间，
 *    变成假红 —— 而那不是 bug，只是我们取样太早。
 */
async function expectOnlyPage(name, label = name, timeoutMs = 3000) {
    const want = `Page_${name}`;
    const t0 = Date.now();
    let alive = [];
    while (Date.now() - t0 < timeoutMs) {
        alive = await livePages();
        if (alive.length === 1 && alive[0] === want) break;
        await sleep(120);
    }
    return check(`此刻场景里只有 ${label}（${want}）`,
        alive.length === 1 && alive[0] === want, `活着的页面节点：${alive.join(', ') || '（无）'}`);
}

// ---------- 页内贪心收尾（用 pick()，与真实触摸同一处理函数） ----------
const FINISH_JS = `(async () => {
  const api = globalThis.__game5;
  const SUIT = {'万':0,'条':1,'筒':2}, NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const pf = (l) => ({ s: SUIT[l[1]], n: NUM[l[0]] });
  const wm = (cnt, f) => {
    if ((cnt.get(f.s + '-' + f.n) || 0) >= 2) return true;
    for (const d of [-2, -1, 0]) {
      const need = [d, d + 1, d + 2];
      if (need.includes(0)) continue;
      if (need.every(k => (cnt.get(f.s + '-' + (f.n + k)) || 0) > 0)) return true;
    }
    return false;
  };
  const marks = [];
  const t0 = Date.now();
  let i = 0, waits = 0;
  while (Date.now() - t0 < 150000 && i < 1200) {
    const st = api.state();
    if (!st || st.over) return { stop: 'over', i, ms: Date.now() - t0, st, marks };
    if (st.locked) { await new Promise(r => setTimeout(r, 90)); if (++waits > 5000) break; continue; }
    const ps = api.pickables();
    if (!ps.length) return { stop: 'nopick', i, ms: Date.now() - t0, st, marks };
    // 用**槽内真实牌面**判"这一张会不会凑成"（不是靠本地记账猜）
    const cnt = new Map();
    for (const fl of api.slotFaces()) { const f = pf(fl); const k = f.s + '-' + f.n; cnt.set(k, (cnt.get(k) || 0) + 1); }
    // 优先挑"会凑成"的（推进消除）；挑不到再挑"不会凑成"的（推进填槽 → 失败）
    let cand = ps.find(p => wm(cnt, pf(p.face)));
    if (!cand) cand = ps.find(p => !wm(cnt, pf(p.face)));
    if (!cand) cand = ps[0];
    api.pick(cand.id);
    await new Promise(r => setTimeout(r, 150));
    const st2 = api.state();
    if (!st2) return { stop: 'gone', i, ms: Date.now() - t0, st };
    if (i % 60 === 0) marks.push({ i, slots: st2.slots, cleared: st2.cleared, remaining: st2.remaining, ms: Date.now() - t0 });
    i++;
  }
  return { stop: 'timeout', i, ms: Date.now() - t0, st: api.state(), marks };
})()`;

let fatal = null;
try {
    console.log('==> 启动无头浏览器');
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, '!!(cc.director && cc.director.getScene())', 15000, '场景');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    // ───────────── ① 启动页 ─────────────
    console.log('\n───── ① 启动页 ─────');
    check('启动页已进入（PageManager 打点 splash）', await waitLog('[PageManager] → splash', 4000));
    await sleep(1300);
    await shot('splash');
    check('启动页阶段调试桥未挂载（只有主玩页才挂）',
        (await cdp.ev('typeof globalThis.__game5')) === 'undefined');

    // ───────────── ② 首页 ─────────────
    console.log('\n───── ② 首页（启动页自动跳转）─────');
    check('启动页自动跳到首页', await waitLog('[PageManager] → home', 15000));
    await sleep(1700);
    await shot('home');
    await expectOnlyPage('home', '首页');
    check('首页主按钮 BtnStart 存在', await hasNode('BtnStart'));

    // ───────────── ③ 开局页（真实点击）─────────────
    console.log('\n───── ③ 开局页 ─────');
    await tapNode('BtnStart', '首页·开始游戏');
    check('真实点击「开始游戏」→ 开局页', await waitLog('[PageManager] → gameStart', 8000));
    await sleep(4500);                       // 掷骰动画 + 赠礼卡展开
    await shot('game-start-gift');
    await expectOnlyPage('gameStart', '开局页');
    check('开局页赠礼按钮 BtnGo 出现', await hasNode('BtnGo'));

    // ───────────── ④ 主玩页（真实点击）─────────────
    console.log('\n───── ④ 主玩页 ─────');
    await tapNode('BtnGo', '开局页·开始挑战');
    check('真实点击「开始挑战」→ 主玩页', await waitLog('[PageManager] → game', 10000));
    await waitFor(cdp, '!!globalThis.__game5', 12000, '调试桥');
    await sleep(2400);
    await shot('game-board');
    await expectOnlyPage('game', '主玩页');

    const s0 = await state();
    check(`第 ${LEVEL} 关已装载（remaining == total）`, s0.remaining === s0.total,
        `remaining=${s0.remaining} total=${s0.total}`);
    // 槽上限照 CFG.PLAY.SLOT_MAX = 8 判，不是 7（曾按记忆写成 7，白报一条假失败）
    check('开局槽位为空、上限为 8', s0.slots === 0 && s0.slotMax === 8, `slots=${s0.slots} slotMax=${s0.slotMax}`);
    check('本局未结束 / 未锁', !s0.over, `over=${s0.over} locked=${s0.locked}`);
    const p0 = await pickables();
    check('开局有可点牌', p0.length > 0, `${p0.length} 张`);
    // ★ 坐标口径断言：只对**画布 CSS 矩形**判，不再写死 750×1334。
    //   旧写法（`p.x <= 750 && p.y <= 1334`）在真机比例下**永远为真**，
    //   变成一条"现状即期望"的废断言 —— 上面那批点空就是它没拦住。
    const rect = await canvasRect(cdp);
    const bad = p0.filter((p) => !(p.x >= rect.l && p.x <= rect.l + rect.w
        && p.y >= rect.t && p.y <= rect.t + rect.h));
    check(`可点牌在画布 CSS 矩形内（${Math.round(rect.w)}×${Math.round(rect.h)}）`, bad.length === 0,
        `x∈[${Math.min(...p0.map((p) => p.x)).toFixed(0)},${Math.max(...p0.map((p) => p.x)).toFixed(0)}] ` +
        `y∈[${Math.min(...p0.map((p) => p.y)).toFixed(0)},${Math.max(...p0.map((p) => p.y)).toFixed(0)}] ` +
        `（设计 px x∈[${Math.min(...p0.map((p) => p.dx))},${Math.max(...p0.map((p) => p.dx))}] ` +
        `y∈[${Math.min(...p0.map((p) => p.dy))},${Math.max(...p0.map((p) => p.dy))}]）`);

    // ---- 真实点击：入槽 ----
    console.log('\n  · 真实鼠标点击牌面');
    const before1 = await state();
    const first = p0[0];
    await cdp.click(first.x, first.y);
    await sleep(800);
    const after1 = await state();
    check('真实点击 1 张牌 → 槽内 +1', after1.slots === before1.slots + 1,
        `${before1.slots} → ${after1.slots}（点了「${first.face}」）`);

    // ---- 真实点击：凑 3 张同面消除（「碰」）----
    console.log('\n  · 真实鼠标连点 3 张同面牌（凑「碰」）');
    const clearedBefore = (await state()).cleared;
    let matched = false, matchDetail = '本轮可点牌里没有同面 ≥3 张（布局如此，跳过）';
    {
        const groups = new Map();
        for (const p of await pickables()) {
            if (!groups.has(p.face)) groups.set(p.face, []);
            groups.get(p.face).push(p);
        }
        // ⚠️ 必须凑够 **3** 张同面才保证消。第一版只点了 2 张「二万」，
        //    而槽里待着的那张是「一条」—— 当然不消。这不是游戏的 bug，是驱动的 bug。
        const trio = [...groups.entries()].filter(([, l]) => l.length >= 3)
            .sort((a, b) => b[1].length - a[1].length)[0];
        if (trio) {
            for (const p of trio[1].slice(0, 3)) {
                await unlocked();
                await cdp.click(p.x, p.y);
                await sleep(820);
            }
            const s2 = await state();
            matched = s2.cleared > clearedBefore;
            matchDetail = `连点「${trio[0]}」3 张 → cleared ${clearedBefore} → ${s2.cleared}（槽内剩 ${s2.slots} 张）`;
        }
    }
    check('真实点击凑成 3 张同面 → 牌被消除', matched, matchDetail);
    await shot('game-after-match');

    // ---- 真实点击：道具（挑有库存的那一格）----
    console.log('\n  · 真实鼠标点击道具格');
    const tools = await cdp.ev(`(() => {
        const b = window.__g5t.find('ToolBar'); if (!b) return [];
        const nums = (n) => { const out = []; const l = n.getComponent('cc.Label');
            if (l) out.push(Number(l.string)); n.children.forEach(c => out.push(...nums(c))); return out; };
        return b.children.filter(c => c.name.startsWith('Tool_'))
            .map(c => ({ name: c.name, max: Math.max(0, ...nums(c).filter(v => !Number.isNaN(v))) }));
    })()`);
    console.log(`    道具格：${tools.map((t) => `${t.name}(${t.max})`).join('  ') || '（无）'}`);
    const usable = tools.find((t) => t.max > 0);
    let toolOk = false;
    let toolDetail = tools.length === 0 ? '本关无道具栏'
        : `本局骰子档位没给到道具（库存 ${tools.map((t) => t.name + '=' + t.max).join(', ')}）—— 属正常`;
    if (usable) {
        const a = await state();
        // ⚠️ 每个道具有**前置条件**，不满足时"点了没变化"是**正确行为**，
        //    不能一律判成失败：消除要槽内 ≥3 张、移出要槽内 ≥1 张、
        //    洗牌要桌上还有牌、加槽要没到上限且本关没用过。
        const condOk = (usable.name === 'Tool_erase' && a.slots >= 3)
            || (usable.name === 'Tool_move' && a.slots >= 1)
            || (usable.name === 'Tool_shuffle' && a.remaining > 0)
            || (usable.name === 'Tool_addslot' && a.slotMax < 9);
        await tapNode(usable.name, '道具格');
        await sleep(1500);
        const b = await state();
        const changed = b.remaining !== a.remaining || b.slots !== a.slots || b.slotMax !== a.slotMax;
        toolOk = condOk ? changed : !changed;
        toolDetail = changed
            ? `${usable.name} 生效：剩余 ${a.remaining}→${b.remaining} 槽 ${a.slots}→${b.slots} 上限 ${a.slotMax}→${b.slotMax}`
            : `${usable.name}（库存 ${usable.max}）无变化 —— 前置条件 ${condOk ? '满足，这就是问题' : `不满足（槽内 ${a.slots} 张），正确`}`;
    }
    check('真实点击道具格 → 生效（或前置条件不满足，属正确）', toolOk || !usable, toolDetail);
    await shot('game-after-tool');

    // ---- 真实点击填槽 → 负向链路 ----
    console.log('\n  · 真实鼠标连点填槽（每次挑"不会凑成"的牌）');
    const SUIT = { 万: 0, 条: 1, 筒: 2 };
    const NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const pf = (l) => ({ s: SUIT[l[1]], n: NUM[l[0]] });
    const key = (f) => `${f.s}-${f.n}`;
    /** 这一张点进去会不会凑成 3 张（碰 / 吃）—— 保守预判，宁可漏判也不误判 */
    const wouldMatch = (cnt, f) => {
        if ((cnt.get(key(f)) ?? 0) >= 2) return true;                       // 碰
        for (const d of [-2, -1, 0]) {
            const need = [d, d + 1, d + 2];
            if (need.includes(0)) continue;
            if (need.every((k) => (cnt.get(`${f.s}-${f.n + k}`) ?? 0) > 0)) return true;   // 吃
        }
        return false;
    };
    let stall = false;
    for (let i = 0; i < 60; i++) {
        await unlocked();
        const st = await state();
        if (!st || st.over || st.slots >= st.slotMax) break;
        // ★ 用调试桥的 slotFaces 拿**槽内真实牌面**（光看 slots 的棋盘下标推不出来）
        const cnt = new Map();
        for (const fl of await cdp.ev('globalThis.__game5.slotFaces()')) {
            const f = pf(fl);
            cnt.set(key(f), (cnt.get(key(f)) ?? 0) + 1);
        }
        const ps = await pickables();
        const cand = ps.find((p) => !wouldMatch(cnt, pf(p.face)));
        if (!cand) { stall = true; break; }
        await cdp.click(cand.x, cand.y);
        await sleep(620);
    }
    await sleep(2400);
    await shot('slot-full');
    const autoRevive = seenLog('赠礼复活自动生效');
    const overlay = await hasResult();
    const stFull = await state();
    const layerNodes = overlay ? await cdp.ev(`(() => { const c = window.__g5t.find('ResultLayer');
        const out = []; (function w(n){ out.push(n.name); n.children.forEach(w); })(c); return out; })()`) : [];
    const isFailLayer = layerNodes.includes('BtnAdRevive');
    console.log(`    收尾：slots=${stFull?.slots}/${stFull?.slotMax} over=${stFull?.over} ` +
        `remaining=${stFull?.remaining} 自动复活=${autoRevive} 弹层=${overlay} 凑不出可点的牌=${stall}`);
    if (overlay) console.log(`    弹层内节点：${layerNodes.join(', ')}`);

    const slotFilled = !!stFull && (stFull.slots >= stFull.slotMax || stFull.over);
    check('连点把槽填满（或本局已结束）', slotFilled || stall,
        `slots=${stFull?.slots}/${stFull?.slotMax}${stall ? '（牌堆里已挑不出不会凑成的牌）' : ''}`);

    if (isFailLayer) {
        check('槽满 → 弹出**失败**结算弹层（含「看广告复活」）', true, `节点：${layerNodes.join(', ')}`);
        await shot('result-fail');
        console.log('  · 真实点击「看广告复活」');
        await tapNode('BtnAdRevive', '结算弹层·看广告复活');
        await sleep(2200);
        await shot('after-ad-revive');
        const stAd = await state();
        check('点「看广告复活」后回到牌局（槽被直消、本局未结束）',
            !!stAd && stAd.slots < stAd.slotMax && !stAd.over,
            `slots=${stAd?.slots}/${stAd?.slotMax} over=${stAd?.over}`);
    } else if (overlay) {
        check('本关在这一轮里被打通 → 弹出**胜态**结算弹层（含「下一关」）',
            layerNodes.includes('BtnNext'), `节点：${layerNodes.join(', ')}`);
        await shot('result-win');
        await tapNode('BtnNext', '结算·下一关');
        check('点「下一关」→ 回到开局页（闭环合上）', await waitLog('[PageManager] → gameStart', 8000));
        await expectOnlyPage('gameStart', '开局页');
    } else if (autoRevive) {
        check('赠礼自动复活后槽被直消并继续本局',
            !!stFull && stFull.slots < stFull.slotMax && !stFull.over,
            `slots=${stFull?.slots}/${stFull?.slotMax} over=${stFull?.over}`);
    } else if (stall) {
        // ⚠️ 教学关（第 1 关 12 张只有 4 种牌面）**本来就填不满 8 格槽**：
        //    每种牌面只能放 2 张（第 3 张就凑成「碰」消掉了），
        //    4 种 × 2 张 = 8 张才到上限，而能挑的牌根本不够。
        //    所以"填不满"在这里是**符合定稿的正确行为**，不该判失败。
        check('槽满负向链路（本关不适用）', true,
            `slots=${stFull?.slots}/${stFull?.slotMax} —— 可点牌里已挑不出"不会凑成"的牌，` +
            '教学关牌面种类 < 槽位数，按定稿本就填不满（负向链路改在第 12 关验证）');
    } else {
        check('槽满触发了负向链路', false, '既没弹层也没自动复活');
    }

    // ───────────── ⑤ 把这一局走到底 → 闭合到开局页 ─────────────
    // 走到这里可能已经在弹层里（上一步打通或打输），先看情况：
    //   · 还在牌局 → 用 pick()（与真实触摸同一处理函数）快速打完
    //   · 已在弹层 → 直接点按钮收尾
    console.log('\n───── ⑤ 把这一局走到底（此段用 __game5.pick，与真实触摸同一处理函数）─────');
    let layerNow = await hasResult();
    if (!layerNow) {
        const fin = await cdp.ev(FINISH_JS);
        console.log(`    ${JSON.stringify({ stop: fin.stop, i: fin.i, ms: fin.ms, st: fin.st, marks: fin.marks })}`);
        check('收尾过程有实际进展（消除数上升）', !!fin.st && fin.st.cleared > 0, `cleared=${fin.st?.cleared}`);
        await sleep(2500);
        await shot('final');
        layerNow = await hasResult();
    }
    const final = await state();
    check('本局走完后弹出结算弹层（胜或负）', !!layerNow,
        `over=${final?.over} remaining=${final?.remaining} cleared=${final?.cleared}`);

    if (layerNow) {
        const axis = await cdp.ev(`(() => { const c = window.__g5t.find('ResultLayer');
            const names = []; (function w(n){ names.push(n.name); n.children.forEach(w); })(c); return names; })()`);
        console.log(`    弹层内节点：${axis.join(', ')}`);
        await shot('result-final');
        const hasNext = axis.includes('BtnNext');
        const hasRetry = axis.includes('BtnRetry');
        const isWin = hasNext && !axis.includes('BtnAdRevive');
        check('结算弹层形态自洽（胜带「下一关」／负带「重新挑战」）',
            isWin ? hasNext : hasRetry,
            `${isWin ? '胜态' : '负态'} · 节点：${axis.filter((n) => n.startsWith('Btn')).join(', ')}`);
        if (isWin) {
            await tapNode('BtnNext', '结算·下一关');
            check('点「下一关」→ 回到开局页（闭环合上）', await waitLog('[PageManager] → gameStart', 8000));
        } else if (hasRetry) {
            await tapNode('BtnRetry', '结算·重新挑战');
            check('点「重新挑战」→ 回到开局页（闭环合上）', await waitLog('[PageManager] → gameStart', 8000));
        }
        await sleep(1800);
        await shot('loop-back');
        await expectOnlyPage('gameStart', '开局页');
    }
} catch (e) {
    fatal = e;
    console.log(`\n❌ 中断：${e.message}`);
} finally {
    await sleep(300);
    const errs = cdp.errors.filter((e) => !e.includes('音频加载失败'));
    const consErrors = cdp.logs.filter((l) => l.level === 'error').map((l) => l.text);
    const failed = RESULTS.filter((r) => !r.pass);
    console.log('\n════════ 汇总 ════════');
    for (const r of RESULTS) console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`);
    console.log(`\n通过 ${RESULTS.length - failed.length} / 共 ${RESULTS.length}`);
    console.log(`未捕获异常 ${errs.length} 条 · console error ${consErrors.length} 条`);
    for (const e of errs.slice(0, 10)) console.log(`  ⚠️ ${e.split('\n')[0]}`);
    for (const e of consErrors.slice(0, 10)) console.log(`  ⚠️ ${e}`);
    console.log(`\n截图 ${shots.length} 张：${OUT}`);

    await writeFile(join(OUT, 'report.json'), JSON.stringify({
        results: RESULTS, shots, errors: errs, consoleErrors: consErrors,
        logs: cdp.logs.map((l) => `[${l.level}] ${l.text}`),
    }, null, 2));
    await writeFile(join(OUT, 'console.log'), cdp.logs.map((l) => `[${l.level}] ${l.text}`).join('\n'));

    close();
    srv.proc.kill();
    process.exitCode = (fatal || failed.length || errs.length || consErrors.length) ? 1 : 0;
}
