/**
 * ============================================================
 *  SaveService.ts · 存档（进度 / 道具库存 / 金币）
 * ============================================================
 *  ⚠️ **不 import './cc.ts'** —— 离线自检要能直接跑它。
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

import { SIGN, TOOL, type ToolKey } from './CFG.ts';

const KEY = 'game5.save.v1';
const MAX_LEVEL = 30;

/**
 * 本地日期键 `YYYY-MM-DD`（**按本地时区**，不是 UTC）。
 *
 * ⚠️ 为什么不用 `toISOString().slice(0,10)`：那是 **UTC 日期**。
 *   深圳（UTC+8）凌晨 0~8 点之间，UTC 还停在前一天 ⇒ 玩家"今天签到/领过"
 *   会被记成昨天，跨天判定整体错一天。凡是"按玩家看到的日历天"做的事
 *   （签到、每日配额）都必须走本地日期。
 */
export function todayKey(d: Date = new Date()): string {
    const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 解析 `YYYY-MM-DD` → UTC 毫秒（只当"日期序号"用，不涉及时区换算）；非法返回 null */
function parseYmd(s: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? t : null;
}

/**
 * `b − a` 相差几个**自然日**（同为 `YYYY-MM-DD`）。
 * 任一侧非法 / 为空串 ⇒ 返回 `NaN`（调用方据此走"当作新的一天"的兜底）。
 * 用 UTC 毫秒做差 + `Math.round`，规避夏令时导致的 23/25 小时天。
 */
export function dayDiff(a: string, b: string): number {
    const ta = parseYmd(a);
    const tb = parseYmd(b);
    if (ta === null || tb === null) return NaN;
    return Math.round((tb - ta) / 86400000);
}

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
    /**
     * **本轮**已连领的格数（0..`SIGN.CYCLE`）。
     * ⚠️ 它是"七格日历画到第几格"的依据，**满一轮 / 断签都会回到起点** ——
     *   所以它**不是**给玩家看的"连签天数"，见 `signTotal`。
     */
    signStreak: number;
    /**
     * ★ **累计连签天数**（第 57 轮三新增 · 用户拍板「方案 B」）。
     *
     * 【为什么必须与 `signStreak` 分开】`signStreak` 满 7 天后回到 1，
     *   于是副标题会出现"领完第 7 天显示 7、第二天再领一下跳回 1"的观感
     *   ——玩家会读成"我的连签被打回原形了"。
     *   本字段**只增不减**：每成功领一格 +1；满 7 天**不重置**；
     *   **中间断签几天也不影响**（只统计累计天数）；清档才归零。
     */
    signTotal: number;
    /**
     * ★ 每日配额计数所属的日期（YYYY-MM-DD）。
     * ⚠️ **它本身就是"跨天清零"的开关** —— 不靠定时器、不靠启动时机：
     *   读计数时发现 `dailyDate !== 今天` 就地清零。少存一个日期键，
     *   玩家改系统时间 / 挂后台过夜都可能让计数不归零（而且不报错）。
     */
    dailyDate: string;
    /**
     * ★ 每日配额计数（key → 今日已用次数）。
     * key 形如 `shop:erase` —— **按道具分别计数**（A3 口径：每种道具 2 次/日）。
     */
    daily: Record<string, number>;
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
        signTotal: 0,
        dailyDate: '',
        daily: {},
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
        // ★ 累计连签（第 57 轮三新增）：老存档没有这个字段 ⇒ 拿 `signStreak` 当**下界**兜底。
        //   取 `max` 而不是直接补 0：老存档里"已经连签 4 天"是玩家真做到的事，
        //   补 0 会让他一开游戏就看着连签被清零（虽然不影响任何玩法，但很伤人）。
        //   ⚠️ 这只是**能推出来的最好近似** —— 满轮后 `signStreak` 已回到 1，
        //     历史真实值无从得知，所以允许它偏小，绝不允许偏大。
        d.signTotal = Math.max(n(p.signTotal, 0), d.signStreak);
        // ★ 每日配额（第 56 轮新增）：老存档没有这两个字段 ⇒ 补空；
        //   有则逐键清洗（只保留正整数，别把脏数据带进运行期）
        d.dailyDate = typeof p.dailyDate === 'string' ? p.dailyDate : '';
        if (p.daily && typeof p.daily === 'object') {
            for (const [k, v] of Object.entries(p.daily as Record<string, unknown>)) {
                const c = n(v, 0);
                if (c > 0) d.daily[k] = c;
            }
        }
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

    // --------------------------------------------------------
    //  ★ 每日配额（第 56 轮新增 · A3「每种道具 ≤2 次/日」的落地件）
    // --------------------------------------------------------
    //
    //  【为什么放在存档里，而不是内存里】
    //    玩家会「领 1 次 → 杀掉小游戏 → 重进 → 再领」。纯内存计数**当场清零**，
    //    上限形同虚设。所以必须落盘，且必须带**日期键**才能跨天自动复位。
    //
    //  【为什么每个 key 单独计数】
    //    A3 的口径是「**每种道具** 2 次/日」，不是"总共 2 次"。
    //    key 用 `shop:<道具名>`，四个键互不影响 —— 领了「消除」不会占「洗牌」的名额。

    /** 跨天即清零（惰性：读取时判一次，不依赖定时器） */
    private rollDaily(): void {
        const t = todayKey();
        if (this._data.dailyDate !== t) {
            this._data.dailyDate = t;
            this._data.daily = {};
        }
    }

    /** 今天某个配额键已用次数 */
    public dailyUsed(key: string): number {
        this.rollDaily();
        return this._data.daily[key] ?? 0;
    }

    /**
     * 今天某个配额键还剩几次。
     * ⚠️ `max <= 0` 表示**不限次数**（`CFG.AD_QUOTA.TOOL_PER_DAY = 0` 的语义），
     *   此时返回 `Infinity` —— 调用方照常用 `left > 0` 判断即可，不用分叉。
     */
    public dailyLeft(key: string, max: number): number {
        if (max <= 0) return Infinity;
        return Math.max(0, max - this.dailyUsed(key));
    }

    /** 用掉一次配额；已用满 ⇒ 返回 `false` 且**不改任何状态**（调用方据此拒绝发放） */
    public useDaily(key: string, max: number): boolean {
        if (max > 0 && this.dailyUsed(key) >= max) return false;
        this.rollDaily();
        this._data.daily[key] = (this._data.daily[key] ?? 0) + 1;
        this.save();
        return true;
    }

    // --------------------------------------------------------
    //  ★ 七日签到（第 57 轮新增 · 用户 2026-10-07 拍板奖励表，表在 `CFG.SIGN`）
    // --------------------------------------------------------
    //
    //  【状态只用已有的两个字段，不新增存档字段】
    //    `signDate`   = 上次签到日期（本地 `YYYY-MM-DD`，空串 = 从未签过）
    //    `signStreak` = **本轮已连领的格数**（0..`SIGN.CYCLE`）
    //
    //  【口径（设计规则 §P1.6 + 视觉稿设计说明⑤）】
    //    · 昨天签过（`dayDiff = 1`）⇒ 今天解锁**下一格**；
    //      满 7 天后下一格**回到第 1 天**（循环，已领记录随之清空）。
    //    · 首次 / 漏签（`dayDiff ≥ 2` 或日期非法）⇒ 从**第 1 天**重来。
    //      ⚠️ 这叫"不给断签惩罚"——**已领到的道具不会被收回**，只是进度重来，
    //        因此 `signStreak` 归 0（而不是负数或保留旧值）。
    //    · 一律按**本地日历天**（`todayKey()`）判，绝不用 UTC。

    /** 上次签到距今天的自然日差；从未签到 / 日期非法 ⇒ `null` */
    private signGap(): number | null {
        if (!this._data.signDate) return null;
        const d = dayDiff(this._data.signDate, todayKey());
        return Number.isFinite(d) ? d : null;
    }

    /** 今天该领第几格（1..`SIGN.CYCLE`）；**今天已领 ⇒ 0** */
    public signDayToday(): number {
        const g = this.signGap();
        if (g === 0) return 0;                                    // 今天签过了
        if (g === 1 && this._data.signStreak < SIGN.CYCLE) return this._data.signStreak + 1;
        return 1;                                                 // 首次 / 漏签 / 满一轮 ⇒ 第 1 天
    }

    /**
     * 已领到第几格（0..`SIGN.CYCLE`）—— **渲染"已领"态格数的唯一入口**。
     *
     * ⚠️ 必须夹 `min(streak, day-1)`：满一轮后的第一天 `signStreak` 还是 7，
     *   而 `signDayToday()` 已经回到 1；不夹的话**第 1 格会同时是"已领"和"可领"**，
     *   界面上表现为"格子上既有一颗勾、又挂着一颗领取胶囊"。
     */
    public signClaimed(): number {
        const g = this.signGap();
        if (g !== 0 && g !== 1) return 0;                         // 断签 ⇒ 全部回到"未到"
        const day = this.signDayToday();
        if (day === 0) return this._data.signStreak;              // 今天已领 ⇒ 连领数就是已领格数
        return Math.min(this._data.signStreak, day - 1);
    }

    /**
     * 副标题那颗「已连签 n 天」胶囊的数字 = **累计连签天数**。
     *
     * ★ 第 57 轮三改口径（用户拍板方案 B）：**不再读本轮的 `signStreak`**。
     *   · 满 7 天后显示「已连签 7 天」，再领新的第 1 格显示「已连签 8 天」（不会跳回 1）；
     *   · 中间断签几天**不影响**这个数（只统计累计天数）；
     *   · 从未签过 = 0 ⇒ 调用方**整颗隐藏**（显示"已连签 0 天"读起来像"你什么都没做到"）。
     */
    public signTotalLive(): number {
        return Math.max(0, this._data.signTotal); 
    }

    /**
     * 领今天这一格：写 `signDate` + 推进 `signStreak`，返回领到的是第几天（1..`SIGN.CYCLE`）。
     * ⚠️ 今天已领 ⇒ 返回 **0** 且**不改任何状态**（调用方据此拒绝重复发奖）。
     *
     * ⚠️ 只推进"签到进度"，**不发货** —— 发什么由 `CFG.SIGN.DAYS` 决定，
     *   由调用方（`HomePage.claimSignToday()`）发放。分开是为了让"第 7 日任选"
     *   能先弹选择器、拿到选择后再落账。
     */
    public claimSign(): number {
        const day = this.signDayToday();
        if (day <= 0) return 0;
        this._data.signDate = todayKey();
        this._data.signStreak = day;
        // ★ 累计连签（方案 B）：每成功领一格 +1，**只增不减**。
        //   `signStreak` 满 7 天后会回到 1，而这个数继续往上走 —— 两者刻意分开。
        //   `Math.max(0, …)` 是防御：万一老存档里混进负数（`n()` 已挡，但迁移路径不止一条），
        //   不要让它变成"越领越小"。
        this._data.signTotal = Math.max(0, this._data.signTotal) + 1;
        this.save();
        return day;
    }

    /** 清档（设置面板用） */
    public resetAll(): void {
        this._data = fresh();
        this.save();
    }
}
