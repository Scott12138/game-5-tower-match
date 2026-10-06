#!/usr/bin/env node
/**
 * ============================================================
 *  g5-bgdiff.mjs · 背景亮度对账（定稿稿 vs 引擎渲染）
 * ============================================================
 *  【为什么】"背景看着暗"是主观判断，容易被截图锐化/缩放误导。
 *  唯一可靠的办法是**在同一批归一化位置取平均像素**，把差值算出来。
 *
 *  【口径】两张图都代表"整屏"，所以按 0~1 归一化取样即可 apples-to-apples，
 *  不需要先把它们缩到同尺寸（缩放会引入重采样伪影 —— 本工程明令禁止）。
 *  取样窗取各图自身的 N‰，落在**两侧边缘带**（那里两版都保证只有背景，
 *  不会被吉祥物/按钮/文字污染）。
 *
 *  【用法】
 *      node tools/g5-bgdiff.mjs --a /tmp/g5-ref/splash-final.png \
 *                              --b /tmp/g5-audit-after2/01-splash.png
 * ============================================================
 */

import { readFileSync } from 'node:fs';

import { avgRect, decodePNG, luma } from './g5-png.mjs';

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const A = argOf('--a', '');
const B = argOf('--b', '');
const LABEL_A = argOf('--la', '定稿稿');
const LABEL_B = argOf('--lb', '引擎渲染');

/**
 * ⚠️ 必须能裁切：Cocos web 构建的 canvas 在页面上有 ~5px 偏移，
 *    不裁掉的话贴边的取样点会混进页面底色（实测把左边缘亮度从 28 拉到 8，
 *    直接读成"左边缘极暗"的假结论）。
 */
function parseBox(s) {
    if (!s) return null;
    const [x, y, w, h] = s.split(',').map(Number);
    return (x === undefined || Number.isNaN(x)) ? null : { x, y, w, h };
}
const BOX_A = parseBox(argOf('--boxA', ''));
const BOX_B = parseBox(argOf('--boxB', ''));

/** 归一化取样点：`[u, v, 标签]`，全部落在两侧边缘带（两版都必为纯背景） */
const SPOTS = [
    [0.020, 0.20, '左边缘 20%'],
    [0.020, 0.45, '左边缘 45%'],
    [0.020, 0.70, '左边缘 70%'],
    [0.020, 0.88, '左边缘 88%'],
    [0.980, 0.20, '右边缘 20%'],
    [0.980, 0.45, '右边缘 45%'],
    [0.980, 0.70, '右边缘 70%'],
    [0.980, 0.88, '右边缘 88%'],
    [0.320, 0.045, '顶部 左上'],
    [0.680, 0.045, '顶部 右上'],
    [0.050, 0.930, '底部 左下'],
    [0.950, 0.930, '底部 右下'],
];

/** 取归一化点附近 w×h（占裁切区比例）的平均色 */
function sampleAt(img, box, u, v, fracW = 0.014, fracH = 0.018) {
    const bx = box ? box.x : 0;
    const by = box ? box.y : 0;
    const bw = box ? box.w : img.width;
    const bh = box ? box.h : img.height;
    const w = Math.max(2, Math.round(bw * fracW));
    const h = Math.max(2, Math.round(bh * fracH));
    let x0 = Math.round(bx + bw * u - w / 2);
    x0 = Math.max(0, Math.min(img.width - w - 1, x0));
    let y0 = Math.round(by + bh * v - h / 2);
    y0 = Math.max(0, Math.min(img.height - h - 1, y0));
    // ⚠️ avgRect 收的是 (x0,y0,x1,y1) 两个**角点**，不是 (x,y,w,h)
    return avgRect(img, x0, y0, x0 + w, y0 + h);
}

const imgA = decodePNG(readFileSync(A));
const imgB = decodePNG(readFileSync(B));

const boxA = BOX_A ?? { x: 0, y: 0, w: imgA.width, h: imgA.height };
const boxB = BOX_B ?? { x: 0, y: 0, w: imgB.width, h: imgB.height };

console.log(`A = ${LABEL_A}  ${imgA.width}×${imgA.height}  裁切 ${boxA.x},${boxA.y},${boxA.w},${boxA.h}  比例 ${(boxA.w / boxA.h).toFixed(4)}`);
console.log(`B = ${LABEL_B}  ${imgB.width}×${imgB.height}  裁切 ${boxB.x},${boxB.y},${boxB.w},${boxB.h}  比例 ${(boxB.w / boxB.h).toFixed(4)}`);
console.log('');
console.log('位置'.padEnd(14) + 'A 均值RGB'.padEnd(20) + 'B 均值RGB'.padEnd(20) + '亮度A'.padEnd(9) + '亮度B'.padEnd(9) + 'B/A');

let sumA = 0, sumB = 0, n = 0;
for (const [u, v, label] of SPOTS) {
    const a = sampleAt(imgA, boxA, u, v);
    const b = sampleAt(imgB, boxB, u, v);
    const la = luma(a);
    const lb = luma(b);
    sumA += la; sumB += lb; n++;
    const ratio = la > 0.5 ? (lb / la) : 1;
    console.log(
        label.padEnd(14)
        + `${a[0]},${a[1]},${a[2]}`.padEnd(20)
        + `${b[0]},${b[1]},${b[2]}`.padEnd(20)
        + la.toFixed(1).padEnd(9)
        + lb.toFixed(1).padEnd(9)
        + ratio.toFixed(3),
    );
}
console.log('');
console.log(`边缘/角落平均亮度：${LABEL_A} ${(sumA / n).toFixed(1)}  ·  ${LABEL_B} ${(sumB / n).toFixed(1)}`
    + `  ⇒ 比值 ${(sumB / n / (sumA / n)).toFixed(3)}`);
console.log('判读：比值 < 0.85 说明明显偏暗；0.9~1.1 属一致。');
