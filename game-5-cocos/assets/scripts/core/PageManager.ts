/**
 * ============================================================
 *  PageManager.ts · 页面状态机 + 转场
 * ============================================================
 *  职责：
 *   ① 页面注册表（名字 → 类）—— 避免页面之间互相 import 形成循环依赖；
 *   ② 页面切换：**先建新页 → 旧页淡出销毁 → 新页淡入推近**，转场互斥防连点；
 *   ③ 提供全局唯一的页面容器（`PageManager.instance` 单例）。
 *
 *  依赖方向（单向，不要破坏）：
 *      各页面 ──► PageManager ◄── GameRoot（启动时注册所有页面）
 *
 *  ★ 三条铁律（game-4 踩出来的）：
 *   ① **状态流转只走 `setTimeout`，绝不用 `tween().call()`**
 *      动效链路一旦异常（节点被销毁 / 中途 stop / 时长被改成 0），回调不触发，
 *      `_transitioning` 就永久为 true —— 表现是"整个游戏的页面再也切不动了"，
 *      而报错指向 tween，与"切页"毫无因果关系，排查成本极高。
 *   ② **转场结束强制把新页 opacity 置 255**
 *      兜底"动效失效导致 UI 永久透明"这种最难查的白屏。
 *   ③ **未初始化时抛异常而不是返回 null**
 *      静默返回 null 会把"漏调 create()"伪装成一个看不懂的 TypeError。
 * ============================================================
 */

// ⚠️⚠️ **绝不要**从 'cc' 里 import `log` / `warn`（2026-10-06 踩坑，代价：整轮验收假红）
//    release 构建的 `application.js` 把 debugMode 写死成 `cc.DebugMode.ERROR`，
//    而引擎 `debug.ts:_resetDebugSetting(ERROR)` 的绑定条件是：
//        · `ccLog`  仅在 `mode <= DebugMode.INFO`（1）时才绑定 → 3 ≤ 1 为假 ⇒ **永远不绑定**
//        · `ccWarn` 仅在 `mode !== DebugMode.ERROR`（3）时才绑定 → 相等 ⇒ **永远不绑定**
//    于是 `cc.log()` / `cc.warn()` 在**打包产物里是空函数 `() => {}`**，一个字都打不出来；
//    而在编辑器预览里 build 是 debug 版（debugMode=INFO），它们是好的 ——
//    这正是"编辑器里看得到、一打包就全瞎"的根源。
//    ⇒ 日志一律用 `console.log` / `console.warn`。（`cc.error()` 不受影响，仍可用。）
import { Layers, Node, UIOpacity, Widget, tween, v3 } from 'cc';

import { TRANS } from '../CFG';
import { AudioService } from '../ui/AudioService';
// ⚠️ 必须是 `import type`：PageBase 那边会 `import { PageManager }`（运行期真需要），
//    这里若也做值导入就形成**运行期双向依赖**。TS 的 import elision 大多能救，
//    但那是"看编译选项吃饭"的写法 —— 显式写成 type 才能保证这条边在产物里不存在。
import type { PageBase, PageCtor } from '../ui/PageBase';

export class PageManager {

    // --------------------------------------------------------
    //  单例
    // --------------------------------------------------------
    private static _instance: PageManager | null = null;

    public static get instance(): PageManager {
        if (!PageManager._instance) {
            throw new Error('[PageManager] 尚未初始化：请先在 GameRoot.onLoad 里调用 PageManager.create(uiRoot)');
        }
        return PageManager._instance;
    }

    /** 由 GameRoot 在启动时调用 */
    public static create(pageRoot: Node): PageManager {
        if (PageManager._instance) {
            console.warn('[PageManager] create 被重复调用，沿用已有实例');
            return PageManager._instance;
        }
        PageManager._instance = new PageManager(pageRoot);
        return PageManager._instance;
    }

    public static get ready(): boolean { return !!PageManager._instance; }

    // --------------------------------------------------------
    //  页面注册表
    // --------------------------------------------------------
    private static readonly _registry = new Map<string, PageCtor>();

    /** 注册页面：名字 → 类。同名重复注册会覆盖并告警 */
    public static register(name: string, ctor: PageCtor): void {
        if (PageManager._registry.has(name)) {
            console.warn(`[PageManager] 页面 "${name}" 被重复注册，后者覆盖前者`);
        }
        PageManager._registry.set(name, ctor);
    }

    /** 已注册的页面名（启动日志 / 排障用） */
    public static get registered(): string[] {
        return Array.from(PageManager._registry.keys());
    }

    // --------------------------------------------------------
    //  实例状态
    // --------------------------------------------------------
    private readonly _pageRoot: Node;
    private _current: PageBase | null = null;
    private _currentName = '';
    private _transitioning = false;

    private constructor(pageRoot: Node) {
        this._pageRoot = pageRoot;
    }

    public get currentPageName(): string { return this._currentName; }
    public get isTransitioning(): boolean { return this._transitioning; }
    /** 供 Toast / 顶层弹层挂在最上层使用 */
    public get layer(): Node { return this._pageRoot; }
    /**
     * 当前页面实例 —— ★ 第 52 轮加：GameRoot 在前后台切换时要**通知当前页**
     * （局内计时得停，见 `GamePage.onAppHide`）。转场中可能是即将被回收的旧页，
     * 所以调用方一律走 `PageBase.__appHide/__appShow` 那对**带 try/catch 的包装**。
     */
    public get current(): PageBase | null { return this._current; }

    // --------------------------------------------------------
    //  核心：打开（替换）一个页面
    // --------------------------------------------------------
    /**
     * 切换到指定页面。语义是**替换**而不是入栈 ——
     * 返回上一页由页面自己在按钮里显式 `goto`（少一层隐式状态，少一类 bug）。
     */
    public open(name: string, params?: unknown): void {
        if (this._transitioning && TRANS.LOCK) {
            console.log(`[PageManager] 转场中，忽略对 "${name}" 的请求`);
            return;
        }
        const ctor = PageManager._registry.get(name);
        if (!ctor) {
            console.warn(`[PageManager] 页面 "${name}" 未注册，检查 GameRoot 的注册列表。已注册：${PageManager.registered.join(', ')}`);
            return;
        }

        this._transitioning = true;
        AudioService.onPageChange();

        const oldPage = this._current;
        const dur = TRANS.FADE;

        // ---------- 1. 建新页 ----------
        const node = new Node(`Page_${name}`);
        node.layer = Layers.Enum.UI_2D;   // 2D UI 必须归属 UI_2D 层
        this._pageRoot.addChild(node);

        // 页面节点三件套：尺寸（铺满）、透明度（转场）、组件（逻辑）
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ALWAYS;

        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 0;
        node.setScale(v3(TRANS.ENTER_SCALE_FROM, TRANS.ENTER_SCALE_FROM, 1));

        const page = node.addComponent(ctor) as unknown as PageBase;
        this._current = page;
        this._currentName = name;

        // ⚠️ __build 必须在节点已挂到树上之后调 —— 里面要读 view.getVisibleSize() 与父链
        page.__build(params);
        console.log(`[PageManager] → ${name}`);

        // ---------- 2. 入场表现：淡入 + 推近（**纯视觉，不承担状态机职责**）----------
        tween(opacity).to(dur, { opacity: 255 }, { easing: 'quadOut' }).start();
        tween(node).to(dur, { scale: v3(1, 1, 1) }, { easing: 'quadOut' }).start();

        // ---------- 3. 解锁与入场通知：用定时器，绝不用 tween 回调（铁律 ①）----------
        setTimeout(() => {
            this._transitioning = false;
            if (!node.isValid) return;
            // 铁律 ②：兜底强制完全可见
            opacity.opacity = 255;
            node.setScale(v3(1, 1, 1));
            page.__enter();
        }, dur * 1000 + 20);

        // ---------- 4. 旧页清理 ----------
        if (oldPage && oldPage.isValid) {
            oldPage.__leave();
            const oldOp = oldPage.node.getComponent(UIOpacity);
            if (oldOp) tween(oldOp).to(dur, { opacity: 0 }).start();
            // 销毁同样用定时器兜底，不依赖 tween 回调
            setTimeout(() => {
                if (oldPage.isValid) oldPage.node.destroy();
            }, dur * 1000 + 20);
        }
    }
}
