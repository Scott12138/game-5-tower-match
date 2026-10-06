#!/usr/bin/env node
/**
 * ============================================================
 *  g5-shot-frame.mjs · 把「定稿 HTML 里的手机画布」干净地截出来
 * ============================================================
 *  【为什么需要它】
 *  定稿稿（`assets/splash/启动页-定稿.html` / `assets/home/首页-定稿.html`）是
 *  **设计对账的唯一真源**，但它外层包着预览壳（标题、说明、坐标表），直接整页
 *  截图会带一堆无关内容，没法跟游戏截图逐像素比。
 *
 *  本脚本：加载页面 → 量 `.frame`（手机壳）的包围盒 → 用 CDP 的 `clip` 只截那一块。
 *  `.frame` 是 372×660 CSS、内部 `.screen` 是 750×1334 `scale(.496)` ⇒ 截出来的
 *  就是 **750×1334 的设计画布**（dpr=2 时 744×1320，宽高比 0.5636 ≈ 750/1334）。
 *
 *  【用法】
 *      node tools/g5-shot-frame.mjs --html <路径> --out <png> [--w 750 --h 1334]
 *      node tools/g5-shot-frame.mjs --all --outdir /tmp/g5-ref
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openBrowser, sleep } from './g5-cdp.mjs';

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const ROOT = resolve(import.meta.dirname, '..', '..');
const PAGES = [
    { name: 'splash-final', html: join(ROOT, 'assets', 'splash', '启动页-定稿.html') },
    { name: 'home-final', html: join(ROOT, 'assets', 'home', '首页-定稿.html') },
];

const OUTDIR = resolve(argOf('--outdir', '/tmp/g5-ref'));
mkdirSync(OUTDIR, { recursive: true });

const targets = has('--all')
    ? PAGES
    : [{ name: argOf('--name', 'shot'), html: resolve(argOf('--html', PAGES[0].html)) }];

// 视口给大一点，保证手机壳完整落在首屏内（不滚动）
const { cdp, close } = await openBrowser('about:blank', { width: 760, height: 1400, scale: 1 });

try {
    for (const t of targets) {
        await cdp.send('Page.navigate', { url: pathToFileURL(t.html).href });
        await sleep(1200);

        const box = await cdp.ev(`(() => {
            const el = document.querySelector('.frame') || document.querySelector('.screen');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        })()`);

        if (!box) { console.log(`[✗] ${t.name}：找不到 .frame / .screen`); continue; }

        // dpr=2 截图（画布 750×1334 → 744×1320 物理，接近 1:1）
        const res = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 },
            captureBeyondViewport: true,
        });
        const out = join(OUTDIR, `${t.name}.png`);
        writeFileSync(out, Buffer.from(res.data, 'base64'));
        console.log(`[✓] ${t.name}  frame=${box.w.toFixed(0)}×${box.h.toFixed(0)} @ (${box.x.toFixed(0)},${box.y.toFixed(0)})`);
        console.log(`    → ${out}  (宽高比 ${(box.w / box.h).toFixed(4)} · 目标 ${(750 / 1334).toFixed(4)})`);
    }
} finally {
    close();
}
