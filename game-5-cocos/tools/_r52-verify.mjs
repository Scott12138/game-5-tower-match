#!/usr/bin/env node
/**
 * ============================================================
 *  _r52-verify.mjs · 第 52 轮 · 正式自证
 * ============================================================
 *  用户拍板后的交付范围（**优先批次 0 + 批次 1**）：
 *    T01 音效 / BGM 开关**解耦**（各自独立持久化）
 *    T02 暂停弹层「返回首页」加**二次确认**
 *    T03 设置「重置进度」加**二次确认**
 *    T05 前后台生命周期（`wx.onShow` / `wx.onHide` → 停 BGM + 停倒计时）
 *    配置：`DIFF.BLOCK` 6→7 · `GAME.NAME` 统一「麻麻大消除」
 *
 *  ── 判据口径（读断言前先读这段）────────────────────────────
 *  1. **T01 的"解耦"必须看存储位，不能看 toast 文案。**
 *     旧 bug 的症状正是"两个开关写同一个键"，只有**键级**断言能抓住它。
 *  2. **T05 在 web-desktop 里没有 `wx`**，所以注入一个**最小 fake wx**
 *     （只给 onHide/onShow/offHide/offShow）。注入安全性已核过：
 *     `wx.vibrateShort/vibrateLong` 两处调用都带 `typeof wx !== 'undefined'` 守卫，
 *     胶囊位置走 `Layout.capsuleInset()` 的固定值、**不读** `getMenuButtonBoundingClientRect`
 *     ⇒ 注入不会改变任何既有布局。
 *  3. **计时暂停要两个方向都测**：停 = `timeLeft` 不动，恢复 = 继续减。
 *     只测"停了"会把"计时器整个卡死不恢复"误判成通过。
 *  4. **破坏性操作的二次确认是"三态"判据**：确认层出现 → 取消后局面/存档**逐字段未变**
 *     → 确认后才真的执行。只测"弹了框"等于没测。
 *
 *  【用法】node tools/_r52-verify.mjs      # 全绿则 exit 0
 * ============================================================
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r52-verify');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 1;
/**
 * ⚠️ **必须 ≥ 3 关**：`PLAY.FREE_TIME_LEVELS = 2` ⇒ 前 2 关 `timeLimitOf()` 返回 0，
 *    `_timeLeft` 恒为 0，T05 的"倒计时停/走"两条判据**根本立不起来**
 *    （第一版用第 1 关，量到 `timeLeft 0 → 0`，两条都判不了）。
 */
const LEVEL = Number(process.env.G5_LEVEL || 3);

/**
 * 最小 fake wx —— 只补前后台四个方法。
 * ⚠️ 不补 `getMenuButtonBoundingClientRect`（胶囊位置走固定值，补了反而会改布局）。
 */
const FAKE_WX = [
    'globalThis.__fakeWx = { hide: null, show: null };',
    'globalThis.wx = {',
    '  onHide: function (cb) { globalThis.__fakeWx.hide = cb; },',
    '  onShow: function (cb) { globalThis.__fakeWx.show = cb; },',
    '  offHide: function () { globalThis.__fakeWx.hide = null; },',
    '  offShow: function () { globalThis.__fakeWx.show = null; },',
    '};',
    'globalThis.__fireAppHide = function () { if (globalThis.__fakeWx.hide) globalThis.__fakeWx.hide(); };',
    'globalThis.__fireAppShow = function () { if (globalThis.__fakeWx.show) globalThis.__fakeWx.show(); };',
].join('\n');

/**
 * 「垫高存档」注入脚本 —— 把存档改成**一眼能认出被清过**的形态。
 *
 * ⚠️ 注册顺序很重要：必须在 `seedAtLevel()` **之后**注册，
 *    同一次文档里的多个注入脚本按注册顺序执行，后注册的才能盖住 seed 的结果。
 */
const BUMP_SAVE = [
    '(function () {',
    '  try {',
    '    var raw = localStorage.getItem("game5.save.v1");',
    '    var d = raw ? JSON.parse(raw) : {};',
    '    d.level = 3; d.best = 2; d.coins = 999; d.plays = 7; d.cleared = 42;',
    '    localStorage.setItem("game5.save.v1", JSON.stringify(d));',
    '  } catch (e) { /* 无视 */ }',
    '})();',
].join('\n');

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
    rows.push({ name, ok, detail });
}
function head(t) { console.log(`\n=== ${t} ===`); }

// ------------------------------------------------------------
//  小工具
// ------------------------------------------------------------

/** 页面里是否存在某具名节点（find 只命中 activeInHierarchy ⇒ 等价于"看得见"） */
async function exists(name) {
    return await cdp.ev('!!window.__g5t.find(' + JSON.stringify(name) + ')');
}

/** 真实鼠标点某具名节点；找不到返回 false（**不抛**，交给断言处理） */
async function tap(name) {
    try { await tapNode(cdp, name); return true; } catch { return false; }
}

/** 点「某开关行」里的那颗开关（Sw 是行的子节点，名字会重名 ⇒ 必须按父行定位） */
async function tapSwitchOf(rowName) {
    const p = await cdp.ev(
        '(function () {\n'
        + '  var row = window.__g5t.find(' + JSON.stringify(rowName) + ');\n'
        + '  if (!row) return null;\n'
        + '  for (var i = 0; i < row.children.length; i++) {\n'
        + "    if (row.children[i].name === 'Sw') {\n"
        + '      var r = window.__g5t.worldToScreen(row.children[i]);\n'
        + '      return r ? { x: r.x, y: r.y } : null;\n'
        + '    }\n'
        + '  }\n'
        + '  return null;\n'
        + '})()');
    if (!p) return false;
    await cdp.click(p.x, p.y);
    return true;
}

/** 静音偏好的两个键（null = 从没写过） */
async function muteKeys() {
    return await cdp.ev('({ sfx: localStorage.getItem("game5.mute.sfx"),'
        + ' bgm: localStorage.getItem("game5.mute.bgm"),'
        + ' legacy: localStorage.getItem("game5.mute") })');
}

/** 存档原文（**逐字段比对**用原文，不做二次解析，避免"解析后相等"掩盖差异） */
async function saveRaw() {
    return await cdp.ev('localStorage.getItem("game5.save.v1")');
}

async function gameState() {
    return await cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');
}

async function reloadWait() {
    await cdp.send('Page.reload', {});
    cdp.logs.length = 0;
    await sleep(2600);
}

async function openSheet() {
    // 抽屉从底部升起（约 0.3s），等它停稳再量坐标
    await tap('Setting');
    await sleep(700);
}

// ------------------------------------------------------------
//  启动：注入 fake wx 并重载，让 GameRoot.onLoad 挂上前后台监听
// ------------------------------------------------------------
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_WX });
await cdp.ev('localStorage.removeItem("game5.mute.sfx");'
    + 'localStorage.removeItem("game5.mute.bgm");'
    + 'localStorage.removeItem("game5.mute"); "ok"');
await reloadWait();

// ============================================================
//  ① T01 · 音效 / BGM 开关解耦
// ============================================================
head('① T01 音效 / BGM 开关解耦（键级判据）');

await navigateTo(cdp, 'home');
await sleep(400);

const m0 = await muteKeys();
assert('起点：两个静音键都还没写过（默认都开）',
    m0.sfx === null && m0.bgm === null, JSON.stringify(m0));

await openSheet();
const sheetOpen = await exists('Sheet');
assert('设置抽屉已升起（Sheet 可见）', sheetOpen);

// --- 点「音效」开关 → 只应写 sfx 键 ---
const hitSfx = await tapSwitchOf('Row_音效');
await sleep(450);
const m1 = await muteKeys();
assert('真实鼠标点中「音效」行里的开关', hitSfx);
assert('★ 点音效开关：sfx 键被写为 1', m1.sfx === '1', `sfx=${m1.sfx}`);
assert('★ 点音效开关：**bgm 键纹丝不动**（旧 bug 就死在这里）',
    m1.bgm === m0.bgm, `bgm ${m0.bgm} → ${m1.bgm}`);
assert('旧键 game5.mute 不再被写入（新代码只用两个新键）',
    m1.legacy === null, `legacy=${m1.legacy}`);

// --- 点「背景音乐」开关 → 只应写 bgm 键 ---
const hitBgm = await tapSwitchOf('Row_背景音乐');
await sleep(450);
const m2 = await muteKeys();
assert('真实鼠标点中「背景音乐」行里的开关', hitBgm);
assert('★ 点音乐开关：bgm 键被写为 1', m2.bgm === '1', `bgm=${m2.bgm}`);
assert('★ 点音乐开关：**sfx 键保持 1 不变**（反方向也要成立）',
    m2.sfx === m1.sfx, `sfx ${m1.sfx} → ${m2.sfx}`);

// --- 再关掉音效 → sfx=0，bgm 仍=1（两个开关可以停在不同档位）---
await tapSwitchOf('Row_音效');
await sleep(450);
const m3 = await muteKeys();
assert('★ 再次点音效开关：sfx 1 → 0', m3.sfx === '0', `sfx=${m3.sfx}`);
assert('★ 此时两开关处于不同档位（sfx 关 / bgm 开）—— 旧版做不到',
    m3.sfx === '0' && m3.bgm === '1', JSON.stringify(m3));

// --- 重载 → 两个偏好各自保持 ---
await reloadWait();
await navigateTo(cdp, 'home');
await sleep(400);
const m4 = await muteKeys();
assert('★ 重载后两个偏好**各自保持**（sfx=0 / bgm=1，没有被互相覆盖）',
    m4.sfx === '0' && m4.bgm === '1', JSON.stringify(m4));

// 行为自证：重载后点一次音效键，应从 0 翻到 1（证明真的读回了持久值）
await openSheet();
await tapSwitchOf('Row_音效');
await sleep(450);
const m5 = await muteKeys();
assert('重载后点音效开关：0 → 1（证明确实读回了持久值，不是每次重置成默认）',
    m5.sfx === '1', `sfx=${m5.sfx}`);

writeFileSync(resolve(OUT, '_r52-mute.json'), JSON.stringify({ m0, m1, m2, m3, m4, m5 }, null, 2));

// ============================================================
//  ② T03 · 「重置进度」二次确认（home 页，与 T01 同页省一次导航）
// ============================================================
head('② T03 设置「重置进度」加二次确认');

// ★ 「垫高存档」的注入脚本 —— 必须**注册在 seed 之后**（同一次文档里按注册顺序执行），
//   否则 reload 时 seed 会把它又覆盖回去（第一版就是这么错的）。
//
//   【为什么非要垫高】`seedAtLevel()` 写出来的存档，与 `resetAll()` 之后的形态本来就
//   长得很像 ⇒ 判据**分不出"真的清了"与"本来就长这样"**，表现是前几条全绿、
//   只有最后一条红（最误导人的那种红）。
//   垫进 coins=999 / best=2 / plays=7 / cleared=42 之后，"清没清"才有唯一解。
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BUMP_SAVE });
await reloadWait();
await navigateTo(cdp, 'home');
await sleep(400);
await openSheet();

const save0 = await saveRaw();
assert('前置：存档里已垫入非默认值（coins=999 / best=2 / plays=7）',
    /"coins":\s*999/.test(save0 || ''), (save0 || '').slice(0, 84));

const hitReset = await tap('Link_重置进度');
await sleep(500);
assert('真实鼠标点中「重置进度」行', hitReset);
assert('★ 点一次**不对**清档 —— 而是弹出确认层', await exists('ConfirmDialog'));

const save1 = await saveRaw();
assert('★ 确认层出现时，存档**一个字节都没动**', save1 === save0,
    save1 === save0 ? '逐字节相同' : '存档已被改动（说明确认层没拦住）');

// --- 取消：确认层消失、存档仍不变 ---
await tap('BtnCancel');
await sleep(500);
const save2 = await saveRaw();
assert('点「取消」→ 确认层消失', !(await exists('ConfirmDialog')));
assert('★ 取消后存档**仍逐字节未变**（这条才是"防误触"的真判据）',
    save2 === save0, save2 === save0 ? '逐字节相同' : '存档被改动');

// --- 确认：存档真的被清 ---
await tap('Link_重置进度');
await sleep(500);
const beforeOk = await exists('ConfirmDialog');
await tap('BtnOk');
await sleep(700);
const save3 = await saveRaw();
assert('第二次点「重置进度」仍会弹确认层（不是"只拦第一次"）', beforeOk);
assert('★ 点「确认重置」→ 存档真的被清（coins 999→0 / best 2→0 / plays 7→0）',
    save3 !== save0 && !/"coins":\s*999/.test(save3 || '')
    && /"coins":\s*0/.test(save3 || '') && /"best":\s*0/.test(save3 || ''),
    save3 ? save3.slice(0, 90) : 'null');

writeFileSync(resolve(OUT, '_r52-reset.json'),
    JSON.stringify({ save0, save1, save2, save3 }, null, 2));

// ============================================================
//  ③ T02 · 暂停弹层「返回首页」二次确认（game 页）
// ============================================================
head('③ T02 暂停弹层「返回首页」加二次确认');

await reloadWait();
await navigateTo(cdp, 'game');
await sleep(600);

const st0 = await gameState();
assert('已进入主玩页（调试桥可用）', !!st0 && typeof st0.remaining === 'number',
    st0 ? `level ${st0.level} · 剩 ${st0.remaining} 张` : 'null');

await tap('Pause');
await sleep(600);
assert('暂停面板已弹出', await exists('PausePanel'));

const stPause = await gameState();
const hitBack = await tap('Btn_返回首页');
await sleep(600);
assert('真实鼠标点中「返回首页」', hitBack);
assert('★ 点「返回首页」**没有直接走** —— 而是弹出确认层',
    await exists('ConfirmDialog'));
assert('★ 确认层出现时**仍在主玩页**（没有被悄悄退掉）',
    await exists('Page_game'), 'Page_game 仍在');

// --- 取消：留在本局，局面逐字段未变 ---
await tap('BtnCancel');
await sleep(600);
const stCancel = await gameState();
assert('点「取消」→ 确认层消失', !(await exists('ConfirmDialog')));
assert('★ 取消后仍在主玩页', await exists('Page_game'));
assert('★ 取消后局面**逐字段未变**（remaining / cleared / slots 全部一致）',
    !!stCancel && stCancel.remaining === stPause.remaining
    && stCancel.cleared === stPause.cleared && stCancel.slots === stPause.slots,
    stCancel ? `剩 ${stCancel.remaining} · 已清 ${stCancel.cleared} · 槽 ${stCancel.slots}`
        : 'null');

// --- 确认：真的回首页 ---
await tap('Btn_返回首页');
await sleep(600);
await tap('BtnOk');
await sleep(1800);
assert('★ 点「确认返回」→ 真的回到首页', await exists('Page_home'),
    'Page_home ' + (await exists('Page_home') ? '在' : '不在'));

writeFileSync(resolve(OUT, '_r52-back.json'),
    JSON.stringify({ st0, stPause, stCancel }, null, 2));

// ============================================================
//  ④ T05 · 前后台生命周期（fake wx 触发真实回调链）
// ============================================================
head('④ T05 前后台：停 BGM + 停倒计时（两个方向都测）');

await reloadWait();
await navigateTo(cdp, 'game');
await sleep(1500);

const armed = await cdp.ev('typeof globalThis.__fakeWx?.hide === "function"'
    + ' && typeof globalThis.__fakeWx?.show === "function"');
assert('★ GameRoot 已把前后台回调挂到 wx 上（armLifecycle 跑过）', armed);

// --- 倒计时：先在后台停住 ---
const t0 = await gameState();
await sleep(2200);
const t1 = await gameState();
assert('前置：倒计时本来是在走的（否则"停下来"这条判不出来）',
    !!t1 && t1.timeLeft < t0.timeLeft, `timeLeft ${t0.timeLeft} → ${t1.timeLeft}`);

await cdp.ev('globalThis.__fireAppHide(); "ok"');
const h0 = await gameState();
await sleep(2600);
const h1 = await gameState();
assert('★ 切后台后倒计时**停住**（2.6s 内 timeLeft 不变）',
    !!h1 && h1.timeLeft === h0.timeLeft, `timeLeft ${h0.timeLeft} → ${h1.timeLeft}`);
assert('★ 切后台**没有**把弹层状态搅乱（paused 未被改动）',
    h1.paused === h0.paused, `paused ${h0.paused} → ${h1.paused}`);

// --- 回前台：倒计时必须**继续走**（防"整个卡死不恢复"）---
await cdp.ev('globalThis.__fireAppShow(); "ok"');
const s0 = await gameState();
await sleep(2600);
const s1 = await gameState();
assert('★ 回到前台后倒计时**继续走**（不是整个卡死）',
    !!s1 && s1.timeLeft < s0.timeLeft, `timeLeft ${s0.timeLeft} → ${s1.timeLeft}`);

// --- 负控：没有 fake wx 时，onHide 触发也不该影响局面 ---
const ctrl = await cdp.ev('(function () {'
    + ' try { globalThis.__fireAppHide(); globalThis.__fireAppShow(); return true; }'
    + ' catch (e) { return false; } })()');
assert('负控：连发 hide/show 不抛异常', ctrl === true);

writeFileSync(resolve(OUT, '_r52-lifecycle.json'),
    JSON.stringify({ t0, t1, h0, h1, s0, s1 }, null, 2));

// ============================================================
//  ⑤ 配置项落地
// ============================================================
head('⑤ 拍板配置项（在**构建产物**里直查）');

// 游戏名是编译期常量、活在模块作用域里 ⇒ 页面侧拿不到，只能查产物。
// ⚠️ 产物里的中文常被转成 `\uXXXX`（记忆里的坑：grep 原文会**假阴性**）⇒ 两种形态都要认。
const jsFiles = [];
(function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = resolve(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) jsFiles.push(p);
    }
})(DIST);

const NEW_RAW = '麻麻大消除';
const NEW_ESC = '\\u9ebb\\u9ebb\\u5927\\u6d88\\u9664';
const OLD_RAW = '叠塔消消';
const OLD_ESC = '\\u53e0\\u5854\\u6d88\\u6d88';
/**
 * ⚠️ **只在"字符串字面量"里判，注释不算。**
 *   本轮改动的注释里就写着「此前这里是「叠塔消消」」，而 debug 构建会把注释**原样打进产物**
 *   ⇒ 第一版按"全文含旧名"判，被自己的注释判红了一次（假红）。
 *   真风险是"某个**面向玩家**的字符串常量还是旧名"，它的形态只有两种：
 *   带引号的原文、或 `\uXXXX` 转义（转义只可能由字符串触发，注释不会被转义）。
 */
let newLit = 0, oldLit = 0;
for (const f of jsFiles) {
    const s = readFileSync(f, 'utf8');
    if (s.includes("'" + NEW_RAW + "'") || s.includes('"' + NEW_RAW + '"') || s.includes(NEW_ESC)) newLit++;
    if (s.includes("'" + OLD_RAW + "'") || s.includes('"' + OLD_RAW + '"') || s.includes(OLD_ESC)) oldLit++;
}
assert('★ 构建产物里游戏名的**字符串字面量** =「麻麻大消除」', newLit > 0,
    `${newLit} 个产物文件命中（共扫 ${jsFiles.length} 个 js）`);
assert('★ 没有任何字符串字面量还写着旧名「叠塔消消」', oldLit === 0, `残留 ${oldLit} 个文件`);

writeFileSync(resolve(OUT, '_r52-cfg.json'),
    JSON.stringify({ jsFiles: jsFiles.length, newLit, oldLit }, null, 2));

// ============================================================
console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r52-verify.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${OUT}/_r52-verify.json`);

await close();
try { proc.kill(); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
