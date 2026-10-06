#!/usr/bin/env node
/**
 * ============================================================
 *  r39-corner.mjs · 把「按钮 / 道具格 / 槽位 / 进度条」放大拍到能验圆角
 * ============================================================
 *  【为什么必须放大拍】
 *  第 39 轮的核心 bug 是「按钮顶面渲染成矩形、四个角露出方形金块」。
 *  用 `g5-device-audit.mjs` 的整屏图（CSS 421×927）根本看不出来：
 *  540 设计 px 的按钮在图上只有 303 CSS px、圆角只有 28px，
 *  缩略图里"圆不圆"完全分不清。
 *  ⇒ 这里用 `Page.captureScreenshot({clip, scale})` 只截按钮那一条、
 *    再放大 4 倍，让圆角占满视野。
 *
 *  【用法】
 *      node tools/r39-corner.mjs [输出目录]        # 默认 /tmp/g5-r39-shot
 *
 *  产物（全部是 CSS 像素的裁切窗 × 倍率）：
 *      gift-btn.png    开局页「开始挑战」@4x
 *      hud-top.png     主玩页顶带（进度条 + 倒计时 + 规则）@3x
 *      hud-bottom.png  主玩页底带（槽位条 + 道具栏）@3x
 *      res-gold.png    结算页「下一关」@4x
 *      res-ghost.png   结算页「分享」@4x
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { designToCss, openBrowser, sleep, startServer, tapNode, waitFor, waitLog } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] ?? '/tmp/g5-r39-shot');
mkdirSync(OUT, { recursive: true });
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { width: 421, height: 927, scale: 1 });

/** 当前画布在页面上的 CSS 矩形（用来把裁切窗夹在视口内） */
async function canvasBox() {
    const r = await cdp.ev('window.__g5t.canvasRect()');
    return r || { l: 0, t: 0, w: 421, h: 927 };
}

/**
 * 裁一块并放大 scale 倍。
 * ⚠️ `clip.x` **不能为负** —— 负值会让 CDP 截出偏移错乱的图
 *    （第一次跑 `hud-top` 时 x=−88，结果画面整体左移、右侧一大片是页面背景色，
 *     差点误判成"顶带右半没渲染"）。所以这里一律夹进画布矩形内。
 */
async function clipShot(file, cx, cy, winW, winH, scale) {
    const box = await canvasBox();
    const x = Math.max(box.l, Math.round(cx - winW / 2));
    const y = Math.max(box.t, Math.round(cy - winH / 2));
    const w = Math.min(Math.round(winW), Math.round(box.l + box.w - x));
    const h = Math.min(Math.round(winH), Math.round(box.t + box.h - y));
    const clip = { x, y, width: w, height: h };
    const r = await cdp.send('Page.captureScreenshot',
        { format: 'png', clip: { ...clip, scale } });
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
    console.log(`  📷 ${file}  clip=${JSON.stringify(clip)} ×${scale}`
        + `  → ${w * scale}×${h * scale}`);
}

/** 以某个具名节点的中心为心裁一块 */
async function zoom(name, file, winW, winH, scale, dy) {
    const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
    if (!p) throw new Error(`找不到节点 ${name}`);
    await clipShot(file, p.x, p.y + (dy ?? 0), winW, winH, scale);
}

try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    // ---- ① 开局页：赠礼卡上的「开始挑战」 ----
    if (!(await waitLog(cdp, '[PageManager] → home', 20000))) throw new Error('没到首页');
    await sleep(1600);
    await tapNode(cdp, 'BtnStart');
    if (!(await waitLog(cdp, '[PageManager] → gameStart', 12000))) throw new Error('没到开局页');
    await sleep(6300);                                   // 掷骰 + 赠礼卡展开 + 按钮呼吸
    await zoom('BtnGo', 'gift-btn.png', 340, 86, 4);

    // ---- ② 主玩页：顶带 / 底带 ----
    await tapNode(cdp, 'BtnGo');
    if (!(await waitLog(cdp, '[PageManager] → game', 15000))) throw new Error('没到主玩页');
    await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');
    await sleep(2400);
    // 顶带：进度条在画面**最左**，窗口必须夹到画布左缘，不能居中（否则 x 为负）
    await zoom('Progress', 'hud-top.png', 340, 130, 3, 0);

    // ★ 点掉 3 张同面牌，把进度条推到非零 —— 否则 0% 时填充是 0 宽，
    //   根本验不了"填充色到底是不是玉绿"（第一版截图就是 0/12，白跑一趟）。
    const trio = await cdp.ev(`(() => {
        const a = window.__game5.pickables(), by = {};
        for (const p of a) (by[p.face] = by[p.face] || []).push(p);
        const g = Object.values(by).find((v) => v.length >= 3);
        return g ? g.slice(0, 3) : null;
    })()`);
    if (trio) {
        const css = await designToCss(cdp, trio);
        for (const p of css) { await cdp.click(p.x, p.y); await sleep(520); }
        console.log(`  已点掉 3 张同面牌（垫进度条），state = `
            + JSON.stringify(await cdp.ev('window.__game5.state()')));
    } else {
        console.log('  ⚠ 凑不出 3 张同面可点牌，进度条仍为 0 —— 填充色这一项没验到');
    }
    await sleep(700);
    await zoom('Progress', 'hud-progress.png', 340, 60, 6, 0);

    // 底带：槽位条 + 道具栏（槽位条中心 → 往下 100 CSS ≈ 道具栏中线）
    await zoom('SlotBar', 'hud-bottom.png', 400, 300, 3, 100);

    // ---- ③ 结算页：金 / 幽两按钮 ----
    const ok = await cdp.ev('!!(window.__game5 && window.__game5.demoResult(true))');
    if (!ok) throw new Error('结算弹层调试口不可用（__game5.demoResult）');
    await sleep(1600);
    await zoom('BtnNext', 'res-gold.png', 340, 86, 4);
    await zoom('BtnShare', 'res-ghost.png', 340, 64, 4);
    // 整张结算卡（看两按钮与卡片整体的关系，也用来抓"幽灵亮线"这类整体问题）
    await zoom('BtnShare', 'res-card.png', 400, 500, 1.6, -120);

    console.log(`✅ 抓图完成 → ${OUT}`);
} catch (e) {
    console.log(`❌ 中断：${e.message}`);
    process.exitCode = 1;
} finally {
    await sleep(200);
    close();
    srv.proc.kill();
}
