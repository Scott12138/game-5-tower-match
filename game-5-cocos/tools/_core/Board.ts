/**
 * ============================================================
 *  Board.ts · 牌堆模型（几何 / 覆盖 / 可点 / 分段）
 * ============================================================
 *  ★★ **本文件与 `docs-verify/game-5/game-play/level_design.py` 的判定必须逐字一致。**
 *     关卡数据（LevelData.ts）是那个 Python 脚本产出的；如果这边的覆盖判定
 *     与生成时不同，就会出现"验收说开局可点 8 张、游戏里只有 5 张"这类**最难查的偏差**。
 *     所以下面每个函数的注释都标了对应的 Python 函数名，改一处必须同步改另一处。
 *
 *  ⚠️⚠️ **第 46 轮起有一处"有意分叉"**（不是遗漏，是用户拍板的设计）：
 *     · **可点判定** = 只看覆盖 `cover < PLAY.COVER_TH`，**不再要求"在当前段内"**，
 *       且 `COVER_TH` 由 0.18 抬到 **0.30**（见 `pickable()` 的注释）。
 *     · Python 侧仍按旧口径（段内 + 0.18）估算可解性 ⇒ 两边算出的"可点张数"会不同，
 *       **这是预期的**。方向是安全的：生成期保守、运行期更宽松，
 *       「生成期说这关可解」在运行期只会更容易解，不会反过来。
 *     · 因此：**不要**再拿"Python 报的开局可点数"去对账游戏里的可点数 ——
 *       该对账从第 46 轮起自动失效。要对照请跑 `tools/_r46-layering-diag.mjs`。
 *
 *  ⚠️⚠️ **第 46 轮起的第二处"有意分叉"：牌面（难度置换）**
 *     · `makeBoard()` 会按 `CFG.DIFF` 把**牌面**打散（见 `core/Difficulty.ts`），
 *       Python 侧生成的是"每 3 张一组同牌面"的原样表。
 *     · 于是"这关可解 / 开局能凑几组"这类**依赖牌面**的 Python 结论，
 *       在 `DIFF.LEVEL > 0` 时**不再适用**。要重算请跑
 *       `tools/_r46-diff-verify.mjs`（它直接复用本文件的模型）。
 *     · 几何（x/y/z/rot）**没有分叉** —— 置换只换面。
 *
 *  ⚠️ **不 import './cc.ts'** —— 离线自检（tools/check-board.mjs）要直接跑它。
 *
 *  【坐标口径】
 *    · 关卡数据里 t 的 x / y 是 **wu 单位**（牌宽倍数，原点 = 安全区中心）
 *    · 安全区（屏幕 34,326,682,682）的**中心恰好是屏幕中心 (375,667)**
 *      ⇒ 引擎坐标可**直接**换算，无需再减安全区偏移：
 *            engineX =  x * w
 *            engineY = -y * w
 *      （y 取负：关卡数据里层号越大 y 越小=越高，而引擎 y 向上为正）
 *    · 牌高恒 = w * 4/3（一关唯一 w，跨关才变 —— 第 32 轮第 5 条）
 * ============================================================
 */

import { PLAY, diffBlockOf, diffSeedOf } from './CFG.ts';
import { diffuseFaces } from './Difficulty.ts';
import { type LevelDef } from './LevelData.ts';

/** 牌高/牌宽（严格 4/3，与 level_design.py 的 TILE_AR 一致） */
export const TILE_AR = 4.0 / 3.0;

export interface Tile {
    /** 下标（= 关卡数据里的顺序，也是 pick 的入参） */
    id: number;
    /** wu 单位位置 */
    x: number;
    y: number;
    /** 层号（0 = 最底） */
    z: number;
    /** 朝向：0 竖 / 90 横 */
    rot: 0 | 90;
    /** 牌面编码 */
    face: number;
    /** 是否还在桌上 */
    alive: boolean;
    /** 当前被更高层覆盖的面积比（0~1） */
    cover: number;
}

/** AABB（wu 单位）：[x0, y0, x1, y1] */
type Box = [number, number, number, number];

function boxArea(b: Box): number {
    return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function overlap(a: Box, b: Box): number {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * wu 单位的 AABB。
 * ★ 对应 Python `tile_box()` —— 横牌 = 竖牌包围盒**旋转 90°**（边长互换、面积相等）。
 *   禁止任何非等比缩放（那就是第 32 轮用户拍板第 5 条要禁止的事）。
 */
export function tileBox(t: { x: number; y: number; rot: number }): Box {
    const hw = (t.rot === 90 ? TILE_AR : 1.0) / 2;
    const hh = (t.rot === 90 ? 1.0 : TILE_AR) / 2;
    return [t.x - hw, t.y - hh, t.x + hw, t.y + hh];
}

export interface SegView {
    /** 段序号（0 = 最先清的那段，自顶向下） */
    index: number;
    lo: number;
    hi: number;
    /** 段内总张数 */
    total: number;
    /** 段内剩余 */
    left: number;
    /** 是否正在打这一段 */
    active: boolean;
    /** 是否已清完 */
    done: boolean;
}

export class Board {
    readonly level: LevelDef;
    readonly tiles: Tile[];
    /** 单关唯一牌宽（设计 px @750） */
    readonly w: number;
    readonly h: number;

    private readonly _boxes: Box[];
    private readonly _areas: number[];
    private readonly _ov: number[];

    constructor(level: LevelDef, faces?: number[]) {
        this.level = level;
        this.w = level.w;
        this.h = level.h;

        // ⚠️ `faces` **只影响"哪张牌是什么面"**：几何（x/y/z/rot）永远来自关卡表。
        //   难度置换（core/Difficulty.ts）就是从这里插进来的，见 `makeBoard`。
        const f = faces ?? level.f;
        const n = level.n;
        const tiles: Tile[] = new Array(n);
        for (let i = 0; i < n; i++) {
            tiles[i] = {
                id: i,
                x: level.t[i * 4] / 1000,
                y: level.t[i * 4 + 1] / 1000,
                z: level.t[i * 4 + 2],
                rot: level.t[i * 4 + 3] ? 90 : 0,
                face: f[i],
                alive: true,
                cover: 0,
            };
        }
        this.tiles = tiles;

        this._boxes = tiles.map(tileBox);
        this._areas = this._boxes.map((b) => Math.max(1e-9, boxArea(b)));

        // 初始覆盖：每张牌累计"比它层号大"的牌的相交面积
        // ★ 对应 Python `cover_ratios()`
        const ov = new Array<number>(n).fill(0);
        for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) {
                if (tiles[k].z > tiles[j].z) ov[j] += overlap(this._boxes[j], this._boxes[k]);
            }
        }
        this._ov = ov;
        for (let j = 0; j < n; j++) tiles[j].cover = Math.min(1, ov[j] / this._areas[j]);
    }

    // ------------------------------------------------------------
    //  查询
    // ------------------------------------------------------------

    /** 剩余张数 */
    get remaining(): number {
        let c = 0;
        for (const t of this.tiles) if (t.alive) c++;
        return c;
    }

    get cleared(): boolean {
        return this.remaining === 0;
    }

    /**
     * 某张牌现在可点吗？
     * ★ 对应 Python `live_counts()` 的现行口径 —— 同层**不参与**判定。
     */
    pickableAt(i: number): boolean {
        const t = this.tiles[i];
        return t.alive && t.cover < PLAY.COVER_TH;
    }

    /**
     * 当前段的段号（自顶向下：segs[0] 最先清）。
     * 全清完返回 -1。
     */
    get activeSeg(): number {
        const segs = this.level.segs;
        for (let s = 0; s < segs.length; s++) {
            for (const t of this.tiles) {
                if (t.alive && t.z >= segs[s].lo && t.z < segs[s].hi) return s;
            }
        }
        return -1;
    }

    /**
     * **当前可点的牌下标**（已按牌堆绘制顺序 —— 层号从低到高，同层按下标）。
     *
     * ★★ **第 46 轮用户拍板：取消「当前段」限制。**
     *
     * 【为什么取消】旧口径要求牌既要"没被压住"、又要在 `activeSeg` 那一段里。
     *   段是**看不见的**逻辑分层 —— 玩家从画面上完全推不出"这张牌现在轮到没轮到"，
     *   于是看到的是「明明整张牌都露在外、却是灰的、点不动」。
     *   实测（`tools/_r46-layering-diag.mjs`，全 30 关逐步采样、"露出来"的口径 =
     *   被压不到一半）：露出却不可点共 **21626 张次**，其中 **14305（66.1%）是段限制**
     *   —— 而且**与覆盖面积毫无关系**（那些牌可能一张都没被压）。
     *   典型一幕（第 9 关第 28 步，正是用户截图那一刻）：段内只剩 2 张、可点 1 张，
     *   同时场上**有 16 张完全没被压住的牌**因为是下一段而统统是灰的。
     *
     * 【新口径】全桌只要 `cover < COVER_TH` 就能点 —— 可点集**只由覆盖决定**，
     *   而覆盖是**看得见**的（被压的部分就在玩家眼前）。
     *   ⇒ "看着能点就能点"这条直觉从此成立。
     *
     * ⚠️ `segs` 字段与 `activeSeg` / `segViews()` **保留**（HUD 仍要显示"第几段/共几段"，
     *   生成期也仍按段保证可解性），只是**不再参与可点判定**。
     */
    pickable(): number[] {
        const out: number[] = [];
        for (const t of this.tiles) {
            if (!t.alive) continue;
            if (t.cover < PLAY.COVER_TH) out.push(t.id);
        }
        out.sort((a, b) => (this.tiles[a].z - this.tiles[b].z) || (a - b));
        return out;
    }

    /** 严格口径可点（零覆盖）—— **只用于诊断上报**，不作设计口径 */
    strictPickable(): number[] {
        const s = this.activeSeg;
        if (s < 0) return [];
        const seg = this.level.segs[s];
        const out: number[] = [];
        for (const t of this.tiles) {
            if (!t.alive) continue;
            if (t.z < seg.lo || t.z >= seg.hi) continue;
            if (t.cover <= 1e-9) out.push(t.id);
        }
        return out;
    }

    /** 逐段视图（给 HUD 显示"第几段/共几段"用） */
    segViews(): SegView[] {
        const active = this.activeSeg;
        return this.level.segs.map((s, i) => {
            let total = 0, left = 0;
            for (const t of this.tiles) {
                if (t.z < s.lo || t.z >= s.hi) continue;
                total++;
                if (t.alive) left++;
            }
            return { index: i, lo: s.lo, hi: s.hi, total, left, active: i === active, done: left === 0 };
        });
    }

    // ------------------------------------------------------------
    //  变更
    // ------------------------------------------------------------

    /**
     * 取走一张牌，并把"它给下层让出的覆盖"扣回去。
     * ★ 对应 Python `greedy_peel()` 里的 `remove()`。
     *
     * 【为什么不整体重算】O(n²) 的整盘重算在 L30（138 张）上是每次 1.9 万次相交，
     * 点击时做会掉帧。而"移除只会降低覆盖"这条性质保证**局部更新结果与整盘重算一致**
     * （Python 侧也是这么做的，两边的增量逻辑必须同源）。
     */
    pick(i: number): boolean {
        const t = this.tiles[i];
        if (!t.alive || t.cover >= PLAY.COVER_TH) return false;
        t.alive = false;
        for (let j = 0; j < this.tiles.length; j++) {
            const o = this.tiles[j];
            if (!o.alive || o.z >= t.z) continue;
            const d = overlap(this._boxes[j], this._boxes[i]);
            if (d > 0) {
                this._ov[j] -= d;
                o.cover = Math.min(1, Math.max(0, this._ov[j] / this._areas[j]));
            }
        }
        return true;
    }

    /** 强制移除（不经可点校验）—— 只给"消除/复活"这类系统动作用 */
    forceRemove(i: number): void {
        const t = this.tiles[i];
        if (!t.alive) return;
        t.alive = false;
        for (let j = 0; j < this.tiles.length; j++) {
            const o = this.tiles[j];
            if (!o.alive || o.z >= t.z) continue;
            const d = overlap(this._boxes[j], this._boxes[i]);
            if (d > 0) {
                this._ov[j] -= d;
                o.cover = Math.min(1, Math.max(0, this._ov[j] / this._areas[j]));
            }
        }
    }

    /**
     * 洗牌：把**存活牌**的位置重排（保持层号与朝向集合不变，只换 x/y 的配对）。
     *
     * 口径：位置数组与"存活牌的 id 序"做一次确定性置换 —— 保证洗后**必然有解**
     * （牌面集合与层结构都没变，只是哪张牌占了哪个位），不会出现"洗完之后更死"。
     * ⚠️ 这与 game-4 的"影子副本先算再提交"是同一族的保护思路。
     */
    shuffle(seed: number): void {
        const alive = this.tiles.filter((t) => t.alive);
        const spots = alive.map((t) => ({ x: t.x, y: t.y, rot: t.rot }));
        // 确定性 LCG（同种子可复现 —— 无头验收靠它）
        let s = (seed >>> 0) || 1;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let i = spots.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const tmp = spots[i]; spots[i] = spots[j]; spots[j] = tmp;
        }
        for (let i = 0; i < alive.length; i++) {
            alive[i].x = spots[i].x;
            alive[i].y = spots[i].y;
            alive[i].rot = spots[i].rot as 0 | 90;
        }
        this.rebuild();
    }

    /**
     * 把一张已经取走的牌**放回桌上**（「移出」道具用）。
     *
     * 【为什么必须整盘 rebuild 而不是反向增量】
     * `pick` 的局部扣减建立在"移除只会降低覆盖"这条性质上；**放回去是反方向的**，
     * 局部加回会漏掉边界情况（这张牌与其它牌的部分重叠），导致覆盖比偏小 ⇒
     * 出现"看着被压着、却能点"的穿帮。这里每次最多调一次，O(n²) 完全可接受。
     */
    restore(i: number): boolean {
        const t = this.tiles[i];
        if (!t || t.alive) return false;
        t.alive = true;
        this.rebuild();
        return true;
    }

    /** 全盘重算覆盖（洗牌 / 位置变更后必须调一次） */
    rebuild(): void {
        const n = this.tiles.length;
        for (let i = 0; i < n; i++) this._boxes[i] = tileBox(this.tiles[i]);
        this._ov.fill(0);
        for (let j = 0; j < n; j++) {
            const tj = this.tiles[j];
            if (!tj.alive) { tj.cover = 0; continue; }
            let ov = 0;
            for (let k = 0; k < n; k++) {
                const tk = this.tiles[k];
                if (!tk.alive || tk.z <= tj.z) continue;
                ov += overlap(this._boxes[j], this._boxes[k]);
            }
            this._ov[j] = ov;
            tj.cover = Math.min(1, ov / this._areas[j]);
        }
    }

    // ------------------------------------------------------------
    //  坐标换算（唯一口）
    // ------------------------------------------------------------

    /** 引擎坐标 X（见文件头推导：安全区中心 == 屏幕中心） */
    engineX(t: { x: number }): number {
        return t.x * this.w;
    }

    /** 引擎坐标 Y（取负：关卡数据里 y 向下为负，引擎 y 向上为正） */
    engineY(t: { y: number }): number {
        return -t.y * this.w;
    }
}

/**
 * 生成期口径的可点阈值。
 *
 * ⚠️ **刻意与运行期的 `PLAY.COVER_TH`（0.30）不同**。本函数唯一用途是"还原生成器
 *   填牌面时用的那条清序"，而 `level_design.py` 里 `COVER_TH = 0.18`。
 *   用运行期阈值算出来的名次**与生成器不一致**（实测"同组连续度"只有 25%，
 *   而正确答案应接近 100%）⇒ 置换就换不到真正的"那一组"上，难度旋钮直接失效。
 *   ⚠️ 本常量**只服务 `peelOrder()`**，不参与任何可点判定。
 */
const GEN_COVER_TH = 0.18;

/**
 * ★ 第 46 轮：**清序** —— 关卡生成器填牌面时用的那条"顺手打"的顺序。
 *
 * 【真源 = 关卡数据自带的 `level.so`】它是 `level_design.py` 里
 *   `order = greedy_peel(tiles, open_first=3*G_open, phases=segs)` 的原样输出，
 *   已随 `LevelData.ts` 内嵌（见 `tools/gen-level-data.py`）。
 *
 * 【为什么不在 TS 里重算】试过，**不行**：照着重写一遍 `greedy_peel`（分段相位 +
 *   0.18 口径）得到的顺序与原序**逐位不同** —— 用重算的名次算"同组连续度"只有
 *   **23%**，而真值应是 **100%**。名次一错，难度置换就换不到真正的"那一组"上
 *   （**旋钮失效且完全不报错**，正是最坏的一类故障）。
 *   ⇒ 直接内嵌真值，零漂移。
 *
 * 【不变量（离线可断言）】`so` 是 0..n-1 的排列，且 `so[3k..3k+2]` 三张牌面**必然相同**。
 *   见 `tools/_r46-diff-verify.mjs` 的 [A] 组。
 */
export function peelOrder(level: LevelDef): number[] {
    const so = level.so;
    if (so && so.length === level.n) return so.slice();
    // 数据缺字段时的兜底：**不做算法重算**（重算出来的名次是错的，见上），
    // 而是退回"按层号从高到低"（仍是合法的剥离倾向，只是置换会弱一些）。
    // ⚠️ 真机上永远不该走到这里；走到说明 `LevelData.ts` 没跟上 `gen-level-data.py`。
    if (typeof console !== 'undefined') {
        console.warn(`[Board] L${level.lv} 缺少清序 so（n=${level.n}）→ 退化按层号排序`);
    }
    const order: number[] = [];
    for (let i = 0; i < level.n; i++) order.push(i);
    order.sort((a, b) => (level.t[b * 4 + 2] - level.t[a * 4 + 2]) || (a - b));
    return order;
}

/**
 * **独立复算**：按运行期几何模型重新走一遍"贪心剥离"，用于交叉验证
 * `level.so` 确实是一条合法清序（对应生成器自己那个 `verify_clear()` 的思路）。
 *
 * ⚠️ **它的结果与 `level.so` 不会逐位相同**（生成器的相位推进无法用一套简单规则复用），
 *   所以**不要**拿它当名次用，也不要断言两者相等。它只回答一个问题：
 *   "照着 `so` 走，每一步点到的牌在几何上是否真的可点"。
 *
 * ⚠️ 复杂度 O(n²)，仅离线自检调用。**不要**放进游戏路径。
 */
export function replaySoIsLegal(level: LevelDef, th = GEN_COVER_TH): { ok: boolean; at: number } {
    const n = level.n;
    const z = (i: number): number => level.t[i * 4 + 2];
    const boxes: Box[] = new Array(n);
    const areas: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const t = {
            x: level.t[i * 4] / 1000,
            y: level.t[i * 4 + 1] / 1000,
            rot: level.t[i * 4 + 3] ? 90 : 0,
        };
        boxes[i] = tileBox(t);
        areas[i] = Math.max(1e-9, boxArea(boxes[i]));
    }
    const ov = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) if (z(k) > z(j)) ov[j] += overlap(boxes[j], boxes[k]);
    }
    const cover = new Array<number>(n);
    for (let j = 0; j < n; j++) cover[j] = Math.min(1, ov[j] / areas[j]);
    const alive = new Array<boolean>(n).fill(true);

    const so = peelOrder(level);
    for (let k = 0; k < so.length; k++) {
        const i = so[k];
        if (!alive[i]) return { ok: false, at: k };              // 重复点同一张
        if (cover[i] >= th) return { ok: false, at: k };          // 点了一张"被压住"的
        alive[i] = false;
        for (let j = 0; j < n; j++) {
            if (!alive[j] || z(j) >= z(i)) continue;
            const d = overlap(boxes[j], boxes[i]);
            if (d > 0) {
                ov[j] -= d;
                cover[j] = Math.min(1, Math.max(0, ov[j] / areas[j]));
            }
        }
    }
    return { ok: true, at: -1 };
}

/**
 * ⚠️ **不要试图"省掉 `so` 字段、运行时重算"**（第 46 轮中途试过一次，已回退）：
 *   照着重写 `greedy_peel`（分段相位 + 0.18 口径）得到的名次与原序**逐位不同**，
 *   用它算"同组连续度"只有 **23%**，而真值 **100%**。名次一错，
 *   难度置换就换不到真正的"那一组"上 —— **旋钮失效且完全不报错**。
 *   结论：清序属于"生成期算出来的事实"，只能随数据内嵌，不能在运行期近似。
 */

/** 便捷构造 */
export function makeBoard(level: LevelDef): Board {
    // ★ 第 46 轮：难度置换在这里插进来 —— **唯一入口**，
    //   于是"游戏里"和"离线自检里"拿到的是**同一副牌面**（否则难度标定就没意义了）。
    const block = diffBlockOf(level.lv);
    if (block <= 3) return new Board(level);
    const rank = new Array<number>(level.n);
    peelOrder(level).forEach((idx, k) => { rank[idx] = k; });
    const faces = diffuseFaces(level.f, rank, block, diffSeedOf(level.lv));
    return new Board(level, faces);
}
