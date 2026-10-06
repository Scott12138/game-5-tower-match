/**
 * ============================================================
 *  CFG.ts · 全工程唯一数值来源
 * ============================================================
 *  纪律：**其余文件里不允许出现魔法数字 / 魔法色值**。
 *  要改任何尺寸、颜色、玩法数值，只改这里。
 *
 *  本章来源（全部来自 game-5 定稿文档，不是臆造）：
 *    · 配色 → `game-5-主玩页-排版.html` 的 `:root`（墨绿典藏 v2，第 6 轮拍板后的最终落地口径）
 *    · 几何 → `game-5-主玩页-规格.md` 第二节「页面几何（三带模型）」第 16 轮定稿
 *    · 玩法 → `game-5 · 设计规则.md` G1 / `game-5-核心玩法与素材尺寸契约.md`
 *    · 关卡 → `docs-verify/game-5/game-play/levels.json`（见 core/LevelData.ts）
 * ============================================================
 */

// ============================================================
//  一、游戏信息
// ============================================================

export const GAME = {
    NAME: '叠塔消消',
    VERSION: 'v0.1.0-cocos',
    /** 设计分辨率（@2x 稿 750×1334，逻辑 375×667pt） */
    DESIGN_W: 750,
    DESIGN_H: 1334,
} as const;

// ============================================================
//  二、配色 token（墨绿典藏 v2 —— 定稿排版稿的 :root 逐值照抄）
// ============================================================
//  ⚠️ 这里只放"代码要用的色值"。CSS 里的 --serif / --sans 是本工程字体栈，
//     见 FONT 段；--sc / --scInv 是排版稿的显示缩放，工程里不需要（用真实 px）。

export const COLOR = {
    // —— 浅色文字系（压在深绿桌上的文字）——
    CREAM: '#FFF7E6',
    CREAM_DIM: '#C9D8CC',
    CREAM_MUTE: '#87998C',

    // —— 金 ——
    GOLD: '#F6C445',
    GOLD_HI: '#FFE08A',
    GOLD_DK: '#C8912B',

    // —— 青玉 ——
    JADE: '#2E8B6F',
    JADE_HI: '#55B79A',

    // —— 桌 / 壳 ——
    GREEN: '#20694E',
    GREEN_DK: '#0A3327',
    SHELL_0: '#060806',
    SHELL_1: '#0B100C',
    SHELL_2: '#121A15',

    // —— 牌面 ——
    IVORY: '#FDFAF0',
    EDGE: '#C7B58B',
    BROWN: '#4A2B18',
    RED: '#D8432F',

    // —— 语义色（代码里高频用到的派生）——
    /** 槽位空位底 */
    SLOT_EMPTY: 'rgba(255,247,230,0.10)',
    /** 槽位格描边 */
    SLOT_LINE: 'rgba(246,196,69,0.26)',
    /** 细金线（分隔 / 描边） */
    HAIR: 'rgba(246,196,69,0.16)',
    /** 告警（槽位将满 / 倒计时最后 10 秒） */
    WARN: '#D8432F',
} as const;

/** 字体栈（第 26 轮定稿「方案丙 混排」，工程照抄） */
export const FONT = {
    /** 标题 / 表头 / 碰吃大字 —— 衬线 */
    SERIF: 'Songti SC',
    /** 正文 / 数字 —— 无衬线 */
    SANS: 'PingFang SC',
    /** 字阶（px @750） */
    TITLE: 48,
    SUBTITLE: 32,
    BODY: 28,
    NOTE: 24,
    /** 数字（倒计时 / 计数），等宽感 */
    NUM: 42,
    /** 碰 / 吃 飘字大字 */
    POP: 96,
} as const;

// ============================================================
//  三、坐标工具（沿用 user 惯例：设计稿坐标 → 引擎坐标）
// ============================================================
//  设计稿用 **屏幕坐标**（左上原点、y 向下），引擎用 **中心原点、y 向上**。
//  三个函数是全工程唯一的换算口，别在别处手算。

/** 屏幕左上原点坐标 → 引擎坐标（x） */
export function px(v: number): number {
    return v - GAME.DESIGN_W / 2;
}

/**
 * 屏幕左上原点坐标 → 引擎坐标（y）。
 * `topY(0)` = 屏幕顶边，`topY(GAME.DESIGN_H)` = 屏幕底边。
 */
export function topY(v: number): number {
    return GAME.DESIGN_H / 2 - v;
}

/** 安全区顶部内缩（微信胶囊 / 状态栏）—— 顶带内容一律再下移这么多 */
export const SAFE_TOP = 0;

/** 安全区底部内缩 */
export const SAFE_BOTTOM = 68;

// ============================================================
//  四、页面几何（三带模型 · 第 16 轮定稿）
// ============================================================

export const LAYOUT = {
    /** 顶部 HUD 带（桌外深色）0 – 292 */
    TOP_H: 292,
    /** 麻将桌（正方形）292 – 1042 */
    TABLE_Y: 292,
    TABLE_SIZE: 750,
    /** 桌面内牌堆安全区 626 起算（屏幕坐标 34,326,682,682） */
    SAFE_X: 34,
    SAFE_Y: 326,
    SAFE_W: 682,
    SAFE_H: 682,

    // —— 顶带组件（left / top / 尺寸，屏幕坐标）——
    PAUSE: { left: 40, top: 76, w: 88, h: 88, r: 26 },
    LEVEL_PILL: { left: 150, top: 88, h: 64, r: 999 },
    CAPSULE_AVOID: { right: 30, top: 88, w: 174, h: 64 },
    /** 复活徽标（不入道具栏 · 顶带空档 344–515.5） */
    REVIVE: { left: 344, top: 88, h: 64, r: 18 },
    PROGRESS: { left: 40, top: 206, w: 230, h: 28, r: 14 },
    /** 倒计时：居中 / top 190 / 字号 42 */
    TIMER: { top: 190 },
    RULE_BTN: { right: 40, top: 192, h: 60, r: 30, w: 126 },

    // —— 底带 ——
    /** 槽位条 47 / 1058，656×80；8 格 × 68×80，间距 16 */
    SLOT_BAR: { left: 47, top: 1058, w: 656, h: 80 },
    SLOT_CELL: { w: 68, h: 80, gap: 16 },
    /** 道具栏 87 / 1150，576×112；4 格 × 126×112，间距 24 */
    TOOL_BAR: { left: 87, top: 1150, w: 576, h: 112 },
    TOOL_CELL: { w: 126, h: 112, gap: 24 },
} as const;

// ============================================================
//  五、玩法数值（G1 · 核心玩法）
// ============================================================

export const PLAY = {
    /** 槽位数（加槽道具 → +1，上限 9） */
    SLOT_MAX: 8,
    ADD_SLOT_MAX: 9,
    /** 每关加槽道具可用次数 */
    ADD_SLOT_PER_LEVEL: 1,
    /** 一组几张（碰 / 吃 都是 3） */
    MATCH_SIZE: 3,
    /** 复活：槽内最后 N 张直接消除 */
    REVIVE_CLEAR: 4,
    /** 每关复活机会 */
    REVIVE_PER_LEVEL: 1,
    /** 判"被上层压住"的累计覆盖面积阈值（与 levels.json 的 coverTh 一致） */
    COVER_TH: 0.18,
    /** 最后 N 秒触发告警配色 + 呼吸 */
    WARN_SEC: 10,
    /** 连点保护窗口（ms） */
    INPUT_LOCK_MS: 300,
    /** 前 N 关不限时（定稿：前 2 关教学不限时） */
    FREE_TIME_LEVELS: 2,
} as const;

/**
 * 限时秒数。
 *
 * ⚠️ **待试玩标定** —— 设计规则 G3.1 明确写「具体时长由试玩标定（待可跑产物）」。
 *    现在的口径是一个**可解释的线性公式**，等用户真机试玩后给数即可整体替换，
 *    不必改任何调用点（所有关卡都走这个函数）。
 *
 * 依据：
 *   · game-4 实测锚点 —— 36 张 300s（8.33s/张）、63 张 540s（8.57s/张）、96 张 720s（7.5s/张）；
 *   · 但 game-5 的牌堆**可点牌更多**（v7 把开局可点从 7~10% 抬到 15~18%），
 *     找牌更快，所以"每张秒数"应随张数**递减**；
 *   · 本式取 `3.6 ~ 6.0 s/张` 的线性递减带，前 2 关不限时。
 */
export function timeLimitOf(levelIndex: number, tileCount: number): number {
    if (levelIndex < PLAY.FREE_TIME_LEVELS) return 0;         // 前 2 关不限时
    const perTile = Math.max(3.6, 6.0 - (tileCount - 30) * 0.018);
    return Math.round(tileCount * perTile);
}

// ============================================================
//  六、道具四件套
// ============================================================

export const TOOL = {
    ERASE: 'erase',     // 消除：槽内凑满 3 张直接消
    MOVE: 'move',       // 移出：把槽内最后一张退回牌堆顶
    SHUFFLE: 'shuffle', // 洗牌：重排场上未消牌的位置
    ADD_SLOT: 'addslot',// 加槽：槽位 +1（本关一次）
} as const;

export type ToolKey = typeof TOOL[keyof typeof TOOL];

/** 道具显示顺序（= 底带四格从左到右） */
export const TOOL_ORDER: ToolKey[] = ['erase', 'move', 'shuffle', 'addslot'];

export const TOOL_META: Record<ToolKey, { name: string; desc: string; icon: string }> = {
    erase: { name: '消除', desc: '槽内凑成一组直接消除', icon: 'tool_erase' },
    move: { name: '移出', desc: '把槽里最后一张退回桌上', icon: 'tool_move' },
    shuffle: { name: '洗牌', desc: '重排桌上剩余牌的位置', icon: 'tool_shuffle' },
    addslot: { name: '加槽', desc: '本关槽位 +1', icon: 'tool_addslot' },
};

// ============================================================
//  七、页面名（避免各处写裸字符串）
// ============================================================

export const PAGE = {
    SPLASH: 'splash',
    HOME: 'home',
    START: 'gameStart',
    GAME: 'game',
    RESULT: 'result',
} as const;

export type PageName = typeof PAGE[keyof typeof PAGE];

// ============================================================
//  八、资产路径（相对 assets/resources/）
// ============================================================

export const ASSET = {
    /** 牌面 27 张：tiles/<suit>/<点数><花色>.png */
    TILE_DIR: 'tiles',
    /** 麻将桌整图（750×750） */
    TABLE: 'game-start/table_default',
    /** 骰子六面 */
    DICE_FACE: (n: number) => `game-start/dice/face_${n}`,
    /** 开局页掷骰音效 */
    SFX_DICE: 'audio/dice_roll',
} as const;

/** 花色名（与 LevelData 的 SUIT_BY_CODE 顺序必须一致） */
export const SUITS = ['wan', 'tiao', 'tong'] as const;
export type Suit = typeof SUITS[number];

/** 花色 → 中文（牌面文件名用） */
export const SUIT_CN: Record<Suit, string> = { wan: '万', tiao: '条', tong: '筒' };

/** 点数 → 中文数字（牌面文件名用） */
export const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

// ============================================================
//  九、调试开关
// ============================================================

export const DEBUG = {
    /** 是否打状态日志（**验收脚本全靠它**，release 构建会自动剥掉 cc.log） */
    LOG_STATE: true,
    /** 是否显示引擎性能面板 */
    STATS: false,
    /** 无头冒烟用：把可点牌坐标打进日志，供 `auto:` 动作解析 */
    LOG_PICKABLE: true,
} as const;

/** 页面转场时长（进入 / 返回互逆，B 案取 240ms easeInOutQuad） */
export const TRANSITION_MS = 240;
