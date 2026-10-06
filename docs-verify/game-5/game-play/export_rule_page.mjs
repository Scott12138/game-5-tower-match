/**
 * 规则页（整页）· 导出固化为正式素材图（第 27 轮）
 * ============================================================================
 * 用户拍板：「整页合并成一张图」+「删除点数对应表下方那行说明」。
 *   → 把 标题栏「游 戏 规 则」+ 碰/吃 区 + 点数对应表区 + 页脚免责声明，
 *     一起烘焙成一张完整规则页图。
 *
 * 做法：无头 Chrome 的 `--screenshot` 直出（**不用 CDP**），透明底，
 *       两步：① 本脚本截「整页原始视图」→ raw（@2x 1264×2400）；
 *             ② 交给 verify_rule_page.py 按 alpha>0 边界裁成卡片本体并逐项自证。
 *
 * ── 为什么放弃 CDP（第 27 轮踩坑记录）────────────────────────────────────────
 *   原实现用 CDP `Page.captureScreenshot(clip)`，但本机连续三次失败：
 *     ① 报 "Received network error or non-101 status code" —— node 22 把
 *        localhost 解析成 ::1，而 Chrome 只监听 127.0.0.1（已用改写 ws 地址修掉）；
 *     ② 加 --remote-allow-origins=* 后，出现**无输出的静默挂死**（6 分钟不返回，
 *        既不 open 也不 error）—— 无超时保护的 WebSocket 握手把整个脚本吊死；
 *     ③ 前台运行还被环境 SIGKILL（exit 137）。
 *   → 换 `--screenshot`：无握手、无长连接、进程自己退；失败模式只有"文件没生成"，
 *     一读便知。**结论：能用一次性截图解决的，不要上长连接。**
 *
 * 三条自证（缺一不可）：
 *   ① 产物自证：读回 PNG 二进制 IHDR，宽高必须 = 1264×2400；
 *   ② 零漂移自证：连截两次，md5 必须逐字一致；
 *   ③ 裁切+透明+内容自证：由 verify_rule_page.py 完成（alpha 边界裁切、
 *      四角 alpha=0、被删的那行说明确实消失 —— 用旧图做双向真值标定）。
 *
 * ⚠ 已踩过的坑（第 26 轮）：`--force-device-scale-factor` 与 `clip.scale`
 *   **会叠乘**（当初 2×2 导成 4 倍）。此处只用 dpx，无第二个缩放参数。
 *
 * 零依赖：node 22 自带 crypto / child_process。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const ROOT   = '/Users/consli/WorkBuddy/2026-10-04-19-15-36';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SRC    = pathToFileURL(path.join(ROOT, 'game-5-规则弹层-内容图-源稿.html')).href;
const OUTDIR = path.join(ROOT, 'assets/_src/game-play/rule-figs');
const PY     = '/Users/consli/.workbuddy/binaries/python/envs/default/bin/python';

/** 卡片 CSS 宽（border-box）。高**不写死** —— 由 Python 按 alpha 边界实测。 */
const CARD_W = 632;
/** 视口给足高度，保证整卡都在视野内；多出来的透明区由 Python 裁掉。 */
const VIEW   = { w: CARD_W, h: 1200 };
/** 设备缩放。@2x 成品 = CSS 尺寸 × DPX。 */
const DPX = 2;

const RAW = path.join(OUTDIR, 'rule-完整规则页-原始视图.png');
const TMP2 = path.join(os.tmpdir(), 'rule-page-verify2.png');
const FINAL = path.join(OUTDIR, 'rule-完整规则页.png');

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是合法 PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

/** 截一次：Chrome --screenshot 是"进程自己跑完就退出"，无长连接。 */
function shoot(outPath) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // ★ 透明底：卡片 border-radius:30px 的圆弧以外必须是透明，否则贴到遮罩上露方块
    '--default-background-color=00000000',
    `--force-device-scale-factor=${DPX}`,
    `--window-size=${VIEW.w},${VIEW.h}`,
    `--screenshot=${outPath}`,
    SRC,
  ];
  const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`Chrome 退出码 ${r.status}\n${(r.stderr || '').split('\n').slice(-6).join('\n')}`);
  if (!fs.existsSync(outPath)) throw new Error('Chrome 没有生成截图文件：' + outPath);
  return fs.readFileSync(outPath);
}

console.log('\n════ 规则页（整页）· 导出固化 ════');
console.log(`源稿：${decodeURIComponent(SRC.split('/').pop())}`);
console.log(`视口：${VIEW.w}×${VIEW.h} @${DPX}x  →  期望原始视图 ${VIEW.w * DPX}×${VIEW.h * DPX}`);

fs.mkdirSync(OUTDIR, { recursive: true });

// ── 第 1 次截图 ────────────────────────────────────────────────────────────
const b1 = shoot(RAW);
const s1 = pngSize(b1);
const viewOk = s1.w === VIEW.w * DPX && s1.h === VIEW.h * DPX;
console.log(`  ${viewOk ? '✅' : '❌'} 原始视图 ${s1.w}×${s1.h}（期望 ${VIEW.w * DPX}×${VIEW.h * DPX}）` +
            ` · ${(b1.length / 1024).toFixed(1)} KB`);

// ── 第 2 次截图（零漂移自证）──────────────────────────────────────────────
const b2 = shoot(TMP2);
const stable = md5(b1) === md5(b2);
try { fs.unlinkSync(TMP2); } catch {}
console.log(`  ${stable ? '✅' : '❌'} 两轮 md5 ${stable ? '一致（零漂移）' : '不一致'} · md5=${md5(b1)}`);

// ── 交给 Python：按 alpha 边界裁切 + 透明/内容自证 ─────────────────────────
console.log('\n── 裁切与自证（verify_rule_page.py）───────────────────────────');
const pyBin = fs.existsSync(PY) ? PY : 'python3';
const py = spawnSync(pyBin, [path.join(ROOT, 'docs-verify/game-5/game-play/verify_rule_page.py')], {
  encoding: 'utf8', timeout: 120000,
});
process.stdout.write(py.stdout || '');
if (py.stderr) process.stdout.write(py.stderr);
if (py.status !== 0) { console.error('\n裁切/自证未通过'); process.exit(1); }

// ── 同步到工程版资产区（第 28 轮：规则页已入资产库 → 两处必须一致）────────────
const PUB = path.join(ROOT, 'assets/game-play', path.basename(FINAL));
fs.copyFileSync(FINAL, PUB);
const synced = md5(fs.readFileSync(FINAL)) === md5(fs.readFileSync(PUB));
console.log(`  ${synced ? '✅' : '❌'} 已同步工程版 assets/game-play/${path.basename(FINAL)}` +
            `（md5 与母版一致 = ${synced}）`);
if (!synced) { console.error('\n工程版同步失败（两处 md5 不一致）'); process.exit(1); }

console.log(`\n成品：assets/_src/game-play/rule-figs/${path.basename(FINAL)}（母版）`);
console.log(`      assets/game-play/${path.basename(FINAL)}（工程版 · 页面引用此份）`);
console.log(viewOk && stable ? '导出完成 · 自证通过' : '导出未通过自证 —— 请查看上方 ❌');
process.exit(viewOk && stable ? 0 : 1);
