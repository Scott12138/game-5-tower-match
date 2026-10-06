#!/usr/bin/env node
/**
 * ============================================================
 *  r40-rule-tap.mjs · 规则弹层「点击任意处关闭」的真实事件自证
 * ============================================================
 *
 *  【为什么要专门验这一条】
 *  第 39 轮用户报「规则页怎么点都关不掉」。根因是 `RulePanel` 的 `UITransform`
 *  被写成了 `{ w: 1, h: 1 }` —— **触摸命中区只有 1 个像素**，
 *  `Node.EventType.TOUCH_END` 永远不会派发到那一层。
 *
 *  这类 bug 有个恶劣性质：**它不报错、不打日志、节点也照常渲染**。
 *  光看截图会以为"这不是好好的吗"。唯一能证明修好了的方式是——
 *  用**真实鼠标事件**点下去，然后断言节点真的没了。
 *  （用 `node.emit(...)` 直接发事件是**假验证**：它绕过了整个命中判定，
 *    而命中判定恰恰就是这次的病灶。）
 *
 *  【用法】node tools/r40-rule-tap.mjs
 * ============================================================
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] ?? '/tmp/g5-rule-tap');
mkdirSync(OUT, { recursive: true });
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

/** 三个探测点（CSS px，视口 421×927）—— 覆盖"图外 / 图正中 / ✕ 热区" */
const PROBES = [
    ['图中正中', 210, 460],
    ['规则图之外（左上空白）', 60, 200],
    ['右上 ✕ 热区', 365, 203],
];

const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { width: 421, height: 927, scale: 2 });

const fails = [];
const rows = [];

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
    const tapNode = async (name) => {
        const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
        if (!p) throw new Error(`找不到节点 ${name}`);
        await cdp.click(p.x, p.y);
    };
    const ruleExists = () => cdp.ev('!!window.__g5t.find("RulePanel")');

    // ---- 走到主玩页 ----
    await waitLog('[PageManager] → home');
    await sleep(1600);
    await tapNode('BtnStart');
    await waitLog('[PageManager] → gameStart');
    // 开局页时间轴 1.95s + 赠礼卡浮现 ≈ 2.4s，等足再点「开始挑战」
    await sleep(2800);
    await tapNode('BtnGo');
    if (!(await waitLog('[PageManager] → game', 12000))) throw new Error('没进到主玩页');
    await sleep(2000);

    // ---- 逐个探测点验证 ----
    for (const [label, x, y] of PROBES) {
        await tapNode('RuleBtn');
        await sleep(700);
        const opened = await ruleExists();
        if (!opened) {
            rows.push([label, 'FAIL', '规则页压根没打开，无法判定']);
            fails.push(label);
            continue;
        }
        // ★ 真实鼠标事件
        await cdp.click(x, y);
        await sleep(900);                       // 淡出 0.2s + 240ms 后销毁
        const stillThere = await ruleExists();
        if (stillThere) {
            rows.push([label, 'FAIL', `点了 (${x}, ${y}) 之后 RulePanel 仍在`]);
            fails.push(label);
        } else {
            rows.push([label, 'OK', `点 (${x}, ${y}) -> RulePanel 已销毁`]);
        }
        await sleep(300);
    }

    // ---- 关闭之后还能再开（证明没把按钮一起弄坏）----
    await tapNode('RuleBtn');
    await sleep(700);
    const reopen = await ruleExists();
    if (reopen) rows.push(['关闭后仍可再次打开', 'OK', '规则按钮未受影响']);
    else { rows.push(['关闭后仍可再次打开', 'FAIL', '第二次打不开了']); fails.push('reopen'); }
    await cdp.click(210, 460);
    await sleep(900);

    // ---- 顺带证明「关闭后游戏恢复可交互」：点一张牌，看清空数是否推进 ----
    const before = await cdp.ev('window.__game5.state().cleared');
    const pick = await cdp.ev('window.__game5.pickables()');
    if (Array.isArray(pick) && pick.length) {
        const p0 = pick[0];
        const toCss = await cdp.ev(`(() => {
            const r = window.__g5t.canvasRect(), v = window.__g5t.view();
            return { l: r.l, t: r.t, w: r.w, h: r.h, vw: v.w, vh: v.h };
        })()`);
        const cx = toCss.l + (p0.x / toCss.vw) * toCss.w;
        const cy = toCss.t + (p0.y / toCss.vh) * toCss.h;
        await cdp.click(cx, cy);
        await sleep(900);
        const after = await cdp.ev('window.__game5.state().cleared');
        if (after >= before) rows.push(['关闭后游戏恢复可交互', 'OK', `点牌未报错（cleared ${before} -> ${after}）`]);
        else { rows.push(['关闭后游戏恢复可交互', 'FAIL', `cleared 倒退 ${before} -> ${after}`]); fails.push('interactive'); }
    }

    await cdp.shot(join(OUT, 'after.png'));
} catch (e) {
    console.log(`❌ 中断：${e.message}`);
    process.exitCode = 1;
    fails.push('exception');
} finally {
    console.log('');
    console.log('  规则弹层「点击任意处关闭」· 真实鼠标事件自证');
    console.log('  ' + '-'.repeat(70));
    for (const [name, st, detail] of rows) {
        console.log(`  ${st === 'OK' ? '[OK]  ' : '[FAIL]'} ${name}${detail ? '  · ' + detail : ''}`);
    }
    console.log('  ' + '-'.repeat(70));
    if (fails.length) {
        console.log(`[✗] ${fails.length} 项不通过：${fails.join(' / ')}`);
        process.exitCode = 1;
    } else {
        console.log(`[✓] 全部 ${rows.length} 项通过`);
    }
    console.log('');
    await sleep(200);
    close();
    srv.proc.kill();
}
