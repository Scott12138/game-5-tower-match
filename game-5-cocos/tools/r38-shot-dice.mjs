#!/usr/bin/env node
/**
 * ============================================================
 *  r38-shot-dice.mjs · 抓「开局页掷骰」的关键几帧
 * ============================================================
 *  【为什么要专门做它】
 *  开局页的骰子只在 **进入页面后的第 0.18s ~ 1.28s** 之间露在外面，之后就被
 *  赠礼层的暗场盖住了 —— 用 `g5-device-audit.mjs` 那种"等 4.6s 再拍"的快照
 *  **永远拍不到骰子**，也就没法验证"骰子有没有落在桌面金环里"。
 *
 *  时间轴（自 `onEnter` 起算，见 GameStartPage 的 T 常量）：
 *      0.18s 开始落盘 → 0.88s 落定 + 开始拉远 → 1.16s 拉远到位 → 1.28s 赠礼卡浮现
 *
 *  【用法】
 *      node tools/r38-shot-dice.mjs [输出目录]        # 默认 /tmp/g5-dice
 * ============================================================
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] ?? '/tmp/g5-dice');
mkdirSync(OUT, { recursive: true });
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { width: 421, height: 927, scale: 1 });

try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    // 等启动页真的转场到首页再点（写死 sleep 会在机器慢的时候点空）
    const waitLog = async (sub, ms = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (cdp.logs.some((l) => l.text.includes(sub))) return true;
            await sleep(120);
        }
        return false;
    };
    await waitLog('[PageManager] → home');
    await sleep(1600);                                   // 首页入场动效收尾

    const p = await cdp.ev('window.__g5t.centerOf("BtnStart")');
    if (!p) throw new Error('首页找不到 BtnStart');
    await cdp.click(p.x, p.y);

    // 点击 → 转场 240ms → onEnter。所以下面的 sleep 要减掉转场时间。
    const marks = [
        [500, 'a-落盘中'],
        [850, 'b-落定'],
        [1150, 'c-拉远中'],
        [1350, 'd-拉远完成'],
        [1700, 'e-赠礼卡'],
    ];
    let prev = 0;
    for (const [t, tag] of marks) {
        await sleep(t - prev);
        prev = t;
        const f = join(OUT, `${tag}.png`);
        await cdp.shot(f);
        console.log(`  📷 ${f}`);
    }
    console.log('✅ 抓帧完成');
} catch (e) {
    console.log(`❌ 中断：${e.message}`);
    process.exitCode = 1;
} finally {
    await sleep(200);
    close();
    srv.proc.kill();
}
