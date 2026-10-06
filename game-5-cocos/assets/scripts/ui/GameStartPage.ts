/**
 * ============================================================
 *  GameStartPage.ts · 开局页（③）—— 掷骰开场 + 赠礼落位
 * ============================================================
 *  分镜（第 9~14 轮定稿，总时长 **1.2s**）：
 *      ① 镜头压在骰盘上（2.10×）→ 轻微前推（2.15×）
 *      ② 两枚骰子落入盘中：旋转 + 世界轴挤压回弹 + 接触阴影
 *      ③ 镜头**拉远到 1.0×**，露出整张麻将桌
 *      ④ 和值定格 → 赠礼卡浮现（档位缎带 / 道具图标 / 护栏说明）
 *      ⑤ 「开始挑战」→ 写 RunState → 进主玩页
 *
 *  【为什么镜头要做成"容器缩放 + 位移"】
 *  这样骰子、桌、光效全部是它的子节点，一次变换全体跟随 ——
 *  不需要给每个元素各写一套随镜头变化的公式（那是最容易写歪的做法）。
 *
 *  【音画同步】音效 `audio/dice_roll` 在第 ② 段起点播放，与骰子落盘的撞击帧对齐
 *  （第 14 轮做过音画对齐，这里保持同一体感：**音起 = 骰子开始落**）。
 * ============================================================
 */

import { Node, Sprite, UIOpacity, _decorator, tween, v3 } from 'cc';

import { ASSET, COLOR, DEBUG, PAGE, SFX } from '../CFG';
import {
    BP, DIE_BOX, DIE_VIS, R_IN, STRETCH, TL, TOTAL_MS, TRAY_DOM,
    bHop, bRadius, bSep, bSpin, bSquash, bTheta, bellN, camScaleAt,
    clampN, contactRatio as contactRatioAt, dieAxisDom, dieScaleBase,
    faceAt, faceOffsetFor, farthest as farthestAt,
} from '../core/DiceMotion';
import { PageBase } from './PageBase';
import { Layout } from './Layout';
import { MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import { Haptics } from './Haptics';
import { SaveService } from '../core/SaveService';
import { beginRun, composeGift, TIER_COLOR, TIER_TEXT, type RunGift } from '../core/Gift';
import {
    cachedFrame, createGraphicsNode, createLabel, createNode, createSprite, draw3dFace,
    fillRadialGlow, fillRoundRect, fillVGradient, fromBottom, fromTop, strokeRoundRect,
} from './UIFactory';
import { darkenHex, hex2color } from './Palette';

const { ccclass } = _decorator;

const DW = 750;
const DH = 1334;

/**
 * ★★ 「屏幕设计 px（从顶边往下量）→ 引擎 y」的唯一换算口 —— 第 38 轮改口径的关键一行。
 *
 * 【为什么必须换】本文件原来直接引 `CFG.topY`，而那是**按设计稿 1334 高**写的
 *   （`667 − v`）。真机在 `fitWidth` 下可视高是 **1651.4**，引擎原点落在可视区中心
 *   ⇒ 传进去的每一个 y 在真机上都会**整体下移 (1651.4 − 1334) / 2 = 158.7 设计 px**。
 *   实测证据：赠礼卡按 `CARD_TOP=498` 摆，审计量到的是 **895.7**；四角金饰按"距顶 16"
 *   摆，量到的是 **196.7**（= 16 + 158.7 + 22）。
 *
 * `Layout.topY` 走的是**真机可视高**（`viewport().height / 2 − v`）⇒ "设计 y = v"
 * 就真的落在屏幕 v 处，与主页/启动页同一口径。**本文件所有纵向坐标都走它。**
 */
const topY = Layout.topY;

// ============================================================
//  ★★ 第 40 轮：掷骰动画按「方案 B · 追尾」真源**整体重建**
// ============================================================
//  【旧实现错在哪】它其实只是"两枚骰子从上往下掉"，与定稿的 B 追尾毫无关系：
//    · 没有绕盘、没有角分离收窄、没有追尾侧碰、没有咬合、没有惯性滑行
//      ⇒ 全程**没有"定格"这个时刻**，观感就是"掉下来 → 立刻被镜头甩走"。
//    · 镜头更糟：2.10× 一直压到 880ms 才动，然后用 **280ms / quadInOut** 拉远
//      —— 玩家还没看清点数，骰子已经缩到 6.4% 屏宽的一个点。
//
//  【本轮的解法】运动学**全部搬进 `core/DiceMotion.ts`**（纯函数、零引擎依赖），
//    本文件只负责"把 t 时刻的姿态写进场景树"。这么拆是为了**判据与实现同源**：
//    验收脚本 `tools/r40-motion-check.mjs` import 的是**同一份函数**，
//    而不是自己再抄一遍公式（那样验的只是"两份抄写是否一致"）。
//
//    相对定稿的三处**有意改动**（用户第 40 轮拍板，已在 DiceMotion 里逐条注明）：
//      ① 拉远起点 740ms -> **1150ms（定格那一刻）**
//      ② 拉远时长 460ms -> **800ms**
//      ③ 骰子**不再淡出**，定格后留在金环里随镜头等比缩小
// ============================================================

/**
 * ★★ 骰盘中心相对**桌面中心**的偏移（引擎口径，y 向上）。
 *
 * 数值来源 = `DiceMotion.TRAY_DOM`（桌面贴图上金环质心的实测值），取负即引擎口径
 * ——两份数据同源，不会跑偏。
 * ⚠️ 换桌面贴图必须重跑 `tools/r38-measure.py` 并同步改 `TRAY_DOM`。
 */
const TRAY_OFFSET = { dx: TRAY_DOM.dx, dy: -TRAY_DOM.dy };


/**
 * ★★ 赠礼层几何（设计 px，屏幕顶算）—— 第 38 轮重做。
 *
 * 【旧实现的病灶】卡片高度**写死 470**，而卡内内容一路排到 478（护栏行 400~478）
 *   ⇒ 内容溢出卡底 8；同时「开始挑战」按钮**挂在卡外的 layer 上、y 写死 `topY(975)`**，
 *   与卡高没有任何约束关系。真机审计实测：按钮覆盖 **1079.7~1187.7**、卡底在 **1188.7**
 *   ⇒ **按钮底边离卡底边只剩 1px，并把「护栏说明」整行压住**。
 *   这就是观感上"按钮跟其他元素完全突兀"的全部来源 —— 不是配色问题，是**位置失约束**。
 *
 * 【现行口径】三件事一起改：
 *   ① 卡高 = **由卡内行表 `CARD_ROWS` 推出**（末行底 + `PAD_BOTTOM`），以后加行不会再溢出；
 *   ② 按钮 y = `卡顶 + 卡高 + GAP`，**由卡底派生**，卡高一变它自动跟随；
 *   ③ 「卡 + 间隙 + 按钮」整组以 `GROUP_CY` 为心视觉居中（略高于几何中心 825.7，
 *      视觉重心稍高更稳），并且**光环与卡片同心**。
 *   ④ 按钮尺寸回归设计稿口径 **480×112**（`game-5-主玩页-规格.md` §四），
 *      原来那块 320×108 只有卡宽的 57%，在 560 宽的卡下显得"孤零零一张小牌"。
 */
const GIFT = {
    CARD_W: 560,
    /** 卡底留白 */
    PAD_BOTTOM: 28,
    BTN_W: 480,
    BTN_H: 112,
    /** 卡底 → 按钮顶的间距 */
    BTN_GAP: 34,
    /** 「卡 + 间隙 + 按钮」这一组的视觉中心 */
    GROUP_CY: 810,
} as const;

/**
 * 卡内各行：`top` = 距卡顶、`h` = 行高。
 * ⚠️ **卡高由这张表推出来，不许再在别处写死** —— 否则又会回到"内容溢出卡底"的老路。
 */
const CARD_ROWS = {
    /** 顶缎带（骑缝，一半压在卡顶之上） */
    ribbon: { top: -26, h: 46 },
    /** 两枚骰子 + 「+」 */
    dice: { top: 56, h: 84 },
    /** 「点数合计」小标 */
    sumCap: { top: 162, h: 24 },
    /** 和值大字 */
    sum: { top: 190, h: 76 },
    /** 赠品行（图标 + 名称 + 副文案） */
    gift: { top: 288, h: 68 },
    /** 护栏说明（仅限本局使用） */
    guard: { top: 372, h: 78 },
} as const;

/** 卡内内容总高（= 末行底边） */
const CARD_BODY_H = CARD_ROWS.guard.top + CARD_ROWS.guard.h;              // 450
/** 卡高 */
const CARD_H = CARD_BODY_H + GIFT.PAD_BOTTOM;                            // 478
/** 卡顶（设计 px）—— 由"整组居中"反推 */
const CARD_TOP = GIFT.GROUP_CY - (CARD_H + GIFT.BTN_GAP + GIFT.BTN_H) / 2; // 498
/** 按钮中心（设计 px，屏幕顶算） */
const BTN_CY = CARD_TOP + CARD_H + GIFT.BTN_GAP + GIFT.BTN_H / 2;         // 1066

/** 设计稿 left（左边距）+ 节点宽 → 引擎 x */
function ex(left: number, w: number): number { return left - DW / 2 + w / 2; }

@ccclass('GameStartPage')
export class GameStartPage extends PageBase {

    private _level = 1;
    private _gift: RunGift | null = null;

    private _camera: Node | null = null;
    /** 桌面节点 —— 骰盘与骰子都挂它下面（桌面一动它们自动跟随） */
    private _table: Node | null = null;
    /**
     * 骰盘中心在**相机层**的局部坐标（y 向上）—— **只给镜头聚焦用**
     * （`cam.setPosition(-trayCx * k, -trayCy * k)` 把这一点拉到屏幕中心，
     * 所以它必须是"相机层内部点"，不能是桌面局部坐标）。
     *
     * ⚠️ 与它极易混的是 `TRAY_OFFSET` —— 那是**桌面局部**的环心偏移，骰盘/骰子节点用的
     *   全是它。两者只有在"桌面恰好落在相机层原点"时才相等；第 38 轮改口径后桌面落在
     *   `Layout.topY(667) = 158.7` ⇒ **两者不再相等**，别再混用。
     */
    private _trayCx = 0;
    private _trayCy = 0;
    /** 两枚骰子的全部姿态节点（三层嵌套，见 `createDie` 注释） */
    private _dice: DieRefs[] = [];
    /** 盘底金环的透明度 —— 驱动期点亮 + 碰撞瞬间强闪 */
    private _haloOp: UIOpacity | null = null;

    /** 动画已过毫秒（由 `update` 累加驱动；**纯函数 `render(t)` 口径**，可任意暂停/复现） */
    private _t = 0;
    private _playing = false;
    /**
     * 换面相位偏移 —— 让"自转归零那一刻"的面**恰好等于**本局掷出的点数。
     *
     * 【为什么必须做】换面是 `floor(自转 / 90)`，自转归零在 950ms 而点数是随机的，
     *   两者不天然对齐 ⇒ 若不加偏移，骰子会"看起来停在 3 点、赠礼卡却写 5 点"。
     *   偏移 = `(目标面在 ROLL_ORDER 中的位次 − 归零时的面序号) mod 6`。
     */
    private _faceOff: Record<'A' | 'B', number> = { A: 0, B: 0 };
    /** 当前已贴上的面（避免每帧重复赋 spriteFrame） */
    private _curFace: Record<'A' | 'B', number> = { A: 0, B: 0 };

    /** 落盘后是否已经放过赠礼卡（防重复） */
    private _revealed = false;

    // ========================================================
    protected onBuild(): void {
        this._level = this.param<number>('level', SaveService.instance.level);

        this.buildEnv();
        this.buildCamera();
        this.buildTray();
        this.buildDice();
    }

    // ---- 环境（不随镜头动）----
    private buildEnv(): void {
        const vs = this.visible();
        const { g } = createGraphicsNode('Env', this.body, { w: vs.width, h: vs.height });
        fillVGradient(g, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#0C110D', '#040604', 32);
        fillRadialGlow(g, 0, 0, Math.min(vs.width, vs.height) * 0.42, '#FFF7E6', 16, 14);

        const { g: tg } = createGraphicsNode('EnvTop', this.body, { w: vs.width, h: vs.height });
        fillVGradient(tg, 0, vs.height / 2 - 150, vs.width * 1.4, 300, 0,
            'rgba(255,247,230,0.05)', 'rgba(255,247,230,0)', 12);
        fillVGradient(tg, 0, -vs.height / 2 + 170, vs.width * 1.4, 340, 0,
            'rgba(0,0,0,0)', 'rgba(0,0,0,0.42)', 14);

        // 四角金饰 44×44 —— ★ 第 38 轮改走 `fromTop` / `fromBottom`。
        //  它是**贴屏幕四角**的装饰，与"页面内容的纵向口径"必须解耦；
        //  原来按设计稿 1334 算，真机上跑到距顶 196.7 / 距底 194 —— 四个角全不在角上。
        const S = 44;
        const S_B = S * 0.88;
        const corner = (left: number, y: number, flipX: boolean, flipY: boolean, k: number): void => {
            const s = S * k;
            const { node, g: cg } = createGraphicsNode('Corner', this.body, {
                w: s, h: s, x: ex(left, s), y,
            });
            node.setScale(v3(flipX ? -1 : 1, flipY ? -1 : 1, 1));
            cg.lineWidth = 2; cg.strokeColor = hex2color('#F6C445', 102);
            cg.rect(-s / 2, -s / 2, s, s); cg.stroke();
            cg.lineWidth = 1; cg.strokeColor = hex2color('#F6C445', 51);
            cg.rect(-s / 2 + 7 * k, -s / 2 + 7 * k, s - 14 * k, s - 14 * k); cg.stroke();
            cg.fillColor = hex2color('#F6C445', 200);
            const d = 3 * k;
            cg.moveTo(0, d); cg.lineTo(d, 0); cg.lineTo(0, -d); cg.lineTo(-d, 0); cg.close(); cg.fill();
        };
        corner(16, fromTop(16 + S / 2), false, false, 1);
        corner(DW - 16 - S, fromTop(16 + S / 2), true, false, 1);
        corner(22, fromBottom(16 + S_B / 2), false, true, 0.88);
        corner(DW - 22 - S_B, fromBottom(16 + S_B / 2), true, true, 0.88);
    }

    // ---- 镜头层（桌子 + 骰盘 + 骰子全在里面）----
    private buildCamera(): void {
        this._camera = createNode('Camera', this.body, { w: DW, h: DH });

        // 桌子（750×750）—— ★ 第 38 轮：在**真机可视区里竖向居中**（引擎 y = 0）。
        //  设计稿那句"落点 y = 292"是 **1334 屏**上的数；直接搬到 1651.4 的屏上，
        //  桌子会浮在上半屏、下方空出 609 设计 px（骰盘也跟着偏）。
        //  居中后上下各留 (1651.4 − 750) / 2 = 450.7，与主玩页 `Layout.tableBox()` 同一思路。
        //  ⚠️ 骰盘与骰子都挂它下面，所以它们的坐标是**桌面局部**的（见 TRAY_OFFSET）。
        const table = createNode('TableWrap', this._camera, {
            w: DW, h: 750, x: 0, y: 0,
        });
        createSprite(table, 'Img', { path: ASSET.TABLE, w: DW, h: 750 });
        this._table = table;
    }

    // ---- 骰盘（就落在桌面贴图那圈金环上）----
    private buildTray(): void {
        if (!this._table) return;
        // 相机层坐标 = 桌面在相机层的位置 + 环心偏移（**只给镜头聚焦用**）
        const tp = this._table.position;
        this._trayCx = tp.x + TRAY_OFFSET.dx;
        this._trayCy = tp.y + TRAY_OFFSET.dy;

        // 只留一层很淡的"台面光"托住骰子。
        // ★ 原来这里还有一枚 166 直径的深色圆盘（TrayFloor，半径 83）已经删掉：
        //   而贴图金环的内孔半径实测也是 ~84 —— 它会**把贴图里那圈錾刻金环整圈盖住**，
        //   留下的只有两根细金线，白瞎了素材。现在金环直接充当骰盘。
        // ⚠️ halo 挂在**桌面节点**下，所以用桌面局部的 `TRAY_OFFSET`，不是 `_trayCx/_trayCy`。
        const halo = createNode('TrayHalo', this._table, {
            w: 300, h: 300, x: TRAY_OFFSET.dx, y: TRAY_OFFSET.dy,
        });
        const { g: hg } = createGraphicsNode('G', halo, { w: 300, h: 300 });
        fillRadialGlow(hg, 0, 0, 150, '#FFF4C8', 42, 12);
        halo.setScale(v3(0.9, 0.9, 1));
        // ★ 第 40 轮：把金环的亮度交给时间轴 ——
        //   真源 `el.trayHalo.opacity = 0.20 + 0.55*drive + 0.72*bell(t, 碰撞+4, 300)`
        //   即「通电反馈期慢慢亮起 → 碰撞瞬间一记强闪」，这是"电已通、盘活了"的全部信号。
        //   旧实现把 halo 设成常量亮度，整个驱动期 70ms 是**死寂**的，玩家感觉不到开局。
        this._haloOp = halo.addComponent(UIOpacity);
    }

    // ---- 两枚骰子（各三层姿态节点，见 `createDie`）----
    private buildDice(): void {
        if (!this._table) return;
        // ⚠️ 骰子挂在**桌面节点**下 ⇒ 坐标用桌面局部的 `TRAY_OFFSET`。
        //   初始位置只是占位：`onEnter` 的第一帧 `applyFrame(0)` 会把它按运动方程摆正。
        this._dice = [
            createDie(this._table, 'DieA', 'A', TRAY_OFFSET.dx - 30, TRAY_OFFSET.dy),
            createDie(this._table, 'DieB', 'B', TRAY_OFFSET.dx + 30, TRAY_OFFSET.dy),
        ];
    }

    // ========================================================
    //  掷骰时间轴（纯函数驱动）
    // ========================================================
    //
    //  【为什么用 `update` 逐帧累加，而不是一串 `tween`】
    //  · 三个运动量**互相耦合**：角分离要按"撞点内收后的半径"反解，挤压轴要按
    //    "两骰连线"实时求 —— 拆成彼此独立的 tween 必然对不上，表现就是两骰穿插或错帧。
    //  · `render(t)` 是**纯函数**：同一个 t 永远给出同一帧 ⇒ 可冻帧、可慢放、可脚本断言。
    //    本轮 `tools/r40-scan.mjs` 就是靠它扫全程验「零穿插 / 最远点 ≤ 81」的。
    protected onEnter(): void {
        this._gift = composeGift(
            1 + Math.floor(Math.random() * 6),
            1 + Math.floor(Math.random() * 6),
        );
        AudioService.preload(SFX.diceRoll);

        // 换面相位：把"自转归零那一刻"对齐到本局掷出的点数（否则会"停 3 点发 5 点"）
        this._faceOff.A = faceOffsetFor(this._gift.a);
        this._faceOff.B = faceOffsetFor(this._gift.b);

        // ★ 音效与动画**同帧起**（第 14 轮音画对齐口径：音起 = 骰子开始转）
        //   音频主脉冲 310ms ↔ 动画追尾碰撞 300ms ⇒ 偏差 10ms（见 `assets/game-start/audio/README.md`）
        AudioService.playSfx(SFX.diceRoll, 1.0);
        Haptics.light();

        this.installDebugBridge();
        this._t = 0;
        this._playing = true;
        this.applyFrame(0);
    }

    /** 离开本页：停掉时间轴（页面被换掉后不必再算），并摘掉调试桥 */
    protected onLeave(): void {
        this._playing = false;
        this.uninstallDebugBridge();
    }

    /**
     * 每帧推进时间轴。
     * ⚠️ `dt` 夹在 66ms 以内：切后台回来 / 首帧的 dt 可能异常大，
     *    不夹的话一次跳帧会让骰子"瞬移"过整个追尾动作（看起来像闪了一下就结束了）。
     */
    protected update(dt: number): void {
        if (!this._playing) return;
        this._t += Math.min(66, dt * 1000);
        if (this._t >= TOTAL_MS) {
            this._t = TOTAL_MS;
            this._playing = false;
            this.applyFrame(TOTAL_MS);          // 终帧一定写死，保证"定格在哪"可复现
            this.timers.add(60, () => this.revealGift());
            return;
        }
        this.applyFrame(this._t);
    }

    /** 把 `t` 时刻的**全部**姿态写进场景树（相机 → 骰盘 → 两骰） */
    private applyFrame(t: number): void {
        const vis = DIE_VIS;
        const camS = camScaleAt(t);

        // ① 相机：缩放 + 平移（把"骰盘中心"锁在屏幕中心）
        if (this._camera) {
            this._camera.setScale(v3(camS, camS, 1));
            this._camera.setPosition(-this._trayCx * camS, -this._trayCy * camS, 0);
        }

        // ② 盘底金环：驱动期点亮 → 碰撞瞬间一记强闪 → 之后回落
        if (this._haloOp) {
            const drive = bellN(t, TL.HOLD * 0.5, TL.HOLD * 2.2);
            const hit = bellN(t, TL.IMPACT + 4, 300);
            this._haloOp.opacity = Math.round(255 * clampN(0.14 + 0.42 * drive + 0.44 * hit, 0, 1));
        }

        // ③ 两骰
        const hop = bHop(t);
        const sq = bSquash(t);
        const base = dieScaleBase(t);
        // 挤压轴 = **两心连线方向**（世界系）⇒ 追尾侧碰会自动"沿接触面法线压扁"
        const axDom = dieAxisDom(t, vis);

        for (const d of this._dice) {
            const r = bRadius(t, vis);
            const th = bTheta(t, d.side, vis) * Math.PI / 180;
            // DOM 坐标（y 向下）→ 引擎坐标（y 向上）：y 取反
            d.root.setPosition(
                TRAY_OFFSET.dx + Math.cos(th) * r,
                TRAY_OFFSET.dy - Math.sin(th) * r,
                0,
            );
            // `Squeeze` 管"世界系挤压"，`Spin` 管"骰子自身自转"。
            // 引擎 `angle` 正值 = 逆时针，DOM `rotate` 正值 = 顺时针 ⇒ 逐项取负。
            d.squeeze.angle = -axDom;
            d.squeeze.setScale(v3(
                base * (1 - BP.squashAmp * sq),
                base * (1 + STRETCH * sq),
                1,
            ));
            d.spin.angle = axDom - bSpin(t);

            const f = this.faceOf(d.side, t);
            if (f !== this._curFace[d.side]) {
                setFace(d.img, f);
                this._curFace[d.side] = f;
            }

            // 接触阴影：离地越高 → 越大越淡（俯视下"跳起来"的观感全在这一条）
            const sK = 0.764 * (1 + 0.30 * hop);
            d.shadow.setScale(v3(sK, sK * 0.42, 1));
            d.shadowOp.opacity = Math.round(255 * clampN(0.62 * (1 - 0.55 * hop), 0, 1));
        }
    }

    // ---- 供验收脚本调用的**薄壳**（真正的公式全在 `core/DiceMotion.ts`）----

    /** 中心距 ÷ 边长：**= 1.000 即"刚好贴合"，< 1 就是穿插**（追尾不穿模的唯一硬判据） */
    public contactRatio(t: number): number { return contactRatioAt(t, DIE_VIS); }

    /** 最靠外那枚骰子的"最远点半径"（含挤压的各向异性放大）—— 必须 <= `R_IN` */
    public farthest(t: number): number { return farthestAt(t, DIE_VIS); }

    /** 某枚骰子在该时刻的面（自转每 90° 一面 + 相位偏移对齐落定点数） */
    public faceOf(side: 'A' | 'B', t: number): number {
        return faceAt(t, this._faceOff[side]);
    }

    /**
     * 调试桥 —— 只暴露**纯函数**，不暴露任何状态。
     * 无头验收脚本靠 `globalThis.__g5dice.scan()` 拿全程曲线做断言。
     */
    private installDebugBridge(): void {
        if (!DEBUG) return;
        (globalThis as Record<string, unknown>).__g5dice = {
            total: TOTAL_MS,
            pullAt: TL.PULL,
            settleAt: TL.SETTLE,
            rIn: R_IN,
            vis: DIE_VIS,
            gift: this._gift,
            camScaleAt: (t: number): number => camScaleAt(t),
            contactRatio: (t: number): number => this.contactRatio(t),
            farthest: (t: number): number => this.farthest(t),
            faceOf: (side: 'A' | 'B', t: number): number => this.faceOf(side, t),
            spin: (t: number): number => bSpin(t),
            radius: (t: number): number => bRadius(t, DIE_VIS),
            sep: (t: number): number => bSep(t, DIE_VIS),

            /**
             * 冻帧：停在任意 `t`（并把可能已经浮现的赠礼层清掉）。
             * 无头抓图靠它拍"撞前 / 追尾瞬间 / 定格 / 拉远中 / 终帧"这些指定时刻。
             */
            seek: (t: number): void => {
                this.dropGiftLayer();
                this._playing = false;
                this._t = t;
                this.applyFrame(t);
            },
            /** 从零重播（时间轴口径与真实入场完全一致） */
            replay: (): void => {
                this.dropGiftLayer();
                this._revealed = false;
                this._t = 0;
                this._playing = true;
                this.applyFrame(0);
            },
            /** 当前时间轴走到哪儿了（ms） */
            now: (): number => this._t,

            /** 全程扫描（默认每 1ms 一条） */
            scan: (step = 1): Array<Record<string, number>> => {
                const out: Array<Record<string, number>> = [];
                for (let t = 0; t <= TOTAL_MS + 0.001; t += step) {
                    out.push({
                        t: Math.round(t * 1000) / 1000,
                        r: bRadius(t, DIE_VIS),
                        sep: bSep(t, DIE_VIS),
                        dist: this.contactRatio(t),
                        far: this.farthest(t),
                        cam: camScaleAt(t),
                        spin: bSpin(t),
                        faceA: this.faceOf('A', t),
                        faceB: this.faceOf('B', t),
                    });
                }
                return out;
            },
        };
    }

    /** 清掉赠礼层（冻帧 / 重播前要先把上一次留下的卡片摘掉） */
    private dropGiftLayer(): void {
        const gl = this.body.getChildByName('GiftLayer');
        if (gl?.isValid) gl.destroy();
    }

    private uninstallDebugBridge(): void {
        delete (globalThis as Record<string, unknown>).__g5dice;
    }

    // ========================================================
    //  赠礼卡
    // ========================================================
    private revealGift(): void {
        if (this._revealed || !this._gift) return;
        this._revealed = true;
        const g = this._gift;
        const layer = createNode('GiftLayer', this.body, { w: DW, h: DH });
        layer.addComponent(UIOpacity);

        // 暗场（照抄 .giftOver 的径向渐变）—— 中心与卡片同心
        const lightCy = CARD_TOP + CARD_H / 2;
        const { g: bg } = createGraphicsNode('Dim', layer, { w: DW, h: DH });
        const R = 900;
        for (let i = 0; i < 18; i++) {
            const t = i / 17;
            bg.fillColor = hex2color('#020403', Math.round(250 * (1 - t * 0.6)));
            bg.circle(0, topY(lightCy), R * (1 - t * 0.55));
            bg.fill();
        }

        // 光环 + 光芒 —— ★ 中心改为**卡片中心**（原来写死 `topY(520)`，那是 1334 设计稿口径，
        //   真机可视高 1651 下会明显偏上，卡片看起来"浮在光环下沿之外"）；
        //   直径同时放大到 720，让 560×478 的卡片四周留出完整光环。
        const ring = createNode('Ring', layer, { w: 720, h: 720, x: 0, y: topY(lightCy) });
        const { g: rg } = createGraphicsNode('G', ring, { w: 720, h: 720 });
        for (let i = 3; i >= 1; i--) {
            rg.lineWidth = i * 2;
            rg.strokeColor = hex2color('#F6C445', Math.round(46 / i));
            rg.circle(0, 0, 360 - i * 14); rg.stroke();
        }
        fillRadialGlow(rg, 0, 0, 340, '#F6C445', 26, 14);
        ring.setScale(v3(0.7, 0.7, 1));
        MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.26);
        tween(ring).to(0.42, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();

        const rays = createNode('Rays', layer, { w: 900, h: 900, x: 0, y: topY(lightCy) });
        const { g: yg } = createGraphicsNode('G', rays, { w: 900, h: 900 });
        for (let i = 0; i < 12; i++) {
            const a0 = (i * 30) * Math.PI / 180;
            const a1 = a0 + 10 * Math.PI / 180;
            yg.fillColor = hex2color('#FFF4C8', 22);
            yg.moveTo(0, 0);
            for (let s = 0; s <= 6; s++) {
                const a = a0 + (a1 - a0) * (s / 6);
                yg.lineTo(Math.cos(a) * 450, Math.sin(a) * 450);
            }
            yg.close(); yg.fill();
        }
        tween(rays).by(38, { angle: -360 }).repeatForever().start();

        // 卡片
        const card = this.buildGiftCard(layer, g);
        card.setScale(v3(0.86, 0.86, 1));
        const cardOp = card.getComponent(UIOpacity)!;
        cardOp.opacity = 0;
        MotionFx.fadeTo(cardOp, 255, 0.3);
        tween(card).to(0.42, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        Haptics.medium();
    }

    /** 赠礼卡（两枚骰子 + 和值 + 档位缎带 + 赠品 + 护栏说明 + 开始按钮） */
    private buildGiftCard(layer: Node, g: RunGift): Node {
        const W = GIFT.CARD_W, H = CARD_H;
        const card = createNode('GiftCard', layer, { w: W, h: H, x: 0, y: topY(CARD_TOP + H / 2) });
        card.addComponent(UIOpacity);

        const y0 = H / 2;   // 卡片顶边（局部坐标）
        /** 卡内 top（距卡顶）→ 局部 y */
        const cy = (topFromCardTop: number, h: number): number => y0 - topFromCardTop - h / 2;

        const tier = TIER_COLOR[g.tier];
        const { g: cg } = createGraphicsNode('Bg', card, { w: W, h: H });
        // 外发光 + 卡面
        fillRoundRect(cg, 0, 0, W + 18, H + 18, 50, 'rgba(246,196,69,0.10)', 255);
        fillRoundRect(cg, 0, 0, W, H, 44, 'rgba(9,18,13,0.97)', 255);
        strokeRoundRect(cg, 0, 0, W, H, 44, 'rgba(246,196,69,0.34)', 2.5, 255);

        // 缎带（顶部骑缝）
        const ribbon = createNode('Ribbon', card, { w: 260, h: CARD_ROWS.ribbon.h, y: cy(CARD_ROWS.ribbon.top, CARD_ROWS.ribbon.h) });
        const { g: rbg } = createGraphicsNode('G', ribbon, { w: 260, h: 46 });
        fillVGradient(rbg, 0, 0, 260, 46, 23, tier.ribbon, darkenHex(tier.ribbon, 0.34), 14);
        strokeRoundRect(rbg, 0, 0, 260, 46, 23, 'rgba(255,255,255,0.24)', 1.5, 255);
        createLabel(ribbon, g.tier, { fontSize: 26, color: '#FFF7E6', bold: true, w: 260, h: 46 });

        // 两枚骰子 + 加号
        const dieW = CARD_ROWS.dice.h;
        const dieY = cy(CARD_ROWS.dice.top, dieW);
        createSprite(card, 'DieA', { path: ASSET.DICE_FACE(g.a), aspectW: dieW, x: -78, y: dieY });
        createLabel(card, '+', { fontSize: 30, color: 'rgba(255,247,230,0.55)', bold: true, w: 30, h: 30, x: 0, y: dieY });
        createSprite(card, 'DieB', { path: ASSET.DICE_FACE(g.b), aspectW: dieW, x: 78, y: dieY });

        // 和值
        createLabel(card, '点数合计', {
            fontSize: 20, color: COLOR.CREAM_MUTE, w: W, h: CARD_ROWS.sumCap.h,
            y: cy(CARD_ROWS.sumCap.top, CARD_ROWS.sumCap.h),
        });
        createLabel(card, String(g.sum), {
            fontSize: 68, color: COLOR.GOLD_HI, bold: true, serif: true, w: W, h: CARD_ROWS.sum.h,
            y: cy(CARD_ROWS.sum.top, CARD_ROWS.sum.h),
        });

        // 赠品
        const isRevive = g.revive > 0;
        const iconNode = createNode('GiftIcon', card, {
            w: CARD_ROWS.gift.h, h: CARD_ROWS.gift.h, x: -132,
            y: cy(CARD_ROWS.gift.top, CARD_ROWS.gift.h),
        });
        if (isRevive) {
            // 复活档没有对应道具图标 —— 用矢量补一枚（与主玩页复活徽标同族）
            const { g: vg } = createGraphicsNode('Rev', iconNode, { w: 68, h: 68 });
            for (let i = 10; i >= 1; i--) {
                const t = i / 10;
                vg.fillColor = hex2color('#D8432F', Math.round(255 * (1 - t * 0.75)));
                vg.circle(0, 0, 34 * t); vg.fill();
            }
            vg.lineWidth = 2; vg.strokeColor = hex2color('rgba(255,238,228,0.55)');
            vg.circle(0, 0, 34); vg.stroke();
            createLabel(iconNode, '复', { fontSize: 40, color: '#FFF4F0', bold: true, serif: true, w: 68, h: 68 });
        } else {
            const id = g.items ? firstItem(g) : '';
            createSprite(iconNode, 'Icon', { path: toolIconPath(id), aspectW: 64 });
        }

        const nameTxt = isRevive ? '复活机会 ×1' : `${toolName(firstItem(g))} ×1`;
        createLabel(card, nameTxt, {
            fontSize: 30, color: tier.name, bold: true, w: 300, h: 36,
            anchor: [0, 0.5], alignLeft: true, x: -W / 2 + 186,
            y: cy(CARD_ROWS.gift.top, 36),
        });
        createLabel(card, TIER_TEXT[g.tier].sub, {
            fontSize: 21, color: COLOR.CREAM_MUTE, w: 300, h: 28,
            anchor: [0, 0.5], alignLeft: true, x: -W / 2 + 186,
            y: cy(CARD_ROWS.gift.top + 34, 28),
        });

        // 护栏说明
        const guard = createNode('Guard', card, {
            w: W - 56, h: CARD_ROWS.guard.h,
            y: cy(CARD_ROWS.guard.top, CARD_ROWS.guard.h),
        });
        const { g: gg } = createGraphicsNode('G', guard, { w: W - 56, h: CARD_ROWS.guard.h });
        fillRoundRect(gg, 0, 0, W - 56, CARD_ROWS.guard.h, 12, 'rgba(85,183,154,0.12)', 255);
        strokeRoundRect(gg, 0, 0, W - 56, CARD_ROWS.guard.h, 12, 'rgba(85,183,154,0.36)', 1.5, 255);
        createLabel(guard, isRevive
            ? '仅限本局使用 —— 未用随本局作废'
            : '仅限本局使用 —— 不累计、不跨局', {
            fontSize: 20, color: '#CFE9DE', w: W - 76, h: 78, wrapW: W - 76,
        });

        // 「开始挑战」按钮 —— ★ 位置**由卡底派生**（`BTN_CY = 卡顶 + 卡高 + 间隙 + 半高`），
        //   卡高再变它也跟着走。旧代码把它写死在 `topY(975)`，与卡高脱钩 ⇒ 压住卡内末行。
        const BW = GIFT.BTN_W, BH = GIFT.BTN_H;
        const btn = createNode('BtnGo', layer, { w: BW, h: BH, x: 0, y: topY(BTN_CY) });
        const { g: bg2 } = createGraphicsNode('Face', btn, { w: BW, h: BH });
        // 面层走公共 `draw3dFace` —— 与结算页金按钮**同一套形制**（含顶缘柔光 ④）。
        // ⚠️ 这里原是手绘，且用的是同一批**偏离真源**的色值：
        //    厚度 #7A5310（真源 `0 8px 0 #9A6A15`）、渐变收尾 #C8912B（真源 #E8A92E）、
        //    描边 #5C3F0C（真源 #8A5A10）、字 #2A1C06（真源 #5C3610）。
        //    并且**没有顶缘柔光** —— 所以它跟结算页的金按钮看着就不是一家。
        //    真源 = `game-5-UI-六页视觉稿-v2.html` 的 `.btn-gold`（第 86 行）。
        draw3dFace(bg2, 0, 0, {
            w: BW, h: BH, radius: BH / 2, depth: 10,
            top: '#FFE08A', bottom: '#E8A92E', depthColor: '#9A6A15', border: '#8A5A10',
        });
        createLabel(btn, '开始挑战', {
            fontSize: 42, color: '#5C3610', bold: true, serif: true, w: BW - 40, h: BH,
        });
        const btnOp = btn.addComponent(UIOpacity);
        btnOp.opacity = 0;
        this.timers.add(260, () => {
            if (!btn.isValid) return;
            MotionFx.fadeTo(btnOp, 255, 0.3);
            btn.setScale(v3(0.9, 0.9, 1));
            tween(btn).to(0.34, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
            tween(btn)
                .repeatForever(
                    tween(btn).to(0.8, { scale: v3(1.04, 1.04, 1) }, { easing: 'sineInOut' })
                        .to(0.8, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
                ).start();
        });

        btn.on(Node.EventType.TOUCH_START, () => {
            tween(btn).to(0.08, { scale: v3(0.94, 0.94, 1) }).start();
        }, btn);
        const go = (): void => {
            tween(btn).to(0.14, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
            Haptics.medium();
            AudioService.playSfx('audio/button');
            this.startRun();
        };
        btn.on(Node.EventType.TOUCH_END, go, btn);
        btn.on(Node.EventType.TOUCH_CANCEL, () => {
            tween(btn).to(0.14, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        }, btn);

        return card;
    }

    private startRun(): void {
        if (!this._gift) return;
        const g = this._gift;
        beginRun(this._level, g);
        SaveService.instance.markPlayed();
        this.close(PAGE.GAME, {
            level: this._level,
            gift: g,
        });
    }
}

// ============================================================
//  模块内工具
// ============================================================

/** 一枚骰子的全部姿态节点（层级见 `createDie`） */
interface DieRefs {
    /** 位置层：只负责"骰子中心在盘里的哪里" */
    root: Node;
    /** 挤压层：**世界系**各向异性缩放（角度 = 两心连线方向） */
    squeeze: Node;
    /** 自转层：**骰子自身**转动（角度 = 自转角 − 挤压轴角） */
    spin: Node;
    /** 贴图层（换面 = 只换这里的 spriteFrame，**绝不重建节点**） */
    img: Node;
    shadow: Node;
    shadowOp: UIOpacity;
    side: 'A' | 'B';
}

/**
 * 造一枚骰子。
 *
 * 【为什么要四层节点】因为"挤压"和"自转"属于**两个不同的坐标系**：
 *   · 挤压必须落在**世界系**（沿两心连线压 —— 追尾侧碰才压得对方向）；
 *   · 自转必须落在**骰子自身系**（骰子面上点数的朝向）。
 *   两者独立叠加的正确拓扑是 `R(ax)·S·R(-ax)·R(φ)`；在引擎里等价于：
 *      `Squeeze.angle = −ax` 且 `Spin.angle = ax − φ`
 *   （因为 `R(−ax)·S·R(ax)·R(−φ) ≡ R(−ax)·S·R(ax−φ)`，用引擎角度表示为下面这两行。）
 *
 * ⚠️ **别把挤压挂到 `root` 上** —— `root` 的 scale 会被"离地放大"占用，
 *    两者一混，落地那一下的挤压幅度就永远算不准。
 */
function createDie(parent: Node, name: string, side: 'A' | 'B', x: number, y: number): DieRefs {
    const root = createNode(name, parent, { w: DIE_BOX, h: DIE_BOX, x, y });

    // 接触阴影（骰子下方那团柔影 —— 没有它骰子看起来是"贴"在盘上的）
    // ⚠️ 圆形 glow 靠**节点非等比缩放**压成扁椭圆（`createGraphicsNode` 的 w/h 不影响绘制内容）
    const shadow = createNode('Shadow', root, {
        w: DIE_VIS * 1.5, h: DIE_VIS * 0.55, y: -DIE_VIS * 0.42,
    });
    const { g: sg } = createGraphicsNode('G', shadow, { w: DIE_VIS * 1.5, h: DIE_VIS * 0.55 });
    fillRadialGlow(sg, 0, 0, DIE_VIS * 0.72, '#000000', 170, 8);
    const shadowOp = shadow.addComponent(UIOpacity);

    // 姿态三层：Squeeze（世界系挤压）→ Spin（自身自转）→ Img（贴图）
    const squeeze = createNode('Squeeze', root, { w: DIE_BOX, h: DIE_BOX });
    const spin = createNode('Spin', squeeze, { w: DIE_BOX, h: DIE_BOX });
    // 骰子六面是等大方图，不需要等比推算 —— 显式给盒子尺寸
    const img = createSprite(spin, 'Img', { path: ASSET.DICE_FACE(1), w: DIE_BOX, h: DIE_BOX });

    return { root, squeeze, spin, img, shadow, shadowOp, side };
}

/**
 * 换骰子面。
 *
 * ⚠️ 只改 `spriteFrame`、**不重建节点**：
 *    重建会丢掉正在跑的补间（旋转/下落），表现是"骰子闪一下就没了"。
 *    六面贴图在启动页已全部预加载，所以这里 `cachedFrame` 必然命中；
 *    万一没命中（例如直接进本页调试），退化为"保持上一面"，不会变白块。
 */
function setFace(node: Node, face: number): void {
    const sp = node.getComponent(Sprite);
    if (!sp) return;
    const sf = cachedFrame(ASSET.DICE_FACE(face));
    if (sf) sp.spriteFrame = sf;
}

/** 取本局赠礼里的第一个道具 id */
function firstItem(g: RunGift): string {
    for (const k of Object.keys(g.items)) {
        if (g.items[k as keyof typeof g.items] > 0) return k;
    }
    return '';
}

function toolName(id: string): string {
    switch (id) {
        case 'erase': return '消除';
        case 'move': return '移出';
        case 'shuffle': return '洗牌';
        case 'addslot': return '加槽';
        default: return '道具';
    }
}

function toolIconPath(id: string): string {
    const base = 'home/';
    switch (id) {
        case 'erase': return `${base}tool_erase`;
        case 'move': return `${base}tool_remove`;
        case 'shuffle': return `${base}tool_shuffle`;
        case 'addslot': return `${base}tool_addslot`;
        default: return `${base}tool_erase`;
    }
}
