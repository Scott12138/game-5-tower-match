#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把主玩页工作稿同步为归档留痕版 assets/game-play/主玩页-排版.html。

归档留痕版规则：仅做路径重写 —— './assets/xxx' → '../xxx'
（定稿位于 assets/game-play/，相对根目录引用需降一级；assets/_src 同理）
★ 与定稿版的区别：留痕版保留「排版稿」标识，不插验收卡 —— 它记录的是**设计期**的排版状态。
★ 先把 data: 块抠出占位再替换（base64 字母表含 '/'，可能凑出 'assets/' 子串被误改）。
"""
import io, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
SRC  = os.path.join(ROOT, 'game-5-主玩页-排版.html')
DST  = os.path.join(ROOT, 'assets', 'game-play', '主玩页-排版.html')

s = io.open(SRC, encoding='utf-8').read()

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
print('原始 ./assets/ 出现 %d 次 → 归档后残留 assets/ 引用 %d 处' % (before, len(leftover)))
print('留痕版：%s（%d B）' % (os.path.relpath(DST, ROOT), len(s2.encode())))
print('data: 块：保护 %d 个（已原样还原）' % len(keep))
print('标识：保留「排版稿」 = %s' % ('排版稿' in s2))
if leftover:
    raise SystemExit('⚠ 仍有残留引用：%s' % leftover[:3])
