/**
 * _r46-diff-verify.mjs · 第 46 轮需求⑥「难度参数」标定 + 验收（离线）
 *
 * 【用户原话】「目前构建的关卡难度太低了，用户基本不需要看广告……请设置一个难度参数，
 *   根据难度参数来调整牌的顺序以控制关卡难度，后续我可以对参数进行调节」。
 *
 * 【这个脚本要回答两个问题】
 *   ① 难度参数**真的有效**吗？（不是"看起来生效了"）
 *   ② 参数该取多少？（给一张**块大小 ↔ 通关率**的标定表，让用户自己拍板）
 *
 * ── 三个代理玩家 ────────────────────────────────────────────
 *   · blind（无脑）：**完全不看牌面**，每次都点"当前能点的里层号最高"的那张。
 *     这正是"太简单"的定义 —— 不动脑子也能过。（顺带说明：它 ≈ 顺着生成器的剥离序走。）
 *   · aware（会看牌）：优先点"点下去立刻成组"的牌，其次点"能和槽里已有的凑上"的牌。
 *     这是普通玩家的**下限**（贪心，随时可能走进死路）。
 *     ⚠️ 第 62 轮：它已**懂「吃」**（`useChi`），但那个次优启发式是为**纯碰局面**标定的；
 *        混合牌面下它会低估玩家（BLOCK=3 原样牌面时 8.0/30 < 无脑 21.0/30）。
 *        ⇒ **想看公平的难度读数请跑 `tools/_r62-proxy-lab.mjs`**（那里有"保守看牌"）。
 *   · followSo（照清序）：严格按 `level.so` 点 —— 生成器保证这条顺序几何上合法。
 *     它**不是**给玩家用的策略，而是**可解性的构造证明**：
 *     只要它能 30/30 通关，就说明"这一档仍然有解"，与 aware 通不通无关。
 *
 * ── 判据设计（★ 别用"现状即期望"那套）──────────────────────
 *   A. `BLOCK = 3` 时「合法可消组率」必须 **= 100%**（清序每 3 张 = 一个可消组），
 *      且「照清序」必须 **30/30** —— 这两条合起来才说明内嵌 `so` 名次正确、置换没空转。
 *      （★ 第 62 轮改口径：原来是"三张全同面 ≥99%"，加「吃」之后天然只剩 ~72%，已失效。）
 *   F. ★ 代理公平性：懂吃的「会看牌」在**没有吃的关**必须与只懂碰的那版逐关一致。
 *   B. 每个块大小跑 **多个种子取均值**（单种子只是运气）。
 *   E. 可解性：只有 `BLOCK = 3` 时能保证 30/30；提档就牺牲该保证（加「吃」后尤其重）。
 *   D. 当前档位：判"与拍板记录一致"，其余数字只作记录。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r46-diff-verify.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { makeBoard, peelOrder, replaySoIsLegal } from './_core/Board.ts';
import { PLAY, DIFF } from './_core/CFG.ts';
import { findMatch, wouldMatch } from './_core/MatchRule.ts';
import { suitOf, numOf } from './_core/TileData.ts';
import { tripleIntactRate, legalGroupRate, diffuseFaces } from './_core/Difficulty.ts';

const SLOT_MAX = PLAY.SLOT_MAX;
const SEEDS = [1, 7, 13, 29, 101, 997];   // 取均值，抹掉单种子的运气

/**
 * ⚠️ **必须在任何 `runAt()` 之前快照** —— `runAt()` 会改 `DIFF.BLOCK` / `DIFF.SEED`
 *   （为了逐档重算），跑完 [B] 之后 `DIFF` 上留的是**最后一个扫描档**，不是配置值。
 *   （第 46 轮踩过：不快照的话 [D] 会把 16 当成"当前配置"，然后误报三条失败。）
 */
const CFG_BLOCK = DIFF.BLOCK;
const CFG_ENABLED = DIFF.ENABLED;
const CFG_PER_LEVEL = { ...DIFF.PER_LEVEL };

const rankOf = (L) => {
    const rank = new Array(L.n).fill(0);
    peelOrder(L).forEach((idx, k) => { rank[idx] = k; });
    return rank;
};

// ── 代理玩家 ────────────────────────────────────────────────

/** 无脑：完全不看牌面，只挑"层号最高"的可点牌（同层取小 id，保证确定性） */
function pickBlind(board, cands) {
    let best = cands[0];
    for (const i of cands) {
        if (board.tiles[i].z > board.tiles[best].z) best = i;
        else if (board.tiles[i].z === board.tiles[best].z && i < best) best = i;
    }
    return best;
}

/**
 * 会看牌（★ 第 62 轮起懂「碰 + 吃」）：① 能立刻成组就成 ② 否则按
 * **同面张数（主键）→ 同花色近号搭子数（次键）** 选 ③ 都没有 → 无脑那套。
 *
 * ⚠️ **`useChi` 不能省**（第 62 轮踩过，见 `_r62-mix-lab.mjs` 的长注释）：
 *    「连号搭子」在**没有吃组的局面**下是纯噪声 —— 真实玩家看得见"这局没吃"，
 *    不会去追连号。若无条件启用，`p = 0`（纯碰局面）时它会抢走本该优先的同面牌，
 *    通关率从 28.0 掉到 22.0 ⇒ 代理不再公平（自检见脚本尾部 [F] 组）。
 */
function pickAware(board, cands, slots, useChi) {
    const faces = slots.map((i) => board.tiles[i].face);
    for (const i of cands) if (wouldMatch(faces, board.tiles[i].face)) return i;
    let best = -1, bestSame = -1, bestCombo = -1;
    for (const i of cands) {
        const f = board.tiles[i].face;
        const same = faces.filter((x) => x === f).length;
        let combo = 0;
        if (useChi) {
            for (const x of faces) {
                if (x !== f && suitOf(x) === suitOf(f) && Math.abs(numOf(x) - numOf(f)) <= 2) combo++;
            }
        }
        const better = same > bestSame
            || (same === bestSame && combo > bestCombo)
            || (same === bestSame && combo === bestCombo
                && best >= 0 && board.tiles[i].z > board.tiles[best].z);
        if (better) { best = i; bestSame = same; bestCombo = combo; }
    }
    return best >= 0 ? best : pickBlind(board, cands);
}

/** 开局局面里"玩家能看见存在吃"吗 —— 有任一花色出现连续三号（各 ≥1 张）即算有 */
function hasChiChance(faces) {
    for (let suit = 0; suit < 3; suit++) {
        const has = new Set();
        for (const f of faces) if (suitOf(f) === suit) has.add(numOf(f));
        for (let s = 1; s <= 7; s++) {
            if (has.has(s) && has.has(s + 1) && has.has(s + 2)) return true;
        }
    }
    return false;
}

/** 公共推进：把一张牌点进槽、判成组。返回 'ok' | 'slotsFull' */
function push(board, slots, i) {
    if (slots.length >= SLOT_MAX) return 'slotsFull';
    if (!board.pickable().includes(i)) return 'illegal';
    board.pick(i);
    slots.push(i);
    const m = findMatch(slots.map((k) => board.tiles[k].face), slots.length - 1);
    if (m) {
        const gone = new Set(m.indices);
        const keep = slots.filter((_, k) => !gone.has(k));
        slots.length = 0;
        slots.push(...keep);
    }
    return 'ok';
}

/**
 * 跑一局贪心代理；返回 { result, peak }。
 *
 * @param strategy 'blind'（无视牌面）/ 'aware'（会看牌，自动判断本关有没有吃）/
 *                 'awarePeng'（**只懂碰**，第 62 轮之前的那版代理 —— 留作公平性对照）
 */
function play(level, strategy) {
    const board = makeBoard(level);
    const slots = [];
    const useChi = strategy !== 'awarePeng' && hasChiChance(board.tiles.map((t) => t.face));
    let peak = 0;
    const maxSteps = level.n * 4 + 64;
    for (let step = 0; step < maxSteps; step++) {
        if (board.remaining === 0) return { result: slots.length === 0 ? 'win' : 'stuck', peak };
        const cands = board.pickable();
        if (cands.length === 0) return { result: 'noCandidates', peak };
        const i = strategy === 'blind' ? pickBlind(board, cands) : pickAware(board, cands, slots, useChi);
        const r = push(board, slots, i);
        peak = Math.max(peak, slots.length);
        if (r !== 'ok') return { result: r, peak };
    }
    return { result: 'stuck', peak };
}

/**
 * 照清序点（可解性的**构造证明**）。返回 { result, peak }。
 *
 * 为什么它能证明"有解"：`level.so` 是生成器用 `verify_clear()` 验证过的合法清序
 *   （每一步点到的牌在几何上都可点）。我们让玩家严格按它点；
 *   只要槽位不溢出、且最终清空，就说明这一档**确实存在一条通关路线**。
 */
function playFollowSo(level) {
    const board = makeBoard(level);
    const so = peelOrder(level);
    const slots = [];
    let peak = 0;
    for (const i of so) {
        const r = push(board, slots, i);
        peak = Math.max(peak, slots.length);
        if (r !== 'ok') return { result: r, peak };
    }
    return { result: board.remaining === 0 && slots.length === 0 ? 'win' : 'stuck', peak };
}

/**
 * 开局"可点牌里能凑出的完整组数"。★ 第 62 轮拆成两项：
 *   · `peng` = Σ ⌊同面张数 / 3⌋（老口径，纯碰）
 *   · `chi`  = 存在同花色连续三号（各 ≥1 张）的起点个数 —— 注意这是**上界**
 *              （多个起点会共用同一张牌，真实可凑数更少），只作观测不做判据。
 */
function openGroups(board) {
    const faces = board.pickable().map((i) => board.tiles[i].face);
    const cnt = new Map();
    for (const f of faces) cnt.set(f, (cnt.get(f) ?? 0) + 1);
    let peng = 0;
    for (const v of cnt.values()) peng += Math.floor(v / 3);
    let chi = 0;
    for (let suit = 0; suit < 3; suit++) {
        const has = new Set();
        for (const f of faces) if (suitOf(f) === suit) has.add(numOf(f));
        for (let s = 1; s <= 7; s++) if (has.has(s) && has.has(s + 1) && has.has(s + 2)) chi++;
    }
    return { peng, chi };
}

/** 在给定块大小 + 种子下评估 30 关 */
function runOnce(block, seed) {
    DIFF.BLOCK = block;
    DIFF.SEED = seed;
    DIFF.PER_LEVEL = {};
    let blind = 0, aware = 0, soOk = 0, peng = 0, chi = 0, intact = 0, legal = 0, peak = 0;
    const blindFails = [];
    for (const L of LEVELS) {
        const b = makeBoard(L);
        const faces = b.tiles.map((t) => t.face);
        const og = openGroups(b);
        peng += og.peng; chi += og.chi;
        intact += tripleIntactRate(faces, rankOf(L));
        legal += legalGroupRate(faces, rankOf(L));
        if (play(L, 'blind').result === 'win') blind++; else blindFails.push(L.lv);
        if (play(L, 'aware').result === 'win') aware++;
        const f = playFollowSo(L);
        if (f.result === 'win') soOk++;
        peak = Math.max(peak, f.peak);
    }
    const n = LEVELS.length;
    return {
        blind, aware, soOk, peak,
        openPeng: peng / n, openChi: chi / n,
        intact: intact / n, legal: legal / n,
        blindFails,
    };
}

/** 多seed取均值 */
function runAt(block) {
    let blind = 0, aware = 0, soOk = 0, peng = 0, chi = 0, intact = 0, legal = 0, peak = 0;
    const fails = new Set();
    for (const s of SEEDS) {
        const r = runOnce(block, s);
        blind += r.blind; aware += r.aware; soOk += r.soOk;
        peng += r.openPeng; chi += r.openChi; intact += r.intact; legal += r.legal;
        peak = Math.max(peak, r.peak);
        r.blindFails.forEach((lv) => fails.add(lv));
    }
    const k = SEEDS.length, n = LEVELS.length;
    return {
        block,
        blind: blind / k, aware: aware / k, soOk: soOk / k,
        openPeng: peng / k, openChi: chi / k,
        intact: intact / k, legal: legal / k,
        peak, blindFailRate: fails.size / n,
    };
}

// ════════════════════════════════════════════════════════════
console.log('\n════════ 第 46 轮需求⑥ · 难度参数标定 ════════');
console.log(`槽位上限 ${SLOT_MAX} · 关卡数 ${LEVELS.length} · 每档 ${SEEDS.length} 个种子取均值\n`);

let pass = 0, fail = 0;
const judge = (ok, msg) => {
    if (ok) { pass++; console.log(`  [v] ${msg}`); }
    else { fail++; console.log(`  [x] ${msg}`); }
};

const f1 = (x) => x.toFixed(1).padStart(4);

// ── A / A2. 自检与对照组 ───────────────────────────────────
//
// ★ 第 62 轮改判据（**旧判据已失效，不能留着**）：
//   旧 [A] 判的是「无脑 ≥ 27/30」+「同组连续度 > 99%」。这两条都是**纯碰时代**的口径：
//     · 生成器现在按用户拍板把约 30% 的组填成「吃」（同花色连号三张，本就不同面）
//       ⇒ "同组同面"天然掉到 ~72%，**它不再是"链路对不对"的判据**；
//     · 「吃」让每种牌面的总张数不再是 3 的倍数 ⇒ 跨块残牌凑不齐，
//       "无脑"（≈ 顺着剥离序走）从 29.0 掉到 21.0 —— 那是**难度变了**，不是代理坏了。
//   新 [A] 直接判**真正的不变量**：
//     ① 清序每连续 3 张都构成一个合法可消组（口径 = 产品判定 `MatchRule.findMatch`）；
//     ② 关卡表原样时"照清序"必然 30/30（生成器的可解性构造）。
//   这两条同时成立才说明 `so` 名次正确 ⇒ 置换没有空转。
console.log('[A] 自检：BLOCK = 3（关卡表原样）');
const g0 = runAt(3);
judge(g0.legal > 0.999,
    `「合法可消组率」= ${(g0.legal * 100).toFixed(1)}%（期望 = 100%）`
    + ` —— 清序上每连续 3 张都构成一个合法可消组（碰 or 吃）`
    + `；不成立即"内嵌的 so 名次错了 ⇒ 置换在空转"`);
judge(g0.soOk >= LEVELS.length - 1e-9,
    `关卡表原样时「照清序」${f1(g0.soOk)}/30 全过 —— 生成器的可解性构造仍然成立`);
console.log(`      （参考量 · 非判据：无脑 ${f1(g0.blind)}/30 · 同面组占比 ${(g0.intact * 100).toFixed(1)}%）`);

console.log('\n[A2] 内嵌 `level.so` 的不变量（独立复算）');
let permOk = true, legalOk = true, legalAt = '';
for (const L of LEVELS) {
    const so = peelOrder(L);
    if (so.length !== L.n || new Set(so).size !== L.n) permOk = false;
    const r = replaySoIsLegal(L);
    if (!r.ok) { legalOk = false; legalAt += ` L${L.lv}@${r.at}`; }
}
judge(permOk, '`so` 是 0..n-1 的排列（30 关）');
judge(legalOk, '照 `so` 逐步回放：每一步点到的牌在**运行期几何模型**下都真的可点'
    + `（0.18 口径 · 30 关 · 0 例外${legalAt}）`);

// ── F. ★ 代理公平性自检（第 62 轮新增）─────────────────────
//
// 为什么必须有这条：`pickAware` 第 62 轮加了「吃」的启发式（连号搭子）。若这个启发式
// 在**没有吃的关**也参与排序，它会抢走本该优先的同面牌 ⇒ 代理失真、数字不可信。
// 判据：凡"本关牌面里真的没有吃"的关，新旧两版代理必须**逐关给出同样的结果**。
console.log('\n[F] 代理公平性：懂吃的「会看牌」在**没有吃的关**必须与只懂碰的那版逐关一致');
DIFF.BLOCK = 3; DIFF.SEED = 0; DIFF.PER_LEVEL = {};
let sameN = 0, totN = 0, mismatch = '';
for (const L of LEVELS) {
    if (hasChiChance(L.f)) continue;
    totN++;
    const a = play(L, 'awarePeng').result;
    const b = play(L, 'aware').result;
    if (a === b) sameN++; else mismatch += ` L${L.lv}(${a}/${b})`;
}
judge(totN > 0 && sameN === totN,
    `无吃关 ${sameN}/${totN} 关结果一致${mismatch} —— 吃启发式只在真有吃的关生效`);

// ── B. 块大小 ↔ 通关率 ─────────────────────────────────────
console.log('\n[B] 块大小 ↔ 通关率（每档多 seed 取均值）');
const BS = [3, 4, 6, 8, 10, 12, 16];
const rows = BS.map(runAt);
console.log('  ┌────────┬──────────────┬──────────────┬──────────────┬────────────┬──────────────┐');
console.log('  │ BLOCK  │ 无脑通关均值  │ 会看牌均值    │ 照清序(可解) │ 槽内峰值   │ 合法组率     │');
console.log('  ├────────┼──────────────┼──────────────┼──────────────┼────────────┼──────────────┤');
for (const r of rows) {
    console.log('  │  ' + String(r.block).padEnd(5)
        + ' │  ' + `${f1(r.blind)}/30`.padEnd(12)
        + ' │  ' + `${f1(r.aware)}/30`.padEnd(12)
        + ' │  ' + `${f1(r.soOk)}/30`.padEnd(12)
        + ' │  ' + String(r.peak).padEnd(9)
        + ' │  ' + `${(r.legal * 100).toFixed(1)}%`.padEnd(12) + ' │');
}
console.log('  └────────┴──────────────┴──────────────┴──────────────┴────────────┴──────────────┘');
console.log('  （"合法组率" = 清序上每 3 张构成合法可消组的比例：BLOCK=3 时 100%，档位越大越散）');
console.log('  （"会看牌"是**纯碰时代标定的代理**，混合牌面下会低估玩家 —— 公平读数见 tools/_r62-proxy-lab.mjs）');

judge(rows[0].blind - rows[rows.length - 1].blind >= 15,
    `难度确实在涨：「无脑」均值 ${f1(rows[0].blind)} → ${f1(rows[rows.length - 1].blind)}`
    + `（差 ${(rows[0].blind - rows[rows.length - 1].blind).toFixed(1)} 关）`);
judge(rows[0].legal - rows[rows.length - 1].legal > 0.5,
    `「合法组率」被打散（${(rows[0].legal * 100).toFixed(1)}%`
    + ` → ${(rows[rows.length - 1].legal * 100).toFixed(1)}%）—— 置换真的在换面`);

// ── E. 可解性：构造证明还剩多少 ────────────────────────────
//
// ★ 第 62 轮重写。旧判据是「BLOCK ≤ 6 ⇒ 照清序 30/30」，那是**纯碰**的结论；
//   加「吃」之后它**不再成立**（实测 4→25.8 · 6→26.2），所以不能继续挂着当期望值。
//   现在只保留一条**必然成立**的构造性保证，以及"提档就牺牲保证"这条事实判据。
console.log('\n[E] 可解性的构造性证明（照清序点）');
for (const r of rows) {
    console.log(`  BLOCK ${String(r.block).padStart(2)}：照清序通关 ${f1(r.soOk)}/30 · 槽内峰值 ${r.peak}`
        + (r.soOk >= LEVELS.length - 1e-9 ? '   ← 可解得证（30/30）' : ''));
}
judge(rows[0].soOk >= LEVELS.length - 1e-9,
    `BLOCK = 3（关卡表原样）：照清序 ${f1(rows[0].soOk)}/30 ⇒ **30 关全部有解，且被构造性证明**`);
judge(rows.some((r) => r.block > 3 && r.soOk < LEVELS.length - 1e-9),
    `BLOCK > 3 之后"可解"不再有保证（实测 ${rows.filter((r) => r.block > 3)
        .map((r) => `${r.block}:${f1(r.soOk)}`).join(' ')}）`
    + ` —— 加「吃」之后这一代价比纯碰时代重得多；这是**用户拍板接受的取舍**`);

// ── C. 置换的硬约束 ────────────────────────────────────────
console.log('\n[C] 置换的硬约束（30 关 · 块大小拉满）');
let multisetOk = true, geomOk = true;
for (const L of LEVELS) {
    const f = diffuseFaces(L.f, rankOf(L), 16, 12345);
    const a = [...L.f].sort((x, y) => x - y).join(',');
    const b = [...f].sort((x, y) => x - y).join(',');
    if (a !== b) multisetOk = false;
    const bb = makeBoard(L);
    for (let i = 0; i < L.n; i++) {
        if (bb.tiles[i].x !== L.t[i * 4] / 1000 || bb.tiles[i].z !== L.t[i * 4 + 2]) geomOk = false;
    }
}
judge(multisetOk, '牌面多重集逐张守恒（置换不改变"每种牌面几张"）');
judge(geomOk, '几何（x / z）逐张一致（置换只换面、不动位置）');

// ── D. 当前 CFG 档位的落点 ─────────────────────────────────
//
// ★ 第 62 轮重写。原来的三条判据（"未越过破坏线 ≤8" / "照清序 ≥ 该档最低要求" /
//   "会看牌 ≥ 24"）**全部建立在纯碰时代的标定值上**，加「吃」之后必须重立：
//     · 「照清序」在 8 档只剩 17.7/30 —— 用户拍板**接受**这个取舍（先按原话选 10，
//       看到 10 档只有 13.3/30 的数据后改回 8），所以它不能再当"必须 ≥29"的红线，只作记录。
//     · 「会看牌」这个代理已经失真（混合牌面下、BLOCK=3 原样牌面时它 8.0/30，
//       反而低于"无脑"21.0/30）⇒ 拿它当"普通玩家下限"会误判玩家真实难度。
//       公平读数改由 `tools/_r62-proxy-lab.mjs` 的「保守看牌」提供。
//   所以 [D] 现在只留**两条真判据**：
//     ① 档位必须与拍板记录一致 —— 这是"回需求真源"，不是"现状即期望"；
//     ② 当前档位确实比"原样"难得多（无脑显著下降）。
/** ★ 拍板记录：第 62 轮用户最终选定（先按原话 10 → 实测后改回 8）。改动这里 = 改产品决定。 */
const ACCEPTED_BLOCK = 8;

console.log('\n[D] 当前 CFG.DIFF 的落点');
DIFF.BLOCK = CFG_BLOCK;                 // 还原成配置值（见 CFG_BLOCK 的注释）
DIFF.ENABLED = CFG_ENABLED;
DIFF.PER_LEVEL = CFG_PER_LEVEL;
DIFF.SEED = 0;
const cur = runAt(CFG_BLOCK);
DIFF.SEED = 0;
console.log(`  CFG.DIFF.BLOCK = ${CFG_BLOCK}（拍板记录 ${ACCEPTED_BLOCK}`
    + ` · PER_LEVEL 覆盖 ${Object.keys(CFG_PER_LEVEL).length} 关 · 全局开关 ${CFG_ENABLED}）`);
console.log(`  无脑 ${f1(cur.blind)}/30 · 会看牌(纯碰口径·参考) ${f1(cur.aware)}/30`
    + ` · 照清序 ${f1(cur.soOk)}/30 · 槽内峰值 ${cur.peak} · 合法组率 ${(cur.legal * 100).toFixed(1)}%`);
console.log(`  ⚠ 记录（非判据）：此档"照清序"${f1(cur.soOk)}/30 ⇒ 约 `
    + `${30 - Math.round(cur.soOk)} 关失去"必有解"的构造性证明，按用户第 62 轮拍板接受。`);
console.log('     嫌难请调 PER_LEVEL（可逐关）或 BLOCK；公平难度读数见 tools/_r62-proxy-lab.mjs');
judge(cur.block === ACCEPTED_BLOCK,
    `当前档位与拍板记录一致（BLOCK ${cur.block} === ${ACCEPTED_BLOCK}）—— 档位不许乱调`);
judge(cur.blind <= LEVELS.length * 0.55,
    `当前档位下「无脑」不再稳过（${f1(cur.blind)}/30 ≤ 16.5）—— 玩家得动脑子了`);

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail ? 1 : 0);
