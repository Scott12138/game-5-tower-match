/**
 * ============================================================
 *  DiceMotion.ts · 开局页掷骰动画的**纯函数运动学**（零引擎依赖）
 * ============================================================
 *
 *  【为什么单独成文件，而不是写在 GameStartPage 里】
 *  这是"**判据与实现同源**"的要求：
 *  验收脚本要断言「全程零穿插 / 最远点 ≤ 81 / 1150ms 之后真的定格」，
 *  如果脚本自己再抄一遍公式去比，那验的是"两份抄写是否一致"，而不是"游戏里是不是这么跑的"。
 *  抽成无依赖模块之后，游戏与脚本 `import` 的是**同一份函数**，断言才作数。
 *  （编译：`tsc assets/scripts/core/DiceMotion.ts --target es2020 --module esnext`）
 *
 *  【真源】`assets/game-start/开局页-定稿.html`（第 10 轮拍板 B「追尾」·第 14 轮定时序）
 *          与 `game-5-开局页-分镜.md` §4.2 / §5 / §6。
 *          下面每个方程都是**逐行照抄**，只做两处坐标口径转换：
 *            · 位置 y 取反（DOM y 向下 → 引擎 y 向上）
 *            · 一切"角度"取反（DOM 的 rotate 正值为顺时针，引擎 angle 正值为逆时针）
 *
 *  【坐标口径】本文件内部一律用 **DOM 桌面坐标系**：
 *      原点 = 骰盘中心（≈ 桌面贴图中心），x 向右、**y 向下**，单位 = 设计 px。
 *      与真源完全同口径 ⇒ 真源「方案 B 关键相位」表里的每个数都能拿来逐值对账。
 * ============================================================
 */

// ============================================================
//  一、相位与参数
// ============================================================

/**
 * 相位时刻（ms）—— 全部相对"入场即 t = 0"。
 *
 * 【零号相位为什么是 70ms 而不是 0】
 * 真机是**电动麻将桌**：按下去那一下先"通电"——盘底金环亮起、盘面微震，
 * 骰子**纹丝不动**。这 70ms 是"手感"的来源，不是可以省掉的等待。
 */
export const TL = {
    /** 驱动反馈期：电已通，此间骰子**绝对静止** */
    HOLD: 70,
    /** 追尾侧碰 */
    IMPACT: 300,
    /** 咬合时长（碰后两骰被"粘"住同步前进一小段 —— 真实电动桌就是这样） */
    LOCK: 60,
    /** 自转归零 —— 必须早于定格：玩家要在停稳之前看清落定点数 */
    SPIN_END: 950,
    /** ★ 位移归零 = **定格**（`smoother` 两端导数为 0，所以这里是真的停住，不是"慢下来"） */
    SETTLE: 1150,
    /** ★ 拉远起点 = 定格时刻（第 40 轮：定稿是 740ms「滑行途中」，用户要求改成「定格之后」） */
    PULL: 1150,
    /** ★ 拉远时长（第 40 轮：定稿 460ms 太快 → 800ms） */
    PULL_MS: 800,
} as const;

/** 动画总时长（ms） */
export const TOTAL_MS = TL.PULL + TL.PULL_MS;               // 1950

/** 相机：压在骰盘上 2.10× → 轻微前推 2.15× → 拉远到 1.00×（露出整张麻将桌） */
export const CAM = { a: 2.10, b: 2.15, end: 1.00 } as const;

/** 骰盘内可用半径（金环内孔实测 ≈84，留安全余量取 81，与真源同值） */
export const R_IN = 81;

/** 贴边半径再内收，给弹跳/挤压留余量 */
export const EDGE_GAP = 3.5;

/** 每转过 90° 换一个面（与自转同源） */
export const FACE_EVERY = 90;

/**
 * 换面循环序 —— 让"转过 90° 的整数倍"落在**物理相邻**的面上。
 * ⚠️ 顺序不能随便改：它是"骰子翻滚看起来对"的全部依据（照抄真源）。
 */
export const ROLL_ORDER = [1, 6, 3, 5, 2, 4] as const;

/** 硬质密胺骰的"垂直伸展"系数（压 15% / 伸 12% —— 看得出撞了一下，但不软塌） */
export const STRETCH = 0.12;

/** 俯视下"离地" = 放大（影子同步收缩） */
export const HOP_SCALE = 0.06;

/** 方案 B · 追尾 的出厂参数（逐值照抄真源 `DEFAULTS.B`） */
export const BP = {
    /** 起始角分离（度） */
    sep0: 150,
    /** 咬合时长（ms） */
    lock: TL.LOCK,
    /** 末态角分离（度） */
    sep1: 122,
    /** 中位角起始（度） */
    mid0: 275,
    /** 中位角扫掠量（度）—— 两骰整体绕盘同向前进的"总行程" */
    midSpan: 480,
    /** 撞点处半径内收（呼吸） */
    dip: 0.09,
    /** 自转总量（度） */
    spinRate: 1400,
    /** 角分离收窄曲线指数 */
    sepPow: 1.5,
    /** 挤压幅度 */
    squashAmp: 0.15,
} as const;

// ============================================================
//  二、骰子尺寸与盘心位置
// ============================================================

/** 骰子**内容**视觉边长（设计值，来自分镜页头「骰子视觉边长 48」） */
export const DIE_VIS = 48;

/**
 * 骰子贴图里**内容占画布**的比例。
 * 实测：384×384 画布里内容 308×308 ⇒ 0.8021（真源台账 `RATIO` 是 0.7996，差 0.3%）。
 */
export const CONTENT_RATIO = 0.8021;

/**
 * ★ 骰子**节点盒**边长 = 内容 ÷ 内容占比。
 *
 * ⚠️ 别把盒子写成 48：`rollR` / `sepDeg` 两条几何约束用的都是**内容**边长 48，
 *    盒子写 48 会让内容只有 38.5 ⇒ 贴边半径算出来偏大 5px ⇒
 *    "两骰刚好贴合、零穿插"这条硬约束就守不住了（会看到两骰叠在一起）。
 */
export const DIE_BOX = DIE_VIS / CONTENT_RATIO;             // ≈ 59.84

/**
 * 骰盘中心相对**桌面贴图中心**的偏移（DOM 桌面坐标系，y 向下）。
 *
 * 来源：`game-5-cocos/tools/r38-measure.py` 量 `game-start/table.jpg`（750×750）上
 * 那圈錾刻金环的质心 = (372.6, 375.7)，贴图中心 (375, 375) ⇒ 偏移 (−2.4, +0.7)。
 * ⚠️ 换桌面贴图必须重跑那个脚本并同步改这两个数。
 */
export const TRAY_DOM = { dx: -2.4, dy: 0.7 } as const;

// ============================================================
//  三、数学工具（照抄真源）
// ============================================================

export const clampN = (v: number, a: number, b: number): number => (v < a ? a : (v > b ? b : v));
export const smoothN = (p: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clampN(p, 0, 1));
export const easeOutCubicN = (p: number): number => 1 - Math.pow(1 - clampN(p, 0, 1), 3);

/** smootherstep：两端一阶导均为 0 —— 段与段衔接"速度 0 对 0"，这就是"丝滑"的来源 */
export const smootherN = (p: number): number => {
    const q = clampN(p, 0, 1);
    return q * q * q * (q * (q * 6 - 15) + 10);
};

/** 升余弦钟形：在 [at-dur/2, at+dur/2] 内 0 → 1 → 0 */
export const bellN = (t: number, at: number, dur: number): number => {
    const d = (t - at) / (dur / 2);
    return (d < -1 || d > 1) ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.abs(d)));
};

/** 单峰 bump：x = 1 处取 1，x ≤ 0 为 0 */
export const bumpN = (x: number): number => (x <= 0 ? 0 : x * Math.exp(1 - x));

export const tClampN = (t: number, a: number, b: number): number => clampN((t - a) / (b - a), 0, 1);

// ============================================================
//  四、骰子几何：全部由"盘内可用半径"解出来
// ============================================================

/** 正方形骰的**内容**外接圆半径 */
export const rcOf = (vis: number = DIE_VIS): number => vis * 0.70711;

/** 贴边半径（骰子贴金环内侧滚动时，其**中心**离盘心的半径） */
export const rollR = (vis: number = DIE_VIS): number => R_IN - rcOf(vis) - EDGE_GAP;

/** 两骰在半径 r 的圆上「刚好贴合」所需的角分离（度）—— 两心距 = 2r·sin(D/2) = 边长 */
export const sepDeg = (vis: number, r: number): number =>
    2 * Math.asin(clampN(vis / (2 * r), 0, 1)) * 180 / Math.PI;

// ============================================================
//  五、方案 B · 追尾 的运动方程（照抄真源 `makeB`）
// ============================================================

/** 半径：贴金环，撞点处微微内收（"呼吸"） */
export function bRadius(t: number, vis: number = DIE_VIS): number {
    const R0 = rollR(vis);
    if (t <= TL.HOLD) return R0;
    return R0 * (1 - BP.dip * bellN(t, TL.IMPACT, 2 * (TL.IMPACT - TL.HOLD)));
}

/**
 * 贴合角：把**撞点半径**（已经内收过的那个）代回 `sepDeg` 反解。
 *
 * ⚠️ 不能用贴边半径直接算 —— 撞点内收 `dip` 之后，若角分离还按旧半径取，
 *    两心距会小于边长 = **两骰穿插**。这是真源 §7 几何护栏的原话。
 */
export function bSepLock(vis: number = DIE_VIS): number {
    return sepDeg(vis, bRadius(TL.IMPACT, vis));
}

/** 角分离：150° 收窄 → 贴合角 → 咬合 lock ms → 分离到 122° */
export function bSep(t: number, vis: number = DIE_VIS): number {
    const Sc = bSepLock(vis);
    if (t <= TL.HOLD) return BP.sep0;
    if (t <= TL.IMPACT) {
        return BP.sep0 - (BP.sep0 - Sc) * Math.pow(tClampN(t, TL.HOLD, TL.IMPACT), BP.sepPow);
    }
    if (t <= TL.IMPACT + BP.lock) return Sc;                // 咬合期：两骰同步前进
    return Sc + (BP.sep1 - Sc) * smootherN(tClampN(t, TL.IMPACT + BP.lock, TL.SETTLE));
}

/** 中位角：两骰整体绕盘同向前进 */
export function bMid(t: number): number {
    return BP.mid0 + BP.midSpan * smootherN(tClampN(t, TL.HOLD, TL.SETTLE));
}

/** 方位角 = 中位角 ± 角分离/2 */
export function bTheta(t: number, side: 'A' | 'B', vis: number = DIE_VIS): number {
    const M = bMid(t), D = bSep(t, vis);
    return M + (side === 'A' ? -D / 2 : D / 2);
}

/** 自转（度）—— 两骰同向同速（真源里 A/B 共用一个 spin） */
export function bSpin(t: number): number {
    return BP.spinRate * smootherN(tClampN(t, TL.HOLD, TL.SPIN_END));
}

/** 离地量（0~1）：俯视下体现为"放大 + 影子收缩" */
export function bHop(t: number): number {
    const q = t - TL.IMPACT;
    return q < 0 ? 0 : 0.42 * bumpN(q / 130);
}

/** 挤压量（0~1）：撞后 8ms 攻击、110ms 衰减 —— "撞了一下"的全部观感 */
export function bSquash(t: number): number {
    const q = t - TL.IMPACT;
    return q < 0 ? 0 : (1 - Math.exp(-q / 8)) * Math.exp(-q / 110);
}

/** 定格前的点数高光（微放大） */
export function diePop(t: number): number { return 1 + 0.020 * bellN(t, 1000, 230); }

/**
 * 骰子统一缩放：离地放大 × 落定高光。
 * ★ 没有"淡出"项 —— 用户第 40 轮拍板「留在盘里不淡出」，
 *   所以拉远之后骰子仍在金环内，只是随镜头等比缩小（不会再"溜走"）。
 */
export function dieScaleBase(t: number): number { return (1 + HOP_SCALE * bHop(t)) * diePop(t); }

// ============================================================
//  六、相机
// ============================================================

/** 相机缩放：压盘 → 前推 → 拉远；撞点处一记回弹（纯缩放、无位移，8ms 攻击 → 不跳变） */
export function camScaleAt(t: number): number {
    let s: number;
    if (t <= TL.IMPACT) s = CAM.a;
    else if (t <= TL.PULL) s = CAM.a + (CAM.b - CAM.a) * smoothN(tClampN(t, TL.IMPACT, TL.PULL));
    else s = CAM.b + (CAM.end - CAM.b) * easeOutCubicN(tClampN(t, TL.PULL, TOTAL_MS));
    if (t >= TL.IMPACT) {
        const tau = t - TL.IMPACT;
        s -= 0.030 * (1 - Math.exp(-tau / 12)) * Math.exp(-tau / 120);
    }
    return s;
}

/** 拉远段"已完成位移量" 0~1（用于量化任意量与该段的时序关系） */
export const camTravel = (t: number): number => easeOutCubicN(tClampN(t, TL.PULL, TOTAL_MS));

// ============================================================
//  七、两骰的位置 / 相对关系（全部在 DOM 桌面坐标系里）
// ============================================================

/** 某一枚骰子在该时刻的中心（DOM 桌面坐标系） */
export function diePosDom(t: number, side: 'A' | 'B', vis: number = DIE_VIS): { x: number; y: number } {
    const r = bRadius(t, vis);
    const th = bTheta(t, side, vis) * Math.PI / 180;
    return { x: TRAY_DOM.dx + Math.cos(th) * r, y: TRAY_DOM.dy + Math.sin(th) * r };
}

/** 两心连线方向（DOM 度，顺时针为正）—— 挤压轴与脚本断言共用同一个来源 */
export function dieAxisDom(t: number, vis: number = DIE_VIS): number {
    const a = diePosDom(t, 'A', vis), b = diePosDom(t, 'B', vis);
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

/** 碰撞点（两心中点，DOM 桌面坐标系）—— 供碰撞闪光定位 */
export function dieContactDom(t: number, vis: number = DIE_VIS): { x: number; y: number } {
    const a = diePosDom(t, 'A', vis), b = diePosDom(t, 'B', vis);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 中心距 ÷ 边长：**= 1.000 即"刚好贴合"，< 1 就是穿插**（追尾不穿模的唯一硬判据） */
export function contactRatio(t: number, vis: number = DIE_VIS): number {
    const a = diePosDom(t, 'A', vis), b = diePosDom(t, 'B', vis);
    return Math.hypot(b.x - a.x, b.y - a.y) / vis;
}

/**
 * 最靠外那枚骰子的"最远点半径"—— 必须 ≤ `R_IN`，否则会捅出金环。
 *
 * ⚠️ 必须含**挤压的各向异性放大**（`max(sx, sy)`）：挤压是"沿对撞轴压、垂直方向伸"，
 *    贴壁相撞时伸出那一侧才是真正的最远点 —— 漏掉它会低估 1.3px 左右（真源实测过）。
 */
export function farthest(t: number, vis: number = DIE_VIS): number {
    const sq = bSquash(t);
    const aniso = Math.max(1 - BP.squashAmp * sq, 1 + STRETCH * sq);
    return bRadius(t, vis) + rcOf(vis) * dieScaleBase(t) * aniso;
}

// ============================================================
//  八、点数：换面与自转同源
// ============================================================

/** 该时刻的自转走到了第几面（每 90° 一面） */
export const faceIndexAt = (t: number): number => Math.floor(Math.abs(bSpin(t)) / FACE_EVERY);

/**
 * 换面相位偏移 —— 让「自转归零那一刻」的面**恰好等于**本局掷出的点数。
 *
 * 换面规则是 `floor(|自转| / 90)`；自转在 `TL.SPIN_END` 归零后不再变化，
 * 但那个面序号是常数（`floor(1400/90) = 15`）而点数是随机的 ⇒
 * 不补偏移就会出现"骰子明明停在 3 点、赠礼卡却写 5 点"。
 */
export function faceOffsetFor(face: number): number {
    const q = faceIndexAt(TL.SPIN_END);
    const idx = (ROLL_ORDER as readonly number[]).indexOf(face);
    return ((idx - q) % 6 + 6) % 6;
}

/** 某枚骰子在该时刻显示的面 */
export function faceAt(t: number, faceOff: number): number {
    const i = faceIndexAt(t) + faceOff;
    return ROLL_ORDER[((i % 6) + 6) % 6];
}
