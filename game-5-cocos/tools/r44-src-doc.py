#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r44-src-doc.py · 生成《素材溯源清单.md》
================================================================
全部条目从 manifest.json 读，**不手写**；四个曲库的授权原文要点单独维护在本文件
的 LICENSES 里（本轮抓规矩页时的原文摘录，附页面 URL 供复核）。

用法: python3 tools/r44-src-doc.py <manifest.json> <out.md>
"""
import json
import sys

# ---------------- 四个曲库的授权原文要点（本轮抓「规矩页」摘录，非法律意见） ----------------
LICENSES = {
    'peritune.com': dict(
        name='PeriTune（ペリチューン）', page='https://peritune.com/about/',
        rows=[('利用報告', '不要'),
              ('商用利用', '可能 ——「映像、動画、イベント、広告、ゲーム、ライブ配信、VRChat、アプリ等、媒体を問わず」'),
              ('加工・改変', '自由（テンポ/エフェクト/ループ処理/歌唱など）'),
              ('クレジット表記', '任意 ——「可能な範囲で『PeriTune』と記載していただければ幸いですが、強制ではありません」'),
              ('著作権表示', '放棄していない（曲の著作権は制作者に帰属）')],
        ban=['YouTube Content ID への登録は固く禁止',
             '楽曲単体の転売・再配布は禁止',
             '「楽曲紹介」目的のまとめ動画（フル視聴・メドレー形式）への利用は禁止',
             '生成AIに学習させる目的の使用は禁止'],
        lic='適用ライセンス（2026年3月変更）：2026年3月以降公開の楽曲は当サイト独自規約。'
            '2026年2月以前公開分は「CC BY 4.0」が継続適用。',
        warn='★ 唯一需要留意的条款：ゲーム/アプリへの同梱（= ファイルをゲームパッケージに含める二次配布）は、'
             '「無償（非営利目的）の場合に限り」例外として許可されています。'
             '将来このゲームを有料配信するなら、PeriTune 由来の BGM（pt-taohua / pt-laidback3 等）は'
             '差し替えるか、同梱せずストリーミング取得に切り替える必要があります。'),
    'maou.audio': dict(
        name='魔王魂', page='https://maou.audio/rule/',
        rows=[('利用報告', '「報告一切不要」'),
              ('商用利用', '可 ——「個人利用も商用も無料で利用可能」／「あらゆるジャンルのコンテンツで利用できます」'),
              ('加工・改変', 'OK ——「改造OK！タイトルや歌詞変更もOK！」'),
              ('クレジット表記', '推奨（必須ではない）——「可能な限り『音楽：魔王魂』みたいに著作表記して下さい」'),
              ('使用料', '「JASRACや著作管理団体から料金を請求されることはありません」')],
        ban=['著作を偽る行為（「この曲はワシが作った」等）',
             '曲単品の再配布は NG',
             '生成AIに魔王魂の音楽を学習させる行為はいかなる場合でも違反'],
        lic='CC ライセンスで利用するか、魔王魂素材利用規約を守るかの、いずれかを選択できる方式。',
        warn=''),
    'amachamusic.chagasi.com': dict(
        name='甘茶の音楽工房（Music Atelier Amacha）', page='https://amachamusic.chagasi.com/terms.html',
        rows=[('利用報告', '不要（規約に報告義務の記載なし）'),
              ('商用利用', '可 ——「公開中の音楽素材は、商用利用、個人利用問わず利用できます」'),
              ('加工・改変', '可（BGM としての利用を想定）'),
              ('クレジット表記', '必須ではない ——「ご都合のよい箇所にリンクorクレジットしていただけると嬉しいです」'
                             '／表記はサイト名・作曲者名・URL のいずれか一つで OK')],
        ban=['音楽だけを販売する／二次配布する（お店の BGM としての使用は二次配布と見なさない）',
             '作曲者を偽る行為（自分で作った曲のように見せる）'],
        lic='楽曲の著作権は放棄されておらず、作曲者「甘茶」に帰属。',
        warn=''),
    'soundeffect-lab.info': dict(
        name='効果音ラボ', page='https://soundeffect-lab.info/agreement/',
        rows=[('利用報告', '不要'),
              ('商用利用', '無料 ——「個人、法人、公的機関問わず無料で使用可能（商用利用無料）」'),
              ('クレジット表記', '不要 ——「クレジット表記・リンク不要」'),
              ('加工・改変', 'OK（ただし改変物の再配布は禁止）')],
        ban=['再配布禁止（効果音が重要な役割を果たすコンテンツも再配布に該当）',
             '効果音ファイルへの直リンク禁止',
             'AI学習用データとしての利用禁止',
             'アダルト／公序良俗に反する作品／違法行為への利用禁止',
             '声素材について声優の尊厳を傷つける使い方'],
        lic='「ダウンロードした時点で下記規約に同意したものとみなします」方式。規約は予告なく変更される場合あり。',
        warn=''),
}

CAT_CN = {'bgm': 'BGM', 'tile': '落槽（麻将入槽）', 'win': '胜利提示音', 'lose': '失败提示音'}

# 汇总表的两个短字段（★ 不要从 rows 里字符串切片拼 —— 会切出一整句日文）
SHORT = {
    'peritune.com': ('可能', '任意'),
    'maou.audio': ('可（免费）', '推奨（非必须）'),
    'amachamusic.chagasi.com': ('可（免费）', '非必须'),
    'soundeffect-lab.info': ('免费', '不要'),
}


def main():
    man_p, out_p = sys.argv[1], sys.argv[2]
    man = json.load(open(man_p, encoding='utf-8'))
    bgm, sfx = man['bgm'], man['sfx']

    # 来源分组统计
    from collections import Counter
    c = Counter(r['src'] for r in bgm + sfx)

    L = []
    A = L.append
    A('# 第 44 轮 · 素材溯源清单（BGM 14 条 + 音效 34 条）\n')
    A('> 用途：微信小游戏《麻麻大消除》的 BGM 与三类音效候选。')
    A('> 本轮用户已明确「不必在乎是否商用免费」，因此本清单**不是**选材门槛，')
    A('> 而是入库前逐个复核用的登记表。\n')
    A(f'> 生成来源：`manifest.json`（第 44 轮量测脚本产物）+ 四个曲库「规矩页」原文摘录。')
    A(f'> 试听件目录：`docs-verify/game-5/audio/round44/`（BGM 14 条 + 音效 34 条，均已峰值归一化）。\n')

    A('## 一 · 来源分布\n')
    A('| 曲库 | 域 | 条数 | 商用 | 署名 | 关键限制 |')
    A('|---|---|---|---|---|---|')
    for dom, n in c.most_common():
        lic = LICENSES.get(dom)
        if not lic:
            A(f'| {dom} | `{dom}` | {n} | 待复核 | 待复核 | — |')
            continue
        kw = '、'.join(x.split('（')[0].split('：')[0].strip() for x in lic['ban'][:2])
        sm, cr = SHORT.get(dom, ('待复核', '待复核'))
        A(f"| {lic['name'].split('（')[0]} | `{dom}` | {n} | {sm} | {cr} | {kw} |")
    A('')

    A('## 二 · 授权原文要点（逐库）\n')
    for dom in c:
        lic = LICENSES.get(dom)
        if not lic:
            continue
        A(f"### {lic['name']}\n")
        A(f"规矩页：<{lic['page']}>\n")
        A('| 项 | 原文要点 |')
        A('|---|---|')
        for k, v in lic['rows']:
            A(f'| {k} | {v} |')
        A('')
        A('**禁止事项**')
        for b in lic['ban']:
            A(f'- {b}')
        A('')
        if lic.get('lic'):
            A(f'**许可模式**：{lic["lic"]}\n')
        if lic.get('warn'):
            A(f'**⚠️ 需注意**：{lic["warn"]}\n')

    A('## 三 · BGM 14 条\n')
    A('| # | id | 标题 | 来源 | 官方标签/描述（原文） | 官方页面 | 直链 | 原版循环 |')
    A('|---|---|---|---|---|---|---|---|')
    for i, r in enumerate(sorted(bgm, key=lambda x: x['id']), 1):
        A(f"| {i} | `{r['id']}` | {r['title']} | `{r['src']}` | {r.get('official','')} | "
          f"<{r['page']}> | <{r['file']}> | {('<'+r['loop']+'>') if r.get('loop') else '—'} |")
    A('')

    A('## 四 · 音效 34 条（全部来自効果音ラボ）\n')
    order = {'tile': 0, 'win': 1, 'lose': 2}
    A('| # | id | 定位 | 标题（日文原名） | 官方用途原文 | 页面 | 直链 |')
    A('|---|---|---|---|---|---|---|')
    for i, r in enumerate(sorted(sfx, key=lambda x: (order.get(x.get('cat'), 9), x['id'])), 1):
        A(f"| {i} | `{r['id']}` | {CAT_CN.get(r.get('cat'), r.get('cat'))} | {r['title']} | "
          f"{r.get('official','')} | <{r['page']}> | <{r['file']}> |")
    A('')

    A('## 五 · 一键重取\n')
    A('> 下面每条都是**实际跑过的签名**（不是凭印象写的）。工作目录 = `game-5-cocos/`。\n')
    A('```bash')
    A('# 1) 抓取（BGM 14 条 + 音效 34 条；音效必须带 UA + Referer，且 Referer 要指向「页面」而不是 mp3 目录）')
    A('HTTPS_PROXY=http://127.0.0.1:7890 python3 tools/r44-fetch.py /tmp/r44')
    A('#    → /tmp/r44/raw/{id}.mp3（48 条）+ /tmp/r44/catalog.json')
    A('')
    A('# 2) 量测（BGM 复用上一轮已验过的分析器；音效是本轮新写的）')
    A('#    注：r43 那个分析器会把 catalog 里的条目**全量**量一遍（实测 48 条全过），')
    A('#        音效再由 r44-sfx-analyze.py 单独量一次更细的「起音 / 碰撞次数 / 首响占比」。')
    A('python3 tools/r43-bgm-analyze.py /tmp/r44/raw /tmp/r44/bgm-out /tmp/r44/catalog.json')
    A('python3 tools/r44-sfx-analyze.py /tmp/r44/raw /tmp/r44/catalog.json /tmp/r44/sfx-out')
    A('')
    A('# 3) 试听件（峰值归一化到 −1 dBFS，只作用于副本；首推=全曲 / 备选=中段 40s）')
    A('python3 tools/r44-make-audition.py /tmp/r44/catalog.json \\')
    A('    /tmp/r44/bgm-out/analysis.json /tmp/r44/sfx-out/analysis.json \\')
    A('    ../docs-verify/game-5/audio/round44 /tmp/r44/raw')
    A('')
    A('# 4) 波形图 —— ★ 必须按 1500×100（=15:1）渲染，与页面 .wave 的 aspect-ratio 一致，')
    A('#    否则图会被 CSS 横向拉伸（第一版就是 900×150 被塞进 819×54，拉伸 2.53 倍）')
    A('python3 tools/r44-wave-redraw.py ../docs-verify/game-5/audio/round44/manifest.json \\')
    A('    /tmp/r44/catalog.json ../docs-verify/game-5/audio/round44')
    A('')
    A('# 5) 拍板板（内含两项自检：星号=0 / 引用文件都存在）')
    A('python3 tools/r44-board-build.py ../docs-verify/game-5/audio/round44/manifest.json \\')
    A('    ../docs-verify/game-5/audio/round44/bgm与音效-试听拍板板.html')
    A('')
    A('# 6) 版面自检（分段截图；查坏图/图变形/横向溢出/波形被裁）+ 真实鼠标点击验证')
    A('node tools/r42-board-shot.mjs "$PWD/../docs-verify/game-5/audio/round44/bgm与音效-试听拍板板.html" /tmp/r44-board 1660')
    A('node tools/r44-board-click.mjs "$PWD/../docs-verify/game-5/audio/round44/bgm与音效-试听拍板板.html"')
    A('```\n')
    A('> ⚠️ 本清单是**登记用摘要，不是法律意见**；四个曲库的规约都可能变更，入库前请打开上表「规矩页」复核一次。')
    A('> 试听件（.m4a）是为本轮拍板做的 AAC 转码副本，**不等于**最终入库格式。')

    open(out_p, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    n_bad = sum(1 for r in bgm + sfx if not r.get('page') or not r.get('file'))
    print(f'  已生成 {out_p}（{len(bgm)} BGM + {len(sfx)} 音效）')
    print(f'  缺页面/直链的条目（应为 0）：{n_bad}')
    assert n_bad == 0


if __name__ == '__main__':
    main()
