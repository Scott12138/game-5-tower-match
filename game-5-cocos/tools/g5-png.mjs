/**
 * ============================================================
 *  g5-png.mjs · 零依赖 PNG 解码（只为本工程的验收服务）
 * ============================================================
 *  【为什么必须自己写】
 *  本机没有 PIL / ffmpeg / imagemagick，`sips` 也只给元数据不给像素。
 *  而"这块灰底是谁画的""颜色对不对"这类判断，**靠肉眼看截图会一直猜错**——
 *  我在同一轮里就据此误判过两次（先是以为 fill() 累积，后是以为某个
 *  渐变色算错）。只有拿到**具体像素值**才能一次定论。
 *
 *  【支持范围】Chrome `Page.captureScreenshot` 的产物：8 bit、
 *  color type 2 (RGB) 或 6 (RGBA)、非隔行。别的都不用支持。
 *
 *  【用法】
 *    import { decodePNG, sample, avgRect, pixelsEqual } from './g5-png.mjs'
 */

import { inflateSync } from 'node:zlib';

export function decodePNG(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG（magic 不符）');
    let off = 8;
    let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
    const idat = [];
    let palette = null, trns = null;

    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0); h = data.readUInt32BE(4);
            depth = data[8]; ctype = data[9]; interlace = data[12];
        } else if (type === 'PLTE') palette = Buffer.from(data);
        else if (type === 'tRNS') trns = Buffer.from(data);
        else if (type === 'IDAT') idat.push(Buffer.from(data));
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (depth !== 8) throw new Error(`只支持 8bit，实际 ${depth}`);
    if (interlace !== 0) throw new Error('不支持隔行 PNG');

    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!channels) throw new Error(`不支持的 color type ${ctype}`);

    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * channels;
    const out = Buffer.alloc(w * h * 4);
    const prev = Buffer.alloc(stride);
    const cur = Buffer.alloc(stride);

    let p = 0;
    for (let y = 0; y < h; y++) {
        const filter = raw[p++];
        raw.copy(cur, 0, p, p + stride);
        p += stride;
        // 反滤波（PNG 规范 9.2）
        for (let i = 0; i < stride; i++) {
            const a = i >= channels ? cur[i - channels] : 0;
            const b = prev[i];
            const c = i >= channels ? prev[i - channels] : 0;
            let v = cur[i];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[i] = v & 255;
        }
        for (let x = 0; x < w; x++) {
            const s = x * channels;
            const d = (y * w + x) * 4;
            if (ctype === 6) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3]; }
            else if (ctype === 2) { out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255; }
            else if (ctype === 0) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = 255; }
            else if (ctype === 4) { out[d] = out[d + 1] = out[d + 2] = cur[s]; out[d + 3] = cur[s + 1]; }
            else { const pi = cur[s] * 3; out[d] = palette[pi]; out[d + 1] = palette[pi + 1]; out[d + 2] = palette[pi + 2]; out[d + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255; }
        }
        cur.copy(prev);
    }
    return { width: w, height: h, data: out };
}

/** 取一个像素 → [r,g,b,a] */
export function sample(png, x, y) {
    const i = (Math.round(y) * png.width + Math.round(x)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

/** 取一块矩形内的平均色（含 alpha）—— 比单点稳，能压掉抖动噪声 */
export function avgRect(png, x0, y0, x1, y1) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(png.height - 1, Math.round(y1)); y++) {
        for (let x = Math.max(0, Math.round(x0)); x <= Math.min(png.width - 1, Math.round(x1)); x++) {
            const i = (y * png.width + x) * 4;
            r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; a += png.data[i + 3]; n++;
        }
    }
    if (!n) return [0, 0, 0, 0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

/** 亮度（0~255，Rec.601）—— 用来判断"这块是不是比周围亮" */
export function luma([r, g, b]) {
    return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function hexOf([r, g, b, a]) {
    const h = (v) => v.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}` + (a !== 255 ? `/${h(a)}` : '');
}
