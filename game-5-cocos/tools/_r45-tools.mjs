#!/usr/bin/env node
/**
 * 第 45 轮 · 道具全量检验
 *
 * 目的：回答「刚刚使用道具没有成功」—— 四个道具（消除/移出/洗牌/加槽）
 *      到底实现了没有、什么条件下才生效。
 *
 * 手法：真实鼠标点击工具格（不绕过事件层）。
 * 赠礼在本局开局时随机，测试需要固定库存 ⇒ 在开局页把 `_page._gift` 换成
 * 「四件各 1」，再点「开始挑战」，于是 `beginRun()` 会把它写进本局道具栏。
 * ⚠️ 只改赠礼卡背后的数据，不改游戏代码。
 */
import { designToCss, openBrowser, seedAtLevel, sleep, startServer, tapNode, waitFor } from './g5-cdp.mjs';

const DIST = new URL('../build/web-desktop/', import.meta.url).pathname;
const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { seedScript: seedAtLevel(1), width: 421, height: 927, scale: 1 });

const R = [];
const judge = (name, pass, detail = '') => {
    R.push({ name, pass: !!pass });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

const state = () => cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');
/** 工具栏 4 格的角标文字 */
const badges = () => cdp.ev(`(function () {
  var b = window.__g5t.find('ToolBar'); if (!b) return null;
  var out = {};
  b.children.filter(function (c) { return c.name.indexOf('Tool_') === 0; }).forEach(function (c) {
    var s = null;
    (function w(n) { n.children.forEach(function (k) {
      var l = k.getComponent('cc.Label'); if (l) s = l.string; w(k); }); })(c);
    out[c.name] = s;
  });
  return out;
})()`);
/** 桌上所有存活牌的位置（洗牌对账用） */
const positions = () => cdp.ev(`(function () {
  var p = window.__g5t.find('Page_game');
  var comps = p.getComponents(cc.Component);
  var c = comps.filter(function (x) { return x && ('_board' in x); })[0];
  if (!c) return null;
  return c._board.tiles.filter(function (t) { return t.alive; })
    .map(function (t) { return t.id + ':' + t.x.toFixed(3) + ',' + t.y.toFixed(3); }).sort();
})()`);
/** ★ 仅用于验证 `toolErase` 的执行路径：把槽位数据直接摆成「一组同面」
 *  （正常玩法下做不到 —— 自动判定会把所有组当场消掉，正因如此才要单独验它） */
const forceSlots = () => cdp.ev(`(function () {
  var p = window.__g5t.find('Page_game');
  var comps = p.getComponents(cc.Component);
  var c = comps.filter(function (x) { return x && ('_board' in x); })[0];
  if (!c) return 'no comp';
  var byFace = {};
  c._board.tiles.forEach(function (t) {
    if (!t.alive) return;
    (byFace[t.face] = byFace[t.face] || []).push(t.id);
  });
  var trio = null;
  Object.keys(byFace).forEach(function (k) { if (!trio && byFace[k].length >= 3) trio = byFace[k].slice(0, 3); });
  if (!trio) return 'no trio';
  c._slots.length = 0;
  trio.forEach(function (id) { c._slots.push(id); });
  return trio.join(',');
})()`);

async function clickTile(pred) {
    const list = await designToCss(cdp, await cdp.ev('globalThis.__game5.pickables()'));
    if (!list.length) return null;
    const t = pred ? list.find(pred) : list[0];
    if (!t) return null;
    await cdp.click(t.x, t.y);
    return t;
}

console.log('==> 进主玩页');
await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 30000, 'UIRoot');
await sleep(2600);
await tapNode(cdp, 'BtnStart');
await waitFor(cdp, 'window.__g5t.find("BtnGo") !== null', 15000, '开局页');
await sleep(4200);

// 劫持赠礼 → 四件各 1（只动数据，不动代码）
const hijack = await cdp.ev(`(function () {
  var page = window.__g5t.find('Page_gameStart');
  if (!page) return 'no page';
  var c = page.getComponents(cc.Component).filter(function (x) { return x && ('_gift' in x); })[0];
  if (!c) return 'no comp';
  c._gift = { a: 3, b: 2, sum: 5, tier: '常规档',
              items: { erase: 1, move: 1, shuffle: 1, addslot: 1 }, revive: 0 };
  return 'ok';
})()`);
console.log('    赠礼劫持：', hijack);

await tapNode(cdp, 'BtnGo');
await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');
await sleep(2400);

console.log('    初始状态：', JSON.stringify(await state()));
console.log('    道具角标：', JSON.stringify(await badges()));

// ---------- ① 加槽 ----------
console.log('\n───── ① 加槽 ─────');
{
    const a = await state();
    await tapNode(cdp, 'Tool_addslot');
    await sleep(1400);
    const b = await state();
    judge('加槽：槽位上限 +1', b.slotMax === a.slotMax + 1, `${a.slotMax} → ${b.slotMax}`);
    console.log('    角标：', JSON.stringify(await badges()));
}

// ---------- ② 移出 ----------
console.log('\n───── ② 移出 ─────');
{
    const t = await clickTile();
    await sleep(1000);
    const a = await state();
    judge('先点 1 张牌入槽', a.slots === 1 && !!t, `槽内 ${a.slots} 张（${t ? t.face : '-'}）`);
    await tapNode(cdp, 'Tool_move');
    await sleep(1400);
    const b = await state();
    judge('移出：槽内 -1 且牌回到桌上', b.slots === a.slots - 1 && b.remaining === a.remaining + 1,
        `槽 ${a.slots}→${b.slots} · 桌上 ${a.remaining}→${b.remaining}`);
    console.log('    角标：', JSON.stringify(await badges()));
}

// ---------- ③ 洗牌 ----------
console.log('\n───── ③ 洗牌 ─────');
{
    const a = await positions();
    await tapNode(cdp, 'Tool_shuffle');
    await sleep(1500);
    const b = await positions();
    const same = JSON.stringify(a) === JSON.stringify(b);
    judge('洗牌：桌上牌的位置真的重排了', !!a && !!b && !same,
        `前 3 位 ${JSON.stringify((a || []).slice(0, 3))} → ${JSON.stringify((b || []).slice(0, 3))}`);
    console.log('    角标：', JSON.stringify(await badges()));
}

// ---------- ④ 消除（情形 A：槽里没有可消组 —— 正常玩法下的**必然**情形）----------
console.log('\n───── ④ 消除（情形 A：槽里没有成组的牌）─────');
{
    // 先把槽里填 3 张**互不成组**的牌
    const faces = () => cdp.ev('globalThis.__game5.slotFaces()');
    for (let i = 0; i < 3; i++) {
        const cur = await faces();
        const t = await clickTile((p) => !cur.includes(p.face) && !cur.includes(''));
        await sleep(950);
        if (!t) break;
    }
    const a = await state();
    console.log(`    槽内 ${a.slots} 张：${JSON.stringify(await faces())}`);
    const bd0 = await badges();
    await tapNode(cdp, 'Tool_erase');
    await sleep(1500);
    const b = await state();
    const bd1 = await badges();
    judge('消除：无组时**不消耗**道具、不改变局面',
        b.cleared === a.cleared && b.slots === a.slots && bd1.Tool_erase === bd0.Tool_erase,
        `已清 ${a.cleared}→${b.cleared} · 槽 ${a.slots}→${b.slots} · 角标 ${bd0.Tool_erase}→${bd1.Tool_erase}`);
}

// ---------- ⑤ 消除（情形 B：槽里确实有一组 —— 正常玩法到不了，直接验代码路径）----------
console.log('\n───── ⑤ 消除（情形 B：直接摆一组进槽，只验代码路径）─────');
{
    const trio = await forceSlots();
    console.log('    强行摆入槽的三张同面牌 id：', trio);
    await sleep(700);
    const bd0 = await badges();
    const a = await state();
    await tapNode(cdp, 'Tool_erase');
    await sleep(1800);
    const b = await state();
    const bd1 = await badges();
    judge('消除：槽里真有组时能消掉（证明实现本身是通的）',
        b.cleared > a.cleared, `已清 ${a.cleared}→${b.cleared} · 槽 ${a.slots}→${b.slots}`);
    judge('消除：生效时**消耗** 1 个道具', bd1.Tool_erase !== bd0.Tool_erase,
        `角标 ${bd0.Tool_erase} → ${bd1.Tool_erase}`);
}

console.log(`\n==> 合计 ${R.filter((r) => r.pass).length}/${R.length} 通过`);
await cdp.shot('/tmp/r45-tools.png');
close();
