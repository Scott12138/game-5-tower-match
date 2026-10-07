#!/usr/bin/env node
/**
 * ============================================================
 *  _r53-verify.mjs · 第 53 轮 · 浏览器「真实鼠标 + 负控」自证
 * ============================================================
 *  被验范围（用户拍板的批次 2：T06~T10 + T17 最小版）：
 *    T06 广告（复活）  T07 广告（换道具）+ 去奖励化分享
 *    T08 广告失败降级  T09 分享接入（合规形态）  T10 wx.login
 *    T17 开放数据域好友榜（主域接线）
 *
 *  ── 与 `_r53-core-check.mjs` 的分工（**别重复、也别互相替代**）──
 *    · 离线那份跑的是**服务内部**（三种结局、监听器只挂一次、云存储值格式…），
 *      用注入 fake wx 做确定性复现；
 *    · 本文件跑的是**页面接线 + 真实事件层**：真的用鼠标点那颗按钮、
 *      真的把面板走完、真的看结算弹层关没关。
 *    第 51 轮的教训是"截图 + 直接调函数"**全都绕过事件层**，
 *    所以凡"点了没反应"这类问题离线那份永远看不见 —— 本文件就是补这一块。
 *
 *  ── 判据口径（读断言前先读这段）────────────────────────────
 *  1. **每条"不发奖"都必须有配对的"会发"**：先证明 `end` 真的复活了，
 *     `abort` / `fail` 的"没变化"才是结论；否则整条链路根本没通也会全绿。
 *  2. **`_paused` 必须两个方向都测**：面板期间为 true（真的接管了输入）、
 *     结算后为 false（否则 = 整页卡死）。只测一边都会漏掉真 bug。
 *  3. **浏览器无 wx ⇒ 广告走替身面板**。替身**不是**"假装有广告"：
 *     它必须在界面**如实**标「演示用」。所以`①`里既断言它出现，
 *     也断言那句文案在。
 *  4. **真分支（`real`）必须走一遍**，靠 `__game5.adConfig()` 运行期翻开关
 *     + 运行期注入 fake `wx.createRewardedVideoAd`。
 *     真分支的特征是**没有面板**（`adPanelOpen === false`）却有 `adBusy === true` ——
 *     这条用来区分"真广告"和"替身"，否则两条路在断言上长得一样。
 *  5. **"分享不给奖励"要双保险**：静态（离线那份 B20~B22 断言代码里没有发奖能力）
 *     + 动态（本文件断言点完之后 `inventory()` / 金币**逐字段未变**）。
 *  6. ★ **fake wx 分两种注入方式，别混**：
 *     · **文档开始注入**（只有 login + 四个生命周期钩子）—— 用来验"登录失败不阻塞首屏"，
 *       必须赶在 `GameRoot.onLoad` 之前；这个形状是 `_r52-verify.mjs` 验证过安全的。
 *     · **运行期注入**（含 share / rank / ad）—— 用来验分享与排行榜的真分支。
 *       运行期注入不会干扰引擎的平台嗅探（引擎早已按"浏览器"初始化完毕）。
 *
 *  【用法】node tools/_r53-verify.mjs      # 全绿则 exit 0
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-verify');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 1;
/** 关卡取 3：`PLAY.FREE_TIME_LEVELS = 2` ⇒ 第 3 关起才有倒计时（本文件不依赖，但保持一致基线） */
const LEVEL = Number(process.env.G5_LEVEL || 3);

// ------------------------------------------------------------
//  ①  文档开始注入：**极简** wx（只有 login 与四个生命周期钩子）
// ------------------------------------------------------------
//  ⚠️ 故意**不**提供 `getSystemInfoSync` / `getOpenDataContext` / `setUserCloudStorage`：
//     引擎的平台嗅探一旦嗅到"这是微信"，会去找一大堆本 fake 没有的 API。
//     这里只需要 `wx.login` 存在、且它的 `fail` 回调会被调用。
const LOGIN_FAIL_WX = [
    '(function () {',
    '  globalThis.__r53login = { calls: 0 };',
    '  globalThis.wx = {',
    '    login: function (o) { globalThis.__r53login.calls++; setTimeout(function () { o.fail({ errMsg: "r53 mock login fail" }); }, 10); },',
    '    onHide: function () {}, onShow: function () {},',
    '    offHide: function () {}, offShow: function () {},',
    '  };',
    '})();',
].join('\n');

/**
 * ② 运行期注入：全量 fake wx（分享 / 排行榜 / 广告）。
 *
 * ⚠️ 这段是在**页面已经跑起来之后**用 `Runtime.evaluate` 执行的
 *   （不是文档开始注入），所以引擎的平台嗅探早就按"浏览器"定完型了，
 *   补一个 wx 只会被我们四个服务读到 —— 这正是我们要的**最小干扰**。
 */
const RUNTIME_WX = `
(function () {
  var S = globalThis.__r53 = {
    create: 0, show: 0, load: 0, onClose: 0, onError: 0,
    kv: [], posted: [], shares: [], shareCb: null,
    adMode: 'ok', opt: null, _closeCb: null, _errCb: null,
  };
  globalThis.__r53Ad = {
    show: function () {
      S.show++;
      if (S.adMode === 'showFail') return Promise.reject(new Error('r53 show fail'));
      return Promise.resolve();
    },
    load: function () { S.load++; return Promise.resolve(); },
    onClose: function (cb) { S.onClose++; S._closeCb = cb; },
    onError: function (cb) { S.onError++; S._errCb = cb; },
  };
  globalThis.wx = {
    createRewardedVideoAd: function (opt) { S.create++; S.opt = opt; return globalThis.__r53Ad; },
    showShareMenu: function () { S.showShareMenu = (S.showShareMenu || 0) + 1; },
    onShareAppMessage: function (cb) { S.shareCb = cb; },
    shareAppMessage: function (opt) { S.shares.push(opt); },
    setUserCloudStorage: function (opt) { S.kv.push(opt); },
    getOpenDataContext: function () { return { postMessage: function (m) { S.posted.push(m); } }; },
    getLaunchOptionsSync: function () { return { query: { shareLevel: '4' } }; },
  };
  return true;
})()`;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(LEVEL), width: W, height: H, scale: SCALE,
});

let pass = 0, fail = 0;
const rows = [];
function assert(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✓ ${name}${detail ? '   ' + detail : ''}`); }
    else { fail++; console.log(`  ✗ ${name}   ${detail}`); }
    rows.push({ name, ok: !!ok, detail });
}
function head(t) { console.log(`\n=== ${t} ===`); }

// ------------------------------------------------------------
//  小工具
// ------------------------------------------------------------

async function exists(name) {
    return await cdp.ev('!!window.__g5t.find(' + JSON.stringify(name) + ')');
}
async function tap(name) {
    try { await tapNode(cdp, name); return true; } catch { return false; }
}
async function gameState() {
    return await cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');
}
async function platform() {
    return await cdp.ev('globalThis.__game5 ? globalThis.__game5.platform() : null');
}
async function inventory() {
    return await cdp.ev('globalThis.__game5 ? globalThis.__game5.inventory() : null');
}
/** 场景里**所有可见 Label 的字**（合规文案断言用；emoji/星号都不用，纯文本比对） */
async function sceneTexts() {
    return await cdp.ev(`(function () {
        var out = [];
        var s = cc.director.getScene();
        (function walk(n) {
            if (n.activeInHierarchy) {
                var l = n.getComponent && n.getComponent('cc.Label');
                if (l && typeof l.string === 'string' && l.string) out.push(l.string);
            }
            for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
        })(s);
        return out;
    })()`);
}
/** 轮询等待某段文案出现在场景里（toast 存活时间短，掐着点读会**假红**） */
async function waitText(sub, timeoutMs = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await sceneTexts()).some((t) => t.includes(sub))) return true;
        await sleep(120);
    }
    return false;
}
async function reloadWait() {
    await cdp.send('Page.reload', {});
    cdp.logs.length = 0;
    cdp.errors.length = 0;
    await sleep(2600);
}

/**
 * 往槽里放 n 张**牌面互不相同**的牌。
 *
 * ⚠️ 为什么必须是"互不相同"：`MATCH_SIZE = 3`，槽里只要出现 3 张同面就会**立刻消掉**，
 *    于是"槽里有几张"这条前置条件就没了（第一版随手取前 2 张，恰好同面 + 后面又补一张，
 *    中途被消掉 ⇒ 复活直消 0 张 ⇒ `cleared` 没变化，看起来像"复活没生效"）。
 *    取不同面 ⇒ 永远凑不出 3 张 ⇒ 槽内容稳定可控。
 */
async function fillSlots(n) {
    for (let guard = 0; guard < 8; guard++) {
        const st = await gameState();
        if (!st || st.slots >= n) return st ? st.slots : -1;
        const have = await cdp.ev('__game5.slotFaces()');
        const pks = await cdp.ev('__game5.pickables()');
        const cand = pks.find((p) => !have.includes(p.face));
        if (!cand) return (await gameState()).slots;
        await cdp.ev(`(function () { __game5.pick(${cand.id}); return true; })()`);
        await sleep(260);
    }
    return (await gameState()).slots;
}

/** 确保「失败结算弹层」是开着的（`_over === true` 且有 BtnAdRevive） */
async function openFailResult() {
    if ((await exists('BtnAdRevive')) && (await gameState())?.over) return true;
    await cdp.ev('(function () { __game5.demoResult(false); return true; })()');
    await sleep(430);
    return await exists('BtnAdRevive');
}

// ============================================================
//  Part A · 主玩页（无 wx）
// ============================================================
console.log('\n──────── Part A · 主玩页（浏览器无 wx）────────');
await navigateTo(cdp, 'game');
await sleep(700);

head('⓪ T06/T07/T08/T09/T10/T17 · 平台能力现状（**只报事实**）');

const st0 = await gameState();
const pf0 = await platform();
assert('已进入主玩页（调试桥可用）', !!st0 && typeof st0.remaining === 'number',
    st0 ? `第 ${st0.level} 关 · 剩 ${st0.remaining} 张` : 'null');
assert('★ 广告现状如实：realEnabled=false，两个场景都判 mock（没有广告位 ≠ 假装有广告）',
    pf0?.ad?.realEnabled === false && pf0?.ad?.revive === 'mock' && pf0?.ad?.tool === 'mock',
    JSON.stringify(pf0?.ad));
assert('★ 分享现状如实：浏览器无 wx ⇒ shareAvailable=false，落地页无 query ⇒ null',
    pf0?.shareAvailable === false && pf0?.landingLevel === null,
    `shareAvailable=${pf0?.shareAvailable} landingLevel=${pf0?.landingLevel}`);
assert('起点干净：没有面板开着、adBusy=false',
    pf0?.adPanelOpen === false && pf0?.adBusy === false);

// ------------------------------------------------------------
head('① T06 · 替身广告「看完」⇒ 复活真的发生（真实鼠标）');

const slots1 = await fillSlots(2);
assert('前置：槽里已放够 2 张**不同面**的牌（否则"复活直消"无事可做，判据退化成 0==0）',
    slots1 === 2, `slots=${slots1}`);
const invBeforeAd = await inventory();
assert('前置：跨局库存/金币已记下（后面要逐字段比对）', !!invBeforeAd, JSON.stringify(invBeforeAd));

assert('失败结算弹层已弹出（BtnAdRevive 可见）', await openFailResult());
const stA = await gameState();
assert('★ 此时 `_over = true`（"看广告复活"的前提；不为真则后面全判不出来）', stA.over === true);

const hitRevive = await tap('BtnAdRevive');
await sleep(500);
assert('真实鼠标点中「看广告复活」', hitRevive);
assert('★ 替身广告面板已升起（AdPanel 可见）', await exists('AdPanel'));

const pfDuring = await platform();
assert('★ 播放期间 `adBusy = true`（连点保护已上锁）', pfDuring?.adBusy === true);
const stDuring = await gameState();
assert('★ 面板期间 `_paused = true` ⇒ 触摸真的被面板接管了', stDuring.paused === true);

const txtDuring = await sceneTexts();
assert('★ 替身面板上**如实**标着「演示用 · 当前尚未接入广告位」（不冒充真广告）',
    txtDuring.includes('演示用 · 当前尚未接入广告位'),
    `面板文案 ${txtDuring.length} 条`);
assert('★ 合规：面板上**没有**「分享给好友」那颗诱导分享按钮',
    !txtDuring.some((t) => t.includes('分享给好友')),
    txtDuring.filter((t) => t.includes('分享')).join(' / ') || '（无含"分享"字样的文案）');
assert('★ 合规：面板上**没有**「看广告满 5 秒，或分享给好友」那句旧文案',
    !txtDuring.some((t) => t.includes('或分享给好友')));

// 等替身走完（CFG.AD.MOCK_SECONDS = 5）
await sleep(6000);

const stEnd = await gameState();
const pfEnd = await platform();
assert('★ 看完（end）⇒ `_over` 复位为 false（这局继续，不是判死）', stEnd.over === false);
assert('★★ 看完 ⇒ `_paused` 复位为 false（少这一下就是**整页点不动**，玩家只能杀进程）',
    stEnd.paused === false);
assert('★★ 看完 ⇒ **复活真的生效**：槽内被直消，`cleared` 增加',
    stEnd.cleared > stA.cleared && stEnd.slots < stA.slots,
    `cleared ${stA.cleared} → ${stEnd.cleared} · slots ${stA.slots} → ${stEnd.slots}`);
assert('★ 看完 ⇒ 替身面板已销毁（不留残留节点）', !(await exists('AdPanel')));
assert('★ 看完 ⇒ `adBusy` 复位（否则下次点击永远被拦）', pfEnd?.adBusy === false);
assert('★ 看完 ⇒ 结算弹层已关闭（ResultLayer 没了）', !(await exists('ResultLayer')));
assert('★ 看完 ⇒ 跨局库存 / 金币**逐字段未变**（看广告只换"复活"，不悄悄改账）',
    JSON.stringify(invBeforeAd) === JSON.stringify(await inventory()),
    JSON.stringify(await inventory()));

// ------------------------------------------------------------
head('② T08 负控 A · 中途「跳过」（abort）⇒ 不发奖 + 不卡死');

const slots2 = await fillSlots(2);
assert('前置：槽里再次放够 2 张不同面的牌', slots2 === 2, `slots=${slots2}`);
assert('失败结算弹层重新弹出', await openFailResult());
const stB = await gameState();
const invB = await inventory();

assert('真实鼠标点中「看广告复活」', await tap('BtnAdRevive'));
await sleep(500);
assert('替身面板再次升起', await exists('AdPanel'));

const hitSkip = await tap('Btn_跳过');
await sleep(700);
const stB2 = await gameState();
const pfB2 = await platform();
assert('真实鼠标点中面板上的「跳过」', hitSkip);
assert('★★ 中途关掉（abort）⇒ **没有复活**：`_over` 仍为 true', stB2.over === true);
assert('★★ abort ⇒ `cleared` 一个都没多加（"关掉了也算数"会让看广告这件事失去意义）',
    stB2.cleared === stB.cleared, `cleared ${stB.cleared} → ${stB2.cleared}`);
assert('★★ abort ⇒ `_paused = false`（这条才是"不发奖也不能卡死"的判据）', stB2.paused === false);
assert('abort ⇒ 面板已销毁', !(await exists('AdPanel')));
assert('abort ⇒ `adBusy` 复位', pfB2?.adBusy === false);
assert('abort ⇒ 结算弹层仍在（玩家还能点「重新挑战」）', await exists('ResultLayer'));
assert('abort ⇒ 跨局库存 / 金币逐字段未变',
    JSON.stringify(invB) === JSON.stringify(await inventory()));

// ------------------------------------------------------------
head('③ T06/T07/T08 · 「真广告」分支（运行期翻开关 + 注入 fake wx）');

await cdp.ev(RUNTIME_WX);
const cfg = await cdp.ev('__game5.adConfig({ REAL_ENABLED: true,'
    + " AD_UNIT: { revive: 'adunit-r53', tool: 'adunit-r53t' } })");
assert('★ 运行期翻开关后：describe() 报告 revive/tool 都走 real（配置生效）',
    cfg?.revive === 'real' && cfg?.tool === 'real', JSON.stringify(cfg));

// --- ③.1 end ---
{
    await fillSlots(2);
    await openFailResult();
    const st1 = await gameState();
    assert('③.1 前置：失败结算弹层已开', st1.over === true);
    await tap('BtnAdRevive');
    await sleep(500);
    const pf = await platform();
    assert('★★ 真分支特征：`adPanelOpen = false` 但 `adBusy = true`（**没有替身面板**）',
        pf?.adPanelOpen === false && pf?.adBusy === true, JSON.stringify(pf));
    const r = await cdp.ev('globalThis.__r53');
    assert('★ 真的去调了 wx.createRewardedVideoAd，且 adUnitId 是 CFG 里配的那个',
        r.create === 1 && r.opt?.adUnitId === 'adunit-r53', JSON.stringify(r.opt));
    assert('★ 监听器只在创建时挂一次（onClose/onError 各 1）',
        r.onClose === 1 && r.onError === 1, `onClose=${r.onClose} onError=${r.onError}`);
    assert('真分支的 show() 被调了 1 次', r.show === 1, `show=${r.show}`);

    await cdp.ev('globalThis.__r53._closeCb({ isEnded: true })');
    await sleep(900);
    const st2 = await gameState();
    const pf2 = await platform();
    assert('★★ end（看完）⇒ 复活生效：`_over` 复位 + `cleared` 增加',
        st2.over === false && st2.cleared > st1.cleared,
        `cleared ${st1.cleared} → ${st2.cleared}`);
    assert('★ end ⇒ `adBusy` 复位（真分支也要能收口）', pf2?.adBusy === false);
}

// --- ③.2 abort ---
{
    await fillSlots(2);
    await openFailResult();
    const st1 = await gameState();
    await tap('BtnAdRevive');
    await sleep(500);
    await cdp.ev('globalThis.__r53._closeCb({ isEnded: false })');
    await sleep(700);
    const st2 = await gameState();
    assert('★★ 真分支 abort（isEnded=false）⇒ 不发奖：`_over` 仍 true / `cleared` 不变',
        st2.over === true && st2.cleared === st1.cleared,
        `over=${st2.over} cleared ${st1.cleared} → ${st2.cleared}`);
    assert('★ 真分支 abort ⇒ `adBusy` 复位（这条防"卡在 busy 里以后再也点不动"）',
        (await platform())?.adBusy === false);
}

// --- ③.3 fail（show 失败）---
{
    await fillSlots(2);
    await openFailResult();
    const st1 = await gameState();
    await cdp.ev("globalThis.__r53.adMode = 'showFail'");
    await tap('BtnAdRevive');
    const toastFail = await waitText('广告暂时拉不到', 2600);
    const st2 = await gameState();
    const r = await cdp.ev('globalThis.__r53');
    assert('★★ 真分支 fail（show 失败 ⇒ load 重试也失败）⇒ 不发奖',
        st2.over === true && st2.cleared === st1.cleared,
        `over=${st2.over} cleared ${st1.cleared} → ${st2.cleared}`);
    assert('★ 失败提示已抛出（toast「广告暂时拉不到，稍后再试」）', toastFail,
        (await sceneTexts()).filter((t) => t.includes('广告') || t.includes('拉不到')).join(' / ')
        || '（未捕获到 toast 文案）');
    assert('★ fail ⇒ `adBusy` 复位', (await platform())?.adBusy === false);
    assert('重试路径确实走过（show ≥ 2）', r.show >= 2, `show=${r.show}`);
    await cdp.ev("globalThis.__r53.adMode = 'ok'");
}

// --- ③.4 fail（onError）---
{
    await fillSlots(2);
    await openFailResult();
    const st1 = await gameState();
    await tap('BtnAdRevive');
    await sleep(500);
    await cdp.ev("globalThis.__r53._errCb({ errMsg: 'r53 no ad' })");
    await sleep(700);
    const st2 = await gameState();
    assert('★★ 真分支 onError 回调 ⇒ 判 fail、不发奖',
        st2.over === true && st2.cleared === st1.cleared,
        `over=${st2.over} cleared ${st1.cleared} → ${st2.cleared}`);
    assert('★ onError ⇒ `adBusy` 复位', (await platform())?.adBusy === false);
}

// --- ③.5 ★★ 连播 3 次：每次只发一份（实例缓存 + 监听器只挂一次）---
{
    const r0 = await cdp.ev('globalThis.__r53');
    const base = { create: r0.create, onClose: r0.onClose, onError: r0.onError };
    const deltas = [];
    for (let i = 0; i < 3; i++) {
        await fillSlots(2);
        await openFailResult();
        const before = await gameState();
        await tap('BtnAdRevive');
        await sleep(430);
        await cdp.ev('globalThis.__r53._closeCb({ isEnded: true })');
        await sleep(900);
        const after = await gameState();
        deltas.push(after.cleared - before.cleared);
    }
    const r1 = await cdp.ev('globalThis.__r53');
    assert('★★★ 连播 3 次，每次 `cleared` 增量**完全相同**且只等于实际槽内容（不是 2/4/6 递增）',
        deltas.length === 3 && deltas.every((d) => d === deltas[0]) && deltas[0] === 2,
        `三次增量 = [${deltas.join(', ')}]（期望 [2, 2, 2]）`);
    assert('★★★ 连播 3 次后 `create` **只多了 0 次**（实例按场景缓存，全程只建 1 个）',
        r1.create === base.create, `create ${base.create} → ${r1.create}`);
    assert('★★★ 连播 3 次后 `onClose` / `onError` **各只多 0 次**（挂 N 份 = 一次广告发 N 份奖励）',
        r1.onClose === base.onClose && r1.onError === base.onError,
        `onClose ${base.onClose}→${r1.onClose} · onError ${base.onError}→${r1.onError}`);
}

// --- 收尾：复位 ---
{
    const back = await cdp.ev('__game5.adConfig({ REAL_ENABLED: false })');
    assert('③ 收尾：adConfig 已复位（realEnabled=false，两个场景回到 mock）',
        back?.realEnabled === false && back?.revive === 'mock' && back?.tool === 'mock',
        JSON.stringify(back));
    await cdp.ev('(function () { delete globalThis.wx; return true; })()');
}

// ============================================================
//  Part B · 回首页（仍无 wx）：降级路径
// ============================================================
console.log('\n──────── Part B · 首页 / 主玩页（仍无 wx）────────');
await reloadWait();
await navigateTo(cdp, 'home');
await sleep(600);

head('⑤ T17 · 排行榜入口在**无开放数据域**环境必须降级（不是崩掉）');

const hasFnRank = await exists('Fn_rank');
assert('首页有排行榜入口 Fn_rank', hasFnRank);
const hitRank = await tap('Fn_rank');
await sleep(700);
assert('真实鼠标点中 Fn_rank', hitRank);
assert('★ 排行榜浮层已升起（RankLayer 可见）', await exists('RankLayer'));
assert('★★ 浏览器无 wx ⇒ **不建** OpenDataView（`RankService.available === false`）',
    !(await exists('OpenDataView')));
const txtRank = await sceneTexts();
assert('★ 降级文案如实呈现：「排行榜需要在小游戏里查看」',
    txtRank.some((t) => t.includes('排行榜需要在小游戏里查看')),
    txtRank.filter((t) => t.includes('排行')).join(' / '));
const hOK = await tap('RankClose');
await sleep(600);
assert('真实鼠标点中「关闭」', hOK);
assert('★ 关闭后 RankLayer 已销毁', !(await exists('RankLayer')));

head('④ T07/T09 · 胜态「分享」：浏览器降级 + **不发任何奖励**');

await navigateTo(cdp, 'game');
await sleep(700);
const stWin = await gameState();
assert('已进入主玩页（此时 `_over = false`）', stWin.over === false);
await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
await sleep(700);
assert('胜态结算弹层已弹出（BtnShare 可见）', await exists('BtnShare'));

const invWin0 = await inventory();
const txtWin = await sceneTexts();
assert('★ 合规：结算卡上**没有**任何"分享换奖励"字样',
    !txtWin.some((t) => /奖励|分享得|分享领|领奖励/.test(t)),
    txtWin.filter((t) => /奖励|分享/.test(t)).join(' / ') || '（无相关字样）');
assert('★ 合规：全场景文案里没有「分享给好友」这颗诱导分享按钮',
    !txtWin.some((t) => t.includes('分享给好友')));

assert('真实鼠标点中「分享」', await tap('BtnShare'));
const shareToast = await waitText('当前环境不支持分享', 2600);
// ⚠️ 这条判据的**已知局限**（第 53 轮结案，别再来回查）：
//   它只回答"场景里有没有这段文字"，**不管遮挡、不看亮度**。
//   同轮一度以为它和取证截图矛盾（截图底部没有 toast）—— 真因**不在产品**：
//   `_r53-shots.mjs` 当时传了 `fromSurface:false`，截图被静默截成 842×1854 残图，
//   底部 15.5%（含 toast 那一段）根本不在图里。改用 `verifiedShot()` 重出后，
//   toast 明明白白在 y≈2590（= 设计 y1539 → CSS 863.9 ×3）那一带。
//   参数真值表见 `g5-cdp.mjs` 的 `verifiedShot` 注释。
assert('★ 浏览器无 wx ⇒ 如实降级提示，而不是静默什么都不发生', shareToast,
    (await sceneTexts()).filter((t) => t.includes('分享')).join(' / ') || '（未捕获到 toast 文案）');
assert('★★ 点分享后跨局库存 / 金币**逐字段未变**（分享 = 纯传播入口，不给奖励）',
    JSON.stringify(invWin0) === JSON.stringify(await inventory()),
    JSON.stringify(await inventory()));
const stWin2 = await gameState();
assert('★ 分享不影响局面：`_paused` 仍为 false、`_over` 仍为 true',
    stWin2.paused === false && stWin2.over === true,
    `paused=${stWin2.paused} over=${stWin2.over}`);
assert('★ 分享后没有多出任何弹层（没走"看完分享领奖"那套）',
    !(await exists('AdPanel')) && !(await exists('ConfirmDialog')));

// ============================================================
//  Part C · 文档开始注入极简 wx：真分支
// ============================================================
console.log('\n──────── Part C · 注入 fake wx 后的真分支 ────────');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LOGIN_FAIL_WX });
await reloadWait();
await navigateTo(cdp, 'home');
await sleep(600);

head('⑥ T10 · wx.login 失败**绝不阻塞**首屏');

const loginCalls = await cdp.ev('globalThis.__r53login ? globalThis.__r53login.calls : -1');
assert('★★ 首屏照常到达（login 失败时游戏能玩）', await exists('Page_home'));
assert('★ `wx.login` 确实被发起过（不是靠"根本没调"混过去的假绿）',
    loginCalls >= 1, `calls=${loginCalls}`);
const loginLogs = cdp.logs.filter((l) => l.text.includes('[LoginService]'));
assert('★ 失败被记录且**只是警告**（不抛、不阻塞）',
    loginLogs.some((l) => l.level === 'warning' && l.text.includes('wx.login 失败')),
    loginLogs.map((l) => l.text).join(' | ') || '（无 LoginService 日志）');
// ⚠️ 浏览器会把**网络层**失败也记成 level=error 的 Log 条目（典型 `net::ERR_...`）
//    —— 那不是"未捕获异常"。不过滤的话会拿噪音判红（g5-cdp 里已经踩过这个坑）。
const realErrs = cdp.errors.filter((e) => !/net::|favicon|ERR_|404|Failed to load resource/.test(e));
assert('★ 全程没有未捕获异常（登录失败没有冒泡到全局）',
    realErrs.length === 0, realErrs.slice(0, 3).join(' ; ') || '0 条');

head('⑧ T17 · 排行榜真分支（主域写云存储 + 通知开放数据域重绘）');

await cdp.ev(RUNTIME_WX);
assert('真实鼠标点中 Fn_rank', await tap('Fn_rank'));
await sleep(800);
assert('★ 有 wx ⇒ 建出了 OpenDataView（开放数据域视窗）', await exists('OpenDataView'));

const odc = await cdp.ev('(function () {'
    + ' var n = window.__g5t.find("OpenDataView"); if (!n) return null;'
    + ' var u = n.getComponent("cc.UITransform");'
    + ' return u ? { w: Math.round(u.width), h: Math.round(u.height) } : null; })()');
assert('★★ 视窗尺寸 = 640×960（**2:3**，与 `SubContextView.designResolutionSize` 默认值同比例）',
    odc && Math.abs(odc.w / odc.h - 640 / 960) < 0.001, JSON.stringify(odc));

const rk = await cdp.ev('globalThis.__r53');
assert('★ 主域把自己的最高关卡写上了云存储（key = "level"）',
    rk.kv.length >= 1 && rk.kv.at(-1)?.KVDataList?.[0]?.key === 'level',
    JSON.stringify(rk.kv.at(-1) || null));
{
    let score = null;
    try { score = JSON.parse(rk.kv.at(-1).KVDataList[0].value).wxgame.score; } catch { /* 留空 */ }
    assert('★★ 云端值的格式是官方约定的 `wxgame.score`，且 > 0（本档 best=2）',
        score === 2, `score=${score}`);
}
assert('★ 通知了开放数据域重绘（postMessage type=render）',
    rk.posted.some((m) => m.type === 'render'), JSON.stringify(rk.posted));
assert('★ 有 wx ⇒ 不再显示"需要在小游戏里查看"的降级文案',
    !(await sceneTexts()).some((t) => t.includes('排行榜需要在小游戏里查看')));
await tap('RankClose');
await sleep(600);
assert('关闭排行榜浮层', !(await exists('RankLayer')));

head('⑦ T09 · 分享真分支（wx.shareAppMessage 被调用）且**依然不给奖励**');

await navigateTo(cdp, 'game');
await sleep(700);
await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
await sleep(700);
assert('胜态结算弹层已弹出', await exists('BtnShare'));
const invReal0 = await inventory();
assert('真实鼠标点中「分享」', await tap('BtnShare'));
await sleep(800);

const rk2 = await cdp.ev('globalThis.__r53');
assert('★★ 真分支：`wx.shareAppMessage` 被调用 1 次', rk2.shares.length === 1,
    JSON.stringify(rk2.shares));
{
    const s = rk2.shares[0] || {};
    assert('★ 分享载荷带关卡号 query（好友点进来能给出"好友正在第 N 关"）',
        s.query === `shareLevel=${LEVEL}`, `query="${s.query}"`);
    assert('★ 分享标题非空且带关卡号', typeof s.title === 'string' && s.title.includes(String(LEVEL)),
        `title="${s.title}"`);
    assert('★ CFG.SHARE.IMAGE_URL 为空 ⇒ 载荷里**不带** imageUrl 字段',
        !('imageUrl' in s), JSON.stringify(s));
}
assert('★★ 真分享之后跨局库存 / 金币**逐字段未变**（微信《运营规范》明令禁止"分享换奖励"）',
    JSON.stringify(invReal0) === JSON.stringify(await inventory()),
    JSON.stringify(await inventory()));
assert('★ 真分享之后没有弹任何"领奖"层，局面未被暂停',
    !(await exists('AdPanel')) && (await gameState()).paused === false);

// ============================================================
console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r53-verify.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${OUT}/_r53-verify.json`);

await close();
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
