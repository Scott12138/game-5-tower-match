#!/usr/bin/env node
/**
 * ============================================================
 *  _r53-core-check.mjs · 第 53 轮 · 平台能力四件套「离线」自证
 * ============================================================
 *  被验对象（都在 `assets/scripts/core/`，都**不 import 'cc'**）：
 *    · AdService    激励视频（`wx.createRewardedVideoAd` 封装）
 *    · ShareService 分享（合规形态：只传播、不奖励）
 *    · LoginService 登录（`wx.login` 拿 code）
 *    · RankService  排行榜主域侧（写云存储 + 通知开放数据域重绘）
 *
 *  ── 为什么要有这个文件，而不是全塞进浏览器验收 ────────────────
 *  这四件的要害**全在"真实分支"里**，而浏览器（无 `wx`）永远走不到：
 *    · 广告的三种结局（`end` 发奖 / `abort` 不发 / `fail` 不发）；
 *    · 监听器只在创建时挂一次（挂多次 = 播一次发 N 份奖励，且**不报错**）；
 *    · 实例按场景缓存（每播一次 create 一次 = 同样发 N 份）；
 *    · `wx.login` 永不回调时的看门狗；
 *    · `setUserCloudStorage` 的**值格式**（`wxgame.score`，自己发明格式官方组件读不了）。
 *  这些用「注入一个 fake `wx`」在 Node 里**确定性复现**，比"等有广告位/有真机"
 *  可靠得多，而且失败时能一眼定位到具体那条分支。
 *  浏览器侧那份（`_r53-verify.mjs`）负责**UI 接线与真实鼠标**，两者互补、不重复。
 *
 *  ── 判据纪律（本项目踩过的血，逐条对应到下面的断言）──────────
 *  1. **断言要能区分"真走了分支"与"碰巧没报错"**：
 *     每条判据都记录 fake 侧的**调用计数**（show/load/close/error/create），
 *     而不是只看返回值 —— 返回值相同、内部路径不同是很常见的。
 *  2. **负控必须真的失败一次**：如"`abort` 不发奖"这条，得先证明
 *     `end` 那条**确实会发**，否则"不发"可能只是因为整条链路根本没通。
 *     ⇒ 每组都先跑"正例"再跑"负例"。
 *  3. **静态断言先剥注释再搜**：`ShareService` 的文件头里就写着"不发奖励"几个字，
 *     不剥注释去搜正文会把**自己的注释**判成违规（第 52 轮被自己的注释判红过一次）。
 *
 *  【用法】
 *    python3 tools/sync-core.py       # 先把源码平铺到 tools/_core/
 *    node --experimental-strip-types --no-warnings tools/_r53-core-check.mjs
 *  全绿 ⇒ exit 0。
 * ============================================================
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { AD, AD_QUOTA, LOGIN, SHARE } from './_core/CFG.ts';
import { AdService } from './_core/AdService.ts';
import { ShareService } from './_core/ShareService.ts';
import { LoginService } from './_core/LoginService.ts';
import { RankService, RANK_KEY } from './_core/RankService.ts';

const HERE = import.meta.dirname;
const SRC_CORE = resolve(HERE, '..', 'assets', 'scripts', 'core');
const SRC_UI = resolve(HERE, '..', 'assets', 'scripts', 'ui');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-core');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const rows = [];
function ok(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ ${msg}`); }
    rows.push({ msg, ok: !!cond });
}
function head(t) { console.log(`\n══ ${t} ══`); }

/**
 * 剥掉 TS/JS 注释（保留换行，行号不乱）。
 * ⚠️ 字符串字面量里的 `//` 会被误伤 —— 本文件只用来做"违规词是否出现在**代码**里"
 *    这种粗粒度静态检查，误伤方向是**少剥**而不是**多判**，安全。
 */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
        .join('\n');
}

// ============================================================
//  fake 工厂
// ============================================================

/**
 * 可控的 fake 激励视频实例。
 *
 * ★ `_onClose` / `_onError` 存成**数组**（而不是覆盖式单值）——
 *   要断言的恰恰是"注册了几次"。覆盖式会让"挂了 3 份监听"看起来跟"挂了 1 份"一样。
 */
function makeFakeAd({ showMode = 'ok', loadMode = 'ok', showFailTimes = 0 } = {}) {
    const inst = {
        showCount: 0,
        loadCount: 0,
        _onClose: [],
        _onError: [],
        showCalls: [],
        get showMode() { return inst._showMode; },
        set showMode(v) { inst._showMode = v; },
        _showMode: showMode,
        _loadMode: loadMode,
        _showFailTimes: showFailTimes,
        show() {
            inst.showCount++;
            if (inst._showMode === 'reject' || inst.showCount <= inst._showFailTimes) {
                return Promise.reject(new Error('show 失败（模拟）'));
            }
            return Promise.resolve();
        },
        load() {
            inst.loadCount++;
            if (inst._loadMode === 'reject') return Promise.reject(new Error('load 失败（模拟）'));
            return Promise.resolve();
        },
        // ⚠️ 真实微信里 `onClose` 是**追加**语义（挂几个就回调几个），fake 必须同语义
        onClose(cb) { inst._onClose.push(cb); },
        onError(cb) { inst._onError.push(cb); },
        setLoadMode(v) { inst._loadMode = v; },
        /** 脚本侧触发：模拟"玩家关掉了广告" */
        fireClose(isEnded) { inst._onClose.slice().forEach((f) => f({ isEnded })); },
        /** 脚本侧触发：模拟"广告拉取出错" */
        fireError(err) { inst._onError.slice().forEach((f) => f(err)); },
    };
    return inst;
}

/**
 * 在 `globalThis.wx` 上装一个 fake 环境，并返回**调用计数器**。
 * 传 `null` = 卸载（还原成"浏览器里没有 wx"）。
 */
function installWx(spec = null) {
    const stat = {
        create: 0, showShareMenu: 0, onShareAppMessage: 0, shareAppMessage: [], login: 0,
        setUserCloudStorage: [], postMessage: [],
        createOpts: [],
    };
    if (!spec) { delete globalThis.wx; return stat; }

    const wx = {};
    if (spec.ad) {
        wx.createRewardedVideoAd = (opt) => {
            stat.create++;
            stat.createOpts.push(opt);
            return spec.ad;
        };
    }
    if (spec.share) {
        wx.showShareMenu = () => { stat.showShareMenu++; };
        wx.onShareAppMessage = (cb) => { stat.onShareAppMessage++; stat.shareCb = cb; };
        wx.shareAppMessage = (opt) => { stat.shareAppMessage.push(opt); };
    }
    if (spec.login) wx.login = spec.login;
    if (spec.launch) wx.getLaunchOptionsSync = () => ({ query: spec.launch });
    if (spec.rank) {
        wx.setUserCloudStorage = (opt) => {
            stat.setUserCloudStorage.push(opt);
            if (spec.rankFail) opt.fail?.({ errMsg: 'mock fail' });
            else opt.success?.();
        };
        wx.getOpenDataContext = () => ({
            postMessage: (m) => { stat.postMessage.push(m); },
        });
    }
    globalThis.wx = wx;
    return stat;
}

/** 把广告相关配置复位到"默认关" */
function resetAdCfg() {
    AD.REAL_ENABLED = false;
    AD.AD_UNIT.revive = '';
    AD.AD_UNIT.tool = '';
}

// ============================================================
//  A 组 · AdService
// ============================================================
head('A 组 · AdService（激励视频）');

// --- 前置：默认态 ---
resetAdCfg();
installWx(null);
{
    const s = new AdService();
    const d = s.describe();
    ok(s.modeOf('revive') === 'mock' && s.modeOf('tool') === 'mock',
        'A1 默认（REAL_ENABLED=false）⇒ 两个场景都判 mock');
    ok(d.realEnabled === false && d.busy === false,
        'A2 describe() 如实报告 realEnabled=false / busy=false（平台能力现状不美化）');
    // 误用保护：mock 模式下**不该**去 create 实例
    const p = await s.play('revive');
    ok(p === 'fail', 'A3 误用保护：mock 场景直接调 play() ⇒ fail（调用方本该先判 modeOf）');
}

// --- 三个条件缺一不可 ---
{
    AD.REAL_ENABLED = true;              // 开关开了
    AD.AD_UNIT.revive = '';              // 但没有广告位 ID
    const s = new AdService();
    ok(s.modeOf('revive') === 'mock', 'A4 开关开但 AD_UNIT 为空 ⇒ 仍判 mock（缺一不可）');

    AD.AD_UNIT.revive = 'adunit-test';
    installWx(null);                     // 环境里没有 createRewardedVideoAd
    ok(new AdService().modeOf('revive') === 'mock', 'A5 开关开 + 有 ID 但环境无 API ⇒ 仍判 mock');

    const ad = makeFakeAd();
    installWx({ ad });
    const s3 = new AdService();
    ok(s3.modeOf('revive') === 'real', 'A6 三条齐了 ⇒ 判 real');
    ok(s3.modeOf('tool') === 'mock', 'A7 场景是**分开**判的：tool 没配 ID ⇒ 仍 mock');
}

// --- 正例：end（看完 → 发奖）---
{
    const ad = makeFakeAd();
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-r'; AD.AD_UNIT.tool = 'adunit-t';
    const s = new AdService();
    const p = s.play('revive');
    ok(ad.showCount === 1, 'A8 正例·show() 被调用 1 次');
    ok(s.busy === true, 'A9 播放中 describe().busy === true');
    const p2 = s.play('revive');           // 连点
    ok((await p2) === 'fail', 'A10 双触发：播放中再调一次 ⇒ 立即 fail（**不排队**等会儿再发一份）');
    ok(ad.showCount === 1, 'A10b 连点那次没有真的再 show() 一次');
    ad.fireClose(true);
    ok((await p) === 'end', '★ A11 正例：onClose(isEnded=true) ⇒ end（这条是"发奖"的唯一入口）');
    ok(s.busy === false, 'A12 结算后 busy 复位');
}

// --- 负例：abort（中途关 → 不发）---
{
    const ad = makeFakeAd();
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-r';
    const s = new AdService();
    const p = s.play('revive');
    await sleep(10);
    ad.fireClose(false);
    ok((await p) === 'abort', '★ A13 负例：onClose(isEnded=false) ⇒ abort（绝不能算 end）');
    ok(s.busy === false, 'A14 abort 之后 busy 也复位（否则下次点击全被拦）');
}

// --- 负例：fail（拉不到）---
{
    const ad = makeFakeAd({ showMode: 'reject', loadMode: 'reject' });
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-r';
    const s = new AdService();
    const o = await s.play('revive');
    ok(o === 'fail', '★ A15 负例：show() 失败且 load() 重试也失败 ⇒ fail');
    // ⚠️ 这里 `showCount` 只能是 **1**：`ad.load().then(() => ad.show())` 里 load 已经 reject，
    //    第二次 show **根本不执行**。我第一版按"重试 = 再 show 一次"写成 2，是**期望值本身错了**
    //    （典型的"拿想象当判据"）—— 保留这条注释，别再改回去。
    ok(ad.showCount === 1 && ad.loadCount === 1,
        `A16 失败路径的调用序列真的是 show×1 → load×1（实测 ${ad.showCount}/${ad.loadCount}）`);
    ok(AD.RETRY_ON_SHOW_FAIL === true, 'A17 重试开关按 CFG 为 true（微信推荐写法）');
}

// --- ★ 正例：重试**成功**（show 第一次失败 → load → show 成功 → 看完发奖）---
{
    const ad = makeFakeAd({ showFailTimes: 1 });      // 只失败第一次
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-retry';
    const s = new AdService();
    const p = s.play('revive');
    await sleep(30);
    ok(ad.showCount === 2 && ad.loadCount === 1,
        `★ A17b 重试路径真的走通了：show×2 → load×1（实测 ${ad.showCount}/${ad.loadCount}）`);
    ad.fireClose(true);
    ok((await p) === 'end',
        '★ A17c 重试成功后仍以正常的 end 收口 ⇒ "重试"不会把结局弄丢（不会卡在 busy）');
    ok(s.busy === false, 'A17d 重试成功后 busy 复位');
}

// --- 负例：onError ---
{
    const ad = makeFakeAd();
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-r';
    const s = new AdService();
    const p = s.play('revive');
    await sleep(10);
    ad.fireError({ errMsg: 'no ad' });
    ok((await p) === 'fail', '★ A18 负例：onError 回调 ⇒ fail');
}

// --- ★★ 实例缓存 + 监听器只挂一次（"一次广告发 N 份"的根因）---
{
    const ad = makeFakeAd();
    const stat = installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-cache';
    const s = new AdService();
    const outs = [];
    for (let i = 0; i < 3; i++) {
        const p = s.play('revive');
        await sleep(15);
        ad.fireClose(true);
        outs.push(await p);
    }
    ok(outs.join(',') === 'end,end,end', `★ A19 连播 3 次全部拿到 end（实测 ${outs.join(',')}）`);
    ok(stat.create === 1,
        `★★ A20 createRewardedVideoAd 只被调用 **1 次**（实测 ${stat.create}）—— 实例按场景缓存`);
    ok(stat.createOpts.every((o) => o.adUnitId === 'adunit-cache'),
        'A21 create 时传的 adUnitId 就是 CFG 里配的那个（没有写死/串场）');
    ok(ad._onClose.length === 1 && ad._onError.length === 1,
        `★★ A22 onClose / onError 各只挂了 **1** 份（实测 ${ad._onClose.length}/${ad._onError.length}）`
        + ' —— 挂 N 份 = 播一次发 N 份奖励，且不报错');
    ok(ad.showCount === 3, `A23 show() 恰好 3 次（实测 ${ad.showCount}），不多播`);
}

// --- 负控：create 抛异常 ⇒ fail，不崩 ---
{
    globalThis.wx = { createRewardedVideoAd: () => { throw new Error('create 抛异常（模拟）'); } };
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-throw';
    const s = new AdService();
    // modeOf 只探"有没有这个函数"，所以判 real；play 时 obtain 里 try/catch 兜住 ⇒ fail
    ok(s.modeOf('revive') === 'real', 'A24 负控前置：create 会抛，但 modeOf 仍判 real（它只看 API 在不在）');
    ok((await s.play('revive')) === 'fail', '★ A25 create 抛异常 ⇒ fail（被 try/catch 兜住，不冒泡到游戏）');
}

// --- 看门狗 ---
{
    const ad = makeFakeAd();
    installWx({ ad });
    AD.REAL_ENABLED = true; AD.AD_UNIT.revive = 'adunit-wd';
    const old = AD.WATCHDOG_MS;
    AD.WATCHDOG_MS = 120;
    const s = new AdService();
    const o = await s.play('revive');
    ok(o === 'fail', '★ A26 看门狗：既无 onClose 也无 onError ⇒ fail（防"整页卡死"）');
    ok(ad.showCount === 1 && s.busy === false, 'A27 看门狗触发后 busy 复位');
    ok(s.modeOf('revive') === 'real', 'A28 看门狗结算后实例仍可用（没被销毁）');
    AD.WATCHDOG_MS = old;
}

// --- CFG 默认值本身 ---
resetAdCfg();
ok(AD.REAL_ENABLED === false, 'A29 ★ CFG 默认 REAL_ENABLED=false（未开流量主时**不调**广告 API 的合规前提）');
ok(AD.AD_UNIT.revive === '' && AD.AD_UNIT.tool === '',
    'A30 ★ CFG 里两个广告位 ID 默认为空串（没有占位假 ID 冒充）');
installWx(null);

// ============================================================
//  B 组 · ShareService（合规形态）
// ============================================================
head('B 组 · ShareService（分享 = 只传播、不奖励）');

{
    installWx(null);
    const s = new ShareService();
    ok(s.available === false, 'B1 无 wx ⇒ available=false');
    ok(s.share(3) === false, 'B2 无 wx ⇒ share() 返回 false（调用方据此降级，不抛）');
    ok(s.arm() === undefined, 'B3 无 wx ⇒ arm() 静默跳过，不抛');
    ok(s.landingLevel() === null, 'B4 无 wx ⇒ landingLevel() = null');
}

{
    const stat = installWx({ share: true });
    const s = new ShareService();
    s.setLevel(6);
    ok(s.available === true, 'B5 有 wx ⇒ available=true');

    s.arm();
    s.arm();
    s.arm();
    ok(stat.onShareAppMessage === 1 && stat.showShareMenu === 1,
        `★ B6 arm() 幂等：连调 3 次，onShareAppMessage / showShareMenu 各只挂 1 次`
        + `（实测 ${stat.onShareAppMessage}/${stat.showShareMenu}）`);

    const p = stat.shareCb();
    ok(typeof p === 'object' && p.title && p.query, 'B7 转发菜单回调返回了 {title, query}');
    ok(p.query === `${SHARE.QUERY_KEY}=6`, `B8 query 带关卡号（实测 "${p.query}"）`);
    ok(p.title.includes('6'), `B9 标题里有关卡号（实测 "${p.title}"）`);
    ok(!('imageUrl' in p), 'B10 IMAGE_URL 为空 ⇒ **不带** imageUrl 字段（交给微信自动取页面截图）');

    ok(s.share(9) === true, 'B11 有 wx ⇒ share() 返回 true');
    const got = stat.shareAppMessage.at(-1);
    ok(!!got && got.query === `${SHARE.QUERY_KEY}=9`, `B12 wx.shareAppMessage 收到 query=${got?.query}`);
    ok(!!got && typeof got.title === 'string' && got.title.includes('9'), 'B13 shareAppMessage 的 title 带关卡号');
    ok(!!got && !('imageUrl' in got), 'B14 shareAppMessage 里不含 imageUrl（空串不上送）');

    // 落地页
    const s2 = new ShareService();
    ok(s2.landingLevel() === null, 'B15 落地页：没有 query ⇒ null');
    installWx({ share: true, launch: { shareLevel: '5' } });
    ok(new ShareService().landingLevel() === 5, 'B16 落地页：shareLevel=5 ⇒ 5');
    installWx({ share: true, launch: { shareLevel: '0' } });
    ok(new ShareService().landingLevel() === null, 'B17 落地页：shareLevel=0 非法 ⇒ null');
    installWx({ share: true, launch: { shareLevel: 'abc' } });
    ok(new ShareService().landingLevel() === null, 'B18 落地页：shareLevel=abc ⇒ null（不产出 NaN）');
    installWx({ share: true, launch: { other: '1' } });
    ok(new ShareService().landingLevel() === null, 'B19 落地页：键名不对 ⇒ null（不会把别的参数当关卡）');
}

// --- ★ 静态合规断言：源码里**没有**发奖能力（剥注释后再搜）---
{
    const raw = readFileSync(resolve(SRC_CORE, 'ShareService.ts'), 'utf8');
    const code = stripComments(raw);
    const banned = ['SaveService', 'inventory', 'addCoins', 'coins', 'grant', 'reward', '奖励'];
    const hit = banned.filter((w) => code.includes(w));
    ok(hit.length === 0,
        `★★ B20 分享服务**代码**里没有任何发奖能力（命中：${hit.join(',') || '无'}）`
        + ' —— 这条比行为断言更难绕：就算将来手滑接了发奖，这里也会红');

    // 诱导分享的那颗按钮必须已经**从代码里**删掉（第 53 轮合规改造）
    const gpRaw = readFileSync(resolve(SRC_UI, 'GamePage.ts'), 'utf8');
    const gp = stripComments(gpRaw);
    ok(!gp.includes('分享给好友'),
        '★★ B21 「分享给好友」（诱导分享按钮）已从 GamePage **代码**里彻底删除');
    ok(!gp.includes('或分享给好友'),
        '★ B22 广告面板里那句「看广告满 5 秒，或分享给好友」的文案也没了');
    // 反向核对：确认真的是"删掉了"而不是"文件读错了"
    ok(gp.includes('看广告复活') && gp.includes('BtnAdRevive'),
        'B23 反向核对：GamePage 代码里「看广告复活」链路仍在（证明上面两条不是"读空文件"式的假绿）');
}

// --- ★ 第 55 轮（T15）：首页「好友邀战」入口的**拉新文案分流** ---
//
//  【这一组在防什么】
//    `share(level)` 与 `share(level, 'invite')` 走的是**同一个** `wx.shareAppMessage`，
//    唯一的差别在标题。如果只断言"调用成功 / 有 query"，两条路**看起来一模一样** ——
//    就算 `mode` 参数被写漏、invite 分支从未生效，那几条断言照样全绿。
//    所以这里：① 直取载荷比对**文案本身**；② 再跑一条 level 路做**差分**
//    （标题必须不同）—— 差分才是"分流真的发生"的证据。

{
    const stat = installWx({ share: true });
    const s = new ShareService();
    s.setLevel(6);

    ok(s.share(12, 'invite') === true, 'B24 invite 路：有 wx ⇒ 返回 true');
    const inv = stat.shareAppMessage.at(-1);
    ok(!!inv && inv.title === SHARE.TITLE_INVITE,
        `★ B25 invite 路走**拉新文案**（实测 "${inv?.title}"）`);
    ok(!!inv && !inv.title.includes('12'),
        '★ B26 拉新文案里**不带**关卡号（是"邀好友来战"，不是"晒我的进度"）');
    ok(!!inv && inv.query === `${SHARE.QUERY_KEY}=12`,
        'B27 invite 路的 query 仍带关卡号（好友点进来照样拿得到落地提示）');
    ok(!!inv && !('imageUrl' in inv), 'B28 invite 路同样不带 imageUrl（与 level 路同契约）');

    // ---- 差分：两条路的标题必须真的不同 ----
    ok(s.share(12) === true, 'B29 level 路也照常能拉起');
    const lv = stat.shareAppMessage.at(-1);
    ok(!!lv && !!inv && lv.title !== inv.title,
        `★★ B30 差分：level 路与 invite 路的标题**确实不同**`
        + `（"${lv?.title}" vs "${inv?.title}"）—— 这条才是"分流真的生效"的证据`);
    ok(!!lv && lv.title.includes('12'), 'B31 level 路照旧带关卡号（没被 invite 分支改坏）');
    ok(stat.shareAppMessage.length === 2,
        'B32 调用计数 = 2（证明上面每条断言都真的调了一次，不是从缓存拿的旧值）');

    // ---- 静态合规：拉新文案里不得出现诱导字样 ----
    //  微信《小游戏运营规范》：「分享后获得奖励」= 诱导分享。
    //  这条比"人眼审文案"可靠 —— 文案将来被改也会在这里红。
    const banned2 = ['得', '领', '奖励', '分享后', '领取'];
    const hit2 = banned2.filter((w) => SHARE.TITLE_INVITE.includes(w));
    ok(hit2.length === 0,
        `★★ B33 邀战文案不含诱导字样（命中：${hit2.join(',') || '无'}）`
        + `—— 实测「${SHARE.TITLE_INVITE}」`);

    // ★ 负控（判据纪律：判据自身也要被验证）：
    //   `hit2.length === 0` 有两种成因 —— ① 文案确实干净；② **检查逻辑本身就是坏的**
    //   （比如 banned2 写错、filter 用反）。这两种在输出上长得一模一样。
    //   所以拿一条**故意含违规字样**的假文案喂给同一套检查，必须先报出来。
    const FAKE_BAD = '《某游戏》分享给好友得道具，立即领取！';
    const ctl = banned2.filter((w) => FAKE_BAD.includes(w));
    ok(ctl.length > 0,
        `★ B34 负控：同一套检查用在含诱导字样的假文案上**能报出来**（命中：${ctl.join(',')}）`
        + ' —— 证明 B33 的"无命中"不是因为检查坏了');
}

// ============================================================
//  C 组 · LoginService
// ============================================================
head('C 组 · LoginService（拿 code，绝不阻塞）');

{
    installWx(null);
    const s = new LoginService();
    ok(s.available === false, 'C1 无 wx ⇒ available=false');
    ok((await s.ensureCode()) === null, 'C2 无 wx ⇒ ensureCode() resolve(null)（**不 reject**）');
    ok(s.code === null, 'C3 无 wx ⇒ code 仍为 null');
}

{
    installWx({ login: (o) => { setTimeout(() => o.success({ code: 'CODE-ABC' }), 20); } });
    const s = new LoginService();
    const c = await s.ensureCode();
    ok(c === 'CODE-ABC', 'C4 成功路径：拿到 code');
    ok(s.code === 'CODE-ABC', 'C5 code 已缓存（getter 可读）');
    // 缓存命中不再调 wx.login
    const stat = installWx({ login: () => { throw new Error('不该再被调用'); } });
    ok((await s.ensureCode()) === 'CODE-ABC', 'C6 ★ 已有 code ⇒ 直接返回缓存，不再打接口');
    ok(stat.login === 0, 'C7 上游计数为 0，证明确实没再调 wx.login');
    s.invalidate();
    ok(s.code === null, 'C8 invalidate() 清掉缓存');
}

// --- 并发合并：10 个地方同时要 code，只调一次 ---
{
    let n = 0;
    installWx({ login: (o) => { n++; setTimeout(() => o.success({ code: 'CODE-ONE' }), 30); } });
    const s = new LoginService();
    const all = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => s.ensureCode()));
    ok(n === 1, `★ C9 并发合并：10 个并发请求只调 1 次 wx.login（实测 ${n}）`);
    ok(all.every((c) => c === 'CODE-ONE'), 'C10 10 个 promise 拿到同一个 code');
}

// --- 负控：fail ⇒ null ---
{
    installWx({ login: (o) => { setTimeout(() => o.fail({ errMsg: 'mock fail' }), 10); } });
    const s = new LoginService();
    ok((await s.ensureCode()) === null, '★ C11 负控：wx.login 失败 ⇒ null（不抛、不阻塞）');
}

// --- 负控：成功但没 code ---
{
    installWx({ login: (o) => { setTimeout(() => o.success({ errMsg: 'ok' }), 10); } });
    const s = new LoginService();
    ok((await s.ensureCode()) === null, '★ C12 负控：success 但 res.code 缺失 ⇒ null');
}

// --- 负控：login 抛异常 ---
{
    installWx({ login: () => { throw new Error('login 抛异常（模拟）'); } });
    const s = new LoginService();
    ok((await s.ensureCode()) === null, '★ C13 负控：wx.login 同步抛异常 ⇒ null');
}

// --- ★ 看门狗：永不回调 ---
{
    let loginCalls = 0;
    installWx({ login: () => { loginCalls++; /* 故意什么都不回调 */ } });
    const old = LOGIN.TIMEOUT_MS;
    LOGIN.TIMEOUT_MS = 100;
    const s = new LoginService();
    const t0 = Date.now();
    const c = await s.ensureCode();
    const dt = Date.now() - t0;
    ok(c === null, '★★ C14 看门狗：wx.login 永不回调 ⇒ 兜底 null（这是"绝不阻塞进游戏"的实现）');
    ok(dt >= 90 && dt < 2000, `C15 看门狗真的等到了超时点才放行（实测 ${dt}ms，阈值 100ms）`);
    ok(loginCalls === 1, 'C15b 只发起了一次 wx.login');
    // 复位超时后再要一次：**同一个实例**必须能重新发起（证明 `_inflight` 被清掉了，
    // 而不是"卡在第一次的 promise 上，以后永远拿不到"——那才是真正的"卡死"）。
    LOGIN.TIMEOUT_MS = old;
    const o2 = await Promise.race([s.ensureCode(), sleep(120).then(() => 'raced')]);
    ok(loginCalls === 2 && o2 === 'raced',
        `★ C16 看门狗触发后 _inflight 已清 ⇒ 新请求能重新发起（实测 wx.login 共 ${loginCalls} 次）`);
}

// ============================================================
//  D 组 · RankService（排行榜主域侧）
// ============================================================
head('D 组 · RankService（写云存储 + 通知开放数据域）');

{
    installWx(null);
    const s = new RankService();
    ok(s.available === false, 'D1 无 wx ⇒ available=false');
    let threw = false;
    try { s.pushScore(7); } catch { threw = true; }
    ok(!threw, 'D2 无 wx ⇒ pushScore 静默返回（排行榜绝不能影响开局）');
    ok(s.render() === false, 'D3 无 wx ⇒ render() 返回 false');
}

{
    // ★ 只有 setUserCloudStorage、没有 getOpenDataContext ⇒ 应判"不可用"
    globalThis.wx = { setUserCloudStorage: () => { /* noop */ } };
    ok(new RankService().available === false,
        '★ D4 available 要求**两个 API 都在**：只有写、不能画 ⇒ 判不可用');
    globalThis.wx = { getOpenDataContext: () => ({ postMessage: () => {} }) };
    ok(new RankService().available === false,
        '★ D5 反过来也一样：只有画、没数据源 ⇒ 判不可用');
}

{
    const stat = installWx({ rank: true });
    const s = new RankService();
    ok(s.available === true, 'D6 两个 API 都在 ⇒ available=true');

    s.pushScore(7);
    ok(stat.setUserCloudStorage.length === 1, 'D7 pushScore 调了一次 setUserCloudStorage');
    const kv = stat.setUserCloudStorage[0]?.KVDataList?.[0];
    ok(kv?.key === RANK_KEY, `D8 云端 key = "${RANK_KEY}"（开放数据域按同一字符串读）`);
    let parsed = null;
    try { parsed = JSON.parse(kv?.value ?? ''); } catch { /* 留给断言报 */ }
    ok(!!parsed, 'D9 value 是合法 JSON 字符串');
    ok(parsed?.wxgame?.score === 7,
        `★★ D10 ★ 值格式是官方约定的 wxgame.score（实测 ${JSON.stringify(parsed)}）`
        + ' —— 自己另起 {"level":7} 官方排行榜组件读不了');
    ok(Number.isInteger(parsed?.wxgame?.update_time) && parsed.wxgame.update_time > 1e9
        && parsed.wxgame.update_time < 1e10,
        `D11 update_time 是**秒级**整数（实测 ${parsed?.wxgame?.update_time}）`);

    // 幂等：同分不重发（接口有频次限制）
    s.pushScore(7);
    ok(stat.setUserCloudStorage.length === 1, '★ D12 同分不重复上报（接口有频次限制）');
    s.pushScore(9);
    ok(stat.setUserCloudStorage.length === 2, 'D13 换了分数 ⇒ 会上报');
    ok(JSON.parse(stat.setUserCloudStorage[1].KVDataList[0].value).wxgame.score === 9, 'D14 第二次传的是新分数');

    // 0 / 负数 = 还没通关过 ⇒ 不上报
    const before = stat.setUserCloudStorage.length;
    s.pushScore(0);
    s.pushScore(-3);
    ok(stat.setUserCloudStorage.length === before,
        '★ D15 score<=0（还没通关过）⇒ 不上报，避免把 0 分写进榜');

    ok(s.render() === true, 'D16 render() 返回 true');
    ok(stat.postMessage.length === 1 && stat.postMessage[0]?.type === 'render',
        `D17 通知开放数据域的消息是 {type:'render'}（实测 ${JSON.stringify(stat.postMessage[0])}）`);
}

// --- 负控：上报失败 ⇒ 静默，不影响游戏 ---
{
    installWx({ rank: true, rankFail: true });
    const s = new RankService();
    let threw = false;
    try { s.pushScore(4); } catch { threw = true; }
    ok(!threw, '★ D18 负控：setUserCloudStorage 回调 fail ⇒ 静默（不给玩家任何报错）');
}

// --- 负控：openDataContext 缺 postMessage ⇒ render 返回 false 不抛 ---
{
    globalThis.wx = { setUserCloudStorage: () => {}, getOpenDataContext: () => ({}) };
    let threw = false, r = null;
    try { r = new RankService().render(); } catch { threw = true; }
    ok(!threw && r === false, '★ D19 负控：开放数据域对象没有 postMessage ⇒ false，不抛');
}

installWx(null);
resetAdCfg();

// ============================================================
head('E 组 · 激励视频频次上限（★ 2026-10-07 用户拍板 → 落码于 `CFG.AD_QUOTA`）');
// ============================================================
//  为什么这几条值得断言：频次是**唯一会直接影响收入的数值**，而它只写在两处
//  （设计文档一张表 + `CFG.AD_QUOTA`）。两处漂移时**没有任何报错**，只会静默多放/少放广告。
//  ⇒ 这里既锁数值，也**对账文档**（判据 8：断言必须回到需求真源，不能"现状即期望"）。
{
    ok(AD_QUOTA.REVIVE_PER_RUN === 1 && AD_QUOTA.REVIVE_PER_DAY === 3,
        `★ E1 A1 复活 = 1 次/局 · 3 次/日（实测 ${AD_QUOTA.REVIVE_PER_RUN}/局 · ${AD_QUOTA.REVIVE_PER_DAY}/日）`);

    // ⚠️ 这条的要害在"**0 必须是 0**"：A2 拍板是「不限次数」，
    //    若有人顺手把 0 改成某个正整数，代码会**静默**开始限量，且不报错。
    ok(AD_QUOTA.TOOL_PER_DAY === 0,
        `★ E2 A2 局内换道具 = 不限次数（实测 TOOL_PER_DAY=${AD_QUOTA.TOOL_PER_DAY}，**0 = 不限**）`);

    ok(AD_QUOTA.SHOP_PER_TOOL_PER_DAY === 2,
        `★ E3 A3 商城领道具 = 每种道具 2 次/日（实测 ${AD_QUOTA.SHOP_PER_TOOL_PER_DAY}）`);

    // 差分：A2 与 A3 的语义**必须不同**（一个不限、一个限量）。
    // 若将来有人把两者接成"共用池子"，这两条会一起红 —— 那正是 2026-10-07 拍板作废的旧口径。
    ok(AD_QUOTA.TOOL_PER_DAY !== AD_QUOTA.SHOP_PER_TOOL_PER_DAY,
        '★ E4 差分：A2（不限）与 A3（限量）口径不同 —— 防"共用每日频次计数"的旧口径被改回来');

    // ★ 文档 ↔ 代码 对账：设计规则那张表必须同步改了（防止只改代码不改文档，或反之）
    const ruleDoc = readFileSync(resolve(HERE, '..', '..', 'game-5 · 设计规则.md'), 'utf8');
    const rowA2 = ruleDoc.split('\n').find((l) => l.includes('| A2 |')) ?? '';
    const rowA3 = ruleDoc.split('\n').find((l) => l.includes('| A3 |')) ?? '';
    ok(rowA2.includes('不限次数') && rowA3.includes('每种道具 2 次/日'),
        '★ E5 对账：设计规则「商业化点总表」A2 行含「不限次数」、A3 行含「每种道具 2 次/日」（文档与代码同步）');
}

// ============================================================
console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r53-core.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${OUT}/_r53-core.json`);
process.exit(fail ? 1 : 0);
