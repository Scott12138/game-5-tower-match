#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-level-data.py · 把权威关卡数据 levels.json 转成 Cocos 工程用的 TS 模块

【为什么走"数据内嵌"而不是"运行时生成"】
  `docs-verify/game-5/game-play/levels.json` 是经过 38/38 真事件验收、**满清可解 30/30 关** 的
  权威数据（每张牌的 x/y/z/rot + 牌面已由构造式剥离算法定死）。把它直接内嵌进工程：
    ① 运行时**零算法风险** —— 位置与发牌天然保证可解，不需要在 TS 里重写 859 行 Python；
    ② 内嵌成 TS 常量而不是 resources.load() —— 避开异步加载时序这一类静默失败（技能反复提到）。

【体积】原始 levels.json 258 KB，砍掉 uni.grid / variant / 中间诊断字段后约 70 KB。
  编码口径：x,y = wu 单位 ×1000 取整（精度 0.001 wu ≈ 0.1px）；z = 层号；rot → 0/1（0=竖 1=横）；
  faces = suit*10 + num（wan=0 / tiao=1 / tong=2）。

用法：python3 tools/gen-level-data.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SRC = os.path.join(PROJ, '..', 'docs-verify', 'game-5', 'game-play', 'levels.json')
OUT = os.path.join(PROJ, 'assets', 'scripts', 'core', 'LevelData.ts')

SUIT = {'wan': 0, 'tiao': 1, 'tong': 2}


def main():
    raw = json.load(open(SRC, encoding='utf-8'))
    meta = raw['meta']
    out_levels = []
    total_tiles = 0

    for L in raw['levels']:
        tiles = L['tiles']
        faces = L['faces']
        assert len(tiles) == len(faces) == L['nTotal'], \
            'L%d 张数不符：tiles=%d faces=%d nTotal=%d' % (L['lv'], len(tiles), len(faces), L['nTotal'])

        flat = []
        for t in tiles:
            assert t['rot'] in (0, 90), 'L%d 出现非法朝向 %s' % (L['lv'], t['rot'])
            flat.append(int(round(t['x'] * 1000)))
            flat.append(int(round(t['y'] * 1000)))
            flat.append(int(t['z']))
            flat.append(1 if t['rot'] == 90 else 0)

        fenc = []
        for s, n in faces:
            fenc.append(SUIT[s] * 10 + int(n))

        segs = [{'lo': s['lo'], 'hi': s['hi'], 'n': s['n']} for s in L['segs']]
        # ★ 第 46 轮：把生成器的**清序**（solveOrder）一并带进工程 —— 难度置换要用它。
        #  【为什么不能"运行时重算"】它在 Python 侧是 `greedy_peel(tiles, open_first, phases)`
        #    的结果，依赖分段的相位推进与 0.18 口径的可点判定。照着重写一遍就一定会有偏差：
        #    实测（未带 solveOrder 时）自己算的清序算出的"同组连续度"只有 23%，
        #    而真值应是 100% —— 名次错了，置换就是在空转（难度旋钮失效且不报错）。
        #    直接内嵌真值 ⇒ 零漂移风险。
        so = [int(i) for i in L['solveOrder']]
        assert sorted(so) == list(range(L['nTotal'])), \
            'L%d solveOrder 不是 0..n-1 的排列' % L['lv']
        # 交叉校验：生成器确实"每 3 张连续位填同一种牌面"（难度置换要打散的就是这个结构）
        fenc_pre = [SUIT[s] * 10 + int(n) for s, n in faces]
        intact = sum(1 for k in range(0, len(so), 3)
                     if fenc_pre[so[k]] == fenc_pre[so[k + 1]] == fenc_pre[so[k + 2]])
        assert intact == len(so) // 3, \
            'L%d 只有 %d/%d 组同面（期望全部同面）' % (L['lv'], intact, len(so) // 3)

        out_levels.append({
            'lv': L['lv'],
            'n': L['nTotal'],
            'layers': L['layers'],
            'w': L['w'],
            'h': L['h'],
            'segs': segs,
            't': flat,
            'f': fenc,
            'so': so,
        })
        total_tiles += L['nTotal']

    assert len(out_levels) == 30, '关卡数应为 30，实得 %d' % len(out_levels)
    assert total_tiles == 2877, '总张数应为 2877，实得 %d' % total_tiles

    sz = meta['safeZoneScreen']
    lines = []
    w = lines.append
    w('/* eslint-disable */')
    w('/**')
    w(' * LevelData.ts · 30 关关卡数据（**自动生成，请勿手工编辑**）')
    w(' *')
    w(' * 来源：docs-verify/game-5/game-play/levels.json（v7 口径 · 38/38 验收 · 满清可解 30/30）')
    w(' * 生成：python3 tools/gen-level-data.py')
    w(' *')
    w(' * 编码口径（为压体积，全部走整数扁平数组）：')
    w(' *   t: 每 4 个一组 = [x*wu*1000, y*wu*1000, 层号 z, rot 0=竖/1=横(90°)]')
    w(' *   f: 每张一个 = suit*10 + num（wan=0 / tiao=1 / tong=2）')
    w(' *   so: 清序（生成器 `greedy_peel` 的输出）—— 每 3 张连续位**同一种牌面**')
    w(' *   x,y 是 **wu 单位**（牌宽倍数，原点 = 安全区中心），乘 1000 取整，精度 0.001 wu')
    w(' */')
    w('')
    w('export interface LevelSeg {')
    w('    /** 该段最低层号（含） */')
    w('    lo: number;')
    w('    /** 该段最高层号（不含） —— 段序自顶向下 */')
    w('    hi: number;')
    w('    /** 段内张数（恒为 3 的倍数） */')
    w('    n: number;')
    w('}')
    w('')
    w('export interface LevelDef {')
    w('    /** 关卡号 1~30 */')
    w('    lv: number;')
    w('    /** 整关张数（3 的倍数） */')
    w('    n: number;')
    w('    /** 单堆层数 */')
    w('    layers: number;')
    w('    /** 单关唯一牌宽（设计 px @750） */')
    w('    w: number;')
    w('    /** 单关唯一牌高 = round(w * 4/3) */')
    w('    h: number;')
    w('    /** 分段（转场波次，自顶向下） */')
    w('    segs: LevelSeg[];')
    w('    /** 扁平牌位：[x1000, y1000, z, rot90] × n */')
    w('    t: number[];')
    w('    /** 扁平牌面：suit*10 + num × n */')
    w('    f: number[];')
    w('    /**')
    w('     * ★ 第 46 轮：**清序** —— 生成器 `greedy_peel()` 的输出，是 0..n-1 的一个排列。')
    w('     *')
    w('     * 【语义】`so[k]` = "顺手的打法"里第 k 个被消掉的牌下标。')
    w('     * 【不变量】每连续 3 位 `so[3k..3k+2]` 对应的牌面**必然相同**（生成器就这么填的）。')
    w('     * 【用途】**难度置换**（`core/Difficulty.ts`）按它给每张牌算名次：难度参数把名次')
    w('     *   切成连续块、只在块内洗牌面 ⇒ 打散"顺手就是一组"的结构。')
    w('     * ⚠️ 它**不是唯一解**，也不参与可点判定；只用来定位"哪三张是一组"。')
    w('     */')
    w('    so: number[];')
    w('}')
    w('')
    w('/** 本作固定数值（来自 levels.json 的 meta，工程侧照抄） */')
    w('export const LEVEL_META = {')
    w('    /** 设计分辨率 */')
    w('    designW: %d,' % meta['designRes'][0])
    w('    designH: %d,' % meta['designRes'][1])
    w('    /** 桌面内牌堆安全区（屏幕坐标，左上原点） */')
    w('    safeX: %d,' % sz['x'])
    w('    safeY: %d,' % sz['y'])
    w('    safeW: %d,' % sz['w'])
    w('    safeH: %d,' % sz['h'])
    w('    /** 每关牌宽的曲线帽区间 */')
    w('    wMin: %d,' % meta['wMin'])
    w('    wMax: %d,' % meta['wMax'])
    w('    /** 牌高/牌宽（严格 4/3） */')
    w('    tileAR: %s,' % repr(meta['tileAR']))
    w('    /** 判"被压"的累计覆盖阈值 */')
    w('    coverTh: %s,' % repr(meta['coverTh']))
    w('    /** 单阶段张数上限 */')
    w('    segMax: %d,' % meta['segMax'])
    w('} as const;')
    w('')
    w('/** 30 关（下标 0 = 第 1 关） */')
    w('export const LEVELS: LevelDef[] = [')
    for L in out_levels:
        segs = ', '.join('{ lo: %d, hi: %d, n: %d }' % (s['lo'], s['hi'], s['n']) for s in L['segs'])
        w('    { lv: %d, n: %d, layers: %d, w: %d, h: %d, segs: [%s],' % (
            L['lv'], L['n'], L['layers'], L['w'], L['h'], segs))
        w('      t: [%s],' % ','.join(str(v) for v in L['t']))
        w('      f: [%s],' % ','.join(str(v) for v in L['f']))
        w('      so: [%s] },' % ','.join(str(v) for v in L['so']))
    w('];')
    w('')
    w('/** 牌面编码 → 花色名（与 TileData 的 SUITS 对应） */')
    w('export const SUIT_BY_CODE = [\'wan\', \'tiao\', \'tong\'] as const;')
    w('')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
    size = os.path.getsize(OUT)
    print('✅ 已写出 %s' % OUT)
    print('   关卡 %d 关 · 总张数 %d · 体积 %.1f KB' % (len(out_levels), total_tiles, size / 1024.0))
    print('   首关 %d 张 / %d 层 / 牌位 %s' % (
        out_levels[0]['n'], out_levels[0]['layers'], out_levels[0]['t'][:4]))
    print('   末关 %d 张 / %d 层 / 段数 %d' % (
        out_levels[-1]['n'], out_levels[-1]['layers'], len(out_levels[-1]['segs'])))


if __name__ == '__main__':
    main()
