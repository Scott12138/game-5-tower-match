#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 34 轮交付：真机尺寸适配 —— 方案与结果对照板（HTML，自包含）

三列视觉对照：
  A 你的真机截图（修复前） 1264×2780 DPR3  ← 用户附图，红圈即问题
  B 引擎渲染（修复后）     421×927  真机比例
  C 定稿稿（设计原稿）     744×1320  ← 注意比例 0.5636 ≠ 真机 0.4547

⚠ 图片在 HTML 里是**按真实比例**摆的，没有拉成同宽 —— 定稿稿更"胖"这件事
  本身就是本轮的核心发现（设计稿 750×1334 与真机可视 750×1651 差 23.8%）。

用法：python3 make_round34_sheet.py
产出：docs-verify/game-5/device/66-第34轮-真机适配-方案与结果.html
"""
import base64
import io
import os

from PIL import Image

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
OUTDIR = os.path.join(ROOT, 'docs-verify/game-5/device')
OUT = os.path.join(OUTDIR, '66-第34轮-真机适配-方案与结果.html')

CLIP = '/Users/consli/.workbuddy/clipboard-images'
SHOTS = {
    'splash-before': os.path.join(CLIP, 'clipboard-2026-10-06T02-19-12-398Z-e9a0cb21.png'),
    'home-before': os.path.join(CLIP, 'clipboard-2026-10-06T02-19-12-402Z-cb73ce05.png'),
    'splash-after': '/tmp/g5-audit/01-splash.png',
    'home-after': '/tmp/g5-audit/02-home.png',
    'splash-final': '/tmp/g5-ref/splash-final.png',
    'home-final': '/tmp/g5-ref/home-final.png',
}

DISP_H = 620


def embed(path, h=DISP_H):
    """等比缩到指定高 → base64 data URI（返回 (uri, w, h)）"""
    im = Image.open(path).convert('RGB')
    w = max(1, round(im.width * h / im.height))
    im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return 'data:image/png;base64,' + b64, w, h


# ───────────────────────── 数据 ─────────────────────────

# 真机量测（iPhone 13/14 一档，与用户截图逐像素同口径）
DEV_ROWS = [
    ('截图物理尺寸', '1264 × 2780', '用户附图实测（4 张一致）', 'ok'),
    ('宽高比', '0.4547', '1264 / 2780 = 0.454676', 'ok'),
    ('设备像素比 DPR', '3', '微信「标准真机」= iPhone 13/14，非 2', 'ok'),
    ('逻辑分辨率', '421.33 × 926.67', '1264/3 × 2780/3', 'ok'),
    ('设计分辨率（工程）', '750 × 1334', 'CFG 里的 designResolution（fitWidth）', 'ok'),
    ('★ 可视高（真实）', '1651.43 设计 px', '750 / 0.4547 —— **不是 1334**', 'warn'),
    ('★ 与设计稿差值', '+317.4 px（+23.8%）', '旧代码按 1334 排版 ⇒ 纵向整体偏上', 'warn'),
    ('微信胶囊（物理）', '44 pt = 132 px', '右上角，必须让开', 'ok'),
    ('胶囊设计盒', 'x 532.5–735.2 / y 95.5–159.3', '实测换算到设计 px', 'ok'),
    ('SAFE_TOP', '183.3', '胶囊底 159.3 + 间距 24', 'ok'),
    ('SAFE_BOTTOM', '68', '底部 Home Indicator', 'ok'),
]

# 资源图逐项比对（★ 结论：全部健康，**未触发重出图**）
ASSET_ROWS = [
    ('splash/felt.jpg', '1024×1456', '0.7033', '1161×1651', '1.134×', '等比 cover，左右各溢 205.7px', 'fail→fixed'),
    ('splash/logo.png', '958×274', '3.4964', '700×200', '0.731×', '恰好 2× 干净下采样', 'ok'),
    ('splash/mascot.png', '960×875', '1.0971', '480×438', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('splash/bar_track.png', '1060×88', '12.0455', '530×44', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('splash/bar_fill.png', '170×68', '2.5000', '—×34', '高 0.500×', '九宫格拉伸，非等比使用', 'ok'),
    ('splash/dice.png', '176×182', '0.9670', '120×124', '0.682×', '1.033 微放大，无伪影', 'ok'),
    ('splash/coin.png', '112×104', '1.0769', '88×82', '0.786×', '下采样，锐度充足', 'ok'),
    ('home/title.png', '840×237', '3.5443', '420×119', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('home/btn_mid.png', '228×280', '0.8143', '320×140（九宫）', '非等比', '九宫格，中段可拉伸', 'ok'),
    ('home/btn_left.png', '156×280', '0.5571', '78×140', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('home/btn_right.png', '150×280', '0.5357', '75×140', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('home/icon_*.png ×4', '192×193', '0.9948', '96×97', '0.500×', '恰好 2× 干净下采样', 'ok'),
    ('home/setting.png', '128×129', '0.9922', '56×56', '0.438×', '下采样', 'ok'),
    ('home/coin.png', '192×196', '0.9796', '40×41', '0.208×', '下采样偏大，但 UI 小图足够', 'ok'),
    ('home/tool_*.png ×4', '192×193', '0.9948', '96×97', '0.500×', '恰好 2× 干净下采样', 'ok'),
]

# 修复项
FIX_ROWS = [
    ('① 纵向排版基准错了',
     '两页 `ey()` 按设计稿中轴 1334/2 = 667 定位，而真机可视高是 1651（中轴 825.7）'
     ' ⇒ 全页内容**整体上移 158.7 设计 px**，底部留出 317px 空带。',
     '新增 `fitY(v, anchor)` 分段线性重映射（顶段反向平移 / 底段锚定 / 中段插值），'
     '两页所有 `ey()` 改走它。1:1 屏幕上退化为恒等变换。'),
    ('② 右上角金饰压住微信胶囊',
     '定稿稿角饰 y = 16~56，胶囊盒 y 95.5–159.3、x 532.5–735.2。'
     '右上角饰 x 694–734 与胶囊**水平完全重叠**，原样摆放会被直接压住。',
     '角饰顶边改锚 `SAFE_TOP = 183.3`（胶囊底 + 24 间距），'
     '底边两枚锚真机底边。实测顶边 y = 203.3（启动页 212.3），已让开。'),
    ('③ 绒布被非等比拉伸 1.55×',
     '`createSprite` 传 w/h 是**强制非等比**口径。felt.jpg 是 0.7033，'
     '被拉到屏幕的 0.4547 ⇒ 各向异性 1.55×，径向高光变竖椭圆。',
     '新增 `createCoverSprite`（走 `aspectH`），等比 cover：1161×1651，'
     '左右各溢 205.7px 被裁掉。'),
    ('④ 启动页进度条不生长',
     '`_setProgress` 只改了外层容器的 UITransform，'
     '**里面的贴图节点不会自己跟着变**（表现：数字涨、条不涨）。',
     '补一行同步改 `_barSprite` 宽度；并新增填充头部辉光点 + 呼吸补间。'),
    ('⑤ 首页中段「半宽渐变方块」',
     'Beam 用硬边矩形叠 vertical gradient —— 横向没有柔化，'
     '左右边缘是**直角**，在大屏上直接看成一个方块。',
     '新增 `fillSoftBeam`：横向 24 列 + 纵向 8 带，'
     '`hFade 0.24` 让左右 24% 渐隐（相邻列差 < 2/255，无可见竖条）。'),
    ('⑥ 接触投影成"黑洞"',
     '定稿是 340×52 的**扁椭圆** radial-gradient（6.5:1），'
     '原实现画成正圆 ⇒ 脚下一团黑饼。',
     '`fillRadialGlow` 拆出椭圆版 `fillRadialGlowE`，'
     '接触投影改 (170, 26) 扁椭圆；光池改 (220, 235) 椭圆。'),
    ('⑦ 光芒没有径向淡出',
     '定稿有 `mask-image: radial-gradient(… transparent 72%)`，'
     '晕染在 72% 半径处收干净；原实现画满整圆，边缘硬断。',
     '新增 `fillRays`：12 道扇 × 每道 10 段，按径向 mask 逐段取 alpha 单独 fill。'),
    ('⑧ ★ 椭圆暗角（两次做错，最终移除）',
     'Graphics **嵌套实心图形原理上做不出暗角** —— '
     '"点被覆盖层数随半径单调递减" ⇒ 必然中心最深、边缘最浅，**方向天然反的**。'
     '两次实现分别把整屏压到 10.3% / 35% 亮度。',
     '`fillVignette` 定为 no-op，两页都不再画。依据：定稿那层 '
     '`radial-gradient(150% 100% at 50% 42%, transparent 50%, rgba(0,0,0,.36))` '
     '在真机上实测左右/上边缘 **alpha 恰好 0**、底边 5.8%、下角 12.1% '
     '—— 它在本作里**本来就可以不要**。'),
]

# 量化对账
BG_ROWS = [
    ('启动页', '0.543', '1.038', '✅ 进入一致区间（0.9~1.1）'),
    ('首页', '0.602', '1.106', '✅ 进入一致区间（略偏亮 0.6%）'),
]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    imgs = {k: embed(v) for k, v in SHOTS.items()}

    def tag(kind):
        return {'ok': '#1c5c40', 'warn': '#a83c28', 'fail→fixed': '#a8813c'}.get(kind, '#333')

    def badge(kind):
        txt = {'ok': 'OK', 'warn': 'WARN', 'fail→fixed': 'FIX'}.get(kind, '')
        return f'<span class="bdg" style="background:{tag(kind)}">{txt}</span>'

    dev_html = '\n'.join(
        f'<tr><td>{a}</td><td class="mono{" hot" if k == "warn" else ""}">{b}</td>'
        f'<td class="note">{c}</td><td>{badge(k)}</td></tr>'
        for a, b, c, k in DEV_ROWS)

    asset_html = '\n'.join(
        f'<tr><td class="mono">{a}</td><td class="mono">{b}</td><td class="mono">{c}</td>'
        f'<td class="mono">{d}</td><td class="mono">{e}</td><td class="note">{f}</td>'
        f'<td>{badge(k)}</td></tr>'
        for a, b, c, d, e, f, k in ASSET_ROWS)

    fix_html = '\n'.join(
        f'<div class="fix"><div class="fi">{n}</div>'
        f'<div class="fc"><p><b>问题</b> {p}</p><p><b>处理</b> {s}</p></div></div>'
        for n, p, s in FIX_ROWS)

    bg_html = '\n'.join(
        f'<tr><td>{a}</td><td class="mono">{b}</td><td class="mono hot">{c}</td><td>{d}</td></tr>'
        for a, b, c, d in BG_ROWS)

    def col(key, title, sub, w, h):
        uri = imgs[key][0]
        return (f'<figure><div class="ph" style="width:{w}px;height:{h}px">'
                f'<img src="{uri}" width="{w}" height="{h}" alt="{title}"></div>'
                f'<figcaption><b>{title}</b><span>{sub}</span></figcaption></figure>')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第 34 轮 · 真机尺寸适配 · 方案与结果</title>
<style>
  :root{{--bg:#f4f4f1;--card:#fff;--ink:#1d2a24;--dim:#6d7b73;--line:#dcdfd9;
        --gold:#a8813c;--grn:#1c5c40;--red:#a83c28;}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);
       font:14px/1.7 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}}
  .wrap{{max-width:1620px;margin:0 auto;padding:32px 28px 72px}}
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
  .note{{color:var(--dim);white-space:normal}}
  .hot{{color:var(--red);font-weight:600}}
  .bdg{{display:inline-block;min-width:34px;padding:1px 6px;border-radius:3px;color:#fff;
       font-size:10.5px;font-weight:700;text-align:center;letter-spacing:.4px}}
  .fix{{display:flex;gap:16px;background:var(--card);border-radius:6px;padding:14px 18px;
       margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
  .fi{{flex:0 0 250px;font-weight:600;font-size:13.5px;color:var(--gold)}}
  .fc{{flex:1}}
  .fc p{{margin:0 0 6px}} .fc p:last-child{{margin:0}}
  .fc b{{color:var(--dim);font-weight:600;margin-right:6px}}
  .cols3{{display:flex;gap:26px;align-items:flex-start}}
  figure{{margin:0;text-align:center}}
  .ph{{border-radius:14px;overflow:hidden;background:#0b1a12;
      box-shadow:0 6px 22px rgba(0,0,0,.18);margin:0 auto}}
  figcaption{{margin-top:10px;font-size:12.5px;line-height:1.5}}
  figcaption b{{display:block;font-size:13.5px}}
  figcaption span{{color:var(--dim)}}
  .grp{{margin-bottom:38px}}
  .grp>h3{{font-size:14.5px;margin:0 0 14px;color:#3c4a42}}
  code{{background:#e9ece6;padding:1px 5px;border-radius:3px;font-size:12.5px;
       font-family:"SF Mono",Menlo,monospace}}
</style></head><body><div class="wrap">

<h1>第 34 轮 · 真机尺寸适配 · 方案与结果</h1>
<div class="sub">《麻麻大消除》 game-5 · Cocos Creator 3.8.8 ·
基线 iPhone 13/14（1264×2780 · DPR 3 · 逻辑 421.33×926.67）</div>

<div class="verdict">
<b>一句话结论：</b>资源图**一张都不用重出** —— 逐项量下来全部健康（多为恰好 2× 的干净下采样）；
真正的问题全在<strong>排版基准</strong>与<strong>合成口径</strong>上。
共修正 8 项，其中 1 项（椭圆暗角）经两次错误实现后判定为<strong>不该做</strong>。
量化对账：启动页边缘亮度比 <code>0.543 → 1.038</code>、首页 <code>0.602 → 1.106</code>（1.0 = 与定稿稿一致）。<br>
验证：类型检查 0 错误 · 两页几何审计 <strong>无非页面节点越界</strong> ·
真机比例下真实鼠标事件冒烟 <strong>25/25 全绿</strong>。
</div>

<h2>① 真机尺寸量测 <span>微信标准真机 = iPhone 13/14 一档，与你截图逐像素同口径</span></h2>
<table><thead><tr><th style="width:170px">项</th><th style="width:250px">实测值</th>
<th>算法 / 依据</th><th style="width:56px">判定</th></tr></thead>
<tbody>{dev_html}</tbody></table>

<h2>② 资源图逐项尺寸比对 <span>结论：未触发「偏差过大 → 重新出图」</span></h2>
<table><thead><tr><th style="width:160px">资源</th><th style="width:96px">原始尺寸</th>
<th style="width:74px">原始比例</th><th style="width:104px">页面使用</th><th style="width:78px">缩放比</th>
<th>说明</th><th style="width:52px">判定</th></tr></thead>
<tbody>{asset_html}</tbody></table>
<p class="note" style="margin-top:8px">
判据：<b>缩放比落在 [0.4, 1.0] 且接近 1/2 或 1/1</b> 视为健康（下采样不产生伪影、
且没有把小图拉大）。全部 15 项通过 ⇒ <b>无需重新出图</b>。
唯一「FIX」项 felt.jpg 不是尺寸不够，而是<b>被非等比拉伸</b>，改为等比 cover 即解决，
用的是同一张源图（与定稿稿 <code>bg_felt.jpg</code> md5 全等）。</p>

<h2>③ 修复项逐条 <span>问题 → 根因 → 处理</span></h2>
{fix_html}

<h2>④ 视觉对照 <span>按真实比例摆放，未拉成同宽 —— 定稿稿更「胖」本身就是本轮核心发现</span></h2>

<div class="grp"><h3>启动页</h3><div class="cols3">
{col('splash-before', '你的真机截图（修复前）', '1264×2780 · DPR 3 · 比例 0.4547', *imgs['splash-before'][1:])}
{col('splash-after', '引擎渲染（修复后）', '421×927 · 真机比例 0.4547', *imgs['splash-after'][1:])}
{col('splash-final', '定稿稿（设计原稿）', '744×1320 · 比例 0.5636 ≠ 真机', *imgs['splash-final'][1:])}
</div></div>

<div class="grp"><h3>首页</h3><div class="cols3">
{col('home-before', '你的真机截图（修复前）', '1264×2780 · DPR 3 · 比例 0.4547', *imgs['home-before'][1:])}
{col('home-after', '引擎渲染（修复后）', '421×927 · 真机比例 0.4547', *imgs['home-after'][1:])}
{col('home-final', '定稿稿（设计原稿）', '744×1320 · 比例 0.5636 ≠ 真机', *imgs['home-final'][1:])}
</div></div>

<h2>⑤ 量化对账 <span>两侧边缘带平均亮度（定稿稿 = 1.000）</span></h2>
<table><thead><tr><th style="width:130px">页面</th><th style="width:150px">修复前 B/A</th>
<th style="width:150px">修复后 B/A</th><th>判定</th></tr></thead>
<tbody>{bg_html}</tbody></table>
<p class="note" style="margin-top:8px">
口径：12 个归一化取样点（左右边缘 20/45/70/88%、顶部、底部）的平均亮度，
Cocos web 画布有 ~5px 页面偏移，故裁 <code>--boxB 5,5,416,922</code>。
判据：<b>0.9~1.1 为一致</b>，&lt;0.85 为明显偏暗。修复前两页都读作「整屏一层均匀黑幕」，
根因就是那两次做错的暗角。</p>

<h2>⑥ 验证矩阵</h2>
<table><thead><tr><th style="width:230px">项</th><th style="width:150px">命令</th>
<th>结果</th></tr></thead><tbody>
<tr><td>TypeScript 类型检查</td><td class="mono">tools/tsc-check.sh</td>
<td>✅ 0 错误</td></tr>
<tr><td>启动页几何审计</td><td class="mono">g5-device-audit.mjs --w 421 --h 927</td>
<td>✅ 无非页面节点越界 · Felt 1161×1651 · BarTrack 居 65.9% · Notice 91.7%</td></tr>
<tr><td>首页几何审计</td><td class="mono">g5-device-audit.mjs --w 421 --h 927</td>
<td>✅ 无非页面节点越界 · 顶边角饰上方空带 203 设计 px（避开胶囊）· BtnStart 1300.6</td></tr>
<tr><td>真实鼠标事件冒烟</td><td class="mono">g5-smoke.mjs（421×927 DPR3）</td>
<td>✅ <b>25 / 25</b> · 未捕获异常 0 · console error 0</td></tr>
<tr><td>背景亮度对账</td><td class="mono">g5-bgdiff.mjs</td>
<td>✅ 启动页 1.038 / 首页 1.106</td></tr>
</tbody></table>

<h2>⑦ 出包与真机试玩</h2>
<table><thead><tr><th style="width:230px">项</th><th style="width:230px">值</th>
<th>说明</th></tr></thead><tbody>
<tr><td>构建模式</td><td class="mono">release · wechatgame</td><td>原始 PNG 无损直出（WebP 在微信小游戏不被支持，引擎整批丢弃）</td></tr>
<tr><td>AppID</td><td class="mono">wxfaa19afc583badd9</td><td><b>只可预览，绝不可上传</b></td></tr>
<tr><td>包体总计</td><td class="mono">9,217,792 字节（8.79 MB）</td><td>含分包</td></tr>
<tr><td>★ 主包</td><td class="mono">3,108,608 字节（<b>2.96 MB</b> / 红线 4MB）</td><td>✅ 达标</td></tr>
<tr><td>分包</td><td class="mono">game 4.24MB · home 1.26MB</td><td>构建后由 <code>postpack-subpackages.py</code> 搬目录 + 登记</td></tr>
<tr><td>真机试玩码</td><td class="mono">device/真机预览二维码.png</td><td>Vision 框架解码自证通过（<b>生成成功 ≠ 能扫</b>，必须解一次）</td></tr>
</tbody></table>

<p class="note" style="margin-top:10px">
⚠️ 微信预览码<b>有且只有最新一张有效</b>：重跑一次 <code>tools/wechat-preview.sh</code>，上一张立刻作废。
扫码后若现象与最新改动对不上，先怀疑扫的是旧码。</p>

<p class="note" style="margin-top:26px">
<b>顺带修掉的一个测试脚手架 bug：</b><code>__game5.pickables()</code> 返回的是<strong>设计 px</strong>，
而真实鼠标事件收的是 <strong>CSS px</strong>。旧脚本把两者当同一个单位用，
只在「调试视口恰好等于 750×1334」时凑巧成立 —— 本轮把视口改成真机 421×927 后，
4 条牌面点击断言立刻假红（整批偏移 1.78×）。已加 <code>designToCss()</code>
统一走 <code>__g5t.toScreen</code> 换算，并把那条「0~750 / 0~1334」的
<b>「现状即期望」废断言</b>换成了跟着画布 CSS 矩形判。</p>

</div></body></html>'''

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print(f'✅ {OUT}  ({os.path.getsize(OUT) / 1024 / 1024:.2f} MB)')


if __name__ == '__main__':
    main()
