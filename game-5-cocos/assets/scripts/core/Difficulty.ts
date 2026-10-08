/**
 * ============================================================
 *  Difficulty.ts · 难度置换（★ 第 46 轮新增 · 用户需求⑥）
 * ============================================================
 *  把关卡表里"**连续三张同牌面**"的顺序结构，按难度参数**在运行期**打散。
 *
 *  ── 根因（不搞清楚这个就调不出难度）──────────────────────────
 *  关卡生成器 `level_design.py`：
 *      order = greedy_peel(tiles, ...)         # 一条"顺手打"的合法清序
 *      faces = fill_by_triples(order, seed, p) # 清序上**每 3 张一组，一组填成一个可消组**
 *  于是最优解退化成"顺着能点的往下点，点到的三张天然是一组"——
 *  玩家不用思考 ⇒ 不需要道具 ⇒ 不会有广告。这就是"难度太低"的全部原因。
 *  ⚠️ 第 62 轮起"一个可消组"不再限定为「碰」：生成器按用户拍板把约 30% 的组填成
 *     「吃」（同花色连号三张），比例沿关卡号渐进。本模块的逻辑与之无关（只按名次分块洗牌）。
 *
 *  ── 本模块做什么：**名次分块置换** ─────────────────────────
 *  1. 用 `Board.peelOrder()` 给每张牌算名次 `rank[i]`（清序上第几个被消掉）；
 *  2. 把名次按 `BLOCK` 大小切成连续块 `[0,B) [B,2B) …`；
 *  3. **只在块内部**把牌面洗一遍。
 *
 *  ── 为什么是"分块"而不是"随机两两互换"（★ 踩过的坑）────────
 *  最初写的是"在名次相距 ≥3 的两张牌之间随机互换"。实测**它是个悬崖不是旋钮**：
 *  档位才 0.15（每关约 4 次互换）就把"无脑通关率"从 29/30 砸到 **2/30** ——
 *  因为一次互换会同时破坏**两组**的完整性，而且换完的牌面在可达性上毫无保障
 *  （全局多重集守恒 ≠ 局部能凑齐）。见 `tools/_r46-diff-verify.mjs` 的存档输出。
 *
 *  ── ★★ 分块置换有一条**可证的性质**：块足够小 ⇒ **仍然保证可解** ──
 *  生成器给的 `order` 本身是合法清序。玩家若**照着 `order` 点**：
 *  在任意时刻，槽里只可能积压"当前块里还没配齐的那些牌" ⇒ 数量 ≤ `BLOCK`。
 *  而块内牌面是**块内原牌面的一个排列**，原本就是这个块的若干**完整组**
 *  （生成器保证每 3 连续位一组）⇒ **块内必然能全部清掉**。
 *  ⇒ "照清序点"是一条解 ⇒ 关卡有解。
 *
 *  ⚠️ **实测把安全上界钉在 6，而不是理论上的 8（= `PLAY.SLOT_MAX`）**：
 *     跨块的**残牌会叠加** —— 上一块配不齐时剩下的 1~2 张会带进下一块，
 *     于是槽内峰值顶到 8，个别关直接溢出。标定表实测（6 种子均值）：
 *       BLOCK 3 / 4 / 5 / 6 → 照清序 **30 / 30 / 30 / 30**
 *       BLOCK 7 / 8         → **29.8 / 29.3**（开始偶发失手）
 *       BLOCK 10 / 12 / 16  → **17.5 / 10.3 / 1.7**（可解性明显被破坏）
 *     ⇒ 建议档位 **4~6**。见 `tools/_r46-diff-verify.mjs` 的 [E] 组。
 *
 *  ⚠️ 想看**刻度**就调 `CFG.DIFF.BLOCK`（3 = 原样，越大越难）。
 *
 *  ── 三条硬约束（离线脚本逐条断言）────────────────────────
 *  ① **只换面、不动几何**：x / y / z / rot 一个都不碰 ⇒ 桌面长相、覆盖结构、
 *     "看着能点就能点"（第 46 轮刚放开的口径）完全不受影响。
 *  ② **牌面多重集逐张守恒**：块内洗牌 ⇒ 每种牌面的总张数不变 ⇒
 *     "每种牌面张数是 3 的倍数"仍然成立。难度升高的是**顺序**，不是"根本清不掉"。
 *  ③ **同参数可复现**：LCG 走种子（`CFG.diffSeedOf`），同一关每次进局结果一致 ——
 *     否则截图对账与无头验收都会随机失败。
 *
 *  ⚠️ **不 import 'cc'** —— 离线标定脚本（tools/_r46-diff-verify.mjs）要直接跑它。
 */

// 「一个合法可消组」的判定**直接复用产品代码的口径**（MatchRule.findMatch），
// 不在这里重写一遍 —— 两处分叉的表现永远是"判据悄悄失效"，不会报错。
import { findMatch } from './MatchRule';

/** 置换下限：3 = 生成器一组的长度 ⇒ 块内洗牌**退化成恒等**（完全按关卡表原样） */
export const MIN_BLOCK = 3;


/** 确定性 LCG（与 `Board.shuffle` 同一套常数，保证行为一致性） */
function lcg(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * 按块大小 `block` 置换牌面。
 *
 * @param base  关卡表原样牌面（`LevelDef.f`）
 * @param rank  `rank[i]` = 牌 i 在清序里的名次（来自 `Board.peelOrder()`）
 * @param block 块大小（≥ 3；3 = 原样。建议 ≤ `PLAY.SLOT_MAX` 以保住"可解"保证）
 * @param seed  置换种子
 * @returns **新数组**（不改 `base`）
 */
export function diffuseFaces(base: number[], rank: number[], block: number, seed: number): number[] {
    const out = base.slice();
    const n = out.length;
    if (n < 2) return out;
    const B = Math.max(MIN_BLOCK, Math.round(block));
    // 块 = 生成器一组（3）⇒ 块内洗牌是**恒等变换**（三张本来就是一个可消组）⇒ 直接原样返回
    if (B <= MIN_BLOCK) return out;

    // 名次 → 牌下标（`rank` 是排列，所以直接反查即可）
    const byRank = new Array<number>(n);
    for (let i = 0; i < n; i++) byRank[rank[i]] = i;

    const rnd = lcg(seed);
    for (let s = 0; s < n; s += B) {
        const e = Math.min(n, s + B);
        const len = e - s;
        if (len < 2) continue;
        const buf = new Array<number>(len);
        for (let k = 0; k < len; k++) buf[k] = out[byRank[s + k]];
        // Fisher–Yates
        for (let i = len - 1; i > 0; i--) {
            const j = (rnd() * (i + 1)) | 0;
            const t = buf[i]; buf[i] = buf[j]; buf[j] = t;
        }
        for (let k = 0; k < len; k++) out[byRank[s + k]] = buf[k];
    }
    return out;
}

/**
 * 置换强度自检 ①：**清序上每连续 3 张"三张全同牌面"的比例**（即「碰」的占比）。
 *
 * ⚠️ 第 62 轮起**它不再是"链路对不对"的判据** —— 生成器已按用户拍板把约 30% 的组填成
 *    「吃」（同花色连号三张，本就不同面）⇒ 关卡表原样时这个值掉到 ≈ 0.70 是**正常的**。
 *    "链路对不对"改由下面的 `legalGroupRate()` 负责（原样时必须 = 1.0）。
 *    保留本函数是为了**看配比**（碰占比）与观察置换把"同面"打散到什么程度。
 *
 * 【为什么放在产品代码里】标定脚本要拿它当对照量：只看"通关率掉了"不够。
 */
export function tripleIntactRate(faces: number[], rank: number[]): number {
    const n = Math.min(faces.length, rank.length);
    const groups = Math.floor(n / 3);
    if (groups <= 0) return 0;
    const byRank = new Array<number>(n);
    for (let i = 0; i < n; i++) byRank[rank[i]] = faces[i];
    let intact = 0;
    for (let g = 0; g < groups; g++) {
        const a = byRank[g * 3], b = byRank[g * 3 + 1], c = byRank[g * 3 + 2];
        if (a === b && b === c) intact++;
    }
    return intact / groups;
}

/**
 * 置换强度自检 ②（★ 第 62 轮新增 · **取代** `tripleIntactRate` 成为主判据）：
 * **清序上每连续 3 张构成"一个合法可消组"的比例**。
 *
 * 口径 = 产品判定本身（`MatchRule.findMatch`）：
 *   · 「碰」＝三张牌面全同；·「吃」＝同一花色里点数连着三张（不跨花色）。
 *
 * 判据：
 *   · 关卡表原样（`BLOCK = 3`）必须 **= 1.0** —— 生成器保证"每 3 张是一个可消组"。
 *     这条不成立 = `peelOrder()` 还原错了（名次不对），置换就是在空转。
 *     **它是整条链路的对照组。**
 *   · `BLOCK` 越大越接近"随手三张恰好能消"的偶然概率 ⇒ 用来量化"结构被打散多少"。
 */
export function legalGroupRate(faces: number[], rank: number[]): number {
    const n = Math.min(faces.length, rank.length);
    const groups = Math.floor(n / 3);
    if (groups <= 0) return 0;
    const byRank = new Array<number>(n);
    for (let i = 0; i < n; i++) byRank[rank[i]] = faces[i];
    let ok = 0;
    for (let g = 0; g < groups; g++) {
        const trio = [byRank[g * 3], byRank[g * 3 + 1], byRank[g * 3 + 2]];
        if (findMatch(trio, -1) !== null) ok++;
    }
    return ok / groups;
}
