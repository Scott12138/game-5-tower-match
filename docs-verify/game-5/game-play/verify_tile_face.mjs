/**
 * 牌面接入验收（第 28 轮 A4 · 第 32 轮改档）
 *
 * 验收对象：主玩页工作稿把 IMG_FACE 从「3 张样张」换成「27 张真母版」之后，
 *   ① ★ **牌堆里 0 张库外牌**（牌库 = 万/条/筒 × 1~9 = 27 种；字牌不得出现）
 *        —— 第 29 轮修正：旧版此脚本把「中」当作**期望值**断言（`a.zhong`），
 *           于是生成器 8% 概率注入红中的 bug 被这条错误期望**盖住了**，12/12 全绿却漏报。
 *           现在改为**反向断言**：库外牌数必须为 0、牌面文字里不得出现「中」。
 *   ② 默认（img 模式）牌堆里每张牌都挂上了真母版 <img class="faceImg">；
 *   ③ 每张母版是 @2x 224×298（naturalWidth/naturalHeight）；★ 第 33 轮由 192×256 抬升
 *   ④ 全部图片加载成功（无破图）；
 *   ⑤ 真实点「牌面」按钮切 svg → faceImg 归零；再切回 img → 恢复；
 *   ⑥ 真实点牌入槽 → 槽位 mini 也带真母版；
 *   ⑦ 运行期零 JS 异常；
 *   ⑧ 顺带存一张实机截图（真母版牌堆）。
 *
 * ★ 第 32 轮改动（用户第 4 条拍板「演示档位跟随真实牌数」）：
 *   旧版把档位写死成 12 / 36 / 96 三档（`for (const want of [12,96])` + `pileCount === 36`），
 *   现在档位 = PILE_DATA.levels 里的**真实关卡**（由 inject_pile_data.py 从 levels.json 注入）。
 *   ⇒ 本脚本改为**从页内 PILE_DATA 读取期望张数**，逐关循环审计，不再写死任何数字。
 *
 * 为什么必须真实事件：本项目既有教训 —— 截图 + 直接调函数会绕过事件层。
 * CDP 三重超时（命令 30s / 握手 10s / 端口 60s）：本机出现过握手静默挂死。
 *
 * 用法：node verify_tile_face.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const PORT = 9361;
const PAGE = 'file://' + path.join(ROOT, 'game-5-主玩页-排版.html').split('/').map(encodeURIComponent).join('/');
const SHOT = path.join(ROOT, 'docs-verify/game-5/game-play', '59-主玩页-真母版接入-实机.png');

const TILE_NW = 224, TILE_NH = 298;   // ★ 第 33 轮：192×256 → 224×298（L1 拍板）

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log('✅ ' + msg)) : (fail++, console.log('❌ ' + msg)); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-face-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=1400,1700', PAGE,
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;

const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时(${ms}ms)：${method}`)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function main() {
try {
  let targets = null, lastErr = null;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const all = (await r.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      targets = all.filter(t => (t.url || '').startsWith('file://'));
      if (!targets.length) targets = all;
      if (targets.length) break;
      lastErr = new Error('端口已开但暂无 page target');
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  if (!targets?.length) throw new Error(`devtools 未就绪 · ${lastErr?.message || lastErr}`);

  const wsUrl = targets[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('WebSocket 握手超时(10s)')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = e => { clearTimeout(t); rej(new Error('WebSocket 握手失败：' + (e?.message || 'non-101'))); };
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej, t } = pending.get(m.id); pending.delete(m.id); clearTimeout(t);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') { events.push(m); }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await sleep(2200);

  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('求值失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const clickSel = async (sel, waitMs = 700) => {
    const r = JSON.parse(await evalJS(`(() => {
      const e = document.querySelector('${sel}'); e.scrollIntoView({block:'center'});
      const b = e.getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2, y:b.top+b.height/2});
    })()`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
    await sleep(50);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      await sleep(40);
    }
    await sleep(waitMs);
    return r;
  };

  // ① 进 play（载入时是赠礼过场，会盖住主界面）
  await clickSel('#btnStart', 1800);
  const phase = await evalJS('phase');
  ok(phase === 'play', `真实点「开始挑战」→ phase=${phase}`);

  /* ★ 牌库审计：库外牌（kind 不在三花色内 / num 不在 1~9）+ 牌面文字里出现「中」 */
  const auditJS = sel => `(() => {
    const SUITS = ['wan','tiao','tong'];
    const tiles = [...document.querySelectorAll('${sel}')];
    const bad = tiles.filter(t => {
      const dk = t.dataset.kind, dn = +t.dataset.num;
      return !(SUITS.indexOf(dk) >= 0 && dn >= 1 && dn <= 9);
    }).map(t => (t.dataset.kind || '?') + '-' + (t.dataset.num || '?'));
    const zhongText = tiles.filter(t => t.textContent.indexOf('中') >= 0).length;
    return JSON.stringify({ n: tiles.length, bad, zhongText, deckSize: DECK.length,
      kinds: [...new Set(tiles.map(t => t.dataset.kind))].sort() });
  })()`;

  const peek = async () => JSON.parse(await evalJS(`(() => {
    const tiles = [...document.querySelectorAll('#pile .tile')];
    const imgs = tiles.flatMap(t => [...t.querySelectorAll('img.faceImg')]);
    return JSON.stringify({
      mode: faceMode,
      tiles: tiles.length,
      withImg: tiles.filter(t => t.querySelector('img.faceImg')).length,
      withSvg: tiles.filter(t => t.querySelector('svg')).length,
      imgOk: imgs.every(i => i.complete && i.naturalWidth > 0),
      imgN: imgs.length,
      sizes: [...new Set(imgs.map(i => i.naturalWidth + 'x' + i.naturalHeight))],
      broken: [...document.images].filter(i => (i.getAttribute('src')||'') && !(i.complete && i.naturalWidth>0)).map(i => i.getAttribute('src')),
    });
  })()`));

  // ② 默认 img 模式
  const a = await peek();
  ok(a.mode === 'img', `页面默认牌面模式 = ${a.mode}（应为 img）`);
  ok(a.withImg === a.tiles,
     `牌堆 ${a.tiles} 张**全部**挂真母版（${a.withImg}/${a.tiles}）· 走矢量 ${a.withSvg} 张`);
  ok(a.imgOk && a.broken.length === 0, `真母版全部加载成功（${a.imgN} 张内联 img · 破图 ${a.broken.length} 张）`);
  ok(a.sizes.length === 1 && a.sizes[0] === `${TILE_NW}x${TILE_NH}`,
     `母版原件尺寸集合 = ${JSON.stringify(a.sizes)}（应只有 ${TILE_NW}x${TILE_NH}）`);

  // ★ 牌库审计（当前档）
  const au0 = JSON.parse(await evalJS(auditJS('#pile .tile')));
  ok(au0.bad.length === 0 && au0.zhongText === 0,
     `★ 当前档牌库审计：牌库 ${au0.deckSize} 种 · 实际花色 ${JSON.stringify(au0.kinds)} · 库外牌 ${au0.bad.length} 张 ${JSON.stringify(au0.bad)} · 牌面「中」字 ${au0.zhongText} 处`);

  // ③ 真实点牌 → 槽位 mini 也带真母版
  const firstLive = JSON.parse(await evalJS(`(() => {
    const t = document.querySelector('#pile .tile.live:not(.imgmode)') || document.querySelector('#pile .tile.live');
    const b = t.getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2, y:b.top+b.height/2});
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: firstLive.x, y: firstLive.y, buttons: 0 });
  await sleep(50);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: firstLive.x, y: firstLive.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(40);
  }
  await sleep(800);
  const slot = JSON.parse(await evalJS(`(() => {
    const minis = [...document.querySelectorAll('#slots .slot .mini')];
    const imgs = minis.flatMap(m => [...m.querySelectorAll('img.faceImg')]);
    return JSON.stringify({ minis: minis.length, withImg: minis.filter(m=>m.querySelector('img.faceImg')).length,
      imgOk: imgs.every(i=>i.complete&&i.naturalWidth>0), n: imgs.length });
  })()`));
  ok(slot.minis > 0, `真实点牌入槽：槽位内有 ${slot.minis} 张 mini`);
  ok(slot.withImg === slot.minis, `槽位 mini 挂真母版 ${slot.withImg}/${slot.minis} 张（img 加载成功 = ${slot.imgOk}）`);

  // ④ 切 svg → faceImg 归零；切回 img → 恢复
  await clickSel('#bFace', 900);
  const b = await peek();
  ok(b.mode === 'svg' && b.withImg === 0 && b.withSvg === b.tiles,
     `真实点「牌面」→ 模式 ${a.mode}→${b.mode}，真母版 ${a.withImg}→${b.withImg} 张，全部回矢量（${b.withSvg}/${b.tiles}）`);
  await clickSel('#bFace', 900);
  const c = await peek();
  ok(c.mode === 'img' && c.withImg === a.withImg,
     `再点一次 → 模式 ${b.mode}→${c.mode}，真母版恢复 ${b.withImg}→${c.withImg} 张（与初始一致 = ${c.withImg === a.withImg}）`);

  // ④b ★ 全档位覆盖牌库审计：真实点「牌堆」按钮依次走完 PILE_DATA.levels 里的**真实关卡**
  const tiers = JSON.parse(await evalJS(`JSON.stringify(PILE_DATA.levels.map(l => ({ lv:l.lv, n:l.n, L:l.L, w:l.w, h:l.h })))`));
  console.log(`   页内演示档位（真实关卡）：${tiers.map(t => `L${t.lv}=${t.n}张/${t.L}层/${t.w}x${t.h}`).join(' · ')}`);
  ok(tiers.length >= 2, `页内注入 ${tiers.length} 个真实演示档位（≥2）`);
  const idx0 = await evalJS('pileIdx');
  for (let k = 1; k <= tiers.length; k++) {
    await clickSel('#bPile', 900);
    const want = tiers[(idx0 + k) % tiers.length];
    const got = await evalJS('pileCount');
    const lvNow = await evalJS('PILE_DATA.levels[pileIdx].lv');
    const au = JSON.parse(await evalJS(auditJS('#pile .tile')));
    ok(lvNow === want.lv && got === want.n && au.n === want.n && au.bad.length === 0 && au.zhongText === 0,
       `★ L${want.lv} 档牌库审计：pileCount=${got}（应 ${want.n}）· 牌 ${au.n} 张 · 花色 ${JSON.stringify(au.kinds)} · 库外牌 ${au.bad.length} 张 ${JSON.stringify(au.bad)} · 「中」字 ${au.zhongText} 处`);
  }
  ok(await evalJS('pileIdx') === idx0 && await evalJS('pileCount') === tiers[idx0].n,
     `循环 ${tiers.length} 次后回到首档（pileIdx=${await evalJS('pileIdx')} · pileCount=${await evalJS('pileCount')} = ${tiers[idx0].n}）`);

  // ⑤ 无破图 + 零异常
  const brokenAll = JSON.parse(await evalJS(`JSON.stringify([...document.images].filter(i=>(i.getAttribute('src')||'')&&!(i.complete&&i.naturalWidth>0)).map(i=>i.getAttribute('src')))`));
  ok(brokenAll.length === 0, `全页无破图（${brokenAll.length} 张）`);
  ok(events.length === 0, `运行期 JS 异常 ${events.length} 条`);

  // ⑥ 实机截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log(`\n实机截图：${path.relative(ROOT, SHOT)}（${(fs.statSync(SHOT).size / 1024).toFixed(0)} KB）`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
}

console.log('════ 牌面接入验收（真母版 27 张 · 真实鼠标事件）════');
main().then(() => {
  console.log(`\n断言 ${pass}/${pass + fail} 通过；运行期异常 ${events.length} 条`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('执行失败：', e.message); process.exit(1); });
