/**
 * ============================================================================
 *  _r53-odc-check.mjs · 开放数据域（openDataContext/index.js）的**离线自证**
 * ============================================================================
 *  【为什么要有它】
 *    开放数据域里跑的东西**没法用无头浏览器测**（它要 `wx.getSharedCanvas`），
 *    而真机验证一轮成本很高、还看不见"画成什么样"。所以退一步：
 *    在 Node 里**桩掉 wx**、把那份 index.js 原样跑起来，断言它**画出来的文字**。
 *    这样"排序对不对 / 空态有没有 / 昵称截断对不对 / 非法消息会不会乱重绘"
 *    这些**纯逻辑**判据都能确定性复现，真机上只需要看"好不好看"。
 *
 *  ⚠️ 判据纪律：断言的是**ctx.fillText 真的被调了哪些字符串**，
 *    不是"函数存在""没报错"。每个正向断言都配一条**负控**（见 B 组）。
 *
 *  用法：node --experimental-strip-types --no-warnings tools/_r53-odc-check.mjs
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ODC = resolve(HERE, '../build-templates/wechatgame/openDataContext/index.js');

// ---------------------------------------------------------------- 报告

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  \u2714 ${name}`); }
    else { fail++; fails.push(name); console.log(`  \u2716 ${name}  ${extra}`); }
}
function group(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------- 桩

/** 记录所有 fillText 的字符串（= 这份脚本"画出来了什么"） */
function makeCtx(log) {
    const noop = () => {};
    return {
        clearRect: noop, beginPath: noop, arc: noop, fill: noop, save: noop,
        restore: noop, clip: noop, fillRect: noop, stroke: noop, moveTo: noop,
        lineTo: noop, drawImage: noop, closePath: noop,
        fillText: (s) => { log.texts.push(String(s)); },
        // 可写属性（脚本会直接赋值）
        fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
        lineWidth: 1, globalAlpha: 1,
    };
}

/**
 * 载入并执行开放数据域脚本。
 * @param {{friend?: object[]|null, failMsg?: string|null}} opt
 *   friend = null  ⇒ 走 fail 分支（负控用）
 */
function load(opt) {
    const log = { texts: [], messages: [] };
    let onMessageCb = null;
    let renderCalls = 0;

    const canvas = { width: 640, height: 960, getContext: () => makeCtx(log) };

    const fakeWx = {
        getSharedCanvas: () => canvas,
        onMessage: (cb) => { onMessageCb = cb; },
        createImage: () => ({ set src(_v) {}, onload: null, onerror: null }),
        getFriendCloudStorage: (o) => {
            renderCalls++;
            if (opt.failMsg) { o.fail && o.fail({ errMsg: opt.failMsg }); return; }
            o.success && o.success({ data: opt.friend ?? [] });
        },
    };

    const code = readFileSync(ODC, 'utf8');
    const sandbox = {
        wx: fakeWx,
        console,
        JSON, Math, Date, String, Number, Array, Object, isFinite,
        setTimeout, clearTimeout,
    };
    vm.createContext(sandbox);
    new vm.Script(code, { filename: 'openDataContext/index.js' }).runInContext(sandbox);

    return {
        log,
        renderCalls: () => renderCalls,
        /** 推一条消息进去（模拟主域 postMessage） */
        send: (m) => onMessageCb && onMessageCb(m),
        /** 清空已记文字，方便分段断言 */
        reset: () => { log.texts.length = 0; },
        hasText: (s) => log.texts.some((t) => t.includes(s)),
    };
}

/** 一条好友数据 */
function kv(score) {
    return { key: 'level', value: JSON.stringify({ wxgame: { score, update_time: 1 } }) };
}
function friend(nick, score, self = false) {
    return { nickname: nick, avatarUrl: 'https://x/' + nick + '.png', openid: 'o_' + nick, isSelf: self, KVDataList: [kv(score)] };
}

// ============================================================ A 组

group('A. 正常数据（3 个好友：5 / 12 / 0 关）');
{
    const d = load({ friend: [friend('阿宝', 5), friend('我', 12, true), friend('新来的', 0)] });
    d.send({ type: 'render' });

    ok('A1 触发了 getFriendCloudStorage', d.renderCalls() === 1, `实际 ${d.renderCalls()}`);
    ok('A2 画出了标题「好友排行」', d.hasText('好友排行'));
    ok('A3 三个昵称都画出来了', d.hasText('阿宝') && d.hasText('我') && d.hasText('新来的'));
    ok('A4 分数 12 画成「第 12 关」', d.hasText('第 12 关'));
    ok('A5 分数 5 画成「第 5 关」', d.hasText('第 5 关'));
    ok('A6 ★ 0 分画成「未开始」而不是「第 0 关」', d.hasText('未开始') && !d.hasText('第 0 关'));

    // 排序：12 分必须排在第 1 行 ⇒「第 12 关」先于「第 5 关」出现
    const i12 = d.log.texts.findIndex((t) => t === '第 12 关');
    const i5 = d.log.texts.findIndex((t) => t === '第 5 关');
    ok('A7 ★ 按关卡降序（12 关画在 5 关之前）', i12 >= 0 && i5 >= 0 && i12 < i5, `i12=${i12} i5=${i5}`);

    ok('A8 名次徽标 1/2/3 都画了', d.hasText('1') && d.hasText('2') && d.hasText('3'));
    ok('A9 脚注「仅你可见」在', d.hasText('仅你可见'));
}

// ============================================================ B 组（负控）

group('B. 负控');
{
    // B1 空数据 ⇒ 必须是空态文案，且**不得**画任何「第 N 关」
    const d1 = load({ friend: [] });
    d1.send({ type: 'render' });
    ok('B1 空数据 → 空态文案', d1.hasText('还没有好友玩过'));
    ok('B2 空数据 → 一条「第 N 关」都不该画', !d1.log.texts.some((t) => /^第 \d+ 关$/.test(t)),
        JSON.stringify(d1.log.texts.filter((t) => t.includes('关'))));

    // B3/B4 接口失败 ⇒ 错误态文案 + 带上 errMsg
    const d2 = load({ friend: null, failMsg: 'network error' });
    d2.send({ type: 'render' });
    ok('B3 接口失败 → 错误态文案', d2.hasText('好友数据加载失败'));
    ok('B4 错误态带上 errMsg', d2.hasText('network error'));

    // B5 引擎的 viewport 消息**不得**触发重新拉数据（否则引擎每帧 post 会打爆接口）
    const d3 = load({ friend: [friend('甲', 1)] });
    d3.send({ type: 'render' });
    const after1 = d3.renderCalls();
    d3.send({ type: 'engine', event: 'viewport', x: 0, y: 0, width: 1, height: 1 });
    ok('B5 engine 视窗消息被忽略（不重新拉数据）', d3.renderCalls() === after1,
        `render 次数 ${after1} → ${d3.renderCalls()}`);

    // B6 空消息 / undefined 不得抛异常
    let threw = false;
    try { d3.send(undefined); d3.send(null); d3.send({}); } catch { threw = true; }
    ok('B6 空消息不抛异常', !threw);
}

// ============================================================ C 组

group('C. 数据健壮性');
{
    // C1 昵称过长要截断（7 个字以内不动，超过留 6 字 + …）
    const d = load({ friend: [friend('这是一个非常非常长的昵称', 3)] });
    d.send({ type: 'render' });
    ok('C1 超长昵称被截断（含 …）', d.log.texts.some((t) => t.endsWith('…') && t.length <= 7),
        JSON.stringify(d.log.texts));
    ok('C2 原始超长昵称没有被整段画上去', !d.hasText('这是一个非常非常长的昵称'));

    // C3 KVDataList 坏掉 / 缺 key ⇒ 按 0 处理，不能崩
    let threw = false;
    try {
        const d3 = load({
            friend: [
                { nickname: 'A', avatarUrl: '', KVDataList: [{ key: 'level', value: '{坏 JSON' }] },
                { nickname: 'B', avatarUrl: '', KVDataList: [] },
                { nickname: 'C', avatarUrl: '', KVDataList: [{ key: 'other', value: '1' }] },
            ],
        });
        d3.send({ type: 'render' });
        if (!d3.hasText('未开始')) threw = true;      // 三个都该是「未开始」
    } catch { threw = true; }
    ok('C3 坏 KV / 缺 key 一律按 0 处理且不崩', !threw);

    // C4 好友多于 7 个 ⇒ 只画 7 行
    const many = [];
    for (let i = 1; i <= 12; i++) many.push(friend('F' + i, i));
    const d5 = load({ friend: many });
    d5.send({ type: 'render' });
    const rows = d5.log.texts.filter((t) => /^第 \d+ 关$/.test(t) || t === '未开始').length;
    ok('C4 只画前 7 名（≥12 个好友时）', rows === 7, `实际 ${rows} 行`);
    ok('C5 ★ 截断后留下的必须是分最高的 7 个（F12~F6）',
        d5.hasText('第 12 关') && d5.hasText('第 6 关') && !d5.hasText('第 5 关'));
}

// ---------------------------------------------------------------- 汇总

console.log(`\n${'='.repeat(58)}`);
console.log(`开放数据域离线自证：${pass}/${pass + fail} 通过`);
if (fail) {
    console.log(`失败项：\n  - ${fails.join('\n  - ')}`);
    process.exit(1);
}
console.log('全部通过');
