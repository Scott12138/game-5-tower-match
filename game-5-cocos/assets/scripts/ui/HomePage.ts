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

import { Graphics, Node, UIOpacity, UITransform, _decorator, tween, v3 } from 'cc';

import { ASSET, BTN_PRIMARY, COLOR, DEVICE, FIT, GAME, HOME_FN, PAGE } from '../CFG';
import { PageBase } from './PageBase';
import { MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import { SaveService } from '../core/SaveService';
import {
    createCoverSprite, createGraphicsNode, createLabel, createNode, createScrim, createSprite,
    fillRadialGlowE, fillRays, fillRoundRect, fillSoftBeam, fillVGradient, fitY,
    fromBottom, fromTop, strokeRoundRect, toast,
} from './UIFactory';
import { hex2color } from './Palette';
import { Haptics } from './Haptics';

const { ccclass } = _decorator;

const DW = 750;
/** 内容层整体下移（用户拍板定稿值，改这一个值即可整体升降） */
const YSHIFT = 64;

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
        const lv = SaveService.instance.level;
        createLabel(btn, '开始游戏', {
            fontSize: 36, color: '#FFE9A8', bold: true, w: W, h: 46, y: 14,
        });
        const sub = `继续 · 第 ${lv} 关`;
        const subW = 40 + 12 + 150 + 12 + 40;
        createLabel(btn, sub, {
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
            this.goto(PAGE.START, { level: lv });
        }, true);
        this.settleIn(btn, 0.48);
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
                toast(this.body, `${fn.label} 敬请期待`);
            });
            this.settleIn(item, 0.62);
        });
    }

    // ---- 关卡进度 ----
    private buildProgress(): void {
        const W = 420;
        const grp = createNode('Progress', this.body, { w: W, h: 90, x: ex(165, W), y: ey(1045, 90) });
        const { g } = createGraphicsNode('Line', grp, { w: W, h: 16, y: 34 });

        // 轨道 4px
        fillRoundRect(g, 0, 0, W, 4, 3, 'rgba(255,247,230,0.14)', 255);
        // 填充 10%
        const lv = SaveService.instance.level;
        const frac = Math.max(0.04, Math.min(1, lv / 30));
        fillRoundRect(g, -W / 2 + (W * frac) / 2, 0, W * frac, 4, 3, COLOR.GOLD, 255);
        // 菱形游标
        const dx = -W / 2 + W * frac;
        g.fillColor = hex2color(COLOR.GOLD_HI);
        g.moveTo(dx, 8); g.lineTo(dx + 8, 0); g.lineTo(dx, -8); g.lineTo(dx - 8, 0); g.close(); g.fill();

        createLabel(grp, `第 ${lv} 关 · 共 ${SaveService.instance.maxLevel} 关`, {
            fontSize: 24, color: COLOR.CREAM_DIM, w: W, h: 28, y: -14,
        });
        this.settleIn(grp, 0.74);
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
        const mute = AudioService.muted;
        this.sheetRow(sheet, SHEET_T.row1, ASSET.HOME_MUTE_ON, '音效', !mute, (on) => {
            AudioService.setMuted(!on);
            toast(this.body, on ? '音效已开启' : '音效已关闭');
            return on;
        });
        this.sheetRow(sheet, SHEET_T.row2, ASSET.HOME_ICON_MUSIC, '背景音乐', !mute, (on) => {
            AudioService.setMuted(!on);
            toast(this.body, on ? '音乐已开启' : '音乐已关闭');
            return on;
        });

        // ---- 链接组 ----
        this.sheetLink(sheet, SHEET_T.row3, 'reset', '重置进度', () => {
            SaveService.instance.resetAll();
            toast(this.body, '进度已重置，重开生效');
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

    private openSheet(): void {
        if (!this._sheet || this._sheetOpen) return;
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
    }
}
