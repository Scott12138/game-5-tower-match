/**
 * game-5 · 主玩页待定稿清单（31-主玩页-待定稿清单.html）· 真实浏览器验收（第 31 轮台账同步后）
 * ==================================================================================
 * 判据：① 页面能加载且零 JS 异常 ② 第 31 轮的改动文案真的在**渲染后的 DOM** 里
 *       ③ 视觉可见（有尺寸 + 非 hidden），不是"元素存在"
 *
 * ⚠ 本环境 Chrome 沙箱初始化失败（sandbox initialization failed）→ **必须加 `--no-sandbox`**，
 *    否则 Chrome 会**静默退出**（进程 exit 0、stdout 全空），极难排查。
 * ⚠ 所有 send 都带超时（长连接可能静默挂死，不给超时就会一直卡住）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(HERE, '31-主玩页-待定稿清单.html');
const PAGE = 'file://' + FILE.split('/').map(encodeURIComponent).join('/');
const PORT = 9381;

const results = [];
const ok = (n, c, d = '') => { results.push([c, n, d]); console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' · ' + d : ''}`); };
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl31-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--window-size=1440,2400', PAGE,
], { stdio: 'ignore' });

let id = 0; const pending = new Map(); let ws;
const send = (m, p = {}, ms = 30000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout ' + m)); }, ms);
  pending.set(mid, { res, rej, t });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});

try {
  let targets = null;
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const all = (await r.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      targets = all.filter(t => (t.url || '').startsWith('file://'));
      if (!targets.length) targets = all;
      if (targets.length) break;
    } catch { /* 还在启动 */ }
    await sleep(250);
  }
  if (!targets?.length) throw new Error('找不到页面 target');
  ws = new WebSocket(targets[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1'));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws 握手超时')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error('ws 错误')); };
  });
  const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description || 'exception');
    if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errs.push(m.params.entry.text);
    if (m.id && pending.has(m.id)) {
      const { res, rej, t } = pending.get(m.id);
      pending.delete(m.id); clearTimeout(t);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Log.enable');
  await send('Page.navigate', { url: PAGE });
  await sleep(1500);

  const ev = async (expr, ms = 30000) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };

  head('A · 页面与结构');
  const title = await ev('document.title');
  ok('A1 页面加载成功且有标题', !!title, String(title));

  const c = JSON.parse(await ev(`JSON.stringify({
    h2: document.querySelectorAll('h2').length,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    cards: document.querySelectorAll('.card').length,
    qs: document.querySelectorAll('.q').length,
    chains: document.querySelectorAll('.chain').length,
    pills: document.querySelectorAll('.pill').length,
  })`));
  ok('A2 结构完整（h2 ≥ 5 / table ≥ 6 / 卡片 4 / 问题卡 ≥ 9 / 流程链 ≥ 3）',
    c.h2 >= 5 && c.tables >= 6 && c.cards === 4 && c.qs >= 9 && c.chains >= 3,
    JSON.stringify(c));

  head('B · 第 32 轮改动真的在渲染后的 DOM 里');
  const txt = await ev('document.body.innerText');
  const flat = txt.replace(/\s+/g, '');

  ok('B1 一句话结论：第 32 轮把 N1~N4 全部处置',
    flat.includes('第32轮按你5条拍板把N1~N4全部处置'));
  ok('B2 二节副标题：N1~N4 已全部处置（可点率 / 分段 / 尺寸一致 / 主玩页档位）',
    flat.includes('N1~N4已全部处置') && flat.includes('可点率/分段/尺寸一致/主玩页档位'));
  ok('B3 顶部最新 verdict 块 = 「第 33 轮变更（最新，以此为准）」',
    flat.includes('第33轮变更（最新，以此为准）'));
  ok('B4 含 v7 两个可点率杠杆：top_share + 层级黄金角错位 R',
    txt.includes('top_share') && flat.includes('层间黄金角错位') && flat.includes('天际线抬升'));
  ok('B5 含后段可点率实测提升：7.2%~10.0% → 14.8%~18.1%',
    flat.includes('7.2%~10.0%→14.8%~18.1%') && flat.includes('11张→25张'));
  ok('B6 含分段口径（按层切 / ≤36 / 3 的倍数 / 自顶向下 / 全堆同时在桌）',
    flat.includes('按层切') && flat.includes('3的倍数且≤36') && flat.includes('自顶向下') && flat.includes('全堆同时在桌'));
  ok('B7 含尺寸一致性四条证据（布局盒 / 变换矩阵 / 宽高互换 / 逐张卡位）',
    flat.includes('offsetWidth×offsetHeight') && flat.includes('a²+b²=1') && flat.includes('宽高互换') && flat.includes('容差0.2px'));
  ok('B8 含旧 bug 说明「牌面被横向拉伸 1.33 倍」',
    flat.includes('横向拉伸1.33倍'));
  ok('B9 拍板事项 h2 = 「A8 ①②③④ + A9 + N1~N4 已全部收敛」',
    flat.includes('已全部收敛') && flat.includes('N1~N4'));
  ok('B10 四节含「待真机确认」的 top_share 观感项',
    flat.includes('待真机确认') && flat.includes('TOP_SHARE_TRIES'));
  ok('B11 底部 note / 证据链含四套验收脚本通过数',
    flat.includes('38/38') && flat.includes('69/69') && flat.includes('17/17') && flat.includes('12/12'));

  ok('B12 第 33 轮 L1：母版 192×256 → 224×298 + CSS 缩比 1.000~0.786（规格唯一）',
    flat.includes('192×256→224×298') && flat.includes('1.000~0.786') && flat.includes('规格唯一'));
  ok('B13 第 33 轮 L2：WebP q=92 + 原资产一字未改（md5 全等）+ 主包达标',
    flat.includes('WebPq=92') && flat.includes('md5全等') && flat.includes('6552.2KB→1115.6KB'));
  ok('B14 第 33 轮 L4：OCC_H 0.804 → 1.0 内切 contain + 27/27 零裁切',
    flat.includes('OCC_H0.804→1.0') && flat.includes('contain') && flat.includes('27/27零裁切'));
  ok('B15 第 33 轮 L3 暂不处理 + TOP_SHARE_TRIES 按指示挂起',
    flat.includes('暂不处理') && flat.includes('TOP_SHARE_TRIES按你指示暂时挂起'));
  ok('B16 第 33 轮验收合计 159/159', flat.includes('159/159'));

  head('C · 视觉可见性（判据是"看得见"，不是"元素存在"）');
  const v = JSON.parse(await ev(`(() => {
    const ps = [...document.querySelectorAll('.pill')].filter(e => /已全部处置|已落地|已解决/.test(e.textContent));
    if (!ps.length) return JSON.stringify({ n: 0 });
    const r = ps[0].getBoundingClientRect(), cs = getComputedStyle(ps[0]);
    return JSON.stringify({ n: ps.length, w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, vis: cs.visibility, color: cs.color });
  })()`));
  ok('C1 第 32 轮状态徽标真实可见（有尺寸 + 非 hidden）',
    v.n > 0 && v.w > 0 && v.h > 0 && v.disp !== 'none' && v.vis !== 'hidden', JSON.stringify(v));

  const layout = JSON.parse(await ev(`(() => {
    const b = document.body;
    const over = [...document.querySelectorAll('table')].filter(t => t.getBoundingClientRect().width > window.innerWidth + 2).length;
    return JSON.stringify({ h: b.scrollHeight, w: document.documentElement.scrollWidth, vw: window.innerWidth, over });
  })()`));
  ok('C2 页面高度合理且无横向溢出（宽 ≤ 视口 + 2px）',
    layout.h > 2000 && layout.over === 0 && layout.w <= layout.vw + 2, JSON.stringify(layout));

  head('D · 运行期');
  ok('D1 运行期零 JS 异常', errs.length === 0, errs.length ? errs.join(' | ') : '捕获 0 条');

  const pass = results.filter(r => r[0]).length;
  console.log('\n' + '='.repeat(84));
  console.log(`结果：${pass}/${results.length} 通过 · ${pass === results.length ? '全绿 ✅' : '有红 ❌'}`);
  console.log('='.repeat(84));
  ws.close();
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 2;
} finally {
  try { chrome.kill(); } catch { }
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }, 300);
}
