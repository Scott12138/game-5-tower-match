/**
 * 第 32 轮归档抓图（#169）
 * ========================
 * 抓两组图，全部来自**真实浏览器渲染**（无头 Chrome + CDP）：
 *
 *  【组 1】主玩页 · 三个**真实关卡**档位（L1 / L10 / L30）
 *     - 整屏 750×1334（含顶栏 / 底带 / 槽位 / 道具栏），每档一张（真母版）
 *  【组 2】30 关总览 + 第 30 关放大与逐层条（56-关卡表与牌堆预览.html）
 *     - 总览整页；L30 展开卡特写（看 10 层结构与 4 段分段条）
 *
 * 输出（docs-verify/game-5/game-play/）：
 *   60-主玩页真实牌堆-L{1,10,30}-整屏.png
 *   61-30关总览-第32轮.png
 *   62-第30关-10层138张-放大与逐层条.png
 *
 * ★ 本机无头 Chrome 必须带 `--no-sandbox`（否则沙箱初始化失败：脚本秒退、零输出、exit 0）。
 * ★ 抓「整页」时要临时打开 `overflow:hidden`（预览页 body）并用 captureBeyondViewport，
 *   否则只能拿到首屏 —— 这是本项目第 31 轮踩过的坑。
 *
 * 用法：node capture_round32.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const HERE = path.join(ROOT, 'docs-verify/game-5/game-play');
const PORT = 9391;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cap32-'));

let id = 0;
const pending = new Map();
let ws, evs = [];
const send = (method, params = {}, ms = 60000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时(${ms}ms)：${method}`)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function connect(url) {
  ws = new WebSocket(url);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws 握手超时')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error('ws 错误')); };
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej, t } = pending.get(m.id); pending.delete(m.id); clearTimeout(t);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') evs.push(m);
  };
  await send('Page.enable'); await send('Runtime.enable');
}

async function waitTarget(port, filter = 'file://') {
  for (let i = 0; i < 240; i++) {
    try {
      const all = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
        .filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      const hit = all.filter(t => (t.url || '').startsWith(filter));
      const use = hit.length ? hit : all;
      if (use.length) return use[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1');
    } catch { /* 启动中 */ }
    await sleep(250);
  }
  throw new Error('devtools 未就绪');
}

const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const shot = async (file, clip, { scale = 1, ms = 240000 } = {}) => {
  const p = await send('Page.captureScreenshot', clip
    ? { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale } }
    : { format: 'png', captureBeyondViewport: true }, ms);
  const out = path.join(HERE, file);
  fs.writeFileSync(out, Buffer.from(p.data, 'base64'));
  console.log(`  → ${file}（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
  return out;
};

async function main() {
  /* ═════════ 组 1：主玩页三个真实档位 ═════════ */
  const pageMain = 'file://' + path.join(ROOT, 'game-5-主玩页-排版.html').split('/').map(encodeURIComponent).join('/');
  const chrome1 = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    '--window-size=1400,1700', pageMain,
  ], { stdio: 'ignore' });

  console.log('【组 1】主玩页 · 真实关卡档位');
  await connect(await waitTarget(PORT));
  await sleep(2400);

  const clickSel = async (sel, waitMs = 700) => {
    const r = JSON.parse(await evalJS(`(() => {
      const e = document.querySelector('${sel}');
      let b = e.getBoundingClientRect();
      const vh = window.innerHeight, pad = 24;
      if (b.bottom > vh - pad) window.scrollBy(0, b.bottom - vh + pad);
      else if (b.top < pad) window.scrollBy(0, b.top - pad);
      b = e.getBoundingClientRect();
      return JSON.stringify({x:b.left+b.width/2, y:b.top+b.height/2});
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

  await clickSel('#btnStart', 1800);
  console.log(`  phase = ${await evalJS('phase')}`);
  const tiers = JSON.parse(await evalJS(`JSON.stringify(PILE_DATA.levels.map(l => ({ lv:l.lv, n:l.n, L:l.L, w:l.w, h:l.h, nl:l.nl, st:l.st })))`));

  const clipScreen = async () => JSON.parse(await evalJS(`(() => { const b = $('screen').getBoundingClientRect();
    return JSON.stringify({x:b.left, y:b.top, width:b.width, height:b.height}); })()`));

  for (const t of tiers) {
    for (let g = 0; g < tiers.length + 2; g++) {
      if (await evalJS('PILE_DATA.levels[pileIdx].lv') === t.lv) break;
      await clickSel('#bPile', 900);
    }
    if (await evalJS('faceMode') !== 'img') await clickSel('#bFace', 800);
    await evalJS(`document.querySelector('.frame').scrollTop = 0; 'ok'`);
    const got = JSON.parse(await evalJS(`JSON.stringify({ n:__mp.pile(), live:$('mPile').textContent.trim() })`));
    console.log(`  L${t.lv}：渲染 ${got.n} 张 / 可点 ${t.nl} · 侧栏「${got.live}」`);
    await shot(`60-主玩页真实牌堆-L${t.lv}-整屏.png`, await clipScreen());
  }

  try { ws.close(); } catch {}
  chrome1.kill('SIGKILL');
  await sleep(600);

  /* ═════════ 组 2：30 关总览 / L30 放大与逐层条 ═════════ */
  const pageLv = 'file://' + path.join(HERE, '56-关卡表与牌堆预览.html').split('/').map(encodeURIComponent).join('/');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cap32b-'));
  const PORT2 = PORT + 1;
  const chrome2 = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT2}`, `--user-data-dir=${dir2}`,
    '--window-size=1700,1400', pageLv,
  ], { stdio: 'ignore' });

  console.log('\n【组 2】30 关总览 / 第 30 关放大');
  await connect(await waitTarget(PORT2));
  for (let i = 0; i < 80; i++) {
    if (await evalJS('!!window.__ready && document.querySelectorAll(".card").length === 30').catch(() => false)) break;
    await sleep(250);
  }
  console.log(`  卡片数 ${await evalJS('document.querySelectorAll(".card").length')} · __ready=${await evalJS('!!window.__ready')}`);

  /* 整页总览：先把页面滚动容器放开，再用 captureBeyondViewport */
  await evalJS(`(() => {
    document.documentElement.style.overflow = 'visible';
    document.body.style.overflow = 'visible';
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') el.style.overflowY = 'visible';
    });
    return 'ok';
  })()`);
  await sleep(400);
  const full = JSON.parse(await evalJS(`JSON.stringify({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`));
  console.log(`  总览整页 ${full.w}×${full.h}（1:1 输出，避免 2x 软件光栅超时）`);
  await shot('61-30关总览-第32轮.png', { x: 0, y: 0, width: full.w, height: full.h }, { scale: 0.5 });

  /* L30 展开卡特写 —— 必须**真实点击**展开（未展开时卡片只有一列宽、且不渲染逐层条） */
  await evalJS(`(() => {
    const c = document.querySelector('.card[data-lv="30"]');
    c.scrollIntoView({block:'start'}); return 'ok';
  })()`);
  await sleep(400);
  const c30 = await evalJS(`(() => { const c = document.querySelector('.card[data-lv="30"]');
    const r = c.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2, y:Math.max(4, Math.min(r.top+40, window.innerHeight-40))}); })()`);
  const p30 = JSON.parse(c30);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p30.x, y: p30.y, buttons: 0 });
  await sleep(60);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: p30.x, y: p30.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(50);
  }
  await sleep(2600);
  const info = JSON.parse(await evalJS(`(() => {
    const c = document.querySelector('.card[data-lv="30"]');
    return JSON.stringify({ open: c.classList.contains('open'),
      bars: c.querySelectorAll('.layRow .layBar, .layBar').length,
      big: c.querySelectorAll('.big .tk').length, mini: c.querySelectorAll('.mini .tk').length,
      h: c.getBoundingClientRect().height });
  })()`));
  console.log(`  L30 卡片：open=${info.open} · 逐层条 ${info.bars} 条 · 放大视图 ${info.big} 张 · 卡高 ${info.h.toFixed(0)}px`);
  await evalJS(`(() => { const c = document.querySelector('.card[data-lv="30"]');
    c.scrollIntoView({block:'start'}); return 'ok'; })()`);
  await sleep(400);
  const box = JSON.parse(await evalJS(`(() => {
    const c = document.querySelector('.card[data-lv="30"]');
    const r = c.getBoundingClientRect();
    return JSON.stringify({ x: r.left + window.scrollX - 10, y: r.top + window.scrollY - 10, width: r.width + 20, height: r.height + 20 });
  })()`));
  console.log(`  取景 ${box.width.toFixed(0)}×${box.height.toFixed(0)}`);
  await shot('62-第30关-10层138张-放大与逐层条.png', box, { scale: 1 });

  try { ws.close(); } catch {}
  chrome2.kill('SIGKILL');
  await sleep(500);
  try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true }); } catch {}

  console.log(`\n抓图完成 · 运行期 JS 异常 ${evs.length} 条`);
}

console.log('════ 第 32 轮归档抓图（真实浏览器渲染）════');
main().then(() => process.exit(0))
  .catch(e => { console.error('执行失败：', e.message); process.exit(1); });
