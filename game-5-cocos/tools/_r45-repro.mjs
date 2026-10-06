#!/usr/bin/env node
/**
 * 第 45 轮 · 排障：槽位显示错位 / 消除后残牌不显示
 *
 * 只做一件事：真机口径下走一遍「入槽 → 成组 → 消除 → 重排」，
 * 把**槽位格里的真实节点状态**打印出来（谁在哪个格、有没有图、坐标多少）。
 */
import { designToCss, navigateTo, openBrowser, seedAtLevel, sleep, startServer, waitFor } from './g5-cdp.mjs';

const DIST = new URL('../build/web-desktop/', import.meta.url).pathname;
const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { seedScript: seedAtLevel(1), width: 421, height: 927, scale: 1 });

const state = () => cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');

/** 槽位条每一格的真实渲染状态 */
const dumpSlots = () => cdp.ev(`(function () {
  var bar = window.__g5t.find('SlotBar');
  if (!bar) return { err: 'no SlotBar' };
  var cells = bar.children.map(function (cell, i) {
    var tiles = cell.children.filter(function (c) { return c.name.indexOf('SlotTile') === 0; });
    return {
      i: i, cellX: Math.round(cell.position.x),
      tiles: tiles.map(function (t) {
        var sprites = [];
        (function w(n) { n.children.forEach(function (c) {
          var s = c.getComponent('cc.Sprite');
          if (s) sprites.push({ n: c.name, sf: !!s.spriteFrame, act: c.activeInHierarchy,
            k: s.sizeMode });
          w(c); }); })(t);
        return { name: t.name, act: t.activeInHierarchy,
          x: Math.round(t.position.x), y: Math.round(t.position.y),
          sprites: sprites };
      }),
    };
  });
  return { cells: cells,
    slots: globalThis.__game5.slots(), faces: globalThis.__game5.slotFaces() };
})()`);

const SUIT = { 万: 0, 条: 1, 筒: 2 };
const NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const pf = (l) => ({ s: SUIT[l[1]], n: NUM[l[0]] });
/** 这一张点进去会不会凑成一组（与 MatchRule 同口径的保守版） */
function wm(faces, f) {
    const cs = faces.map(pf);
    const nf = pf(f);
    if (cs.filter((c) => c.s === nf.s && c.n === nf.n).length >= 2) return true;
    for (const d of [-2, -1, 0]) {
        const need = [d, d + 1, d + 2];
        if (!need.includes(0)) continue;
        if (need.every((k) => k === 0 || cs.some((c) => c.s === nf.s && c.n === nf.n + k))) return true;
    }
    return false;
}

await navigateTo(cdp, 'game');
await sleep(2200);
console.log('==> 已进主玩页');
console.log('    初始：', JSON.stringify(await state()));
console.log('    槽位初始：', JSON.stringify(await dumpSlots()));

/** 真实鼠标点一张牌 */
async function clickTile(want) {
    const list = await designToCss(cdp, await cdp.ev('globalThis.__game5.pickables()'));
    if (!list.length) return null;
    const faces = await cdp.ev('globalThis.__game5.slotFaces()');
    let cand;
    if (want === 'notmatch') cand = list.find((p) => !wm(faces, p.face));
    else if (want === 'match') cand = list.find((p) => wm(faces, p.face));
    if (!cand) cand = list[0];
    await cdp.click(cand.x, cand.y);
    return cand;
}

// 阶段 1：先塞两张**不会凑成**的牌（保证槽里有残留）
for (let i = 0; i < 2; i++) {
    const c = await clickTile('notmatch');
    await sleep(700);
    console.log(`  · 点入 ${c ? c.face : '(无)'} → ${JSON.stringify((await state()))}`);
}
console.log('\n==> 阶段 1 结束（应有 2 张残留）');
console.log(JSON.stringify(await dumpSlots(), null, 1));

// 阶段 2：一直点到发生消除为止
console.log('\n==> 阶段 2：触发一次成组消除');
for (let step = 0; step < 20; step++) {
    const before = await state();
    if (before.over) { console.log('  局面结束'); break; }
    const c = await clickTile('match');
    await sleep(1100);
    const after = await state();
    console.log(`  · 点入 ${c ? c.face : '(无)'} → 槽 ${before.slots}→${after.slots} 剩 ${before.remaining}→${after.remaining}`);
    if (after.slots < before.slots + 1 - 0.5) {
        console.log('  ★ 发生消除！');
        await sleep(700);
        break;
    }
}

console.log('\n==> 消除后的槽位真实状态：');
console.log(JSON.stringify(await dumpSlots(), null, 1));

await cdp.shot('/tmp/r45-slots.png');
console.log('截图 → /tmp/r45-slots.png');
close();
