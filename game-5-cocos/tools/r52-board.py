#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 52 轮 · 验收对照板（给用户拍板用）

本轮范围 = 用户拍板的「批次 0 + 批次 1」：
  T01 音效 / BGM 开关解耦   T02 暂停弹层「返回首页」二次确认
  T03 设置「重置进度」二次确认   T05 前后台生命周期
  配置 DIFF.BLOCK 6→7 · GAME.NAME 统一「麻麻大消除」

小节：
  ① 本轮范围与落地位置
  ② T01 静音解耦（截图 + 键值迁移表）
  ③ T02 / T03 二次确认（两张截图 + 三态判据表）
  ④ T05 前后台（数值表）
  ⑤ ★ 出码链路：上传失败的真根因 + 判据自身的缺陷与修法
  ⑥ T04 真机实测步骤（请照此操作）
  ⑦ 自证与回归汇总

⚠️ 排版纪律：不用 emoji（中文字体渲染成豆腐块）；不用 markdown 星号（PIL 原样画出）；
   板高先给足余量、画完按实际 y 裁。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROOT = os.path.normpath(os.path.join(PROJ, '..'))
OUT = os.path.join(ROOT, 'docs-verify', 'game-5', 'ui', 'round52-settings-save')
os.makedirs(OUT, exist_ok=True)

SH = '/tmp/g5-r52-shots'
S_SHEET_ON = os.path.join(SH, '01-设置抽屉-两开关都开.png')
S_SHEET_MIX = os.path.join(SH, '02-设置抽屉-音效关音乐开.png')
S_CONFIRM_RESET = os.path.join(SH, '03-确认层-重置进度.png')
S_CONFIRM_BACK = os.path.join(SH, '04-确认层-返回首页.png')
QR = os.path.join(PROJ, 'docs', 'verify', 'S13', 'device', '真机预览二维码.png')

FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
MONO = '/System/Library/Fonts/Menlo.ttc'

C_BG = (16, 36, 28)
C_CARD = (26, 58, 45)
C_CREAM = (238, 232, 214)
C_GOLD = (222, 186, 110)
C_DIM = (150, 176, 160)
C_OK = (126, 214, 148)
C_NG = (232, 118, 108)
C_KEY = (120, 230, 255)

W = 1720
PAD = 56
H = 6400

board = Image.new('RGB', (W, H), C_BG)
d = ImageDraw.Draw(board)
y = PAD


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def mono(sz, bold=False):
    try:
        return ImageFont.truetype(MONO, sz, index=1 if bold else 0)
    except Exception:
        return font(sz, bold)


def head(no, title, sub=''):
    global y
    d.rectangle([PAD, y, PAD + 10, y + 40], fill=C_GOLD)
    d.text((PAD + 26, y - 6), f'{no} · {title}', font=font(38, True), fill=C_CREAM)
    y += 46
    if sub:
        d.text((PAD + 26, y), sub, font=font(25), fill=C_DIM)
        y += 34
    y += 18


def note(txt, color=C_DIM, size=24, indent=26):
    global y
    d.text((PAD + indent, y), txt, font=font(size), fill=color)
    y += size + 12


def table(rows, cw, mono_cells=True, ok_cols=(), ng_cols=(), head_row=True):
    """rows[0] = 表头。ok_cols/ng_cols 按列号染色（只看数据行）。"""
    global y
    x = PAD + 20
    for i, row in enumerate(rows):
        xx = x
        hd = head_row and i == 0
        for j, cell in enumerate(row):
            col = C_GOLD if hd else (C_CREAM if j == 0 else C_DIM)
            if not hd and j in ok_cols:
                col = C_OK
            if not hd and j in ng_cols:
                col = C_NG
            # ⚠️ Menlo 不含中文字形 -> 含中文的单元一律走中文字体，否则渲染成豆腐块
            use_mono = (hd or mono_cells) and cell.isascii()
            f = mono(25, True) if use_mono else font(25, hd)
            d.text((xx, y), cell, font=f, fill=col)
            xx += cw[j]
        y += 40
        if hd:
            d.line([PAD + 20, y - 10, PAD + 20 + sum(cw), y - 10], fill=(70, 100, 84), width=2)
    y += 24


def fit_w(im, w):
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def fit_h(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def crop_band(src, y0, y1, x0=None, x1=None):
    im = Image.open(src).convert('RGB')
    y1 = min(y1, im.height)
    x0 = 0 if x0 is None else x0
    x1 = im.width if x1 is None else x1
    return im.crop((x0, y0, x1, y1))


def frame(im, x, yy, color=(70, 100, 84)):
    d.rectangle([x - 2, yy - 2, x + im.width + 2, yy + im.height + 2], outline=color, width=2)


# ============================================================
head('①', '本轮范围（用户拍板 → 本次落地）',
     '批次 0 + 批次 1；万字牌面修形与 T11 签到页版式按用户决定不在本轮')

table([
    ('项', '内容', '落地位置'),
    ('T01', '音效 / BGM 开关解耦（各存各的键）', 'AudioService.ts + HomePage.ts'),
    ('T02', '暂停弹层「返回首页」加二次确认', 'GamePage.ts + UIFactory.confirmDialog'),
    ('T03', '设置「重置进度」加二次确认', 'HomePage.ts + UIFactory.confirmDialog'),
    ('T05', '前后台生命周期 wx.onShow / onHide', 'GameRoot.ts + PageBase.ts + GamePage.ts'),
    ('配置', 'DIFF.BLOCK 6 → 7', 'CFG.ts'),
    ('配置', '游戏名统一「麻麻大消除」', 'CFG.ts（GAME.NAME）'),
], [150, 720, 700], mono_cells=False, ok_cols=(2,))

# ============================================================
head('②', 'T01 静音解耦：两个开关从此各管各的',
     '左：实测截图（音效关 / 音乐开 —— 异档，这正是解耦最直观的样子）· 右：键值迁移')

y += 30   # ② 标题副行与图片标签之间留白
img_mix = fit_w(crop_band(S_SHEET_MIX, 1080, 1545), 560)
img_on = fit_w(crop_band(S_SHEET_ON, 1080, 1545), 560)
xL = PAD + 10
board.paste(img_mix, (xL, y))
frame(img_mix, xL, y, C_OK)
d.text((xL, y - 34), '改后 · 音效关（灰）/ 音乐开（绿）', font=font(24, True), fill=C_OK)
board.paste(img_on, (xL + 580, y))
frame(img_on, xL + 580, y, C_DIM)
d.text((xL + 580, y - 34), '改前起点 · 两个都开', font=font(24, True), fill=C_DIM)
y += img_mix.height + 26

table([
    ('操作', 'game5.mute.sfx', 'game5.mute.bgm', 'game5.mute（旧键）'),
    ('起点（全新安装）', 'null', 'null', 'null'),
    ('点「音效」开关', '1', 'null（没被动）', 'null（不再写）'),
    ('再点「背景音乐」', '1（保持）', '1', 'null'),
    ('再点「音效」（关）', '0', '1（保持）', 'null'),
    ('重载页面后', '0（记住）', '1（记住）', 'null'),
    ('再点「音效」（开）', '1', '1', 'null'),
], [300, 280, 320, 320], ok_cols=(1, 2))

note('旧 bug：两个开关都调 AudioService.setMuted -> 关音乐会连音效一起关、写同一个键，谁也独立不了。', C_NG)
note('修法：拆成 sfx / bgm 两个键各写各的；旧键只在两个新键都缺失时当兜底初值（老玩家升级不突变）。', C_DIM)
y += 10

# ============================================================
head('③', 'T02 / T03 二次确认：破坏性操作不再一点就走',
     '左：「重置进度」· 右：「返回首页」（叠在暂停面板之上）· 安全项做金色主按钮，危险项做描边 ghost')

y += 30   # ③ 同上
c_reset = fit_w(crop_band(S_CONFIRM_RESET, 660, 1185), 700)
c_back = fit_w(crop_band(S_CONFIRM_BACK, 660, 1185), 700)
xL = PAD + 30
board.paste(c_reset, (xL, y))
frame(c_reset, xL, y, C_GOLD)
d.text((xL, y - 34), 'T03 · 设置 → 重置进度', font=font(24, True), fill=C_GOLD)
board.paste(c_back, (xL + 760, y))
frame(c_back, xL + 760, y, C_GOLD)
d.text((xL + 760, y - 34), 'T02 · 暂停 → 返回首页', font=font(24, True), fill=C_GOLD)
y += c_reset.height + 26

table([
    ('态', 'T03 重置进度（存档）', 'T02 返回首页（局面）'),
    ('① 点一下', '弹确认层，不清档', '弹确认层，不退页'),
    ('② 点取消', '存档逐字段未变', '仍在本局，局面三字段未变'),
    ('③ 点确认', '存档变成全新默认值', '真的回到首页'),
], [220, 560, 560], mono_cells=False, ok_cols=(1, 2))

note('★ 三态判据的由来：只测「弹了框」等于没测 —— 必须证「取消后确实什么都没变、确认后才真执行」。', C_DIM)
note('T03 存档取证（垫高过，才分得清两态）：', C_CREAM, 25)
note('  改前/取消后 = level3 · best2 · coins999 · plays7 · cleared42', C_DIM, 23, 60)
note('  确认后       = level1 · best0 · coins0   · plays0 · cleared0   ← 真的清了', C_OK, 23, 60)
y += 10

# ============================================================
head('④', 'T05 前后台生命周期：停得住、也回得来',
     'web-desktop 里没有 wx -> 注入最小 fake wx（只补 onHide/onShow/offHide/offShow）后实测')

table([
    ('时刻', 'timeLeft', '说明'),
    ('基线（本来在走）', '179 → 177', '证明倒计时确实在走，否则"停住"这条判不出来'),
    ('触发 onHide', '177 → 177', '2.6 秒内纹丝不动 -> 停住'),
    ('触发 onShow', '177 → 175', '又走起来 -> 不是把计时器整个卡死'),
    ('弹层状态', 'paused false → false', '负控：切后台不该动弹层状态'),
], [300, 300, 700], mono_cells=False, ok_cols=(1,))

note('★ 设计约束：`_paused`（有弹层）与 `_inBackground`（切后台）必须分开存。', C_CREAM, 25)
note('  共用同一个标志的话，「切后台前正开着暂停面板 → 回前台面板被抹掉」，玩家会问"我暂停面板呢？"', C_DIM)
note('★ 踩到的真 bug：切后台那一刻 tickTimer 里若正有一个 1 秒定时器在跑，到点照样 -- 白掉 1 秒。', C_NG)
note('  修法 = 在该 1 秒回调内部再判一次背景标志（只在循环首行判是不够的）。', C_DIM)
y += 10

# ============================================================
head('⑤', '★ 出码链路：一张"上传失败"的假红，牵出两个真问题',
     '这一节是本轮另一个实际收获 —— 出码脚本的判据自身有缺陷，且对上传域名的认识是错的')

note('现象：本轮第一次出码，[8/7] 报「检出 1 条 task type:upload exec error —— 预览包没传上去」。', C_NG, 25)
note('按纪律，"把失败解释成误报"必须拿独立证据 -> 逐条查日志，结论如下：', C_CREAM, 25)
y += 8

FINDINGS = [
    ('① 判据口径错（这条假红的直接来源）',
     '整轮净增计数把"早期失败尝试"的错误算到了"最终成功那次"的头上。', C_NG,
     '证据 attempt#1 upload ECONNRESET；attempt#2 重传 progressSuccess + reportNewRemoteDebug，'),
    ('', 'preview-info.json 的 mtime 12:56:48 正落在 attempt#2 收尾 -> 包其实传上去了。', C_DIM,
     None),
    ('② 上传域名认错（第 36 轮排查的漏）',
     '包上传走的是腾讯 COS，不是 servicewechat.com。', C_NG,
     '证据 mmbizwxadevlogiccos-1258344707.cos.ap-shanghai.myqcloud.com'),
    ('', '同域 curl 各 8 次：全局代理 4/8 · 绕过代理 8/8', C_DIM,
     '结论 只给 servicewechat 加 DIRECT 不足以保上传，myqcloud.com 也要直连'),
    ('③ 出码脚本自身有 bash 3.2 语法坑',
     'macOS 自带 bash 3.2：`$RC）` 会把中文当变量名的一部分。', C_NG,
     '现象 unbound variable: RC? -> 修法 变量名后紧跟中文一律写 ${RC}'),
    ('④ 切档判据太弱',
     'curl 收到 HTTP 401 也会返回 0 -> 会在根本没切成功时报"已切到 direct"。', C_NG,
     '修法 PATCH 之后读回模式再确认，而不是只看退出码'),
]
for t1, t2, col, t3 in FINDINGS:
    if t1:
        d.text((PAD + 20, y), t1, font=font(25, True), fill=C_GOLD)
        y += 36
    d.text((PAD + 60, y), t2, font=font(24), fill=col)
    y += 34
    if t3:
        d.text((PAD + 60, y), t3, font=font(23), fill=C_DIM)
        y += 32
    y += 4
y += 14
note('已修（tools/wechat-preview.sh 与 wechat-preview-safe.sh）：', C_OK, 25)
note('  · [8/7] 改为按尝试计增量：只算"返回 成功 的那一次"自己带来的上传错误', C_OK, 23, 60)
note('  · 加正向佐证 progressSuccess 计数；报错指引补上 myqcloud.com 直连', C_OK, 23, 60)
note('  · safe 脚本切 direct 后读回验证；修掉 3 处 `$VAR` 紧贴中文的写法', C_OK, 23, 60)
y += 8

note('用修好的判据重跑出码的结果：', C_CREAM, 25)
table([
    ('项', '实测'),
    ('尝试次数', '1（第一次就成）'),
    ('成功那次之后的增量', 'upload error +0  ·  progressSuccess +1'),
    ('独立复解码（OpenCV，非出码脚本自带解码器）', '与 Swift Vision 结果逐字符一致'),
], [620, 900], mono_cells=False, ok_cols=(1,))
y += 6

# 二维码本体
if os.path.exists(QR):
    q = fit_h(Image.open(QR).convert('RGB'), 300)
    qx = PAD + 10
    board.paste(q, (qx, y))
    frame(q, qx, y, C_GOLD)
    d.text((qx + q.width + 30, y + 20), '当前有效真机试玩码', font=font(28, True), fill=C_GOLD)
    # ⚠️ Menlo 没有中文字形：含中文的行必须走中文字体，否则整行变成豆腐块
    d.text((qx + q.width + 30, y + 66), 'AppID  wxfaa19afc583badd9', font=mono(24), fill=C_DIM)
    d.text((qx + q.width + 30, y + 104), '包体  12385823 字节（11.81 MB）', font=font(24), fill=C_DIM)
    d.text((qx + q.width + 30, y + 142), '模式  release · 主包 3.78 MB（红线 4 MB）', font=font(24), fill=C_DIM)
    d.text((qx + q.width + 30, y + 194), '注意：预览码只有最新一张有效 —— 重跑一次，上一张立刻作废', font=font(24), fill=C_NG)
    y += max(300, 0) + 30

# ============================================================
head('⑥', 'T04 存档落盘 · 真机实测步骤（请照此操作）',
     '自动化只能证"web 端逻辑对"，真机落盘必须你在手机上走一遍')

steps = [
    ('1', '扫上面的码进入游戏，把第 1 关打过（或至少进到第 3 关）—— 让存档发生变化。'),
    ('2', '在设置里把「音效」关掉、「背景音乐」保持开 —— 制造一个异档。'),
    ('3', '完全退出小游戏（不是切后台：微信里上滑卡片把它划掉 / 或者用「…」菜单退出）。'),
    ('4', '重新扫码进入，逐项检查下面三行，把现象告诉我。'),
]
for no, txt in steps:
    d.text((PAD + 26, y), no, font=mono(26, True), fill=C_GOLD)
    d.text((PAD + 70, y), txt, font=font(25), fill=C_CREAM)
    y += 42
y += 8

table([
    ('检查项', '期望现象', '若不成立说明什么'),
    ('关卡进度', '回到你退出的那一关（不是第 1 关）', '存档没落盘 或 键名/序列化有问题'),
    ('金币 / 已清牌数', '与退出前一致', '同上；也可能是写入时机太晚（被杀进程）'),
    ('音效 / 音乐开关', '仍是「音效关、音乐开」的异档', 'T01 的两个键在真机上没写进 storage'),
], [260, 520, 460], mono_cells=False, ok_cols=(1,))
note('（真机存档与 web 端走的是同一套 SaveService + 同一份 localStorage 抽象；web 端已由本轮的', C_DIM, 23)
note('  重置/保持判据覆盖，真机这一遍是验"实际落盘通道"。）', C_DIM, 23)

# ============================================================
head('⑦', '自证与回归汇总')
for t, c in [
    ('自证：tools/_r52-verify.mjs —— 38 通过 / 0 失败（T01 13 条 · T03 8 条 · T02 9 条 · T05 6 条 · 配置 2 条）', C_OK),
    ('难度档复核：tools/_r46-diff-verify.mjs —— 15 通过 / 0 失败（BLOCK=7 已在标定表里对过账）', C_OK),
    ('类型检查：tools/tsc-check.sh —— 0 错误', C_OK),
    ('回归：tools/_r49-verify.mjs 28/28 · tools/_r47b-verify.mjs 16/16 · tools/_r48-verify.mjs 48/48', C_OK),
    ('真实事件：所有断言都走 CDP 真实鼠标（点开关 / 点确认 / 点取消），不是直接调函数', C_DIM),
    ('负控：确认层"取消"路径必须证明什么都没变；切后台必须不动 paused；连发 hide/show 不抛异常', C_DIM),
    ('冒烟：tools/g5-smoke.mjs —— 25 通过 / 0 失败（连跑 3 次一致）', C_OK),
]:
    note(t, c, 25)
    y += 4
y += 10

# -------- 顺带修掉的长期误判 --------
d.rectangle([PAD, y, PAD + 10, y + 40], fill=C_NG)
d.text((PAD + 26, y - 6), '★ 顺带查清一条长期误判：g5-smoke 的 21/22 不是网络问题', font=font(30, True), fill=C_CREAM)
y += 52
for t, c in [
    ('症状：⑤「本局走完后弹出结算弹层」偶发失败，报 over=false remaining=0 而早先被当成 ERR_CONNECTION_RESET 竞态。', C_NG),
    ('查证：真因是冒烟脚本自己不看暂存架（移出工具的三格）。', C_NG),
    ('    牌堆点空、但架子里还有牌时，按设计既不判胜也不判负', C_DIM),
    ('    （GamePage.checkBoardEmpty 第 1614 行：架里有牌 -> 玩家还能取回凑组 -> 不到终局）。', C_DIM),
    ('    脚本只从牌堆取牌，于是停在一个"没牌可点、也没结束"的中间态，把结算断言判成失败。', C_DIM),
    ('修法：FINISH 段改成循环 —— 牌堆点空后用真实鼠标点架子里的牌取回（onTempTileTap -> takeFromTemp）。', C_OK),
    ('复跑证据：轮 0 取回「九万」-> 轮 1 cleared=12/12、槽 0、架 0 -> over=true 且弹出胜态结算层（BtnNext）。', C_OK),
    ('      修后连跑 3 次：25/25 · 25/25 · 25/25，未捕获异常 0 条。', C_OK),
]:
    note(t, c, 24)
    y += 2

# ---------------- 裁掉底部空白 ----------------
y += PAD
final = board.crop((0, 0, W, y))
out = os.path.join(OUT, '00-第52轮-设置与存档-对照板.png')
final.save(out)
print(f'{out}   {final.width}x{final.height}')
