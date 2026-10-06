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

import { ASSET, COLOR, PAGE, SFX, topY } from '../CFG';
import { PageBase } from './PageBase';
import { MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import { Haptics } from './Haptics';
import { SaveService } from '../core/SaveService';
import { beginRun, composeGift, TIER_COLOR, TIER_TEXT, type RunGift } from '../core/Gift';
import {
    cachedFrame, createGraphicsNode, createLabel, createNode, createSprite,
    fillRadialGlow, fillRoundRect, fillVGradient, strokeRoundRect,
} from './UIFactory';
import { darkenHex, hex2color } from './Palette';

const { ccclass } = _decorator;

const DW = 750;
const DH = 1334;

/**
 * 分镜时长（秒）—— 总长 ≈ 1.28s，对齐定稿的「1.2s 掷骰开场」。
 *
 * 时间轴：
 *      0.00  镜头压在骰盘上（2.10×）
 *      0.18  开始落盘 + **音效同帧起**（第 14 轮音画对齐口径：音起 = 骰子开始落）
 *      0.66  骰子触盘
 *      0.88  挤压回弹结束
 *      0.88  镜头拉远（2.10× → 1.00×），同时骰子放大到 DIE_SCALE_AFTER
 *      1.16  镜头到位
 *      1.28  赠礼卡浮现
 */
const T = {
    PUSH: 0.18,
    DROP: 0.48,
    /** 触盘后的挤压回弹 */
    BOUNCE: 0.22,
    PULL: 0.28,
} as const;

/** 骰子视觉边长（设计值，来自分镜页头「骰子视觉边长 48」） */
const DIE_VIS = 48;
/**
 * 拉远后骰子放大的倍数。
 * 【为什么必须放大】拉远到 1.0× 之后，48px 的骰子在 750 宽的屏幕上只有 6.4% 宽，
 * 点数根本看不清 —— 而"掷骰看点数"正是这一屏的全部意义。
 */
const DIE_SCALE_AFTER = 2.4;

function ex(left: number, w: number): number { return left - DW / 2 + w / 2; }
function ey(top: number, h: number): number { return topY(top + h / 2); }

@ccclass('GameStartPage')
export class GameStartPage extends PageBase {

    private _level = 1;
    private _gift: RunGift | null = null;

    private _camera: Node | null = null;
    private _trayCx = 0;
    private _trayCy = 0;
    private _dieA: Node | null = null;
    private _dieB: Node | null = null;
    private _dieImgA: Node | null = null;
    private _dieImgB: Node | null = null;
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

        // 四角金饰 44×44
        const S = 44;
        const corner = (left: number, top: number, flipX: boolean, flipY: boolean, k: number): void => {
            const s = S * k;
            const { node, g: cg } = createGraphicsNode('Corner', this.body, {
                w: s, h: s, x: ex(left, s), y: topY(top + s / 2),
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
        corner(16, 16, false, false, 1);
        corner(DW - 16 - S, 16, true, false, 1);
        corner(22, DH - 16 - S * 0.88, false, true, 0.88);
        corner(DW - 22 - S * 0.88, DH - 16 - S * 0.88, true, true, 0.88);
    }

    // ---- 镜头层（桌子 + 骰盘 + 骰子全在里面）----
    private buildCamera(): void {
        this._camera = createNode('Camera', this.body, { w: DW, h: DH });

        // 桌子（750×750，落点 y=292 —— 与主玩页同一口径）
        const tableTop = 292;
        const table = createNode('TableWrap', this._camera, {
            w: DW, h: 750, x: 0, y: ey(tableTop, 750),
        });
        createSprite(table, 'Img', { path: ASSET.TABLE, w: DW, h: 750 });
    }

    // ---- 骰盘（桌面内偏上；分镜页实测 373,376）----
    private buildTray(): void {
        if (!this._camera) return;
        // 盘中心（屏幕坐标 373,376）→ 相机层内坐标
        this._trayCx = 373 - DW / 2;
        this._trayCy = topY(376);

        const halo = createNode('TrayHalo', this._camera, { w: 230, h: 230, x: this._trayCx, y: this._trayCy });
        const { g: hg } = createGraphicsNode('G', halo, { w: 230, h: 230 });
        fillRadialGlow(hg, 0, 0, 115, '#FFF4C8', 60, 12);
        halo.setScale(v3(0.85, 0.85, 1));

        const floor = createNode('TrayFloor', this._camera, { w: 166, h: 166, x: this._trayCx, y: this._trayCy });
        const { g: fg } = createGraphicsNode('G', floor, { w: 166, h: 166 });
        fg.fillColor = hex2color('#07120C', 150);
        fg.circle(0, 0, 83); fg.fill();
        fg.lineWidth = 3; fg.strokeColor = hex2color('#F6C445', 64);
        fg.circle(0, 0, 81); fg.stroke();
        fg.lineWidth = 1; fg.strokeColor = hex2color('#F6C445', 30);
        fg.circle(0, 0, 62); fg.stroke();
    }

    // ---- 两枚骰子（独立图层，可单独运动）----
    private buildDice(): void {
        if (!this._camera) return;
        const a = createDie(this._camera, 'DieA', this._trayCx - 30, this._trayCy + 18, 2);
        const b = createDie(this._camera, 'DieB', this._trayCx + 30, this._trayCy + 18, 5);
        this._dieA = a.root; this._dieImgA = a.img;
        this._dieB = b.root; this._dieImgB = b.img;
    }

    // ========================================================
    //  演示：掷骰 → 拉远 → 翻赠礼卡
    // ========================================================
    protected onEnter(): void {
        this._gift = composeGift(1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6));
        AudioService.preload(SFX.diceRoll);

        // ① 镜头压在骰盘上（2.10×）
        const cam = this._camera!;
        cam.setScale(v3(2.10, 2.10, 1));
        // 让"骰盘"出现在屏幕中心：相机放大后，把盘中心平移到原点
        cam.setPosition(-this._trayCx * 2.10, -this._trayCy * 2.10, 0);

        this.timers.add(T.PUSH * 1000, () => this.rollDice());
    }

    private rollDice(): void {
        const cam = this._camera!;

        // 音效与落盘**同帧起**（第 14 轮音画对齐口径：音起 = 骰子开始落）
        AudioService.playSfx(SFX.diceRoll, 1.0);
        Haptics.light();

        const fa = this._gift ? this._gift.a : 3;
        const fb = this._gift ? this._gift.b : 4;

        // 骰子：旋转换面 + 落到盘里 + 挤压回弹
        this.spinDie(this._dieA!, this._dieImgA!, fa, 0);
        this.spinDie(this._dieB!, this._dieImgB!, fb, 0.06);

        // ② 落定 → ③ 镜头拉远（2.10× → 1.00×），同时把骰子放大到看得清点数
        const tPull = (T.PUSH + T.DROP + T.BOUNCE) * 1000;
        this.timers.add(tPull, () => {
            tween(cam).to(T.PULL, { scale: v3(1, 1, 1), position: v3(0, 0, 0) },
                { easing: 'quadInOut' }).start();
            this.scaleDie(this._dieA!, DIE_SCALE_AFTER, T.PULL);
            this.scaleDie(this._dieB!, DIE_SCALE_AFTER, T.PULL);
        });

        // ④ 镜头到位 → 赠礼卡
        this.timers.add(tPull + T.PULL * 1000 + 120, () => this.revealGift());
    }

    /**
     * 骰子旋转落盘。
     *
     * 【换面为什么用"间隔递增"而不是固定帧率】
     * 固定帧率是"匀速闪光"，看起来像坏了；间隔按 1.16 倍递增就是**减速感** ——
     * 这是"骰子快停下时能隐约看清点数"的观感来源，也是玩家相信"这一掷是随机的"的关键。
     *
     * ⚠️ 换面循环用 `MotionFx.after` 递归而不是 for 循环 + 一次大延时：
     *    这样每一帧都能检查 `isValid`，页面被销毁后循环会自己停下。
     */
    private spinDie(root: Node, img: Node, face: number, delay: number): void {
        root.setPosition(root.position.x, root.position.y + 130, 0);

        // 换面：随机跑一遍 → 停在目标点数
        let elapsed = 0;
        let step = 42;
        const spinTotal = T.DROP * 1000 + (delay * 1000);
        const runFace = (): void => {
            if (!root.isValid) return;
            if (elapsed >= spinTotal) { setFace(img, face); return; }
            setFace(img, 1 + Math.floor(Math.random() * 6));
            elapsed += step;
            step *= 1.16;
            MotionFx.after(step, runFace);
        };
        MotionFx.after(delay * 1000, runFace);

        // 位移：先加速下落再落定（quadIn 收尾 = 重力感）
        const targetY = this._trayCy + 18;
        MotionFx.after(delay * 1000, () => {
            if (!root.isValid) return;
            const x = root.position.x;
            tween(root)
                .to(T.DROP * 0.62, { position: v3(x, targetY + 58, 0) }, { easing: 'quadOut' })
                .to(T.DROP * 0.38, { position: v3(x, targetY, 0) }, { easing: 'quadIn' })
                .start();

            // 挤压回弹（世界轴对齐：先扁一下再弹回，落地的"分量感"全在这一下）
            MotionFx.after(T.DROP * 1000, () => {
                if (!root.isValid) return;
                tween(root)
                    .to(0.06, { scale: v3(1.12, 0.84, 1) }, { easing: 'quadOut' })
                    .to(0.16, { scale: v3(1, 1, 1) }, { easing: 'backOut' })
                    .start();
                Haptics.light();
            });
        });
    }

    private scaleDie(root: Node, k: number, dur: number): void {
        if (!root.isValid) return;
        tween(root).to(dur, { scale: v3(k, k, 1) }, { easing: 'quadInOut' }).start();
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

        // 暗场（照抄 .giftOver 的径向渐变）
        const { g: bg } = createGraphicsNode('Dim', layer, { w: DW, h: DH });
        const R = 900;
        for (let i = 0; i < 18; i++) {
            const t = i / 17;
            bg.fillColor = hex2color('#020403', Math.round(250 * (1 - t * 0.6)));
            bg.circle(0, topY(667), R * (1 - t * 0.55));
            bg.fill();
        }

        // 光环 + 光芒（中心 y 520）
        const ring = createNode('Ring', layer, { w: 640, h: 640, x: 0, y: topY(520) });
        const { g: rg } = createGraphicsNode('G', ring, { w: 640, h: 640 });
        for (let i = 3; i >= 1; i--) {
            rg.lineWidth = i * 2;
            rg.strokeColor = hex2color('#F6C445', Math.round(46 / i));
            rg.circle(0, 0, 320 - i * 12); rg.stroke();
        }
        fillRadialGlow(rg, 0, 0, 300, '#F6C445', 26, 14);
        ring.setScale(v3(0.7, 0.7, 1));
        MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.26);
        tween(ring).to(0.42, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();

        const rays = createNode('Rays', layer, { w: 900, h: 900, x: 0, y: topY(520) });
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
        const W = 560, H = 470;
        const card = createNode('GiftCard', layer, { w: W, h: H, x: 0, y: topY(560 + H / 2) });
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
        const ribbon = createNode('Ribbon', card, { w: 260, h: 46, y: cy(-4, 46) });
        const { g: rbg } = createGraphicsNode('G', ribbon, { w: 260, h: 46 });
        fillVGradient(rbg, 0, 0, 260, 46, 23, tier.ribbon, darkenHex(tier.ribbon, 0.34), 14);
        strokeRoundRect(rbg, 0, 0, 260, 46, 23, 'rgba(255,255,255,0.24)', 1.5, 255);
        createLabel(ribbon, g.tier, { fontSize: 26, color: '#FFF7E6', bold: true, w: 260, h: 46 });

        // 两枚骰子 + 加号
        const dieW = 84;
        const dieY = cy(96, dieW);
        createSprite(card, 'DieA', { path: ASSET.DICE_FACE(g.a), aspectW: dieW, x: -78, y: dieY });
        createLabel(card, '+', { fontSize: 30, color: 'rgba(255,247,230,0.55)', bold: true, w: 30, h: 30, x: 0, y: dieY });
        createSprite(card, 'DieB', { path: ASSET.DICE_FACE(g.b), aspectW: dieW, x: 78, y: dieY });

        // 和值
        createLabel(card, '点数合计', {
            fontSize: 20, color: COLOR.CREAM_MUTE, w: W, h: 24, y: cy(200, 24),
        });
        createLabel(card, String(g.sum), {
            fontSize: 68, color: COLOR.GOLD_HI, bold: true, serif: true, w: W, h: 76, y: cy(230, 76),
        });

        // 赠品
        const isRevive = g.revive > 0;
        const iconNode = createNode('GiftIcon', card, { w: 68, h: 68, x: -132, y: cy(316, 68) });
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
            fontSize: 30, color: tier.name, bold: true, w: 300, h: 40,
            anchor: [0, 0.5], alignLeft: true, x: -W / 2 + 186, y: cy(300, 40),
        });
        createLabel(card, TIER_TEXT[g.tier].sub, {
            fontSize: 21, color: COLOR.CREAM_MUTE, w: 300, h: 30,
            anchor: [0, 0.5], alignLeft: true, x: -W / 2 + 186, y: cy(340, 30),
        });

        // 护栏说明
        const guard = createNode('Guard', card, { w: W - 56, h: 78, y: cy(400, 78) });
        const { g: gg } = createGraphicsNode('G', guard, { w: W - 56, h: 78 });
        fillRoundRect(gg, 0, 0, W - 56, 78, 12, 'rgba(85,183,154,0.12)', 255);
        strokeRoundRect(gg, 0, 0, W - 56, 78, 12, 'rgba(85,183,154,0.36)', 1.5, 255);
        createLabel(guard, isRevive
            ? '仅限本局使用 —— 未用随本局作废'
            : '仅限本局使用 —— 不累计、不跨局', {
            fontSize: 20, color: '#CFE9DE', w: W - 76, h: 78, wrapW: W - 76,
        });

        // 开始按钮
        const btn = createNode('BtnGo', layer, { w: 320, h: 108, x: 0, y: topY(975) });
        const { g: bg2 } = createGraphicsNode('Face', btn, { w: 320, h: 108 });
        fillRoundRect(bg2, 0, -10, 320, 108, 54, '#7A5310', 255);
        fillVGradient(bg2, 0, 0, 320, 108, 54, '#FFE08A', '#C8912B', 20);
        strokeRoundRect(bg2, 0, 0, 320, 108, 54, '#5C3F0C', 3, 255);
        createLabel(btn, '开始挑战', {
            fontSize: 38, color: '#2A1C06', bold: true, serif: true, w: 280, h: 108,
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

function createDie(parent: Node, name: string, x: number, y: number, face: number): { root: Node; img: Node } {
    const root = createNode(name, parent, { w: DIE_VIS, h: DIE_VIS, x, y });
    // 接触阴影（骰子下方那团柔影 —— 没有它骰子看起来是"贴"在盘上的）
    const { g: sg } = createGraphicsNode('Shadow', root, { w: DIE_VIS * 1.5, h: DIE_VIS * 0.55, y: -DIE_VIS * 0.42 });
    fillRadialGlow(sg, 0, 0, DIE_VIS * 0.72, '#000000', 160, 8);

    // 骰子图：用 `w/h` 显式给尺寸（骰子六面是等大方图，不需要等比推算）
    const img = createSprite(root, 'Img', { path: ASSET.DICE_FACE(face), w: DIE_VIS, h: DIE_VIS });
    return { root, img };
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
