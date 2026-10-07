/**
 * ============================================================
 *  Gift.ts · 掷骰点数 → 开局赠礼映射表
 * ============================================================
 *  ⚠️ **本表是第 13 / 15 轮定稿版，一字不改**（用户逐项拍板过两次）。
 *     表里的每一行都能在主玩页排版稿的 `GIFT_TABLE` 里找到同源副本；
 *     改这里必须同步改那边，否则"演示页说的"和"游戏里给的"会分叉。
 *
 *  【口径（第 14 轮拍板）】
 *    · 由**两枚骰子的和值**（2~12）决定档位；
 *    · 赠礼**仅限本局** —— 本局结束或提前退出时未使用的赠礼立即作废，
 *      不计入累积、不跨局保留；
 *    · `revive` 档**不入道具栏**：它是"失败时自动直消 4 张"的机会，
 *      玩家不能主动使用、也没有按钮。
 *
 *  【和值对称】2/12 与 3/11 与 4/10… 的档位是**对称**的（见下方表格），
 *     这是定稿时特意做的 —— 规则页那张"点数对应表"也是按对称和值合并成 6 行的。
 * ============================================================
 */

import { TOOL, type ToolKey } from './CFG.ts';

export type GiftTier = '复活档' | '加槽档' | '常规档';

export interface GiftDef {
    tier: GiftTier;
    /** 本局可用道具（通常 1 个；复活档为空） */
    items: ToolKey[];
    /** 复活机会次数（0 = 不给） */
    revive: number;
}

/**
 * 和值 → 赠礼。**2 与 12 / 3 与 11 / 4 与 10 … 对称**。
 * 读表时注意：`revive` 档给的是"失败时自动直消 4 张"的机会，不是道具。
 */
export const GIFT_TABLE: Record<number, GiftDef> = {
    2:  { tier: '复活档', items: [], revive: 1 },
    3:  { tier: '加槽档', items: [TOOL.ADD_SLOT], revive: 0 },
    4:  { tier: '常规档', items: [TOOL.MOVE], revive: 0 },
    5:  { tier: '常规档', items: [TOOL.ERASE], revive: 0 },
    6:  { tier: '常规档', items: [TOOL.MOVE], revive: 0 },
    7:  { tier: '常规档', items: [TOOL.ERASE], revive: 0 },
    8:  { tier: '常规档', items: [TOOL.MOVE], revive: 0 },
    9:  { tier: '常规档', items: [TOOL.ERASE], revive: 0 },
    10: { tier: '常规档', items: [TOOL.MOVE], revive: 0 },
    11: { tier: '加槽档', items: [TOOL.ADD_SLOT], revive: 0 },
    12: { tier: '复活档', items: [], revive: 1 },
};

/** 取某个和值的赠礼（越界时回落到常规档，绝不返回 undefined） */
export function giftOf(sum: number): GiftDef {
    return GIFT_TABLE[sum] ?? { tier: '常规档', items: [TOOL.MOVE], revive: 0 };
}

/** 档位配色（赠礼卡的缎带 / 名称色） */
export const TIER_COLOR: Record<GiftTier, { ribbon: string; name: string }> = {
    复活档: { ribbon: '#D8432F', name: '#FF9E88' },
    加槽档: { ribbon: '#C8912B', name: '#FFE08A' },
    常规档: { ribbon: '#2E8B6F', name: '#7FD8BC' },
};

/** 档位说明文案（赠礼卡的副标题 + 护栏说明） */
export const TIER_TEXT: Record<GiftTier, { sub: string; guard: string }> = {
    复活档: {
        sub: '不入道具栏 · 本局失败时自动直消 4 张',
        guard: '仅限本局使用 —— 复活机会不进道具栏、不能主动使用，本局失败时自动生效；未用随本局一并作废。',
    },
    加槽档: {
        sub: '本局道具栏 · 随时可用',
        guard: '仅限本局使用 —— 本局结束或提前退出关卡时，未使用的赠礼道具立即作废，不计入累积、不跨局保留。',
    },
    常规档: {
        sub: '本局道具栏 · 随时可用',
        guard: '仅限本局使用 —— 本局结束或提前退出关卡时，未使用的赠礼道具立即作废，不计入累积、不跨局保留。',
    },
};

// ============================================================
//  本局状态（RunState）—— 「本局限定」护栏的唯一落点
// ============================================================

export interface RunGift {
    /** 骰子 A 点数 */
    a: number;
    /** 骰子 B 点数 */
    b: number;
    /** 和值 */
    sum: number;
    /** 档位 */
    tier: GiftTier;
    /** 本局道具（初始库存） */
    items: Record<ToolKey, number>;
    /** 复活机会（初始） */
    revive: number;
}

/**
 * 一次投掷的结果 → 本局赠礼对象。
 * @param seed 可选：给定时走确定性随机（无头验收靠它复现同一局）
 */
export function rollGift(seed?: number): RunGift {
    if (seed === undefined) return composeGift(rollDie(), rollDie());
    // 两枚骰子用**不同**的种子派生，否则同种子下 a 恒等于 b（这是个很容易漏的坑）
    return composeGift(rollDie(seed), rollDie(seed * 7919 + 13));
}

function rollDie(seed?: number): number {
    if (seed === undefined) return 1 + Math.floor(Math.random() * 6);
    // 确定性 LCG（与 Board.shuffle 同族），保证同种子同结果
    const s = ((seed >>> 0) || 1) * 1664525 + 1013904223;
    return 1 + Math.floor(((s >>> 0) / 4294967296) * 6);
}

/** 由两个点数组装赠礼（点数越界会被夹到 1~6） */
export function composeGift(a: number, b: number): RunGift {
    const da = Math.max(1, Math.min(6, Math.floor(a)));
    const db = Math.max(1, Math.min(6, Math.floor(b)));
    const sum = da + db;
    const def = giftOf(sum);

    const items: Record<ToolKey, number> = {
        [TOOL.ERASE]: 0, [TOOL.MOVE]: 0, [TOOL.SHUFFLE]: 0, [TOOL.ADD_SLOT]: 0,
    };
    for (const id of def.items) items[id] = (items[id] ?? 0) + 1;

    return { a: da, b: db, sum, tier: def.tier, items, revive: def.revive };
}

/**
 * 本局运行时状态 —— 页面之间靠它传"这一局"的东西。
 *
 * 【为什么用模块级可变对象而不是参数层层传递】
 * 主玩页需要知道赠礼、结算页需要知道结果、失败复活要回写使用次数；
 * 层层透传会把每条跳页调用都染上"这局"的参数。而**本局**这个概念天然只有一个，
 * 做成单例更贴合语义（`beginRun` / `endRun` 两个动作对称，用完即清）。
 */
export interface RunState {
    /** 关卡号 */
    level: number;
    /** 本局道具库存（会被消耗） */
    items: Record<ToolKey, number>;
    /** 本局已用过的道具（顺序，用于统计） */
    used: ToolKey[];
    /** 复活机会总数 */
    revive: number;
    /** 已用掉的复活机会 */
    reviveUsed: number;
    /** 掷骰赠礼（含点数，结算页要用） */
    gift: RunGift;
    /** 本局是否已结算（防止重复弹结算） */
    settled: boolean;
    /** 本局使用过的加槽次数（每关限 1） */
    addSlotUsed: number;
}

let _run: RunState | null = null;

/** 开始一局（幂等：已存在则先结束旧的） */
export function beginRun(level: number, gift: RunGift): RunState {
    _run = {
        level,
        items: { ...gift.items },
        used: [],
        revive: gift.revive,
        reviveUsed: 0,
        gift,
        settled: false,
        addSlotUsed: 0,
    };
    return _run;
}

export function currentRun(): RunState | null {
    return _run;
}

/** 尝试消耗一个本局道具（返回是否成功） */
export function useRunItem(id: ToolKey): boolean {
    if (!_run) return false;
    if ((_run.items[id] ?? 0) <= 0) return false;
    _run.items[id]--;
    _run.used.push(id);
    return true;
}

/** 尝试用掉一次复活机会（返回是否成功） */
export function useRevive(): boolean {
    if (!_run) return false;
    if (_run.reviveUsed >= _run.revive) return false;
    _run.reviveUsed++;
    return true;
}

export function reviveLeft(): number {
    if (!_run) return 0;
    return Math.max(0, _run.revive - _run.reviveUsed);
}

/**
 * 结束一局：返回**未使用即作废**的清单（给结算页显示"作废"提示用），然后清空。
 * 这一步是"本局限定"护栏的收口 —— 未用的东西**绝不写进存档**。
 */
export function endRun(): { deadItems: Record<ToolKey, number>; deadRevive: number } | null {
    if (!_run) return null;
    const deadItems = { ..._run.items };
    const deadRevive = Math.max(0, _run.revive - _run.reviveUsed);
    _run = null;
    return { deadItems, deadRevive };
}
