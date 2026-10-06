/**
 * ============================================================
 *  MatchRule.ts · 牌型判定
 * ============================================================
 *  本作首版**只有 2 个机制**（`game-5 · 设计规则.md` G1）：
 *    ① 碰 —— 三张**完全相同**
 *    ② 吃 —— **同一花色**里号码连着三张（n, n+1, n+2），**不跨花色**
 *  ⚠️ **没有「杠」**（game-4 有，game-5 首版不做）—— 判定里凡涉及"4 张"的分支一律不存在，
 *     别从 game-4 抄过来。
 *
 *  ⚠️ **本文件不 import './cc.ts'** —— 无头冒烟里的 `fill:` / `auto:` 决策要复用同一份判定。
 *     技能里的血坑：「`wouldMatch()` 的规则必须与 `findMatch()` 一致」——
 *     不一致的表现**永远不是报错**，而是"面板没弹 / 计数不涨 / 循环空转"。
 *     所以两者写在同一个文件、共用同一个 `findBest()` 内核。
 *
 *  【优先级】
 *    ① 优先消除「包含**最新入槽**那张牌」的组合 —— 否则玩家刚放进去的牌不参与消除，
 *       会产生"我明明凑齐了却没消"的错觉；
 *    ② 仍并列时：碰（同面）优先于吃（连号）；
 *    ③ 再并列时：取下标更小的组合（保证同局面下判定**确定**，便于回归）。
 * ============================================================
 */

import { suitOf, numOf, type FaceCode } from './TileData.ts';

export type MatchType = 'peng' | 'chi';

export interface MatchResult {
    type: MatchType;
    /** 参与消除的槽位下标（升序） */
    indices: number[];
}

/** 内部日志用的中文别名（**不上屏**，仅 console） */
export const MATCH_LABEL: Record<MatchType, string> = { peng: '碰', chi: '吃' };

/** 一组几张 */
export const MATCH_SIZE = 3;

/** 把槽内容按牌面分组：code → 槽位下标数组 */
function groupByCode(slots: FaceCode[]): Map<FaceCode, number[]> {
    const m = new Map<FaceCode, number[]>();
    for (let i = 0; i < slots.length; i++) {
        const arr = m.get(slots[i]);
        if (arr) arr.push(i);
        else m.set(slots[i], [i]);
    }
    return m;
}

/** 碰：3 张完全相同。anchor >= 0 时要求组合必须含该槽位 */
function findPeng(slots: FaceCode[], anchor: number): MatchResult | null {
    const groups = groupByCode(slots);
    // 遍历顺序固定（Map 保持插入序）⇒ 结果确定
    for (const [, idx] of groups) {
        if (idx.length < 3) continue;
        if (anchor >= 0 && idx.indexOf(anchor) < 0) continue;
        return { type: 'peng', indices: idx.slice(0, 3) };
    }
    return null;
}

/** 吃：同花色连号 3 张。同一张牌不能在一次「吃」里用两次 */
function findChi(slots: FaceCode[], anchor: number): MatchResult | null {
    for (let suit = 0; suit < 3; suit++) {
        // 该花色：点数 → 槽位下标列表
        const byNum = new Map<number, number[]>();
        for (let i = 0; i < slots.length; i++) {
            if (suitOf(slots[i]) !== suit) continue;      // ⚠️ 必须比数字序号，见 TileData.suitOf 注释
            const n = numOf(slots[i]);
            const arr = byNum.get(n);
            if (arr) arr.push(i);
            else byNum.set(n, [i]);
        }
        for (let start = 1; start <= 7; start++) {
            const a = byNum.get(start);
            const b = byNum.get(start + 1);
            const c = byNum.get(start + 2);
            if (!a || !b || !c) continue;
            const picks = [a[0], b[0], c[0]];
            if (new Set(picks).size !== MATCH_SIZE) continue;   // 防御性
            if (anchor >= 0 && picks.indexOf(anchor) < 0) continue;
            picks.sort((x, y) => x - y);
            return { type: 'chi', indices: picks };
        }
    }
    return null;
}

/**
 * 扫描槽位，返回应消除的组合；没有则 null。
 *
 * @param slots  当前槽内容（顺序即显示顺序）
 * @param newest 最新入槽牌的槽位下标；-1 表示不特殊照顾
 */
export function findMatch(slots: FaceCode[], newest = -1): MatchResult | null {
    if (slots.length < MATCH_SIZE) return null;

    // ① 先照顾最新入槽那张
    if (newest >= 0 && newest < slots.length) {
        const p = findPeng(slots, newest);
        if (p) return p;
        const c = findChi(slots, newest);
        if (c) return c;
    }
    // ② 兜底全扫（道具把牌退回槽内之类的扩展路径会用到）
    return findPeng(slots, -1) ?? findChi(slots, -1);
}

/**
 * 预测：把 candidate 放进槽后**会不会**引发消除（不真放）。
 *
 * ⚠️ **必须与 `findMatch` 共用同一份规则** —— 见文件头注释。
 *    无头冒烟的 `fill:` 动作靠它把槽"安全地塞满"，规则一旦分叉，
 *    `fill:` 就永远塞不满 8 格，表现是"槽没满、面板没弹"，看不出是判定写错。
 */
export function wouldMatch(slots: FaceCode[], candidate: FaceCode): boolean {
    const probe = slots.concat([candidate]);
    return findMatch(probe, probe.length - 1) !== null;
}

/**
 * 自检用：把整个槽摊开，返回**所有**可消组合（不是第一个）。
 * 离线复算"这一局最多能消几组"时用得到；游戏主流程不用它。
 */
export function allMatches(slots: FaceCode[]): MatchResult[] {
    const out: MatchResult[] = [];
    const groups = groupByCode(slots);
    for (const [, idx] of groups) {
        for (let k = 0; k + MATCH_SIZE <= idx.length; k += MATCH_SIZE) {
            out.push({ type: 'peng', indices: idx.slice(k, k + MATCH_SIZE) });
        }
    }
    for (let suit = 0; suit < 3; suit++) {
        const byNum = new Map<number, number[]>();
        for (let i = 0; i < slots.length; i++) {
            if (suitOf(slots[i]) !== suit) continue;
            const n = numOf(slots[i]);
            const arr = byNum.get(n);
            if (arr) arr.push(i);
            else byNum.set(n, [i]);
        }
        for (let start = 1; start <= 7; start++) {
            const a = byNum.get(start), b = byNum.get(start + 1), c = byNum.get(start + 2);
            if (a && b && c) out.push({ type: 'chi', indices: [a[0], b[0], c[0]].sort((x, y) => x - y) });
        }
    }
    return out;
}
