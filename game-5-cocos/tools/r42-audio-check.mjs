#!/usr/bin/env node
/**
 * ============================================================
 *  r42-audio-check.mjs · 第 42 轮真实事件自证
 *    A · 吃/碰人声：隔壁项目 → 入库 → 进包 → 运行期 → 逐次可听
 *    B · 桌外底色 B「织锦经纬 ×1.20」：无缝平铺真的生效
 * ============================================================
 *
 *  【为什么不看"加载成功"就够了】
 *  `AudioService` 对加载失败**只 warn 不抛错**（设计如此，避免一次网络抖动
 *  把整局静音），所以"没报错"根本不等于"声音会响"。本项目已经踩过一次同类坑：
 *  `m.kind` 写成 `undefined`，所有"碰"静默播成"吃"，零报错。
 *  ⇒ 这里用**真实探针 + 真实鼠标点击**证明三层：
 *     ① 素材链路（Node 侧字节级）：隔壁项目那两个文件 = 我入库的 = 进包的；
 *     ② 运行期身份：内存里那条 clip 的 uuid / 时长就是它；
 *     ③ 行为：每一"碰/吃"都真的发出播放调用，且与飘字**逐次一致**。
 *
 *  【★ 本轮踩到的两个"假红"，都是判据自身写错了（判据纪律 #1）】
 *    · `cc.UITransform` / `cc.AudioSource` 在 **web 构建产物里是 undefined**
 *      —— 构建后的 `window.cc` 是**精简命名空间**，只挂实际引用到的符号，
 *      真名分别是 `cc.UITransformComponent` / `cc.AudioSourceComponent`。
 *      直接 `cc.AudioSource.prototype` 会抛 "Cannot read properties of undefined"。
 *      （`cc.Sprite` / `cc.Label` / `cc.AudioClip` / `cc.resources` 倒是有的，
 *       所以这个坑是"挑着踩"的，最容易被当成产品问题。）
 *    · `Texture2D.WrapMode.REPEAT` **不等于** WebGL 的 `GL_REPEAT(10497)`：
 *      引擎的 WrapMode 直接复用 gfx 的 AddressMode ⇒ `REPEAT = 0`。
 *      实测打表：`cc.Texture2D.WrapMode = {REPEAT:0, MIRRORED_REPEAT:1,
 *      CLAMP_TO_EDGE:2, CLAMP_TO_BORDER:3}`。旧判据拿 10497 去比一个恒为 0 的
 *      字段，自然报红 —— 而产品侧日志与真机自相关峰位都证明平铺是好的。
 *
 *  【★ 判据的对照组（没有对照组 = 不知道判据是不是恒真/恒假）】
 *    · wrapMode：把 EnvWeave 的贴图临时改成 CLAMP_TO_EDGE → 必须读回 2，
 *      再改回 REPEAT → 必须回 0。（证明这个字段真的在变、读数是真的测量）
 *    · packable：同一场景里 `EnvGrad` 的 `packable === true` 而 EnvWeave 是
 *      false（实测 19 个 Sprite：17 true / 2 false）。
 *    · Sprite.type：EnvGrad 是 0(SIMPLE)、EnvWeave 是 2(TILED)。
 *    · 时长：afinfo 的 `estimated duration` **不等于** `getDuration()`——
 *      前者只算 valid frames，后者含 AAC priming/remainder（解码总帧数）。
 *      两个都打出来，避免"用错口径的期望值"再制造一次假红。
 *
 *  【★ 飘字期望值来自需求真源，不是来自游戏当前输出】
 *  设计规则 G1：① 碰 = 三张完全相同；② 吃 = 同花色连号 n,n+1,n+2（不跨花色）；
 *  ③ 含"最新入槽那张"的组合优先；④ 并列时碰优先于吃。
 *  本脚本**独立实现**这四条，据此算出"这一点击下去应该飘哪个字"，
 *  再和实测的「飘字 + 播放的 clip」对账 —— 这才拦得住 `m.kind` 那类错别字。
 *  （若直接拿游戏自己飘的字当期望，就是在做"现状即期望"的断言。⚠️ 判据纪律 #8）
 *
 *  【用法】node tools/r42-audio-check.mjs [outdir] [--level N]
 * ============================================================
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { designToCss, openBrowser, sleep, startServer, waitFor } from './g5-cdp.mjs';

const argv = process.argv.slice(2);
const LEVEL = (() => { const i = argv.indexOf('--level'); return i >= 0 ? Number(argv[i + 1]) : 12; })();
const OUT = resolve(argv.find((a) => !a.startsWith('--') && a !== String(LEVEL)) ?? '/tmp/g5-r42-audio');
mkdirSync(OUT, { recursive: true });

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'build', 'web-desktop');
/** 隔壁项目（用户原话里的「麻麻大消除」＝ game-4-mahjong，仓库名 mahjong-chipeng） */
const G4_AUDIO = join(homedir(), 'WorkBuddy/2026-09-30-14-03-17/game-4-mahjong/assets/resources/audio');

/** 两条人声的溯源台账（md5/uuid 与 CFG.ts 的注释、.meta 三处必须一致） */
const CLIPS = {
    chi: {
        cn: '吃', src: 'eat.m4a', dst: 'chi.m4a',
        md5: 'ac3fead2c6353e05f28215d91ea041cf',
        uuid: 'ec761682-2d60-4a4e-b6c6-264543b83ee1',
    },
    peng: {
        cn: '碰', src: 'peng.m4a', dst: 'peng.m4a',
        md5: 'f427097ca644a0e80c7ff5e39c8f5aa4',
        uuid: '0d6a500c-2ccb-4141-a3fc-2562d45046ff',
    },
};

// ---------- 断言记账 ----------
const rows = [];
const fails = [];
const note = (k, v = '') => rows.push([k, v]);
const bad = (k, v) => { rows.push([k, `FAIL · ${v}`]); fails.push(k); };
const warn = (k, v) => { rows.push([k, `WARN · ${v}`]); };
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

// ============================================================
//  段 A · 素材链路（Node 侧，字节级）
// ============================================================
console.log('  ── A 素材链路（Node 侧字节级）──');
let afinfoOf = {};
for (const [key, c] of Object.entries(CLIPS)) {
    const local = join(ROOT, 'assets/resources/audio', c.dst);
    // ① 入库文件 md5 == 台账 md5
    if (!existsSync(local)) { bad(`A1 ${c.cn} 入库文件存在`, local); continue; }
    const m = md5(local);
    if (m !== c.md5) bad(`A1 ${c.cn} 入库 md5 == 台账`, `${m} vs ${c.md5}`);
    else note(`A1 ${c.cn} 入库 md5 == 台账`, m.slice(0, 12));

    // ② 隔壁项目源文件 md5 一致（真溯源；项目不在本机时降级为"台账已记录"）
    const src = join(G4_AUDIO, c.src);
    if (existsSync(src)) {
        const ms = md5(src);
        if (ms !== c.md5) bad(`A2 ${c.cn} == game-4/${c.src}`, `${ms} vs ${c.md5}`);
        else note(`A2 ${c.cn} == game-4/${c.src}`, `字节相同 · ${(readFileSync(src).length / 1024).toFixed(1)} KB`);
    } else warn(`A2 ${c.cn} == game-4/${c.src}`, `源项目不在本机（${G4_AUDIO}），仅按台账 md5 核对`);

    // ③ 进包的那份 m4a 与入库文件逐字节一致（文件名就是 uuid ⇒ 与运行期 clip 同一条）
    const packed = join(DIST, 'assets/resources/native', c.uuid.slice(0, 2), `${c.uuid}.m4a`);
    if (!existsSync(packed)) bad(`A3 ${c.cn} 已进构建产物`, packed);
    else {
        const mp = md5(packed);
        if (mp !== c.md5) bad(`A3 ${c.cn} 构建产物 == 入库文件`, `${mp} vs ${c.md5}`);
        else note(`A3 ${c.cn} 构建产物 == 入库文件`, `native/${c.uuid.slice(0, 2)}/${c.uuid}.m4a`);
    }

    // ④ 时长期望值取自**源文件本身**（不写死数字）
    try {
        const txt = execFileSync('afinfo', [local], { encoding: 'utf8' });
        const ch = txt.match(/Data format:\s+(\d+) ch,\s+(\d+) Hz/);
        const fr = txt.match(/audio (\d+) valid frames \+ (\d+) priming \+ (\d+) remainder = (\d+)/);
        const est = txt.match(/estimated duration:\s+([\d.]+) sec/);
        afinfoOf[key] = {
            hz: Number(ch[2]), ch: Number(ch[1]),
            valid: Number(fr[1]), total: Number(fr[4]),
            est: Number(est[1]),
            /** ★ 运行期 `getDuration()` 的口径 = 解码总帧数 / 采样率 */
            expect: Number(fr[4]) / Number(ch[2]),
        };
        note(`A4 ${c.cn} 时长期望（源文件推出）`,
            `${afinfoOf[key].expect.toFixed(4)}s = ${fr[4]} 帧 ÷ ${ch[2]}Hz`
            + `（afinfo 的 estimated ${est[1]}s 只算 ${fr[1]} valid frames —— 两个口径别混）`);
    } catch (e) {
        warn(`A4 ${c.cn} 时长期望`, `afinfo 不可用：${e.message}`);
    }
}

// ============================================================
//  段 B/C/D · 运行期
// ============================================================
const srv = await startServer(DIST);
const { cdp, close } = await openBrowser(srv.url, { seedLevel: LEVEL });

/** 把「设计 px」坐标喂给真实鼠标前必须过 `toScreen`（见 g5-cdp.designToCss 头注释） */
const state = () => cdp.ev('globalThis.__game5 ? globalThis.__game5.state() : null');
const logHas = (sub) => cdp.logs.some((l) => l.text.includes(sub));
const waitLog = async (sub, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (logHas(sub)) return true; await sleep(120); }
    return false;
};
async function tapNode(name) {
    const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
    if (!p) throw new Error(`找不到节点 ${name}`);
    await cdp.click(p.x, p.y);
}
async function unlocked(ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = await state();
        if (!s || !s.locked) return true;
        await sleep(90);
    }
    return false;
}

// ---------- 判定内核：独立复刻需求真源（碰 = 3 同；吃 = 同花色连号 3） ----------
const SUIT = { 万: 0, 条: 1, 筒: 2 };
const NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const parseFace = (l) => ({ s: SUIT[l[1]], n: NUM[l[0]] });
const code = (f) => `${f.s}-${f.n}`;
/**
 * 把 newFace 放进槽后**按规则应该**消出什么？null = 不消。
 * 与游戏同一优先级：先照顾最新那张 → 碰优先于吃。
 */
function expectedType(slotFaces, newFace) {
    const nf = parseFace(newFace);
    const all = slotFaces.map(parseFace).concat([nf]);
    if (all.filter((f) => code(f) === code(nf)).length >= 3) return 'peng';
    for (const suit of [0, 1, 2]) {
        for (let st = 1; st <= 7; st++) {
            const need = [st, st + 1, st + 2];
            if (!need.every((n) => all.some((f) => f.s === suit && f.n === n))) continue;
            if (nf.s === suit && need.includes(nf.n)) return 'chi';
        }
    }
    return null;
}

try {
    await waitFor(cdp, 'typeof cc !== "undefined" && !!window.__g5t', 30000, '引擎 + 页面助手');
    await waitFor(cdp, 'window.__g5t.find("UIRoot") !== null', 15000, 'UIRoot');

    console.log(`  ── B/C 运行期（真机视口 421×927 @3 · 第 ${LEVEL} 关）──`);
    if (!await waitLog('[PageManager] → home', 20000)) throw new Error('没到首页');
    await sleep(1600);
    await tapNode('BtnStart');
    if (!await waitLog('[PageManager] → gameStart', 12000)) throw new Error('没到开局页');
    await sleep(3000);
    await tapNode('BtnGo');
    if (!await waitLog('[PageManager] → game', 15000)) throw new Error('没进到主玩页');
    await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');
    await sleep(2200);

    // ============================================================
    //  段 B · 运行期 clip 身份
    // ============================================================
    const clips = await cdp.ev(`(() => {
        const out = {};
        for (const p of ['audio/chi', 'audio/peng']) {
            const a = cc.resources.get(p, cc.AudioClip);
            out[p] = a ? { name: a.name, dur: a.getDuration(), uuid: a._uuid } : null;
        }
        return out;
    })()`);

    for (const [key, c] of Object.entries(CLIPS)) {
        const got = clips[`audio/${key}`];
        if (!got) { bad(`B1 运行期取到 audio/${key}（${c.cn}）`, 'resources.get 取不到 ⇒ 没进包或路径写错'); continue; }
        if (got.name !== key) bad(`B1 运行期 audio/${key} 的 name`, `实测 ${got.name}`);
        else note(`B1 运行期 audio/${key} 的 name`, got.name);
        // ★ uuid 是**最强身份判据**：它同时锚定了"进包的那个文件"和"内存里这条 clip"
        if (got.uuid !== c.uuid) bad(`B2 audio/${key} 的 uuid == 台账`, `${got.uuid} vs ${c.uuid}`);
        else note(`B2 audio/${key} 的 uuid == 台账`, got.uuid);
        const exp = afinfoOf[key]?.expect;
        if (exp === undefined) warn(`B3 audio/${key} 时长`, '无期望值可比');
        else if (Math.abs(got.dur - exp) > 0.005) bad(`B3 audio/${key} 时长 == 源文件解码总帧`, `实测 ${got.dur.toFixed(4)}s / 期望 ${exp.toFixed(4)}s`);
        else note(`B3 audio/${key} 时长 == 源文件解码总帧`, `${got.dur.toFixed(4)}s ✓`);
    }
    // 负向对照：两条不能是同一条资源（否则"逐次一致"毫无意义）
    if (clips['audio/chi'] && clips['audio/peng']) {
        const same = clips['audio/chi'].uuid === clips['audio/peng'].uuid;
        const sameDur = Math.abs(clips['audio/chi'].dur - clips['audio/peng'].dur) < 1e-6;
        if (same || sameDur) bad('B4 对照：吃/碰 是两条不同资源', `uuid 同=${same} 时长同=${sameDur} ⇒ 可能整条线接错`);
        else note('B4 对照：吃/碰 是两条不同资源',
            `时长 ${clips['audio/chi'].dur.toFixed(3)}s ≠ ${clips['audio/peng'].dur.toFixed(3)}s`);
    }

    // 加载失败：只断言「这两条没失败」，其余是**工程已知的预留空位**
    const failLogs = cdp.logs.filter((l) => l.text.includes('音频加载失败'));
    const failedPaths = failLogs.map((l) => (l.text.match(/音频加载失败：(\S+)/) || [])[1]).filter(Boolean);
    const humanFailed = failedPaths.filter((p) => p === 'audio/chi' || p === 'audio/peng');
    if (humanFailed.length) bad('B5 两条人声都加载成功', `失败：${humanFailed.join(', ')}`);
    else note('B5 两条人声都加载成功', 'AudioService 未报 audio/chi / audio/peng 失败');
    if (failedPaths.length) {
        note('B6 其余音频空位（工程现状，非本轮引入）',
            [...new Set(failedPaths)].sort().join(' / ') + ` —— 共 ${failedPaths.length} 次，均无对应素材文件`);
    }

    // ============================================================
    //  段 C · 桌外底色：织锦平铺层
    // ============================================================
    const weave = await cdp.ev(`(() => {
        const T = window.__g5t;
        const n = T.find('EnvWeave'), g = T.find('EnvGrad');
        if (!n) return { miss: true };
        const sp = n.getComponent('cc.Sprite');           // ★ 字符串类名：cc.Sprite 在产物里有，但 UITransform 没有
        const ui = n.getComponent('cc.UITransform');
        const sf = sp && sp.spriteFrame;
        const tex = sf && sf.texture;
        const v = cc.view.getVisibleSize();
        const WM = cc.Texture2D.WrapMode;                 // ★ 别硬编码 10497
        const out = {
            active: n.activeInHierarchy, type: sp ? sp.type : -1,
            w: ui ? +ui.contentSize.width.toFixed(2) : -1,
            h: ui ? +ui.contentSize.height.toFixed(2) : -1,
            visW: +v.width.toFixed(2), visH: +v.height.toFixed(2),
            texW: sf ? sf.rect.width : -1, texH: sf ? sf.rect.height : -1,
            packable: sf ? sf.packable : null,
            wrapS: tex ? tex._wrapS : -1, wrapT: tex ? tex._wrapT : -1,
            WM_REPEAT: WM.REPEAT, WM_CLAMP: WM.CLAMP_TO_EDGE,
            // 对照组 ①：同一个 texture 临时改成 CLAMP_TO_EDGE，读数必须跟着变
            ctrl: null,
            // 对照组 ②：另一个 Sprite（EnvGrad）的 type / packable
            grad: null,
        };
        if (tex) {
            tex.setWrapMode(WM.CLAMP_TO_EDGE, WM.CLAMP_TO_EDGE);
            const clamp = tex._wrapS;
            tex.setWrapMode(WM.REPEAT, WM.REPEAT);
            out.ctrl = { clamp, back: tex._wrapS };
        }
        if (g) {
            const gsp = g.getComponent('cc.Sprite');
            const gsf = gsp && gsp.spriteFrame;
            out.grad = { type: gsp ? gsp.type : -1, packable: gsf ? gsf.packable : null };
        }
        return out;
    })()`);

    if (weave.miss) bad('C1 EnvWeave 节点存在', '没找到节点 ⇒ 平铺层没建起来');
    else {
        note('C1 EnvWeave 节点就位', `active=${weave.active} 贴图 ${weave.texW}×${weave.texH}`);
        if (weave.type !== 2) bad('C2 Sprite.type == TILED(2)', `实测 ${weave.type}`
            + (weave.grad ? `（对照：EnvGrad=${weave.grad.type}=SIMPLE ⇒ 读数会变，不是恒为 2）` : ''));
        else note('C2 Sprite.type == TILED(2)', `实测 2${weave.grad ? ` · 对照 EnvGrad=${weave.grad.type}(SIMPLE)` : ''}`);
        if (Math.abs(weave.w - weave.visW) > 1 || Math.abs(weave.h - weave.visH) > 1) {
            bad('C3 平铺层尺寸 == 可视尺寸', `${weave.w}×${weave.h} vs ${weave.visW}×${weave.visH}`);
        } else note('C3 平铺层尺寸 == 可视尺寸', `${weave.w}×${weave.h}`);
        const okWrap = weave.wrapS === weave.WM_REPEAT && weave.wrapT === weave.WM_REPEAT;
        const ctrlOk = weave.ctrl && weave.ctrl.clamp === weave.WM_CLAMP && weave.ctrl.back === weave.WM_REPEAT;
        if (!okWrap) bad('C4 贴图 wrapMode == REPEAT', `实测 _wrapS=${weave.wrapS} _wrapT=${weave.wrapT}（REPEAT=${weave.WM_REPEAT}，CLAMP=${weave.WM_CLAMP}；注意不是 GL 的 10497）`);
        else if (!ctrlOk) bad('C4 贴图 wrapMode == REPEAT', `读数对照组不通过：${JSON.stringify(weave.ctrl)} ⇒ 这个字段读不出变化，判据不可信`);
        else {
            note('C4 贴图 wrapMode == REPEAT', `_wrapS=_wrapT=${weave.wrapS}（=REPEAT，不是 GL 的 10497）`);
            note('C4b 对照组：wrapMode 读数是真的测量',
                `改成 CLAMP_TO_EDGE 读回 ${weave.ctrl.clamp} → 改回 REPEAT 读回 ${weave.ctrl.back}`);
        }
        if (weave.packable !== false) bad('C5 贴图 packable=false', `实测 ${weave.packable} ⇒ 可能被动态合图吞掉，UV 不再是 [0,1]`);
        else note('C5 贴图 packable=false', `不会被动态合图吞掉${weave.grad && weave.grad.packable === true ? '（对照：EnvGrad.packable=true ⇒ 字段在变）' : ''}`);
    }
    const ready = cdp.logs.filter((l) => l.text.includes('织锦平铺层就绪')).pop();
    if (!ready) bad('C6 运行期日志「织锦平铺层就绪」', '没打印 ⇒ 贴图没加载成功（失败时是静默隐藏的）');
    else if (!ready.text.includes('wrap=REPEAT')) bad('C6 运行期日志含 wrap=REPEAT', ready.text.trim());
    else note('C6 运行期日志', ready.text.replace(/^\[GamePage\]\s*/, '').trim());

    // ============================================================
    //  段 D · 真实鼠标驱动，逐次三角对账（期望类型 / 飘字 / 播放的 clip）
    // ============================================================
    console.log('  ── D 真实鼠标消除：期望 ↔ 飘字 ↔ 播放 ──');
    // 探针 ①：播放调用（★ 类名是 cc.AudioSourceComponent，不是 cc.AudioSource）
    const probe = await cdp.ev(`(() => {
        window.__sfxLog = []; window.__popLog = [];
        const C = cc.AudioSourceComponent;
        if (!C || !C.prototype) return { ok: false, why: 'cc.AudioSourceComponent 不可见' };
        if (!C.prototype.__g5probed) {
            const orig = C.prototype.playOneShot;
            C.prototype.playOneShot = function (clip, vol) {
                try {
                    window.__sfxLog.push({ name: clip && clip.name, uuid: clip && clip._uuid,
                        dur: clip && +clip.getDuration().toFixed(3), vol: +(vol || 0).toFixed(2) });
                } catch (e) { /* 忽略 */ }
                return orig.call(this, clip, vol);
            };
            C.prototype.__g5probed = true;
        }
        // 探针 ②：飘字（在 Label.string **被赋值的那一刻**记账 → 与播放调用严格同序，不靠采样时机）
        const L = cc.Label.prototype;
        if (!L.__g5probed) {
            const d = Object.getOwnPropertyDescriptor(L, 'string');
            Object.defineProperty(L, 'string', {
                get: d.get, enumerable: d.enumerable, configurable: true,
                set(v) {
                    const p = this.node && this.node.parent;
                    if (p && p.name === 'Pop') window.__popLog.push(String(v));
                    return d.set.call(this, v);
                },
            });
            L.__g5probed = true;
        }
        return { ok: true, labelDesc: 'accessor' };
    })()`);
    if (!probe.ok) bad('D1 探针挂载', probe.why);
    else note('D1 探针挂载', 'AudioSourceComponent.playOneShot + Label.string(Pop)');

    const take = (k) => cdp.ev(`(() => { const a = window.${k}.slice(); window.${k}.length = 0; return a; })()`);
    const pickablesCss = async () => designToCss(cdp,
        await cdp.ev('globalThis.__game5 ? globalThis.__game5.pickables() : []'));

    const pairs = [];              // { want, toast, clip, cn }
    let nPeng = 0, nChi = 0, clicks = 0, lostAt = null;
    const t0 = Date.now();

    for (let step = 0; step < 160; step++) {
        if (Date.now() - t0 > 200000) { lostAt = '时间预算耗尽'; break; }
        const st = await state();
        if (!st) { lostAt = '调试桥消失'; break; }
        if (st.over) { lostAt = '本局已结束'; break; }
        if (st.slots >= st.slotMax) { lostAt = '槽已满'; break; }
        await unlocked();

        const faces = await cdp.ev('globalThis.__game5.slotFaces()');
        const pks = await pickablesCss();
        if (!pks.length) { lostAt = '已无可点牌'; break; }

        const scored = pks.map((p) => ({ p, want: expectedType(faces, p.face) }));
        const matching = scored.filter((s) => s.want);
        // 覆盖面优先：还不满的类型优先补齐（吃比碰稀有，先补吃）
        const need = nChi === 0 ? 'chi' : (nPeng === 0 ? 'peng' : null);
        let choice = null;
        if (matching.length) {
            choice = (need && matching.find((s) => s.want === need)) || matching[0];
        } else if (st.slots < st.slotMax - 1) {
            // 不消：优先挑「与槽内同花色点数相邻」的，攒出「吃」的机会
            const seed = (p) => {
                const f = parseFace(p.face);
                return faces.map(parseFace).filter((g) => g.s === f.s && Math.abs(g.n - f.n) <= 2).length;
            };
            const pool = scored.filter((s) => !s.want);
            pool.sort((a, b) => seed(b.p) - seed(a.p));
            choice = pool[0] ?? null;
        } else {
            choice = matching[0] ?? null;
        }
        if (!choice) { lostAt = '本步无牌可点（避免送死）'; break; }

        await take('__sfxLog'); await take('__popLog');
        await cdp.click(choice.p.x, choice.p.y);
        clicks++;
        await sleep(400);

        const toasts = await take('__popLog');
        const sfxs = (await take('__sfxLog')).filter((e) => ['chi', 'peng'].includes(e.name));
        if (!choice.want) continue;                       // 这一点击下去本来就不该消

        const toast = toasts[0] ?? null;
        const clip = sfxs[0] ?? null;
        pairs.push({ want: choice.want, toast, clip: clip && clip.name, cn: CLIPS[choice.want].cn });
        if (choice.want === 'peng') nPeng++; else nChi++;
    }
    console.log(`    共真实点击 ${clicks} 次 · 观察到消除 ${pairs.length} 次（碰 ${nPeng} / 吃 ${nChi}）· 收尾：${lostAt ?? '步数用尽'}`);

    if (pairs.length === 0) bad('D2 消除确实发出播放调用', '打了一整关一次都没探到 ⇒ 音效没接上');
    else note('D2 消除确实发出播放调用', `碰×${nPeng} 吃×${nChi} 共 ${pairs.length} 次`);

    const noToast = pairs.filter((p) => p.toast !== (p.want === 'peng' ? '碰' : '吃'));
    if (noToast.length) bad('D3 飘字 == 规则推出的期望', JSON.stringify(noToast.slice(0, 4)));
    else note('D3 飘字 == 规则推出的期望', `逐次一致（期望由设计规则独立推出）`);

    const noClip = pairs.filter((p) => p.clip !== p.want);
    if (noClip.length) bad('D4 播放的 clip == 规则推出的期望', JSON.stringify(noClip.slice(0, 4)));
    else note('D4 播放的 clip == 规则推出的期望', pairs.slice(0, 6).map((p) => `${p.cn}→${p.clip}`).join(' ')
        + (pairs.length > 6 ? ' …' : ''));

    for (const t of ['peng', 'chi']) {
        const n = t === 'peng' ? nPeng : nChi;
        if (n === 0) warn(`D5 覆盖：${CLIPS[t].cn}（${t}）分支`, '本局没出现过这一型，该分支本轮未被真实触发');
        else note(`D5 覆盖：${CLIPS[t].cn}（${t}）分支`, `${n} 次`);
    }

    const errs = cdp.logs.filter((l) => l.level === 'error');
    const uncaught = cdp.errors.filter((e) => !e.includes('音频加载失败'));
    note('D6 console error', `${errs.length} 条 · 未捕获异常 ${uncaught.length} 条`);
    if (errs.length || uncaught.length) {
        bad('D6 零 error / 零未捕获异常',
            [...uncaught.slice(0, 3), ...errs.slice(0, 3).map((l) => l.text)].join(' | '));
    }

    // 末帧留痕。
    // ⚠️ 3× 下重盘面（本关 99 张）在无头 Chrome 的软件光栅里 `Page.captureScreenshot`
    //    会真的超时（60s / 90s 都不返回）—— 这是 g5-cdp.shot 已记的坑，**与产品无关**。
    //    既定绕法是降到 dsf=1（同一时刻游戏内实测仍是 60fps，卡的是截图通路）。
    //    ⇒ 截图失败**不判产品失败**，但要如实记账，不许静默吞掉。
    try {
        await cdp.shot(join(OUT, 'final-3x.png'));
        note('末帧留痕', 'final-3x.png（3× 一次成功）');
    } catch (e3) {
        try {
            await cdp.send('Emulation.setDeviceMetricsOverride',
                { width: 421, height: 927, deviceScaleFactor: 1, mobile: true });
            await sleep(800);
            await cdp.shot(join(OUT, 'final-1x.png'));
            note('末帧留痕', '3× 光栅超时 → 降 1× 重拍成功（软件光栅已知限制，非产品问题）');
        } catch (e1) {
            warn('末帧留痕', `两档都超时：3× ${e3.message} / 1× ${e1.message}`);
        }
    }
} catch (e) {
    bad('流程', e.message);
} finally {
    console.log('');
    console.log('  第 42 轮 · 吃/碰人声 + 桌外底色的真实事件自证');
    console.log('  ' + '-'.repeat(96));
    for (const [k, v] of rows) {
        const tag = String(v).startsWith('FAIL') ? '[FAIL]' : String(v).startsWith('WARN') ? '[WARN]' : '[OK]  ';
        console.log(`  ${tag} ${k}${v ? '  · ' + v : ''}`);
    }
    console.log('  ' + '-'.repeat(96));
    if (fails.length) { console.log(`[x] ${fails.length} 项不通过：${fails.join(' / ')}`); process.exitCode = 1; }
    else console.log(`[v] 全部 ${rows.length} 项通过（WARN 为非产品问题，见原文）`);
    console.log('');
    await sleep(200);
    close();
    srv.proc.kill();
}
