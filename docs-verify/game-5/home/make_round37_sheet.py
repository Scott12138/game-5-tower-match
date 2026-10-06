# -*- coding: utf-8 -*-
"""
第 37 轮 · 首页三项优化 —— 验收对照板。

用户三项诉求（原话）：
  ① 首页顶栏与标题之间空出 211 设计 px，按你的建议修改试试看
  ② 两边的功能键可以适当再放大一些，现在太小了
  ③ 开始游戏按钮设置得不好看 …… 使用回统一色调的素材（另出 72 号板待拍板）

本脚本产出：
  · round37/r37-区域A-顶栏到标题.png  （改前 | 改后，带空档标注）
  · round37/r37-区域B-功能键.png      （改前 | 改后）
  · round37/r37-区域C-主按钮.png      （改前 | 改后）
  · 74-第37轮-首页三项优化.html
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
S = os.path.join(ROOT, 'round37')
OUT = os.path.join(ROOT, '74-第37轮-首页三项优化.html')

BEFORE = os.path.join(S, 'home-before-421x927.png')
AFTER = os.path.join(S, 'home-after-421x927.png')

CSS_W, CSS_H = 421, 927                       # 真机基线视口（421×927 @3）
DESIGN_H = 1651.4286                          # 可视高（设计 px）
K = CSS_H / DESIGN_H                          # 设计 px → 截图 px 的换算系数
SCALE = 1.2                                   # 裁切图放大倍数（1.2× 已足够看清位移；
                                              #  再大页面会超 6000px 截图会超时 —— 第 37 轮实测）

FONT_PATH = '/System/Library/Fonts/STHeiti Medium.ttc'


def font(sz: int):
    try:
        return ImageFont.truetype(FONT_PATH, sz)
    except Exception:
        return ImageFont.load_default()


def dy(design_y: float) -> float:
    """设计 px → 截图 px"""
    return design_y * K


# ----------------------------------------------------------------- 区域定义
# 每一区：设计 y 起止、标题、要画的水平标注线（设计 y, 颜色, 文案）
REGIONS = [
    dict(
        key='A', name='顶栏 → 标题', title='区域 A · 顶栏与标题之间的空档',
        y0=45, y1=520,
        lines_before=[
            (159.4, '#7AD1A9', '顶栏底沿 159.4（胶囊底）'),
            (334.1, '#E8B33C', '标题光晕顶 334.1'),
            (370.6, '#E8B33C', '标题美术字顶 370.6  ← 你量到的 211 空档下端'),
        ],
        bands_before=[(159.4, 370.6, '#E8B33C')],
        lines_after=[
            (159.4, '#7AD1A9', '顶栏底沿 159.4（两版一致）'),
            (225.0, '#6FE0A8', '标题光晕顶 225.0'),
            (261.5, '#6FE0A8', '标题美术字顶 261.5  ← 空档下端'),
        ],
        bands_after=[(159.4, 261.5, '#6FE0A8')],
    ),
    dict(
        key='B', name='功能键', title='区域 B · 左右功能键（图标 96 → 120）',
        y0=700, y1=1300, lines_before=[], bands_before=[], lines_after=[], bands_after=[],
    ),
    dict(
        key='C', name='主按钮 + 进度条', title='区域 C · 主按钮与关卡进度条',
        y0=1140, y1=1620, lines_before=[], bands_before=[], lines_after=[], bands_after=[],
    ),
]


def panel(im: Image.Image, r: dict, tag: str, tag_color: str, which: str) -> Image.Image:
    """裁一个区域、放大、在顶部贴一条标签栏、画标注线与空档色带。"""
    y0, y1 = r['y0'], r['y1']
    cy0, cy1 = int(dy(y0)), int(round(dy(y1)))
    crop = im.crop((0, cy0, CSS_W, cy1)).resize(
        (int(CSS_W * SCALE), int((cy1 - cy0) * SCALE)), Image.LANCZOS)

    BAR = 26
    out = Image.new('RGB', (crop.width, crop.height + BAR), '#10221B')
    d = ImageDraw.Draw(out, 'RGBA')

    # 空档色带（画在内容之上，半透明，让"空"看得见）
    for a, b, col in r['bands_' + which]:
        ya, yb = dy(a) - cy0, dy(b) - cy0
        rgba = (int(col[1:3], 16), int(col[3:5], 16), int(col[5:7], 16), 46)
        d.rectangle([0, BAR + ya * SCALE, crop.width, BAR + yb * SCALE], fill=rgba)

    out.paste(crop, (0, BAR))

    # 顶部标签栏
    d.rectangle([0, 0, out.width, BAR], fill=tag_color)
    d.text((8, 5), tag, font=font(15), fill='#FFFFFF')

    # 水平标注线
    for y, col, label in r['lines_' + which]:
        yy = BAR + (dy(y) - cy0) * SCALE
        rgb = (int(col[1:3], 16), int(col[3:5], 16), int(col[5:7], 16))
        d.line([0, yy, out.width, yy], fill=rgb + (235,), width=2)
        tw = d.textlength(label, font=font(13))
        d.rectangle([6, yy + 3, 6 + tw + 8, yy + 20], fill=(10, 24, 18, 205))
        d.text((10, yy + 4), label, font=font(13), fill=col)

    return out


def compose(r: dict) -> str:
    b = panel(Image.open(BEFORE).convert('RGB'), r, '改前', '#8A4B3A', 'before')
    a = panel(Image.open(AFTER).convert('RGB'), r, '改后', '#1B5E4A', 'after')
    h = max(b.height, a.height)
    GAP, DIV = 12, 3
    out = Image.new('RGB', (b.width * 2 + GAP * 2 + DIV, h), '#DFE5E0')
    out.paste(b, (0, 0))
    out.paste(a, (b.width + GAP + DIV, 0))
    path = os.path.join(S, f'r37-区域{r["key"]}-{r["name"].replace(" → ", "到").replace(" + ", "与")}.png')
    out.save(path)
    print(f'  {os.path.basename(path)}  {out.size[0]}×{out.size[1]}')
    return os.path.basename(path)


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


# ----------------------------------------------------------------- 数据
ROWS = [
    ('`FIT.HOME.top`（纵向映射参数）', '110', '**205**', '+95'),
    ('顶栏底沿（金币胶囊底）', '159.4', '159.4', '不动 · 绝对定位'),
    ('标题光晕顶', '334.1', '**225.0**', '↑109.1'),
    ('标题美术字顶', '370.6', '**261.5**', '↑109.1'),
    ('**空档：顶栏底沿 → 标题美术字顶**', '**211.2**', '**102.1**', '**−51.7%**'),
    ('空档：顶栏底沿 → 标题光晕顶', '174.7', '65.6', '−62.5%'),
    ('标题中心 y', '441.1', '332.0', '↑109.1'),
    ('吉祥物中心 y', '840.3', '769.3', '↑71.0'),
    ('主按钮中心 y', '1300.6', '1273.5', '↑27.1'),
    ('主按钮顶边', '1230.6', '1203.5', '↑27.1'),
    ('进度条中心 y', '1525.6', '1520.0', '↑5.6（近似锚定）'),
    ('进度条底边', '1570.6', '1565.0', '↑5.6'),
    ('功能键图标（正方形素材）', '96 × 96', '**120 × 120**', '**+25.0%**'),
    ('功能键节点总高', '96 × 130', '120 × 158', '+28'),
    ('功能键文案字号', '22', '**26**', '+18.2%'),
    ('功能键 左列 x', '40 ~ 136', '**40 ~ 160**', '右缘 +24'),
    ('功能键 右列 x', '614 ~ 710', '**590 ~ 710**', '左缘 −24'),
    ('列内第一行真机中心 y', '931.6', '862.2', '↑69.4'),
    ('列内第二行真机中心 y', '1160.4', '1113.0', '↑47.4'),
]

VERIFY = [
    ('类型检查 `bash tools/tsc-check.sh`', '**[✓] 0 错误**'),
    ('冒烟 `node tools/g5-smoke.mjs`', '**通过 25 / 共 25** · 未捕获异常 0 · console error 0'),
    ('版式审计 `g5-device-audit.mjs --w 421 --h 927`', '**✅ 无非页面节点越界**（可视 0 ~ 1651）'),
    ('web-desktop 构建', '成功 · 入口文件齐全'),
    ('前后取证方式', '`git stash push -- <两文件>` → 构建/审计 → `git stash pop` → **md5 与备份逐字节一致**'),
]


def build(files: dict) -> None:
    rows = '\n'.join(
        f'<tr><td>{inline(a)}</td><td class="mono">{inline(b)}</td>'
        f'<td class="mono">{inline(c)}</td><td class="mono">{inline(d)}</td></tr>'
        for a, b, c, d in ROWS)
    ver = '\n'.join(f'<tr><td>{inline(a)}</td><td>{inline(b)}</td></tr>' for a, b in VERIFY)

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第37轮 · 首页三项优化（已改完 · 待验收）</title>
<style>
  :root {{
    --ink:#16211C; --sub:#5D6B64; --line:#DFE5E0; --bg:#F5F7F5; --card:#FFFFFF;
    --green:#1B5E4A; --green2:#2E8B63; --gold:#B8860B; --red:#C0392B; --amber:#B7791F;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; padding:40px 28px 64px; background:var(--bg); color:var(--ink);
         font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
         font-size:15px; line-height:1.72; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1400px; margin:0 auto; }}
  header {{ border-bottom:3px solid var(--green); padding-bottom:18px; margin-bottom:26px; }}
  h1 {{ margin:0 0 8px; font-size:27px; letter-spacing:.4px; }}
  .sub {{ color:var(--sub); font-size:14px; }}
  h2 {{ font-size:18px; margin:40px 0 14px; padding-left:12px;
        border-left:4px solid var(--green2); }}
  h2 .en {{ font-size:12px; color:var(--sub); font-weight:400; margin-left:8px; letter-spacing:1px; }}
  .verdict {{ background:var(--green); color:#F2F7F4; border-radius:12px;
              padding:22px 26px; margin:0 0 30px; }}
  .verdict .lbl {{ font-size:12.5px; letter-spacing:2.5px; opacity:.75; margin-bottom:8px; }}
  .verdict .txt {{ font-size:15.5px; line-height:1.9; }}
  .verdict b {{ color:#FFD98A; }}
  .verdict code {{ background:rgba(255,255,255,.13); color:#FFE9A8; padding:1px 6px;
                   border-radius:4px; font-family:var(--mono); font-size:13px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th {{ background:#EEF3EF; text-align:left; padding:10px 14px; font-weight:600;
        font-size:13px; color:#2C3B34; border-bottom:1px solid var(--line); }}
  td {{ padding:9px 14px; border-bottom:1px solid #EDF1EE; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  .mono {{ font-family:var(--mono); font-size:12.8px; }}
  code {{ font-family:var(--mono); font-size:12.6px; background:#EEF3EF;
          padding:1px 5px; border-radius:4px; color:#22483A; }}
  b {{ color:#0F3D2E; }}
  figure {{ margin:0; }}
  figcaption {{ font-size:12.5px; color:var(--sub); margin:0 0 8px; font-family:var(--mono); }}
  .shot {{ display:block; width:100%; max-width:900px; height:auto; margin:0 auto;
           border:1px solid var(--line); border-radius:8px; }}
  .shot.small {{ max-width:560px; }}
  .note {{ background:#F7FAF8; border-left:3px solid #B9D6C6; padding:12px 16px;
           border-radius:0 8px 8px 0; font-size:13.5px; color:#41504A; margin-top:14px; }}
  .warn {{ background:#FFF9EC; border-left:3px solid #E0B84C; padding:12px 16px;
           border-radius:0 8px 8px 0; font-size:13.5px; color:#5E4A17; margin-top:14px; }}
  .ask {{ background:var(--green); color:#F2F7F4; border-radius:10px; padding:18px 22px;
          margin-top:18px; font-size:14.5px; line-height:1.9; }}
  .ask b {{ color:#FFD98A; }}
  .chip {{ display:inline-block; background:#E3F4EA; color:#1E8449; font-size:12px;
           font-weight:600; padding:2px 10px; border-radius:20px; margin-left:8px;
           vertical-align:2px; }}
  .chip.gray {{ background:#EEF1EF; color:#5D6B64; }}
  .grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:20px; }}
  ol, ul {{ margin:8px 0 0; padding-left:22px; }}
  li {{ margin-bottom:6px; }}
</style></head><body><div class="wrap">

<header>
  <h1>第 37 轮 · 首页三项优化<span class="chip">已改完 · 待验收</span></h1>
  <div class="sub">《麻麻大消除》· 微信小游戏 · 真机基线 <b>421×927 @3</b>
    （逻辑屏 421.33×926.67 · 可视高 1651.4 设计 px）· 所有 y 值为<b>设计 px</b></div>
</header>

<div class="verdict">
  <div class="lbl">本轮结论</div>
  <div class="txt">
    三项里 <b>①② 已落进工程并全绿</b>：空档 <b>211.2 → 102.1（−51.7%）</b>、
    功能键图标 <b>96 → 120（+25%）</b>、文案 22 → 26。<br>
    <b>③ 主按钮</b>已定位到真因（<b>九宫格被强制非等比拉伸 2.81×</b>，病灶在拼法不在素材），
    已出 <b>3 款对照板</b>（见 <code>72-第37轮-主按钮-3款式对比.html</code>），<b>等你拍板后再接入</b> ——
    没擅自改代码。
  </div>
</div>

<h2>一、总览：改了什么<span class="en">全部取自同一视口的前后两次审计</span></h2>
<div class="card">
<table>
  <tr><th>项</th><th>改前</th><th>改后</th><th>变化</th></tr>
  {rows}
</table>
</div>

<h2>二、全页前后对照<span class="en">左 = 改前 · 右 = 改后</span></h2>
<figure>
  <figcaption>421×927 @3 · 真机基线视口 · 同一关卡进度（第 1 关）· 逐像素同口径</figcaption>
  <img class="shot small" src="round37/首页-第37轮-前后并排.png" alt="首页改前改后并排">
</figure>

<h2>三、区域 A：顶栏与标题之间的空档<span class="en">你的诉求 ①</span></h2>
<figure>
  <figcaption>左 = 改前（空档 211.2）· 右 = 改后（空档 102.1）· 色带即空档区域</figcaption>
  <img class="shot" src="round37/{files['A']}" alt="区域A 顶栏到标题 前后对照">
</figure>
<div class="note">
  <b>病因</b>：第 35 轮把顶栏改成绝对定位（<code>fromTop(胶囊中线 127.4)</code>）后，
  <code>FIT.HOME.top = 110</code> 那个位置<b>已经没有元素了</b> ——
  于是 <code>[110, 标题光晕顶]</code> 这一整段映射变成了纯空档。真机上就是顶栏底沿 159.4
  到标题美术字顶 370.6 的 <b>211.2</b>（占可视高 12.8%；定稿稿只有 ≈58，占 4.3%）。<br>
  <b>解法</b>：把 <code>top</code> 挪到「<b>第一个真实内容元素（标题光晕）的设计顶边</b>」——
  <code>HALO_TOP 139.5 + YSHIFT 64 = 203.5</code> ⇒ 取整 <b>205</b>（留 1.5 余量）。<br>
  <b>副作用</b>：<code>top</code> 一改，整页上半屏跟着上移。标题 ↑109.1、吉祥物 ↑71.0、
  主按钮 ↑27.1、进度条 ↑5.6（越靠下越接近锚定，这是分段线性重映射的正常表现）。
</div>
<div class="warn">
  <b>上限（不能再往上推）</b>：<code>top ≈ 237</code> 时标题光晕顶正好落到
  <code>SAFE_TOP</code>（183.3，胶囊底 + 24 间距）；<code>top ≥ 270</code> 光晕会<b>盖住顶栏</b>。
  已选定的 <b>205</b> 距上限还有 <b>32</b> 的余量（可用空间 <code>110 → 237</code> 用掉 ≈75%），
  取整时也刻意留了 1.5 —— 建议就此定稿，再往上压就只能动标题本身的纵向位置了。
</div>

<h2>四、区域 B：左右功能键放大<span class="en">你的诉求 ②</span></h2>
<figure>
  <figcaption>左 = 改前（图标 96×96 · 文案 22）· 右 = 改后（图标 120×120 · 文案 26）。
    ⚠ 吉祥物<b>尺寸未改</b>，只是整体上移 71 设计 px ⇒ 同一裁切区里看到的是它更宽的那一段，视觉上"变大"是错觉</figcaption>
  <img class="shot" src="round37/{files['B']}" alt="区域B 功能键 前后对照">
</figure>
<div class="note">
  <b>放大到 120 不是手感，是被"撞不撞吉祥物"卡出来的。</b>
  吉祥物显示 410 宽，整体不透明区占宽 99.3%（x 171.5~578.5）；
  但真正构成约束的是<b>功能键所在的那条 y 带</b>：实测该带内吉祥物最大宽 <b>331.4</b>、
  且因姿势不对称<b>整体右偏</b>（x <b>247.3 ~ 578.7</b>，右臂伸得更远）。于是：
  <ul>
    <li>右列左缘 <b>590</b> ↔ 吉祥物右缘 578.7 ⇒ 最小间隙 <b>11.3 设计 px</b>（≈6.3 CSS px @421）—— <b>这就是瓶颈</b>；</li>
    <li>左列右缘 <b>160</b> ↔ 吉祥物在左半侧约 247.3 ⇒ 间隙 87.3，不构成约束；</li>
    <li>文案 26 号："七日签到" 4 字 = <b>104</b> ≤ 标签框 120，不溢出。</li>
  </ul>
  <b>设计坐标一个没动</b>：列位仍是「贴边距 40」，节点设计 y 仍是 563 / 741，
  节距未改 —— 改的只是图标尺寸（96→120），真机上的 y 位移来自上面 <code>top</code> 那一项。
  这样改动面最小、最好回退，也不会牵连主按钮与进度条的纵向口径。
</div>
<div class="warn">
  <b>再往上放要付代价</b>：图标每 +10，右列左缘就 −10，间隙同减 10。
  上限约 <b>125</b>（间隙 6.3，已经很挤）；到 130 间隙只剩 1.3，视觉上会"贴上去"。
  若你想更大，得先动吉祥物（缩小 / 上移 / 换姿势），那是另一项改动，<b>等你发话</b>。
</div>

<h2>五、区域 C：主按钮（本轮未改）<span class="en">你的诉求 ③ · 待拍板</span></h2>
<figure>
  <figcaption>当前在用的 btn9 三段拼法（中间发亮 / 两端接不上）—— 与 <code>72</code> 号板的「方案 C」同一处病灶</figcaption>
  <img class="shot" src="round37/{files['C']}" alt="区域C 主按钮 前后对照">
</figure>
<div class="note">
  这一项目前<b>源码保持原样</b>（<code>buildMainButton()</code> 未动）。真因已经锁定：
  引擎把 <code>btn9_mid</code> 的 <b>228×280 强制拉成 320×140</b>（横向 ×1.40 / 纵向 ×0.50，
  <b>各向异性 2.81×</b>），再叠一层中央白渐变 —— 而设计稿 v2 原文写的是
  「<b>两端圆角固定、中段水平拉伸</b>」。三款候选（A=v1 / B=v2 / C=现状）已按正确九宫格渲染好，
  见 <code>72-第37轮-主按钮-3款式对比.html</code>。
</div>

<h2>六、回归验证<span class="en">改完必须全绿</span></h2>
<div class="card">
<table>
  <tr><th>检查项</th><th>结果</th></tr>
  {ver}
</table>
</div>

<h2>七、请你拍板<span class="en">两件事</span></h2>
<div class="ask">
  <b>① 主按钮选哪款？</b>方案 A（<code>btn_primary</code> · 拉伸 1.66×）/
  方案 B（<code>btn_primary_v2</code> · 拉伸 1.34×）/ 方案 C（维持现状）——
  我的建议是 <b>方案 B</b>，理由与数据在 <code>72</code> 号板「四、我的建议」。<br>
  <b>② 显示尺寸维持 320×140 吗？</b>跟着素材比例改会牵动下方关卡进度条的位置，需要你确认。<br>
  另外确认一条：本轮空档已压到 <b>102.1</b>、<code>top</code> 也用到可用空间的 ≈75%，
  <b>这个幅度可以吗</b>？还要更紧就得动标题的纵向位置了。
</div>

</div></body></html>'''

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('写出', OUT, os.path.getsize(OUT), 'B')


if __name__ == '__main__':
    print('生成区域裁切：')
    files = {r['key']: compose(r) for r in REGIONS}
    build(files)
