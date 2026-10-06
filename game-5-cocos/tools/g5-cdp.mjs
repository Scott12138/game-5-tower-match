/**
 * ============================================================
 *  g5-cdp.mjs · 无头 Chrome CDP 工装底座（零依赖）
 * ============================================================
 *  被 g5-probe.mjs / g5-smoke.mjs 共用。只做三件事：
 *    ① 起静态服务器 + 起 Chrome（带本机必踩的沙箱开关）
 *    ② 收发 CDP 消息（Node 22 自带 WebSocket）
 *    ③ 注入页面侧助手 __g5t（把 Cocos 世界坐标 → 浏览器 CSS 像素）
 *
 *  【为什么必须有 __g5t —— 坐标口径有三层，靠脑子换算必错】
 *    Cocos 世界坐标（设计 px、原点屏幕中心、y 向上）
 *      → 可视尺寸坐标（visibleSize 单位、左上原点、y 向下）
 *      → 浏览器 CSS 像素（还要乘"画布显示尺寸 / visibleSize"）
 *    这三层在 fitWidth 下**两两都不相等**（visibleSize 宽恒为设计宽 720/750，
 *    而画布 CSS 宽是视口宽）。少乘一次缩放，点击就会整片偏移，
 *    且偏移量随窗口大小变化 —— 看起来像"游戏没反应"，实际是坐标错了。
 *    所以一律**在页面里**用 `canvas.getBoundingClientRect()` 算，不在 Node 侧猜。
 *
 *  【本机必踩的坑（都已在代码里处理）】
 *    · Chrome 内嵌沙箱初始化失败 → 渲染进程崩溃 → CDP "连上就断"、
 *      后续调用永久挂起。⇒ `--no-sandbox --disable-dev-shm-usage`。
 *    · 千万不要 `--disable-gpu`：WebGL 直接不可用，页面报
 *      "This device does not support WebGL"，看着像代码崩了。
 *    · Cocos web 模板把 #GameDiv 写死 1280×960，窄视口下 canvas 溢出窗口、
 *      引擎读到的可见尺寸变成横屏。⇒ 用 `addScriptToEvaluateOnNewDocument`
 *      在**文档开始**就注入撑满视口的样式（在引擎读尺寸之前生效）。
 *    · 静态服务器必须在**同一次前台调用**里（Bash 后台进程调用结束即被回收，
 *      下一轮 curl 会 502，而冒烟脚本会误报成 "canvas: null" 白屏）。
 *    · 服务器要做**产物归属校验**（cmp 本地产物），防端口被别的工程顶替 ——
 *      那种情况全程零报错，截图却是别人的游戏。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 让内核分一个空闲端口（避免写死端口被别的会话抢占/顶替） */
export async function freePort() {
    const net = await import('node:net');
    return await new Promise((res, rej) => {
        const s = net.createServer();
        s.on('error', rej);
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => res(p));
        });
    });
}

// ------------------------------------------------------------
//  静态服务器：起 + 就绪探测 + **产物归属校验**
// ------------------------------------------------------------
export async function startServer(distDir) {
    if (!existsSync(join(distDir, 'index.html'))) {
        throw new Error(`产物不存在：${join(distDir, 'index.html')}（先跑 cocos-build.sh）`);
    }
    const port = await freePort();
    const proc = spawn('/usr/bin/python3', [
        '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', distDir,
    ], { stdio: 'ignore' });

    // 服务器必须**真的活着**（bind 失败会立刻退出，但端口上可能还蹲着别人的服务）
    await sleep(600);
    if (proc.exitCode !== null) {
        throw new Error(`端口 ${port} 上起不来（多半已被占用）—— 这不是我起的服务器`);
    }

    let code = '';
    for (let i = 0; i < 20; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/index.html`);
            code = String(r.status);
            if (code === '200') break;
        } catch { /* 还没起来 */ }
        await sleep(250);
    }
    if (code !== '200') throw new Error(`静态服务器未就绪（HTTP ${code}）`);

    // 归属校验：拿两个文件比对本地字节，防止"连到别人的工程"
    for (const rel of ['index.html', 'assets/main/index.js']) {
        const local = await readFile(join(distDir, rel));
        const remote = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/${rel}`)).arrayBuffer());
        const h1 = createHash('sha1').update(local).digest('hex');
        const h2 = createHash('sha1').update(remote).digest('hex');
        if (h1 !== h2) {
            proc.kill();
            throw new Error(`服务器返回的 ${rel} 与本地产物不一致 —— 端口被别的工程顶替了`);
        }
    }
    return { port, proc, url: `http://127.0.0.1:${port}/index.html` };
}

// ------------------------------------------------------------
//  撑满视口的注入样式（必须在引擎读尺寸之前生效）
// ------------------------------------------------------------
const FILL_CSS = `
html,body{margin:0;padding:0;overflow:hidden;background:#0b1f16;}
#GameDiv{width:100vw !important;height:100vh !important;position:fixed !important;
         left:0 !important;top:0 !important;margin:0 !important;padding:0 !important;}
#GameDiv canvas{width:100% !important;height:100% !important;display:block !important;}
#splash,#progress,#splash-progress,.progress-bar{display:none !important;}
`;

/**
 * 页面侧助手 __g5t —— 全部坐标换算都在页面里做。
 * 暴露：
 *   view()              可视尺寸 {w,h}
 *   canvasRect()        画布 CSS 矩形 {l,t,w,h}
 *   toScreen(tx,ty)     可视尺寸坐标（左上原点、y 向下）→ CSS 像素
 *   find(name)          按名字找**第一个 activeInHierarchy** 的节点
 *   centerOf(name)      ↗ 的屏幕中心 {x,y}
 *   worldToScreen(node) 任意节点 → 屏幕中心
 *   listNamed()         全场景"有名字的"节点 + 屏幕矩形（探针用）
 *   hit(x,y)            返回该 CSS 点上最上层被 tap 拦截的节点名（诊断用）
 */
const PAGE_HELPER = `
(function () {
  var st = document.createElement('style');
  st.textContent = ${JSON.stringify(FILL_CSS)};
  // ⚠️ 在 document-start 执行时 document.head 与 document.documentElement
  //    **都可能还是 null**（Chrome 惰性创建）。这里若直接 appendChild 会抛
  //    "Cannot read properties of null" —— 而且**整段脚本一起中断**，
  //    后面的 window.__g5t 根本不会挂上（症状是"探针找不到 __g5t"，
  //    与真正的原因毫无因果关系）。所以必须重试 + 兜底 DOMContentLoaded。
  //    （注：这段代码整体是 JS 模板字面量，注释里**不能出现反引号**，
  //      否则模板提前闭合，Node 侧直接 SyntaxError。）
  function inject() {
    var root = document.head || document.documentElement;
    if (!root) { setTimeout(inject, 0); return; }
    root.appendChild(st);
  }
  inject();
  document.addEventListener('DOMContentLoaded', inject, { once: true });
})();
window.__g5t = (function () {
  function ccAny() { return (typeof cc !== 'undefined') ? cc : null; }
  function scene() { var c = ccAny(); return c && c.director ? c.director.getScene() : null; }
  function canvasRect() {
    var el = document.querySelector('#GameDiv canvas') || document.querySelector('canvas');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  }
  function view() {
    var c = ccAny();
    if (!c) return null;
    var s = c.view.getVisibleSize();
    return { w: s.width, h: s.height };
  }
  /**
   * 设计 px（**左上原点、y 向下**）→ 浏览器 CSS 像素。
   *
   * ⚠️ 这里的「设计 px」与 visibleSize 单位在 fitWidth 下**恒等**
   *    （可视宽被引擎锁成设计宽 750），所以只需要乘"画布 CSS 尺寸 / 可视尺寸"
   *    这一个缩放。别把它和下面 worldToScreen 的坐标口径搞混。
   */
  function toScreen(tx, ty) {
    var v = view(), r = canvasRect();
    if (!v || !r) return null;
    return { x: r.l + (tx / v.w) * r.w, y: r.t + (ty / v.h) * r.h };
  }
  /**
   * Cocos 世界坐标 → 浏览器 CSS 像素。
   *
   * ⚠️⚠️ 口径实测结论（2026-10-06 用 g5-eval 打表定的，别再猜）：
   *    node.worldPosition 已经是「**左下原点、y 向上、设计 px**」——
   *    Canvas 自身的世界坐标 = (375, 667) = 可视尺寸的一半，
   *    子节点的世界坐标在此之上累加（BtnStart 世界 (375,355) → 屏幕 x 正中）。
   *    所以 **x 直接用、y 只要翻转**。
   *
   *    我第一版写成 tx = w.x + v.w/2（凭"世界坐标=中心原点"的印象），
   *    结果每个坐标都**多偏半个屏宽**：BtnStart 报 755（视口才 750 宽），
   *    CapR 报 915。这种错很阴——数字看着"像坐标"，只是点哪儿都不中。
   */
  function worldToScreen(node) {
    var v = view(), r = canvasRect();
    if (!v || !r) return null;
    var w = node.worldPosition;
    var tx = w.x;                    // 左下原点，x 直接可用
    var ty = v.h - w.y;              // y 向上 → y 向下
    return { x: r.l + (tx / v.w) * r.w, y: r.t + (ty / v.h) * r.h };
  }
  function walk(n, fn) {
    if (!n) return;
    fn(n);
    var ch = n.children;
    for (var i = 0; i < ch.length; i++) walk(ch[i], fn);
  }
  function find(name) {
    var s = scene(), hit = null;
    if (!s) return null;
    walk(s, function (n) {
      if (hit) return;
      if (n.name === name && n.activeInHierarchy) hit = n;
    });
    return hit;
  }
  function centerOf(name) {
    var n = find(name);
    return n ? worldToScreen(n) : null;
  }
  function listNamed() {
    var s = scene(), out = [];
    if (!s) return out;
    walk(s, function (n) {
      if (n === s) return;
      // ⚠️ 必须传**字符串类名**：web 产物里的全局 cc 是精简过的命名空间，
      //    cc.UITransform 常常是 undefined，而 getComponent(undefined) 会
      //    每调一次喷一条 "getComponent: Type must be non-nil"（不是返回值 null！），
      //    于是"遍历一遍场景树"就刷出上百条 error，看着像游戏崩了。
      var ui = n.getComponent && n.getComponent('cc.UITransform');
      var p = worldToScreen(n);
      out.push({
        name: n.name,
        active: n.activeInHierarchy,
        x: p ? Math.round(p.x) : null,
        y: p ? Math.round(p.y) : null,
        w: ui ? Math.round(ui.width) : null,
        h: ui ? Math.round(ui.height) : null,
        kids: n.children.length,
      });
    });
    return out;
  }
  /** 该点上的命中栈（从顶层往下），排障"点了没反应"用 */
  function hit(x, y) {
    var el = document.elementFromPoint(x, y);
    var out = { el: el ? (el.tagName + (el.id ? '#' + el.id : '')) : null, nodes: [] };
    var s = scene();
    if (!s) return out;
    var v = view(), r = canvasRect();
    var tx = (x - r.l) / r.w * v.w, ty = (y - r.t) / r.h * v.h;
    walk(s, function (n) {
      if (!n.activeInHierarchy) return;
      var ui = n.getComponent && n.getComponent('cc.UITransform');   // 同上：字符串类名
      if (!ui) return;
      var p = worldToScreen(n);
      if (!p) return;
      var hw = ui.width * (n.scale.x || 1) / 2, hh = ui.height * (n.scale.y || 1) / 2;
      var cxv = (p.x - r.l) / r.w * v.w, cyv = (p.y - r.t) / r.h * v.h;
      if (tx >= cxv - hw && tx <= cxv + hw && ty >= cyv - hh && ty <= cyv + hh) {
        out.nodes.push(n.name + '[' + Math.round(ui.width) + 'x' + Math.round(ui.height) + ']');
      }
    });
    return out;
  }
  return { view: view, canvasRect: canvasRect, toScreen: toScreen,
           worldToScreen: worldToScreen, find: find, centerOf: centerOf,
           listNamed: listNamed, hit: hit };
})();
`;

// ------------------------------------------------------------
//  CDP 客户端
// ------------------------------------------------------------
class CDP {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.logs = [];
        this.errors = [];
        ws.addEventListener('message', (ev) => {
            let m;
            try { m = JSON.parse(ev.data); } catch { return; }
            if (m.id && this.pending.has(m.id)) {
                const { resolve, reject } = this.pending.get(m.id);
                this.pending.delete(m.id);
                if (m.error) reject(new Error(`${m.error.message} (${m.error.code})`));
                else resolve(m.result);
                return;
            }
            this.onEvent(m);
        });
    }
    onEvent(m) {
        if (m.method === 'Runtime.consoleAPICalled') {
            const text = (m.params.args || []).map((a) => {
                if (a.type === 'string') return a.value;
                if ('value' in a) return String(a.value);
                if (a.description) return a.description;
                return a.type;
            }).join(' ');
            this.logs.push({ level: m.params.type, text });
        } else if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails || {};
            const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown';
            this.errors.push(String(desc));
        } else if (m.method === 'Log.entryAdded') {
            const e = m.params.entry || {};
            // ★ 必须把 url 带上：浏览器把**网络层**失败也记成 level=error 的 Log 条目
            //   （典型是 `net::ERR_CONNECTION_RESET`），只报 "未捕获异常 1 条" 会让人
            //   以为是 JS 异常、去翻代码；带上 url 才能一眼看出「是哪个请求挂了」。
            if (e.level === 'error') {
                this.errors.push(`[${e.source}] ${e.text}${e.url ? ` ← ${e.url}` : ''}`);
            }
        }
    }
    send(method, params = {}, timeoutMs = 30000) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP 超时：${method}（${timeoutMs}ms）`));
                }
            }, timeoutMs);
        });
    }
    /** 求值并拿回 JSON 可序列化的结果 */
    async ev(expr) {
        const r = await this.send('Runtime.evaluate', {
            expression: expr, returnByValue: true, awaitPromise: true,
        });
        if (r.exceptionDetails) {
            throw new Error(`页面求值异常：${r.exceptionDetails.text} ${JSON.stringify(r.exceptionDetails.exception?.description || '')}`);
        }
        return r.result?.value;
    }
    /** 派发**真实**鼠标事件（不是 node.emit —— 那会绕过事件层，验不出问题） */
    async mouse(type, x, y, button = 'left') {
        await this.send('Input.dispatchMouseEvent', {
            type, x, y, button,
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
        });
    }
    async click(x, y) {
        await this.mouse('mouseMoved', x, y);
        await sleep(16);
        await this.mouse('mousePressed', x, y);
        await sleep(40);
        await this.mouse('mouseReleased', x, y);
    }
    /**
     * 截图。
     *
     * ⚠️ 大关（第 12 关 99 张牌 / 7 层）会让一次光栅化明显变慢，
     *    30s 的默认超时**真的会超**（实测在 `→ game` 之后立刻挂）。
     *    而且光栅化一旦被打断，同一张图再截往往就正常了 ⇒ 给足时间 + 重试一次。
     *    重试不是掩盖问题：真正的失败（页面崩了）重试两次仍然失败，照样抛错退出。
     */
    async shot(path) {
        let last = null;
        for (const t of [60000, 90000]) {
            try {
                const r = await this.send('Page.captureScreenshot',
                    { format: 'png', captureBeyondViewport: false }, t);
                await writeFile(path, Buffer.from(r.data, 'base64'));
                return path;
            } catch (e) { last = e; }
        }
        throw last;
    }
}

/** 起 Chrome + 建 CDP 连接（含页面助手注入） */
/** 存档键（与 `core/SaveService.ts` 的 KEY 必须一致） */
export const SAVE_KEY = 'game5.save.v1';

/**
 * 造一段"开局即第 N 关"的注入脚本。
 *
 * ⚠️ 必须**在页面脚本之前**写 localStorage —— `SaveService` 在模块加载时
 *    就构造并读了一次存档，晚一步就不生效（表现是"脚本还停在首页等你点"）。
 */
export function seedAtLevel(level) {
    return `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)},
        JSON.stringify({ level: ${level}, best: ${Math.max(0, level - 1)},
          inventory: { erase: 0, move: 0, shuffle: 0, addslot: 0 },
          coins: 0, plays: 0, cleared: 0, signDate: '', signStreak: 0 })); } catch (e) {}`;
}

/**
 * 打开一个 headless Chrome 并连上 CDP。
 *
 * ★ 第 34 轮：默认视口由设计稿 `750×1334` 改为**微信真机基线** `421×927 @3x`
 *   （iPhone 13/14 一档，物理 1264×2780、DPR 3 —— 与用户截图逐像素同口径）。
 *   ⚠️ 别把它改回 750×1334：fitWidth 下真机可视高是 **1651 设计 px**（不是 1334），
 *      用 1334 量出来的页面几何全部偏低 23.8%，越界/贴边类断言会集体失真。
 */
/**
 * ★ 第 36 轮新增 `injectHelper` 开关（默认 true = 保持原有行为）。
 *
 * 为什么需要：`PAGE_HELPER` 会往**每一个新文档**注入游戏的 `FILL_CSS`
 * （含 `html,body{overflow:hidden;background:#0b1f16}`）。这对游戏页是必须的，
 * 但**截图验收板 / 报告这类普通 HTML 时会把它们的背景刷成深墨绿**，
 * 表现为「深底浅字、对比诡异」——而 CSS 明明是对的（computed style 正常），
 * 极难排查（第 36 轮为了这个绕了一大圈：量像素 → 读 computed style → 采样颜色）。
 * ⇒ 截非游戏页面时传 `injectHelper: false`。
 */
export async function openBrowser(url, { width = 421, height = 927, scale = 3, seedScript = null, seedLevel = null, injectHelper = true } = {}) {
    if (seedLevel) seedScript = seedAtLevel(seedLevel);
    const port = await freePort();
    const profile = mkdtempSync(join(tmpdir(), 'g5-chrome-'));
    const proc = spawn(CHROME, [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // ⚠️ 绝不能加 --disable-gpu：WebGL 会直接不可用
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        '--hide-scrollbars',
        '--mute-audio',
        'about:blank',
    ], { stdio: 'ignore' });

    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
        } catch { /* 还没起来 */ }
        await sleep(250);
    }
    if (!wsUrl) { proc.kill(); throw new Error('Chrome 调试端口没起来'); }

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: scale, mobile: true,
    });
    if (injectHelper) {
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPER });
    }
    // 需要"开局就是第 N 关"时用：**必须在页面脚本之前**写 localStorage，
    // 因为 SaveService 在模块加载时就构造并读了一次存档（晚一步就不生效）。
    if (seedScript) {
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript });
    }
    await cdp.send('Page.navigate', { url });

    return {
        cdp,
        close() {
            try { ws.close(); } catch { /* ignore */ }
            try { proc.kill(); } catch { /* ignore */ }
            try { rmSync(profile); } catch { /* ignore */ }
        },
    };
}

// ------------------------------------------------------------
//  导航（真实鼠标事件，与 g5-smoke 同一套判据）
// ------------------------------------------------------------
export async function waitLog(cdp, sub, timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (cdp.logs.some((l) => l.text.includes(sub))) return true;
        await sleep(150);
    }
    return false;
}

/** 真实鼠标点击某个具名节点的中心 */
export async function tapNode(cdp, name) {
    const p = await cdp.ev(`window.__g5t.centerOf(${JSON.stringify(name)})`);
    if (!p) throw new Error(`找不到节点 ${name}`);
    await cdp.click(p.x, p.y);
    return p;
}

/**
 * 把「设计 px（左上原点）」坐标批量换算成浏览器 CSS px —— **派发真实鼠标前必须走这一步**。
 *
 * ⚠️ 血坑（2026-10-06，第 34 轮）：`__game5.pickables()` 返回的是**设计 px**
 *    （`y = visibleSize.height - world.y`）。旧代码把它**直接喂给 `cdp.click()`**，
 *    而 `Input.dispatchMouseEvent` 收的是 **CSS px**。
 *    过去一直"能用"纯属巧合 —— 那时调试视口恰好写死 750×1334，与设计分辨率 1:1，
 *    两个单位数值相同。第 34 轮把视口改成真机 421×927 之后，
 *    所有牌面点击**整批偏移 1.78 倍**（x 271→152、y 690→387），
 *    表现是"点了没反应"（4 条断言假红），而这是**脚本口径**的问题，
 *    真机触摸走引擎自己的换算，完全正常。
 *
 * ⇒ 结论：任何"设计 px → 真实鼠标事件"的路径都必须过 `toScreen`，
 *   让换算跟随后实际视口，脚本才能与视口尺寸解耦。
 */
export async function designToCss(cdp, pts) {
    if (!pts || !pts.length) return [];
    const out = await cdp.ev(`(${JSON.stringify(pts)}).map(function (p) {
        var r = window.__g5t.toScreen(p.x, p.y);
        return r ? { id: p.id, face: p.face, x: r.x, y: r.y, dx: p.x, dy: p.y } : null;
    }).filter(Boolean)`);
    return out || [];
}

/** 当前画布在页面上的 CSS 矩形（断言"点是否落在画布内"用） */
export async function canvasRect(cdp) {
    return await cdp.ev('(function () { var r = window.__g5t.canvasRect();' +
        ' return r ? { l: r.l, t: r.t, w: r.w, h: r.h } : null; })()');
}

/**
 * 一路点到目标页（**真实鼠标事件**，不绕过事件层）。
 *
 * ⚠️ 每步都要等页面**入场动效走完**再算按钮中心：首页主按钮是 settleIn 上浮入场的
 *    （y 从 -26 推到 0），入场没走完时算出来的中心偏 26px，
 *    点下去正好落在按钮外沿 —— 表现是"点了没反应"，很容易误判成功能坏了。
 */
export async function navigateTo(cdp, to) {
    if (!(await waitLog(cdp, '[PageManager] → home', 20000))) throw new Error('没到首页');
    await sleep(1600);
    if (to === 'home') return;
    await tapNode(cdp, 'BtnStart');
    if (!(await waitLog(cdp, '[PageManager] → gameStart', 12000))) throw new Error('没到开局页');
    await sleep(4500);                                   // 掷骰 + 赠礼卡展开
    if (to === 'gameStart') return;
    await tapNode(cdp, 'BtnGo');
    if (!(await waitLog(cdp, '[PageManager] → game', 15000))) throw new Error('没到主玩页');
    await waitFor(cdp, '!!globalThis.__game5', 15000, '调试桥');
}

/** 等页面里出现某个全局量 */
export async function waitFor(cdp, expr, timeoutMs = 30000, label = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            if (await cdp.ev(expr)) return Date.now() - t0;
        } catch { /* 页面可能还没就绪 */ }
        await sleep(200);
    }
    throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

export { sleep, mkdir };
