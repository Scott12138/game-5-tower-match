#!/usr/bin/env node
/**
 * ============================================================
 *  _r58-verify.mjs · 第 57 轮三 · 三条用户需求的浏览器验收
 * ============================================================
 *  需求（用户 2026-10-07 拍板）：
 *    ① 连续签到 —— 满 7 天后继续领「累计连签」不应跳回 1（**方案 B**：新增 signTotal 字段）
 *        ⇒ UI 侧那部分断言在 `_r55-verify.mjs` 第 ⑱ / ⑳ 组（那里已经有整套签到流程），
 *          本文件只负责**离线语义**之外的浏览器回归（那条链已经在 ⑳ 里跑过一遍）。
 *    ② 道具商城弹窗**背景完全透明** ⇒ 换成参考图（结算卡）那套深绿渐变 + 金框
 *    ③ 商城 / 签到领来的道具**在关卡里不显示**（角标恒为 0、也点不动）
 *
 *  ── 本文件为什么必须存在（而不是并进 `_r55-verify.mjs`）────────────
 *   ② 的要害是**像素**：节点树、`fillColor`、computed style 全都"看着正常"，
 *      只有画面上知道它是不是真的画了。所以这里要跑一条**截图 → 解码 → 量均值**
 *      的通道，混进去会让签到那组变得又长又难读。
 *   ③ 的要害是**两本账的合并**：离线部分在 `_r53-core-check.mjs` G 组（纯策略），
 *      这里补的是"角标真的显示了这个数 / 真的按这个顺序扣"**端到端**那一截。
 *
 *  ── 判据纪律（本轮新增/沿用的）─────────────────────────────────
 *   · ②的判据是**对代码常量的绝对预测**，不是"跟上一张图比"：
 *     卡片是 `fillVGradient(#1B6047 → #123F30)`，那么卡内竖带自上而下 4 段的
 *     均值就必须落在**按 t 插值算出来的颜色**附近。修复前那里画的是首页内容
 *     （吉祥物 / 标题 / 按钮）⇒ 必然出界。这比"两次截图对比"强：后者只能证明"变了"。
 *   · ②的**负控**在**同一张图**上：把同一套量法用在卡片**外侧**同一 y 段。
 *     量法若只会"永远通过"，负控区也会"通过" ⇒ 那说明判据是空的。
 *   · ③的判据是**不变量** `stock === runItems + saveStock`，而不是"角标写着 2"。
 *     后者在"两本账只有一本被画"的世界里同样成立。
 *
 *  ── 本轮自己踩的两个坑（写死在这儿，别再来一次）──────────────────
 *   ★ 「取样条均分 N 段 ⇒ 第 i 段的**中心**距条顶 = `hDes×(i+0.5)/N`」——
 *     **漏掉那个 `/N`**，算出来的 `t` 会冲到 3.0 开外、预测色算成负数。
 *     第 57 轮三在这里卡了半轮，还连带让**负控 A4 假通过**（预测本身是错的，
 *     卡外自然"有一段落进容差"）。⇒ 预测公式必须自带可证伪检查（见 A0b）。
 *   ★ `verifiedShot` 的**无 clip 通道在连续交互后会挂死 150 s 并抛错**，
 *     而它一旦抛错就会把**后面还没跑的断言整段吞掉**（B11/B12 两条负控就是这么消失的）
 *     ⇒ 取证一律走 `safeShot()`（带 clip 降级 + 尺寸自证），**判据与取证分家**。
 *
 *  【用法】node tools/_r58-verify.mjs      全绿 ⇒ exit 0
 * ============================================================
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    SAVE_KEY, navigateTo, openBrowser, screencastShot, sleep, startServer, tapNode, verifiedShot, waitFor,
} from './g5-cdp.mjs';

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const OUT = resolve(process.env.G5_OUT || '/tmp/g5-r58-verify');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, SCALE = 3;
const PY = '/usr/bin/python3';                       // ⚠️ 只有系统 python 装了 PIL
const STRIP_PY = resolve(import.meta.dirname, 'r58-strip.py');

let pass = 0, fail = 0;
const rows = [];
function ok(cond, msg, detail) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.log(`  ✗ ${msg}${detail ? `\n      ↳ ${detail}` : ''}`); }
    rows.push({ msg, ok: !!cond, detail: detail ?? null });
}
function head(t) { console.log(`\n══ ${t} ══`); }

/** 铺一份存档（含跨局库存），**在开浏览器之前**交给种子脚本 —— 全程不 reload */
function seedSave(over = {}) {
    const base = {
        level: 1, best: 0, coins: 0, plays: 0, cleared: 0,
        inventory: { erase: 2, move: 1, shuffle: 2, addslot: 2 },
        signDate: '', signStreak: 0, signTotal: 0, dailyDate: '', daily: {},
    };
    return `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(${JSON.stringify({ ...base, ...over })})); } catch (e) {}`;
}

/** 带 clip 的截图（**只用于像素取样**，不作尺寸判据 —— 尺寸自证走 `verifiedShot`） */
async function clipShot(cdp, path, rect) {
    const r = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
        clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
    }, 60000);
    const buf = Buffer.from(r.data, 'base64');
    writeFileSync(path, buf);
    return { gw: buf.readUInt32BE(16), gh: buf.readUInt32BE(20) };
}

/**
 * 取证截图（**取证，不是判据**）。两条通道，按页面选首选项：
 *   · `prefer:'noclip'`（默认，**静态页面**）：`verifiedShot`（无 clip，出 DPR 倍率图，**尺寸自证**）
 *     ⇒ 失败再退 `screencast`。
 *   · `prefer:'screencast'`（**主玩页**）：直接用 `screencast`。**这不是偏好，是唯一可行**——
 *     第 57 轮三两次实测：`captureScreenshot` 在主玩页上会把渲染进程**卡死且不可逆**
 *     （无 clip 150 s、带 clip 45 s、连停掉引擎主循环也 30 s 全挂，之后连 `Runtime.evaluate`
 *      都超时）。而它一旦抛错，会把**后面还没跑的断言整段吞掉**（B11/B12 两条负控就是这么消失的）
 *     ⇒ 所以取证一律走这个包装，**判据与取证分家**。探针见 `_r58-probe-shot*.mjs`。
 * 返回值：'ok' | 'fallback' | 'fail'（调用方用它决定要不要报一条黄线）。
 */
async function safeShot(cdp, path, opt, prefer = 'noclip') {
    const order = prefer === 'screencast' ? ['screencast', 'noclip'] : ['noclip', 'screencast'];
    let firstErr = null;
    for (let i = 0; i < order.length; i++) {
        const chan = order[i];
        try {
            if (chan === 'screencast') await screencastShot(cdp, path, { w: opt.w, h: opt.h });
            else await verifiedShot(cdp, path, opt);
            console.log(`    · 取证截图（通道=${chan}${i ? '，首选通道挂了' : ''}）→ ${path}`);
            return i ? 'fallback' : 'ok';
        } catch (e) {
            if (!firstErr) firstErr = e;
        }
    }
    console.log(`    · ⚠️ 本轮取不到证据图：${String(firstErr?.message).slice(0, 90)}`);
    return 'fail';
}

/**
 * 把一张**整图**均分 N 段，拿每段均值 RGB（解码在 python，见 r58-strip.py）。
 * ⚠️ 取的是**整图的真实像素尺寸**，不是"我按 CSS 算出来的期望尺寸" ——
 *    后者一旦与浏览器实际出图差 1px，取样矩形就越界（python 会当场 exit 2），
 *    "期望即事实"是这类量测最容易埋的雷。
 */
function stripMeans(png, bands) {
    const out = execFileSync(PY, [STRIP_PY, png, '0', '0',
        String(sizeOf(png).w), String(sizeOf(png).h), String(bands)], { encoding: 'utf8' });
    return JSON.parse(out).bands;
}
const _sizes = new Map();
/** 直接读 PNG 的 IHDR（宽偏移 16 / 高偏移 20）—— 不依赖任何解码库 */
function sizeOf(png) {
    if (!_sizes.has(png)) {
        const b = readFileSync(png);
        _sizes.set(png, { w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    }
    return _sizes.get(png);
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const near = (got, exp, tol) => Math.abs(got.r - exp[0]) <= tol && Math.abs(got.g - exp[1]) <= tol && Math.abs(got.b - exp[2]) <= tol;
const fmt = (c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

// ============================================================

const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);

const { cdp, close } = await openBrowser(url, {
    width: W, height: H, scale: SCALE, seedScript: seedSave(),
});

try {
    // ========================================================
    head('A 组 · 需求② 商城弹层底色：**像素级**判据（对代码常量做绝对预测）');
    // ========================================================
    await navigateTo(cdp, 'home');
    await waitFor(cdp, "!!(window.__g5t && window.__g5t.find('Fn_shop'))", 30000, '首页四入口');
    await sleep(900);
    ok(await tapNode(cdp, 'Fn_shop') !== null, '真实鼠标点中 Fn_shop');
    await sleep(1500);

    const g = await cdp.ev(`(function () {
        var t = window.__g5t, d = t.find('ShopCard');
        if (!d) return null;
        var u = d.getComponent('cc.UITransform');
        var p = t.worldToScreen(d), r = t.canvasRect(), v = t.view();
        return { cw: u.width, ch: u.height, cx: p.x, cy: p.y, k: r.w / v.w };
    })()`);
    ok(!!g, '取到 ShopCard 的几何与「设计 px → CSS」系数', JSON.stringify(g));
    console.log(`    · ShopCard ${g.cw}×${g.ch} 设计 px · 中心 CSS (${g.cx.toFixed(1)}, ${g.cy.toFixed(1)})`
        + ` · 设计→CSS 系数 k=${g.k.toFixed(4)}`);

    // 卡内**左缘竖带**：`SHOP_CARD_W 626 − SHOP_ROW_W 546` ⇒ 两侧各有 40 设计 px 的纯底边距
    //   （卡上除底色外没有任何东西画在那条缝里 —— 标题/副标题/四行/关闭键都是居中的）
    //   · x 取 [10, 20]（离 5px 金线 与 圆角 36 都足够远，也离行卡左沿 40 还有 20）
    //   · 上下各留 70 躲开圆角弧
    //   ⚠️ CDP 的裁切窗会被**截断成整数 CSS px** ⇒ 这里先自己取整，
    //      再**按取整后的实际值**回算每段对应的设计 y（不要用"我打算取的"那个数）。
    const leftCss = g.cx - (g.cw / 2) * g.k;
    const topCss = g.cy - (g.ch / 2) * g.k;
    const rect = {
        x: Math.round(leftCss + 10 * g.k), y: Math.round(topCss + 70 * g.k),
        w: Math.max(3, Math.round(10 * g.k)), h: Math.round((g.ch - 140) * g.k),
    };
    const ctl = { x: Math.round(leftCss - 14 * g.k), y: rect.y, w: rect.w, h: rect.h };

    const pngIn = resolve(OUT, 'shop-strip-in.png');
    const pngCtl = resolve(OUT, 'shop-strip-ctl.png');
    const sIn = await clipShot(cdp, pngIn, rect);
    const sCtl = await clipShot(cdp, pngCtl, ctl);
    console.log(`    · 取样条出图：卡内 ${sIn.gw}×${sIn.gh} · 卡外 ${sCtl.gw}×${sCtl.gh}`
        + `（CSS 窗 ${rect.w}×${rect.h} @DPR${SCALE}）`);
    ok(sIn.gw === rect.w * SCALE && sIn.gh === rect.h * SCALE,
        '★ A0 取样条出图尺寸 = 裁切窗 × DPR（**没被 `clip.scale` 再乘一遍**、也没被截断）'
        + ' —— 取样矩形与实际像素一一对应，后面的均值才有意义');

    const BANDS = 4;
    const bands = stripMeans(pngIn, BANDS);
    const ctlBands = stripMeans(pngCtl, BANDS);

    // ---- 期望值：直接由 `fillVGradient(#1B6047 → #123F30)` 推出 ----
    //  卡片本地 +y 向上，渐变从 y=+ch/2（t=0，浅）走到 y=−ch/2（t=1，深）。
    //  取样条上沿距卡顶：`(rect.y − topCss) / k` 设计 px（用**实际取整后**的窗，不是"打算取的"）
    const TOP = hex('#1B6047'), BOT = hex('#123F30');
    const offTop = (rect.y - topCss) / g.k;
    const hDes = rect.h / g.k;
    //  ⚠️⚠️ 第 57 轮三踩过的**算术坑**（A1 假红的唯一原因，已定位）：
    //    取样条被均分成 `BANDS` 段 ⇒ 第 i 段的**中心**距条顶 = `hDes × (i+0.5) / BANDS`。
    //    **必须除以 BANDS**。漏掉这个除法，t 会一路冲到 3.0 开外（预测色算到负数）——
    //    那本身就是"公式错了"的铁证，不必再去怀疑渲染。
    //  卡片本地 +y 向上，渐变从卡的**整个高度**上走（`fillVGradient(…, SHOP_CARD_W, SHOP_CARD_H, …)`）
    //   ⇒ `t = 该点距卡顶的设计 px ÷ ch`。
    const ts = [];
    for (let i = 0; i < BANDS; i++) ts.push((offTop + hDes * (i + 0.5) / BANDS) / g.ch);
    const exp = ts.map((t) => lerp(TOP, BOT, t));

    //  判据自身也要能被证伪：取样窗必须**真的落在卡内**，且 4 段的 t 全在 [0,1] 里。
    //  否则"预测"只是两组数在打架 —— A1 的通过/失败都不说明任何事。
    ok(offTop >= 0 && offTop + hDes <= g.ch && ts.every((t) => t >= 0 && t <= 1),
        '★ A0b 取样窗落在卡内、4 段 t 全 ∈[0,1]（**给期望值公式本身做的可证伪性检查**）',
        `offTop=${offTop.toFixed(1)} hDes=${hDes.toFixed(1)} ch=${g.ch} t=[${ts.map((t) => t.toFixed(3)).join(', ')}]`);

    console.log('    · 实测（卡内）= ' + bands.map((b, i) => `${i}:${fmt(b)}`).join('  '));
    console.log('    · 预测（t=' + ts.map((t) => t.toFixed(3)).join('/') + ' · 由 #1B6047→#123F30 推出）= '
        + exp.map((e, i) => `${i}:rgb(${e.map(Math.round).join(',')})`).join('  '));
    console.log('    · 实测（卡外·负控）= ' + ctlBands.map((b, i) => `${i}:${fmt(b)}`).join('  '));

    const TOL = 16;
    const inAll = bands.every((b, i) => near(b, exp[i], TOL));
    ok(inAll, `★★ A1 卡内竖带 4 段**逐段落在预测色 ±${TOL}** 内 ⇒ 底色渐变真的画上去了`,
        bands.map((b, i) => `${i} 实测${fmt(b)} 期望rgb(${exp[i].map(Math.round).join(',')})`).join(' | '));
    ok(bands[0].g > bands[BANDS - 1].g + 8,
        `★★ A2 渐变方向对：上段比下段亮（G 通道 ${Math.round(bands[0].g)} > ${Math.round(bands[BANDS - 1].g)}）`
        + ' —— 修复前这里是**首页内容**，根本不是单调渐变');
    ok(bands.every((b) => b.g > b.r + 20 && b.g > b.b + 8),
        '★ A3 全部 4 段都是**深绿族**（G 明显压制 R/B）—— 与参考图（结算卡）同族，不是黑也不是灰');

    const ctlIn = ctlBands.filter((b, i) => near(b, exp[i], TOL)).length;
    ok(ctlIn === 0,
        '★★ A4 负控：**同一套量法**打在卡片**外侧**同一 y 段 ⇒ 4 段**一段都不落在预测内**'
        + `（卡外是首页内容被遮罩压暗后的样子）`,
        `落在容差内的段数 = ${ctlIn}（必须 0，否则说明这套量法"永远通过"≈没判据）`);

    const shotA = await safeShot(cdp, resolve(OUT, 'A-商城弹层.png'), { w: W, h: H, scale: SCALE });

    // 收尾：把商城关掉（下一步要回首页主流程）
    await tapNode(cdp, 'ShopClose');
    await sleep(700);

    // ========================================================
    head('B 组 · 需求③ 两本账接进关卡：角标 / 扣减顺序 / 广告兜底');
    // ========================================================
    //  存档种的是 inventory = {erase:2, move:1, shuffle:2, addslot:2}
    //  ⚠️ **别再写"赠礼只会发 move / addslot"** —— 那是错的（第 57 轮三自己踩的坑）：
    //     `GIFT_TABLE` 按**两枚骰子和值**发礼，`erase` 在 **5 / 7 / 9** 三个和值上就是赠礼！
    //     ⇒ 拿 `erase` 的角标去断言常量「2」会**偶发假红**（和值摇到 5/7/9 那天角标就是 3）。
    //     真正"永远不是赠礼"的只有 **`shuffle`**（全表没有它）⇒ 确定性断言全部押在它身上，
    //     `erase` 这类"可能带赠礼"的键一律按 `run + save` 动态算期望。
    const inv0 = { erase: 2, move: 1, shuffle: 2, addslot: 2 };
    await navigateTo(cdp, 'game');
    await sleep(1200);
    await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');

    //  ⚠️ **先把赠礼造出来，再读账** —— 真骰子的和值随机（和值 2/12 时赠礼为**空**），
    //     如果就这么读，B2 的"两本账"在赠礼为 0 的那一局会退化成 `stock === save`，
    //     也就是**恰好**又变成"只看一本账"⇒ 判据强度随机浮动。
    //     显式造出 `erase` 赠礼 2 个，让不变量在任何一局都是非平凡的。
    const runBefore = await cdp.ev('__game5.runItems()') || {};
    const granted = await cdp.ev('__game5.grantRunItem("erase", 2)');
    const stock0 = await cdp.ev('__game5.stock()');
    const save0 = await cdp.ev('__game5.saveStock()');
    const run0 = await cdp.ev('__game5.runItems()') || {};
    console.log(`    · 跨局库存=${JSON.stringify(save0)}  本局赠礼=${JSON.stringify(run0)}  合计=${JSON.stringify(stock0)}`);
    //  ⚠️ 断言**增量**，不写 `run0.erase === 2`：骰子自己也可能赠 `erase`（和值 5/7/9），
    //     那一局 grant 之后就是 3 ⇒ 写常量会假红（本轮第一次跑就是这么红的）。
    ok(granted === true && run0.erase === (runBefore.erase ?? 0) + 2,
        `★ B0 把 \`erase\` 赠礼再 +2（**让 B2 的不变量非平凡**；骰子自己也可能赠它）`
        + ` — 实测 ${runBefore.erase ?? 0} → ${run0.erase}`);

    //  ⚠️ 比**逐键的值**，不比 `JSON.stringify` —— 后者把**键的顺序**也带进判据，
    //     顺序一变就假红，而顺序跟"账对不对"毫无关系（判据名必须与所量之物相符）。
    ok(Object.keys(inv0).every((k) => save0[k] === inv0[k]),
        '★ B1 跨局库存原样读回（商城/签到那本账真的进了这一局）', JSON.stringify(save0));
    ok(['erase', 'move', 'shuffle', 'addslot'].every((k) => stock0[k] === run0[k] + save0[k]),
        '★★ B2 不变量：`stock[k] === runItems[k] + saveStock[k]`（**两本账合起来看**，'
        + '旧代码 stock 恒等于 runItems —— 就是"商城领了却看不见"的病根）',
        `stock=${JSON.stringify(stock0)} run=${JSON.stringify(run0)} save=${JSON.stringify(save0)}`);
    ok(stock0.shuffle === 2 && run0.shuffle === 0,
        '★ B3 洗牌：赠礼表里没有它 ⇒ 可用数恒等于跨局库存 2');
    /** 读某个道具键角标上的字符串（`Tool_x → Cnt → Label`） */
    const badge = async (id) => await cdp.ev(`(function () {
        var n = window.__g5t.find(${JSON.stringify('Tool_' + id)});
        if (!n) return null;
        var c = n.getChildByName('Cnt');
        var l = c && c.getComponentInChildren('cc.Label');
        return l ? l.string : null;
    })()`);

    const bShuffle = await badge('shuffle');
    const bErase = await badge('erase');
    //  `shuffle` 恒不是赠礼 ⇒ 它的角标必须**恰好**是跨局库存 2（这是本组唯一的常量断言）；
    //  `erase` 可能带赠礼 ⇒ 期望值 = `run + save`（动态算，不是写 2）。
    const expErase = String(run0.erase + save0.erase);
    ok(bShuffle === '2' && bErase === expErase,
        '★★ B4 关卡道具栏的角标**真的画出了跨局库存**'
        + `（洗牌 "${bShuffle}"=库存2 · 消除 "${bErase}"=赠礼${run0.erase}+库存${save0.erase}）`
        + ' —— 修复前这两颗恒为「＋」');

    //  证据图放在**第一次点击之前**：此时场景最干净（无 toast / 无动画残留）。
    //  第 57 轮三原来把它放在 7 次点击之后 ⇒ `captureScreenshot` 挂死 150 s，
    //  把 B11 / B12 两条负控**整段吞掉**（且日志上看不出"少跑了"）。
    const shotB1 = await safeShot(cdp, resolve(OUT, 'B1-关卡道具栏-跨局库存已显示.png'),
        { w: W, h: H, scale: SCALE }, 'screencast');
    //  ⚠️ 上面这条截图**不能**算作 B4 的判据 —— 角标字符串是 B4 用节点读回来的，
    //     截图只是给人看的旁证。判据与取证两条通道，别混。

    // ---- 扣减顺序：赠礼优先 ----
    //  真骰子的和值是随机的（`GIFT_TABLE`：2/12 给复活、3/11 给加槽、4/6/8/10 给移出、
    //  5/7/9 给消除）⇒ "本局到底有没有赠礼、是哪一件"**不确定**，不能拿来当断言的起点。
    //  用 `grantRunItem` 把 `addslot` 的赠礼**显式造到 ≥1**，这样"先扣哪本"才是确定性的。
    const g0 = await cdp.ev('__game5.grantRunItem("addslot", 1)');
    const runA = await cdp.ev('__game5.runItems()');
    const saveA = await cdp.ev('__game5.saveStock()');
    ok(g0 === true && runA.addslot >= 1,
        `★ B5 造出"本局赠礼 ≥1 + 跨局库存 2"的局面（赠礼 addslot=${runA.addslot}）`);
    await tapNode(cdp, 'Tool_addslot');
    await sleep(900);
    const runB = await cdp.ev('__game5.runItems()');
    const saveB = await cdp.ev('__game5.saveStock()');
    ok(runB.addslot === runA.addslot - 1 && saveB.addslot === saveA.addslot,
        '★★ B6 消耗顺序 = **先扣本局赠礼**（会作废的那本先花），跨局库存原封不动',
        `赠礼 ${runA.addslot}→${runB.addslot} · 库存 ${saveA.addslot}→${saveB.addslot}`);
    ok((await badge('addslot')) === String(runB.addslot + saveB.addslot),
        `★ B7 角标 = 两本账之和 = ${runB.addslot + saveB.addslot}`);

    // ---- 只用跨局库存那条路：洗牌扣 2 → 1 → 0 ----
    await tapNode(cdp, 'Tool_shuffle');
    await sleep(900);
    const saveC = await cdp.ev('__game5.saveStock()');
    ok(saveC.shuffle === 1, `★★ B8 赠礼为 0 时**才动跨局库存**（洗牌 2→1，实测 ${saveC.shuffle}）`);
    ok((await badge('shuffle')) === '1', `★ B9 角标跟着掉到 "${await badge('shuffle')}"`);

    await tapNode(cdp, 'Tool_shuffle');
    await sleep(900);
    const saveD = await cdp.ev('__game5.saveStock()');
    ok(saveD.shuffle === 0 && (await badge('shuffle')) === '＋',
        `★★ B10 用光 ⇒ 库存 0、角标回到「＋」（实测库存 ${saveD.shuffle} / 角标 "${await badge('shuffle')}"）`);

    //  ⚠️ 这里**曾经**还留着一条旧的 `verifiedShot('B1-…')`（第 57 轮三的原位），
    //     我把截图挪到 B4 之后时漏删了它 ⇒ 主玩页 `captureScreenshot` 又挂死 150 s 并抛出，
    //     整个脚本崩在这行、B11/B12 两条负控**根本没跑**。
    //     **教训**：挪动取证点时，"旧的那行"必须当场 grep 确认删干净 ——
    //     `grep -n "verifiedShot\|safeShot(" 脚本` 应当只列出**唯一的**调用点。

    // ---- 负控：两本账都空 ⇒ 必须**去弹广告**，且不得虚扣 ----
    const adBefore = await cdp.ev('__game5.platform().adPanelOpen');
    await tapNode(cdp, 'Tool_shuffle');
    await sleep(900);
    const adAfter = await cdp.ev('__game5.platform().adPanelOpen');
    const saveE = await cdp.ev('__game5.saveStock()');
    ok(adBefore === false && adAfter === true,
        '★★ B11 负控：两本账都空 ⇒ 走的是**看广告**那条路（广告面板真的弹了）',
        `adPanelOpen ${adBefore} → ${adAfter}`);
    ok(saveE.shuffle === 0,
        '★★ B12 且**不得虚扣**：弹广告这件事本身不消耗任何库存（仍是 0）');

    const shotB2 = await safeShot(cdp, resolve(OUT, 'B2-两本账都空才看广告.png'),
        { w: W, h: H, scale: SCALE }, 'screencast');

    // ========================================================
    head('C 组 · 收尾');
    // ========================================================
    ok([shotA, shotB1, shotB2].every((s) => s !== 'fail'),
        '★ 三张证据图都拿到了（两条通道任一条成功即可）',
        `A=${shotA} B1=${shotB1} B2=${shotB2}`);
    ok(cdp.errors.length === 0, '★ 全程没有 JS 异常', JSON.stringify(cdp.errors.slice(0, 3)));
} finally {
    try { await close(); } catch { /* ignore */ }
    proc.kill();
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
writeFileSync(resolve(OUT, '_r58-verify.json'),
    JSON.stringify({ pass, fail, rows, at: new Date().toISOString() }, null, 2));
console.log(`取证 JSON → ${resolve(OUT, '_r58-verify.json')}`);
process.exit(fail ? 1 : 0);
