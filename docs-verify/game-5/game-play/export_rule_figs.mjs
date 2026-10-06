/**
 * 规则弹层两张内容图 · 导出固化为正式素材图（第 26 轮）
 * ============================================================================
 * 用户拍板：「将这两张设计稿直接导出并固化为 PNG 素材图」。
 *
 * 做法：无头 Chrome + CDP `Page.captureScreenshot(clip, scale:2)`，
 *       从**源稿页**（game-5-规则弹层-内容图-源稿.html）精确截取两个区，
 *       而不是从主稿弹层里截 —— 源稿页带完整 .ruleCard 骨架，
 *       半透明背景能叠在同一个深绿渐变上，颜色与真弹层逐像素一致，
 *       且源稿可长期保留、随时重出。
 *
 * 三条自证（缺一不可）：
 *   ① 尺寸自证：两区渲染尺寸必须精确等于 568×300 / 568×360，否则**拒绝导出**
 *      （防"某天改了 CSS 悄悄把图导歪了"）；
 *   ② 产物自证：读回 PNG 二进制头解析真实宽高，必须 = 1136×600 / 1136×720；
 *   ③ 零漂移自证：连导两次，两张图的 md5 必须逐张一致。
 *
 * 零依赖：node 22 自带 WebSocket / fetch / crypto。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT   = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT   = 9337;
const SRC    = pathToFileURL(path.join(ROOT, 'game-5-规则弹层-内容图-源稿.html')).href;
const OUTDIR = path.join(ROOT, 'assets/_src/game-play/rule-figs');

/** 导出目标：id → { 文件名, 期望 CSS 宽, 期望 CSS 高, @2x 后的像素尺寸 } */
const TARGETS = [
  { id: 'expRules', file: 'rule-碰吃示意.png',   w: 568, h: 300 },
  { id: 'expDice',  file: 'rule-点数对应表.png', w: 568, h: 360 },
];
/** 设备缩放（命令行 --force-device-scale-factor）。@2x 成品 = CSS 尺寸 × DPX。
 *  ⚠ 坑：clip 自身的 scale 会与它**叠乘**。第 26 轮首跑写成 clip.scale=2 + dpx=2
 *      → 导出 2272×1200（4 倍）。此处 clip.scale 固定为 1，倍数只由 DPX 决定。 */
const DPX = 2;

/** 读 PNG 二进制的 IHDR，取出真实像素宽高（不引第三方库） */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是合法 PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-exp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', `--force-device-scale-factor=${DPX}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
  '--window-size=1500,1400', SRC,
], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
let ws;
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = (await r.json()).filter(t => t.type === 'page');
      if (targets.length) break;
    } catch { /* 尚未就绪 */ }
    await sleep(250);
  }
  if (!targets?.length) throw new Error('devtools 未就绪');

  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };

  await send('Page.enable'); await send('Runtime.enable');
  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // ── 等字体与图片真正就位（字体没加载就截 = 字形回退，白导一次）─────────────
  for (let i = 0; i < 40; i++) {
    const ready = await evalJS(`(async () => {
      await document.fonts.ready;
      const imgs = [...document.images];
      return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0);
    })()`);
    if (ready === true) break;
    await sleep(200);
  }
  await sleep(400);

  const broken = JSON.parse(await evalJS(`JSON.stringify(
    [...document.images].filter(i => !(i.complete && i.naturalWidth > 0))
      .map(i => i.getAttribute('src')))`));
  if (broken.length) throw new Error('有图片未加载，拒绝导出：' + JSON.stringify(broken));

  // ── ① 尺寸自证 ────────────────────────────────────────────────────────────
  const geo = JSON.parse(await evalJS(`JSON.stringify(${JSON.stringify(TARGETS)}.map(t => {
    const e = document.getElementById(t.id);
    const r = e.getBoundingClientRect();
    return { id: t.id, file: t.file,
             w: +r.width.toFixed(2), h: +r.height.toFixed(2),
             x: r.left, y: r.top,
             dpr: devicePixelRatio,
             ff: getComputedStyle(e).fontFamily };
  }))`));

  let sizeOk = true;
  console.log('\n════ 规则弹层内容图 · 导出固化 ════');
  console.log(`源稿：${path.basename(decodeURIComponent(SRC.split('/').pop()))}`);
  for (const g of geo) {
    const t = TARGETS.find(x => x.id === g.id);
    const ok = Math.abs(g.w - t.w) < 0.5 && Math.abs(g.h - t.h) < 0.5;
    if (!ok) sizeOk = false;
    console.log(`  ${ok ? '✅' : '❌'} ${g.file}  实测 ${g.w}×${g.h}  期望 ${t.w}×${t.h}`);
  }
  if (!sizeOk) throw new Error('两区渲染尺寸与规格不符 —— 拒绝导出（先查 CSS 是否被改动）');

  // ── ② 截图导出（导两轮，做零漂移比对）─────────────────────────────────────
  const shotOnce = async () => {
    const out = [];
    for (const g of geo) {
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.w), height: Math.round(g.h), scale: 1 },
      });
      out.push(Buffer.from(r.data, 'base64'));
    }
    return out;
  };

  const round1 = await shotOnce();
  await sleep(300);
  const round2 = await shotOnce();

  // ── ③ 产物自证 + 零漂移自证 ───────────────────────────────────────────────
  fs.mkdirSync(OUTDIR, { recursive: true });
  let pass = true;
  TARGETS.forEach((t, i) => {
    const b1 = round1[i], b2 = round2[i];
    const sz = pngSize(b1);
    const expectW = t.w * DPX, expectH = t.h * DPX;
    const sizeGood = sz.w === expectW && sz.h === expectH;
    const stable = md5(b1) === md5(b2);
    if (!sizeGood || !stable) pass = false;
    fs.writeFileSync(path.join(OUTDIR, t.file), b1);
    const kb = (b1.length / 1024).toFixed(1);
    console.log(`  ${sizeGood ? '✅' : '❌'} ${t.file}  导出 ${sz.w}×${sz.h}（期望 ${expectW}×${expectH}） · ${kb} KB · 两轮 md5 ${stable ? '一致 ✅' : '不一致 ❌'}`);
    console.log(`       md5=${md5(b1)}`);
  });

  console.log(`\n输出目录：assets/_src/game-play/rule-figs/`);
  console.log(pass ? '导出完成 · 全部自证通过' : '导出未通过自证 —— 请查看上方 ❌');

  ws.close(); chrome.kill();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('\nFAIL', e.message || e); chrome.kill(); process.exit(2); });
