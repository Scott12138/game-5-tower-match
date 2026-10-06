/**
 * ============================================================
 *  SplashPage.ts · 启动页（①）
 * ============================================================
 *  版式**逐值照抄** `assets/splash/启动页-定稿.html`（v8 微调版，750×1334）。
 *  坐标：`ex(left,w)` = 横向照设计值；`ey(top,h)` = 纵向走 `fitY()` 做**真机适配**
 *  （设计稿 1334 高 vs 真机可视 1651.4 高，直接照抄设计 y 会让内容整体浮在中间）。
 *
 *  【进度是怎么来的 —— 不是假进度条】
 *  进度 = **真实预加载完成度**：启动时把首页 / 开局页 / 主玩页要用的贴图
 *  （牌面 27 张 + 桌面 + 骰子 6 面 + 首页图标…）全部 `preloadAll()`，
 *  每完成一项推进一格。这样"卡在 87%"就是**真的**有一张图没进来 ——
 *  命令行无头验收时这一条能直接定位资源缺失，比看日志猜快得多。
 *  （为了让 1 帧就加载完的情况不至于"进度条一动不动"，再叠一个时间下限。）
 *
 *  【最短停留】预加载可能几十毫秒就完成，那样启动页会闪一下，
 *  取 `MIN_SHOW_MS` 与预加载完成的**较晚者**。
 * ============================================================
 */

import { Node, UIOpacity, UITransform, _decorator, tween, v3 } from 'cc';

import { ASSET, BUNDLES, COLOR, FIT, HOME_FN, PAGE, TOOL, TOOL_ICON } from '../CFG';
import { PageBase } from './PageBase';
import { MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import {
    createCoverSprite, createGraphicsNode, createLabel, createNode, createSprite, estTextWidth,
    fillRadialGlow, fillRadialGlowE, fillRays, fillRoundRect, fillVGradient,
    fitY, fromBottom, preloadAll, preloadBundles,
} from './UIFactory';
import { hex2color } from './Palette';
import { fullDeck, spritePath } from '../core/TileData';

const { ccclass } = _decorator;

/** 最短停留（ms） */
const MIN_SHOW_MS = 1400;
/**
 * 进度条里"加载分包"占前段的比例（其余给贴图）。
 *
 * 为什么要给分包单独留一段：分包（home / game）在**真机**上是要走网络下载的，
 * 耗时通常比本地贴图解析长得多。若把两者混成一个计数，进度条会在 0% 卡很久
 * 然后突然跳到 90%，看起来像卡死。分成两段后"先爬 6% 再爬完"是单调递增的。
 */
const BUNDLE_WEIGHT = 0.06;
/** 设计稿宽度（横向换算基准） */
const DW = 750;

/** 需要预加载的全部贴图（**与进度条一一对应**，加一个就要在这里加一个） */
function allTexturePaths(): string[] {
    const list: string[] = [
        ASSET.SPLASH_FELT, ASSET.SPLASH_LOGO, ASSET.SPLASH_MASCOT,
        ASSET.SPLASH_DICE, ASSET.SPLASH_COIN,
        ASSET.SPLASH_BAR_TRACK, ASSET.SPLASH_BAR_FILL,
        ASSET.HOME_SETTING, ASSET.HOME_COIN, ASSET.HOME_TITLE,
        ASSET.HOME_BTN_L, ASSET.HOME_BTN_M, ASSET.HOME_BTN_R,
        ASSET.HOME_MUTE_ON, ASSET.HOME_MUTE_OFF, ASSET.HOME_ICON_MUSIC,
        ASSET.TABLE, ASSET.RULE_PAGE,
    ];
    for (const f of HOME_FN) list.push(f.icon);
    for (const k of Object.values(TOOL)) list.push(TOOL_ICON[k]);
    for (let n = 1; n <= 6; n++) list.push(ASSET.DICE_FACE(n));
    for (const code of fullDeck()) list.push(spritePath(code));
    return list;
}

/** 设计稿 (left, top) + 尺寸 → 引擎坐标（节点为**中心锚点**） */
function ex(left: number, w: number): number { return left - DW / 2 + w / 2; }
/**
 * 设计稿 `top` + 高度 → 引擎坐标（**纵向适配**）。
 *
 * ⚠️ 这里走 `fitY()` 而不是 `topY()`：设计稿 1334 高、真机可视 1651.4 高，
 *    用 `topY()` 会把内容整体居中、上下各白留 158.7px。`fitY()` 把内容
 *    区间 `[116, 1332]` 重新摊到「胶囊下沿 … Home Indicator 上方」之间，
 *    顶带贴顶、底带贴底、中段按比例舒展，任何屏幕比例都成立。
 */
function ey(top: number, h: number): number { return fitY(top + h / 2, FIT.SPLASH); }

@ccclass('SplashPage')
export class SplashPage extends PageBase {

    private _loaded = 0;
    private _total = 0;
    /** 分包加载进度（BUNDLES 里几张已就绪 / 共几张） */
    private _bundleDone = 0;
    private _bundleTotal = 0;
    private _barFill: Node | null = null;
    /** 填充贴图节点（**必须和外层容器一起改宽**，见 `_setProgress`） */
    private _barSprite: Node | null = null;
    /** 填充头部辉光点（跟着填充右端走） */
    private _barHead: Node | null = null;
    private _pct: ReturnType<typeof createLabel> | null = null;
    private _left = false;

    // ========================================================
    //  构建
    // ========================================================
    protected onBuild(): void {
        // ⚠️ 顺序即层级：后建的画在上面。光芒必须在吉祥物**之前**建。
        //
        //  ★ 第 35 轮：`buildCorners()`（四角金饰）**已删除** —— 用户反馈
        //    "四个角的标志图标显得多余"。定稿稿里它是装饰性画框，真机上
        //    顶边两枚又必须让开胶囊、底边两枚贴 Home Indicator，
        //    结果四枚离画面中心越来越远、读起来像"孤立的方框"，故整体去掉。
        //    删掉后画面重心回到「标题 / 吉祥物 / 进度条」这一条主轴。
        this.buildBackground();
        this.buildRays();
        this.buildTitle();
        this.buildProps();
        this.buildMascot();
        this.buildProgress();
        this.buildNotice();
    }

    // ---- 背景：绒布 + 顶光 + 光池 + 落地 ----
    //
    //  ★ 第 34 轮：三层**逐值照抄** `assets/splash/启动页-定稿.html` 的 CSS 配方
    //    （L37 顶光 / L39 光池 / L41 落地）。改这里必须回去对定稿稿，
    //     不要凭感觉调 alpha —— "整屏压黑"就是这么来的（见 UIFactory §一之二）。
    private buildBackground(): void {
        const vs = this.visible();

        // ① 绒布：**等比 cover 铺满**（定高等比 → 宽度溢出屏幕，可见部分正好是图中段）
        //    ⚠️ 改掉旧的 `w: vs.width, h: vs.height`：那是强制非等比，
        //       图片 0.7033 被拉到 0.4547 ⇒ **各向异性 1.55×**，径向高光变竖椭圆。
        const { node: base, g } = createGraphicsNode('FeltBase', this.body, { w: vs.width, h: vs.height });
        fillRoundRect(g, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, COLOR.GREEN, 255);
        createCoverSprite(base, 'Felt', { path: ASSET.SPLASH_FELT, w: vs.width, h: vs.height });

        const { g: fg } = createGraphicsNode('Atmosphere', this.body, { w: vs.width, h: vs.height });

        // ② 【已移除】椭圆暗角 —— 定稿稿那层 `radial-gradient(150% 100% at 50% 42%,
        //    transparent 50%, rgba(0,0,0,.36) 100%)` 在真机上实测：左右/上边缘 **0**、
        //    底边 5.8%、下角 12%。它提供的纵深已被 ③④⑤ 覆盖，且 Graphics 的
        //    嵌套实心图形**原理上做不出暗角**（详见 UIFactory §一之二）。
        //    历史两次实现分别把整屏压到 10% / 35% 亮度，故直接去掉。

        // ③ 顶光 —— 定稿稿：linear-gradient(180deg, rgba(255,251,230,.08), transparent 20%)
        fillVGradient(fg, 0, vs.height / 2 - vs.height * 0.10, vs.width * 1.4, vs.height * 0.20, 0,
            'rgba(255,251,230,0.08)', 'rgba(255,251,230,0)', 12);

        // ④ 中央光池（设计 45,700 → 660×500，**椭圆**）—— 定稿稿 .lightpool：
        //      radial-gradient(closest-side, rgba(255,244,200,.17), rgba(255,244,200,.06) 46%, transparent 72%)
        fillRadialGlowE(fg, ex(45, 660), ey(700, 500), 330, 250, '#FFF4C8', 44, 18);

        // ⑤ 底部落地 —— 定稿稿：linear-gradient(180deg, transparent, rgba(0,0,0,.30) 88%)
        //    定稿元素是 `bottom:0; height:300px`（占 1334 的 22.5%），这里按**真机可视高**
        //    等比例走，保证任何比例下都贴底、占比一致。
        const gh = vs.height * 0.225;
        fillVGradient(fg, 0, fromBottom(gh / 2), vs.width * 1.4, gh, 0,
            'rgba(0,0,0,0)', 'rgba(0,0,0,0.30)', 14);
    }

    // ---- （第 35 轮删除）四角金饰 ----
    //
    //  历史实现见 git 记录 / 第 34 轮日志：四枚 58×58 的金色方框 + 菱形点，
    //  顶边两枚锚 `SAFE_TOP` 让开胶囊、底边两枚锚真机底边上方 14。
    //  ★ 第 35 轮按用户要求**整组删除**（"四个角的标志图标显得多余"）。
    //    删除后 `SAFE_TOP` / `fromTop` 在本文件不再被引用，已一并从 import 里摘掉。

    // ---- 吉祥物背后光芒（慢转的放射扇，46s 一圈）----
    private buildRays(): void {
        const { node, g } = createGraphicsNode('Rays', this.body, {
            w: 520, h: 520, x: ex(115, 520), y: ey(600, 520),
        });
        // 12 道扇，每道 9°、间隔 30°（照抄 repeating-conic-gradient 的 9deg/30deg）
        // + 径向 mask（中心 0.9 → 72% 半径处归零）+ 整体 opacity .8 ⇒ 峰值 ≈ 15
        fillRays(g, 260, 15, { count: 12, stepDeg: 30, sweepDeg: 9, fadeAt: 0.72 });
        node.angle = 0;
        tween(node).by(46, { angle: -360 }).repeatForever().start();
    }

    // ---- 标题：光晕 + logo ----
    private buildTitle(): void {
        const { node: halo, g } = createGraphicsNode('TitleHalo', this.body, {
            w: 560, h: 250, x: ex(190, 560), y: ey(116, 250),
        });
        for (let i = 10; i >= 1; i--) {
            const t = i / 10;
            g.fillColor = hex2color('#FFD678', Math.round(48 * (1 - t)));
            g.ellipse(0, 0, 280 * t, 125 * t);
            g.fill();
        }
        tween(halo)
            .repeatForever(
                tween(halo).to(2.1, { scale: v3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                    .to(2.1, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();

        // logo：设计稿 700 宽、(25,160)；宽高比由贴图决定
        const logo = createSprite(this.body, 'Logo', {
            path: ASSET.SPLASH_LOGO, aspectW: 700, x: ex(25, 700), y: ey(160, 200),
        });
        this.settleIn(logo, 0.08);
    }

    // ---- 点缀：骰子（右）/ 铜钱（左）----
    private buildProps(): void {
        // 骰子：容器 190×190 @ (552,436)；图 120 宽 @ 容器内 (41,39)、rotate(-12°)
        const d = createNode('PropDice', this.body, { w: 190, h: 190, x: ex(552, 190), y: ey(436, 190) });
        this.propGlow(d, 190);
        const di = createSprite(d, 'Img', { path: ASSET.SPLASH_DICE, aspectW: 120 });
        di.setPosition(41 - 95 + 60, -(39) + 95 - 60, 0);
        di.angle = -12;
        this.settleIn(d, 0.34);

        // 铜钱：容器 170×170 @ (34,472)；图 88 宽 @ 容器内 (44,50)、rotate(-10°)
        const c = createNode('PropCoin', this.body, { w: 170, h: 170, x: ex(34, 170), y: ey(472, 170) });
        this.propGlow(c, 170);
        const ci = createSprite(c, 'Img', { path: ASSET.SPLASH_COIN, aspectW: 88 });
        ci.setPosition(44 - 85 + 44, -(50) + 85 - 44, 0);
        ci.angle = -10;
        this.settleIn(c, 0.48);
    }

    private propGlow(parent: Node, size: number): void {
        const { node, g } = createGraphicsNode('Glow', parent, { w: size, h: size });
        fillRadialGlow(g, 0, 0, size / 2, '#F6C445', 66, 12);
        tween(node)
            .repeatForever(
                tween(node).to(1.8, { scale: v3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
                    .to(1.8, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();
    }

    // ---- 吉祥物 + 接触投影 ----
    private buildMascot(): void {
        // 接触投影（205,968 → 340×56）—— 定稿 `.contactShadow`：
        //   radial-gradient(closest-side, rgba(0,0,0,.38), rgba(0,0,0,.16) 55%, transparent 75%)
        // ⚠️ 元素是 **340×56 的扁椭圆**（6:1），画成正圆会变成脚下一团黑饼。
        const { g: sg } = createGraphicsNode('ContactShadow', this.body, {
            w: 340, h: 56, x: ex(205, 340), y: ey(968, 56),
        });
        fillRadialGlowE(sg, 0, 0, 170, 28, '#000000', 97, 16);

        // 吉祥物（top 560，宽 480 居中）
        const wrap = createNode('Mascot', this.body, { w: DW, h: 480, x: 0, y: ey(560, 480) });
        const img = createSprite(wrap, 'Img', { path: ASSET.SPLASH_MASCOT, aspectW: 480 });
        // 悬浮呼吸（3.4s 往复、±12px）
        tween(img)
            .repeatForever(
                tween(img).to(1.7, { position: v3(0, 12, 0) }, { easing: 'sineInOut' })
                    .to(1.7, { position: v3(0, 0, 0) }, { easing: 'sineInOut' }),
            ).start();
        this.spark(wrap, 118 + 10 - DW / 2, 110 + 10, 20, 0);
        this.spark(wrap, DW - 128 - 14 + 7 - DW / 2, 64 + 7, 14, 0.9);
        this.spark(wrap, DW - 86 - 11 + 5.5 - DW / 2, 250 + 5.5, 11, 1.7);
        this.settleIn(wrap, 0.22);
    }

    /** 四角星（clip-path 多边形的等价物） */
    private spark(parent: Node, x: number, y: number, size: number, delay: number): void {
        const { node, g } = createGraphicsNode('Spark', parent, { w: size, h: size, x, y });
        const h = size / 2;
        g.fillColor = hex2color('#FFE08A');
        g.moveTo(0, h); g.lineTo(h * 0.22, h * 0.22); g.lineTo(h, 0); g.lineTo(h * 0.22, -h * 0.22);
        g.lineTo(0, -h); g.lineTo(-h * 0.22, -h * 0.22); g.lineTo(-h, 0); g.lineTo(-h * 0.22, h * 0.22);
        g.close(); g.fill();
        node.setScale(v3(0.7, 0.7, 1));
        MotionFx.after(delay * 1000, () => {
            if (!node.isValid) return;
            tween(node)
                .repeatForever(
                    tween(node).to(1.3, { scale: v3(1.15, 1.15, 1), angle: 18 }, { easing: 'sineInOut' })
                        .to(1.3, { scale: v3(0.7, 0.7, 1), angle: 0 }, { easing: 'sineInOut' }),
                ).start();
        });
    }

    /** 统一入场：opacity 0→255 + y 上浮 26 + scale .96→1（对应 CSS 的 settle 关键帧） */
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

    // ---- 进度条 ----
    //
    //  ★ 第 34 轮修 bug：填充**不生长**。
    //    旧实现 `_setProgress` 只改外层 `BarFill` 的 `setContentSize`，
    //    而里面那张 85×34 的 `Fill` 贴图节点尺寸**从没变过** ⇒ 无论进度多少，
    //    看到的永远是同一小截金子（用户截图里 "100%" 却只亮 1/4 就是这个）。
    //    现在两层一起改，并按定稿稿补上**填充头部辉光圆点**（`.loadfill::after`）。
    private buildProgress(): void {
        const track = createNode('BarTrack', this.body, {
            w: 530, h: 44, x: ex(110, 530), y: ey(1092, 44),
        });
        createSprite(track, 'Track', { path: ASSET.SPLASH_BAR_TRACK, w: 530, h: 44 });

        // 填充：左锚点（x 固定在内缩 5 处，宽度随进度改）—— 定稿 `.loadfill{left:5px;top:5px}`
        const holder = createNode('BarFill', track, {
            w: 17, h: 34, anchor: [0, 0.5], x: -265 + 5, y: 0,
        });
        this._barFill = holder;
        this._barSprite = createSprite(holder, 'Fill', {
            path: ASSET.SPLASH_BAR_FILL, w: 85, h: 34, anchor: [0, 0.5],
        });
        // 头部辉光点：跟着填充右端走（定稿 `radial-gradient(circle at 40% 35%, #FFF3C4, gold 62%)` + 外发光）
        const head = createNode('HeadDot', holder, { w: 18, h: 18, anchor: [0, 0.5], x: 85, y: 0 });
        const { g: hg } = createGraphicsNode('Dot', head, { w: 18, h: 18 });
        fillRadialGlow(hg, 0, 0, 11, '#F6C445', 210, 6);
        fillRadialGlow(hg, -1.5, 1.5, 7, '#FFF3C4', 255, 4);
        tween(head)
            .repeatForever(
                tween(head).to(1.1, { scale: v3(1.25, 1.25, 1) }, { easing: 'sineInOut' })
                    .to(1.1, { scale: v3(1, 1, 1) }, { easing: 'sineInOut' }),
            ).start();
        this._barHead = head;

        this._pct = createLabel(this.body, '0%', {
            fontSize: 28, color: COLOR.GOLD, bold: true, w: 530, h: 40,
            x: 0, y: ey(1092 + 44 + 14, 40),
        });

        // 扫光（装饰）—— 定稿 `.loadsweep`
        const sweep = createNode('Sweep', track, { w: 150, h: 32, x: -265 + 75, y: 0 });
        const { g: sg } = createGraphicsNode('SweepG', sweep, { w: 150, h: 32 });
        fillRoundRect(sg, 0, 0, 150, 32, 16, '#FFFFFF', 40);
        tween(sweep)
            .repeatForever(
                tween(sweep)
                    .to(1.4, { position: v3(190, 0, 0) }, { easing: 'sineInOut' })
                    .to(0.01, { position: v3(-265 + 75, 0, 0) })
                    .delay(1.0),
            ).start();

        this.settleIn(this._pct.node, 0.62);
    }

    // ---- 健康忠告 ----
    private buildNotice(): void {
        const w = 590;
        const grp = createNode('Notice', this.body, { w, h: 120, x: ex(80, w), y: ey(1212, 120) });

        const { g } = createGraphicsNode('Lines', grp, { w, h: 24, y: 42 });
        const titleW = estTextWidth('健康游戏忠告', 24) + 24;
        g.fillColor = hex2color('#F6C445', 96);
        const seg = (w - titleW) / 2;
        g.rect(-w / 2, -0.5, seg, 1); g.fill();
        g.rect(titleW / 2, -0.5, seg, 1); g.fill();

        createLabel(grp, '健康游戏忠告', { fontSize: 24, color: COLOR.CREAM, bold: true, w, h: 24, y: 42 });
        createLabel(grp, '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。', {
            fontSize: 18, color: '#DCEBDF', w, h: 22, y: 4,
        });
        createLabel(grp, '适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。', {
            fontSize: 18, color: '#DCEBDF', w, h: 22, y: -22,
        });
        this.settleIn(grp, 0.74);
    }

    // ========================================================
    //  入场
    // ========================================================
    protected onEnter(): void {
        const t0 = Date.now();

        // 音效也一并预热（音效全在主包 audio/，不参与分包）
        AudioService.preloadAll(['audio/dice_roll', 'audio/tile_pick', 'audio/peng', 'audio/chi', 'audio/tool_use', 'audio/button']);

        this._bundleDone = 0;
        this._bundleTotal = BUNDLES.length;
        this._total = 0;                 // 贴图总数要等分包就绪后才算得出来
        this._setProgress(0);

        // ① 先拉两张分包（home / game），② 再拉全部贴图。
        //    严格说调换顺序也不会坏 —— `loadFrame` 里的 `ensureBundle` 会自动补加载；
        //    但显式先拉一次的好处是进度条能把"分包下载"和"贴图解析"分开显示，
        //    真机上不会出现"卡在 0% 很久、然后一下跳到 90%"的观感。
        preloadBundles([...BUNDLES], (done) => { this._bundleDone = done; })
            .then(() => {
                if (this._left || !this.node.isValid) return;

                const paths = allTexturePaths();
                this._total = paths.length;

                preloadAll(paths, (ok, total) => {
                    this._loaded = ok;
                    if (ok < total) {
                        console.warn(
                            `[SplashPage] 预加载完成度 ${ok}/${total} —— 有资源没进包，`
                            + '检查 assets/bundles/home/ 、 assets/bundles/game/ 与 assets/resources/',
                        );
                    }
                    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - t0));
                    this.timers.add(wait + 140, () => {
                        if (!this.node.isValid) return;
                        this.goto(PAGE.HOME);
                    });
                });
            });

        // 进度平滑推进（读的是真实计数，只是把跳变抹平）
        const tick = (): void => {
            if (this._left || !this.node.isValid) return;
            const bundleFrac = this._bundleTotal > 0
                ? Math.min(1, this._bundleDone / this._bundleTotal) : 1;
            const texFrac = this._total > 0 ? Math.min(1, this._loaded / this._total) : 0;
            const frac = bundleFrac * BUNDLE_WEIGHT + texFrac * (1 - BUNDLE_WEIGHT);
            const timeFrac = Math.min(0.92, ((Date.now() - t0) / MIN_SHOW_MS) * 0.92);
            const done = this._total > 0 && this._loaded >= this._total;
            this._setProgress(done ? 1 : Math.max(frac, timeFrac));
            if (!done) this.timers.add(60, tick);
        };
        this.timers.add(60, tick);
    }

    private _setProgress(k: number): void {
        const v = Math.max(0, Math.min(1, k));
        // 轨道内可用宽 520（530 − 左右各 5）；最窄给 20 保底
        const w = Math.max(20, 520 * v);
        if (this._barFill && this._barFill.isValid) {
            this._barFill.getComponent(UITransform)!.setContentSize(w, 34);
        }
        // ★ 修 bug 的关键一行：外层容器改了尺寸，**里面的贴图节点不会自己跟着变**，
        //   必须同步改它，否则进度条永远显示同一小截。
        if (this._barSprite && this._barSprite.isValid) {
            this._barSprite.getComponent(UITransform)!.setContentSize(w, 34);
        }
        // 头部辉光点贴在填充右端（左锚点节点 ⇒ 局部 x 就是宽度）
        if (this._barHead && this._barHead.isValid) {
            this._barHead.setPosition(w, 0, 0);
        }
        if (this._pct && this._pct.isValid) this._pct.string = `${Math.round(v * 100)}%`;
    }

    protected onLeave(): void {
        this._left = true;
    }
}
