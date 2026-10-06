#!/usr/bin/env node
/**
 * ============================================================
 *  r40-shot-dice.mjs · 抓「方案 B 追尾」掷骰动画的关键帧
 * ============================================================
 *
 *  【和 r38 版有什么不同】
 *  r38 用的是"点完首页 → sleep 若干毫秒 → 截图"，靠**时间对齐**去撞关键帧：
 *  机器一慢就抓偏，而且抓不到 `t=300ms` 这个只有几毫秒宽的"追尾侧碰"瞬间。
 *
 *  本轮 `GameStartPage` 的时间轴已经改成**纯函数 `applyFrame(t)`**，
 *  调试桥多了 `seek(t)`（冻帧）/ `replay()` —— 于是可以**指名道姓地**要求
 *  "把动画停在 300.0ms 给我看"，与机器快慢完全无关。
 *
 *  【用法】node tools/r40-shot-dice.mjs [输出目录]
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] ?? '/tmp/g5-dice-r40');
mkdirSync(OUT, { recursive: true });
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

/** 要冻住的关键帧（ms 一律相对 `onEnter`，与 DiceMotion.TL 同口径） */
const MARKS = [
    [0, 'a-驱动反馈·骰子静止'],
    [150, 'b-加速绕盘·角分离收窄'],
    [250, 'c-撞前·即将贴合'],
    [300, 'd-追尾侧碰瞬间'],
    [330, 'e-咬合期'],
    [420, 'f-挤压回弹'],
    [700, 'g-惯性滑行·分离'],
    [950, 'h-自转归零·看清点数'],
    [1150, 'i-定格(拉远起点)'],
    [1550, 'j-拉远中'],
    [1950, 'k-拉远完成·整张麻将桌'],
];

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { width: 421, height: 927, scale: 2 });

try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    const waitLog = async (sub, ms = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (cdp.logs.some((l) => l.text.includes(sub))) return true;
            await sleep(120);
        }
        return false;
    };
    await waitLog('[PageManager] → home');
    await sleep(1600);

    const p = await cdp.ev('window.__g5t.centerOf("BtnStart")');
    if (!p) throw new Error('首页找不到 BtnStart');
    await cdp.click(p.x, p.y);
    await waitLog('[PageManager] → gameStart');

    // 停掉自动播放，之后完全由 seek 指挥
    await waitFor(cdp, '!!window.__g5dice', 8000, '掷骰调试桥');
    const gift = await cdp.ev('window.__g5dice.gift');
    const total = await cdp.ev('window.__g5dice.total');
    console.log(`  本局赠礼：${JSON.stringify(gift)}   时间轴总长 ${total}ms`);

    for (const [t, tag] of MARKS) {
        await cdp.ev(`window.__g5dice.seek(${t})`);
        await sleep(220);                       // 让 renderer 把这一帧画出来
        const f = join(OUT, `${tag}.png`);
        await cdp.shot(f);
        console.log(`  📷 t=${String(t).padStart(4)}ms  ${f}`);
    }

    // 把**游戏内**这条 scan 曲线也存下来 —— 它是"游戏里真的加载了这份运动学"的证据
    const scan = await cdp.ev('window.__g5dice.scan(5)');
    writeFileSync(join(OUT, 'scan.json'), JSON.stringify(scan, null, 1));
    console.log(`  📄 ${join(OUT, 'scan.json')}（${scan.length} 条）`);

    console.log('✅ 抓帧完成');
} catch (e) {
    console.log(`❌ 中断：${e.message}`);
    process.exitCode = 1;
} finally {
    await sleep(200);
    close();
    srv.proc.kill();
}
