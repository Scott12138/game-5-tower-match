/**
 * _r46-layering-diag.mjs · 第 46 轮需求⑤「露出来的牌点不动」根因诊断
 *
 * 【要回答的问题】
 *   玩家看到的"牌明明露出来了、却是灰的、点不动"，到底是被哪一条挡住的：
 *     ① **段限制** —— 牌不在当前段（activeSeg）内 ⇒ 一律不可点（与覆盖无关）
 *     ② **覆盖阈值** —— 在段内，但累计覆盖 ≥ PLAY.COVER_TH(0.18) ⇒ 不可点
 *
 * 【口径】
 *   "视觉上露出来" = cover < VIS（默认 0.45，即被压不到一半，玩家读作"能点"）。
 *   在整局推进的每一步采样，把"露出但不可点"的牌按上面两类归因。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r46-layering-diag.mjs [VIS]
 */
import { LEVELS } from './_core/LevelData.ts';
import { Board } from './_core/Board.ts';
import { PLAY } from './_core/CFG.ts';

const VIS = Number(process.argv[2] ?? 0.45);
const TH = PLAY.COVER_TH;

console.log(`\n覆盖阈值 COVER_TH = ${TH}   ·   "算露出来"的视觉线 cover < ${VIS}\n`);
console.log('关卡  步  段  段内可点  露出却不可点(总) │ 段外 段内超阈 │ 桌上剩 此刻段内剩');
console.log('─'.repeat(84));

let sumOut = 0, sumOver = 0, sumLive = 0, sampled = 0;
const perLevel = [];

for (const L of LEVELS) {
    const b = new Board(L);
    let step = 0;
    let worst = null;                       // 本关"最让玩家困惑"的一步

    for (;;) {
        const seg = b.activeSeg;
        if (seg < 0) break;
        const sg = L.segs[seg];
        const pick = new Set(b.pickable());

        let outSeg = 0, overTh = 0;         // 两类归因
        let live = 0, segLeft = 0;
        for (const t of b.tiles) {
            if (!t.alive) continue;
            live++;
            if (t.z >= sg.lo && t.z < sg.hi) segLeft++;
            if (t.cover >= VIS) continue;   // 被压得太狠 —— 玩家不会读作"露出来"
            if (pick.has(t.id)) continue;   // 能点 —— 不是问题
            if (t.z < sg.lo || t.z >= sg.hi) outSeg++;   // ① 段外
            else overTh++;                                // ② 段内但超阈
        }
        const confuse = outSeg + overTh;
        sumOut += outSeg; sumOver += overTh; sumLive += live; sampled++;

        if (!worst || confuse > worst.confuse) {
            worst = { step, seg, outSeg, overTh, confuse, live, segLeft, pick: pick.size };
        }

        // 贪心推进：能点就点第一张（同 game-4 的模拟手法）
        const arr = b.pickable();
        if (arr.length === 0) break;        // 死锁（本关打不下去）
        b.pick(arr[0]);
        step++;
        if (step > 4000) break;
    }
    perLevel.push({ lv: L.lv, worst });
    if (L.lv <= 10 || L.lv % 5 === 0) {
        const w = worst;
        console.log(`${String(L.lv).padStart(4)} ${String(w.step).padStart(3)} ${String(w.seg).padStart(3)}`
            + `${String(w.pick).padStart(9)}${String(w.confuse).padStart(15)} │`
            + `${String(w.outSeg).padStart(5)}${String(w.overTh).padStart(9)} │`
            + `${String(w.live).padStart(7)}${String(w.segLeft).padStart(11)}`);
    }
}

console.log('─'.repeat(84));
console.log(`\n【全 30 关 · 采样的"最困惑一步"汇总】`);
console.log(`  露出却不可点  合计 ${sumOut + sumOver}`);
console.log(`    ① 段外（不在当前段，与覆盖无关）  ${sumOut}  （${((sumOut / (sumOut + sumOver)) * 100).toFixed(1)}%）`);
console.log(`    ② 段内但 cover ≥ ${TH}            ${sumOver}  （${((sumOver / (sumOut + sumOver)) * 100).toFixed(1)}%）`);

// 找全 30 关里最刺眼的那几关
const top = perLevel.map((p) => ({ lv: p.lv, c: p.worst.confuse, o: p.worst.outSeg, t: p.worst.overTh }))
    .sort((a, b) => b.c - a.c).slice(0, 6);
console.log(`\n  最刺眼的 6 关（露出却不可点的峰值）：`);
for (const p of top) console.log(`    L${p.lv}：共 ${p.c} 张（段外 ${p.o} / 段内超阈 ${p.t}）`);

// 第 9 关逐帧细看（用户截图那一关）
console.log(`\n【用户截图那一关 · 第 9 关 逐步明细（前 40 步 + 段切换处）】`);
const L9 = LEVELS[8];
{
    const b = new Board(L9);
    let step = 0, lastSeg = -1;
    for (;;) {
        const seg = b.activeSeg;
        if (seg < 0) break;
        const sg = L9.segs[seg];
        const pick = new Set(b.pickable());
        let outSeg = 0, overTh = 0, segLeft = 0, live = 0;
        for (const t of b.tiles) {
            if (!t.alive) continue;
            live++;
            if (t.z >= sg.lo && t.z < sg.hi) segLeft++;
            if (t.cover >= VIS || pick.has(t.id)) continue;
            if (t.z < sg.lo || t.z >= sg.hi) outSeg++; else overTh++;
        }
        const show = step < 40 || seg !== lastSeg;
        if (show) {
            console.log(`  步${String(step).padStart(3)}  段${seg}(z${sg.lo}~${sg.hi - 1})`
                + `  可点 ${String(pick.size).padStart(2)}  段内剩 ${String(segLeft).padStart(2)}`
                + `  桌上剩 ${String(live).padStart(3)}  露出却不可点 ${String(outSeg + overTh).padStart(2)}`
                + `（段外 ${outSeg} / 超阈 ${overTh}）`);
        }
        lastSeg = seg;
        const arr = b.pickable();
        if (!arr.length) { console.log('  ⇒ 死锁：无可点牌'); break; }
        b.pick(arr[0]);
        step++;
        if (step > 4000) break;
    }
}
