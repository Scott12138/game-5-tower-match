/**
 * ============================================================
 *  MotionFx.ts · 动效工具箱（带"通道"的补间注册表）
 * ============================================================
 *  本文件把 game-4 踩过的三次坑固化成纪律，写在这里就等于写在了每个调用点：
 *
 *  ① **状态流转绝不用 `tween().call()`**
 *     一旦动效链路异常（节点被销毁 / 中途 stop / 时长被改成 0），回调不触发，
 *     状态机就永久卡死。铁律：**状态用 setTimeout，动效只负责好看**。
 *     本工具箱的 `after()` 就是这条纪律的唯一出口。
 *
 *  ② **同节点同通道互斥**（`TAG`）
 *     tag 是「这条动效在改哪一组属性」，不是「这是哪个功能」。
 *     共用通道会互相打断：提示呼吸把按钮放大到 1.06，玩家此时点它，
 *     按压动效会 stop 掉呼吸那条 —— 而"收回到 1"写在呼吸末尾，
 *     于是按钮**永久停在 1.06**，看起来只是"这个键大一点"，极难联想。
 *
 *  ③ **UIOpacity 只能做 0 ↔ 255**
 *     UIOpacity 会把节点内所有顶点的 alpha **乘**一遍；对"画在两批顶点上的
 *     多段内容"（牌底 + 牌面）会把它们抹平成同一个值。目标是中间值（半透明遮罩）
 *     时，顶点一重建就回落。所以中间值一律走 Graphics 重绘（见 UIFactory.alphaPainter）。
 * ============================================================
 */

import { Node, UIOpacity, Vec3, easing, tween, v3 } from 'cc';
// `TweenEasing` 是字符串字面量联合（不是 `string`）：给 `easing` 字段标注成 `string`
// 之后再传进 `t.to()` 会报 TS2322。用 `import type` 只引类型，不产生运行期依赖。
import type { TweenEasing } from 'cc';
import { MOTION } from '../CFG';

// ============================================================
//  一、语义缓动名（业务代码里不许出现 'quadOut' 字面量）
// ============================================================

export const EASE = {
    ENTER: MOTION.EASE_ENTER,
    MOVE: MOTION.EASE_MOVE,
    POP: MOTION.EASE_POP,
    EXIT: MOTION.EASE_EXIT,
    IDLE: MOTION.EASE_IDLE,
    REJECT: MOTION.EASE_REJECT,
    DROP: MOTION.EASE_DROP,
} as const;

/** 缓动名 → 函数。**只用于弧线整体采样**（见 arc 的注释） */
const EASE_FN: Record<string, (k: number) => number> = {
    quadOut: easing.quadOut,
    quadIn: easing.quadIn,
    backOut: easing.backOut,
    sineInOut: easing.sineInOut,
    linear: easing.linear,
};

// ============================================================
//  二、动效通道
// ============================================================

export const TAG = {
    /** 按压（改 scale） */
    PRESS: 'press',
    /** 牌从桌上飞向槽位（改 position / scale） */
    FLY: 'fly',
    /** 槽内落位与聚拢（改 position / scale） */
    SLOT: 'slot',
    /** 旋转（改 angle）—— 与 SLOT 分开，因为一个动效可能要同时改位移与角度 */
    SPIN: 'spin',
    /** 牌堆内的位置（入场涌现、洗牌铺开） */
    STACK: 'stack',
    /** 牌堆整体浮现（改容器 scale） */
    ENTER: 'enter',
    /** 透明度（与位移分开，保证"位移不打断淡入淡出"） */
    FADE: 'fade',
    /** 临时特效 */
    FX: 'fx',
    /**
     * 提示呼吸（改 scale）。
     * ⚠️ 与 PRESS 分开是**必须**的 —— 见文件头第 ② 条。
     */
    NUDGE: 'nudge',
    /** 抖动 / 拒绝 */
    SHAKE: 'shake',
    /** 过场（赠礼卡、结算卡的进出） */
    OVER: 'over',
} as const;

export type MotionTag = string;

// ============================================================
//  三、注册表
// ============================================================

/**
 * 注册表里存的是**异构**补间：`MotionFx.to()` 补的是 Node，
 * 而 `fadeTo()` 补的是 `UIOpacity` 组件。所以这里只描述"我们要用到的那两个能力"。
 *
 * ⚠️ 别写成 `Tween<unknown>` —— 引擎的 `Tween<T extends object>` 不满足 `unknown` 约束，
 *    会直接报 TS2344（"看着更严谨"反而编不过）。用结构类型最稳，也最诚实地表达用途。
 */
interface AnyTween {
    start(): void;
    stop(): void;
}
const _running = new WeakMap<Node, Map<MotionTag, AnyTween>>();

function slotOf(node: Node): Map<MotionTag, AnyTween> {
    let m = _running.get(node);
    if (!m) {
        m = new Map<MotionTag, AnyTween>();
        _running.set(node, m);
    }
    return m;
}

export interface NodeProps {
    position?: Vec3;
    scale?: Vec3;
    angle?: number;
}

export interface FxOpts {
    /** 起始延时（秒）。多张牌错峰就用它，而不是给每条 tween 各写一个 setTimeout */
    delay?: number;
    easing?: TweenEasing;
    tag?: MotionTag;
}

export interface ToOpts extends FxOpts {
    /** 时长（秒） */
    duration?: number;
}

export interface ArcOpts extends FxOpts {
    /** 时长（秒） */
    duration?: number;
    /**
     * 弧线"鼓出去"的力度（0 = 直线）。
     * 单位与 position 相同（px），正值表示朝屏幕上方鼓。
     */
    bulge?: number;
    /** 结束时的缩放（比用两条 tween 更稳，避免中途被 stop 后停在半路尺寸） */
    scaleTo?: number;
}

export class MotionFx {

    // --------------------------------------------------------
    //  通道控制
    // --------------------------------------------------------

    /** 停掉某节点某通道上正在跑的补间（对已跑完的调用也安全） */
    public static stop(node: Node | null | undefined, tag: MotionTag): void {
        if (!node || !node.isValid) return;
        const m = _running.get(node);
        const t = m?.get(tag);
        if (!t) return;
        t.stop();
        m!.delete(tag);
    }

    /** 停掉某节点全部通道（换父节点 / 回收进池之前必须调，否则残留补间会写坏复位值） */
    public static stopAll(node: Node | null | undefined): void {
        if (!node || !node.isValid) return;
        const m = _running.get(node);
        if (!m) return;
        m.forEach((t) => t.stop());
        m.clear();
    }

    private static launch(key: Node, tag: MotionTag, make: () => AnyTween): void {
        if (!key || !key.isValid) return;
        this.stop(key, tag);
        const t = make();
        slotOf(key).set(tag, t);
        t.start();
    }

    // --------------------------------------------------------
    //  基础补间
    // --------------------------------------------------------

    /** 单段位移 / 缩放 / 旋转 */
    public static to(node: Node | null | undefined, props: NodeProps, opts: ToOpts = {}): void {
        if (!node || !node.isValid) return;
        const dur = opts.duration ?? MOTION.T_ENTER;
        const tag = opts.tag ?? TAG.FX;
        const ease = opts.easing ?? EASE.ENTER;

        this.launch(node, tag, () => {
            const t = tween(node);
            if (opts.delay) t.delay(opts.delay);
            t.to(dur, props as Record<string, unknown>, { easing: ease });
            return t;
        });
    }

    /** 多段串联（每段自己给时长 / 缓动）。最后一维用 `afterSeconds` 收口 */
    public static seq(
        node: Node | null | undefined,
        steps: Array<{ props: NodeProps; duration: number; easing?: TweenEasing }>,
        opts: FxOpts = {},
    ): void {
        if (!node || !node.isValid || steps.length === 0) return;
        const tag = opts.tag ?? TAG.FX;

        this.launch(node, tag, () => {
            const t = tween(node);
            if (opts.delay) t.delay(opts.delay);
            for (const s of steps) {
                t.to(s.duration, s.props as Record<string, unknown>, { easing: s.easing ?? EASE.ENTER });
            }
            return t;
        });
    }

    /**
     * 沿一条**抛物线**飞行（牌飞入槽位 / 赠礼落位都用它）。
     *
     * 【为什么不用两段 tween 拼】
     * 两段拼出来的折线在拐点处速度会突然转向，看着像"弹了一下"；
     * 而这里按采样点直接驱动 position，整条弧线共用一个缓动函数，观感是一条流畅的抛线。
     *
     * 【为什么缓动作用在**整条弧的参数 u** 上，而不是每一小段】
     * 把 quadIn 挨个套到每小段上，等于把加速曲线重复了 N 次 —— 观感是"一顿一顿地往前拱"。
     * 正确做法：采样点按 `ease(i/n)` 分布，每小段本身用 linear。
     */
    public static arc(
        node: Node | null | undefined,
        from: Vec3,
        to: Vec3,
        opts: ArcOpts = {},
    ): void {
        if (!node || !node.isValid) return;
        const dur = opts.duration ?? MOTION.T_FLY;
        const tag = opts.tag ?? TAG.FLY;
        const easeName = opts.easing ?? EASE.MOVE;
        const fn = EASE_FN[easeName] ?? easing.quadOut;
        const bulge = opts.bulge ?? 0;

        const startScale = node.scale.clone();
        const endScale = opts.scaleTo !== undefined
            ? v3(opts.scaleTo, opts.scaleTo, 1)
            : startScale.clone();

        const at = (u: number): Vec3 => {
            const x = from.x + (to.x - from.x) * u;
            const y = from.y + (to.y - from.y) * u + bulge * 4 * u * (1 - u);
            return v3(x, y, 0);
        };

        node.setPosition(at(0));
        this.stop(node, tag);
        slotOf(node).set(tag, null as unknown as AnyTween);   // 占位：标记该通道繁忙

        const total = dur * 1000;
        const t0 = Date.now();
        const delayMs = (opts.delay ?? 0) * 1000;

        const tick = (): void => {
            if (!node.isValid) return;
            const el = Date.now() - t0 - delayMs;
            if (el < 0) { setTimeout(tick, 16); return; }
            const lin = Math.min(1, el / total);
            const u = fn(lin);
            node.setPosition(at(u));
            const k = lin;
            node.setScale(v3(
                startScale.x + (endScale.x - startScale.x) * k,
                startScale.y + (endScale.y - startScale.y) * k,
                1,
            ));
            if (lin < 1) {
                setTimeout(tick, 16);
            } else {
                node.setPosition(to.x, to.y, 0);
                node.setScale(endScale);
            }
        };
        setTimeout(tick, 16);
    }

    /**
     * 抖动（拒绝 / 告警）。
     * 用**绝对位移**而不是叠加 —— 叠加会让连续触发时振幅越抖越大。
     */
    public static shake(
        node: Node | null | undefined,
        amp = 6,
        times = 3,
        opts: FxOpts = {},
    ): void {
        if (!node || !node.isValid) return;
        const base = node.position.clone();
        const tag = opts.tag ?? TAG.SHAKE;
        const step = 0.05;

        this.launch(node, tag, () => {
            const t = tween(node);
            if (opts.delay) t.delay(opts.delay);
            for (let i = 0; i < times; i++) {
                t.to(step, { position: v3(base.x - amp, base.y, base.z) }, { easing: 'linear' });
                t.to(step, { position: v3(base.x + amp, base.y, base.z) }, { easing: 'linear' });
            }
            t.to(step, { position: base }, { easing: EASE.ENTER });
            return t;
        });
    }

    /** 呼吸（往复缩放）—— 用于"提示这个键可以点" */
    public static breath(
        node: Node | null | undefined,
        scaleTo = 1.06,
        half = 0.6,
        opts: FxOpts = {},
    ): void {
        if (!node || !node.isValid) return;
        const tag = opts.tag ?? TAG.NUDGE;

        this.launch(node, tag, () => {
            const t = tween(node);
            if (opts.delay) t.delay(opts.delay);
            t.repeatForever(
                tween(node)
                    .to(half, { scale: v3(scaleTo, scaleTo, 1) }, { easing: EASE.IDLE })
                    .to(half, { scale: v3(1, 1, 1) }, { easing: EASE.IDLE }),
            );
            return t;
        });
    }

    // --------------------------------------------------------
    //  透明度（只做 0 ↔ 255，见文件头第 ③ 条）
    // --------------------------------------------------------

    /** 淡入 / 淡出到目标（0~255）。用 `after` 收口状态 */
    public static fadeTo(
        opacity: UIOpacity | null | undefined,
        target: number,
        duration: number,
        opts: ToOpts = {},
    ): void {
        if (!opacity || !opacity.isValid) return;
        const tag = opts.tag ?? TAG.FADE;
        const key = opacity.node;

        this.launch(key, tag, () => {
            const t = tween(opacity);
            if (opts.delay) t.delay(opts.delay);
            t.to(duration, { opacity: target }, { easing: opts.easing ?? EASE.ENTER });
            return t;
        });
    }

    // --------------------------------------------------------
    //  状态收口（唯一被允许的"延迟执行"出口）
    // --------------------------------------------------------

    /**
     * `ms` 之后执行一次（毫秒）。**状态流转只用它，绝不用 tween 回调** —— 见文件头第 ① 条。
     * 返回取消句柄，调用方在 onLeave 里清掉它（防止页面销毁后回调打到死节点）。
     */
    public static after(ms: number, fn: () => void): TimerHandle {
        const id = setTimeout(() => {
            try {
                fn();
            } catch (e) {
                console.warn('[MotionFx] after 回调抛异常：', e);
            }
        }, ms);
        return { id, cancel: () => clearTimeout(id) };
    }

    /** 按帧驱动的等待（用于"等 N 帧后"这类场景，避免 setTimeout(0) 的时序不确定性） */
    public static afterFrames(frames: number, fn: () => void): void {
        const step = (n: number): void => {
            if (n <= 0) { fn(); return; }
            setTimeout(() => step(n - 1), 16);
        };
        setTimeout(() => step(frames - 1), 0);
    }
}

export interface TimerHandle {
    id: ReturnType<typeof setTimeout>;
    cancel: () => void;
}

/**
 * 定时器集合 —— 页面的 `onLeave` 里一把清空。
 *
 * 【为什么需要】页面销毁后残留的 setTimeout 回调会打到已销毁的节点上，
 * 轻则 `isValid` 判断保住，重则给已经复用的节点写错状态。集中托管是最省心的做法。
 */
export class TimerBag {
    private _handles: TimerHandle[] = [];

    /** 登记并返回取消句柄 */
    public add(ms: number, fn: () => void): TimerHandle {
        const h = MotionFx.after(ms, fn);
        this._handles.push(h);
        return h;
    }

    /** 清空全部未触发的定时器 */
    public clear(): void {
        for (const h of this._handles) h.cancel();
        this._handles.length = 0;
    }
}
