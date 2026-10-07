/**
 * ============================================================
 *  AdService.ts · 激励视频广告（`wx.createRewardedVideoAd` 的封装）
 * ============================================================
 *  ⚠️ **不 import './cc.ts'** —— 离线自检要能直接跑它。
 *
 *  【为什么要有这个类，而不是各处直接调 wx】
 *
 *   ① `createRewardedVideoAd({ adUnitId })` 的 **`onClose` / `onError` 是挂在实例上的、
 *      会累积**。如果每播一次就 `createRewardedVideoAd` 一次、顺手再挂一对监听，
 *      播到第 N 次时回调会同时触发 N 份 ⇒ **一次广告发 N 份奖励**。
 *      这是这类接入最典型的翻车点，而且**不报错**、只在"多播几次"后才看得出来。
 *      ⇒ 本类把实例**按场景缓存**，监听器**只在创建时挂一次**。
 *
 *   ② 发奖与否**只看 `onClose(res.isEnded)`**，不看"有没有报错"：
 *      玩家中途关掉（`isEnded=false`）必须**不发**。这是判据，不是体验问题。
 *
 *   ③ 本项目现在**没有广告位**（流量主要求 UV≥1000 + 后台手动建广告位）。
 *      所以 `modeOf(scene)` 会返回 `mock`，由调用方走"可测替身"那条路 ——
 *      调用方**不需要**自己去嗅探 `wx` 有没有、有没有 ID。
 *
 *  【三种结局】
 *      `end`   看完了           → 发奖励
 *      `abort` 中途关掉         → **不发**，且必须把暂停态复位
 *      `fail`  拉不到/超时/异常 → **不发**，且必须把暂停态复位（否则弹层关不掉 = 卡死）
 * ============================================================
 */

import { AD, DEBUG, type AdScene } from './CFG.ts';

export type { AdScene };
export type AdOutcome = 'end' | 'abort' | 'fail';
/** 走哪条路：`real` = 真微信广告；`mock` = 无广告位时由调用方画的可测替身 */
export type AdMode = 'real' | 'mock';

/**
 * 微信激励视频实例的最小接口 —— 只声明本类用到的部分。
 * 这样验收脚本注入一个 **fake wx** 就能把真实分支跑通（不需要在生产代码里留测试后门）。
 */
interface WxRewardedVideoAd {
    load(): Promise<void>;
    show(): Promise<void>;
    onError(cb: (err: unknown) => void): void;
    onClose(cb: (res?: { isEnded?: boolean }) => void): void;
}

interface WxLike {
    createRewardedVideoAd?: (opt: { adUnitId: string }) => WxRewardedVideoAd;
}

export class AdService {
    private static _instance: AdService | null = null;
    public static get instance(): AdService {
        if (!AdService._instance) AdService._instance = new AdService();
        return AdService._instance;
    }

    /** 按场景缓存的实例（**同一个 adUnitId 只创建一个**，见文件头 ①） */
    private readonly _ads = new Map<AdScene, WxRewardedVideoAd>();

    /** 正在进行的一次播放（同时只允许一次） */
    private _pending: {
        scene: AdScene;
        resolve: (o: AdOutcome) => void;
        watchdog: ReturnType<typeof setTimeout>;
    } | null = null;

    private constructor() { /* 单例，不导出构造 */ }

    // --------------------------------------------------------
    //  环境嗅探
    // --------------------------------------------------------

    private wx(): WxLike | undefined {
        return (globalThis as { wx?: WxLike }).wx;
    }

    /**
     * 该场景会走哪条路。**调用方据此决定要不要自己画替身 UI。**
     * 三个条件全满足才算 `real`：总开关开 · 有该场景的广告位 ID · 环境真有 API。
     */
    public modeOf(scene: AdScene): AdMode {
        return this.canReal(scene) ? 'real' : 'mock';
    }

    private canReal(scene: AdScene): boolean {
        if (!AD.REAL_ENABLED) return false;
        if (!AD.AD_UNIT[scene]) return false;
        return typeof this.wx()?.createRewardedVideoAd === 'function';
    }

    /** 是否正在播（用于双触发保护与验收断言） */
    public get busy(): boolean { return this._pending !== null; }

    /** 诊断信息（启动日志 / `__game5.adInfo()` 用） */
    public describe(): { realEnabled: boolean; revive: AdMode; tool: AdMode; busy: boolean } {
        return {
            realEnabled: AD.REAL_ENABLED,
            revive: this.modeOf('revive'),
            tool: this.modeOf('tool'),
            busy: this.busy,
        };
    }

    // --------------------------------------------------------
    //  播放
    // --------------------------------------------------------

    /**
     * 播一次激励视频；`resolve` 出三种结局（见文件头）。
     * ⚠️ **只有 `end` 才发奖励** —— 调用方必须自己再判一次。
     */
    public play(scene: AdScene): Promise<AdOutcome> {
        if (this._pending) {
            // 双触发保护：连点按钮时只认第一次。判 `fail` 是**故意的** ——
            // 让第二次点击什么都不发生，而不是排进队列等会儿再发一份奖励。
            console.warn('[AdService] 已有一次播放在进行中，忽略本次请求');
            return Promise.resolve('fail');
        }

        const ad = this.obtain(scene);
        if (!ad) {
            // 走到这里 = 调用方误用了（应该先 `modeOf` 判一下）。记一条好定位。
            console.warn(`[AdService] 场景 ${scene} 无可播放实例（应走 mock 分支）`);
            return Promise.resolve('fail');
        }

        return new Promise<AdOutcome>((resolve) => {
            // 看门狗：既没 onClose 也没 onError 时兜底判 fail，**防卡死**
            const watchdog = setTimeout(() => {
                console.warn('[AdService] 看门狗超时（无 onClose / onError）⇒ 判 fail');
                this.settle('fail');
            }, AD.WATCHDOG_MS);

            this._pending = { scene, resolve, watchdog };
            if (DEBUG.LOG_STATE) console.log(`[AdService] ► 开始播放（场景 ${scene}）`);

            ad.show().catch((e: unknown) => {
                console.warn('[AdService] show() 失败：', e);
                if (!AD.RETRY_ON_SHOW_FAIL) { this.settle('fail'); return; }
                // 微信推荐写法：拉取失败 ⇒ load() 一次再 show()
                ad.load().then(() => ad.show()).catch((e2: unknown) => {
                    console.warn('[AdService] load()+show() 重试仍失败：', e2);
                    this.settle('fail');
                });
            });
        });
    }

    /** 取（或首个创建）某场景的实例；返回 null = 该走 mock */
    private obtain(scene: AdScene): WxRewardedVideoAd | null {
        const cached = this._ads.get(scene);
        if (cached) return cached;
        if (!this.canReal(scene)) return null;

        let ad: WxRewardedVideoAd | null = null;
        try {
            ad = this.wx()!.createRewardedVideoAd!({ adUnitId: AD.AD_UNIT[scene] }) ?? null;
        } catch (e) {
            console.warn('[AdService] createRewardedVideoAd 抛异常：', e);
            return null;
        }
        if (!ad) return null;

        // ★ 监听器只在创建时挂一次（见文件头 ①：挂多次 = 播一次发多份）
        ad.onError((err: unknown) => {
            console.warn('[AdService] onError：', err);
            this.settle('fail');
        });
        ad.onClose((res?: { isEnded?: boolean }) => {
            const ended = !!(res && res.isEnded);
            if (DEBUG.LOG_STATE) console.log(`[AdService] ◄ 关闭（isEnded=${ended}）`);
            this.settle(ended ? 'end' : 'abort');
        });

        this._ads.set(scene, ad);
        if (DEBUG.LOG_STATE) console.log(`[AdService] 已创建实例（场景 ${scene}，adUnitId 已配）`);
        return ad;
    }

    /** 收口：无论从哪条路来（onClose / onError / 看门狗），都只结算一次 */
    private settle(outcome: AdOutcome): void {
        const p = this._pending;
        if (!p) return;                        // 幂等：重复回调不重复结算
        this._pending = null;
        clearTimeout(p.watchdog);
        p.resolve(outcome);
    }
}
