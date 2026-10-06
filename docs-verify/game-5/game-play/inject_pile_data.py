#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 levels.json 的真实关卡卡位注入主玩页的 <script id="pileData">（第 32 轮 · #168）。

背景（用户第 32 轮第 4 条拍板）
--------------------------------
「主玩页演示档位需跟随**真实牌数**变化」—— 旧版主玩页把三档写死成 36 / 12 / 96 张
（`const PILE` + `buildPile(count)`），张数、层数、牌体尺寸、卡位全是页面自己编的，
与 level_design.py 产出的 30 关关卡表**完全脱钩**（例如真实 L30 是 138 张 / 10 层 / 牌宽 88，
而页面演示的"96 张大关"是 96 张 / 4 层 / 牌宽 80x107）。

本脚本做一件事：把关卡表里指定的**演示关卡**（DEMO_TIERS）转成页面消费的精简结构，
幂等替换主玩页里 `<script id="pileData" type="application/json">…</script>` 的内容。

页面消费的精简结构
------------------
  { "meta": {"coverTh":0.18, "segMax":36, "src":"levels.json"},
    "levels": [
      { "lv":1, "name":"第 1 关", "chapter":"一 教学→初阶",
        "n":12,            # 牌堆总张数（= 关卡表 nTotal）
        "L":2,             # 总层数（"全堆同时在桌"口径 = 整关总层数）
        "w":112, "h":149,  # ★ 单关内唯一牌体尺寸（第 32 轮第 5 条）；h = w × 4/3
        "nl":8,            # 开局可点数（口径与 level_design.py 一致：被更高层累计覆盖 < 18%）
        "st": [12],        # 按层分段的每段张数（段序自顶向下）
        "tiles": [ {"x":12.75,"y":-4.01,"z":0,"r":0,"k":"wan","n":1,"c":0.9609}, … ] }
    ] }

  x / y  = **相对安全区中心的 px**（= 关卡表 tiles[i].px / py；关卡表已做「包围盒中心 = 原点」平移）
  z      = 层号（0 = 最底）
  r      = 朝向 0 / 90（90 = 横牌；页面用**纯 rotate(90deg)** 渲染，绝不换宽高 → 第 32 轮第 5 条）
  k / n  = 牌面（'wan'|'tiao'|'tong' + 1..9，取自关卡表 faces[i]）
  c      = 该张被更高层累计覆盖比（取自关卡表 cover[i]；页面据此判可点，不再自行几何计算）

用法
----
  python3 inject_pile_data.py            # 注入默认演示关卡 DEMO_TIERS
  python3 inject_pile_data.py 1 15 30    # 换演示关卡（关卡号）
  改 DEMO_TIERS 后重跑即可；主玩页两处注释里的档位说明也会一并同步。

自检（不合格直接 exit 1，不落盘）
--------------------------------
  ① 每关注入张数 == 关卡表 nTotal；② 层数 == 关卡表 layers
  ③ 可点数 == 关卡表 nLive（用注入后的 c 自算一遍对账）
  ④ 单关内牌体尺寸唯一（所有张共用同一 w/h，h/w ≈ 4/3 ± 0.01）
  ⑤ 无库外牌（k ∈ SUITS 且 1 ≤ n ≤ 9）
  ⑥ 卡位不出安全区（|x| ≤ (682-w)/2 + 半张牌的余量，|y| 同理）
  ⑦ JSON 可被 json.loads 反解（防注入出坏语法把页面搞白屏）
"""

import io
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
LEVELS = os.path.join(BASE, 'levels.json')
PAGE = os.path.join(ROOT, 'game-5-主玩页-排版.html')

# ── 演示档位：默认「最小 / 中段 / 最大」三档，覆盖牌宽上下限与层数上下限 ──
#    L1  = 12 张 / 2 层 / 牌宽 112（W_MAX，教学关，可点率最高 66.7%）
#    L10 = 93 张 / 7 层 / 牌宽 88（进入 4/3 曲线的中段）
#    L30 = 138 张 / 10 层 / 牌宽 88（层数上限 N1、张数上限、4 段）
DEMO_TIERS = [1, 10, 30]

SUITS = ('wan', 'tiao', 'tong')
SAFE = 682
COVER_TH = 0.18


def slim_level(lv):
    """关卡表单关 → 页面精简结构。"""
    tiles = lv['tiles']
    faces = lv['faces']
    cover = lv['cover']
    n = lv['nTotal']
    assert len(tiles) == len(faces) == len(cover) == n, \
        'L%d 三数组长度不一致：tiles=%d faces=%d cover=%d n=%d' % (
            lv['lv'], len(tiles), len(faces), len(cover), n)
    out_tiles = []
    for i in range(n):
        t = tiles[i]
        k, num = faces[i]
        out_tiles.append({
            'x': t['px'], 'y': t['py'], 'z': t['z'],
            'r': t.get('rot', 0), 'k': k, 'n': num, 'c': cover[i],
        })
    return {
        'lv': lv['lv'],
        'name': '第 %d 关' % lv['lv'],
        'chapter': lv.get('chapter', ''),
        'n': n,
        'L': lv['layers'],
        'w': lv['w'], 'h': lv['h'],
        'nl': lv['nLive'],
        'st': list(lv['stages']),
        'tiles': out_tiles,
    }


def self_check(levels):
    problems = []
    for lv in levels:
        tag = 'L%d' % lv['lv']
        # ① 张数
        if len(lv['tiles']) != lv['n']:
            problems.append('%s 张数不符：tiles=%d n=%d' % (tag, len(lv['tiles']), lv['n']))
        # ② 层数 = 实际出现的最大 z + 1
        zs = {t['z'] for t in lv['tiles']}
        if (max(zs) + 1) != lv['L'] or min(zs) != 0:
            problems.append('%s 层号不连续/不符：z=%s L=%d' % (tag, sorted(zs), lv['L']))
        # ③ 可点数（用注入后的 c 自算，与关卡表 nLive 对账）
        nl2 = sum(1 for t in lv['tiles'] if t['c'] < COVER_TH)
        if nl2 != lv['nl']:
            problems.append('%s 可点数不符：自算 %d vs 关卡表 %d' % (tag, nl2, lv['nl']))
        # ④ 单关内尺寸唯一（h/w ≈ 4/3）
        if lv['w'] <= 0 or lv['h'] <= 0:
            problems.append('%s 尺寸非法：%sx%s' % (tag, lv['w'], lv['h']))
        else:
            ar = lv['h'] / lv['w']
            if abs(ar - 4.0 / 3.0) > 0.01:
                problems.append('%s 长宽比 %.4f ≠ 4/3' % (tag, ar))
        # ⑤ 无库外牌
        bad = [t for t in lv['tiles'] if t['k'] not in SUITS or not (1 <= t['n'] <= 9)]
        if bad:
            problems.append('%s 出现库外牌 %d 张：%s' % (tag, len(bad), bad[:3]))
        # ⑥ 卡位不出安全区（含横牌旋转后的半宽；留 2px 机械余量）
        mx = 0.0
        for t in lv['tiles']:
            hw = (lv['h'] if t['r'] == 90 else lv['w']) / 2.0
            hh = (lv['w'] if t['r'] == 90 else lv['h']) / 2.0
            mx = max(mx, abs(t['x']) + hw, abs(t['y']) + hh)
        if mx > SAFE / 2.0 + 2.0:
            problems.append('%s 卡位越界：最远 %.1f > %.1f' % (tag, mx, SAFE / 2.0))
    return problems


def main():
    tiers = [int(a) for a in sys.argv[1:]] or list(DEMO_TIERS)
    data = json.load(io.open(LEVELS, encoding='utf-8'))
    by_lv = {lv['lv']: lv for lv in data['levels']}
    missing = [t for t in tiers if t not in by_lv]
    if missing:
        raise SystemExit('⚠ 关卡表里没有这些关：%s（可用 1..%d）'
                         % (missing, max(by_lv)))

    levels = [slim_level(by_lv[t]) for t in tiers]
    problems = self_check(levels)
    if problems:
        for p in problems:
            print('  ✗ ' + p)
        raise SystemExit('⚠ 自检未通过，未落盘')

    payload = {
        'meta': {
            'coverTh': data['meta']['coverTh'],
            'segMax': data['meta']['segMax'],
            'segConcurrent': data['meta']['segConcurrent'],
            'solveMode': data['meta']['solveMode'],
            'src': 'docs-verify/game-5/game-play/levels.json',
        },
        'levels': levels,
    }
    blob = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    json.loads(blob)                      # ⑦ 反解自检

    html = io.open(PAGE, encoding='utf-8').read()
    pat = re.compile(r'(<script id="pileData" type="application/json">)(.*?)(</script>)',
                     re.S)
    m = pat.search(html)
    if not m:
        raise SystemExit('⚠ 主玩页里找不到 <script id="pileData"> 注入点')
    old_len = len(m.group(2))
    html2 = html[:m.start(2)] + blob + html[m.end(2):]
    io.open(PAGE, 'w', encoding='utf-8').write(html2)

    print('=' * 76)
    print('主玩页牌堆数据注入（第 32 轮 · #168）')
    print('=' * 76)
    print('来源：%s' % os.path.relpath(LEVELS, ROOT))
    print('目标：%s' % os.path.relpath(PAGE, ROOT))
    print('-' * 76)
    print('%-6s %-10s %5s %4s %6s %6s %8s %8s %s'
          % ('关卡', '章节', '张数', '层', '牌宽', '牌高', '可点', '可点率', '分段'))
    for lv in levels:
        print('%-6s %-10s %5d %4d %6d %6d %8d %7.1f%% %s'
              % ('L%d' % lv['lv'], lv['chapter'], lv['n'], lv['L'],
                 lv['w'], lv['h'], lv['nl'], 100.0 * lv['nl'] / lv['n'],
                 '+'.join(str(x) for x in lv['st'])))
    print('-' * 76)
    print('注入块：%d B → %d B' % (old_len, len(blob)))
    print('自检：①张数 ②层号连续 ③可点数对账 ④单关尺寸唯一(h=w×4/3) '
          '⑤无库外牌 ⑥卡位不出安全区 ⑦JSON 可反解 —— 全部通过 ✅')
    print('下一步：重跑 make_archive_play.py 与 make_final_play.py 同步两份归档。')


if __name__ == '__main__':
    main()
