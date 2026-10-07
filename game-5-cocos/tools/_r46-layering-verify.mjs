/**
 * _r46-layering-verify.mjs · 第 46 轮需求⑤「分层放宽」验收（离线断言）
 *
 * 【用户拍板】方案 A —— **取消段限制**（全桌只要没被压住就能点）
 *              + 覆盖阈值 **0.18 → 0.30**。
 *
 * 【要断言的】
 *   A. `PLAY.COVER_TH === 0.30`（阈值真的改了）
 *   B. **可点集完全由覆盖决定** —— 全 30 关、逐步推进，任何时刻
 *      "存活 且 cover < COVER_TH" 的牌**必须**都在 `pickable()` 里（0 例外）。
 *      这一条同时证明了「段限制已消失」：只要有例外，就说明还有第二个过滤条件。
 *   C. **段外可点确实存在**（正例）—— 至少有一张 z 不在 activeSeg 段内的牌可点。
 *      没有这条，"B 通过"可能只是因为所有牌本来就在段内。
 *   D. **开局可点数提升**（与旧口径 `段内 + 0.18` 对比）—— 方向性复核。
 *
 * 【为什么能离线跑】`Board.ts` 不 import 'cc'（见其文件头），
 *   `tools/_core/` 是它的平铺副本，node --experimental-strip-types 直接吃 TS。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/_r46-layering-verify.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { Board } from './_core/Board.ts';
import { PLAY } from './_core/CFG.ts';

/** 旧口径的两个常量（只为对照，勿在业务代码里引用） */
const OLD_TH = 0.18;
const OLD_SEG_LIMIT = true;

let pass = 0, fail = 0;
const judge = (ok, msg) => {
    if (ok) { pass++; console.log(`  [v] ${msg}`); }
    else { fail++; console.log(`  [x] ${msg}`); }
};

console.log('\n════════ 第 46 轮需求⑤ · 分层放宽验收 ════════');

// ── A. 阈值 ────────────────────────────────────────────────
console.log('\n[A] 覆盖阈值');
judge(PLAY.COVER_TH === 0.30, `PLAY.COVER_TH = ${PLAY.COVER_TH}（期望 0.30）`);

// ── 旧口径复算器（段内 + 0.18），只为下面 D 做对照 ──────────────
function pickableOld(b) {
    const s = b.activeSeg;
    if (s < 0) return [];
    const sg = b.level.segs[s];
    const out = [];
    for (const t of b.tiles) {
        if (!t.alive) continue;
        if (t.z < sg.lo || t.z >= sg.hi) continue;
        if (t.cover < OLD_TH) out.push(t.id);
    }
    return out;
}

// ── B / C / D：全 30 关逐步推进 ──────────────────────────────
console.log('\n[B/C/D] 全 30 关逐步推进（贪心消牌）');
let violB = 0;                 // B 的违规张次
let outSegPickable = 0;        // C：段外却可点的张次
let samples = 0;
const openNew = [], openOld = [];   // 第 0 步的可点数（新 / 旧口径）

for (const L of LEVELS) {
    const b = new Board(L);
    let step = 0;
    for (;;) {
        const pick = new Set(b.pickable());
        const seg = b.activeSeg;
        const sg = seg >= 0 ? L.segs[seg] : null;

        if (step === 0) { openNew.push(pick.size); openOld.push(pickableOld(b).length); }

        for (const t of b.tiles) {
            if (!t.alive) continue;
            // B：覆盖未超阈 ⇒ 必须可点
            if (t.cover < PLAY.COVER_TH && !pick.has(t.id)) violB++;
            // C：可点 且 不在当前段
            if (sg && pick.has(t.id) && (t.z < sg.lo || t.z >= sg.hi)) outSegPickable++;
        }
        samples++;

        const arr = b.pickable();
        if (arr.length === 0) break;          // 死锁（不该发生在开局）
        b.pick(arr[0]);
        step++;
        if (step > 4000) break;
    }
}
judge(violB === 0, `可点集完全由覆盖决定：${samples} 个采样点，违规 ${violB} 张次（期望 0）`);
judge(outSegPickable > 0, `段外可点确实存在：${outSegPickable} 张次（> 0 才说明段限制真的没了）`);

const sumNew = openNew.reduce((a, c) => a + c, 0);
const sumOld = openOld.reduce((a, c) => a + c, 0);
const avgNew = sumNew / openNew.length, avgOld = sumOld / openOld.length;
judge(sumNew > sumOld,
    `开局可点总数：新口径 ${sumNew} vs 旧口径 ${sumOld}（均值 ${avgNew.toFixed(1)} vs ${avgOld.toFixed(1)}）`);

// ── 逐关打印（只打变化的） ───────────────────────────────────
console.log('\n【各关开局可点数 · 新 vs 旧】');
console.log('  关卡   新   旧   差');
let changed = 0;
LEVELS.forEach((L, i) => {
    const d = openNew[i] - openOld[i];
    if (d === 0 && changed > 12) return;
    if (i < 12 || d > 0) {
        console.log(`  L${String(L.lv).padStart(2)}  ${String(openNew[i]).padStart(4)}`
            + ` ${String(openOld[i]).padStart(4)} ${d > 0 ? '+' : ''}${String(d).padStart(4)}`);
    }
});

console.log('\n════════════════════════════════════════');
console.log(`  ${pass} 通过 · ${fail} 失败`);
console.log('════════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
