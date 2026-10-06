#!/usr/bin/env node
/**
 * ============================================================
 *  _r45c-verify.mjs · 第 45 轮拍板落地的**真实浏览器自证**
 * ============================================================
 *  用户第 45 轮拍板三件：
 *    ① 被压牌 → 方案 C（灰阶）
 *    ② 金币雨 → 方案 B（柔虚）+ 放大一倍（34 → 68 设计 px）
 *    ③ 去掉「每张牌周边的黄色框/光晕」= 删 `drawRing()` 的金环 + 三层外发光
 *
 *  【为什么不能只看截图】
 *   ① 的判据是"被压的那张**真的换成了灰阶贴图**"，不是"看起来灰了"——
 *      `Sprite.color` 只能压暗不能降饱和，如果哪天有人改回去，截图只是略暗，
 *      肉眼几乎看不出，但断言会红。
 *   ③ 的判据是"牌节点下**不存在 Ring 子节点**"——比在截图里找那道 2px 金线可靠。
 *
 *  【用法】node tools/_r45c-verify.mjs [输出目录]
 * ============================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { navigateTo, openBrowser, seedAtLevel, sleep, startServer } from './g5-cdp.mjs';

const OUT = resolve(process.argv[2] || '/tmp/g5-r45c');
mkdirSync(OUT, { recursive: true });

const LEVEL = Number(process.env.G5_LEVEL || 3);
const W = 421, H = 927, SCALE = 3;

let fail = 0;
const judge = (ok, txt) => {
    console.log('%s %s', ok ? '[OK]  ' : '[FAIL]', txt);
    if (!ok) fail++;
};

const DIST = resolve(import.meta.dirname, '..', 'build', 'web-desktop');
const { port, proc, url } = await startServer(DIST);
const { cdp, close } = await openBrowser(url, { seedScript: seedAtLevel(LEVEL), width: W, height: H, scale: 1 });

/** 3× 物理像素截图（= 真机口径 1264×2780 的 1 设计 px = 1.6853 物理 px） */
async function shot(file) {
    const res = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: W, height: H, scale: SCALE },
        captureBeyondViewport: false,
    }, 90000);
    const p = resolve(OUT, file);
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    console.log(`      → ${p}`);
    return p;
}

const PROBE_TILES = `(function () {
  var g = globalThis.__game5;
  if (!g || !window.__g5t) return { err: 'bridge missing' };
  var t0 = window.__g5t.find('T0');
  if (!t0 || !t0.parent) return { err: 'no T0' };
  var tiles = t0.parent.children.filter(function (c) { return /^T\\d+$/.test(c.name); });
  var pickSet = {};
  g.pickables().forEach(function (p) { pickSet['T' + p.id] = 1; });

  var res = { total: tiles.length, ring: 0, faceNodes: 0, deadNodes: 0,
              pick: 0, cover: 0, hidden: 0, fallback: 0,
              deadSize: null, colorSize: null, mism: [], kids: null };
  tiles.forEach(function (n) {
    if (!n.activeInHierarchy) { res.hidden++; return; }
    var names = n.children.map(function (c) { return c.name; });
    if (res.kids === null) res.kids = names;
    if (names.indexOf('Ring') >= 0) res.ring++;
    var f = n.getChildByName('Face');
    var d = n.getChildByName('FaceDead');
    if (f) res.faceNodes++;
    if (d) res.deadNodes++;
    var fs = f && f.getComponent('cc.Sprite');
    var ds = d && d.getComponent('cc.Sprite');
    if (fs && fs.spriteFrame) res.colorSize = fs.spriteFrame.rect.width + 'x' + fs.spriteFrame.rect.height;
    if (ds && ds.spriteFrame) res.deadSize = ds.spriteFrame.rect.width + 'x' + ds.spriteFrame.rect.height;
    var fa = !!(f && f.activeInHierarchy);
    var da = !!(d && d.activeInHierarchy);
    var isPick = !!pickSet[n.name];
    if (isPick) res.pick++; else res.cover++;
    if (isPick && !(fa && !da)) res.mism.push(n.name + ':pick fa=' + fa + ' da=' + da);
    if (!isPick && !(da && !fa)) {
      res.mism.push(n.name + ':cover fa=' + fa + ' da=' + da);
      if (!ds || !ds.spriteFrame) res.fallback++;
    }
  });
  return res;
})()`;

const PROBE_RESULT = `(function () {
  if (!window.__g5t) return { err: 'no __g5t' };
  var coins = [];
  for (var i = 0; i < 40; i++) {
    var n = window.__g5t.find('Coin' + i);
    if (!n) continue;
    var ui = n.getComponent('cc.UITransform');
    var sp = n.getComponent('cc.Sprite');
    coins.push({ w: ui ? Math.round(ui.contentSize.width) : null,
                 h: ui ? Math.round(ui.contentSize.height) : null,
                 sf: sp && sp.spriteFrame ? sp.spriteFrame.rect.width + 'x' + sp.spriteFrame.rect.height : null });
  }
  var rewards = [];
  for (var k = 0; k < 4; k++) {
    var rn = window.__g5t.find('Reward' + k);
    if (!rn) continue;
    var ic = rn.getChildByName('Ic');
    var sp2 = ic && ic.getComponent('cc.Sprite');
    rewards.push({ i: k, has: !!ic,
      sf: sp2 && sp2.spriteFrame ? sp2.spriteFrame.rect.width + 'x' + sp2.spriteFrame.rect.height : null });
  }
  return { coins: coins, rewards: rewards };
})()`;

try {
    await navigateTo(cdp, 'game');
    await sleep(2600);
    console.log(`==> 已进主玩页（L${LEVEL}）`);

    // ---------------- ① 被压牌灰阶 ----------------
    console.log('\n── ① 被压牌 = 灰阶贴图（方案 C）──');
    let t = await cdp.ev(PROBE_TILES);
    // 贴图是懒加载的，首帧可能还有几张没到位；再等一轮
    if (t && t.fallback > 0) { await sleep(1800); t = await cdp.ev(PROBE_TILES); }
    if (t?.err) throw new Error('牌节点探针失败：' + t.err);
    console.log('      节点子件：%s', JSON.stringify(t.kids));
    console.log('      存活 %d 张（可点 %d / 被压 %d，已出局 %d）',
        t.total - t.hidden, t.pick, t.cover, t.hidden);
    judge(t.pick > 0 && t.cover > 0, `可点与被压**同时存在**（${t.pick} / ${t.cover}）—— 否则这条断言没有判别力`);
    judge(t.faceNodes === t.total - t.hidden && t.deadNodes === t.total - t.hidden,
        `每张存活牌都有 Face 与 FaceDead（各 ${t.faceNodes} / ${t.deadNodes}）`);
    judge(t.mism.length === 0,
        `显示态与 pickable 完全一致（不一致 ${t.mism.length} 张${t.mism.length ? '：' + t.mism.slice(0, 4).join(' | ') : ''}）`);
    judge(t.fallback === 0, `没有一张退回"原色压暗"兜底（灰阶图全部加载成功）`);
    // ⚠️ `spriteFrame.rect` **不是 PNG 的原始尺寸**：Cocos 导入时会裁掉透明边，
    //    母版 224×298 报成 208×298、灰阶版 168×224 报成 160×224（不同图裁得不一样，
    //    因为 LANCZOS 缩放把 alpha 边变成软过渡，裁切线会多吞 1~2 px）。
    //    ⇒ 判据只能是**两者之比 ≈ 0.75**，不能拿 PNG 尺寸直接比。
    //    ("几何是否对齐"另有专门取证：`_r45c-facealign.mjs` —— 同一节点只换贴图，
    //      牌体四缘实测 0.0 物理 px 位移。)
    const [cw, ch] = t.colorSize.split('x').map(Number);
    const [dw, dh] = t.deadSize.split('x').map(Number);
    judge(Math.abs(dw / cw - 0.75) < 0.035 && Math.abs(dh / ch - 0.75) < 0.035,
        `被压贴图 = 可点贴图的 0.75 倍（rect ${t.deadSize} vs ${t.colorSize}，`
        + `比值 ${(dw / cw).toFixed(3)} / ${(dh / ch).toFixed(3)}）`);

    // ---------------- ③ 牌外金环已删除 ----------------
    console.log('\n── ③ 牌周边的黄色框/光晕（drawRing）已删除 ──');
    judge(t.ring === 0, `牌节点下不存在 Ring 子节点（实测 ${t.ring} 个）`);

    const board = await shot(`board-L${LEVEL}-3x.png`);

    // ---------------- ② 金币雨 ----------------
    console.log('\n── ② 金币雨 68 设计 px + 柔虚素材（方案 B）──');
    await cdp.ev('globalThis.__game5.demoResult(true)');
    await sleep(520);          // 金币存活期 1.0~1.9s，取中段截一张
    const r = await cdp.ev(PROBE_RESULT);
    if (r?.err) throw new Error('结算页探针失败：' + r.err);
    const n = r.coins.length;
    judge(n >= 3, `金币雨已生成（场上 ${n} 枚）`);
    judge(r.coins.length > 0 && r.coins.every((c) => c.w === 68 && c.h === 68),
        `单枚显示尺寸 = ${r.coins[0]?.w}x${r.coins[0]?.h} 设计 px（期望 68x68，原 34）`);
    judge(r.coins.length > 0 && r.coins.every((c) => c.sf === '136x136'),
        `用的是柔虚素材 136×136（实测 ${r.coins[0]?.sf}）`);
    const coinIcon = r.rewards.find((x) => x.sf);
    judge(!!coinIcon && coinIcon.sf === '112x104',
        `结算卡内小金币图标**仍用原始清晰素材**（实测 ${coinIcon?.sf}）—— 没被柔虚版连坐`);
    await shot('result-3x.png');

    const errs = cdp.errors.filter((e) => !/ERR_|favicon|AudioContext/i.test(e));
    judge(errs.length === 0, `全程无未捕获异常（${errs.length} 条）`);
    for (const e of errs.slice(0, 4)) console.log('      ' + e);
} finally {
    close();
    proc.kill();
}

console.log(fail === 0 ? '\n[v] 第 45 轮三件落地全部通过' : `\n[x] ${fail} 项未通过`);
process.exit(fail === 0 ? 0 : 1);
