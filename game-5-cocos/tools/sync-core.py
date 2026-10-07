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
    # ★ 难度置换 —— Board.ts 现在 import 它（第 46 轮需求⑥），必须一起平铺
    ('Difficulty.ts', os.path.join(SRC, 'core', 'Difficulty.ts')),
    ('Board.ts', os.path.join(SRC, 'core', 'Board.ts')),
    # ★★ 第 53 轮：平台能力四件套也要平铺。
    #   理由：这四件的"真实分支"（有三条结局、会累积的监听器、一次性票据、云存储值格式）
    #   是**离线可确定性复现**的 —— 注入一个 fake `wx` 就能把真路跑一遍，
    #   而不用等"哪天有广告位 / 有真机"才验。见 `tools/_r53-core-check.mjs`。
    #   ⚠️ 这四件都**不 import 'cc'**（各自文件头写了这条纪律），所以能直接平铺。
    ('AdService.ts', os.path.join(SRC, 'core', 'AdService.ts')),
    ('ShareService.ts', os.path.join(SRC, 'core', 'ShareService.ts')),
    ('LoginService.ts', os.path.join(SRC, 'core', 'LoginService.ts')),
    ('RankService.ts', os.path.join(SRC, 'core', 'RankService.ts')),
    # ★ 第 56 轮：存档也要平铺 —— 每日配额（跨天清零 / 每键独立计数）与
    #   日期工具（`todayKey` / `dayDiff`）是**纯逻辑、可确定性复现**的，
    #   而它们正是"签到连着几天"和"A3 每种道具 2 次/日"的地基。
    #   ⚠️ 它同样**不 import 'cc'**（文件头写了这条纪律）。
    ('SaveService.ts', os.path.join(SRC, 'core', 'SaveService.ts')),
    # ★ 第 57 轮三：道具「两本账」也要平铺。
    #   理由同上：它的要害是**纯策略**（赠礼优先 / 扣空了怎么办 / 不得虚扣），
    #   而这正是"商城领的道具在关卡里恒为 0"那个 bug 的藏身处。
    #   `Gift.ts` 是它依赖的那本"本局限定"账，一并铺。
    #   ⚠️ 两者都**不 import 'cc'**。
    ('Gift.ts', os.path.join(SRC, 'core', 'Gift.ts')),
    ('ItemStock.ts', os.path.join(SRC, 'core', 'ItemStock.ts')),
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
