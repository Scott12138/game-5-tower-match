#!/usr/bin/env node
/**
 * _r53-probe-shot2.mjs · 探针 4：`Page.captureScreenshot` **参数真值表**
 *
 * 【为什么要建表】
 *   探针 3 已用「插入已知颜色的 DOM 横条 + 量它落在图里哪一行」把截图映射**实测**出来了：
 *     无参调用 ⇒ 1263×2781（= CSS 421×927 ×3），三条色条全部落在 3× 精确位置，内容 100% 覆盖。
 *   但本工程 `tools/` 下**十几套脚本**在传各种组合：
 *     `captureBeyondViewport:false` ／ `fromSurface:false` ／ `clip{scale:1|2|3}` …
 *   而这些组合**从来没被单独称过**，只有"542×1854 看着像 2×"这种事后解释
 *   （探针 2 更狠：clip{scale:1} 与 clip{scale:3} 出来的图 **md5 完全相同** ⇒ scale 被忽略了）。
 *
 *   判据 1：**判据自身也要被验证** —— 截图就是本轮所有取证的尺子，尺子没标定过，量出来的都不能用。
 *
 * 【判定口径】对每一张图报告：
 *   · 实际像素尺寸        → 反推倍率
 *   · GREEN@CSS200 落在哪 → ÷3(=期望倍率) 后应 ≈ 207.8，偏了就是映射不对
 *   · RED@CSS900 落在哪   → **关键**：它命不命中，直接暴露"底部还在不在图里"
 *   · 内容结束行          → 覆盖是否 100%
 *
 * 【用法】node tools/_r53-probe-shot2.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-shot-matrix');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

const CLIP1 = { x: 0, y: 0, width: W, height: H, scale: 1 };
const CLIP3 = { x: 0, y: 0, width: W, height: H, scale: SCALE };

/** 待测组合。名字里写清参数，出图文件名 = 名字，便于 python 侧对号入座。 */
const CASES = [
    ['V1-default', { format: 'png' }],
    ['V2-beyond-false', { format: 'png', captureBeyondViewport: false }],
    ['V3-surface-false', { format: 'png', fromSurface: false }],
    ['V4-both-false', { format: 'png', captureBeyondViewport: false, fromSurface: false }],
    ['V5-clip1', { format: 'png', clip: CLIP1 }],
    ['V6-clip3', { format: 'png', clip: CLIP3 }],
    ['V7-clip3+beyondfalse', { format: 'png', clip: CLIP3, captureBeyondViewport: false }],
    ['V8-clip1+beyondtrue', { format: 'png', clip: CLIP1, captureBeyondViewport: true }],
];

try {
    await navigateTo(cdp, 'game');
    await sleep(900);

    // 落标尺：三条已知颜色的 DOM 横条（DOM 合成路径 ≠ canvas）
    const marked = await cdp.ev(`(function () {
        var bars = [[200,'#00ff00'],[500,'#0000ff'],[900,'#ff0000']];
        for (var i = 0; i < bars.length; i++) {
            var d = document.createElement('div');
            d.id = 'mtx-' + bars[i][0];
            d.style.cssText = 'position:fixed;left:0;width:100%;height:16px;z-index:2147483647;' +
                              'background:' + bars[i][1] + ';';
            d.style.top = bars[i][0] + 'px';
            document.body.appendChild(d);
        }
        return { viewport: window.innerWidth + 'x' + window.innerHeight,
                 bars: [[200,200],[500,500],[900,900]] };
    })()`);
    console.log('\n===== 标尺 =====');
    console.log(JSON.stringify(marked));

    for (const [name, params] of CASES) {
        try {
            const r = await cdp.send('Page.captureScreenshot', params, 45000);
            const buf = Buffer.from(r.data, 'base64');
            // 只读 PNG IHDR 的宽高，不引依赖
            const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
            writeFileSync(join(OUT, `${name}.png`), buf);
            console.log(`  [✓] ${name.padEnd(24)} ${w}x${h}  ${buf.length} bytes`);
        } catch (e) {
            console.log(`  [✗] ${name.padEnd(24)} 超时/失败：${String(e.message || e).slice(0, 90)}`);
        }
    }

    console.log('\n探针 4 完成');
} finally {
    await close();
    proc.kill();
}
