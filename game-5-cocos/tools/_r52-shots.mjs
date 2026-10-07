#!/usr/bin/env node
/**
 * ============================================================
 *  _r52-shots.mjs · 第 52 轮 · 取证截图（给对照板用）
 * ============================================================
 *  只做一件事：把本轮**新出现的三个界面态**用真实鼠标走到、再截图。
 *    01 设置抽屉 · 两开关都开（起点）
 *    02 设置抽屉 · 音效关 / 音乐开（**异档** —— 这是"解耦"最直观的证据）
 *    03 「重置进度」的二次确认层
 *    04 「返回首页」的二次确认层（叠在暂停面板之上）
 *
 *  ⚠️ 口径：截图一律走 `verifiedShot()`（`g5-cdp.mjs` 导出），视口 421×927 @3
 *     ⇒ 出图 **1263×2781**，与真机 1264×2780 差 1px，可忽略。
 *     **别自己写 `captureScreenshot` 参数** —— 本脚本第 52 轮的原版传了
 *     `clip{scale:3} + captureBeyondViewport:false + fromSurface:false`，
 *     出来的其实是 **842×1854 的残图**（底部 15.5% 全丢）。当时日志里那句
 *     "实际出图 2×" 是**把故障当成了口径**。真值表见 `g5-cdp.mjs` 的 `verifiedShot` 注释。
 *  ⚠️ 视口 421×927（真机基线），不是已作废的 750×1334。
 *
 *  【用法】node tools/_r52-shots.mjs
 * ============================================================
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode, verifiedShot } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r52-shots');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

async function exists(name) {
    return await cdp.ev('!!window.__g5t.find(' + JSON.stringify(name) + ')');
}

async function tap(name) {
    try { await tapNode(cdp, name); return true; } catch { return false; }
}

/** 点「某开关行」里的开关（Sw 与行内其他子节点重名 ⇒ 必须按父行定位） */
async function tapSwitchOf(rowName) {
    const p = await cdp.ev(
        '(function () {\n'
        + '  var row = window.__g5t.find(' + JSON.stringify(rowName) + ');\n'
        + '  if (!row) return null;\n'
        + '  for (var i = 0; i < row.children.length; i++) {\n'
        + "    if (row.children[i].name === 'Sw') {\n"
        + '      var r = window.__g5t.worldToScreen(row.children[i]);\n'
        + '      return r ? { x: r.x, y: r.y } : null;\n'
        + '    }\n'
        + '  }\n'
        + '  return null;\n'
        + '})()');
    if (!p) return false;
    await cdp.click(p.x, p.y);
    return true;
}

async function shot(name) {
    // ⚠️ 历史包袱（留档，别再照着写）：
    //   第 52 轮的原版写的是 `clip{scale:3} + captureBeyondViewport:false + fromSurface:false`。
    //   · `captureBeyondViewport:true` 在本工程页面（画布满屏 + 持续 RAF）上**一直不返回** ✔已确认
    //   · `fromSurface:true` + DPR3 会挂死（连 `Runtime.evaluate` 一起卡住） ✔已确认
    //   · ✘ **但"所以固定 `fromSurface:false`"是错的结论** —— 那会把图静默截成 842×1854。
    //     第 53 轮用"插已知颜色色条再量落点"称出真值表，正解是**只留**
    //     `{format:'png', captureBeyondViewport:false}`：1263×2781、覆盖 100%、且很快。
    //   现在统一交给 `verifiedShot()`，它捕获后会验 IHDR 宽高，残图直接抛错。
    const out = await verifiedShot(cdp, join(OUT, `${name}.png`), { w: W, h: H, scale: SCALE });
    console.log(`[✓] ${name}  视口 ${W}×${H} css → 出图 ${W * SCALE}×${H * SCALE} → ${out}`);
}

// ⚠️ 这里**故意不**清 localStorage、也**不** `Page.reload`。
//   ① `openBrowser` 每次都用 `mkdtempSync` 开全新 profile ⇒ 静音键本来就是空的。
//   ② 更要紧：本工程页面在 `Page.reload` 之后再调 `Page.captureScreenshot`
//      会**一直不返回**（headless=new 上的老毛病，实测两次：30s 与 90s 都超时）。
//      不重载就一次都没超时。

try {
    // ---- 01/02 设置抽屉 ----
    await navigateTo(cdp, 'home');
    await sleep(500);
    if (!(await tap('Setting'))) throw new Error('点不到设置入口');
    await sleep(800);
    if (!(await exists('Sheet'))) throw new Error('设置抽屉没起来');
    await shot('01-设置抽屉-两开关都开');

    // 只关「音效」，音乐保持开 → 异档
    if (!(await tapSwitchOf('Row_音效'))) throw new Error('点不到音效开关');
    await sleep(600);
    const keys = await cdp.ev('({sfx: localStorage.getItem("game5.mute.sfx"),'
        + ' bgm: localStorage.getItem("game5.mute.bgm")})');
    console.log('    异档确认 sfx/bgm =', JSON.stringify(keys));
    if (keys.sfx !== '1' || keys.bgm !== null) {
        console.log('    ⚠️ 没有形成"异档"（sfx=1 且 bgm 未写）—— 截图仍保留，但要留意');
    }
    await shot('02-设置抽屉-音效关音乐开');

    // ---- 03 重置进度确认层 ----
    if (!(await tap('Link_重置进度'))) throw new Error('点不到重置进度');
    await sleep(700);
    if (!(await exists('ConfirmDialog'))) throw new Error('重置确认层没出现');
    await shot('03-确认层-重置进度');
    await tap('BtnCancel');
    await sleep(500);
    await tap('Close');
    await sleep(600);

    // ---- 04 返回首页确认层 ----
    await navigateTo(cdp, 'game');
    await sleep(800);
    if (!(await tap('Pause'))) throw new Error('点不到暂停键');
    await sleep(700);
    if (!(await exists('PausePanel'))) throw new Error('暂停面板没出现');
    if (!(await tap('Btn_返回首页'))) throw new Error('点不到返回首页');
    await sleep(700);
    if (!(await exists('ConfirmDialog'))) throw new Error('返回首页确认层没出现');
    await shot('04-确认层-返回首页');

    console.log('\n全部截图完成：' + OUT);
} finally {
    await close();
    proc.kill();
}
