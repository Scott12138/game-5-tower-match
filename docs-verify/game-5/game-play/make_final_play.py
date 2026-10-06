#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主玩页 · 验收入库：把工作稿生成「assets/game-play/主玩页-定稿.html」。

与 make_archive_play.py（留痕版）的区别 —— 只做「标识升级」，功能与参数一字不动：
  ① <title> 由「排版稿」改为「定稿」
  ② 页头 h1「排版稿」→「定稿」；角标 layout v2 → final v1
  ③ 头部注释块升为定稿行，并补沿革
  ④ 侧栏最前插入一张「已验收入库」卡（不删改原有 4 张卡）

★ 路径重写：定稿位于 assets/game-play/，页面里的 './assets/xxx' 需整体降为 '../xxx'。
★ 仍按开局页工艺先把 data: 块抠出占位再替换（base64 字母表含 '/'，可能凑出 'assets/'）。
"""
import io, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'game-5-主玩页-排版.html')
DST  = os.path.join(ROOT, 'assets', 'game-play', '主玩页-定稿.html')

s = io.open(SRC, encoding='utf-8').read()
orig_len = len(s.encode())

# ── ① title ────────────────────────────────────────────────────────────────
old_title = '<title>game-5 · 主玩页（④）排版稿 ·《麻麻大消除》</title>'
new_title = '<title>game-5 · 主玩页（④）定稿 ·《麻麻大消除》</title>'
assert old_title in s, '未找到原 title'
s = s.replace(old_title, new_title, 1)

# ── ② 页头 h1 + 角标 ────────────────────────────────────────────────────────
old_h1 = '<h1>主玩页（④）· 排版稿</h1>'
new_h1 = '<h1>主玩页（④）· 定稿</h1>'
assert old_h1 in s, '未找到页头 h1'
s = s.replace(old_h1, new_h1, 1)

old_tag = '<span class="tag">game-5 · layout v2 · 750×1334</span>'
new_tag = '<span class="tag">game-5 · final v1 · 750×1334</span>'
assert old_tag in s, '未找到页头角标'
s = s.replace(old_tag, new_tag, 1)

# ── ③ 头部注释块 ────────────────────────────────────────────────────────────
old_head = ('   主玩页（④）· 排版稿  v2（第 16 轮 · 2026-10-05）\n'
            '   ├ 本轮 4 项调整：① 暂停/关卡上移对齐胶囊避让 ② 移除「＋看广告得」独立位\n'
            '   │               ③ 道具格 96×96 → 126×112（4 格） ④「?」→ 规则按钮 + 规则弹层（内容图待出图）')
new_head = ('   主玩页（④）· 定稿  v1（第 17 轮验收入库 · 2026-10-05）\n'
            '   —— 沿革：第 15 轮定内容框架（6 区 21 项）→ 排版落地（底带超 12px，拍板「桌面不动、压扁底部两栏」）\n'
            '     → 赠礼层产出（过场 + 落位两段）→ 第 16 轮按截图反馈调 4 项 + 修 1 项遗留缺陷（复活徽标压槽位）\n'
            '     → 第 17 轮用户验收通过，正式纳入资产库（assets/game-play/主玩页-定稿.html）\n'
            '     → 第 25/26 轮规则弹层两区填实并固化为分区图 → 第 27 轮整页合并为一张图（规则页定稿）\n'
            '     → 第 28 轮规则页正式入资产库（assets/game-play/rule-完整规则页.png）\n'
            '     → 第 28 轮牌面 27 张归一化 192×256 并入 tiles/，页内接入真母版\n'
            '     → 第 29 轮修掉「红中」根因（生成器曾以 8% 概率注入库外牌 → 收敛为唯一真源 DECK）\n'
            '     → 第 33 轮牌面母版 192×256 → 224×298（`OCC_H 1.0` 内切 · 27/27 零裁切）\n'
            '       + 主包转 WebP q=92（原 PNG 未改）⇒ 6552.2 KB → 1115.6 KB（超限 → 达标）\n'
            '   ├ 第 16 轮 4 项调整：① 暂停/关卡上移对齐胶囊避让 ② 移除「＋看广告得」独立位\n'
            '   │                   ③ 道具格 96×96 → 126×112（4 格） ④「?」→ 规则按钮 + 规则弹层（第 27 轮整页一图定稿）')
assert old_head in s, '未找到原头部注释'
s = s.replace(old_head, new_head, 1)

# ── ④ 侧栏最前插入「已验收入库」卡 ─────────────────────────────────────────
anchor = '  <aside class="side">\n    <div class="card">'
assert anchor in s, '未找到侧栏锚点'
final_card = (
    '  <aside class="side">\n'
    '    <div class="card" style="border-color:rgba(246,196,69,.62);background:rgba(246,196,69,.07)">\n'
    '      <h3>✅ 已验收入库（第 17 轮 · 2026-10-05）</h3>\n'
    '      <p style="color:#8FE3C5">本页经用户拍板验收通过，正式纳入资产库 —— '
    '<code>assets/game-play/主玩页-定稿.html</code>。</p>\n'
    '      <p>已验证：真实浏览器 <b>95 / 95 项</b>通过、运行期零错误。'
    '定稿口径：底带占用 <b>220 ≤ 224</b> · 顶带四件垂直中心同为 <b>y 120</b> · '
    '道具栏 <b>4 格 126×112</b> · 点不足道具<b>直接走看广告</b> · 复活徽标在顶带空档（不压槽位）。</p>\n'
    '      <p class="note">✅ <b>规则页（M7 内容）已定稿入库（第 27–28 轮）</b>：标题栏 + 碰/吃 区 + 点数表区 + '
    '页脚免责声明整页烘焙为一张图 <code>rule-完整规则页.png</code>（@2x 1264×2040），页内整卡以 '
    '<code>&lt;img&gt;</code> 引用、✕ 由透明热区承接（真实事件验收 16/16）。<br>'
    '✅ <b>牌面 27 张已接入</b>（第 28 轮接入 → <b>第 33 轮升规格</b>）：归一化 <code>@2x 224×298</code> → '
    '<code>assets/game-play/tiles/{wan,tiao,tong}/*.png</code>（内切贴满 · 各关 CSS 缩 0.786~1.0），本页默认走真母版。<br>'
    '★ <b>第 33 轮：主包转 WebP q=92</b>（用户 L2 拍板）—— 另出 <code>*-webp/</code> 目录，'
    '<b>原 PNG 一字未改</b>（57 文件 md5 全等）；主包 <b>6552.2 KB → 1115.6 KB</b>（超限 → 达标），回退删目录即可。<br>'
    '★ <b>第 29 轮：牌库收敛为唯一真源 <code>DECK</code></b>（万/条/筒 × 1~9 = 27 种）。'
    '此前生成器以 <b>8% 概率注入「中」</b>（库外的牌），已彻底移除；'
    '牌库审计 <b>库外牌 0 张 · 牌面「中」字 0 处</b>（12/36/96 三档全覆盖 → 15/15）。<br>'
    '⏳ <b>牌堆初始化方案待拍板</b>：现状为 3 层网格 + 恒定层偏移 + 全部 0° 正放，'
    '且三档发牌均<b>不可满清</b> —— 详见 <code>docs-verify/…/31-主玩页-待定稿清单.html</code>。</p>\n'
    '    </div>\n'
    '    <div class="card">'
)
s = s.replace(anchor, final_card, 1)

# ── 路径重写（先抠 data: 块）────────────────────────────────────────────────
keep = []
def stash(m):
    keep.append(m.group(0))
    return '\x00D%d\x00' % (len(keep) - 1)
s2 = re.sub(r'(src|href)="data:[^"]+"', stash, s)

before = s2.count('./assets/')
s2 = s2.replace('./assets/', '../')
s2 = re.sub(r'\x00D(\d+)\x00', lambda m: keep[int(m.group(1))], s2)

io.open(DST, 'w', encoding='utf-8').write(s2)

leftover = re.findall(r'(?:src|href)="[^"]*assets/[^"]*"', s2)
print('工作稿 %d B → 定稿版 %d B' % (orig_len, len(s2.encode())))
print('路径重写：./assets/ 出现 %d 次 → 残留 assets/ 引用 %d 处' % (before, len(leftover)))
print('data: 块：保护 %d 个（已原样还原）' % len(keep))
print('产出：%s' % os.path.relpath(DST, ROOT))
for tag, ok in [('title 已改定稿', '主玩页（④）定稿' in s2),
                ('页头 h1 已改', '主玩页（④）· 定稿' in s2),
                ('角标 final v1', 'game-5 · final v1' in s2),
                ('头部注释 v1', '主玩页（④）· 定稿  v1' in s2),
                ('验收卡已插', '已验收入库（第 17 轮' in s2),
                ('相对路径降级', '../game-start/' in s2 and './assets/' not in s2)]:
    print('  %s : %s' % (tag, 'OK' if ok else '⚠ 失败'))
if leftover:
    raise SystemExit('⚠ 仍有残留引用：%s' % leftover[:3])
