/**
 * ============================================================
 *  ItemStock.ts · 道具**两本账合并**的唯一真源
 * ============================================================
 *  ⚠️ **不 import './cc.ts'** —— 离线自检要能直接跑它（见 `tools/_r53-core-check.mjs` G 组）。
 *
 *  【为什么需要这个文件 —— 第 57 轮三的真 bug】
 *    本作的道具**天生是两本账**，而且两本账的"生死"完全不同：
 *
 *      · **本局赠礼** `Gift.currentRun().items`
 *          —— 骰子掷出来的那 1 个。`endRun()` 时**未用即作废**，
 *             **永远不写进存档**（第 13 轮拍板）。它只活在"这一局"里。
 *      · **跨局库存** `SaveService.inventory`
 *          —— 道具商城看广告领的、七日签到领的。跨会话保留，
 *             关掉小游戏再进来还在。
 *
 *    但关卡的 `refreshTools()` 当时**只读了第一本**，而商城的 `addTool()`
 *    只写第二本 ⇒ **玩家在商城/签到领到的道具，进关卡后角标恒为 0、也点不动**
 *    （`useTool()` 同样只认第一本，还会把他推去看广告）。
 *    更隐蔽的是：`SaveService.useTool()` 早就写好了、注释齐全，
 *    却**全工程一次都没被调用过** —— 一本"凭空消失"的账。
 *    验尸特征：商城的「当前持有」在涨、关卡角标不动，**两边都不报任何错**。
 *
 *  【为什么把策略放在 core 而不是写进 `GamePage`】
 *    放 UI 里就只能靠"开浏览器、真机点、看角标"来验，而这类 bug 的要害
 *    恰恰是**多本账之间的取舍**（谁先扣、扣到 0 之后怎么办），
 *    用离线确定性用例能一条条钉死，也不给"UI 层再实现一遍"留缝。
 *    这与 `Difficulty` / `Gift` 放 core 是同一个理由。
 *
 *  【消耗顺序为什么是"赠礼优先"】
 *    赠礼本局结束就蒸发，跨局库存不会 ⇒ **先花会过期的那个**。
 *    玩家的利益最大，也是这一类游戏的通行做法。
 *    ⚠️ 顺序反过来（先扣库存）玩家**不会觉得哪里坏了**，只会觉得
 *      "我明明买了 5 个，怎么打着打着赠礼那个还在" —— 属于静默吃亏。
 * ============================================================
 */

import { TOOL, type ToolKey } from './CFG.ts';
import { currentRun, useRunItem } from './Gift.ts';
import { SaveService } from './SaveService.ts';

/** 某个道具**当前可用总数** = 本局赠礼 + 跨局库存 */
export function itemStock(id: ToolKey): number {
    const run = currentRun();
    const gift = run ? (run.items[id] ?? 0) : 0;
    return Math.max(0, gift) + Math.max(0, SaveService.instance.count(id));
}

/** 四件道具的可用总数快照（返回的是**副本**，改它不影响存档） */
export function itemStockAll(): Record<ToolKey, number> {
    const out = {} as Record<ToolKey, number>;
    for (const k of Object.values(TOOL)) out[k] = itemStock(k);
    return out;
}

/**
 * 消耗一个道具（**赠礼优先，其次跨局库存**），返回是否真的消耗到了。
 *
 * ⚠️ 两本账都空 ⇒ `false`，**且不改变任何状态**。
 *   调用方必须据此走"看广告"分支，而不是当作已扣减继续往下走
 *   （否则就是凭空虚扣玩家一个道具 —— 第 46 轮修过一次同类的）。
 */
export function consumeItem(id: ToolKey): boolean {
    if (useRunItem(id)) return true;              // ① 本局赠礼（会作废 ⇒ 先花）
    return SaveService.instance.useTool(id);      // ② 跨局库存（商城 / 签到）
}
