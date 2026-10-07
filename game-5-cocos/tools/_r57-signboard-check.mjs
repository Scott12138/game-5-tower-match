#!/usr/bin/env node
/**
 * ============================================================
 *  _r57-signboard-check.mjs · 第 57 轮「七日签到视觉稿」几何自检
 * ============================================================
 *  为什么不能只截一张图看：本稿第 1 版**金框用了 `border`**，而
 *  `box-sizing:border-box` 下 `border:5px` 会从内容宽里**吃掉 10px**，
 *  于是「4 + 3」两行网格的第二行超宽 10px ⇒ **第 7 日被挤到第三行**、
 *  卡片凭空高了 210px。而截图**看起来只是"第 7 天自己单独一行"**，
 *  非常像有意为之 —— 这种错人眼几乎抓不住，必须用几何断言钉死。
 *
 *  判据（每条都对应一个可以真的出错的地方）：
 *   ① 内容宽必须是 **546**（= 626 − 2×40），与 Cocos 侧 `SHOP_ROW_W` 同口径。
 *      ⚠️ 差 10px 就说明金框又用回 `border` 了。
 *   ② 七格，且**恰好两行**；第一行 4 格、第二行 3 格。
 *   ③ 格宽 126 / 第 7 日宽格 266 / 列距 14 / 行距 34。
 *   ④ 卡片高 = 推导值 **670**（56+8+34+30 + 176+34+176 + 24+84 + 36）。
 *   ⑤ 整页**无横向溢出**（scrollWidth ≤ clientWidth）。
 *   ⑥ 「领取」胶囊的**下沿不得越过下一行格顶**（骑边可以，压到格子不行）。
 *   ⑦ 坏图 0 张。
 *
 *  【用法】node tools/_r57-signboard-check.mjs      # 全绿则 exit 0
 * ============================================================
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { openBrowser, sleep } from './g5-cdp.mjs';

const HTML = process.argv[2]
    || '/Users/consli/WorkBuddy/2026-10-04-19-15-36/game-5-七日签到-视觉稿-v1.html';
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r57-signboard');
mkdirSync(OUT, { recursive: true });

/** 设计值（本稿承诺给 Cocos 的契约） */
const EXP = {
    cardW: 626, padX: 40, contentW: 546,
    cellW: 126, cellH: 176, wideW: 266,
    gapX: 14, gapY: 34, cardH: 670,
    mockW: 120, mockH: 120,
};

const { cdp, close } = await openBrowser('about:blank', {
    width: 1660, height: 900, scale: 1,
    injectHelper: false,                       // ★ 截非游戏页必须关掉，否则背景被刷成墨绿
});
await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
await sleep(2400);

let pass = 0, fail = 0;
const rows = [];
function assert(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✓ ${name}${detail ? '   ' + detail : ''}`); }
    else { fail++; console.log(`  ✗ ${name}   ${detail}`); }
    rows.push({ name, ok: !!ok, detail });
}
function head(t) { console.log(`\n=== ${t} ===`); }

/** 取稿 A（id=signA）所在那张卡的全部几何 */
const g = await cdp.ev(`(function () {
    var sc = document.getElementById('signA');
    var modal = sc.querySelector('.signmodal');
    var cells = [].slice.call(sc.querySelectorAll('.cell'));
    var cs = getComputedStyle(modal);
    // ⚠️ 一律用 offsetWidth / offsetHeight —— 那是**布局 px（= 设计值）**。
    //    getBoundingClientRect() 给的是**变换后**的 CSS px，本稿 .screen 上有
    //    transform:scale(.48)，所以它会给出 300 / 60 / 128 这种"看着像坏了的数"。
    var padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
    var contentW = modal.clientWidth - padL - padR;      // clientWidth 已排除 border
    var tops = {};
    cells.forEach(function (c) {
        var t = c.offsetTop;
        (tops[t] = tops[t] || []).push(c);
    });
    var lines = Object.keys(tops).map(Number).sort(function (a, b) { return a - b; })
        .map(function (k) { return tops[k]; });
    var first = cells[0];
    var claim = sc.querySelector('.claim');
    // 「领取」胶囊相对**自己那格**的下沿（offsetParent 就是 .cell —— 它有 position:relative）
    // 「领取」胶囊是否骑边且不压下一行 —— 用**直接几何比对**，不要用 offset 推：
    //   .cell 自带 3px 边框，绝对定位的 bottom 落在**padding box** 上，
    //   混着 offsetTop 算出来的数会差几像素，且差多少取决于浏览器实现。
    //   另外 rect 是**变换后**的 CSS px，所以要除以 .screen 的 scale 换回设计 px。
    // ⚠️ #signA 自己**就是** .screen（缩放在它身上）—— 用 querySelector 找后代会拿到 null，
    //    scale 会悄悄退回 1，于是下面报出来的"设计 px"其实是 CSS px（差 2.08 倍）。
    var scEl = sc.classList.contains('screen') ? sc : sc.querySelector('.screen');
    var tm = scEl ? getComputedStyle(scEl).transform : '';
    var scale = (tm && tm.indexOf('matrix') === 0) ? parseFloat(tm.slice(7)) : 1;
    var claimR = claim ? claim.getBoundingClientRect() : null;
    var row2R = lines[1] ? lines[1][0].getBoundingClientRect() : null;
    var todayR = sc.querySelector('.cell.today').getBoundingClientRect();
    var overhang = claimR ? (claimR.bottom - todayR.bottom) / scale : null;   // 伸出本格多少（设计 px）
    var clearance = (claimR && row2R) ? (row2R.top - claimR.bottom) / scale : null; // 距下一行多少
    // 两行网格的净高：第二行顶 + 格高 − 第一行顶
    var gridH = lines.length >= 2
        ? (lines[1][0].offsetTop + lines[1][0].offsetHeight - lines[0][0].offsetTop) : null;
    var sub = sc.querySelector('.signSub'), close = sc.querySelector('.signClose');
    var subH = sub ? sub.offsetHeight : null, closeH = close ? close.offsetHeight : null;
    var subCS = sub ? getComputedStyle(sub) : null, closeCS = close ? getComputedStyle(close) : null;
    // 卡片高**由各段推导**：pad-top + (sub 上边距 + sub 高 + sub 下边距)
    //   + 网格净高 + (close 上边距 + close 高) + pad-bottom
    var derivedH = sub && close
        ? Math.round(parseFloat(cs.paddingTop) + parseFloat(subCS.marginTop) + subH
            + parseFloat(subCS.marginBottom) + gridH
            + parseFloat(closeCS.marginTop) + closeH + parseFloat(cs.paddingBottom))
        : null;
    // ---- 第 7 日「四选一」选择器（稿 D）的几何：与签到卡同一类坑，一并钉死 ----
    var picker = document.querySelector('.picker');
    var pcards = picker ? [].slice.call(picker.querySelectorAll('.pcard')) : [];
    var pcs = picker ? getComputedStyle(picker) : null;
    var pRows = {};
    pcards.forEach(function (c) { (pRows[c.offsetTop] = pRows[c.offsetTop] || []).push(c); });
    var pLineSizes = Object.keys(pRows).map(Number).sort(function (a, b) { return a - b; })
        .map(function (k) { return pRows[k].length; });
    var imgs = [].slice.call(document.images);
    var keys = [].slice.call(document.querySelectorAll('.keyicon'));
    return {
        cardW: modal.offsetWidth, cardH: modal.offsetHeight,
        contentW: Math.round(contentW),
        borderL: parseFloat(cs.borderLeftWidth),
        cellCount: cells.length,
        lineCount: lines.length,
        lineSizes: lines.map(function (l) { return l.length; }),
        cellW: first.offsetWidth, cellH: first.offsetHeight,
        wideW: (function () { var w = sc.querySelector('.cell.wide'); return w ? w.offsetWidth : null; })(),
        gapY: lines.length >= 2 ? (lines[1][0].offsetTop - lines[0][0].offsetTop - first.offsetHeight) : null,
        gridH: gridH, derivedH: derivedH, subH: subH, closeH: closeH,
        order: cells.map(function (c) { return (c.querySelector('.day') || {}).textContent; }),
        wideDay: (function () {
            var w = sc.querySelector('.cell.wide');
            return w ? (w.querySelector('.day') || {}).textContent : null;
        })(),
        overhang: overhang, clearance: clearance, scale: scale,
        picker: picker ? {
            contentW: Math.round(picker.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight)),
            borderL: parseFloat(pcs.borderLeftWidth),
            cards: pcards.length, lineSizes: pLineSizes,
            cardW: pcards[0].offsetWidth, cardH: pcards[0].offsetHeight,
        } : null,
        scrollW: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        clientW: document.documentElement.clientWidth,
        imgs: imgs.length,
        broken: imgs.filter(function (i) { return !i.complete || !i.naturalWidth; }).length,
        keyW: keys[0] ? keys[0].offsetWidth : null,
    };
})()`);

head('① 卡片几何：内容宽必须 = 546（与 Cocos 同口径；差 10 = 金框又用回 border）');
assert('卡宽 = 626', g.cardW === EXP.cardW, `实际 ${g.cardW}`);
assert('金框**没有**用 border（borderLeftWidth 应为 0，靠 box-shadow 画）',
    g.borderL === 0, `borderLeftWidth=${g.borderL}（若为 5 ⇒ 内容宽被吃掉 10px）`);
assert('★ 内容宽 = 546', g.contentW === EXP.contentW,
    `实际 ${g.contentW}（= ${g.cardW} − 2×40 − border）`);
assert('★★ 两行网格净高 = 386（= 176×2 + 34；**多出一行会变成 596**）',
    g.gridH === 386, `实际 ${g.gridH}（行距实测 ${g.gapY}）`);
assert('★ 卡高 = 各段推导值（pad + sub + 网格 + close + pad，抓"凭空多出一块"）',
    g.derivedH === g.cardH,
    `实测 ${g.cardH} vs 推导 ${g.derivedH}（pad56 + 8 + sub${g.subH} + 30 + 386 + 24 + close${g.closeH} + 36）`);

head('② 七格必须**恰好两行**：4 + 3');
assert('格子总数 = 7', g.cellCount === 7, `实际 ${g.cellCount}`);
assert('★★ 只有 2 行（第 1 版这里会是 3 行 —— 第 7 日被挤下去）',
    g.lineCount === 2, `实际 ${g.lineCount} 行，每行 ${JSON.stringify(g.lineSizes)}`);
assert('★ 第一行 4 格、第二行 3 格',
    JSON.stringify(g.lineSizes) === JSON.stringify([4, 3]), JSON.stringify(g.lineSizes));
assert('★ 第 7 日（宽格）在第二行最后一个',
    g.wideDay === '第 7 天' && g.lineSizes[1] === 3, `wideDay="${g.wideDay}"`);

head('③ 尺寸契约：格 126×176 / 宽格 266');
assert('格宽 = 126', g.cellW === EXP.cellW, `实际 ${g.cellW}`);
assert('格高 = 176', g.cellH === EXP.cellH, `实际 ${g.cellH}`);
assert('宽格 = 266', g.wideW === EXP.wideW, `实际 ${g.wideW}`);
assert('行距 = 34', g.gapY === EXP.gapY, `实际 ${g.gapY}`);
assert('★ 两行宽度都刚好占满内容宽（126×4+14×3 = 126×2+14×2+266 = 546）',
    126 * 4 + 14 * 3 === EXP.contentW && 126 * 2 + 14 * 2 + 266 === EXP.contentW);
assert('七格顺序 = 第1…第7天（无缺号）',
    JSON.stringify(g.order) === JSON.stringify(
        ['第 1 天', '第 2 天', '第 3 天', '第 4 天', '第 5 天', '第 6 天', '第 7 天']),
    JSON.stringify(g.order));

head('④ 「领取」胶囊骑边但**不压**下一行格子');
assert('★ 骑边成立：胶囊底**确实伸出**本格（不是被格边框框住）',
    g.overhang !== null && g.overhang > 6,
    `伸出 ${g.overhang?.toFixed(1)} 设计 px`);
assert('★★ 不压下一行：胶囊底仍在第二行格顶之上',
    g.clearance !== null && g.clearance > 0,
    `余量 ${g.clearance?.toFixed(1)} 设计 px（换算 scale=${g.scale}）`);

head('⑤ 第 7 日「四选一」选择器：2×2 四宫格，内容宽 482');
assert('选择器存在', !!g.picker);
assert('金框同样**没有**用 border（borderLeftWidth = 0）',
    g.picker && g.picker.borderL === 0, `borderLeftWidth=${g.picker?.borderL}`);
assert('内容宽 = 482（= 550 − 2×34）', g.picker && g.picker.contentW === 482,
    `实际 ${g.picker?.contentW}`);
assert('★ 四张卡**恰好两行**、每行 2 张',
    g.picker && JSON.stringify(g.picker.lineSizes) === JSON.stringify([2, 2]),
    JSON.stringify(g.picker?.lineSizes));
assert('卡 224×196（比七格里的 68 图标大一档，因为这里是"挑一件带走"）',
    g.picker && g.picker.cardW === 224 && g.picker.cardH === 196,
    `${g.picker?.cardW}×${g.picker?.cardH}`);
assert('★ 两列刚好放得下（224×2 + 16 = 464 ≤ 482）',
    224 * 2 + 16 <= 482);

head('⑥ 整页无横向溢出 & 图片完好');
assert('scrollWidth ≤ clientWidth', g.scrollW <= g.clientW,
    `${g.scrollW} vs ${g.clientW}`);
assert('坏图 0 张', g.broken === 0, `${g.broken}/${g.imgs}`);

head('⑦ 稿 E 的入口图标是 1:1 实际尺寸（120，与 CFG.FN_ICON 一致）');
assert('功能键图标 = 120 设计 px', g.keyW === EXP.mockW, `实际 ${g.keyW}`);

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r57-signboard.json'),
    JSON.stringify({ pass, fail, rows, geo: g, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${OUT}/_r57-signboard.json`);

await close();
process.exit(fail ? 1 : 0);
