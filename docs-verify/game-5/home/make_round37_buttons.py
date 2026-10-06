# -*- coding: utf-8 -*-
"""
第 37 轮 · 首页主按钮换素材 —— 3 款式对比板（待用户拍板）。

为什么出这块板：
  用户反馈「开始游戏按钮难看：中间亮度提高、四周边缘违和」。
  定位结果 **不是素材问题，是九宫格实现方式错了** ——
  引擎里把 btn9 的中段 228×280 **强制拉成 320×140**（横向 ×1.40 / 纵向 ×0.50
  = 各向异性 2.81×），再叠一层中央白渐变 ⇒ 就成了"中间发亮、两端接不上"。
  而原设计稿 v2 白纸黑字写的是「两端圆角固定、中段水平拉伸」。

本脚本同时干两件事：
  ① 把 v1 / v2 底板**按实测弧宽切成九宫格三段**（切好的件就是工程要用的资产）；
  ② 生成对比板 HTML：三款各出 1:1 实样 + 2× 细节，配真实毡面与真实文案。
"""
import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(ROOT, 'round37')
OUT = os.path.join(ROOT, '72-第37轮-主按钮-3款式对比.html')

# ----------------------------------------------------------------- 实测几何
# 弧宽（"进入直段"的第一列/最后一列）由 alpha 逐列扫描量得，见本轮日志。
PLATES = {
    'v1': dict(src='btn_v1.png', w=885, h=519, inset_l=213, inset_r=213),
    'v2': dict(src='btn_v2.png', w=890, h=467, inset_l=189, inset_r=184),
}
DISP_W, DISP_H = 320, 140          # 定稿显示尺寸（方案二 320×140 · 2.29:1）


def cut(p: dict) -> dict:
    """把底板切成 左帽 / 中段 / 右帽 三件，返回显示几何。"""
    im = Image.open(os.path.join(STAGE, p['src'])).convert('RGBA')
    w, h = im.size
    scale = DISP_H / h                       # 等比缩放系数（由高定）
    il, ir = p['inset_l'], p['inset_r']
    im.crop((0, 0, il, h)).save(os.path.join(STAGE, p['key'] + '_cap_l.png'))
    im.crop((il, 0, w - ir, h)).save(os.path.join(STAGE, p['key'] + '_mid.png'))
    im.crop((w - ir, 0, w, h)).save(os.path.join(STAGE, p['key'] + '_cap_r.png'))
    cap_l, cap_r = il * scale, ir * scale
    mid_disp = DISP_W - cap_l - cap_r
    mid_src_scaled = (w - il - ir) * scale
    return dict(cap_l=cap_l, cap_r=cap_r, mid_disp=mid_disp,
                stretch=mid_disp / mid_src_scaled, scale=scale)


GEO = {}
for k, v in PLATES.items():
    v['key'] = k
    GEO[k] = cut(v)

# 当前在用款（btn9 三段）的引擎真实做法 —— 用来复现"病灶"
BTN9 = dict(cap_l=156 * (DISP_H / 280), cap_r=150 * (DISP_H / 280))


def inline(s: str) -> str:
    """**粗** → <b>，`码` → <code>（HTML 不认 markdown，第 35 轮的教训）。"""
    out, i, bold = [], 0, False
    while i < len(s):
        if s.startswith('**', i):
            out.append('</b>' if bold else '<b>'); bold = not bold; i += 2
        elif s[i] == '`':
            j = s.find('`', i + 1)
            if j == -1:
                out.append(s[i]); i += 1
            else:
                out.append('<code>' + s[i + 1:j] + '</code>'); i = j + 1
        else:
            out.append(s[i]); i += 1
    if bold:
        out.append('</b>')
    return ''.join(out)


# ----------------------------------------------------------------- 文案
TXT_MAIN = '开始游戏'
TXT_SUB = '继续 · 第 3 关'


def stage_916(key: str, scale: float, marks: bool = False) -> str:
    """
    渲染一个「真实毡面 + 真实文案」的按钮舞台（1:1 或 2×）。
    scale=1 → 320×140 真实尺寸；scale=2 → 640×280 细节。
    """
    w, h = DISP_W * scale, DISP_H * scale
    g = GEO[key]
    cl, cr, md = g['cap_l'] * scale, g['cap_r'] * scale, g['mid_disp'] * scale
    clamp = ''
    if marks:
        # 九宫格切点标记（虚线 + 顶部标签）—— 让"哪里固定、哪里拉伸"一眼可见
        clamp = (
            f'<i class="cut" style="left:{cl:.1f}px"></i>'
            f'<i class="cut" style="left:{(cl + md):.1f}px"></i>'
            f'<i class="tag" style="left:{cl:.1f}px">切</i>'
            f'<i class="tag" style="left:{(cl + md):.1f}px">切</i>'
        )
    return (
        f'<div class="stage" style="width:{w}px;height:{h}px">'
        f'<img class="cap" src="round37/{key}_cap_l.png" '
        f'style="left:0;width:{cl:.1f}px;height:{h}px">'
        f'<img class="mid" src="round37/{key}_mid.png" '
        f'style="left:{cl:.1f}px;width:{md:.1f}px;height:{h}px">'
        f'<img class="cap" src="round37/{key}_cap_r.png" '
        f'style="left:{cl + md:.1f}px;width:{cr:.1f}px;height:{h}px">'
        f'{clamp}'
        f'<div class="labelbox" style="--s:{scale}">'
        f'<span class="l1">{TXT_MAIN}</span>'
        f'<span class="l2"><i></i>{TXT_SUB}<i></i></span>'
        f'</div></div>'
    )


def stage_now(scale: float) -> str:
    """忠实复现**当前引擎**的画法（btn9 三段 + Shade 叠加）—— 病灶就在这里。"""
    w, h = DISP_W * scale, DISP_H * scale
    cl = BTN9['cap_l'] * scale
    cr = BTN9['cap_r'] * scale
    return (
        f'<div class="stage" style="width:{w}px;height:{h}px">'
        # 中段：228×280 → 强制 320×140（横向 ×1.40、纵向 ×0.50）
        f'<img class="mid" src="round37/btn9_mid.png" style="left:0;width:{w}px;height:{h}px">'
        f'<img class="cap" src="round37/btn9_left.png" style="left:0;width:{cl:.1f}px;height:{h}px">'
        f'<img class="cap" src="round37/btn9_right.png" '
        f'style="left:{w - cr:.1f}px;width:{cr:.1f}px;height:{h}px">'
        # Shade：两端各 80 宽的压暗带 + 中央白 10% 渐变（"中间亮度提高"的真凶）
        f'<div class="shade" style="width:{w}px;height:{h}px;'
        f'--band:{80 * scale}px"></div>'
        f'<div class="labelbox" style="--s:{scale}">'
        f'<span class="l1">{TXT_MAIN}</span>'
        f'<span class="l2"><i></i>{TXT_SUB}<i></i></span>'
        f'</div></div>'
    )


CARDS = [
    dict(key='v2', name='方案 B', title='v2 底板（设计稿 v2 选定的那块）',
         badge='设计稿推荐', hot=True,
         facts=['素材 **890×467**（1.91:1）', '左右弧宽实测 **189 / 184**',
                '显示 **320×140**（2.29:1）', '中段横向拉伸 **1.34×**（纵向 1:1）'],
         why='这是 `assets/_src/home/btn_primary_v2.png`。设计稿 v2 的正文原话就是'
             '「采用游戏 UI 标准的九宫格工艺（两端圆角固定、中段水平拉伸——金线横平竖直、'
             '玉纹云雾状，拉伸无损）」。拉伸量最小、玉纹保留最完整。'),
    dict(key='v1', name='方案 A', title='v1 底板（最早的存档版）',
         badge='', hot=False,
         facts=['素材 **885×519**（1.71:1）', '左右弧宽实测 **213 / 213**',
                '显示 **320×140**（2.29:1）', '中段横向拉伸 **1.66×**（纵向 1:1）'],
         why='这是 `assets/_src/home/btn_primary.png`。形体更"胖"一些、玉纹更浓，'
             '但因为素材比 320×140 更接近方形，中段要拉伸 1.66× —— '
             '玉纹会被横向拉长的程度比 v2 明显。设计稿当初正是因此重出了 v2。'),
]

# ----------------------------------------------------------------- 页面
def build() -> None:
    cards_html = []
    for c in CARDS:
        g = GEO[c['key']]
        facts = ''.join(f'<li>{inline(f)}</li>' for f in c['facts'])
        cards_html.append(f'''
<section class="cand {'hot' if c['hot'] else ''}">
  <div class="chead">
    <span class="cname">{c['name']}</span>
    <span class="ctitle">{inline(c['title'])}</span>
    {f'<span class="pick">{c["badge"]}</span>' if c['badge'] else ''}
  </div>
  <div class="shots">
    <figure><figcaption>1:1 真实尺寸 · 320×140</figcaption>{stage_916(c['key'], 1)}</figure>
    <figure><figcaption>2× 细节 · 640×280（虚线 = 九宫格切点，帽固定 / 中段拉伸）</figcaption>
      {stage_916(c['key'], 2, marks=True)}</figure>
  </div>
  <ul class="facts">{facts}</ul>
  <p class="why">{inline(c['why'])}</p>
</section>''')

    v2s = GEO['v2']['stretch']
    v1s = GEO['v1']['stretch']

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第37轮 · 首页主按钮 · 3 款式对比（待拍板）</title>
<style>
  :root {{
    --ink:#16211C; --sub:#5D6B64; --line:#DFE5E0; --bg:#F5F7F5; --card:#FFFFFF;
    --green:#1B5E4A; --green2:#2E8B63; --gold:#B8860B; --red:#C0392B; --amber:#B7791F;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --serif:"Songti SC","STSong",serif;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; padding:40px 32px 60px; background:var(--bg); color:var(--ink);
         font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
         font-size:15px; line-height:1.72; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1120px; margin:0 auto; }}
  header {{ border-bottom:3px solid var(--green); padding-bottom:18px; margin-bottom:26px; }}
  h1 {{ margin:0 0 8px; font-size:27px; letter-spacing:.4px; }}
  .sub {{ color:var(--sub); font-size:14px; }}
  .verdict {{ background:var(--green); color:#F2F7F4; border-radius:12px;
              padding:22px 26px; margin:0 0 30px; }}
  .verdict .lbl {{ font-size:12.5px; letter-spacing:2.5px; opacity:.75; margin-bottom:8px; }}
  .verdict .txt {{ font-size:16px; line-height:1.85; }}
  .verdict b {{ color:#FFD98A; }}
  .verdict code {{ background:rgba(255,255,255,.13); color:#FFE9A8; padding:1px 6px;
                   border-radius:4px; font-family:var(--mono); font-size:13px; }}
  h2 {{ font-size:18px; margin:38px 0 14px; padding-left:12px;
        border-left:4px solid var(--green2); }}
  h2 .en {{ font-size:12px; color:var(--sub); font-weight:400; margin-left:8px;
            letter-spacing:1px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:10px;
           overflow:hidden; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th {{ background:#EEF3EF; text-align:left; padding:11px 14px; font-weight:600;
        font-size:13px; color:#2C3B34; border-bottom:1px solid var(--line); }}
  td {{ padding:11px 14px; border-bottom:1px solid #EDF1EE; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  .mono {{ font-family:var(--mono); font-size:12.8px; }}
  .bad {{ color:var(--red); font-weight:600; }}
  .good {{ color:#1E8449; font-weight:600; }}
  code {{ font-family:var(--mono); font-size:12.6px; background:#EEF3EF;
          padding:1px 5px; border-radius:4px; color:#22483A; }}
  b {{ color:#0F3D2E; }}

  /* ---- 现状解剖 ---- */
  .autopsy {{ display:grid; grid-template-columns:auto 1fr; gap:26px; align-items:start; }}
  .autopsy img {{ display:block; border-radius:10px; border:1px solid #2A3A34; }}
  .faults {{ margin:0; padding:0; list-style:none; }}
  .faults li {{ padding:10px 0 10px 34px; position:relative; border-bottom:1px dashed #E2E8E4;
                font-size:14px; }}
  .faults li:last-child {{ border-bottom:none; }}
  .faults li::before {{ content:attr(data-n); position:absolute; left:0; top:10px;
      width:22px; height:22px; border-radius:50%; background:#FDE8E6; color:var(--red);
      font-size:12px; font-weight:700; text-align:center; line-height:22px;
      font-family:var(--mono); }}
  .faults .t {{ font-weight:600; color:#0F3D2E; }}

  /* ---- 候选卡 ---- */
  .cand {{ background:var(--card); border:1px solid var(--line); border-radius:12px;
           padding:20px 22px 18px; margin-bottom:20px; }}
  .cand.hot {{ border-color:#B9D6C6; box-shadow:0 2px 14px rgba(27,94,74,.09); }}
  .chead {{ display:flex; align-items:baseline; gap:12px; margin-bottom:16px;
            flex-wrap:wrap; }}
  .cname {{ font-size:20px; font-weight:700; color:#0F3D2E; letter-spacing:.5px; }}
  .ctitle {{ font-size:13.5px; color:var(--sub); }}
  .pick {{ margin-left:auto; background:#E3F4EA; color:#1E8449; font-size:12.5px;
           font-weight:600; padding:3px 12px; border-radius:20px; }}
  .shots {{ display:flex; gap:22px; align-items:flex-end; flex-wrap:wrap; }}
  figure {{ margin:0; }}
  figcaption {{ font-size:11.5px; color:var(--sub); margin-bottom:7px;
                font-family:var(--mono); }}

  /* ---- 按钮舞台（真实毡面） ---- */
  .stage {{ position:relative; border-radius:6px; overflow:hidden;
      background:url(round37/felt.jpg) center/cover;
      background-color:#0E2A1E; }}
  .stage img {{ position:absolute; top:0; display:block; image-rendering:auto; }}
  .stage .mid {{ object-fit:fill; }}
  .stage .shade {{ position:absolute; left:0; top:0; pointer-events:none;
      background:
        linear-gradient(90deg, rgba(2,24,13,.34) 0, rgba(2,24,13,.34) var(--band),
                        rgba(2,24,13,0) calc(var(--band) * 1.6)),
        linear-gradient(270deg, rgba(2,24,13,.34) 0, rgba(2,24,13,.34) var(--band),
                        rgba(2,24,13,0) calc(var(--band) * 1.6)),
        linear-gradient(180deg, rgba(255,255,255,.10) 0, rgba(255,255,255,0) 50%,
                        rgba(0,20,10,.16) 100%); }}
  .cut {{ position:absolute; top:0; bottom:0; width:0; border-left:1px dashed rgba(255,225,150,.85); }}
  .tag {{ position:absolute; top:2px; font-size:10px; color:#FFE9A8; font-style:normal;
          transform:translateX(-50%); font-family:var(--mono); }}
  .labelbox {{ position:absolute; inset:0; display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:calc(6px * var(--s)); }}
  .labelbox .l1 {{ font-size:calc(36px * var(--s)); font-weight:800; color:#FFE9A8;
      letter-spacing:calc(2px * var(--s)); line-height:1;
      text-shadow:0 calc(2px * var(--s)) calc(4px * var(--s)) rgba(0,0,0,.55); }}
  .labelbox .l2 {{ font-size:calc(24px * var(--s)); font-family:var(--serif); font-weight:700;
      color:rgba(255,247,230,.92); line-height:1; display:flex; align-items:center;
      gap:calc(12px * var(--s));
      text-shadow:0 calc(2px * var(--s)) calc(4px * var(--s)) rgba(0,0,0,.5); }}
  .labelbox .l2 i {{ display:block; width:calc(40px * var(--s)); height:1px;
      background:rgba(246,196,69,.63); }}

  .facts {{ margin:16px 0 0; padding:0; list-style:none; display:flex; gap:26px;
            flex-wrap:wrap; }}
  .facts li {{ font-size:13px; color:#41504A; position:relative; padding-left:13px; }}
  .facts li::before {{ content:''; position:absolute; left:0; top:8px; width:5px; height:5px;
      border-radius:50%; background:var(--green2); }}
  .why {{ margin:14px 0 0; font-size:13.5px; color:#41504A; background:#F7FAF8;
          border-left:3px solid #B9D6C6; padding:11px 14px; border-radius:0 8px 8px 0; }}

  .rec {{ background:#FFFDF4; border:1px solid #EDE0BC; border-radius:10px;
          padding:18px 22px; margin-top:8px; }}
  .rec h3 {{ margin:0 0 10px; font-size:15px; color:#8A6D1F; }}
  .rec ol {{ margin:0; padding-left:20px; font-size:14px; }}
  .rec li {{ margin-bottom:7px; }}
  .ask {{ background:var(--green); color:#F2F7F4; border-radius:10px; padding:16px 22px;
          margin-top:16px; font-size:14.5px; }}
  .ask b {{ color:#FFD98A; }}
</style></head><body><div class="wrap">

<header>
  <h1>第 37 轮 · 首页主按钮换素材 · 3 款式对比</h1>
  <div class="sub">《麻麻大消除》· 微信小游戏 · 750×1334 设计值 ·
    用户反馈：中间亮度提高 / 四周边缘违和 · <b>待拍板</b></div>
</header>

<div class="verdict">
  <div class="lbl">先给结论</div>
  <div class="txt">
    <b>病灶不在素材，在"九宫格怎么拼"。</b>
    当前引擎把 <code>btn9_mid</code> 的 <b>228×280 强制拉成 320×140</b> ——
    横向 ×1.40、纵向 ×0.50，<b>各向异性 2.81×</b>，玉纹被压扁拉长；
    再叠一层 <code>rgba(255,255,255,.10)</code> 的中央白渐变，
    就成了你圈出来的"<b>中间发亮</b>"；两端 78/75 宽的帽又盖在中段上，
    接缝落进可见区 ⇒ "<b>边缘违和</b>"。
    而原设计稿 v2 写的是「<b>两端圆角固定、中段水平拉伸</b>」——
    引擎里没照这个做。<br>
    下面三款都按<b>正确九宫格</b>渲染（本轮已把 v1/v2 实测弧宽切好），你挑一款即可。
  </div>
</div>

<h2>一、现状解剖<span class="en">你的实拍 2× 放大</span></h2>
<div class="card" style="padding:20px 22px">
  <div class="autopsy">
    <img src="round37/现状实拍.png" width="670" height="380"
         alt="当前主按钮实拍 2× 放大">
    <ul class="faults">
      <li data-n="1"><span class="t">中段被强制非等比拉伸</span><br>
        源图 228×280 → 显示 320×140：横向 ×1.403、纵向 ×0.500。
        玉纹本来是一团一团云雾，被压成横向拉丝 ⇒ 中间看着"平、假、发亮"。</li>
      <li data-n="2"><span class="t">中央白渐变叠加</span><br>
        <code>fillVGradient(..., 'rgba(255,255,255,0.10)', ...)</code> 铺在中段上方，
        再叠 <code>rgba(0,20,10,0.16)</code> 压底 —— 中段整体比两端亮一档。</li>
      <li data-n="3"><span class="t">两端的帽与中段接不上</span><br>
        左帽 78 宽、右帽 75 宽（按高 140 等比），都<b>压在中段之上</b>；
        帽的金框是圆弧、中段的金线是直线，落在 x≈78 / 245 处形成硬接缝。
        两端另有 80 宽 <code>rgba(2,24,13,.34)</code> 压暗带 ⇒ 那两条"灰条"。</li>
    </ul>
  </div>
</div>

<h2>二、三款候选<span class="en">全部按正确九宫格渲染 · 真实毡面 + 真实文案</span></h2>
{''.join(cards_html)}

<section class="cand">
  <div class="chead">
    <span class="cname">方案 C</span>
    <span class="ctitle">当前在用的 btn9 三段拼接（现状，供对照）</span>
  </div>
  <div class="shots">
    <figure><figcaption>1:1 真实尺寸 · 320×140</figcaption>{stage_now(1)}</figure>
    <figure><figcaption>2× 细节 · 640×280</figcaption>{stage_now(2)}</figure>
  </div>
  <ul class="facts">
    {''.join(f'<li>{inline(x)}</li>' for x in [
        '中段素材 **228×280**',
        '左帽 **156×280** → 78×140',
        '右帽 **150×280** → 75×140',
        '中段 **横向 1.40× / 纵向 0.50×**',
    ])}
  </ul>
  <p class="why">{inline('这就是你截图里看到的效果 —— 与上面「现状解剖」同一处病灶。'
      '放在这里是为了让你能**并排对比**：同样的文案与毡面，换成正确九宫格后差别有多大。')}</p>
</section>

<h2>三、数据对比<span class="en">同一显示尺寸 320×140 下的几何</span></h2>
<div class="card">
<table>
  <tr><th>项</th><th>方案 A · v1 底板</th><th>方案 B · v2 底板</th><th>方案 C · 现状 btn9</th></tr>
  <tr><td>素材文件</td><td class="mono">btn_primary.png</td><td class="mono">btn_primary_v2.png</td>
      <td class="mono">btn9_left/mid/right.png</td></tr>
  <tr><td>素材尺寸</td><td class="mono">885×519</td><td class="mono">890×467</td>
      <td class="mono">156 / 228 / 150 ×280</td></tr>
  <tr><td>素材比例</td><td class="mono">1.71:1</td><td class="mono">1.91:1</td>
      <td class="mono">—（三段拼）</td></tr>
  <tr><td>左右弧宽（实测）</td><td class="mono">213 / 213</td><td class="mono">189 / 184</td>
      <td class="mono">108 / 107</td></tr>
  <tr><td>中段横向拉伸</td><td class="mono">{v1s:.2f}×</td>
      <td class="mono good">{v2s:.2f}×</td><td class="mono bad">1.40×</td></tr>
  <tr><td>中段纵向拉伸</td><td class="mono good">1.00×</td><td class="mono good">1.00×</td>
      <td class="mono bad">0.50×</td></tr>
  <tr><td>各向异性（横÷纵）</td><td class="mono good">{v1s:.2f}×</td>
      <td class="mono good">{v2s:.2f}×</td><td class="mono bad">2.81×</td></tr>
  <tr><td>额外叠加层</td><td>无</td><td>无</td>
      <td class="bad">Shade：中央白 10% + 两端压暗 34%</td></tr>
  <tr><td>玉纹保留</td><td>中段被拉长 66%，云雾感有损失</td>
      <td class="good">中段只拉长 34%，云雾感基本保留</td>
      <td class="bad">压扁 50%，呈横向拉丝</td></tr>
  <tr><td>金线是否受影响</td><td>否（水平直线）</td><td>否（水平直线）</td>
      <td class="bad">是（直线被拉细、圆弧对不上）</td></tr>
</table>
</div>

<h2>四、我的建议<span class="en">依据给足，拍板在你</span></h2>
<div class="rec">
  <h3>推荐方案 B（<code>btn_primary_v2</code>），理由三条</h3>
  <ol>
    <li><b>它就是设计稿 v2 当初选的底板。</b> 设计稿正文写明"九宫格可拉至 2.2~2.6:1"，
        而 320×140 = 2.29:1 正落在区间内 —— 等于<b>把定稿意图原样实现</b>，不是新做决定。</li>
    <li><b>拉伸量最小。</b> 中段只需横向 1.34×（v1 要 1.66×），纵向严格 1:1，
        金线横平竖直不受影响，玉纹云雾感保留最完整。</li>
    <li><b>与整体色调同源。</b> 与「墨绿玉牌 + 金线」基准（七日签到锚点那套）同一材质族，
        和顶栏金币、四功能图标、静音图标是一条线。</li>
  </ol>
</div>
<div class="ask">
  <b>请你拍板：</b>方案 A / 方案 B / 方案 C（维持现状）选哪一个？
  另外确认一条：显示尺寸维持定稿的 <b>320×140</b>，还是要跟着素材比例改（会牵动下方关卡进度条的位置）？
</div>

</div></body></html>'''

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('写出', OUT)
    for k, g in GEO.items():
        print(f'  {k}: 帽 {g["cap_l"]:.1f}/{g["cap_r"]:.1f} · 中段 {g["mid_disp"]:.1f} '
              f'· 横向拉伸 {g["stretch"]:.3f}×')


if __name__ == '__main__':
    build()
