#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync-core.py · 把 game-5-cocos 的核心逻辑文件平铺到 tools/_core/，供 Node 直跑自检。

【为什么要平铺 + 改写 import】
  Node 22 的 `--experimental-strip-types` **不做无扩展名解析**，而工程源码里的
  `from '../CFG'` 是无扩展名的（Cocos 的模块解析器才认）。
  平铺到同一层并把路径改写成 `./CFG.ts` 是最省事、最不容易失配的做法。
  （技能里的教训：手工字符串替换会在"源码多 import 一个符号"时**静默失配**，
   所以本脚本用**正则扫全部 import** 再统一改写，加符号不用改脚本。）

用法：python3 tools/sync-core.py
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC = os.path.join(PROJ, 'assets', 'scripts')
DST = os.path.join(HERE, '_core')

FILES = [
    ('CFG.ts', os.path.join(SRC, 'CFG.ts')),
    ('LevelData.ts', os.path.join(SRC, 'core', 'LevelData.ts')),
    ('TileData.ts', os.path.join(SRC, 'core', 'TileData.ts')),
    ('MatchRule.ts', os.path.join(SRC, 'core', 'MatchRule.ts')),
    ('Board.ts', os.path.join(SRC, 'core', 'Board.ts')),
]

# from '...' / import '...' → 统一压平成 './<名字>.ts'
IMP = re.compile(r"""(from\s+|import\s+)(['"])([^'"]+)\2""")


def rewrite(src: str) -> str:
    def sub(m):
        head, q, path = m.group(1), m.group(2), m.group(3)
        name = path.split('/')[-1]
        return '%s%s./%s.ts%s' % (head, q, name, q)
    return IMP.sub(sub, src)


def main():
    os.makedirs(DST, exist_ok=True)
    for name, path in FILES:
        text = open(path, encoding='utf-8').read()
        out = rewrite(text)
        open(os.path.join(DST, name), 'w', encoding='utf-8').write(out)
        print('  · %s → tools/_core/%s' % (os.path.relpath(path, PROJ), name))
    print('✅ 核心文件已平铺到 tools/_core/（生成物，勿手工编辑；重建就重跑本脚本）')


if __name__ == '__main__':
    main()
