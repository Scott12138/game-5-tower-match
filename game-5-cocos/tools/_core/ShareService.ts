/**
 * ============================================================
 *  ShareService.ts · 微信分享（`wx.shareAppMessage` / `onShareAppMessage`）
 * ============================================================
 *  ⚠️ **不 import './cc.ts'** —— 离线自检要能直接跑它。
 *
 *  【★ 合规口径（第 53 轮用户拍板）】
 *    本类**只做传播，不发任何奖励**。分享成功与否都不改变玩家背包、金币、关卡进度。
 *    原因：微信《小游戏运营规范》把「分享后才能获得奖励」明确列为**诱导分享**。
 *    所以：
 *      · 想拿道具只有一条路 —— **看激励视频**（`AdService`）；
 *      · 「分享」按钮的文案里**不得**出现"得"/"领"/"奖励"这类字样。
 *    这条口径的落地检查写进了 `tools/_r53-verify.mjs`（断言页面无奖励字样）。
 *
 *  【两条路都要挂上才完整】
 *    · `onShareAppMessage`  —— 右上角「…」菜单里的**转发**。不挂的话点转发给的是默认卡片。
 *    · `wx.shareAppMessage`  —— 代码里**主动**拉起分享（结算页那个「分享」按钮走这条）。
 *
 *  【落地页】分享出去的 query 里带关卡号（`shareLevel`），好友点进来时主域可以
 *    读 `wx.getLaunchOptionsSync().query` 给出"好友正在第 N 关"的落地提示。
 * ============================================================
 */

import { DEBUG, SHARE } from './CFG.ts';

interface WxLike {
    showShareMenu?: (opt: { withShareTicket?: boolean; menus?: string[] }) => void;
    onShareAppMessage?: (cb: () => unknown) => void;
    shareAppMessage?: (opt: { title?: string; imageUrl?: string; query?: string }) => void;
    getLaunchOptionsSync?: () => { query?: Record<string, string> };
}

/** 分享卡片的载荷（微信的 `onShareAppMessage` 返回值结构） */
interface SharePayload {
    title: string;
    /** ★ 空串 ⇒ 不带这个字段，交给微信自动取页面截图（见 CFG.SHARE.IMAGE_URL 的注释） */
    imageUrl?: string;
    query: string;
}

export class ShareService {
    private static _instance: ShareService | null = null;
    public static get instance(): ShareService {
        if (!ShareService._instance) ShareService._instance = new ShareService();
        return ShareService._instance;
    }

    /** 转发菜单是否已挂（幂等守卫，重复 `arm` 不重复注册） */
    private _armed = false;
    /** 主动分享时需要知道的"当前关卡" —— 由页面推进来，避免服务反查页面状态 */
    private _level = 1;

    private constructor() { /* 单例 */ }

    private wx(): WxLike | undefined {
        return (globalThis as { wx?: WxLike }).wx;
    }

    /** 环境里有没有分享能力（浏览器里没有 wx ⇒ false，调用方据此把按钮降级） */
    public get available(): boolean {
        return typeof this.wx()?.shareAppMessage === 'function';
    }

    // --------------------------------------------------------
    //  ① 挂转发菜单（游戏启动时调一次）
    // --------------------------------------------------------

    /**
     * 挂右上角转发 + 显示转发菜单。**幂等**。
     * 没有 wx 时静默跳过（web-desktop 构建照常跑）。
     */
    public arm(): void {
        if (this._armed) return;
        const w = this.wx();
        if (!w?.onShareAppMessage) {
            if (DEBUG.LOG_STATE) console.log('[ShareService] 无 wx 分享能力（浏览器直跑），跳过');
            return;
        }

        // 「转发」与「分享到朋友圈」两个入口都开。朋友圈那条平台会自行处理样式。
        w.showShareMenu?.({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] });
        w.onShareAppMessage?.(() => this.payload());
        this._armed = true;
        if (DEBUG.LOG_STATE) console.log('[ShareService] 转发菜单已挂载（★ 只传播、不发奖）');
    }

    /** 页面进入时告知当前关卡号 —— 让分享文案能带上进度 */
    public setLevel(level: number): void {
        this._level = Math.max(1, Math.floor(level) || 1);
    }

    // --------------------------------------------------------
    //  ② 载荷
    // --------------------------------------------------------

    /** 生成分享卡片载荷。`withLevel=false` 用通用标题（右上角转发不知道上下文）。 */
    private payload(withLevel = true): SharePayload {
        const title = withLevel
            ? SHARE.TITLE_WITH_LEVEL.replace('%d', String(this._level))
            : SHARE.TITLE;
        const p: SharePayload = {
            title,
            query: `${SHARE.QUERY_KEY}=${this._level}`,
        };
        if (SHARE.IMAGE_URL) p.imageUrl = SHARE.IMAGE_URL;
        return p;
    }

    /**
     * 邀战载荷（首页右列「好友邀战」入口专用）。
     * 与 `payload()` 只差**标题**：走拉新文案、不带进度。
     * query 仍带关卡号 —— 好友点进来照样能拿到"好友正在第 N 关"的落地提示。
     */
    private invitePayload(): SharePayload {
        const p: SharePayload = {
            title: SHARE.TITLE_INVITE,
            query: `${SHARE.QUERY_KEY}=${this._level}`,
        };
        if (SHARE.IMAGE_URL) p.imageUrl = SHARE.IMAGE_URL;
        return p;
    }

    // --------------------------------------------------------
    //  ③ 主动分享（结算页 / 邀战入口走这条）
    // --------------------------------------------------------

    /**
     * 主动拉起转发面板。
     * @param level 可选，覆盖"当前关卡"（会同步进 `_level`）
     * @param mode  `'level'`（默认｜结算页胜态：带进度）· `'invite'`（首页邀战：拉新文案）
     * @returns 是否**真的调出去了**（平台不提供"用户有没有发成功"的回执，
     *          所以**不要**拿它当发奖依据 —— 反正我们也不发奖）。
     */
    public share(level?: number, mode: 'level' | 'invite' = 'level'): boolean {
        const w = this.wx();
        if (typeof level === 'number') this.setLevel(level);
        if (typeof w?.shareAppMessage !== 'function') {
            if (DEBUG.LOG_STATE) console.log('[ShareService] 当前环境不支持主动分享（已忽略）');
            return false;
        }
        const p = mode === 'invite' ? this.invitePayload() : this.payload();
        try {
            // ⚠️ 直接把 payload 交出去，**别在这里逐字段重列一遍**。
            //   重列会把"没有分享图"写成 `imageUrl: undefined` —— 字段**在**，
            //   而 `payload()` 的契约是"IMAGE_URL 为空 ⇒ 这个字段根本不出现"。
            //   （第 53 轮离线自检 B14 抓到的就是这处「代码与自己的注释不一致」：
            //     `payload()` 守约、`share()` 不守约。真机上 undefined 通常被当缺省，
            //     但"靠平台宽容"不是接口契约，顺手对齐掉。）
            w.shareAppMessage(p);
        } catch (e) {
            console.warn('[ShareService] shareAppMessage 抛异常：', e);
            return false;
        }
        if (DEBUG.LOG_STATE) {
            console.log(`[ShareService] 已拉起分享（${mode} · 关卡 ${this._level}）`);
        }
        return true;
    }

    // --------------------------------------------------------
    //  ④ 落地页：好友从分享链接进来时读关卡号
    // --------------------------------------------------------

    /** 读启动 query 里的关卡号；没有 / 非法 ⇒ null */
    public landingLevel(): number | null {
        const q = this.wx()?.getLaunchOptionsSync?.()?.query;
        const raw = q?.[SHARE.QUERY_KEY];
        if (raw === undefined) return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1) return null;
        if (DEBUG.LOG_STATE) console.log(`[ShareService] 落地页：好友来自第 ${n} 关的分享`);
        return Math.floor(n);
    }
}
