/**
 * 规则页 · 真实事件验收（第 25 轮立 · 第 26 轮改「两图资产版」· 第 27 轮改「整页一图版」）
 *
 * 第 27 轮变更：用户拍板「整页合并为一张图」→
 *   规则页内部 DOM（.ruleHead / .ruleBody / .ruleSec / .ruleFoot / .ph /
 *   .figRules / .figDice / .diceTbl / .frRow / .rvIc / .tagT）**全部移除**，
 *   只剩一张 <img>（rule-完整规则页.png @2x 1264×2040）+ 一个透明关闭热区。
 *   故断言组改为「整页图资产 + 交互」：
 *     图加载成功 · 原图 1264×2040 · 渲染 632×1020 · 卡片完整在一屏内 ·
 *     旧 DOM 残留 = 0 · 真实点 ✕ 可关 · 真实点遮罩可关 · 像素真的变了。
 *
 * 为什么不用截图/US 检查"元素存在"：
 *   第 21 轮的教训 —— 只截屏 + 直接调函数，等于绕过事件层，事件没注册也看不出来
 *   （当时 pointermove/pointerup 从未绑定，页面点不动，截图却完全正常）。
 *   所以判据必须是：**派发真实鼠标事件之后，状态真的变了、像素真的变了**。
 *
 * ⚠ 第 27 轮给 CDP 连接加了三重超时：本机曾出现 WebSocket 握手**静默挂死**
 *   （既不 open 也不 error，把脚本吊死 6 分钟、零输出）。凡长连接一律设上限。
 *
 * 零依赖：node 22 自带 WebSocket / fetch / crypto。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PAGE = 'file:///Users/consli/WorkBuddy/2026-10-04-19-15-36/game-5-%E4%B8%BB%E7%8E%A9%E9%A1%B5-%E6%8E%92%E7%89%88.html';
const OUT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36/docs-verify/game-5/game-play';

const md5 = b => crypto.createHash('md5').update(b).digest('hex');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-rule-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=2',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--window-size=1400,1700', PAGE,
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
const events = [];
let ws;

/** 每条 CDP 命令都带超时 —— 没有上限的 await 就是"静默挂死"的温床 */
const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时(${ms}ms)：${method}`)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function main() {
  // ── 等 devtools 端口就绪（窗口 60s：本机多 Chrome 并存时启动会慢）────────
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
  if (!targets?.length) throw new Error(`devtools 未就绪 · 最后错误：${lastErr?.message || lastErr}`);
  console.log(`devtools 就绪 · target = ${(targets[0].url || '').slice(0, 60)}…`);

  // ★ node 22 会把 localhost 解析成 ::1，而 Chrome 只监听 127.0.0.1 → 统一改写
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
    } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Log.entryAdded') {
      events.push(m);
    }
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await sleep(1800);                                  // 等字体/图片就位

  const evalJS = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  // ── ① 启动期自查 ────────────────────────────────────────────────────────
  const boot = JSON.parse(await evalJS(`JSON.stringify({
    imgs: [...document.images].map(i => ({src:(i.getAttribute('src')||'').split('/').pop(), ok:i.complete && i.naturalWidth>0, w:i.naturalWidth, h:i.naturalHeight}))
  })`));

  // ── ② 真实鼠标 · 真机流程：赠礼过场挡着 z-index 40，必须先点「开始挑战」──────
  const clickAt = async (x, y, waitMs = 500) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await sleep(50);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
      await sleep(40);
    }
    await sleep(waitMs);
  };
  const clickSel = async (sel, waitMs = 500) => {
    const r = JSON.parse(await evalJS(`(() => {
      const e = document.querySelector('${sel}');
      e.scrollIntoView({block:'center'});
      const r = e.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()`));
    await clickAt(r.x, r.y, waitMs);
    return r;
  };

  const gated = JSON.parse(await evalJS(`(() => {
    const el = document.querySelector('#btnRule').getBoundingClientRect();
    const hit = document.elementFromPoint(el.left + el.width/2, el.top + el.height/2);
    return JSON.stringify({ phase: phase, hit: hit ? hit.className : null });
  })()`));

  await clickSel('#btnStart', 1700);
  const playPhase = await evalJS(`phase`);

  // ── ③ 真实鼠标：点「规则」 → 弹层打开（并比对像素真的变了）──────────────
  const before = await evalJS(`document.querySelector('#ruleOver').classList.contains('on')`);
  const shotPre = (await send('Page.captureScreenshot', { format: 'png' })).data;
  await evalJS(`window.scrollTo(0,0); 1`);
  const D = JSON.parse(await evalJS(`(() => {
    const el = document.querySelector('#btnRule');
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    const x = r.left + r.width/2, y = r.top + r.height/2;
    const hit = document.elementFromPoint(x, y);
    return JSON.stringify({
      rect: {x:+r.left.toFixed(1), y:+r.top.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1)},
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      hitTag: hit ? hit.tagName + '.' + hit.className : null,
      hitsBtn: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))),
      pt: {x, y},
    });
  })()`));
  await clickAt(D.pt.x, D.pt.y, 700);
  const after = await evalJS(`document.querySelector('#ruleOver').classList.contains('on')`);
  const shotPost = (await send('Page.captureScreenshot', { format: 'png' })).data;
  const pixelsChanged = md5(Buffer.from(shotPre, 'base64')) !== md5(Buffer.from(shotPost, 'base64'));

  // ── ④ 整页图资产断言 ────────────────────────────────────────────────────
  const M = JSON.parse(await evalJS(`(() => {
    const scr = document.querySelector('#screen').getBoundingClientRect();
    const SC = scr.width / 750;
    const box = el => { const r = el.getBoundingClientRect();
      return { w:+(r.width/SC).toFixed(1), h:+(r.height/SC).toFixed(1),
               top:+((r.top-scr.top)/SC).toFixed(1), bottom:+((r.bottom-scr.top)/SC).toFixed(1) }; };
    const card = document.querySelector('.ruleCard');
    const img  = document.querySelector('#ruleCard .rulePage');
    const hit  = document.querySelector('#btnRuleClose');
    const cr = card.getBoundingClientRect();
    const ir = img ? img.getBoundingClientRect() : null;
    const hr = hit ? hit.getBoundingClientRect() : null;
    const bad = [...document.images].filter(i => i.getAttribute('src') && !(i.complete && i.naturalWidth > 0))
                                   .map(i => i.getAttribute('src'));
    return JSON.stringify({
      ruleOpen: document.querySelector('#ruleOver').classList.contains('on'),
      card: box(card), cardInScreen: box(card).top >= 0 && box(card).bottom <= 1334,
      imgCount: document.querySelectorAll('#ruleCard img').length,
      img: img ? { src:(img.getAttribute('src')||'').split('/').pop(),
                   natW: img.naturalWidth, natH: img.naturalHeight,
                   ok: img.complete && img.naturalWidth > 0,
                   w:+(ir.width/SC).toFixed(1), h:+(ir.height/SC).toFixed(1) } : null,
      /* 旧结构选择器残留数必须为 0 —— 防"图换了、旧节点还埋在底下" */
      legacyDOM: document.querySelectorAll(
        '.ruleHead, .ruleBody, .ruleSec, .ruleFoot, .ph, .figRules, .figDice, .diceTbl, .frRow, .rvIc, .tagT'
      ).length,
      closeHit: hr ? { w:+(hr.width/SC).toFixed(1), h:+(hr.height/SC).toFixed(1),
                       right: +((cr.right - hr.right)/SC).toFixed(1),
                       ctrY: +(((hr.top + hr.height/2) - cr.top)/SC).toFixed(1) } : null,
      brokenImgs: bad,
    });
  })()`));

  // ── ⑤ 真实鼠标：点 ✕ 热区 → 关闭；再开 → 点遮罩 → 关闭 ───────────────────
  await clickSel('#btnRuleClose', 500);
  const closedByX = await evalJS(`!document.querySelector('#ruleOver').classList.contains('on')`);
  await clickSel('#btnRule', 700);
  const reopened = await evalJS(`document.querySelector('#ruleOver').classList.contains('on')`);
  const pt = JSON.parse(await evalJS(`(() => {
    const scr = document.querySelector('#screen').getBoundingClientRect();
    /* 点遮罩：取屏幕左侧 12px 处（卡片居中、左右各留约 29px），y 取屏幕中部 */
    return JSON.stringify({ x: scr.left + 12, y: scr.top + scr.height / 2 });
  })()`));
  await clickAt(pt.x, pt.y, 500);
  const closedByScrim = await evalJS(`!document.querySelector('#ruleOver').classList.contains('on')`);

  // ── ⑥ 逐条断言 ─────────────────────────────────────────────────────────
  const checks = [
    ['赠礼过场期间「规则」被正确遮挡（真机流程）',
      gated.phase === 'gift' && /giftOver|scrim|rays|ring/.test(gated.hit || '')],
    ['真实点击「开始挑战」后进入 play', playPhase === 'play'],
    ['真实点击「规则」后规则页真的打开', before === false && after === true],
    ['打开后画面像素真的变了（不是"元素在但没显示"）', pixelsChanged === true],
    ['卡片完整在 1334 屏内', M.cardInScreen === true],
    ['卡片宽 632 / 渲染高 1020（= 图 1264×2040 ÷ 2）',
      Math.abs(M.card.w - 632) < 1 && Math.abs(M.card.h - 1020) < 1],
    ['规则页内容 = 一张图（img 个数 = 1）', M.imgCount === 1],
    ['图为 rule-完整规则页.png', M.img?.src === 'rule-完整规则页.png'],
    ['原图 @2x = 1264×2040', M.img?.natW === 1264 && M.img?.natH === 2040],
    ['图加载成功且铺满卡片（632×1020）',
      M.img?.ok === true && Math.abs(M.img.w - 632) < 1 && Math.abs(M.img.h - 1020) < 1],
    ['旧结构 DOM 已清空（.ruleHead/.ruleBody/.ruleSec/.ruleFoot/.ph/.figRules/.figDice/.diceTbl/.frRow/.rvIc/.tagT 全为 0）',
      M.legacyDOM === 0],
    ['✕ 热区几何 = 56×56 / 距右 18 / 垂直中心 y=48（对齐图中 ✕）',
      M.closeHit && Math.abs(M.closeHit.w - 56) < 1 && Math.abs(M.closeHit.h - 56) < 1 &&
      Math.abs(M.closeHit.right - 18) < 1 && Math.abs(M.closeHit.ctrY - 48) < 1.5],
    ['真实点击 ✕ 热区可关闭', closedByX === true],
    ['真实点击遮罩可关闭', reopened === true && closedByScrim === true],
    ['全页无破图', M.brokenImgs.length === 0],
    ['运行期零 JS 异常', events.length === 0],
  ];

  // ── ⑦ 截图（重开一次，拍"打开态"）────────────────────────────────────────
  await clickSel('#btnRule', 700);
  const save = (b64, name) => fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));
  const shotScreen = await send('Page.captureScreenshot', { format: 'png' });
  save(shotScreen.data, '40-规则页-整页图版-实机.png');
  const clipOf = async sel => {
    const c = JSON.parse(await evalJS(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
      return JSON.stringify({x:r.left, y:r.top, width:r.width, height:r.height}); })()`));
    return send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height), scale: 2 },
    });
  };
  save((await clipOf('.ruleCard')).data, '41-规则页-整页图-实机特写.png');

  console.log('\n════ 规则页 · 真实事件验收（整页一图版）════');
  console.log(`载入相位 phase=${gated.phase}，「规则」按钮落点命中 = ${gated.hit}（应被赠礼层遮挡）`);
  console.log(`真实点击「开始挑战」→ phase=${playPhase}`);
  console.log(`按钮 rect=${JSON.stringify(D.rect)} 视口 ${D.vw}×${D.vh} dpr=${D.dpr} 落点命中 = ${D.hitTag} 命中按钮=${D.hitsBtn}`);
  console.log(`规则按钮点击前 on=${before} → 点击后 on=${after} · 像素变化 = ${pixelsChanged}`);
  console.log(`卡片 ${M.card.w}×${M.card.h}（top ${M.card.top} / bottom ${M.card.bottom}）`);
  console.log(`内容图 = ${JSON.stringify(M.img)}`);
  console.log(`✕ 热区 = ${JSON.stringify(M.closeHit)}`);
  console.log(`旧结构残留 DOM = ${M.legacyDOM}（应为 0）· 破图 = ${JSON.stringify(M.brokenImgs)}`);
  console.log(`关闭：✕ → ${closedByX} · 遮罩 → ${closedByScrim}（重开 ${reopened}）`);
  console.log(`启动期图片：${JSON.stringify(boot.imgs.filter(i => !i.ok))}（空 = 全部加载成功）`);
  let pass = 0;
  for (const [n, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (ok) pass++; }
  console.log(`\n断言 ${pass}/${checks.length} 通过；运行期异常 ${events.length} 条`);
  if (events.length) console.log(JSON.stringify(events.slice(0, 3), null, 2));

  ws.close(); chrome.kill();
  process.exit(pass === checks.length ? 0 : 1);
}

main().catch(e => { console.error('FAIL', e); try { chrome.kill(); } catch {} process.exit(2); });
