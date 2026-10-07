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
 *     这正是"太简单"的定义 —— 不动脑子也能过。
 *   · aware（会看牌）：优先点"点下去立刻成组"的牌，其次点"能和槽里已有的凑上"的牌。
 *     这是普通玩家的**下限**（贪心，随时可能走进死路）。
 *   · followSo（照清序）：严格按 `level.so` 点 —— 生成器保证这条顺序几何上合法。
 *     它**不是**给玩家用的策略，而是**可解性的构造证明**：
 *     只要它能 30/30 通关，就说明"这一档仍然有解"，与 aware 通不通无关。
 *
 * ── 判据设计（★ 别用"现状即期望"那套）──────────────────────
 *   A. `BLOCK = 3` 时 **blind 必须 ≥ 27/30**（复现"难度太低"这个现状）；
 *      不成立 ⇒ 说明代理模型写错了（而不是"游戏不难"），先修模型再谈别的。
 *   A2. 对照组：`BLOCK = 3` 时「同组连续度」必须 **≈ 100%** ——
 *      它同时证明了内嵌的 `level.so` 就是生成器那条清序。名次错则置换空转。
 *   B. 每个块大小跑 **多个种子取均值**（单种子只是运气；
 *      "随块大小单调"是错的判据 —— 不同块大小是不同的随机排列，天然有噪声）。
 *   E. ★ **可解性构造证明**：`BLOCK ≤ 槽位上限` 时 `followSo` 必须 **30/30**
 *      且槽内峰值 ≤ 槽位上限。这是"块内置换不牺牲可解性"这条设计主张的**直接验证**。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r46-diff-verify.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { makeBoard, peelOrder, replaySoIsLegal } from './_core/Board.ts';
import { PLAY, DIFF } from './_core/CFG.ts';
import { findMatch, wouldMatch } from './_core/MatchRule.ts';
import { tripleIntactRate, diffuseFaces } from './_core/Difficulty.ts';

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

/** 会看牌：① 能立刻成组就成 ② 否则优先"与槽内已有同面张数最多"的 ③ 都没有 → 无脑那套 */
function pickAware(board, cands, slots) {
    const faces = slots.map((i) => board.tiles[i].face);
    for (const i of cands) if (wouldMatch(faces, board.tiles[i].face)) return i;
    let best = -1, bestScore = -1;
    for (const i of cands) {
        const f = board.tiles[i].face;
        const score = faces.filter((x) => x === f).length;
        if (score > bestScore
            || (score === bestScore && best >= 0 && board.tiles[i].z > board.tiles[best].z)) {
            best = i; bestScore = score;
        }
    }
    return best >= 0 ? best : pickBlind(board, cands);
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

/** 跑一局贪心代理；返回 { result, peak } */
function play(level, strategy) {
    const board = makeBoard(level);
    const slots = [];
    let peak = 0;
    const maxSteps = level.n * 4 + 64;
    for (let step = 0; step < maxSteps; step++) {
        if (board.remaining === 0) return { result: slots.length === 0 ? 'win' : 'stuck', peak };
        const cands = board.pickable();
        if (cands.length === 0) return { result: 'noCandidates', peak };
        const i = strategy === 'blind' ? pickBlind(board, cands) : pickAware(board, cands, slots);
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

/** 开局"可点牌里能凑出的完整组数"（碰口径：同面张数 // 3 求和） */
function openTriples(board) {
    const cnt = new Map();
    for (const i of board.pickable()) {
        const f = board.tiles[i].face;
        cnt.set(f, (cnt.get(f) ?? 0) + 1);
    }
    let g = 0;
    for (const v of cnt.values()) g += Math.floor(v / 3);
    return g;
}

/** 在给定块大小 + 种子下评估 30 关 */
function runOnce(block, seed) {
    DIFF.BLOCK = block;
    DIFF.SEED = seed;
    DIFF.PER_LEVEL = {};
    let blind = 0, aware = 0, soOk = 0, tri = 0, intact = 0, peak = 0;
    const blindFails = [];
    for (const L of LEVELS) {
        const b = makeBoard(L);
        tri += openTriples(b);
        intact += tripleIntactRate(b.tiles.map((t) => t.face), rankOf(L));
        if (play(L, 'blind').result === 'win') blind++; else blindFails.push(L.lv);
        if (play(L, 'aware').result === 'win') aware++;
        const f = playFollowSo(L);
        if (f.result === 'win') soOk++;
        peak = Math.max(peak, f.peak);
    }
    const n = LEVELS.length;
    return { blind, aware, soOk, openTri: tri / n, intact: intact / n, peak, blindFails };
}

/** 多seed取均值 */
function runAt(block) {
    let blind = 0, aware = 0, soOk = 0, tri = 0, intact = 0, peak = 0;
    const fails = new Set();
    for (const s of SEEDS) {
        const r = runOnce(block, s);
        blind += r.blind; aware += r.aware; soOk += r.soOk;
        tri += r.openTri; intact += r.intact;
        peak = Math.max(peak, r.peak);
        r.blindFails.forEach((lv) => fails.add(lv));
    }
    const k = SEEDS.length, n = LEVELS.length;
    return {
        block,
        blind: blind / k, aware: aware / k, soOk: soOk / k,
        openTri: tri / k, intact: intact / k, peak,
        blindFailRate: fails.size / n,
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

// ── A / A2. 自检与对照组 ───────────────────────────────────
console.log('[A] 自检：BLOCK = 3（关卡表原样）');
const g0 = runAt(3);
judge(g0.blind >= LEVELS.length * 0.9,
    `「无脑」通关率 = ${g0.blind.toFixed(1)}/${LEVELS.length}（期望 ≥ 27）`
    + ` —— 不成立说明代理模型写错了，而不是"游戏不难"`);
judge(g0.intact > 0.99,
    `「同组连续度」= ${(g0.intact * 100).toFixed(1)}%（期望 >99%）`
    + ` —— 同时证明内嵌的 so 就是生成器那条清序（名次错了置换就是空转）`);

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

// ── B. 块大小 ↔ 通关率 ─────────────────────────────────────
console.log('\n[B] 块大小 ↔ 通关率（每档多 seed 取均值）');
const BS = [3, 4, 5, 6, 7, 8, 10, 12, 16];
const rows = BS.map(runAt);
const f1 = (x) => x.toFixed(1).padStart(4);
console.log('  ┌────────┬──────────────┬──────────────┬──────────────┬────────────┬──────────────┐');
console.log('  │ BLOCK  │ 无脑通关均值  │ 会看牌均值    │ 照清序(可解) │ 槽内峰值   │ 同组连续度   │');
console.log('  ├────────┼──────────────┼──────────────┼──────────────┼────────────┼──────────────┤');
for (const r of rows) {
    console.log('  │  ' + String(r.block).padEnd(5)
        + ' │  ' + `${f1(r.blind)}/30`.padEnd(12)
        + ' │  ' + `${f1(r.aware)}/30`.padEnd(12)
        + ' │  ' + `${f1(r.soOk)}/30`.padEnd(12)
        + ' │  ' + String(r.peak).padEnd(9)
        + ' │  ' + `${(r.intact * 100).toFixed(1)}%`.padEnd(12) + ' │');
}
console.log('  └────────┴──────────────┴──────────────┴──────────────┴────────────┴──────────────┘');

judge(rows[0].blind - rows[rows.length - 1].blind >= 15,
    `难度确实在涨：「无脑」均值 ${f1(rows[0].blind)} → ${f1(rows[rows.length - 1].blind)}`
    + `（差 ${(rows[0].blind - rows[rows.length - 1].blind).toFixed(1)} 关）`);
judge(rows[0].intact - rows[rows.length - 1].intact > 0.9,
    `「同组连续度」被打散（${(rows[0].intact * 100).toFixed(1)}%`
    + ` → ${(rows[rows.length - 1].intact * 100).toFixed(1)}%）`);

// ── E. ★ 可解性构造证明 ────────────────────────────────────
console.log('\n[E] ★ 可解性构造证明（照清序点）');
// ★ 安全上界**实测为 6**，不是理论推导的 SLOT_MAX(8)：见下方注释。
const SAFE_BLOCK = 6;
for (const r of rows) {
    console.log(`  BLOCK ${String(r.block).padStart(2)}：照清序通关 ${f1(r.soOk)}/30 · 槽内峰值 ${r.peak}`
        + (r.soOk >= LEVELS.length - 1e-9 ? '   ← 可解得证' : ''));
}
const safe = rows.filter((r) => r.block <= SAFE_BLOCK);
judge(safe.every((r) => r.soOk >= LEVELS.length - 1e-9),
    `BLOCK ≤ ${SAFE_BLOCK} 的各档：照清序**全部 30/30 通关**`
    + ` ⇒ 这些档位下"有解"是被构造性证明的，而不是靠感觉`);
judge(safe.every((r) => r.peak < SLOT_MAX),
    `BLOCK ≤ ${SAFE_BLOCK} 时槽内峰值 < ${SLOT_MAX}（留有余量）`);
// ⚠️ 这条是**实测对理论推导的修正**，值得留档：
//   理论推导说"块 ≤ SLOT_MAX 就有解"（槽里最多积压 BLOCK 张）。实测 7/8 档却是
//   29.8/29.3 —— 因为**跨块的残牌会叠加**：上一块剩下的 1~2 张会带进下一块，
//   于是峰值顶到 8 = SLOT_MAX，个别关直接溢出。⇒ 安全上界取 6（留 2 张余量）。
judge(rows.some((r) => r.block > SAFE_BLOCK && r.soOk < LEVELS.length - 1e-9),
    `超过 BLOCK ${SAFE_BLOCK} 后"可解"不再有保证（实测 ${rows
        .filter((r) => r.block > SAFE_BLOCK)
        .map((r) => `${r.block}:${f1(r.soOk)}`).join(' ')}）`);

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
// ★ 第 52 轮：用户拍板把 `CFG.DIFF.BLOCK` 由 6 调到 7。7 档的代价**正是**放弃
//   "必可解"的数学保证（照清序 30/30 → 29.8/30），所以下面对"可解性"的两条期望值
//   不能再硬编"必须是 30"，改成**按档位分级**。
//   阈值取自 2026-10-07 的拍板记录与上表标定值，**不是**从当前输出反抄的：
//     · BLOCK ≤ 6 ：照清序**必须 30/30**（构造性可解，槽内峰值 < 8，留有余量）
//     · BLOCK 7~8 ：照清序 **≥ 29/30**（实测 7→29.8 · 8→29.3；槽内峰值已顶到 8）
//     · BLOCK ≥ 9 ：可解性已被破坏（10→17.5 · 12→10.3 · 16→1.7）⇒ **不接受**
//   这样判据守的仍然是"档位不能乱调"，而不是"现状即期望"。
/** 可解性"破坏线"：越过后连照清序都过不了关 */
const SAFE_HARD = 8;
/** 该档位下"照清序"的最低可接受通关数 */
function minClearOf(block) {
    if (block <= SAFE_BLOCK) return LEVELS.length;      // 30：构造性可解
    if (block <= SAFE_HARD) return LEVELS.length - 1;   // 29：拍板接受的取舍
    return Infinity;                                    // ≥9：不接受
}

console.log('\n[D] 当前 CFG.DIFF 的落点');
DIFF.BLOCK = CFG_BLOCK;                 // 还原成配置值（见 CFG_BLOCK 的注释）
DIFF.ENABLED = CFG_ENABLED;
DIFF.PER_LEVEL = CFG_PER_LEVEL;
DIFF.SEED = 0;
const cur = runAt(CFG_BLOCK);
DIFF.SEED = 0;
console.log(`  CFG.DIFF.BLOCK = ${CFG_BLOCK}`
    + `（PER_LEVEL 覆盖 ${Object.keys(CFG_PER_LEVEL).length} 关）`);
console.log(`  无脑 ${f1(cur.blind)}/30 · 会看牌 ${f1(cur.aware)}/30 · 照清序 ${f1(cur.soOk)}/30`
    + ` · 槽内峰值 ${cur.peak} · 同组连续度 ${(cur.intact * 100).toFixed(1)}%`);
judge(cur.blind <= LEVELS.length * 0.55,
    `当前档位下「无脑」不再稳过（${f1(cur.blind)}/30 ≤ 16.5）—— 玩家得动脑子了`);
judge(cur.block <= SAFE_HARD,
    `当前档位未越过"可解性破坏线"（BLOCK ${cur.block} ≤ ${SAFE_HARD}）`);
judge(cur.soOk >= minClearOf(cur.block),
    `当前档位下"照清序" ${f1(cur.soOk)}/30 ≥ 该档最低要求 ${minClearOf(cur.block)}/30`
    + `（BLOCK ${cur.block}：≤6 满清 30 · 7~8 允许 29 · ≥9 不接受）`);
judge(cur.aware >= LEVELS.length * 0.8,
    `当前档位下「会看牌」贪心也能过 ${f1(cur.aware)}/30（≥ 24）—— 难度来自"要想"，不是"要运气"`);

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail ? 1 : 0);
