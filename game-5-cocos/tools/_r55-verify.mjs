#!/usr/bin/env node
/**
 * ============================================================
 *  _r55-verify.mjs · 第 55 轮 · 批次 3「浏览器 + 真实鼠标」自证
 * ============================================================
 *  被验范围（用户拍板的批次 3）：
 *    T15 首页「好友邀战」入口接线（拉新文案分流 · 不给奖励）
 *    T14 首页「道具商城」（纯广告领道具 · 每种 2 次/日 · 逐件独立计数）
 *    ↑ 后续 T11~T13 落地后**在本文件继续追加分组**，不另起新脚本。
 *
 *  ── 与 `_r53-core-check.mjs` 的分工（**别重复、也别互相替代**）──
 *    · 离线那份验的是 **ShareService 内部**：载荷字段、mode 分流、合规词扫描，
 *      注入 fake wx 做确定性复现；
 *    · 本文件验的是 **页面接线 + 真实事件层**：真的用鼠标点那颗图标、
 *      真的看 toast 有没有出来、真的确认存档没被改。
 *    第 51 轮的教训：截图 + 直接调函数**全都绕过事件层**，
 *    所以"点了没反应"这类问题离线那份永远看不见。
 *
 *  ── 判据口径（读断言前先读这段）────────────────────────────
 *  1. ★★ **降级分支与真分支都要走**，且要能区分二者：
 *     浏览器无 wx ⇒ 必须出"如实提示"，而不是静默死键；
 *     运行期注入 fake wx ⇒ 必须真的调到 `wx.shareAppMessage`。
 *     只测一边都会漏 —— 只测降级会漏掉"真机上点不动"，
 *     只测真分支会漏掉"浏览器里点了没反应、看起来像坏了"。
 *  2. ★ **差分才算证据**：「文案分流」这条不能只断言"邀战文案非空"。
 *     必须再走一遍结算页的分享，断言两次的**标题确实不同** ——
 *     否则 mode 参数被写漏、invite 分支从未生效，断言照样全绿。
 *  3. ★ **"分享不给奖励"要双保险**：静态（离线 B20 断言代码里没有发奖能力）
 *     + 动态（本文件断言点完前后**存档逐字段未变**）。
 *  4. ★ **toast 存活时间短，不能用"读一次"判据** —— 必须轮询
 *     （`waitText`），否则会偶发假红。
 *  5. ★★ **负控必须配一个"已经发生过变化"的正控**（T14 那组）：
 *     "abort 之后配额没动"在 `daily === {}` 的初始态下**恒真**，
 *     所以顺序固定为「先真领到 1 次（证明链路通、且写进了 localStorage）
 *     → 再中途跳过（证明 abort 不发）」。反过来写就是一条永远绿的空断言。
 *  6. ★★ **凡"在首页做的事"都要排在离开首页之前**：
 *     `navigateTo()` 靠日志行判到达（`[PageManager] → home`），而 `cdp.logs` **只增不清**。
 *     开到主玩页之后再调 `navigateTo(cdp,'home')` 会**立刻**匹配到开局那行旧日志
 *     并返回 ⇒ 人还在主玩页，脚本却以为在首页。
 *     ⇒ T14 那组被**刻意**插在 Part A 之后、Part B（去主玩页）之前。
 *
 *  ⚠️ 本文件里的 `INVITE_TITLE` 与 `assets/scripts/CFG.ts` 的
 *     `SHARE.TITLE_INVITE` **必须同步**。改了文案就要一起改这里
 *     （故意用"逐字相等"而不是"包含关键词"——文案是定稿，不该悄悄漂移）。
 *
 *  【用法】node tools/_r55-verify.mjs      # 全绿则 exit 0
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, SAVE_KEY, seedAtLevel, setSeedScript, sleep, startServer, tapNode, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r55-verify');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 1;
const LEVEL = Number(process.env.G5_LEVEL || 3);

/** ⚠️ 与 `CFG.SHARE.TITLE_INVITE` 逐字同步（见文件头说明） */
const INVITE_TITLE = '《麻麻大消除》三缺一，等你来战！';

/**
 * 运行期注入的 fake wx（只含分享能力）。
 *
 * ⚠️ 必须在**页面已经跑起来之后**注入：引擎的平台嗅探在启动时已按"浏览器"定完型，
 *   这时补一个 `wx` 只会被 `ShareService` 读到 —— 这是**最小干扰**的注入方式。
 *   （文档开始注入会让引擎去找一堆本 fake 没有的 API，见 `_r53-verify.mjs` 的教训。）
 */
const RUNTIME_WX = `
(function () {
  var S = globalThis.__r55 = { shares: [], menu: 0, shareCb: null };
  globalThis.wx = {
    showShareMenu: function () { S.menu++; },
    onShareAppMessage: function (cb) { S.shareCb = cb; },
    shareAppMessage: function (opt) { S.shares.push(opt); },
  };
  return true;
})()`;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close, seedId } = await openBrowser(url, {
    seedScript: seedAtLevel(LEVEL), width: W, height: H, scale: SCALE,
});
/** 当前生效的"新文档种子脚本" id（见 `seedSign` / `g5-cdp.setSeedScript`） */
let _seedId = seedId;

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
/** 场景里**所有可见 Label 的字**（纯文本比对，不用 emoji / 不用星号） */
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
/** 轮询等待某段文案出现（toast 存活极短，掐点读会假红） */
async function waitText(sub, timeoutMs = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await sceneTexts()).some((t) => t.includes(sub))) return true;
        await sleep(120);
    }
    return false;
}
/** 直接读存档（首页也能读 —— `__game5` 是主玩页才有的调试桥） */
async function readSave() {
    return await cdp.ev('JSON.parse(localStorage.getItem("game5.save.v1") || "null")');
}
/**
 * 读某个**具名节点**上渲染出来的文案（用于"这一行还剩几次 / 按钮上写的什么"）。
 *
 * ⚠️ 必须先看节点自身、再看子树 —— 这两种写法在本项目里**同时存在**：
 *    · `createLabel()` 返回的就是**带 Label 的节点**（如 `ShopLeft_erase`）；
 *    · 按钮这类是「**容器节点 + 子 Label**」（`ShopBtn_erase` 自己没 Label，
 *      文字挂在它的 `Label` 子节点上）。
 *    只读节点自身的话，按钮一律返回 `null` —— 而 `null !== '明日再来'` 会让
 *    断言**继续报红**（不会假绿），但归因会指向"按钮没变冷"，其实只是读错了地方。
 */
async function labelOf(name) {
    return await cdp.ev(`(function () {
        var n = window.__g5t.find(${JSON.stringify(name)});
        if (!n) return null;
        var own = n.getComponent && n.getComponent('cc.Label');
        if (own) return own.string;
        var found = null;
        (function walk(x) {
            if (found !== null) return;
            var l = x.getComponent && x.getComponent('cc.Label');
            if (l) { found = l.string; return; }
            for (var i = 0; i < x.children.length; i++) walk(x.children[i]);
        })(n);
        return found;
    })()`);
}
/** 本地日期 YYYY-MM-DD —— 与 `SaveService.todayKey()` **故意各写一遍**（互为对照） */
function todayLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
//  Part A · 首页 · T15 邀战入口
// ============================================================
await navigateTo(cdp, 'home');
await sleep(1800);

head('① T15 · 前置：首页四个功能入口都在（真分支验证的前提）');
assert('Fn_signin / Fn_shop / Fn_rank / Fn_invite 四个入口节点都在',
    (await exists('Fn_signin')) && (await exists('Fn_shop'))
    && (await exists('Fn_rank')) && (await exists('Fn_invite')),
    `sin=${await exists('Fn_signin')} shop=${await exists('Fn_shop')} `
    + `rank=${await exists('Fn_rank')} invite=${await exists('Fn_invite')}`);

head('② T15 · 降级分支：浏览器无 wx ⇒ **如实提示**（不是死键、不炸）');
cdp.errors.length = 0;
const saveBefore = await readSave();
assert('真实鼠标点中「好友邀战」', await tap('Fn_invite'));
assert('★ 出现降级提示「分享需要在小游戏里使用」',
    await waitText('分享需要在小游戏里使用'), '（无 wx 时明说，而不是静默什么都不发生）');
assert('★ 降级时**没有**误开任何浮层（RankLayer 也没被误开）',
    !(await exists('RankLayer')), '（说明 invite 分支没串到 openRank）');
assert('★ 降级时没有 JS 异常', cdp.errors.length === 0,
    JSON.stringify(cdp.errors.slice(0, 3)));
assert('★ 降级态下存档未被改动',
    JSON.stringify(saveBefore) === JSON.stringify(await readSave()));

head('③ T15 · 真分支：运行期注入 fake wx ⇒ 真的调到 wx.shareAppMessage');
await cdp.ev(RUNTIME_WX);
await sleep(300);
const saveBefore2 = await readSave();
assert('真实鼠标点中「好友邀战」（真分支）', await tap('Fn_invite'));
await sleep(700);

const r55 = await cdp.ev('globalThis.__r55');
assert('★★ 真分支：`wx.shareAppMessage` 被调用 **1 次**（真实鼠标点出来的）',
    !!r55 && r55.shares.length === 1, JSON.stringify(r55 && r55.shares));
{
    const s = (r55?.shares?.[0]) || {};
    assert('★ 载荷 title = 拉新文案（逐字等于 CFG.SHARE.TITLE_INVITE）',
        s.title === INVITE_TITLE, `title="${s.title}"`);
    assert('★ 拉新文案里**不带**关卡号（是"邀好友来战"，不是"晒进度"）',
        !String(s.title || '').includes(String(LEVEL)), `title="${s.title}"`);
    assert('★ 载荷 query 仍带关卡号（好友点进来照样给得出落地提示）',
        new RegExp('^shareLevel=\\d+$').test(String(s.query || '')), `query="${s.query}"`);
    assert('★ CFG.SHARE.IMAGE_URL 为空 ⇒ 载荷里**不带** imageUrl 字段',
        !('imageUrl' in s), JSON.stringify(s));
    // 合规：微信《小游戏运营规范》把"分享后获得奖励"列为诱导分享
    assert('★★ 合规：拉新文案里不含「得 / 领 / 奖励 / 领取」字样',
        !/[得领]|奖励|领取/.test(String(s.title || '')), `title="${s.title}"`);
}
assert('★ 真分支下**也没有**误开浮层', !(await exists('RankLayer')));
assert('★ 真分支下没有 JS 异常', cdp.errors.length === 0, JSON.stringify(cdp.errors.slice(0, 3)));
assert('★★ 真分享之后存档**逐字段未变**（分享不得换奖励）',
    JSON.stringify(saveBefore2) === JSON.stringify(await readSave()),
    `before=${JSON.stringify(saveBefore2)} after=${JSON.stringify(await readSave())}`);

// ============================================================
//  Part A2 · 首页 · T14「道具商城」（纯广告领道具）
// ============================================================
//  【口径 —— 用户 2026-10-07 拍板，代码真源 `CFG.AD_QUOTA`】
//    A3 本商城 = **每种道具 2 次/日**（四件套 ⇒ 单日最多 8 次）；计数键 `shop:<key>`。
//    A2 局内「＋」= **不限次数** —— 与本页**各自记账**，本文件不覆盖 A2（那是 `_r53` 的活）。
//  【本组只用替身广告】`CFG.AD.REAL_ENABLED=false` + `AD_UNIT` 全空 ⇒ `modeOf('tool')==='mock'`。
//    所以本组证到的是「**替身链路**通过」，**不能**写成"真实广告通过" —— 那要等有广告位。
//  【这里验的是事件层】离线 F 组已把 `SaveService` 的每日配额逐条钉死；本组要证的是
//    「**真的用鼠标点那颗按钮**，真的走完面板，真的写进了 localStorage」。
console.log('\n──────── Part A2 · T14 道具商城（替身广告链路）────────');

head('④ T14 · 开：真实鼠标点「道具商城」⇒ 弹层真的出来（不是死键）');
cdp.errors.length = 0;                       // 前面两组留下的噪音不带进来
assert('真实鼠标点中「道具商城」', await tap('Fn_shop'));
await sleep(700);
assert('★ ShopLayer 弹层已出现（点了真有反应）', await exists('ShopLayer'));
assert('★ 四行道具都在（消除 / 移出 / 洗牌 / 加槽）',
    (await exists('ShopRow_erase')) && (await exists('ShopRow_move'))
    && (await exists('ShopRow_shuffle')) && (await exists('ShopRow_addslot')));
{
    const t = await sceneTexts();
    assert('★ 卡片标题「道具商城」在位', t.includes('道具商城'), JSON.stringify(t.slice(0, 14)));
    assert('★ 副标题「看广告免费领」在位（说清入口是广告而非付费）', t.includes('看广告免费领'));
}
assert('★ 没有误开排行榜弹层（说明没串到 openRank）', !(await exists('RankLayer')));
assert('★★ 四颗「免费领」各自**唯一命名**（ShopBtn_*）',
    (await exists('ShopBtn_erase')) && (await exists('ShopBtn_move'))
    && (await exists('ShopBtn_shuffle')) && (await exists('ShopBtn_addslot')),
    '（同名 ×4 时 `find()` 只返回第一行 ⇒ "逐件独立计数"根本点不出来）');
assert('★ 打开商城没有 JS 异常', cdp.errors.length === 0, JSON.stringify(cdp.errors.slice(0, 3)));

head('⑤ T14 · 正控：领 1 次（等替身广告走完 = end）⇒ 真的到账 + 真的落盘');
const save0 = await readSave();
const inv0 = { ...((save0 && save0.inventory) || {}) };
assert('★ 起始态：daily["shop:erase"] 未被记过（0 次）',
    !(save0 && save0.daily && save0.daily['shop:erase']),
    `daily=${JSON.stringify((save0 && save0.daily) || {})}`);
assert('真实鼠标点中「消除」行的「免费领」', await tap('ShopBtn_erase'));
await sleep(600);
assert('★ 替身广告面板（ShopAdPanel）已弹出', await exists('ShopAdPanel'));
assert('★★ 面板**如实**标「演示用 · 当前尚未接入广告位」（没有假装有广告）',
    await waitText('演示用 · 当前尚未接入广告位'), '（这是口径，不是装饰）');
assert('★ 面板里就是那颗共用「跳过」键（Btn_跳过）', await exists('Btn_跳过'));

// 替身时长 = `CFG.AD.MOCK_SECONDS`（5 秒）。用"轮询到面板消失"而不是死等：
// 死等时机写早了会读到"还没结算"，写晚了又白等；轮询对时长改动免疫。
{
    const t0 = Date.now();
    let gone = false;
    while (Date.now() - t0 < 9000) {
        if (!(await exists('ShopAdPanel'))) { gone = true; break; }
        await sleep(150);
    }
    assert('★ 替身广告**自己走完**并关闭（等价于"看完了"）', gone,
        `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（应≈5s）`);
}
await sleep(400);
{
    const s1 = await readSave();
    assert('★★ 正控：`daily["shop:erase"]` **从无到 1**（配额真的被记了）',
        s1 && s1.daily && s1.daily['shop:erase'] === 1,
        `daily=${JSON.stringify((s1 && s1.daily) || {})}`);
    assert('★★ 正控：库存 `inventory.erase` **+1**（道具真的发了）',
        ((s1 && s1.inventory && s1.inventory.erase) || 0)
            === ((inv0.erase || 0) + 1),
        `before=${inv0.erase || 0} after=${(s1 && s1.inventory && s1.inventory.erase) || 0}`);
    assert('★ 正控：`dailyDate` 就是**今天**（本地日期，不是 UTC）',
        s1 && s1.dailyDate === todayLocal(),
        `dailyDate=${s1 && s1.dailyDate}  期望=${todayLocal()}`);
}

const afterGrant1 = await readSave();

head('⑥ T14 · 负控：再领一次但中途「跳过」⇒ **配额与库存都不动**');
// ★ 顺序要点：此刻 `daily` 已经是非空（=1），"没动"才有意义。
const daily1 = JSON.stringify((afterGrant1 && afterGrant1.daily) || {});
const inv1 = JSON.stringify((afterGrant1 && afterGrant1.inventory) || {});
assert('真实鼠标点中「消除」行的「免费领」（第 2 次）', await tap('ShopBtn_erase'));
await sleep(600);
assert('★ 替身面板再次弹出（说明第 1 次没把这一行锁死）', await exists('ShopAdPanel'));
assert('真实鼠标点中「跳过」', await tap('Btn_跳过'));
await sleep(900);
assert('★ 面板已关掉', !(await exists('ShopAdPanel')));
{
    const s2 = await readSave();
    assert('★★ 负控：abort 之后 `daily` **逐字段没动**（跳过 ≠ 看完）',
        JSON.stringify((s2 && s2.daily) || {}) === daily1,
        `before=${daily1} after=${JSON.stringify((s2 && s2.daily) || {})}`);
    assert('★★ 负控：abort 之后库存 **逐字段没动**（没白送道具）',
        JSON.stringify((s2 && s2.inventory) || {}) === inv1,
        `before=${inv1} after=${JSON.stringify((s2 && s2.inventory) || {})}`);
}

head('⑦ T14 · 正控（第 2 次）：领满 2 次 ⇒ 该行转冷（按钮变「明日再来」）');
assert('真实鼠标点中「消除」行的「免费领」（第 3 次）', await tap('ShopBtn_erase'));
await sleep(600);
assert('★ 替身面板第 3 次弹出', await exists('ShopAdPanel'));
{
    const t0 = Date.now();
    let gone = false;
    while (Date.now() - t0 < 9000) {
        if (!(await exists('ShopAdPanel'))) { gone = true; break; }
        await sleep(150);
    }
    assert('★ 走完并自动关闭', gone);
}
await sleep(500);
{
    const s3 = await readSave();
    assert('★★ 正控：`daily["shop:erase"]` 已达上限 2',
        s3 && s3.daily && s3.daily['shop:erase'] === 2,
        `daily=${JSON.stringify((s3 && s3.daily) || {})}`);
    assert('★★ 正控：库存累计 +2（两次都真发了）',
        ((s3 && s3.inventory && s3.inventory.erase) || 0)
            === ((inv0.erase || 0) + 2),
        `before=${inv0.erase || 0} after=${(s3 && s3.inventory && s3.inventory.erase) || 0}`);
    assert('★★ 该行文案转冷：「今日已领完」',
        (await labelOf('ShopLeft_erase')) === '今日已领完',
        `实际="${await labelOf('ShopLeft_erase')}"`);
    assert('★★ 该行按钮文案转冷：「明日再来」',
        (await labelOf('ShopBtn_erase')) === '明日再来',
        `实际="${await labelOf('ShopBtn_erase')}"`);
}

head('⑧ T14 · 触顶后再点 ⇒ 只提示、**连广告面板都不开**（不白耗一次观看）');
const daily2 = JSON.stringify(((await readSave()) || {}).daily || {});
assert('真实鼠标点中已冷却的「消除」按钮', await tap('ShopBtn_erase'));
await sleep(400);
assert('★★ 触顶后**没有**弹出广告面板（这才是"不白看广告"的证据）',
    !(await exists('ShopAdPanel')), '（若弹了 ⇒ 玩家看完 5 秒才被告知"今日已领完"）');
// ⚠️ 搜的是**整句**（'今日已领完，明天再来'）而不是 '今日已领完'：
//    那一行的标签本身就写着「今日已领完」，搜半句的话**标签会被当成 toast**，
//    这条断言就变成恒真的（点与不点都能过）。
assert('★ 出现了「今日已领完，明天再来」提示（如实告知，不是静默失效）',
    await waitText('今日已领完，明天再来'));
assert('★★ 触顶后配额**没被多记**（还是 2）',
    JSON.stringify(((await readSave()) || {}).daily || {}) === daily2,
    `before=${daily2} after=${JSON.stringify(((await readSave()) || {}).daily || {})}`);

head('⑨ T14 · 差分：**逐件独立**计数（消除领满 ≠ 移出也被锁）');
assert('★★ 差分：同屏的「移出」行**仍然可领**（今日还可 2 次）',
    (await labelOf('ShopLeft_move')) === '今日还可 2 次',
    `move="${await labelOf('ShopLeft_move')}"  vs  erase="${await labelOf('ShopLeft_erase')}"`);
assert('★ 差分：同屏的「移出」按钮**仍是常态**「免费领」',
    (await labelOf('ShopBtn_move')) === '免费领', `实际="${await labelOf('ShopBtn_move')}"`);
assert('★ 差分：全屏只有「消除」这一行转冷（加槽 / 洗牌也都还没动）',
    (await labelOf('ShopLeft_shuffle')) === '今日还可 2 次'
    && (await labelOf('ShopLeft_addslot')) === '今日还可 2 次',
    `shuffle="${await labelOf('ShopLeft_shuffle')}" addslot="${await labelOf('ShopLeft_addslot')}"`);

head('⑩ T14 · 关：点「关闭」⇒ 弹层**被销毁**（不是只隐藏）');
assert('真实鼠标点中「关闭」', await tap('ShopClose'));
await sleep(700);
assert('★★ ShopLayer 已从场景里消失（`find` 只找 activeInHierarchy 的节点）',
    !(await exists('ShopLayer')));
assert('★ 关掉之后首页四入口仍在（没有把首页一起带走）',
    (await exists('Fn_signin')) && (await exists('Fn_shop')) && (await exists('Fn_rank')));
assert('★ 全组跑完没有 JS 异常', cdp.errors.length === 0,
    JSON.stringify(cdp.errors.slice(0, 3)));

// ============================================================
//  Part A3 · T11/T12/T13 七日签到（「领取」落点 = 用户拍板的稿 A）
// ============================================================
//
//  ── 这一组要证的四件事 ────────────────────────────────────
//   ① **落点几何**：胶囊 83×42、骑在**当天那格**的下沿正中、底边越过格底 **19**。
//      这条不是"看着对"，而是**逐值对账**视觉稿 `game-5-七日签到-视觉稿-v1.html`。
//   ② **三态真的分开了**：已领（勾）/ 当天（呼吸 + 胶囊）/ 未到（压暗）——
//      三态共用同一个 Graphics，只改颜色不 clear 会叠在一起，而**截图看不出来**。
//   ③ **领与不领**：正控（点了 ⇒ 落账 + 落盘）必须配负控
//      （点已领的格子 ⇒ 存档**逐字段没动**），否则"没反应"和"没实现"分不开。
//   ④ **第 7 日四选一**：取消**不推进**签到进度（否则会出现"领了却没拿到东西"）。

/** 本地日期偏移（`-1` = 昨天），与 `SaveService.todayKey()` **故意各写一遍** */
function ymd(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/**
 * 造一个"昨天签过 · 已连签 `streak` 天"的存档态。
 *
 * ── ⚠️⚠️ 这里**不能**只写 localStorage（第 57 轮被这坑掉一整轮）──────────
 *  见 `g5-cdp.setSeedScript` 的注释：关卡种子脚本是用
 *  `Page.addScriptToEvaluateOnNewDocument` 注册的，**每次导航（含 `Page.reload`）
 *  都会重跑**。所以"运行期改 localStorage 再 reload"这条路会被种子脚本原样覆盖：
 *  `我写种子 → reload → 种子脚本先跑、把 signDate/signStreak 覆盖回 ''/0 → 页面读到旧值`。
 *  症状极具迷惑性 —— 种子写进去了、reload 也真的发生了、单独探针全绿，
 *  只有"在本脚本上下文里"失效（因为只有本脚本挂了关卡种子）。
 *
 *  ⇒ 正解：**把要造的状态写进种子脚本本身**，让它在每次新文档创建时自己铺好。
 *
 *  这里刻意从**全新骨架**铺（而不是"读旧档打补丁"）：多组之间互相不留残渣，
 *  `daily` / `dailyDate` 也一并清空 —— 断言读到的状态只由本函数决定。
 */
async function seedSign(streak, dateOffset, total) {
    //  `total` = **累计连签**（第 57 轮三新增的字段）。缺省取 `streak` ——
    //  这与 `SaveService.migrate()` 给老存档的兜底口径一致（`max(signTotal, signStreak)`），
    //  所以"只给 streak"的用例与"真玩家拿老存档升级上来"走的是同一条路。
    const t = total === undefined ? streak : total;
    const src = `try {
        var k = ${JSON.stringify(SAVE_KEY)};
        localStorage.setItem(k, JSON.stringify({
            level: ${LEVEL}, best: ${Math.max(0, LEVEL - 1)},
            inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
            coins: 0, plays: 0, cleared: 0,
            signDate: ${JSON.stringify(ymd(dateOffset))}, signStreak: ${streak}, signTotal: ${t},
            dailyDate: '', daily: {}
        }));
    } catch (e) {}`;
    _seedId = await setSeedScript(cdp, src, _seedId);
}
async function reopenHome() {
    // ★★ 必须先打一个"活不过刷新"的标记，再 reload —— 否则**整组断言会跑在旧页面上**：
    //    `Page.reload` 是异步的，旧页面还会活一小会儿；此时
    //    `waitFor(!!__g5t.find('Fn_signin'))` 会**立刻**匹配到旧页面并返回，
    //    于是 `sleep(900)` 之后所有断言读到的都是**刷除前的状态**。
    //    ⚠️ 这个坑和"种子被覆盖"是**两个独立事故**、症状同样是"种子没生效"，
    //       第 57 轮先后各踩了一次 —— 两个都要防（本函数 + `seedSign`）。
    await cdp.ev('(window.__g5StaleProbe = 1)');
    await cdp.send('Page.reload', {});
    await waitFor(cdp, 'window.__g5StaleProbe === undefined', 20000, '页面确实重载了（标记被清掉）');
    await waitFor(cdp, "!!(window.__g5t && window.__g5t.find('Fn_signin'))", 30000, '新首页四入口');
    await sleep(900);
    // 诊断用：reload 之后存档里到底是不是我刚种的那份（种丢了就要看这里，不是看截图）
    const cur = await cdp.ev(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    const ok = await cdp.ev('(function(){var s=JSON.parse(localStorage.getItem('
        + JSON.stringify(SAVE_KEY) + ')||"{}");return s.signDate+"/"+s.signStreak;})()');
    console.log(`      · reload 后签到种子 = ${ok}（应为"昨天 / 期望连签数"）`);
    if (!String(cur || '').includes('signStreak')) console.log(`      · ⚠️ 存档异常：${cur}`);
}
/** 读节点的**设计 px** 几何（`UITransform` 的 width/height 与本地坐标） */
async function geo(name) {
    return await cdp.ev(`(function () {
        var n = window.__g5t.find(${JSON.stringify(name)});
        if (!n) return null;
        var ui = n.getComponent('cc.UITransform');
        return { w: ui.width, h: ui.height, x: n.position.x, y: n.position.y,
                 p: n.parent ? n.parent.name : null };
    })()`);
}

console.log('\n──────── Part A3 · T11/T12/T13 七日签到（稿 A 落点）────────');

head('⑪ 造状态：昨天签过 · 连签 2 天 ⇒ 稿 A 那张图（第 1/2 已领、第 3 可领）');
await seedSign(2, -1);
await reopenHome();
assert('★ 首页四入口都在（红点/入口的前提）',
    (await exists('Fn_signin')) && (await exists('Fn_shop')) && (await exists('Fn_rank')) && (await exists('Fn_invite')));
assert('★★ T13b · 今日未签 ⇒ 签到入口**有**红点', await exists('FnDot_signin'));
assert('★ T13b · 同口径：商城入口也有红点（四件里有剩余次数）', await exists('FnDot_shop'));
assert('★ T13b · 排行榜**没有**红点（它没有每日限额 —— 不受"假红点"污染）',
    !(await exists('FnDot_rank')));

head('⑫ T13 · 入口接线：真实鼠标点「七日签到」⇒ 弹层真的出来');
assert('真实鼠标点中 Fn_signin', await tap('Fn_signin'));
await sleep(800);
assert('★★ SignLayer / SignCard 已出现（不是死键、不是 toast 敬请期待）',
    (await exists('SignLayer')) && (await exists('SignCard')));
assert('★ 兜底文案「敬请期待」**没有**出现（四键全接通了）',
    !(await waitText('敬请期待', 500)));

head('⑬ T11 · 落点几何：逐值对账视觉稿（卡 626×663 · 网格 546×386 · 格 126×176 / 宽格 266）');
const gCard = await geo('SignCard');
const gGrid = await geo('SignCells');
const gC1 = await geo('SignCell_1');
const gC7 = await geo('SignCell_7');
assert('卡 626 × 663（高由各段推导，多一行会变成 663+210）',
    gCard && gCard.w === 626 && gCard.h === 663, JSON.stringify(gCard));
assert('★ 网格净高 386（= 176×2 + 34；**第 7 天被挤到第三行会变成 596**）',
    gGrid && gGrid.w === 546 && gGrid.h === 386, JSON.stringify(gGrid));
assert('单格 126 × 176 @（−210, +105）',
    gC1 && gC1.w === 126 && gC1.h === 176 && gC1.x === -210 && gC1.y === 105, JSON.stringify(gC1));
assert('★ 第 7 日宽格 266 × 176 @（+140, −105）—— 下排剩多少占多少',
    gC7 && gC7.w === 266 && gC7.h === 176 && gC7.x === 140 && gC7.y === -105, JSON.stringify(gC7));

const gClaim = await geo('SignClaim');
assert('★★ 「领取」胶囊 83 × 42（稿 A 的落点尺寸）',
    gClaim && gClaim.w === 83 && gClaim.h === 42, JSON.stringify(gClaim));
assert('★★ 落点 = **当天那格（第 3 天）的水平中线**（x = 0 ⇒ 与格子同心）',
    gClaim && gClaim.x === 0 && (gClaim.p === 'SignCell_3'), `parent=${gClaim?.p} x=${gClaim?.x}`);
assert('★★ 落点 = **胶囊底边越过格底 19 设计 px**（格内 y = −86 = −88 − 19 + 21）',
    gClaim && Math.abs(gClaim.y - (-86)) < 0.01
    && Math.abs((gClaim.y - 21) - (-88 - 19)) < 0.01,
    `y=${gClaim?.y}（格底 −88 · 胶囊底 ${(gClaim?.y ?? 0) - 21} ⇒ 越过 ${((gClaim?.y ?? 0) - 21) + 88}）`);

head('⑭ T11 · 三态：已领（勾）/ 当天（呼吸 + 胶囊）/ 未到（压暗）**真的分开了**');
assert('第 1 / 2 天 = 已领 ⇒ 有青玉勾', (await exists('SignTick_1')) && (await exists('SignTick_2')));
assert('★★ 第 3 天 = 当天 ⇒ **没有**勾、**有**胶囊、**有**呼吸光（三态互斥）',
    !(await exists('SignTick_3')) && (await exists('SignClaim')) && (await exists('SignGlow_3')));
assert('★ 第 4 天 = 未到 ⇒ 没有勾、没有呼吸光', !(await exists('SignTick_4')) && !(await exists('SignGlow_4')));
assert('★ 第 1 天（已领）**没有**呼吸光 —— 复用的 Graphics 真的被 clear 过（没把三态叠在一起）',
    !(await exists('SignGlow_1')));
assert('★★ 文案逐格对得上稿子：第 3 天「洗牌 ×1」/ 第 5 天「各 ×1」/ 第 7 天「任选 1 种 × 2」',
    (await labelOf('SignName_3')) === '洗牌 ×1'
    && (await labelOf('SignName_5')) === '各 ×1'
    && (await labelOf('SignName_7')) === '任选 1 种 × 2',
    `3="${await labelOf('SignName_3')}" 5="${await labelOf('SignName_5')}" 7="${await labelOf('SignName_7')}"`);
assert('★ 副标题右侧那颗胶囊 = 「已连签 2 天」（= 已连续领到的天数，不含今天）',
    (await labelOf('SignStreak')) === '已连签 2 天', `实际 "${await labelOf('SignStreak')}"`);

head('⑮ 正控：真实鼠标点胶囊 ⇒ 真的落账 + 真的落盘');
const svA = await readSave();
const shuffleA = (svA?.inventory?.shuffle) ?? 0;
assert('真实鼠标点中 SignClaim', await tap('SignClaim'));
await sleep(700);
const svB = await readSave();
assert('★★ 存档：连签 2 → 3、签到日期 = 本地今天（**真的写进了 localStorage**）',
    svB?.signStreak === 3 && svB?.signDate === todayLocal(),
    `streak=${svB?.signStreak} date=${svB?.signDate} 期望=${todayLocal()}`);
assert('★★ 道具真的到账：洗牌 +1（第 3 天的奖励就是洗牌 ×1）',
    (svB?.inventory?.shuffle ?? 0) === shuffleA + 1,
    `${shuffleA} → ${svB?.inventory?.shuffle}`);
assert('★ 有"已到账"提示（不是静默发货）', await waitText('已到账'));
//  ★★ 口径来自视觉稿的**稿 C · 今日已签**（`第 3 天已领 · 明天再来`）：
//     领完之后第 3 天转 `done`（带勾），且**整张卡上再没有 `.claim` 元素** ——
//     稿 A 家族不带稿 B 那颗大按钮 ⇒ "今天已领"这件事只由勾 + 胶囊文案表达。
//     ⚠️ 上一轮我把这条写成"胶囊应该跳到下一格"（期望 parent=SignCell_4），那是**错的**：
//        `refreshSignCells` 里 `today = signDayToday()` 今天已领就是 0 ⇒ 没有任何格是 today
//        ⇒ 胶囊全灭。是我把断言写反了，不是实现坏了（回视觉稿核对后才改的口径）。
assert('★★ 领完当场翻态：第 3 天转"已领"（勾出现）+ 「领取」胶囊**消失**（当天已无可领之格 ⇒ 全屏不再有可点目标）',
    (await exists('SignTick_3')) && !(await exists('SignClaim')),
    `Tick_3=${await exists('SignTick_3')} Claim=${await exists('SignClaim')}`);
assert('★★ 副标题的「已连签 n 天」跟着翻新（2 → 3）—— 停在旧数字上就是 bug',
    (await labelOf('SignStreak')) === '已连签 3 天', `实际 "${await labelOf('SignStreak')}"`);

head('⑯ 负控：点**已领**的那一格 ⇒ 存档逐字段不动（"没反应" ≠ "没实现"）');
const svC = await readSave();
const keepC = JSON.stringify({ s: svC.signStreak, d: svC.signDate, i: svC.inventory });
assert('真实鼠标点中 SignCell_3（已领格）', await tap('SignCell_3'));
await sleep(600);
const svD = await readSave();
assert('★★ 存档逐字段未变（已领的格子**不可重复领**）',
    JSON.stringify({ s: svD.signStreak, d: svD.signDate, i: svD.inventory }) === keepC,
    `${keepC} vs ${JSON.stringify({ s: svD.signStreak, d: svD.signDate, i: svD.inventory })}`);

head('⑰ T12 · 第 7 日「四选一」：取消**不推进**、选定才落账');
await seedSign(6, -1);
await reopenHome();
await tap('Fn_signin');
await sleep(800);
const gClaim7 = await geo('SignClaim');
assert('第 7 天 = 当天（胶囊挂到宽格上）', gClaim7 && gClaim7.p === 'SignCell_7', `parent=${gClaim7?.p}`);
assert('★ 宽格里的胶囊**仍居中于该格**（不是整排中线）', gClaim7 && gClaim7.x === 0, `x=${gClaim7?.x}`);
const svE = await readSave();
await tap('SignClaim');
await sleep(700);
assert('★★ 点胶囊 ⇒ 弹出「四选一」二级弹层 + 4 张卡',
    (await exists('SignPicker')) && (await exists('SignPickCard_erase')) && (await exists('SignPickCard_move'))
    && (await exists('SignPickCard_shuffle')) && (await exists('SignPickCard_addslot')));
assert('★ 选择器有自己的「取消」', await exists('SignPickCancel'));
const moveE = (svE?.inventory?.move) ?? 0;
assert('真实鼠标点中「取消」', await tap('SignPickCancel'));
await sleep(600);
const svF = await readSave();
assert('★★ 取消 ⇒ **签到进度不推进**（否则会出现"领着领着没领到东西"）',
    svF?.signStreak === svE?.signStreak && svF?.signDate === svE?.signDate,
    `streak ${svE?.signStreak}→${svF?.signStreak}`);
assert('★★ 取消 ⇒ 一件道具都没发', ((svF?.inventory?.move) ?? 0) === moveE,
    `move ${moveE} → ${svF?.inventory?.move}`);
assert('★ 选择器已销毁（不是隐藏）', !(await exists('SignPicker')));

assert('真实鼠标点中 SignClaim（第二次）', await tap('SignClaim'));
await sleep(700);
assert('真实鼠标点中「移出」卡（四选一里选它）', await tap('SignPickCard_move'));
await sleep(800);
const svG = await readSave();
assert('★★ 选定 ⇒ 移出 **+2**（不是 +1，也不是四种各 +1）',
    ((svG?.inventory?.move) ?? 0) === moveE + 2, `move ${moveE} → ${svG?.inventory?.move}`);
assert('★★ 选定 ⇒ 签到进度才推进（连签 6 → 7）', svG?.signStreak === 7 && svG?.signDate === todayLocal(),
    `streak=${svG?.signStreak} date=${svG?.signDate}`);

head('⑱ T12 · 满 7 天**循环回第 1 天**，且"已领"记录随之清空');
await seedSign(7, -1);
await reopenHome();
await tap('Fn_signin');
await sleep(800);
const gClaimW = await geo('SignClaim');
assert('★★ 满一轮后的第二天：当天 = **第 1 天**（不是第 8 天）', gClaimW && gClaimW.p === 'SignCell_1',
    `parent=${gClaimW?.p}`);
assert('★★ 且**没有任何一格是"已领"**（`min(streak, day-1)` 那道夹子真的生效了 —— '
    + '不夹的话第 1 格会同时有勾 + 胶囊）',
    !(await exists('SignTick_1')) && !(await exists('SignTick_2')) && !(await exists('SignTick_7')));

//  ★ 顺手把这一格真的领掉 —— 不是为了验证"第 1 天能领"（⑮ 已经验过同类），
//    而是**为 ⑲ 造出"今天已签"这个前提**：⑲ 要证的是"签完之后红点自己消失"，
//    没有这一步的话今天仍是未签态，红点本来就该亮着，那条断言会变成假红。
assert('真实鼠标点中 SignClaim（第 1 天 · 无选择器，直接发货）', await tap('SignClaim'));
await sleep(700);
const svH = await readSave();
assert('★ 循环后的第 1 天真的领到了：连签归 1、日期 = 今天',
    svH?.signStreak === 1 && svH?.signDate === todayLocal(),
    `streak=${svH?.signStreak} date=${svH?.signDate}`);

// ★★ 用户 2026-10-07 拍板「方案 B」的核心：**累计连签**。
//    满 7 天后本轮 `signStreak` 归 1，但"已连签 n 天"要继续往上走（7 → 8），
//    否则玩家读到的就是"我的连签被打回原形了"。
assert('★★ 满一轮后累计连签 **7 → 8**（本轮归 1，但累计只增不减）',
    svH?.signTotal === 8, `signTotal=${svH?.signTotal}（期望 8）`);
assert('★★ 副标题胶囊显示**累计**值：「已连签 8 天」（不是跳回「已连签 1 天」）',
    (await labelOf('SignStreak')) === '已连签 8 天', `实际 "${await labelOf('SignStreak')}"`);
assert('★★ 且本轮进度与累计**是分开的两件事**：格子只有第 1 格有勾（不是 7 格全勾）',
    (await exists('SignTick_1')) && !(await exists('SignTick_2')) && !(await exists('SignTick_7')));

head('⑲ 关：点「关闭」⇒ 弹层被销毁；红点随签到状态消失');
assert('真实鼠标点中 SignClose', await tap('SignClose'));
await sleep(700);
assert('★★ SignLayer 已从场景消失', !(await exists('SignLayer')));
assert('★★ T13b · 今天已经签过 ⇒ 签到入口的红点**自己消失**（不需要重启）',
    !(await exists('FnDot_signin')));
assert('★ 商城红点不受影响（两本账，语义不同）', await exists('FnDot_shop'));
assert('★ 全组跑完没有 JS 异常', cdp.errors.length === 0,
    JSON.stringify(cdp.errors.slice(0, 3)));

head('⑳ 方案 B · 断签**不影响累计**（只统计累计天数），本轮进度照旧重来');
//  用户原话：「中间断签几天不影响，只统计累计天数」。
//  ⚠️ 这一组刻意造"日期差 ≥ 2"的状态 —— 那是 `signDayToday()` 走"从第 1 天重来"
//     的分支，也正是"顺手把累计也清了零"最容易发生的地方。
await seedSign(4, -4, 4);          // 断签 3 天 · 本轮曾连领 4 格 · 累计 4
await reopenHome();
await tap('Fn_signin');
await sleep(800);
const gClaimBreak = await geo('SignClaim');
assert('★★ 断签 ⇒ 当天回到**第 1 格**（本轮进度重来，不给断签惩罚）',
    gClaimBreak && gClaimBreak.p === 'SignCell_1', `parent=${gClaimBreak?.p}`);
//  ⚠️ 这里**曾经**误写成 `!exists('SignGlow_1')`（第 57 轮三自己踩的坑，已修）：
//     `SignGlow_N` 不是"已领"标记，而是**"今天这一格"的呼吸光**
//     （`refreshSignCells()` 里 `c.glow.active = st === 'today'`）。
//     今天正是第 1 格 ⇒ 它**必须亮着**。期望写反的后果是这条断言**永远红**，
//     而红的是"我读错了语义"，不是产品 —— 正是"断言可疑对象前必须回到需求真源"那条纪律。
//     所以改成按设计断言：**七格一个勾都没有**（负控）+ **有且只有第 1 格有呼吸光**（正控）。
const ticks = [];
for (let d = 1; d <= 7; d++) ticks.push(await exists(`SignTick_${d}`));
const glows = [];
for (let d = 1; d <= 7; d++) glows.push(await exists(`SignGlow_${d}`));
assert('★★ 断签 ⇒ 七格**全部回到"未到"**（一个勾都没有；`signClaimed()` = 0）',
    ticks.every((t) => !t),
    `勾 = [${ticks.map((t, i) => (t ? i + 1 : '')).filter(Boolean).join(',') || '无'}]`);
assert('★ 正控：**有且只有第 1 格**挂着"今天"的呼吸光（证明上面那条不是"整块没渲染"）',
    glows[0] === true && glows.slice(1).every((g) => !g),
    `呼吸光 = [${glows.map((t, i) => (t ? i + 1 : '')).filter(Boolean).join(',') || '无'}]`);
assert('★★ 但「已连签 n 天」**保留累计值 4**（断签不清零 —— 这正是方案 B 的要点）',
    (await labelOf('SignStreak')) === '已连签 4 天', `实际 "${await labelOf('SignStreak')}"`);
assert('真实鼠标点中 SignClaim（断签后的第 1 天）', await tap('SignClaim'));
await sleep(700);
const svI = await readSave();
assert('★★ 断签后再签 ⇒ 累计继续 +1（4 → 5），本轮归 1',
    svI?.signTotal === 5 && svI?.signStreak === 1,
    `total=${svI?.signTotal} streak=${svI?.signStreak}`);
assert('★ 胶囊跟着翻新：「已连签 5 天」',
    (await labelOf('SignStreak')) === '已连签 5 天', `实际 "${await labelOf('SignStreak')}"`);

//  ⚠️⚠️ **必须把弹层关掉再往下走**（第 57 轮三踩的坑，已修）：
//     Part B 的第一件事是 `navigateTo('game')`，而它靠"**真实鼠标**点 `BtnStart`"。
//     ⑳ 这组是自己新开的签到层，不关的话那一下点击落在**遮罩**上被吞掉，
//     于是 `waitLog('[PageManager] → gameStart')` 12 s 超时、脚本崩在 Part B 开头
//     —— 报错信息（"没到开局页"）指向导航，根因却在本组末尾这几行。
//     ⇒ 顺带把"层真的销毁了"也断言掉，让这条收尾**自己有据**。
assert('真实鼠标点中 SignClose（⑳ 收尾 —— 不关掉，后面 Part B 的导航会被遮罩吞掉）',
    await tap('SignClose'));
await sleep(500);
assert('★ 收尾：SignLayer 已从场景消失', !(await exists('SignLayer')));


// ============================================================
//  Part B · 差分：首页邀战 vs 结算页分享，文案**确实不同**
// ============================================================
//  ⚠️ 本组会把页面开到**主玩页**，走完就回不去首页了（`navigateTo` 靠只增的日志判到达）
//     —— 所以任何"首页上的事"都必须排在它前面（T14 / 签到那两组就是这么安排的）。
//
//  ⚠️ Part A3 里为了造签到状态做过**整页 reload** ⇒ Part A 注入的 fake wx
//     和它的记分板 `globalThis.__r55` 已被一起清掉。这里**重新注入一次**，
//     否则 `r55b` 会是 `undefined`，本组三条断言全红（而根因与分享毫无关系）。
await cdp.ev(RUNTIME_WX);
await sleep(200);
console.log('\n──────── Part B · 差分（文案分流真的生效了）────────');
await navigateTo(cdp, 'game');
await sleep(700);

head('⑪ 差分 · 结算页胜态分享的标题必须**与邀战不同**');
await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
await sleep(800);
assert('结算页胜态弹层已弹出（有 BtnShare）', await exists('BtnShare'));
assert('真实鼠标点中结算页「分享」', await tap('BtnShare'));
await sleep(900);

const r55b = await cdp.ev('globalThis.__r55');
const lvShare = r55b?.shares?.[r55b.shares.length - 1];
assert('★ 结算页那条分享确实发出去了（记分板里有 1 条 —— 邀战那条已被 Part A3 的 reload 清掉）',
    !!r55b && r55b.shares.length === 1, `shares=${r55b?.shares?.length}`);
assert('★★ 差分：两条路的标题**确实不同**（这条才是"分流生效"的证据）',
    !!lvShare && lvShare.title !== INVITE_TITLE,
    `结算页="${lvShare?.title}"  vs  邀战="${INVITE_TITLE}"`);
assert('★ 结算页那条带关卡号（邀战那条不带）—— 两条路的定位确实不一样',
    !!lvShare && String(lvShare.title || '').includes(String(LEVEL)),
    `title="${lvShare?.title}"`);

// ============================================================
console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r55-verify.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${OUT}/_r55-verify.json`);

await close();
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
