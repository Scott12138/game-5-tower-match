/**
 * 探针：商城弹层的**卡片底色到底画没画**。
 *
 * 背景：用户报「道具商城弹窗背景完全透明」。代码里明明有
 *   `strokeRoundRect(#0A3327)` + `fillVGradient(#1B6047 → #123F30)` + 金线，
 *   所以先取证再改 —— 不猜、不照着截图想当然。
 *
 * 取证两步：① 截图（目视）② 在**渲染后的画布**上按设计坐标取样像素。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { navigateTo, openBrowser, sleep, startServer, tapNode, verifiedShot, waitFor } from './g5-cdp.mjs';

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const OUT = '/tmp/g5-probe-shop';
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, SCALE = 3;

/** 页面侧：读若干节点几何 + 在卡片区域按**设计偏移**取样像素 */
const PROBE = `(function () {
    var g = window.__g5t;
    var node = function (n) {
        var x = g.find(n);
        if (!x) return null;
        var u = x.getComponent('cc.UITransform');
        return { name: n, w: u.width, h: u.height, kids: x.children.length,
                 sx: x.scale.x, sy: x.scale.y,
                 parent: x.parent ? x.parent.name : null };
    };
    var card = g.find('ShopCard');
    var res = { card: node('ShopCard'), layer: node('ShopLayer'),
                rows: [], close: node('ShopClose') };
    if (card) {
        for (var i = 0; i < card.children.length; i++) {
            var c = card.children[i];
            var u = c.getComponent('cc.UITransform');
            res.rows.push({ name: c.name, w: u ? u.width : null, h: u ? u.height : null,
                            kids: c.children.length });
        }
    }

    // ---- 像素取样：card 局部坐标 → 世界 → 屏幕 → 画布内部像素 ----
    var cv = document.querySelector('#GameDiv canvas') || document.querySelector('canvas');
    var r = g.canvasRect(), v = g.view();
    if (cv && r && v && card) {
        var tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        var cx = tmp.getContext('2d');
        cx.drawImage(cv, 0, 0);
        // ⚠️ canvasRect() 返回的是 {l,t,w,h}，**不是** DOMRect —— 写成 r.width 会得到
        //    undefined ⇒ k 变 NaN ⇒ getImageData 报 "Value is not of type 'long'"。
        var k = cv.width / r.w;                     // CSS → canvas 内部像素
        var cp = g.worldToScreen(card);             // card 中心的 CSS
        var wp = card.worldPosition;
        var pick = function (dx, dy) {
            // 设计偏移 → 世界（y 向上）→ 屏幕
            var p = g.worldToScreen({ worldPosition: { x: wp.x + dx, y: wp.y - dy } });
            var px = Math.round(p.x * k), py = Math.round(p.y * k);
            var d = cx.getImageData(px, py, 1, 1).data;
            return { at: [dx, dy], px: px, py: py, rgb: [d[0], d[1], d[2]], a: d[3] };
        };
        var hw = card.getComponent('cc.UITransform').width / 2;
        var hh = card.getComponent('cc.UITransform').height / 2;
        res.cardCenterCss = cp;
        res.samples = [
            pick(0, 0),            // 卡正中
            pick(0, hh * 0.55),    // 卡上段（副标题与第一行之间）
            pick(0, hh * 0.30),    // 卡中偏上
            pick(0, -hh * 0.35),   // 卡中偏下
            pick(-hw * 0.75, 0),   // 卡左侧空白带
            pick(hw * 0.55, -hh * 0.75),  // 右下空白带
            pick(0, hh * 0.98),    // 卡顶内缘
        ];
    }
    return res;
})()`;

const { port, proc, url } = await startServer(DIST);
console.log(`静态服务器 http://127.0.0.1:${port}`);
const { cdp, close } = await openBrowser(url, { width: W, height: H, scale: SCALE });

try {
    await navigateTo(cdp, 'home');
    await waitFor(cdp, "!!(window.__g5t && window.__g5t.find('Fn_shop'))", 30000, '首页四入口');
    await sleep(900);

    if (!(await tapNode(cdp, 'Fn_shop'))) throw new Error('点不到 Fn_shop');
    await sleep(1400);

    const info = await cdp.ev(PROBE);
    console.log('商城结构 =', JSON.stringify(info, null, 1));

    await verifiedShot(cdp, resolve(OUT, 'shop.png'), { w: W, h: H, scale: SCALE });
    console.log(`[✓] 商城截图 → ${resolve(OUT, 'shop.png')}`);
    writeFileSync(resolve(OUT, 'probe.json'), JSON.stringify(info, null, 2));
} finally {
    try { await close(); } catch { /* ignore */ }
    proc.kill();
}
