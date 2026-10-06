#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把拍板选定的音效（候选 #3「サイコロを振る・二個」）以 base64 内嵌进分镜页。
理由：预览面板 / 双击本地文件打开时，相对路径音频可能 404；内嵌后一定能播。
同时把该音效复制为正式资产 assets/_src/game-start/audio/sfx-roll-dice.mp3。
可重复运行（幂等）。
"""
import base64, os, re, shutil

BASE = os.path.dirname(os.path.abspath(__file__))                 # docs-verify/game-5/game-start
ROOT = os.path.abspath(os.path.join(BASE, '..', '..', '..'))
NAME = 'サイコロを振る・二個.mp3'
SRC  = os.path.join(ROOT, 'assets', '_src', 'game-start', 'audio-candidates', NAME)
DST  = os.path.join(ROOT, 'assets', '_src', 'game-start', 'audio', 'sfx-roll-dice.mp3')
HTML = os.path.join(ROOT, 'game-5-开局页-分镜.html')

if not os.path.exists(SRC):
    raise SystemExit('找不到源音频：' + SRC)

os.makedirs(os.path.dirname(DST), exist_ok=True)
shutil.copyfile(SRC, DST)

raw = open(DST, 'rb').read()
uri = 'data:audio/mpeg;base64,' + base64.b64encode(raw).decode('ascii')

html = open(HTML, encoding='utf-8').read()
new, n = re.subn(r'<audio id="sfx"[^>]*></audio>',
                 lambda m: '<audio id="sfx" preload="auto" src="' + uri + '"></audio>',
                 html)
if n != 1:
    raise SystemExit('未找到唯一的 <audio id="sfx">，实际匹配 %d 次' % n)
open(HTML, 'w', encoding='utf-8').write(new)

print('资产 : %s（%d B）' % (os.path.relpath(DST, ROOT), len(raw)))
print('base64: %d B（比原始 +%.0f%%）' % (len(uri), 100.0 * len(uri) / len(raw) - 100))
print('HTML : %d B → %d B' % (len(html.encode()), len(new.encode())))
