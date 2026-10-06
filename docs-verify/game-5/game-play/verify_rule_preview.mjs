/**
 * 规则页「完整预览」页 · 真实事件验收（第 27 轮）
 * ============================================================================
 * 为什么不复用 verify_rule_modal.mjs：那个脚本验的是**主玩页里的规则页**
 *（要先过赠礼过场）；本页是给用户一眼看定稿态的**独立预览页**，入口不同。
 * 但判据口径完全一致 —— 派发**真实鼠标事件**后，状态真的变了才算过。
 *
 * 断言：① 打开即为定稿态（.on 初始就在）  ② 图 1264×2040 加载成功、渲染 632×1020
 *      ③ 真实点 ✕ 热区 → 关闭   ④ 真实点遮罩 → 关闭   ⑤ 点「重新打开」→ 真的打开
 *      ⑥ 零 JS 异常
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const PAGE = 'file:///Users/consli/WorkBuddy/2026-10-04-19-15-36/game-5-%E8%A7%84%E5%88%99%E9%A1%B5-%E5%AE%8C%E6%95%B4%E9%A2%84%E8%A7%88.html';
const OUT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36/docs-verify/game-5/game-play';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prev-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--window-size=900,1200', PAGE,
], { stdio: 'ignore' });

let id = 0; const pending = new Map(); const events = []; let ws;
const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时：${method}`)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function main() {
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
    } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Log.entryAdded') events.push(m);
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await sleep(1600);
  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails.exception?.description));
    return r.result.value;
  };
  const clickSel = async (sel, waitMs = 400) => {
    const r = JSON.parse(await evalJS(`(() => { const e = document.querySelector('${sel}');
      e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2}); })()`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
    await sleep(50);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left',
        clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      await sleep(40);
    }
    await sleep(waitMs);
    return r;
  };

  const bootOpen = await evalJS(`document.querySelector('#ruleOver').classList.contains('on')`);
  const M = JSON.parse(await evalJS(`(() => {
    const card = document.querySelector('.ruleCard'), img = document.querySelector('.rulePage');
    const hit = document.querySelector('#btnRuleClose');
    const cr = card.getBoundingClientRect(), ir = img.getBoundingClientRect(), hr = hit.getBoundingClientRect();
    return JSON.stringify({
      imgCount: document.querySelectorAll('.ruleCard img').length,
      img: { src:(img.getAttribute('src')||'').split('/').pop(), natW:img.naturalWidth, natH:img.naturalHeight,
             ok: img.complete && img.naturalWidth > 0, w:+ir.width.toFixed(1), h:+ir.height.toFixed(1) },
      /* 预览页整体按 0.5 缩放显示 → CSS 显示宽 = 632×0.5 = 316，逻辑宽仍按 632 记 */
      logicW: +(ir.width / 0.5).toFixed(1), logicH: +(ir.height / 0.5).toFixed(1),
      legacyDOM: document.querySelectorAll('.ruleHead, .ruleBody, .ruleSec, .ruleFoot, .figRules, .figDice').length,
      broken: [...document.images].filter(i => i.getAttribute('src') && !(i.complete && i.naturalWidth > 0)).length,
    });
  })()`));

  await clickSel('#btnRuleClose', 400);
  const closedByX = await evalJS(`!document.querySelector('#ruleOver').classList.contains('on')`);

  await clickSel('#btnOpen', 400);
  const reopened = await evalJS(`document.querySelector('#ruleOver').classList.contains('on')`);

  const pt = JSON.parse(await evalJS(`(() => { const s = document.querySelector('.stage').getBoundingClientRect();
    return JSON.stringify({ x: s.left + 10, y: s.top + s.height / 2 }); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, buttons: 0 });
  await sleep(50);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left',
      clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    await sleep(40);
  }
  await sleep(400);
  const closedByScrim = await evalJS(`!document.querySelector('#ruleOver').classList.contains('on')`);

  await clickSel('#btnOpen', 500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '42-规则页-完整预览页-实机.png'), Buffer.from(shot.data, 'base64'));

  const checks = [
    ['预览页打开即为定稿态（.on 初始就在）', bootOpen === true],
    ['规则页内容 = 一张图', M.imgCount === 1],
    ['图为 rule-完整规则页.png', M.img.src === 'rule-完整规则页.png'],
    ['原图 @2x = 1264×2040', M.img.natW === 1264 && M.img.natH === 2040],
    ['图加载成功且铺满卡片（逻辑 632×1020）',
      M.img.ok === true && Math.abs(M.logicW - 632) < 1 && Math.abs(M.logicH - 1020) < 1],
    ['旧结构 DOM 残留 = 0', M.legacyDOM === 0],
    ['真实点击 ✕ 热区可关闭', closedByX === true],
    ['真实点击「重新打开」可打开', reopened === true],
    ['真实点击遮罩可关闭', closedByScrim === true],
    ['无破图', M.broken === 0],
    ['运行期零 JS 异常', events.length === 0],
  ];
  console.log('\n════ 规则页完整预览页 · 真实事件验收 ════');
  console.log(`初始打开 = ${bootOpen} · 图 = ${JSON.stringify(M.img)} · 逻辑尺寸 ${M.logicW}×${M.logicH}`);
  let pass = 0;
  for (const [n, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (ok) pass++; }
  console.log(`\n断言 ${pass}/${checks.length} 通过；运行期异常 ${events.length} 条`);
  ws.close(); chrome.kill();
  process.exit(pass === checks.length ? 0 : 1);
}
main().catch(e => { console.error('FAIL', e); try { chrome.kill(); } catch {} process.exit(2); });
