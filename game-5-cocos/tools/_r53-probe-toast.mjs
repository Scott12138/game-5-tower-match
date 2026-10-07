#!/usr/bin/env node
/**
 * _r53-probe-toast.mjs · 探针：结算弹层上的 toast 到底在哪、被谁盖住
 *
 * 【为什么要它】`_r53-verify.mjs` 里「浏览器不支持分享 -> 弹 toast」那条断言
 *   用的是"场景里有没有这段文字"，**它不看遮挡、也不看亮度**。
 *   而取证截图 `07-分享-浏览器降级提示.png` 的底部**看不到那条 toast**。
 *   两者矛盾 ⇒ 必须先量清楚，不能靠猜（可能只是被 60% 蒙层压暗、也可能是真的被挡住）。
 *
 * 量三件东西：
 *   ① `Toast` 节点的屏幕矩形（CSS px）+ UIOpacity
 *   ② 该点上的**命中栈**（`__g5t.hit`）—— 谁在它上面
 *   ③ 同一时刻的截图（用于人眼对照）
 *
 * ★ 结案（同轮）：矛盾的真因**不在产品**，在本探针自己 —— 它把截图参数写成了
 *   `fromSurface:false, clip{scale:3}`，那组合会出 **842×1854 的残图**（底部 15.5% 全丢）。
 *   toast 一直在（opacity 255、在命中栈首位），只是**从来没被画进那张图里**。
 *   现已改走 `verifiedShot()`（带尺寸自证）；参数真值表见 `g5-cdp.mjs`。
 *
 * 【用法】node tools/_r53-probe-toast.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer, tapNode, verifiedShot } from './g5-cdp.mjs';

const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r53-probe');
mkdirSync(OUT, { recursive: true });
const W = 421, H = 927, SCALE = 3;

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, {
    seedScript: seedAtLevel(3), width: W, height: H, scale: SCALE,
});

async function shot(name) {
    const out = await verifiedShot(cdp, join(OUT, `${name}.png`), { w: W, h: H, scale: SCALE });
    console.log(`  [shot] ${out}`);
}

try {
    await navigateTo(cdp, 'game');
    await sleep(800);
    await cdp.ev('(function () { __game5.demoResult(true); return true; })()');
    await sleep(800);
    await tapNode(cdp, 'BtnShare');

    // 0.35s 时读数 + 截图（此时 opacity 应已到 255，duration 1.5s 还没开始淡出）
    await sleep(350);

    const info = await cdp.ev(`(function () {
        var vs = cc.view.getVisibleSize();
        var r = window.__g5t.canvasRect();
        var n = window.__g5t.find('Toast');
        if (!n) return { found: false, vs: { w: vs.width, h: vs.height } };
        var u = n.getComponent('cc.UITransform');
        var op = n.getComponent('cc.UIOpacity');
        var wp = n.worldPosition;
        var p = window.__g5t.worldToScreen(n);
        var lab = null;
        for (var i = 0; i < n.children.length; i++) {
            var L = n.children[i].getComponent && n.children[i].getComponent('cc.Label');
            if (L) lab = L.string;
        }
        return {
            found: true, text: lab,
            opacity: op ? op.opacity : null,
            design: { x: Math.round(wp.x), y: Math.round(vs.height - wp.y),
                      w: u ? Math.round(u.width) : null, h: u ? Math.round(u.height) : null },
            screen: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
            parent: n.parent ? n.parent.name : null,
            canvas: r ? { l: r.l, t: r.t, w: r.w, h: r.h } : null,
            hit: p ? window.__g5t.hit(p.x, p.y) : null,
            siblingsAbove: null,
        };
    })()`);

    console.log('\n===== Toast 量测 =====');
    console.log(JSON.stringify(info, null, 2));

    // 兄弟层级：ResultLayer（在 TopLayer 下）是否在 Toast 之上
    const layers = await cdp.ev(`(function () {
        var s = cc.director.getScene();
        var out = [];
        (function walk(n, depth) {
            if (n.activeInHierarchy && depth <= 4) out.push({ d: depth, name: n.name,
                parent: n.parent ? n.parent.name : null,
                has: (function(){ var l=n.getComponent&&n.getComponent('cc.Label'); return l?l.string:''; })() });
            for (var i = 0; i < n.children.length; i++) walk(n.children[i], depth + 1);
        })(s, 0);
        return out.filter(function (r) {
            return /TopLayer|ResultLayer|ResultCard|Dim|Body|Toast|Page_game/.test(r.name);
        });
    })()`);
    console.log('\n===== 层级（深度<=4） =====');
    for (const r of layers) {
        console.log(`${'  '.repeat(r.d)}${r.name}  <- ${r.parent}${r.has ? '   ["' + r.has + '"]' : ''}`);
    }

    await shot('toast-at-350ms');
    await sleep(900);
    await shot('toast-at-1250ms');

    console.log('\n探针完成');
} finally {
    await close();
    proc.kill();
}
