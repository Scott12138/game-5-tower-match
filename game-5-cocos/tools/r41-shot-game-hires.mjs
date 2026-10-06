#!/usr/bin/env node
/**
 * ============================================================
 *  r41-shot-game-hires.mjs · 主玩页「真机 3× 高清」截图
 * ============================================================
 *  【为什么需要它】
 *  第 41 轮要给主玩页换底色，做候选样底对比板。对比板需要把**真实页面内容**
 *  （麻将桌 / 牌堆 / HUD / 槽位 / 道具栏）叠到候选底色上，
 *  而 `g5-device-audit.mjs` 出的截图是 **CSS 421×927**（低分），
 *  抠出前景再放大到对比板尺寸会糊。
 *
 *  所以这里用 `Page.captureScreenshot` 的 `clip.scale = 3` 拿到
 *  **1263×2781 物理像素**（与真机 1264×2780 差 1px，可忽略），
 *  正好等于 1 设计 px = 1.6853 物理 px 的真机口径。
 *
 *  ⚠️ 用 clip 而不是 `Emulation.setDeviceMetricsOverride.deviceScaleFactor`：
 *     后者在本机 headless 实测**不出高分图**（仍返回 CSS 尺寸），
 *     而 clip.scale 稳定生效（`g5-shot-frame.mjs` 已长期验证）。
 *
 *  【用法】
 *      node tools/r41-shot-game-hires.mjs <输出目录>
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openBrowser, navigateTo, startServer, sleep } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r41-game-hires');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, SCALE = 3;

const { port, proc, url } = await startServer(resolve(import.meta.dirname, '..', 'build', 'web-desktop'));
const { cdp, close } = await openBrowser(url, { width: W, height: H, scale: 1 });

try {
    await navigateTo(cdp, 'game');
    await sleep(900);

    // 关掉一切可能还在跳的动效：主玩页入场结束后再截
    const box = { x: 0, y: 0, w: W, h: H };
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: SCALE },
        captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, 'game-3x.png');
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    console.log(`[ok] ${p}  (目标 ${W * SCALE}×${H * SCALE})`);

    const errs = cdp.errors.filter((e) => !/ERR_|favicon/i.test(e));
    console.log(`[i] 未捕获异常 ${errs.length} 条`);
    for (const e of errs.slice(0, 5)) console.log('    ' + e);
} finally {
    close();
    proc.kill();
}
