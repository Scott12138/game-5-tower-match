/**
 * ============================================================
 *  Board.ts · 牌堆模型（几何 / 覆盖 / 可点 / 分段）
 * ============================================================
 *  ★★ **本文件与 `docs-verify/game-5/game-play/level_design.py` 的判定必须逐字一致。**
 *     关卡数据（LevelData.ts）是那个 Python 脚本产出的；如果这边的覆盖判定
 *     与生成时不同，就会出现"验收说开局可点 8 张、游戏里只有 5 张"这类**最难查的偏差**。
 *     所以下面每个函数的注释都标了对应的 Python 函数名，改一处必须同步改另一处。
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

import { PLAY } from './CFG.ts';
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

    constructor(level: LevelDef) {
        this.level = level;
        this.w = level.w;
        this.h = level.h;

        const n = level.n;
        const tiles: Tile[] = new Array(n);
        for (let i = 0; i < n; i++) {
            tiles[i] = {
                id: i,
                x: level.t[i * 4] / 1000,
                y: level.t[i * 4 + 1] / 1000,
                z: level.t[i * 4 + 2],
                rot: level.t[i * 4 + 3] ? 90 : 0,
                face: level.f[i],
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
     * ⚠️ 限定在「当前段」内 —— 段是逻辑分段（全堆同时在桌，只是"轮到自己才可动"），
     *    这正是"清完上段、下段才露出来"的落地方式（第 32 轮第 3 条）。
     */
    pickable(): number[] {
        const s = this.activeSeg;
        if (s < 0) return [];
        const seg = this.level.segs[s];
        const out: number[] = [];
        for (const t of this.tiles) {
            if (!t.alive) continue;
            if (t.z < seg.lo || t.z >= seg.hi) continue;
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

/** 便捷构造 */
export function makeBoard(level: LevelDef): Board {
    return new Board(level);
}
