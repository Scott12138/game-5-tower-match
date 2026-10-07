/**
 * ============================================================
 *  RankService.ts · 好友排行榜（**主域**侧）
 * ============================================================
 *  ⚠️ **不 import 'cc'** —— 离线自检要能直接跑它。
 *
 *  【平台强制的隔离 —— 先理解它，否则会一直找不到数据】
 *    微信小游戏把"好友关系链数据"关在**开放数据域**里（另一套 JS 环境）：
 *      · **主域**（本文件所在的地方）**拿不到**好友列表，也不该去拿；
 *      · 主域能做的是 ① 把自己的分数**写上去** ② 通知开放数据域**重绘**；
 *      · 开放数据域画在一块共享画布 `sharedCanvas` 上，主域再把它当贴图显示
 *        （那部分在 `HomePage.openRank()` 里，用引擎的 `SubContextView` 组件）。
 *
 *  【写入用的 key / 值格式 —— 不能自己发明】
 *    `wx.setUserCloudStorage` 的 value 必须是 JSON 字符串，且**分数要放在
 *    `wxgame.score` 这个约定字段里**，微信的官方排行榜组件与
 *    `getFriendCloudStorage` 的排序都认这个结构：
 *        { "wxgame": { "score": 12, "update_time": 1690000000 } }
 *    自己另起一个扁平结构（如 `{"level":12}`）也能读，但官方组件读不了 —— 别那样写。
 *
 *  【失败一律静默】排行榜是锦上添花：写失败 / 没有 wx 环境 / 基础库老，
 *    都只是"排行榜里少一条"，绝不允许影响开局与存档。
 * ============================================================
 */

import { DEBUG } from '../CFG';

/** 云端 KV 的 key —— 开放数据域里按同一个字符串去读，改一处必须改两处 */
export const RANK_KEY = 'level';

interface WxLike {
    setUserCloudStorage?: (opt: {
        KVDataList: { key: string; value: string }[];
        success?: () => void;
        fail?: (err: unknown) => void;
    }) => void;
    getOpenDataContext?: () => { postMessage: (msg: unknown) => void };
}

export class RankService {
    private static _instance: RankService | null = null;
    public static get instance(): RankService {
        if (!RankService._instance) RankService._instance = new RankService();
        return RankService._instance;
    }

    /** 上次真正写上去的分数 —— 相同就不重复写（`setUserCloudStorage` 有频次限制） */
    private _lastPushed = -1;

    private constructor() { /* 单例 */ }

    private wx(): WxLike | undefined {
        return (globalThis as { wx?: WxLike }).wx;
    }

    /**
     * 环境是否支持排行榜。
     * ⚠️ **两个 API 缺一不可**：没有 `getOpenDataContext` 就画不出榜，
     *   没有 `setUserCloudStorage` 就没有数据可画 —— 只判一个会把"打不开"误判成"能开"。
     */
    public get available(): boolean {
        const w = this.wx();
        return typeof w?.setUserCloudStorage === 'function'
            && typeof w?.getOpenDataContext === 'function';
    }

    // --------------------------------------------------------
    //  ① 把自己的分数写上去
    // --------------------------------------------------------

    /**
     * 上报"历史最高通关关卡"。同一分数不重复上报。
     * @param score 关卡号（1 起）；<= 0 视为"还没通关过"，不上报
     */
    public pushScore(score: number): void {
        const s = Math.floor(score) || 0;
        if (s <= 0) return;
        if (s === this._lastPushed) return;
        const w = this.wx();
        if (typeof w?.setUserCloudStorage !== 'function') {
            if (DEBUG.LOG_STATE) console.log('[RankService] 无 setUserCloudStorage，跳过分榜上报');
            return;
        }
        const value = JSON.stringify({
            wxgame: { score: s, update_time: Math.floor(Date.now() / 1000) },
        });
        try {
            w.setUserCloudStorage({
                KVDataList: [{ key: RANK_KEY, value }],
                success: () => {
                    this._lastPushed = s;
                    if (DEBUG.LOG_STATE) console.log(`[RankService] ✔ 已上报最高关卡 ${s}`);
                },
                fail: (err: unknown) => {
                    console.warn('[RankService] 上报失败（不影响游戏）：', err);
                },
            });
        } catch (e) {
            console.warn('[RankService] setUserCloudStorage 抛异常（不影响游戏）：', e);
        }
    }

    // --------------------------------------------------------
    //  ② 通知开放数据域重绘
    // --------------------------------------------------------

    /** 让开放数据域拉一次好友数据并重绘（主域每次打开排行榜时调） */
    public render(): boolean {
        const c = this.wx()?.getOpenDataContext?.();
        if (!c?.postMessage) {
            if (DEBUG.LOG_STATE) console.log('[RankService] 无开放数据域（浏览器直跑），跳过');
            return false;
        }
        c.postMessage({ type: 'render' });
        return true;
    }
}
