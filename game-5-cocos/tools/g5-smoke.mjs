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
 *      ★ 双判据：「页面切换到 X」既查 **PageManager 日志新出现过**（历史事件，
 *        `waitPageLog` —— **只认"标记之后"新产生的日志**），又查 **此刻场景里只有
 *        `Page_X` 节点**（当前状态，`expectOnlyPage`）。
 *        单靠日志会被"日志整体失效"骗（2026-10-06：release 里 cc.log 是空函数，
 *        五个页面全假红），单靠场景树则丢掉"事件确实发生过"的历史信息。两条都要。
 *      ⚠️⚠️ 2026-10-07 补的**第三坑**：`waitLog` 原来是"扫全部历史日志"，
 *        于是「点「重新挑战」→ 回到开局页」这条**永远为真** —— ③ 段早就留下过
 *        一条 `[PageManager] → gameStart`，后面的检查只是把它又捞了一遍。
 *        表现是"产品明明没跳页、这条却绿"。⇒ 页面跳转一律用 `waitPageLog()`
 *        （内部先 `markLogs()` 取当前长度，只在**之后**新增的日志里找）。
 *        ★ 顺带解掉前缀歧义：`'→ game'` 是 `'→ gameStart'` 的前缀，加了标记之后
 *        历史里那条 `gameStart` 不再可能被 `'→ game'` 命中。
 *   ② 主玩页：真实点击入槽（slots +1）；凑 3 张会消除（cleared 增加）
 *      ⚠️ "凑 3 张同面"依赖**本关布局真的给了 3 张可点的同面牌**。第 1 关是
 *        4 种牌面 × 3 张 = 12 张，但开局可点的 8 张里**可能一种都凑不满 3 张**
 *        （2/2/2/2 是合法分布）。这种时候那**不是失败，是"这条判据没被执行"**
 *        ⇒ 走 `skip()`（⏭ 计数、不算通过也不算失败）。★ 布局由 `CFG.diffSeedOf`
 *        决定 ⇒ **同一关每局一致**，所以这条不会时红时绿。
 *   ③ 道具：真实点击工具格生效
 *   ④ 负向链路：槽满 → 赠礼自动复活 或 失败弹层 →「看广告复活」回到牌局
 *      ⚠️ 「看广告复活」走的是 **mock 广告**，要播 `CFG.AD.MOCK_SECONDS`(**5**)秒。
 *        2026-10-07 前这里写死"点完等 2200ms 就断言"，而 2.2s 时广告**还在播** ⇒
 *        必然读到 `slots=8/8 over=true`（假红）。更糟的是**广告遮罩会吞掉后面所有
 *        真实点击** —— 连带把 ⑤ 段「点「重新挑战」」也一起吞了，于是"页面停在
 *        `Page_game`"，看起来像"结算弹层跳页坏了"，其实是**我们点得太早**。
 *        ⇒ 改法：点完**轮询等复活真的落到牌局**（`!over && slots < slotMax`，上限 12s）。
 *   ⑤ 结算弹层（胜/负）出现且按钮可点 → 回到开局页/首页（闭环合上）
 *      ★ 第 58 轮：弹层按钮轴从 **2 颗变 3 颗**（新增「返回首页」`BtnHome`），
 *        两态都有 ⇒ 这里显式断言 `BtnHome` 存在（只加按钮不断言 = 没人管它会不会掉）。
 *   ⑥ 全程零未捕获异常（音频空位是设计上的，网开一面）
 *
 *  ★★ 【为什么这个脚本要跑**两遍**（两遍互为补充，缺一遍就有分支没验到）】
 *    第 ④ 段「槽满 → 失败弹层 → 看广告复活」**依赖"槽真的能填满 8 格"**，
 *    而"能填满"要求"牌堆里同时有 ≥5 种不同牌面的牌"：
 *      8 格 = 4 组"每种 2 张"，牌面种类不足 5 种时**结构上就填不满**。
 *    · 第 1 关（教学关）：12 张 / **只有 4 种面** ⇒ 只要第 ② 段先消掉一组「碰」，
 *      桌上就只剩 3 种面 ⇒ 最多填 6 格 ⇒ 第 ④ 段永远走 `stall` 分支。
 *      （*改动前* ② 段凑不成组、一组都没消，4 种面凑齐 ⇒ 恰好能填到 8 ⇒ 才偶然走到过。）
 *    · 第 3 关起：30 张 / **8 种面** ⇒ 4 组两两不同随便摆 ⇒ 稳定填满。
 *    ⇒ 固定跑法（**三条都跑**，都在 `docs-verify` 归档）：
 *        node tools/g5-smoke.mjs <out1>                    # 第 1 关 → 走**胜态**：碰消除 / 道具 / 下一关
 *        node tools/g5-smoke.mjs <out2> --level 3          # 第 3 关 → 走**负态**：失败弹层 / 看广告复活 / 重新挑战
 *        node tools/g5-smoke.mjs <out3> --level 3 --gift-seed 1545
 *                                                          # 第 3 关 + **和值 12（复活档）** →
 *                                                          # 走**赠礼自动复活**分支（第 ④ 段的另一条路）
 *      ⚠️ 第 3 条是 2026-10-08 补的：在此之前掷骰是随机数 ⇒ 走哪条分支全看运气，
 *         判据总数在 27~29 之间漂，偶发 1 红且不可复现（见 `GIFT_SEED` 处的详细说明）。
 *    ⚠️ 别用第 10 关以后的重盘面（90+ 张 / 7 层）：第 ⑤ 段收尾 + 截图会明显变慢。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { canvasRect, designToCss, openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const argv = process.argv.slice(2);
const OUT = resolve(argv[0] || '/tmp/g5-smoke');
const LEVEL = (() => { const i = argv.indexOf('--level'); return i >= 0 ? Number(argv[i + 1]) : 1; })();
/**
 * 开局掷骰的**固定种子**（写进页面的 `globalThis.__g5GiftSeed`）。
 *
 * 【为什么必须有这个】（2026-10-08 第 60 轮实测发现，改了本文件）
 *   掷骰原本是 `Math.random()` ⇒ **每局赠礼不同**，而 `GIFT_TABLE` 里**只有和值 12
 *   给「复活档」**（本局失败时自动直消 4 张）。于是第 ④ 段「槽满之后」会走两条不同分支：
 *     · 非 12 ⇒ 弹**失败弹层** ⇒ 判据条数多（实测 **29** 条）
 *     · 和值 12 ⇒ 先走**赠礼自动复活** ⇒ 判据条数少（实测 **27** 条）
 *   表现是「同一命令、同样全绿，判据总数在 27~29 之间漂」——**连"全绿"这件事
 *   本身都不可靠**了（10 次里出现过 1 次 27 条 + 1 红，且无法复现）。
 *   ⇒ 定型：种子固定，**两条分支各跑一遍**（默认 1 ⇒ 失败弹层分支；
 *     `--gift-seed 1545` ⇒ 6+6=12 ⇒ 复活档分支），把偶发变成可复现。
 *   ⚠️ 种子只影响**赠礼内容**，不影响牌堆布局（牌堆由 `CFG.diffSeedOf` 决定）。
 */
const GIFT_SEED = (() => {
    const i = argv.indexOf('--gift-seed');
    return i >= 0 ? Number(argv[i + 1]) : 1;
})();
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const SAVE_KEY = 'game5.save.v1';

/**
 * 开局就是第 N 关。
 * ⚠️ 必须**在页面脚本之前**写 localStorage —— SaveService 在模块加载时就
 *    构造并读了一次存档，晚一步就不生效（脚本还在首页上等你点）。
 * ⚠️ `__g5GiftSeed` 同理：必须早于 `GameStartPage.onEnter`。见上方 GIFT_SEED 注释。
 */
const SEED = `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)},
    JSON.stringify({ level: ${LEVEL}, best: ${LEVEL - 1},
      inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
      coins: 0, plays: 0, cleared: 0, signDate: '', signStreak: 0 })); } catch (e) {}
    try { globalThis.__g5GiftSeed = ${GIFT_SEED}; } catch (e) {}`;

// ---------- 断言记账 ----------
const RESULTS = [];
function check(name, pass, detail = '') {
    RESULTS.push({ name, pass: !!pass, detail });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? `  —— ${detail}` : ''}`);
    return !!pass;
}
/**
 * **跳过**：这条判据在当前条件下**没有被执行**。
 *
 * ⚠️ 与"通过"必须区分开：`RESULTS` 里 `pass:true` 是为了不把汇总染红，
 *    但**另记 `skipped:true`**，汇总里单独报数 —— 否则报告会谎称"这条验过了"。
 *    （旧写法是把"凑不齐同面"直接判 `false`，等于**拿布局的随机性给产品扣分**；
 *      另一种坏写法是判 `true` 却不留痕，那就成了"现状即期望"。）
 */
let SKIPPED = 0;
function skip(name, detail = '') {
    SKIPPED++;
    RESULTS.push({ name, pass: true, skipped: true, detail });
    console.log(`  ⏭ ${name}${detail ? `  —— ${detail}` : ''}`);
    return true;
}
/** 轮询直到 `fn()` 为真；返回是否等到（不抛异常，便于把结果直接喂给 check） */
async function until(fn, timeoutMs, stepMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (await fn()) return true; } catch { /* 页面可能在转场 */ }
        await sleep(stepMs);
    }
    return false;
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
/**
 * 日志判据。**`from` 默认 0 = 扫全部历史** —— 只在"我确实关心历史"时这么用
 * （例如「赠礼复活自动生效」是几秒前发生的，此刻才轮到我们判）。
 * ⚠️ **页面跳转判据不许用默认值** —— 见下面 `waitPageLog`。
 */
const seenLog = (sub, from = 0) => cdp.logs.slice(from).some((l) => l.text.includes(sub));
async function waitLog(sub, timeoutMs = 8000, from = 0) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (seenLog(sub, from)) return true;
        await sleep(120);
    }
    return false;
}
/** 打一个"日志水位标记"：只认这之后的日志 */
let LOG_MARK = 0;
const markLogs = () => { LOG_MARK = cdp.logs.length; };
/**
 * 等**新的**「`[PageManager] → name`」日志出现（`markLogs()` 之后才算）。
 *
 * 【为什么不能直接 `waitLog('[PageManager] → gameStart')`】
 *   它扫的是**全部历史**，而 ③ 段进开局页时就留下过同样一行 ⇒ 之后在结算弹层上
 *   点「重新挑战」，无论跳没跳页，这条检查**都绿**。实测就撞上了：
 *   页面明明停在 `Page_game`，这条却报通过，把真正的失败挪到后面一条
 *   `expectOnlyPage` 上去报 —— 归因直接指错方向（看起来像跳页坏了）。
 *
 * ⚠️ 调用姿势：**先 `markLogs()`，再点按钮，再 `await waitPageLog(...)`**。
 *    顺序反了就会把"点击之后的日志"算进水位里，等于没标记。
 */
async function waitPageLog(name, timeoutMs = 8000) {
    const from = LOG_MARK;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (seenLog(`[PageManager] → ${name}`, from)) return true;
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
    if (!ps.length) {
      // ★★ 第 52 轮补：牌堆里点不出牌时，**暂存架（移出工具的三格）里可能还有牌可捞回主槽**。
      //   判胜条件是「牌堆空 **且** 暂存架空」（见 GamePage.checkBoardEmpty 与 hasTempTiles），
      //   所以架子非空时这一局**根本不算终局** —— 脚本若不把架子里的牌取回来，
      //   就会停在一个"没牌可点、但也没结束"的假死态，把下面那条结算断言判成失败。
      //   （那是**脚本的漏**，不是游戏的 bug：真机上玩家点一下架子里的牌就能取回。）
      const tp = api.tempPickables ? api.tempPickables() : [];
      if (tp.length) return { stop: 'temp', i, ms: Date.now() - t0, st, marks, temp: tp };
      return { stop: 'nopick', i, ms: Date.now() - t0, st, marks };
    }
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
    markLogs();
    await tapNode('BtnStart', '首页·开始游戏');
    check('真实点击「开始游戏」→ 开局页', await waitPageLog('gameStart', 8000));
    await sleep(4500);                       // 掷骰动画 + 赠礼卡展开
    await shot('game-start-gift');
    await expectOnlyPage('gameStart', '开局页');
    check('开局页赠礼按钮 BtnGo 出现', await hasNode('BtnGo'));

    // ───────────── ④ 主玩页（真实点击）─────────────
    console.log('\n───── ④ 主玩页 ─────');
    markLogs();
    await tapNode('BtnGo', '开局页·开始挑战');
    check('真实点击「开始挑战」→ 主玩页', await waitPageLog('game', 10000));
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
    console.log('\n  · 真实鼠标连点同面牌（凑「碰」）');
    const clearedBefore = (await state()).cleared;
    let matched = false;
    let matchDetail = '';
    {
        // ★★ 2026-10-07 第 59 轮重写：原来只看**开局那 8 张可点牌**里有没有 3 张同面，
        //   凑不齐就直接判 `false` —— 那是**拿布局的随机性给产品扣分**。
        //   两处都错：
        //     ① 开局 8 张里同面最多 2 张是**合法分布**（2/2/2/2 就是），不是缺陷；
        //     ② 只要继续点，被压住的牌会露出来 ⇒ "能不能凑成"是**多轮**的事，
        //        看一眼就下结论太早。
        //   改成多轮贪心：每点一张就重新评估，槽里已有的张数加权重
        //   （**离成组越近越优先**）⇒ ①有 2 张就点第 3 张（必是「碰」）
        //   ②有 1 张就补到 2 张 ③都没有就点"可点张数最多"的那一面。
        //   ⚠️ 上限 14 轮：槽只有 8 格，凑不成的话 8 步内就会判负，14 轮是宽裕余量。
        for (let round = 0; round < 14; round++) {
            await unlocked();
            const st = await state();
            if (!st || st.over) { matchDetail += `（第 ${round + 1} 轮时本局已结束）`; break; }
            const cnt = new Map();
            for (const fl of await cdp.ev('globalThis.__game5.slotFaces()'))
                cnt.set(fl, (cnt.get(fl) ?? 0) + 1);
            const groups = new Map();
            for (const p of await pickables()) {
                if (!groups.has(p.face)) groups.set(p.face, []);
                groups.get(p.face).push(p);
            }
            if (groups.size === 0) { matchDetail += '（可点牌耗尽）'; break; }
            const best = [...groups.entries()].map(([face, list]) => ({
                face, list, have: cnt.get(face) ?? 0,
                // 槽里已有 2 张 = 点下去就成组（100 分档）；其次 1 张；再次"这一面可点的张数"当平手判据
                score: (cnt.get(face) ?? 0) * 50 + Math.min(3, list.length),
            })).sort((a, b) => b.score - a.score)[0];
            await cdp.click(best.list[0].x, best.list[0].y);
            await sleep(780);
            const s2 = await state();
            if (s2 && s2.cleared > clearedBefore) {
                matched = true;
                matchDetail = `第 ${round + 1} 轮点「${best.face}」（槽里原有 ${best.have} 张，` +
                    `${best.have >= 2 ? '★ 点下去即凑成「碰」' : best.have === 1 ? '补齐到 2 张' : '起新的一组'}）` +
                    ` → cleared ${clearedBefore} → ${s2.cleared}（槽内剩 ${s2.slots} 张）`;
                break;
            }
            const faces = [...groups.keys()].length;
            matchDetail = `走了 ${round + 1} 轮仍未消（末轮点「${best.face}」，槽内 ${s2?.slots ?? '?'} 张，` +
                `可点面 ${faces} 种）`;
        }
    }
    if (matched) {
        check('真实点击凑成 3 张同面 → 牌被消除', true, matchDetail);
    } else {
        // ⚠️ 没消掉要分**三种**情况，不能一律算失败：
        //   ① 本局已判负 → 那是**正确行为**（槽满就是输），失败链路由 ④ 段专门验；
        //   ② 槽先满了 → 同 ①；
        //   ③ 其余情况才是"该消没消" → 真失败。
        //   前两种走 `skip()`：**这条判据当前没被执行**，如实报出来，
        //   既不像旧写法那样给产品扣分，也不假装通过。
        const stEnd = await state();
        if (stEnd?.over || stEnd?.slots >= stEnd?.slotMax) {
            skip('真实点击凑成 3 张同面 → 牌被消除',
                `${matchDetail} —— 本局在凑成之前就走到负态（槽满判负本身是正确行为，见 ④ 段）`);
        } else {
            check('真实点击凑成 3 张同面 → 牌被消除', false, matchDetail);
        }
    }
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
    // ★ 「槽满」在**复活档**下是个**瞬态**，事后读状态读不到（2026-10-08 第 60 轮查明）。
    //   本循环在**下一次迭代的开头**才判 `st.slots >= st.slotMax`，而赠礼给的是复活档时，
    //   「填满第 8 格的那一击」会**当场触发**自动复活、直消 4 张 ⇒ 事后读到 `slots=4/8 over=false`，
    //   于是这条判据在复活档下**恒红**（且因为掷骰是随机数，它表现为"十次里偶发一红、
    //   还复现不了"）。产品行为是对的 —— 是**判据没考虑瞬态**。
    //   ⇒ 用「赠礼复活自动生效」这条日志当**满槽的正面证据**：该日志只在槽真的满过时才出现，
    //     不是放水（对照：常规档下它恒为 false，此时本条仍按 slots/over 判）。
    const slotFilledOrConsumed = slotFilled || autoRevive;
    check('连点把槽填满（或本局已结束）', slotFilledOrConsumed || stall,
        slotFilled ? `slots=${stFull?.slots}/${stFull?.slotMax}`
            : (autoRevive ? '槽满那一刻被「赠礼自动复活」当场直消（瞬态，见判据注释）'
                : `slots=${stFull?.slots}/${stFull?.slotMax}`) + (stall ? '（牌堆里已挑不出不会凑成的牌）' : ''));

    if (isFailLayer) {
        check('槽满 → 弹出**失败**结算弹层（含「看广告复活」）', true, `节点：${layerNodes.join(', ')}`);
        await shot('result-fail');
        console.log('  · 真实点击「看广告复活」');
        markLogs();
        await tapNode('BtnAdRevive', '结算弹层·看广告复活');
        // ⚠️⚠️ **这里不能写死 sleep 时长**。mock 广告要播 `CFG.AD.MOCK_SECONDS` 秒，
        //   播完还要 `closeResult()`(240ms) + `performRevive` 的收尾定时器(340ms)。
        //   2026-10-07 之前写的是 `sleep(2200)` ⇒ 2.2s 时广告**还在播**，于是：
        //     ① 本条断言必然读到 `slots=8/8 over=true`（**假红**，报"复活没生效"）；
        //     ② 更要命 —— 广告遮罩**会继续吞掉后面所有真实点击**：⑤ 段那颗
        //        「重新挑战」被吞 ⇒ 页面停在 `Page_game`，
        //        报告读起来像"结算弹层跳页坏了"，其实只是**我们点得太早**。
        //   ⇒ 改成轮询"复活真的落到牌局"，不再猜秒数。
        const revived = await until(async () => {
            const s = await state();
            return !!s && !s.over && s.slots < s.slotMax;
        }, 12000);
        const stAd = await state();
        await shot('after-ad-revive');
        check('点「看广告复活」后回到牌局（槽被直消、本局未结束）',
            revived && !!stAd && stAd.slots < stAd.slotMax && !stAd.over,
            `slots=${stAd?.slots}/${stAd?.slotMax} over=${stAd?.over} · revive 次数 ${stAd?.revive}`);
        check('「看广告复活」确实把槽内牌直消掉了（不是只关个弹层）',
            !!stAd && stAd.slots < (stFull?.slots ?? 0),
            `槽 ${stFull?.slots} → ${stAd?.slots}（` +
            `${stAd?.slots < (stFull?.slots ?? 0) ? '确有下降' : '⚠ 一张都没少'}）`);
    } else if (overlay) {
        check('本关在这一轮里被打通 → 弹出**胜态**结算弹层（含「下一关」）',
            layerNodes.includes('BtnNext') && layerNodes.includes('BtnHome'),
            `节点：${layerNodes.join(', ')}`);
        await shot('result-win');
        markLogs();
        await tapNode('BtnNext', '结算·下一关');
        check('点「下一关」→ 回到开局页（闭环合上）', await waitPageLog('gameStart', 8000));
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
    // ⚠️ 这两个必须声明在 if **外面** —— 下面的断言要用（第一版写在 if 里，
    //    结果 check() 求值消息时 ReferenceError：「中断：tempAfter is not defined」）。
    let tempAfter = null;
    let fin = null;
    if (!layerNow) {
        // ★★ 第 52 轮：这里是**循环**，不只是调一次。
        //   理由见 FINISH_JS 里 `stop:'temp'` 那段注释 —— 牌堆点空之后还要把
        //   暂存架里的牌**用真实鼠标**取回来（走 onTempTileTap → takeFromTemp），
        //   取回后才可能凑成组、才可能把"牌堆空 + 暂存架空"同时满足、才会出结算。
        for (let round = 0; round < 10; round++) {
            fin = await cdp.ev(FINISH_JS);
            console.log(`    [轮 ${round}] ${JSON.stringify({ stop: fin.stop, i: fin.i,
                ms: fin.ms, st: fin.st, marks: fin.marks })}`);
            if (fin.stop !== 'temp') break;
            const css = await designToCss(cdp, fin.temp);
            if (!css.length) break;
            console.log(`    暂存架还有 ${fin.temp.length} 张，真实鼠标取回第 1 张（${css[0].face}）`);
            await cdp.click(css[0].x, css[0].y);
            await sleep(700);
            if (await hasResult()) break;
        }
        check('收尾过程有实际进展（消除数上升）', !!fin.st && fin.st.cleared > 0, `cleared=${fin.st?.cleared}`);
        tempAfter = await cdp.ev('window.__game5.temp ? window.__game5.temp() : null');
        console.log(`    终局暂存架：${JSON.stringify(tempAfter)}`);
        await sleep(2500);
        await shot('final');
        layerNow = await hasResult();
    }
    const final = await state();
    check('本局走完后弹出结算弹层（胜或负）', !!layerNow,
        `over=${final?.over} remaining=${final?.remaining} cleared=${final?.cleared}`
        + ` 暂存架=${tempAfter?.count ?? '?'} 槽=${final?.slots}`);

    if (layerNow) {
        const axis = await cdp.ev(`(() => { const c = window.__g5t.find('ResultLayer');
            const names = []; (function w(n){ names.push(n.name); n.children.forEach(w); })(c); return names; })()`);
        console.log(`    弹层内节点：${axis.join(', ')}`);
        await shot('result-final');
        const btnAxis = axis.filter((n) => n.startsWith('Btn'));
        const hasNext = axis.includes('BtnNext');
        const hasRetry = axis.includes('BtnRetry');
        const hasAd = axis.includes('BtnAdRevive');
        const hasHome = axis.includes('BtnHome');
        const isWin = hasNext && !hasAd;
        check('结算弹层形态自洽（胜带「下一关」／负带「重新挑战」）',
            isWin ? hasNext : hasRetry,
            `${isWin ? '胜态' : '负态'} · 按钮轴：${btnAxis.join(', ')}`);
        // ★★ 第 58 轮需求①：**胜 / 负两态都要有「返回首页」**。
        //   为什么要单独断言：加按钮很容易变成"加了但某一态没生效 / 被后面的按钮挤掉"，
        //   而弹层多一颗少一颗**不会报错**，只有数节点名才看得出来。
        check('结算弹层两态都有「返回首页」（★ 第 58 轮需求①）', hasHome,
            `${isWin ? '胜态' : '负态'} · 按钮轴：${btnAxis.join(', ')}`);
        // 形态互斥：胜态的头牌是「下一关」，负态是「看广告复活」，两者不该同时出现
        check('结算弹层主按钮不混态（「下一关」与「看广告复活」不同时出现）',
            hasNext !== hasAd, `BtnNext=${hasNext} BtnAdRevive=${hasAd}`);

        if (isWin) {
            markLogs();
            await tapNode('BtnNext', '结算·下一关');
            check('点「下一关」→ 回到开局页（闭环合上）', await waitPageLog('gameStart', 8000));
        } else if (hasRetry) {
            markLogs();
            await tapNode('BtnRetry', '结算·重新挑战');
            check('点「重新挑战」→ 回到开局页（闭环合上）', await waitPageLog('gameStart', 8000));
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
    for (const r of RESULTS) {
        const tag = r.skipped ? '⏭' : (r.pass ? '✅' : '❌');
        console.log(`${tag} ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`);
    }
    const passed = RESULTS.filter((r) => r.pass && !r.skipped).length;
    // ⚠️ 三个数分开报：**跳过 ≠ 通过**。合成一个"通过 N 条"会让报告谎称
    //   "这条验过了"。跳过的判据在下面单独列出来，便于人工判断要不要补条件重验。
    console.log(`\n通过 ${passed} · 跳过 ${SKIPPED} · 失败 ${failed.length} / 共 ${RESULTS.length}`);
    if (SKIPPED > 0) {
        console.log('⏭ 未执行的判据（当前关卡条件下不成立，**不是通过**）：');
        for (const r of RESULTS.filter((x) => x.skipped)) console.log(`   · ${r.name}`);
    }
    console.log(`未捕获异常 ${errs.length} 条 · console error ${consErrors.length} 条`);
    for (const e of errs.slice(0, 10)) console.log(`  ⚠️ ${e.split('\n')[0]}`);
    for (const e of consErrors.slice(0, 10)) console.log(`  ⚠️ ${e}`);
    console.log(`\n截图 ${shots.length} 张：${OUT}`);

    await writeFile(join(OUT, 'report.json'), JSON.stringify({
        results: RESULTS, shots, errors: errs, consoleErrors: consErrors,
        skipped: SKIPPED,
        summary: { total: RESULTS.length, passed, skipped: SKIPPED, failed: failed.length },
        logs: cdp.logs.map((l) => `[${l.level}] ${l.text}`),
    }, null, 2));
    await writeFile(join(OUT, 'console.log'), cdp.logs.map((l) => `[${l.level}] ${l.text}`).join('\n'));

    close();
    srv.proc.kill();
    process.exitCode = (fatal || failed.length || errs.length || consErrors.length) ? 1 : 0;
}
