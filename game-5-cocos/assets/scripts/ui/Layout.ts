/**
 * ============================================================
 *  Layout.ts · 三带布局（顶带 / 桌面 / 底带）
 * ============================================================
 *  【为什么不能直接把设计稿坐标 topY() 一算就完事】
 *  设计稿是 750×1334（9:16），而真机竖屏普遍更长（20:9 ≈ 750×1625）。
 *  适配策略是 `fitWidth` ⇒ **可视宽度恒为 750，高度 ≥ 1334**。
 *  如果所有东西都从"顶边"往下排，多出来的高度会全部堆在底部 ——
 *  底带（槽位条 / 道具栏）就会浮在屏幕中间偏上，下面空一大片。
 *
 *  【正确口径】顶带贴顶、底带贴底、桌面在两带之间**居中**：
 *      · 顶带：从**顶边**往下量（屏幕坐标语义保持与设计稿一致）
 *      · 底带：从**底边**往上量（`BOT_*` 是"距底边多少"）
 *      · 桌面：取两者之间空白区的**中点**
 *    这样 1334 上逐像素等于设计稿；更高的屏上多出来的高度自动分给桌面上下留白。
 *
 *  【桌面尺寸的钳制】极端比例（例如平板 4:3）下空白区可能 **小于 750**，
 *  此时把桌面整体等比缩小（`tableScale < 1`），而不是让它压到底带上。
 * ============================================================
 */

import { Size, view } from 'cc';

import { LAYOUT } from '../CFG';

/** 可视尺寸（引擎设计单位） */
export function viewport(): Size {
    return view.getVisibleSize();
}

/** 屏幕左上原点坐标 → 引擎坐标（x）。与 CFG.px 同口径，但基于**可视宽度**居中 */
export function xOf(v: number): number {
    return v - viewport().width / 2;
}

/** 从**顶边**往下量 `v` 的引擎 y */
export function topY(v: number): number {
    return viewport().height / 2 - v;
}

/** 从**底边**往上量 `v` 的引擎 y */
export function botY(v: number): number {
    return -viewport().height / 2 + v;
}

// ------------------------------------------------------------
//  底带（距底边的偏移，全部由 1334 设计稿换算而来）
// ------------------------------------------------------------
//  设计稿：道具栏 1150~1262（底边留 72）；槽位条 1058~1138；两者间距 12。
export const BOT = {
    /** 道具栏底边距屏幕底边的距离 */
    PAD: 72,
    /** 道具栏中心（距底边） */
    TOOL_C: 72 + LAYOUT.TOOL_BAR.h / 2,
    /** 槽位条中心（距底边） */
    SLOT_C: 72 + LAYOUT.TOOL_BAR.h + 12 + LAYOUT.SLOT_BAR.h / 2,
    /** 底带整体占用的高度（距底边）—— 桌面下沿不能低于它 */
    TOP: 72 + LAYOUT.TOOL_BAR.h + 12 + LAYOUT.SLOT_BAR.h,
} as const;

// ------------------------------------------------------------
//  桌面
// ------------------------------------------------------------

export interface TableBox {
    /** 桌面节点的引擎 y（中心） */
    cy: number;
    /** 桌面边长（已按可用高度钳制） */
    size: number;
    /** 缩放系数（1 = 不缩） */
    scale: number;
}

/**
 * 桌面落点与尺寸。
 *
 * 可用高度 = 顶带下沿 − 底带上沿；桌面边长 750 放不下时整体等比缩小。
 * 放得下时**居中**放在空白区里 —— 这正是设计稿在 1334 上的表现（中心 y ≈ −8）。
 */
export function tableBox(): TableBox {
    const topEdge = topY(LAYOUT.TOP_H);        // 顶带下沿
    const botEdge = botY(BOT.TOP);             // 底带上沿
    const avail = Math.max(0, topEdge - botEdge);

    const size = LAYOUT.TABLE_SIZE;
    const scale = Math.min(1, avail / size);
    const half = (size * scale) / 2;

    // 居中：空白区中点；再夹一次，保证不越界
    let cy = (topEdge + botEdge) / 2;
    cy = Math.min(cy, topEdge - half);
    cy = Math.max(cy, botEdge + half);

    return { cy, size, scale };
}

/** 桌面可用的安全区（牌堆活动范围）边长，随桌面缩放 */
export function safeSize(): number {
    const t = tableBox();
    return LAYOUT.SAFE_W * t.scale;
}

// ------------------------------------------------------------
//  常用落点
// ------------------------------------------------------------

/** 顶带某控件中心（用设计稿的 `top` + 高度求中心） */
export function hudCenterY(top: number, h: number): number {
    return topY(top + h / 2);
}

/** 底带某控件中心（用设计稿的 `top` 换算成"距底边"，再取中心） */
export function botBandY(designTop: number, h: number): number {
    const fromBottom = DESIGN_H_REF - designTop;
    return botY(fromBottom - h / 2);
}

/** 设计稿高度（只用于把设计稿的 top 换算成"距底边"） */
const DESIGN_H_REF = 1334;

/**
 * 顶部安全区（微信胶囊避让）。
 *
 * ⚠️ 真机上微信胶囊的位置由 `wx.getMenuButtonBoundingClientRect()` 给出；
 *   **拿不到时**（浏览器 / 开发者工具 / 非微信环境）回落到设计稿的固定值：
 *   胶囊避让区 right 30 / top 88 / 174×64。
 *   本函数返回"顶带内容应当再往下让开多少"，目前设计稿的顶带已经让开了，故为 0。
 */
export function capsuleInset(): { top: number; right: number } {
    return { top: 0, right: LAYOUT.CAPSULE_AVOID.right };
}

/**
 * 命名空间式聚合导出 —— 让调用处写成 `Layout.tableBox()`。
 *
 * 【为什么要有它】上面每个函数都已经具名导出了，直接 `import { tableBox }` 也能用。
 *  但在页面代码里，`tableBox()` / `xOf()` / `botY()` 这些名字**太通用**，
 *  裸用会让人读不出"这是布局口径"；而 `Layout.tableBox()` 一眼就知道出处。
 *  同一页面里再用 `Layout.BOT.SLOT_C` 这类常量时也不必多 import 一次。
 *  （聚合对象是 `as const`，成员引用与直接调用同一个函数，没有额外开销。）
 */
export const Layout = {
    viewport, xOf, topY, botY,
    BOT, tableBox, safeSize, hudCenterY, botBandY, capsuleInset,
} as const;
