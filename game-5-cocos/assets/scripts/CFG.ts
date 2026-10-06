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

// ============================================================
//  三之二、真机基线（第 34 轮实测 · 微信标准竖屏）
// ============================================================
//
//  【为什么必须把这组数写进代码】
//  设计稿是 **750×1334**（比例 0.5622，近似 9:16）；而微信标准真机是
//  **1264×2780**（比例 0.4547，约 9:19.8）。在 `fitWidth` 下引擎把宽度锁到 750，
//  于是可视高度变成 `750 / 0.4547 = 1651.4` 设计 px —— **比设计稿高 317.4px（+23.8%）**。
//  这 317.4px 就是"尺寸和资源图对不上"的结构性来源：
//  所有按 750×1334 打表量出来的纵向坐标，在真机上都整体偏了。
//
//  【换算口诀】物理 px ÷ DPR = 逻辑 pt；逻辑 pt × (750 / 逻辑宽) = 设计 px。
//  实测：1264 ÷ 3 = 421.33pt；421.33 × (750/421.33) = 750 ✓
//
//  ⚠️ 胶囊（微信右上角那两颗）是**系统绘制**的，游戏内容躲不开它的位置，
//     只能在它下方开始排 —— 这就是 `CAPSULE` 这组数的用处。

export const DEVICE = {
    /** 用户真机截图的物理分辨率（iPhone 14 Pro 类 · 微信标准竖屏） */
    PHYS_W: 1264,
    PHYS_H: 2780,
    /** 设备像素比 */
    DPR: 3,
    /** 逻辑屏（pt） */
    LOGIC_W: 421.33,
    LOGIC_H: 926.67,
    /** 物理宽高比（宽/高） */
    RATIO: 1264 / 2780,
    /**
     * `fitWidth` 下真机可视高（设计 px）。
     * ⚠️ 这**不是**设计稿的 1334 —— 别再把两者混用。
     */
    VISIBLE_H: 750 / (1264 / 2780),

    /**
     * 微信胶囊（右上角）实测盒 —— 单位 **设计 px**，原点 = 屏幕左上角。
     * 44pt 物理高度 = 132px ÷ (1264/750) = 78.3 设计 px 宽高比换算后 ≈ 63.8 设计 px。
     */
    CAPSULE: { x0: 532.5, y0: 95.5, x1: 735.2, y1: 159.3 },
    /** 顶带内容离胶囊下沿至少留这么多（呼吸量） */
    CAPSULE_GAP: 24,
    /** 真机底部 Home Indicator 安全区（设计 px） */
    HOME_BAR: 68,
} as const;

/**
 * 安全区顶部内缩（微信胶囊）—— 顶带内容一律从这里往下排。
 *
 * ★ 第 34 轮修正：原文写 `0`，与实际不符（胶囊下沿实测在 159.3 设计 px）。
 *   现在取「胶囊下沿 + 呼吸量」= 183.3。
 */
export const SAFE_TOP = DEVICE.CAPSULE.y1 + DEVICE.CAPSULE_GAP;

/** 安全区底部内缩（Home Indicator） */
export const SAFE_BOTTOM = DEVICE.HOME_BAR;

/**
 * ★★ 页面纵向适配锚点（第 34 轮新增 · 启动页 / 首页专用）
 *
 * 【问题】设计稿 1334 高、真机可视 1651.4 高，多出 317.4px。
 *   旧做法是把内容整体**居中**（`topY()` 就是居中口径）⇒ 上下各白留 158.7px，
 *   观感是"画面浮在中间、上下两条空带"。
 *
 * 【解法】把内容区间 `[top, bottom]`（设计稿坐标）**分段线性重映射**到真机的
 *   `[SAFE_TOP + (top - 内容顶), VISIBLE_H - SAFE_BOTTOM]`：
 *     · 区间**以上**的元素整体平移到胶囊下方；
 *     · 区间**以下**的元素整体平移到 Home Indicator 上方；
 *     · 区间**之内**按比例摊开（多出来的 317.4px 由中段内容吸收）。
 *   在 1:1 的屏幕上该映射退化为恒等，所以同一套代码在任何比例下都成立。
 *
 * 数值来源：`top`/`bottom` = 该页**真实有元素**的最上与最下沿（设计稿坐标，
 * 首页含 `YSHIFT`）。取内容真实边界而不是 0/1334，是为了让"多出来的空间"
 * 落在元素之间的空档里，而不是把内容整体拉散。
 */
export const FIT = {
    /** 启动页：TitleHalo 顶 116 ↔ 健康忠告底 1332 */
    SPLASH: { top: 116, bottom: 1332 },
    /**
     * 首页：内容带顶 110（含 YSHIFT 64）↔ 关卡进度底 1199。
     *
     * ⚠️ 第 35 轮起，**顶部那条「设置 + 金币」横栏不在这个带里** ——
     *    它必须和微信胶囊同一条中线，故改走 `fromTop(胶囊中线)` 绝对定位。
     *    这里的 `top: 110` 现在只是**映射参数**（决定"设计 y110 → 真机 y183.3"），
     *    不代表带顶有元素。改它会让整页 fitY 内容整体平移，非必要别动。
     */
    HOME: { top: 110, bottom: 1199 },
} as const;

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
    /**
     * 终局判定的"静默等待"（ms）—— 牌堆清空后要等消除链跑完才定胜负。
     *
     * 取值必须 **> 飞入(280) + 消除(300)** 里最长的那条尾巴，否则"最后一组
     * 正在消除"仍会被误判成失败（详见 `GamePage.checkBoardEmpty` 的注释：
     * 这个 bug 实测撞到过，满盘清空却弹失败）。
     */
    END_SETTLE_MS: 420,
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

/**
 * 页面转场时长（进入 / 返回互逆，B 案取 240ms easeInOutQuad）。
 *
 * ⚠️ 这个常量**必须声明在 `TRANS` 之前**：`TRANS` 的对象字面量在模块顶层
 *    按顺序求值，若此时 `TRANSITION_MS` 尚未初始化，会踩 `const` 的 TDZ
 *    抛 `ReferenceError: Cannot access 'TRANSITION_MS' before initialization`，
 *    表现是**整个 CFG 模块加载失败 → 全游戏白屏**，且报错位置与被引处隔着几百行。
 */
export const TRANSITION_MS = 240;

/** 页面转场（B 案：240ms easeInOutQuad，进入 / 返回互逆） */
export const TRANS = {
    /** 淡入淡出时长（秒） */
    FADE: TRANSITION_MS / 1000,
    /** 入场起始缩放（从略小推近到 1） */
    ENTER_SCALE_FROM: 0.965,
    /** 转场互斥：转场中忽略新的跳页请求 */
    LOCK: true,
} as const;

// ============================================================
//  十、动效（缓动语义名 + 时长）
// ============================================================
//  ⚠️ 业务代码里**禁止出现 `'quadOut'` 这类字面量** —— 用 MOTION.EASE_* 语义名。
//     理由：字面量说不清"为什么是这条曲线"，换曲线时也无从下手。
//     但注意：Cocos 的 Tween easing 只认字符串，所以语义名本身就是字符串常量。

export const MOTION = {
    /** 入场 / 出现 */
    EASE_ENTER: 'quadOut',
    /** 位移（与入场同族，保证"飞"和"浮现"像同一个世界的东西） */
    EASE_MOVE: 'quadOut',
    /** 弹跳 / 胀开（带过冲 —— "手感"的主要来源） */
    EASE_POP: 'backOut',
    /** 消失（先慢后快） */
    EASE_EXIT: 'quadIn',
    /** 呼吸 / 往复 */
    EASE_IDLE: 'sineInOut',
    /** 拒绝 / 抖动 */
    EASE_REJECT: 'quadIn',
    /** 下落（越落越快 = 重力感） */
    EASE_DROP: 'quadIn',

    // —— 常用时长（秒）——
    T_POP: 0.18,
    /** 牌飞入槽位 */
    T_FLY: 0.26,
    /** 槽内落位与聚拢 */
    T_SLOT: 0.16,
    /** 消除爆开 */
    T_CLEAR: 0.26,
    /** 按压反馈 */
    T_PRESS: 0.06,
    /** 松开回弹 */
    T_RELEASE: 0.14,
    /** 通用入场 */
    T_ENTER: 0.28,
} as const;

// ============================================================
//  十一、皮肤参数（按钮 / 面板 / 描边 —— 全部来自定稿排版稿）
// ============================================================
//  来源：`game-5-主玩页-排版.html` 里 `.pause / .ruleBtn / .item / .slot / .tool` 等规则。

export const SKIN = {
    /** 面板（弹层卡片） */
    PANEL: {
        RADIUS: 40,
        /** 卡片底（墨绿深色，带一丝青） */
        FILL: 'rgba(11,20,15,0.96)',
        /** 卡描边（金 hair） */
        BORDER: 'rgba(246,196,69,0.22)',
        BORDER_W: 2,
        /** 外发光 */
        GLOW: 'rgba(246,196,69,0.10)',
        GLOW_W: 10,
    },
    /** 主按钮（金） */
    BTN_GOLD: {
        TOP: '#FFE08A',
        BOTTOM: '#C8912B',
        DEPTH: '#7A5310',
        TEXT: '#2A1C06',
        BORDER: '#5C3F0C',
    },
    /** 次按钮（青玉） */
    BTN_JADE: {
        TOP: '#55B79A',
        BOTTOM: '#1F6B54',
        DEPTH: '#0C3A2C',
        TEXT: '#FFF7E6',
        BORDER: '#0A3327',
    },
    /** 幽灵按钮（深底 + 金线） */
    BTN_GHOST: {
        TOP: 'rgba(11,20,15,0.9)',
        BOTTOM: 'rgba(6,12,9,0.95)',
        DEPTH: '#04100B',
        TEXT: '#FFF7E6',
        BORDER: 'rgba(246,196,69,0.42)',
    },
    /** 3D 厚度默认值 */
    DEPTH: 10,
    /** 圆角胶囊 */
    R_PILL: 999,
    /** 接地柔影（Cocos 无 box-shadow，用一层低 alpha 大偏移的圆角矩形近似） */
    SHADOW: { DROP: 8, ALPHA: 70, SPREAD: 4 },
    /** 槽位格 */
    SLOT: {
        RADIUS: 16,
        FILL: 'rgba(255,247,230,0.10)',
        LINE: 'rgba(246,196,69,0.26)',
        LINE_W: 2,
    },
    /** 道具格 */
    TOOL: {
        RADIUS: 22,
        FILL: 'rgba(4,20,14,0.62)',
        LINE: 'rgba(246,196,69,0.26)',
        /** 可用态（金线更亮） */
        LINE_ON: 'rgba(246,196,69,0.62)',
    },
} as const;

// ============================================================
//  八、资产路径（相对各 Bundle 根；主包 = assets/resources/）
// ============================================================
//
//  【包体分层】主包只留启动页要用的 `splash/` + `audio/`，其余按"何时用到"外移：
//      `home/`                              → Bundle 'home'
//      `tiles/` `game-start/` `game-play/`  → Bundle 'game'
//  路径字符串一律**相对各自 Bundle 根**，所以下面这些值跟拆包前**一模一样** ——
//  路由由 `UIFactory.bundleNameOf()` 按前缀自动完成，这里不需要标注归属。
//
//  【为什么不用 WebP】微信**真机**不支持 WebP：引擎产物里有
//      `if ('.webp' === d && !hasFeature(WEBP)) continue;`
//  且 `web-adapter.js` 里 "webp" 出现 0 次 → `Feature.WEBP === false`
//  → 整批 `.webp` 被**静默丢弃**（画面只剩矢量图形，控制台不报错）。
//  所以画质路线是「**原始 PNG 无损直出**」，体积靠拆包解决，不靠压图。

/** 自定义 Asset Bundle（构建时配为「小游戏分包」，产物落 build/wechatgame/subpackages/） */
export const BUNDLES = ['home', 'game'] as const;

export const ASSET = {
    /** 牌面 27 张：tiles/<suit>/<suit><点数>.png（ASCII 名，见 TileData.spritePath） */
    TILE_DIR: 'tiles',

    // —— 启动页 ——
    SPLASH_FELT: 'splash/felt',
    SPLASH_LOGO: 'splash/logo',
    SPLASH_MASCOT: 'splash/mascot',
    SPLASH_DICE: 'splash/dice',
    SPLASH_COIN: 'splash/coin',
    SPLASH_BAR_TRACK: 'splash/bar_track',
    SPLASH_BAR_FILL: 'splash/bar_fill',

    // —— 首页 ——
    HOME_SETTING: 'home/setting',
    HOME_COIN: 'home/coin',
    HOME_TITLE: 'home/title',
    HOME_BTN_LEFT: 'home/btn_left',
    HOME_BTN_MID: 'home/btn_mid',
    HOME_BTN_RIGHT: 'home/btn_right',
    HOME_MUTE_ON: 'home/mute_on',
    HOME_MUTE_OFF: 'home/mute_off',
    HOME_ICON_MUSIC: 'home/icon_music',

    // —— 开局页 ——
    /** 麻将桌整图（750×750） */
    TABLE: 'game-start/table',
    /** 骰子六面（1~6） */
    DICE_FACE: (n: number) => `game-start/dice/face_${n}`,

    // —— 主玩页 ——
    /** 完整规则页（整页烘焙成一张图，第 27 轮拍板） */
    RULE_PAGE: 'game-play/rule_page',
} as const;

/** 首页左右功能列（图标路径 + 文案）—— 顺序即上左下左…见 HOME_FN_POS */
export const HOME_FN = [
    { id: 'signin', icon: 'home/icon_signin', label: '七日签到' },
    { id: 'shop', icon: 'home/icon_shop', label: '道具商城' },
    { id: 'rank', icon: 'home/icon_rank', label: '排行榜' },
    { id: 'invite', icon: 'home/icon_invite', label: '好友邀战' },
] as const;

/** 道具图标路径 */
export const TOOL_ICON: Record<ToolKey, string> = {
    [TOOL.ERASE]: 'home/tool_erase',
    [TOOL.MOVE]: 'home/tool_remove',
    [TOOL.SHUFFLE]: 'home/tool_shuffle',
    [TOOL.ADD_SLOT]: 'home/tool_addslot',
};

/**
 * 音效键 → 资源路径（相对 resources/）。
 *
 * ⚠️ **目前只有 `diceRoll` 是真实素材**（第 12~14 轮采集并做过音画对齐）；
 *    其余键是为后续补齐预留的**空位** —— `AudioService` 对加载失败的路径会
 *    记一次日志后静默跳过，所以现在缺素材**不会**导致任何报错或卡顿，
 *    只是那几处暂时没有声音。补齐时只需把文件放进 `assets/resources/audio/`
 *    并把路径写进这里，调用点一行都不用改。
 */
export const SFX = {
    /** 开局掷骰（**已有真实素材**） */
    diceRoll: 'audio/dice_roll',
    /** 点牌飞入槽位 */
    tilePick: 'audio/tile_pick',
    /** 碰 / 吃 成组消除 */
    matchPop: 'audio/match_pop',
    /** 槽位将满告警 */
    slotWarn: 'audio/slot_warn',
    /** 道具使用 */
    toolUse: 'audio/tool_use',
    /** 洗牌 */
    shuffle: 'audio/shuffle',
    /** 复活 */
    revive: 'audio/revive',
    /** 按钮点击 */
    button: 'audio/button',
    /** 通关 */
    win: 'audio/win',
    /** 失败 */
    fail: 'audio/fail',
} as const;

/** 需要预加载的音效（进主玩页前一次性拉进来，避免"第一次点没声"） */
export const SFX_PRELOAD: string[] = [
    SFX.tilePick, SFX.matchPop, SFX.slotWarn, SFX.toolUse, SFX.shuffle, SFX.revive,
];

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
