#!/usr/bin/env node
/**
 * _r53-probe-shot3.mjs · 探针 5：真值表补最后两格（`clip{scale:3}` 到底出什么）
 *
 * 【为什么还要补】探针 4 把 `clip:{...,scale:3}` 两类组合在 **45s** 上判了"超时"，
 *   但工程里 `_r46 / _r47 / _r47b / _r48 / _r49` 等脚本用的正是这两类、且显式给了 **90s**
 *   并**跑出过关**。所以"超时"这个结论不完整 —— 得知道它们**最终出的图完不完整**。
 *   判据 1：结论要能覆盖实际在用的路径，不能只标定我用得顺手的那一条。
 *
 *   本探针给到 **150s**，并沿用"插已知色条再量落点"的称法。
 *
 * 【用法】node tools/_r53-probe-shot3.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-shot-matrix2');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

const CLIP3 = { x: 0, y: 0, width: W, height: H, scale: SCALE };
const CASES = [
    ['W1-clip3-only', { format: 'png', clip: CLIP3 }],
    ['W2-clip3+beyondfalse', { format: 'png', clip: CLIP3, captureBeyondViewport: false }],
];

try {
    await navigateTo(cdp, 'game');
    await sleep(900);
    await cdp.ev(`(function () {
        var bars = [[200,'#00ff00'],[500,'#0000ff'],[900,'#ff0000']];
        for (var i = 0; i < bars.length; i++) {
            var d = document.createElement('div');
            d.style.cssText = 'position:fixed;left:0;width:100%;height:16px;z-index:2147483647;' +
                              'background:' + bars[i][1] + ';top:' + bars[i][0] + 'px;';
            document.body.appendChild(d);
        }
        return true;
    })()`);

    for (const [name, params] of CASES) {
        const t0 = Date.now();
        try {
            const r = await cdp.send('Page.captureScreenshot', params, 150000);
            const buf = Buffer.from(r.data, 'base64');
            const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
            writeFileSync(join(OUT, `${name}.png`), buf);
            console.log(`  [✓] ${name.padEnd(22)} ${w}x${h}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        } catch (e) {
            console.log(`  [✗] ${name.padEnd(22)} 150s 仍超时/失败：${String(e.message || e).slice(0, 70)}`);
        }
    }
    console.log('\n探针 5 完成');
} finally {
    await close();
    proc.kill();
}
