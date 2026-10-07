/**
 * check-board.mjs · 核心逻辑离线对账（不需要浏览器、不需要 Cocos）
 *
 * 【它证明什么】
 *   TS 侧的覆盖判定与关卡生成器（Python `level_design.py`）**逐字一致**。
 *   判据取自权威数据 `levels.json` 自己记录的实测值：
 *     · 每关 `nLive`   = 整关开局可点数（现行口径 cover < 0.18）
 *     · 每关 `nStrict` = 整关开局可点数（严格口径 cover == 0）
 *     · 每段 `openLive`= 该段"轮到自己时"（更上段已清空）的开局可点数
 *   三条全过 ⇒ 游戏里看到的手感与验收过的数据一致；
 *   一条不过 ⇒ 说明 TS 的几何/阈值与生成器分叉了（这是最难查的一类偏差）。
 *
 * 用法：python3 tools/sync-core.py && node --experimental-strip-types --no-warnings tools/check-board.mjs
 */
import { LEVELS } from './_core/LevelData.ts';
import { Board } from './_core/Board.ts';
import { fullDeck, inDeck, faceKey, spritePath } from './_core/TileData.ts';
import { findMatch, wouldMatch, MATCH_SIZE } from './_core/MatchRule.ts';
import { timeLimitOf, PLAY } from './_core/CFG.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(
    join(HERE, '..', '..', 'docs-verify', 'game-5', 'game-play', 'levels.json'), 'utf8'));

let pass = 0, fail = 0;
const bad = [];
function ok(cond, msg) {
    if (cond) { pass++; }
    else { fail++; bad.push(msg); console.log('  ❌ ' + msg); }
}

// ══════════ A 组 · 数据完整性 ══════════

console.log('\n══ A 组 · 关卡数据完整性 ══');
ok(LEVELS.length === 30, `关卡数应为 30，实得 ${LEVELS.length}`);

let totalTiles = 0;
for (const L of LEVELS) {
    totalTiles += L.n;
    ok(L.t.length === L.n * 4, `L${L.lv} 牌位数组长度应为 ${L.n * 4}，实得 ${L.t.length}`);
    ok(L.f.length === L.n, `L${L.lv} 牌面数组长度应为 ${L.n}，实得 ${L.f.length}`);
    ok(L.h === Math.round(L.w * 4 / 3), `L${L.lv} 长宽比应为 4/3（w=${L.w} h=${L.h}）`);
    for (const f of L.f) ok(inDeck(f), `L${L.lv} 出现库外牌面编码 ${f}`);
    // 段约束（第 32 轮第 3 条）
    let segSum = 0;
    for (const s of L.segs) {
        segSum += s.n;
        ok(s.n % MATCH_SIZE === 0, `L${L.lv} 段张数 ${s.n} 不是 3 的倍数`);
        ok(s.n <= 36, `L${L.lv} 段张数 ${s.n} 超上限 36`);
    }
    ok(segSum === L.n, `L${L.lv} 段张数和 ${segSum} ≠ 整关 ${L.n}`);
    ok(L.segs[0].hi === L.layers, `L${L.lv} 首段 hi=${L.segs[0].hi} ≠ 层数 ${L.layers}`);
    ok(L.segs[L.segs.length - 1].lo === 0, `L${L.lv} 末段 lo≠0`);
    for (let i = 1; i < L.segs.length; i++) {
        ok(L.segs[i].hi === L.segs[i - 1].lo, `L${L.lv} 段 ${i} 边界与段 ${i - 1} 不齐`);
    }
}
ok(totalTiles === 2877, `总张数应为 2877，实得 ${totalTiles}`);
console.log(`  张数合计 ${totalTiles} · 牌库 ${fullDeck().length} 种`);

// ══════════ B 组 · 覆盖判定与生成器逐关对账 ══════════
//
// ★★ 第 46 轮起**本组的期望变了**（用户拍板的需求⑤），先说清楚再断言：
//   运行期可点口径 = 只看覆盖 + `COVER_TH` **0.30**（原 0.18）+ **取消段限制**；
//   而 `levels.json` 的 `nLive` / `openLive` 是**生成期**按 0.18 + 段内算出来的。
//   ⇒ 逐值相等**不可能再成立**，这是**预期内的分叉**，不是 bug。
//   （第 46 轮的正面证据在 `tools/_r46-layering-verify.mjs`，4/4 绿。）
//
//   ⚠️ 但**不能**因此把这组删掉 —— 那就把"覆盖模型坏掉"这类真回归一起放走了。
//   改成一条**方向性**断言（比"相等"更有信息量）：
//       「运行期可点数 **必须 ≥ 生成期记录值**」
//   理由：阈值抬高只会让更多牌可点；取消段限制只会放宽，不会收紧。
//   出现"更少"⇒ 覆盖/坐标真的坏了，那才是要抓的。
console.log('\n══ B 组 · 覆盖判定对账（TS vs levels.json · 方向性）══');
const detail = [];
let liveSum = 0;
let bDiff = 0, bWorse = 0;

/** B 组专用判定：只要求 `now >= ref`，并把差值记成信息（不刷屏） */
function okGe(now, ref, msg) {
    if (now === ref) { pass++; return; }
    bDiff++;
    if (now < ref) { fail++; bWorse++; bad.push(msg); console.log('  ❌ ' + msg); return; }
    pass++;
}

for (let i = 0; i < 30; i++) {
    const L = LEVELS[i];
    const ref = RAW.levels[i];
    const b = new Board(L);

    // 整关开局可点（不分段）
    const all = b.tiles.filter(t => t.alive && t.cover < PLAY.COVER_TH).length;
    const strict = b.tiles.filter(t => t.alive && t.cover <= 1e-9).length;

    okGe(all, ref.nLive, `L${L.lv} 整关可点 ${all} **少于** levels.json ${ref.nLive}（覆盖模型疑似坏了）`);
    // 「严格可点」（cover == 0）与阈值无关 ⇒ 这条仍然是**逐值相等**的真对账
    ok(strict === ref.nStrict, `L${L.lv} 严格可点 ${strict} ≠ levels.json ${ref.nStrict}`);

    // 逐段：把更上段全部清空后，本段开局可点
    for (let s = 0; s < L.segs.length; s++) {
        const bb = new Board(L);
        for (const t of bb.tiles) {
            if (t.z >= L.segs[s].hi) bb.forceRemove(t.id);   // 更上段视为已清空
        }
        const segLive = bb.pickable().length;
        // ⚠️ 对账基准必须取自**原始** levels.json（ref.segs）—— 精简结构只留 lo/hi/n，
        //    没有 openLive，写成 L.segs[s].openLive 会恒为 undefined（本脚本踩过一次）
        okGe(segLive, ref.segs[s].openLive,
            `L${L.lv} 段${s} 可点 ${segLive} **少于** levels.json ${ref.segs[s].openLive}`);
    }

    const tl = timeLimitOf(i, L.n);
    liveSum += ref.nLive;
    detail.push(`L${String(L.lv).padStart(2)} ${String(L.n).padStart(3)}张 ${L.layers}层 ${L.segs.length}段 ` +
        `可点 ${String(all).padStart(2)} 限时 ${tl ? String(tl).padStart(3) + 's' : '  — '}`);
}
console.log(`  ℹ️ 与 levels.json 有差值 ${bDiff} 处 · 其中"更少"（真回归）${bWorse} 处`);
console.log(`     差值来源 = 第 46 轮把 COVER_TH 0.18→0.30 且取消段限制（用户拍板的需求⑤）`);
console.log('  ' + detail.slice(0, 10).join('\n  '));
console.log('  …');
console.log('  ' + detail.slice(-5).join('\n  '));
console.log(`  开局可点合计 ${liveSum} 张（levels.json 汇总为 532 · 仅作参考基准）`);
ok(liveSum === 532, `开局可点合计 ${liveSum} ≠ 532`);

// ══════════ C 组 · 匹配规则 ══════════

console.log('\n══ C 组 · 匹配规则（碰 / 吃）══');
const W = 0, T = 1, O = 2;
const c = (suit, num) => suit * 10 + num;

ok(findMatch([c(W, 3), c(W, 3), c(W, 3)])?.type === 'peng', '三张同面应为碰');
ok(findMatch([c(W, 3), c(W, 4), c(W, 5)])?.type === 'chi', '同花连号应为吃');
ok(findMatch([c(W, 3), c(T, 4), c(O, 5)]) === null, '★ 跨花色不得判为吃');
ok(findMatch([c(W, 8), c(W, 9), c(W, 1)]) === null, '★ 8-9-1 不得判为吃（不循环）');
ok(findMatch([c(W, 3), c(W, 4)]) === null, '两张不够一组');
ok(findMatch([c(W, 1), c(W, 2), c(W, 3), c(W, 3)]) !== null, '四张里应能凑出一组');
// 锚点优先：最新入槽那张必须参与
const slots = [c(T, 5), c(W, 3), c(W, 4), c(W, 5)];
const m = findMatch(slots, 3);
ok(m !== null && m.indices.indexOf(3) >= 0, '★ 组合必须包含最新入槽那张');
// wouldMatch 与 findMatch 必须一致（技能血坑）
let mismatch = 0;
for (let suit = 0; suit < 3; suit++) {
    for (let a = 1; a <= 9; a++) {
        for (let b = 1; b <= 9; b++) {
            const base = [c(suit, a), c((suit + 1) % 3, b)];
            const cand = c(suit, a);
            const wm = wouldMatch(base, cand);
            const probe = base.concat([cand]);
            const fm = findMatch(probe, probe.length - 1) !== null;
            if (wm !== fm) mismatch++;
        }
    }
}
ok(mismatch === 0, `wouldMatch 与 findMatch 分叉 ${mismatch} 处`);

// ══════════ D 组 · 贴图路径 ══════════

console.log('\n══ D 组 · 贴图路径 ══');
const paths = fullDeck().map(spritePath);
ok(new Set(paths).size === 27, `27 张牌面路径应互不相同，实得 ${new Set(paths).size}`);
ok(paths.every(p => /^tiles\/(wan|tiao|tong)\/(wan|tiao|tong)[1-9]$/.test(p)),
    '路径形态应为 tiles/<suit>/<suit><num>（纯 ASCII）');
console.log('  样例：' + paths.slice(0, 3).join(' · ') + ' … ' + paths[26]);

// ══════════ 汇总 ══════════

console.log('\n' + '═'.repeat(56));
console.log(`  ${fail === 0 ? '✅ 全部通过' : '❌ 有失败'} —— 通过 ${pass} / 共 ${pass + fail}`);
if (fail) { console.log('  失败项：'); bad.slice(0, 20).forEach(m => console.log('    · ' + m)); }
console.log('═'.repeat(56));
process.exit(fail === 0 ? 0 : 1);
