/**
 * ============================================================
 *  UIFactory.ts · 界面工厂（本工程 UI 的唯一构件来源）
 * ============================================================
 *  定位：**代码驱动 UI**。场景文件里一个控件都没有，所有界面都由这里造出来。
 *  因此本文件是"视觉规范"的落点 —— 业务页面只允许调用这里的函数，
 *  不允许自己 `new Node()` 画界面（那样规范就散了，改一处颜色要翻十个文件）。
 *
 *  ★ 按钮"五要素必须一次配齐"（game-4 血泪）：
 *      ① 触摸区尺寸   ② 可见图形   ③ 文字   ④ 状态（按下/禁用）   ⑤ 事件
 *    少任何一条的典型症状：按钮看得见、点不动（触摸区没设）；
 *    或者点得动、但手指离开按钮范围就丢（TOUCH_CANCEL 没接）。
 * ============================================================
 */

// ⚠️ 不要从 'cc' import `log`/`warn`：release 构建 debugMode=ERROR，
//    引擎只在 mode<=INFO 时绑定 ccLog、只在 mode!==ERROR 时绑定 ccWarn，
//    ⇒ 打包产物里它们是空函数。日志一律用 console.log / console.warn。
import {
    AssetManager, Color, Graphics, Label, LabelOutline, Layers, Node, Rect, Size, Sprite, SpriteFrame,
    Tween, UIOpacity, UITransform, Widget, assetManager, resources, tween, v3, view,
} from 'cc';

import { COLOR, FONT, GAME, MOTION, SAFE_BOTTOM, SAFE_TOP, SKIN } from '../CFG';
import { Layout } from './Layout';
import { EASE, MotionFx, TAG } from './MotionFx';
import { hex2color } from './Palette';

// ============================================================
//  一、绘制基元
// ============================================================

/**
 * 圆角矩形路径（**只建路径，不填充**）。
 * 允许半径超过半边长（自动钳制）—— 这样 `r = 999` 就能表达"胶囊"，
 * 调用方不必为每颗按钮算 `min(w,h)/2`。
 */
export function roundRectPath(
    g: Graphics, x: number, y: number, w: number, h: number, r: number,
): void {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    // Cocos 的 roundRect 在 rr=0 时仍然可用（退化成直角）
    g.roundRect(x, y, w, h, rr);
}

/** 填充圆角矩形（中心对齐：x,y 是中心） */
export function fillRoundRect(
    g: Graphics, cx: number, cy: number, w: number, h: number, r: number,
    fill: string, alpha = 255,
): void {
    g.fillColor = hex2color(fill, alpha);
    roundRectPath(g, cx - w / 2, cy - h / 2, w, h, r);
    g.fill();
}

/** 描边圆角矩形 */
export function strokeRoundRect(
    g: Graphics, cx: number, cy: number, w: number, h: number, r: number,
    line: string, lineWidth: number, alpha = 255,
): void {
    g.lineWidth = lineWidth;
    g.strokeColor = hex2color(line, alpha);
    roundRectPath(g, cx - w / 2, cy - h / 2, w, h, r);
    g.stroke();
}

/**
 * 圆角矩形在「距形心 dyAbs」高度处，左右各要内缩多少 —— 也就是轮廓相对满宽的内缩量。
 * 直边段返回 0；进入圆角区后返回 `r − √(r² − k²)`（k = 从直边段末端起算深入圆角区的距离）。
 *
 * 【为什么必须要有它 —— 第 39 轮血案】
 *   旧 `fillVGradient` 把渐变切成横带，**只给首尾两条**传 `r`，中间的传 0。
 *   而带高只有 `h/steps`（按钮 ~4px），`roundRectPath` 又把超出半高的 `r`
 *   钳到 `min(w,h)/2 ≈ 2px` ⇒ 26 条带里 **24 条是全宽直角矩形**。
 *   结果：按钮顶面渲染出来是个**矩形**，只有 3px 描边还画在真正的胶囊路径上，
 *   ⇒ 四个角上露出方形色块。用户原话："突出来的角很丑""不够圆润"。
 *   实测铁证：真机 1264×2780 截图里，1052×144 的金按钮**从上到下 144 行宽度恒为 1052**，
 *   圆角半径为 0（量测脚本 tools/r39-corner.py）。
 *   ⇒ 正确做法：**每条带都按轮廓函数收窄**，而不是靠圆角矩形去"凑"。
 */
function shapeInset(dyAbs: number, halfH: number, r: number): number {
    const R = Math.max(0, Math.min(r, halfH));
    const straight = halfH - R;                     // 直边段半高
    const d = Math.abs(dyAbs);
    if (R <= 0 || d <= straight) return 0;
    const k = Math.min(R, d - straight);
    return R - Math.sqrt(Math.max(0, R * R - k * k));
}

/**
 * 用「水平切片带」逼近竖向渐变，**每条带都按轮廓函数收窄** ⇒ 渐变永远落在圆角形内部。
 *
 * @param cx        形心 x（所有点都以此为中心左右对称）
 * @param halfW     形半宽
 * @param centerY   形心 y（用来算每条带距形心的距离，喂给 `insetAt`）
 * @param yTop/yBot 要填充的竖直范围（本地 y，**+y 向上**）
 * @param colorAt   给 0~1 返回该带的颜色
 * @param insetAt   给「距形心距离」返回横向内缩量，见 `shapeInset`
 */
function bandedFill(
    g: Graphics, cx: number, halfW: number, centerY: number, yTop: number, yBot: number,
    steps: number, colorAt: (t: number) => Color, insetAt: (dyAbs: number) => number,
): void {
    const total = yTop - yBot;
    if (total <= 0 || halfW <= 0) return;
    const band = total / steps;
    // 每条带内部再取 3 个 y 采样：圆角区里轮廓是曲线，
    // 只取上下两端会退化成"折线"，在胶囊两端能看出斜切面。
    const SUB = 3;
    for (let i = 0; i < steps; i++) {
        g.fillColor = colorAt(i / Math.max(1, steps - 1));
        const yT = yTop - band * i;
        // 末条不越界；其余往下多留 0.5px 重叠，消掉带与带之间的抗锯齿缝
        const yB = i === steps - 1 ? yBot : Math.max(yBot, yT - band - 0.5);
        const lx: number[] = [];
        const rx: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k <= SUB; k++) {
            const y = yT + (yB - yT) * (k / SUB);
            const ins = insetAt(Math.abs(y - centerY));
            ys.push(y);
            lx.push(cx - halfW + ins);
            rx.push(cx + halfW - ins);
        }
        g.moveTo(lx[0], ys[0]);
        for (let k = 1; k <= SUB; k++) g.lineTo(lx[k], ys[k]);
        for (let k = SUB; k >= 0; k--) g.lineTo(rx[k], ys[k]);
        g.close();
        g.fill();
    }
}

/**
 * 竖向渐变（用横带逼近）。
 *
 * 【为什么自己画】Cocos 的 `Graphics` 没有渐变填充；而本作的主按钮、
 * 舞台背景、赠礼卡都是渐变。用 26~32 条横带逼近，在本工程的尺寸下色阶差 < 2/255，
 * 肉眼完全看不出横带。（真要严格的话得写自定义材质，为这点收益不值得。）
 *
 * ⚠️ 每条带的宽度**必须**按圆角轮廓收窄，见 `shapeInset` 的注释（第 39 轮方角血案）。
 */
export function fillVGradient(
    g: Graphics, cx: number, cy: number, w: number, h: number, r: number,
    topHex: string, bottomHex: string, steps = 32,
): void {
    const top = hex2color(topHex);
    const bot = hex2color(bottomHex);
    const halfH = h / 2;
    const colorAt = (t: number): Color => new Color(
        Math.round(top.r + (bot.r - top.r) * t),
        Math.round(top.g + (bot.g - top.g) * t),
        Math.round(top.b + (bot.b - top.b) * t),
        Math.round(top.a + (bot.a - top.a) * t),
    );
    // 直角矩形（`r = 0`）走老路：`roundRect` 顶点更少，且没必要采样轮廓
    if (r <= 0) {
        const y0 = cy + halfH;
        const band = h / steps;
        for (let i = 0; i < steps; i++) {
            g.fillColor = colorAt(i / Math.max(1, steps - 1));
            roundRectPath(g, cx - w / 2, y0 - band * i - band, w, band + 0.6, 0);
            g.fill();
        }
        return;
    }
    bandedFill(g, cx, w / 2, cy, cy + halfH, cy - halfH, steps,
        colorAt, (d: number): number => shapeInset(d, halfH, r));
}

/**
 * 顶缘柔光：**贴着按钮顶弧、随轮廓自动收窄**的半透明白色渐隐带。
 *
 * 对应定稿稿 `.btn-gold{ box-shadow: …, inset 0 3px 4px rgba(255,255,255,.7) }`。
 * CSS 的 inset 阴影会跟着 `border-radius` 走，所以这里也必须跟着**外层轮廓**走 ——
 * 高光带的左右边界直接取外层圆角形在该高度的边界，而不是自己再画一个圆角矩形。
 *
 * ⚠️ 旧实现是「90% 宽 / 34% 高的白色硬边圆角矩形」，换成渐变后又把
 *   `radius − inset` 当自己的圆角传进去；带子只有 16px 高、圆角被钳到 ~1.6px
 *   ⇒ **高光条在按钮两端戳出轮廓之外**，看着就像左右各多长出一个浅色方角。
 *   这与上面的"方角"是**同一个病的两个症状**。
 */
export function fillTopSheen(
    g: Graphics, cx: number, cy: number, w: number, h: number, r: number,
    bandH: number, alpha: number, steps = 6,
): void {
    const halfH = h / 2;
    const yTop = cy + halfH - 3.5;                  // 顶边内缩 3.5，躲开 3px 描边
    const yBot = Math.max(cy - halfH, yTop - bandH);
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    bandedFill(g, cx, w / 2, cy, yTop, yBot, steps,
        (t: number): Color => new Color(255, 255, 255, Math.round(a * (1 - t))),
        (d: number): number => shapeInset(d, halfH, r));
}

/** 径向柔光（近似 CSS radial-gradient）—— 光圈层数少，避免顶点爆量 */
export function fillRadialGlow(
    g: Graphics, cx: number, cy: number, r: number, hex: string, peakAlpha: number, rings = 18,
): void {
    fillRadialGlowE(g, cx, cy, r, r, hex, peakAlpha, rings);
}

/**
 * 径向柔光（**椭圆**版）。
 *
 * 【为什么必须分椭圆/正圆】定稿稿的柔光全是 `radial-gradient(closest-side, …)`，
 * 而承载它的元素宽高比各不相同：
 *   · 吉祥物接触投影 340×52（**6.5:1** 的扁椭圆）
 *   · 光池 660×500 / 440×470（近圆的椭圆）
 * 旧实现一律画**正圆** ⇒ 接触投影变成了一个直径 340 的黑圆饼（用户截图里
 * 吉祥物下方那团"黑洞"就是这么来的，定稿稿里它只是脚下一道很扁的软影）。
 *
 * @param rx,ry 椭圆的横/纵半径
 */
export function fillRadialGlowE(
    g: Graphics, cx: number, cy: number, rx: number, ry: number,
    hex: string, peakAlpha: number, rings = 18,
): void {
    const c = hex2color(hex);
    for (let i = rings; i >= 1; i--) {
        const k = i / rings;
        const a = Math.round(peakAlpha * (1 - k) * (1 - k));
        if (a <= 0) continue;
        g.fillColor = new Color(c.r, c.g, c.b, a);
        g.ellipse(cx, cy, rx * k, ry * k);
        g.fill();
    }
}

/**
 * 吉祥物背后的**放射光芒**（12 道扇，形制逐值照抄定稿稿的 `.rays`）。
 *
 * 定稿稿配方：
 *   background      : repeating-conic-gradient(from 0deg, rgba(255,244,200,.075) 0deg 9deg,
 *                                              transparent 9deg 30deg)
 *   mask-image      : radial-gradient(closest-side, rgba(0,0,0,.9), transparent 72%)
 *   opacity         : .8
 *   animation       : 46s 匀速自转
 *
 * 【旧实现的毛病】把每道扇画成**等 alpha 的硬边扇形**、一直到最外沿才断掉 ——
 * 定稿稿真正的样子是"越往外越淡、72% 半径处归零"。少了这层径向淡出，
 * 光芒在读感上不是"光"而是一把 12 齿的伞（用户截图里吉祥物背后的锯齿就是这么来的）。
 *
 * @param r      光芒半径（定稿稿 520/2 = 260 · 首页 460/2 = 230）
 * @param peak   中心处 alpha（0-255）—— 定稿稿 = 底色 alpha × opacity
 *               （启动页 0.075×255×0.8 ≈ 15 · 首页 0.07×255×0.8 ≈ 14）
 */
export function fillRays(
    g: Graphics, r: number, peak: number, opts: {
        hex?: string; count?: number; stepDeg?: number; sweepDeg?: number;
        /** mask 归零的归一化半径（定稿稿 0.72） */
        fadeAt?: number;
        /** mask 中心值（定稿稿 0.9） */
        maskPeak?: number;
        bands?: number;
    } = {},
): void {
    const hex = opts.hex ?? '#FFF4C8';
    const count = opts.count ?? 12;
    const stepDeg = opts.stepDeg ?? 30;
    const sweepDeg = opts.sweepDeg ?? 9;
    const fadeAt = opts.fadeAt ?? 0.72;
    const maskPeak = opts.maskPeak ?? 0.9;
    const bands = opts.bands ?? 10;
    const c = hex2color(hex);

    for (let i = 0; i < count; i++) {
        const a0 = (i * stepDeg) * Math.PI / 180;
        const a1 = a0 + sweepDeg * Math.PI / 180;
        for (let b = 0; b < bands; b++) {
            const k0 = b / bands;
            const k1 = (b + 1) / bands;
            const kc = (k0 + k1) / 2;
            // 径向 mask：中心 maskPeak，到 fadeAt 线性归零
            const m = kc >= fadeAt ? 0 : maskPeak * (1 - kc / fadeAt);
            const alpha = Math.round(peak * m);
            if (alpha <= 0) continue;
            // 越靠外 alpha 越低：同色多段叠加会互相加深，所以每段单独 fill
            g.fillColor = new Color(c.r, c.g, c.b, alpha);
            g.moveTo(Math.cos(a0) * r * k0, Math.sin(a0) * r * k0);
            for (let s = 0; s <= 6; s++) {
                const a = a0 + (a1 - a0) * (s / 6);
                g.lineTo(Math.cos(a) * r * k1, Math.sin(a) * r * k1);
            }
            for (let s = 6; s >= 0; s--) {
                const a = a0 + (a1 - a0) * (s / 6);
                g.lineTo(Math.cos(a) * r * k0, Math.sin(a) * r * k0);
            }
            g.close();
            g.fill();
        }
    }
}

/** 实心圆 */
export function fillCircle(
    g: Graphics, cx: number, cy: number, r: number, fill: string, alpha = 255,
): void {
    g.fillColor = hex2color(fill, alpha);
    g.circle(cx, cy, r);
    g.fill();
}

// ============================================================
//  一之二、★ 背景暗角（第 34 轮 —— 两次踩坑后的最终口径）
// ============================================================
//
//  【定稿稿的真实配方】（`assets/splash/启动页-定稿.html` L34-35）
//      .vignette{ inset:0;
//        background:radial-gradient(150% 100% at 50% 42%, transparent 50%, rgba(0,0,0,.36) 100%) }
//  中心 (50%,42%)、横半径 = 1.5×画布宽、纵半径 = 1×画布高的**椭圆**；
//  k ∈ [0, 0.5] 完全透明，k = 0.5→1 线性加深到 0.36。
//
//  ⚠️⚠️ 把它算到真机上，效果**几乎为零**，只在底部两角有一点点：
//      左/右边缘中点 k = 375/1125 = 0.333 → **alpha 0**
//      顶边中点      k = 0.42          → **alpha 0**
//      底边中点      k = 0.58          → alpha 5.8%
//      左下/右下角   k = 0.669         → alpha 12.1%
//      左上/右上角   k = 0.536         → alpha 2.6%
//  而底部本来就有 `.grounding` 那层 0→30% 的落地渐变把它盖住了。
//  ⇒ **这层暗角在本作里是"可以不要"的**，真正给背景做纵深的是
//    「光池 + 顶光 + 底部落地」这三层。
//
//  【两次错误实现，留作教训】
//   ① 最初用 16 个**同心实心圆**，半径 R = max(w,h)×0.80 = 1321，而屏幕
//      半对角线只有 906 —— 每圈都盖住全屏，16 层 alpha 连乘后**透射率仅 10.3%**，
//      整屏压黑（用户截图"全黑"）。
//   ② 我改成"只在 k ∈ [inner,1] 铺环带"的嵌套**实心**椭圆 —— 但嵌套实心图形
//      有个数学事实：**点被覆盖的层数随半径单调递减**，所以累积 alpha 必然
//      「中心最深、边缘最浅」，方向**天然是反的**，做不出暗角
//      （实测：k ≤ 0.519 处 26 层全叠 ⇒ 35% 黑幕；k = 0.9 处只剩 6 层 ⇒ 9%）。
//      → 想用 Graphics 做暗角**只能用带孔的环带**（描边或纹理），
//        嵌套实心图形**原理上做不到**。
//
//  ⇒ 最终决定：**不再画暗角**，与定稿稿实测观感一致（差值 ≤ 6%）。

/**
 * （保留空实现以防有页面仍在调用）
 *
 * @deprecated 见本节说明 —— 嵌套实心椭圆无法做出暗角；定稿稿的椭圆暗角
 *             在真机上实测 ≈ 0。请改用「光池 + 顶光 + 底部落地」三层。
 */
export function fillVignette(_g: Graphics, _w: number, _h: number): void {
    /* no-op：故意留空。历史实现见上方注释，勿恢复。 */
}

/**
 * 横向「柔化」的竖向渐变光带 —— 逐值复刻定稿稿的 `.beam`：
 *      background: linear-gradient(180deg, transparent 0%, rgba(255,232,170,.075) 16%,
 *                  rgba(255,232,170,.05) 56%, rgba(255,232,170,.075) 86%, transparent 100%);
 *      mask-image: linear-gradient(90deg, transparent, #000 24%, #000 76%, transparent);
 *
 * 【为什么必须重写】旧实现用 5 段 × 6 个**硬边矩形**横向递减宽度叠出来，
 * 矩形之间 alpha 是阶跃的 ⇒ 在深色背景上直接读成"一块块方格"（用户圈出来的方块）。
 * 定稿稿真正的柔化来自那条**横向 mask**：两侧 24% 线性淡出、中间 52% 满值。
 *
 * 实现：横向切 `cols` 列，每列 alpha = 纵向折线取值 × 横向 mask 取值。
 * 列宽 380/24 ≈ 15.8px，相邻列 alpha 差 < 2/255 ⇒ 肉眼无阶梯。
 *
 * @param w,h     光带尺寸（设计 px，节点已定位好，内部以节点中心为原点）
 * @param vStops  纵向折线 `[位置0~1, alpha0~1][]`（位置自上而下）
 * @param hFade   两侧淡出宽度占宽的比例（定稿稿 0.24）
 * @param hSolid  中间满值区起点/终点占比（定稿稿 0.24 / 0.76）—— 即 [hFade, 1-hFade]
 */
export function fillSoftBeam(
    g: Graphics, w: number, h: number,
    vStops: ReadonlyArray<readonly [number, number]>,
    hex: string, hFade = 0.24, cols = 24,
): void {
    const c = hex2color(hex);
    const vAt = (t: number): number => {
        if (t <= vStops[0][0]) return vStops[0][1];
        for (let i = 0; i < vStops.length - 1; i++) {
            const [t0, a0] = vStops[i];
            const [t1, a1] = vStops[i + 1];
            if (t >= t0 && t <= t1) {
                const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
                return a0 + (a1 - a0) * u;
            }
        }
        return vStops[vStops.length - 1][1];
    };
    // 横向 mask：0 → hFade 线性升起，中段满值，1-hFade → 1 线性落下
    const hAt = (u: number): number => {
        if (u <= hFade) return u / hFade;
        if (u >= 1 - hFade) return (1 - u) / hFade;
        return 1;
    };

    const stepH = h / 8;                       // 纵向分 8 带（折线本身很平缓）
    const colW = w / cols;
    for (let ci = 0; ci < cols; ci++) {
        const u = (ci + 0.5) / cols;
        const mx = hAt(u);
        if (mx <= 0.004) continue;
        const x = -w / 2 + colW * ci;
        for (let si = 0; si < 8; si++) {
            const t = (si + 0.5) / 8;
            const av = vAt(t) * mx;
            const alpha = Math.round(255 * av);
            if (alpha <= 0) continue;
            g.fillColor = new Color(c.r, c.g, c.b, alpha);
            // 顶边向下量 t ⇒ 引擎 y（0.5 处为画布中心）
            const y = h / 2 - h * ((si + 1) / 8);
            // +0.6 的重叠：避免相邻列/带之间因浮点取整露出 1px 缝
            g.rect(x, y, colW + 0.6, stepH + 0.6);
            g.fill();
        }
    }
}

/** 描边圆 */
export function strokeCircle(
    g: Graphics, cx: number, cy: number, r: number, line: string, lw: number, alpha = 255,
): void {
    g.lineWidth = lw;
    g.strokeColor = hex2color(line, alpha);
    g.circle(cx, cy, r);
    g.stroke();
}

/**
 * alpha 绘制器：把"逐帧重绘"包装成一个可补间对象。
 *
 * 【用途】遮罩层、告警呼吸、赠礼过场这类需要**中间透明度**的图形。
 *   （普通淡入淡出用 UIOpacity 就行，别用这个 —— 它重绘有开销。）
 *
 * ⚠️ 用它的补间必须**每一段 `.to()` 都写 `onUpdate`**：
 *    只写在最后一段的话，前面几段不重绘（画面上是"前两段没动，最后一段突然动"）。
 */
export function alphaPainter(
    g: Graphics,
    paint: (g: Graphics, alpha255: number) => void,
    initA = 1,
): { a: number; redraw: () => void } {
    const holder = {
        a: initA,
        redraw: (): void => {
            if (!g || !g.isValid) return;
            g.clear();
            if (holder.a <= 0.002) return;   // 留着上一帧的图形在真机上会看到残影
            const v = Math.max(0, Math.min(1, holder.a));
            paint(g, Math.round(v * 255));
        },
    };
    holder.redraw();
    return holder;
}

// ============================================================
//  二、节点
// ============================================================

export interface NodeOpts {
    w?: number;
    h?: number;
    x?: number;
    y?: number;
    /** 锚点（默认 0.5, 0.5）。左对齐布局用 (0, 0.5) */
    anchor?: [number, number];
}

/** 建一个带 UITransform 的空节点（UI 一切的基础） */
export function createNode(name: string, parent: Node, opts: NodeOpts = {}): Node {
    const node = new Node(name);
    parent.addChild(node);

    // ⚠️ 关键：代码创建的节点默认在 DEFAULT 层，2D UI 必须归属 UI_2D 层
    // （不设的话在部分平台会不渲染 / 批次错乱，且不报错）
    node.layer = Layers.Enum.UI_2D;

    const ui = node.addComponent(UITransform);
    const a = opts.anchor ?? [0.5, 0.5];
    ui.setAnchorPoint(a[0], a[1]);
    if (opts.w !== undefined && opts.h !== undefined) {
        ui.setContentSize(opts.w, opts.h);
    }
    node.setPosition(opts.x ?? 0, opts.y ?? 0, 0);
    return node;
}

/** 建一个铺满父节点的容器（用来做"层"） */
export function createLayer(name: string, parent: Node): Node {
    const node = createNode(name, parent);
    const w = node.addComponent(Widget);
    w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
    w.top = w.bottom = w.left = w.right = 0;
    w.alignMode = Widget.AlignMode.ALWAYS;
    return node;
}

/** 给节点挂一个 Graphics 并返回（常用于自绘底板） */
export function createGraphicsNode(
    name: string, parent: Node, opts: NodeOpts = {},
): { node: Node; g: Graphics } {
    const node = createNode(name, parent, opts);
    const g = node.addComponent(Graphics);
    return { node, g };
}

// ============================================================
//  三、文字
// ============================================================

export interface LabelOpts extends NodeOpts {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    /** 衬线体（标题 / 牌面 / 大数字用） */
    serif?: boolean;
    /** 描边（浅底上的深字用） */
    outline?: string;
    outlineWidth?: number;
    lineHeightRatio?: number;
    /** 左对齐：此时 `x` 是**左边界**（锚点被移到左边，比每次手算宽度稳） */
    alignLeft?: boolean;
    /** 文字换行宽度（给了就开 CLAMP 换行） */
    wrapW?: number;
}

/** 创建一段文字 */
export function createLabel(parent: Node, text: string, opts: LabelOpts = {}): Label {
    const node = createNode('Label', parent, opts);
    const label = node.addComponent(Label);

    const fontSize = opts.fontSize ?? FONT.BODY;

    if (opts.alignLeft && opts.w !== undefined) {
        const ui = node.getComponent(UITransform)!;
        ui.setAnchorPoint(0, 0.5);
        node.setPosition(opts.x ?? 0, opts.y ?? 0, 0);
    }

    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize * (opts.lineHeightRatio ?? 1.25);
    label.color = hex2color(opts.color ?? COLOR.CREAM);
    label.isBold = opts.bold ?? false;

    if (opts.wrapW !== undefined) {
        const ui = node.getComponent(UITransform)!;
        ui.setContentSize(opts.wrapW, opts.h ?? fontSize * 1.4);
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.enableWrapText = true;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
    } else {
        label.overflow = Label.Overflow.NONE;   // 自适应，不裁切
        label.horizontalAlign = opts.alignLeft ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    }
    label.verticalAlign = Label.VerticalAlign.CENTER;

    // 引擎不打包字体，靠平台回退 —— 中文衬线在 iOS 是 Songti SC、Android 多为 Noto Serif。
    // 拿不到就退到系统默认（观感会差一点，但不会出方块）。
    label.useSystemFont = true;
    label.fontFamily = opts.serif
        ? `${FONT.SERIF}, STSong, SimSun, serif`
        : `${FONT.SANS}, Hiragino Sans GB, Heiti SC, sans-serif`;

    if (opts.outline) {
        const ol = node.addComponent(LabelOutline);
        ol.color = hex2color(opts.outline);
        ol.width = opts.outlineWidth ?? 3;
    }
    return label;
}

/**
 * 估一段文字的像素宽。
 *
 * 【为什么需要估】`Label` 的真实宽度来自平台字体度量，**构建期拿不到**；
 * 而布局（顶条弹性分段、按钮自动缩字）发生在构建那一刻。
 * 中日韩全角按 `1.0 × 字号`、其余按 `0.56 × 字号` —— 实测与本机字体偏差 ±3px。
 */
export function estTextWidth(text: string, size: number): number {
    let w = 0;
    for (const ch of text) {
        w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56;
    }
    return w;
}

/**
 * 按可用宽度**收敛字号**（只缩不放）。
 *
 * 【为什么必须做成工厂的默认行为】文字一律 `overflow: NONE`，
 * 所以超宽文案**不是被裁掉、而是直接画到按钮外面去** —— 最难看的一种失败。
 * 手工逐个调字号治不了根：文案一改、多一个状态、换台设备换个字体，问题就回来。
 *
 * @param text   可给数组表示"同一颗按钮的多个状态"，取最宽的那个
 *               （否则同一颗按钮会随文案长短忽大忽小）
 */
export function fitFontSize(
    text: string | readonly string[],
    maxW: number,
    startSize: number,
    minSize = 16,
): number {
    const list = typeof text === 'string' ? [text] : text;
    let need = 0;
    for (const t of list) need = Math.max(need, estTextWidth(t, startSize));
    if (need <= maxW || need <= 0) return startSize;
    const scaled = Math.floor(startSize * (maxW / need));
    return Math.max(minSize, scaled);
}

// ============================================================
//  四、贴图加载（带缓存 + 同路径并发合并 + 跨 Bundle 路由）
// ============================================================
//
//  【为什么要拆 Bundle】（2026-10-06 第 2 轮包体治理）
//  微信小游戏 **主包上限 4MB**，而全部原始素材约 7MB —— 全塞进主包必然超限；
//  而把 PNG 转 WebP 这条路是**死的**（微信真机 `cc.sys.capabilities.webp === false`，
//  引擎产物里 `if ('.webp' === d && !hasFeature(WEBP)) continue;` 会把 59 张图
//  整批静默丢弃，画面只剩矢量图形）。所以只能"按用到的时机分层拆包"：
//
//      主包 resources/  →  splash/ + audio/                    （启动页当场就要）
//      Bundle 'home'    →  home/                               （首页）
//      Bundle 'game'    →  tiles/ + game-start/ + game-play/    （开局页与主玩页）
//
//  两张自定义 Bundle 在构建时配成 **小游戏分包**，产物落
//  `build/wechatgame/subpackages/<bundleName>/`，于是主包只剩 splash + audio。
//
//  【调用方完全无感】所有路径字符串**一个字都没改**（`tiles/wan/wan1` 还是它），
//  改的只是"去哪张资源表里查" —— 路由表就在下面，将来新增目录只改这一处。
//  这是刻意的：`loadFrame(path, cb)` 的签名保持不变，20 多处调用点一行都不用动。

/** 路径前缀 → Bundle 名（`''` 表示内置 `resources`，即主包） */
const BUNDLE_ROUTES: ReadonlyArray<readonly [string, string]> = [
    ['home/', 'home'],
    ['tiles/', 'game'],
    ['game-start/', 'game'],
    ['game-play/', 'game'],
    // 主玩页桌外底色（第 42 轮）：渐变件 + 织锦平铺件，放 game 分包省主包配额
    ['bg/', 'game'],
];

/** 查一个资源路径属于哪张 Bundle（`''` = 主包 resources） */
export function bundleNameOf(path: string): string {
    for (let i = 0; i < BUNDLE_ROUTES.length; i++) {
        const r = BUNDLE_ROUTES[i];
        if (path.startsWith(r[0])) return r[1];
    }
    return '';
}

const _bundleWait = new Map<string, Promise<AssetManager.Bundle | null>>();

/**
 * 取一张 Bundle，**没有就自动去加载**。
 *
 * ⚠️ 这里必须"缺了就补加载"，不能只 `assetManager.getBundle(name)` 查一下 ——
 *    查不到就回调 null 的话，表现是**图片静默不显示**（控制台只留一行 warn），
 *    这正是本工程第一版（WebP 版）栽过的坑。让每次 `loadFrame` 都能自己把包拉起来，
 *    调用方就不必关心"当前页面需要哪张包、包加载好没有"。
 *
 * 【失败不缓存】加载失败时把 promise 从表里删掉，下次调用还能重试 ——
 *    否则一次网络抖动会把这张包**永久钉死**在失败态。
 */
export function ensureBundle(name: string): Promise<AssetManager.Bundle | null> {
    if (!name) return Promise.resolve(resources as unknown as AssetManager.Bundle);
    const hit = assetManager.getBundle(name);
    if (hit) return Promise.resolve(hit);
    const pending = _bundleWait.get(name);
    if (pending) return pending;

    const p = new Promise<AssetManager.Bundle | null>((resolve) => {
        assetManager.loadBundle(name, (err: Error | null, b: AssetManager.Bundle) => {
            if (err || !b) {
                console.warn(`[UIFactory] Bundle 加载失败：${name}`, err?.message ?? '');
                _bundleWait.delete(name);
                resolve(null);
                return;
            }
            resolve(b);
        });
    });
    _bundleWait.set(name, p);
    return p;
}

/**
 * 预加载若干 Bundle（启动页用）。
 * `onEach` 每完成一张回调一次，用来推**真实**进度 —— 不是假进度条。
 */
export function preloadBundles(
    names: string[], onEach: (done: number, total: number) => void,
): Promise<void> {
    let done = 0;
    const total = names.length;
    if (total === 0) return Promise.resolve();
    return Promise.all(names.map((n) => ensureBundle(n).then((b) => {
        onEach(++done, total);
        return b;
    }))).then(() => undefined);
}

const _frameCache = new Map<string, SpriteFrame>();
const _frameQueue = new Map<string, Array<(sf: SpriteFrame | null) => void>>();

/**
 * 加载一张 SpriteFrame（自动路由到所属 Bundle：主包 / home / game）。
 *
 * ⚠️ 路径末尾的 `/spriteFrame` **不能省**：图片被导入后自身是 `ImageAsset`，
 *    `SpriteFrame` 是挂在它下面的**子资源**；少了这一段会"加载成功但拿到
 *    ImageAsset"，赋给 Sprite 无效（画面空白，控制台不报错）—— 静默失败里最难查的一种。
 */
export function loadFrame(path: string, cb: (sf: SpriteFrame | null) => void): void {
    const hit = _frameCache.get(path);
    if (hit) { cb(hit); return; }
    const q = _frameQueue.get(path);
    if (q) { q.push(cb); return; }
    _frameQueue.set(path, [cb]);

    /** 收口：无论成功失败都只走这里一次（成功入缓存，失败记 bundle 名便于定位） */
    const settle = (sf: SpriteFrame | null): void => {
        const list = _frameQueue.get(path) ?? [];
        _frameQueue.delete(path);
        if (sf) {
            _frameCache.set(path, sf);
        } else {
            console.warn(
                `[UIFactory] 加载贴图失败：${path}（bundle=${bundleNameOf(path) || 'resources'}）`,
            );
        }
        for (const f of list) f(sf);
    };

    const bundleName = bundleNameOf(path);
    ensureBundle(bundleName).then((b) => {
        if (!b) { settle(null); return; }
        b.load(`${path}/spriteFrame`, SpriteFrame, (err: Error | null, sf: SpriteFrame) => {
            settle(!err && sf ? sf : null);
        });
    }).catch(() => settle(null));
}

/** 同步取一张**已加载过**的贴图（没加载完返回 null） */
export function cachedFrame(path: string): SpriteFrame | null {
    return _frameCache.get(path) ?? null;
}

/** 预加载一批贴图，全部完成（或超时）后回调 —— 进入主玩页前必须先把 27 张牌面拉进来 */
export function preloadAll(paths: string[], onDone: (okCount: number, total: number) => void): void {
    let left = paths.length;
    let ok = 0;
    if (left === 0) { onDone(0, 0); return; }
    for (const p of paths) {
        loadFrame(p, (sf) => {
            if (sf) ok++;
            if (--left === 0) onDone(ok, paths.length);
        });
    }
}

export interface SpriteOpts extends NodeOpts {
    /** 路径（相对 resources/，不含 `/spriteFrame`） */
    path: string;
    /**
     * **定宽等比**：给宽度，高度按贴图自身宽高比算。
     *
     * 【为什么必须有它】绝大多数素材的宽高比在写代码时**不知道**
     * （logo / 吉祥物 / 图标都是出图时才定的）。硬写 w/h 会把图压扁或拉长，
     * 而这种变形在构建期不报错、只有肉眼能看出来。
     * 给了 `aspectW` 就不必再给 `h`（给了也会被算出来的值覆盖）。
     */
    aspectW?: number;
    /** 定高等比（同上，给高度算宽度） */
    aspectH?: number;
    /** 没加载出来时是否隐藏（默认 true，避免出现白色方块） */
    hideOnFail?: boolean;
}

/** 建一个图片节点；贴图就绪前先隐藏，避免"白块闪一下" */
export function createSprite(parent: Node, name: string, opts: SpriteOpts): Node {
    const node = createNode(name, parent, opts);
    const sp = node.addComponent(Sprite);

    // ⚠️ 顺序不能反：先定模式、再赋贴图、**最后**显式写一次尺寸。
    //    反过来写的话赋贴图那一刻模式还是 TRIMMED，引擎会按原图尺寸改节点，
    //    之后再设成 CUSTOM**不会**改回来（game-4 静默错过一次，底图只铺了中间一条）。
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.trim = false;
    const ui = node.getComponent(UITransform)!;
    if (opts.w !== undefined && opts.h !== undefined) ui.setContentSize(opts.w, opts.h);

    node.active = false;
    loadFrame(opts.path, (sf) => {
        if (!node.isValid) return;
        if (!sf) { if (opts.hideOnFail !== false) node.active = false; return; }
        sp.spriteFrame = sf;

        // 尺寸最后写：优先用等比口径（若给了），否则用显式 w/h
        const ow = sf.originalSize.width || sf.rect.width || 1;
        const oh = sf.originalSize.height || sf.rect.height || 1;
        if (opts.aspectW !== undefined) {
            ui.setContentSize(opts.aspectW, opts.aspectW * (oh / ow));
        } else if (opts.aspectH !== undefined) {
            ui.setContentSize(opts.aspectH * (ow / oh), opts.aspectH);
        } else if (opts.w !== undefined && opts.h !== undefined) {
            ui.setContentSize(opts.w, opts.h);
        } else {
            ui.setContentSize(ow, oh);
        }
        node.active = true;
    });
    return node;
}

/** 同步取一张已加载贴图的宽高比（宽/高）。未加载时返回 null */
export function frameAspect(path: string): number | null {
    const sf = _frameCache.get(path);
    if (!sf) return null;
    const w = sf.originalSize.width || sf.rect.width || 1;
    const h = sf.originalSize.height || sf.rect.height || 1;
    return w / h;
}

/** 从一张底图上裁出一个小矩形做成新 SpriteFrame（**共享纹理，不额外占显存**） */
export function cropFrame(base: SpriteFrame, px: number, py: number, pw: number, ph: number): SpriteFrame {
    const sf = new SpriteFrame();
    sf.texture = base.texture;
    // ⚠️ rect 的 y 从纹理**顶端**往下量（Cocos 把 rect.y 映射到 v 的上边）
    sf.rect = new Rect(px, py, pw, ph);
    sf.originalSize = new Size(pw, ph);
    return sf;
}

// ============================================================
//  五、背景
// ============================================================

/** 引擎当前可视尺寸（设计 px）—— 竖屏下宽恒 750，高随真机比例变 */
export function visibleSize(): { width: number; height: number } {
    const s = view.getVisibleSize();
    return { width: s.width, height: s.height };
}

/**
 * ★★ 纵向适配：把「设计稿坐标（750×1334 体系）」映射到「真机可视坐标」。
 *
 * 【为什么需要】设计稿 1334 高，真机可视 1651.4 高 —— 多出 317.4px（+23.8%）。
 * 直接按设计值摆位（`topY()` 的居中口径）会让内容上下各空 158.7px。
 *
 * 【算法】分段线性平移：
 *   · `v ≤ a.top`   → 整体平移到 `SAFE_TOP + (v - a.top)`（顶带贴胶囊下方）
 *   · `v ≥ a.bottom`→ 整体平移到 `h - SAFE_BOTTOM - (a.bottom - v)`（底带贴 Home Indicator 上方）
 *   · 区间之内 → 平移量在两端之间线性插值（多出的空间由中段内容吸收）
 * 该函数**单调不减**（不会出现元素前后交叉），且两端段严格保距（顶带/底带内部不拉伸）。
 *
 * @param v     设计稿「距屏幕顶」的纵向坐标（含该页的 YSHIFT）
 * @param a     内容真实上下边界，见 `CFG.FIT`
 * @returns     引擎坐标（原点 = 画布中心，y 向上）
 */
export function fitY(v: number, a: { top: number; bottom: number }): number {
    const h = view.getVisibleSize().height;
    // 顶带平移量 = 胶囊下沿 - 设计稿内容顶；底带平移量 = Home Indicator 上方 - 设计稿内容底
    const shiftTop = SAFE_TOP - a.top;
    const shiftBottom = (h - SAFE_BOTTOM) - a.bottom;
    let vv: number;
    if (v <= a.top) {
        vv = v + shiftTop;
    } else if (v >= a.bottom) {
        vv = v + shiftBottom;
    } else {
        const t = (v - a.top) / (a.bottom - a.top);
        vv = v + shiftTop + (shiftBottom - shiftTop) * t;
    }
    return h / 2 - vv;
}

/** 距**真机**顶边 v 设计 px → 引擎 y（贴边装饰用，不受适配锚点影响） */
export function fromTop(v: number): number {
    return view.getVisibleSize().height / 2 - v;
}

/** 距**真机**底边 v 设计 px → 引擎 y（同上） */
export function fromBottom(v: number): number {
    return -view.getVisibleSize().height / 2 + v;
}

/**
 * 等比「cover」铺满背景图。
 *
 * 【为什么不用 w/h】`createSprite` 的 `w`+`h` 是**强制非等比**口径 ——
 * 绒布 `felt.jpg` 是 1024×1456（0.7033），被拉成 750×1651.4（0.4547）时
 * **各向异性 1.55×**：图片自带的径向高光被压成竖椭圆，纹理也一起被拉长。
 * 改走 `aspectH`（定高等比）后尺寸 = 1161×1651，比屏幕宽 —— 左右各溢 206px，
 * **溢出部分在屏幕外**，屏幕内看到的正好是图片中央，等价于 CSS 的 `cover`。
 */
export function createCoverSprite(
    parent: Node, name: string, opts: { path: string; w: number; h: number },
): Node {
    // 定高等比：高度铺满 ⇒ 宽度按原图比例算，必然 ≥ 屏幕宽（竖屏背景都是"高瘦"图）
    return createSprite(parent, name, { path: opts.path, aspectH: opts.h });
}

/**
 * 铺满整屏的壳色背景（三带模型里的"桌外深色"）。
 *
 * 【尺寸口径】这里**用可视尺寸而不是设计分辨率**：真机竖屏比 9:16 更长
 * （微信标准机 750×1651），写死 1334 会在底部露一条清屏色。
 */
export function createShellBackground(parent: Node, opts: { glow?: boolean } = {}): Node {
    const vs = visibleSize();
    const { node, g } = createGraphicsNode('ShellBg', parent, { w: vs.width, h: vs.height });

    // 竖向渐变：顶 #0C110D → 底 #050805（照抄定稿稿 body 的三段渐变之底色）
    fillVGradient(g, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#0C110D', '#040604', 36);

    if (opts.glow !== false) {
        // 顶部偏左的墨绿柔光（定稿稿 22% -6% 那团）
        fillRadialGlow(g, -vs.width * 0.28, vs.height * 0.44, vs.width * 0.78, '#265036', 92, 20);
        // 右下角的暖金光斑（96% 108%）
        fillRadialGlow(g, vs.width * 0.46, -vs.height * 0.58, vs.width * 0.62, '#78581A', 40, 16);
    }
    return node;
}

/**
 * 麻将桌底板（750×750 的桌面图 + 底部垫色）。
 *
 * 【为什么底下要垫一层纯色】底图是异步加载的：加载完之前那一两帧不能是黑的，
 * 加载失败（资源没进包）时页面也仍然可用 —— 只是少了纹理。
 */
export function createTableBackground(parent: Node, path: string, size: number): Node {
    const { node, g } = createGraphicsNode('TableBg', parent, { w: size, h: size });
    // 垫色：桌面最外圈色（#12241A 偏暗的青绿）
    fillRoundRect(g, 0, 0, size, size, 0, '#12241A', 255);

    const img = createSprite(node, 'TableImg', { path, w: size, h: size });
    img.setSiblingIndex(1);
    return node;
}

// ============================================================
//  六、3D 厚描边 按钮
// ============================================================

export type ButtonTone = 'gold' | 'jade' | 'ghost';

interface ToneSpec {
    top: string; bottom: string; depth: string; border: string; text: string;
}

function toneSpec(tone: ButtonTone): ToneSpec {
    switch (tone) {
        case 'jade':
            return {
                top: SKIN.BTN_JADE.TOP, bottom: SKIN.BTN_JADE.BOTTOM,
                depth: SKIN.BTN_JADE.DEPTH, border: SKIN.BTN_JADE.BORDER, text: SKIN.BTN_JADE.TEXT,
            };
        case 'ghost':
            return {
                top: SKIN.BTN_GHOST.TOP, bottom: SKIN.BTN_GHOST.BOTTOM,
                depth: SKIN.BTN_GHOST.DEPTH, border: SKIN.BTN_GHOST.BORDER, text: SKIN.BTN_GHOST.TEXT,
            };
        case 'gold':
        default:
            return {
                top: SKIN.BTN_GOLD.TOP, bottom: SKIN.BTN_GOLD.BOTTOM,
                depth: SKIN.BTN_GOLD.DEPTH, border: SKIN.BTN_GOLD.BORDER, text: SKIN.BTN_GOLD.TEXT,
            };
    }
}

export interface ButtonOpts extends NodeOpts {
    w: number;
    h: number;
    text: string;
    tone?: ButtonTone;
    radius?: number;
    fontSize?: number;
    serif?: boolean;
    /** 厚度（px）。0 = 扁平按钮 */
    depth?: number;
    /** 关掉自动缩字（默认开）。全工程目前没有必须关掉的按钮 */
    autoShrink?: boolean;
    /** 多状态文案（自动缩字会取其中最宽的一条） */
    fitText?: readonly string[];
    /** 禁用态：整体压暗 + 不响应 */
    enabled?: boolean;
    /** 关掉按下缩放（大面积按钮点下去抖一下反而显得廉价） */
    noPress?: boolean;
    onClick?: () => void;
}

/**
 * 3D 厚描边按钮。
 *
 * 形制：`圆角胶囊 + 向下的厚度层 + 顶面渐变 + 顶部高光带`。
 * 手感：按下缩到 0.96；抬起 backOut 回弹（带一点过冲，"活"的来源）。
 *
 * ⚠️ 热区用 `UITransform.contentSize`，**不含厚度层** ——
 *    厚度是"影子"，点到影子不该触发。所以外层节点高度 = 面层高度。
 */
export function createButton(parent: Node, name: string, opts: ButtonOpts): Node {
    const tone = opts.tone ?? 'gold';
    const spec = toneSpec(tone);
    const radius = opts.radius ?? Math.min(opts.h / 2, SKIN.R_PILL);
    const depth = opts.depth ?? SKIN.DEPTH;
    const enabled = opts.enabled ?? true;

    const btn = createNode(name, parent, { w: opts.w, h: opts.h, x: opts.x, y: opts.y });
    btn.addComponent(UIOpacity);   // 供转场 / 淡入淡出用
    const g = btn.addComponent(Graphics);

    draw3dFace(g, 0, 0, {
        w: opts.w, h: opts.h, radius, depth,
        top: enabled ? spec.top : '#2A342E',
        bottom: enabled ? spec.bottom : '#161E19',
        depthColor: enabled ? spec.depth : '#0A100C',
        border: enabled ? spec.border : '#243028',
    });

    // ---- 文字 ----
    // ⚠️ 文字可用宽度的内边距**按比例夹**，不能写死"左右各 12px"：
    //    424 宽留 12 是对的，但 88 宽的小方钮留 12 就只剩 64，
    //    会把一颗已验收的按钮无谓缩小。取 min(14, 8% 宽)。
    const boxW = opts.w - Math.min(14, opts.w * 0.08) * 2;
    const wantFont = opts.fontSize ?? Math.round(opts.h * 0.4);
    const font = opts.autoShrink === false
        ? wantFont
        : fitFontSize(opts.fitText ?? opts.text, boxW, wantFont, Math.max(14, Math.round(wantFont * 0.55)));
    if (font !== wantFont) {
        // 打日志而不是静默缩字：它本身不严重，但这是"文案该改短了"的信号
        console.log(`[UIFactory] 按钮「${name}」文案超宽，字号 ${wantFont}→${font}（可用 ${boxW}px）`);
    }

    createLabel(btn, opts.text, {
        fontSize: font,
        color: enabled ? spec.text : '#7E8C84',
        bold: true,
        serif: opts.serif,
        w: boxW,
        h: opts.h,
    });

    if (enabled && opts.onClick) {
        const clickable = opts.onClick;
        if (opts.noPress !== true) {
            btn.on(Node.EventType.TOUCH_START, () => {
                MotionFx.stop(btn, TAG.PRESS);
                Tween.stopAllByTarget(btn);
                tween(btn).to(MOTION.T_PRESS, { scale: v3(0.96, 0.96, 1) }).start();
            }, btn);
            const release = (): void => {
                MotionFx.stop(btn, TAG.PRESS);
                Tween.stopAllByTarget(btn);
                tween(btn).to(MOTION.T_RELEASE, { scale: v3(1, 1, 1) }, { easing: EASE.POP }).start();
            };
            btn.on(Node.EventType.TOUCH_END, () => { release(); clickable(); }, btn);
            btn.on(Node.EventType.TOUCH_CANCEL, release, btn);
        } else {
            btn.on(Node.EventType.TOUCH_END, clickable, btn);
        }
    }
    return btn;
}

/** 二次确认弹层的节点名（也是"同一父节点下只允许一个"的判据） */
const CONFIRM_NAME = 'ConfirmDialog';

export interface ConfirmOpts {
    /** 标题 —— 一句话说清"要干什么" */
    title: string;
    /** 副文案 —— 说清**后果**（例：「本局进度不会保留」）。省 = 不显示 */
    desc?: string;
    /** 确认按钮文案（默认「确认」） */
    ok?: string;
    /** 取消按钮文案（默认「取消」） */
    cancel?: string;
    /** 点「确认」后执行。**不用自己销毁弹层**（本函数已收干净） */
    onOk: () => void;
    /** 点「取消」或点遮罩后执行 */
    onCancel?: () => void;
}

/**
 * 二次确认弹层 —— **破坏性操作专用**（返回首页 / 重置进度 / 清档）。
 *
 * 【★ 为什么"取消"是金色主按钮、"确认"反而做成 ghost】
 *   这个弹层的目的是**防误触**，不是"让玩家再表一次决心"。把**安全选项**
 *   做成视觉主按钮，手滑连点的人自然落回安全分支；危险那颗做得克制
 *   （ghost + 警示色描边），必须**看清文案再点**。
 *   反过来把"确认"做成金色 = 在引导玩家点它，与做这个弹层的目的相反。
 *
 * 【行为约定（与全站弹层一致）】
 *   · 点遮罩空白 = 取消
 *   · 同一父节点下**同时只允许一个**；已存在则本次调用直接忽略（防连点叠层）
 *   · `close` 有 `closed` 闸门，一条弹层只会走一次回调
 *
 * ⚠️ 遮罩尺寸必须给足（1.4× 全屏）—— `w:1,h:1` 会让命中区只有 1 像素，
 *    这是第 40 轮 RulePanel 踩过的坑（"点任意处关闭"从来没生效过）。
 */
export function confirmDialog(parent: Node, opts: ConfirmOpts): void {
    if (!parent?.isValid) return;
    if (parent.getChildByName(CONFIRM_NAME)?.isValid) return;   // 已有一个，忽略

    const vs = visibleSize();
    const layer = createNode(CONFIRM_NAME, parent, { w: vs.width * 1.4, h: vs.height * 1.4 });
    const layerOp = layer.addComponent(UIOpacity);
    layerOp.opacity = 0;

    let closed = false;
    const close = (cb?: () => void): void => {
        if (closed) return;
        closed = true;
        cb?.();
        if (!layer.isValid) return;
        MotionFx.fadeTo(layerOp, 0, 0.16);
        const dead = layer;
        MotionFx.after(200, () => { if (dead.isValid) dead.destroy(); });
    };

    // ---- 遮罩：吃点击，点空白 = 取消 ----
    const { g: sg } = createGraphicsNode('Scrim', layer, { w: vs.width, h: vs.height });
    fillRoundRect(sg, 0, 0, vs.width * 1.4, vs.height * 1.4, 0, '#000000', 176);
    sg.node.on(Node.EventType.TOUCH_END, () => close(opts.onCancel), sg.node);

    // ---- 卡片（与 PausePanel 同形制：金描边 + 深墨绿底 + 圆角 44）----
    const W = 520, H = 352;
    const card = createNode('Card', layer, { w: W, h: H });
    const { g: cg } = createGraphicsNode('Bg', card, { w: W, h: H });
    fillRoundRect(cg, 0, 0, W + 18, H + 18, 52, 'rgba(246,196,69,0.10)', 255);
    fillRoundRect(cg, 0, 0, W, H, 44, 'rgba(9,18,13,0.98)', 255);
    strokeRoundRect(cg, 0, 0, W, H, 44, 'rgba(246,196,69,0.34)', 2.5, 255);

    createLabel(card, opts.title, {
        fontSize: 40, color: COLOR.CREAM, bold: true, serif: true,
        w: W - 80, h: 56, y: 106,
    });
    if (opts.desc) {
        createLabel(card, opts.desc, {
            fontSize: 22, color: COLOR.CREAM_MUTE, w: W - 80, h: 64, y: 40,
        });
    }

    // 按钮行：左「取消」(gold，安全选项占主位) / 右「确认」(ghost + 警示色)
    const BW = 214, BH = 80, BY = -86, BX = 116;
    createButton(card, 'BtnCancel', {
        w: BW, h: BH, x: -BX, y: BY, text: opts.cancel ?? '取消',
        tone: 'gold', fontSize: 30, serif: true, noPress: true,
        onClick: () => close(opts.onCancel),
    });
    const okBtn = createButton(card, 'BtnOk', {
        w: BW, h: BH, x: BX, y: BY, text: opts.ok ?? '确认',
        tone: 'ghost', fontSize: 30, serif: true, noPress: true,
        onClick: () => close(opts.onOk),
    });
    // 危险选项加一道暖色描边（不靠颜色单独承载语义 —— 文案本身也已写明后果）
    const okG = okBtn.getComponent(Graphics);
    if (okG) {
        okG.lineWidth = 2.5;
        okG.strokeColor = hex2color('rgba(230,142,96,0.85)');
        okG.roundRect(-BW / 2, -BH / 2, BW, BH, 40);
        okG.stroke();
    }

    MotionFx.fadeTo(layerOp, 255, 0.18);
    card.setScale(v3(0.92, 0.92, 1));
    tween(card).to(0.26, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
}

export interface Face3DOpts {
    w: number; h: number; radius: number; depth: number;
    top: string; bottom: string; depthColor: string; border: string;
    /** 是否画顶缘高光（默认 true）。纯色板 / 需要完全平的面可关掉 */
    highlight?: boolean;
}

/** 画"厚度层 + 顶面渐变 + 顶缘柔光 + 描边"（按钮与面板共用） */
export function draw3dFace(g: Graphics, cx: number, cy: number, o: Face3DOpts): void {
    g.clear();
    // ⚠️ 厚度一律读 `o.depth`。曾在这里直接写 `depth`（裸变量，不是形参也不是全局）——
    //    它在编译期就被 TS 拦下了；若被静默放过，`draw3dFace` 会在**第一次调用时**
    //    抛 ReferenceError，而它被所有按钮/面板共用 ⇒ 全工程界面一起白屏。
    const depth = o.depth;
    // ① 接地柔影（Cocos 无 box-shadow，用一层低 alpha 的偏移圆角矩形近似）
    fillRoundRect(g, cx, cy - depth - SKIN.SHADOW.DROP, o.w + SKIN.SHADOW.SPREAD * 2,
        o.h, o.radius, '#000000', SKIN.SHADOW.ALPHA);
    // ② 厚度层（往下偏移 depth）
    fillRoundRect(g, cx, cy - depth, o.w, o.h, o.radius, o.depthColor, 255);
    // ③ 顶面渐变
    fillVGradient(g, cx, cy, o.w, o.h, o.radius, o.top, o.bottom, 26);
    // ④ 顶缘柔光 —— 对应定稿稿 `.btn-gold{ box-shadow: …, inset 0 3px 4px rgba(255,255,255,.7) }`
    //   即"从顶边往下 3px 实、再 4px 模糊"，是**贴着顶边的一圈柔光**。
    //
    //   ⚠️ 旧实现在这里画了一个「高 34%、宽 90% 的白色圆角矩形」（alpha 54），
    //      那是**硬边色块**而不是柔光：在中/大号按钮上会看到一条**左右带竖直硬边**的
    //      浅色方带浮在面上，像贴了一张半透明贴纸 —— 用户说的"按钮和别的元素完全突兀"
    //      主要就是它（结算页「下一关」540×100、赠礼页「开始挑战」480×112 都有）。
    //      圆角与描边（⑤，最后画）都压不住它，因为它的上下边是直的。
    //
    //   ⇒ 正确画法见 `fillTopSheen`：**高光带的左右边界直接取外层轮廓在该高度的边界**
    //     （而不是自己再画一个圆角矩形 —— 那样在胶囊两端必然戳出轮廓之外）。
    //     · 带高 `min(h*0.26, 16)`：100 高的按钮得 16、76 高得 16，矮按钮按比例缩；
    //     · alpha 0.62 → 0 垂直渐隐，等效 CSS 的 `inset 0 3px 4px`。
    //   ⚠️ 曾经还把中心 y 写成 `+h/2 − inset + hh/2`（加号）—— Cocos 本地坐标 **+y 向上**，
    //      "从顶边往下 hh" 的中心应在顶边**下方** hh/2。写成加号会把柔光整条推到按钮
    //      **上沿之外**（Graphics 不会自动裁剪）⇒ 真机上按钮上方多一条淡亮横线。
    //      现在这个符号问题被 `fillTopSheen` 内部封死了，调用方不用再算。
    if (o.highlight !== false) {
        fillTopSheen(g, cx, cy, o.w, o.h, o.radius, Math.min(o.h * 0.26, 16), 0.62);
    }
    // ⑤ 描边
    if (o.border) {
        strokeRoundRect(g, cx, cy, o.w, o.h, o.radius, o.border, 3, 255);
    }
}

/** 只重画一颗已存在按钮的面（换禁用态时用，不重建节点 —— 重建会丢事件监听） */
export function redrawButtonFace(
    btn: Node, w: number, h: number, radius: number, tone: ButtonTone, enabled: boolean,
): void {
    const g = btn.getComponent(Graphics);
    if (!g) return;
    const spec = toneSpec(tone);
    const depth = SKIN.DEPTH;
    draw3dFace(g, 0, 0, {
        w, h, radius, depth,
        top: enabled ? spec.top : '#2A342E',
        bottom: enabled ? spec.bottom : '#161E19',
        depthColor: enabled ? spec.depth : '#0A100C',
        border: enabled ? spec.border : '#243028',
    });
}

// ============================================================
//  七、面板（弹层卡片）
// ============================================================

export interface PanelOpts extends NodeOpts {
    w: number;
    h: number;
    radius?: number;
    /** 是否画标题栏（返回标题 Label，由调用方决定放哪） */
    fill?: string;
    border?: string;
}

/** 弹层卡片底板（深绿 + 金线 + 外发光） */
export function createPanel(parent: Node, name: string, opts: PanelOpts): Node {
    const { node, g } = createGraphicsNode(name, parent, opts);
    const r = opts.radius ?? SKIN.PANEL.RADIUS;
    const { w, h } = opts;

    // 外发光（两层）
    fillRoundRect(g, 0, 0, w + SKIN.PANEL.GLOW_W * 2, h + SKIN.PANEL.GLOW_W * 2, r + 10,
        SKIN.PANEL.GLOW, 255);
    fillRoundRect(g, 0, 0, w + 6, h + 6, r + 3, 'rgba(246,196,69,0.14)', 255);
    // 卡面
    fillRoundRect(g, 0, 0, w, h, r, opts.fill ?? SKIN.PANEL.FILL, 255);
    strokeRoundRect(g, 0, 0, w, h, r, opts.border ?? SKIN.PANEL.BORDER, SKIN.PANEL.BORDER_W, 255);
    return node;
}

/** 半透明全屏遮罩（弹层背景）。返回的节点带 TOUCH 拦截，防止点穿到下层 */
export function createScrim(parent: Node, alpha = 176, onClick?: () => void): Node {
    const vs = view.getVisibleSize();
    const { node, g } = createGraphicsNode('Scrim', parent, { w: vs.width, h: vs.height });
    fillRoundRect(g, 0, 0, vs.width * 1.5, vs.height * 1.5, 0, '#000000', alpha);
    // 吃掉落在遮罩上的触摸（否则会穿透到下面的牌）
    node.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
        e.propagationStopped = true;
    }, node);
    if (onClick) {
        node.on(Node.EventType.TOUCH_END, () => onClick(), node);
    }
    return node;
}

// ============================================================
//  八、进度条
// ============================================================

/** 画一段进度条（左对齐，`w` 为满格宽） */
export function drawProgressBar(
    g: Graphics, ratio: number, w: number, h: number, r: number,
    trackFill: string, barFrom: string, barTo: string,
): void {
    g.clear();
    const k = Math.max(0, Math.min(1, ratio));
    // 轨道
    fillRoundRect(g, 0, 0, w, h, r, trackFill, 255);
    // 已填充（从左端起）
    if (k > 0.001) {
        const bw = Math.max(h, w * k);
        const cx = -w / 2 + bw / 2;
        fillVGradient(g, cx, 0, bw, h, r, barFrom, barTo, 14);
    }
}

// ============================================================
//  九、轻提示
// ============================================================

const _toastStack: Node[] = [];

/**
 * ★★ 第 49 轮：轻提示的**纵向落点**（距屏幕底边的设计 px）。
 *
 * 【为什么不是"屏幕高度 30%"】旧写法 `y: -vs.height * 0.30` 在真机
 *   （可视高 1651.43）算出距底 **330.3**，而**槽位条正好占距底 [281, 361]** ⇒
 *   提示条整条压在槽位上。用户截图红圈那处「看广告的提示正好盖住了槽位」，
 *   实测 Toast 中心 330.29、视觉高 84 ⇒ 占 [288.3, 372.3]，与槽位条**完全重合**。
 *
 * 【新落点 = 页面里唯一的空档】底带从下往上依次是
 *   道具栏 [157, 269] · 槽位条 [281, 361] · 暂存架 [367, 437]，
 *   而 Home Indicator 安全区是 [0, 68] ⇒ **只剩 [68, 157] 这条 89 高的横带没人用**。
 *   取它的中点 = `(SAFE_BOTTOM + BOT.PAD) / 2 = (68 + 157) / 2 = 112.5`。
 *   胶囊视觉高 84 ⇒ 占距底 [70.5, 154.5]：上不压道具栏、下不进 Home Indicator。
 *
 * ⚠️ 余量只有 **2.5 设计 px**（≈ 4.2 物理 px）—— 这是"89 的带放 84 的盒"的
 *   数学必然，不是手感问题。**别再给 toast 加高**；要加高必须先动
 *   `Layout.BOT.PAD`（道具栏整体上移）或压缩胶囊高度。
 * ⚠️ 这里用 game 页道具栏的位置定标；home / splash 页底部本就空到 452 以上，
 *   落在这里同样安全（toast 放屏幕最下方对任何页面都不挡内容）。
 */
const TOAST_FROM_BOTTOM = (SAFE_BOTTOM + Layout.BOT.PAD) / 2;

/**
 * 让一条提示**立即退场**（淡出 + 销毁 + 移出栈）。
 *
 * 【为什么需要】底带下方的空档只有一条胶囊的位置（见 `TOAST_FROM_BOTTOM`），
 *   旧的"向上错开 h+12=88"堆叠会让第 2 条落到距底 200.5 —— 正好压在
 *   道具栏 [157, 269] 上。所以底部落点下**同一时刻只保留最新一条**。
 *   这不是删功能：轻提示本来就是"最新的一条最重要"，旧的那条已经在读秒消失。
 */
function retireToast(node: Node): void {
    const i = _toastStack.indexOf(node);
    if (i >= 0) _toastStack.splice(i, 1);
    if (!node.isValid) return;
    const op = node.getComponent(UIOpacity);
    if (!op) { node.destroy(); return; }
    tween(op).to(0.12, { opacity: 0 }).start();
    MotionFx.after(200, () => { if (node.isValid) node.destroy(); });
}

/**
 * 屏幕下方弹一条会自动消失的提示（墨绿胶囊 + 金字）。
 *
 * 落点见 `TOAST_FROM_BOTTOM`（★ 第 49 轮从"屏高 30%"挪到底带下方的空档）。
 */
export function toast(parent: Node, text: string, duration = 1.5): void {
    const vs = view.getVisibleSize();
    const fontSize = FONT.BODY;
    const w = Math.min(vs.width - 80, Math.max(280, estTextWidth(text, fontSize) + 72));
    const h = 76;

    const node = createNode('Toast', parent, { x: 0, y: Layout.botY(TOAST_FROM_BOTTOM) });
    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = 0;

    const g = node.addComponent(Graphics);
    fillRoundRect(g, 0, 0, w + 8, h + 8, h / 2 + 4, 'rgba(0,0,0,0.45)', 255);
    fillRoundRect(g, 0, 0, w, h, h / 2, 'rgba(8,18,13,0.94)', 255);
    strokeRoundRect(g, 0, 0, w, h, h / 2, WRAP_HAIR, 2, 255);

    createLabel(node, text, { fontSize, color: COLOR.CREAM, bold: true, w: w - 40, h });

    // ★ 第 49 轮：底部空档只够一条 ⇒ 旧条**直接退场**，不再向上堆叠（原因见 retireToast）
    for (const old of _toastStack.slice()) retireToast(old);
    _toastStack.push(node);

    tween(opacity)
        .to(0.16, { opacity: 255 })
        .delay(duration)
        .to(0.24, { opacity: 0 })
        .start();

    // ⚠️ 销毁走定时器而不是 tween 回调 —— 见 MotionFx 文件头第 ① 条
    MotionFx.after((0.16 + duration + 0.24) * 1000 + 40, () => {
        const i = _toastStack.indexOf(node);
        if (i >= 0) _toastStack.splice(i, 1);
        if (node.isValid) node.destroy();
    });
}

const WRAP_HAIR = 'rgba(246,196,69,0.18)';

// ============================================================
//  十、便捷：铺满屏的纯色层（背景兜底）
// ============================================================

/** 一块铺满可视区的纯色（用于"页面底"和颜色兜底，避免透出上层页面） */
export function createSolidLayer(parent: Node, name: string, fill: string, alpha = 255): Node {
    const vs = view.getVisibleSize();
    const { node, g } = createGraphicsNode(name, parent, { w: vs.width, h: vs.height });
    fillRoundRect(g, 0, 0, vs.width * 1.6, vs.height * 1.6, 0, fill, alpha);
    return node;
}

/** 一条发光细线（分隔用） */
export function createHairLine(parent: Node, name: string, w: number, x = 0, y = 0): Node {
    const { node, g } = createGraphicsNode(name, parent, { w, h: 2, x, y });
    g.fillColor = hex2color(COLOR.HAIR);
    g.rect(-w / 2, -1, w, 2);
    g.fill();
    return node;
}

/** 设计尺寸便捷访问（写布局时少打几个字） */
export const DESIGN = { W: GAME.DESIGN_W, H: GAME.DESIGN_H } as const;
