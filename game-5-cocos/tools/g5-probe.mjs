#!/usr/bin/env node
/**
 * ============================================================
 *  g5-probe.mjs · 探针：把"页面到底起没起来"一次问清
 * ============================================================
 *  冒烟脚本失败时最需要看到的恰恰是它吞掉的报错。本脚本只做取证、不做断言：
 *    · 全部 console 输出（Cocos 的 log() 走 console.log）
 *    · 全部未捕获异常 / 控制台错误
 *    · 可视尺寸、画布 CSS 矩形、引擎是否就绪
 *    · 场景树里"有名字的节点"及其屏幕坐标（用它来找按钮）
 *    · `__game5` 桥接状态（游戏页才挂）
 *    · 一张全屏截图
 *
 *  【用法】
 *    node tools/g5-probe.mjs [等待毫秒] [输出目录]
 *  默认：等待 9000ms、输出 /tmp/g5-probe
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const WAIT_MS = Number(process.argv[2] || 9000);
const OUT = resolve(process.argv[3] || '/tmp/g5-probe');
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

const srv = await startServer(DIST);
console.log(`==> 静态服务器就绪：${srv.url}`);
await mkdir(OUT, { recursive: true });

const { cdp, close } = await openBrowser(srv.url);
let failed = false;
try {
    // 引擎就绪的判据：`cc` 全局出现。用 30s 上限，超时不是"慢"而是"没起来"。
    const tCocos = await waitFor(cdp, 'typeof cc !== "undefined"', 30000, 'cc 全局出现');
    console.log(`==> 引擎加载完成（+${tCocos}ms）`);

    await waitFor(cdp, '!!(cc.director && cc.director.getScene())', 15000, '场景就绪');
    await sleep(WAIT_MS);

    const info = await cdp.ev(`(() => {
        const v = window.__g5t.view();
        const r = window.__g5t.canvasRect();
        return {
            title: document.title,
            gameDiv: (() => { const e = document.getElementById('GameDiv'); if (!e) return null;
                const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })(),
            visible: v ? { w: Math.round(v.w), h: Math.round(v.h) } : null,
            canvas: r ? { l: Math.round(r.l), t: Math.round(r.t), w: Math.round(r.w), h: Math.round(r.h) } : null,
            bridge: typeof globalThis.__game5 !== 'undefined',
            sceneNodes: (() => { const s = cc.director.getScene(); return s ? s.children.map(c => c.name) : null; })(),
        };
    })()`);
    console.log('==> 页面信息：', JSON.stringify(info, null, 2));

    const named = await cdp.ev('JSON.stringify(window.__g5t.listNamed())');
    await writeFile(join(OUT, 'scene-tree.json'), named);
    const nodes = JSON.parse(named);
    console.log(`==> 场景节点（有 UITransform 且 active）：${nodes.filter(n => n.active).length} / 共 ${nodes.length}`);
    console.log('    顶层可点候选（前 40）：');
    for (const n of nodes.filter((x) => x.active).slice(0, 40)) {
        console.log(`      ${String(n.name).padEnd(22)} ${String(n.w ?? '-').padStart(5)}×${String(n.h ?? '-').padStart(5)}  @ ${n.x},${n.y}`);
    }

    const shot = join(OUT, 'probe.png');
    await cdp.shot(shot);
    console.log(`==> 截图：${shot}`);
} catch (e) {
    failed = true;
    console.log(`❌ 探针失败：${e.message}`);
} finally {
    await writeFile(join(OUT, 'console.log'), cdp.logs.map((l) => `[${l.level}] ${l.text}`).join('\n'));
    await writeFile(join(OUT, 'errors.log'), cdp.errors.join('\n\n'));
    console.log(`\n===== 控制台（${cdp.logs.length} 条，全量见 ${join(OUT, 'console.log')}）=====`);
    for (const l of cdp.logs.slice(0, 80)) console.log(`  [${l.level}] ${l.text}`);
    if (cdp.logs.length > 80) console.log(`  … 另有 ${cdp.logs.length - 80} 条`);
    console.log(`\n===== 异常 / 错误（${cdp.errors.length} 条）=====`);
    for (const e of cdp.errors.slice(0, 20)) console.log(`  ${e.split('\n')[0]}`);
    if (cdp.errors.length) failed = true;

    close();
    srv.proc.kill();
}
process.exit(failed ? 1 : 0);
