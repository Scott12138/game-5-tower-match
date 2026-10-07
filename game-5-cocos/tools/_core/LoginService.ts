/**
 * ============================================================
 *  LoginService.ts · 微信登录（`wx.login` 拿 code）
 * ============================================================
 *  ⚠️ **不 import './cc.ts'** —— 离线自检要能直接跑它。
 *
 *  【这一版只做"拿到 code"，不换 openid】
 *    `wx.login` 给的 `code` 只是**一次性票据**，要用它去**自己的服务器**调
 *    `code2Session` 才换得到 openid / session_key。本项目现在**没有后端**，
 *    所以本服务的职责到此为止：拿到 code、落日志、缓存起来，供后续（排行榜 / 云存档）
 *    真正需要时取用。**不做任何网络请求**。
 *
 *  【铁律：登录失败绝不能阻塞游戏】
 *    取不到 code 时返回 `null`，游戏照常能玩。理由很直白 ——
 *    登录是"锦上添花"的能力，让它卡住主流程是本末倒置。
 *    因此这里给 `wx.login` 挂了**看门狗**：超时即放弃，不等。
 * ============================================================
 */

import { DEBUG, LOGIN } from './CFG.ts';

interface WxLike {
    login?: (opt: {
        success?: (res: { code?: string; errMsg?: string }) => void;
        fail?: (err: { errMsg?: string }) => void;
        timeout?: number;
    }) => void;
}

export class LoginService {
    private static _instance: LoginService | null = null;
    public static get instance(): LoginService {
        if (!LoginService._instance) LoginService._instance = new LoginService();
        return LoginService._instance;
    }

    /** 已拿到的 code（**一次性票据，用过即废**，所以每次要新的都得重新 `wx.login`） */
    private _code: string | null = null;
    /** 正在进行中的一次登录请求（并发合并：10 个地方同时要 code 只调一次 wx.login） */
    private _inflight: Promise<string | null> | null = null;

    private constructor() { /* 单例 */ }

    private wx(): WxLike | undefined {
        return (globalThis as { wx?: WxLike }).wx;
    }

    /** 当前缓存的 code（没有则 null）。⚠️ 它随时可能失效，别长期持有。 */
    public get code(): string | null { return this._code; }

    /** 环境里有没有登录能力 */
    public get available(): boolean {
        return typeof this.wx()?.login === 'function';
    }

    /**
     * 确保拿到一个 code。**永不 reject、永不阻塞** ——
     * 失败 / 超时 / 环境不支持一律 `resolve(null)`，调用方只需判空。
     */
    public ensureCode(): Promise<string | null> {
        if (this._code) return Promise.resolve(this._code);
        if (this._inflight) return this._inflight;      // 并发合并

        const w = this.wx();
        if (typeof w?.login !== 'function') {
            if (DEBUG.LOG_STATE) console.log('[LoginService] 无 wx.login（浏览器直跑），跳过');
            return Promise.resolve(null);
        }

        this._inflight = new Promise<string | null>((resolve) => {
            let done = false;
            const finish = (code: string | null): void => {
                if (done) return;                       // 幂等：success 与看门狗只会有一个生效
                done = true;
                clearTimeout(watchdog);
                this._inflight = null;
                resolve(code);
            };
            // 看门狗：微信偶尔既不回调 success 也不回调 fail（弱网 / 平台抖动），必须兜底
            const watchdog = setTimeout(() => {
                console.warn(`[LoginService] wx.login 超过 ${LOGIN.TIMEOUT_MS}ms 无回调 ⇒ 放弃（不阻塞游戏）`);
                finish(null);
            }, LOGIN.TIMEOUT_MS);

            try {
                w.login!({
                    timeout: LOGIN.TIMEOUT_MS,
                    success: (res) => {
                        const c = res?.code;
                        if (!c) {
                            console.warn('[LoginService] wx.login 成功但无 code：', res?.errMsg);
                            finish(null);
                            return;
                        }
                        this._code = c;
                        // ⚠️ code 本身不算敏感凭据（一次性、换完即废），可以打日志；
                        //    但**不能**打 AppSecret —— 那个东西永远不该出现在客户端。
                        console.log(`[LoginService] ✔ 拿到 code（${c.length} 字符，已缓存）`);
                        finish(c);
                    },
                    fail: (err) => {
                        console.warn('[LoginService] wx.login 失败（不阻塞游戏）：', err?.errMsg);
                        finish(null);
                    },
                });
            } catch (e) {
                console.warn('[LoginService] wx.login 抛异常（不阻塞游戏）：', e);
                finish(null);
            }
        });

        return this._inflight;
    }

    /** 作废缓存的 code（票据用过就废，换 openid 之后应调一次） */
    public invalidate(): void {
        this._code = null;
    }
}
