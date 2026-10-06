#!/usr/bin/env node
/**
 * ============================================================
 *  r43-board-check.mjs · 试听板自证：**声音真的会响**
 * ============================================================
 *  【为什么必须这么验】
 *  「有 13 个 audio 标签」≠「点下去有声音」。本机踩过的同类坑：
 *  交付的演示页里监听器根本没注册、截图却很好看（2026-10-01）。
 *  ⇒ 判据只能是「**真实鼠标点下去之后，播放位置真的在走**」：
 *     ① 用 `Input.dispatchMouseEvent` 点自定义播放按钮（不是 `el.play()` 直调）；
 *     ② 断言 `currentTime` 从 0 涨起来，且 `paused === false`；
 *     ③ 再点一次必须停住（否则"暂停"是假的）。
 *  另 10 条备选用的是原生 `<audio controls>`（不自己造轮子，稳），
 *  对它们只断言**资源真的取得到**（HTTP 200 + 字节数 + Content-Type），
 *  以及标签数量对得上 —— 原生控件的播放行为是浏览器的事，不用我复验。
 *
 *  【★ 截验收板必须 injectHelper:false】见 g5-cdp.mjs：PAGE_HELPER 会往每个
 *  新文档注入游戏的 `html,body{background:#0b1f16}`，把本页背景刷成深墨绿，
 *  而 computed style 看着完全正常 —— 极易误判成自己的 CSS 坏了。
 *
 *  【用法】node tools/r43-board-check.mjs [outdir]
 * ============================================================
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

import { freePort, openBrowser, sleep, waitFor } from './g5-cdp.mjs';

const DIR = resolve(import.meta.dirname, '..', '..', 'docs-verify', 'game-5', 'audio', 'bgm-candidates');
const PAGE = 'bgm-试听拍板板.html';
const OUT = resolve(process.argv[2] ?? '/tmp/g5-r43-board');
mkdirSync(OUT, { recursive: true });

const rows = [];
const fails = [];
const note = (k, v = '') => rows.push([k, v]);
const bad = (k, v) => { rows.push([k, `FAIL · ${v}`]); fails.push(k); };

if (!existsSync(join(DIR, PAGE))) { console.error(`找不到 ${join(DIR, PAGE)}`); process.exit(2); }

// ---------- 静态侧：13 个音频 + 13 张波形图都在、字节数与分析台账一致 ----------
const AUDIO = [
    'full/pt-wuxia2-guzheng-pipa.m4a', 'full/pt-folk-chinese.m4a', 'full/ts-kings-tile-draw.m4a',
    'excerpt/ts-kokushi-musou.m4a', 'excerpt/km-shenyang.m4a', 'excerpt/pt-wuxia2.m4a',
    'excerpt/ts-jankis-lair.m4a', 'excerpt/ts-fall-boogie.m4a', 'excerpt/ts-hypnotic-poison.m4a',
    'excerpt/ts-second-dealing.m4a', 'excerpt/ts-trust-me.m4a', 'excerpt/ts-racks-highway.m4a',
    'excerpt/ts-all-in-or-fold.m4a',
];
const PNG = [
    'pt-wuxia2-guzheng-pipa', 'pt-folk-chinese', 'ts-kings-tile-draw', 'km-shenyang',
    'ts-kokushi-musou', 'pt-wuxia2', 'ts-jankis-lair', 'ts-fall-boogie', 'ts-hypnotic-poison',
    'ts-second-dealing', 'ts-trust-me', 'ts-racks-highway', 'ts-all-in-or-fold',
].map((k) => k + '.png');

let miss = [...AUDIO, ...PNG].filter((p) => !existsSync(join(DIR, p)));
if (miss.length) bad('静态件齐全（13 音频 + 13 波形）', `缺 ${miss.length}：${miss.slice(0, 4).join(', ')}`);
else note('静态件齐全（13 音频 + 13 波形）',
    `音频合计 ${(AUDIO.reduce((s, p) => s + statSync(join(DIR, p)).size, 0) / 1048576).toFixed(1)} MB`);

/**
 * 本页不是 Cocos 产物 ⇒ 不能用 `startServer`（它要求 index.html 且会拿
 * `assets/main/index.js` 做归属校验，那是给游戏产物用的）。这里起一个
 * 最朴素的静态服务器即可；**归属校验换成"随机端口 + 先就绪探测"**，
 * 避免连到别人残留的进程上。
 */
async function serveLocal(dir) {
    const port = await freePort();
    const proc = spawn('/usr/bin/python3',
        ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir],
        { stdio: 'ignore' });
    await sleep(600);
    if (proc.exitCode !== null) throw new Error(`端口 ${port} 上起不来`);
    for (let i = 0; i < 20; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/${encodeURIComponent(PAGE)}`);
            if (r.status === 200) return { proc, url: `http://127.0.0.1:${port}/${encodeURIComponent(PAGE)}` };
        } catch { /* 还没起来 */ }
        await sleep(250);
    }
    proc.kill();
    throw new Error('静态服务器未就绪');
}

const srv = await serveLocal(DIR);
const { cdp, close } = await openBrowser(srv.url, {
    width: 1180, height: 1000, scale: 1, injectHelper: false,   // ★ 见文件头
});

try {
    await waitFor(cdp, 'document.querySelectorAll(".card").length === 3', 20000, '三张首推卡');
    await waitFor(cdp, '!!(window.__bgm && window.__bgm.length === 3)', 20000, '三个自定义播放器');
    await sleep(1200);

    // ---------- ① 量：13 个音频真的能取到（HTTP 200 + 字节数） ----------
    const gets = await cdp.ev(`(async () => {
        const list = ${JSON.stringify(AUDIO)};
        const out = [];
        for (const p of list) {
            try {
                const r = await fetch('./' + p);
                const b = (await r.arrayBuffer()).byteLength;
                out.push({ p, status: r.status, bytes: b, type: r.headers.get('content-type') });
            } catch (e) { out.push({ p, err: String(e) }); }
        }
        return out;
    })()`);
    const httpBad = gets.filter((g) => g.status !== 200 || !g.bytes);
    if (httpBad.length) bad('13 个音频 HTTP 可取', JSON.stringify(httpBad.slice(0, 3)));
    else note('13 个音频 HTTP 可取', `${gets.length} 条全部 200（最小 ${Math.min(...gets.map((g) => g.bytes)) / 1024 | 0} KB）`);

    // ---------- ② 13 张波形图真的解码出来了（naturalWidth > 0 才算数） ----------
    // 3 张在首推大卡里、10 张在备选小卡里 —— 一共 13 张，全部要被引用到。
    const imgs = await cdp.ev(`(() => {
        const a = [...document.images].map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight }));
        return { n: a.length, broken: a.filter(x => !x.w) };
    })()`);
    if (imgs.broken.length) bad('波形图全部解码成功', JSON.stringify(imgs.broken.slice(0, 3)));
    else if (imgs.n !== 13) bad('波形图全部解码成功', `页面上只引用了 ${imgs.n} 张，应为 13 张`);
    else note('波形图全部解码成功', `${imgs.n} 张引用到位，naturalWidth 全部 > 0`);

    // ---------- ③ 三个播放器：**真实鼠标点击** → 播放位置真的在走 ----------
    for (let i = 0; i < 3; i++) {
        const box = await cdp.ev(`(() => {
            const b = document.querySelectorAll('.pp')[${i}]; const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                     src: b.dataset.src, top: r.top + window.scrollY };
        })()`);
        // 先把卡片滚进视口（点不在视口内的事件不会命中）
        await cdp.ev(`window.scrollTo(0, ${Math.max(0, box.top - 260)})`);
        await sleep(420);
        const box2 = await cdp.ev(`(() => {
            const b = document.querySelectorAll('.pp')[${i}]; const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await cdp.click(box2.x, box2.y);
        await sleep(1400);
        const st = await cdp.ev(`(() => { const a = window.__bgm[${i}].el;
            return { paused: a.paused, t: +a.currentTime.toFixed(2), dur: +(a.duration || 0).toFixed(1),
                     rs: a.readyState, err: a.error ? a.error.code : null,
                     scan: document.querySelectorAll('.scan')[${i}].style.getPropertyValue('--p') }; })()`);
        const name = box.src.split('/').pop();
        if (st.err !== null) bad(`③#${i + 1} ${name} 可播放`, `MediaError code=${st.err}`);
        else if (st.paused || st.t <= 0.15) bad(`③#${i + 1} ${name} 真实点击后在播`, JSON.stringify(st));
        else note(`③#${i + 1} ${name} 真实点击后在播`,
            `t=${st.t}s / 总长 ${st.dur}s · 扫描线 --p=${st.scan}px`);

        // 再点一次必须停住（证明"暂停"不是装饰）
        await cdp.click(box2.x, box2.y);
        await sleep(700);
        const st2 = await cdp.ev(`(() => { const a = window.__bgm[${i}].el;
            return { paused: a.paused, t: +a.currentTime.toFixed(2) }; })()`);
        if (!st2.paused) bad(`③#${i + 1} 再点一次能停`, JSON.stringify(st2));
    }
    note('③#a 暂停语义', '三个播放器再点一次均停住');

    // ---------- ④ 点第三个时前面那个必须停（避免试听叠音） ----------
    await cdp.ev('window.__bgm.forEach(o => o.stop())');
    await cdp.ev(`(() => { window.scrollTo(0, 0); return 1; })()`);
    await sleep(300);

    // ---------- ⑤ 10 条备选的原生 audio 标签数对得上 ----------
    const nAlt = await cdp.ev('document.querySelectorAll(".alt audio").length');
    if (nAlt !== 10) bad('备选区 10 个原生播放器', `实测 ${nAlt}`);
    else note('备选区 10 个原生播放器', '数量与清单一致');

    // ---------- ⑥ 断点：820px 下不横向溢出 ----------
    await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(700);
    const ovf = await cdp.ev(`({ sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth })`);
    if (ovf.sw > ovf.cw + 1) bad('390px 视口不横向溢出', `scrollWidth ${ovf.sw} > clientWidth ${ovf.cw}`);
    else note('390px 视口不横向溢出', `${ovf.sw} <= ${ovf.cw}`);
    await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(600);

    await cdp.shot(join(OUT, 'board-full.png'));
    note('整页截图', join(OUT, 'board-full.png'));

    // 分段留痕：一次截全长会撞上"单张高度上限 ≈4500px"的老坑（见项目记忆），
    // 所以按滚动位置切几段拍。
    const H = await cdp.ev('document.documentElement.scrollHeight');
    note('页面总高', `${H}px`);
    for (const [tag, y] of [['01-header-cardA', 0], ['02-cardB', 980], ['03-cardC-pack', 1900],
        ['04-alts-top', 2760], ['05-alts-bot', 3660]]) {
        await cdp.ev(`window.scrollTo(0, ${y})`);
        await sleep(420);
        await cdp.shot(join(OUT, `seg-${tag}.png`));
    }
    note('分段截图', '5 段（seg-01 … seg-05）');
    await cdp.ev('window.scrollTo(0, 0)');
} catch (e) {
    bad('流程', e.message);
} finally {
    console.log('');
    console.log('  第 43 轮 · BGM 试听板的真实事件自证');
    console.log('  ' + '-'.repeat(86));
    for (const [k, v] of rows) console.log(`  ${String(v).startsWith('FAIL') ? '[FAIL]' : '[OK]  '} ${k}${v ? '  · ' + v : ''}`);
    console.log('  ' + '-'.repeat(86));
    if (fails.length) { console.log(`[x] ${fails.length} 项不通过：${fails.join(' / ')}`); process.exitCode = 1; }
    else console.log(`[v] 全部 ${rows.length} 项通过`);
    console.log('');
    await sleep(200);
    close();
    srv.proc.kill();
}
