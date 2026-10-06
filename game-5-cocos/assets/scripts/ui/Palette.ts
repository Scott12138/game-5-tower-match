/**
 * ============================================================
 *  Palette.ts · 颜色工具（UI 层最底层的依赖）
 * ============================================================
 *  【为什么单独一个文件】
 *  `hex2color` 被 UIFactory 与 TileRenderer 同时需要；而 UIFactory 又要
 *  import TileRenderer 的牌面常量 —— 直接互相 import 会成环（Cocos 的
 *  模块打包对循环依赖的处理是"拿到半初始化模块"，症状是某个常量 undefined，
 *  且只在特定加载顺序下复现）。所以颜色放最底层，两边都只往下依赖。
 *
 *  【为什么要兼容 rgba() 字符串】
 *  定稿排版稿的 `:root` 里有 `--hair: rgba(246,196,69,.16)` 这类值，
 *  而本工程的颜色 token 是**逐值照抄**设计稿的。如果 CFG 里只写十六进制，
 *  照抄就断了（得手算 alpha），所以解析器必须能吃 `rgba(r,g,b,a)`。
 * ============================================================
 */

import { Color } from 'cc';

const _cache = new Map<string, Color>();

/** 把 `#RGB` / `#RRGGBB` / `rgba(r,g,b,a)` 解析成 Color（带缓存） */
export function hex2color(hex: string, alpha = 255): Color {
    const key = alpha === 255 ? hex : `${hex}@${alpha}`;
    const hit = _cache.get(key);
    if (hit) return hit;

    const c = parse(hex, alpha);
    _cache.set(key, c);
    return c;
}

function parse(s: string, alphaOverride: number): Color {
    const str = (s || '#000000').trim();

    // —— rgba() / rgb() ——
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(str);
    if (m) {
        const r = clamp255(parseFloat(m[1]));
        const g = clamp255(parseFloat(m[2]));
        const b = clamp255(parseFloat(m[3]));
        // 只有调用方没显式给 alpha 时才用字符串里的 alpha
        const a = alphaOverride !== 255
            ? alphaOverride
            : (m[4] !== undefined ? clamp255(parseFloat(m[4]) * 255) : 255);
        return new Color(r, g, b, a);
    }

    // —— #RGB / #RRGGBB ——
    let hex = str.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length === 8) {
        // #RRGGBBAA
        const a = parseInt(hex.slice(6, 8), 16);
        const c = new Color();
        c.set(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), a);
        if (alphaOverride !== 255) c.a = alphaOverride;
        return c;
    }
    const v = parseInt(hex, 16);
    if (Number.isNaN(v)) {
        // 颜色写错不能静默变黑 —— 那会让"某处颜色不对"变成一个找不到源头的谜
        console.warn(`[Palette] 无法解析颜色 "${s}"，已回落为品红以便定位`);
        return new Color(255, 0, 255, alphaOverride);
    }
    return new Color((v >> 16) & 255, (v >> 8) & 255, v & 255, alphaOverride);
}

function clamp255(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
}

/** 取一条颜色的 CSS 串 + 覆盖 alpha（调试日志 / 二次派生用） */
export function withAlpha(hex: string, alpha: number): Color {
    return hex2color(hex, Math.max(0, Math.min(255, Math.round(alpha * 255))));
}

/** 按比例把颜色往黑里压（画"厚度层 / 暗部"用） */
export function darken(hex: string, k: number): Color {
    const c = hex2color(hex);
    return new Color(
        Math.round(c.r * (1 - k)),
        Math.round(c.g * (1 - k)),
        Math.round(c.b * (1 - k)),
        c.a,
    );
}

/**
 * 同上，但返回 **`#RRGGBB` 字符串**。
 * 渐变函数（`fillVGradient`）吃的是十六进制串而不是 Color，
 * 所以需要一个"压暗后仍是串"的版本，避免调用处到处写 `c.toHEX()` 的细节。
 */
export function darkenHex(hex: string, k: number): string {
    const c = hex2color(hex);
    const h = (v: number): string => {
        const s = Math.max(0, Math.min(255, Math.round(v * (1 - k)))).toString(16);
        return s.length === 1 ? `0${s}` : s;
    };
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * 把 Color 序列化成 `#RRGGBB`。
 * ⚠️ 不要用引擎的 `Color.toHEX()`：那个返回的是**不带 `#`** 的串，
 *    而本工程的 `hex2color` 解析器虽然容错，但统一带上 `#` 更不容易看错。
 */
export function toHex(c: Color): string {
    const h = (v: number): string => {
        const s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
        return s.length === 1 ? `0${s}` : s;
    };
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
