/**
 * ============================================================
 *  AdDialog.ts · 「替身广告面板」（mock 模式专用 · 主玩页 / 首页共用）
 * ============================================================
 *
 *  【为什么要有它，而不是各页面各写一份】
 *    "没有广告位时让链路仍然可走完"是**同一个需求**，而它出现在两个地方：
 *      · ④ 主玩页 —— 复活（A1）与换道具（A2）；
 *      · ② 首页 —— 道具商城的每日免费领（A3）。
 *    各写一份的代价不是多几十行，而是两处会**慢慢长得不一样**
 *    （文案、秒数、进度条、幂等收口），最终变成"验证过这一屏 ≠ 验证过那一屏"。
 *    ⇒ 面板与结算幂等收在这一个文件里；调用方只管两件事：
 *      ① 「播之前」要把自己的暂停态置上、播完复位；
 *      ② 「拿到结局之后」要不要发奖（**本文件不发任何奖励**）。
 *
 *  【界面上如实标「演示用 · 当前尚未接入广告位」】
 *    它不是"假装有广告"，而是"没有广告位时让链路可走完"的替身。
 *    一旦 `CFG.AD.REAL_ENABLED` 打开且配上 adUnitId，
 *    `AdService.modeOf()` 会给出 `real`，这块面板**根本不会被走到**。
 *
 *  【为什么不定时器自己管】
 *    进度全靠调用方传进来的 `schedule`（页面级 `timers`）驱动 ——
 *    页面一离开，`TimerBag` 自动清空，不会留下"页面没了但定时器还在跑"的幽灵。
 *    历史教训：状态挂在 tween 回调上的面板，在快速切页时最容易留一张半透明贴纸在屏上。
 *
 *  【三种结局】
 *    `end`   进度走完（等价于"看完了"）
 *    `abort` 玩家点「跳过」
 *    `fail`  面板被销毁 / 环境异常
 *    ⚠️ 本文件只负责**如实返回**，不负责"该不该发奖励" —— 那是调用方的判据。
 * ============================================================
 */

import { Graphics, Node, UIOpacity, tween, v3 } from 'cc';
import { AD, COLOR } from '../CFG';
import type { AdOutcome } from '../core/AdService';
import {
    createGraphicsNode, createLabel, createNode, createSprite, drawProgressBar,
    fillRoundRect, strokeRoundRect, visibleSize,
} from './UIFactory';
import { MotionFx } from './MotionFx';

/** 替身面板要显示的内容 */
export interface MockAdUi {
    /** 卡顶标题，如「获取道具」 */
    title: string;
    /** 中间的道具图标（可选；没有就只留文字） */
    icon?: string;
    /** 图标下方的金色文字，如「▸ 消除 ×1」 */
    sub: string;
    /** 秒数；缺省取 `CFG.AD.MOCK_SECONDS`（5） */
    seconds?: number;
}

export interface MockAdHandle {
    /** 面板根节点（调用方一般不用管，留给"要另挂东西"的场景） */
    readonly node: Node;
    /** 面板还在屏上？ */
    readonly alive: boolean;
    /**
     * 结算（幂等）：返回 `true` = **本次真的结算了**。
     * 重复调用、面板已销毁 ⇒ 返回 `false` —— 调用方据此避免"结算两次发两份奖励"。
     */
    settle(o: AdOutcome): boolean;
}

/** 按下缩一下、抬起回弹（与 `GamePage.tap` 同款手感） */
function tapWithFeedback(node: Node, onClick: () => void): void {
    node.on(Node.EventType.TOUCH_START, () => {
        tween(node).to(0.07, { scale: v3(0.94, 0.94, 1) }).start();
    }, node);
    const release = (): void => {
        tween(node).to(0.14, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
    };
    node.on(Node.EventType.TOUCH_END, () => { release(); onClick(); }, node);
    node.on(Node.EventType.TOUCH_CANCEL, release, node);
}

/**
 * 打开替身广告面板。
 *
 * ⚠️ 调用方**必须先自己**判断 `AdService.modeOf(scene) !== 'real'` 再调这里 ——
 *    本函数不做环境嗅探，它只是"一块面板"。判断集中在 `playAd` 那一处，别分散。
 */
export function openMockAdDialog(opts: {
    /** 面板挂到哪（主玩页 = `_topLayer`；首页 = `body`） */
    parent: Node;
    /** 节点名（默认 `AdPanel`；调用方用它做"已经开着就别再开"的幂等判断） */
    name?: string;
    ui: MockAdUi;
    /** 页面级定时器（`PageBase.timers`）—— 页面离开时自动清空 */
    schedule: (ms: number, cb: () => void) => void;
    /** ★ 每次**真的结算**时回调一次（含 `settle()` 被外部强制调用的情况） */
    onSettle: (o: AdOutcome) => void;
}): MockAdHandle {
    const name = opts.name ?? 'AdPanel';
    const ui = opts.ui;
    const seconds = Math.max(1, ui.seconds ?? AD.MOCK_SECONDS);

    const vs = visibleSize();
    const layer = createNode(name, opts.parent, { w: 1, h: 1 });
    layer.addComponent(UIOpacity).opacity = 0;

    // ---- 遮罩：1.4× 全屏，保证边缘 20% 也能被点/被盖住 ----
    const { g: sg } = createGraphicsNode('Scrim', layer, { w: vs.width, h: vs.height });
    fillRoundRect(sg, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#000000', 214);

    // ⚠️ 卡高 600 → **520**：旧版多出来的 80 是给「分享给好友」那颗按钮的，
    //    该按钮已按合规口径删除 ⇒ 一并收回。改这里必须同步改下面每个 y
    //    （卡片是**居中**的，y 一错就会戳出卡外，且不会有任何报错）。
    const CW = 560, CH = 520;
    const card = createNode('AdCard', layer, { w: CW, h: CH });
    const { g: cg } = createGraphicsNode('Bg', card, { w: CW, h: CH });
    fillRoundRect(cg, 0, 0, CW, CH, 40, 'rgba(9,18,13,0.98)', 255);
    strokeRoundRect(cg, 0, 0, CW, CH, 40, 'rgba(246,196,69,0.30)', 2.5, 255);

    createLabel(card, ui.title, {
        fontSize: 38, color: COLOR.CREAM, bold: true, serif: true, w: 520, h: 48, y: 208,
    });
    if (ui.icon) createSprite(card, 'Icon', { path: ui.icon, aspectW: 96, y: 112 });
    createLabel(card, ui.sub, {
        fontSize: 30, color: COLOR.GOLD_HI, bold: true, w: 520, h: 40, y: ui.icon ? 38 : 96,
    });

    const bar = createNode('Bar', card, { w: 400, h: 16, y: -16 });
    const bg = bar.addComponent(Graphics);
    const secLabel = createLabel(card, String(seconds), {
        fontSize: 24, color: COLOR.CREAM_MUTE, w: 520, h: 30, y: -52,
    });
    createLabel(card, '演示用 · 当前尚未接入广告位', {
        fontSize: 20, color: COLOR.CREAM_MUTE, w: 540, h: 28, y: -110,
    });

    // ---- 跳过（ghost 胶囊，与主玩页警停面板同款形制）----
    const BW = 380, BH = 84, by = -190;
    const btn = createNode('Btn_跳过', card, { w: BW, h: BH, y: by });
    const { g: bg2 } = createGraphicsNode('Face', btn, { w: BW, h: BH });
    fillRoundRect(bg2, 0, -8, BW, BH, 42, '#04100B', 255);
    fillRoundRect(bg2, 0, 0, BW, BH, 42, 'rgba(11,20,15,0.92)', 255);
    strokeRoundRect(bg2, 0, 0, BW, BH, 42, 'rgba(246,196,69,0.42)', 2.5, 255);
    createLabel(btn, '跳过', { fontSize: 32, color: COLOR.CREAM, bold: true, serif: true, w: BW - 40, h: BH });

    MotionFx.fadeTo(layer.getComponent(UIOpacity), 255, 0.22);

    let settled = false;
    const handle: MockAdHandle = {
        get node(): Node { return layer; },
        get alive(): boolean { return layer.isValid && !settled; },
        settle(o: AdOutcome): boolean {
            if (settled) return false;                 // 幂等：重复结算不生效
            settled = true;
            const op = layer.getComponent(UIOpacity);
            if (layer.isValid && op) MotionFx.fadeTo(op, 0, 0.2);
            const dead = layer;
            opts.schedule(240, () => { if (dead.isValid) dead.destroy(); });
            opts.onSettle(o);
            return true;
        },
    };

    tapWithFeedback(btn, () => { handle.settle('abort'); });

    // ---- 进度（由 `schedule` 驱动，状态不挂在 tween 回调上）----
    let left = seconds;
    const paint = (): void => {
        drawProgressBar(bg, 1 - left / seconds, 400, 16, 8,
            'rgba(255,247,230,0.12)', COLOR.GOLD_HI, COLOR.GOLD);
    };
    paint();
    const step = (): void => {
        if (!layer.isValid) { handle.settle('fail'); return; }
        left -= 0.1;
        if (left <= 0) { handle.settle('end'); return; }
        paint();
        if (secLabel.isValid) secLabel.string = String(Math.ceil(left));
        opts.schedule(100, step);
    };
    opts.schedule(100, step);

    return handle;
}
