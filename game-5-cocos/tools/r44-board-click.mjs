#!/usr/bin/env node
/**
 * r44-board-click.mjs · 用**真实鼠标事件**验证拍板板的 48 条音频真能播
 * ================================================================
 * 用法: node tools/r44-board-click.mjs <html绝对路径>
 *
 * ★ 为什么不能只看截图 / 只调 play()（用户长期铁律）：
 *   「可交互产物交付前必须用真实事件验证，不能只看截图或自动演示」。
 *   自动演示（直接调函数）**绕过事件层**，历史上真出过「监听器根本没注册、
 *   点都点不动但截图全对」的事故。
 *
 * ★ 判据 = **状态真的变了**：window.__r44.t（audio.currentTime）在推进，
 *   而不是「按钮元素存在」。再点一次必须能停（t 不再增长）。
 *
 * ★ 无头 Chrome 里 <audio> 能播吗：能。合成 CDP 鼠标事件是 trusted user gesture，
 *   可解锁 play()；无音频设备时 currentTime 照常走。真出错会挂在 __r44.err。
 */
import { pathToFileURL } from 'node:url';
import { openBrowser, sleep } from './g5-cdp.mjs';

const [, , HTML] = process.argv;
if (!HTML) { console.error('用法: node tools/r44-board-click.mjs <html>'); process.exit(2); }

let fail = 0;
const judge = (ok, txt) => { console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt); if (!ok) fail++; };

const { cdp, close } = await openBrowser('about:blank',
    { width: 1660, height: 980, scale: 1, injectHelper: false });

try {
    await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
    await sleep(2000);

    // ★ 语义校准：板子里 cards() 选的是 [data-src]（=48 条），不是首推卡。
    //   首推卡数要另外数 .pick，别把两个数混着断言。
    const meta = await cdp.ev(`window.__r44 ? {
        audios: __r44.nAudioFiles,
        picks: document.querySelectorAll('.pick').length,
        alts: document.querySelectorAll('.altgrid .ab').length
    } : null`);
    judge(!!meta, `页面脚本已就绪（__r44 存在）`);
    if (!meta) throw new Error('__r44 未注入，无法断言');
    console.log('     首推卡 %d 张 / 备选条 %d 条 / 音频条目 %d 条', meta.picks, meta.alts, meta.audios);
    judge(meta.picks === 12 && meta.alts === 36 && meta.audios === 48,
        `结构 12 首推 / 36 备选 / 48 音频（实测 ${meta.picks} / ${meta.alts} / ${meta.audios}）`);

    /** 取第 i 张首推卡的播放按钮中心（CSS px） */
    const btnRect = async (i) => await cdp.ev(`(function () {
        var b = document.querySelectorAll('.pick .pbtn')[${i}];
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        var r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                 src: b.getAttribute('data-src') };
    })()`);

    // ---------- ① 12 张首推卡：逐个真实点击 → 断言 currentTime 真的在走 ----------
    console.log('── 12 张首推卡逐个「真实鼠标点击」 ──');
    for (let i = 0; i < 12; i++) {
        const r = await btnRect(i);
        if (!r) { judge(false, `第 ${i + 1} 张的播放按钮取不到`); continue; }
        await cdp.mouse('mouseMoved', r.x, r.y);
        await cdp.mouse('mousePressed', r.x, r.y);
        await cdp.mouse('mouseReleased', r.x, r.y);
        await sleep(650);
        const st = await cdp.ev('({playing: __r44.playing, t: __r44.t, d: __r44.d, err: __r44.err})');
        const ok = st.playing === r.src && st.t > 0.05 && !st.err;
        const name = String(r.src).replace(/^(bgm|sfx)\//, '');
        // ★ Node 的 console.log 不支持 %-28s 这类宽度填充（会原样打印字面量）——用 padEnd
        console.log('  %s %s t=%s s  d=%s s%s', ok ? '✓' : '✗', name.padEnd(26),
            st.t.toFixed(2), (st.d || 0).toFixed(1), st.err ? '  err=' + st.err : '');
        if (!ok) fail++;
        await cdp.mouse('mouseMoved', r.x, r.y);
        await cdp.mouse('mousePressed', r.x, r.y);
        await cdp.mouse('mouseReleased', r.x, r.y);   // 再点一次 = 停
        await sleep(180);
        const off = await cdp.ev('__r44.playing');
        judge(off === null, `  再点一次可停（playing=${off}）`);
    }

    // ---------- ② 备选条也点一条（.ab 走的是同一委托，但要确认它也绑上了） ----------
    console.log('── 备选条抽样 ──');
    const ab = await cdp.ev(`(function () {
        var b = document.querySelector('.altgrid .ab');
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        var r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, src: b.getAttribute('data-src') };
    })()`);
    if (ab) {
        await cdp.mouse('mouseMoved', ab.x, ab.y);
        await cdp.mouse('mousePressed', ab.x, ab.y);
        await cdp.mouse('mouseReleased', ab.x, ab.y);
        await sleep(650);
        const st = await cdp.ev('({playing: __r44.playing, t: __r44.t, err: __r44.err})');
        judge(st.playing === ab.src && st.t > 0.05 && !st.err,
            `备选条可播（${ab.src}，t=${st.t.toFixed(2)}）`);
        await cdp.ev('(function(){document.getElementById("dockStop").click();return 1;})()');
        await sleep(150);
        judge(!(await cdp.ev('__r44.playing')), '底部 mini-transport 的「停止」可用');
    } else {
        judge(false, '找不到备选条 .ab');
    }

    // ---------- ③ 点波形条 = 跳到那一段（进度必须真的跳） ----------
    // ★ 两个前置自证（否则这条断言必然假红）：
    //   a) 坐标为负 = 目标被滚出视口，鼠标会点在空处（我第一次就栽在这）
    //   b) duration 还是 NaN 时，seek 处理器**按设计**不动作，这不是 bug
    await cdp.ev(`(function () {
        var b = document.querySelectorAll('.pick .pbtn')[0];
        if (b) b.click();
        document.querySelectorAll('.pick .wave')[0].scrollIntoView({ block: 'center' });
        return 1;
    })()`);
    await sleep(700);
    const sr = await cdp.ev(`(function () {
        var w = document.querySelectorAll('.pick .wave')[0];
        var r = w.getBoundingClientRect();
        return { x: r.left + r.width * 0.72, y: r.top + r.height / 2,
                 top: r.top, bot: r.bottom, vh: window.innerHeight, d: __r44.d };
    })()`);
    judge(sr.top > 0 && sr.bot < sr.vh + 1,
        `波形条在视口内（top=${sr.top.toFixed(0)} bottom=${sr.bot.toFixed(0)} vh=${sr.vh}）`);
    judge(isFinite(sr.d) && sr.d > 1, `播放前已知时长（d=${sr.d}）—— 否则 seek 按设计是空操作`);
    await cdp.mouse('mouseMoved', sr.x, sr.y);
    await cdp.mouse('mousePressed', sr.x, sr.y);
    await cdp.mouse('mouseReleased', sr.x, sr.y);
    await sleep(400);
    const sk = await cdp.ev('({t: __r44.t, d: __r44.d})');
    const frac = sk.d ? sk.t / sk.d : 0;
    judge(frac > 0.5 && frac < 0.95, `点波形条跳转生效（点 72% 处 → 实际 ${(frac * 100).toFixed(1)}%）`);

    // ---------- ④ 窄视口 390px：不得横向溢出 ----------
    await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(700);
    const narrow = await cdp.ev(`(function () {
        var b = document.body, d = document.documentElement;
        // ★ 只报「真正越界」的：若元素处在横向可滚动容器里（overflow-x:auto/scroll），
        //   它超出视口是**设计如此**，不算溢出 —— 否则会打印一串看着吓人其实没事的绿行。
        function inScroller(e) {
            for (var p = e.parentElement; p && p !== document.body; p = p.parentElement) {
                var ox = getComputedStyle(p).overflowX;
                if (ox === 'auto' || ox === 'scroll') return true;
            }
            return false;
        }
        return { w: Math.max(b.scrollWidth, d.scrollWidth),
                 over: [].slice.call(document.querySelectorAll('body *')).filter(function (e) {
                     return e.getBoundingClientRect().right > 391 && e.offsetParent && !inScroller(e);
                 }).slice(0, 5).map(function (e) { return (e.className || e.tagName) + ''; }) };
    })()`);
    judge(narrow.w <= 391,
        `390px 视口无横向溢出（scrollWidth=${narrow.w} 真越界元素=${JSON.stringify(narrow.over)}）`);

    const errFinal = await cdp.ev('__r44.err');
    judge(!errFinal, `全程无播放异常（__r44.err=${errFinal}）`);
} finally {
    close();
}

console.log(fail === 0 ? '\n[v] 真实鼠标播放验证全部通过' : `\n[x] ${fail} 项未通过`);
process.exit(fail === 0 ? 0 : 1);
