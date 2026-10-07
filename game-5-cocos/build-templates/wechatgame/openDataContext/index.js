/**
 * ============================================================================
 *  开放数据域入口（微信小游戏 · 好友排行榜）
 * ============================================================================
 *  【这是什么】微信小游戏的「开放数据域」是一段**跑在独立 JS 环境里**的代码：
 *    它拿得到好友数据（`wx.getFriendCloudStorage`），但**主域拿不到**；
 *    它画出来的东西写在一块共享画布 `sharedCanvas` 上，由主域当贴图显示。
 *    这是平台强制的隔离 ——「好友关系链数据只能在开放数据域里用」。
 *
 *  【入口文件为什么叫 index.js】`game.json` 里的 `openDataContext` 指向本目录，
 *    平台约定该目录下必须有 **index.js** 作为入口（主域 / 分包才叫 game.js）。
 *
 *  【画布尺寸是 640×960 —— 这是 Cocos 定死的，不是我们挑的】
 *    Cocos 的 `SubContextView` 在 `onLoad` 里把 `sharedCanvas` 设成
 *    `designResolutionSize`（默认 **640×960**），并把内容按 SHOW_ALL 缩放到节点框内。
 *    该属性**运行期只读** ⇒ 代码建节点时改不了它 ⇒ 本文件一律按 640×960 布局。
 *    下面 `W/H` 仍然每次绘制都从 `sharedCanvas` 现读一次，读不到才回退常量 ——
 *    这样万一引擎将来改了默认值，也不会画到画布外面去。
 *
 *  【消息协议】主域 → 本域都用 `postMessage`：
 *    · `{ type: 'render' }`  ⇒ 拉一次好友数据并重绘（主域打开排行榜时发）
 *    · `{ type: 'engine', event: 'viewport', ... }` ⇒ **引擎自己发的**，
 *      用来同步视窗位置（见 Cocos `sub-context-view.ts`）—— 本域不关心，忽略。
 *
 *  ⚠️ 本文件**不参与 Cocos 的资产导入**（它在 `build-templates/` 下，不在 `assets/`），
 *     由构建模板直接拷进产物、由 `tools/postpack-subpackages.py` 兜底补拷 + 登记 game.json。
 * ============================================================================
 */

/* global wx */
'use strict';

/** 设计画布（兜底值；实际以 sharedCanvas 的尺寸为准） */
var DESIGN_W = 640;
var DESIGN_H = 960;

/** 配色 —— 与主域 `CFG.COLOR`（墨绿典藏 v2）逐值对齐，别在这里另起一套 */
var C = {
    cream: '#FFF7E6',
    dim: '#C9D8CC',
    mute: '#87998C',
    gold: '#F6C445',
    goldHi: '#FFE08A',
    line: 'rgba(246,196,69,0.18)',
    badge: 'rgba(255,247,230,0.08)',
};

var sharedCanvas = wx.getSharedCanvas();
var ctx = sharedCanvas.getContext('2d');

/** 头像图片缓存：key = url，避免每次重绘都重新 createImage（会闪、也浪费） */
var avatarCache = {};

/** 当前状态：loading | ok | empty | error */
var state = 'loading';
var rows = [];
var lastError = '';

// ---------------------------------------------------------------- 数据

/**
 * 拉好友数据。
 * `wx.getFriendCloudStorage` 返回的每一项形如：
 *   { nickname, avatarUrl, openid, KVDataList: [{ key, value }] }
 * 其中 `value` 是字符串，我们自己写进去时是 `{"wxgame":{"score":N,"update_time":T}}`
 * （`wxgame.score` 是微信排行榜约定的字段名，用它可以被官方排行榜组件直接读）。
 */
function loadAndDraw() {
    state = 'loading';
    draw();

    if (typeof wx.getFriendCloudStorage !== 'function') {
        state = 'error';
        lastError = '当前基础库不支持好友数据';
        draw();
        return;
    }

    wx.getFriendCloudStorage({
        keyList: ['level'],
        success: function (res) {
            try {
                rows = normalize(res && res.data);
                state = rows.length ? 'ok' : 'empty';
            } catch (e) {
                rows = [];
                state = 'error';
                lastError = '数据解析失败';
            }
            draw();
        },
        fail: function (err) {
            rows = [];
            state = 'error';
            lastError = (err && err.errMsg) || '接口调用失败';
            draw();
        },
    });
}

/** 把微信的原始数据整理成可绘制的行，并**按关卡降序**排序 */
function normalize(list) {
    if (!list || !list.length) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var u = list[i];
        if (!u) continue;
        out.push({
            nickname: shortName(u.nickname || '微信好友'),
            avatarUrl: u.avatarUrl || '',
            score: pickScore(u.KVDataList),
            self: !!u.isSelf,
        });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    // 并列同分时把"我"往前放，玩家一眼能看到自己
    return out.slice(0, 7);
}

/** 从 KVDataList 里取关卡分；没有 / 坏了都按 0（= 没玩过） */
function pickScore(kv) {
    if (!kv || !kv.length) return 0;
    for (var i = 0; i < kv.length; i++) {
        if (kv[i] && kv[i].key === 'level') {
            try {
                var v = JSON.parse(kv[i].value);
                var s = v && v.wxgame && v.wxgame.score;
                return typeof s === 'number' && isFinite(s) ? s : 0;
            } catch (e) {
                return 0;
            }
        }
    }
    return 0;
}

/** 昵称截断（按"字符"不是"字节"，中文才不会被砍半个） */
function shortName(n) {
    var chars = String(n).split('');
    return chars.length <= 7 ? n : chars.slice(0, 6).join('') + '…';
}

// ---------------------------------------------------------------- 绘制

function draw() {
    var W = sharedCanvas.width || DESIGN_W;
    var H = sharedCanvas.height || DESIGN_H;

    ctx.clearRect(0, 0, W, H);

    // 标题
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.cream;
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('好友排行', W / 2, 62);

    ctx.fillStyle = C.mute;
    ctx.font = '22px sans-serif';
    ctx.fillText('按历史最高通关关卡排序', W / 2, 108);

    line(W, 136);

    if (state === 'loading') {
        hint(W, H, '正在读取好友数据…');
        return;
    }
    if (state === 'error') {
        hint(W, H, '好友数据加载失败\n' + lastError);
        return;
    }
    if (state === 'empty') {
        hint(W, H, '还没有好友玩过\n快去邀请一个来比比');
        return;
    }

    var top = 164;
    var rowH = 106;
    for (var i = 0; i < rows.length; i++) {
        drawRow(rows[i], i, top + i * rowH, W);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.mute;
    ctx.font = '20px sans-serif';
    ctx.fillText('数据来自微信好友，仅你可见', W / 2, H - 34);
}

function drawRow(row, rank, y, W) {
    var cy = y + 42;

    // 名次徽标
    ctx.beginPath();
    ctx.arc(76, cy, 26, 0, Math.PI * 2);
    if (rank < 3) {
        ctx.fillStyle = rank === 0 ? C.gold : (rank === 1 ? C.goldHi : C.gold);
        ctx.globalAlpha = rank === 0 ? 1 : 0.72;
    } else {
        ctx.fillStyle = C.badge;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = rank < 3 ? '#0B100C' : C.dim;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank + 1), 76, cy + 1);

    // 头像（圆形裁切）
    var ax = 148, ar = 40;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, cy, ar, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,247,230,0.06)';
    ctx.fillRect(ax - ar, cy - ar, ar * 2, ar * 2);
    var img = getAvatar(row.avatarUrl);
    if (img) {
        ctx.drawImage(img, ax - ar, cy - ar, ar * 2, ar * 2);
    } else {
        // 还没加载出来 / 加载失败 ⇒ 画一个首字占位，别留黑圈
        ctx.fillStyle = C.mute;
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(row.nickname.slice(0, 1), ax, cy + 1);
    }
    ctx.restore();

    // 昵称
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = row.self ? C.goldHi : C.cream;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(row.nickname, 204, cy + 1);

    // 关卡（右对齐）
    ctx.textAlign = 'right';
    ctx.fillStyle = C.goldHi;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(row.score > 0 ? ('第 ' + row.score + ' 关') : '未开始', W - 48, cy + 1);

    line(W, y + 98);
}

/** 居中提示（支持 \n 换行） */
function hint(W, H, text) {
    var lines = String(text).split('\n');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.dim;
    ctx.font = '26px sans-serif';
    var y0 = H / 2 - (lines.length - 1) * 20;
    for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], W / 2, y0 + i * 40);
    }
}

/** 分隔线（内缩，别顶到画布边） */
function line(W, y) {
    ctx.beginPath();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.moveTo(48, y + 0.5);
    ctx.lineTo(W - 48, y + 0.5);
    ctx.stroke();
}

/**
 * 取头像。首次调用发起加载，加载完成后**自己触发一次重绘** ——
 * 否则要等主域下一次 postMessage 才看得到头像，观感上像"卡住了"。
 */
function getAvatar(url) {
    if (!url) return null;
    var hit = avatarCache[url];
    if (hit && hit.loaded) return hit.img;
    if (hit) return null;                       // 加载中
    var img = wx.createImage();
    var rec = { img: img, loaded: false };
    avatarCache[url] = rec;
    img.onload = function () { rec.loaded = true; draw(); };
    img.onerror = function () { rec.loaded = false; };
    img.src = url;
    return null;
}

// ---------------------------------------------------------------- 消息

wx.onMessage(function (msg) {
    if (!msg) return;
    // 引擎自己发的视窗同步消息（见 Cocos SubContextView）—— 与本域无关，忽略
    if (msg.type === 'engine') return;
    if (msg.type === 'render') loadAndDraw();
});

// 首帧先画一次"加载中"，免得主域刚打开时看到一片空白
draw();
