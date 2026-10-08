#!/usr/bin/env node
/**
 * ============================================================
 *  _r61-verify.mjs · 第 61 轮 · 「陶瓷麻将牌」全量替换的验收
 * ============================================================
 *  需求（用户 2026-10-08 原话）：
 *    「读取桌面『万筒条风』…仅提取其中的牌面图片文件…把它封装成套，存入资产库并命名为
 *      『陶瓷麻将牌』，随后用这套新牌面替换当前正在使用的牌面；并把旧的整套（万/条/筒）
 *      一并收入资产库并命名为『玉石麻将牌』。确保新旧素材均完整归档、命名准确、替换无遗漏。」
 *  抠图口径经用户当轮改口：「抠好了，就直接替换进去试试看」⇒ 用素材自带 alpha，不走 rembg。
 *
 *  ── 与前身 `_r60-verify.mjs` 的关系（★ 它已退役）───────────────
 *  `_r60-verify` 的判别力建立在「2D 描金万（暗）vs 3D 万（亮）」的**明暗/饱和差分**上。
 *  本轮把三花色全换成 3D 陶瓷后，实测：
 *      新·陶瓷 一万  亮度 211.1 · 饱和 0.133
 *      第60轮 3D 一万 亮度 210.6 · 饱和 0.132     ← **与新版几乎同值**
 *  ⇒ 明暗差分**失去分辨力**（C1/C2 变红是"判据陈旧"，不是产品回归）。
 *  加上它还有一条**真空成立**的负控（`git diff` 传了仓库相对路径却以 PROJ 为 cwd ⇒ 恒空 ⇒
 *  第 60 轮起就一直在"假通过"）。
 *  ⇒ 本轮把它退役，改写本脚本；本脚本**不依赖任何历史素材对**，只依赖
 *    「当前树 vs git HEAD」和「归档套装 vs 现行套装」这两组**永远成立**的对照。
 *
 *  【用法】node tools/_r61-verify.mjs       全绿 ⇒ exit 0
 *          G5_OUT=/tmp/xxx node tools/_r61-verify.mjs
 * ============================================================
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, screencastShot, sleep, startServer } from './g5-cdp.mjs';

const PROJ = resolve(import.meta.dirname, '..');
const ROOT = resolve(PROJ, '..');
const DIST = resolve(PROJ, 'build', 'web-desktop');
const A_ROOT = resolve(ROOT, 'assets', '_src', 'game-play', 'tiles');
const B_ROOT = resolve(ROOT, 'assets', 'game-play', 'tiles');
const C_ROOT = resolve(PROJ, 'assets', 'bundles', 'game', 'tiles');
const SETS = resolve(ROOT, 'assets', '_src', 'game-play', 'tile-sets');
const OLD_SET = resolve(SETS, '玉石麻将牌');
const NEW_SET = resolve(SETS, '陶瓷麻将牌');
const PY = '/Users/consli/.workbuddy/binaries/python/envs/default/bin/python';
const SHOTPY = resolve(import.meta.dirname, '_r60-shot-check.py');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r61-verify');
mkdirSync(OUT, { recursive: true });

const SUITS = [
    { k: 'wan', cn: '万', nums: ['一', '二', '三', '四', '五', '六', '七', '八', '九'] },
    { k: 'tiao', cn: '条', nums: ['一', '二', '三', '四', '五', '六', '七', '八', '九'] },
    { k: 'tong', cn: '筒', nums: ['一', '二', '三', '四', '五', '六', '七', '八', '九'] },
];
const W = 224, H = 298;

let pass = 0, fail = 0;
const rows = [];
function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✔ ${name}${detail ? `  —— ${detail}` : ''}`); }
    else { fail++; console.log(`  ✘ ${name}${detail ? `  —— ${detail}` : ''}`); }
    rows.push({ name, ok, detail });
}
const gitShow = (p) => execFileSync('git', ['show', `HEAD:${p}`],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
function pngSize(p) { const b = readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

// ══════════════════ A 组 · 资产层（离线） ══════════════════
console.log('\n── A 组 · 资产层（三处 + 套装归档）──');

// A1 A 源图库：27 张母版（裁切后全尺寸 RGBA）
let aBad = [];
for (const s of SUITS) for (const n of s.nums) {
    const p = resolve(A_ROOT, s.k, `${n}${s.cn}.png`);
    if (!existsSync(p)) { aBad.push(`${s.k}/${n}${s.cn} 缺`); continue; }
    const im = readFileSync(p); if (im.length < 100) aBad.push(`${n}${s.cn} 空`);
}
check('A1 A 源图库 27 张母版在位', aBad.length === 0, aBad.slice(0, 4).join(' ') || '27/27');

// A2 B 成品库：27 张全部 224×298
let bBad = [];
for (const s of SUITS) for (const n of s.nums) {
    const p = resolve(B_ROOT, s.k, `${n}${s.cn}.png`);
    if (!existsSync(p)) { bBad.push(`${s.k}/${n}${s.cn} 缺`); continue; }
    const sz = pngSize(p); if (sz.w !== W || sz.h !== H) bBad.push(`${s.k}/${n}${s.cn} ${sz.w}x${sz.h}`);
}
check('A2 B 成品库 27 张均为 224×298', bBad.length === 0, bBad.slice(0, 4).join(' ') || '27/27');

// A3 C bundle：27 png + 27 .meta
let cBad = [];
for (const s of SUITS) for (let i = 1; i <= 9; i++) {
    for (const f of [`${s.k}${i}.png`, `${s.k}${i}.png.meta`]) {
        if (!existsSync(resolve(C_ROOT, s.k, f))) cBad.push(`${s.k}/${f}`);
    }
}
check('A3 C bundle 27 png + 27 .meta 全部在位', cBad.length === 0, cBad.slice(0, 4).join(' ') || '54/54');

// A4 C 的 27 张与 B 逐字节一致（B→C 真的同步了）
let cDiff = [];
for (const s of SUITS) for (let i = 1; i <= 9; i++) {
    const a = readFileSync(resolve(C_ROOT, s.k, `${s.k}${i}.png`));
    const b = readFileSync(resolve(B_ROOT, s.k, `${s.nums[i - 1]}${s.cn}.png`));
    if (Buffer.compare(a, b) !== 0) cDiff.push(`${s.k}${i}`);
}
check('A4 C 的 27 张与 B 成品库逐字节一致', cDiff.length === 0, cDiff.slice(0, 4).join(' ') || '27/27');

// A5 ★ 27 个 .meta 的 uuid 与 HEAD 完全一致（引用未断）
let uuidBad = [];
for (const s of SUITS) for (let i = 1; i <= 9; i++) {
    const f = `${s.k}${i}.png.meta`;
    const now = JSON.parse(readFileSync(resolve(C_ROOT, s.k, f), 'utf8')).uuid;
    const head = JSON.parse(gitShow(`game-5-cocos/assets/bundles/game/tiles/${s.k}/${f}`).toString()).uuid;
    if (now !== head) uuidBad.push(`${f}: ${head} -> ${now}`);
}
check('A5 【要害】27 个 .meta 的 uuid 与 HEAD 完全一致（引用未断）',
    uuidBad.length === 0, uuidBad.slice(0, 3).join(' ') || '27/27 一致');

// A6 ★ 「现行牌面 = 归档『陶瓷麻将牌』的 product 库」逐字节一致
//
// ⚠️ 第 62 轮修正：原 A6 是"成品与 git HEAD 逐字节**不同**"（用来证明第 61 轮的替换真的发生了）。
//    但第 61 轮已于 `30456e0` 提交 ⇒ HEAD 里就是陶瓷版 ⇒ 这条**恒假**，从此一直红。
//    那是"判据陈旧"（同判据 109 那一类），不是产品回归。
//    改为**不依赖 git 状态**的等价断言：现行牌面必须与归档套装的 product 库完全一致。
//    （"替换真的发生了"这件事，由 A1~A4 + A6 + A8a 联合钉死：A 库 → B 库 → C bundle，
//      且 B 库 == 陶瓷 product；旧套另有 A7 负控证明新旧确实不同。）
let setDiff = [];
for (const s of SUITS) for (const n of s.nums) {
    const cur = readFileSync(resolve(B_ROOT, s.k, `${n}${s.cn}.png`));
    const arc = readFileSync(resolve(NEW_SET, 'product', s.k, `${n}${s.cn}.png`));
    if (Buffer.compare(cur, arc) !== 0) setDiff.push(`${s.k}/${n}${s.cn}`);
}
check('A6 现行牌面 27 张 == 归档「陶瓷麻将牌」product 库（逐字节）',
    setDiff.length === 0, setDiff.slice(0, 4).join(' ') || '27/27 一致');

// A7 负控：同一比对打在**旧套装「玉石麻将牌」**的 product 上，必须判「不一致」
//    （否则 A6 可能是"恒为相同"的假判据）
let oldDiff = 0;
for (const s of SUITS) for (const n of s.nums) {
    try {
        const cur = readFileSync(resolve(B_ROOT, s.k, `${n}${s.cn}.png`));
        const old = readFileSync(resolve(OLD_SET, 'product', s.k, `${n}${s.cn}.png`));
        if (Buffer.compare(cur, old) !== 0) oldDiff++;
    } catch { /* 旧套缺该文件 ⇒ 也算"可分辨" */ oldDiff++; }
}
check('A7 负控：同一比对打在旧「玉石麻将牌」上必须判「不一致」（A6 有分辨力）',
    oldDiff === 27, `旧套与现行不同 ${oldDiff}/27`);

// A8 命名套装归档完整 + 命名准确
function countExt(d, ext = '.png') {
    if (!existsSync(d)) return -1;
    return execFileSync('sh', ['-c', `find "${d}" -name "*${ext}" | wc -l`]).toString().trim() * 1;
}
const newSrc = countExt(resolve(NEW_SET, 'source'), '.png');
const newProd = countExt(resolve(NEW_SET, 'product'), '.png');
const oldProd = countExt(resolve(OLD_SET, 'product'), '.png');
const oldSrc = countExt(resolve(OLD_SET, 'source'), '.png');
check('A8a 「陶瓷麻将牌」目录名精确 + source 27 / product 27',
    existsSync(NEW_SET) && newSrc === 27 && newProd === 27, `source=${newSrc} product=${newProd}`);
check('A8b 「玉石麻将牌」目录名精确 + product 27（source 含历代留痕，>27 即为完整）',
    existsSync(OLD_SET) && oldProd === 27 && oldSrc > 27, `source=${oldSrc} product=${oldProd}`);

// ══════════════════ B 组 · 运行期（真实浏览器） ══════════════════
console.log('\n── B 组 · 运行期（真实浏览器 · 量真正渲染出来的截图像素）──');

// 探针：遍历场景 Sprite，收 wan/tiao/tong[1-9] 的屏幕矩形（CSS 像素）
// ⚠️ 注入 cdp.ev 的 JS 里不能出现反引号（判据 57）；锚点处 worldPosition 要按 anchor 还原（判据 101）
const PROBE = `
(function () {
  var C = (typeof cc !== 'undefined') ? cc : null;
  if (!C) return { err: 'no-cc' };
  var scene = C.director && C.director.getScene();
  if (!scene) return { err: 'no-scene' };
  var v = window.__g5t.view(); var cr = window.__g5t.canvasRect();
  if (!v || !cr) return { err: 'no-view' };
  var kx = cr.w / v.w, ky = cr.h / v.h;
  var out = [], frames = {};
  function walk(n) {
    if (!n) return walkChildrenOf(n);
    var sp = n.getComponent ? n.getComponent(C.Sprite) : null;
    var sf = sp ? sp.spriteFrame : null;
    if (sf) {
      var nm = sf.name || '';
      frames[nm] = (frames[nm] || 0) + 1;
      if (/^(wan|tiao|tong)[1-9]/.test(nm)) {
        var ui = null;
        try { ui = n.getComponent(C.UITransform); } catch (e) { ui = null; }
        if (!ui && n._uiProps && n._uiProps.uiTransformComp) ui = n._uiProps.uiTransformComp;
        if (ui) {
          var w = ui.width, h = ui.height, ax = ui.anchorX, ay = ui.anchorY;
          var wp = n.worldPosition, ws = n.worldScale;
          var left = wp.x - ax * w * ws.x, right = left + w * ws.x;
          var topUp = wp.y + (1 - ay) * h * ws.y, botUp = topUp - h * ws.y;
          var topDn = v.h - topUp, botDn = v.h - botUp;
          out.push({ frame: nm, node: n.name, act: n.activeInHierarchy !== false,
            x: cr.l + ((left + right) / 2) * kx, y: cr.t + ((topDn + botDn) / 2) * ky,
            w: (right - left) * kx, h: (botDn - topDn) * ky });
        }
      }
    }
    walkChildrenOf(n);
  }
  function walkChildrenOf(n) { var ch = n.children; for (var i = 0; i < ch.length; i++) walk(ch[i]); }
  walk(scene);
  return { tiles: out, frames: frames };
})()
`;

// B1 的正确口径：**单局不保证三花色同现**（第 61 轮首跑实测 L1 只有 wan/tiao、tong=0）。
//   要求"单局三花色齐"是把「现状」当「期望」（判据 2 的变体），必然假红。
//   "替换无遗漏"要证的是**运行期所有牌面都出自新素材** ⇒ 正解＝**跨多局取并集** + 帧名全部落在新命名域内。
const SUIT_OF = (f) => (f.startsWith('wan') ? 'wan' : f.startsWith('tiao') ? 'tiao' : f.startsWith('tong') ? 'tong' : null);
const FRAME_RE = /^(wan|tiao|tong)[1-9]$/;
const BODY_SUIT = { tiao: ['二条.png'], tong: ['一筒.png'] };

const LEVELS = [1, 4, 8, 12];
const { proc: srv, url } = await startServer(DIST);
const seenFrames = new Set();
const perLevel = [];
const stray = [];
const caps = {};                       // 花色 -> { shot, rects, level }
const shots = [];
try {
    for (const lv of LEVELS) {
        const b = await openBrowser(url, { width: 421, height: 927, scale: 3, seedLevel: lv });
        try {
            await navigateTo(b.cdp, 'game');
            await sleep(1500);
            const probe = await b.cdp.ev(PROBE);
            if (probe?.err) { perLevel.push({ lv, n: -1, suits: `探针:${probe.err}` }); continue; }
            const tiles = (probe.tiles || []).filter((t) => !t.frame.endsWith('_dead'));
            const suits = new Set();
            for (const t of tiles) {
                if (!FRAME_RE.test(t.frame)) stray.push(`L${lv}:${t.frame}`);
                seenFrames.add(t.frame);
                const s = SUIT_OF(t.frame); if (s) suits.add(s);
            }
            perLevel.push({ lv, n: tiles.length, suits: [...suits].sort().join('/') });
            // 取证截图：每个"尚未取到样本"的花色各截一局（取该花色矩形最多的那局最好，这里简化取首个命中局）
            const need = ['tiao', 'tong'].filter((s) => !caps[s] && tiles.some((t) => SUIT_OF(t.frame) === s));
            const shot = await screencastShot(b.cdp, resolve(OUT, `61-主玩页-L${lv}.png`));
            shots.push(shot);
            for (const s of need) caps[s] = { shot, rects: tiles.filter((t) => SUIT_OF(t.frame) === s), level: lv };
        } finally { try { b.close(); } catch { /* ignore */ } }
    }
} finally {
    try { srv?.kill?.(); } catch { /* ignore */ }
}

console.log(`     跨 ${LEVELS.length} 局逐局探针：` +
    perLevel.map((p) => `L${p.lv}(${p.n}张 ${p.suits})`).join(' · '));
const unionSuits = [...new Set([...seenFrames].map(SUIT_OF).filter(Boolean))].sort();
check('B1 跨多局取并集后三花色均有牌面精灵渲染（单局不保证同现 ⇒ 不许按单局判）',
    unionSuits.length === 3, `并集=${unionSuits.join(',')} · 累计 ${seenFrames.size} 个不同帧名`);
check('B2 渲染出的帧名全部落在新牌面命名域（无残留 / 未定义帧）',
    stray.length === 0, stray.slice(0, 4).join(' ') || `${seenFrames.size} 个帧名全部合规`);
check('B3 主玩页取证截图已落盘（screencastShot，不卡主玩页）',
    shots.length > 0 && shots.every((s) => s && existsSync(s)), shots.map((s) => s && s.split('/').pop()).join(' '));

// ── 逐花色像素判据：**只在「条」与「筒」上做** ────────────────────────
//   可判性来自"新素材更亮"这一**单调量**（详见 _r60-shot-check.py 头注释）。
//   整幅签名（alpha>200 中位亮度 / 平均饱和）实测：
//     条：新 221.7 / 0.101  ↔  旧 164.4 / 0.232   ⇒ 可分
//     筒：新 195.4 / 0.211  ↔  旧 148.3 / 0.280   ⇒ 可分
//     万：新 211.1 / 0.133  ↔  旧 210.6 / 0.132   ⇒ **天然不可分**，据实不判（不硬造判据）
const pc = (v) => (v === null || v === undefined ? 'n/a' : (v * 100).toFixed(0) + '%');
let iB = 4;
for (const s of ['tiao', 'tong']) {
    const cap = caps[s];
    if (!cap) {
        check(`B${iB} [${s}] 运行期像素判据 —— 本批关卡未渲染该花色，样本缺失`, false, '调大 LEVELS 或换关卡');
        iB += 3; continue;
    }
    const rectsP = resolve(OUT, `rects-${s}.json`);
    writeFileSync(rectsP, JSON.stringify(cap.rects, null, 2));
    const anal = JSON.parse(execFileSync(PY, [SHOTPY, cap.shot, rectsP,
        resolve(B_ROOT, s, BODY_SUIT[s][0]), resolve(OLD_SET, 'product', s, BODY_SUIT[s][0])])
        .toString().trim());
    console.log(`     [${s}] L${cap.level} · ${cap.rects.length} 块 · 对照（亮度≥${anal.bright_gate} 占比 f210）：` +
        `新 ${pc(anal.new_f210)} · 旧 ${pc(anal.old_f210)} · 门槛 ${pc(anal.ceiling)} · 实测最高 ${pc(anal.live_max)}（${anal.live_n} 块可判）`);
    check(`B${iB} [${s}] 对照两侧真的分得开（新 f210 ≥ max(30%, 旧×5)）`, anal.control_ok === true,
        `新 ${pc(anal.new_f210)} vs 旧 ${pc(anal.old_f210)}`);
    check(`B${iB + 1} [${s}] 【决定性】画面渲染的确是新的陶瓷${s}牌（有块超过旧素材自身上界）`,
        anal.live_max !== null && anal.live_max >= anal.ceiling,
        `实测最高 ${pc(anal.live_max)} vs 门槛 ${pc(anal.ceiling)}`);
    check(`B${iB + 2} [${s}] 负控：同一量法打在归档旧素材合成图上必须判「不合格」`,
        anal.old_f210 < anal.ceiling, `旧 f210 ${pc(anal.old_f210)} < 门槛 ${pc(anal.ceiling)}`);
    iB += 3;
}
const shotPath = caps.tiao?.shot || caps.tong?.shot || shots[0] || null;

console.log(`\n通过 ${pass} · 失败 ${fail} / 共 ${pass + fail}`);
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ pass, fail, rows, shot: shotPath }, null, 2));
console.log(`报告：${resolve(OUT, 'report.json')}`);
process.exit(fail ? 1 : 0);
