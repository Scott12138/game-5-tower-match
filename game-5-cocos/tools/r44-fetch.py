#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r44-fetch.py · 第 44 轮：BGM + 三类音效候选抓取
============================================================
【口径】
- 所有元信息（曲名/风格标签/授权）**逐字来自下载页原文**，不自行发挥。
- 每条都记 page（页面）与 file（直链），保证可一键重取。
- 下载走环境变量代理；失败重试 4 次（本机大文件偶发 Recv failure）。
- 任一必需文件缺失 ⇒ 报错退出，**不静默跳过**（否则会把"没下到"当成"没有"）。

【用法】
  python3 tools/r44-fetch.py <outdir> [--only bgm|sfx]
============================================================
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0 Safari/537.36')

PERI = 'https://peritune.com'
MAOU = 'https://maou.audio'
AMAC = 'https://amachamusic.chagasi.com'

# ============================================================
#  一、BGM 候选
#     kind='bgm'；official = 下载页原文标题/标签（日文原文保留，便于核对）
# ============================================================
BGM = {
    # ---- PeriTune（CC BY 4.0 旧曲 + 站方额外允许署名可选）----
    'pt-taohua': dict(
        title='Taohua / 桃花', artist='PeriTune', src='peritune.com',
        page=f'{PERI}/taohua/',
        official='【無料フリーBGM】中華風の穏やかなBGM「Taohua」',
        tags='中華・アジア / ほのぼの / 癒し / 優しい / 日常 / 民族音楽 / きれい',
        file=f'{PERI}/music/PerituneMaterial_Taohua.mp3',
        loop=f'{PERI}/loop/PerituneMaterial_Taohua_loop.zip'),
    'pt-laidback3': dict(
        title='Laid_Back3', artist='PeriTune', src='peritune.com',
        page=f'{PERI}/laid_back3/',
        official='【無料フリーBGM】ほのぼの楽しい日常曲「Laid_Back3」',
        tags='かわいい / ほのぼの / ポップ / メルヘン / 楽しい / 日常 / 優しい',
        file=f'{PERI}/music/PerituneMaterial_Laid_Back3.mp3',
        loop=f'{PERI}/loop/PerituneMaterial_Laid_Back3_Retro_loop.zip'),
    'pt-ohayashi2': dict(
        title='Ohayashi2 / お囃子', artist='PeriTune', src='peritune.com',
        page=f'{PERI}/ohayashi2/',
        official='【無料フリーBGM】賑やかなお囃子「Ohayashi2」',
        tags='和風 / 民族音楽 / フォーク / ほのぼの',
        file=f'{PERI}/music/PerituneMaterial_Ohayashi2A.mp3',
        loop=f'{PERI}/loop/PerituneMaterial_Ohayashi2A_loop.zip'),
    'pt-harvest': dict(
        title='Harvest_Festival', artist='PeriTune', src='peritune.com',
        page=f'{PERI}/harvest_festival/',
        official='【無料フリーBGM】軽快な中世の町BGM「Harvest_Festival」',
        tags='フォーク / 楽しい / 爽やか / 日常 / powerful / gorgeous',
        file=f'{PERI}/music/PerituneMaterial_Harvest_Festival.mp3',
        loop=f'{PERI}/loop/PerituneMaterial_Harvest_Festival_Brass_loop.zip'),

    # ---- 魔王魂（無料BGM、商用可；站方条款不强制署名）----
    'maou-ethnic27': dict(
        title='民族27（三味線・正月）', artist='魔王魂 / 森田交一', src='maou.audio',
        page=f'{MAOU}/bgm_ethnic27/',
        official='曲名「民族27」· 标签：三味線 / 和風 / 正月 / アニメ / ゲーム',
        tags='三味線 / 和風 / 正月',
        file=f'{MAOU}/sound/bgm/maou_bgm_ethnic27.mp3',
        loop=f'{MAOU}/sound/bgm/maou_loop_bgm_ethnic27.mp3'),
    'maou-ethnic32': dict(
        title='民族32（和風・正月）', artist='魔王魂 / 森田交一', src='maou.audio',
        page=f'{MAOU}/bgm_ethnic32/',
        official='曲名「民族32」· 标签：和風 / 正月 / アニメ / ゲーム',
        tags='和風 / 正月',
        file=f'{MAOU}/sound/bgm/maou_bgm_ethnic32.mp3',
        loop=f'{MAOU}/sound/bgm/maou_loop_bgm_ethnic32.mp3'),
    'maou-ethnic09': dict(
        title='民族09（お祭り）', artist='魔王魂 / 森田交一', src='maou.audio',
        page=f'{MAOU}/bgm_ethnic09/',
        official='曲名「民族09」· 标签：お祭り / 和風 / アニメ / ゲーム',
        tags='お祭り / 和風',
        file=f'{MAOU}/sound/bgm/maou_bgm_ethnic09.mp3',
        loop=f'{MAOU}/sound/bgm/maou_loop_bgm_ethnic09.mp3'),
    'maou-ethnic09b': dict(
        title='民族09b（お祭り・別アレンジ）', artist='魔王魂 / 森田交一', src='maou.audio',
        page=f'{MAOU}/bgm_ethnic09b/',
        official='曲名「民族09b」· 标签：お祭り / 和風 / アニメ / ゲーム',
        tags='お祭り / 和風',
        file=f'{MAOU}/sound/bgm/maou_bgm_ethnic09b.mp3',
        loop=f'{MAOU}/sound/bgm/maou_loop_bgm_ethnic09b.mp3'),
    'maou-fantasy02': dict(
        title='ファンタジー02（中華・龍）', artist='魔王魂 / 森田交一', src='maou.audio',
        page=f'{MAOU}/bgm_fantasy02/',
        official='曲名「ファンタジー02」· 标签：中華 / 龍 / 変拍子 / rpg',
        tags='中華 / 龍 / 変拍子',
        file=f'{MAOU}/sound/bgm/maou_bgm_fantasy02.mp3',
        loop=f'{MAOU}/sound/bgm/maou_loop_bgm_fantasy02.mp3'),

    # ---- 甘茶の音楽工房（和風・アジア 分类）----
    'am-yuruyaka': dict(
        title='ゆるやかな風', artist='甘茶の音楽工房', src='amachamusic.chagasi.com',
        page=f'{AMAC}/music_yuruyakanakaze.html',
        official='分类「和風・アジア」· 曲名「ゆるやかな風」',
        tags='和風・アジア',
        file=f'{AMAC}/mp3/yuruyakanakaze.mp3'),
    'am-heiannoyoi': dict(
        title='平安の宵', artist='甘茶の音楽工房', src='amachamusic.chagasi.com',
        page=f'{AMAC}/music_heiannoyoi.html',
        official='分类「和風・アジア」· 曲名「平安の宵」',
        tags='和風・アジア',
        file=f'{AMAC}/mp3/heiannoyoi.mp3'),
    'am-uchiage': dict(
        title='打ち上げ花火', artist='甘茶の音楽工房', src='amachamusic.chagasi.com',
        page=f'{AMAC}/music_uchiagehanabi.html',
        official='分类「和風・アジア」· 曲名「打ち上げ花火」',
        tags='和風・アジア',
        file=f'{AMAC}/mp3/uchiagehanabi.mp3'),
    'am-gamelan': dict(
        title='伽藍帰香', artist='甘茶の音楽工房', src='amachamusic.chagasi.com',
        page=f'{AMAC}/music_gamelankikou.html',
        official='分类「和風・アジア」· 曲名「伽藍帰香」',
        tags='和風・アジア',
        file=f'{AMAC}/mp3/gamelankikou.mp3'),
    'am-ouun': dict(
        title='凰雲', artist='甘茶の音楽工房', src='amachamusic.chagasi.com',
        page=f'{AMAC}/music_ouun.html',
        official='分类「和風・アジア」· 曲名「凰雲」',
        tags='和風・アジア',
        file=f'{AMAC}/mp3/ouun.mp3'),
}

# ============================================================
#  二、音效候选
#     F = freesound 匿名预览件（-lq 低码率，仅用于候选筛选）
#     L = 効果音ラボ（免费商用·免署名）
# ============================================================
FS = 'https://cdn.freesound.org/previews'

# 索引：由 r44-freesound-search.py 落在 tools/_r44/fs-*.json
_INDEX = {}


def load_index():
    import glob
    for p in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    '_r44', 'fs-*.json')):
        for r in json.load(open(p)):
            import html as _h
            r['title'] = _h.unescape(r['title'])
            _INDEX[int(r['id'])] = r
    return _INDEX


def fs(sid, **kw):
    """按 sound id 取真实预览直链与页面（不自己拼 uid，避免拼错）。"""
    r = _INDEX.get(int(sid))
    if not r:
        raise KeyError(f'freesound id {sid} 不在索引里（先在 tools/_r44/ 里检索到它）')
    return dict(file=r['mp3'], page=r['page'], bytes_hint=r.get('bytes'),
                fs_dur=float(r['dur']), fs_dl=int(r['downloads']),
                fs_user=r.get('user', ''), **kw)


# ★ 必须在这里就把索引装好：下面 SFX 字典字面量里的 fs(...) 是**导入期求值**，
#   放到 main() 里再加载会直接 KeyError。
load_index()


SFX = {
    # ========================================================
    #  ① 麻将落槽 —— 全部来自「効果音ラボ」（免费商用·免署名），标题与用途说明逐字取自下载页；优先选「硬物相碰」的听感：麻将牌是硬塑料/亚克力，磕在木桌上应当是短、干、脆。
    # ========================================================
    'tile-peta1': dict(
        cat='tile', title='轻放拟音｜ペタッ', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ペタッ」— スタンプをつく時などに（anime 分类）',
        tags='把东西轻轻放下',
        note='全库唯一"刻意做轻"的一记：没有金属尾巴、没有环境声，正是"牌被按进槽里"该有的音量与长度',
        file='https://soundeffect-lab.info/sound/anime/mp3/peta1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'tile-pa1': dict(
        cat='tile', title='干脆一记｜パッ', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「パッ」— 可愛くメッセージ表示（anime 分类）',
        tags='可爱地弹出消息',
        note='极短、极干。落槽是高频动作，短音才不会把耳朵磨钝',
        file='https://soundeffect-lab.info/sound/anime/mp3/pa1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'tile-decision31': dict(
        cat='tile', title='カチッ（硬物扣合）｜決定ボタンを押す31', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「決定ボタンを押す31」— カチッ（button 分类）',
        tags='决定键·卡チッ',
        note='「カチッ」是硬质小物相碰的拟声，频谱集中在中高频，和麻将牌（硬塑料）磕桌的听感最接近',
        file='https://soundeffect-lab.info/sound/button/mp3/decision31.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    'tile-decision48': dict(
        cat='tile', title='キコッ｜決定ボタンを押す48', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「決定ボタンを押す48」— キコッ（button 分类）',
        tags='决定键·キコッ',
        note='同族里更"木"的一记，适合当作落槽的第 2 个随机变体',
        file='https://soundeffect-lab.info/sound/button/mp3/decision48.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    'tile-decision50': dict(
        cat='tile', title='カコッ｜決定ボタンを押す50', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「決定ボタンを押す50」— カコッ（button 分类）',
        tags='决定键·カコッ',
        note='同族里更"闷"的一记，适合当作第 3 个随机变体 —— 三记轮换就能消掉"每次落槽都一样"的机械感',
        file='https://soundeffect-lab.info/sound/button/mp3/decision50.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    'tile-dvd-case-close1': dict(
        cat='tile', title='硬塑料壳扣合｜ビデオディスクのケースを閉める', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ビデオディスクのケースを閉める」— パチッ（various 分类）',
        tags='光盘盒扣上·パチッ',
        note='麻将牌就是硬塑料/亚克力压制件，这条的材质与它同一类；官方拟声词「パチッ」也说明它是薄而脆的一扣',
        file='https://soundeffect-lab.info/sound/various/mp3/dvd-case-close1.mp3',
        page='https://soundeffect-lab.info/sound/various/'),
    'tile-hyoushigi1': dict(
        cat='tile', title='拍子木（木質对击）｜拍子木1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「拍子木1」— 木を打ち鳴らす和楽器（anime 分类）',
        tags='木を打ち鳴らす和楽器',
        note='两块硬木对击 —— 现实里"牌磕桌面"的最近类比，木质感能自然融进玉牌/织锦的中式调性',
        file='https://soundeffect-lab.info/sound/anime/mp3/hyoushigi1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'tile-wood-fish1': dict(
        cat='tile', title='木鱼三连｜木魚ポク・ポク・ポク', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「木魚ポク・ポク・ポク」— この後にチーン（anime 分类）',
        tags='木魚ポク・ポク・ポク',
        note='一次给三下，天然带节奏；用在"一次消除多张"的连消时刻最合适',
        file='https://soundeffect-lab.info/sound/anime/mp3/wood-fish1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'tile-tin2': dict(
        cat='tile', title='鋭いチーン｜チーン2', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「チーン2」— 鋭い音（anime 分类）',
        tags='鋭い音',
        note='比 wood-fish 更亮、更细，可作为"落槽高亮版"（连击时升一档）',
        file='https://soundeffect-lab.info/sound/anime/mp3/tin2.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'tile-money-drop1': dict(
        cat='tile', title='一枚硬币落桌｜お金を落とす1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「お金を落とす1」— 硬貨一枚（various 分类）',
        tags='硬貨一枚',
        note='薄金属盘落在硬面上的单响，短促且有种"清脆小确幸"，和"进槽得分"的语义天然贴合',
        file='https://soundeffect-lab.info/sound/various/mp3/money-drop1.mp3',
        page='https://soundeffect-lab.info/sound/various/'),
    'tile-cursor2': dict(
        cat='tile', title='カシャ｜カーソル移動2', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「カーソル移動2」— カシャ（button 分类）',
        tags='カーソル移動·カシャ',
        note='更轻、更"电子"的一记，作为"轻量落槽"备选，适合牌少、节奏快的局面',
        file='https://soundeffect-lab.info/sound/button/mp3/cursor2.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    'tile-decision38': dict(
        cat='tile', title='カッ｜決定ボタンを押す38', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「決定ボタンを押す38」— カッ（button 分类）',
        tags='決定ボタン·カッ',
        note='最轻的一记，几乎只有"接触瞬间"，用于极高频落槽时避免听觉疲劳',
        file='https://soundeffect-lab.info/sound/button/mp3/decision38.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    # ========================================================
    #  ② 胜利 —— 一条上行收束，2~3 秒，欢快但不铺张；与失败共用同一套语汇（综艺答题/游戏升级），保证胜败成对。
    # ========================================================
    'win-success1': dict(
        cat='win', title='成功音｜成功音', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「成功音」— ゲーム等で何かが成功した時（button 分类）',
        tags='ゲーム等で何かが成功した時',
        note='官方定位直白："游戏里某事成功时"。它就是为这个场景做的',
        file='https://soundeffect-lab.info/sound/button/mp3/success1.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    'win-trumpet1': dict(
        cat='win', title='小号号角｜ラッパのファンファーレ', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ラッパのファンファーレ」— 喜びの演出に（anime 分类）',
        tags='喜びの演出に（喜悦的演出）',
        note='三音上行的小号 —— "喜悦"但只有两三秒，不铺张，符合悠哉基调',
        file='https://soundeffect-lab.info/sound/anime/mp3/trumpet1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-correct1': dict(
        cat='win', title='综艺正解音｜クイズ正解1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「クイズ正解1」— ピンポンピンポンピンポン（anime 分类）',
        tags='ピンポンピンポンピンポン',
        note='三连「叮咚」：把"赢一手"处理成"答对了"，轻松、不带征服感',
        file='https://soundeffect-lab.info/sound/anime/mp3/correct1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-correct2': dict(
        cat='win', title='铁琴正解｜クイズ正解2', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「クイズ正解2」— 鉄琴（anime 分类）',
        tags='鉄琴',
        note='同一套正解音的另一种音色（铁琴），比 1 更温和，适合"小幅胜利"用它、通关用 1',
        file='https://soundeffect-lab.info/sound/anime/mp3/correct2.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-levelup1': dict(
        cat='win', title='升级音｜レベルアップ', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「レベルアップ」— テッテレー（anime 分类）',
        tags='テッテレー',
        note='"テッテレー"是日本游戏通用的升级定式音，玩家一听就懂',
        file='https://soundeffect-lab.info/sound/anime/mp3/levelup1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-item-get1': dict(
        cat='win', title='获得金钱｜アイテムを入手1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「アイテムを入手1」— お金（anime 分类）',
        tags='お金',
        note='金币入袋的音色 —— 麻将题材里没有比"钱"更贴的奖励语义了',
        file='https://soundeffect-lab.info/sound/anime/mp3/item-get1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-item-get2': dict(
        cat='win', title='获得宝物｜アイテムを入手2', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「アイテムを入手2」— お宝ザクザク（anime 分类）',
        tags='お宝ザクザク',
        note='同一个语义的豪华版。连续消除奖励时从 1 升到 2 即为"加码"',
        file='https://soundeffect-lab.info/sound/anime/mp3/item-get2.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-chan-chan1': dict(
        cat='win', title='木琴收尾（ちゃんちゃん）｜ちゃんちゃん♪1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ちゃんちゃん♪1」— 木琴で演奏。オチに使える（anime 分类）',
        tags='木琴で演奏。オチに使える',
        note='日式综艺的收尾定式，自带"讲完了"的句号感；木琴音色也和中式弹拨不冲突',
        file='https://soundeffect-lab.info/sound/anime/mp3/chan-chan1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-ramen-stall1': dict(
        cat='win', title='屋台小调｜ラーメン屋台のメロディ', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ラーメン屋台のメロディ」— 江戸時代からある旋律（anime 分类）',
        tags='江戸時代からある旋律',
        note='一条只有几秒的街头小调旋律 —— 比"号角"更贴"茶馆搓牌"的市井气，放在"小胡一把"上比放通关上更合适',
        file='https://soundeffect-lab.info/sound/anime/mp3/ramen-stall1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-shakin3': dict(
        cat='win', title='シャキーン（爽快）｜シャキーン3', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「シャキーン3」— 爽快感重視。ゲームにも使える（anime 分类）',
        tags='爽快感重視。ゲームにも使える',
        note='官方写明"重视爽快感、游戏也可用"；一条亮脆的上行，不占用旋律空间，可高频复用',
        file='https://soundeffect-lab.info/sound/anime/mp3/shakin3.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'win-gauge-recovery1': dict(
        cat='win', title='体力回复｜ゲージ回復1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ゲージ回復1」— 体力回復（button 分类）',
        tags='体力回復',
        note='温和上行的"数值涨了"型音效，情绪值最低的那档胜利，适合"清掉一小片但没胡牌"的中间反馈',
        file='https://soundeffect-lab.info/sound/button/mp3/gauge-recovery1.mp3',
        page='https://soundeffect-lab.info/sound/button/'),
    # ========================================================
    #  ③ 失败 —— 休闲游戏最忌"重挫感"：要下行、要软、最好还有点喜感；刻意避开刺耳蜂鸣与长篇悲鸣。
    # ========================================================
    'lose-incorrect2': dict(
        cat='lose', title='综艺错答音｜クイズ不正解2', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「クイズ不正解2」— 残念でした（anime 分类）',
        tags='残念でした（真遗憾）',
        note='和 correct1 是同一套综艺语汇 ⇒ 胜/败成对，输的时候官方的语气本身就是"遗憾"而不是"惩罚"',
        file='https://soundeffect-lab.info/sound/anime/mp3/incorrect2.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-tin1': dict(
        cat='lose', title='チーン（失望）｜チーン1', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「チーン1」— がっかりした時の演出に（anime 分类）',
        tags='がっかりした時の演出に',
        note='官方定位原文就是"用于失望的时刻"。一声金属余韵的"チーン"，是休闲游戏最经典的"再来一次"提示',
        file='https://soundeffect-lab.info/sound/anime/mp3/tin1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-cute-sad1': dict(
        cat='lose', title='可爱沮丧｜しょげる', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「しょげる」— 可愛いキャラがテンションダウン（anime 分类）',
        tags='可愛いキャラがテンションダウン',
        note='官方写明"可爱角色情绪低落" —— 把失败演成"小家伙垂头"，而不是"你输了"，这是最能保住休闲调性的一条',
        file='https://soundeffect-lab.info/sound/anime/mp3/cute-sad1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-stupid5': dict(
        cat='lose', title='间抜け（泄气）｜間抜け5', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「間抜け5」— 気の抜ける音（anime 分类）',
        tags='気の抜ける音（泄气的声音）',
        note='一条"泄气"音：没有音高指向、没有攻击性，纯粹表示"这步没成"，情绪风险最低',
        file='https://soundeffect-lab.info/sound/anime/mp3/stupid5.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-stupid7': dict(
        cat='lose', title='ボワンボワン｜間抜け7', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「間抜け7」— ほわんほわんほわん（anime 分类）',
        tags='ほわんほわんほわん',
        note='柔波状的滑稽音，带明显喜感；适合把"失误"直接变成笑点（配合飘字更有效）',
        file='https://soundeffect-lab.info/sound/anime/mp3/stupid7.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-trumpet-greasedown1': dict(
        cat='lose', title='小号下滑｜トランペットのグリスダウン', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「トランペットのグリスダウン」— 音程を素早く下げる（anime 分类）',
        tags='音程を素早く下げる',
        note='如果胜利选了小号号角，失败就配这条：一上一下，语义不用解释就成立（这是最"成套"的一组）',
        file='https://soundeffect-lab.info/sound/anime/mp3/trumpet-greasedown1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-trumpet-dub1': dict(
        cat='lose', title='蹩脚小号｜へたくそトランペット', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「へたくそトランペット」— 力が抜ける（anime 分类）',
        tags='力が抜ける（泄力）',
        note='跑调的小号 —— "努力了但没成"的幽默表达，比纯电子音有温度得多',
        file='https://soundeffect-lab.info/sound/anime/mp3/trumpet-dub1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-fall-down1': dict(
        cat='lose', title='综艺扑空｜ずっこける', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ずっこける」— ドテーン（anime 分类）',
        tags='ドテーン（摔个屁股墩）',
        note='日式综艺"摔倒"音，纯喜剧。失败＝笑点，最贴"悠哉"基调',
        file='https://soundeffect-lab.info/sound/anime/mp3/fall-down1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-drop1': dict(
        cat='lose', title='落ち込む（低落）｜落ち込む', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「落ち込む」— 暗いイメージ（anime 分类）',
        tags='暗いイメージ',
        note='唯一一条"正经低沉"的失败音；留给"关卡没过"这种大节点，日常小失误不要用它',
        file='https://soundeffect-lab.info/sound/anime/mp3/drop1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-boyoyon1': dict(
        cat='lose', title='ボヨヨーン（弹簧）｜ボヨヨーン', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「ボヨヨーン」— びっくり箱。ギャグ音にも使える（anime 分类）',
        tags='ギャグ音にも使える',
        note='弹簧抖动音，官方写明"也可当搞笑音"；卡通感最强的一条',
        file='https://soundeffect-lab.info/sound/anime/mp3/boyoyon1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
    'lose-stunned1': dict(
        cat='lose', title='目が点（呆住）｜目が点になる', artist='効果音ラボ',
        src='soundeffect-lab.info',
        official='「目が点になる」— カーン、カァカァ（anime 分类）',
        tags='カーン、カァカァ',
        note='「カーン、カァカァ」＝眼睛变成点的呆滞音，表示"看走眼了"，比"你错了"更含蓄',
        file='https://soundeffect-lab.info/sound/anime/mp3/stunned1.mp3',
        page='https://soundeffect-lab.info/sound/anime/'),
}


def dl(url, dst, tries=4, referer=None):
    if os.path.exists(dst) and os.path.getsize(dst) > 1024:
        return os.path.getsize(dst), 'cache'
    last = None
    for i in range(tries):
        try:
            # ★ Referer 必须是**页面**，不是 mp3 所在目录：
            #   soundeffect-lab.info 对无 Referer / 错 Referer 的 mp3 请求直接 403。
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Referer': referer or (url.rsplit('/', 1)[0] + '/')})
            with urllib.request.urlopen(req, timeout=90) as r, open(dst, 'wb') as w:
                w.write(r.read())
            n = os.path.getsize(dst)
            if n < 1024:
                raise RuntimeError(f'文件过小 {n}B')
            return n, 'ok'
        except Exception as e:
            last = e
            if os.path.exists(dst):
                os.remove(dst)
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'下载失败 {url}: {last}')


def main():
    out = sys.argv[1]
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    os.makedirs(f'{out}/raw', exist_ok=True)

    groups = []
    if only in (None, 'bgm'):
        groups.append(('BGM', {k: v for k, v in BGM.items()}))
    if only in (None, 'sfx'):
        groups.append(('SFX', {k: v for k, v in SFX.items()}))

    catalog, fails = {}, []
    # ★ 合并而不是覆盖：--only sfx 时不能把上一轮的 BGM 记录冲掉
    if os.path.exists(f'{out}/catalog.json'):
        try:
            catalog.update(json.load(open(f'{out}/catalog.json')))
            print(f'  （并入已有 catalog.json：{len(catalog)} 条）')
        except Exception as e:
            print(f'  （已有 catalog.json 读取失败，忽略：{e}）')
    for gname, table in groups:
        print(f'════ {gname} · {len(table)} 条 ════')
        for k, v in table.items():
            ext = '.mp3'
            dst = f'{out}/raw/{k}{ext}'
            try:
                n, st = dl(v['file'], dst, referer=v.get('page'))
            except Exception as e:                      # 缺一条就记账，最后统一报错
                fails.append(f'{k}: {e}')
                print(f'  [x] {k:<22} {e}')
                continue
            rec = dict(v)
            rec.update(id=k, kind=gname.lower(), local=dst, bytes=n)
            catalog[k] = rec
            print(f'  [v] {k:<22} {n/1024:>8.1f} KB  {st:<5} {rec.get("title","")[:34]}')

    with open(f'{out}/catalog.json', 'w') as fh:
        json.dump(catalog, fh, ensure_ascii=False, indent=2)
    print()
    print(f'  → {out}/catalog.json（{len(catalog)} 条）')
    if fails:
        print(f'  [x] 失败 {len(fails)} 条：')
        for x in fails:
            print('      ' + x)
        sys.exit(1)


if __name__ == '__main__':
    main()
