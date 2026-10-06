/**
 * ============================================================
 *  Haptics.ts · 触感反馈
 * ============================================================
 *  【为什么要包一层】`wx.vibrateShort` 只在微信小游戏里存在，
 *  浏览器 / 开发者工具里没有；直接调用会抛 `wx is not defined`。
 *  而"点一下牌抖一下"恰恰是这条链路上最容易被忽略、也最容易把
 *  整局交互打断的地方（异常会中断触摸回调）。
 *
 *  【为什么要节流】连续点 8 张牌会连抖 8 次，手上是"嗡嗡嗡"一片；
 *  真机上有明显的不适感。所以最短间隔 60ms。
 * ============================================================
 */

/** 微信小游戏 API 的最小声明（避免引入 @types/wechat-minigame 这一整包类型） */
interface WxHaptic {
    vibrateShort?: (o: { type?: 'heavy' | 'medium' | 'light'; fail?: () => void }) => void;
    vibrateLong?: (o: { fail?: () => void }) => void;
}
declare const wx: WxHaptic | undefined;

let _last = 0;
const MIN_GAP = 60;

export const Haptics = {
    /** 轻抖（点牌 / 落位） */
    light(): void {
        fire('light');
    },
    /** 中抖（成组消除） */
    medium(): void {
        fire('medium');
    },
    /** 重抖（失败 / 告警） */
    heavy(): void {
        fire('heavy');
    },
    /** 长震（结算落定） */
    long(): void {
        try {
            if (typeof wx !== 'undefined' && wx?.vibrateLong) wx.vibrateLong({ fail: () => { /* 不支持就算了 */ } });
        } catch { /* 忽略：触感是加分项，不该影响主流程 */ }
    },
};

function fire(type: 'heavy' | 'medium' | 'light'): void {
    const now = Date.now();
    if (now - _last < MIN_GAP) return;
    _last = now;
    try {
        if (typeof wx !== 'undefined' && wx?.vibrateShort) {
            wx.vibrateShort({ type, fail: () => { /* 不支持就算了 */ } });
        }
    } catch { /* 忽略 */ }
}
