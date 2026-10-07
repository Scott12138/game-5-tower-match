/**
 * ============================================================
 *  HomePage.ts · 首页（②）
 * ============================================================
 *  版式**逐值照抄** `assets/home/首页-定稿.html`（750×1334）。
 *
 *  ★ 关键口径：**内容层整体下移 `--yshift = 64`**（用户拍板定稿值）。
 *    实现上不是每个元素各加 64，而是把整组内容放进一个容器、容器下移 ——
 *    这样"背景四层 + 四角金饰保持贴边"这条约束才不会破
 *    （否则底部角饰会被推出屏幕）。改升降只动 `YSHIFT` 一个常量。
 *
 *  ★ 主按钮是**九宫格**（`btn9_left / mid / right`）：
 *    两端的「帽」用**定高等比**贴住左右，中间那块横向铺满。
 *    ⚠️ 帽的宽度未知（出图时定的），所以不能写死 —— 用 `aspectH` 让引擎按贴图算。
 * ============================================================
 */

import { Graphics, Label, Node, SubContextView, Tween, UIOpacity, UITransform, _decorator, tween, v3 } from 'cc';

import {
    AD, AD_QUOTA, ASSET, BTN_PRIMARY, COLOR, DEVICE, FIT, GAME, HOME_FN, PAGE, SFX, SIGN,
    TOOL_ICON, TOOL_META, TOOL_ORDER, type ToolKey,
} from '../CFG';
import { PageBase } from './PageBase';
import { MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import { SaveService } from '../core/SaveService';
import { RankService } from '../core/RankService';
import { ShareService } from '../core/ShareService';
import { AdService, type AdOutcome } from '../core/AdService';
// 替身广告面板（与主玩页**同一块** —— 见 `ui/AdDialog.ts` 文件头「为什么要有它」）
import { openMockAdDialog } from './AdDialog';
import {
    confirmDialog, createCoverSprite, createGraphicsNode, createLabel, createNode, createScrim,
    createSprite, estTextWidth, fillCircle, fillRadialGlowE, fillRays, fillRoundRect, fillSoftBeam,
    fillVGradient, fitY, fromBottom, fromTop, strokeCircle, strokeRoundRect, toast,
} from './UIFactory';
import { hex2color } from './Palette';
import { Haptics } from './Haptics';

const { ccclass } = _decorator;

const DW = 750;
/** 内容层整体下移（用户拍板定稿值，改这一个值即可整体升降） */
const YSHIFT = 64;

/**
 * 关卡进度条的**轨道宽**（设计 px）。
 * ★ 第 58 轮从 `buildProgress` 的局部变量提上来：重绘路径（`refreshProgress`）
 *   也要用它，两处各写一个 420 迟早会出现"建的宽、重绘的窄"。
 */
const PROGRESS_W = 420;

// ------------------------------------------------------------
//  标题尺寸（第 35 轮：用户反馈"字号偏小，适当放大"）
// ------------------------------------------------------------
//  旧值 420（= 定稿稿值，占屏宽 56.0%）。
//
//  ★ 为什么定在 **500** 而不是随手放大 —— 这是"源图像素"卡出来的上限：
//    · 标题源图 `title.png` 宽 **840 设计 px**（840×237）；
//    · 真机 fitWidth 下 1 设计 px = 1264/750 = **1.6853 物理 px**；
//    · ⇒ 源图能 1:1 支撑的最大显示宽 = 840 / 1.6853 = **498.5 设计 px**。
//    取 500 ⇒ 842.7 物理 px，与源图 **1:1（超采样 0.3%，肉眼不可辨）**；
//    再往上（如 560）就开始真上采样，标题边缘会先糊。
//    ⇒ 500 是"当前素材能做到的最大清晰放大"，比旧值 **+19.0%**，占屏宽 66.7%。
const TITLE_W = 500;
/** 标题源图 `title.png` 宽高比（840×237） */
const TITLE_AR = 840 / 237;
/** 标题显示高（由宽度 + 源图比例推出）≈ 141.1 */
const TITLE_H = TITLE_W / TITLE_AR;

// ------------------------------------------------------------
//  左右功能列尺寸（第 37 轮：用户反馈"功能键太小"）
// ------------------------------------------------------------
//  旧值 96（= 定稿稿值）。放大到 **120（+25%）** —— 上限是被「撞不撞吉祥物」卡出来的，
//  不是手感：详见 `buildFunctionColumn()` 上方的推导（最小间隙 41.6 设计 px）。
/** 功能键图标显示宽（正方形素材，aspectW） */
const FN_ICON = 120;
/** 图标与文案之间的竖向留白 */
const FN_GAP = 12;
/** 功能键文案字号（22 → 26；"七日签到" 4 字 = 104 宽 ≤ 标签框 120） */
const FN_FS = 26;
/** 功能键节点总高 = 图标 + 留白 + 文案 */
const FN_ITEM_H = FN_ICON + FN_GAP + FN_FS;

/** 设计稿 (left, top) → 引擎坐标（中心锚点） */
function ex(left: number, w: number): number { return left - DW / 2 + w / 2; }
/**
 * 设计稿 top（**内容层坐标**，会自动叠加 YSHIFT）→ 引擎坐标。
 *
 * ⚠️ 纵向走 `fitY()` 而不是 `topY()` —— 见 CFG.FIT 的注释：
 *   设计稿 1334 高、真机可视 1651.4 高，`topY()` 会把内容整体居中、上下各白留 158.7px；
 *   `fitY()` 把内容区间 [110, 1199] 摊到「胶囊下沿 … Home Indicator 上方」之间。
 */
function ey(top: number, h: number): number { return fitY(top + YSHIFT + h / 2, FIT.HOME); }

// ------------------------------------------------------------
//  设置抽屉栅格（第 37 轮整页重排）
// ------------------------------------------------------------
//  ★★ 原版的四个硬伤（用户圈出红圈的那一处是 ①）：
//   ① **第二条分隔线穿在「背景音乐」行内部** —— `rule(352)`，而该行占据 284~388。
//      视觉上像"背景音乐的下划线"，这是最刺眼的一条。
//   ② **两组左边缘三档不齐**：开关组图标左缘 46 / 开关组文字左缘 110 /
//      链接组文字左缘 46 —— 谁也没对齐谁。
//   ③ **关闭按钮与标题不同心**（中线 70 vs 88，差 18）。
//   ④ **版本号与「关于本作」行重叠 16px**（行 518~616、版本 600~626），
//      且抽屉底部空 74 而顶部只空 4 —— 版心整体偏上。
//
//  ★ 重排后：**全部落在 24 的竖向节奏上**、横向统一「内容边距 48」、四行同一个骨架。
//
//       4    抓手（8 高）
//      36    标题带（88 高；标题与关闭按钮**共用中线 80**）
//     148    分隔线①（距标题带底 24）
//     174    行1 音效        ┐
//     270    行2 背景音乐    ┘ 开关组（行高统一 96）
//     390    分隔线②（距行2底 24）
//     416    行3 重置进度    ┐
//     512    行4 关于本作    ┘ 链接组
//     648    版本号（26 高；距行4底 **40**）
//     700    抽屉底（留白 26，与顶部 24 呼应）
//
//  ★ 版本号为什么要留 **40** 而不是 24：行高 96 意味着"相邻两行的文字中心距 = 96"。
//    若版本号也按 24 排，它的中心距行4 只有 ~89 —— **比行间距还小**，
//    于是它会被读成"第五行 / 关于本作的注脚"而不是页脚（第一版就是这么翻的，
//    截图上一眼就能看出来）。拉到 40 之后中心距 **101 > 96**，视觉上才"游离"出来。
//    这里**故意破一次 24 节奏**：分组边界上的留白本来就该与组内节奏不同。

/** 抽屉高度（**外框尺寸不变**，只重排内部 —— 改动面最小、最好回退） */
const SHEET_H = 700;

// ------------------------------------------------------------
//  排行榜浮层几何（★ 第 53 轮 · T17）
// ------------------------------------------------------------
//  ⚠️ `RANK_ODC_W:H` **必须是 2:3** —— 开放数据域的共享画布尺寸由引擎
//     `SubContextView` 固定为 640×960（`designResolutionSize` 默认值，运行期只读），
//     组件按 SHOW_ALL 把画布缩放进节点框；节点框比例不同就会左右/上下留黑边。
const RANK_ODC_W = 640;
const RANK_ODC_H = 960;
/** 画布上方的留边（让金框包住画布而不是压在画布上） */
const RANK_TOP_PAD = 12;
/** 底部操作条（只放「关闭」） */
const RANK_BAR_H = 130;
/** 卡宽 = 画布宽 + 左右各 12 */
const RANK_CARD_W = RANK_ODC_W + 24;

// ------------------------------------------------------------
//  道具商城弹层几何（★ 第 56 轮 · T14）
// ------------------------------------------------------------
//  逐项照 `game-5-道具商城-视觉稿-v1.html` 的 `.shopmodal / .shopRow / .btnLite`
//  （设计稿 750×1334 值，1:1 可直接抄）。该稿第 56 轮已按用户拍板改过一版：
//  **「今日剩余」删掉刻度点、改成行内纯文字**（口径 = 每种道具 2 次/日）。
//
//  ★ 卡高**不写死**，由下面这些数推出来 —— 改任何一段间距它都会自动跟着变。
//    写死高度的下场是"改了行高，底部那条边戳出卡外，而截图之外看不出来"。
const SHOP_CARD_W = 626;
const SHOP_PAD_X = 40;
/** 行宽 = 卡宽 − 左右内边距（= 546） */
const SHOP_ROW_W = SHOP_CARD_W - SHOP_PAD_X * 2;
const SHOP_ROW_H = 142;
const SHOP_ROW_GAP = 16;
const SHOP_ROW_R = 22;
const SHOP_ROW_PAD_X = 22;
const SHOP_ROW_ICON = 96;
/** 图标 → 文字列 的横向间隙 */
const SHOP_ROW_GAP_ICON = 20;
/** 行尾「按钮 + 剩余次数文字」这一列的总宽 */
const SHOP_ACT_W = 190;
const SHOP_BTN_W = 190;
const SHOP_BTN_H = 78;
const SHOP_NAME_FS = 30;
const SHOP_STOCK_FS = 22;
const SHOP_LEFT_FS = 21;
const SHOP_SUB_FS = 26;
const SHOP_TITLE_FS = 74;
const SHOP_TOP_PAD = 56;
const SHOP_SUB_GAP_TOP = 8;
const SHOP_SUB_H = 34;
const SHOP_SUB_GAP_BOTTOM = 30;
const SHOP_CLOSE_H = 84;
const SHOP_CLOSE_GAP = 24;
const SHOP_BOTTOM_PAD = 36;
const SHOP_CARD_H = SHOP_TOP_PAD + SHOP_SUB_GAP_TOP + SHOP_SUB_H + SHOP_SUB_GAP_BOTTOM
    + SHOP_ROW_H * 4 + SHOP_ROW_GAP * 3 + SHOP_CLOSE_GAP + SHOP_CLOSE_H + SHOP_BOTTOM_PAD;

/**
 * 画行尾那颗小号金按钮（常态 / 冷却态两态）。
 *
 * ⚠️ 冷却态是**变暗禁用**，不是把按钮藏起来 —— 藏起来玩家会以为"商城坏了 / 功能没了"。
 *    这条与设计说明③是同一句；两态共用同一个 Graphics，所以必须 `clear()` 后重画，
 *    只改颜色不 clear 会把两种状态叠在一起（而且看着只是"有点脏"，很难归因）。
 */
function paintShopButton(g: Graphics, cool: boolean): void {
    g.clear();
    const W = SHOP_BTN_W, H = SHOP_BTN_H, r = H / 2;
    if (cool) {
        fillRoundRect(g, 0, -6, W, H, r, '#16211B', 255);
        fillVGradient(g, 0, 0, W, H, r, '#3A4A42', '#25332C', 18);
        strokeRoundRect(g, 0, 0, W, H, r, '#1A2620', 3, 255);
    } else {
        fillRoundRect(g, 0, -6, W, H, r, '#9A6A15', 255);
        fillVGradient(g, 0, 0, W, H, r, '#FFE08A', '#E8A92E', 18);
        strokeRoundRect(g, 0, 0, W, H, r, '#8A5A10', 3, 255);
    }
}
// ------------------------------------------------------------
//  七日签到弹层几何（★ 第 57 轮 · T11）
// ------------------------------------------------------------
//  逐值照 `game-5-七日签到-视觉稿-v1.html` 的 `.signmodal / .cells / .cell / .claim`
//  （设计稿 750×1334 值，1:1 可直接抄）。该稿第 57 轮出稿，用户拍板取 **稿 A**。
//
//  ★★ **稿 A = 「领取」胶囊骑在当天格子的下沿**（格子自己就是按钮），
//     不是底部另起一颗大按钮（那是稿 B，已弃）。见下面 `SIGN_CLAIM_*` 的落点说明。
//
//  ★ 卡高**不写死**，由各段推出来（与道具商城同一手法）：写死高度的下场是
//    "改了行距、底部那条边戳出卡外，而截图之外看不出来"。
const SIGN_CARD_W = 626;
const SIGN_PAD_X = 40;
/** 内容宽 = 卡宽 − 左右内边距 = **546** */
const SIGN_GRID_W = SIGN_CARD_W - SIGN_PAD_X * 2;
const SIGN_TOP_PAD = 56;
const SIGN_SUB_GAP_TOP = 8;
/**
 * 副标题行高。
 * ⚠️ 取 **39** 而不是商城那个 34 —— 39 是视觉稿里 `.signSub` 的**实测渲染高**
 *   （26 号字的行框）。用 39 推出来的卡高正好是 **663**，与稿子逐像素一致；
 *   若照抄商城的 34，卡会矮 5px —— 而这一点**截图上看不出来**，只有对账才暴露。
 */
const SIGN_SUB_H = 39;
const SIGN_SUB_GAP_BOTTOM = 30;

const SIGN_CELL_W = 126;
const SIGN_CELL_H = 176;
const SIGN_CELL_R = 22;
const SIGN_CELL_GAP_X = 14;
const SIGN_CELL_GAP_Y = 34;
/** 第 7 日的宽格 = 下排剩多少占多少（546 − 2×(126+14) = **266**） */
const SIGN_WIDE_W = 266;

/** 距格顶 `d` 的元素**中心** → 格内 y（格锚点 0.5,0.5 ⇒ 格中心 y = 0） */
function cellY(centerFromTop: number): number { return SIGN_CELL_H / 2 - centerFromTop; }

// ---- 格内竖向节奏（全部来自视觉稿**实测**，不是从 CSS 硬推）----
//  ⚠️ `.ic` 在稿里写的是 `height:80`，但实测渲染只有 **68**（flex 竖向挤压）；
//     这里的 68 是"眼睛看到的那个数"。照 80 排会让图标整体高 12px，
//     而 4+3 网格里格子是紧的，这 12px 会顶到名称行。
const SIGN_DAY_Y = cellY(33);        // 「第 N 天」中心距格顶 19+28/2 = 33
const SIGN_IC_Y = cellY(89);         // 图标中心距格顶 55+68/2 = 89
const SIGN_NAME_Y = cellY(139);      // 名称中心距格顶 123+32/2 = 139（= 格底往上 21+16）
const SIGN_TICK_Y = cellY(164);      // 青玉勾中心距格顶 148+32/2 = 164

// ---- ★★ 「领取」胶囊：用户拍板的**稿 A 落点**，这里是它的唯一真源 ----
const SIGN_CLAIM_W = 83;
const SIGN_CLAIM_H = 42;
/** 胶囊底边**越过格底**多少（设计 px） */
const SIGN_CLAIM_DROP = 19;
/**
 * ★★ 为什么是 **19** 而不是视觉稿 CSS 里写的 `bottom:-22px`：
 *     那 22 是相对 `.cell` 的 **padding box** 量的，而 `.cell` 自带 `border:3px`
 *     ⇒ 视觉上越过**可见外沿**只有 22 − 3 = **19**。
 *     引擎这边我们用 `strokeRoundRect` 画格框（**描边不吃尺寸**，没有 border box 那一层），
 *     所以必须取 19 才和稿子逐像素一致。
 *     ⚠️ 若照抄 22：胶囊整体往下挪 3px，单看"也没啥"，
 *       但它与下一行格顶的余量会被吃掉 3px —— 属于**累积型**偏差，越改越偏。
 */
const SIGN_CLAIM_Y = -SIGN_CELL_H / 2 - SIGN_CLAIM_DROP + SIGN_CLAIM_H / 2;   // −86
/** 青玉勾的水平偏移（稿实测：勾心在格心右侧 51） */
const SIGN_TICK_X = 51;

const SIGN_DAY_FS = 20;
const SIGN_DAY_H = 28;
const SIGN_IC_SINGLE = 68;
const SIGN_IC_DUO = 46;
const SIGN_IC_DUO_GAP = 4;
const SIGN_NAME_FS = 21;
const SIGN_NAME_FS_WIDE = 24;
const SIGN_NAME_H = 32;
const SIGN_FUTURE_OPACITY = 133;     // 「未到」整格压到 52%（= 133/255）

const SIGN_CLOSE_H = 84;
const SIGN_CLOSE_GAP = 24;
/** 关闭键左右各内缩 30（稿：`margin:24px 30px 0`） */
const SIGN_CLOSE_INSET = 30;
const SIGN_CLOSE_W = SIGN_GRID_W - SIGN_CLOSE_INSET * 2;
const SIGN_BOTTOM_PAD = 36;
const SIGN_TITLE_FS = 74;
const SIGN_TITLE_H = 100;
/** 标题框中心比卡顶边**低** 7.5（稿实测 `top:-44` + 高 103 ⇒ 中心在卡顶下 7.5） */
const SIGN_TITLE_DROP = 8;

/** 两行网格净高 = 176×2 + 34 = **386**（多出一行会变成 596 —— 验收脚本就靠这个数抓换行） */
const SIGN_GRID_H = SIGN_CELL_H * 2 + SIGN_CELL_GAP_Y;
/** 推导式卡高 ⇒ **663**（与视觉稿逐像素一致，见 `tools/_r57-signcard-check.mjs`） */
const SIGN_CARD_H = SIGN_TOP_PAD + SIGN_SUB_GAP_TOP + SIGN_SUB_H + SIGN_SUB_GAP_BOTTOM
    + SIGN_GRID_H + SIGN_CLOSE_GAP + SIGN_CLOSE_H + SIGN_BOTTOM_PAD;

// ---- 第 7 日「四选一」选择器（稿 D）----
const SIGN_PICK_W = 550;
const SIGN_PICK_PAD_X = 34;
const SIGN_PICK_GRID_W = SIGN_PICK_W - SIGN_PICK_PAD_X * 2;   // 482
const SIGN_PICK_TOP_PAD = 56;
const SIGN_PICK_SUB_GAP_TOP = 2;
const SIGN_PICK_SUB_H = 33;
const SIGN_PICK_SUB_GAP_BOTTOM = 24;
const SIGN_PICK_CARD_W = 224;
const SIGN_PICK_CARD_H = 196;
const SIGN_PICK_CARD_R = 22;
const SIGN_PICK_GAP = 16;
const SIGN_PICK_ICON = 76;
const SIGN_PICK_NAME_FS = 26;
const SIGN_PICK_TITLE_FS = 60;
const SIGN_PICK_CARD_H_TOTAL =
    SIGN_PICK_TOP_PAD + SIGN_PICK_SUB_GAP_TOP + SIGN_PICK_SUB_H + SIGN_PICK_SUB_GAP_BOTTOM
    + SIGN_PICK_CARD_H * 2 + SIGN_PICK_GAP + SIGN_CLOSE_GAP + SIGN_CLOSE_H + 34;   // 665

/** 副标题文案（**固定**，设计规则 §P1.6 ④：不出现"金币/礼包/分享"字样） */
const SIGN_SUB_TEXT = '连续签到 7 天，天天有道具';
const SIGN_SUB_FS = 26;
/** 连签胶囊（副标题右侧那颗） */
const SIGN_CHIP_H = 38;
const SIGN_CHIP_GAP = 14;
const SIGN_CHIP_FS = 22;
const SIGN_CHIP_PAD_X = 14;

/** 格子的三种态 */
type SignCellState = 'done' | 'today' | 'future';

/**
 * 重画一格的"脸"（三态各一套配色，逐值照视觉稿的 `.cell / .cell.done / .cell.today`）。
 *
 * ⚠️ 三态**共用同一个 Graphics**，所以必须 `clear()` 后重画 ——
 *   只改颜色不 clear 会把两种态叠在一起，而画面看着只是"有点脏 / 颜色深了一档"，
 *   极难归因（道具商城的冷却态踩过同一个坑）。
 */
function paintSignCell(g: Graphics, w: number, h: number, st: SignCellState): void {
    g.clear();
    if (st === 'today') {
        fillVGradient(g, 0, 0, w, h, SIGN_CELL_R, '#2A6E51', '#174E3B', 20);
        strokeRoundRect(g, 0, 0, w, h, SIGN_CELL_R, COLOR.GOLD, 3, 255);
    } else if (st === 'done') {
        fillVGradient(g, 0, 0, w, h, SIGN_CELL_R, '#174E3B', '#0F382A', 20);
        strokeRoundRect(g, 0, 0, w, h, SIGN_CELL_R, '#3BA97D', 3, 166);   // rgba(59,169,125,.65)
    } else {
        fillVGradient(g, 0, 0, w, h, SIGN_CELL_R, '#1E6049', '#144534', 20);
        strokeRoundRect(g, 0, 0, w, h, SIGN_CELL_R, '#FFFFFF', 3, 36);    // rgba(255,255,255,.14)
    }
}

/**
 * 当天格子的「暖金呼吸」外发光。**呼吸由调用方 tween 这颗节点的 opacity 驱动**，
 * 这里只管画一层静态的光。
 *
 * 【为什么用"由外向内叠实心圆角矩形"是对的方向】
 *   实心嵌套图形的累积 alpha **必然内深外浅** —— 这与"暗角"的需求方向相反
 *   （见 `UIFactory.fillVignette` 的留档：暗角**原理上**不能用嵌套实心图形做），
 *   但**恰好就是外发光要的方向**：贴着格子最亮、往外渐隐。
 *   而且中间那块会被**不透明的格子脸**盖住，所以实心不会弄脏格内。
 */
function paintSignGlow(g: Graphics, w: number, h: number): void {
    g.clear();
    for (let i = 6; i >= 0; i--) {
        const d = i * 6;
        fillRoundRect(g, 0, 0, w + d * 2, h + d * 2, SIGN_CELL_R + d, COLOR.GOLD, 15);
    }
}

/**
 * 已领格子的青玉勾（稿：32 直径，深色环 3px，白色对勾 19）。
 * ⚠️ 描边与填充**必须分两个 Graphics**（`fill()/stroke()` 作用于整条路径，
 *   混在一个节点里会把圆环也描一遍 / 把对勾填成实心）。
 */
function paintSignTickFace(g: Graphics): void {
    g.clear();
    fillCircle(g, 0, 0, 19, '#0B2017', 230);        // 稿：box-shadow 0 0 0 3px rgba(11,32,23,.9)
    fillCircle(g, 0, 0, 16, '#3BA97D', 255);       // 稿 --jade（比 CFG.COLOR.JADE 亮一档，照稿取）
}

/** 勾本身（稿 SVG `M4 10.6 l4.2 4.2 L16 5.4`，20×20 viewBox 渲染到 19 ⇒ ×0.95） */
function paintSignTickMark(g: Graphics): void {
    g.clear();
    g.lineWidth = 3.2;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = hex2color('#0B2017');
    g.moveTo(-5.7, -0.6);
    g.lineTo(-1.7, -4.6);
    g.lineTo(5.7, 4.4);
    g.stroke();
}

/**
 * 「领取」胶囊的脸（金渐变 + 下沿厚度 + 深金描边），逐值照视觉稿 `.claim`。
 * ⚠️ 稿 A 里 `.claim` 是**唯一的可交互落点**，所以它的热区必须单独注册 ——
 *   胶囊有一半在格子**外面**，只注册格子的话那半颗点不动。
 */
function paintSignClaim(g: Graphics): void {
    g.clear();
    const W = SIGN_CLAIM_W, H = SIGN_CLAIM_H, r = H / 2;
    fillRoundRect(g, 0, -4, W, H, r, '#9A6A15', 255);            // 稿：0 4px 0 #9A6A15
    fillVGradient(g, 0, 0, W, H, r, '#FFE08A', '#E8A92E', 14);
    strokeRoundRect(g, 0, 0, W, H, r, '#8A5A10', 3, 255);
}

/** 网格列心（相对网格中心）：4 格时 63−273 = −210 / −70 / +70 / +210 */
function signColX(i: number): number {
    return -SIGN_GRID_W / 2 + SIGN_CELL_W / 2 + i * (SIGN_CELL_W + SIGN_CELL_GAP_X);
}
/** 网格行心（相对网格中心）：上排 +105 / 下排 −105 */
function signRowY(r: number): number {
    return SIGN_GRID_H / 2 - SIGN_CELL_H / 2 - r * (SIGN_CELL_H + SIGN_CELL_GAP_Y);
}
/** 第 7 日宽格的横向中心：从第 3 列左缘起、占满到网格右缘（266 宽 ⇒ 中心 +140） */
function signWideX(): number {
    return -SIGN_GRID_W / 2 + 2 * (SIGN_CELL_W + SIGN_CELL_GAP_X) + SIGN_WIDE_W / 2;
}

/** 一格底部那行奖励文案（逐字照稿：`消除 ×1` / `各 ×1` / `任选 1 种 × 2`） */
function signRewardText(day: number): string {
    const r = SIGN.DAYS[day - 1];
    if (r.pick) return `任选 1 种 × ${SIGN.PICK_N}`;
    if (r.items.length === 1) return `${TOOL_META[r.items[0].tool].name} ×${r.items[0].n}`;
    return `各 ×${r.items[0].n}`;
}

/** 一格签到格的引用（重画三态时要用到全部这些件） */
interface SignCellRef {
    day: number;
    node: Node;
    face: Graphics;
    /** 当天才显示的暖金呼吸光（`glowOp` 用来做呼吸 tween） */
    glow: Node | null;
    glowOp: UIOpacity | null;
    /** 已领才显示的青玉勾 */
    tick: Node | null;
    /** 当天才显示的「领取」胶囊 */
    claim: Node | null;
    dayLabel: Label;
    nameLabel: Label;
    op: UIOpacity;
}


/** 内容左右边距 → 行宽 = DW − 2×PAD = 654；四行共用同一个左缘与右缘 */
const SHEET_PAD = 48;
const SHEET_ROW_W = DW - SHEET_PAD * 2;
/** 行高（四行统一；原版是 104 / 104 / 98 / 98，两档不齐） */
const SHEET_ROW_H = 96;
/** 行首图标**显示高** —— 定高不定宽：素材宽高比 1.10 / 0.835 不同，定宽会让图标一高一矮 */
const SHEET_ICON_H = 40;
/** 图标列宽（图标在此列内左对齐） */
const SHEET_ICON_W = 44;
/** 图标列右缘 → 文字左缘 的间隙 */
const SHEET_ICON_GAP = 22;
/** 行首文字左缘（行内坐标，锚点 0 = 行左缘） */
const SHEET_TEXT_X = -SHEET_ROW_W / 2 + SHEET_ICON_W + SHEET_ICON_GAP;
/** 竖向栅格（距抽屉顶边，单位设计 px） */
const SHEET_T = {
    grip: 4,
    header: 36,
    headerH: 88,
    rule1: 148,
    row1: 174,
    row2: 270,
    rule2: 390,
    row3: 416,
    row4: 512,
    ver: 648,
    verH: 26,
} as const;

/**
 * 抽屉内坐标换算：设计 `top`（**距抽屉顶边**）→ 抽屉内 y。
 *
 * ⚠️ 抽屉节点的锚点是 **(0.5, 0) = 底边中点**，所以子元素的 y 都是
 *    "**从抽屉底边往上量**"。方向反了会把内容画到屏幕外 —— 而屏幕外的东西
 *    **不报错、也不被裁掉**，只是看不见（最难排查的一类）。统一走这里，别手写 y。
 */
function sy(top: number, h: number): number { return SHEET_H - top - h / 2; }

/**
 * 用折线逼近圆弧（`seg` 段）。
 *
 * ★ 为什么不用 `Graphics.arc()`：它的 `counterclockwise` 参数在引擎坐标
 *   （y 轴向上）下的方向很容易搞反，画出来是"缺口在反方向的圆"——
 *   这种错在小图标上**很难一眼看出来**，所以就别用它。逐点连线完全可控。
 */
function polyArc(g: Graphics, cx: number, cy: number, r: number,
                 a0: number, a1: number, seg = 56): void {
    for (let i = 0; i <= seg; i++) {
        const a = a0 + (a1 - a0) * (i / seg);
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
}

@ccclass('HomePage')
export class HomePage extends PageBase {

    private _walletLabel: ReturnType<typeof createLabel> | null = null;
    private _sheet: Node | null = null;
    private _sheetOpen = false;

    // ---- ★ 第 58 轮：**重置进度要"就地生效"**，于是这些显示必须留下可刷新的把手 ----
    //
    //  【为什么需要它们 —— 用户报的原文】
    //   「修复点击重置进度后没有立即重置的问题，要求点击后即刻重置，无需进入下一关才生效」。
    //   旧实现里 `resetAll()` 确实把存档清了，但首页这几处都是**建时读一次存档就再也不看**：
    //     · 金币胶囊（有 `_walletLabel`，但只在 `onEnter` 刷）
    //     · 关卡进度条 + 「第 N 关 · 共 M 关」（**连引用都没留**）
    //     · 主按钮副标题「继续 · 第 N 关」（**连引用都没留**）
    //   ⇒ 点完确认后画面**一动不动**，玩家的判断是"重置没生效"，
    //     只有进一次下一关（= 新开一局、重新读档）才看到变化。
    //
    //  ⚠️ 别改成"销毁整页重建"：那会重播一遍 0.08~0.74s 的入场动画，
    //     与"就地生效"的体感正相反（而且 `createNode` 追加会打乱 z 序）。
    /** 进度条那张 Graphics（原地 `clear()` + 重绘，见 `refreshProgress`） */
    private _progressG: Graphics | null = null;
    /** 「第 N 关 · 共 M 关」那行字 */
    private _progressLabel: Label | null = null;
    /**
     * 主按钮副标题「继续 · 第 N 关」。
     * ⚠️ 它是**主按钮内部**的一行字（按钮本身是九宫格拼图，不能整颗重建）。
     */
    private _startSubLabel: Label | null = null;

    // ========================================================
    protected onBuild(): void {
        this.buildBackground();
        // ★ 第 35 轮：`buildCorners()`（四角金饰）**已删除** —— 用户反馈
        //   "四个角的方形标志显得多余"。与启动页同一处理，详见下方留档注释。
        this.buildLightLayers();
        this.buildTopBar();
        this.buildTitle();
        this.buildMascot();
        this.buildMainButton();
        this.buildFunctionColumn();
        this.buildProgress();
        this.buildSheet();
    }

    // ---- 背景：绒布 + 顶光 + 落地（**不随 YSHIFT 动**）----
    //
    //  ★ 第 34 轮：照抄 `assets/home/首页-定稿.html`
    //    （L48 顶光 / L50 光池在 buildLightLayers / L54 落地），**暗角已移除**。
    private buildBackground(): void {
        const vs = this.visible();
        const { node: base, g } = createGraphicsNode('Felt', this.body, { w: vs.width, h: vs.height });
        fillRoundRect(g, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, COLOR.GREEN, 255);
        // 等比 cover（消除 felt.jpg 被拉成 0.4547 比例导致的 1.55× 各向异性）
        createCoverSprite(base, 'Img', { path: ASSET.SPLASH_FELT, w: vs.width, h: vs.height });

        const { g: fg } = createGraphicsNode('Atmo', this.body, { w: vs.width, h: vs.height });

        // ① 【已移除】椭圆暗角 —— 定稿稿那层 `radial-gradient(150% 100% at 50% 45%,
        //    transparent 48%, rgba(0,0,0,.40) 100%)` 在真机上实测同样趋近 0
        //    （椭圆 rx/ry 相对真机可视高被拉长，边缘落点远在屏幕外）。
        //    它提供的纵深已被 ②③④ 覆盖；而 Graphics 的**嵌套实心图形原理上做不出暗角**
        //    （"点被覆盖层数随半径单调递减" ⇒ 必然中心最深、边缘最浅，方向天然反的）。
        //    历史两次实现分别把整屏压到 10% / 35% 亮度，故与启动页一致直接去掉。
        //    详见 UIFactory §一之二。

        // ② 顶光 —— 定稿：linear-gradient(180deg, rgba(255,251,230,.08), transparent 18%)
        fillVGradient(fg, 0, vs.height / 2 - vs.height * 0.09, vs.width * 1.4, vs.height * 0.18, 0,
            'rgba(255,251,230,0.08)', 'rgba(255,251,230,0)', 12);

        // ③ 底部落地 —— 定稿：linear-gradient(180deg, transparent, rgba(0,0,0,.32) 88%)
        //    定稿元素是 `bottom:0; height:280px`（占 1334 的 **21.0%**）。
        //    ★ 第 34 轮修正：原来写死 `height: 280` + `fromBottom(140)`——在真机可视高
        //      1651（而非 1334）下只占 17%，且**高度不随比例走**。现按真机可视高等比，
        //      保证任何比例下都贴底、占比与定稿一致。
        const gh = vs.height * 0.21;
        fillVGradient(fg, 0, fromBottom(gh / 2), vs.width * 1.4, gh, 0,
            'rgba(0,0,0,0)', 'rgba(0,0,0,0.32)', 14);
    }

    // ---- （第 35 轮删除）四角金饰 ----
    //
    //  历史实现：四枚 40×40 的金色方框 + 菱形点，顶边两枚锚 `SAFE_TOP` 让开胶囊、
    //  底边两枚锚真机底边上方 16。
    //  ★ 第 35 轮按用户要求**整组删除**（"四个角的方形标志显得多余"）。

    // ---- 光池 / 光芒 / 光束 / 接触投影（随 YSHIFT 动）----
    private buildLightLayers(): void {
        // 光池 155,304 440×470 —— 定稿 `.lightpool`（**椭圆** rx220 × ry235）：
        //   radial-gradient(closest-side, rgba(255,244,200,.16), rgba(255,244,200,.05) 48%, transparent 74%)
        const { node: pool, g: pg } = createGraphicsNode('LightPool', this.body, {
            w: 440, h: 470, x: ex(155, 440), y: ey(304, 470),
        });
        fillRadialGlowE(pg, 0, 0, 220, 235, '#FFF4C8', 41, 18);
        tween(pool)
            .repeatForever(
                tween(pool).to(2.3, { scale: v3(1.05, 1.03, 1) }, { easing: 'sineInOut' })
                    .to(2.3, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();

        // 光芒 145,309 460×460（12 道扇，46s/圈）—— 定稿 `.rays`：
        //   rgba(255,244,200,.07) 9deg/30deg + 径向 mask(0.9 → 72% 归零) + opacity .8
        const { node: rays, g: rg } = createGraphicsNode('Rays', this.body, {
            w: 460, h: 460, x: ex(145, 460), y: ey(309, 460),
        });
        fillRays(rg, 230, 14, { count: 12, stepDeg: 30, sweepDeg: 9, fadeAt: 0.72 });
        tween(rays).by(46, { angle: -360 }).repeatForever().start();

        // 中央光束 185,300 380×770
        //
        //  ★ 第 34 轮重写（用户圈出来的"半宽方块"就是这里）：
        //    旧实现 = 5 段 × 6 个**硬边矩形**、靠逐层收窄宽度叠出来 ⇒ 矩形之间 alpha
        //    是**阶跃**的，在深色背景上直接读成一坨方格，而且完全没有横向柔化。
        //    定稿稿 `.beam` 的柔化其实来自一条**横向 mask**：
        //        mask-image: linear-gradient(90deg, transparent, #000 24%, #000 76%, transparent)
        //    即「两侧各 24% 线性淡出、中间 52% 满值」。现按此逐列铺，列宽 380/24 ≈ 15.8px，
        //    相邻列 alpha 差 < 2/255 ⇒ 肉眼无阶梯。
        const { g: bg } = createGraphicsNode('Beam', this.body, {
            w: 380, h: 770, x: ex(185, 380), y: ey(300, 770),
        });
        fillSoftBeam(bg, 380, 770, [
            [0.00, 0],
            [0.16, 0.075],
            [0.56, 0.05],
            [0.86, 0.075],
            [1.00, 0],
        ], '#FFE8AA', 0.24, 24);

        // 接触投影 205,764 340×52 —— 定稿 `.contactShadow`（**6.5:1 扁椭圆**）：
        //   radial-gradient(closest-side, rgba(0,0,0,.38), rgba(0,0,0,.16) 55%, transparent 75%)
        // ⚠️ 画成正圆会变成吉祥物脚下一团黑饼，必须用椭圆。
        const { node: sh, g: sg } = createGraphicsNode('ContactShadow', this.body, {
            w: 340, h: 52, x: ex(205, 340), y: ey(764, 52),
        });
        fillRadialGlowE(sg, 0, 0, 170, 26, '#000000', 97, 16);
        tween(sh)
            .repeatForever(
                tween(sh).to(1.7, { scale: v3(0.85, 1, 1) }, { easing: 'sineInOut' })
                    .to(1.7, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();
    }

    // ---- 顶栏：设置（左）+ 金币 ----
    //
    //  ★★ 第 35 轮修「没和右侧胶囊对齐」（用户红框标出的第二处）。
    //
    //  【真因】旧代码走 `ey(46, 88)` → `fitY()`。而 `fitY()` 是**跨整页的
    //    线性重映射**：它把设计区间 `[110, 1199]` 拉长到真机的 `[183.3, 1583.4]`
    //    （×1.286），于是这条顶栏被推到**距屏顶 239.9 设计 px** ——
    //    而实测微信胶囊盒是 `y 95.5–159.3`（中线 **127.4**），
    //    两者差 **112.5 设计 px**。截图里"设置/金币明显矮了半截"就是这个数。
    //
    //  【解法】贴系统控件（胶囊 / Home Indicator）的元素**一律不走 `fitY()`**，
    //    改走 `fromTop()` / `fromBottom()` —— 这两个是"距真机边框的绝对距离"，
    //    在任何屏幕比例下都成立。顶栏中线直接取胶囊中线。
    //
    //  【顺带】金币胶囊的高度从 56 改成 **= 胶囊高度 63.8**，
    //    这样左右两条的上下沿完全同高，肉眼一看就是"一条横线"；
    //    原来的 56 即使中线对齐也会因为矮 8px 而显得没对齐。
    private buildTopBar(): void {
        /** 微信胶囊垂直中线（设计 px，距屏顶） */
        const BAR_CY = (DEVICE.CAPSULE.y0 + DEVICE.CAPSULE.y1) / 2;     // 127.4
        /** 金币胶囊高度 —— **取胶囊实测高度**，让左右两条同高（63.8） */
        const BAR_H = DEVICE.CAPSULE.y1 - DEVICE.CAPSULE.y0;            // 63.8

        // 设置：触摸区 88×88（图标本体 56），中线锚胶囊中线
        const setting = createNode('Setting', this.body, { w: 88, h: 88, x: ex(24, 88), y: fromTop(BAR_CY) });
        createSprite(setting, 'Img', { path: ASSET.HOME_SETTING, aspectW: 56 });
        this.tapable(setting, () => { Haptics.light(); this.openSheet(); });
        this.settleIn(setting, 0.08);

        // 金币胶囊：与设置同一中线、高度与微信胶囊齐平
        const wallet = createNode('Wallet', this.body, { w: 210, h: BAR_H, x: ex(114, 210), y: fromTop(BAR_CY) });
        const { g } = createGraphicsNode('Chip', wallet, { w: 210, h: BAR_H });
        fillRoundRect(g, 0, 0, 210, BAR_H, BAR_H / 2, 'rgba(4,20,14,0.72)', 255);
        strokeRoundRect(g, 0, 0, 210, BAR_H, BAR_H / 2, 'rgba(246,196,69,0.26)', 2, 255);
        createSprite(wallet, 'Coin', { path: ASSET.HOME_COIN, aspectW: 40, x: -210 / 2 + 8 + 20 });

        this._walletLabel = createLabel(wallet, this.coinText(), {
            fontSize: 26, color: 'rgba(255,247,230,0.88)', bold: true,
            w: 150, h: BAR_H, x: -210 / 2 + 8 + 40 + 6 + 75,
        });
        this.settleIn(wallet, 0.08);
    }

    private coinText(): string {
        const n = SaveService.instance.coins;
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ---- 主题字 ----
    //
    //  ★ 第 35 轮：标题由 420 → **500** 设计 px（用户反馈字号偏小），
    //    光晕同步放大并**保持两者同心**（否则放大后光晕会偏在上半截）。
    //    纵向**锚住标题顶边 176 不变**，加大的部分全部向下长 ——
    //    这样不会顶到上方的顶栏，也不会影响 `FIT.HOME.top` 的既有口径。
    //    放大后标题底 ≈ 317.1、吉祥物可视顶 ≈ 370.1，仍留 **53px** 安全间隙。
    private buildTitle(): void {
        /** 光晕尺寸：宽跟标题同宽，高按定稿的 1.52 倍关系 */
        const HALO_W = TITLE_W;
        const HALO_H = Math.round(TITLE_H * 1.52);          // 214
        /** 标题纵向中线（设计稿坐标，未含 YSHIFT） */
        const TITLE_CY = 176 + TITLE_H / 2;                 // 246.5
        const HALO_TOP = TITLE_CY - HALO_H / 2;             // 139.5

        const { node: halo, g } = createGraphicsNode('TitleHalo', this.body, {
            w: HALO_W, h: HALO_H, x: ex((DW - HALO_W) / 2, HALO_W), y: ey(HALO_TOP, HALO_H),
        });
        for (let i = 10; i >= 1; i--) {
            const t = i / 10;
            g.fillColor = hex2color('#FFD678', Math.round(36 * (1 - t)));
            g.ellipse(0, 0, (HALO_W / 2) * t, (HALO_H / 2) * t);
            g.fill();
        }
        tween(halo)
            .repeatForever(
                tween(halo).to(2.1, { scale: v3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                    .to(2.1, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();

        const title = createSprite(this.body, 'Title', {
            path: ASSET.HOME_TITLE, aspectW: TITLE_W, x: 0, y: ey(176, TITLE_H),
        });
        this.settleIn(title, 0.22);
    }

    // ---- 吉祥物 ----
    private buildMascot(): void {
        const wrap = createNode('Mascot', this.body, { w: DW, h: 410, x: 0, y: ey(352, 410) });
        const img = createSprite(wrap, 'Img', { path: ASSET.SPLASH_MASCOT, aspectW: 410 });
        tween(img)
            .repeatForever(
                tween(img).to(1.7, { position: v3(0, 12, 0) }, { easing: 'sineInOut' })
                    .to(1.7, { position: v3(0, 0, 0) }, { easing: 'sineInOut' }),
            ).start();
        this.settleIn(wrap, 0.34);
    }

    // ---- 主按钮（九宫格 · 方案 B）----
    //
    //  ★★ 第 37 轮：用户拍板「主按钮采用方案 B」，并圈出了旧实现的"中间发亮 + 四周违和"。
    //
    //  【真因不在素材，在拼法】
    //    旧代码 `createSprite(btn,'Mid',{path: HOME_BTN_MID, w: W, h: H})` 把中段源图
    //    **228×280 强制拉成 320×140** ⇒ 横向 ×1.403 / 纵向 ×0.500，**各向异性 2.81×**，
    //    玉纹被压成横向拉丝（"中间发亮"的观感来源之一）；而两端 78/75 宽的帽是
    //    **盖在中段之上**的（`CapL/CapR` 与铺满全宽的 `Mid` 大面积重叠），帽的圆弧金框
    //    与中段的直线金线落不到一起 ⇒ "四周违和"。
    //    设计稿 v2 原文写的却是「两端圆角固定、中段水平拉伸」—— 本次就是把它做对。
    //
    //  【另一条"中间发亮"的直因】旧代码在按钮上又叠了一层 `Shade`：
    //      两侧各 80 宽的 `rgba(2,24,13,0.34)` 压暗带  ← 用来盖接缝（掩盖症状）
    //      中央 `rgba(255,255,255,0.10)` 竖向渐变     ← 就是那个"亮"
    //      底部 `rgba(0,20,10,0.16)` 压暗
    //    现在素材自带完整玉纹与端部圆角，**整层删除**（见下方 ③）。
    //
    //  【正确拼法】三段各占其位、**互不重叠**：
    //    ① 中段宽度 = `W − CAP_L − CAP_R`（两帽之间的**净空**），高 `H`
    //       ⇒ 纵向严格 1:1、横向 1.345×；
    //    ② 两帽 `aspectH: H` 定高等比 ⇒ 纵向与中段同比、横向不变形。
    //    ⇒ 全按钮再无任何方向的各向异性缩放（旧值是 2.81×）。
    //
    //  【常量来源 / 切点为什么是 190 与 706】见 `CFG.BTN_PRIMARY` 与
    //    `docs-verify/game-5/home/make_btn_primary_assets.py` 的头注释。
    private buildMainButton(): void {
        const { W, H, CAP_L, CAP_R } = BTN_PRIMARY;
        /** 两帽之间的净空 —— 中段的宽度 */
        const MID_W = W - CAP_L - CAP_R;
        const btn = createNode('BtnStart', this.body, { w: W, h: H, x: ex(215, W), y: ey(845, H) });
        btn.addComponent(UIOpacity);

        // ① 中段：只做水平拉伸，纵向严格 1:1；摆在两帽之间，**不与帽重叠**。
        //    （左右帽宽度不等 ⇒ 中段中心相对按钮中心偏 0.86 设计 px，这是对的：
        //      真正的约束是"两端贴死"，不是"中段居中"。）
        createSprite(btn, 'Mid', {
            path: ASSET.HOME_BTN_M, w: MID_W, h: H,
            x: -W / 2 + CAP_L + MID_W / 2,
        });
        // ② 两帽：定高等比，贴住左右边缘
        createSprite(btn, 'CapL', { path: ASSET.HOME_BTN_L, aspectH: H, anchor: [0, 0.5], x: -W / 2 });
        createSprite(btn, 'CapR', { path: ASSET.HOME_BTN_R, aspectH: H, anchor: [1, 0.5], x: W / 2 });

        // ③ 【已删除】旧的 `Shade` 层（两侧压暗带 + 中央白 10% 渐变 + 底部压暗）。
        //    它是"中间发亮"的直因，也是"四周违和"的帮凶（用压暗带盖接缝）。
        //    新拼法没有接缝可盖、素材自带明暗，整层去掉 —— 这是本次三项修改之一。

        // 文案
        createLabel(btn, '开始游戏', {
            fontSize: 36, color: '#FFE9A8', bold: true, w: W, h: 46, y: 14,
        });
        const subW = 40 + 12 + 150 + 12 + 40;
        this._startSubLabel = createLabel(btn, this.startSubText(), {
            fontSize: 24, color: 'rgba(255,247,230,0.88)', bold: true, w: subW, h: 28, y: -28,
        });
        // 两侧短金线
        const { g: lg } = createGraphicsNode('SubLines', btn, { w: subW, h: 28, y: -28 });
        const half = subW / 2;
        lg.fillColor = hex2color('#F6C445', 160);
        lg.rect(-half, -0.5, 40, 1); lg.fill();
        lg.rect(half - 40, -0.5, 40, 1); lg.fill();

        this.tapable(btn, () => {
            Haptics.medium();
            AudioService.playSfx('audio/button');
            // ★★ 第 58 轮修：这里**必须在点击时实时读存档**，不能用建时捕获的局部变量。
            //   捕获旧值的后果是"重置进度后立刻点开始游戏"仍然进**重置前**的那一关 ——
            //   而按钮上那行「继续 · 第 N 关」已经刷成"第 1 关"了 ⇒ 显示与行为**互相矛盾**，
            //   且两边都不报错。这种"显示刷了、行为没刷"比整块没刷更难发现。
            this.goto(PAGE.START, { level: SaveService.instance.level });
        }, true);
        this.settleIn(btn, 0.48);
    }

    /** 主按钮副标题「继续 · 第 N 关」（重置进度后要就地刷新，故收敛成一处） */
    private startSubText(): string {
        return `继续 · 第 ${SaveService.instance.level} 关`;
    }

    // ---- 左右功能列 ----
    //
    //  ★ 第 37 轮：用户反馈"两边的功能键太小"，图标 96 → **120（+25%）**、文案 22 → 26。
    //
    //  【放大到多少是被"撞不撞吉祥物"卡出来的，不是手感】
    //    · 吉祥物美术字显示 410 宽、素材不透明区占宽 99.7% ⇒ x 占 **170.6 ~ 579.4**；
    //    · 但它的**最宽点在手臂**（占素材高 57%），而功能键所在的 y 区间（830.6~946.6）
    //      吉祥物实际只有 **346.7** 宽（201.6 ~ 548.4）—— 比整体最宽窄 62px；
    //    · 左列右缘 = 40 + 120 = 160、右列左缘 = 710 − 120 = 590
    //      ⇒ 与吉祥物最小间隙 **41.6 设计 px**（按最坏情况 408.7 算也有 10.6，仍是正的）。
    //    · 文案 26 号："七日签到" 4 字 = 104 宽 ≤ 标签框 120，不溢出。
    //
    //  【为什么列位与节距一个没动】（top 仍 563 / 741）
    //    项高 130 → 158 后，两项之间留白 20 设计 px = 图标的 17%，属正常网格节奏；
    //    不动列位 = **改动面最小、最好回退**，也不会牵连主按钮 / 进度条的纵向口径。
    private buildFunctionColumn(): void {
        // 左列贴左边距，右列贴右边距（镜像）—— 改图标宽度时两侧同时生效、始终对称。
        const L = 40;
        const R = DW - 40 - FN_ICON;
        const pos = [
            { left: L, top: 563 },
            { left: L, top: 741 },
            { left: R, top: 563 },
            { left: R, top: 741 },
        ];
        HOME_FN.forEach((fn, i) => {
            const p = pos[i];
            const item = createNode(`Fn_${fn.id}`, this.body, {
                w: FN_ICON, h: FN_ITEM_H, x: ex(p.left, FN_ICON), y: ey(p.top, FN_ICON),
            });
            createSprite(item, 'Icon', { path: fn.icon, aspectW: FN_ICON });
            createLabel(item, fn.label, {
                fontSize: FN_FS, color: COLOR.CREAM, w: 120, h: FN_FS,
                y: -(FN_ICON / 2) - FN_GAP - FN_FS / 2,
            });
            this.tapable(item, () => {
                Haptics.light();
                // ★ 第 53 轮（T17）：**排行榜**入口接线。
                // ★ 第 55 轮（T15）：**好友邀战**入口接线。
                // ★ 第 56 轮（T14）：**道具商城**入口接线。
                // ★ 第 57 轮（T13）：**七日签到**入口接线 ⇒ **四枚功能键全部接通**，
                //   下面那行兜底 `敬请期待` 到此为止是**不可达**的（留着以防将来加第 5 枚）。
                if (fn.id === 'rank') { this.openRank(); return; }
                if (fn.id === 'invite') { this.openInvite(); return; }
                if (fn.id === 'shop') { this.openShop(); return; }
                if (fn.id === 'signin') { this.openSignIn(); return; }
                // ⚠️ 这行**已经不可达**（四键全部接通，TS 会把 `fn` 收窄成 `never`）。
                //    留着是为了"将来加第 5 枚功能键"时**不会静默无反应** ——
                //    所以显式断言回原始元素类型，换掉被收窄的 `never`。
                toast(this.body, `${(fn as (typeof HOME_FN)[number]).label} 敬请期待`);
            });

            // ---- 「今日可领」红点（★ 第 57 轮 · T13b · 稿 E 规格）----
            //  直径 26 / 圆心落在图标右上角**顶点**（right、top 各偏 −13）⇒ 半内半外；
            //  朱红填充 + 象牙白描边 3（深绿底上没这圈白会糊成一团）+ 红色外发光。
            //  ⚠️ 只有「有每日重置次数」的两个入口才配红点（签到 / 商城）；
            //     排行榜与邀战没有每日限额，给它们加就是**永远亮着的假红点** ——
            //     而玩家学会忽略红点之后，签到那个**真红点**也一起被忽略。
            if (fn.id === 'signin' || fn.id === 'shop') {
                const dot = createNode(`FnDot_${fn.id}`, item, {
                    w: 26, h: 26, x: FN_ICON / 2 - 13, y: FN_ICON / 2 - 13,
                });
                const { g: dg } = createGraphicsNode('Face', dot, { w: 26, h: 26 });
                // 外发光用两层低 alpha 大圆近似（稿：红 · 半径 10 · 亮度 .85）
                fillCircle(dg, 0, 0, 18, COLOR.RED, 38);
                fillCircle(dg, 0, 0, 15, COLOR.RED, 120);
                // ⚠️ 稿里 `.dot` 是 `26×26 + border:3px` 且 `box-sizing:border-box`
                //   ⇒ 那圈象牙白是**画在 26 里面**的：红心直径 20、白环占掉外侧 3。
                fillCircle(dg, 0, 0, 10, COLOR.RED, 255);
                // 描边**必须另起一个 Graphics** —— `fill()/stroke()` 作用于整条路径，
                // 同节点里 stroke 会把上面三颗发光圆也描一圈。
                const { g: rg } = createGraphicsNode('Ring', dot, { w: 26, h: 26 });
                strokeCircle(rg, 0, 0, 11.5, COLOR.CREAM, 3, 255);
                dot.active = false;
                this._fnDots[fn.id] = dot;
            }
            this.settleIn(item, 0.62);
        });
        // 红点状态要在四枚都建完之后统一刷一次（顺带把"商城今天还剩几次"算进去）
        this.refreshFnDots();
    }

    // ---- 关卡进度 ----
    private buildProgress(): void {
        const W = PROGRESS_W;
        const grp = createNode('Progress', this.body, { w: W, h: 90, x: ex(165, W), y: ey(1045, 90) });
        const { g } = createGraphicsNode('Line', grp, { w: W, h: 16, y: 34 });
        this._progressG = g;
        this._progressLabel = createLabel(grp, '', {
            fontSize: 24, color: COLOR.CREAM_DIM, w: W, h: 28, y: -14,
        });
        this.refreshProgress();          // 文案与图形都从这里出，避免"建时一套、刷新又是一套"
        this.settleIn(grp, 0.74);
    }

    /**
     * 按**当前存档**把进度条与「第 N 关 · 共 M 关」原地重绘。
     *
     * 【为什么是"重绘"而不是"重建节点"】
     *   ① `createNode(...)` 一律**追加**到 `body` 末尾 ⇒ 重建一次，进度组就跳到最上层，
     *      会盖住后建的元素（这里恰好是设置抽屉的背景层），而**不会有任何报错**；
     *   ② 重建还会连带把 `settleIn` 的入场动画再播一遍（0.74s 才浮出来），
     *      与"点了确认立刻生效"的诉求正相反。
     *   所以留三个把手（组 / Graphics / Label），原地 `clear()` + 重绘。
     *
     * 【为什么分母从写死的 30 改成 `maxLevel`】
     *   旧代码填充比例用 `lv / 30`，而下面那行文案用 `maxLevel` —— 两个来源。
     *   关卡数一旦不是 30，进度条与文字就会各说各话（且不报错）。统一取 `maxLevel`。
     */
    private refreshProgress(): void {
        const g = this._progressG;
        const lv = SaveService.instance.level;
        const max = Math.max(1, SaveService.instance.maxLevel);
        if (this._progressLabel?.isValid) {
            this._progressLabel.string = `第 ${lv} 关 · 共 ${max} 关`;
        }
        if (!g?.isValid) return;
        const W = PROGRESS_W;
        const frac = Math.max(0.04, Math.min(1, lv / max));
        g.clear();
        // 轨道 4px
        fillRoundRect(g, 0, 0, W, 4, 3, 'rgba(255,247,230,0.14)', 255);
        // 已完成段
        fillRoundRect(g, -W / 2 + (W * frac) / 2, 0, W * frac, 4, 3, COLOR.GOLD, 255);
        // 菱形游标
        const dx = -W / 2 + W * frac;
        g.fillColor = hex2color(COLOR.GOLD_HI);
        g.moveTo(dx, 8); g.lineTo(dx + 8, 0); g.lineTo(dx, -8); g.lineTo(dx - 8, 0); g.close(); g.fill();
    }

    /**
     * ★ 第 58 轮：把首页**所有依赖存档的显示**按当前存档重刷一遍。
     *
     * 【为什么收成一个函数，而不是在重置处平铺几行】
     *   "重置进度"这种事最怕**漏刷一处** —— 漏掉的那处不会报错，只是静静显示旧值，
     *   表现成"重置好像生效了、但有个地方不对"，比整块没生效更难归因。
     *   收成一个函数之后，**判据也就只有一条**：「调用它之后，页面上不再有任何
     *   与存档不一致的数字」。验收脚本照这条写（见 `tools/_r59-verify.mjs` 的 R 组）。
     *
     * 【清单怎么来的：反向 grep，不是凭印象】
     *   `grep -n 'SaveService\.instance' HomePage.ts` ⇒ 逐个确认它是不是"显示"：
     *     651 金币胶囊 ✅ · 752 主按钮副标题 ✅ · 867/875 进度条 ✅
     *     1282 商城「当前持有」✅ · 1583 签到「已连签 n 天」✅ · 1865 两颗红点 ✅
     *   剩下的（1142 / 1205 / 1967 的 `RankService.pushScore`、签到/商城的读写动作）
     *   不是常驻显示，不在此列。
     *
     * ⚠️ 两个弹层的刷新**必须带 `isValid` 守卫**：`refreshSignCells()` 里有一句
     *    `this._signCard!`（非空断言），弹层没开时 `_signCard` 是 `null`
     *    ⇒ 裸调会直接抛 TypeError。这类"只有弹层开着时才安全"的方法，
     *    一律按"层在才刷"处理。
     */
    private refreshSaveDependent(): void {
        // ① 顶栏金币
        if (this._walletLabel?.isValid) this._walletLabel.string = this.coinText();
        // ② 关卡进度条 + 「第 N 关 · 共 M 关」
        this.refreshProgress();
        // ③ 主按钮副标题「继续 · 第 N 关」
        if (this._startSubLabel?.isValid) this._startSubLabel.string = this.startSubText();
        // ④ 两颗入口红点（签到 = 今天还没签；商城 = 四件里有任一件还剩次数）
        this.refreshFnDots();
        // ⑤ / ⑥ 两个弹层（**层活着才刷**，理由见上面的 ⚠️）
        //   `refreshShopRows()` 已经把「当前持有 n」一起刷了（第 58 轮补的 `hold`），
        //   这里不需要再单独处理那一行。
        if (this._shopLayer?.isValid) this.refreshShopRows();
        if (this._signLayer?.isValid) this.refreshSignCells();
    }

    // ========================================================
    //  设置面板（底部抽屉）
    // ========================================================
    /**
     * 设置抽屉（**第 37 轮整页重排** —— 用户："提升整体排版的美观度与规整性，
     * 使布局层次清晰、间距合理、视觉协调"）。
     *
     * 病因 / 栅格 / 坐标表见文件顶部「设置抽屉栅格」注释块，这里只讲实现要点：
     *   · 四行同一个骨架「图标列 44 → 间隙 22 → 文字 … 右端控件」，
     *     左右缘全部对齐（原版是三档不齐）；
     *   · 标题与关闭按钮**共用中线 80**（原版差 18）；
     *   · 两条分隔线只落在**组与组的空隙中央**（原版那条穿在行内部）。
     */
    private buildSheet(): void {
        const scrim = createScrim(this.body, 150, () => this.closeSheet());
        scrim.active = false;

        const sheet = createNode('Sheet', this.body, {
            w: DW, h: SHEET_H, anchor: [0.5, 0], y: -this.visible().height / 2,
        });

        const { g } = createGraphicsNode('Bg', sheet, { w: DW, h: SHEET_H, anchor: [0.5, 0] });
        g.fillColor = hex2color('rgba(8,18,13,0.98)');
        g.roundRect(-DW / 2, 0, DW, SHEET_H, 44);
        g.fill();
        g.lineWidth = 2; g.strokeColor = hex2color('rgba(246,196,69,0.34)');
        g.roundRect(-DW / 2, 0, DW, SHEET_H, 44); g.stroke();

        // 抓手
        fillRoundRect(g, 0, sy(SHEET_T.grip, 8), 76, 8, 4, 'rgba(246,196,69,0.28)', 255);

        // ---- 标题带：标题与关闭按钮**共用中线** ----
        createLabel(sheet, '设置', {
            fontSize: 44, color: COLOR.CREAM, bold: true, serif: true,
            w: DW, h: SHEET_T.headerH, y: sy(SHEET_T.header, SHEET_T.headerH),
        });

        // 关闭按钮：**右缘与内容右缘对齐**（原版距右 30，比行的边距 46 还靠外 16）
        const CLOSE_S = 88;
        const HEADER_CY = SHEET_T.header + SHEET_T.headerH / 2;         // 80
        const close = createNode('Close', sheet, {
            w: CLOSE_S, h: CLOSE_S,
            x: DW / 2 - SHEET_PAD - CLOSE_S / 2,
            y: sy(HEADER_CY - CLOSE_S / 2, CLOSE_S),
        });
        const { g: cg } = createGraphicsNode('X', close, { w: CLOSE_S, h: CLOSE_S });
        // 圆环 40 → 30：88 的框里放 80 的环是"顶满"的（原版视觉上压住标题）；
        // 30 的环 + 26 的 ✕ 更克制，也更像一个图标而不是一个大按钮。
        cg.lineWidth = 2; cg.strokeColor = hex2color('rgba(246,196,69,0.30)');
        polyArc(cg, 0, 0, 30, 0, Math.PI * 2, 64); cg.stroke();
        cg.lineWidth = 2.6; cg.strokeColor = hex2color('rgba(246,196,69,0.72)');
        cg.moveTo(-13, -13); cg.lineTo(13, 13); cg.stroke();
        cg.moveTo(13, -13); cg.lineTo(-13, 13); cg.stroke();
        this.tapable(close, () => this.closeSheet());

        // ---- 分隔线：**只出现在组与组之间**，且落在空隙正中 ----
        const rule = (top: number, alpha: number): void => {
            const { g: dg } = createGraphicsNode('Rule', sheet, {
                w: SHEET_ROW_W, h: 2, y: sy(top, 2),
            });
            dg.fillColor = hex2color('rgba(246,196,69,' + alpha + ')');
            dg.rect(-SHEET_ROW_W / 2, -1, SHEET_ROW_W, 2); dg.fill();
        };
        rule(SHEET_T.rule1, 0.22);
        rule(SHEET_T.rule2, 0.16);

        // ---- 开关组 ----
        // ★ 第 52 轮修 bug：原来两个开关**都读同一个 `AudioService.muted`、都调 `setMuted`**
        //   ⇒ 按哪个都是"全静音 / 全开"，用户报"关背景音乐会连音效一起关"就是这个。
        //   现在各读各的位、各调各的 setter，互不影响。
        this.sheetRow(sheet, SHEET_T.row1, ASSET.HOME_MUTE_ON, '音效', !AudioService.sfxMuted, (on) => {
            AudioService.setSfxMuted(!on);
            toast(this.body, on ? '音效已开启' : '音效已关闭');
            return on;
        });
        this.sheetRow(sheet, SHEET_T.row2, ASSET.HOME_ICON_MUSIC, '背景音乐', !AudioService.bgmMuted, (on) => {
            AudioService.setBgmMuted(!on);
            toast(this.body, on ? '音乐已开启' : '音乐已关闭');
            return on;
        });

        // ---- 链接组 ----
        this.sheetLink(sheet, SHEET_T.row3, 'reset', '重置进度', () => {
            // ★ 第 52 轮：**破坏性操作加二次确认**。
            //   原来一点就把存档清了（关卡 / 金币 / 道具 / 签到全没），一点挽回余地都没有。
            confirmDialog(this.body, {
                title: '重置进度？',
                desc: '关卡进度、金币与道具会全部清空',
                ok: '确认重置',
                cancel: '算了',
                onOk: () => {
                    SaveService.instance.resetAll();
                    // ★★ 第 58 轮修复（用户报「点击后没有立即重置，要进下一关才生效」）：
                    //   根因是**首页所有读存档的显示都是建时快照、之后没人刷** ——
                    //   `resetAll()` 把存档清了，画面上却一个数字都没变，玩家自然判定"没生效"。
                    //   这里补一次就地刷新；toast 也去掉「重开生效」那句
                    //   （那句本身就是"不会立刻生效"的书面承认，现在它不成立了）。
                    this.refreshSaveDependent();
                    toast(this.body, '进度已重置');
                },
            });
        });
        this.sheetLink(sheet, SHEET_T.row4, 'info', '关于本作', () => {
            toast(this.body, `《${GAME.NAME}》· 试玩版 v0.1`);
        });

        // ---- 版本号：独立一行、与「关于本作」脱开（原版两者重叠 16px）----
        createLabel(sheet, `${GAME.VERSION} · 试玩版`, {
            fontSize: 20, color: 'rgba(220,235,223,0.42)',
            w: DW, h: SHEET_T.verH, y: sy(SHEET_T.ver, SHEET_T.verH),
        });

        this._sheet = sheet;
        sheet.active = false;
        (sheet as unknown as { _scrim: Node })._scrim = scrim;
        // 收起态：整体沉到屏幕外
        sheet.setPosition(0, -this.visible().height / 2 - SHEET_H, 0);
    }

    /**
     * 开关行：「图标列 44 → 间隙 22 → 文字 … 右端开关」——四行共用的骨架。
     *
     * ★ 图标改**定高**（`aspectH`）而不是定宽：两个素材宽高比 1.10（喇叭）/ 0.835（音符）
     *   不同，定宽 42 会让喇叭显示 42×38.2、音符显示 42×50.3 —— **一高一矮**，
     *   这是原版"看着不齐"的隐藏来源之一。定高 40 之后两者视觉高度严格一致。
     */
    private sheetRow(parent: Node, top: number, icon: string, label: string, on: boolean,
                     onChange: (on: boolean) => boolean): void {
        const row = createNode(`Row_${label}`, parent, {
            w: SHEET_ROW_W, h: SHEET_ROW_H, y: sy(top, SHEET_ROW_H),
        });
        createSprite(row, 'Icon', {
            path: icon, aspectH: SHEET_ICON_H, anchor: [0, 0.5], x: -SHEET_ROW_W / 2,
        });
        createLabel(row, label, {
            fontSize: 28, color: 'rgba(255,247,230,0.93)', w: 400, h: SHEET_ROW_H,
            anchor: [0, 0.5], alignLeft: true, x: SHEET_TEXT_X,
        });

        // 开关 96×56（右缘 = 内容右缘）
        const sw = createNode('Sw', row, { w: 96, h: 56, x: SHEET_ROW_W / 2 - 48 });
        const g = sw.addComponent(Graphics);
        let state = on;
        const paint = (): void => {
            g.clear();
            fillRoundRect(g, 0, 0, 96, 56, 28, state ? COLOR.JADE : 'rgba(255,247,230,0.16)', 255);
            strokeRoundRect(g, 0, 0, 96, 56, 28, 'rgba(246,196,69,0.28)', 1.5, 255);
            const kx = state ? 47 - 48 + 22 : 5 - 48 + 22;
            fillRadialGlowE(g, kx, 0, 22, 22, '#FFFDF3', 255, 8);
        };
        paint();

        this.tapable(row, () => {
            state = onChange(!state);
            paint();
            Haptics.light();
        });
    }

    /** 链接行：**与开关行同一骨架**（图标列 → 文字 … 右端 ›） */
    private sheetLink(parent: Node, top: number, glyph: 'reset' | 'info', label: string,
                      onClick: () => void): void {
        const row = createNode(`Link_${label}`, parent, {
            w: SHEET_ROW_W, h: SHEET_ROW_H, y: sy(top, SHEET_ROW_H),
        });
        this.rowGlyph(row, glyph, -SHEET_ROW_W / 2);
        createLabel(row, label, {
            fontSize: 28, color: 'rgba(255,247,230,0.86)', w: 400, h: SHEET_ROW_H,
            anchor: [0, 0.5], alignLeft: true, x: SHEET_TEXT_X,
        });
        createLabel(row, '›', {
            fontSize: 34, color: 'rgba(246,196,69,0.8)', w: 40, h: SHEET_ROW_H,
            anchor: [1, 0.5], x: SHEET_ROW_W / 2,
        });
        this.tapable(row, () => { Haptics.light(); onClick(); });
    }

    /**
     * 链接行的行首图标 —— 金色**线描**（与开关行的写实图标同色系，但更"轻"）。
     *
     * ★ 为什么给链接行也加图标：原版两组的左边缘是**三档不齐**的
     *   （开关图标 46 / 开关文字 110 / 链接文字 46）。加图标之后四行统一成
     *   「图标列 → 间隙 → 文字」同一骨架，左缘严格对齐 —— 这是"规整"最关键的一条。
     *
     * ★ 为什么用线描、而不是再出两张写实素材：
     *   · 素材库里没有"重置 / 信息"语义的现成图标，新出两张 PNG 还要占包体；
     *   · 线描天然比写实"轻" ⇒ 正好形成层级：**可操作的开关行实心、跳转的链接行线描**。
     *
     * ⚠️ 描边与填充**必须分成两个节点** —— Cocos 的 `fill()/stroke()` 作用于
     *    "当前整条路径"且不会自动重置，混在一个 Graphics 里会把圆环也填成实心。
     */
    private rowGlyph(parent: Node, kind: 'reset' | 'info', x: number): void {
        const gold = hex2color('#F6C445', 215);
        const opt = { w: SHEET_ICON_W, h: SHEET_ICON_W, anchor: [0, 0.5] as [number, number], x };
        const { g: gl } = createGraphicsNode(`Glyph_${kind}_Stroke`, parent, opt);
        const { g: gs } = createGraphicsNode(`Glyph_${kind}_Fill`, parent, opt);
        gl.lineWidth = 3.6; gl.strokeColor = gold;
        gs.fillColor = gold;

        // 半径 16.5 ⇒ 可见直径 16.5×2 + 线宽 3.6 = 36.6 —— 与上方写实图标的 40 显示高
        // 基本齐平（第一版用了 13.5，视觉上小一圈，看着像"缩水的图标"）。
        const R = 16.5;
        if (kind === 'reset') {
            // 3/4 圆环（缺口在右侧偏上），末端沿切向伸出一个实心三角 = "回转"
            polyArc(gl, 0, 0, R, Math.PI * 0.30, Math.PI * 2, 64);
            gl.stroke();
            const a = Math.PI * 0.30;
            const px = R * Math.cos(a), py = R * Math.sin(a);
            const tx = -Math.sin(a), ty = Math.cos(a);      // 逆时针切向
            const nx = Math.cos(a), ny = Math.sin(a);       // 外法向
            gs.moveTo(px + tx * 9, py + ty * 9);
            gs.lineTo(px + nx * 6.5, py + ny * 6.5);
            gs.lineTo(px - nx * 6.5, py - ny * 6.5);
            gs.close(); gs.fill();
        } else {
            // 圆环 + 小写 i（点 + 竖），**一次 stroke 画完两个子路径**
            polyArc(gl, 0, 0, R, 0, Math.PI * 2, 64);
            gl.moveTo(0, 2); gl.lineTo(0, -10.5);
            gl.stroke();
            gs.circle(0, 8.5, 2.8); gs.fill();
        }
    }

    // ========================================================
    //  排行榜（★ 第 53 轮新增 · T17 好友榜）
    // ========================================================
    //
    //  【它为什么长这样 —— 三个尺寸不是随便定的】
    //   ① `RANK_ODC_W:H = 640:960`（= **2:3**）。
    //      开放数据域的共享画布尺寸由引擎 `SubContextView` 定成 **640×960**
    //      （`designResolutionSize` 的默认值，运行期只读），组件再按 **SHOW_ALL**
    //      把画布缩放进节点框。⇒ 节点框必须是同一个 2:3，否则会左右留黑边。
    //   ② 卡宽 664 = 640 + 左右各 12 留边，让金框包住画布而不是压在画布上。
    //   ③ 底部 130 的条只放「关闭」——**不再叠任何奖励文案**（分享/奖励的合规口径）。
    //
    //  【环境不支持时不要留空框】浏览器直跑 / 基础库太老 ⇒ `RankService.available`
    //    为假。这时**画出说明文字**，而不是给一个"什么都没有"的黑框（那会被当成 bug）。

    /** 排行榜浮层（null = 没开） */
    private _rankLayer: Node | null = null;

    private openRank(): void {
        if (this._rankLayer?.isValid) return;

        const layer = createNode('RankLayer', this.body, { w: 1, h: 1 });
        this._rankLayer = layer;
        layer.addComponent(UIOpacity).opacity = 0;

        createScrim(layer, 190, () => this.closeRank());

        const H = RANK_TOP_PAD + RANK_ODC_H + RANK_BAR_H;
        const top = H / 2;
        const card = createNode('RankCard', layer, { w: RANK_CARD_W, h: H });
        const { g } = createGraphicsNode('Bg', card, { w: RANK_CARD_W, h: H });
        g.fillColor = hex2color('rgba(8,18,13,0.98)');
        g.roundRect(-RANK_CARD_W / 2, -top, RANK_CARD_W, H, 40); g.fill();
        g.lineWidth = 2; g.strokeColor = hex2color('rgba(246,196,69,0.34)');
        g.roundRect(-RANK_CARD_W / 2, -top, RANK_CARD_W, H, 40); g.stroke();

        // ---- 画布（开放数据域的视窗）----
        const odcY = top - RANK_TOP_PAD - RANK_ODC_H / 2;
        if (RankService.instance.available) {
            const view = createNode('OpenDataView', card, { w: RANK_ODC_W, h: RANK_ODC_H, y: odcY });
            // `SubContextView` 自己会在内部建一个带 Sprite 的 content 子节点，
            // 所以这里**不需要**再给本节点挂 Sprite（挂了也不影响，纯多余）。
            view.addComponent(SubContextView);
            // 先上报自己的最高关卡，再让开放数据域拉一次好友数据重绘
            RankService.instance.pushScore(SaveService.instance.best);
            RankService.instance.render();
        } else {
            createLabel(card, '排行榜需要在小游戏里查看', {
                fontSize: 28, color: COLOR.CREAM_DIM, w: RANK_CARD_W, h: 40, y: odcY + 40,
            });
            createLabel(card, '（浏览器预览环境没有开放数据域）', {
                fontSize: 22, color: COLOR.CREAM_MUTE, w: RANK_CARD_W, h: 32, y: odcY - 10,
            });
        }

        // ---- 底部：关闭 ----
        const barY = -top + RANK_BAR_H / 2;
        const close = createNode('RankClose', card, { w: 360, h: 88, y: barY });
        const { g: cg } = createGraphicsNode('Btn', close, { w: 360, h: 88 });
        cg.fillColor = hex2color('rgba(255,247,230,0.06)');
        cg.roundRect(-180, -44, 360, 88, 44); cg.fill();
        cg.lineWidth = 2; cg.strokeColor = hex2color('rgba(246,196,69,0.45)');
        cg.roundRect(-180, -44, 360, 88, 44); cg.stroke();
        createLabel(close, '关闭', { fontSize: 32, color: COLOR.CREAM, bold: true, w: 360, h: 40 });
        this.tapable(close, () => this.closeRank());

        MotionFx.fadeTo(layer.getComponent(UIOpacity)!, 255, 0.22);
        console.log(`[HomePage] 排行榜已打开（环境可用=${RankService.instance.available}）`);
    }

    private closeRank(): void {
        const l = this._rankLayer;
        this._rankLayer = null;
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.2);
        this.timers.add(240, () => { if (l.isValid) l.destroy(); });
    }

    // ========================================================
    //  好友邀战（★ 第 55 轮新增 · T15）
    // ========================================================
    //
    //  【为什么"点一下就行"——没有弹层、没有中间页、没有奖励】
    //    微信《小游戏运营规范》把"分享后才能获得奖励"直接列为**诱导分享**。
    //    所以这条入口的合规形态就是：**点 → 直接拉起转发面板**，
    //    中间不插任何"分享得 XX"的页，按钮文案里也不出现"得 / 领 / 奖励"。
    //    与结算页胜态那个「分享」按钮是**同一套载荷**（`ShareService.share()`），
    //    只是走 `mode='invite'` 换一条拉新文案 —— 两条路的文案**互不出现**。
    //
    //  【为什么取 `best` 而不是 `level`】
    //    `SaveService.level` 是"继续"要玩的下一关，分享给别人看的是**成绩**，
    //    所以用 `best`（历史最高通关）。没有成绩时 `best = 0`，
    //    `setLevel()` 会兜底成 1 —— 文案里不出现关卡号，但 query 仍合法。
    //
    //  【环境不支持时要说出来】
    //    浏览器直跑 / 基础库过老 ⇒ `ShareService.available` 为假。
    //    这时**明说**（toast），别让按钮看起来像坏了 —— 与 `openRank()` 的
    //    "不留空框"是同一条原则。

    private openInvite(): void {
        const svc = ShareService.instance;
        if (!svc.available) {
            toast(this.body, '分享需要在小游戏里使用');
            console.log('[HomePage] 邀战入口：当前环境无分享能力（浏览器直跑）');
            return;
        }
        const ok = svc.share(Math.max(1, SaveService.instance.best), 'invite');
        console.log(`[HomePage] 邀战入口：已拉起分享=${ok}`);
    }

    // ========================================================
    //  道具商城（★ 第 56 轮新增 · T14）
    // ========================================================
    //
    //  【口径 —— 代码唯一真源 `CFG.AD_QUOTA`（2026-10-07 用户拍板）】
    //    · A3 本商城 = **每种道具 2 次/日**（计数键带道具名，四件套 ⇒ 单日最多 8 次）；
    //    · A2 局内「＋」= **不限次数** —— 与本页**各自记账**。
    //    ⚠️ 设计规则旧版那句「局内与商城**共用每日频次计数**」已作废：
    //       一个不限、一个限量，共用一个池子在语义上讲不通。
    //
    //  【为什么计数必须落盘（不能只放内存）】
    //    玩家会「领 1 次 → 杀掉小游戏 → 重进 → 再领 1 次」。纯内存计数**当场清零**，
    //    上限形同虚设，而且**不报错**。所以走 `SaveService` 的每日配额
    //    （带日期键、读时惰性清零，见 `SaveService.rollDaily()`）。
    //
    //  【★ 顺序：先播广告拿到 `end`，再扣配额 + 发货】
    //    `AdService` 三种结局里只有 `end` 算"看完了"，`abort` / `fail` 一律**不发**。
    //    反过来先扣次数再播广告 ⇒ 玩家跳过广告也白扣，而且不会有任何报错。

    private _shopLayer: Node | null = null;
    /** 广告播放中（连点保护；`AdService` 自己也有一次保护） */
    private _shopBusy = false;
    /**
     * 每行的可刷新件（领到道具后要重画按钮 + 改三行文字）。
     *
     * ★ 第 58 轮补 `hold`：「当前持有 n」原来是个**建时写死、之后没人管**的 Label，
     *   重置进度（清空 `inventory`）后它会一直显示旧数字 —— 典型的"漏刷一处"。
     */
    private _shopRows: { key: ToolKey; g: Graphics; btnText: Label; left: Label; hold: Label }[] = [];

    private openShop(): void {
        if (this._shopLayer?.isValid) return;

        const layer = createNode('ShopLayer', this.body, { w: 1, h: 1 });
        this._shopLayer = layer;
        layer.addComponent(UIOpacity).opacity = 0;
        createScrim(layer, 190, () => this.closeShop());

        const card = createNode('ShopCard', layer, { w: SHOP_CARD_W, h: SHOP_CARD_H });
        const half = SHOP_CARD_H / 2;
        const { g } = createGraphicsNode('Bg', card, { w: SHOP_CARD_W, h: SHOP_CARD_H });
        // 外圈深绿描边（视觉稿里的 `box-shadow: 0 0 0 3px #0A3327`）→ 玉质渐变 → 金线 5px
        strokeRoundRect(g, 0, 0, SHOP_CARD_W + 6, SHOP_CARD_H + 6, 39, '#0A3327', 3, 255);
        fillVGradient(g, 0, 0, SHOP_CARD_W, SHOP_CARD_H, 36, '#1B6047', '#123F30', 36);
        strokeRoundRect(g, 0, 0, SHOP_CARD_W, SHOP_CARD_H, 36, COLOR.GOLD, 5, 255);

        // 标题骑在弹层上沿（与结算弹层 ribbonTop 同一手法；中心正落在卡顶边上）
        createLabel(card, '道具商城', {
            fontSize: SHOP_TITLE_FS, bold: true, serif: true, color: COLOR.CREAM,
            w: SHOP_CARD_W, h: 92, y: half, outline: '#4A2B18', outlineWidth: 3,
        });

        const subY = half - SHOP_TOP_PAD - SHOP_SUB_GAP_TOP - SHOP_SUB_H / 2;
        createLabel(card, '看广告免费领', {
            fontSize: SHOP_SUB_FS, color: COLOR.CREAM_DIM, w: SHOP_CARD_W, h: SHOP_SUB_H, y: subY,
        });

        // ---- 四行道具 ----
        //  y 由「卡顶 → 依次下推」算出来，不写死：改行高/间距，四行与关闭键一起跟着走
        const rowTop = half - SHOP_TOP_PAD - SHOP_SUB_GAP_TOP - SHOP_SUB_H - SHOP_SUB_GAP_BOTTOM;
        this._shopRows = [];
        TOOL_ORDER.forEach((key, i) => {
            const cy = rowTop - i * (SHOP_ROW_H + SHOP_ROW_GAP) - SHOP_ROW_H / 2;
            const row = createNode(`ShopRow_${key}`, card, { w: SHOP_ROW_W, h: SHOP_ROW_H, y: cy });
            const { g: rg } = createGraphicsNode('Face', row, { w: SHOP_ROW_W, h: SHOP_ROW_H });
            fillVGradient(rg, 0, 0, SHOP_ROW_W, SHOP_ROW_H, SHOP_ROW_R, '#1E6049', '#144534', 24);
            strokeRoundRect(rg, 0, 0, SHOP_ROW_W, SHOP_ROW_H, SHOP_ROW_R, 'rgba(255,255,255,0.3)', 3, 255);

            const iconX = -SHOP_ROW_W / 2 + SHOP_ROW_PAD_X + SHOP_ROW_ICON / 2;
            createSprite(row, 'Icon', { path: TOOL_ICON[key], aspectW: SHOP_ROW_ICON, x: iconX });

            const textX = -SHOP_ROW_W / 2 + SHOP_ROW_PAD_X + SHOP_ROW_ICON + SHOP_ROW_GAP_ICON;
            const meta = TOOL_META[key];
            createLabel(row, meta.name, {
                fontSize: SHOP_NAME_FS, bold: true, color: COLOR.CREAM,
                alignLeft: true, w: SHOP_ACT_W, h: 38, x: textX, y: 16,
            });
            // 「当前持有 n」——数量是**跨局库存**（与局内赠礼那套账分开）
            const hold = createLabel(row, this.shopHoldText(key), {
                fontSize: SHOP_STOCK_FS, color: COLOR.CREAM_DIM,
                alignLeft: true, w: SHOP_ACT_W, h: 30, x: textX, y: -18,
            });
            // ⚠️ 节点名必须唯一（与 `ShopBtn_*` 同规矩）—— 否则验收脚本按名取到的永远是第一行
            hold.node.name = `ShopHold_${key}`;

            // 行尾操作列：按钮在上、「今日还可 n 次」在下（★ 用户拍板：不用刻度点）
            //
            // ⚠️ 节点名**必须带道具名**（`ShopBtn_erase` 而不是 `Btn`）：
            //    `__g5t.find(name)` 返回**深度优先的第一个同名节点**，
            //    四行都叫 `Btn` 的话，验收脚本点"第二行"时实际点到的永远是第一行 ——
            //    而"逐件独立计数"正好要靠点不同行来验，会直接验不出来。
            const actX = SHOP_ROW_W / 2 - SHOP_ROW_PAD_X - SHOP_ACT_W / 2;
            const btn = createNode(`ShopBtn_${key}`, row, { w: SHOP_BTN_W, h: SHOP_BTN_H, x: actX, y: 17 });
            const { g: bg } = createGraphicsNode('Face', btn, { w: SHOP_BTN_W, h: SHOP_BTN_H });
            const btnText = createLabel(btn, '免费领', {
                fontSize: 26, bold: true, color: '#5C3610', w: SHOP_BTN_W - 20, h: SHOP_BTN_H,
            });
            const left = createLabel(row, `今日还可 ${AD_QUOTA.SHOP_PER_TOOL_PER_DAY} 次`, {
                fontSize: SHOP_LEFT_FS, color: COLOR.CREAM_DIM, w: SHOP_ACT_W, h: 26, x: actX, y: -43,
            });
            left.node.name = `ShopLeft_${key}`;
            this.tapable(btn, () => this.claimShopTool(key));

            this._shopRows.push({ key, g: bg, btnText, left, hold });
        });

        // ---- 关闭 ----
        const closeW = SHOP_CARD_W - 60;
        const close = createNode('ShopClose', card, { w: closeW, h: SHOP_CLOSE_H, y: -half + SHOP_BOTTOM_PAD + SHOP_CLOSE_H / 2 });
        const { g: cg } = createGraphicsNode('Face', close, { w: closeW, h: SHOP_CLOSE_H });
        fillRoundRect(cg, 0, 0, closeW, SHOP_CLOSE_H, SHOP_CLOSE_H / 2, 'rgba(0,0,0,0.18)', 255);
        strokeRoundRect(cg, 0, 0, closeW, SHOP_CLOSE_H, SHOP_CLOSE_H / 2, 'rgba(255,247,230,0.55)', 3, 255);
        createLabel(close, '关闭', { fontSize: 28, bold: true, color: COLOR.CREAM, w: closeW, h: 40 });
        this.tapable(close, () => this.closeShop());

        this.refreshShopRows();
        MotionFx.fadeTo(layer.getComponent(UIOpacity)!, 255, 0.22);
        const st = this._shopRows.map((r) => `${r.key}:${SaveService.instance.dailyLeft(`shop:${r.key}`, AD_QUOTA.SHOP_PER_TOOL_PER_DAY)}`);
        console.log(`[HomePage] 道具商城已打开（每件上限 ${AD_QUOTA.SHOP_PER_TOOL_PER_DAY}/日 · 剩余 ${st.join(' ')}）`);
    }

    private closeShop(): void {
        const l = this._shopLayer;
        this._shopLayer = null;
        this._shopRows = [];
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.2);
        this.timers.add(240, () => { if (l.isValid) l.destroy(); });
    }

    /** 「当前持有 n」那行字（建行与刷新两处共用，避免出现两套口径） */
    private shopHoldText(key: ToolKey): string {
        return `当前持有 ${SaveService.instance.count(key)}`;
    }

    /** 按当前配额把四行刷成常态 / 冷却态（★ 逐件独立 —— 一件领满不影响其余三件） */
    private refreshShopRows(): void {
        const sv = SaveService.instance;
        const max = AD_QUOTA.SHOP_PER_TOOL_PER_DAY;
        for (const r of this._shopRows) {
            const left = sv.dailyLeft(`shop:${r.key}`, max);
            const can = left > 0;
            paintShopButton(r.g, !can);
            r.btnText.string = can ? '免费领' : '明日再来';
            r.btnText.color = hex2color(can ? '#5C3610' : '#8FA79A');
            r.left.string = can ? `今日还可 ${left} 次` : '今日已领完';
            r.left.color = hex2color(can ? COLOR.CREAM_DIM : '#8FA79A');
            // ★ 第 58 轮：库存那行也归这里刷（领取会 +1、重置进度会归零）
            r.hold.string = this.shopHoldText(r.key);
        }
    }

    /**
     * 点「免费领」：播一次广告 → **只有 `end` 才**扣配额 + 发货。
     * 广告从哪来与主玩页走同一条判断（`AdService.modeOf`），替身面板也是**同一块**。
     */
    private claimShopTool(key: ToolKey): void {
        if (this._shopBusy) return;
        const sv = SaveService.instance;
        const max = AD_QUOTA.SHOP_PER_TOOL_PER_DAY;
        if (sv.dailyLeft(`shop:${key}`, max) <= 0) {
            toast(this.body, '今日已领完，明天再来');
            console.log(`[HomePage] 商城：${key} 今日已领满（${max} 次）`);
            return;
        }
        this._shopBusy = true;
        const meta = TOOL_META[key];
        Haptics.light();

        const play = (): Promise<AdOutcome> => {
            if (AdService.instance.modeOf('tool') === 'real') return AdService.instance.play('tool');
            const layer = this._shopLayer;
            if (!layer?.isValid) return Promise.resolve('fail');
            if (layer.getChildByName('ShopAdPanel')?.isValid) return Promise.resolve('fail');
            return new Promise<AdOutcome>((resolve) => {
                openMockAdDialog({
                    parent: layer,
                    name: 'ShopAdPanel',
                    ui: {
                        title: '获取道具', icon: TOOL_ICON[key],
                        sub: `▸ ${meta.name} ×1`, seconds: AD.MOCK_SECONDS,
                    },
                    schedule: (ms, cb) => this.timers.add(ms, cb),
                    onSettle: resolve,
                });
            });
        };

        void play().then((o) => {
            this._shopBusy = false;
            if (!this._shopLayer?.isValid) return;          // 页面已关：什么都不做
            if (o !== 'end') {
                // ★ abort / fail 一律**不发**；`fail` 额外如实提示一次（与主玩页同口径）
                if (o === 'fail') toast(this.body, '广告暂时拉不到，稍后再试');
                console.log(`[HomePage] 商城：广告结局 ${o} ⇒ 不发道具、不扣次数`);
                return;
            }
            // ★ 顺序：拿到 `end` 之后才扣配额（反过来会"扣了次数却没拿到东西"）
            if (!sv.useDaily(`shop:${key}`, max)) { toast(this.body, '今日已领完，明天再来'); return; }
            sv.addTool(key, 1);
            AudioService.playSfx(SFX.toolUse);
            toast(this.body, `${meta.name} ×1 已到账`);
            this.refreshShopRows();
            console.log(`[HomePage] 商城：发放 ${key} ×1 ⇒ 库存 ${sv.count(key)}，今日剩余 ${sv.dailyLeft(`shop:${key}`, max)}`);
        });
    }

    // ========================================================
    //  七日签到（★ 第 57 轮新增 · T11 界面 + T12 逻辑 + T13 入口）
    // ========================================================
    //
    //  ★★【落点 —— 用户 2026-10-07 拍板 = 视觉稿「稿 A」】
    //    「领取」= 一颗 **83×42 的金色胶囊**，骑在**当天格子**的下沿正中：
    //      · 水平：**所在格的水平中线**（第 7 日的宽格也是它自己的中线，不是整排中线）
    //      · 垂直：胶囊**底边越过格底 19 设计 px**（格内 y = −86，胶囊中心离格底 2px）
    //      · 热区：**整格 126×176** 与**胶囊本身**都注册 ⇒ 点格子、点胶囊都能领
    //    为什么不用底部大按钮（稿 B，已弃）：签到页的主信息是"我签了几天"，
    //    格子本身有呼吸金框就已经在说"点我"；再叠一颗大按钮会让这一屏出现
    //    **两个"看起来是主按钮"的东西**（底部本来还有一颗「关闭」）。
    //
    //  ★【三种格态 —— 稿 A/B/C 三张图合起来就是全部状态】
    //    future 未到 ：整格 52% 透明 + 暗白描边 + 灰绿文字        —— **不可点**
    //    done   已领 ：青玉底 + 压暗 + 右下角青玉勾（32，半出格沿） —— **不可点**
    //    today  当天 ：暖金呼吸（1.8s 循环）+ 金框 + **骑边领取胶囊** —— **唯一可点**
    //    ⚠️ **今天领完之后，当天格子直接翻成 done、胶囊消失**，界面上**不再有可点目标**。
    //       稿 A 家族**没有**稿 C 那颗"今日已签到 · 明天再来"大按钮（那是稿 B 家族的件）。
    //       所以领取的即时反馈靠三样：格子"叮"一下（缩放到 1.12 再回弹）+ 音效 + toast。
    //
    //  ★【口径真源】奖励表 = `CFG.SIGN.DAYS`；日期 / 连签判定 = `SaveService.signDayToday()`
    //    等四个方法。本文件**不自己算日期**，一律问 `SaveService`。

    private _signLayer: Node | null = null;
    private _signCells: SignCellRef[] = [];
    /** 第 7 日「四选一」二级弹层（同一时间最多一层） */
    private _signPick: Node | null = null;
    /** 二级遮罩（**必须单独留引用**：它和一级遮罩同名，按名字找会拿错） */
    private _signPickDim: Node | null = null;
    /** 领取流程进行中（含等选择器）—— 挡住"胶囊与格子都收到同一次触摸"造成的重复领取 */
    private _signBusy = false;

    /** 首页功能键上的「今日可领」红点（T13b）：`signin` / `shop` 各一颗 */
    private _fnDots: Record<string, Node> = {};

    /** 签到卡的根节点（重建副标题行时要往它身上挂节点） */
    private _signCard: Node | null = null;
    /** 副标题行的两个节点（文字 + 胶囊）—— 值变了就整行重建，所以留着引用好销毁 */
    private _signSubNodes: Node[] = [];
    /** 上一次重建副标题行时用的连签数（`null` = 还没建过） */
    private _signSubStreak: number | null = null;

    private openSignIn(): void {
        if (this._signLayer?.isValid) return;

        const layer = createNode('SignLayer', this.body, { w: 1, h: 1 });
        this._signLayer = layer;
        layer.addComponent(UIOpacity).opacity = 0;
        createScrim(layer, 190, () => this.closeSignIn());

        // ⚠️ 弹层**不接 `fitY`** —— 它是浮在全屏之上的模态，居中于**可视区**才是对的；
        //    `fitY` 那套是给"随首页内容一起纵向重映射"的元素的（见 CFG.FIT 注释）。
        //    道具商城 / 排行榜 / 设置抽屉三处也是这么办的，口径一致。
        const card = createNode('SignCard', layer, { w: SIGN_CARD_W, h: SIGN_CARD_H });
        this._signCard = card;
        const half = SIGN_CARD_H / 2;
        const { g } = createGraphicsNode('Bg', card, { w: SIGN_CARD_W, h: SIGN_CARD_H });
        strokeRoundRect(g, 0, 0, SIGN_CARD_W + 6, SIGN_CARD_H + 6, 39, '#0A3327', 3, 255);
        fillVGradient(g, 0, 0, SIGN_CARD_W, SIGN_CARD_H, 36, '#1B6047', '#123F30', 36);
        strokeRoundRect(g, 0, 0, SIGN_CARD_W, SIGN_CARD_H, 36, COLOR.GOLD, 5, 255);

        createLabel(card, '七日签到', {
            fontSize: SIGN_TITLE_FS, bold: true, serif: true, color: COLOR.CREAM,
            w: SIGN_CARD_W, h: SIGN_TITLE_H, y: half - SIGN_TITLE_DROP,
            outline: '#4A2B18', outlineWidth: 3,
        });

        // ---- 副标题 + 「已连签 n 天」胶囊：**同一行整体居中** ----
        //  图标稿里那一行是"文字 + 行内胶囊"一起居中的，所以文字**不在卡的横向中线上**，
        //  而是被胶囊往左顶了半颗胶囊宽 —— 手写死坐标会错，这里按文字实际估宽算。
        this.buildSignSubRow(card);

        // ---- 七格日历（4 + 3 两行）----
        const gridCy = half - (SIGN_TOP_PAD + SIGN_SUB_GAP_TOP + SIGN_SUB_H + SIGN_SUB_GAP_BOTTOM + SIGN_GRID_H / 2);
        const grid = createNode('SignCells', card, { w: SIGN_GRID_W, h: SIGN_GRID_H, y: gridCy });

        this._signCells = [];
        for (let day = 1; day <= SIGN.CYCLE; day++) {
            const wide = day === SIGN.CYCLE;
            const w = wide ? SIGN_WIDE_W : SIGN_CELL_W;
            const col = (day - 1) % 4;
            const row = Math.floor((day - 1) / 4);
            const cell = createNode(`SignCell_${day}`, grid, {
                w, h: SIGN_CELL_H,
                x: wide ? signWideX() : signColX(col),
                y: signRowY(row),
            });
            const op = cell.addComponent(UIOpacity);
            const ref: SignCellRef = {
                day, node: cell, face: null as unknown as Graphics,
                glow: null, glowOp: null, tick: null, claim: null,
                dayLabel: null as unknown as Label, nameLabel: null as unknown as Label, op,
            };

            // ① 呼吸光（**必须先建**：同父同层里"先建的排在下面"，这样它才在格子脸的背后）
            const glow = createNode(`SignGlow_${day}`, cell, { w, h: SIGN_CELL_H });
            paintSignGlow(glow.addComponent(Graphics), w, SIGN_CELL_H);
            glow.addComponent(UIOpacity).opacity = 150;
            ref.glow = glow;
            ref.glowOp = glow.getComponent(UIOpacity)!;

            // ② 格子脸
            const { g: face } = createGraphicsNode('Face', cell, { w, h: SIGN_CELL_H });
            ref.face = face;

            // ③ 第 N 天 / 图标 / 名称
            //  ⚠️ 两个 Label 都要**改名**（`createLabel` 默认一律叫 `Label`）：
            //     `__g5t.find()` 只给"深度优先第一个同名"，七格里全是 `Label` 时
            //     想读"第 3 格那行字"读到的永远是第 1 格 —— 断言会假红且归因错。
            ref.dayLabel = createLabel(cell, `第 ${day} 天`, {
                fontSize: SIGN_DAY_FS, color: COLOR.CREAM_DIM, w: w + 40, h: SIGN_DAY_H, y: SIGN_DAY_Y,
            });
            ref.dayLabel.node.name = `SignDay_${day}`;
            this.buildSignCellIcon(cell, day);
            ref.nameLabel = createLabel(cell, signRewardText(day), {
                fontSize: wide ? SIGN_NAME_FS_WIDE : SIGN_NAME_FS, color: COLOR.CREAM,
                w: w + 60, h: SIGN_NAME_H, y: SIGN_NAME_Y,
            });
            ref.nameLabel.node.name = `SignName_${day}`;

            // ④ 青玉勾（已领才有；32 直径，圆心落在格子右下角 ⇒ 半内半外）
            const tick = createNode(`SignTick_${day}`, cell, { w: 32, h: 32, x: SIGN_TICK_X, y: SIGN_TICK_Y });
            paintSignTickFace(tick.addComponent(Graphics));
            const { g: mark } = createGraphicsNode('Mark', tick, { w: 19, h: 19 });
            paintSignTickMark(mark);
            ref.tick = tick;

            // ⑤ 「领取」胶囊（当天才有；热区**单独注册**，否则越出格子的那 19px 点不动）
            //  ⚠️ 只有一颗会同时可见（当天那格），所以它不需要带天数后缀的名字。
            const claim = createNode('SignClaim', cell, { w: SIGN_CLAIM_W, h: SIGN_CLAIM_H, y: SIGN_CLAIM_Y });
            paintSignClaim(claim.addComponent(Graphics));
            createLabel(claim, '领取', {
                fontSize: 21, bold: true, color: '#5C3610', w: SIGN_CLAIM_W, h: SIGN_CLAIM_H,
            });
            ref.claim = claim;

            // ⚠️ 整格 + 胶囊都注册，两颗都调**同一个** `claimSignToday`。
            //    胶囊是格子的子节点，事件会**冒泡** ⇒ 一次点击会走到两遍；
            //    靠 `claimSignToday` 里的 `_signBusy` + `signDayToday()` 双闸挡掉第二遍。
            this.tapable(cell, () => this.claimSignToday(day), true);
            this.tapable(claim, () => this.claimSignToday(day));

            this._signCells.push(ref);
        }

        // ---- 关闭 ----
        const close = createNode('SignClose', card, {
            w: SIGN_CLOSE_W, h: SIGN_CLOSE_H,
            y: -half + SIGN_BOTTOM_PAD + SIGN_CLOSE_H / 2,
        });
        const { g: cg2 } = createGraphicsNode('Face', close, { w: SIGN_CLOSE_W, h: SIGN_CLOSE_H });
        fillRoundRect(cg2, 0, 0, SIGN_CLOSE_W, SIGN_CLOSE_H, SIGN_CLOSE_H / 2, 'rgba(0,0,0,0.18)', 255);
        strokeRoundRect(cg2, 0, 0, SIGN_CLOSE_W, SIGN_CLOSE_H, SIGN_CLOSE_H / 2, 'rgba(255,247,230,0.55)', 3, 255);
        createLabel(close, '关闭', { fontSize: 28, bold: true, color: COLOR.CREAM, w: SIGN_CLOSE_W, h: 40 });
        this.tapable(close, () => this.closeSignIn());

        this.refreshSignCells();
        MotionFx.fadeTo(layer.getComponent(UIOpacity)!, 255, 0.22);
        console.log(`[HomePage] 七日签到已打开（今天该领第 ${SaveService.instance.signDayToday()} 格 · 已领 ${SaveService.instance.signClaimed()} 格 · 累计连签 ${SaveService.instance.signTotalLive()} 天）`);
    }

    /**
     * 建（或按需重建）副标题那一行：`连续签到 7 天，天天有道具` + 「已连签 n 天」胶囊。
     *
     * ── 为什么是"重建"而不是"改一下 Label 的字"────────────────
     *  ① 这一行是**整体居中**的：文字被胶囊往左顶半颗胶囊宽。
     *     胶囊宽随数字变化（"已连签 9 天" ≠ "已连签 10 天"）⇒ 只改字会让整行偏移。
     *  ② 从未签过时 `signTotalLive()` = 0 ⇒ **整颗胶囊不画**
     *     （显示"已连签 0 天"像在说"你什么都没做到"）。所以还要处理"从无到有"。
     *  整行只有两个节点，拆了重画最省事也最不容易错。
     *
     * ⚠️ **必须在 `refreshSignCells()` 里调**：领完当天连签数会变（0→1 或 2→3），
     *   不重建的话那颗胶囊会**停在旧数字上**（第 57 轮验收现场发现）。
     *   用 `_signSubStreak` 挡住"值没变就别重画"，免得每帧白折腾。
     */
    private buildSignSubRow(card: Node): void {
        if (!card.isValid) return;
        // ★ 第 57 轮三：这里读的是**累计连签天数**（`signTotalLive()`），不是本轮的 `signStreak`。
        //   满 7 天后本轮回到第 1 格，但"已连签 n 天"应当继续往上走（用户拍板方案 B）。
        const streak = SaveService.instance.signTotalLive();
        if (this._signSubStreak === streak && this._signSubNodes.every((n) => n.isValid)) return;
        this._signSubStreak = streak;
        for (const n of this._signSubNodes) if (n.isValid) n.destroy();
        this._signSubNodes = [];

        const subCy = SIGN_CARD_H / 2 - SIGN_TOP_PAD - SIGN_SUB_GAP_TOP - SIGN_SUB_H / 2;
        const tw = estTextWidth(SIGN_SUB_TEXT, SIGN_SUB_FS);
        const chipText = `已连签 ${streak} 天`;
        const chipW = estTextWidth(chipText, SIGN_CHIP_FS) + SIGN_CHIP_PAD_X * 2;
        const lineW = streak > 0 ? tw + SIGN_CHIP_GAP + chipW : tw;
        const lineL = -lineW / 2;

        const sub = createLabel(card, SIGN_SUB_TEXT, {
            fontSize: SIGN_SUB_FS, color: COLOR.CREAM_DIM,
            w: tw + 6, h: SIGN_SUB_H, x: lineL + tw / 2, y: subCy,
        });
        sub.node.name = 'SignSub';
        // 插回"标题之下、日历之上"的固定层位：重建出来的节点默认会被追加到最末，
        // 虽然这一行与日历不重叠（视觉上无所谓），但层位漂移以后很难查。
        sub.node.setSiblingIndex(2);
        this._signSubNodes.push(sub.node);

        if (streak > 0) {
            const chip = createNode('SignStreak', card, { w: chipW, h: SIGN_CHIP_H, x: lineL + tw + SIGN_CHIP_GAP + chipW / 2, y: subCy });
            const { g: cg } = createGraphicsNode('Face', chip, { w: chipW, h: SIGN_CHIP_H });
            fillRoundRect(cg, 0, 0, chipW, SIGN_CHIP_H, SIGN_CHIP_H / 2, COLOR.GOLD, 33);        // rgba(246,196,69,.13)
            strokeRoundRect(cg, 0, 0, chipW, SIGN_CHIP_H, SIGN_CHIP_H / 2, COLOR.GOLD, 2, 128);  // rgba(246,196,69,.5)
            const lab = createLabel(chip, chipText, {
                fontSize: SIGN_CHIP_FS, bold: true, color: COLOR.GOLD_HI, w: chipW, h: SIGN_CHIP_H,
            });
            chip.setSiblingIndex(3);
            void lab;
            this._signSubNodes.push(chip);
        }
    }

    /** 按 `SaveService` 的当前状态，把七格刷成 done / today / future */
    private refreshSignCells(): void {
        const sv = SaveService.instance;
        // ★ 先刷副标题行：领完当天「已连签 n 天」要跟着变（见 `buildSignSubRow` 注释）
        this.buildSignSubRow(this._signCard!);
        const today = sv.signDayToday();
        const claimed = sv.signClaimed();
        for (const c of this._signCells) {
            const st: SignCellState = c.day === today ? 'today' : (c.day <= claimed ? 'done' : 'future');
            paintSignCell(c.face, c.node.getComponent(UITransform)!.width, SIGN_CELL_H, st);
            c.op.opacity = st === 'future' ? SIGN_FUTURE_OPACITY : 255;
            if (c.glow) c.glow.active = st === 'today';
            if (c.tick) c.tick.active = st === 'done';
            if (c.claim) c.claim.active = st === 'today';

            const wide = c.day === SIGN.CYCLE;
            if (st === 'today') {
                c.dayLabel.color = hex2color(COLOR.GOLD_HI);
                c.dayLabel.isBold = true;
                c.nameLabel.color = hex2color(COLOR.CREAM);
                c.nameLabel.isBold = true;
            } else if (st === 'done') {
                c.dayLabel.color = hex2color(COLOR.CREAM_DIM);
                c.dayLabel.isBold = false;
                c.nameLabel.color = hex2color('#8FC0A6');
                c.nameLabel.isBold = false;
            } else {
                c.dayLabel.color = hex2color(COLOR.CREAM_DIM);
                c.dayLabel.isBold = false;
                c.nameLabel.color = hex2color('#A8BCAF');
                c.nameLabel.isBold = false;
            }
            void wide;

            // 呼吸：只有当天那格转，1.8s 一循环（0.9 亮 + 0.9 暗 = 稿上的 1.8s）
            if (c.glowOp) {
                Tween.stopAllByTarget(c.glowOp);
                if (st === 'today') {
                    c.glowOp.opacity = 150;
                    tween(c.glowOp)
                        .to(0.9, { opacity: 255 }, { easing: 'sineInOut' })
                        .to(0.9, { opacity: 150 }, { easing: 'sineInOut' })
                        .union().repeatForever().start();
                }
            }
        }
    }

    /** 建一格里的图标：第 7 日 = 签到图标；其余按 `CFG.SIGN.DAYS` 单件 / 双件 */
    private buildSignCellIcon(cell: Node, day: number): void {
        const r = SIGN.DAYS[day - 1];
        if (r.pick) {
            createSprite(cell, 'Icon', { path: 'home/icon_signin', aspectW: SIGN_IC_SINGLE, y: SIGN_IC_Y });
            return;
        }
        if (r.items.length === 1) {
            createSprite(cell, 'Icon', { path: TOOL_ICON[r.items[0].tool], aspectW: SIGN_IC_SINGLE, y: SIGN_IC_Y });
            return;
        }
        // 两样各 1 个：并排（稿：各 46、间隙 4）
        const step = SIGN_IC_DUO + SIGN_IC_DUO_GAP;
        r.items.forEach((it, i) => {
            createSprite(cell, `Icon${i}`, {
                path: TOOL_ICON[it.tool], aspectW: SIGN_IC_DUO,
                x: -step / 2 + i * step, y: SIGN_IC_Y,
            });
        });
    }

    private closeSignIn(): void {
        const l = this._signLayer;
        this._signLayer = null;
        // ⚠️ 先把呼吸 tween 停掉：节点销毁后 tween 仍会跑一帧，
        //    在某些机型上会抛出"组件已失效"的告警（不是崩溃，但会污染错误日志）。
        for (const c of this._signCells) if (c.glowOp) Tween.stopAllByTarget(c.glowOp);
        this._signCells = [];
        this._signPick = null;
        this._signPickDim = null;
        this._signCard = null;
        this._signSubNodes = [];
        this._signSubStreak = null;
        this._signBusy = false;
        if (!l?.isValid) return;
        const op = l.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.2);
        this.timers.add(240, () => { if (l.isValid) l.destroy(); });
        this.refreshFnDots();
    }

    /**
     * ★ 领当天那一格（稿 A 的落点行为）。
     *
     * 顺序：**先推进签到 + 拿到"第几天" → 再发货**。
     *  第 7 日要先弹四选一选择器，玩家**选定之后**才落账；取消 ⇒ 这一次不领
     *  （签到进度也**不推进** —— 否则会出现"领了但没拿到东西"）。
     */
    private claimSignToday(day: number): void {
        if (this._signBusy) return;
        const sv = SaveService.instance;
        if (sv.signDayToday() !== day) return;      // 只有"当天"那格可领（冒泡来的第二遍走这里）
        this._signBusy = true;
        Haptics.light();

        const r = SIGN.DAYS[day - 1];
        if (r.pick) {
            this.openSignPicker();
            return;
        }
        this.grantSignDay(day, r.items.map((it) => ({ tool: it.tool, n: it.n })));
    }

    /** 真正落账：推进签到 + 发货 + 反馈（第 7 日选定后也走这里） */
    private grantSignDay(day: number, items: { tool: ToolKey; n: number }[]): void {
        const sv = SaveService.instance;
        const got = sv.claimSign();                 // ⚠️ 它自带"今天已领 ⇒ 返回 0 且不改状态"的保护
        if (got === 0) { this._signBusy = false; return; }
        for (const it of items) sv.addTool(it.tool, it.n);
        AudioService.playSfx(SFX.toolUse);
        const txt = items.map((it) => `${TOOL_META[it.tool].name} ×${it.n}`).join(' + ');
        toast(this.body, `签到第 ${got} 天 · ${txt} 已到账`);

        // 反馈：当天那格"叮"一下（稿 A 没有底部大按钮，缩放回弹就是唯一的落账反馈）
        const cell = this._signCells.find((c) => c.day === day)?.node;
        if (cell?.isValid) {
            tween(cell)
                .to(0.09, { scale: v3(1.12, 1.12, 1) })
                .to(0.20, { scale: v3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        }
        this.refreshSignCells();
        this.refreshFnDots();
        this._signBusy = false;
        console.log(`[HomePage] 签到：第 ${day} 天已领 ⇒ 发放 ${txt}`);
    }

    /** 第 7 日大奖：四选一（二级弹层）。选定 ⇒ `grantSignDay`；取消 ⇒ 这一次不领 */
    private openSignPicker(): void {
        const layer = this._signLayer;
        if (!layer?.isValid || this._signPick?.isValid) return;

        const pick = createNode('SignPicker', layer, { w: SIGN_PICK_W, h: SIGN_PICK_CARD_H_TOTAL, y: -61 });
        this._signPick = pick;
        pick.addComponent(UIOpacity).opacity = 0;

        // 二级遮罩：比一级更深（.86），否则底下的「七日签到」标题会透上来和本层标题叠字
        //
        // ⚠️ 两个坑：
        //   ① `createScrim` 建出来的节点**也叫 `Scrim`**，且一级遮罩先建 ⇒
        //      `getChildByName('Scrim')` 拿到的是**一级**那颗 —— 关选择器时会顺手把
        //      一级遮罩销毁掉（表现为"取消之后整个弹层变透明，还能点到首页"）。
        //      所以必须**用返回值**，不能靠名字找。
        //   ② 遮罩是**后建**的，默认会盖在 `SignPicker` 上面 ⇒ 整张选择器卡变灰、点不动。
        //      要把它插到"弹层之下、卡之上"（= 倒数第二）。
        const dim = createScrim(layer, 219, () => this.closeSignPicker());
        this._signPickDim = dim;
        dim.setSiblingIndex(layer.children.length - 2);

        const half = SIGN_PICK_CARD_H_TOTAL / 2;
        const { g } = createGraphicsNode('Bg', pick, { w: SIGN_PICK_W, h: SIGN_PICK_CARD_H_TOTAL });
        strokeRoundRect(g, 0, 0, SIGN_PICK_W + 6, SIGN_PICK_CARD_H_TOTAL + 6, 39, '#0A3327', 3, 255);
        fillVGradient(g, 0, 0, SIGN_PICK_W, SIGN_PICK_CARD_H_TOTAL, 36, '#1B6047', '#123F30', 32);
        strokeRoundRect(g, 0, 0, SIGN_PICK_W, SIGN_PICK_CARD_H_TOTAL, 36, COLOR.GOLD, 5, 255);

        createLabel(pick, '选择奖励', {
            fontSize: SIGN_PICK_TITLE_FS, bold: true, serif: true, color: COLOR.CREAM,
            w: SIGN_PICK_W, h: 90, y: half - 2, outline: '#4A2B18', outlineWidth: 3,
        });
        const subY = half - SIGN_PICK_TOP_PAD - SIGN_PICK_SUB_GAP_TOP - SIGN_PICK_SUB_H / 2;
        createLabel(pick, `第 7 天大奖 · 任选 1 种，直接拿 ${SIGN.PICK_N} 个`, {
            fontSize: 24, color: COLOR.CREAM_DIM, w: SIGN_PICK_GRID_W + 20, h: SIGN_PICK_SUB_H, y: subY,
        });

        const gridCy = half - (SIGN_PICK_TOP_PAD + SIGN_PICK_SUB_GAP_TOP + SIGN_PICK_SUB_H
            + SIGN_PICK_SUB_GAP_BOTTOM + (SIGN_PICK_CARD_H * 2 + SIGN_PICK_GAP) / 2);
        const grid = createNode('SignPickGrid', pick, {
            w: SIGN_PICK_GRID_W, h: SIGN_PICK_CARD_H * 2 + SIGN_PICK_GAP, y: gridCy,
        });

        TOOL_ORDER.forEach((key, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const c = createNode(`SignPickCard_${key}`, grid, {
                w: SIGN_PICK_CARD_W, h: SIGN_PICK_CARD_H,
                // ⚠️ 横向**左对齐**、不居中：稿里 `.grid4` 是 `flex + wrap`，
                //    两列 224+16+224 = 464 < 内容宽 482 ⇒ 右边富余 18px 全留在右侧。
                x: -SIGN_PICK_GRID_W / 2 + SIGN_PICK_CARD_W / 2 + col * (SIGN_PICK_CARD_W + SIGN_PICK_GAP),
                y: ((SIGN_PICK_CARD_H + SIGN_PICK_GAP) / 2) * (1 - 2 * row),
            });
            const { g: cg } = createGraphicsNode('Face', c, { w: SIGN_PICK_CARD_W, h: SIGN_PICK_CARD_H });
            fillVGradient(cg, 0, 0, SIGN_PICK_CARD_W, SIGN_PICK_CARD_H, SIGN_PICK_CARD_R, '#1E6049', '#144534', 20);
            strokeRoundRect(cg, 0, 0, SIGN_PICK_CARD_W, SIGN_PICK_CARD_H, SIGN_PICK_CARD_R, '#FFFFFF', 3, 71);

            createSprite(c, 'Icon', { path: TOOL_ICON[key], aspectW: SIGN_PICK_ICON, y: SIGN_PICK_CARD_H / 2 - 22 - SIGN_PICK_ICON / 2 });
            createLabel(c, TOOL_META[key].name, {
                fontSize: SIGN_PICK_NAME_FS, bold: true, color: COLOR.CREAM,
                w: SIGN_PICK_CARD_W, h: 36, y: SIGN_PICK_CARD_H / 2 - 22 - SIGN_PICK_ICON - 10 - 18,
            });
            // 右上角「×2」金标
            const badgeW = 62, badgeH = 34;
            const badge = createNode('Times', c, { w: badgeW, h: badgeH, x: SIGN_PICK_CARD_W / 2 - 12 - badgeW / 2, y: SIGN_PICK_CARD_H / 2 - 12 - badgeH / 2 });
            const { g: bg2 } = createGraphicsNode('Face', badge, { w: badgeW, h: badgeH });
            fillVGradient(bg2, 0, 0, badgeW, badgeH, badgeH / 2, COLOR.GOLD_HI, '#E8A92E', 12);
            createLabel(badge, `×${SIGN.PICK_N}`, { fontSize: 20, bold: true, color: '#5C3610', w: badgeW, h: badgeH });

            this.tapable(c, () => this.chooseSignReward(key));
        });

        const closeW = SIGN_PICK_GRID_W - SIGN_CLOSE_INSET * 2;
        const close = createNode('SignPickCancel', pick, {
            w: closeW, h: SIGN_CLOSE_H, y: -half + 34 + SIGN_CLOSE_H / 2,
        });
        const { g: cg } = createGraphicsNode('Face', close, { w: closeW, h: SIGN_CLOSE_H });
        fillRoundRect(cg, 0, 0, closeW, SIGN_CLOSE_H, SIGN_CLOSE_H / 2, 'rgba(0,0,0,0.18)', 255);
        strokeRoundRect(cg, 0, 0, closeW, SIGN_CLOSE_H, SIGN_CLOSE_H / 2, 'rgba(255,247,230,0.55)', 3, 255);
        createLabel(close, '取消', { fontSize: 28, bold: true, color: COLOR.CREAM, w: closeW, h: 40 });
        this.tapable(close, () => this.closeSignPicker());

        MotionFx.fadeTo(pick.getComponent(UIOpacity)!, 255, 0.18);
        console.log('[HomePage] 第 7 日大奖：已弹出「四选一」选择器');
    }

    private closeSignPicker(): void {
        const p = this._signPick;
        const dim = this._signPickDim;
        this._signPick = null;
        this._signPickDim = null;
        this._signBusy = false;      // 取消 ⇒ 这一次不领，也**不推进**签到进度
        if (dim?.isValid) dim.destroy();
        if (!p?.isValid) return;
        const op = p.getComponent(UIOpacity)!;
        MotionFx.fadeTo(op, 0, 0.16);
        this.timers.add(200, () => { if (p.isValid) p.destroy(); });
    }

    private chooseSignReward(key: ToolKey): void {
        if (!this._signPick?.isValid) return;
        Haptics.light();
        const layer = this._signLayer;
        this.closeSignPicker();
        if (!layer?.isValid) return;
        this._signBusy = true;
        this.grantSignDay(SIGN.CYCLE, [{ tool: key, n: SIGN.PICK_N }]);
    }

    /** 首页两颗入口红点（T13b）：签到 = 今天还没签；商城 = 四件里有任一件还剩次数 */
    private refreshFnDots(): void {
        const sv = SaveService.instance;
        const on: Record<string, boolean> = {
            signin: sv.signDayToday() > 0,
            shop: TOOL_ORDER.some((k) => sv.dailyLeft(`shop:${k}`, AD_QUOTA.SHOP_PER_TOOL_PER_DAY) > 0),
        };
        for (const id of Object.keys(this._fnDots)) {
            const d = this._fnDots[id];
            if (d.isValid) d.active = on[id] === true;
        }
    }

    private openSheet(): void {
        this._sheetOpen = true;
        const scrim = (this._sheet as unknown as { _scrim: Node })._scrim;
        this._sheet.active = true;
        scrim.active = true;
        const op = this._sheet.getComponent(UIOpacity) ?? this._sheet.addComponent(UIOpacity);
        op.opacity = 0;
        const opS = scrim.getComponent(UIOpacity) ?? scrim.addComponent(UIOpacity);
        opS.opacity = 0;
        MotionFx.fadeTo(opS, 255, 0.2);
        MotionFx.fadeTo(op, 255, 0.2, { tag: 'sheet' });
        tween(this._sheet)
            .to(0.28, { position: v3(0, -this.visible().height / 2, 0), scale: v3(1, 1, 1) }, { easing: 'quadOut' })
            .start();
    }

    private closeSheet(): void {
        if (!this._sheet || !this._sheetOpen) return;
        this._sheetOpen = false;
        const sheet = this._sheet;
        const scrim = (sheet as unknown as { _scrim: Node })._scrim;
        const op = sheet.getComponent(UIOpacity)!;
        const opS = scrim.getComponent(UIOpacity) ?? scrim.addComponent(UIOpacity);
        MotionFx.fadeTo(op, 0, 0.2, { tag: 'sheet' });
        MotionFx.fadeTo(opS, 0, 0.2);
        tween(sheet).to(0.24, { position: v3(0, -this.visible().height / 2 - SHEET_H, 0) }, { easing: 'quadIn' }).start();
        // 收口走定时器（不用 tween 回调）
        this.timers.add(300, () => {
            if (sheet.isValid) sheet.active = false;
            if (scrim.isValid) scrim.active = false;
        });
    }

    // ========================================================
    //  工具
    // ========================================================

    /**
     * 给一个节点接"可点"能力。
     *
     * ★ 五要素一次配齐（触摸区 / 视觉 / 文字 / 状态 / 事件）：
     *   ① 触摸区 = 节点的 `UITransform.contentSize`（**必须先有尺寸**，
     *      没设尺寸的节点在部分平台收不到触摸，表现是"东西看得见、点不动"）；
     *   ② 视觉 = 调用方已经画好的图或 Graphics；
     *   ③ 文字 = 调用方自己的 Label 子节点；
     *   ④ 状态 = 按下缩到 0.94（`noPress` 可关）；
     *   ⑤ 事件 = TOUCH_END 触发 + TOUCH_CANCEL 复位（少了 CANCEL 会"手指滑出按钮后按钮卡在按下态"）。
     */
    private tapable(node: Node, onClick: () => void, noPress = false): void {
        if (node.getComponent(UITransform)?.contentSize.width === 0) {
            console.warn(`[HomePage] "${node.name}" 触摸区尺寸为 0，可能点不动`);
        }
        if (noPress) {
            node.on(Node.EventType.TOUCH_END, () => onClick(), node);
            return;
        }
        node.on(Node.EventType.TOUCH_START, () => {
            tween(node).to(0.08, { scale: v3(0.94, 0.94, 1) }).start();
        }, node);
        const release = (): void => {
            tween(node).to(0.16, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        };
        node.on(Node.EventType.TOUCH_END, () => { release(); onClick(); }, node);
        node.on(Node.EventType.TOUCH_CANCEL, release, node);
    }

    private settleIn(node: Node, delay: number): void {
        const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        const baseY = node.position.y;
        op.opacity = 0;
        node.setScale(v3(0.96, 0.96, 1));
        node.setPosition(node.position.x, baseY - 26, 0);
        MotionFx.after(delay * 1000, () => {
            if (!node.isValid) return;
            MotionFx.fadeTo(op, 255, 0.55, { easing: 'quadOut' });
            tween(node)
                .to(0.55, { position: v3(node.position.x, baseY, 0), scale: v3(1, 1, 1) },
                    { easing: 'backOut' })
                .start();
        });
    }

    // ========================================================
    protected onEnter(): void {
        // 金币可能有变化（结算页回来），刷新一次
        if (this._walletLabel?.isValid) this._walletLabel.string = this.coinText();
        // 抽屉收起
        if (this._sheet) this._sheet.setPosition(0, -this.visible().height / 2 - SHEET_H, 0);
        // ★ 第 53 轮：把"历史最高通关关卡"同步到微信云存储（排行榜的数据来源）。
        //   放在这里是因为**结算后必然回到首页**，一次上报覆盖所有通关路径；
        //   而 `RankService` 内部对"同分不重发"有幂等保护，重复进首页不会刷接口。
        RankService.instance.pushScore(SaveService.instance.best);
    }
}
