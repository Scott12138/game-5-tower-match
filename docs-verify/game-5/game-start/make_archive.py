#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把工作稿分镜页同步为归档版 assets/game-start/开局页-分镜.html。
归档版规则：assets/_src/game-start/ → ../_src/game-start/ ； assets/game-start/ → ./
★ 必须先把 <audio src="data:..."> 的 base64 数据块抠出来占位再替换 ——
  因为 base64 字母表含 '/'，理论上可能凑出 "assets/" 子串而被误改（实测风险低，但要杜绝）。
"""
import io, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC = os.path.join(ROOT, 'game-5-开局页-分镜.html')
DST = os.path.join(ROOT, 'assets', 'game-start', '开局页-分镜.html')

s = io.open(SRC, encoding='utf-8').read()

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

# 复验：不该再有任何 src="assets/... 的引用
leftover = re.findall(r'src="assets/[^"]*"', s2)
print('原始 assets/ 出现 %d 次 → 归档后残留 src="assets/..." %d 处' % (before, len(leftover)))
print('归档版：%s（%d B）' % (os.path.relpath(DST, ROOT), len(s2.encode())))
print('base64 数据块：保护 %d 个（已原样还原）' % len(keep))
if leftover:
    raise SystemExit('⚠ 仍有残留引用：%s' % leftover[:3])
