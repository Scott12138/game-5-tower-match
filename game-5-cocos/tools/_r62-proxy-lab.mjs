/**
 * _r62-proxy-lab.mjs · 第 62 轮 · **代理玩家对照实验台**（离线）
 *
 * 【为什么需要它】
 *  `_r46-diff-verify.mjs` 里那个 `pickAware`（会看牌）是**为纯「碰」局面标定的**。
 *  第 62 轮把牌面组改成「碰 70% + 吃 30%」之后，它的启发式（优先"与槽内同面张数最多"）
 *  反而把玩家往死路里带 —— 实测 BLOCK = 3（**关卡表原样**）时：
 *      无脑 21.0/30 · 会看牌 8.0/30 · 照清序 30.0/30
 *  会看牌 竟然比无脑还差 ⇒ **它不再是"普通玩家下限"的公平代理**。
 *  拿一个失真代理的数字去判断"游戏难不难"，等于用错误的尺子量。
 *
 * 【本实验台做什么】在同一份真实关卡数据上，横向跑 **5 个代理**，给出一个"难度带"：
 *   · blind      —— 无脑：只挑层号最高的可点牌（≈ 顺着生成器的剥离序走）
 *   · awarePeng  —— 旧版"会看牌"（只懂碰；第 62 轮之前的代理，留作对照）
 *   · awareGreedy—— 现版"会看牌"（懂吃；但没成组机会时按"同面/连号搭子"贪心）← `_r46` 用的
 *   · awareRank  —— **保守型会看牌**：有立刻成组机会就成，否则**退回"最小清序名次"**
 *                   （即：不冒险，顺着那条已被验证可解的剥离序走）
 *   · followSo   —— 照清序（可解性的构造证明；**上界参考**）
 *
 * 读法：真实玩家介于 `blind` 与 `awareRank` 之间偏上（有全局视野、会规划）。
 *   `awareRank` 才是"认真玩但不做长程规划"的合理下限；`awareGreedy` 的数字**偏低**。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r62-proxy-lab.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { makeBoard, peelOrder } from './_core/Board.ts';
import { PLAY, DIFF } from './_core/CFG.ts';
import { findMatch, wouldMatch } from './_core/MatchRule.ts';
import { suitOf, numOf } from './_core/TileData.ts';

const SLOT_MAX = PLAY.SLOT_MAX;
const SEEDS = [1, 7, 13, 29, 101, 997];
const BLOCKS = [3, 4, 6, 8, 10];

const rankOf = (L) => {
    const rank = new Array(L.n).fill(0);
    peelOrder(L).forEach((idx, k) => { rank[idx] = k; });
    return rank;
};

function hasChiChance(faces) {
    for (let suit = 0; suit < 3; suit++) {
        const has = new Set();
        for (const f of faces) if (suitOf(f) === suit) has.add(numOf(f));
        for (let s = 1; s <= 7; s++) if (has.has(s) && has.has(s + 1) && has.has(s + 2)) return true;
    }
    return false;
}

/** 只挑"层号最高"（同层取小 id，保证确定性） */
function highestLayer(board, cands) {
    let best = cands[0];
    for (const i of cands) {
        if (board.tiles[i].z > board.tiles[best].z) best = i;
        else if (board.tiles[i].z === board.tiles[best].z && i < best) best = i;
    }
    return best;
}

/** 清序名次最小（= 顺着生成器那条已验证可解的剥离序走） */
function smallestRank(cands, rank) {
    let best = cands[0];
    for (const i of cands) if (rank[i] < rank[best]) best = i;
    return best;
}

/**
 * 代理决策。
 * @param kind 'blind' | 'awarePeng' | 'awareGreedy' | 'awareRank'
 * @param ctx  { rank, useChi }
 */
function decide(kind, board, cands, slots, ctx) {
    if (kind === 'blind') return highestLayer(board, cands);
    const faces = slots.map((k) => board.tiles[k].face);
    // ① 能立刻成组就成（所有 aware 系共用；口径 = 产品判定本身）
    for (const i of cands) if (wouldMatch(faces, board.tiles[i].face)) return i;
    if (kind === 'awareRank') return smallestRank(cands, ctx.rank);
    if (kind === 'awarePeng') return pickBySame(board, cands, faces, false);
    return pickBySame(board, cands, faces, ctx.useChi);
}

/** 无成组机会时的贪心：同面张数为主键、同花色近号搭子为次键 */
function pickBySame(board, cands, faces, useChi) {
    let best = cands[0], bestSame = -1, bestCombo = -1;
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
                && board.tiles[i].z > board.tiles[best].z);
        if (better) { best = i; bestSame = same; bestCombo = combo; }
    }
    return best;
}

function playOne(level, kind, rank) {
    const board = makeBoard(level);
    const slots = [];
    const ctx = { rank, useChi: kind !== 'awarePeng' && hasChiChance(board.tiles.map((t) => t.face)) };
    let peak = 0;
    const maxSteps = level.n * 4 + 64;
    for (let step = 0; step < maxSteps; step++) {
        if (board.remaining === 0) return { result: slots.length === 0 ? 'win' : 'stuck', peak };
        const cands = board.pickable();
        if (cands.length === 0) return { result: 'noCandidates', peak };
        const i = decide(kind, board, cands, slots, ctx);
        if (slots.length >= SLOT_MAX) return { result: 'slotsFull', peak };
        board.pick(i);
        slots.push(i);
        const m = findMatch(slots.map((k) => board.tiles[k].face), slots.length - 1);
        if (m) {
            const gone = new Set(m.indices);
            const keep = slots.filter((_, k) => !gone.has(k));
            slots.length = 0;
            slots.push(...keep);
        }
        peak = Math.max(peak, slots.length);
    }
    return { result: 'stuck', peak };
}

/** 照清序（构造证明） */
function playSo(level) {
    const board = makeBoard(level);
    const slots = [];
    let peak = 0;
    for (const i of peelOrder(level)) {
        if (slots.length >= SLOT_MAX) return { result: 'slotsFull', peak };
        board.pick(i);
        slots.push(i);
        const m = findMatch(slots.map((k) => board.tiles[k].face), slots.length - 1);
        if (m) {
            const gone = new Set(m.indices);
            const keep = slots.filter((_, k) => !gone.has(k));
            slots.length = 0;
            slots.push(...keep);
        }
        peak = Math.max(peak, slots.length);
    }
    return { result: board.remaining === 0 && slots.length === 0 ? 'win' : 'stuck', peak };
}

const KINDS = ['blind', 'awarePeng', 'awareGreedy', 'awareRank'];

function runAt(block) {
    DIFF.BLOCK = block;
    DIFF.PER_LEVEL = {};
    const wins = Object.fromEntries(KINDS.map((k) => [k, 0]));
    let so = 0, peak = 0;
    const failSets = Object.fromEntries(KINDS.map((k) => [k, new Set()]));
    for (const s of SEEDS) {
        DIFF.SEED = s;
        for (const L of LEVELS) {
            const rank = rankOf(L);
            for (const k of KINDS) {
                if (playOne(L, k, rank).result === 'win') wins[k]++;
                else failSets[k].add(L.lv);
            }
            const r = playSo(L);
            if (r.result === 'win') so++;
            peak = Math.max(peak, r.peak);
        }
    }
    const k = SEEDS.length;
    const out = { block, peak, soOk: so / k };
    for (const kk of KINDS) {
        out[kk] = wins[kk] / k;
        out[kk + 'Fails'] = [...failSets[kk]].sort((a, b) => a - b);
    }
    return out;
}

console.log('\n════════ 第 62 轮 · 代理玩家对照实验台（真实关卡数据）════════');
console.log(`槽位上限 ${SLOT_MAX} · 关卡 30 · 每档 ${SEEDS.length} 种子取均值`);
console.log('代理：无脑 / 旧会看牌(只碰) / 新会看牌(贪心·_r46在用) / 保守会看牌(退回清序) / 照清序\n');

const rows = BLOCKS.map(runAt);
const f1 = (x) => x.toFixed(1).padStart(4);
console.log('  ┌────────┬────────┬────────────┬────────────┬────────────┬────────────┐');
console.log('  │ BLOCK  │ 无脑   │ 旧会看牌   │ 新会看牌   │ 保守看牌   │ 照清序     │');
console.log('  ├────────┼────────┼────────────┼────────────┼────────────┼────────────┤');
for (const r of rows) {
    console.log('  │  ' + String(r.block).padEnd(5)
        + ' │  ' + `${f1(r.blind)}/30`.padEnd(6)
        + ' │  ' + `${f1(r.awarePeng)}/30`.padEnd(10)
        + ' │  ' + `${f1(r.awareGreedy)}/30`.padEnd(10)
        + ' │  ' + `${f1(r.awareRank)}/30`.padEnd(10)
        + ' │  ' + `${f1(r.soOk)}/30`.padEnd(10) + ' │');
}
console.log('  └────────┴────────┴────────────┴────────────┴────────────┴────────────┘');

console.log('\n【公平性自检】旧会看牌 vs 新会看牌 —— 在"本关没有吃"的关（L1~L3）必须逐关一致');
DIFF.BLOCK = 3; DIFF.PER_LEVEL = {}; DIFF.SEED = 0;
let same = 0, total = 0;
for (const L of LEVELS) {
    const base = makeBoard(L);
    if (hasChiChance(base.tiles.map((t) => t.face))) continue;
    total++;
    const a = playOne(L, 'awarePeng', rankOf(L)).result;
    const b = playOne(L, 'awareGreedy', rankOf(L)).result;
    if (a === b) same++;
    else console.log(`   ✗ L${L.lv}：旧 ${a} / 新 ${b}`);
}
console.log(`   ${same}/${total} 关一致 ${same === total ? '✅（新代理在无吃局面下退化为旧代理）' : '❌'}`);

console.log('\n【BLOCK = 10 各代理打不过的关】');
const r10 = rows.find((r) => r.block === 10);
for (const k of [...KINDS, 'soOk']) {
    const v = k === 'soOk' ? r10.soOk : r10[k];
    const fs = k === 'soOk' ? [] : r10[k + 'Fails'];
    console.log(`   ${k.padEnd(12)} 通关 ${f1(v)}/30` + (fs.length ? ` · 未过 ${fs.length} 关：${fs.join(',')}` : ''));
}
console.log('\n   ⚠️ 收尾提醒：`_r46-diff-verify.mjs` 里"会看牌 ≥ 24/30"那条判据用的是');
console.log('      **新会看牌(贪心)** —— 它在混合牌面下偏低，该判据需按本表重新标定。\n');
