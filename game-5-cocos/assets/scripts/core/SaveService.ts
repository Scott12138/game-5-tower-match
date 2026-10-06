/**
 * ============================================================
 *  SaveService.ts · 存档（进度 / 道具库存 / 金币）
 * ============================================================
 *  ⚠️ **不 import 'cc'** —— 离线自检要能直接跑它。
 *  存储后端用 `localStorage`（微信小游戏与浏览器都有）；读不到时**静默降级成
 *  内存态**（游戏照常能玩，只是关掉重开回第一关）—— 绝不允许因为存储不可用而白屏。
 *
 *  【口径】
 *    · `level`   = 当前关卡号（1 起）。通关后 +1，上限 30。
 *    · `best`    = 历史最高通关关卡（首页显示用）。
 *    · `inventory` = **跨局**的道具库存（商城买的 / 签到领的）。
 *      ⚠️ 与"本局限定"的赠礼道具**是两套账**：赠礼只进 `RunState`，本局结束即作废
 *      （第 13 轮拍板），永远不写进这里。
 *    · `coins`   = 金币。
 * ============================================================
 */

import { TOOL, type ToolKey } from '../CFG';

const KEY = 'game5.save.v1';
const MAX_LEVEL = 30;

export interface SaveData {
    /** 当前关卡（1 起） */
    level: number;
    /** 历史最高通关关卡（0 = 还没通过任何一关） */
    best: number;
    /** 跨局道具库存 */
    inventory: Record<ToolKey, number>;
    /** 金币 */
    coins: number;
    /** 累计游玩局数 */
    plays: number;
    /** 累计消除张数 */
    cleared: number;
    /** 上次签到日期（YYYY-MM-DD，空串 = 未签到） */
    signDate: string;
    /** 连续签到天数 */
    signStreak: number;
}

function freshInventory(): Record<ToolKey, number> {
    return { [TOOL.ERASE]: 0, [TOOL.MOVE]: 0, [TOOL.SHUFFLE]: 0, [TOOL.ADD_SLOT]: 0 };
}

function fresh(): SaveData {
    return {
        level: 1,
        best: 0,
        inventory: freshInventory(),
        coins: 0,
        plays: 0,
        cleared: 0,
        signDate: '',
        signStreak: 0,
    };
}

export class SaveService {
    private static _instance: SaveService | null = null;
    public static get instance(): SaveService {
        if (!SaveService._instance) SaveService._instance = new SaveService();
        return SaveService._instance;
    }

    private _data: SaveData = fresh();
    /** 存储是否可用（不可用时只走内存，不报错也不丢功能） */
    private _persistOk = true;

    private constructor() {
        this.load();
    }

    // --------------------------------------------------------

    /** 从存储读一次（构造时已调；GameRoot 启动时再显式读一遍，让启动日志能看到存档状态） */
    public load(): SaveData {
        try {
            const raw = globalThis.localStorage?.getItem(KEY);
            if (!raw) { this._data = fresh(); return this._data; }
            const parsed = JSON.parse(raw) as Partial<SaveData>;
            this._data = this.migrate(parsed);
        } catch (e) {
            // ⚠️ 存档损坏不能让游戏起不来：丢掉重来，并留下可查的日志
            console.warn('[SaveService] 存档读取失败，已重置：', e);
            this._data = fresh();
            this._persistOk = false;
        }
        return this._data;
    }

    /** 老版本存档补字段（比"读不出来就重置"对玩家友好得多） */
    private migrate(p: Partial<SaveData>): SaveData {
        const d = fresh();
        const n = (v: unknown, def: number): number =>
            (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? Math.floor(v) : def;

        d.level = Math.min(MAX_LEVEL, Math.max(1, n(p.level, 1)));
        d.best = Math.min(MAX_LEVEL, n(p.best, 0));
        d.coins = n(p.coins, 0);
        d.plays = n(p.plays, 0);
        d.cleared = n(p.cleared, 0);
        d.signStreak = n(p.signStreak, 0);
        d.signDate = typeof p.signDate === 'string' ? p.signDate : '';
        if (p.inventory && typeof p.inventory === 'object') {
            for (const k of Object.values(TOOL)) {
                d.inventory[k] = n((p.inventory as Record<string, unknown>)[k], 0);
            }
        }
        return d;
    }

    public save(): void {
        if (!this._persistOk) return;
        try {
            globalThis.localStorage?.setItem(KEY, JSON.stringify(this._data));
        } catch (e) {
            console.warn('[SaveService] 存档写入失败（转为内存态）：', e);
            this._persistOk = false;
        }
    }

    // --------------------------------------------------------
    //  读取
    // --------------------------------------------------------

    public get data(): SaveData { return this._data; }
    public get level(): number { return this._data.level; }
    public get best(): number { return this._data.best; }
    public get coins(): number { return this._data.coins; }

    /** 跨局库存的某个道具数量 */
    public count(tool: ToolKey): number { return this._data.inventory[tool] ?? 0; }

    public get maxLevel(): number { return MAX_LEVEL; }

    // --------------------------------------------------------
    //  写入
    // --------------------------------------------------------

    /** 通关一关：推进关卡、刷新最高纪录、发金币 */
    public onLevelClear(level: number, rewardCoins: number): void {
        if (level >= this._data.level) {
            this._data.level = Math.min(MAX_LEVEL, level + 1);
        }
        if (level > this._data.best) this._data.best = level;
        this._data.coins += Math.max(0, rewardCoins);
        this._data.cleared += 0;
        this.save();
    }

    /** 记住"这局打过"（无论胜负，用于统计） */
    public markPlayed(): void {
        this._data.plays++;
        this.save();
    }

    /** 累加消除张数 */
    public addCleared(n: number): void {
        this._data.cleared += Math.max(0, n);
        this.save();
    }

    /** 增减跨局道具库存（商城 / 签到 / 奖励用） */
    public addTool(tool: ToolKey, delta: number): void {
        this._data.inventory[tool] = Math.max(0, this.count(tool) + delta);
        this.save();
    }

    /** 消耗跨局道具（返回是否成功） */
    public useTool(tool: ToolKey): boolean {
        if (this.count(tool) <= 0) return false;
        this._data.inventory[tool]--;
        this.save();
        return true;
    }

    public addCoins(n: number): void {
        this._data.coins = Math.max(0, this._data.coins + n);
        this.save();
    }

    /** 直接跳到某关（首页的"选关"调试入口用） */
    public setLevel(lv: number): void {
        this._data.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(lv)));
        this.save();
    }

    /** 清档（设置面板用） */
    public resetAll(): void {
        this._data = fresh();
        this.save();
    }
}
