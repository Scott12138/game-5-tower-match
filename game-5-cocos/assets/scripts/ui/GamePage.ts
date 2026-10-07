/**
 * ============================================================
 *  GamePage.ts · 主玩页（④）—— 核心玩法落地
 * ============================================================
 *  几何 / 配色 / 交互**逐条照抄**这两份定稿：
 *      · `game-5-主玩页-规格.md` 第二节「页面几何（三带模型）」（第 16 轮）
 *      · `game-5-主玩页-排版.html` 的 `.tile / .slot / .item / .pause / .ruleBtn`
 *
 *  ── 核心循环 ──────────────────────────────────────────────
 *     点可点牌 → 飞入槽位 → 凑成**碰/吃** → 消除 → 压着的牌露出 → 清场胜 / 槽满或超时负
 *
 *  ── 三条不能破的口径 ──────────────────────────────────────
 *  ① **可点判定只有一个真源**：`Board.pickable()`（**只看覆盖 < 30 %，没有段限制**）。
 *     牌面的"亮/暗"直接由它派生 —— **绝不允许**用 `tile.cover` 另算一遍。
 *     两者一旦分叉，表现是"看着能点、点了没反应"，或反之，且完全不报错。
 *  ② **数据先行、视觉后到**：点牌的瞬间就把数据入槽（而不是等飞行动画结束）。
 *     否则玩家连点时会计数错乱 —— 这类 bug 在飞行 0.26s 的窗口里高频复现。
 *  ③ ★ **第 46 轮起「段限制」已取消**（用户拍板）：全桌只要没被压住就能点，
 *     可点集**只由覆盖决定**，而覆盖是看得见的 ⇒ 「看着能点就能点」成立。
 *     旧口径下"从下层露出来、但不在当前段"的牌是灰的，玩家完全推不出原因
 *     （实测占"露出却点不动"的 66.1 %），那是用户截图里最困惑的一处。
 *
 *  ── 调试桥 ───────────────────────────────────────────────
 *  `globalThis.__game5` 暴露 state / pickables / pick —— **无头验收脚本靠它**。
 *  `pick()` 与真实触摸走**同一个**处理函数，所以"脚本能打通"等价于"手指能打通"。
 * ============================================================
 */

import { Input, Node, Sprite, Texture2D, UIOpacity, UITransform, _decorator, input, tween, v3 } from 'cc';

import { AD, ASSET, COLOR, DEBUG, DIFF, FONT, LAYOUT, MOTION, NUDGE, PAGE, PLAY, SFX, SKIN, TOOL,
    TOOL_ICON, TOOL_META, TOOL_ORDER, diffBlockOf, timeLimitOf, type AdScene, type ToolKey } from '../CFG';
import { PageBase } from './PageBase';
import { Layout } from './Layout';
import { EASE, MotionFx, TAG } from './MotionFx';
import { AudioService } from './AudioService';
import { Haptics } from './Haptics';
import { SaveService } from '../core/SaveService';
import { AdService, type AdOutcome } from '../core/AdService';
// ★ 第 56 轮：替身广告面板抽成共用件（首页「道具商城」也要用同一块面板）。
//   面板的 UI / 进度 / 幂等收口全在 `AdDialog.ts`，本页只管"暂停态"与"拿到结局之后干什么"。
import { openMockAdDialog, type MockAdHandle } from './AdDialog';
import { ShareService } from '../core/ShareService';
import { LEVELS, type LevelDef } from '../core/LevelData';
import { Board, makeBoard } from '../core/Board';
import { findMatch, MATCH_LABEL, type MatchType } from '../core/MatchRule';
import { currentRun, endRun, reviveLeft, useRevive } from '../core/Gift';
// ★ 第 57 轮三：道具库存 = 本局赠礼 + 跨局库存，**策略在 core 里**（可离线自证）
import { consumeItem, itemStock } from '../core/ItemStock';
import { faceLabel, spritePath } from '../core/TileData';
import {
    confirmDialog, createGraphicsNode, createLabel, createNode, createSprite,
    draw3dFace, drawProgressBar, fillRadialGlow, fillRoundRect, fillVGradient, loadFrame,
    strokeRoundRect, toast,
} from './UIFactory';
import { hex2color } from './Palette';
import { TileView } from './TileRenderer';

const { ccclass } = _decorator;

const DW = 750;

/** 槽内小牌可用尺寸（格 68×80，留一点内缩） */
const SLOT_BOX = { w: 62, h: 74 };
/** 判定用的输入锁（ms）—— 连点保护 */
const INPUT_LOCK = PLAY.INPUT_LOCK_MS;

// ============================================================
//  「碰 / 吃」撞击动效的**时间轴刻度（ms）** —— 全部由 `MOTION` 常量累加得出
// ============================================================
//
//  ★ 第 59 轮新增。它决定了"什么时候可以把剩下的牌重排、把进度加上去"。
//  ⚠️ **必须由各段累加得出，不许手填一个数**：将来谁改了 `POP_OUT` 却忘了改这里，
//    表现是"三张牌炸到一半就被重排打断"，而**不会有任何报错**
//    （旧实现正是这么坏的：动效 280ms、重排 300ms，两者都远短于现在这套时间轴）。
//
//  ⚠️ 撞击帧那一段**多留 1 帧（16ms）**：冲刺补间是在引擎的 update 里推进的，
//    而撞击帧的回调是 `setTimeout`。两者取同一个毫秒数时，回调会**先于**冲刺的
//    最后一帧落地 —— 于是撞击帧里那条同样改 `scale` 的挤压补间会把冲刺补间
//    `stop()` 在离终点 1 帧的位置（表现不明显，但那 1~2px 的错位会让"叠成一张厚牌"
//    看起来没完全叠拢）。留一帧是这台机器上最省的确定性做法。

/** 撞击帧 = 蓄力 + 冲刺（+1 帧余量，见上） */
const CLASH_HIT_MS = Math.round((MOTION.CLASH_ANTICIPATE + MOTION.CLASH_DASH) * 1000) + 16;
/** 停一拍 —— 让"撞"和"散"成为两件可以分别记住的事 */
const CLASH_HOLD_MS = Math.round(MOTION.POP_HOLD * 1000);
/** 释放段（先胀到峰值、再收缩到 0 并淡出） */
const CLASH_OUT_MS = Math.round(MOTION.POP_OUT * 1000);
/**
 * 动效总时长 —— **数据收尾（重排 / 进度 / 判胜负）必须等它走完**。
 * ⚠️ 这条式子同时是"释放段真的跑完了"的唯一凭证：`resolveMatch` 里那个
 *    `this.timer(CLASH_TOTAL_MS, …)` 就写在它上面。
 */
const CLASH_TOTAL_MS = CLASH_HIT_MS + CLASH_HOLD_MS + CLASH_OUT_MS;

/**
 * 估算单行文字宽度（设计 px）。
 *
 * 【用途】只给"胶囊 / 卡片跟着文案变宽"用（关卡胶囊「第 N 关」的一段一段摆位）。
 *   CJK 按 `fontSize × 0.96`、其余（数字 / 空格 / 冒号）按 `0.60` 估。
 *
 * 【为什么不去量真实宽度】`createLabel` 用的是 `overflow: NONE`，contentSize 由引擎
 *   在**渲染帧**里重算 —— 在同一个构建函数里**同步读出来的是旧值**。
 *   要拿真值就得 `scheduleOnce(0)` 再重排 + 重画底，代价大且容易和别的时间轴打架。
 *   这里只是"排布"，±3px 的误差完全看不出来（真源 `.lv` 本来就是 `padding:0 32px` 自适应）。
 *   ⚠️ 所以这个函数**不得**参与任何几何断言。
 */
function textW(s: string, fontSize: number): number {
    let w = 0;
    for (const ch of s) w += /[\u4e00-\u9fff\u3000-\u303f]/.test(ch) ? fontSize * 0.96 : fontSize * 0.6;
    return w;
}

/**
 * 结算弹层几何 —— **逐值照抄** `game-5-UI-六页视觉稿-v2.html` 的 `.dim / .modal`：
 *   `.dim`   background: rgba(4,20,15,.6)          → DIM = 0.6*255 ≈ 154
 *   `.modal` left/right:65px  ⇒ 卡宽 = 750 − 130 = 620
 *            top:360px；border-radius:36px；border:5px solid var(--gold)
 *            box-shadow 的 `0 0 0 3px #0A3327` → 外圈深绿描边环 RING = 3
 *            padding:44px 40px 40px
 *   `.ribbonTop` top:−34px / 88px 重墨描边（★ 第 48 轮改为**卡内题字**，见 TITLE_*）
 *   `.mascotSlot` height:250px；margin-top:30px
 *   `.desc` 28px / margin:6px 0 30px
 *   `.reward` 130×130 / gap 22；`.rewardrow` margin-bottom:30px
 *   `.btn-gold` height:100px / 40px；margin-bottom:20px
 *   `.btn-ghost` height:76px / 28px
 *   `.coinfall` 34×34
 *
 *  ⚠️ 卡高是**算出来的**（不是写死），并且必须与下面 `cur` 游标的累加**逐项对齐** ——
 *    两者一旦不一致，表现是"卡片高度和内容对不上"（要么内容溢出卡外，要么卡底空一截），
 *    而且**不报错**。新增/删除一行时，改 `cardH` 与 `cur` 两处。
 */
const RESULT = {
    DIM: 154,
    CARD_W: 620,
    TOP: 360,
    RADIUS: 36,
    RING: 3,
    BORDER: 5,
    /**
     * 卡顶 → **标题框顶** 的距离。
     *
     * ★ 第 48 轮：从 44 改到 12 —— 因为标题从"骑缝在卡外"搬进了**卡内**（见 `TITLE_*`），
     *   这个值现在是"标题的上内边距"，不再是"给骑缝缎带让位的空白"。
     */
    PAD_TOP: 12,
    PAD_BOTTOM: 40,

    // ------------------------------------------------------------
    //  ★★ 第 48 轮：标题从「骑缝缎带」改为「**卡内题字**」
    //
    //  【为什么要改 —— 有实测硬数据，不是手感】
    //   旧版把 HTML 的 `.ribbonTop{top:-34px}` 直接当成"**中心**相对卡顶向上 34"用，
    //   而 CSS 里 `top` 是**盒顶**偏移。两者差半个框高：
    //     按真源语义：标签中心应在卡顶**下方** 43.3（框 = [−34, +120.6]）
    //     旧版实际：  标签中心在卡顶**上方** 34（框 = [−111.3, +43.3]，实测）
    //   ⇒ 标题被整体抬高 **77.3 设计 px**，实测 **111.3px 悬在卡框之外**
    //     （框高 154.6，也就是说 72% 的身子在外面）。用户原话：
    //     「文字超出了框外，影响观感」。
    //
    //  【为什么不能靠"把卡片往下挪"来救】
    //   真机可视高 1651.43（≠ 设计稿 1334），HUD 贴安全区顶 ⇒ HUD 底沿约在 319，
    //   而卡顶 TOP=360 —— 中间只有 **41px**。骑缝要占 111.3，怎么挪都会与 HUD 撞。
    //   ⇒ 标题必须完全落进卡内。
    //
    //  【现在的版式】卡顶 → PAD_TOP → 标题框 → TITLE_MT → 吉祥物 → …
    //   标题视觉上沿 ≈ 360 + 12 + 27 = 399，与 HUD 底沿 319 留出 80px 呼吸 ✓
    // ------------------------------------------------------------
    /** 标题字号（照抄真源 `.ribbonTop` 的 `font-size:88px`） */
    TITLE_FONT: 88,
    /**
     * 标题 Label 的**实测**框高 —— **不是**传进去的 `h`。
     *
     * 【为什么必须写成实测值】`createLabel` 在 `overflow: NONE` 下把 contentSize
     *   交给引擎按"文本 + 描边"重算：88 号字 + 8px 描边实测得到 **154.6**。
     *   布局里凡是"要让开标题"的地方都必须用它算 —— 按字号（88）算会少让开 66.6，
     *   然后你会看到一个"明明留了间距却仍然贴着"的诡异现象。
     *   （第 48 轮实测，`tools/_r48-probe-result.mjs` 打出 `w=368 h=154.6`。）
     *   ⚠️ 改 `TITLE_FONT` 必须重跑那个探针复量此值。
     */
    TITLE_H: 155,
    /**
     * 标题框底 → 吉祥物顶 的呼吸量。
     *
     * 【实测口径（第 48 轮，`tools/_r48-probe-result.mjs`）】
     *   取 12 时：标题框底 = 卡内 166.8，吉祥物顶框 = 167 ⇒ **框贴框**（间隙 0.2px），
     *     视觉间隙（到字形下沿、再扣 8px 厚底）只剩 ~19 ⇒ 图上看着"标题快压到吉祥物头顶的叶子"。
     *   取 28 后：上（卡顶 → 字形）≈39 / 下（字形 → 吉祥物）≈35 ⇒ 基本对称，这才是想要的。
     *   ⚠️ 吉祥物自带 `repeatForever` 的 ±12 浮动，量它的时候**必须把 12 加回去**，
     *      否则会把"浮动到最低点"误读成"布局偏低 11px"（第 48 轮第一版就差点栽在这）。
     */
    TITLE_MT: 28,
    /**
     * 标题「厚底」向下偏移（真源 `text-shadow: … 0 8px 0 #5C361D`）。
     *
     * ⚠️ 旧版这一层是**空的**（建了个 `RibbonShadow` Graphics 却 `void rg` 什么都没画），
     *   所以标题看着"发飘"。现在用**同一段文字的第二个 Label** 铺在下面 —— 这才是
     *   text-shadow 的等价物：主标题的 8px 描边会盖住厚底上缘，只在下方露出 8px 深棕。
     */
    TITLE_DEPTH: 8,
    /** 标题厚底颜色（真源 #5C361D） */
    TITLE_DEPTH_COLOR: '#5C361D',
    /**
     * ★★ 第 49 轮：**尾部全角标点的视觉居中补偿**（单位 = em，乘字号即设计 px）。
     *
     * 【问题】用户反馈「"通关啦"/"只差一点"横向上都不太居中，看着偏左了一些」。
     *
     * 【先把排版参数排除掉】探针 `tools/_r49-probe.mjs` 实测：
     *   `Title` / `TitleShade` 的 `worldPosition.x` 与卡中线差 **0**，
     *   `horizontalAlign = 1`(CENTER)、`overflow = 0`(NONE)、`anchorX = 0.5`
     *   ⇒ 节点是**精确居中**的，跟"框宽/对齐/x 写错"一点关系都没有。
     *
     * 【剩下唯一的解释：字形】Label 是按「字符 advance 之和」居中的，
     *   而全角「！」的 advance 是 **1 em**、墨迹**只占 0.30 em** ⇒
     *   右侧凭空多出 0.70 em 的空档没被计入 ⇒ 墨迹重心被整体推向左。
     *
     * 【像素实测】`tools/r49-title-ink.py` 在无头截图（1263×2781）上逐列扫墨迹：
     *   「就差一点！」切出 3 段 =
     *     [3.084 em ＝「就差一」三字粘连] [0.911 em ＝「点」] [**0.297 em ＝「！」**]
     *   ⇒ 末字确实只有 0.297 em 的墨迹宽（这就是直接证据）。
     *   墨迹中心相对卡中线 **−28.21 设计 px（=−0.321 em）**，方向与用户观感一致。
     *   对照组 = 卡的金框：间距实测 619.95 ≈ `CARD_W` 620 ⇒ 比例可信
     *   （第一版把"图像换算值"和"设计常量"混着减，量出 +8.61 的系统平移，
     *     被这个对照组当场拦下 —— 见该脚本的注释）。
     *   ⚠️ 胜态那张被金币雨的暗边污染（切出 5 段碎片），量到 +22.57，**不可用**；
     *     两态尾部都是同一个「！」，补偿量相同，故以**负态**为准。
     *
     * 【取值】0.32 em ⇒ 88 × 0.32 = **28.16 设计 px**，与实测 28.21 差 0.05。
     *   ⚠️ 这是**字体度量**标定值（Songti SC）—— 换字体（Android 的 Noto Serif）
     *     会有小幅出入；换字号**不用**改它（按 em 走）。
     *   ⚠️ 只在**尾部**是全角标点时才补；「通关啦」这类不带叹号的不补。
     */
    TITLE_TRAIL_SHIFT_EM: 0.32,
    /**
     * 吉祥物显示**宽**（定宽等比）。
     * ⚠️ 高由素材宽高比决定，见下面的 `MASCOT_H`。
     */
    MASCOT_W: 240,
    /**
     * 吉祥物显示**高** —— 由素材宽高比推出，**不许写死**。
     *   `splash/mascot.png = 960×875`（宽高比 1.0971）⇒ 240 宽对应 **218.9** 高。
     *   旧代码写 `aspectW: 210` 却把占位高当成 250（两者不自洽），实际只占 191，
     *   凭空多出 59 的缝，`cur` 的累加也跟着虚高。
     */
    MASCOT_H: 240 / (960 / 875),
    /**
     * ⚠️ 第 48 轮**已删除** `MASCOT_MT` —— 吉祥物上方的间距现在由 `TITLE_MT` 统一负责。
     *   留着两个名字会让人误以为"标题—吉祥物"之间还有第二段空白，改一个漏一个。
     */
    /** 吉祥物底 → 副标题 的间距 */
    MASCOT_MB: 18,
    DESC_FONT: 28,
    DESC_H: 40,
    DESC_MB: 30,
    REWARD_W: 130,
    REWARD_H: 130,
    REWARD_GAP: 22,
    REWARD_MB: 30,
    BTN_GOLD_H: 100,
    BTN_GOLD_FONT: 40,
    BTN_GOLD_MB: 20,
    BTN_GHOST_H: 76,
    BTN_GHOST_FONT: 28,
    /**
     * ★ 第 58 轮：末排「**返回首页**」按钮。
     *
     * 【为什么必须补这一颗 —— 这是个"出不去"的死角】
     *   加它之前，结算弹层的出口只有：胜态「下一关 / 再玩一次」、负态「看广告复活 / 重新挑战」。
     *   **两态都没有"回首页"** ⇒ 玩家打完一局若不想继续，只能点「下一关」被推着往前走；
     *   负态更糟：不想看广告就只能「重新挑战」，**没有任何退路**
     *   （遮罩是吃触摸的，点空白关不掉）。所以它不是"锦上添花的第三颗"，
     *   而是补上了一个**功能性的缺口**。
     *
     * 【为什么独立成第三排，而不是与次按钮并排】
     *   ① 并排要把 540 宽劈成两半（每颗 260），字号 28 的「重新挑战」占 107 宽还塞得下，
     *      但那样"返回首页"就与"分享 / 重新挑战"**同级**了 —— 语义上它更轻
     *      （是**离开**，不是继续玩），独立成排、排在最后最弱的位置才读得对；
     *   ② 并排要改 `resultButton` 的宽度口径（现在一律 `CARD_W − 80`），
     *      而那个宽度是第 45 轮专门统一过的（旧版上 540/下 460 呈梯形，用户点名报过）。
     */
    BTN_HOME_H: 76,
    /** 次按钮 → 返回首页 的间距 */
    BTN_HOME_MT: 20,
    /**
     * 金币雨单枚显示尺寸（设计 px）。
     *
     * ★ 第 45 轮用户拍板：**放大一倍 + 稍微虚化**，34 → 68。
     *   素材 `splash/coin_rain.png` 136×136（= 68×2）：
     *   1 设计 px = 1264/750 = 1.6853 物理 px ⇒ 68 设计 px = 114.6 物理 px，
     *   136 是 1.19× 过采样，够锐且不吃带宽。
     *   ⚠️ 原始 `coin.png` 只有 112×104，它的 1:1 上限是 112/1.6853 = **66.5 设计 px**；
     *      走柔虚版本正好把这个"超一点点"（1.5px）盖掉。
     */
    COIN: 68,
} as const;

@ccclass('GamePage')
export class GamePage extends PageBase {

    // ---- 数据 ----
    private _level = 1;
    private _def: LevelDef = LEVELS[0];
    private _board: Board | null = null;
    private _views: Array<TileView | null> = [];

    /** 槽位：下标 = 位置，值 = 牌在关卡数据里的下标 */
    private _slots: number[] = [];
    /** 槽位里每个位置的显示节点 */
    private _slotNodes: Array<Node | null> = [];
    /**
     * 「待重排的槽内节点」—— 消除发生到 `relayoutSlots()` 真正执行的 **300ms 窗口期**里，
     * 存活牌的节点先被摘到这里，等重排时按序放回。
     *
     * ⚠️ **为什么需要它**：旧写法让 `relayoutSlots()` 回过头去读 `_slotNodes`，
     *    而调用方在它之前刚把 `_slotNodes` 清空 ⇒ 拿到空表 ⇒ 每一格都新建
     *    **没有 Sprite 的空壳节点**。表现是「消除一次之后，槽里剩下的牌全变成看不见的空位」
     *    （第 45 轮用户实测报「第一个槽里有牌却显示不出来 / 牌像是落在第二个槽」）。
     *    详见 `relayoutSlots()` 的注释。
     */
    private _pendingKeep: Node[] | null = null;
    /** 槽容量（加槽道具 +1，上限 9） */
    private _slotMax = PLAY.SLOT_MAX;

    /**
     * ★ 第 46 轮：**暂存架** —— 「移出」道具的临时 3 格（照搬 game-4）。
     *
     * 【语义（用户拍板 + game-4 口径）】
     *   · 存的是**关卡下标**（与 `_slots` 同口径），不是牌面
     *   · 里面的牌**不参与**「碰 / 吃」成组判定（隔离区）—— 它们在 `_slots` 之外
     *   · 可以**取回主槽**（点一下那张牌）
     *   · **洗牌时整架撒回场上**（见 `releaseTempToBoard`）
     *   · 架子**默认隐藏**，第一次点「移出」才浮现（game-4 的 S14.2b 口径）
     *
     * ⚠️ 这些牌在 `Board` 里仍是 `alive === false`（已离场）——
     *   "移出"不等于"放回牌堆"，只是换个地方放。所以判胜要额外看本数组是否为空。
     */
    private _temp: number[] = [];
    /** 暂存架里每张牌的显示节点（下标与 `_temp` 一一对应） */
    private _tempNodes: Array<Node | null> = [];
    private _tempBar: Node | null = null;

    // ---- 状态 ----
    private _locked = false;
    /** 点按序号 —— 输入锁看门狗的归属校验（见 `onTapTile` 注释） */
    private _lockSeq = 0;
    private _over = false;
    private _paused = false;
    /**
     * ★ 第 52 轮：**应用切到后台**（≠ 弹层暂停）。
     *
     * 【为什么必须与 `_paused` 分开存】`_paused` 的语义是"有弹层开着"。
     *   切后台时玩家可能正开着暂停面板，回到前台那个面板**还得在** ——
     *   两者共用一个标志的话，回前台会把面板状态一并抹掉（"我的暂停面板呢？"）。
     *   所以这位只管"倒计时 / 发呆提示要不要走"，不参与任何 UI 判断。
     */
    private _inBackground = false;
    private _cleared = 0;
    private _timeLeft = 0;
    private _totalTime = 0;
    private _addSlotUsed = 0;

    /**
     * ★ 第 46 轮：【消除】的**就绪态**（armed）。
     *
     * 【用户拍板的口径】「消除按钮原设定是要选定槽里的一张牌，进行强制消除
     *   （剩余多余两张不管）」⇒ 点消除键**不再直接消**，而是进入本状态：
     *   槽内每张牌变成可选，玩家点哪张就消哪张，**只消 1 张**。
     *
     * 【为什么"只消 1 张"要单独写清楚】它打破了"同牌面张数 ≡ 0 (mod 3)"这条不变量
     *   （game-4 正是靠这条不变量才把「消除」做成"消整组 3 张"）。
     *   用户已明确知晓并选择方案 A —— 代价是卡住率上升（这与需求⑥提难度同向）。
     *
     * 【取消路径】再点一次消除键 = 取消（不消耗任何库存）；
     *   槽内牌被清空 / 本局结束 / 离开页面 都会自动复位。
     */
    private _armedErase = false;
    /**
     * ★ 这一次「消除」就绪态是不是**靠库存点开的**。
     *
     * 决定真正消掉那张牌时要不要 `consumeItem()`：
     *   · `true`  —— 玩家用自己的库存点开的 → 生效时扣 1（赠礼优先，其次跨局库存）
     *   · `false` —— 走广告 / 分享拿到的那一次（从没进过库存） → **不扣**
     * 不区分的话，看完广告用掉一次消除会把玩家库存凭空减 1（甚至减成负数）。
     */
    private _eraseFromStock = false;

    // ========================================================
    //  ★ 第 46 轮 · 卡住提示（nudge）—— 照搬 game-4 `CFG.NUDGE` 那一套
    // ========================================================
    //  【用户拍板】「引入 3 秒没消就主动引导看广告换道具」。
    //  【形态】取 game-4 的「无条极简」：**键上金环 + 键上方「点这里 ▼」**，
    //    零遮挡。game-5 的底带被道具栏 / 槽位条 / 暂存架塞满，没有 game-4 那种
    //    "可以临时接管"的导航行（见 CFG.NUDGE 的长注释）。
    //
    //  ⚠️ **只做"指路"，不做"第二条道具路径"** —— 点环 / 点标签最终都走同一个
    //    `useTool(id)`，于是"先查能不能用 → 再要权限（库存 or 广告/分享）→ 才执行"
    //    这条顺序天然被复用，不可能出现"引导环能白拿道具"的漏洞。
    /**
     * "卡住"秒表（秒）。**只在玩家当下真的能动手的那些秒里累加** ——
     * 理由见 `tickNudge()`。开局先给 `NUDGE.START_GRACE` 的负值，用于宽限。
     */
    private _nudgeIdle = 0;
    /** 冷却（秒）—— 调了 `_nudgeIdle` 的同一个心跳一起走 */
    private _nudgeCool = 0;
    /** 这一"轮"是否已经提示过（玩家消掉一组后复位，见 `nudgeReset`） */
    private _nudgeShown = false;
    private _nudgeGlow: Node | null = null;
    /** 当前被罩住的键（`null` = 没提示）—— `refreshTools()` 靠它做"推荐键失效即收环" */
    private _nudgeGlowId: ToolKey | null = null;
    /** 心跳是否已经起过（防重复 schedule） */
    private _nudgeTicking = false;

    // ---- 节点 ----
    private _boardNode: Node | null = null;
    private _slotBar: Node | null = null;
    private _slotCells: Node[] = [];
    private _toolCells: Node[] = [];
    private _toolCounts: Node[] = [];
    private _timerLabel: ReturnType<typeof createLabel> | null = null;
    private _progressG: ReturnType<typeof createGraphicsNode>['g'] | null = null;
    private _progressLabel: ReturnType<typeof createLabel> | null = null;
    private _reviveBadge: Node | null = null;
    private _topLayer: Node | null = null;
    /** 规则页的全局"点任意处关闭"回调（挂在 `input` 上，关闭/离页时必须摘掉） */
    private _ruleTapCb: (() => void) | null = null;

    private _tableScale = 1;

    // ========================================================
    //  构建
    // ========================================================
    protected onBuild(): void {
        this._level = Math.max(1, Math.min(LEVELS.length, this.param<number>('level', 1)));
        this._def = LEVELS[this._level - 1];

        this.buildEnv();
        this.buildTableAndBoard();
        this.buildHud();
        this.buildSlotBar();
        this.buildTempRack();          // ★ 第 46 轮：暂存架（默认隐藏）
        this.buildToolBar();

        this._topLayer = createNode('TopLayer', this.body, { w: 1, h: 1 });

        this.refreshAllStates();
        this.log(`关卡 ${this._level} · ${this._def.n} 张 / ${this._def.layers} 层 / ${this._def.segs.length} 段`);
    }

    /** 离开本页：把挂在**全局 input** 上的规则页兜底监听摘掉（否则会跨页残留） */
    protected onLeave(): void {
        this.detachRuleTap();
        this.hideNudgeGlow();
        // ★ 第 53 轮：**广告流程可能正开着就离页了**（比如超时判负后玩家直接退出）。
        //   不强制结算的话：`_adPanelResolve` 悬着不放、`_paused` 留在 true、
        //   面板节点挂在已销毁的 `_topLayer` 上 ⇒ 下次进主玩页直接全屏点不动。
        this.settleAdPanel('abort');
        this._adBusy = false;
        this.uninstallDebugBridge();
    }

    /**
     * ★ 第 52 轮：小游戏切到后台。
     *
     * 只置后台标志 —— 倒计时与"卡住提示"的计时都会读它
     * （见 `tickTimer` 与 `tickNudge`）。
     *
     * ⚠️ **不碰 `_paused`**：玩家切后台前若正开着暂停 / 规则面板，
     *   回到前台时那个面板得**原样还在**。共用一个标志就会把它抹掉。
     */
    protected onAppHide(): void {
        this._inBackground = true;
        this.log('切到后台 → 倒计时与卡住提示已暂停');
    }

    /** 从后台回来：清掉后台标志，倒计时接着走（不补扣后台那段时间） */
    protected onAppShow(): void {
        this._inBackground = false;
        this.log('回到前台 → 倒计时继续');
    }

    // ---- 环境（第 42 轮换血：桌外底色 = B「织锦经纬」× 1.20）----
    /**
     * 桌外底色 = 「低频渐变（小图拉伸）」+「高频织锦（无缝平铺）」两层。
     *
     * ── 为什么不是一张整页图 ──────────────────────────────
     * 整页 1263×2781 的 PNG 要 3.2 MB，主包红线 4 MB、本轮还要塞一条 BGM
     * ⇒ 只能拆成「程序/小图渐变 + 无缝平铺纹样」，合计 **59 KB**。
     *
     * ── ★ 为什么贴图是「白墨 + 单边 alpha」 ────────────────
     * 定稿（候选 B）的纹样是**加法**：`底色 + v·amp`，幅度绝对恒定。
     * 而 Sprite 只有 normal 混合 `out = dst·(1−a) + src.rgb·a`：
     *   · src 取黑 ⇒ 乘性，底部暗带（底色只有 9）纹样几乎消失 ⇒ 与定稿不符；
     *   · src 取**白** ⇒ `out = dst + a·(255−dst)`。底色很暗（5~30）而 255
     *     远高于它，`255−dst` 整页只变 ±4% ⇒ **近似加法**。
     * 令 `渐变色 = 目标 − D`（D = 纹样峰值幅度）、`a = (dev+D)/denom`，则有
     *     out = (B−D) + a·(255−(B−D)) = B + dev     （dev ∈ [−D, +D]）
     * ⇒ 除「渐变色被钳到 0」的底部暗带外**逐像素等于定稿**。实测：
     *     上带 29.7 / 目标 30.2（幅 36.9 / 35.8）；底部暗带 14.8 / 9.5。
     * 底部那 5.3 的不符是模型固有的（目标在暗带也被钳到 0），
     * 而它换来的收益是**上带逐像素精确** + 不需要自定义材质
     * （3.8 的 `UIRenderer.srcBlendFactor` 已是 deprecated，踩进去是双重不确定性）。
     */
    private buildEnv(): void {
        const vs = this.visible();

        // ① 兜底垫色：两层贴图都是**异步**加载的，就绪前 / 失败时不能一片死黑
        //    （死黑正是本轮要修的东西）。垫色取渐变件最暗那档。
        const { g } = createGraphicsNode('EnvBase', this.body, { w: vs.width, h: vs.height });
        g.fillColor = hex2color('#0A1710', 255);
        g.rect(-vs.width / 2, -vs.height / 2, vs.width, vs.height);
        g.fill();

        // ② 低频渐变层：128×282 的小图拉伸铺满（23 KB）
        //    ⚠️ 用 w/h 显式拉伸（不是 aspectH）：它是「整页缩略」，
        //       宽高比本来就该被拉到与屏幕一致，各向异性在这里是**对的**。
        createSprite(this.body, 'EnvGrad', { path: ASSET.BG_GRAD, w: vs.width, h: vs.height });

        // ③ 高频织锦层：256×256 无缝平铺（36 KB）
        this.buildWeaveLayer(vs);
    }

    /**
     * 织锦平铺层（`Sprite.Type.TILED`）。
     *
     * 【平铺尺度怎么来的】TILED 装配器按**贴图原始像素**在节点局部空间重复
     * （节点 scale=1 时 1 texel = 1 设计 px，见引擎 `assembler/sprite/tiled.ts`
     * 用 `frame.getRect()`）。贴图 256 texel 里排了 **27 个斜纹周期**（整数 ⇒
     * 无缝）⇒ 周期 = 256/27 = 9.4815 设计 px = 15.97 物理 px（定稿 16.0）。
     *
     * ⚠️ 贴图**必须是 2 的整数幂**：引擎 `TextureBase.setWrapMode` 注释写明
     *    「非 2 的整数幂只允许 CLAMP_TO_EDGE」⇒ 非 POT 的 REPEAT 在 WebGL1
     *    （微信小游戏）上直接失效，平铺会退化成「只有一张」。
     * ⚠️ `sf.packable = false`：动态合图会把贴图塞进一张大图，
     *    那样 UV 不再是 [0,1]、REPEAT 失效 —— 同样是"静默变成一张"。
     */
    private buildWeaveLayer(vs: { width: number; height: number }): void {
        const node = createNode('EnvWeave', this.body, { w: vs.width, h: vs.height });
        const sp = node.addComponent(Sprite);
        // 顺序同 createSprite：先定模式 → 再赋贴图 → **最后**写尺寸
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        sp.type = Sprite.Type.TILED;
        node.active = false;                 // 贴图就绪前先隐藏，避免白块闪一下

        loadFrame(ASSET.BG_WEAVE, (sf) => {
            if (!node.isValid) return;
            if (!sf) return;                 // 失败时保持隐藏 ⇒ 露出下面的渐变层
            sf.packable = false;
            const tex = sf.texture;
            if (tex) tex.setWrapMode(Texture2D.WrapMode.REPEAT, Texture2D.WrapMode.REPEAT);
            sp.spriteFrame = sf;
            node.getComponent(UITransform)!.setContentSize(vs.width, vs.height);
            node.active = true;
            console.log(`[GamePage] 织锦平铺层就绪 贴图 ${sf.rect.width}×${sf.rect.height}`
                + ` wrap=${tex ? 'REPEAT' : 'n/a'} 节点 ${vs.width.toFixed(1)}×${vs.height.toFixed(1)}`);
        });
    }

    // ---- 桌子 + 牌堆 ----
    private buildTableAndBoard(): void {
        const box = Layout.tableBox();
        this._tableScale = box.scale;

        const table = createNode('Table', this.body, {
            w: LAYOUT.TABLE_SIZE, h: LAYOUT.TABLE_SIZE, x: 0, y: box.cy,
        });
        table.setScale(v3(box.scale, box.scale, 1));

        // 垫色 + 桌面图（垫色管"图还没加载完的那两帧"和"加载失败"）
        const { g: tg } = createGraphicsNode('Base', table, { w: LAYOUT.TABLE_SIZE, h: LAYOUT.TABLE_SIZE });
        fillRoundRect(tg, 0, 0, LAYOUT.TABLE_SIZE, LAYOUT.TABLE_SIZE, 0, '#12241A', 255);
        createSprite(table, 'Img', { path: ASSET.TABLE, w: LAYOUT.TABLE_SIZE, h: LAYOUT.TABLE_SIZE });

        // 牌堆容器：安全区中心 == 桌面中心，所以直接挂在桌面原点上
        const boardNode = createNode('Board', table, { w: LAYOUT.SAFE_W, h: LAYOUT.SAFE_H });
        this._boardNode = boardNode;

        this.buildTiles(boardNode);
    }

    private buildTiles(parent: Node): void {
        const board = makeBoard(this._def);
        this._board = board;

        const w = this._def.w;
        const h = this._def.h;
        const views: Array<TileView | null> = new Array(board.tiles.length).fill(null);

        // ★ 层级顺序：与排版稿的 `zIndex = 10 + z*10` 同口径 ——
        //   按 (层号, 数据下标) 排序建节点，后建的在上。
        const order = board.tiles.map((t, i) => i)
            .sort((a, b) => (board.tiles[a].z - board.tiles[b].z) || (a - b));

        for (const i of order) {
            const t = board.tiles[i];
            const v = new TileView(parent, `T${i}`, {
                w, h, face: t.face, rot: t.rot,
                x: board.engineX(t), y: board.engineY(t),
            });
            const idx = i;
            v.node.on(Node.EventType.TOUCH_END, () => this.onTapTile(idx), v.node);
            views[i] = v;
        }
        this._views = views;
    }

    // ---- 顶带 HUD ----
    private buildHud(): void {
        // ① 暂停键（40,76 88×88 r26）
        const pause = createNode('Pause', this.body, {
            w: LAYOUT.PAUSE.w, h: LAYOUT.PAUSE.h,
            x: Layout.xOf(LAYOUT.PAUSE.left), y: Layout.hudCenterY(LAYOUT.PAUSE.top, LAYOUT.PAUSE.h),
        });
        const { g: pg } = createGraphicsNode('G', pause, { w: 88, h: 88 });
        fillRoundRect(pg, 0, 0, 88, 88, 26, 'rgba(4,20,14,0.62)', 255);
        strokeRoundRect(pg, 0, 0, 88, 88, 26, 'rgba(246,196,69,0.25)', 2, 255);
        fillRoundRect(pg, -10, 0, 9, 32, 3, 'rgba(255,247,230,0.9)', 255);
        fillRoundRect(pg, 10, 0, 9, 32, 3, 'rgba(255,247,230,0.9)', 255);
        this.tap(pause, () => this.togglePause());

        // ② 关卡胶囊（150,88 h64）—— 文案「第 N 关」，**数字走金色 + 大一号**
        //
        //  【真源】`game-5-主玩页-排版.html` 第 160~163 行的 `.lv`：
        //      .lv{left:150;top:88;height:64;padding:0 32px;font-size:30px;color:var(--cream)}
        //      .lv b{font-size:34px;color:var(--gold-hi);margin:0 6px}
        //    即「第」与「关」是 30 号奶油白、**中间的数字是 34 号金**，且胶囊宽度
        //    由 `padding:0 32px` **自适应**。
        //  ⚠️ 旧代码把整串塞进一个 30 号白 Label、胶囊写死 150 宽 —— 数字完全不突出，
        //    而且关卡号涨到两位数（第 10~30 关）时文字会顶到胶囊左右边。
        //  ⇒ 这里拆成三段 Label 按估算宽度排，胶囊宽度跟着文案走。
        const lvNum = String(this._level);
        // `lvGap` 只给 3：字宽是**估**出来的，估宽会略大于实际字形宽，留 6 会显得松散。
        const lvF = 30, lvNumF = 34, lvGap = 3, lvPad = 30;
        const lvW1 = textW('第', lvF), lvW2 = textW(lvNum, lvNumF), lvW3 = textW('关', lvF);
        const lvInner = lvW1 + lvW2 + lvW3 + lvGap * 2;
        const lvW = Math.round(lvInner + lvPad * 2);
        const pill = createNode('LevelPill', this.body, {
            w: lvW, h: LAYOUT.LEVEL_PILL.h, x: Layout.xOf(LAYOUT.LEVEL_PILL.left) + lvW / 2,
            y: Layout.hudCenterY(LAYOUT.LEVEL_PILL.top, LAYOUT.LEVEL_PILL.h),
        });
        const { g: lg } = createGraphicsNode('G', pill, { w: lvW + 8, h: LAYOUT.LEVEL_PILL.h });
        fillRoundRect(lg, 0, 0, lvW, LAYOUT.LEVEL_PILL.h, LAYOUT.LEVEL_PILL.h / 2,
            'rgba(4,20,14,0.62)', 255);
        strokeRoundRect(lg, 0, 0, lvW, LAYOUT.LEVEL_PILL.h, LAYOUT.LEVEL_PILL.h / 2,
            'rgba(246,196,69,0.25)', 2, 255);
        let lvX = -lvInner / 2;
        const lvSeg = (t: string, f: number, c: string, w: number): void => {
            createLabel(pill, t, {
                fontSize: f, color: c, bold: true, serif: true,
                w: w + 8, h: LAYOUT.LEVEL_PILL.h, x: lvX + w / 2,
            });
            lvX += w + lvGap;
        };
        lvSeg('第', lvF, COLOR.CREAM, lvW1);
        lvSeg(lvNum, lvNumF, COLOR.GOLD_HI, lvW2);
        lvSeg('关', lvF, COLOR.CREAM, lvW3);

        // ③ 复活徽标（344,88 h64）—— 有复活机会才显示
        const rev = createNode('ReviveBadge', this.body, {
            w: 172, h: 64, x: Layout.xOf(LAYOUT.REVIVE.left) + 86,
            y: Layout.hudCenterY(LAYOUT.REVIVE.top, LAYOUT.REVIVE.h),
        });
        const { g: rg } = createGraphicsNode('G', rev, { w: 172, h: 64 });
        fillRoundRect(rg, 0, 0, 172, 64, 18, 'rgba(216,67,47,0.22)', 255);
        strokeRoundRect(rg, 0, 0, 172, 64, 18, 'rgba(216,67,47,0.62)', 2, 255);
        fillRadialGlow(rg, -52, 0, 22, '#D8432F', 255, 10);
        createLabel(rg.node, '复', { fontSize: 26, color: '#FFF4F0', bold: true, serif: true, w: 44, h: 44, x: -52 });
        this._reviveLabel = createLabel(rev, '复活 ×1', {
            fontSize: 24, color: '#FFC7AC', bold: true, w: 110, h: 64, x: 22,
        });
        this._reviveBadge = rev;

        // ④ 倒计时（居中 / top 190 / 42 号）
        this._timerLabel = createLabel(this.body, '--:--', {
            fontSize: FONT.NUM, color: COLOR.CREAM, bold: true, serif: true,
            w: 300, h: 56, x: 0, y: Layout.hudCenterY(LAYOUT.TIMER.top, 56),
        });

        // ⑤ 进度条（40 / 中线 311 / 230×28 r14）
        //
        //  ★「已清 n/m」**嵌在条内**、左内缩 14。
        //  【真源】`game-5-主玩页-排版.html` 第 168、174 行：
        //      /* 进度条 + 条内嵌「已清 n/m」—— 原先文字浮在条上方…已修 */
        //      .progTxt{position:absolute;left:14px;top:0;height:28px;line-height:28px;font-size:19px}
        //  ⚠️ 旧代码把文字放在**条外下方**（`y:-26`）—— 它成了信息行里唯一"下沿突出去"
        //     的元素，整行看着参差不齐（用户反馈的"顶带下沿不齐"主因就在这）。
        //  ⚠️ 文字压在进度填充上 ⇒ 必须带**深色描边**，否则走到浅色填充段就糊了。
        const prog = createNode('Progress', this.body, {
            w: LAYOUT.PROGRESS.w, h: LAYOUT.PROGRESS.h,
            x: Layout.xOf(LAYOUT.PROGRESS.left) + LAYOUT.PROGRESS.w / 2,
            y: Layout.hudCenterY(LAYOUT.PROGRESS.top, LAYOUT.PROGRESS.h),
        });
        this._progressG = prog.addComponent(
            // 动态 require 会让打包器把 Graphics 当外部依赖，所以直接 import
            GraphicsCtor,
        );
        this._progressLabel = createLabel(prog, '已清 0/0', {
            fontSize: 19, color: 'rgba(255,247,230,0.96)', bold: true,
            outline: '#04140F', outlineWidth: 2.5,
            alignLeft: true,
            w: LAYOUT.PROGRESS.w - LAYOUT.PROGRESS_PAD_L - 8, h: LAYOUT.PROGRESS.h,
            x: -LAYOUT.PROGRESS.w / 2 + LAYOUT.PROGRESS_PAD_L, y: 0,
        });

        // ⑥ 规则按钮（right 40 / 中线 311 / 126×60 r30）
        //  【真源】第 184~189 行 `.ruleBtn` 是「**书页图标** + 「规则」文字」：
        //      .ruleBtn{height:60;padding:0 22px 0 18px;gap:9px;font-size:23px}
        //      .ruleBtn svg{width:26px;height:26px}
        //  ⚠️ 旧代码只有「规则」两个字 ⇒ 顶上四个胶囊里它最空、最像占位符。
        //     这里补上用 Graphics 画的摊开书页（画法见 `drawBookGlyph`）。
        const RB = LAYOUT.RULE_BTN;
        const rule = createNode('RuleBtn', this.body, {
            w: RB.w, h: RB.h,
            x: Layout.xOf(DW - RB.right - RB.w) + RB.w / 2,
            y: Layout.hudCenterY(RB.top, RB.h),
        });
        const { g: gg } = createGraphicsNode('G', rule, { w: RB.w, h: RB.h });
        fillRoundRect(gg, 0, 0, RB.w, RB.h, RB.r, 'rgba(4,20,14,0.62)', 255);
        strokeRoundRect(gg, 0, 0, RB.w, RB.h, RB.r, 'rgba(246,196,69,0.25)', 2, 255);
        // 图标：左内缩 18、图标宽 26 ⇒ 图标中心 = −W/2 + 18 + 13
        this.drawBookGlyph(gg, -RB.w / 2 + 31, 0, 26, COLOR.GOLD);
        // 文字：图标右 9 起，到右内缩 22 为止，在这段里居中
        const ruleTxtX = (-RB.w / 2 + 44 + RB.w / 2 - 22) / 2;
        createLabel(rule, '规则', {
            fontSize: 23, color: 'rgba(255,247,230,0.9)', bold: true,
            w: RB.w - 44 - 22, h: RB.h, x: ruleTxtX,
        });
        this.tap(rule, () => this.openRule());

        this.refreshRevive();
    }

    /**
     * 画「摊开的书」图标（规则按钮用）。
     *
     * 【真源】`game-5-主玩页-排版.html` 第 189 行是一个 26×26 的 svg，左右两页镜像：
     *   `M4 4.6A1.6 1.6 0 0 1 5.6 3H10a2 2 0 0 1 2 2v14.2a1.7 1.7 0 0 0-1.7-1.7H4z`
     *   （24 viewBox 里单页 x 4..12 / y 3..19 ⇒ **窄而高、宽高比约 1:2**，这是书页的正确比例。）
     *
     * 【为什么不用两个圆角矩形】实测过：26px 下两个 10.6×22 的圆角矩形描边后
     *   中间 2.4px 的缝会被 1.8px 的线宽吃掉 ⇒ 读起来是**两根竖条**，不是书。
     *   改法有两步：
     *     ① 两页用**梯形**（内侧上端抬高 0.86、下端收 0.80）⇒ 中间自然形成"书脊抬起"的 V；
     *     ② 两页写进**同一条路径的两个闭合子路径**，只 `stroke()` 一次
     *       —— 既不会互相污染（`fill()/stroke()` 作用于整条路径），也没有重复描边。
     */
    private drawBookGlyph(g: Graphics, cx: number, cy: number, size: number, color: string): void {
        const h = size / 2;
        const spine = 1.6;              // 书脊：左右页内边缘的 x（正负对称）
        /** 两个闭合子路径（左右页）—— 写一次，`fill()` 与 `stroke()` 各用一次 */
        const pagePath = (): void => {
            g.moveTo(cx - h, cy + h * 0.60);
            g.lineTo(cx - spine, cy + h * 0.86);
            g.lineTo(cx - spine, cy - h * 0.80);
            g.lineTo(cx - h, cy - h * 0.58);
            g.close();
            g.moveTo(cx + h, cy + h * 0.60);
            g.lineTo(cx + spine, cy + h * 0.86);
            g.lineTo(cx + spine, cy - h * 0.80);
            g.lineTo(cx + h, cy - h * 0.58);
            g.close();
        };
        // ① 先填一层半透明的"纸"——只描边的话，26px 下（DPR1 截图 ≈15 CSS px）
        //    两条 1.9px 的细线几乎贴在一起，会被读成"两根竖条"。给一点体量才认得出是书。
        pagePath();
        g.fillColor = hex2color(color, 62);
        g.fill();
        // ② 再描一次外轮廓（路径重建了一次；`Graphics` 的 fill/stroke 只作用于**新增段**，
        //    所以这里不会把 ① 重复描粗，见 `Impl._updatePathOffset` 的行为）
        pagePath();
        g.lineWidth = 2.0;
        g.strokeColor = hex2color(color, 255);
        g.stroke();
    }

    private _reviveLabel: ReturnType<typeof createLabel> | null = null;

    // ---- 槽位条（47,1058 656×80；8 格 68×80 gap16）----
    private buildSlotBar(): void {
        if (this._slotBar?.isValid) this._slotBar.destroy();
        this._slotCells = [];
        // ⚠️ 一律 `fill(null)`：`refreshSlotDanger()` 用 `=== null` 判空格，
        //    空数组读出来是 `undefined`，会让所有格子都被当成"有牌"（短横全不画）。
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);
        // 旧槽位条已销毁 ⇒ 待排队列里的节点引用全部作废
        this._pendingKeep = null;

        const bar = createNode('SlotBar', this.body, {
            w: LAYOUT.SLOT_BAR.w, h: LAYOUT.SLOT_BAR.h,
            x: Layout.xOf(LAYOUT.SLOT_BAR.left) + LAYOUT.SLOT_BAR.w / 2,
            y: Layout.botY(Layout.BOT.SLOT_C),
        });
        this._slotBar = bar;

        // ★ 第 46 轮修：格宽**按当前容量重算**（原写死 68 + 间距 16）。
        //   写死时 8 格恰好铺满 656（8×68 + 7×16），加槽到 9 格后第 9 格右缘会冲出
        //   屏幕 **37 设计 px** —— 这正是用户截图里右侧红框圈出的那个框。
        //   现口径照 game-4 的 `slotWidth()`：条宽不变，格宽 = (条宽 − 间距×(n−1)) / n。
        const cw = this.slotCellW();
        const gap = LAYOUT.SLOT_CELL.gap;
        for (let i = 0; i < this._slotMax; i++) {
            const left = i * (cw + gap);
            const cell = createNode(`Slot${i}`, bar, {
                w: cw, h: LAYOUT.SLOT_CELL.h,
                x: -LAYOUT.SLOT_BAR.w / 2 + left + cw / 2,
            });
            const { g } = createGraphicsNode('G', cell, { w: cw, h: LAYOUT.SLOT_CELL.h });
            this.paintSlotCell(g, false, true, cw);
            this._slotCells.push(cell);
            this._slotNodes.push(null);
        }
    }

    /**
     * 槽格宽度（**随容量自适应**）—— 与 game-4 的 `slotWidth()` 同口径。
     *
     * 【为什么必须是"重算"而不是"写死"】槽位条宽 `SLOT_BAR.w` 是固定的 656；
     *   8 格时写死的 68+16 恰好铺满，但加槽后第 9 格会直接排在条外
     *   （实测右缘超出条右缘 84 设计 px = 屏幕外 37）⇒ 玩家看到的是
     *   「加槽后新格子跑到屏幕外」，而且**没有任何报错**。
     *
     * 【8 格时结果不变】`(656 − 16×7) / 8 = 68` —— 与旧写死值逐像素相同，
     *   所以这条修改**不会**动到已经验收过的 8 格布局。
     */
    private slotCellW(): number {
        const gap = LAYOUT.SLOT_CELL.gap;
        const n = Math.max(1, this._slotMax);
        return (LAYOUT.SLOT_BAR.w - gap * (n - 1)) / n;
    }

    /**
     * 槽内小牌的**可用框**（跟着格宽缩）。
     *
     * 牌是格子的子节点；格宽从 68 缩到 9 格时的 ~58.7 后，如果仍按写死的 62×74
     * 摆牌，牌会横向顶出格子、压到邻格上。这里按「格宽 − 6」与基准取小。
     * 高度按基准的宽高比等比缩（基准框 62×74 ≈ 0.838），保证不改变牌的观感比例。
     */
    private slotBox(): { w: number; h: number } {
        const w = Math.min(SLOT_BOX.w, this.slotCellW() - 6);
        const k = w / SLOT_BOX.w;
        return { w, h: SLOT_BOX.h * k };
    }

    // ========================================================
    //  ★ 第 46 轮 · 暂存架（「移出」道具的临时 3 格 / 照搬 game-4）
    // ========================================================
    //  【逐条对应 game-4】语义与边界完全照搬，只把几何换成 game-5 的口径：
    //    · 3 格、**默认隐藏**、第一次点「移出」才浮现     → showTempRack()
    //    · 搬走槽内**最靠前的 N 张**（N = min(空位, 3, 槽内张数)）→ toolMove()
    //    · 点架子里的牌 → **取回主槽**（槽满则提示）        → takeFromTemp()
    //    · **不参与**「碰 / 吃」成组判定（隔离区）          → 它们不在 `_slots` 里
    //    · 洗牌时**整架撒回场上**                          → releaseTempToBoard()

    /** 暂存架第 i 格的中心 x（相对屏幕中心） */
    private tempCellX(i: number): number {
        const T = LAYOUT.TEMP_RACK;
        const total = T.count * T.cellW + (T.count - 1) * T.gap;
        return -total / 2 + T.cellW / 2 + i * (T.cellW + T.gap);
    }

    /** 暂存架的纵向中心（引擎 y）—— 用"距底边"口径，跟着底带走 */
    private tempRackY(): number {
        return Layout.botY(LAYOUT.TEMP_RACK.fromBottom);
    }

    /** 主槽位小牌的缩放系数（`_def` 的牌面 → 槽位格的可用框） */
    private slotTileK(): number {
        const box = this.slotBox();
        return Math.min(box.w / this._def.w, box.h / this._def.h);
    }

    /**
     * 暂存架小牌的**尺寸系数**（`_def` 的牌面 → 架格）。
     *
     * ★ 第 47 轮两处修正：
     *   ① **按轴分别留白**。旧写法宽高两条都用 `max(w, h)` 当除数 ⇒ 宽度轴被高估
     *      （牌是竖的，`max` 是它的高）⇒ 格子做窄之后牌会莫名变小。
     *      现在宽除 `_def.w`、高除 `_def.h` —— 与 `slotBox()` / `buildSmallTile` 同一口径。
     *   ② 留白取 **6**：主槽位格「格高 80 / 牌高 74」= 上下各 3px 边距，
     *      这里沿用同一套观感（架格 70 → 牌 64）。
     */
    private smallTileK(cellW: number, cellH: number): number {
        const PAD = 6;
        return Math.min(this.slotTileK(),
            (cellW - PAD) / this._def.w, (cellH - PAD) / this._def.h);
    }

    /**
     * ★★ 第 47 轮修的真 bug：把**主槽位的牌节点**放进暂存架时，该乘的**额外**缩放。
     *
     * 【怎么坏的】`toolMove()` 是把槽内牌节点**原样 reparent** 到架子上（为的是让
     *   "飞过去"的动效连续），而那个节点里的贴图**已经按主槽缩过一次**了
     *   （`buildSmallTile` 里 `_def × slotTileK()`）。旧代码又乘了一个
     *   `smallTileK()` ⇒ 实际缩放 = `slotTileK × smallTileK` ≈ 0.63 × 0.55 = **0.35**，
     *   牌在架子里只剩 **27.6×36.7**（主槽位是 55.7×74，不到一半）。
     *   而 `spawnTempTile()` 那条冷门路径建出来的是 48.1×64 ——
     *   同一张牌走两条路径会得到**两个尺寸**，这正是 bug 能长期藏住的原因。
     *
     * 【正确口径】给"已经缩过一次"的节点补上**两者之比**，即回到统一基准：
     *   `scale = smallTileK / slotTileK` ⇒ 视觉尺寸 = `_def × smallTileK`，
     *   与 `spawnTempTile()` 完全一致。本轮该值 ≈ **0.86**。
     *
     * ⚠️ 它在 1 附近，**不是**可直接乘牌面尺寸的尺寸系数 ——
     *   别拿它去乘 `_def.w/_def.h`，那样会再错一次。
     */
    private tempTileScale(): number {
        const T = LAYOUT.TEMP_RACK;
        return this.smallTileK(T.cellW, T.cellH) / this.slotTileK();
    }

    /** 建暂存架（**默认隐藏**）—— 几何全在 `LAYOUT.TEMP_RACK`（含位置推导） */
    private buildTempRack(): void {
        if (this._tempBar?.isValid) this._tempBar.destroy();
        this._tempNodes = new Array<Node | null>(LAYOUT.TEMP_RACK.count).fill(null);

        const T = LAYOUT.TEMP_RACK;
        const total = T.count * T.cellW + (T.count - 1) * T.gap;
        const bar = createNode('TempRack', this.body, {
            w: total + 160, h: T.cellH + 20, x: 0, y: this.tempRackY(),
        });
        bar.addComponent(UIOpacity).opacity = 255;
        this._tempBar = bar;

        // 3 个格子：与槽位格同一套「深玉底 + 玉绿描边 + 中心短横」
        // （它们都是"装牌的位"，不是可点按钮 —— 金才是可交互语义，见 paintSlotCell）
        for (let i = 0; i < T.count; i++) {
            const cell = createNode(`TempCell${i}`, bar, {
                w: T.cellW, h: T.cellH, x: this.tempCellX(i),
            });
            const { g } = createGraphicsNode('G', cell, { w: T.cellW, h: T.cellH });
            // ★ 第 47 轮：改成与主槽位格**同一套画法**（= `paintSlotCell` 的四层，逐层同序同参）。
            //   旧版少了「顶内缘高光」那一层，而且圆角/线宽写死 ⇒ 三个格子看着是
            //   "三个平铺的方框"，与槽位条不是一套语言。补上后两者才在同一个设计系统里。
            //   （常量也一并改引 `SKIN.SLOT.*`：以后调槽位格的外观，这里自动跟随。）
            const S = SKIN.SLOT;
            fillRoundRect(g, 0, 0, T.cellW, T.cellH, S.RADIUS, S.FILL, 255);
            fillRoundRect(g, 0, T.cellH / 2 - 4, T.cellW - 8, 3, 1.5, S.TOP_LIGHT, 255);
            fillRoundRect(g, 0, 0, S.DASH.w, S.DASH.h, S.DASH.r, S.DASH.color, 255);
            strokeRoundRect(g, 0, 0, T.cellW, T.cellH, S.RADIUS, S.LINE, S.LINE_W, 255);
        }
        // 「暂存」标签（在架子左侧）—— 没有它，玩家只会看到三个空盒子，不知道是干什么的
        createLabel(bar, '暂存', {
            fontSize: 22, color: COLOR.CREAM_MUTE, w: 66, h: 28,
            x: -(total / 2 + T.labelGap + 33),
        });

        bar.active = false;
    }

    /**
     * 让暂存架浮现。**必须在"牌飞出去"之前调** ——
     * 顺序反了会看到"牌飞向一个还不存在的格子"（game-4 `applyMoveOut` 的同款注释）。
     */
    private showTempRack(): void {
        const bar = this._tempBar;
        if (!bar?.isValid || bar.active) return;
        bar.active = true;
        const op = bar.getComponent(UIOpacity) ?? bar.addComponent(UIOpacity);
        op.opacity = 0;
        MotionFx.fadeTo(op, 255, 0.22);
    }

    /**
     * 「小牌」节点的**唯一建法**（主槽位 / 暂存架共用）。
     *
     * ★ 第 47 轮合并：早先 `spawnSlotTile()` 与 `spawnTempTile()` 各建各的，
     *   连**结构都不一样**（槽内 = 节点 + `Img` 子节点挂 Sprite；架内 = Sprite 直接挂节点），
     *   于是两条路径下"尺寸基准"不同 —— 重复缩放那个 bug 正因此能长期藏住
     *   （改哪一条的系数，另一条就错，而且谁都不报错）。
     *   现在统一成「**内容盒 = `slotBox()`、贴图挂 `Img` 子节点、缩放由调用方给**」。
     *
     * 调用方：`spawnSlotTile()`（scale 1）、`spawnTempTile()`（scale = `tempTileScale()`）。
     */
    private buildSmallTile(parent: Node, name: string, face: number): Node {
        const box = this.slotBox();
        const k = this.slotTileK();
        const w = Math.round(this._def.w * k);
        const h = Math.round(this._def.h * k);

        const node = createNode(name, parent, { w: box.w, h: box.h });
        const holder = createNode('Img', node, { w, h });
        const sp = holder.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        holder.active = false;
        loadFrame(spritePathOf(face), (sf) => {
            if (!node.isValid) return;
            if (!sf) {
                // ⚠️ `holder.active = true` 这一句**不能漏**：`drawFallbackFace` 是往 holder 上
                //    画 Graphics，旧代码的架内分支漏了它 ⇒ 贴图缺失时连兜底牌面也一起隐身。
                drawFallbackFace(holder, face, w, h);
                holder.active = true;
                return;
            }
            sp.spriteFrame = sf;
            holder.getComponent(UITransform)!.setContentSize(w, h);
            holder.active = true;
        });
        // 点一下 → 交给 `onTileNodeTap` 按"节点现在住在哪"分派
        // ⚠️ 刻意**不用** `this.tap()` —— 它按下会缩到 0.94，会和入槽那条 1.18 → 1 的
        //    弹入 tween 抢同一条 scale 通道（表现是"新入槽的牌弹到一半被按回去"）。
        node.on(Node.EventType.TOUCH_END, () => this.onTileNodeTap(node), node);
        return node;
    }

    /** 建一张暂存架里的小牌（点一下 = 取回主槽） */
    private spawnTempTile(face: number): Node | null {
        const bar = this._tempBar;
        if (!bar?.isValid) return null;
        const node = this.buildSmallTile(bar, 'TempTile', face);
        // ★ 架格比槽格小 ⇒ 在"已按主槽缩过"的节点上补一个**比值**（见 `tempTileScale`）
        const s = this.tempTileScale();
        node.setScale(v3(s, s, 1));
        return node;
    }

    /**
     * 「小牌节点」（槽内 / 暂存架里的那两种）的**统一点击入口**。
     *
     * ★★ 第 46 轮修的真 bug —— **不改它，暂存架里的牌永远取不回来**。
     *
     * 【怎么坏的】「移出」并不是新建节点，而是把槽内的牌节点**原样 reparent**
     *   到架子上（见 `toolMove` 第 ⑤ 步，为的是让"飞过去"的动效连续）。
     *   于是节点上挂的仍是**建它时**那个 handler ——
     *   `spawnSlotTile()` 注册的是 `onSlotNodeTap()`（只在「消除」就绪态下才动），
     *   在架子里点它 ⇒ 走 `onSlotNodeTap()` ⇒ `if (!this._armedErase) return;`
     *   ⇒ **怎么点都取不回来，而且一声不响**。
     *
     * 【为什么改成"分派"而不是"reparent 时重绑"】重绑要记得在**每一个**
     *   reparent 点上写一遍；漏一处就是同一个静默 bug 换个地方复发。
     *   按"节点现在住在哪"分派，则任何一次 reparent 都天然正确。
     *   （第 46 轮无头验收 `tools/_r46-verify.mjs` ②段用真实鼠标点出来的
     *     正是这一条：当时"暂存架 3 → 3"，一点没动。）
     */
    private onTileNodeTap(node: Node): void {
        if (this._tempNodes.indexOf(node) >= 0) this.onTempTileTap(node);
        else this.onSlotNodeTap(node);
    }

    /** 把暂存架里的牌重排到前几格（取回一张之后补位） */
    private relayoutTemp(): void {
        // ★ 第 47 轮：架内节点都**带主槽位那一层缩放**（见 `buildSmallTile`），
        //   所以这里要的是**比值**而不是尺寸系数 —— 与 `toolMove` 第 ⑦ 步同源。
        const k = this.tempTileScale();
        for (let i = 0; i < this._temp.length; i++) {
            const nd = this._tempNodes[i];
            if (!nd?.isValid) continue;
            tween(nd).to(0.18, {
                position: v3(this.tempCellX(i), 0, 0), scale: v3(k, k, 1),
            }, { easing: 'quadOut' }).start();
        }
    }

    private onTempTileTap(node: Node): void {
        if (this._over || this._paused) return;
        const i = this._tempNodes.indexOf(node);
        if (i < 0) return;
        this.takeFromTemp(i);
    }

    /**
     * **从暂存架取回一张 → 放回主槽**（照搬 game-4 的 `takeFromTemp`）。
     *
     * 边界：**槽满时拒绝并提示**（game-4 原文案「槽位已满，先消掉几张再取回」）——
     *   这里不能默默丢弃，否则玩家的牌就凭空消失了。
     */
    private takeFromTemp(i: number): void {
        const board = this._board;
        if (!board) return;
        const tileIdx = this._temp[i];
        if (tileIdx === undefined) return;

        if (this._slots.length >= this._slotMax) {
            toast(this.body, '槽位已满，先消掉几张再取回');
            return;
        }

        const node = this._tempNodes[i];
        if (node?.isValid) node.destroy();
        this._temp.splice(i, 1);
        this._tempNodes.splice(i, 1);
        this._tempNodes.push(null);
        this.relayoutTemp();

        // 入主槽（数据 + 视觉），随后走与"从牌堆拿牌"同一条判定链
        this._slots.push(tileIdx);
        this.placeSlotTile(this._slots.length - 1, board.tiles[tileIdx].face);
        this.refreshSlotDanger();
        this.log(`暂存取回：牌 #${tileIdx} → 槽内第 ${this._slots.length - 1} 位`);
        // 取回之后可能**立刻**就能消（架子那张正好补上缺口）
        this.timer(180, () => this.resolveMatch());
    }

    /**
     * **整架撒回场上**（洗牌时调 —— 照搬 game-4 `applyShuffle` 的第一步）。
     *
     * 【为什么必须撒回去】架子里的牌本来就能取回，把"场上 + 架子"当成两拨
     *   会让洗牌只解决一半问题；而且它们**不参与成组**，留在架子里
     *   会让玩家觉得"洗了还是老的局面"。
     */
    private releaseTempToBoard(): void {
        const board = this._board;
        if (!board || this._temp.length === 0) return;
        for (const idx of this._temp) {
            board.restore(idx);
            const v = this._views[idx];
            const t = board.tiles[idx];
            if (v && t) v.resetToBoard(board.engineX(t), board.engineY(t));
        }
        for (const nd of this._tempNodes) if (nd?.isValid) nd.destroy();
        this._temp = [];
        this._tempNodes = new Array<Node | null>(LAYOUT.TEMP_RACK.count).fill(null);
    }

    /**
     * 暂存架是否还有牌 → 本局**不能判胜**。
     *
     * 【为什么单独一条】这些牌在 `Board` 里是 `alive=false`（已离场），
     *   所以 `board.remaining === 0` 时它们**不在统计里** ——
     *   不加这条就会出现"牌堆空了就判胜，可架子里的牌还没消"的错判。
     *   同理也不判负：玩家还能把它们取回来凑组（见 `checkBoardEmpty`）。
     */
    private get tempLeft(): number { return this._temp.length; }

    /**
     * 画一个槽位格（**只画底**，牌是它上面的子节点）。
     *
     * 【逐值来源】`game-5-主玩页-排版.html` 的 `.slot` / `.slot.empty::after`：
     *   .slot{width:68px;height:80px;border-radius:10px;
     *         background:rgba(4,20,14,.5);border:2px solid rgba(46,139,111,.30);
     *         box-shadow:inset 0 2px 0 rgba(255,255,255,.05)}
     *   .slot.empty::after{content:"";width:22px;height:2px;border-radius:1px;
     *                      background:rgba(46,139,111,.34)}
     *
     * ⚠️ 改前这里是**整套偏离真源**的：奶油白底 `rgba(255,247,230,.10)` + **金**描边
     *   + 圆角 16，而且**没有中心短横** —— 真机截图里那排"空无一物的灰盒子"就是它。
     *   真源是「深玉底 + 玉绿描边」，属**冷色**、与桌面绒布同族；金线才是外来色
     *   （金是"可交互/奖励"的语义，不该用在一排静态占位框上）。
     *
     * 【为什么短横可以常驻、不用在放牌时重画】
     *   牌是格子的子节点，尺寸 62×74 而短横只有 22×2 且在正中 ⇒ 有牌时被完全盖住、
     *   牌被消掉后自动重新露出来。所以只需在构建时画一次。
     */
    private paintSlotCell(
        g: ReturnType<typeof createGraphicsNode>['g'], danger: boolean, empty: boolean,
        cw: number = LAYOUT.SLOT_CELL.w,
    ): void {
        g.clear();
        const w = cw;
        const h = LAYOUT.SLOT_CELL.h;
        const S = SKIN.SLOT;
        fillRoundRect(g, 0, 0, w, h, S.RADIUS, danger ? S.DANGER_FILL : S.FILL, 255);
        // 顶内缘高光（真源 `inset 0 2px 0`）—— 先画，后面描边会把它两端压住，不会戳出圆角
        fillRoundRect(g, 0, h / 2 - 4, w - 8, 3, 1.5, S.TOP_LIGHT, 255);
        if (empty && !danger) {
            fillRoundRect(g, 0, 0, S.DASH.w, S.DASH.h, S.DASH.r, S.DASH.color, 255);
        }
        strokeRoundRect(g, 0, 0, w, h, S.RADIUS,
            danger ? S.DANGER_LINE : S.LINE, S.LINE_W, 255);
    }

    // ---- 道具栏（87,1150 576×112；4 格 126×112 gap24）----
    private buildToolBar(): void {
        const bar = createNode('ToolBar', this.body, {
            w: LAYOUT.TOOL_BAR.w, h: LAYOUT.TOOL_BAR.h,
            x: Layout.xOf(LAYOUT.TOOL_BAR.left) + LAYOUT.TOOL_BAR.w / 2,
            y: Layout.botY(Layout.BOT.TOOL_C),
        });

        const cw = LAYOUT.TOOL_CELL.w;
        const gap = LAYOUT.TOOL_CELL.gap;
        this._toolCells = [];
        this._toolCounts = [];

        TOOL_ORDER.forEach((id, i) => {
            const left = i * (cw + gap);
            const cell = createNode(`Tool_${id}`, bar, {
                w: cw, h: LAYOUT.TOOL_CELL.h,
                x: -LAYOUT.TOOL_BAR.w / 2 + left + cw / 2,
            });

            const { g } = createGraphicsNode('Face', cell, { w: cw, h: LAYOUT.TOOL_CELL.h });
            // 底 + 图标（图标异步加载，先画底）
            fillRoundRect(g, 0, 0, cw, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS, SKIN.TOOL.FILL, 255);
            strokeRoundRect(g, 0, 0, cw, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS, SKIN.TOOL.LINE, 2, 255);

            // 图标：真源 `.item img{width:78px;height:78px}` —— 改前只有 60，格子里空得很。
            //   格高 112，底部要留 ~30 给文字 ⇒ 图标可用带只有 82 高。
            //   取 74（而不是写死 78）是为了让图标顶部离格顶留 6、底部离文字留 2，
            //   整格视觉重心略上移，看起来"装得满"又不挤。
            createSprite(cell, 'Icon', { path: TOOL_ICON[id], aspectW: SKIN.TOOL.ICON_W, y: 13 });
            createLabel(cell, TOOL_META[id].name, {
                fontSize: 19, color: 'rgba(201,216,204,0.72)', w: cw, h: 22, y: -37,
            });

            // 角标（数量 / ＋）：真源 `.cnt{min-width:42px;height:42px;border-radius:21px;
            //   right:-6px;top:-6px;font-size:25px;color:#4A2B18}` ⇒ 中心比格右上角再外扩 6
            const B = SKIN.TOOL.BADGE;
            const cnt = createNode('Cnt', cell, {
                w: B, h: B,
                x: cw / 2 + 6 - B / 2,
                y: LAYOUT.TOOL_CELL.h / 2 + 6 - B / 2,
            });
            const { g: cg } = createGraphicsNode('G', cnt, { w: B, h: B });
            fillRoundRect(cg, 0, 0, B, B, B / 2, '#C8912B', 255);
            strokeRoundRect(cg, 0, 0, B, B, B / 2, 'rgba(246,196,69,0.7)', 1.5, 255);
            createLabel(cnt, '0', {
                fontSize: SKIN.TOOL.BADGE_FONT, color: SKIN.TOOL.BADGE_TEXT,
                bold: true, w: B, h: B,
            });
            this._toolCounts.push(cnt);

            this.tap(cell, () => this.useTool(id));
            this._toolCells.push(cell);
        });

        this.refreshTools();
    }

    // ========================================================
    //  状态刷新（**唯一真源是 Board.pickable()**）
    // ========================================================
    private refreshAllStates(): void {
        const board = this._board;
        if (!board) return;

        const pickable = new Set(board.pickable());
        for (let i = 0; i < board.tiles.length; i++) {
            const v = this._views[i];
            if (!v) continue;
            const t = board.tiles[i];
            if (!t.alive) { v.setVisible(false); continue; }
            v.setVisible(true);
            v.setState(pickable.has(i) ? 'pick' : 'cover');
        }

        if (DEBUG.LOG_PICKABLE) {
            this.log(`可点 ${pickable.size} 张 · 桌上剩 ${board.remaining} · 当前段 ${board.activeSeg}`);
        }
    }

    private refreshProgress(): void {
        const board = this._board;
        if (!board) return;
        const total = this._def.n;
        const done = this._cleared;
        if (this._progressG) {
            // 填充色 = 真源 `.progFill{background:linear-gradient(90deg,var(--jade),var(--jade-hi));
            //   box-shadow:inset 0 0 12px rgba(85,183,154,.5)}`（第 171~173 行）。
            // ⚠️ 改前写的是 `COLOR.GOLD_HI, COLOR.GOLD` —— 金渐变。金在本作是
            //   "奖励/可交互"语义，而进度条讲的是"我已清掉多少牌"，该用玉绿主色。
            drawProgressBar(this._progressG, done / total, LAYOUT.PROGRESS.w, LAYOUT.PROGRESS.h,
                LAYOUT.PROGRESS.r, 'rgba(255,247,230,0.12)', COLOR.JADE, COLOR.JADE_HI);
        }
        if (this._progressLabel?.isValid) {
            this._progressLabel.string = `已清 ${done}/${total}`;
        }
    }

    // ★ 道具库存 = **两本账合起来看**（本局赠礼 + 跨局库存）。
    //   策略与推导全部在 `core/ItemStock.ts`，本页只调用 —— 那样它能离线确定性自证，
    //   也不会被 UI 层再实现一遍（第 57 轮三的 bug 正是"只看了半本账"）。
    private refreshTools(): void {
        TOOL_ORDER.forEach((id, i) => {
            const n = itemStock(id);
            // ★ 第 46 轮：「消除」处于就绪态时键面转金（金 = 可交互 —— 见 setArmedErase）；
            //   "亮 / 暗" 改由 `propBlockReason()` 单一真源决定（不再自己判一遍）。
            const armed = id === TOOL.ERASE && this._armedErase;
            const on = (this.propBlockReason(id) === null) || armed;
            const label = this._toolCounts[i]?.getComponentInChildren(
                // 角标里的 Label 是唯一子节点
                LabelCtor,
            );
            if (label) label.string = n > 0 ? String(n) : '＋';
            const cell = this._toolCells[i];
            if (!cell) return;
            const g = cell.getComponentInChildren(GraphicsCtor);
            // 只重画"底 + 描边"（图标是 Sprite 子节点，不在这里）
            void g;
            const face = cell.getChildByName('Face')?.getComponent(GraphicsCtor);
            if (face) {
                face.clear();
                face.fillColor = hex2color(on ? SKIN.TOOL.FILL : SKIN.TOOL.FILL_EMPTY);
                face.roundRect(-LAYOUT.TOOL_CELL.w / 2, -LAYOUT.TOOL_CELL.h / 2,
                    LAYOUT.TOOL_CELL.w, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS);
                face.fill();
                const lineColor = armed ? COLOR.GOLD : (on ? SKIN.TOOL.LINE_ON : SKIN.TOOL.LINE);
                face.lineWidth = armed ? 3 : 2;
                face.strokeColor = hex2color(lineColor);
                face.roundRect(-LAYOUT.TOOL_CELL.w / 2, -LAYOUT.TOOL_CELL.h / 2,
                    LAYOUT.TOOL_CELL.w, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS);
                face.stroke();
            }
            cell.setSiblingIndex(TOOL_ORDER.length - 1);   // 保持顺序不变（占位，防意外乱序）
        });

        // ★ 第 46 轮：**推荐键中途变得不可用 → 立刻收环**（game-4 `refreshPropBar` 的同款守卫）。
        //   不守这一条的话会出现"金环还在招呼你点，点了却弹一句「暂存架已经满了」"——
        //   提示语比错误提示更伤信任。
        if (this._nudgeGlowId && this.propBlockReason(this._nudgeGlowId) !== null) {
            this.hideNudgeGlow();
        }
    }

    private refreshRevive(): void {
        const left = reviveLeft();
        if (this._reviveBadge?.isValid) this._reviveBadge.active = left > 0;
        if (this._reviveLabel?.isValid) this._reviveLabel.string = `复活 ×${left}`;
    }

    // ========================================================
    //  核心：点牌 → 飞入槽位 → 成组判定
    // ========================================================
    private onTapTile(idx: number): void {
        if (this._locked || this._over || this._paused) return;
        const board = this._board;
        if (!board) return;

        // ① 必须走到 Board 的真源判定上（视觉是它的派生，不能反过来信视觉）
        if (!board.pickable().includes(idx)) {
            const v = this._views[idx];
            if (v) MotionFx.shake(v.node, 4, 2, { tag: 'deny' });
            return;
        }
        if (this._slots.length >= this._slotMax) return;

        this._locked = true;
        const slotIdx = this._slots.length;
        // ★ 输入锁**看门狗**：正常路径由 `flyTileToSlot` 的回调在 ~280ms 解锁，
        //    但"回调链路某处没跑到"这类故障一旦发生，`_locked` 就永远为 true
        //    ⇒ 表现是"整局再也点不动任何牌"，而且**完全不报错**（最坏的一类故障）。
        //    这里兜一道底：宁可放过一次连点，也不能让整局卡死。
        // ⚠️ 必须带**归属校验**：看门狗是按"第几次点按"发的，
        //    若不带 `seq`，第一次点按的看门狗会把**第二次**刚拿到的锁误清掉
        //    （两把锁共用一个 `_locked` 布尔），于是连点保护直接失效。
        //    兜底时间取正常路径的 4 倍 —— 只抓真故障，绝不与正常解锁抢先后。
        const seq = ++this._lockSeq;
        this.timer(INPUT_LOCK * 4, () => {
            if (this._locked && this._lockSeq === seq) this._locked = false;
        });

        // ② **数据先行**：立刻入槽与出牌，视觉在飞
        board.pick(idx);
        this._slots.push(idx);
        const face = board.tiles[idx].face;

        AudioService.playSfx(SFX.tilePick, 0.85);
        Haptics.light();

        this.flyTileToSlot(idx, slotIdx, face, () => {
            this._locked = false;
            this.refreshAllStates();
            this.refreshProgress();
            this.resolveMatch();
        });
    }

    /** 把牌从桌上飞到槽位（三段：飞出 → 落位 → 判定） */
    private flyTileToSlot(idx: number, slotIdx: number, face: number, done: () => void): void {
        const view = this._views[idx];
        const boardNode = this._boardNode;
        const cell = this._slotCells[slotIdx];
        if (!view || !boardNode || !cell) {
            // 兜底：视觉缺一环也不能卡住数据（否则整局再也点不动）
            this.timer(300, done);
            return;
        }

        // 目标点：把槽位格的**世界坐标**换算到牌堆容器的局部坐标
        const world = cell.getWorldPosition();
        const local = boardNode.getComponent(UITransform)!.convertToNodeSpaceAR(world);
        // 目标缩放：槽内小牌尺寸 / 牌体尺寸；再除以桌面缩放（牌堆被整体缩过）
        const box = this.slotBox();
        const k = Math.min(box.w / this._def.w, box.h / this._def.h) / this._tableScale;

        const node = view.node;
        // 横牌在飞的过程中转正（槽内小牌一律正立），与排版稿的 `transform:scale(.55)` 同口径
        node.angle = 0;
        view.setState('lock');

        const from = node.position.clone();
        const to = v3(local.x, local.y, 0);
        MotionFx.stop(node, 'fly');
        tween(node)
            .to(0.10, { position: v3(from.x, from.y + 34, 0) }, { easing: 'quadOut' })
            .to(0.16, { position: to, scale: v3(k, k, 1) }, { easing: 'quadIn' })
            .start();

        this.timer(280, () => {
            if (!node.isValid) { done(); return; }
            node.active = false;
            this.placeSlotTile(slotIdx, face);
            done();
        });
    }

    /**
     * 在槽位格里放一张小牌（**入槽路径专用**，带弹入动效）。
     * 重排（`relayoutSlots`）复用底下的 `spawnSlotTile()`，两者**必须是同一套建法** ——
     * 早先就是"入槽会贴图、重排不贴图"的分叉，才有了那个静默的空白槽 bug。
     */
    private placeSlotTile(slotIdx: number, face: number): void {
        // 清掉旧的（理论上这个格是空的）
        const old = this._slotNodes[slotIdx];
        if (old?.isValid) old.destroy();

        const node = this.spawnSlotTile(slotIdx, face);
        if (!node) return;

        // 落位动效（小幅弹入）
        node.setScale(v3(1.18, 1.18, 1));
        tween(node).to(0.16, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        const op = node.addComponent(UIOpacity);
        op.opacity = 200;

        this._slotNodes[slotIdx] = node;
        // ★ 若正处于「消除 → 重排」的窗口期，这张新牌要登记到待排队列**尾部**，
        //    否则会被 `relayoutSlots()` 当成多余节点销毁，然后重建出一个空壳。
        if (this._pendingKeep) this._pendingKeep.push(node);
        this.refreshSlotDanger();
    }

    /**
     * 建一张「槽内小牌」节点（贴图异步加载）。**唯一的建法** ——
     * `placeSlotTile()`（入槽）与 `relayoutSlots()`（重排）都走它。
     */
    private spawnSlotTile(slotIdx: number, face: number): Node | null {
        const cell = this._slotCells[slotIdx];
        if (!cell) return null;
        const box = this.slotBox();
        // ★ 第 47 轮：建节点的那一大段合并进 `buildSmallTile()`（与架内小牌**同一份**）。
        //   以前这里另写一遍，正是"两条路径缩放基准不同"的温床。
        const node = this.buildSmallTile(cell, `SlotTile${slotIdx}`, face);

        // 就绪态中途入槽的牌也要补上可选环（否则它看着"不能选"）
        if (this._armedErase) {
            const { g: rg } = createGraphicsNode('ArmedRing', node, { w: box.w, h: box.h });
            strokeRoundRect(rg, 0, 0, box.w + 8, box.h + 8, 12, COLOR.GOLD, 3, 255);
        }
        return node;
    }

    /**
     * 摘出**不会被这次消除波及**的槽内节点，按数据顺序返回。
     *
     * ⚠️ 必须在 `_slots` / `_slotNodes` 被改动**之前**调用 —— 它按旧下标读 `_slotNodes`
     *    （那种"先改数据、再回头找视觉"的写法就是这次 bug 的成因）。
     */
    private takeSurvivors(gone: number[]): Node[] {
        const out: Node[] = [];
        for (let i = 0; i < this._slots.length; i++) {
            if (gone.includes(i)) continue;
            const n = this._slotNodes[i];
            if (n?.isValid) out.push(n);
        }
        return out;
    }

    private refreshSlotDanger(): void {
        const danger = this._slots.length >= this._slotMax - 1;
        const cw = this.slotCellW();
        this._slotCells.forEach((c, i) => {
            const g = c.getChildByName('G')?.getComponent(GraphicsCtor);
            // 第 3 参 = 本格是否为空（决定画不画中心短横）—— 真源里短横只属于 `.slot.empty`
            if (g) this.paintSlotCell(g, danger && this._slots.length > 0, this._slotNodes[i] === null, cw);
        });
    }

    /** 成组判定与消除 */
    private resolveMatch(): void {
        if (this._over) return;
        const board = this._board;
        if (!board) return;

        const faces = this._slots.map((i) => board.tiles[i].face);
        const m = findMatch(faces, this._slots.length - 1);

        if (!m) {
            // 没成组 → 看是不是该判负
            if (this._slots.length >= this._slotMax) {
                // ★★ 第 48 轮：**不再直接 `onFail`** —— 槽满且牌堆已空时判**胜**。
                //   判定条件与文案都在 `settleSlotsFull()` 里（与 checkBoardEmpty 同源）。
                this.timer(240, () => this.settleSlotsFull());
            } else if (this._slots.length >= this._slotMax - 1) {
                toast(this.body, `⚠ 槽位将满 —— 再入 1 张且不能成组即失败`);
                AudioService.playSfx(SFX.slotWarn, 0.9);
            }
            this.checkBoardEmpty();
            return;
        }

        // 成组：碰 / 吃
        const gone = m.indices.slice();
        // ⚠️ 用 `m.type`（'peng'|'chi'）—— 曾把这里写成 `m.kind`，
        //    `undefined === 'peng'` 恒为假，于是**所有"碰"都被显示成"吃"**且不报错。
        // ★ 第 59 轮：飘字 / 人声念白 / 触感**一律搬到了撞击帧**（见 `onClash`），
        //   不再在这里播。理由见 `onClash` 第 ① 条 —— 留在 t=0 会出现
        //   "人声先喊、牌 200ms 后才撞上"的错位，而 game-4 的节奏是"咚——唰"。
        //    （`m.type` 仍是唯一真源，`onClash` 收的是同一个值。）

        // ★ 第 46 轮：成组消除 = "这一轮卡住"到此结束 → 秒表归零 + 立刻收掉引导环。
        //    ⚠️ 它改的是**状态**（提示计时），不是视觉 ⇒ 必须留在 t=0，
        //       不能跟着飘字一起挪到 200ms 后（否则引导环会多亮 200ms）。
        this.nudgeReset();

        // ★ 摘出**不会被消掉的**槽内节点，交给 300ms 后的重排 ——
        //    必须在 `_slots` / `_slotNodes` 改动**之前**（见 `takeSurvivors` / `relayoutSlots`）。
        //    ⚠️ 这一步早先漏了，直接导致"消除一次之后槽里剩下的牌全部变空白"。
        this._pendingKeep = this.takeSurvivors(gone);

        // 再从数据里摘掉（**立即**，不等动画）
        this._slots = this._slots.filter((_, i) => !gone.includes(i));
        this._cleared += gone.length;
        // ★ 第 46 轮：槽被清空时就绪态自动失效（否则键面一直亮着"等你选牌"，但没牌可选）
        if (this._armedErase && this._slots.length === 0) this.setArmedErase(false);

        // ★ 第 59 轮新增：**消除动效期间锁输入**。
        //
        // 【为什么必须加】动效时长从"旧实现的 300ms"变成 `CLASH_TOTAL_MS`(≈516ms)，
        //   而这 516ms 里 `_locked` 一直是 false（点牌那把锁在飞行动效收尾时就交了）。
        //   窗口期内玩家再点一张，`placeSlotTile()` 会按 `_slots.length` 选格 ——
        //   但此刻**存活的那几张牌还坐在它们的旧格子里**（要等 516ms 才重排），
        //   于是新牌可能被放进"某个存活牌正占着的格子"，两张牌叠在一起约 200ms
        //   才被重排解开。属于"看着像渲染 bug"的那类瑕疵。
        //   game-4 用 `_busy = true` 覆盖整段动效，本作照此加锁。
        //
        // ⚠️ 必须走 `_lockSeq` 的**归属校验**：`_locked` 是一个共用布尔，
        //    而"上次点牌"那条看门狗（`INPUT_LOCK × 4`）也可能来清它。
        //    不自增序号的话，看门狗会把动效这把锁提前放掉（在 INPUT_LOCK 较小时就会发生）。
        // ⚠️ 解锁只写在 `CLASH_TOTAL_MS` 那个定时器里（见下）——
        //    失败路径也走同一个定时器，不存在"锁了没人放"的分支。
        this._locked = true;
        const clashSeq = ++this._lockSeq;

        // ============================================================
        //  视觉：蓄力 → 冲刺 → 撞击 → 停一拍 → 释放
        //  ★ 第 59 轮：逐值照抄隔壁项目 game-4 的 `playClashClear()`，
        //    「碰 / 吃」共用同一套（与 game-4 的现状一致 —— 它那边已经
        //    把"吃"的咀嚼动效停用了，两种牌型走同一条撞击链）。
        // ============================================================
        //
        // ★ 第 0 步（**必须最先做，且必须在 `_slotNodes` 被清空之前**）：
        //   把这三张牌从**槽格 `Slot{i}`** 摘到**槽位条 `SlotBar`** 上。
        //
        //   · 为什么必须摘：`relayoutSlots()` 里有一句「清掉所有格子里
        //     **不在队列中**的 SlotTile」—— 而收尾用的是全新的 `_slotNodes`（全 null），
        //     待消的这三张**不可能**在队列里 ⇒ 它们一定会被当场销毁。
        //     旧实现之所以把销毁卡在 280ms、重排卡在 300ms，就是在绕开这件事，
        //     代价是"牌还没炸完就被抹掉"。
        //   · 为什么摘到**槽位条**而不是别处：那里有正确的坐标系 ——
        //     所有槽格的中心都在条内的 y=0 上、横向间距就是 `slotCellW()`，
        //     于是"三张牌朝中心靠拢"这条几何可以**直接用槽位自己的单位**表达。
        //     它同时也天然盖在槽格之上、弹层（`_topLayer`）之下。
        //   · `setParent(parent, keepWorldTransform)` 的第二参在 Creator 3.x 的
        //     TS 定义里是**必填**的，必须显式写 `true`；漏了它牌会瞬间跳位
        //     （局部坐标被当成世界坐标用）。
        const bar = this._slotBar;
        const doomed: Node[] = [];
        if (bar?.isValid) {
            for (const si of gone) {
                const n = this._slotNodes[si];
                if (!n?.isValid) continue;
                n.setParent(bar, true);
                doomed.push(n);
            }
        }

        if (doomed.length > 0) {
            this.playClash(doomed, m.type);
        } else {
            // 兜底（理论上不可达）：槽位条缺失或三张牌都没节点 ⇒ 退回最朴素的淡出，
            // 数据链路绝不能因为"视觉缺一环"而卡住（否则整局再也点不动）。
            for (const si of gone) {
                const n = this._slotNodes[si];
                if (!n?.isValid) continue;
                const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
                MotionFx.fadeTo(op, 0, 0.2);
                const dead = n;
                this.timer(240, () => { if (dead.isValid) dead.destroy(); });
            }
        }

        // ⚠️ 必须是 `fill(null)` 而不是 `[]`：`refreshSlotDanger()` 靠 `=== null` 判"空格"，
        //    空数组读出来的是 `undefined`，会让**所有格子都被当成"有牌"**（短横不画）。
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);
        this.timer(CLASH_TOTAL_MS, () => {
            // ① 先放锁：动效跑完了，玩家该能继续点牌（哪怕下面几步抛异常也不能把锁留下）
            if (this._locked && this._lockSeq === clashSeq) this._locked = false;
            // ② 三张"已消"的牌此刻已缩到 0 并淡透 —— 从槽位条上**真正删掉**它们。
            //    ⚠️ 必须自己删：它们已被摘出槽格，而 `relayoutSlots()` 只管
            //       **格子里**的孩子（那句"清掉不在队列中的 SlotTile"够不到它们）。
            //       漏掉这一步的表现是"槽位条上多了三张看不见的幽灵节点"，
            //       平时没事，但它们会一直挂在条上、还会挡住后面弹出的命中区。
            for (const n of doomed) if (n.isValid) n.destroy();
            // ③ 数据收尾（与旧实现逐字相同，只是等的时间从 300ms 变成动效总时长）
            this.relayoutSlots();
            this.refreshProgress();
            SaveService.instance.addCleared(gone.length);
            this.checkBoardEmpty();
            this.refreshSlotDanger();
        });
    }

    /**
     * 「碰 / 吃」的**撞击**：蓄力 → 冲刺 → 撞上 → 停一拍 → 释放。
     *
     * 【为什么旧版不够"撞"】
     *   旧版的三张牌**从头到尾都待在自己的槽格里**：各自放大 1.45 倍、转 14°、淡出。
     *   也就是说它们之间从来没有发生过任何**空间关系** ——
     *   玩家看到的是"三张牌各自胀了一下"，而不是"三张牌撞到了一起"。
     *   差距全在下面这条时间轴上，而不在"幅度够不够大"。
     *
     * 【时间轴】（`MOTION` 里的常量，一个数都不许凭手感改 —— 改了就不再"表现一致"）
     *   t=0           蓄力：三张牌朝**远离中心**的方向各退 `CLASH_PULLBACK`(12) px
     *   t=90ms        冲刺：`EASE.DASH`(quadIn) 加速朝中心猛冲，
     *                 撞上后的中心间距压到 `槽格宽 × CLASH_OVERLAP`(0.45)
     *   t=200ms       ★ 撞击帧：挤压 + 冲击圆环 + 每张牌喷碎屑 + 牌堆上踢
     *                           + 人声念白 + 中档震动 + 飘字（见 `onClash`）
     *   t=260ms       停一拍（`POP_HOLD` 60ms）
     *   t=260ms 起    释放：先胀到 1.20，再收缩到 0 并淡出
     *   t=500ms       数据收尾 → 判胜负（由 `resolveMatch` 的 `CLASH_TOTAL_MS` 定时器接）
     *
     * 【为什么"撞击"必须是 quadIn 而不是 quadOut】
     *   quadOut 冲到终点时会减速，看起来像"小心翼翼地靠拢"；
     *   quadIn 是越冲越快、到位即最高速 —— 那才是撞上去。
     *
     * 【为什么撞完要"停一拍"】
     *   撞击与消散直接连起来，玩家只记得"闪了一下"。
     *   停 60ms 让"撞"和"散"成为两件可以被分别记住的事 ——
     *   这是消除类游戏通用的一条节奏经验：先顿一下，再消失。
     *
     * @param doomed 待消的三张牌。**已经被摘到槽位条上**，所以它们的
     *               `position` 已经是槽位条坐标系里的值（y 恒为 0）。
     */
    private playClash(doomed: Node[], type: MatchType): void {
        const bar = this._slotBar;
        if (!bar?.isValid) return;

        const n = doomed.length;
        // 撞击中心 = 这几张牌当前位置的平均值。它们此刻都躺在槽位条的 y=0 上。
        let cx = 0;
        for (const v of doomed) cx += v.position.x;
        cx /= n;
        const cy = 0;

        // 叠拢程度：撞上之后的中心间距 = 槽格宽 × `CLASH_OVERLAP`。
        // 三张牌叠成"一张厚牌"正是"三合一"的观感。
        const span = this.slotCellW() * MOTION.CLASH_OVERLAP;

        // ① 蓄力 → 冲刺：**一条链**走完，绝不拆成两条 tween。
        //    拆开的话，蓄力与冲刺会同时持有 position（两条 tween 抢同一属性），
        //    在交界处必然出现重叠帧 —— 真机上是肉眼可见的一顿。
        for (let k = 0; k < n; k++) {
            const v = doomed[k];
            if (!v.isValid) continue;
            // 第 k 张朝**远离中心**的方向退：中间的（dir = 0）不动。
            // 只动两侧就已经足够表达"攒势"了；中间那张也退反而像整体平移。
            // ⚠️ 这里的 `dir` 由**序号**推出（而不是由实际 x 的符号推出）——
            //    与 game-4 逐字一致，也天然免疫"牌正好落在中心点上"的除零。
            const dir = k < (n - 1) / 2 ? -1 : (k > (n - 1) / 2 ? 1 : 0);
            const x0 = v.position.x;
            const y0 = v.position.y;
            const tx = cx + (k - (n - 1) / 2) * span;
            MotionFx.seq(v, [
                { props: { position: v3(x0 + dir * MOTION.CLASH_PULLBACK, y0, 0) },
                    duration: MOTION.CLASH_ANTICIPATE, easing: EASE.ENTER },
                { props: { position: v3(tx, cy, 0) },
                    duration: MOTION.CLASH_DASH, easing: EASE.DASH },
            ], { tag: TAG.SLOT });
        }

        // ② ★ 撞击帧：所有牌都撞到的时刻（+1 帧余量，理由见 `CLASH_HIT_MS` 的注释）
        this.timer(CLASH_HIT_MS, () => {
            if (!bar.isValid) return;
            this.onClash(doomed, type, cx, cy);
            // ③ 停一拍之后再释放
            this.timer(CLASH_HOLD_MS, () => this.releaseClash(doomed));
        });
    }

    /**
     * ★ 撞击帧的全部表现。抽成独立方法是因为它要做 6 件事 ——
     *   全塞进定时器闭包里会让那段代码彻底不可读（game-4 也是这么分的）。
     */
    private onClash(doomed: Node[], type: MatchType, cx: number, cy: number): void {
        const bar = this._slotBar;
        if (!bar?.isValid) return;

        // ① 声音与触感 —— 这是本作**唯一"值得震"的瞬间**。
        //    ★ 第 59 轮把它们从 `resolveMatch` 开头**搬到撞击帧**：
        //      放大到牌真的撞上的那一帧，才是 game-4 的"咚——唰"节奏；
        //      留在 t=0 会出现"人声先喊、牌 200ms 后才撞上"的错位（肉眼/耳朵都能察觉）。
        //    ⚠️ 碰 / 吃 **各自一条人声念白**（第 42 轮从隔壁麻将项目复用）。
        //      传的是 `type`（'peng' | 'chi'）—— 曾经上游把它写成 `m.kind` ⇒ undefined，
        //      于是所有"碰"都被静默播成"吃"：这类错别字不报错，只能靠耳朵听出来。
        AudioService.playSfx(type === 'peng' ? SFX.peng : SFX.chi, 1.0);
        Haptics.medium();

        // ② 挤压（squash & stretch）：撞上去的牌会被压扁一点、拉长一点。
        //    两段式：先压（`EASE.EXIT` = quadIn，被撞的那一下是突然的），
        //    再弹回（`EASE.POP` = backOut，带过冲 ⇒ 材质有弹性）。
        //    一条曲线跑完的话，回到 1.0 的过程没有"弹"的记忆，会像"缩放"而不是"碰撞"。
        for (const v of doomed) {
            if (!v.isValid) continue;
            MotionFx.seq(v, [
                { props: { scale: v3(MOTION.CLASH_SQUASH_X, MOTION.CLASH_SQUASH_Y, 1) },
                    duration: MOTION.CLASH_RECOIL * 0.35, easing: EASE.EXIT },
                { props: { scale: v3(1, 1, 1) },
                    duration: MOTION.CLASH_RECOIL * 0.65, easing: EASE.POP },
            ], { tag: TAG.SLOT });
        }

        // ③ 冲击圆环：一圈由小到大、同时淡出的描边环 —— 三张牌撞在一起的能量释放。
        //    父节点用**槽位条**：那里既是撞击点的正确坐标系，
        //    又天然盖在三张牌之上、在弹层（`_topLayer`）之下。
        //    （game-4 要在槽位层与特效层之间做一次世界坐标换算，本作不需要 —— 这里是同一个父节点。）
        MotionFx.spawnPulse(bar, cx, cy, COLOR.GOLD, {
            r0: MOTION.CLASH_RING_R0,
            r1: MOTION.CLASH_RING_R1,
            line: MOTION.CLASH_RING_LINE,
            life: MOTION.CLASH_RING_LIFE,
        });

        // ④ 碎屑：从**每张牌**的位置各喷一次，而不是只从中心喷一个点。
        //    只在中心喷的话，"三张牌被打散"这件事就没有空间上的分布感。
        //    ⚠️ 取的是牌的**当前**位置 —— 此刻冲刺已收尾，正好是叠拢后的落点。
        for (const v of doomed) {
            if (!v.isValid) continue;
            MotionFx.spawnShards(bar, v.position.x, v.position.y, COLOR.GOLD);
        }

        // ⑤ 牌堆上踢：把撞击的能量传导出去（替代"整屏镜头抖动"那条被否掉的方案）。
        this.kickBoard(MOTION.CLASH_KICK);

        // ⑥ 飘字：把牌型名说出来（碰 / 吃）。
        //    ★ 与①的人声一起，这是「吃 / 碰」之间**唯一还看得见听得见的差别**
        //      —— 动效本身两种牌型完全一致（与 game-4 的现状一致）。
        this.popToast(type);
    }

    /**
     * 释放段：先胀到峰值，再收缩到 0 并淡出。
     *
     * 【为什么是两段而不是一条曲线】
     *   一条曲线从 1.0 直接跑到 0，看起来是"缩没了"；
     *   先胀到 1.20 再收缩，看起来是"胀开了、然后被打散"。
     *   前者是"消失"，后者是"消除" —— 差的正是那 60ms 的胀开。
     */
    private releaseClash(doomed: Node[]): void {
        for (const v of doomed) {
            if (!v.isValid) continue;
            MotionFx.seq(v, [
                { props: { scale: v3(MOTION.POP_SCALE_MAX, MOTION.POP_SCALE_MAX, 1) },
                    duration: MOTION.POP_OUT * 0.3, easing: EASE.POP },
                { props: { scale: v3(0, 0, 1) },
                    duration: MOTION.POP_OUT * 0.7, easing: EASE.EXIT },
            ], { tag: TAG.SLOT });
            // 淡出与"胀开 → 收缩"错峰：前 30% 还在往外胀的时候不能已经开始变透明，
            // 否则那一下"胀"是看不见的（旧实现没有这个 delay，观感像直接缩小）。
            const op = v.getComponent(UIOpacity) ?? v.addComponent(UIOpacity);
            MotionFx.fadeTo(op, 0, MOTION.POP_OUT * 0.7, {
                delay: MOTION.POP_OUT * 0.3, easing: EASE.EXIT, tag: TAG.FADE,
            });
        }
    }

    /** 撞击时把**整个牌堆**上踢一下再落回（把撞击的能量传导出去）。 */
    private kickBoard(amount: number): void {
        const board = this._boardNode;
        if (!board?.isValid) return;
        MotionFx.seq(board, [
            { props: { position: v3(0, amount, 0) },
                duration: MOTION.CLASH_KICK_UP, easing: EASE.EXIT },
            { props: { position: v3(0, 0, 0) },
                duration: MOTION.CLASH_KICK_DOWN, easing: EASE.POP },
        ], { tag: TAG.KICK });
    }

    /**
     * 把槽内小牌重排到前面的格子里。
     *
     * ★★ **第 45 轮修掉的一处静默 bug**（用户实测：「第一个槽里有牌，但是没显示出来」、
     *    「牌像是直接出现在第二个槽」）。根因在旧写法的这三行：
     *
     *        const old = this._slotNodes.slice();      // ← 调用方刚把它清成 []
     *        for (const n of old) if (...) alive.push(n);   // ← 恒为空
     *        const node = alive[i] ?? createNode(name, cell, {w, h});
     *                                     ↑ 兜底分支**只给尺寸、不给 Sprite**
     *
     *    调用链是：`resolveMatch()` 先把 `_slotNodes = []`，300ms 后才调本函数
     *    ⇒ 收集结果恒空 ⇒ **每一格都走兜底分支，建出没有图的空壳节点**。
     *    而 `_slots` 数据是对的 ⇒ 玩家看到的是「槽里空着，但点第 N 张牌落在第 N+1 格」。
     *    无头实测证据（第 45 轮复现）：消除一次后 `slots = [3,4,6]`（3 张牌），
     *    而三个格的 `SlotTile` 节点 `sprites: []` —— 一张图都没有。
     *
     *    ⇒ 修法：存活节点改由 `takeSurvivors()` 在**数据变更的同一步**摘出来，
     *      经 `_pendingKeep` 传进来；窗口期内新入槽的牌由 `placeSlotTile()` 追加到队尾。
     *      于是"待排队列"的顺序天然等于 `_slots` 的顺序。
     */
    private relayoutSlots(): void {
        // 待摆放队列 = 消除时摘出的存活节点（旧序）+ 窗口期新入槽的（入槽序）
        const queue = (this._pendingKeep ?? []).filter((n) => n.isValid);
        this._pendingKeep = null;

        const board = this._board;
        if (!board) return;

        // 多余节点（数据里已经没这几张了）→ 直接销毁，别留在格子里当幽灵
        for (let i = this._slots.length; i < queue.length; i++) {
            const n = queue[i];
            if (n?.isValid) n.destroy();
        }

        // 清掉所有格子里**不在队列中**的 SlotTile（正常情况下就是正在爆开的那几个）
        const inQueue = new Set(queue);
        for (const c of this._slotCells) {
            for (const ch of c.children.slice()) {
                if (ch.name.startsWith('SlotTile') && ch.isValid && !inQueue.has(ch)) ch.destroy();
            }
        }

        this._slotNodes = new Array(this._slotMax).fill(null);
        this._slots.forEach((tileIdx, i) => {
            const cell = this._slotCells[i];
            if (!cell) return;
            // 队列不够时按牌面**补一张** —— 绝不能留空位（留空位正是这个 bug 的样子）
            const node = (queue[i]?.isValid ? queue[i] : null)
                ?? this.spawnSlotTile(i, board.tiles[tileIdx].face);
            if (!node) return;
            if (node.parent !== cell) cell.addChild(node);
            node.setPosition(0, 0, 0);
            node.setScale(v3(1, 1, 1));
            node.angle = 0;
            node.active = true;
            const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            op.opacity = 255;
            this._slotNodes[i] = node;
        });
    }

    /**
     * 槽位**刚好坐满**（`_slots.length >= _slotMax`）时的收局判定。
     *
     * ★★ **第 48 轮用户拍板：牌堆没牌了 + 槽位刚好满（不溢出）⇒ 判成功通关。**
     *   （原话：「对于牌堆没牌了，槽位刚好满的情况，只要不溢出，都算成功通关」）
     *
     * 【为什么要单独一个函数，而不是继续在定时器里调 `onFail`】
     *   旧写法是 `this.timer(240, () => this.onFail('slotsFull'))` —— 它**抢在**
     *   `checkBoardEmpty()` 的 420ms 复查之前（240 < 420）落地。于是"最后一手把牌堆点空、
     *   但那一手没凑成组"这种局面**必然**被判负：玩家明明已经把牌全点完了，
     *   屏幕上写的却是「就差一点！· 还剩 0 张 · 槽位已满」
     *   （第 48 轮用户截图复现：第 5 关 · 已清 40/45）。
     *
     * 【判定口径 —— 与 `checkBoardEmpty` 完全同源，不许各写一套】
     *   牌堆空（`board.remaining <= 0`）**且** 暂存架空（`tempLeft <= 0`）⇒ 判胜；
     *   其余一律判负（槽位真被挤爆、且场上还有牌可点 ⇒ 玩家确实走不下去了）。
     *   · 暂存架里还有牌时**不判胜**：那些牌玩家还能取回主槽，本局没到终局。
     *   · 「不溢出」= `_slots.length === _slotMax` —— 本函数只在 `>=` 时被调用，
     *     而真正超容的入槽在 `placeSlotTile()` 那一侧就被拦住了。
     *
     * 【为什么保留 240ms】与 `onFail` 的原有时序一致 —— 入槽/落位动效还在飞，
     *   立刻下判决会让"最后一张牌还没落进格子"就弹层。
     */
    private settleSlotsFull(): void {
        if (this._over) return;
        const b = this._board;
        if (b && b.remaining <= 0 && this.tempLeft <= 0) {
            // 牌堆已空 ⇒ 玩家已无牌可点，槽满只是"这几张凑不成组"，不算输。
            // ⚠️ 必须先 `settleLeftoversOnWin()`：否则 `_cleared` 会停在 40/45，
            //    而弹层写着「通关啦！」，同一屏自相矛盾（口径见该函数注释）。
            this.settleLeftoversOnWin();
            this.onWin();
            return;
        }
        this.onFail('slotsFull');
    }

    /**
     * 牌堆是否已清空 → 收局判胜负。
     *
     * ★★ **第 47 轮用户拍板：牌堆清空 = 判定为「成功」。**（原话：
     *   「牌堆的牌已经清空，而且槽位没有超出，应当判定为成功」）
     *
     * 判胜条件 = **牌堆空 + 暂存架空**，**槽里剩几张不再判负**。
     *   · 为什么：牌堆一空，场上就再没有可点的牌；玩家已无从下手，
     *     此时把这一局算成失败，在玩家那边读作"我明明清完了"。
     *   · 槽位**爆了**才是真失败 —— 那条另有出口（`resolveMatch` 的 `slotsFull`），
     *     且它的 240ms 判定**早于**本函数的 420ms 复查，所以"槽满 + 牌堆空"仍判负
     *     （= 玩家确实一步都走不下去），与用户"槽位没有超出才算成功"的口径一致。
     *   · 实测触发场景：用「消除」道具删掉一张、把三张组拆散 ⇒ 留 2 张孤牌永远凑不成组，
     *     牌堆一空必然撞上（旧逻辑 100% 弹「就差一点！」，见 `_r47-verify.mjs`）。
     *
     * ⚠️⚠️ **必须延迟复查，绝不能在"牌堆刚变空"的那一刻直接下判决。**
     *  「入槽 → 落位 → 判定 → 消除」是一条**异步链**（飞入 0.28s + 消除 0.3s），
     *  牌堆变空的那一瞬，槽里往往正躺着一组**正在消除**的牌。
     *
     *  早先的写法是"此刻 `_slots` 非空 → 预约 260ms 后判负"，于是：
     *      t=0    最后一次点击；牌堆已空，槽内仍有待消的牌
     *      t=300  判定：`_slots` 非空 → 预约 t=560 判负
     *      t=450  那一组消完，`_slots` 归 0（**此时才真正满足胜利条件**）
     *      t=560  预约的判负**照常触发** → **满盘清空却弹「失败」**
     *  实测就撞上了：第 1 关 12 张全部消完，弹层却写「牌出完了 · 槽里没消掉」。
     *  这类 bug 对玩家是致命的（"我明明清完了"），而且只在最后一组刚好
     *  压在牌堆清空之后时才复现 —— 手工点几下根本碰不到。
     *
     *  ⇒ 判据改为：牌堆空 **且** 消除链已静默（没有新的判定把 `_endSeq` 顶掉）时才定胜负。
     *    `_endSeq` 的归属校验和输入锁看门狗同一个思路：**旧判决不得在新局面上生效**。
     */
    private checkBoardEmpty(): void {
        const board = this._board;
        if (!board || this._over) return;
        if (board.remaining > 0) return;
        // ★ 第 46 轮：暂存架里还有牌 ⇒ 本局**既不算胜也不算负** ——
        //   那些牌在 Board 里是 alive=false（不占 remaining），但并没被消掉；
        //   玩家还能把它们取回主槽凑组。等架子空了再判。
        if (this.tempLeft > 0) return;
        const seq = ++this._endSeq;
        this.timer(PLAY.END_SETTLE_MS, () => {
            if (this._over || this._endSeq !== seq) return;   // 局面又变了 → 作废
            const b = this._board;
            if (!b || b.remaining > 0) return;
            if (this.tempLeft > 0) return;                    // 架子里还有牌 → 不到终局
            // ★★ 第 47 轮：条件收紧到这一步就够 —— 剩下的槽内残牌**一律不再判负**
            //   （它们是"被道具拆散的孤牌"，凑不成组不是玩家的错）。
            this.settleLeftoversOnWin();
            this.onWin();
        });
    }

    /**
     * 判胜前把**槽内残牌**一并结算掉：计入已消 + 清空槽位。
     *
     * 【为什么需要】牌堆清空时槽里可能还剩 1~2 张孤牌（被「消除」拆散的三张组），
     *   它们凑不成组、也没法再从牌堆取牌。这一局既然判胜，进度就该是满的 ——
     *   否则 HUD 会停在「已清 91/93」而弹层写着「通关啦！」，同一屏自相矛盾。
     *
     * 【为什么可以在这里清】调用点只在 `checkBoardEmpty` 的**延迟复查**里，
     *   而 `_slots` 的改动全部发生在 `resolveMatch` 的**同步段**（立即 filter + pop），
     *   复查时刻不可能有"正在消除中的牌"被抢走 `_slots` 下标。
     *   为了彻底断掉竞争，这里连 `_pendingKeep` 一起清掉（防止更早一轮排下的
     *   `relayoutSlots()` 回头把节点重新摆回来 —— 那会变成"清完又冒出来"）。
     *
     * 【与 `performRevive` 的分工】那个是"复活后**继续打**"（要留重排），
     *   这里是"本局**结束**"，所以直接销毁节点、不排布。`_cleared` 记账口径相同。
     */
    private settleLeftoversOnWin(): void {
        const n = this._slots.length;
        if (n <= 0) return;
        this._pendingKeep = null;
        for (let i = 0; i < this._slotNodes.length; i++) {
            const nd = this._slotNodes[i];
            if (nd?.isValid) nd.destroy();
            this._slotNodes[i] = null;
        }
        this._slots = [];
        this._cleared += n;
        this.refreshProgress();
        this.refreshSlotDanger();
        this.log(`判胜收尾：槽内 ${n} 张孤牌一并结算（已清 ${this._cleared}/${this._def.n}）`);
    }

    // ========================================================
    //  道具
    // ========================================================
    /**
     * 玩家点了道具键。
     *
     * ★ 第 46 轮改了两处流程（对齐 game-4）：
     *   ① **【消除】是两段式**（用户拍板）——点键只进入"就绪态"，
     *      真正生效发生在玩家点中槽里某一张牌时。所以：
     *        · 二次点键 = 取消（**不消耗**任何库存）
     *        · 库存的扣减放在 `eraseSlotAt()` 里（"点了但没选中牌"不该扣）
     *   ② **可用性先于一切**：槽空 / 暂存架满这类"用了也没用"的情况要**先拦**。
     *      顺序反过来的话，玩家会先看完广告才被告知"你槽里没牌"——
     *      game-4 的注释写得很直白：那种体验足以让人直接卸载。
     */
    private useTool(id: string): void {
        if (this._over || this._paused) return;

        // ① 「消除」二次点击 = 取消就绪态（**不消耗任何东西**）
        if (id === TOOL.ERASE && this._armedErase) {
            this.setArmedErase(false);
            toast(this.body, '已取消「消除」');
            return;
        }

        // ② ★ **可用性先于一切**（game-4 口径）——
        //   "槽里没牌"这类情况必须在**弹广告之前**拦掉，不能让玩家先看 5 秒广告
        //   再被告知"你槽里没牌"。
        const reason = this.propBlockReason(id);
        if (reason) {
            toast(this.body, reason);
            return;
        }

        // ③ 换道具 → 收掉「消除」的就绪态（同一时刻只允许一个道具待命）
        if (this._armedErase) this.setArmedErase(false);

        // ④ 有库存就直用；两本账都空 → 看广告 / 分享
        //   ⚠️ 这里必须看 `itemStock()`（赠礼 + 跨局库存）。曾经只看 `currentRun()`，
        //     于是商城/签到领来的道具**按了会被推去看广告** —— 明明账上有货。
        if (itemStock(id as ToolKey) <= 0) { this.openAd(id); return; }

        // ⑤ ★ **「消除」两段式 —— 库存不在这里扣**（扣在 `eraseSlotAt()`）：
        //   这一步只把键推进就绪态，"点了键但没选牌"不该算用掉一次。
        //   ⚠️ 曾经这里无条件 `useRunItem(id)` ⇒ 点一下键就扣 1 个、再取消也退不回来。
        if (id === TOOL.ERASE) {
            if (!this.applyTool(id)) return;
            AudioService.playSfx(SFX.toolUse, 1.0);
            Haptics.medium();
            this.nudgeReset();
            return;
        }

        if (!this.applyTool(id)) return;
        consumeItem(id as ToolKey);
        this.afterToolUsed(id);
        this.nudgeReset();     // 玩家动过了 → "发呆"计时重新开始
    }

    /**
     * 执行一个道具（**不扣库存**）。
     *
     * 库存扣减刻意留给调用方，因为三条路径的规矩不同：
     *   · 走库存（`useTool`）→ 调 `consumeItem()`（赠礼优先、其次跨局库存）
     *   · 走广告 / 分享（`closeAd`）→ **不扣** —— 它本来就不进库存
     *   · 「消除」→ 谁都不在这儿扣，真正的扣减在 `eraseSlotAt()`（"选牌"才算用掉）
     */
    private applyTool(id: string, fromStock = true): boolean {
        switch (id) {
            case TOOL.ERASE: return this.armErase(fromStock);
            case TOOL.MOVE: return this.toolMove();
            case TOOL.SHUFFLE: return this.toolShuffle();
            case TOOL.ADD_SLOT: return this.toolAddSlot();
            default: return false;
        }
    }

    /**
     * **道具当前是否可用**；返回不可用的原因（`null` = 可用）。
     *
     * ★ 第 46 轮新增 —— 照搬 game-4 的 `propBlockReason(id)`，文案逐字对齐。
     *
     * 【为什么必须"先查它，再谈广告"】顺序反过来的话，玩家会先看完 5 秒广告
     *   才被告知"你槽里没牌"。game-4 的注释写得很直白：那种体验足以让人直接卸载。
     *
     * 【它同时是"道具键亮/暗"的唯一真源】`refreshTools()` 不再自己判一遍 ——
     *   两处判定迟早分叉，表现是"键看着能点、点了却弹一句不能用的原因"。
     */
    private propBlockReason(id: string): string | null {
        switch (id) {
            case TOOL.ERASE:
                if (this._slots.length === 0) return '槽里还没有牌';
                return null;
            case TOOL.MOVE:
                if (this._slots.length === 0) return '槽里还没有牌';
                if (this._temp.length >= PLAY.TEMP_CAPACITY) return '暂存架已经满了';
                return null;
            case TOOL.SHUFFLE:
                // 暂存架里的牌也算"还在牌局里"（洗牌会把它们一并撒回场上）
                if ((this._board?.remaining ?? 0) + this._temp.length <= 1) return '场上没有可洗的牌了';
                return null;
            case TOOL.ADD_SLOT:
                if (this._addSlotUsed >= PLAY.ADD_SLOT_PER_LEVEL) return '本关的加槽名额已用完';
                if (this._slotMax >= PLAY.ADD_SLOT_MAX) return `槽位已是上限 ${PLAY.ADD_SLOT_MAX} 格`;
                return null;
            default:
                return null;
        }
    }

    /** 道具**真正生效之后**的统一收尾（库存已扣） */
    private afterToolUsed(id: string): void {
        this.refreshTools();
        AudioService.playSfx(SFX.toolUse, 1.0);
        Haptics.medium();
        toast(this.body, `已使用 ${TOOL_META[id as keyof typeof TOOL_META].name}`);
    }

    // ========================================================
    //  ★ 第 46 轮 · 卡住提示（3 秒没消 → 引导「看广告 / 分享」换道具）
    // ========================================================

    /** 起心跳。**只在进关时调一次**（`onEnter`）。 */
    private startNudge(): void {
        if (!NUDGE.ENABLED || this._nudgeTicking) return;
        if (this._level < NUDGE.FROM_LEVEL) return;
        this._nudgeTicking = true;
        this._nudgeIdle = -NUDGE.START_GRACE;    // 开局宽限（见 CFG.NUDGE.START_GRACE）
        this._nudgeCool = 0;
        this._nudgeShown = false;
        this.tickNudge();
    }

    /**
     * 「卡住」秒表。全部参数见 `CFG.NUDGE`。
     *
     * ── 为什么"不可操作"的那些秒不累加（三种情形，第三种最要命）──
     *   · `_locked`：牌正飞向槽位（0.26 s 的输入锁窗口）—— 玩家没得操作。
     *   · `_paused`：任意弹层开着（暂停 / 广告 / 规则）。
     *   · `_armedErase`：**「消除」已就绪、正等玩家点槽里那张牌**。
     *     最典型的坏例子 —— 玩家点道具键 → 看完 5 秒广告 → 回到牌局：
     *     若广告期间的秒数照算，`_nudgeIdle` 早就超过 3 秒，回来的**第一秒**
     *     就会再浮一圈"卡住了？看广告换道具"。读起来就是"刚给你东西又来推销"。
     *
     * ⚠️ 这是**累加条件**，不是**触发条件**。触发条件严格按用户口径：
     *     距上次成组消除满 `IDLE_SECONDS` 秒（且过了开局宽限、冷却已走完）。
     * `_over` 一到整条心跳就停（最后一次 `timer` 不再续）。
     */
    private tickNudge(): void {
        if (!this.node.isValid || this._over) return;
        this.timer(1000, () => {
            if (!this.node.isValid || this._over) return;
            if (!this._paused && !this._inBackground && !this._locked && !this._armedErase) {
                if (this._nudgeCool > 0) this._nudgeCool -= 1;
                this._nudgeIdle += 1;

                if (!this._nudgeShown && this._nudgeIdle >= NUDGE.IDLE_SECONDS
                    && this._nudgeCool <= 0) {
                    // 挑不出"当下真能用"的道具就**不提示** —— 提示了也没有下一步，
                    // 那只是白拿玩家一份注意力（见 pickNudgeProp 的注释）。
                    const id = this.pickNudgeProp();
                    if (id) {
                        this._nudgeShown = true;
                        this._nudgeCool = NUDGE.COOLDOWN;
                        this.log(`卡住提示：${this._nudgeIdle}s 无消除 → 推荐「${TOOL_META[id].name}」`);
                        this.showNudge(id);
                    }
                }
            }
            this.tickNudge();
        });
    }

    /**
     * 挑一个"当下推荐"的道具。返回 null = 一个都不能用（→ 不提示）。
     *
     * 【优先级为什么是这个顺序】按"能立刻解开困境"的强度排（与 game-4 逐项一致）：
     *   ① 消除 —— 只在槽里已经有牌时可用，而"槽里攒了几张却没成型"正是最常见的卡；
     *   ② 洗牌 —— 在牌堆层面重排，能救"顶层全被压死、一片灰"；
     *   ③ 加槽 —— 只解决"快满了"，是最缓的一档；
     *   ④ 移出 —— 把槽里的牌腾出去，但**牌并没有被消掉**，最不解卡。
     * ⚠️ 顺序改了不会报错，只会让提示显得"不懂玩家正在做什么"
     *    （对应 `CFG.NUDGE.LEAD` 的四句前导语）。
     */
    private pickNudgeProp(): ToolKey | null {
        const order: ToolKey[] = [TOOL.ERASE, TOOL.SHUFFLE, TOOL.ADD_SLOT, TOOL.MOVE];
        for (const id of order) if (this.propBlockReason(id) === null) return id;
        return null;
    }

    /**
     * 显示卡住提示。**全工程唯一的分流点** —— game-5 目前只有 glow 一种形态，
     *   将来若要加"底部引导条"，只在这里多一行（game-4 的 `MODE` 分流同款）。
     */
    private showNudge(id: ToolKey): void {
        this.showNudgeGlow(id);
        // 合规文案（"看广告 / 分享"两处**必须并列**出现）走 toast，见 CFG.NUDGE.TEXT。
        toast(this.body, `${NUDGE.LEAD[id]} ${NUDGE.TEXT.replace('%s', TOOL_META[id].name)}`, 2.4);
    }

    /**
     * 在推荐键上套一圈金环 + 键上方浮出「点这里 ▼」。
     *
     * 【为什么挂成"道具键的子节点"】
     *   ① 不用做任何坐标换算 —— 只写键内局部坐标（键心 = 原点）；
     *   ② 键被销毁（换局 / 离场 / 结算重建）时环与标签跟着一起销毁，不会留孤儿节点。
     *
     * 【点哪儿有效】环 / 标签本身**不挂事件**：真正接指针的是那个透明的 `NudgeHit`
     *   命中盒，它把"键 + 环 + ▼"整片圈进来后转发给 `useTool(id)` ——
     *   于是"箭头指着哪就点哪"是天然成立的，而且**不构成第二条道具路径**
     *   （照样走"先查可用 → 再过库存/广告门禁 → 才执行"）。
     *   ⚠️ **命中盒半宽必须 < 相邻格中心距的一半（150/2 = 75）**，否则会抢隔壁键的
     *      点击。下面算式末尾那个 `+ 2` 就是为此留的余量（63+7+2+2 = 74 < 75）。
     *      改 `RING_OFF` / `RING_LINE` / `TOOL_CELL` 时这条不变量要重新过一遍。
     */
    private showNudgeGlow(id: ToolKey): void {
        const cell = this._toolCells[TOOL_ORDER.indexOf(id)];
        if (!cell || !cell.isValid) return;
        this.hideNudgeGlow();                        // 同一时刻只允许罩一个键

        const cw = LAYOUT.TOOL_CELL.w;
        const ch = LAYOUT.TOOL_CELL.h;
        const R = SKIN.TOOL.RADIUS;

        // ---- 视觉层（只画，不接指针）----
        const art = createNode('NudgeGlow', cell, { w: 1, h: 1 });
        const op = art.addComponent(UIOpacity);
        op.opacity = 0;

        const { g } = createGraphicsNode('Ring', art, { w: 1, h: 1 });
        // ① 外发光：多层极淡描边（引擎没有模糊，与 `drawSoftShadow` 造柔影同一招）
        for (const grow of [10, 7, 4]) {
            const d = (NUDGE.RING_OFF + grow) * 2;
            strokeRoundRect(g, 0, 0, cw + d, ch + d, R + d / 2, COLOR.GOLD, 2, 40);
        }
        // ② 实环
        strokeRoundRect(g, 0, 0, cw + NUDGE.RING_OFF * 2, ch + NUDGE.RING_OFF * 2,
            R + NUDGE.RING_OFF, COLOR.GOLD, NUDGE.RING_LINE, 255);

        // ---- 「点这里 ▼」：容器底边压在键上沿，▼ 尖端咬进键内一点 ----
        const TIP = 12;              // ▼ 高（= 宽）
        const TXT = 34;              // 文字带高
        const TAG_H = TIP + TXT;
        const OVER = 6;              // ▼ 尖端咬进键内的深度
        const tag = createNode('Tag', art, {
            w: 170, h: TAG_H, y: ch / 2 + TAG_H / 2 - OVER,
        });
        const tg = createGraphicsNode('Tip', tag, { w: TIP, h: TIP, y: -TAG_H / 2 + TIP / 2 }).g;
        const hw = TIP / 2;
        tg.moveTo(-hw, hw); tg.lineTo(hw, hw); tg.lineTo(0, -hw); tg.close();
        tg.fillColor = hex2color(COLOR.GOLD);
        tg.fill();
        tg.lineWidth = 2;
        tg.strokeColor = hex2color('#3A2A10');       // 深墨边：金压在深键面上没有它就会糊
        tg.stroke();
        createLabel(tag, NUDGE.TAG_TEXT, {
            fontSize: 24, color: COLOR.GOLD, bold: true, serif: true,
            w: 170, h: TXT, y: -TAG_H / 2 + TIP + TXT / 2,
            outline: '#3A2A10', outlineWidth: 3,
        });

        // ---- 指针层：透明命中盒（把键 + 环 + ▼ 整片圈进来）----
        //  ⚠️ 做成 `art` 的子节点 → `hideNudgeGlow()` 销毁 `art` 时它一起走。
        const hitHalfW = cw / 2 + NUDGE.RING_OFF + NUDGE.RING_LINE / 2 + 2;
        const topExt = TAG_H - OVER + 4;
        const hit = createNode('NudgeHit', art, {
            w: hitHalfW * 2, h: ch + 2 * (NUDGE.RING_OFF + NUDGE.RING_LINE) + topExt,
            y: topExt / 2,
        });
        const press = (): void => {
            tween(hit).to(0.07, { scale: v3(0.96, 0.96, 1) }).start();
        };
        const release = (): void => {
            tween(hit).to(0.14, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        };
        // ⚠️⚠️ **三个事件都要 `propagationStopped = true`**（第 46 轮修的真 bug）。
        //   命中盒是道具键的**子节点**，Cocos 的节点触摸事件会**向父节点冒泡**。
        //   早先只停了 `TOUCH_START`，于是 `TOUCH_END` 会**一路冒到 `Tool_xxx` 键**上：
        //     · 命中盒的 handler 先跑 → `useTool('erase')` → 进入「消除」就绪态；
        //     · 紧接着键的 `tap()` 又跑一次 → `useTool('erase')` 看到"已就绪" ⇒
        //       **判定为二次点击 = 取消** ⇒ 玩家看到的是"点了引导环，什么都没发生"。
        //   症状极具迷惑性：`armed` 从 false → true → false，单看每个函数都对，
        //   是**同一次点击跑了两遍**才出的错。`_r46-verify.mjs` ④段点的是命中盒
        //   中心（真实鼠标），才把它逼出来 —— 只点键永远验不到。
        const claim = (e: { propagationStopped: boolean }): void => {
            e.propagationStopped = true;
        };
        hit.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
            claim(e);                                // 认领，免得下面的键再收一次
            press();
        }, hit);
        hit.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
            claim(e);
            release();
            this.useTool(id);
        }, hit);
        hit.on(Node.EventType.TOUCH_CANCEL, (e: { propagationStopped: boolean }) => {
            claim(e);
            release();
        }, hit);

        this._nudgeGlow = art;
        this._nudgeGlowId = id;

        MotionFx.fadeTo(op, 255, 0.24);
        // 呼吸两下**播完即停**（不做常驻闪烁）：`breath` 是 repeatForever，
        //   按"一次往复 = PULSE×2"算出总时长后自己喊停。
        MotionFx.breath(art, NUDGE.PULSE_SCALE, NUDGE.PULSE, { tag: TAG.NUDGE, delay: 0.24 });
        const pulseMs = Math.round((NUDGE.PULSE * 2 * NUDGE.PULSE_TIMES) * 1000) + 240;
        this.timer(pulseMs, () => {
            if (!art.isValid) return;
            MotionFx.stop(art, TAG.NUDGE);
            art.setScale(v3(1, 1, 1));
        });
        // 到期自动收起。⚠️ 用"是不是同一个 art"做归属校验 —— 中途换键 / 被
        //   `nudgeReset()` 收掉之后，这条定时器**不得**再去收别人的环。
        this.timer(NUDGE.LIFE * 1000, () => {
            if (this._nudgeGlow === art) this.hideNudgeGlow(true);
        });
        this.log(`卡住提示已挂到「${TOOL_META[id].name}」键上（${NUDGE.LIFE}s 后自动收）`);
    }

    /**
     * 收掉金环 / 标签 / 命中盒。
     * @param fade true = 先淡出再销毁（到期自动收起时用）；
     *             false = 立刻收掉（换目标 / 玩家消掉一组 / 局终 / 离场用 ——
     *             那几种情况下"立刻消失"本身就是反馈，慢慢淡反而显得迟钝）。
     */
    private hideNudgeGlow(fade = false): void {
        const art = this._nudgeGlow;
        this._nudgeGlow = null;
        this._nudgeGlowId = null;
        if (!art || !art.isValid) return;

        MotionFx.stop(art, TAG.NUDGE);
        MotionFx.stop(art, TAG.FADE);
        if (!fade) { art.destroy(); return; }

        const op = art.getComponent(UIOpacity);
        if (op) MotionFx.fadeTo(op, 0, 0.2);
        const dead = art;
        this.timer(260, () => { if (dead.isValid) dead.destroy(); });
    }

    /**
     * 玩家**消掉一组**（或刚用过道具）→ 这一轮"卡住"结束，重新开始计时。
     *
     * ⚠️ 冷却（`_nudgeCool`）**刻意不动**：它防的是"消一组 → 卡 3 秒 → 又消一组
     *    → 又卡 3 秒"这种快节奏循环。跟着清零的话，冷却就等于不存在了。
     */
    private nudgeReset(): void {
        this._nudgeIdle = 0;
        this._nudgeShown = false;
        this.hideNudgeGlow();
    }

    // ========================================================
    //  ★ 第 46 轮 · 「消除」= 选槽内一张 → 强制消掉这 1 张
    // ========================================================

    /**
     * 进入「消除」就绪态。**不扣库存** —— 扣减在 `eraseSlotAt()` 里。
     *
     * 边界：槽里没牌时**不进入就绪态**（提示后原样返回），
     *       这是 game-4 `propBlockReason('remove')` 的第一条。
     */
    private armErase(fromStock = true): boolean {
        if (this._slots.length === 0) {
            toast(this.body, '槽里还没有牌');
            return false;
        }
        // ★ 记下"这一次就绪态是怎么来的" —— 决定真正消掉那张牌时**要不要扣库存**。
        //   走广告 / 分享拿到的那一次本来就没进过库存，扣了就是凭空虚扣玩家一个道具。
        this._eraseFromStock = fromStock;
        this.setArmedErase(true);
        toast(this.body, '点槽里任意一张，把它消掉');
        this.log(`道具 消除 就绪：槽内 ${this._slots.length} 张可选（${fromStock ? '消耗库存' : '广告/分享得来，不扣库存'}）`);
        return true;
    }

    /**
     * 开 / 关就绪态，并同步视觉。
     *
     * 【视觉提示为什么是"金环 + 键面变金"】金在本作 = 可交互/奖励（玉绿 = 状态，
     *   见 `paintSlotCell` 的注释）。就绪态要说的正是"现在点我是对的"，所以用金。
     *   ⚠️ 与第 45 轮删掉的"牌堆金环"不是一回事：那是**每张牌常驻**的装饰
     *      （太吵、被用户圈掉），这里只在**选牌态**存在，且是可交互的语义。
     */
    private setArmedErase(on: boolean): void {
        if (this._armedErase === on) return;
        this._armedErase = on;
        if (!on) this._eraseFromStock = false;   // 退出就绪态 ⇒ "这次算不算库存"的记账一并作废

        // 槽内牌上的可选环
        for (const c of this._slotCells) {
            for (const ch of c.children.slice()) {
                if (ch.name === 'ArmedRing' && ch.isValid) ch.destroy();
            }
        }
        if (on) {
            const box = this.slotBox();
            for (const n of this._slotNodes) {
                if (!n?.isValid) continue;
                const { g } = createGraphicsNode('ArmedRing', n, { w: box.w, h: box.h });
                strokeRoundRect(g, 0, 0, box.w + 8, box.h + 8, 12, COLOR.GOLD, 3, 255);
            }
        }
        this.refreshTools();
    }

    /**
     * 槽内牌被点中（**只在就绪态下有效**）。
     *
     * ⚠️ 用 `indexOf(node)` **当场解析下标**，不能把 `spawnSlotTile` 的入参 `slotIdx`
     *    闭包进去 —— 槽内节点会在 `relayoutSlots()` 里被复用、下标随之改变，
     *    闭包捕获的旧下标会**指向另一张牌**（而且完全不报错）。
     */
    private onSlotNodeTap(node: Node): void {
        if (!this._armedErase || this._over || this._paused) return;
        const i = this._slotNodes.indexOf(node);
        if (i < 0) return;
        this.eraseSlotAt(i);
    }

    /**
     * **强制消除槽内第 i 张牌（只此 1 张）** —— 用户拍板方案 A。
     *
     * 与 `resolveMatch()` 的三点不同，逐一说明（都容易写错）：
     *  ① **牌是永久离场**，不是退回牌堆 ⇒ 用 `board.forceRemove()`（不校验可点性），
     *     而「移出」用的是 `board.restore()`。
     *  ② **只摘 1 个槽位**，不是一整组。
     *  ③ 扣库存放在这里（而不是 `useTool`）——「进入就绪态又取消」不该消耗玩家一个道具。
     *
     * 【连带后果（用户已知晓）】只消 1 张会打破"同牌面张数 ≡ 0 (mod 3)"不变量，
     *   同牌面剩下的 2 张若凑不出「吃」，这一关就清不空 ⇒ 判负。
     *   这正是"用道具换来的代价"，也是需求⑥提难度要的效果。
     */
    private eraseSlotAt(i: number): void {
        const board = this._board;
        if (!board || i < 0 || i >= this._slots.length) return;

        const tileIdx = this._slots[i];
        const node = this._slotNodes[i];
        // ⚠️ 必须先取走这个标记 —— 下面 `setArmedErase(false)` 会把它清掉
        const fromStock = this._eraseFromStock;

        // ① 数据：牌永久离场 + 槽位移除（**先摘存活节点，再动数据** —— 见 takeSurvivors）
        this._pendingKeep = this.takeSurvivors([i]);
        this._slots = this._slots.filter((_, k) => k !== i);
        board.forceRemove(tileIdx);
        this._cleared += 1;
        SaveService.instance.addCleared(1);
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);

        this.setArmedErase(false);
        this.nudgeReset();          // 消掉一张 = 有进展 → "卡住"秒表归零

        // ② 视觉：缩小旋转消失（与 resolveMatch 同族的"被消掉"语言）
        if (node?.isValid) {
            tween(node).to(0.28, { scale: v3(0, 0, 1), angle: 40 }, { easing: 'quadIn' }).start();
            const dead = node;
            this.timer(300, () => { if (dead.isValid) dead.destroy(); });
        }

        // ③ 真正生效之后才扣库存 —— **且只在"这次就绪态是靠自己库存点开的"时才扣**。
        //   走广告 / 分享拿到的那一次从没进过库存，扣了就是凭空虚扣玩家一个道具。
        if (fromStock) consumeItem(TOOL.ERASE);
        this.refreshTools();

        this.timer(320, () => {
            this.relayoutSlots();
            this.refreshProgress();
            this.refreshSlotDanger();
            this.checkBoardEmpty();
        });
        this.log(`道具 消除 已生效：强制消掉牌 #${tileIdx}（槽内第 ${i} 位）`);
    }

    // ⚠️ 旧的 `toolErase()`（「槽内已凑满一组才让消」）已在第 46 轮**删除**：
    //    用户拍板改成「选定槽里的一张牌，强制消除（剩余多余两张不管）」——
    //    实现在上面的 `armErase()` / `eraseSlotAt()`。
    //    旧口径的失败提示「槽内还没有可消除的组合」正是用户截图 1 里那条文案
    //    （当时槽里只有 2 张 3 筒，永远凑不满 3 张）。

    /**
     * 「移出」：把槽里**最靠前的 N 张**搬进暂存架。
     *
     * ★ 第 46 轮**整块重写**（旧实现是"把最后一张退回牌堆"，与本作的道具语义不符）。
     *   现在是 game-4 `applyMoveOut()` 的同款逻辑，逐条对照：
     *     ① `n = min(暂存架空位, MOVE_OUT_COUNT(3), 槽内张数)` —— 三者取小
     *     ② 取 `_slots.splice(0, n)` = **槽内最靠前的 N 张**
     *     ③ **先把架子叫出来，再让牌飞**（顺序反了会看到"牌飞向不存在的格子"）
     *     ④ 留在槽里的牌**同步补位**（先动数据再动视图）
     *
     * 【边界（game-4 `propBlockReason` 的原文案）】
     *   · 槽内空 → 「槽里还没有牌」（注意：旧实现写的是「槽里没有牌可移出」，已统一）
     *   · 架子满 → 「暂存架已经满了」
     * ⚠️ 这两条**必须在 `useTool` 扣库存之前**返回 false —— 否则玩家的道具白扣。
     */
    private toolMove(): boolean {
        const board = this._board;
        if (!board) return false;

        if (this._slots.length === 0) {
            toast(this.body, '槽里还没有牌');
            return false;
        }
        if (this._temp.length >= PLAY.TEMP_CAPACITY) {
            toast(this.body, '暂存架已经满了');
            return false;
        }
        const n = Math.min(PLAY.TEMP_CAPACITY - this._temp.length,
            PLAY.MOVE_OUT_COUNT, this._slots.length);
        if (n <= 0) return false;

        // ③ 架子先浮出来
        this.showTempRack();

        // ④ 数据先行
        const movingNodes = this._slotNodes.slice(0, n);
        const keep: Node[] = [];
        for (let i = n; i < this._slotNodes.length; i++) {
            const nd = this._slotNodes[i];
            if (nd?.isValid) keep.push(nd);
        }
        const moving = this._slots.splice(0, n);
        const from = this._temp.length;             // 这批牌在架子里的起始格
        for (const idx of moving) this._temp.push(idx);

        // ⑤ 把"要飞走的这几张"先摘出格子。
        //    ⚠️ 必须在 `relayoutSlots()` **之前**：它的清理循环会销毁
        //       "不在待排队列里"的 `SlotTile`（名字前缀判定），飞走的那几张
        //       正好不在队列里 ⇒ 晚一步就会被销毁，表现是"移出的牌凭空消失"。
        for (let j = 0; j < n; j++) {
            const nd = movingNodes[j];
            if (!nd?.isValid) {
                // 兜底：这张牌的视觉节点缺失（理论上不会发生）—— 按牌面补建一张，
                // 否则数据里它在架子里、画面上却没有，玩家取不回它。
                // ★ 第 47 轮：`spawnTempTile()` 建出来的**已经是架格尺寸**（自带同一个
                //   `tempTileScale()`），所以它和下面 reparent 过来的节点现在**同基准** ——
                //   这正是把两条路径合并到 `buildSmallTile()` 之后才成立的。
                const nb = this.spawnTempTile(board.tiles[moving[j]].face);
                if (nb) {
                    nb.setPosition(this.tempCellX(from + j), 0, 0);
                    this._tempNodes[from + j] = nb;
                }
                continue;
            }
            const world = nd.getWorldPosition();
            nd.setParent(this._tempBar!);
            nd.setPosition(this._tempBar!.getComponent(UITransform)!.convertToNodeSpaceAR(world));
            this._tempNodes[from + j] = nd;
        }

        // ⑥ 槽内剩余的牌补位
        this._pendingKeep = keep;
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);
        this.relayoutSlots();
        this.refreshSlotDanger();

        // ⑦ 视觉：飞向暂存架（抛物线由"先略微下沉再抬升"两段近似，够用且便宜）
        // ★★ 第 47 轮：这里要的是"**相对主槽位节点的额外缩放**"，**不是**绝对尺寸系数。
        //   旧代码直接乘 `smallTileK()` ⇒ 与节点里那层 `slotTileK()` 叠乘，
        //   牌缩到主槽位的一半（27.6×36.7）—— 用户报的"暂存栏里面的牌太小了"就是它。
        const k = this.tempTileScale();
        for (let j = 0; j < n; j++) {
            const nd = this._tempNodes[from + j];
            if (!nd?.isValid) continue;
            const p = nd.position.clone();
            tween(nd)
                .to(0.10, { position: v3(p.x, p.y + 26, 0) }, { easing: 'quadOut' })
                .to(0.20, { position: v3(this.tempCellX(from + j), 0, 0),
                            scale: v3(k, k, 1), angle: 0 }, { easing: 'quadIn' })
                .start();
        }

        this.log(`移出：${n} 张 → 暂存架（架内 ${this._temp.length}/${PLAY.TEMP_CAPACITY}）`);
        return true;
    }

    /** 洗牌：重排桌上未消牌的位置（暂存架的牌一并撒回） */
    private toolShuffle(): boolean {
        const board = this._board;
        if (!board) return false;
        // 边界（照搬 game-4 的「场上没有可洗的牌了」）：架子里的牌也算"还在牌局里"
        if (board.remaining + this._temp.length <= 1) {
            toast(this.body, '场上没有可洗的牌了');
            return false;
        }

        // ★ 第 46 轮：暂存架的牌**一并撒回场上**（game-4 `applyShuffle` 第 ① 步）。
        //   它们本来就能取回；留在架子里会让"洗完之后还是老局面"。
        this.releaseTempToBoard();
        board.shuffle(Date.now() & 0xffff);

        for (let i = 0; i < board.tiles.length; i++) {
            const v = this._views[i];
            const t = board.tiles[i];
            if (!v || !t.alive) continue;
            v.rot = t.rot;
            v.node.angle = t.rot === 90 ? 90 : 0;
            tween(v.node)
                .to(0.26, { position: v3(board.engineX(t), board.engineY(t), 0) }, { easing: 'quadOut' })
                .start();
        }
        this.timer(300, () => this.refreshAllStates());
        AudioService.playSfx(SFX.shuffle, 1.0);
        return true;
    }

    /** 加槽：本关一次，槽位 +1 */
    private toolAddSlot(): boolean {
        if (this._addSlotUsed >= PLAY.ADD_SLOT_PER_LEVEL) {
            toast(this.body, '本关加槽机会已用完');
            return false;
        }
        if (this._slotMax >= PLAY.ADD_SLOT_MAX) {
            toast(this.body, `槽位已是上限 ${PLAY.ADD_SLOT_MAX} 格`);
            return false;
        }
        this._addSlotUsed++;
        this._slotMax++;
        this.rebuildSlotBarKeepContent();
        return true;
    }

    /**
     * 拓槽后重建槽位条 —— 玩家已入槽的牌必须**原样保留**，且真实下标不能丢。
     *
     * ⚠️ 铁律：真实下标必须在 `buildSlotBar()` **之前**存好。
     *    `buildSlotBar()` 只重建格子与 `_slotNodes`（不动 `_slots`），但一旦先清空 `_slots`，
     *    就再也还原不回来了 —— 用"牌面 + 入槽顺序"回推是**错的**：
     *    同一花色的牌有多张，`_slots` 存的关卡下标一旦被牌面顶替，
     *    后续 `board.tiles[i].face` 会读到别的牌，表现是"点牌成组判定全乱且完全不报错"。
     */
    private rebuildSlotBarKeepContent(): void {
        const board = this._board;
        const savedSlots = this._slots.slice();      // ① 先存真实下标
        const savedFaces: number[] = [];
        if (board) for (const i of savedSlots) savedFaces.push(board.tiles[i].face);

        this.buildSlotBar();                        // ② 重建格子（`_slots` 未动）

        this._slots = savedSlots;                   // ③ 真实下标原样还回去
        this._slotNodes = new Array(this._slotMax).fill(null);
        savedFaces.forEach((face, i) => this.placeSlotTile(i, face));  // ④ 按原位补回视觉
        this.refreshSlotDanger();
        this.log(`加槽 → ${this._slotMax} 格 · 槽内 ${savedSlots.length} 张已保留`);
    }

    // ========================================================
    //  胜负 → 结算弹层
    // ========================================================
    //  ★ 为什么结算做成**弹层**而不是独立页（定稿如此，且另有工程理由）
    //    ① `game-5 · 设计规则.md` 第 532 行把 ⑤ 结算页明确定义为 **弹层**：
    //       「60% 暖白蒙层 + 白色玉质厚卡弹层；胜 = 金币雨 + 标题入场；负 = 牌堆淡出后浮起」。
    //       同文件 J3（唯一峰值）与 A1（复活广告位 1 次/局）也都挂在**这个弹层**上。
    //    ② 独立页会**销毁牌堆**，于是「看广告复活」无从续局 —— 而 A1 要求它必须能续。
    //       弹层留在牌局之上，复活才真的能"接回同一局"。
    //    ③ 护栏一致：`endRun()` 仍然只在**三条出口**（本局结算 / 提前退出 / 重掷换关）上走。
    //       注意「看广告复活」**不是出口**（这局还在继续），所以它**不**调 `endRun()` ——
    //       这正是"漏掉的出口把道具偷偷带走"的反面：也不能把还没结束的局提前判死。

    private _resultLayer: Node | null = null;

    /** 终局判定的归属序号（见 `checkBoardEmpty`：旧判决不得在新局面上生效） */
    private _endSeq = 0;

    private onWin(): void {
        if (this._over) return;
        this._over = true;
        if (this._armedErase) this.setArmedErase(false);   // 就绪态必须随局终一起收掉
        this.hideNudgeGlow();                              // 引导环也别留到结算层下面
        AudioService.playSfx(SFX.win, 1.0);
        Haptics.long();
        const reward = 20 + this._level * 5;
        SaveService.instance.onLevelClear(this._level, reward);
        // 通关 = 本局结束 → 出口 ①，走 endRun()
        endRun();
        this.openResult(true, reward, '');
    }

    private onFail(reason: string): void {
        if (this._over) return;
        if (this._armedErase) this.setArmedErase(false);   // 就绪态必须随局终一起收掉
        this.hideNudgeGlow();                              // 引导环也别留到结算层下面
        // 判负的原因必须留痕：弹层文案会按 reason 变，但**日志才是排障入口**
        // （命令行跑无头验收时看不到弹层，只有这行能说明"为什么判我输"）
        this.log(`判负：${reason} · 牌堆剩 ${this._board?.remaining ?? -1} · 槽内 ${this._slots.length} 张`);

        // ★ 赠礼的「复活机会」（骰子 2/12 档）是**自动**生效的：
        //   失败瞬间直消槽内最后 4 张并继续本局，玩家不需要点任何按钮。
        if (reviveLeft() > 0 && useRevive()) {
            this._over = true;                       // 先锁住，动效期间不接受输入
            this.performRevive(PLAY.REVIVE_CLEAR, '复活！');
            this.log(`赠礼复活自动生效（原因 ${reason}）`);
            return;
        }

        // 走到这里 = 这局真的打不下去了 → 弹「负态结算弹层」
        // ⚠️ **此时不调 `endRun()`** —— 玩家可能选「看广告复活」，这局还要继续。
        //    作废只发生在两个出口上（重新挑战 / 返回首页）。
        this._over = true;
        AudioService.playSfx(SFX.fail, 1.0);
        Haptics.heavy();
        this.openResult(false, 0, reason);
    }

    /** 直消槽内最后 N 张并把控制权交回牌局（赠礼复活与广告复活共用） */
    private performRevive(n0: number, title: string): void {
        const n = Math.min(n0, this._slots.length);
        // ★ 与 `resolveMatch` 同口径：直消的是**末尾 n 张**，前面几张的节点先摘出来留给重排
        const gone: number[] = [];
        for (let k = this._slots.length - n; k < this._slots.length; k++) gone.push(k);
        this._pendingKeep = this.takeSurvivors(gone);
        for (let i = 0; i < n; i++) {
            const si = this._slots.length - 1;
            const nd = this._slotNodes[si];
            if (nd?.isValid) {
                tween(nd).to(0.3, { scale: v3(0, 0, 1), angle: 40 }, { easing: EASE.EXIT }).start();
                const d = nd;
                this.timer(320, () => { if (d.isValid) d.destroy(); });
            }
            this._slots.pop();
            this._slotNodes[si] = null;
        }
        this._cleared += n;
        this.nudgeReset();          // 复活直消 N 张 = 有进展 → "卡住"秒表归零
        AudioService.playSfx(SFX.revive, 1.0);
        Haptics.medium();
        toast(this.body, `${title}槽内直消 ${n} 张 —— 继续挑战`);
        this.refreshRevive();
        this.timer(340, () => {
            this._over = false;
            this.relayoutSlots();
            this.refreshAllStates();
            this.refreshSlotDanger();
            this.refreshProgress();
        });
    }

    // ---- 结算弹层（照抄 `game-5-UI-六页视觉稿-v2.html` 的 .dim / .modal 逐值）----
    private openResult(win: boolean, reward: number, reason: string): void {
        if (!this._topLayer) return;
        if (this._resultLayer?.isValid) return;

        const vs = this.visible();
        const layer = createNode('ResultLayer', this._topLayer, { w: 1, h: 1 });
        this._resultLayer = layer;

        // ① 蒙层 rgba(4,20,15,.6)；吃掉触摸，避免点到下面的牌
        const { g: sg } = createGraphicsNode('Dim', layer, { w: vs.width, h: vs.height });
        fillRoundRect(sg, 0, 0, vs.width * 1.5, vs.height * 1.5, 0, '#04140F', RESULT.DIM);
        sg.node.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
            e.propagationStopped = true;
        }, sg.node);

        const REWARDS = win ? 2 : 0;
        // ⚠️ 这个式子与下面 `cur` 的累加**必须逐项同步**（同一个 `RESULT` 表、同一顺序）——
        //    少一项的表现是"卡底留白凭空少一截"，而且**不报错**。末尾有自检兜底。
        const cardH = RESULT.PAD_TOP + RESULT.TITLE_H + RESULT.TITLE_MT
            + RESULT.MASCOT_H + RESULT.MASCOT_MB
            + RESULT.DESC_H + RESULT.DESC_MB
            + (REWARDS ? RESULT.REWARD_H + RESULT.REWARD_MB : 0)
            + RESULT.BTN_GOLD_H + RESULT.BTN_GOLD_MB
            + RESULT.BTN_GHOST_H + RESULT.BTN_HOME_MT
            + RESULT.BTN_HOME_H + RESULT.PAD_BOTTOM;

        // ② 玉质厚卡：锚点 (0.5, 1) = 顶边中点，于是**子元素 y 一律"从卡顶往下量"**
        const card = createNode('Card', layer, {
            w: RESULT.CARD_W, h: cardH, anchor: [0.5, 1], y: Layout.topY(RESULT.TOP),
        });
        const { g: cg } = createGraphicsNode('Bg', card, {
            w: RESULT.CARD_W, h: cardH, anchor: [0.5, 1],
        });
        // 外圈深绿描边环（box-shadow: 0 0 0 3px #0A3327）
        fillRoundRect(cg, 0, -cardH / 2, RESULT.CARD_W + RESULT.RING * 2, cardH + RESULT.RING * 2,
            RESULT.RADIUS + RESULT.RING, '#0A3327', 255);
        // 卡面渐变 #1B6047 → #123F30
        fillVGradient(cg, 0, -cardH / 2, RESULT.CARD_W, cardH, RESULT.RADIUS, '#1B6047', '#123F30', 30);
        // 金色粗边（border 5px var(--gold)）
        strokeRoundRect(cg, 0, -cardH / 2, RESULT.CARD_W, cardH, RESULT.RADIUS, COLOR.GOLD, RESULT.BORDER, 255);

        // ③ 卡内题字（胜「通关啦！」/ 负「就差一点！」）
        //
        //  ★★ 第 48 轮：从"骑缝缎带"改为"**卡内题字**"（原因见 `RESULT.TITLE_*` 的长注释）。
        //   这里有一个**必须连起来看**的两层结构：
        //     先建 TitleShade（深棕纯色、**不带描边**、向下偏 TITLE_DEPTH）
        //     再建 Title     （奶白 + 8px 深墨描边，正常位置）
        //   ⇒ 主标题的描边盖住厚底上缘，只在下方露出 8px 深棕 = 真源的 `0 8px 0 #5C361D`。
        //   ⚠️ 顺序不能反，也不能给厚底加描边（加了之后露出来的是描边色，不是厚底色）。
        //   ⚠️ 两层的文字必须**逐字相同**，否则厚底会在字缝里露出来。
        const titleText = win ? '通关啦！' : '就差一点！';
        const titleY = -(RESULT.PAD_TOP + RESULT.TITLE_H / 2);
        //  ★ 第 49 轮：**视觉居中补偿**。
        //   尾部是全角标点（！？。，…）时向右挪 `TITLE_TRAIL_SHIFT_EM × 字号`。
        //   原因与实测见 `RESULT.TITLE_TRAIL_SHIFT_EM` 的长注释 —— 一句话：
        //   全角「！」的 advance 是 1 em、墨迹只有 ~0.30 em，Label 按 advance
        //   居中 ⇒ 墨迹重心被推左 0.32 em（实测 28.21 设计 px）。
        //   ⚠️ 两层**必须用同一个 x**，否则厚底与主标题会错开半个补偿量。
        const titleShift = /[！？。，、；：）」』】…—]$/.test(titleText)
            ? RESULT.TITLE_TRAIL_SHIFT_EM * RESULT.TITLE_FONT
            : 0;
        const titleShade = createLabel(card, titleText, {
            fontSize: RESULT.TITLE_FONT, color: RESULT.TITLE_DEPTH_COLOR, bold: true, serif: true,
            w: RESULT.CARD_W - 80, h: RESULT.TITLE_H,
            x: titleShift, y: titleY - RESULT.TITLE_DEPTH,
        });
        titleShade.node.name = 'TitleShade';
        const title = createLabel(card, titleText, {
            fontSize: RESULT.TITLE_FONT, color: COLOR.CREAM, bold: true, serif: true,
            outline: '#4A2B18', outlineWidth: 8,
            w: RESULT.CARD_W - 80, h: RESULT.TITLE_H, x: titleShift, y: titleY,
        });
        title.node.name = 'Title';

        // 起点 = 标题框下沿 + 呼吸量。
        //  标题框占卡内 [PAD_TOP, PAD_TOP + TITLE_H] = [12, 167]，
        //  所以 `PAD_TOP + TITLE_H + TITLE_MT = 179` 是吉祥物的顶边 —— 这个关系是
        //  **算出来的**，不是手感；改 PAD_TOP / TITLE_H / TITLE_MT 任一项都要重核。
        let cur = RESULT.PAD_TOP;
        cur += RESULT.TITLE_H + RESULT.TITLE_MT;

        // ④ 吉祥物位
        //  ★ 第 47 轮：**按胜/负换形象**（用户拍板）。
        //    胜 → `SPLASH_MASCOT`（双臂张开的迎接姿势）
        //    负 → `GAME_MASCOT_FAIL`（懊恼不甘 · 抱头，方案 C）
        //  ⚠️ 两者画幅必须一致（960×875 / 1.0971），否则 `aspectW` 反算出的高度
        //     与上面 `cardH` 里那项 `RESULT.MASCOT_H` 会对不上（**不报错**，
        //     表现是卡底留白多一截或少一截）。换图前先复量宽高比。
        //  ★ 第 48 轮：`cur` 在标题段末尾已经走到"吉祥物顶边"，这里**不再**加任何间距
        //    （原来那句 `cur += RESULT.MASCOT_MT` 已随常量一起删除）。
        const mascotY = -(cur + RESULT.MASCOT_H / 2);
        const mascotPath = win ? ASSET.SPLASH_MASCOT : ASSET.GAME_MASCOT_FAIL;
        const mascot = createSprite(card, 'Mascot', {
            path: mascotPath, aspectW: RESULT.MASCOT_W, y: mascotY,
        });
        // 把用的哪张写进节点名后缀 ⇒ 无头验收能**按名字**断言是新的那张，
        // 而不是靠"看着像"（素材路径本身不上屏，运行期没有别的可读痕迹）。
        mascot.name = win ? 'Mascot' : 'MascotFail';
        // ★★ 浮动动效**必须先算出绝对目标 y 再插值**。
        //   tween 的 `position` 是**绝对坐标**，不是"相对当前值" —— 旧代码写成
        //   `{ position: v3(0, 12, 0) }` ⇒ 吉祥物被直接**拽到卡顶**（实测中心 356.3，
        //   而它本该在 559），正好钻到缎带底下，于是看起来"位置不对、被标题压住"。
        //   这类 bug 不报错、静态截图看着只是"位置怪"，只有量过坐标才认得出来。
        tween(mascot)
            .repeatForever(
                tween(mascot).to(1.7, { position: v3(0, mascotY + 12, 0) }, { easing: 'sineInOut' })
                    .to(1.7, { position: v3(0, mascotY, 0) }, { easing: 'sineInOut' }),
            ).start();
        cur += RESULT.MASCOT_H + RESULT.MASCOT_MB;

        // ⑤ 副标题
        const desc = win
            ? `第 ${this._level} 关 · 用时 ${this.elapsedText()}`
            : this.failDesc(reason);
        const dl = createLabel(card, desc, {
            fontSize: RESULT.DESC_FONT, color: COLOR.CREAM_DIM, w: RESULT.CARD_W - 80, h: RESULT.DESC_H,
            y: -(cur + RESULT.DESC_H / 2),
        });
        // 胜：副标题下再补一行"本局成绩"，把信息补足（视觉稿只有一行用时，这里不夺主）
        if (win) dl.color = hex2color(COLOR.CREAM_DIM);
        cur += RESULT.DESC_H + RESULT.DESC_MB;

        // ⑥ 奖励两格（胜态）
        if (win) {
            this.buildRewardRow(card, cur, reward);
            cur += RESULT.REWARD_H + RESULT.REWARD_MB;
        }

        // ⑦ 主按钮
        if (win) {
            this.resultButton(card, 'BtnNext', cur, RESULT.BTN_GOLD_H,
                this._level < LEVELS.length ? '下一关' : '再玩一次', 'gold', RESULT.BTN_GOLD_FONT,
                RESULT.CARD_W - 80, () => {
                    this.closeResult();
                    this.goto(PAGE.START, { level: Math.min(LEVELS.length, this._level + 1) });
                });
        } else {
            this.resultButton(card, 'BtnAdRevive', cur, RESULT.BTN_GOLD_H, '看广告复活', 'gold',
                RESULT.BTN_GOLD_FONT, RESULT.CARD_W - 80, () => this.adRevive());
        }
        cur += RESULT.BTN_GOLD_H + RESULT.BTN_GOLD_MB;

        // ⑧ 次按钮 —— ★ 宽度与主按钮**同宽**（`CARD_W - 80`）。
        //   旧代码是 `CARD_W - 80 - 80` ⇒ 上 540 / 下 460，两个按钮上下紧贴却差 80px，
        //   呈"上宽下窄"的梯形 —— 这就是观感上"下一关那两组按钮很突兀"的直接来源。
        if (win) {
            this.resultButton(card, 'BtnShare', cur, RESULT.BTN_GHOST_H, '分享', 'ghost',
                RESULT.BTN_GHOST_FONT, RESULT.CARD_W - 80, () => {
                    Haptics.light();
                    // ★ 第 53 轮：真分享，**不给任何奖励**。
                    //   合规口径见 `ShareService` 文件头 —— 分享是**传播入口**，
                    //   想要道具只有"看广告"一条路。文案里也刻意不出现"得/领/奖励"。
                    const ok = ShareService.instance.share(this._level);
                    if (!ok) toast(this.body, '当前环境不支持分享，请在微信里试');
                });
        } else {
            // 负态第二排：重新挑战（同一个出口语义 → 走 endRun 作废本局赠礼）
            this.resultButton(card, 'BtnRetry', cur, RESULT.BTN_GHOST_H, '重新挑战', 'ghost',
                RESULT.BTN_GHOST_FONT, RESULT.CARD_W - 80, () => {
                    endRun();
                    this.closeResult();
                    this.goto(PAGE.START, { level: this._level });
                });
        }
        // ⑨ ★ 第 58 轮：末排「返回首页」—— **胜 / 负两态都有**。
        //   理由见 `RESULT.BTN_HOME_H` 的长注释（这不是第三颗装饰按钮，
        //   而是补上"不想继续玩时无路可退"这个缺口）。
        cur += RESULT.BTN_GHOST_H + RESULT.BTN_HOME_MT;
        this.resultButton(card, 'BtnHome', cur, RESULT.BTN_HOME_H, '返回首页', 'ghost',
            RESULT.BTN_GHOST_FONT, RESULT.CARD_W - 80, () => {
                // 返回首页 = 本局的**一个出口** ⇒ 与「重新挑战」同口径：先 `endRun()`
                // 把没花完的局内赠礼按约作废（它本来就会过期，不结账等于凭空多给一局）。
                // ⚠️ 胜态在 `onWin()` 里**已经**调过一次 `endRun()` —— 这里重复调是安全的：
                //    `endRun()` 首行就是 `if (!_run) return null`，天然幂等。
                endRun();
                this.closeResult();
                this.goto(PAGE.HOME);
            });
        cur += RESULT.BTN_HOME_H + RESULT.PAD_BOTTOM;
        // ★ 自检：内容总高必须**恰好**等于卡高。
        //   两者不同步时卡片底部会莫名其妙多/少一截留白，而**不会有任何报错**
        //   （第 38 轮就是这么漏掉 `MASCOT_MB` 的）。用 dev 期的 console.warn 喊出来 ——
        //   release 构建里 `cc.warn` 是空函数，所以这里用 console。
        if (Math.abs(cur - cardH) > 0.5) {
            console.warn(`[结算弹层] cardH(${cardH}) ≠ 内容总高(${cur})，差 ${(cur - cardH).toFixed(1)}`
                + ' —— 检查 openResult 里 cardH 与 cur 两处累加是否同步');
        }

        // ⑩ 胜态：金币雨（全局唯一峰值）—— z 在卡之上（照抄视觉稿 .coins z-index:8 > .modal:7）
        if (win) this.coinRain(layer, vs.width, vs.height);

        // ⑪ 入场：蒙层淡入 + 卡片从 0.92 弹入
        const op = layer.addComponent(UIOpacity);
        op.opacity = 0;
        MotionFx.fadeTo(op, 255, 0.3);
        card.setScale(v3(0.92, 0.92, 1));
        tween(card).to(0.42, { scale: v3(1, 1, 1) }, { easing: EASE.POP }).start();

        this.log(`结算弹层：${win ? '胜' : `负（${reason}）`}`);
    }

    /**
     * 结算弹层里的按钮。
     *
     * 【逐值来源】`game-5-UI-六页视觉稿-v2.html` 的 `.btn-gold` / `.btn-ghost`（第 86 / 93 行）——
     * 那是结算弹层按钮的**需求真源**，本函数所有颜色都照抄它，不许凭手感调：
     *
     *   .btn-gold {
     *     background: linear-gradient(180deg, var(--gold-hi) 0%, var(--gold) 45%, #E8A92E 100%);
     *     border: 3px solid #8A5A10;  border-radius: 60px;  color: #5C3610;
     *     box-shadow: 0 8px 0 #9A6A15, 0 18px 26px rgba(0,0,0,.45),
     *                 inset 0 3px 4px rgba(255,255,255,.7);   ← 顶缘柔光，见 draw3dFace ④
     *   }
     *   .btn-ghost {
     *     border: 3px solid rgba(255,247,230,.55);  color: var(--cream);
     *     background: rgba(0,0,0,.18);   ← 半透明！下面是玉卡的绿会透出来
     *   }
     *
     * ⚠️ 改前这里有两处**明显偏离真源**、也是"按钮突兀"的帮凶：
     *   ① 金按钮 border `#5C3F0C`（比真源 #8A5A10 暗一档，看着像烧焦的边）、
     *      depth `#7A5310`（真源 0 8px 0 #9A6A15）、字 `#2A1C06`（真源 #5C3610）；
     *   ② 次按钮 border 写成了**金色 42%**，而真源是**暖白 55%**；
     *      底色写成 `rgba(11,20,15,0.9)`（几乎全黑），而真源是 `rgba(0,0,0,.18)`
     *      —— 半透明黑压在玉卡上应该是"深玉绿"，不是"纯黑条"。（截图里它就是一条黑带。）
     *
     * 【次按钮为什么用不透明色写「半透明黑压玉卡」】
     *   `fillVGradient` 是**逐条带叠加**（每条带 0.6px 重叠），拿半透明色去填：
     *   每像素被 ~1.2 条带覆盖 ⇒ alpha 被抬高、且条带交界处会浮出横向条纹。
     *   所以这里先算好"rgba(0,0,0,.18) 压在卡片渐变上"的等效实色：
     *     上端 0.82 × #1B6047 = #164E3A ；下端 0.82 × #123F30 = #0F3427。
     *   视觉与真源一致，且是不透明填充、没有叠加问题。
     */
    private resultButton(
        parent: Node, name: string, topOffset: number, h: number, text: string,
        tone: 'gold' | 'ghost', fontSize: number, w: number, onClick: () => void,
    ): void {
        const spec = tone === 'gold'
            ? {
                top: '#FFE08A', bottom: '#E8A92E', depth: '#9A6A15',
                border: '#8A5A10', textc: '#5C3610', thick: 8,
            }
            : {
                top: '#164E3A', bottom: '#0F3427', depth: '#0A2A1F',
                border: 'rgba(255,247,230,0.55)', textc: COLOR.CREAM, thick: 0,
            };

        const btn = createNode(name, parent, { w, h, y: -(topOffset + h / 2) });
        const { g } = createGraphicsNode('Face', btn, { w, h });
        draw3dFace(g, 0, 0, {
            w, h, radius: Math.min(h / 2, SKIN.R_PILL), depth: spec.thick,
            top: spec.top, bottom: spec.bottom, depthColor: spec.depth, border: spec.border,
        });
        createLabel(btn, text, {
            fontSize, color: spec.textc, bold: true, serif: true, w: w - 24, h,
        });
        this.tap(btn, () => { Haptics.light(); onClick(); });
    }

    /** 胜态奖励两格（130×130 深底 + 白描边 + 图标 + 文字） */
    private buildRewardRow(card: Node, topOffset: number, reward: number): void {
        const S = RESULT.REWARD_H;
        const row = createNode('Rewards', card, { w: RESULT.CARD_W - 80, h: S, y: -(topOffset + S / 2) });
        const items: Array<{ kind: 'coin' | 'tile'; text: string }> = [
            { kind: 'coin', text: `麻豆 ×${reward}` },
            { kind: 'tile', text: `清牌 ×${this._cleared}` },
        ];
        const totalW = items.length * RESULT.REWARD_W + (items.length - 1) * RESULT.REWARD_GAP;
        items.forEach((it, i) => {
            const x = -totalW / 2 + i * (RESULT.REWARD_W + RESULT.REWARD_GAP) + RESULT.REWARD_W / 2;
            const cell = createNode(`Reward${i}`, row, { w: RESULT.REWARD_W, h: S, x });
            const { g } = createGraphicsNode('Bg', cell, { w: RESULT.REWARD_W, h: S });
            fillRoundRect(g, 0, 0, RESULT.REWARD_W, S, 18, '#000000', 66);
            strokeRoundRect(g, 0, 0, RESULT.REWARD_W, S, 18, 'rgba(255,255,255,0.30)', 2.5, 255);

            if (it.kind === 'coin') {
                createSprite(cell, 'Ic', { path: ASSET.SPLASH_COIN, aspectW: 58, y: 22 });
            } else {
                // 迷你牌面（矢量，不依赖素材）：象牙底 + 金边
                const { g: tg } = createGraphicsNode('Ic', cell, { w: 44, h: 58, y: 22 });
                fillRoundRect(tg, 0, 0, 44, 58, 6, COLOR.IVORY, 255);
                strokeRoundRect(tg, 0, 0, 44, 58, 6, COLOR.EDGE, 2, 255);
                fillRoundRect(tg, -8, 14, 16, 16, 3, COLOR.RED, 255);
                fillRoundRect(tg, -8, -8, 16, 16, 3, COLOR.BROWN, 200);
            }
            createLabel(cell, it.text, {
                fontSize: 20, color: COLOR.CREAM_DIM, w: RESULT.REWARD_W - 10, h: 24, y: -38,
            });
        });
    }

    /** 金币雨（胜态唯一峰值；纯视觉，收口走 timers） */
    private coinRain(layer: Node, vw: number, vh: number): void {
        const N = 26;
        for (let i = 0; i < N; i++) {
            const x = (Math.random() - 0.5) * (vw - 40);
            const y0 = vh / 2 + 60;
            const coin = createSprite(layer, `Coin${i}`, {
                // 第 45 轮：改走「柔虚」专用素材（方案 B），尺寸 34 → 68
                path: ASSET.SPLASH_COIN_RAIN, w: RESULT.COIN, h: RESULT.COIN, x, y: y0,
            });
            const dur = 1.0 + Math.random() * 0.9;
            const delay = Math.random() * 0.9;
            const drift = (Math.random() - 0.5) * 70;
            const spin = 360 + Math.random() * 540;
            tween(coin)
                .delay(delay)
                .to(dur, {
                    position: v3(x + drift, -vh / 2 - 80, 0),
                    angle: spin,
                }, { easing: EASE.DROP })
                .start();
            this.timer((delay + dur) * 1000 + 60, () => { if (coin.isValid) coin.destroy(); });
        }
        AudioService.playSfx(SFX.win, 0.6);
    }

    /**
     * 失败原因 → 副标题文案（照抄视觉稿口径：「还剩 5 张 · 槽位已满」）。
     *
     * ⚠️ 第 47 轮起 `boardEmptySlotsLeft` **已无产出点**（牌堆清空一律判胜，见
     *   `checkBoardEmpty`）。这一支保留作**兜底**：万一将来又新增一条判负路径
     *   却忘了在这里配文案，至少不会掉进"槽位已满"这个错误口径。
     */
    private failDesc(reason: string): string {
        const left = this._board?.remaining ?? 0;
        const why = reason === 'timeout' ? '时间到'
            : reason === 'boardEmptySlotsLeft' ? '牌出完了 · 槽里没消掉'
            : '槽位已满';
        return `还剩 ${left} 张 · ${why}`;
    }

    private elapsedText(): string {
        const t = Math.max(0, this._totalTime - this._timeLeft);
        if (this._totalTime <= 0) return '不限时';
        const mm = String(Math.floor(t / 60)).padStart(2, '0');
        const ss = String(t % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    }

    /**
     * 看广告复活（A1：1 次/局）—— 补一次复活机会，**这局继续**，所以不走 `endRun()`。
     *
     * ★ 第 53 轮：**只有广告看完（`end`）才复活**。中途关掉 / 拉不到，什么都不发生，
     *   且必须把 `_paused` 复位（否则结算弹层关不掉 = 卡死）。
     */
    private adRevive(): void {
        if (!this._over) return;
        if (this._adBusy) return;                     // 连点保护
        if (this._topLayer?.getChildByName('AdPanel')?.isValid) return;
        AudioService.playSfx(SFX.button, 1.0);

        this._adBusy = true;
        void this.playAd('revive', {
            title: '看广告复活',
            // ⚠️ 复活**没有对应的道具图标**（见 GameStartPage 的同款注释：
            //   复活档用矢量补一枚）⇒ 这里不传 icon，副标题自动上移填补空档。
            sub: '复活机会 ×1',
        }).then((o) => {
            this._adBusy = false;
            if (o !== 'end') {
                if (o === 'fail') toast(this.body, '广告暂时拉不到，稍后再试');
                return;
            }
            this.doAdRevive();
        });
    }

    /** 广告看完后真正执行的复活（与 `adRevive` 分开 ⇒ "看完"这个判据是显式的、可断言的） */
    private doAdRevive(): void {
        if (!this.node.isValid || !this._over) return;
        const run = currentRun();
        if (run) run.revive = run.reviveUsed + 1;      // 补 1 次可用的复活机会
        if (run && !useRevive()) {
            toast(this.body, '复活机会用不了，请重开本关');
            return;
        }
        this.closeResult();
        // 复用同一套复活逻辑（槽内最后 4 张直消）
        this.timer(260, () => this.performRevive(PLAY.REVIVE_CLEAR, '复活！'));
    }

    private closeResult(): void {
        const l = this._resultLayer;
        this._resultLayer = null;
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity) ?? l.addComponent(UIOpacity);
        MotionFx.fadeTo(op, 0, 0.2);
        this.timer(240, () => { if (l.isValid) l.destroy(); });
    }

    // ========================================================
    //  计时
    // ========================================================
    private startTimer(): void {
        this._totalTime = timeLimitOf(this._level - 1, this._def.n);
        this._timeLeft = this._totalTime;
        if (this._totalTime <= 0) {
            if (this._timerLabel?.isValid) this._timerLabel.string = '不限时';
            return;
        }
        this.tickTimer();
    }

    private tickTimer(): void {
        if (this._over || !this.node.isValid) return;
        if (this._paused || this._inBackground) { this.timer(200, () => this.tickTimer()); return; }

        if (this._timeLeft <= 0) {
            this.onFail('timeout');
            return;
        }
        this.updateTimerLabel();
        this.timer(1000, () => {
            // ⚠️ **在途的这一秒到点时，可能已经切到后台 / 已打开弹层** ⇒ 那一秒不该扣。
            //    只在函数开头判一次是不够的：`onHide` 那一刻若正好有一个 1s 定时器在跑，
            //    它到点仍会 `--`，白掉 1 秒（第 52 轮实测：2.6s 采样窗里掉的正是这 1）。
            //    递归回 `tickTimer()` 后会走上面那条 200ms 轮询，不会继续扣。
            if (this._inBackground || this._paused) { this.tickTimer(); return; }
            this._timeLeft--;
            this.tickTimer();
        });
    }

    private updateTimerLabel(): void {
        if (!this._timerLabel?.isValid) return;
        if (this._totalTime <= 0) { this._timerLabel.string = '不限时'; return; }
        const t = Math.max(0, this._timeLeft);
        const mm = String(Math.floor(t / 60)).padStart(2, '0');
        const ss = String(t % 60).padStart(2, '0');
        this._timerLabel.string = `${mm}:${ss}`;
        const warn = t <= PLAY.WARN_SEC;
        this._timerLabel.color = hex2color(warn ? COLOR.WARN : COLOR.CREAM);
        if (warn && t === PLAY.WARN_SEC) {
            MotionFx.breath(this._timerLabel.node, 1.08, 0.5);
            toast(this.body, `⚠ 只剩 ${PLAY.WARN_SEC} 秒`);
        }
    }

    // ========================================================
    //  弹层
    // ========================================================
    private togglePause(): void {
        if (this._over) return;
        this._paused ? this.closePause() : this.openPause();
    }

    private openPause(): void {
        if (!this._topLayer) return;
        this._paused = true;
        const layer = createNode('PausePanel', this._topLayer, { w: 1, h: 1 });
        layer.addComponent(UIOpacity).opacity = 0;

        const vs = this.visible();
        const { g: sg } = createGraphicsNode('Scrim', layer, { w: vs.width, h: vs.height });
        fillRoundRect(sg, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#000000', 176);
        sg.node.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
            e.propagationStopped = true;
        }, sg.node);

        const panel = createNode('Card', layer, { w: 520, h: 460 });
        const { g: cg } = createGraphicsNode('Bg', panel, { w: 520, h: 460 });
        fillRoundRect(cg, 0, 0, 538, 478, 52, 'rgba(246,196,69,0.10)', 255);
        fillRoundRect(cg, 0, 0, 520, 460, 44, 'rgba(9,18,13,0.98)', 255);
        strokeRoundRect(cg, 0, 0, 520, 460, 44, 'rgba(246,196,69,0.34)', 2.5, 255);

        createLabel(panel, '已暂停', {
            fontSize: 44, color: COLOR.CREAM, bold: true, serif: true, w: 480, h: 56, y: 160,
        });
        createLabel(panel, `第 ${this._level} 关 · 已清 ${this._cleared}/${this._def.n}`, {
            fontSize: 24, color: COLOR.CREAM_MUTE, w: 480, h: 30, y: 112,
        });

        this.panelButton(panel, 30, '继续游戏', 'gold', () => this.closePause());
        this.panelButton(panel, -60, '重开本关', 'jade', () => {
            this.close(PAGE.GAME, { level: this._level, restart: true });
        });
        this.panelButton(panel, -150, '返回首页', 'ghost', () => {
            // ★ 第 52 轮：**破坏性操作加二次确认**。
            //   原来一点就直接退 —— 误触一次本局就没了，而且没有任何提示
            //   （设计规则 P3/P2-R3 早就写了"破坏性操作需二次确认"，代码里一直没做）。
            if (!this._topLayer) return;
            confirmDialog(this._topLayer, {
                title: '返回首页？',
                desc: '本局进度不会保留',
                ok: '确认返回',
                cancel: '再玩一会',
                onOk: () => {
                    endRun();
                    this.close(PAGE.HOME);
                },
            });
        });

        MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.22);
        panel.setScale(v3(0.92, 0.92, 1));
        tween(panel).to(0.28, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    private closePause(): void {
        this._paused = false;
        const l = this._topLayer?.getChildByName('PausePanel');
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.18);
        const dead = l;
        this.timer(220, () => { if (dead.isValid) dead.destroy(); });
    }

    private panelButton(parent: Node, y: number, text: string, tone: string, onClick: () => void): void {
        const W = 380, H = 84;
        const btn = createNode(`Btn_${text}`, parent, { w: W, h: H, y });
        const { g } = createGraphicsNode('Face', btn, { w: W, h: H });
        if (tone === 'gold') {
            fillRoundRect(g, 0, -8, W, H, 42, '#7A5310', 255);
            fillVGradient(g, 0, 0, W, H, 42, '#FFE08A', '#C8912B', 18);
            strokeRoundRect(g, 0, 0, W, H, 42, '#5C3F0C', 3, 255);
        } else if (tone === 'jade') {
            fillRoundRect(g, 0, -8, W, H, 42, '#0C3A2C', 255);
            fillVGradient(g, 0, 0, W, H, 42, '#55B79A', '#1F6B54', 18);
            strokeRoundRect(g, 0, 0, W, H, 42, '#0A3327', 3, 255);
        } else {
            fillRoundRect(g, 0, -8, W, H, 42, '#04100B', 255);
            fillRoundRect(g, 0, 0, W, H, 42, 'rgba(11,20,15,0.92)', 255);
            strokeRoundRect(g, 0, 0, W, H, 42, 'rgba(246,196,69,0.42)', 2.5, 255);
        }
        createLabel(btn, text, {
            fontSize: 32, color: tone === 'ghost' ? COLOR.CREAM : (tone === 'gold' ? '#2A1C06' : COLOR.CREAM),
            bold: true, serif: true, w: W - 40, h: H,
        });
        this.tap(btn, onClick);
    }

    /** 规则弹层：整页规则图 + 全屏热区关闭（照抄第 27 轮的"✕ 已烘焙进图"口径） */
    private openRule(): void {
        if (!this._topLayer) return;
        if (this._topLayer.getChildByName('RulePanel')?.isValid) return;
        this._paused = true;

        const vs = this.visible();
        // ★★ 第 40 轮修 bug：原来这里是 `{ w: 1, h: 1 }` ——
        //   `Node.EventType.TOUCH_END` 的命中判定走的是节点自己的 `UITransform`，
        //   尺寸 1×1 就等于**触摸命中区只有 1 像素**：用户怎么点都在命中区之外，
        //   事件永远不会派发到这一层 ⇒「点击任意处关闭」从来就没生效过。
        //   （同目录的 PausePanel / AdPanel 也是 1×1，但它们靠卡内按钮关闭，所以没暴露。）
        //   修法：与 scrim 同口径给足 1.4× 全屏，边缘 20% 也能点到。
        const layer = createNode('RulePanel', this._topLayer, {
            w: vs.width * 1.4, h: vs.height * 1.4,
        });
        layer.addComponent(UIOpacity).opacity = 0;

        const { g: sg } = createGraphicsNode('Scrim', layer, { w: vs.width, h: vs.height });
        fillRoundRect(sg, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#000000', 210);

        // 整页规则图（宽 632 = 1264/2）
        const img = createSprite(layer, 'RuleImg', { path: ASSET.RULE_PAGE, aspectW: 632 });
        let h = 1020;
        loadFrame(ASSET.RULE_PAGE, (sf) => {
            if (!sf || !img.isValid) return;
            const ow = sf.originalSize.width || 1;
            const oh = sf.originalSize.height || 1;
            h = 632 * (oh / ow);
            img.getComponent(UITransform)!.setContentSize(632, h);
        });
        void h;

        createLabel(layer, '点击任意处关闭', {
            fontSize: 22, color: COLOR.CREAM_MUTE, w: 500, h: 30, y: -vs.height / 2 + 60,
        });

        layer.on(Node.EventType.TOUCH_END, () => this.closeRule(), layer);

        // ★★ 双保险（第 40 轮）：再挂一条**全局输入**监听。
        //   节点触摸的命中判定要过 `UITransform`，一旦尺寸/层级有任何意外就是静默失效；
        //   而 `input.on(TOUCH_END)` 不参与命中判定，只要屏幕被点就一定触发。
        //   · 延迟 120ms 注册：`openRule()` 本身正是被一次 TOUCH_END 调起来的，
        //     同帧注册有概率把"打开它的那一次点击"也吃掉 ⇒ 规则页刚开就被关。
        //   · 只保留一份（重复 open 已被前面的 `getChildByName('RulePanel')` 挡住）。
        this._ruleTapCb = (): void => this.closeRule();
        this.timer(120, () => {
            if (this._ruleTapCb) input.on(Input.EventType.TOUCH_END, this._ruleTapCb);
        });

        MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.24);
    }

    private closeRule(): void {
        const l = this._topLayer?.getChildByName('RulePanel');
        this._paused = false;
        this.detachRuleTap();
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.2);
        const dead = l;
        this.timer(240, () => { if (dead.isValid) dead.destroy(); });
    }

    /** 摘掉规则页的全局兜底监听（关闭时 / 离开本页时都要摘，否则会跨页残留） */
    private detachRuleTap(): void {
        if (!this._ruleTapCb) return;
        input.off(Input.EventType.TOUCH_END, this._ruleTapCb);
        this._ruleTapCb = null;
    }

    // ========================================================
    //  ★ 第 53 轮：广告（A1 复活 / A2 换道具）与分享
    // ========================================================
    //
    //  【统一入口 `playAd()`】复活与换道具都走它，内部二选一：
    //    · `AdService.modeOf(scene) === 'real'` ⇒ 真微信激励视频；
    //    · 否则 ⇒ `openMockAdPanel()` 的**替身**（5 秒进度条，界面上如实标「演示用」）。
    //    把"没有广告位"这件事**只**限定在"广告从哪来"这一个点上 ——
    //    于是 T06/T07/T08 的每条判据在预览环境下都能**确定性复现**，
    //    而不是"等哪天有广告位了再验"。
    //
    //  【★ 合规改造：分享不再换奖励（第 53 轮用户拍板）】
    //    旧版这一屏是「看广告满 5 秒，**或分享给好友** —— 到手即用」，即"分享 = 白送道具"。
    //    微信《小游戏运营规范》把"分享后才能获得奖励"明确列为**诱导分享**，故这条路**已删**。
    //    现在：想拿道具**只有看广告一条路**；分享退化为**纯传播入口**
    //    （结算页胜态那颗「分享」按钮，见 `openResult()` 的 `BtnShare`）。
    //
    //  【为什么 `abort` / `fail` 一律不发】见 `AdService` 文件头：这是判据不是体验 ——
    //    "关掉了也算数"会让"看广告"这个行为失去意义。

    /** 正在开着的替身广告面板（null = 没开）；配 `settleAdPanel()` 用 */
    private _mockAd: MockAdHandle | null = null;
    /** 广告流程进行中（含替身面板）—— 连点保护；`AdService` 自己也有一次保护 */
    private _adBusy = false;

    /** 播一次广告（真 / 替身两条路），返回 `end` | `abort` | `fail` */
    private playAd(scene: AdScene, mockUi: { title: string; icon?: string; sub: string }): Promise<AdOutcome> {
        if (AdService.instance.modeOf(scene) === 'real') {
            return AdService.instance.play(scene);
        }
        return this.openMockAdPanel({ ...mockUi, seconds: AD.MOCK_SECONDS });
    }

    /**
     * 替身广告面板（mock 模式专用）。
     *
     * ★ 第 56 轮：面板本体抽到 **`ui/AdDialog.ts`** —— 首页「道具商城」要用**同一块**面板，
     *   各写一份的代价是两处会慢慢长得不一样（秒数 / 文案 / 进度条 / 幂等收口）。
     *   本页只留两件"只有本页才有"的事：
     *     ① 播之前把 `_paused` 置上、引导环收掉；
     *     ② 拿到结局后复位 `_paused`（**少一次复位就是整页卡死** —— T08 的核心判据）。
     */
    private openMockAdPanel(ui: { title: string; icon?: string; sub: string; seconds: number }): Promise<AdOutcome> {
        const top = this._topLayer;
        if (!top) return Promise.resolve('fail');
        // 幂等：已经开着一块就别再开（连点）。判 `fail` 是故意的 —— 什么都不发生。
        if (top.getChildByName('AdPanel')?.isValid) return Promise.resolve('fail');

        this._paused = true;
        this.hideNudgeGlow();                 // 引导环先收掉，别压在弹层上

        return new Promise<AdOutcome>((resolve) => {
            this._mockAd = openMockAdDialog({
                parent: top,
                name: 'AdPanel',
                ui,
                schedule: (ms, cb) => this.timer(ms, cb),
                onSettle: (o) => {
                    this._mockAd = null;
                    this._paused = false;      // ★ 必须复位，否则整页卡死
                    resolve(o);
                },
            });
        });
    }

    /**
     * 关闭替身广告面板并结算。**无论从哪条路来都只结算一次**（幂等）——
     * 现在这一步由 `AdDialog` 的 `settle()` 负责，本方法只是**转发**。
     *
     * ⚠️ `_paused = false` 走 `openMockAdPanel` 的 `onSettle` —— 少一次复位就是**整页卡死**
     *   （所有触摸都被 `_paused` 挡住，玩家只能杀进程）。这条是 T08 的核心判据。
     */
    private settleAdPanel(outcome: AdOutcome): void {
        this._mockAd?.settle(outcome);
    }

    /**
     * 道具不够 → **看广告换一次**，换来的道具**立刻生效**（不进库存）。
     *
     * ★ 第 46 轮口径（**保留**）：骰子赠礼给库存、库存空了才走这里；
     *   看完**不再补 1 个进库存**，而是**立马使用、产生效果** ——
     *   补库存的话玩家还得再点一次道具键，中间那步是纯摩擦。
     * ★ 第 53 轮改动：① 广告来源换成 `AdService`；
     *                ② **删除「分享给好友」这条发奖路径**（合规，见本节开头）。
     */
    private openAd(id: string): void {
        if (!this._topLayer) return;
        if (this._adBusy) return;
        if (this._topLayer.getChildByName('AdPanel')?.isValid) return;

        this._adBusy = true;
        const tname = TOOL_META[id as keyof typeof TOOL_META].name;
        void this.playAd('tool', {
            title: '获取道具',
            icon: TOOL_ICON[id as keyof typeof TOOL_ICON],
            sub: `${tname} ×1`,
        }).then((o) => {
            this._adBusy = false;
            this.grantByAd(id, o);
        });
    }

    /**
     * 广告结束后的结算分支。
     * ★ **只有 `end` 才发**；`abort`（中途关）/ `fail`（拉不到）**一个字节都不给**。
     */
    private grantByAd(id: string, outcome: AdOutcome): void {
        if (outcome !== 'end') {
            if (outcome === 'fail') toast(this.body, '广告暂时拉不到，稍后再试');
            return;
        }
        if (!this.node.isValid || this._over) return;   // 这几十秒里局面可能已经变了

        const reason = this.propBlockReason(id);
        if (reason) {
            toast(this.body, reason);
            return;
        }

        const tname = TOOL_META[id as keyof typeof TOOL_META].name;
        // ★ 这条路径**不扣库存**（道具从来没进过库存）——
        //   与 `useTool` 的唯一差别就是这一点，效果完全同源（都走 `applyTool`）。
        if (id === TOOL.ERASE) {
            // 「消除」是两段式的：这里只负责把它推进就绪态，抛给玩家的提示由 armErase 发。
            // ⚠️ 传 `false` —— 这一次是靠广告换来的，**没进过库存**，
            //   真正消掉那张牌时不得再扣一次（见 `_eraseFromStock`）。
            if (this.armErase(false)) {
                AudioService.playSfx(SFX.toolUse, 1.0);
                Haptics.medium();
            }
            this.nudgeReset();
            return;
        }
        if (!this.applyTool(id)) return;

        AudioService.playSfx(SFX.toolUse, 1.0);
        Haptics.medium();
        this.refreshTools();
        toast(this.body, `看完广告 · ${tname} 已生效`);
        this.nudgeReset();
    }

    /** 碰 / 吃 飘字（第 5 节爽点：大字 + 缩放冲击） */
    private popToast(kind: MatchType): void {
        if (!this._topLayer) return;
        const text = MATCH_LABEL[kind] ?? kind;
        const node = createNode('Pop', this._topLayer, { w: 300, h: 160 });
        node.addComponent(UIOpacity).opacity = 0;
        createLabel(node, text, {
            fontSize: FONT.POP, color: COLOR.GOLD_HI, bold: true, serif: true,
            w: 300, h: 160, outline: '#7A3B12', outlineWidth: 8,
        });
        node.setPosition(0, Layout.tableBox().cy + 60, 0);
        node.setScale(v3(0.4, 0.4, 1));
        const op = node.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 255, 0.12);
        tween(node).to(0.24, { scale: v3(1.15, 1.15, 1) }, { easing: 'backOut' }).start();
        this.timer(360, () => {
            if (!node.isValid) return;
            tween(node).to(0.3, { scale: v3(1.5, 1.5, 1) }, { easing: 'quadIn' }).start();
            MotionFx.fadeTo(op, 0, 0.3);
        });
        this.timer(700, () => { if (node.isValid) node.destroy(); });
    }

    // ========================================================
    //  入场
    // ========================================================
    protected onEnter(): void {
        this.refreshProgress();
        this.refreshTools();
        this.refreshAllStates();
        this.startTimer();
        this.startNudge();          // ★ 第 46 轮：卡住提示心跳（含开局宽限）
        // 预加载音效（本局要用的）
        AudioService.preloadAll([SFX.tilePick, SFX.peng, SFX.chi, SFX.slotWarn, SFX.toolUse, SFX.shuffle, SFX.revive]);
        // ★ 第 53 轮：把当前关卡号告诉 ShareService —— 分享文案要带进度，而服务
        //   不该反过来 import 页面（那是反向依赖）。每次入场刷新一次即可。
        ShareService.instance.setLevel(this._level);
        this.installDebugBridge();
        this.log(`入场完成 · 开局可点 ${this._board?.pickable().length ?? 0} 张`);
    }

    // ========================================================
    //  工具
    // ========================================================

    /** 用 `timers` 托管延时（页面销毁自动清理 —— **绝不用裸 setTimeout**） */
    private timer(ms: number, fn: () => void): void {
        this.timers.add(ms, fn);
    }

    private tap(node: Node, onClick: () => void): void {
        node.on(Node.EventType.TOUCH_START, () => {
            tween(node).to(0.07, { scale: v3(0.94, 0.94, 1) }).start();
        }, node);
        const release = (): void => {
            tween(node).to(0.14, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        };
        node.on(Node.EventType.TOUCH_END, () => { release(); onClick(); }, node);
        node.on(Node.EventType.TOUCH_CANCEL, release, node);
    }

    private log(msg: string): void {
        if (DEBUG.LOG_STATE) console.log(`[GamePage] ${msg}`);
    }

    // ========================================================
    //  调试桥（无头验收用）
    // ========================================================
    private installDebugBridge(): void {
        const api = {
            state: () => ({
                level: this._level,
                remaining: this._board?.remaining ?? -1,
                slots: this._slots.length,
                slotMax: this._slotMax,
                cleared: this._cleared,
                total: this._def.n,
                locked: this._locked,
                over: this._over,
                paused: this._paused,
                timeLeft: this._timeLeft,
                revive: reviveLeft(),
                activeSeg: this._board?.activeSeg ?? -1,
            }),
            /**
             * 可点牌的**屏幕坐标**（左上原点、设计 px）—— 派发真实鼠标事件要用。
             *
             * ⚠️ 坐标口径（2026-10-06 实测打表定，别再凭印象改）：
             *    `node.worldPosition` 本身就是「**左下原点、y 向上、设计 px**」——
             *    Canvas 的世界坐标 = 可视尺寸的一半 (375, 667)，子节点在此之上累加。
             *    所以 **x 直接用，只有 y 需要翻转**：`y = vs.height - w.y`。
             *
             *    这里曾写成 `x = w.x + vs.width/2` / `y = vs.height/2 - w.y`
             *    （按"世界坐标是屏幕中心原点"的印象），结果 x 恒**多偏半个屏宽**：
             *    牌位实际落在 375~1125，而视口只有 750 宽 —— 数字看着像坐标、
             *    点哪儿都不中，是最难查的一类坐标 bug。
             */
            pickables: () => {
                const board = this._board;
                if (!board) return [];
                const vs = viewportSize();
                const out: Array<{ id: number; face: string; x: number; y: number }> = [];
                for (const i of board.pickable()) {
                    const v = this._views[i];
                    if (!v) continue;
                    const w = v.node.getWorldPosition();
                    out.push({
                        id: i,
                        face: faceLabel(board.tiles[i].face),
                        x: Math.round(w.x),
                        y: Math.round(vs.height - w.y),
                    });
                }
                return out;
            },
            /** 与真实触摸**同一个**处理函数（不是旁路） */
            pick: (id: number) => this.onTapTile(id),
            useTool: (id: string) => this.useTool(id),
            slots: () => this._slots.slice(),
            /**
             * 槽内每一张的牌面（与 `pickables().face` 同一口径）。
             *
             * 【为什么需要它】无头验收要**故意**填满槽子以逼出失败链路，
             * 就必须知道"槽里已经有什么"，才能挑出"点进去不会凑成 3 张"的牌。
             * 只靠 `slots()` 给的棋盘下标是推不出牌面的（那些牌已不可点，
             * 不会出现在 `pickables()` 里）。
             */
            slotFaces: () => this._slots.map((i) => faceLabel(this._board?.tiles[i].face ?? 0)),
            /**
             * ★ 第 46 轮：槽内小牌的**屏幕坐标**（左上原点、设计 px，与 `pickables()` 同口径）。
             *
             * 【为什么要它】「消除」改成两段式之后，无头验收必须先点道具键、**再点槽内一张牌**。
             *   槽内牌不是牌堆节点（在 `_slotCells` 下、且被 `slotBar` 的坐标链影响），
             *   用 `pickables()` 那套拿不到它们。没有这个接口，就**无法自证**
             *   "选中槽内一张 → 强制消掉"这条链路真的通。
             */
            slotPickables: () => {
                const vs = viewportSize();
                const out: Array<{ i: number; face: string; x: number; y: number }> = [];
                this._slotNodes.forEach((n, i) => {
                    if (!n?.isValid) return;
                    const w = n.getWorldPosition();
                    out.push({
                        i,
                        face: faceLabel(this._board?.tiles[this._slots[i]]?.face ?? 0),
                        x: Math.round(w.x),
                        y: Math.round(vs.height - w.y),
                    });
                });
                return out;
            },
            /** 「消除」是否处于就绪态（断言用） */
            armed: () => this._armedErase,
            /** 这一次就绪态是否消耗库存（广告/分享换来的 = false）—— 断言用 */
            eraseFromStock: () => this._eraseFromStock,
            /**
             * **本局道具库存快照**（`currentRun().items`）。
             *
             * 【为什么必须有】"库存空了才看广告"这条链路要能被断言 ——
             *   只看 UI 上的角标数字是**不够**的：角标画的是 `run.items[id]`，
             *   但它不告诉你"广告得来的那一次到底扣没扣"。
             *   第 46 轮修的正是这个 bug（凭空虚扣）⇒ 断言必须是**库存本身**。
             */
            runItems: () => {
                const run = currentRun();
                return run ? { ...run.items } : null;
            },
            /**
             * **道具可用总数快照** = 本局赠礼 + 跨局库存（`itemStock()` 逐个取）。
             *
             * 【为什么要与 `runItems` 分开留两个接口】第 57 轮三的 bug 正是
             *   "角标只画了半本账"。只留 `runItems` 的话，断言会**跟着代码一起错**
             *   （判据 8：现状即期望）—— 必须有一个"玩家真正能用的总数"可断言。
             */
            stock: () => {
                const out: Record<string, number> = {};
                for (const id of TOOL_ORDER) out[id] = itemStock(id);
                return out;
            },
            /**
             * **跨局库存快照**（`SaveService.inventory`，商城 / 签到那本账）。
             * 与 `runItems` 一起才能把"消耗的是哪一本账"验清楚（赠礼优先）。
             */
            saveStock: () => ({ ...SaveService.instance.data.inventory }),
            /**
             * ⚠️ **仅调试用**：给本局道具栏补货。
             *
             * 【为什么需要】骰子赠礼只给 1 个、且和值随机 ⇒ "有库存"这条路径
             *   在无头验收里**无法确定性复现**（要靠篡改 `Math.random` 才凑得出和值，
             *   那还会污染页面其它随机）。有了它，两条路径（库存 / 广告）都能
             *   在同一局里按需构造、逐条断言。
             * ⚠️ 它只动 `currentRun().items`，**不写存档** —— 本局限定的护栏不受影响。
             */
            grantRunItem: (id: string, n = 1) => {
                const run = currentRun();
                if (!run) return false;
                const k = id as keyof typeof run.items;
                run.items[k] = (run.items[k] ?? 0) + n;
                this.refreshTools();
                return true;
            },
            /** 暂存架内容（断言「移出」真的搬进了临时三槽、且架子显形） */
            temp: () => ({
                count: this._temp.length,
                faces: this._temp.map((i) => faceLabel(this._board?.tiles[i].face ?? 0)),
                visible: !!this._tempBar?.active,
                cap: PLAY.TEMP_CAPACITY,
            }),
            /**
             * 暂存架里每张牌的**屏幕坐标**（左上原点、设计 px，与 `pickables()` 同口径）。
             *
             * ⚠️ 【为什么不能靠节点名找】「移出」是把**槽内的牌节点原样 reparent** 到架子上
             *   （见 `toolMove` 第 ⑤ 步），所以它们仍叫 `SlotTile0/1/2`，
             *   **不叫** `TempTile`（只有兜底补建的那张才叫 `TempTile`）。
             *   按名字找 ⇒ 找不到，且会误判成"架子里没牌"。
             */
            tempPickables: () => {
                const vs = viewportSize();
                const out: Array<{ i: number; face: string; x: number; y: number }> = [];
                this._tempNodes.forEach((n, i) => {
                    if (!n?.isValid) return;
                    const w = n.getWorldPosition();
                    out.push({
                        i,
                        face: faceLabel(this._board?.tiles[this._temp[i]]?.face ?? 0),
                        x: Math.round(w.x),
                        y: Math.round(vs.height - w.y),
                    });
                });
                return out;
            },
            /**
             * **逐张牌的覆盖 / 层号 / 所属段 / 是否可点** —— 断言需求⑤「段外也能点」用。
             *
             * 【为什么不能只看 `pickables().length` 变大】张数变多可能是任何原因
             *   （覆盖模型改了、阈值改了…）。要证明的是**特定那一张**"整张露在外面
             *   却因为是下一段而点不动"的牌现在能点了 ⇒ 必须拿到 `cover` 与 `seg`。
             */
            tileDiag: () => {
                const b = this._board;
                if (!b) return [];
                const segs = this._def.segs ?? [];
                return b.tiles.map((t) => {
                    let seg = -1;
                    for (let s = 0; s < segs.length; s++) {
                        if (t.z >= segs[s].lo && t.z < segs[s].hi) { seg = s; break; }
                    }
                    return {
                        id: t.id, z: t.z, seg, alive: t.alive,
                        cover: Math.round(t.cover * 1000) / 1000,
                        pick: t.alive && t.cover < PLAY.COVER_TH,
                    };
                });
            },
            /** 当前档位参数（断言需求⑥"难度参数真的接在运行期上"） */
            diffCfg: () => ({
                enabled: DIFF.ENABLED, block: DIFF.BLOCK,
                effBlock: diffBlockOf(this._level),
                perLevel: { ...DIFF.PER_LEVEL }, seed: DIFF.SEED,
            }),
            /**
             * **关卡表原样牌面 vs 当前实际牌面**（断言难度置换真的生效）。
             * 只做逐位比对 ⇒ `same === true` 就说明置换**根本没跑**。
             */
            faceDiff: () => {
                const b = this._board;
                if (!b) return null;
                const base = this._def.f;
                let n = 0;
                for (let i = 0; i < base.length; i++) if (b.tiles[i].face !== base[i]) n++;
                return { total: base.length, changed: n, same: n === 0 };
            },
            /**
             * ★ 第 46 轮：**卡住提示**的当前状态（断言用）。
             * `idle` 的单位是秒，开局宽限期内是**负数**（见 `CFG.NUDGE.START_GRACE`）。
             */
            nudge: () => ({
                idle: this._nudgeIdle,
                cool: this._nudgeCool,
                shown: this._nudgeShown,
                glowId: this._nudgeGlowId,
            }),
            /**
             * **直接触发一次提示**（跳过 3 秒等待）—— 供无头验收用。
             *
             * 【为什么需要它】3 秒 + 开局宽限 6 秒 = 约 9 秒才能看到提示，
             *   而截一次游戏页要反复起停无头浏览器；更要命的是**判据不唯一**
             *   （"没出现"到底是 bug 还是没等够，说不清）。
             *   有了它，"挂环 → 点环 → 道具生效"这条链路的每一条断言都能**确定性复现**。
             * ⚠️ 它走的是与 `tickNudge()` **同一个** `showNudge()`，不是旁路。
             * @returns 被推荐的道具 id（一个都不能用时返回 null）
             */
            forceNudge: () => {
                const id = this.pickNudgeProp();
                if (!id) return null;
                this._nudgeShown = true;
                this._nudgeCool = NUDGE.COOLDOWN;
                this.showNudge(id);
                return id;
            },
            /**
             * 引导**命中盒**的屏幕坐标（左上原点、设计 px，与 `pickables()` 同口径）。
             *
             * ⚠️ 派发真实鼠标事件前**必须**过 `designToCss()`（设计 px ≠ CSS px，
             *   见本文件 `pickables()` 的长注释）；这里同时给出**键本身**的中心，
             *   因为点键永远有效，而命中盒是刻意放大过的（含环与 ▼）。
             */
            nudgeHit: () => {
                const id = this._nudgeGlowId;
                const hit = this._nudgeGlow?.getChildByName('NudgeHit');
                if (!id || !hit?.isValid) return null;
                const vs = viewportSize();
                const w = hit.getWorldPosition();
                const ui = hit.getComponent(UITransform);
                const cell = this._toolCells[TOOL_ORDER.indexOf(id)];
                const cw = cell?.getWorldPosition();
                return {
                    id,
                    x: Math.round(w.x),
                    y: Math.round(vs.height - w.y),
                    w: Math.round(ui?.contentSize.width ?? 0),
                    h: Math.round(ui?.contentSize.height ?? 0),
                    cellX: Math.round(cw?.x ?? 0),
                    cellY: Math.round(vs.height - (cw?.y ?? 0)),
                };
            },
            /** 等价于手指点中槽内第 i 张（走**同一个** `onSlotNodeTap`，不是旁路） */
            tapSlot: (i: number) => {
                const n = this._slotNodes[i];
                if (!n?.isValid) return false;
                this.onSlotNodeTap(n);
                return true;
            },
            /**
             * ⚠️ **仅调试用**：直接把局面推到结算弹层，用于量结算层版式。
             *
             * 【为什么要它】结算弹层只在"胜/负"那一刻存在，用截图脚本"等一会儿再拍"
             *   永远拍不到，于是这一屏的版式**从来没被真实几何量过** —— 本轮
             *   「下一关按钮比分享按钮宽 80px」「吉祥物被缎带压住」两个问题都是靠人眼
             *   从截图上看出来的，机器一句断言都没有。
             *   它**不清盘、不算分**，只走 `openResult()` 的绘制路径 ⇒ **只能用来量几何**，
             *   不能当作"通关流程"的验证（那是 `g5-smoke.mjs` 的活）。
             */
            demoResult: (win = true) => {
                if (this._over) return false;
                this._over = true;
                this.openResult(win, 20 + this._level * 5, 'slotsFull');
                return true;
            },
            /**
             * ★ 第 53 轮：**平台能力现状**（广告 / 分享 / 登录）。
             *
             * ⚠️ 它**只报事实、不做断言**—— 特别是"广告走真还是走替身"这件事，
             *   本身就是一条必须如实说出来的口径（没有广告位 ≠ 假装有广告）。
             *   本项目的规矩是"判据要能自证"：`ad.revive === 'mock'` 时，
             *   任何"复活可用"的结论都只能标成"替身链路通过"，不能写成"广告通过"。
             */
            platform: () => ({
                ad: AdService.instance.describe(),
                adPanelOpen: !!this._topLayer?.getChildByName('AdPanel')?.isValid,
                adBusy: this._adBusy,
                shareAvailable: ShareService.instance.available,
                landingLevel: ShareService.instance.landingLevel(),
            }),
            /**
             * ⚠️ **仅供验收脚本**：运行期翻转广告配置。
             *
             * 【为什么必须留这个口子】`CFG.AD.REAL_ENABLED` 默认 false（理由见 CFG 第 九之二 节），
             *   于是浏览器 / 预览环境**永远**走替身面板，`AdService` 的三种真实结局
             *   （`end` 发奖 / `abort` 不发 / `fail` 不发）就**没有任何一条能端到端验**。
             *   有了它，脚本可以：注入 fake `wx.createRewardedVideoAd` → 翻开关 → 用
             *   **真实鼠标**点「看广告复活」→ 由脚本决定回调哪一条 ⇒ 三条路各走一遍。
             *   （这是 CFG 里"本文件唯一不写 `as const`"那条注释所承诺的能力，
             *     第 53 轮才把访问路径补上 —— 此前那句注释是**空头支票**。）
             *
             * 【安全性】生产代码里**没有任何地方**调它；它只把 `AD` 上两个字段改掉，
             *   不改任何别的状态。改回 `{ REAL_ENABLED: false }` 即完全恢复默认行为。
             */
            adConfig: (patch: { REAL_ENABLED?: boolean; AD_UNIT?: Partial<Record<AdScene, string>> }) => {
                if (typeof patch?.REAL_ENABLED === 'boolean') AD.REAL_ENABLED = patch.REAL_ENABLED;
                if (patch?.AD_UNIT) Object.assign(AD.AD_UNIT, patch.AD_UNIT);
                return AdService.instance.describe();
            },
            /**
             * 跨局库存 + 金币（**负控断言用**：广告中途关 / 拉不到时，这些必须逐字段不变）。
             * 注意它读的是 `SaveService`（跨局账），与"本局限定的赠礼"是两套账。
             */
            inventory: () => {
                const d = SaveService.instance.data;
                return { ...d.inventory, coins: d.coins };
            },
        };
        (globalThis as unknown as { __game5?: unknown }).__game5 = api;
        this.log('调试桥已挂载：globalThis.__game5');
    }

    private uninstallDebugBridge(): void {
        delete (globalThis as unknown as { __game5?: unknown }).__game5;
    }
}

// ============================================================
//  模块内引用（避免动态 require —— 打包器会把 require 当外部依赖）
// ============================================================
import { Graphics, Label, view } from 'cc';

const GraphicsCtor = Graphics;
const LabelCtor = Label;

function viewportSize(): { width: number; height: number } {
    const s = view.getVisibleSize();
    return { width: s.width, height: s.height };
}

// 贴图路径真源在 `core/TileData.spritePath` —— 这里**不再自己拼一遍**。
// （曾在本文件里重复实现过一次 `tiles/<suit>/<suit><num>`；两份一旦分叉，
//   表现是"部分牌面永远加载不出来且完全不报错"。）
const spritePathOf = spritePath;

function drawFallbackFace(parent: Node, face: number, w: number, h: number): void {
    const grp = createNode('Fb', parent, { w, h });
    const g = grp.addComponent(GraphicsCtor);
    fillRoundRect(g, 0, 0, w, h, 6, COLOR.IVORY, 255);
    strokeRoundRect(g, 0, 0, w, h, 6, COLOR.EDGE, 1.5, 255);
    createLabel(grp, faceLabel(face), {
        fontSize: Math.max(10, Math.round(h * 0.36)), color: COLOR.BROWN, bold: true, serif: true, w, h,
    });
}
