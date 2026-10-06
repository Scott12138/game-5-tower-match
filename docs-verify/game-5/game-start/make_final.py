#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开局页 · 验收入库：把工作稿生成「assets/game-start/开局页-定稿.html」。

与 make_archive.py（分镜留痕版）的区别 —— 只做三处「标识升级」，功能与参数一字不动：
  ① <title> 由「分镜演示」改为「定稿」
  ② 头部注释块的标题行升为 v3 定稿，并补一行沿革
  ③ 顶部说明区新插入一条「已验收定稿」块（不删改原第 13 轮说明）

★ 必须先把 <audio src="data:..."> 的 base64 数据块抠出来占位再替换 —— base64 字母表含 '/'，
  理论上可能凑出 "assets/" 子串而被误改。
"""
import io, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'game-5-开局页-分镜.html')
DST  = os.path.join(ROOT, 'assets', 'game-start', '开局页-定稿.html')

s = io.open(SRC, encoding='utf-8').read()
orig_len = len(s.encode())

# ── ① title ────────────────────────────────────────────────────────────────
old_title = '<title>game-5 · 开局页分镜演示（1.2s 电动桌掷骰 · B 追尾 · 音效 + 点数赠礼）·《麻麻大消除》</title>'
new_title = '<title>game-5 · 开局页定稿（1.2s 电动桌掷骰 · B 追尾 · 音效 + 点数赠礼 + 本局限定）·《麻麻大消除》</title>'
assert old_title in s, '未找到原 title'
s = s.replace(old_title, new_title, 1)

# ── ② 头部注释块 ────────────────────────────────────────────────────────────
old_head = ('   开局页 · 分镜演示页  v2（第 9 轮重做碰撞 → 第 11 轮定音效 + 点数赠礼 → 第 12 轮本局限定护栏\n'
            '     → 第 13 轮赠礼表定稿微调：偶 4·6·8·10 移出 / 奇 5·7·9 消除 / 3·11 加槽 / 2·12 复活·自动）')
new_head = ('   开局页 · 定稿  v3（第 14 轮验收入库 · 2026-10-05）\n'
            '   —— 沿革：第 9 轮重做碰撞出三方案 → 第 10 轮拍板 B「追尾」 → 第 11 轮定音效 #3 + 掷骰点数真随机\n'
            '     → 第 12 轮本局限定护栏 → 第 13 轮赠礼表定稿微调（偶移出 / 奇消除 / 3·11 加槽 / 2·12 复活·自动）\n'
            '     → 第 14 轮验收：本页正式纳入资产库（assets/game-start/开局页-定稿.html）')
assert old_head in s, '未找到原头部注释'
s = s.replace(old_head, new_head, 1)

# ── ③ 顶部说明区插入「已验收定稿」块（插在原第 13 轮 ok 块之前）──────────────
anchor = '      <div class="ok"><b>本轮修订（第 13 轮 · 定稿微调）：</b>'
assert anchor in s, '未找到第 13 轮说明块锚点'
final_block = (
    '      <div class="ok" style="border-color:rgba(246,196,69,.62);background:rgba(246,196,69,.07)">'
    '<b>✅ 已验收定稿（第 14 轮 · 2026-10-05）：</b>'
    '本页经用户拍板验收，正式纳入资产库 —— <code>assets/game-start/开局页-定稿.html</code>。'
    '定稿口径：方案 <b>B「追尾」</b> · 音效 <b>#3（サイコロを振る・二個）</b> · 掷骰点数<b>真随机</b> · '
    '赠礼表 <b>第 13 轮微调版</b> · <b>本局限定护栏</b>（道具与复活机会未用即作废）。'
    '配套音效已全量入库 <code>assets/game-start/audio/</code>（选定 1 + 未选中候选 7）。'
    '验收板：<code>13-点数与赠礼.png</code> / <code>14-音画对齐.png</code> / <code>15-映射表定稿与本局护栏.png</code>。</div>\n'
)
s = s.replace(anchor, final_block + anchor, 1)

# ── 路径重写（先抠 base64 块）──────────────────────────────────────────────
keep = []
def stash(m):
    keep.append(m.group(0))
    return '\x00D%d\x00' % (len(keep) - 1)
s2 = re.sub(r'src="data:[^"]+"', stash, s)

before = s2.count('assets/')
s2 = s2.replace('assets/_src/game-start/', '../_src/game-start/')
s2 = s2.replace('assets/game-start/', './')
s2 = re.sub(r'\x00D(\d+)\x00', lambda m: keep[int(m.group(1))], s2)

io.open(DST, 'w', encoding='utf-8').write(s2)

leftover = re.findall(r'src="assets/[^"]*"', s2)
print('工作稿 %d B → 定稿版 %d B' % (orig_len, len(s2.encode())))
print('路径重写：assets/ 出现 %d 次 → 残留 src="assets/..." %d 处' % (before, len(leftover)))
print('base64 数据块：保护 %d 个（已原样还原）' % len(keep))
print('产出：%s' % os.path.relpath(DST, ROOT))
for tag, ok in [('title 已改定稿', '开局页定稿' in s2),
                ('头部 v3 已改', '开局页 · 定稿  v3' in s2),
                ('验收块已插', '已验收定稿（第 14 轮' in s2),
                ('默认方案 B', "curScheme = 'B'" in s2),
                ('音效内嵌', 'data:audio/mpeg;base64' in s2)]:
    print('  %s : %s' % (tag, 'OK' if ok else '⚠ 失败'))
if leftover:
    raise SystemExit('⚠ 仍有残留引用：%s' % leftover[:3])
