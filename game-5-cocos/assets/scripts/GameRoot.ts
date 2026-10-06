/**
 * ============================================================
 *  GameRoot.ts · 游戏入口组件（总装车间）
 * ============================================================
 *  所有界面都由它在运行时创建 —— 这是「代码驱动 UI」的落点。
 *
 *  ⚠️ **它不是挂在场景里的**：`Main.scene` 保持零脚本引用的纯舞台，
 *  由 `Bootstrap.ts` 在运行时把它挂到 Canvas 上（原因见 Bootstrap 的注释：
 *  命令行无头构建时，场景里挂的脚本组件会被静默丢弃，构建"成功"但一片空白）。
 *
 *  启动顺序：
 *      ① 建 UIRoot 容器（铺满 Canvas）
 *      ② 音频服务（**必须在任何播放之前** —— 声道池与首次加载都要时间）
 *         └ 紧接着起 BGM（第 44 轮首次接入，含"浏览器手势兜底"，见 startBgm）
 *      ③ 页面状态机 PageManager
 *      ④ 注册所有页面（集中在此 ⇒ 页面之间不需要互相 import）
 *      ⑤ 预热存档（把状态打进启动日志，命令行排障唯一线索）
 *      ⑥ 进入首屏 splash
 * ============================================================
 */

// ⚠️ 不要从 'cc' import `log`/`warn`：release 构建 debugMode=ERROR，
//    引擎只在 mode<=INFO 时绑定 ccLog、只在 mode!==ERROR 时绑定 ccWarn，
//    ⇒ 打包产物里它们是空函数。日志一律用 console.log / console.warn。
import { Component, Input, Layers, Node, UITransform, Widget, _decorator, input, profiler, view } from 'cc';

import { BGM, DEBUG, GAME, PAGE } from './CFG';
import { PageManager } from './core/PageManager';
import { SaveService } from './core/SaveService';
import { AudioService } from './ui/AudioService';
import { HomePage } from './ui/HomePage';
import { GamePage } from './ui/GamePage';
import { GameStartPage } from './ui/GameStartPage';
import { SplashPage } from './ui/SplashPage';

const { ccclass } = _decorator;

@ccclass('GameRoot')
export class GameRoot extends Component {

    /** UI 根容器（所有页面的父亲） */
    private _uiTransform: UITransform | null = null;

    protected onLoad(): void {
        console.log(`[GameRoot] 《${GAME.NAME}》${GAME.VERSION} 启动`);

        const uiRoot = this.buildUIRoot();
        this.step('[1/6] buildUIRoot');

        // 音频服务必须在任何 play 之前 init（否则头几次操作是哑的）
        AudioService.init(uiRoot);
        this.step('[2/6] AudioService.init');

        this.startBgm();
        this.step('[2.5/6] startBgm');

        PageManager.create(uiRoot);
        this.step('[3/6] PageManager.create');

        this.registerPages();
        this.step('[4/6] registerPages');

        this.preloadData();
        this.step('[5/6] preloadData');

        PageManager.instance.open(PAGE.SPLASH);
        this.step('[6/6] open(splash)');

        // 屏幕尺寸变化（旋转 / 分屏 / 浏览器改窗口）时同步 UIRoot
        view.on('canvas-resize', this.syncUIRootSize, this);
    }

    /** 启动分步日志：命令行无头构建时看不到调试器，这几行是唯一的排障线索 */
    private step(tag: string): void {
        if (DEBUG.LOG_STATE) console.log(`[GameRoot] ${tag} 完成`);
    }

    protected onDestroy(): void {
        this.disarmBgm();
        view.off('canvas-resize', this.syncUIRootSize, this);
    }

    // --------------------------------------------------------
    //  ② BGM（第 44 轮首次接入）
    // --------------------------------------------------------
    //
    //  【为什么是"立即起一次 + 首次手势兜底"两路】
    //  微信小游戏允许进游戏即播；**浏览器会拦截无手势的自动播放**
    //  （`AudioSource.play()` 被拒后不会自己恢复，音乐就永远不响了）。
    //  两路都挂之后：
    //    · 真机/小游戏 → 第一路当场出声，兜底白挂一枪；
    //    · 浏览器      → 第一路静默失败，玩家第一次点屏幕时兜底补起。
    //  两路都调 `playBgm`，而它自带幂等守卫（同一首已在播则直接 return），
    //  所以重复触发无副作用 —— 不会"重头开始放两遍"。

    /** 首次用户手势的兜底监听（null = 还没挂或已摘） */
    private _armBgm: (() => void) | null = null;

    /** 起 BGM：立即尝试一次 + 挂一次性手势兜底（理由见上） */
    private startBgm(): void {
        AudioService.playBgm(BGM.MAIN);

        const arm = (): void => {
            this.disarmBgm();
            AudioService.playBgm(BGM.MAIN);
        };
        this._armBgm = arm;
        input.on(Input.EventType.TOUCH_START, arm, this);
        input.on(Input.EventType.MOUSE_DOWN, arm, this);
    }

    /** 摘掉手势兜底监听（**必须带 this 作为 target**，否则 off 摘不掉） */
    private disarmBgm(): void {
        if (!this._armBgm) return;
        input.off(Input.EventType.TOUCH_START, this._armBgm, this);
        input.off(Input.EventType.MOUSE_DOWN, this._armBgm, this);
        this._armBgm = null;
    }

    // --------------------------------------------------------
    //  ① UI 根容器
    // --------------------------------------------------------
    private buildUIRoot(): Node {
        const uiRoot = new Node('UIRoot');
        uiRoot.layer = Layers.Enum.UI_2D;
        this.node.addChild(uiRoot);
        uiRoot.setPosition(0, 0, 0);

        const ui = uiRoot.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        this._uiTransform = ui;

        // 显式设一次尺寸：不是写死设计分辨率，而是取"当前适配策略下的可视尺寸"，
        // 在 20:9 之类超长屏上会自然得到更高的高度（背景与底部条都不会露白边）。
        const vs = view.getVisibleSize();
        ui.setContentSize(vs.width, vs.height);

        // Widget 兜底：屏幕变化时自动四边贴齐 Canvas
        const widget = uiRoot.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ALWAYS;

        if (DEBUG.LOG_STATE) {
            console.log(`[GameRoot] 可视尺寸 ${Math.round(vs.width)}×${Math.round(vs.height)}（设计 ${GAME.DESIGN_W}×${GAME.DESIGN_H} · fitWidth）`);
        }
        return uiRoot;
    }

    private syncUIRootSize(): void {
        if (!this._uiTransform) return;
        const vs = view.getVisibleSize();
        this._uiTransform.setContentSize(vs.width, vs.height);
    }

    // --------------------------------------------------------
    //  ② 页面注册
    // --------------------------------------------------------
    //  ⚠️ 只有**四**个页（不是五个）：结算按定稿做成主玩页内的**弹层**。
    //     依据 `game-5 · 设计规则.md` 第 532 行「⑤ 单局结算页 | 弹层」；
    //     并且只有弹层能让「看广告复活」接回**同一局**（独立页会销毁牌堆）。
    //     详见 GamePage 顶部「为什么结算做成弹层」。
    private registerPages(): void {
        PageManager.register(PAGE.SPLASH, SplashPage);
        PageManager.register(PAGE.HOME, HomePage);
        PageManager.register(PAGE.START, GameStartPage);
        PageManager.register(PAGE.GAME, GamePage);
        if (DEBUG.LOG_STATE) {
            console.log(`[GameRoot] 已注册页面：${PageManager.registered.join(', ')}`);
        }
    }

    // --------------------------------------------------------
    //  ③ 数据预热
    // --------------------------------------------------------
    private preloadData(): void {
        // 构造函数里已 load 过一次；这里再显式读一遍，让启动日志能明确显示存档状态
        const d = SaveService.instance.load();
        if (DEBUG.LOG_STATE) {
            console.log(`[GameRoot] 存档：关卡 ${d.level} / 最高 ${d.best} / 金币 ${d.coins} / 局数 ${d.plays}`);
        }
    }
}

/** 供 Bootstrap 之外的地方强制刷新性能面板（调试用） */
export function applyStatsVisibility(show: boolean): void {
    try {
        if (show) profiler.showStats();
        else profiler.hideStats();
    } catch {
        /* 引擎尚未就绪 —— 交给下一次机会 */
    }
}
