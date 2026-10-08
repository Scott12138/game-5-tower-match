/**
 * ============================================================
 *  _r62-mix-lab.mjs · 「碰 / 吃」混合比例实验台（离线 · 只读正式数据）
 * ============================================================
 *  【背景】用户 2026-10-08 新需求：
 *    ① 难度提升到 10（对应 `CFG.DIFF.BLOCK = 10`）
 *    ② 「目前全都是碰的组合，多增加一些吃的组合，占总组合的 30%，碰占 70%」
 *
 *  【本脚本回答三个问题】
 *    A. BLOCK = 10 到底发生了什么？（与 `_r46-diff-verify.mjs` 同一把尺子）
 *    B. 把「吃」按比例掺进牌面后，三种代理玩家的通关率怎么变？
 *    C. 「照清序点」这条可解性证明还守不守得住？槽内峰值会不会顶穿 8？
 *
 *  【为什么在内存里重建牌面，而不是改 LevelData】
 *    改正式牌面要动 Python 生成器 → levels.json → gen-level-data.py 一整条链。
 *    实验阶段只需回答"值不值得这么改"，所以这里直接借用 `level.so` 已有的
 *    「每 3 张一组」结构在内存里重填牌面 —— **不改任何正式数据**。
 *
 *  【吃 / 碰 的定义（与 MatchRule.ts 一致）】
 *    · 碰 = 三张**完全相同**
 *    · 吃 = **同一花色**里点数连着三张（n, n+1, n+2），不跨花色
 *  一组「吃」的牌面 = (suit, start) / (suit, start+1) / (suit, start+2)，start ∈ 1..7
 *
 *  用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r62-mix-lab.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { Board, peelOrder } from './_core/Board.ts';
import { PLAY } from './_core/CFG.ts';
import { findMatch, wouldMatch } from './_core/MatchRule.ts';
import { diffuseFaces } from './_core/Difficulty.ts';
import { suitOf, numOf } from './_core/TileData.ts';

const SLOT_MAX = PLAY.SLOT_MAX;
const SEEDS = [1, 7, 13, 29, 101, 997];
const SUITS = [0, 1, 2];

function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * 按比例 p 重填牌面：`so` 的每三个连续位是一组，
 * 以概率 p 填成「吃」，否则填成「碰」。
 * @returns {f, chiN, pengN}
 */
function mixFaces(L, p, seed) {
    const rnd = lcg(seed);
    const f = new Array(L.n).fill(0);
    const so = peelOrder(L);
    let chiN = 0, pengN = 0;
    for (let k = 0; k + 3 <= so.length; k += 3) {
        const g = [so[k], so[k + 1], so[k + 2]];
        if (rnd() < p) {
            const suit = SUITS[(rnd() * 3) | 0];
            const start = 1 + ((rnd() * 7) | 0);
            f[g[0]] = suit * 10 + start;
            f[g[1]] = suit * 10 + start + 1;
            f[g[2]] = suit * 10 + start + 2;
            chiN++;
        } else {
            const suit = SUITS[(rnd() * 3) | 0];
            const num = 1 + ((rnd() * 9) | 0);
            const face = suit * 10 + num;
            f[g[0]] = f[g[1]] = f[g[2]] = face;
            pengN++;
        }
    }
    return { f, chiN, pengN };
}

/** 牌面经难度置换（与 `Board.makeBoard()` 同一条路径） */
function permute(L, f, block, seed) {
    if (block <= 3) return f;
    const rank = new Array(L.n);
    peelOrder(L).forEach((idx, k) => { rank[idx] = k; });
    return diffuseFaces(f, rank, block, seed);
}

// ── 代理玩家 ────────────────────────────────────────────────

/** 无脑：完全不看牌面，只挑"层号最高"的可点牌 */
function pickBlind(board, cands) {
    let best = cands[0];
    for (const i of cands) {
        if (board.tiles[i].z > board.tiles[best].z) best = i;
        else if (board.tiles[i].z === board.tiles[best].z && i < best) best = i;
    }
    return best;
}

/** 只懂「碰」的玩家（= `_r46-diff-verify` 的原版 pickAware，用作基线） */
function pickAwarePeng(board, cands, slots) {
    const faces = slots.map((k) => board.tiles[k].face);
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

/**
 * 懂「碰 + 吃」的玩家。
 *
 * ⚠️ 两条**自检**必须同时成立，否则它就不是公平的"真实玩家"代理：
 *    ① `p = 0`（纯碰局面）时通关率必须≈ `pickAwarePeng`
 *       —— 第一版把两项加成写成同一标量（同面 +3 / 连号 +1），"4 个连号搭子(12)"
 *          会压过"2 个同面(6)"，抢走本该优先的同面牌 ⇒ 22.5 vs 28.3。改两级排序。
 *       但实测改完**数字一点没动** ⇒ 根因不在这儿。
 *    ② 第二版仍是 22.0 vs 28.0，差别来自：**「连号搭子」在纯碰局面下是纯噪声**
 *       —— 真实玩家看得见"这局没有吃"，不会去追连号。所以必须把连号启发
 *       **只在"本关真的存在吃组"时启用**（`useChi`），否则退化成纯碰策略。
 *
 * @param useChi 本关是否存在「吃」组（不存在 ⇒ 连号项完全不参与排序）
 */
function pickAwareMix(board, cands, slots, useChi) {
    const faces = slots.map((k) => board.tiles[k].face);
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

/** 公共推进：把一张牌点进槽、判成组 */
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

function play(L, faces, strategy, useChi = false) {
    const board = new Board(L, faces);
    const slots = [];
    let peak = 0;
    const maxSteps = L.n * 4 + 64;
    for (let step = 0; step < maxSteps; step++) {
        if (board.remaining === 0) return { result: slots.length === 0 ? 'win' : 'stuck', peak };
        const cands = board.pickable();
        if (cands.length === 0) return { result: 'noCandidates', peak };
        const i = strategy === 'blind' ? pickBlind(board, cands)
            : strategy === 'awarePeng' ? pickAwarePeng(board, cands, slots)
                : pickAwareMix(board, cands, slots, useChi);
        const r = push(board, slots, i);
        peak = Math.max(peak, slots.length);
        if (r !== 'ok') return { result: r, peak };
    }
    return { result: 'stuck', peak };
}

/** 照清序点 —— 可解性的构造证明（用置换后的牌面） */
function playFollowSo(L, faces) {
    const board = new Board(L, faces);
    const so = peelOrder(L);
    const slots = [];
    let peak = 0;
    for (const i of so) {
        const r = push(board, slots, i);
        peak = Math.max(peak, slots.length);
        if (r !== 'ok') return { result: r, peak };
    }
    return { result: board.remaining === 0 && slots.length === 0 ? 'win' : 'stuck', peak };
}

function runAt(p, block) {
    let blind = 0, ap = 0, am = 0, so = 0, peak = 0;
    let chi = 0, peng = 0;
    for (const seed of SEEDS) {
        for (const L of LEVELS) {
            const { f, chiN, pengN } = mixFaces(L, p, seed * 1000 + L.lv);
            chi += chiN; peng += pengN;
            const faces = permute(L, f, block, seed * 7919 + L.lv);
            const useChi = chiN > 0;
            if (play(L, faces, 'blind').result === 'win') blind++;
            if (play(L, faces, 'awarePeng').result === 'win') ap++;
            if (play(L, faces, 'awareMix', useChi).result === 'win') am++;
            const r = playFollowSo(L, faces);
            if (r.result === 'win') so++;
            peak = Math.max(peak, r.peak);
        }
    }
    const k = SEEDS.length, n = LEVELS.length;
    return {
        p, block,
        blind: blind / k, ap: ap / k, am: am / k, so: so / k, peak,
        chiRatio: chi / (chi + peng),
    };
}

// ════════════════════════════════════════════════════════════
console.log('\n════════ 第 62 轮 · 「碰 / 吃」混合比例实验台 ════════');
console.log(`槽位上限 ${SLOT_MAX} · 关卡 ${LEVELS.length} · 每档 ${SEEDS.length} 种子取均值`);
console.log('代理玩家：无脑 / 只会碰 / 会碰+吃 / 照清序(可解性下界)\n');

// ── 自检：加「吃」本身不破坏可解性 ──────────────────────────
//   `so` 的每三个连续位就是**生成器填出来的一组**（碰或吃），组本身就是合法可消组。
//   ⇒ 不置换（BLOCK = 3）时照 so 点，每组按下标依次入槽即消完，槽内峰值恒 ≤ 3。
//   这条如果不成立，说明"分组"这件事本身错了，后面所有数都不用看了。
console.log('[自检] 原始表（不置换）照 so 点 —— 逐吃比验证「组 = 合法可消组」');
{
    let allOk = true;
    for (const p of [0, 0.1, 0.2, 0.3]) {
        let ok = 0, total = 0, peak = 0;
        for (const seed of SEEDS) {
            for (const L of LEVELS) {
                const { f } = mixFaces(L, p, seed * 1000 + L.lv);
                const r = playFollowSo(L, f);
                total++;
                if (r.result === 'win') ok++;
                peak = Math.max(peak, r.peak);
            }
        }
        if (ok !== total || peak > 3) allOk = false;
        console.log(`  吃比 ${(p * 100).toFixed(0).padStart(3)}%：${ok}/${total} 局通关 · 槽内峰值 ${peak}`
            + (ok === total && peak <= 3 ? '   ← 每组都是完整可消组 ✓' : '   ← ✗ 分组结构有问题'));
    }
    console.log(allOk
        ? '  ⇒ 结论：「吃」本身**不破坏可解性** —— 可解性来自生成期的分组，与置换无关。\n'
        : '  ⇒ ⚠️ 自检未通过，下面的数不可信。\n');
}

const P_LIST = [0, 0.1, 0.2, 0.3];
const B_LIST = [4, 6, 8, 10];

const f1 = (x) => x.toFixed(1).padStart(4);
console.log('  ┌──────┬───────┬────────┬──────────┬──────────┬──────────────┬────────┬────────────┐');
console.log('  │ 吃比 │ BLOCK │ 无脑   │ 只会碰   │ 会碰+吃  │ 照清序(可解) │ 槽峰   │ 实际吃占比 │');
console.log('  ├──────┼───────┼────────┼──────────┼──────────┼──────────────┼────────┼────────────┤');
for (const block of B_LIST) {
    for (const p of P_LIST) {
        const r = runAt(p, block);
        console.log('  │ ' + `${(r.p * 100).toFixed(0)}%`.padStart(5)
            + ' │ ' + String(block).padStart(6)
            + ' │ ' + `${f1(r.blind)}/30`
            + ' │ ' + `${f1(r.ap)}/30`.padEnd(8)
            + ' │ ' + `${f1(r.am)}/30`.padEnd(8)
            + ' │ ' + `${f1(r.so)}/30`.padEnd(12)
            + ' │ ' + String(r.peak).padStart(6)
            + ' │ ' + `${(r.chiRatio * 100).toFixed(1)}%`.padEnd(10) + ' │');
    }
    console.log('  ├──────┼───────┼────────┼──────────┼──────────┼──────────────┼────────┼────────────┤');
}
console.log('  └──────┴───────┴────────┴──────────┴──────────┴──────────────┴────────┴────────────┘');
console.log('\n  ⚠️ 「照清序」在 BLOCK > 3 时用的是**置换后的牌面** ⇒ 它是可解性的**保守下界**，');
console.log('     不是"这关有没有解"的判决（原清序已不再对应同一组牌）。');
console.log('     它掉下去只说明"照老路子打不通了"，要判决无解需要更强的求解器。\n');
