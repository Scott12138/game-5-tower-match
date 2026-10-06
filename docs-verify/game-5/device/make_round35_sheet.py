#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 35 轮交付：启动页 / 首页 UI 精修 —— 方案与结果对照板（HTML，自包含）

视觉对照两列：左 = 用户新截图（本轮修复前，已含第 34 轮成果）/ 右 = 引擎渲染（修复后）。

本轮四项需求（用户原话逐条）：
  ① 启动页：保留现有优化效果，去掉四个角的标志图标
  ② 首页：标题字号偏小 → 适当放大
  ③ 首页：左上角设置图标与金币元素未与右侧胶囊对齐 → 调整对齐
  ④ 首页：去掉四个角的方形标志

用法：python3 make_round35_sheet.py
产出：docs-verify/game-5/device/68-第35轮-UI精修-方案与结果.html
"""
import base64
import io
import os
import re

from PIL import Image


def rt(s):
    """极简内联渲染：**粗** → <b>，`码` → <code>。

    ⚠️ 上一版忘了这步，结果整块表格里 `**去掉四个角的标志图标**` 的星号
    和 `` `SAFE_TOP` `` 的反引号**原样显示**在页面上（HTML 不认 markdown）。
    凡是往 HTML 里塞的数据串，一律先过这个函数。
    """
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+?)`', r'<code>\1</code>', s)
    return s

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
OUTDIR = os.path.join(ROOT, 'docs-verify/game-5/device')
OUT = os.path.join(OUTDIR, '68-第35轮-UI精修-方案与结果.html')

CLIP = '/Users/consli/.workbuddy/clipboard-images'
SHOTS = {
    'splash-before': os.path.join(CLIP, 'clipboard-2026-10-06T03-19-42-638Z-7d5e637d.jpg'),
    'home-before': os.path.join(CLIP, 'clipboard-2026-10-06T03-19-42-639Z-135f4987.jpg'),
    'splash-after': '/tmp/g5-audit/01-splash.png',
    'home-after': '/tmp/g5-audit/02-home.png',
}

DISP_H = 700


def embed(path, h=DISP_H):
    im = Image.open(path).convert('RGB')
    w = max(1, round(im.width * h / im.height))
    im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'), w, h


# ───────────────────────── 数据 ─────────────────────────

REQ_ROWS = [
    ('①', '启动页：保留优化，**去掉四个角的标志图标**',
     '删除 `SplashPage.buildCorners()` —— 四枚 58×58 的`金色方框 + 菱形点`'
     '（顶边两枚锚 `SAFE_TOP` 让开胶囊、底边两枚锚真机底边 14）整组去掉；'
     '随之失效的 `SAFE_TOP` / `fromTop` / `hex2color` import 一并摘掉，避免 unused 报错。',
     '四角 72×72 设计 px 采样窗内「金色描边像素」= **0 / 0 / 0 / 0**', 'done'),
    ('②', '首页：**标题字号偏小，适当放大**',
     '`TITLE_W` 420 → **500 设计 px**（+19.0%）。光晕同步 500×214 并与标题**同心**；'
     '纵向**锚住标题顶边 176 不变** ⇒ 放大的部分全部向下长，不会顶到顶栏。'
     '放大后标题底 ≈ 317.1、吉祥物可视顶 ≈ 370.1，仍留 53px 间隙。',
     '引擎渲染量测：标题可见宽 **55.9% → 66.5%** 屏宽（498.8 / 750 设计 px）', 'done'),
    ('③', '首页：**设置图标 / 金币未与右侧胶囊对齐**',
     '整条顶栏改走 `fromTop(胶囊中线 127.4)`（绝对定位，不再经 `fitY`）；'
     '金币胶囊高度 56 → **63.8 = 微信胶囊实测高**，让左右两条上下沿完全同高。',
     '审计：`Setting y = 127.4`、`Wallet y = 127.4`，与胶囊中线 **偏差 0**', 'done'),
    ('④', '首页：**去掉四个角的方形标志**',
     '删除 `HomePage.buildCorners()` —— 四枚 40×40 的金色方框 + 菱形点整组去掉。',
     '四角 72×72 设计 px 采样窗内「金色描边像素」= **0 / 0 / 0 / 0**', 'done'),
]

# ③ 的真因拆解
CAUSE_ROWS = [
    ('旧做法', '顶栏走 `ey(46, 88)` → `fitY(154)`',
     '**239.9** 设计 px'),
    ('为什么', '`fitY` 是**跨整页**的线性重映射：把设计区间 `[110, 1199]` 拉长到真机的 `[183.3, 1583.4]`（×1.286）',
     '+12.6% 拉伸'),
    ('实测胶囊中线', '`(95.5 + 159.3) / 2` —— 微信胶囊设计盒 y 95.5–159.3',
     '**127.4** 设计 px'),
    ('★ 偏差', '239.9 − 127.4 —— 这就是截图里「设置/金币矮了半截」的量化值',
     '**112.5** 设计 px'),
    ('修法', '贴系统控件（胶囊 / Home Indicator）的元素**一律不走 `fitY()`**，改走 `fromTop()` / `fromBottom()`；'
             '顶栏中线直接取胶囊中线', '偏差 → 0'),
]

# ② 的尺寸上限推导
TITLE_ROWS = [
    ('标题源图 `home/title.png`', '840 × 237 px', '宽高比 3.5443'),
    ('真机换算', '1 设计 px = 1264 / 750 = **1.6853 物理 px**', 'fitWidth · DPR 3'),
    ('★ 源图能 1:1 支撑的最大显示宽', '840 / 1.6853 = **498.5 设计 px**', '超过就开始真上采样'),
    ('本轮取值', '**500** 设计 px ⇒ 842.7 物理 px', '超采样 0.3%，肉眼不可辨'),
    ('对比旧值', '420 设计 px（707.8 物理 px，源图利用率 84%）', '定稿稿值，占屏宽 56.0%'),
    ('放大后', '500 设计 px（占屏宽 **66.7%**）', '+19.0%'),
    ('为什么不再大', '取 560 ⇒ 943.8 物理 px，上采样 1.12×，标题描边会先糊',
     '素材卡住的上限'),
]

# 量化对账（背景亮度，定稿稿 = 1.000）
BG_ROWS = [
    ('启动页', '1.038（第 34 轮）', '1.038', '✅ 去角饰**未影响**背景亮度'),
    ('首页', '1.106（第 34 轮）', '1.106', '✅ 同上'),
]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    imgs = {k: embed(v) for k, v in SHOTS.items()}

    def badge(kind):
        txt = {'done': 'DONE', 'warn': 'WARN'}.get(kind, '')
        bg = {'done': '#1c5c40', 'warn': '#a83c28'}.get(kind, '#333')
        return f'<span class="bdg" style="background:{bg}">{txt}</span>'

    req_html = '\n'.join(
        f'<tr><td class="num">{n}</td><td class="req">{rt(q)}</td>'
        f'<td class="note">{rt(s)}</td><td class="ev">{rt(e)}</td><td>{badge(k)}</td></tr>'
        for n, q, s, e, k in REQ_ROWS)

    cause_html = '\n'.join(
        f'<tr><td class="k">{rt(a)}</td><td class="note">{rt(b)}</td>'
        f'<td class="mono{" hot" if "★" in a else ""}">{rt(c)}</td></tr>'
        for a, b, c in CAUSE_ROWS)

    title_html = '\n'.join(
        f'<tr><td class="k">{rt(a)}</td><td class="mono">{rt(b)}</td>'
        f'<td class="note">{rt(c)}</td></tr>'
        for a, b, c in TITLE_ROWS)

    bg_html = '\n'.join(
        f'<tr><td>{rt(a)}</td><td class="mono">{rt(b)}</td>'
        f'<td class="mono hot">{rt(c)}</td><td>{rt(d)}</td></tr>'
        for a, b, c, d in BG_ROWS)

    def col(key, title, sub):
        uri, w, h = imgs[key]
        return (f'<figure><div class="ph" style="width:{w}px;height:{h}px">'
                f'<img src="{uri}" width="{w}" height="{h}" alt="{title}"></div>'
                f'<figcaption><b>{title}</b><span>{sub}</span></figcaption></figure>')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第 35 轮 · 启动页 / 首页 UI 精修 · 方案与结果</title>
<style>
  :root{{--bg:#f4f4f1;--card:#fff;--ink:#1d2a24;--dim:#6d7b73;--line:#dcdfd9;
        --gold:#a8813c;--grn:#1c5c40;--red:#a83c28;}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);
       font:14px/1.7 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}}
  .wrap{{max-width:1660px;margin:0 auto;padding:32px 28px 72px}}
  h1{{font-size:25px;margin:0 0 6px;letter-spacing:.5px}}
  .sub{{color:var(--dim);font-size:13px;margin-bottom:22px}}
  .verdict{{background:var(--card);border-left:5px solid var(--grn);border-radius:6px;
           padding:16px 20px;margin-bottom:26px;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
  .verdict b{{color:var(--grn)}}
  h2{{font-size:17px;margin:34px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line)}}
  h2 span{{color:var(--dim);font-weight:400;font-size:12px;margin-left:8px}}
  table{{width:100%;border-collapse:collapse;background:var(--card);border-radius:6px;
        overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);font-size:13px}}
  th,td{{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}
  th{{background:#eef0ec;font-weight:600;font-size:12px;color:#3c4a42}}
  tr:last-child td{{border-bottom:none}}
  .mono{{font-family:"SF Mono",Menlo,monospace;font-size:12.5px;white-space:nowrap}}
  .note{{color:#4a5750;white-space:normal}}
  .hot{{color:var(--red);font-weight:700}}
  .num{{font-weight:700;color:var(--gold);font-size:15px;width:34px}}
  .req{{font-weight:600;width:260px}}
  .ev{{color:var(--grn);font-size:12.5px;width:330px}}
  .k{{font-weight:600;width:230px;color:#3c4a42}}
  .bdg{{display:inline-block;min-width:44px;padding:1px 6px;border-radius:3px;color:#fff;
       font-size:10.5px;font-weight:700;text-align:center;letter-spacing:.4px}}
  .cols2{{display:flex;gap:30px;align-items:flex-start;justify-content:center}}
  figure{{margin:0;text-align:center}}
  .ph{{border-radius:14px;overflow:hidden;background:#0b1a12;
      box-shadow:0 6px 22px rgba(0,0,0,.18);margin:0 auto}}
  figcaption{{margin-top:10px;font-size:12.5px;line-height:1.5}}
  figcaption b{{display:block;font-size:13.5px}}
  figcaption span{{color:var(--dim)}}
  .grp{{margin-bottom:38px;background:var(--card);border-radius:8px;padding:20px 22px 24px;
       box-shadow:0 1px 3px rgba(0,0,0,.05)}}
  .grp>h3{{font-size:14.5px;margin:0 0 16px;color:#3c4a42}}
  .flag{{background:#fff8ef;border-left:5px solid var(--gold);border-radius:6px;
        padding:15px 20px;margin:26px 0 8px;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
  .flag b{{color:#8a6216}}
  code{{background:#e9ece6;padding:1px 5px;border-radius:3px;font-size:12.5px;
       font-family:"SF Mono",Menlo,monospace}}
</style></head><body><div class="wrap">

<h1>第 35 轮 · 启动页 / 首页 UI 精修 · 方案与结果</h1>
<div class="sub">《麻麻大消除》 game-5 · Cocos Creator 3.8.8 ·
基线 iPhone 13/14（1264×2780 · DPR 3 · 逻辑 421.33×926.67 · 可视 1651.43 设计 px）</div>

<div class="verdict">
<b>一句话结论：</b>四项要求全部落地，全部有量测自证 ——
四角装饰去掉后四角采样窗内金色像素 <code>0/0/0/0</code>；
标题可见宽 <code>55.9% → 66.5%</code> 屏宽（放大到素材能 1:1 支撑的极限 500 设计 px）；
顶栏中线与微信胶囊中线<b>偏差 0</b>（修前差 112.5 设计 px）。<br>
验证：类型检查 0 错误 · 两页几何审计「无非页面节点越界」 ·
真机比例真实鼠标事件冒烟 <b>25 / 25</b> · 背景亮度比与上轮完全一致（1.038 / 1.106）。<br>
<b>一处我没有擅自处理的设计影响已单列在文末「待你拍板」</b>——顶栏上移让上部多出
211 设计 px 空档（定稿稿是 42），我没有连带去改整页纵向节奏。
</div>

<h2>① 需求逐条对照 <span>左 = 你提的原文，右 = 落地方式与量测证据</span></h2>
<table><thead><tr><th>#</th><th>你的要求</th><th>落地方式</th>
<th>量测证据</th><th style="width:64px">状态</th></tr></thead>
<tbody>{req_html}</tbody></table>

<h2>② 视觉对照 <span>左 = 你本轮截图（修复前）／右 = 引擎渲染（修复后），均按真实比例摆放</span></h2>

<div class="grp"><h3>启动页 —— 四角标志图标已去掉，其余优化全部保留</h3>
<div class="cols2">
{col('splash-before', '你的截图（修复前）', '红框 = 四角标志图标')}
{col('splash-after', '引擎渲染（修复后）', '四角采样窗金色像素 0/0/0/0')}
</div></div>

<div class="grp"><h3>首页 —— 标题放大 · 顶栏对齐胶囊 · 四角标志去掉</h3>
<div class="cols2">
{col('home-before', '你的截图（修复前）', '黄框 = 对齐目标位 · 红框 = 当前问题位')}
{col('home-after', '引擎渲染（修复后）', '顶栏 y = 127.4（= 胶囊中线）· 标题 66.5% 屏宽')}
</div></div>

<h2>③ 需求 ③ 的真因拆解 <span>「没和胶囊对齐」到底差多少</span></h2>
<table><thead><tr><th>环节</th><th>说明</th><th style="width:200px">数值</th></tr></thead>
<tbody>{cause_html}</tbody></table>

<h2>④ 需求 ② 的尺寸上限推导 <span>「适当放大」的边界是素材像素，不是手感</span></h2>
<table><thead><tr><th>环节</th><th style="width:330px">数值</th><th>依据</th></tr></thead>
<tbody>{title_html}</tbody></table>

<h2>⑤ 量化对账 <span>去角饰后背景亮度比（定稿稿 = 1.000）应与上轮完全一致</span></h2>
<table><thead><tr><th style="width:130px">页面</th><th style="width:190px">第 34 轮</th>
<th style="width:130px">第 35 轮</th><th>判定</th></tr></thead>
<tbody>{bg_html}</tbody></table>
<p class="note" style="margin-top:8px">
口径：12 个归一化取样点（左右边缘 20/45/70/88%、顶部、底部）的平均亮度；
Cocos web 画布有 ~5px 页面偏移，故裁 <code>--boxB 5,5,416,922</code>。判据 <b>0.9~1.1 为一致</b>。
两页数值与上轮<b>一位不差</b> ⇒ 说明去掉四角金饰没有改动背景层。</p>

<h2>⑥ 验证矩阵</h2>
<table><thead><tr><th style="width:230px">项</th><th style="width:300px">命令</th>
<th>结果</th></tr></thead><tbody>
<tr><td>TypeScript 类型检查</td><td class="mono">tools/tsc-check.sh</td>
<td>✅ 0 错误（删掉的方法未留 unused 引用）</td></tr>
<tr><td>启动页几何审计</td><td class="mono">g5-device-audit.mjs --w 421 --h 927 --page splash</td>
<td>✅ 无非页面节点越界 · 场景树里已无 <code>Corner</code> 节点 · Logo 700×200 · BarTrack 1332.4</td></tr>
<tr><td>首页几何审计</td><td class="mono">g5-device-audit.mjs --w 421 --h 927 --page home</td>
<td>✅ 无非页面节点越界 · <code>Setting 127.4</code> / <code>Wallet 127.4</code> / <code>Title 500×141 @441.1</code></td></tr>
<tr><td>真实鼠标事件冒烟</td><td class="mono">g5-smoke.mjs（421×927 DPR3）</td>
<td>✅ <b>25 / 25</b> · 未捕获异常 0 · console error 0</td></tr>
<tr><td>背景亮度对账</td><td class="mono">g5-bgdiff.mjs --boxB 5,5,416,922</td>
<td>✅ 启动页 1.038 / 首页 1.106（与上轮完全一致）</td></tr>
</tbody></table>

<h2>⑦ 出包与真机试玩</h2>
<table><thead><tr><th style="width:230px">项</th><th style="width:280px">值</th>
<th>说明</th></tr></thead><tbody>
<tr><td>构建模式</td><td class="mono">release · wechatgame</td>
<td>原始 PNG 无损直出（WebP 在微信小游戏不被支持，引擎会整批静默丢弃）</td></tr>
<tr><td>AppID</td><td class="mono">wxfaa19afc583badd9</td><td><b>只可预览，绝不可上传</b></td></tr>
<tr><td>产物总计</td><td class="mono">9,249,421 字节（8.82 MB）</td>
<td>文件系统实测；微信工具口径 9,216,600（差 0.4%，计入口径不同）</td></tr>
<tr><td>★ 主包</td><td class="mono">3,140,010 字节 = <b>2.99 MB</b></td>
<td>✅ 红线 4 MB，<b>余量 ≈ 1.0 MB</b> · 主包 <code>assets/</code> 只剩 <code>resources</code></td></tr>
<tr><td>分包合计</td><td class="mono">6,109,411 字节（5.83 MB）</td>
<td>game 4,449,923 (4.24 MB) · home 1,324,192 (1.26 MB) · internal 165,696 · main 169,600</td></tr>
<tr><td>分包登记</td><td class="mono">postpack-subpackages.py</td>
<td>构建后搬目录 + 登记 <code>src/settings.json</code> 的 <code>assets.subpackages</code> 与 <code>game.json</code></td></tr>
<tr><td>真机试玩码</td><td class="mono">device/真机预览二维码.png（470×470）</td>
<td>Vision 框架解码自证通过：<code>https://mp.weixin.qq.com/a/~~2MzJ_SB5ClM~…~~</code>
（<b>生成成功 ≠ 能扫</b>，必须解一次）</td></tr>
<tr><td>⚠ 码的有效期</td><td class="mono">约 25 分钟</td>
<td>过期后扫码无反应。<b>代码没变时</b>用
<code>SKIP_BUILD=1 bash tools/wechat-preview.sh &lt;工程绝对路径&gt; release &lt;归档目录&gt;</code> 秒换一张新码</td></tr>
<tr><td>⚠ 体积数字会漂</td><td class="mono">微信工具多次读数差 ±0.1%</td>
<td>同一份产物连出两次码，工具报的 TOTAL 分别为 9,216,600 / 9,204,650；
<b>以文件系统实测为准</b></td></tr>
</tbody></table>

<div class="flag">
<b>⚠️ 待你拍板 · 一处我没有擅自处理的设计影响</b><br>
需求 ③ 是把顶栏<b>上移 112.5 设计 px</b> 贴到胶囊中线上。上移之后，
顶栏底沿（159.4）与标题光晕顶（370.6）之间空出 <b>211 设计 px</b>，
而定稿稿里这个空档只有 <b>42</b>（占屏高 12.8% vs 3.1%）。<br>
原因不是顶栏，而是 <code>fitY</code> 的纵向拉伸（×1.286）在「内容带顶 110」到「标题」之间
多摊了一段 —— 内容带顶现在<b>已经没有元素</b>了（顶栏改绝对定位后），
所以这段拉伸变成了纯空档。<br>
<b>只改一个数就能收回：</b><code>CFG.FIT.HOME.top</code> 从 <code>110</code> 调到
<code>~205</code>（= 标题光晕顶的设计坐标）。代价是<b>上半屏整体上移</b>：
标题 ↑116、吉祥物 ↑75、功能列 ↑66、主按钮 ↑10、底部进度条 ↑6（底带锚定，几乎不动）。<br>
<b>我没有动它</b> —— 因为这不是你本轮要求的改动，而且它会牵动整页纵向节奏，
需要你看过渲染再决定。你说改我就改，一句话的事。
</div>

</div></body></html>'''

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print(f'✅ {OUT}  ({os.path.getsize(OUT) / 1024 / 1024:.2f} MB)')


if __name__ == '__main__':
    main()
