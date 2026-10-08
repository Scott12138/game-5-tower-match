#!/usr/bin/env node
/**
 * ============================================================
 *  ⛔ 【已退役 · 2026-10-08 第 61 轮】请改用 `tools/_r61-verify.mjs`
 * ============================================================
 *  退役原因（两条）：
 *    ① 判别力失效 —— 本脚本靠「2D 描金万（暗）vs 3D 万（亮）」的明暗/饱和差分。
 *       第 61 轮三花色全换 3D 陶瓷后，新·陶瓷一万（211.1 / 0.133）与第 60 轮 3D 一万
 *       （210.6 / 0.132）几乎同值 ⇒ 差分**天然不可分**，C1/C2 变红是"判据陈旧"而非回归。
 *    ② 真空负控 —— 其 A5 用 `git diff --name-only -- game-5-cocos/...` 却以 PROJ 为 cwd，
 *       该路径在 PROJ 下不存在 ⇒ **恒返回空** ⇒ 从第 60 轮起一直在"假通过"。
 *  ⚠ 本文件**保留仅供考古**，不要再纳入回归；保留它也是为了让上面两条教训有据可查。
 * ============================================================
 *  _r60-verify.mjs · 第 60 轮 · 万子 3D 版替换的验收
 * ============================================================
 *  需求（用户 2026-10-08 原话）：
 *    「读取桌面『万子』文件夹，将里面的万字牌 PNG 文件也录入到资产库，
 *      并替代当前的万字牌，输出试玩码给我试试视觉效果。」
 *    补充硬约束：「所有抠图任务必须使用 rembg 抠图工具，不能使用其他」。
 *
 *  ── 本轮的「要害」────────────────────────────────────────────
 *  把 PNG 拷进 bundle 目录**不等于**游戏画面上换成了新牌面。可能的断裂点：
 *    ① 拷贝路径写错（bundle 用 ASCII 名 `wan1.png`，源/成品库用中文名 `一万.png`）；
 *    ② .meta 被覆盖 ⇒ UUID 变 ⇒ 引用断，Cocos 静默回落；
 *    ③ 构建没跑 / 跑的是旧构建；
 *    ④ 纹理被缓存，实际用的是另一份。
 *  ⇒ 判据必须建在**运行期真正渲染出来的纹理像素**上，不是"文件在不在"。
 *
 *  ── 判别力（为什么这个判据能分辨新旧）──────────────────────────
 *  实测整幅签名（仅 alpha>200 像素）：
 *      旧（git HEAD）：亮度 135.6~147.2 · 饱和 0.340~0.407   ← 2D 描金扁平
 *      新（3D 版）    ：亮度 205.8~210.6 · 饱和 0.132~0.147   ← 奶白面 + 绿棱
 *  两区间**完全不重叠**（亮度差 ≥58，饱和差 ≥0.19）⇒ 阈值取中间即可。
 *
 *  ── 判据纪律（沿用）─────────────────────────────────────────
 *   ★ 负控必须真的会红：同一套签名量法打在 HEAD 旧牌上，必须判「不合格」。
 *   ★ 主玩页只用 `screencastShot`（判据 48b：captureScreenshot 会卡死渲染进程）。
 *   ★ 注入 `cdp.ev()` 的 JS 里不能出现反引号（判据 57）。
 *
 *  【用法】node tools/_r60-verify.mjs                全绿 ⇒ exit 0
 *          G5_OUT=/tmp/xxx node tools/_r60-verify.mjs
 * ============================================================
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, screencastShot, sleep, startServer } from './g5-cdp.mjs';

const PROJ = resolve(import.meta.dirname, '..');
const DIST = resolve(PROJ, 'build', 'web-desktop');
const BUNDLE = resolve(PROJ, 'assets', 'bundles', 'game', 'tiles', 'wan');
const PY = '/Users/consli/.workbuddy/binaries/python/envs/default/bin/python';
const SIGPY = resolve(import.meta.dirname, '_r60-sig.py');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r60-verify');
mkdirSync(OUT, { recursive: true });

const W = 224, H = 298, DEAD_W = 168, DEAD_H = 224;

let pass = 0, fail = 0;
const rows = [];
function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✔ ${name}${detail ? `  —— ${detail}` : ''}`); }
    else { fail++; console.log(`  ✘ ${name}${detail ? `  —— ${detail}` : ''}`); }
    rows.push({ name, ok, detail });
}

/** 数字格式化（null 显示成 n/a，别让 undefined 混进结论） */
const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : 'n/a');

/** 读 PNG 的 IHDR（不依赖任何图像库）——判据 13：尺寸要自己量，别信目录名 */
function pngSize(p) {
    const b = readFileSync(p);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** 调 _r60-sig.py 拿一组签名（与运行期探针同口径） */
function sigOf(paths) {
    if (!paths.length) return [];
    const out = execFileSync(PY, [SIGPY, ...paths], { maxBuffer: 8 * 1024 * 1024 }).toString().trim();
    return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// 运行期探针：遍历场景里所有 Sprite，筛出 spriteFrame 名以 wan1~wan9 开头者，
// 返回它们在**浏览器 CSS 像素**下的屏幕矩形（用于去截图上量真正渲染出来的像素）。
//
// ⚠️ 为什么不在页面里直接读纹理像素：Cocos web 构建把牌面打进 **2048×2048 动态图集**，
//    `spriteFrame.texture.image` 是 **null**（纹理已是原生 GL 纹理），JS 侧根本读不到。
//    实测报错也不是"读到了旧图"，而是 `no-image` —— 这类"工具用错"的假红必须靠
//    **对照组**才能定性：同一套量法打在旧素材的合成图上必须给出另一个数。
//
// ⚠️ `worldPosition` 给的是**锚点所在处**（判据 101），不是矩形中心 ⇒ 先按 anchor 还原矩形。
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
    if (!n) return;
    var sp = n.getComponent ? n.getComponent(C.Sprite) : null;
    var sf = sp ? sp.spriteFrame : null;
    if (sf) {
      var nm = sf.name || '';
      frames[nm] = (frames[nm] || 0) + 1;
      if (/^wan[1-9]/.test(nm)) {
        // 取 UITransform 的正确姿势：n.getComponent(C.UITransform) 在构建后的
        // 产物里拿不到（C.UITransform 未暴露到全局），实测能拿到的是
        // n._uiProps.uiTransformComp。这条排障值得留下 —— 取不到时 width 静默为 0，
        // 表现为"矩形退化成一个点"，而不是报错。
        var ui = null;
        try { ui = n.getComponent(C.UITransform); } catch (e) { ui = null; }
        if (!ui && n._uiProps && n._uiProps.uiTransformComp) ui = n._uiProps.uiTransformComp;
        if (!ui) return walkChildrenOf(n);
        var w = ui.width, h = ui.height;
        var ax = ui.anchorX, ay = ui.anchorY;
        var wp = n.worldPosition, ws = n.worldScale;
        var left = wp.x - ax * w * ws.x;
        var right = left + w * ws.x;
        var topUp = wp.y + (1 - ay) * h * ws.y;
        var botUp = topUp - h * ws.y;
        var topDn = v.h - topUp, botDn = v.h - botUp;
        out.push({
          frame: nm, node: n.name,
          act: n.activeInHierarchy !== false,
          x: cr.l + ((left + right) / 2) * kx,
          y: cr.t + ((topDn + botDn) / 2) * ky,
          w: (right - left) * kx, h: (botDn - topDn) * ky,
        });
      }
    }
    walkChildrenOf(n);
  }
  function walkChildrenOf(n) {
    var ch = n.children;
    for (var i = 0; i < ch.length; i++) walk(ch[i]);
  }
  walk(scene);
  return { tiles: out, frames: frames };
})()
`;

console.log('\n── A 组 · 资产层（离线读写）──');

let sizeBad = [];
for (let i = 1; i <= 9; i++) {
    const p = resolve(BUNDLE, `wan${i}.png`);
    if (!existsSync(p)) { sizeBad.push(`wan${i} 缺失`); continue; }
    const s = pngSize(p);
    if (s.w !== W || s.h !== H) sizeBad.push(`wan${i} ${s.w}x${s.h}`);
}
check('A1 九张万牌成品均为 224×298', sizeBad.length === 0, sizeBad.join(' ') || '9/9');

let deadBad = [];
for (let i = 1; i <= 9; i++) {
    const p = resolve(BUNDLE, `wan${i}_dead.png`);
    if (!existsSync(p)) { deadBad.push(`wan${i}_dead 缺失`); continue; }
    const s = pngSize(p);
    if (s.w !== DEAD_W || s.h !== DEAD_H) deadBad.push(`wan${i}_dead ${s.w}x${s.h}`);
}
check('A2 九张被压灰阶均为 168×224', deadBad.length === 0, deadBad.join(' ') || '9/9');

let metaBad = [];
for (let i = 1; i <= 9; i++) {
    for (const n of [`wan${i}.png.meta`, `wan${i}_dead.png.meta`]) {
        if (!existsSync(resolve(BUNDLE, n))) metaBad.push(n);
    }
}
check('A3 18 个 .meta 全部在位', metaBad.length === 0, metaBad.join(' ') || '18/18');

// ★ 关键判据：「.meta 在位」**不等于**「引用没断」——真正要死守的是 **uuid 不变**。
//   uuid 一变，所有按 uuid 引用的 SpriteFrame 会静默回落（不报错），表现为"牌变空白"。
//   所以这里逐个与 git HEAD 里的 uuid 比对，而不是只看文件在不在。
let uuidBad = [];
for (let i = 1; i <= 9; i++) {
    for (const n of [`wan${i}.png.meta`, `wan${i}_dead.png.meta`]) {
        const p = resolve(BUNDLE, n);
        const nowUuid = JSON.parse(readFileSync(p, 'utf8')).uuid;
        const headUuid = JSON.parse(execFileSync('git', ['show', `HEAD:game-5-cocos/assets/bundles/game/tiles/wan/${n}`],
            { cwd: PROJ, maxBuffer: 8 * 1024 * 1024 }).toString()).uuid;
        if (nowUuid !== headUuid) uuidBad.push(`${n}: ${headUuid} -> ${nowUuid}`);
    }
}
check('A3b 18 个 .meta 的 uuid 与 HEAD 完全一致（引用未断）',
    uuidBad.length === 0, uuidBad.join(' ') || '18/18 一致');

let sameAsHead = 0;
for (let i = 1; i <= 9; i++) {
    const head = execFileSync('git', ['show', `HEAD:game-5-cocos/assets/bundles/game/tiles/wan/wan${i}.png`],
        { cwd: PROJ, maxBuffer: 32 * 1024 * 1024 });
    const now = readFileSync(resolve(BUNDLE, `wan${i}.png`));
    if (Buffer.compare(head, now) === 0) sameAsHead++;
}
check('A4 九张万牌内容与 HEAD 版本逐字节不同（真的换了）', sameAsHead === 0, `与 HEAD 相同的：${sameAsHead} 张`);

let ttDirty = '';
try {
    ttDirty = execFileSync('git', ['diff', '--name-only', '--',
        'game-5-cocos/assets/bundles/game/tiles/tiao', 'game-5-cocos/assets/bundles/game/tiles/tong'],
        { cwd: PROJ }).toString().trim();
} catch (e) { ttDirty = String(e).slice(0, 60); }
check('A5 负控：条/筒 18 张零改动', ttDirty === '', ttDirty || '干净');

// 9 张新牌的静态签名（下界/上界都要落进新牌区间）
const sigNew = sigOf(Array.from({ length: 9 }, (_, i) => resolve(BUNDLE, `wan${i + 1}.png`)));
const sigNewOk = sigNew.filter((s) => !s.err);
check('A6 九张新牌静态签名可读', sigNewOk.length === 9, `${sigNewOk.length}/9`);

console.log('\n── B 组 · 运行期（真实浏览器 · 量真正渲染出来的截图像素）──');

const { proc: srv, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, { width: 421, height: 927, scale: 3 });
let shotPath = null;
let analysis = null;

try {
    await navigateTo(cdp, 'game');
    await sleep(1500);

    const probe = await cdp.ev(PROBE);
    if (probe?.err) throw new Error(`页面探针失败：${probe.err}`);
    const tiles = probe.tiles || [];
    const names = Object.keys(probe.frames || {});
    const liveFrames = [...new Set(tiles.filter((t) => !t.frame.endsWith('_dead')).map((t) => t.frame))];
    const inact = tiles.filter((t) => t.act === false).length;
    console.log(`     探针：命中 wan* 精灵 ${tiles.length} 个（非被压 ${tiles.filter((t) => !t.frame.endsWith('_dead')).length} 个 · 未激活 ${inact} 个）`);
    console.log(`     非被压万牌帧：${liveFrames.join(', ') || '（无）'}`);
    console.log(`     场景 spriteFrame 名（前 26 个）：${names.slice(0, 26).join(', ')}`);

    check('B1 主玩页上确实渲染了万牌精灵（探针自身有分辨力）',
        tiles.filter((t) => !t.frame.endsWith('_dead')).length > 0,
        `非被压 ${tiles.filter((t) => !t.frame.endsWith('_dead')).length} 个`);

    const rectsP = resolve(OUT, 'tile-rects.json');
    writeFileSync(rectsP, JSON.stringify(tiles, null, 2));

    shotPath = await screencastShot(cdp, resolve(OUT, '60-主玩页-新万牌.png'));
    check('B2 主玩页取证截图已落盘（screencastShot，不卡死）', !!shotPath && existsSync(shotPath), String(shotPath));

    const oldP = resolve(OUT, '_head-old', 'wan1.png');
    if (!existsSync(oldP)) {
        mkdirSync(resolve(OUT, '_head-old'), { recursive: true });
        writeFileSync(oldP, execFileSync('git', ['show', 'HEAD:game-5-cocos/assets/bundles/game/tiles/wan/wan1.png'],
            { cwd: PROJ, maxBuffer: 32 * 1024 * 1024 }));
    }
    analysis = JSON.parse(execFileSync(PY,
        [resolve(import.meta.dirname, '_r60-shot-check.py'), shotPath, rectsP,
            resolve(BUNDLE, 'wan1.png'), oldP]).toString().trim());

    const ctl = analysis.control;
    console.log(`     对照（同一套量法 · 亮度≥${analysis.bright_gate} 的占比 f210）：`
        + `新素材 ${fmt(ctl.new.f210 * 100)}% · 旧素材 ${fmt(ctl.old.f210 * 100)}%`);
    console.log(`     门槛（旧素材自身 f210 + 20pt）= ${fmt(analysis.ceiling * 100)}%`);
    console.log(`     截图实测（非被压万牌）：`
        + analysis.live.map((m) => `${m.frame}=${m.f210 === null ? 'n/a' : (m.f210 * 100).toFixed(0) + '%'}`).join('  '));

    check('B3 对照两侧真的分得开（新素材 f210 ≥ max(30%, 旧×5)）', analysis.control_ok === true,
        `新 ${fmt(ctl.new.f210 * 100)}% vs 旧 ${fmt(ctl.old.f210 * 100)}%`);

    // ★ 决定性判据：f210 是**单调量** —— 遮挡只会把它往下拖，旧素材在任何遮挡下
    //   都到不了「自己未被遮挡时的 f210 + 20pt」。所以有一块过了门槛，就只能是新素材。
    check('B4 【决定性】截图上存在万牌，其亮像素占比超过「旧素材本身的上界」',
        analysis.live_max !== null && analysis.live_max >= analysis.ceiling,
        `实测最高 ${analysis.live_max === null ? 'n/a' : (analysis.live_max * 100).toFixed(0)}%`
        + ` vs 门槛 ${fmt(analysis.ceiling * 100)}%`);

    check('B5 负控：同一套量法打在旧素材合成图上必须判「不合格」（判据能被证伪）',
        analysis.old_f210 < analysis.ceiling,
        `旧素材 f210 ${fmt(analysis.old_f210 * 100)}% < 门槛 ${fmt(analysis.ceiling * 100)}%`);

    console.log(`     参考（不设门槛）：${analysis.live_pass}/${analysis.live_n} 块读数超过门槛`
        + ` —— 被别的牌/别的花色压住的块读数会被压低，per 块判「新旧」不可判，只报数`);
} finally {
    try { close(); } catch { /* ignore */ }
    try { srv?.kill?.(); } catch { /* ignore */ }
}

console.log('\n── C 组 · 负控：判据法本身能被证伪 ──');

const oldDir = resolve(OUT, '_head-old');
mkdirSync(oldDir, { recursive: true });
const oldPaths = [];
for (let i = 1; i <= 3; i++) {
    const buf = execFileSync('git', ['show', `HEAD:game-5-cocos/assets/bundles/game/tiles/wan/wan${i}.png`],
        { cwd: PROJ, maxBuffer: 32 * 1024 * 1024 });
    const p = resolve(oldDir, `wan${i}.png`);
    writeFileSync(p, buf);
    oldPaths.push(p);
}
const sigOld = sigOf(oldPaths);
const NL2 = [180, 235], NS2 = [0.02, 0.24];
const oldFlagged = sigOld.filter((s) => !(s.lum >= NL2[0] && s.lum <= NL2[1] && s.sat >= NS2[0] && s.sat <= NS2[1])).length;
check('C1 同一套签名判据打在 HEAD 旧牌上必须判「不合格」（负样本能红）',
    sigOld.length === 3 && oldFlagged === 3,
    `旧牌被判不合格 ${oldFlagged}/3 · 亮度 ${sigOld.map((s) => s.lum.toFixed(0)).join('/')} 饱和 ${sigOld.map((s) => s.sat.toFixed(2)).join('/')}`);

// C2 差分：新牌与旧牌的亮度区间**不相交**（否则 B3 没有分辨力）
const newMin = Math.min(...sigNewOk.map((s) => s.lum));
const oldMax = Math.max(...sigOld.map((s) => s.lum));
check('C2 新牌与旧牌的亮度区间完全不相交（差分判据成立）', newMin > oldMax,
    `新最低 ${newMin.toFixed(1)} > 旧最高 ${oldMax.toFixed(1)}`);

console.log(`\n通过 ${pass} · 失败 ${fail} / 共 ${pass + fail}`);
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ pass, fail, rows, shot: shotPath }, null, 2));
console.log(`报告：${resolve(OUT, 'report.json')}`);

process.exit(fail ? 1 : 0);
