#!/usr/bin/env node
/**
 * ============================================================
 *  _r55-verify.mjs · 第 55 轮 · 批次 3「浏览器 + 真实鼠标」自证
 * ============================================================
 *  被验范围（用户拍板的批次 3）：
 *    T15 首页「好友邀战」入口接线（拉新文案分流 · 不给奖励）
 *    ↑ 后续 T14 / T11~T13 落地后**在本文件继续追加分组**，不另起新脚本。
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

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode } from './g5-cdp.mjs';

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
//  Part B · 差分：首页邀战 vs 结算页分享，文案**确实不同**
// ============================================================
console.log('\n──────── Part B · 差分（文案分流真的生效了）────────');
await navigateTo(cdp, 'game');
await sleep(700);

head('④ 差分 · 结算页胜态分享的标题必须**与邀战不同**');
await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
await sleep(800);
assert('结算页胜态弹层已弹出（有 BtnShare）', await exists('BtnShare'));
assert('真实鼠标点中结算页「分享」', await tap('BtnShare'));
await sleep(900);

const r55b = await cdp.ev('globalThis.__r55');
const lvShare = r55b?.shares?.[r55b.shares.length - 1];
assert('★ 结算页那条分享确实发出去了（累计 2 次调用）',
    !!r55b && r55b.shares.length === 2, `shares=${r55b?.shares?.length}`);
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
