#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 make_round37b_sheet.py · 第 37 轮（二）验收对照板
============================================================
 输入：`/private/tmp/r37-shot/{before,after}-*.png`（同视口 421×927 @3 前后截图）
 输出：`round37/` 下的裁切对照图 + `76-第37轮二-主按钮与设置页.html`

 ⚠️ 踩过的坑（写板时逐条自检）：
   ① 往 HTML 里塞的 markdown **必须过 `inline()`**（`**粗**`→`<b>`），
      否则星号原样显示（第 35 / 37 轮各踩一次）；
   ② 板内内嵌图必须限宽 —— 单次截图高度上限实测 ≈4500px，超了会静默超时；
   ③ 表格每一列都要过 `inline()`（第 37 轮漏过一列）。
============================================================
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SHOT = Path("/private/tmp/r37-shot")
OUT = HERE / "round37"

# 真机换算：421 CSS 宽 = 750 设计 px
K_DESIGN = 750 / 421
# 截图是 @3 物理像素
DPR = 3


def crop_region(src: Path, dst: Path, cx: float, cy: float, w: float, h: float) -> Path:
    """按**设计坐标**（按钮/抽屉中心）从整屏截图里裁一块，坐标自动过 CSS/@3 换算。"""
    im = Image.open(src).convert("RGB")
    k = im.width / 750.0                      # 物理 px / 设计 px
    x0 = int((cx - w / 2) * k)
    y0 = int((cy - h / 2) * k)
    box = (x0, y0, int((cx + w / 2) * k), int((cy + h / 2) * k))
    out = im.crop(box)
    out.save(dst, "PNG", optimize=True)
    return dst


def inline(s: str) -> str:
    """把行内 markdown 渲染成 HTML —— 与「验证页/对照板」同一套。"""
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
    return s


# 真机可视高（设计 px）→ 抽屉顶在屏幕上的设计 y
VISIBLE_H = 750 / (1264 / 2780)
SHEET_TOP = VISIBLE_H - 700
# 改前（第 36 轮末）主按钮中心 y = 1300.6；改后 = 1273.5
BTN_CY_BEFORE, BTN_CY_AFTER = 1300.6, 1273.5


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    files = {}

    # ---- 主按钮：改前 / 改后 特写（360×180 设计）----
    files["btn_b"] = crop_region(SHOT / "before-home.png", OUT / "r37b-btn-before.png",
                                 375, BTN_CY_BEFORE, 380, 190)
    files["btn_a"] = crop_region(SHOT / "after-home.png", OUT / "r37b-btn-after.png",
                                 375, BTN_CY_AFTER, 380, 190)
    # 用户实拍（改前真机照）
    real = OUT / "现状实拍.png"
    if real.exists():
        files["btn_real"] = real

    # ---- 设置页：整屏 + 行区特写 ----
    for tag, key in (("before", "b"), ("after", "a")):
        im = Image.open(SHOT / f"{tag}-sheet.png").convert("RGB")
        p = OUT / f"r37b-sheet-{key}.png"
        im.save(p, "PNG", optimize=True)
        files[f"sheet_{key}"] = p

        rows = Image.open(SHOT / f"{tag}-sheet-rows.png").convert("RGB")
        p2 = OUT / f"r37b-sheet-rows-{key}.png"
        rows.save(p2, "PNG", optimize=True)
        files[f"rows_{key}"] = p2

        head = Image.open(SHOT / f"{tag}-sheet-header.png").convert("RGB")
        p3 = OUT / f"r37b-sheet-header-{key}.png"
        head.save(p3, "PNG", optimize=True)
        files[f"head_{key}"] = p3

        foot = Image.open(SHOT / f"{tag}-sheet-foot.png").convert("RGB")
        p4 = OUT / f"r37b-sheet-foot-{key}.png"
        foot.save(p4, "PNG", optimize=True)
        files[f"foot_{key}"] = p4

    for k, v in files.items():
        im = Image.open(v)
        print(f"  {k:10s} {im.width:5d}×{im.height:<5d} {v.name}")

    # ---- 数据表 ----
    btn_rows = [
        ("中段源 → 显示", "228×280 → 320×140", "361×327 → 207.8×140"),
        ("横向缩放", "×1.403", "×1.345（**只在中段**）"),
        ("纵向缩放", "×0.500", "×0.428（三段**同一比例**）"),
        ("各向异性（横向÷纵向）", "**2.81×**", "**1.00×**（帽）/ 1.345×（中段）"),
        ("两端帽与中段的关系", "帽**压在中段之上**（重叠 78/75 宽）",
         "三段**各占其位、零重叠**"),
        ("叠加的高光/压暗层", "两侧各 80 宽压暗带 + 中央白 10% + 底部压暗",
         "**整层删除**（素材自带明暗）"),
        ("素材体积", "155 KB", "308 KB（缩 70% 后）"),
    ]
    sheet_rows = [
        ("第二条分隔线位置", "`rule(352)` — 落在「背景音乐」行**内部**（该行 284~388）",
         "落在两组**空隙中央**（距行边各 24）"),
        ("四行左边缘", "**三档不齐**：图标 46 / 文字 110 / 链接文字 46",
         "**严格同一骨架**：图标列 48 → 间隙 22 → 文字"),
        ("行高", "104 / 104 / 98 / 98（两档）", "**96 × 4**（统一）"),
        ("图标视觉高", "喇叭 38.2 / 音符 50.3（定宽 42 导致）", "**均为 40**（改定高）"),
        ("关闭按钮 vs 标题中线", "70 vs 88（**差 18**）", "80 vs 80（**同心**）"),
        ("关闭按钮右边距", "30（比行的边距 46 还靠外）", "48（**与内容右缘对齐**）"),
        ("版本号 vs「关于本作」", "行 518~616 / 版本 600~626 ⇒ **重叠 16**",
         "行 512~608 / 版本 648~674 ⇒ 中心距 101 > 行距 96"),
        ("抽屉竖向留白", "顶部 4 / 底部 74（版心偏上）", "顶部 24 节奏 / 底部 26"),
        ("链接行图标", "无（所以左边缘对不齐）", "金色线描（重置↺ / 信息 i）"),
    ]

    def table(rows: list) -> str:
        return "\n".join(
            f'<tr><td>{inline(a)}</td><td class="b">{inline(b)}</td>'
            f'<td class="a">{inline(c)}</td></tr>'
            for a, b, c in rows
        )

    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第37轮（二）· 主按钮换血 + 设置页重排</title>
<style>
  :root {{
    --ink:#12211A; --ink2:#3D5449; --line:#D8E2DA; --bg:#F5F7F5;
    --bad:#8A4B3A; --good:#1B5E4A; --gold:#9A7B2E; --card:#FFFFFF;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; padding:26px 30px 44px; background:var(--bg); color:var(--ink);
         font:15px/1.72 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; }}
  h1 {{ font-size:26px; margin:0 0 6px; letter-spacing:.01em; }}
  h2 {{ font-size:19px; margin:34px 0 12px; padding-left:11px;
        border-left:4px solid var(--good); }}
  h3 {{ font-size:15px; margin:20px 0 8px; color:var(--ink2); }}
  .lede {{ color:var(--ink2); font-size:14px; margin:0 0 6px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:12px;
           padding:16px 18px; margin:12px 0 18px; }}
  .kv {{ display:grid; grid-template-columns:96px 1fr; gap:5px 14px; font-size:14px; }}
  .kv dt {{ color:var(--ink2); }}
  .kv dd {{ margin:0; }}
  table {{ width:100%; border-collapse:collapse; background:var(--card);
           border:1px solid var(--line); border-radius:10px; overflow:hidden;
           font-size:13.5px; }}
  th,td {{ padding:9px 12px; text-align:left; border-bottom:1px solid var(--line);
           vertical-align:top; }}
  th {{ background:#EDF2EE; font-weight:600; font-size:13px; }}
  tr:last-child td {{ border-bottom:0; }}
  td.b {{ color:var(--bad); }}
  td.a {{ color:var(--good); }}
  code {{ background:#EDF2EE; padding:1px 5px; border-radius:4px; font-size:12.5px;
          font-family:ui-monospace,Menlo,Consolas,monospace; }}
  .row {{ display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }}
  /* 强制并排（板面固定 1660 宽，不会溢出）—— 上下各一组会把页面顶到 5000px，
     而单次截图的高度上限实测 ≈4500px（超了**静默超时**，且自检三件套照样全绿）。 */
  .row.nowrap {{ flex-wrap:nowrap; }}
  .row.nowrap figure {{ flex:1 1 0; min-width:0; }}
  .row.nowrap .shot {{ width:100%; max-width:none; }}
  figure {{ margin:0; }}
  figcaption {{ font-size:12.5px; color:var(--ink2); margin-top:6px; text-align:center; }}
  .shot {{ display:block; height:auto; border:1px solid var(--line); border-radius:10px; }}
  .phone {{ max-width:300px; }}
  .pair {{ max-width:600px; }}
  .wide {{ max-width:900px; margin:0 auto; }}
  .tag {{ display:inline-block; font-size:11.5px; font-weight:700; letter-spacing:.04em;
          padding:2px 9px; border-radius:999px; margin-bottom:7px; }}
  .tag.b {{ background:#F3E4DF; color:var(--bad); }}
  .tag.a {{ background:#DEEEE7; color:var(--good); }}
  ul {{ margin:8px 0; padding-left:20px; }}
  li {{ margin:4px 0; }}
  .note {{ background:#FFFCF2; border:1px solid #EADFB8; border-radius:10px;
           padding:13px 16px; font-size:13.5px; }}
</style></head><body>

<h1>第 37 轮（二）· 主按钮换血 + 设置页重排</h1>
<p class="lede">同视口取证：<code>421×927 @3</code>（= 真机 1264×2780）。改前 / 改后走
<code>git stash</code> 切换，<b>没有手改源码造状态</b>；恢复后三个源文件 md5 与改后
<b>逐字节一致</b>。</p>

<h2>一、主按钮 —— 方案 B 落地</h2>

<div class="card">
<dl class="kv">
  <dt>病根</dt><dd>不在素材，在<b>拼法</b>：旧代码把中段源图 <code>228×280</code> 强制拉成
      <code>320×140</code> ⇒ 横向 ×1.403 / 纵向 ×0.500，<b>各向异性 2.81×</b>，
      玉纹被压成横向拉丝。</dd>
  <dt>叠层</dt><dd>旧代码还在按钮上压了一层 <code>Shade</code>：两侧各 80 宽的
      <code>rgba(2,24,13,0.34)</code> 硬压暗带（用来盖接缝），中央
      <code>rgba(255,255,255,0.10)</code> 竖向渐变 —— <b>这就是"中间发亮"的直因</b>。</dd>
  <dt>改法</dt><dd>三段<b>各占其位、零重叠</b>：两帽 <code>aspectH:140</code> 定高等比，
      中段宽 = <code>320 − 56.94 − 55.23 = 207.83</code>；<code>Shade</code> 整层删除。</dd>
  <dt>素材</dt><dd>切件由 <code>make_btn_primary_assets.py</code> 从 <code>btn_v2.png</code>
      <b>先整图缩 70%、再按实测切点 190/706 裁三段</b>。切点取"两侧列高完全相同"处，
      消掉 1px 接缝台阶（1 源 px ≈ 真机 0.72 物理 px，不可见）。</dd>
</dl>
</div>

<div class="row">
  <figure><span class="tag b">改前</span>
    <img class="shot pair" src="round37/{files['btn_b'].name}" alt="改前主按钮"></figure>
  <figure><span class="tag a">改后</span>
    <img class="shot pair" src="round37/{files['btn_a'].name}" alt="改后主按钮"></figure>
</div>
<figcaption style="text-align:left;margin-top:8px">
  同一裁切口径（380×190 设计 px）。改前可对照用户实拍：中段明显亮、两端接不上。</figcaption>

<table style="margin-top:16px">
<tr><th style="width:29%">项</th><th style="width:35%">改前（btn9 拼法）</th><th>改后（方案 B）</th></tr>
{table(btn_rows)}
</table>

<h2>二、设置页 —— 四个硬伤已修</h2>

<div class="card">
<dl class="kv">
  <dt>① 分组线</dt><dd>原来 <code>rule(352)</code> 落在「背景音乐」行（284~388）<b>内部</b>，
      看起来像这行的下划线 —— <b>就是你红圈圈的那一处</b>。</dd>
  <dt>② 左边缘</dt><dd>原来两组是<b>三档不齐</b>（开关图标 46 / 开关文字 110 / 链接文字 46）。
      现在四行统一骨架「图标列 48 → 间隙 22 → 文字」，左右缘严格对齐。</dd>
  <dt>③ 标题带</dt><dd>关闭按钮与「设置」原来不同心（中线差 18），且距右 30 比行的边距 46
      还靠外；现在<b>共用中线 80</b>、右缘与内容右缘对齐。</dd>
  <dt>④ 版本号</dt><dd>原来与「关于本作」行<b>重叠 16px</b>；现在独立成页脚，
      中心距行 4 为 101 &gt; 行距 96，视觉上"游离"出来。</dd>
</dl>
</div>

<h3>整屏对照</h3>
<div class="row">
  <figure><span class="tag b">改前</span>
    <img class="shot phone" src="round37/{files['sheet_b'].name}" alt="改前设置页"></figure>
  <figure><span class="tag a">改后</span>
    <img class="shot phone" src="round37/{files['sheet_a'].name}" alt="改后设置页"></figure>
</div>

<h3>行区特写（同一裁切口径）</h3>
<div class="row nowrap">
  <figure><span class="tag b">改前</span>
    <img class="shot" src="round37/{files['rows_b'].name}" alt="改前行区"></figure>
  <figure><span class="tag a">改后</span>
    <img class="shot" src="round37/{files['rows_a'].name}" alt="改后行区"></figure>
</div>

<h3>标题带</h3>
<div class="row nowrap">
  <figure><span class="tag b">改前</span>
    <img class="shot" src="round37/{files['head_b'].name}" alt="改前标题带"></figure>
  <figure><span class="tag a">改后</span>
    <img class="shot" src="round37/{files['head_a'].name}" alt="改后标题带"></figure>
</div>

<h3>页脚</h3>
<div class="row nowrap">
  <figure><span class="tag b">改前</span>
    <img class="shot" src="round37/{files['foot_b'].name}" alt="改前页脚"></figure>
  <figure><span class="tag a">改后</span>
    <img class="shot" src="round37/{files['foot_a'].name}" alt="改后页脚"></figure>
</div>

<table style="margin-top:16px">
<tr><th style="width:26%">项</th><th style="width:37%">改前</th><th>改后</th></tr>
{table(sheet_rows)}
</table>

<h2>三、验证</h2>
<div class="card">
<dl class="kv">
  <dt>类型检查</dt><dd><code>tsc-check.sh</code> → <b>0 错误</b></dd>
  <dt>冒烟</dt><dd><code>g5-smoke.mjs</code> → <b>25 / 25 通过</b>（复跑 2 次均为
      「未捕获异常 0 · console error 0」；首跑出现过 1 条
      <code>ERR_CONNECTION_RESET</code> 的本地服务器偶发断连，复跑不复现）</dd>
  <dt>版式审计</dt><dd>真机比例下 <code>BtnStart 320×140</code> ·
      <code>Mid 208×140</code> · <code>CapL 57×140</code> · <code>CapR 55×140</code>，
      <b>无非页面节点越界</b></dd>
  <dt>素材</dt><dd>旧 <code>btn_left/mid/right</code> 已从工程删除（备份
      <code>/private/tmp/g5-btn9-bak</code>）；新素材自动生成 <code>.meta</code> 并进包</dd>
</dl>
</div>

<h2>四、请你拍板 / 待确认</h2>
<div class="note">
<ul>
  <li><b>音效 / 背景音乐两个开关是联动的</b> —— 两行都调
      <code>AudioService.setMuted()</code>，所以关掉「背景音乐」会把「音效」一起关掉。
      这是<b>功能问题、不是排版问题</b>，我没擅自改（要改得给
      <code>AudioService</code> 加独立的 bgm / sfx 开关）。要不要修？</li>
  <li><b>「重置进度」目前点了就直接重置</b>，没有二次确认。要不要加一个
      「确定要重置吗」的确认层？</li>
  <li>版本号文案 <code>v0.1.0-cocos · 试玩版</code> 与「关于本作」的 toast
      <code>《叠塔消消》· 试玩版</code> 里的<b>游戏名仍是「叠塔消消」</b>，
      而美术标题是「麻麻大消除」—— 这个悬了很久，要不要一并统一？</li>
</ul>
</div>

</body></html>
"""

    html_path = HERE / "76-第37轮二-主按钮与设置页.html"
    html_path.write_text(html, encoding="utf-8")

    leak = len(re.findall(r"\*\*", html))
    print(f"\n  已写 {html_path.name}  {len(html)} B")
    print(f"  星号泄漏自检：{leak} 处" + ("  ✅" if leak == 0 else "  ❌"))
    for m in sorted(set(re.findall(r'src="([^"]+)"', html))):
        print(("  OK   " if (HERE / m).exists() else "  MISS ") + m)
    return 0 if leak == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
