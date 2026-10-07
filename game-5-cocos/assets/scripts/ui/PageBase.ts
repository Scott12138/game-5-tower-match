/**
 * ============================================================
 *  PageBase.ts · 页面基类
 * ============================================================
 *  一屏 = 一个页面。每个页面是一个挂在独立节点上的组件，由 PageManager
 *  负责创建 / 转场 / 销毁；页面自身只关心内容。
 *
 *  生命周期（由 PageManager 驱动，**子类不要手动调用带 __ 前缀的方法**）：
 *      onBuild(params)   创建时 —— 构建界面，**只执行一次**
 *      onEnter()         转场完成后 —— 启动计时器 / 播入场动效
 *      onLeave()         即将销毁前 —— 停计时器 / 存临时状态
 *
 *  ★ 三件套（`Timers` / `Ticker`）由基类提供，**子类必须用它们**而不是裸 setTimeout：
 *    页面销毁后残留的定时器会打到已销毁的节点上，症状是偶发的
 *    "某个数字还在跳 / 某个面板又弹了一下"，且只在快速来回切页时复现。
 * ============================================================
 */

import { _decorator, Component, Node, UIOpacity, UITransform, view } from 'cc';

import { PageManager } from '../core/PageManager';
import { TimerBag } from './MotionFx';
import { createLayer } from './UIFactory';

const { ccclass } = _decorator;

@ccclass('PageBase')
export class PageBase extends Component {

    /** 打开本页时传入的参数（由 PageManager.open 透传） */
    protected params: Record<string, unknown> | null = null;

    /** 本页专用的定时器集合 —— `onLeave` 会被自动清空 */
    protected readonly timers = new TimerBag();

    /** 本页的 UI 容器（铺满可视区，所有内容挂它下面） */
    private _body: Node | null = null;

    /** 关闭请求的合并开关：转场中重复调 close 只生效一次 */
    private _closing = false;

    // --------------------------------------------------------
    //  便捷入口
    // --------------------------------------------------------

    /** 本页的节点 */
    protected get root(): Node { return this.node; }

    /** 本页的 UITransform */
    protected get ui(): UITransform { return this.node.getComponent(UITransform)!; }

    /** 本页的 UIOpacity（转场淡入淡出用，由 PageManager 挂载） */
    protected get opacity(): UIOpacity { return this.node.getComponent(UIOpacity)!; }

    /**
     * **内容容器**：铺满可视区。
     * 页面内容一律挂它下面，而不是直接挂 `this.node` ——
     * 这样"页面节点"只承担转场职责（Widget + UIOpacity），内容层可以整体替换。
     */
    protected get body(): Node {
        if (!this._body) this._body = createLayer('Body', this.node);
        return this._body;
    }

    /** 跳转到另一个页面（**替换**当前页，不是入栈） */
    protected goto(pageName: string, params?: Record<string, unknown>): void {
        PageManager.instance.open(pageName, params);
    }

    /** 可视尺寸（写布局时用它，而不是写死 750×1334） */
    protected visible(): { width: number; height: number } {
        const s = view.getVisibleSize();
        return { width: s.width, height: s.height };
    }

    // --------------------------------------------------------
    //  生命周期骨架（by PageManager）
    // --------------------------------------------------------

    /** @internal 由 PageManager 调用 —— 子类不要覆写 */
    public __build(params: unknown): void {
        this.params = (params ?? null) as Record<string, unknown> | null;
        try {
            this.onBuild();
        } catch (e) {
            // ⚠️ 一个页面构建失败不能让整游戏白屏 —— 把原因打出来，页面照常进（只是内容缺）
            console.error(`[PageBase] ${this.node.name} onBuild 抛异常：`, e);
        }
    }

    /** @internal 由 PageManager 调用 —— 子类不要覆写 */
    public __enter(): void {
        try {
            this.onEnter();
        } catch (e) {
            console.error(`[PageBase] ${this.node.name} onEnter 抛异常：`, e);
        }
    }

    /** @internal 由 PageManager 调用 —— 子类不要覆写 */
    public __leave(): void {
        try {
            this.onLeave();
        } catch (e) {
            console.error(`[PageBase] ${this.node.name} onLeave 抛异常：`, e);
        }
        this.timers.clear();
    }

    /**
     * @internal 由 GameRoot 在**小游戏切到后台**时调用 —— 子类不要覆写。
     *
     * ★ 第 52 轮新增。⚠️ **别拿它去改 `_paused` 那类"弹层状态"**：
     *   切后台前如果正开着暂停弹层，回到前台时那个弹层**还得在** ——
     *   用一个标志兼表两件事，回前台就会把弹层凭空关掉。
     *   要挡计时的子类请**自己加一个独立的后台标志**（见 `GamePage._inBackground`）。
     */
    public __appHide(): void {
        try {
            this.onAppHide();
        } catch (e) {
            console.error(`[PageBase] ${this.node.name} onAppHide 抛异常：`, e);
        }
    }

    /** @internal 由 GameRoot 在**从后台回来**时调用 —— 子类不要覆写 */
    public __appShow(): void {
        try {
            this.onAppShow();
        } catch (e) {
            console.error(`[PageBase] ${this.node.name} onAppShow 抛异常：`, e);
        }
    }

    // --------------------------------------------------------
    //  子类钩子
    // --------------------------------------------------------

    /** 构建界面：所有创建控件的代码写这里，**只执行一次** */
    protected onBuild(): void { /* 子类重写 */ }

    /** 入场完成：开始计时、播动画、读存档 */
    protected onEnter(): void { /* 子类重写 */ }

    /** 离场之前：停计时、清理（`timers` 会被自动清空） */
    protected onLeave(): void { /* 子类重写 */ }

    /**
     * **应用切到后台**（不是页面转场）—— 需要"暂停"语义的页面重写它。
     * 例：主玩页停倒计时、停"卡住提示"的发呆计时。
     * ⚠️ 别在这里改弹层状态，理由见 `__appHide`。
     */
    protected onAppHide(): void { /* 子类重写 */ }

    /** **从后台回来** —— 与 `onAppHide` 成对，恢复在 `onAppHide` 里暂停的东西 */
    protected onAppShow(): void { /* 子类重写 */ }

    // --------------------------------------------------------
    //  关闭（供子类在按钮里调）
    // --------------------------------------------------------

    /**
     * 请求关闭并跳到指定页。
     * 合并重复请求：连点两颗按钮不会触发两次转场（第二次直接忽略）。
     */
    protected close(target: string, params?: Record<string, unknown>): void {
        if (this._closing) return;
        this._closing = true;
        this.goto(target, params);
    }

    /** 取参数（带默认值），避免到处写 `this.params?.x as number ?? 0` */
    protected param<T>(key: string, def: T): T {
        const v = this.params?.[key];
        return (v === undefined || v === null) ? def : (v as T);
    }
}

/** 页面类构造器类型（PageManager 用它与注册表配合） */
export type PageCtor = new (...args: unknown[]) => PageBase;
