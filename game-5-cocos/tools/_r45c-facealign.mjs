#!/usr/bin/env node
/**
 * ============================================================
 *  _r45c-facealign.mjs · 「同一张牌」原色贴图 vs 灰阶贴图的对位检查
 * ============================================================
 *  【要回答的问题】
 *   Cocos 导入 PNG 时有「裁透明边」（trim），于是 `spriteFrame.rect` 并不是
 *   PNG 的原始尺寸：母版报 **208×298**、我们烘的灰阶版报 **160×224**。
 *   两者比例不同（0.698 vs 0.714）。如果 Sprite **把 rect 拉伸铺满节点**，
 *   那么一张牌从"被压"变"可点"时，牌面会横向**跳 2.3%**（≈2.6 设计 px）。
 *
 *  【为什么不能靠推理】
 *   `Sprite.trim` 的真实语义在 3.8.8 的引擎源码里没查到实现体（在打包的 JS 里）。
 *   所以直接实测：**同一个节点、同一 contentSize，只换贴图**，
 *   把两次渲染分别截图，量牌体轮廓的位置与宽度。
 *   —— 只动贴图、不动 node，任何差别都只能来自贴图映射，归因是干净的。
 *
 *  【用法】node tools/_r45c-facealign.mjs [输出目录]
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r45c-align');
mkdirSync(OUT, { recursive: true });

const W = 421, H = 927, SCALE = 3;
const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');

let fail = 0;
const judge = (ok, txt) => { console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt); if (!ok) fail++; };

const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, { seedScript: seedAtLevel(3), width: W, height: H, scale: 1 });

/** 把「被压」那张换成原色贴图（只切贴图，不动 node / 不动 contentSize） */
const SWAP = (name, mode) => `(function () {
  var n = window.__g5t.find(${JSON.stringify(name)});
  if (!n) return null;
  var f = n.getChildByName('Face'), d = n.getChildByName('FaceDead');
  if (${JSON.stringify(mode)} === 'dead') { f.active = false; d.active = true; }
  else { f.active = true; d.active = false; }
  var r = window.__g5t.centerOf(${JSON.stringify(name)});
  var ui = n.getComponent('cc.UITransform');
  return { x: r.x, y: r.y, w: ui.contentSize.width, h: ui.contentSize.height,
           node: n.name,
           face: { active: f.active, sf: (function(){var s=f.getComponent('cc.Sprite'); return s && s.spriteFrame ? s.spriteFrame.rect.width+'x'+s.spriteFrame.rect.height : null;})() },
           dead: { active: d.active, sf: (function(){var s=d.getComponent('cc.Sprite'); return s && s.spriteFrame ? s.spriteFrame.rect.width+'x'+s.spriteFrame.rect.height : null;})() } };
})()`;

async function shot(file, clip) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { ...clip, scale: SCALE }, captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, file);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    return p;
}

try {
    await navigateTo(cdp, 'game');
    await sleep(2600);

    // ⚠️ 必须取**完全可见**的牌：第一版取了 T0（底层、被上面几张压住），
    //    切贴图后画面几乎没变（只露出一条缝），差异图只有 1478 px ⇒ 白测一轮。
    //    取 pickable 里的牌 = 覆盖 < 18%，基本整张露着。
    const pick1 = await cdp.ev(`(function () {
      var g = globalThis.__game5;
      var ps = g.pickables();
      if (!ps.length) return null;
      for (var i = 0; i < ps.length; i++) {
        var name = 'T' + ps[i].id;
        var r = window.__g5t.centerOf(name);
        if (r) return { name: name, x: r.x, y: r.y, face: ps[i].face, n: ps.length };
      }
      return null;
    })()`);
    if (!pick1) throw new Error('没找到可用的可点牌');
    console.log('取样牌：%s（屏幕 CSS %.0f,%.0f）', pick1.name, pick1.x, pick1.y);

    // 窗口：以牌心为中心，半径 34 设计 px（= 34/1.684≈20 CSS px）→ 取 90 CSS px 见方
    const half = 46;
    const clip = { x: Math.max(0, pick1.x - half), y: Math.max(0, pick1.y - half),
                   width: half * 2, height: half * 2 };

    const info = await cdp.ev(SWAP(pick1.name, 'color'));
    console.log('  Face     = %j', info.face);
    console.log('  FaceDead = %j', info.dead);
    const b = await shot('face-color.png', clip);
    await sleep(200);
    await cdp.ev(SWAP(pick1.name, 'dead'));
    await sleep(200);
    const a = await shot('face-dead.png', clip);
    await cdp.ev(SWAP(pick1.name, 'color'));      // 还原
    console.log('  两次渲染 → %s / %s', a, b);

    // 交给 Python 量轮廓（Node 里不想引图像库）
    writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify({ clip, scale: SCALE, info }, null, 2));
    judge(info.face.sf !== info.dead.sf,
        `两张贴图的 rect 确实不同（Face ${info.face.sf} / Dead ${info.dead.sf}）—— 这个对照有意义`);
} finally {
    close();
    proc.kill();
}

console.log(fail === 0 ? '\n[v] 取样完成，轮廓对账见 Python 步' : `\n[x] ${fail} 项异常`);
process.exit(fail === 0 ? 0 : 1);
