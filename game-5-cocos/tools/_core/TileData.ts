/**
 * ============================================================
 *  TileData.ts · 牌库唯一真源
 * ============================================================
 *  牌面编码 = `suit*10 + num`（wan=0 / tiao=1 / tong=2，num 1~9）。
 *  编码口径与 `core/LevelData.ts` 的 `f` 数组**必须一致**（那边是生成的，这边是消费的）。
 *
 *  ⚠️ **本文件不 import './cc.ts'** —— 无头冒烟与离线自检都要复用它。
 *
 *  纪律（沿用 game-4 的教训）：牌库、贴图路径、判定规则**只能有一份**。
 *  一旦"游戏里"和"自检里"各写一份，就一定会分叉，最后变成
 *  「脚本说有解、游戏里消不掉」这种最难查的 bug。
 * ============================================================
 */

import { SUITS, SUIT_CN, NUM_CN, type Suit } from './CFG.ts';

/** 牌面编码：suit*10 + num */
export type FaceCode = number;

export interface Face {
    suit: Suit;
    num: number;
}

/** 由花色 + 点数编码 */
export function encode(suit: Suit, num: number): FaceCode {
    return SUITS.indexOf(suit) * 10 + num;
}

/** 解码 */
export function decode(code: FaceCode): Face {
    return { suit: SUITS[Math.floor(code / 10)], num: code % 10 };
}

/**
 * 花色序号（0/1/2）——**高频判定路径专用**。
 *
 * ⚠️ 判定里**不要**用 `decode(code).suit !== suit` 去比字符串：
 *    `decode` 返回的 `suit` 是 `'wan'|'tiao'|'tong'`，而循环变量通常是数字 0/1/2，
 *    两者**永远不相等**，于是「吃」判定会**静默失效**（不报错，只是永远返回 null）。
 *    这个坑在 check-board.mjs 的 C 组被抓住过一次，保留这两个函数就是为了不再犯。
 */
export function suitOf(code: FaceCode): number {
    return Math.floor(code / 10);
}

/** 点数（1~9） */
export function numOf(code: FaceCode): number {
    return code % 10;
}

/** 稳定字符串键（日志 / 自检 / 分组都用它） */
export function faceKey(code: FaceCode): string {
    const f = decode(code);
    return `${f.suit}-${f.num}`;
}

/**
 * 贴图路径（相对 assets/resources/，**不含扩展名**）。
 *
 * ⚠️ 资产用 **ASCII 文件名**（`tiles/wan/wan3.png`）而不是中文名（`三万.png`）：
 *    中文资源名在 `resources.load` 里虽然多数情况可用，但会在 URL 编码、
 *    日志输出、以及命令行 grep 验证这三处引出无谓的麻烦（技能第 23 条：
 *    本机 Bash 的 grep 对中文模式会**静默返回空**，这让"验证资源是否入包"变得不可靠）。
 *    导入脚本 `tools/import-assets.py` 负责重命名。
 */
export function spritePath(code: FaceCode): string {
    const f = decode(code);
    return `tiles/${f.suit}/${f.suit}${f.num}`;
}

/** 牌面中文名（**只用于日志**，不上屏 —— 沿用 game-4 的用词纪律） */
export function faceLabel(code: FaceCode): string {
    const f = decode(code);
    return `${NUM_CN[f.num - 1]}${SUIT_CN[f.suit]}`;
}

/** 整副牌库（27 种）—— 审计 / 自检用 */
export function fullDeck(): FaceCode[] {
    const out: FaceCode[] = [];
    for (const s of SUITS) for (let n = 1; n <= 9; n++) out.push(encode(s, n));
    return out;
}

/** 牌库审计：编码越界 / 花色非法一律拦下 */
export function inDeck(code: FaceCode): boolean {
    const suit = Math.floor(code / 10);
    const num = code % 10;
    return suit >= 0 && suit < SUITS.length && num >= 1 && num <= 9;
}
