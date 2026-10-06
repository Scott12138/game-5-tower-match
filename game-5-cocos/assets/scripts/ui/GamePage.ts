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
 *  ① **可点判定只有一个真源**：`Board.pickable()`（限定当前段 + 覆盖 < 18%）。
 *     牌面的"亮/暗"直接由它派生 —— **绝不允许**用 `tile.cover` 另算一遍。
 *     两者一旦分叉，表现是"看着能点、点了没反应"，或反之，且完全不报错。
 *  ② **数据先行、视觉后到**：点牌的瞬间就把数据入槽（而不是等飞行动画结束）。
 *     否则玩家连点时会计数错乱 —— 这类 bug 在飞行 0.26s 的窗口里高频复现。
 *  ③ **分段是逻辑分段**，全堆同时在桌；不可点的牌**不是因为被压，而是"还没轮到"**。
 *     所以从下层露出来但不在当前段的牌，视觉上仍然是暗的（由 ① 统一派生）。
 *
 *  ── 调试桥 ───────────────────────────────────────────────
 *  `globalThis.__game5` 暴露 state / pickables / pick —— **无头验收脚本靠它**。
 *  `pick()` 与真实触摸走**同一个**处理函数，所以"脚本能打通"等价于"手指能打通"。
 * ============================================================
 */

import { Input, Node, Sprite, Texture2D, UIOpacity, UITransform, _decorator, input, tween, v3 } from 'cc';

import { ASSET, COLOR, DEBUG, FONT, LAYOUT, PAGE, PLAY, SFX, SKIN, TOOL, TOOL_ICON, TOOL_META,
    TOOL_ORDER, timeLimitOf } from '../CFG';
import { PageBase } from './PageBase';
import { Layout } from './Layout';
import { EASE, MotionFx } from './MotionFx';
import { AudioService } from './AudioService';
import { Haptics } from './Haptics';
import { SaveService } from '../core/SaveService';
import { LEVELS, type LevelDef } from '../core/LevelData';
import { Board, makeBoard } from '../core/Board';
import { findMatch, allMatches, MATCH_LABEL, type MatchType } from '../core/MatchRule';
import { currentRun, endRun, reviveLeft, useRevive, useRunItem } from '../core/Gift';
import { faceLabel, spritePath } from '../core/TileData';
import {
    createGraphicsNode, createLabel, createNode, createSprite,
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
 *   `.ribbonTop` top:−34px / 88px 重墨描边
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
    PAD_TOP: 44,
    PAD_BOTTOM: 40,
    RIBBON_FONT: 88,
    /**
     * 缎带 Label 的**实测**高度 —— **不是**传进去的 `h: 110`。
     *
     * 【为什么必须写成实测值】`createLabel` 在 `overflow: NONE` 下把 contentSize
     *   交给引擎按"文本 + 描边"重算：88 号字 + 8px 描边实测得到 **155**。
     *   布局里凡是"要让开缎带"的地方都必须用 155 算 —— 按 110 算会少让开 22.5，
     *   然后你会看到一个"明明留了间距却仍然贴着"的诡异现象。
     *   （第 38 轮实测：`--page result --depth 5` 打印 `Label 326 ± 77.5`。）
     */
    RIBBON_H: 155,
    /** 缎带中心相对卡顶**向上**的偏移（骑缝：一半压在卡顶之上） */
    RIBBON_LIFT: 34,
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
    MASCOT_MT: 30,
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

    // ---- 状态 ----
    private _locked = false;
    /** 点按序号 —— 输入锁看门狗的归属校验（见 `onTapTile` 注释） */
    private _lockSeq = 0;
    private _over = false;
    private _paused = false;
    private _cleared = 0;
    private _timeLeft = 0;
    private _totalTime = 0;
    private _addSlotUsed = 0;

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
        this.buildToolBar();

        this._topLayer = createNode('TopLayer', this.body, { w: 1, h: 1 });

        this.refreshAllStates();
        this.log(`关卡 ${this._level} · ${this._def.n} 张 / ${this._def.layers} 层 / ${this._def.segs.length} 段`);
    }

    /** 离开本页：把挂在**全局 input** 上的规则页兜底监听摘掉（否则会跨页残留） */
    protected onLeave(): void {
        this.detachRuleTap();
        this.uninstallDebugBridge();
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

        const cw = LAYOUT.SLOT_CELL.w;
        const gap = LAYOUT.SLOT_CELL.gap;
        for (let i = 0; i < this._slotMax; i++) {
            const left = i * (cw + gap);
            const cell = createNode(`Slot${i}`, bar, {
                w: cw, h: LAYOUT.SLOT_CELL.h,
                x: -LAYOUT.SLOT_BAR.w / 2 + left + cw / 2,
            });
            const { g } = createGraphicsNode('G', cell, { w: cw, h: LAYOUT.SLOT_CELL.h });
            this.paintSlotCell(g, false, true);
            this._slotCells.push(cell);
            this._slotNodes.push(null);
        }
    }

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
    ): void {
        g.clear();
        const w = LAYOUT.SLOT_CELL.w;
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

    private refreshTools(): void {
        const run = currentRun();
        TOOL_ORDER.forEach((id, i) => {
            const n = run ? (run.items[id] ?? 0) : 0;
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
                face.fillColor = hex2color(n > 0 ? SKIN.TOOL.FILL : SKIN.TOOL.FILL_EMPTY);
                face.roundRect(-LAYOUT.TOOL_CELL.w / 2, -LAYOUT.TOOL_CELL.h / 2,
                    LAYOUT.TOOL_CELL.w, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS);
                face.fill();
                const lineColor = n > 0 ? SKIN.TOOL.LINE_ON : SKIN.TOOL.LINE;
                face.lineWidth = 2;
                face.strokeColor = hex2color(lineColor);
                face.roundRect(-LAYOUT.TOOL_CELL.w / 2, -LAYOUT.TOOL_CELL.h / 2,
                    LAYOUT.TOOL_CELL.w, LAYOUT.TOOL_CELL.h, SKIN.TOOL.RADIUS);
                face.stroke();
            }
            cell.setSiblingIndex(TOOL_ORDER.length - 1);   // 保持顺序不变（占位，防意外乱序）
        });
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
        const k = Math.min(SLOT_BOX.w / this._def.w, SLOT_BOX.h / this._def.h) / this._tableScale;

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
        const node = createNode(`SlotTile${slotIdx}`, cell, { w: SLOT_BOX.w, h: SLOT_BOX.h });
        const k = Math.min(SLOT_BOX.w / this._def.w, SLOT_BOX.h / this._def.h);
        const w = Math.round(this._def.w * k);
        const h = Math.round(this._def.h * k);

        const holder = createNode('Img', node, { w, h });
        const sp = holder.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        holder.active = false;
        loadFrame(spritePathOf(face), (sf) => {
            if (!node.isValid) return;
            if (!sf) { drawFallbackFace(holder, face, w, h); return; }
            sp.spriteFrame = sf;
            holder.getComponent(UITransform)!.setContentSize(w, h);
            holder.active = true;
        });
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
        this._slotCells.forEach((c, i) => {
            const g = c.getChildByName('G')?.getComponent(GraphicsCtor);
            // 第 3 参 = 本格是否为空（决定画不画中心短横）—— 真源里短横只属于 `.slot.empty`
            if (g) this.paintSlotCell(g, danger && this._slots.length > 0, this._slotNodes[i] === null);
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
                this.timer(240, () => this.onFail('slotsFull'));
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
        this.popToast(m.type);
        // 碰 / 吃 **各自一条人声念白**（第 42 轮从隔壁麻将项目复用）。
        // ⚠️ 传的是 `m.type`（'peng' | 'chi'），曾把这里写成 `m.kind` ⇒ undefined，
        //    所有"碰"都会被静默播成"吃"—— 这类错别字不报错，只能靠耳朵听出来。
        AudioService.playSfx(m.type === 'peng' ? SFX.peng : SFX.chi, 1.0);
        Haptics.medium();

        // ★ 摘出**不会被消掉的**槽内节点，交给 300ms 后的重排 ——
        //    必须在 `_slots` / `_slotNodes` 改动**之前**（见 `takeSurvivors` / `relayoutSlots`）。
        //    ⚠️ 这一步早先漏了，直接导致"消除一次之后槽里剩下的牌全部变空白"。
        this._pendingKeep = this.takeSurvivors(gone);

        // 再从数据里摘掉（**立即**，不等动画）
        this._slots = this._slots.filter((_, i) => !gone.includes(i));
        this._cleared += gone.length;

        // 视觉：爆开 → 移除 → 槽位重排
        for (const si of gone) {
            const n = this._slotNodes[si];
            if (n?.isValid) {
                tween(n)
                    .to(0.26, { scale: v3(1.45, 1.45, 1), angle: 14 }, { easing: 'backOut' })
                    .start();
                const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
                MotionFx.fadeTo(op, 0, 0.26);
                const dead = n;
                this.timer(280, () => { if (dead.isValid) dead.destroy(); });
            }
        }
        // ⚠️ 必须是 `fill(null)` 而不是 `[]`：`refreshSlotDanger()` 靠 `=== null` 判"空格"，
        //    空数组读出来的是 `undefined`，会让**所有格子都被当成"有牌"**（短横不画）。
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);
        this.timer(300, () => {
            this.relayoutSlots();
            this.refreshProgress();
            SaveService.instance.addCleared(gone.length);
            this.checkBoardEmpty();
            this.refreshSlotDanger();
        });
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
     * 牌堆是否已清空 → 收局判胜负。
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
        const seq = ++this._endSeq;
        this.timer(PLAY.END_SETTLE_MS, () => {
            if (this._over || this._endSeq !== seq) return;   // 局面又变了 → 作废
            const b = this._board;
            if (!b || b.remaining > 0) return;
            if (this._slots.length === 0) this.onWin();
            else this.onFail('boardEmptySlotsLeft');
        });
    }

    // ========================================================
    //  道具
    // ========================================================
    private useTool(id: string): void {
        if (this._over || this._paused) return;
        const run = currentRun();
        const n = run ? (run.items[id as keyof typeof run.items] ?? 0) : 0;
        if (n <= 0) {
            this.openAd(id);
            return;
        }

        let used = false;
        switch (id) {
            case TOOL.ERASE: used = this.toolErase(); break;
            case TOOL.MOVE: used = this.toolMove(); break;
            case TOOL.SHUFFLE: used = this.toolShuffle(); break;
            case TOOL.ADD_SLOT: used = this.toolAddSlot(); break;
            default: break;
        }
        if (!used) return;

        useRunItem(id as never);
        this.refreshTools();
        AudioService.playSfx(SFX.toolUse, 1.0);
        Haptics.medium();
        toast(this.body, `已使用 ${TOOL_META[id as keyof typeof TOOL_META].name}`);
    }

    /** 消除：把槽内**已存在的一组**直接消掉 */
    private toolErase(): boolean {
        const board = this._board;
        if (!board) return false;
        const faces = this._slots.map((i) => board.tiles[i].face);
        const groups = allMatches(faces);
        if (groups.length === 0) {
            toast(this.body, '槽内还没有可消除的组合');
            return false;
        }
        const gone = groups[0].indices.slice();
        // ★ 与 `resolveMatch` 同口径：先摘存活节点，再动数据（见 `takeSurvivors`）
        this._pendingKeep = this.takeSurvivors(gone);
        this._slots = this._slots.filter((_, i) => !gone.includes(i));
        this._cleared += gone.length;
        SaveService.instance.addCleared(gone.length);

        // 视觉
        for (const si of gone) {
            const nd = this._slotNodes[si];
            if (nd?.isValid) {
                tween(nd).to(0.3, { scale: v3(0, 0, 1), angle: 40 }, { easing: 'quadIn' }).start();
                const dead = nd;
                this.timer(320, () => { if (dead.isValid) dead.destroy(); });
            }
        }
        this._slotNodes = new Array<Node | null>(this._slotMax).fill(null);
        this.timer(340, () => {
            this.relayoutSlots();
            this.refreshProgress();
            this.refreshSlotDanger();
            this.checkBoardEmpty();
        });
        return true;
    }

    /** 移出：把槽里最后一张退回桌上 */
    private toolMove(): boolean {
        const board = this._board;
        if (!board || this._slots.length === 0) {
            toast(this.body, '槽里没有牌可移出');
            return false;
        }
        const slotIdx = this._slots.length - 1;
        const tileIdx = this._slots.pop()!;
        board.restore(tileIdx);

        const nd = this._slotNodes[slotIdx];
        if (nd?.isValid) {
            // 飞回桌上的原位
            const view = this._views[tileIdx];
            const boardNode = this._boardNode;
            if (view && boardNode) {
                const t = board.tiles[tileIdx];
                const target = v3(board.engineX(t), board.engineY(t), 0);
                const from = nd.position.clone();
                const worldFrom = nd.getWorldPosition();
                const localFrom = boardNode.getComponent(UITransform)!.convertToNodeSpaceAR(worldFrom);
                nd.setParent(boardNode);
                nd.setPosition(localFrom);
                nd.setScale(v3(Math.min(SLOT_BOX.w / this._def.w, SLOT_BOX.h / this._def.h) / this._tableScale,
                    Math.min(SLOT_BOX.w / this._def.w, SLOT_BOX.h / this._def.h) / this._tableScale, 1));
                tween(nd)
                    .to(0.26, { position: target, scale: v3(1, 1, 1) }, { easing: 'quadOut' })
                    .start();
                this.timer(280, () => {
                    if (nd.isValid) nd.destroy();
                    view.resetToBoard(board.engineX(t), board.engineY(t));
                    this.refreshAllStates();
                });
                void from;
            } else {
                nd.destroy();
            }
        }
        this._slotNodes[slotIdx] = null;
        this.refreshSlotDanger();
        this.log(`移出：牌 #${tileIdx} 回到桌上`);
        return true;
    }

    /** 洗牌：重排桌上未消牌的位置 */
    private toolShuffle(): boolean {
        const board = this._board;
        if (!board) return false;
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
        const cardH = RESULT.PAD_TOP + RESULT.MASCOT_MT + RESULT.MASCOT_H + RESULT.MASCOT_MB
            + RESULT.DESC_H + RESULT.DESC_MB
            + (REWARDS ? RESULT.REWARD_H + RESULT.REWARD_MB : 0)
            + RESULT.BTN_GOLD_H + RESULT.BTN_GOLD_MB + RESULT.BTN_GHOST_H + RESULT.PAD_BOTTOM;

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

        // ③ 顶部缎带标题：压在卡顶之上 34px
        const ribbon = createLabel(card, win ? '通关啦！' : '就差一点！', {
            fontSize: RESULT.RIBBON_FONT, color: COLOR.CREAM, bold: true, serif: true,
            outline: '#4A2B18', outlineWidth: 8,
            w: RESULT.CARD_W + 120, h: RESULT.RIBBON_H, y: RESULT.RIBBON_LIFT,
        });
        // 缎带的"厚底"：#5C361D 向下偏移 8px（照抄 text-shadow 的 0 8px 0）
        const { g: rg } = createGraphicsNode('RibbonShadow', card, {
            w: RESULT.CARD_W + 120, h: 110, y: 26,
        });
        void rg;
        ribbon.node.setSiblingIndex(999);          // 缎带永远在最上（含盖过吉祥物）

        // 起点 = 缎带下沿让开后的位置。
        //  缎带覆盖卡顶 −111.5 ~ **+43.5**（= RIBBON_H/2 − RIBBON_LIFT），
        //  所以 `PAD_TOP + MASCOT_MT = 74` 与它留出 30.5 的呼吸量 —— 这个关系是
        //  **算出来的**，不是手感；改 RIBBON_H / RIBBON_LIFT / MASCOT_MT 任一项都要重核。
        let cur = RESULT.PAD_TOP;

        // ④ 吉祥物位
        cur += RESULT.MASCOT_MT;
        const mascotY = -(cur + RESULT.MASCOT_H / 2);
        const mascot = createSprite(card, 'Mascot', {
            path: ASSET.SPLASH_MASCOT, aspectW: RESULT.MASCOT_W, y: mascotY,
        });
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
                    toast(this.body, '分享功能待接入微信开放能力');
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
        cur += RESULT.BTN_GHOST_H + RESULT.PAD_BOTTOM;
        // ★ 自检：内容总高必须**恰好**等于卡高。
        //   两者不同步时卡片底部会莫名其妙多/少一截留白，而**不会有任何报错**
        //   （第 38 轮就是这么漏掉 `MASCOT_MB` 的）。用 dev 期的 console.warn 喊出来 ——
        //   release 构建里 `cc.warn` 是空函数，所以这里用 console。
        if (Math.abs(cur - cardH) > 0.5) {
            console.warn(`[结算弹层] cardH(${cardH}) ≠ 内容总高(${cur})，差 ${(cur - cardH).toFixed(1)}`
                + ' —— 检查 openResult 里 cardH 与 cur 两处累加是否同步');
        }

        // ⑨ 胜态：金币雨（全局唯一峰值）—— z 在卡之上（照抄视觉稿 .coins z-index:8 > .modal:7）
        if (win) this.coinRain(layer, vs.width, vs.height);

        // ⑩ 入场：蒙层淡入 + 卡片从 0.92 弹入
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

    /** 失败原因 → 副标题文案（照抄视觉稿口径：「还剩 5 张 · 槽位已满」） */
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

    /** 看广告复活（A1：1 次/局）—— 补一次复活机会，**这局继续**，所以不走 endRun() */
    private adRevive(): void {
        if (!this._over) return;
        AudioService.playSfx(SFX.button, 1.0);
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
        if (this._paused) { this.timer(200, () => this.tickTimer()); return; }

        if (this._timeLeft <= 0) {
            this.onFail('timeout');
            return;
        }
        this.updateTimerLabel();
        this.timer(1000, () => {
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
            endRun();
            this.close(PAGE.HOME);
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

    /** 道具不足 → 看广告补 1 个（**只进本局道具栏**，与赠礼同规） */
    private openAd(id: string): void {
        if (!this._topLayer) return;
        if (this._topLayer.getChildByName('AdPanel')?.isValid) return;
        this._paused = true;

        const vs = this.visible();
        const layer = createNode('AdPanel', this._topLayer, { w: 1, h: 1 });
        layer.addComponent(UIOpacity).opacity = 0;

        const { g: sg } = createGraphicsNode('Scrim', layer, { w: vs.width, h: vs.height });
        fillRoundRect(sg, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#000000', 214);

        const card = createNode('AdCard', layer, { w: 560, h: 520 });
        const { g: cg } = createGraphicsNode('Bg', card, { w: 560, h: 520 });
        fillRoundRect(cg, 0, 0, 560, 520, 40, 'rgba(9,18,13,0.98)', 255);
        strokeRoundRect(cg, 0, 0, 560, 520, 40, 'rgba(246,196,69,0.30)', 2.5, 255);

        createLabel(card, '补充道具', {
            fontSize: 38, color: COLOR.CREAM, bold: true, serif: true, w: 520, h: 48, y: 200,
        });
        createSprite(card, 'Icon', { path: TOOL_ICON[id as keyof typeof TOOL_ICON], aspectW: 110, y: 96 });
        createLabel(card, `${TOOL_META[id as keyof typeof TOOL_META].name} ×1`, {
            fontSize: 30, color: COLOR.GOLD_HI, bold: true, w: 520, h: 40, y: 16,
        });

        // 进度条
        const bar = createNode('Bar', card, { w: 400, h: 16, y: -44 });
        const bg = bar.addComponent(GraphicsCtor);
        const secLabel = createLabel(card, '5', {
            fontSize: 24, color: COLOR.CREAM_MUTE, w: 520, h: 30, y: -84,
        });
        createLabel(card, '仅限本局使用 · 不累计、不跨局', {
            fontSize: 20, color: COLOR.CREAM_MUTE, w: 520, h: 28, y: -126,
        });
        this.panelButton(card, -196, '跳过', 'ghost', () => this.closeAd(id, false));

        // 5 秒进度（用 timers 驱动，状态不依赖 tween 回调）
        const AD_SEC = 5;
        let left = AD_SEC;
        const paint = (): void => {
            drawProgressBar(bg, 1 - left / AD_SEC, 400, 16, 8, 'rgba(255,247,230,0.12)', COLOR.GOLD_HI, COLOR.GOLD);
        };
        paint();
        const step = (): void => {
            if (!layer.isValid) return;
            left -= 0.1;
            if (left <= 0) { this.closeAd(id, true); return; }
            paint();
            if (secLabel.isValid) secLabel.string = String(Math.ceil(left));
            this.timer(100, step);
        };
        this.timer(100, step);

        MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.22);
    }

    private closeAd(id: string, grant: boolean): void {
        const l = this._topLayer?.getChildByName('AdPanel');
        this._paused = false;
        if (l?.isValid) {
            const op = l.getComponent(UIOpacity)!;
            MotionFx.fadeTo(op, 0, 0.2);
            const dead = l;
            this.timer(240, () => { if (dead.isValid) dead.destroy(); });
        }
        if (grant) {
            const run = currentRun();
            if (run) {
                run.items[id as keyof typeof run.items] = (run.items[id as keyof typeof run.items] ?? 0) + 1;
            }
            this.refreshTools();
            toast(this.body, `获得 ${TOOL_META[id as keyof typeof TOOL_META].name} ×1 —— 仅限本局使用`);
        }
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
        // 预加载音效（本局要用的）
        AudioService.preloadAll([SFX.tilePick, SFX.peng, SFX.chi, SFX.slotWarn, SFX.toolUse, SFX.shuffle, SFX.revive]);
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
