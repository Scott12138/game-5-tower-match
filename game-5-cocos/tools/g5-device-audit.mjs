#!/usr/bin/env node
/**
 * ============================================================
 *  g5-device-audit.mjs · 真机比例版式审计
 * ============================================================
 *  【为什么必须有这个工具】（2026-10-06 血坑）
 *  冒烟脚本 `g5-smoke.mjs` 一直跑在 **750×1334**（设计稿比例 0.5622）下，
 *  而用户真机是 **1264×2780（比例 0.4547）**。两者可视高度差一大截：
 *      设计比例下 visibleH = 750/0.5622 = 1334
 *      真机比例下 visibleH = 750/0.4547 = 1649   ← 多出 23.6%
 *  于是"无头全绿、真机翻车"：脚本里量到的每一个 y 都是错的基准。
 *
 *  【它做什么】
 *   ① 按**给定的真机 CSS 尺寸**开无头浏览器（不是 750×1334）
 *   ② 真实鼠标点进首页/主玩页（不绕过事件层）
 *   ③ dump 场景树：每个节点的名字 + 屏幕 px 包围盒 + 设计 px 包围盒
 *   ④ 打印"可视区 / 安全区 / 胶囊位"的关键数字，供版式对账
 *
 *  【用法】
 *    node tools/g5-device-audit.mjs --w 421 --h 927 --out /tmp/g5-audit
 *    node tools/g5-device-audit.mjs --w 421 --h 927 --page home
 *    node tools/g5-device-audit.mjs --w 750 --h 1334 --page home      # 对照：旧基准
 *
 *  ⚠️ `--w/--h` 是**浏览器 CSS 像素**（= 真机逻辑 px），不是物理像素。
 *     真机 1264×2780 @3x → 逻辑 421.3×926.7 → 传 421 / 927。
 *     只有**宽高比**影响设计坐标；绝对值只影响截图分辨率。
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const W = Number(argOf('--w', 421));
const H = Number(argOf('--h', 927));
const OUT = resolve(argOf('--out', '/tmp/g5-audit'));
const PAGE = argOf('--page', 'home');          // splash | home | gameStart | game
const LEVEL = Number(argOf('--level', 1));
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const SAVE_KEY = 'game5.save.v1';

const SEED = `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)},
  JSON.stringify({ level: ${LEVEL}, best: ${LEVEL - 1},
    inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
    coins: 0, plays: 0, cleared: 0, signDate: '', signStreak: 0 })); } catch (e) {}`;

mkdirSync(OUT, { recursive: true });
console.log(`==> 视口 ${W}×${H}（比例 ${(W / H).toFixed(4)}）  目标页：${PAGE}`);
if (Math.abs(W / H - 750 / 1334) > 1e-6) {
    console.log(`    ⚠️ 这不是设计稿比例（750/1334 = ${(750 / 1334).toFixed(4)}）`);
}

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { seedScript: SEED, width: W, height: H, scale: 1 });

let shotNo = 0;
const shot = async (tag) => {
    const p = join(OUT, `${String(++shotNo).padStart(2, '0')}-${tag}.png`);
    await cdp.shot(p);
    console.log(`  📷 ${p}`);
    return p;
};

try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, '!!(cc.director && cc.director.getScene())', 15000, '场景');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    // ---------- ① 关键数字 ----------
    const geo = await cdp.ev(`JSON.stringify({
        view: window.__g5t.view(),
        canvas: window.__g5t.canvasRect(),
        dpr: window.devicePixelRatio,
        inner: { w: window.innerWidth, h: window.innerHeight },
    })`);
    const g = JSON.parse(geo);
    console.log('\n───── 视口几何 ─────');
    console.log(`  浏览器内层      ${g.inner.w} × ${g.inner.h}   dpr=${g.dpr}`);
    console.log(`  画布 CSS 盒     ${Math.round(g.canvas.w)} × ${Math.round(g.canvas.h)} @ (${Math.round(g.canvas.l)},${Math.round(g.canvas.t)})`);
    console.log(`  引擎可视尺寸    ${g.view.w} × ${g.view.h}  （设计 px，fitWidth）`);
    console.log(`  ⮕ 设计稿高 1334 vs 实际可视高 ${g.view.h}  ⇒ 差 ${(g.view.h - 1334).toFixed(1)}px（+${((g.view.h / 1334 - 1) * 100).toFixed(1)}%）`);

    // ---------- ② 导航到目标页（真实点击） ----------
    const waitLog = async (sub, ms = 12000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (cdp.logs.some((l) => l.text.includes(sub))) return true;
            await sleep(120);
        }
        return false;
    };
    const tap = async (name) => {
        const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
        if (!p) throw new Error(`找不到节点 ${name}`);
        await cdp.click(p.x, p.y);
    };

    await sleep(1200);
    await shot('splash');
    if (PAGE !== 'splash') {
        await waitLog('[PageManager] → home', 15000);
        await sleep(1600);
        await shot('home');
        if (PAGE === 'gameStart' || PAGE === 'game') {
            await tap('BtnStart');
            await waitLog('[PageManager] → gameStart', 10000);
            await sleep(4600);
            await shot('game-start');
            if (PAGE === 'game') {
                await tap('BtnGo');
                await waitLog('[PageManager] → game', 12000);
                await sleep(2500);
                await shot('game');
            }
        }
    }

    // ---------- ③ 场景树 dump ----------
    // ⚠️ 只取"页面根节点 + 它的直接子树的前两层"，全树几百个节点打出来没法看。
    const dump = await cdp.ev(`(() => {
        const T = window.__g5t;
        const v = T.view(), r = T.canvasRect();
        const toDesign = (p) => p ? { x: (p.x - r.l) / r.w * v.w, y: (p.y - r.t) / r.h * v.h } : null;
        const scene = cc.director.getScene();
        const out = [];
        (function walk(n, depth, pageRoot) {
            if (depth > 3) return;
            const isPage = n.name.indexOf('Page_') === 0;
            const root = isPage ? n.name : pageRoot;
            if (!root) { n.children.forEach(c => walk(c, depth, null)); return; }
            const p = T.worldToScreen(n);
            const d = toDesign(p);
            const ui = n.getComponent && n.getComponent('cc.UITransform');
            out.push({
                page: root, depth,
                name: n.name,
                sx: p ? Math.round(p.x) : null, sy: p ? Math.round(p.y) : null,
                dx: d ? Math.round(d.x * 10) / 10 : null, dy: d ? Math.round(d.y * 10) / 10 : null,
                w: ui ? Math.round(ui.width) : null, h: ui ? Math.round(ui.height) : null,
                kids: n.children.length,
            });
            n.children.forEach(c => walk(c, depth + 1, root));
        })(scene, 0, null);
        return JSON.stringify({ view: v, rect: r, nodes: out });
    })()`);
    const D = JSON.parse(dump);

    const pages = [...new Set(D.nodes.map((n) => n.page))];
    const want = pages[pages.length - 1];
    console.log(`\n───── 场景树（页 ${want}，前 3 层）─────`);
    console.log('  设计px: x,y = 中心点；w,h = UITransform 尺寸');
    console.log('  ' + ['depth', 'name', 'x', 'y', 'w', 'h', 'kids'].map((s) => s.padEnd(10)).join(''));
    for (const n of D.nodes.filter((n) => n.page === want)) {
        console.log('  ' + [
            String(n.depth), n.name, String(n.dx), String(n.dy),
            String(n.w), String(n.h), String(n.kids),
        ].map((s) => s.padEnd(10)).join(''));
    }

    // ---------- ④ 越界检查：设计 px 是否落在 [0, visibleH] 内 ----------
    console.log(`\n───── 纵向越界检查（设计 px，可视 0 ~ ${D.view.h.toFixed(0)}）─────`);
    const bad = D.nodes.filter((n) => n.page === want && n.h != null && n.y != null
        && (n.dy - n.h / 2 < -1 || n.dy + n.h / 2 > D.view.h + 1));
    if (!bad.length) console.log('  ✅ 无非页面节点越界');
    for (const n of bad) {
        console.log(`  ⚠️ ${n.name}  设计 y ${n.dy} ± ${n.h / 2}  →  [${(n.dy - n.h / 2).toFixed(1)}, ${(n.dy + n.h / 2).toFixed(1)}]  超出`);
    }

    writeFileSync(join(OUT, 'tree.json'), JSON.stringify(D, null, 2));
    console.log(`\n（完整树已写 ${join(OUT, 'tree.json')}）`);
} catch (e) {
    console.log(`\n❌ 中断：${e.message}`);
    process.exitCode = 1;
} finally {
    await sleep(200);
    close();
    srv.proc.kill();
}
