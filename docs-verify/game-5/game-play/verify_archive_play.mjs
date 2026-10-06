/**
 * 归档产物自检（第 28 轮立 · 每次重出 assets/game-play/ 的两个产物都要跑一遍）
 *
 * 为什么需要它：
 *   归档脚本只改了路径字符串，**并不能证明归档后的页面真的能打开**。
 *   本项目纪律（定稿工艺第 7 条）：页面进 assets/<子目录>/ 后，所有 './assets/…'
 *   引用要整体降一级为 '../…'，且必须**真实打开页面**确认「0 残留 + 全量资源加载成功」。
 *
 * 六条断言：
 *   ① 全部 <img> 加载成功（naturalWidth > 0）—— 无破图
 *   ② 规则页图 = 1264×2040（@2x 原件尺寸，且真的被页面加载了）
 *   ③ 运行期零 JS 异常（Runtime.exceptionThrown）
 *   ④ 页内无 './assets/' 字面残留（归档后必须为 0 处）
 *   ⑤ 标识正确（定稿版标题含「定稿」且不含「排版稿」；留痕版含「排版稿」）
 *   ⑥ ★ 牌库审计（第 29 轮立 · 第 32 轮改档）—— 遍历 PILE_DATA.levels 的**真实关卡卡位**逐张核对，
 *       三档产出里**不得有任何库外的牌**（牌库 = 万/条/筒 × 1~9 = 27 种）；
 *       同时验证 IMG_FACE 项数 == DECK 项数、tileSVG('zhong') 返回空串。
 *       立这条的原因：第 29 轮「红中」正是"生成器注入库外牌"，而它躲过了 12/12 全绿
 *       —— 归档产物也必须能拦住这一类缺陷。
 *
 * 用法：node verify_archive_play.mjs
 * 零依赖：node 22 自带 WebSocket / fetch。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const PORT = 9351;

const TARGETS = [
  { file: 'assets/game-play/主玩页-定稿.html', label: '定稿版', wantTitle: '定稿', denyTitle: '排版稿' },
  { file: 'assets/game-play/主玩页-排版.html', label: '留痕版', wantTitle: '排版稿', denyTitle: null },
];

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log('  ✅ ' + msg)) : (fail++, console.log('  ❌ ' + msg)); };

const fileUrl = p => 'file://' + p.split('/').map(encodeURIComponent).join('/');

async function checkPage(t) {
  console.log(`\n── ${t.label} · ${t.file} ──────────────────────────`);
  const abs = path.join(ROOT, t.file);
  if (!fs.existsSync(abs)) { ok(false, `${t.file} 不存在`); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-arch-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--force-device-scale-factor=2', '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    '--window-size=1400,1700', fileUrl(abs),
  ], { stdio: 'ignore' });

  let id = 0;
  const pending = new Map();
  const events = [];
  let ws;

  const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
    const mid = ++id;
    const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP 超时(${ms}ms)：${method}`)); }, ms);
    pending.set(mid, { res, rej, timer });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  try {
    // 等 devtools 端口 + page target（最多 60s）
    let targets = null, lastErr = null;
    for (let i = 0; i < 240; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const all = (await r.json()).filter(x => x.type === 'page' && x.webSocketDebuggerUrl);
        targets = all.filter(x => (x.url || '').startsWith('file://'));
        if (!targets.length) targets = all;
        if (targets.length) break;
        lastErr = new Error('端口已开但暂无 page target');
      } catch (e) { lastErr = e; }
      await sleep(250);
    }
    if (!targets?.length) throw new Error(`devtools 未就绪 · ${lastErr?.message || lastErr}`);

    // ★ node 22 把 localhost 解析成 ::1，而 Chrome 只监听 127.0.0.1
    const wsUrl = targets[0].webSocketDebuggerUrl.replace(/^ws:\/\/localhost/, 'ws://127.0.0.1');
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('WebSocket 握手超时(10s)')), 10000);
      ws.onopen = () => { clearTimeout(timer); res(); };
      ws.onerror = e => { clearTimeout(timer); rej(new Error('WebSocket 握手失败：' + (e?.message || 'non-101'))); };
    });
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej, timer } = pending.get(m.id); pending.delete(m.id); clearTimeout(timer);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        events.push(m);
      }
    };

    await send('Page.enable'); await send('Runtime.enable');
    await sleep(2000);   // 等字体 / 图片就位

    const evalJS = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error('页面求值失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    };

    const boot = JSON.parse(await evalJS(`JSON.stringify({
      title: document.title,
      imgs: [...document.images].map(i => ({
        src: (i.getAttribute('src') || '').split('/').pop(),
        ok: i.complete && i.naturalWidth > 0,
        w: i.naturalWidth, h: i.naturalHeight,
      })),
      rawAssetsRefs: (document.documentElement.outerHTML.match(/\\.\\/assets\\//g) || []).length,
    })`));

    // ① 无破图（空 src 的 <img> 是"动态牌面未赋值"的既有形态，单独计数、不算破图）
    const broken = boot.imgs.filter(i => !i.ok && (i.src || '') !== '');
    const empty = boot.imgs.filter(i => !i.ok && (i.src || '') === '');
    ok(broken.length === 0,
       `全部 ${boot.imgs.length} 张图：破图 ${broken.length} 张` +
       `${broken.length ? '（' + broken.map(b => b.src).join(', ') + '）' : ''}` +
       ` · 空 src（动态牌面未赋值）${empty.length} 张`);

    // ② 规则页图 = 1264×2040
    const rule = boot.imgs.find(i => (i.src || '').includes('rule-完整规则页'));
    ok(!!rule && rule.w === 1264 && rule.h === 2040,
       rule ? `规则页图已加载 ${rule.w}×${rule.h}（期望 1264×2040）` : '未找到规则页图（页面里没有 rule-完整规则页.png）');

    // ③ 零 JS 异常
    ok(events.length === 0, `运行期 JS 异常 ${events.length} 条`);

    // ④ 无 './assets/' 字面残留
    ok(boot.rawAssetsRefs === 0, `页内 './assets/' 残留 = ${boot.rawAssetsRefs} 处（应为 0）`);

    // ⑤ 标识正确
    const hasWant = boot.title.includes(t.wantTitle);
    const hasDeny = t.denyTitle ? boot.title.includes(t.denyTitle) : false;
    ok(hasWant && !hasDeny,
       `标题标识：含「${t.wantTitle}」=${hasWant}${t.denyTitle ? ` · 含「${t.denyTitle}」=${hasDeny}（应为 false）` : ''} · title=「${boot.title}」`);

    // ⑥ ★ 牌库审计（数据级 · 全部真实演示档位）
    /* ★ 第 32 轮改动：旧版直接调 `buildPile(12/36/96)` —— 那是写死档位时代的函数，
       第 32 轮已删除（改为读 <script id="pileData"> 的真实关卡卡位）。
       现在遍历 PILE_DATA.levels，逐档逐张核对 k/n 是否在库内。 */
    const deck = JSON.parse(await evalJS(`(() => {
      const SUITS = ['wan', 'tiao', 'tong'];
      const bad = [], kinds = new Set();
      let total = 0;
      for (const l of PILE_DATA.levels) {
        total += l.tiles.length;
        for (const x of l.tiles) {
          kinds.add(x.k);
          if (!(SUITS.indexOf(x.k) >= 0 && x.n >= 1 && x.n <= 9)) bad.push('L' + l.lv + ':' + x.k + '-' + x.n);
        }
      }
      return JSON.stringify({
        deckSize: DECK.length,
        faceKeys: Object.keys(IMG_FACE).length,
        tiers: PILE_DATA.levels.map(l => l.lv + '=' + l.n).join(' / '),
        kinds: [...kinds].sort(),
        bad, total,
        outOfDeckDraw: tileSVG('zhong', 1),
      });
    })()`));
    ok(deck.bad.length === 0 && deck.outOfDeckDraw === '' &&
       deck.faceKeys === deck.deckSize && deck.kinds.join() === 'tiao,tong,wan',
       `牌库审计：DECK ${deck.deckSize} 种 · 贴图映射 ${deck.faceKeys} 项 · ` +
       `真实档位 ${deck.tiers} 共 ${deck.total} 张牌的花色 = [${deck.kinds}] · 库外牌 ${deck.bad.length} 张 ` +
       `${JSON.stringify(deck.bad)} · 库外牌绘制 = ${JSON.stringify(deck.outOfDeckDraw)}（应为 ""）`);
  } catch (e) {
    ok(false, `检查过程出错：${e.message}`);
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill('SIGKILL');
    await sleep(400);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

console.log('════ 归档产物自检（真实浏览器打开 assets/game-play/ 两个产物）════');
for (const t of TARGETS) await checkPage(t);

console.log(`\n断言 ${pass}/${pass + fail} 通过${fail ? `（失败 ${fail} 条）` : ''}`);
process.exit(fail ? 1 : 0);
