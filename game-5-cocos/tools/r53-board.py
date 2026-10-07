#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第 53 轮 · 验收对照板（给用户拍板用）

本轮范围 = 用户拍板的「批次 2」+ 加做的 T17 最小版：
  T06 激励视频（复活）  T07 广告扩到换道具 + 去奖励化分享
  T08 广告失败降级      T09 分享接入（合规形态）  T10 wx.login
  T17 开放数据域好友榜（主域接线 · 最小版）

小节：
  01 本轮范围（4 条拍板 -> 落地位置）
  02 广告三种结局的判据表 + 真/替身两条路的区分
  03 截图：失败结算位 / 替身面板 / 真广告播放中
     + ★ 截图口径标定（本轮修掉的一个取证工具 bug：fromSurface:false ⇒ 静的残图）
  04 核心负控：连播 3 次只发 3 份（实例缓存 + 监听器只挂一次）
  05 分享：合规形态（静态 + 动态双保险）
  06 T17 排行榜：降级 + 真分支（两张截图）
  07 T10 登录：失败不阻塞首屏
  08 配置现状 + 拿到广告位后的两步
  09 自证与回归汇总
  10 真机怎么试（步骤）+ 二维码

排版纪律（沿用本项目惯例）：不用 emoji（中文字体渲染成豆腐块）；
   含中文的单元一律走中文字体（Menlo 无中文字形）；板高先给足、画完按实际 y 裁。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROOT = os.path.normpath(os.path.join(PROJ, '..'))
OUT = os.path.join(ROOT, 'docs-verify', 'game-5', 'ui', 'round53-platform-ads-share-rank')
os.makedirs(OUT, exist_ok=True)

SH = '/tmp/g5-r53-shots'
S_FAIL = os.path.join(SH, '01-失败结算-看广告复活位.png')
S_MOCK = os.path.join(SH, '02-替身广告面板-演示用.png')
S_REAL = os.path.join(SH, '03-真广告播放中-无面板.png')
S_RANK_FALLBACK = os.path.join(SH, '04-排行榜-浏览器降级态.png')
S_RANK_ODC = os.path.join(SH, '05-排行榜-开放数据域视窗.png')
S_WIN = os.path.join(SH, '06-胜态结算-分享入口.png')
S_SHARE_TOAST = os.path.join(SH, '07-分享-浏览器降级提示.png')
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
C_WARN = (240, 186, 96)

W = 1720
PAD = 56
H = 9000

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
    d.text((PAD + 26, y - 6), '%s · %s' % (no, title), font=font(38, True), fill=C_CREAM)
    y += 46
    if sub:
        d.text((PAD + 26, y), sub, font=font(25), fill=C_DIM)
        y += 34
    y += 18


def note(txt, color=C_DIM, size=24, indent=26):
    """说明文字。★ 按**实际像素宽自动折行** —— PIL 不会自动换行，
    中文又没有空格可断词，只能逐字量宽。不折行的后果是文字直接跑出板外被切掉
    （第 53 轮补标定段时踩到：右侧半句全没了，而画的时候毫无报错）。

    ⚠️ 另外：PIL 不认 markdown，**别在这里写 `**粗体**`** —— 星号会原样印出来
    （判据 22 的同类坑；HTML 那边是内联渲染，这里是"干脆别写"）。"""
    global y
    f = font(size)
    maxw = W - (PAD + indent) - 44
    lines, cur = [], ''
    for ch in txt:
        if cur and f.getlength(cur + ch) > maxw:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    for ln in lines:
        d.text((PAD + indent, y), ln, font=f, fill=color)
        y += size + 12


def table(rows, cw, mono_cells=True, ok_cols=(), ng_cols=(), warn_cols=(), head_row=True):
    global y
    # ★ 硬自检：列宽超板会让表头横线（和长单元格）**被板边默默裁掉**，画的时候零报错。
    #   第 53 轮就踩了：新表的列宽合计 1660 ⇒ 横线画到 x=1736，比板宽 1720 多出 16px。
    if PAD + 20 + sum(cw) > W - 4:
        raise SystemExit('[!] 表格太宽：列宽合计 %d ⇒ 右端 x=%d，已超出板宽 %d。'
                         '请收窄列宽（本板最大允许合计 %d）。'
                         % (sum(cw), PAD + 20 + sum(cw), W, W - 4 - PAD - 20))
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
            if not hd and j in warn_cols:
                col = C_WARN
            # Menlo 不含中文字形 -> 含中文的单元一律走中文字体，否则渲染成豆腐块
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


def crop_band(src, y0, y1, x0=None, x1=None):
    im = Image.open(src).convert('RGB')
    y1 = min(y1, im.height)
    x0 = 0 if x0 is None else x0
    x1 = im.width if x1 is None else x1
    return im.crop((x0, y0, x1, y1))


def paste_row(items, w=370, gap=30, caption_color=C_DIM):
    """items = [(path, caption, color), ...]；并排贴一行，返回该行高"""
    global y
    x = PAD + 20
    hmax = 0
    for path, cap, col in items:
        im = fit_w(Image.open(path).convert('RGB'), w)
        d.text((x, y), cap, font=font(23, True), fill=col)
        board.paste(im, (x, y + 34))
        d.rectangle([x - 2, y + 32, x + im.width + 2, y + 34 + im.height + 2],
                    outline=(70, 100, 84), width=2)
        x += w + gap
        hmax = max(hmax, im.height + 34)
    y += hmax + 26


# ============================================================
head('01', '本轮范围（用户拍板 -> 本次落地）',
     '动工前四项拍板已逐条确认；T16 与合规口径冲突，按拍板结论整项不做')

table([
    ('ID', '任务', '落地位置 / 关键实现'),
    ('T06', '激励视频 —— 只打通「复活」', 'core/AdService.ts（新建 · 276 行）'),
    ('T07', '广告扩到「换道具」+ 分享去奖励化', 'GamePage.playAd / openAd / grantByAd'),
    ('T08', '广告失败降级（abort / fail 不发奖）', 'GamePage.settleAdPanel / onLeave'),
    ('T09', '分享接入（合规：只传播）', 'core/ShareService.ts（新建 · 151 行）'),
    ('T10', 'wx.login 拿 code（不阻塞首屏）', 'core/LoginService.ts（新建 · 119 行）'),
    ('T17', '开放数据域好友榜（最小版）', 'build-templates/.../openDataContext/index.js'),
    ('--', '排行榜主域接线 + 上报', 'core/RankService.ts + HomePage.openRank'),
    ('--', '验收钩子（翻转广告配置）', 'GamePage 调试桥 adConfig()'),
    ('--', '开放数据域自动就位', 'tools/postpack-subpackages.py 第 (4) 步'),
], [110, 560, 900], mono_cells=False, ok_cols=(2,))

note('[!] T16「结算页分享得道具」直接违反「分享不得诱导」—— 按拍板结论不做，分享不给任何奖励。', C_NG)
note('[!] 旧口径 holdFromAdShare（分享得来的道具）整条删除，不存在这回事了。', C_NG)

# ============================================================
head('02', '广告：三种结局的判据 + 真/替身两条路怎么区分',
     '三种结局由 AdService 收口；页面只认 end 才发奖')

table([
    ('结局', '触发条件', '是否发奖', '必须同时做到'),
    ('end', 'onClose(res.isEnded === true)', '发', '--'),
    ('abort', 'onClose(res.isEnded === false)', '不发', '复位 _paused（否则整页卡死）'),
    ('fail', 'show 失败 / onError / 看门狗超时', '不发', '复位 _paused + 复位 adBusy'),
], [180, 560, 190, 620], mono_cells=False, ok_cols=(2,), ng_cols=(1,))

note('真分支 vs 替身面板，唯一可判定的特征：')
table([
    ('', 'adPanelOpen', 'adBusy', '有无广告位'),
    ('real（真广告）', 'false（没有面板）', 'true', '有 adunitId + 开关开'),
    ('mock（替身面板）', 'true（有面板）', 'true', '默认态，界面上标「演示用」'),
], [320, 380, 240, 520], mono_cells=False, ok_cols=(1, 2, 3))

# ============================================================
head('03', '真实鼠标取证：三个界面态',
     '视口 421x927 CSS（真机基线）· 出图 1263x2781 = 421x927 @3x（与真机 1264x2780 差 1px）')

paste_row([
    (S_FAIL, '01 失败结算 ·「看广告复活」位', C_DIM),
    (S_MOCK, '02 替身面板 · 如实标「演示用」', C_WARN),
    (S_REAL, '03 真广告播放中 · 无任何面板', C_OK),
])

note('02 与 03 的差别就是本轮最要紧的一处「不骗人」：默认态没有广告位，界面如实写'
     '「演示用 · 当前尚未接入广告位」，绝不冒充真广告。', C_DIM)
note('03 里 platform() 实测 = { realEnabled: true, revive: "real", adPanelOpen: false, adBusy: true }，'
     '正是「没有面板却在上锁」的真广告特征。', C_KEY)

# ------------------------------------------------------------
note('[!] 本轮顺带修掉一个「取证工具自身的 bug」—— 它一度让「画面里有什么」变成不可信的判断依据。', C_NG)
table([
    ('captureScreenshot 参数组合（视口 421x927）', '实际出图', '内容覆盖', '判定'),
    ('{format:"png"}', '1263x2781', '100%', 'OK'),
    ('{format, captureBeyondViewport:false}', '1263x2781', '100%', 'OK（共享 helper 走这条）'),
    ('{format, clip:{...,scale:1}}', '1263x2781', '100%', 'OK（clip.scale 被忽略）'),
    ('{format, fromSurface:false}', '842x1854', '84.5%', '坏：底部 15.5% 静默丢失'),
    ('{format, ... + captureBeyondViewport:false}', '842x1854', '84.5%', '坏（与上一行字节数完全相同）'),
    ('{format, clip:{...,scale:3}}  @DPR1', '1263x2781', '100%', '可用（只是慢些）'),
    ('{format, clip:{...,scale:3}}  @DPR3', '(150s 不返回)', '--', 'DPR3x3 = 重渲染 9x 像素'),
], [620, 270, 190, 520], mono_cells=False, ok_cols=(3,))
note('怎么称出来的（不是猜的）：往页面里插三条已知颜色的 DOM 横条'
     '（y=200 绿 / 500 蓝 / 900 红），再量它们落在图里的第几行。'
     '1263x2781 那张三条全部落在 3x 精确位；842x1854 那张绿、红两条整条都不见了'
     '—— 说明不是简单裁切，是一帧半合成的残图。', C_KEY)
note('影响面：只有 _r52-shots / _r53-shots / _r53-probe-toast 三个脚本中招'
     '（它们都开 DPR3 且都传了 fromSurface:false）。'
     '而 _r46 到 _r49 那批验收脚本开的是 DPR1，clip{scale:3} 只等于 3x 像素，'
     '所以没事 —— 已逐个核过，不搞连坐。', C_DIM)
note('代价：52、53 两轮的取证图全是 842x1854 残图。于是「07 截图里看不到 toast」这个假象'
     '被当成产品问题查了两轮 —— 其实 toast 一直在（不透明度 255、且排在命中栈首位），'
     '只是从来没被画进那张图里。', C_NG)
note('修法：三个截图脚本统一改走 verifiedShot()（g5-cdp.mjs 导出），'
     '它在捕获后立刻验 PNG 的 IHDR 宽高，不符就抛错。'
     '这样「静默残图」以后不可能再被当证据用。', C_OK)

_bottom_path = os.path.join(OUT, '_r53-07-底部放大.png')
crop_band(S_SHARE_TOAST, 2150, 2781).save(_bottom_path)
paste_row([
    (_bottom_path, '07 底部放大 · toast「当前环境不支持分享，请在微信里试」确实在图上（此前被残图吃掉）', C_OK),
], w=900)

# ============================================================
head('04', '核心负控：连播 3 次只发 3 份（不是 6 份 / 9 份）',
     '这是激励视频接入最典型的翻车点，而且不报错')

table([
    ('判据', '期望', '本轮实测'),
    ('连播 3 次，每次 cleared 增量', '完全相同且 = 槽内实际张数', '[2, 2, 2]  (期望 [2, 2, 2])'),
    ('createRewardedVideoAd 调用次数', '全程 1 次（实例按场景缓存）', '1 -> 1（3 轮后仍为 1）'),
    ('onClose 注册次数', '1（只在创建时挂一次）', '1 -> 1'),
    ('onError 注册次数', '1（只在创建时挂一次）', '1 -> 1'),
    ('show() 调用次数', '每播一次 1 次', '3 次 / 3 次播放'),
], [600, 560, 480], mono_cells=False, ok_cols=(2,))

note('根因说明：createRewardedVideoAd 的 onClose / onError 是挂在实例上、会累积的。'
     '每播一次就 create 一次、顺手再挂一对监听 -> 播到第 N 次时回调同时触发 N 份。', C_NG)
note('修法：AdService 把实例按场景缓存、监听器只在创建时挂一次；settle() 幂等，'
     '重复回调也只结算一次。', C_OK)

# ============================================================
head('05', '分享：合规形态（静态 + 动态双保险）', '微信《小游戏运营规范》把「分享后才给奖励」列为诱导分享')

table([
    ('保险', '判据', '结果'),
    ('静态 1', 'ShareService 剥注释后代码里无发奖能力', '不含 SaveService / inventory / coins / grant'),
    ('静态 2', 'GamePage 代码里无「分享给好友」按钮', '已 0 处（连注释外的文案一起删干净）'),
    ('静态 3', '广告面板旧文案「或分享给好友」已消失', '已 0 处'),
    ('动态 1', '点完分享后 inventory 四件套逐字段未变', '{"erase":0,"move":0,"shuffle":0,"addslot":0}'),
    ('动态 2', '点完分享后 coins 未变', '0 -> 0'),
    ('动态 3', '全场景 Label 无「奖励 / 分享得 / 分享领」', '0 条命中'),
    ('动态 4', '真分支 wx.shareAppMessage 被调用且载荷正确', 'title + query=shareLevel=3，无 imageUrl'),
], [180, 700, 700], mono_cells=False, ok_cols=(2,))

note('静态那三条是为了「将来手滑把奖励接回分享」也能红 —— 光靠行为断言挡不住新加的代码路径。', C_KEY)

# ============================================================
head('06', 'T17 排行榜：无开放数据域时降级、有 wx 时建视窗', '视窗 640x960 = 2:3，与 SubContextView 默认同比例')

paste_row([
    (S_RANK_FALLBACK, '04 浏览器降级态 · 如实提示', C_WARN),
    (S_RANK_ODC, '05 有 wx · 建出开放数据域视窗', C_OK),
])

table([
    ('环境', 'OpenDataView', '云端上报', '通知重绘'),
    ('浏览器无 wx', '不建（降级文案）', '不调', '不调'),
    ('有 wx（真机 / 注入）', '建 640x960', 'key=level, wxgame.score=2', '{type:"render"}'),
], [300, 360, 480, 300], mono_cells=False, ok_cols=(1, 2, 3))

note('开放数据域子包已就位（9.9K，入口 index.js），postpack 每轮自动搬 + 登记 game.json。', C_DIM)
note('离线自证 20/20：含 6 条负控（空态不画分 / 失败带 errMsg / engine 视口消息不打爆接口 / '
     '空消息不抛异常 / 坏 KV 按 0 / 截断后留的是分最高的 7 个）。', C_DIM)
note('[!] 真机好友榜需要至少 1 位好友也玩过才有数据 —— 这条只能等你的真机回执。', C_WARN)

# ============================================================
head('07', 'T10 登录 与 胜态分享入口', '两个截图均为真实鼠标点出来的状态')

paste_row([
    (S_WIN, '06 胜态结算 · 分享入口', C_DIM),
    (S_SHARE_TOAST, '07 点分享 -> 浏览器如实降级提示', C_OK),
])

table([
    ('判据', '结果'),
    ('wx.login 失败时首屏是否照常到达', '到达（login calls=1，日志为 warning 级）'),
    ('wx.login 失败是否冒泡成未捕获异常', '0 条'),
    ('并发 10 次 ensureCode 实际调 wx.login 几次', '1 次（并发合并）'),
    ('wx.login 永不回调时是否兜底', '看门狗 100ms 后 resolve(null)，且 _inflight 已清可重发'),
], [700, 880], mono_cells=False, ok_cols=(1,))

# ============================================================
head('08', '配置现状 + 拿到广告位后的两步', '当前是「真 SDK + 总开关（默认关）+ 降级替身」')

table([
    ('配置项', '当前值', '说明'),
    ('AD.REAL_ENABLED', 'false', '默认关：未开流量主时调广告 API 有审核风险'),
    ('AD.AD_UNIT.revive', '""（空串）', 'A1 复活位'),
    ('AD.AD_UNIT.tool', '""（空串）', 'A2 换道具位'),
    ('AD.MOCK_SECONDS', '5', '替身面板时长（界面上标「演示用」）'),
    ('AD.WATCHDOG_MS', '120000', '既无 onClose 也无 onError 时兜底判 fail，防卡死'),
    ('SHARE.IMAGE_URL', '""（空串）', '空 => 不带 imageUrl 字段，交给微信取页面截图'),
    ('LOGIN.TIMEOUT_MS', '8000', 'wx.login 看门狗'),
], [420, 300, 860], mono_cells=False, warn_cols=(1,))

note('拿到正式广告位后：把两个 adUnitId 填进 CFG.AD.AD_UNIT，并把 REAL_ENABLED 改成 true。', C_OK)
note('其余代码一行不用动 —— 替身面板那段根本不会被走到。', C_OK)
note('注：CFG.AD 是本工程里唯一不写 as const 的配置块，就是为了让验收脚本能在运行期翻开关。', C_DIM)

# ============================================================
head('09', '自证与回归汇总', '全部为脚本实测，非人工目视')

table([
    ('套件', '覆盖', '结果'),
    ('_r53-core-check（离线）', '广告三结局 / 实例缓存 / 监听器 / 重试 / 看门狗 / 分享 / 登录 / 排行', '93 通过 0 失败'),
    ('_r53-verify（真实鼠标）', '替身走完 / abort 负控 / 真分支三结局 / 连播 3 次 / 分享 / 排行 / 登录', '90 通过 0 失败'),
    ('_r53-odc-check（离线）', '开放数据域自绘逻辑 + 6 条负控', '20 通过 0 失败'),
    ('check-board', '关卡数据完整性 + 覆盖判定 + 匹配规则 + 贴图路径', '3476 通过 0 失败'),
    ('_r46-diff-verify', '难度档 BLOCK=7 的难度标定与可解性', '15 通过 0 失败'),
    ('g5-smoke', '五页导航 + 对局冒烟（含暂存架）', '25 通过 0 失败'),
    ('_r52-verify', '静音解耦 / 二次确认 / 前后台生命周期 / 配置项', '38 通过 0 失败'),
    ('_r49-verify', '结算弹层几何（胜 / 负双态）', '28 通过 0 失败'),
    ('_r48-verify', '胜 / 负判定口径（含槽满负控）', '48 通过 0 失败'),
    ('_r47b-verify', '负态吉祥物贴图身份与尺寸', '16 通过 0 失败'),
], [300, 660, 420], mono_cells=False, ok_cols=(2,))

table([
    ('构建与出码', '结果'),
    ('类型检查 tsc-check.sh', '0 错误'),
    ('web-desktop 构建', '成功 13M'),
    ('wechatgame 构建 + 分包化', '成功 · 主包 3.78 MB（红线 4MB）'),
    ('开放数据域', '已就位（9.9K，入口 index.js）'),
    ('真机预览码', '已生成且上传通道正常（upload error +0 / progressSuccess +1）'),
    ('取证截图工具（本轮修）', '3 个脚本统一走 verifiedShot（尺寸自证）· 7 张全部 1263x2781'),
], [360, 1220], mono_cells=False, ok_cols=(1,))

# ============================================================
head('10', '真机怎么试（请照此操作）', '扫下面这张码；预览码只有最新一张有效')

try:
    qr = fit_w(Image.open(QR).convert('RGB'), 300)
    board.paste(qr, (PAD + 20, y))
    d.rectangle([PAD + 18, y - 2, PAD + 22 + qr.width, y + qr.height + 2], outline=C_GOLD, width=3)
    tx = PAD + 20 + qr.width + 40
    lines = [
        ('1) 微信「扫一扫」扫左边这张码，进入游戏。', C_CREAM),
        ('2) 进任意一关，故意把槽填满弄失败。', C_CREAM),
        ('3) 点「看广告复活」-> 会出现 5 秒替身面板，', C_CREAM),
        ('   界面上写着「演示用 · 当前尚未接入广告位」', C_DIM),
        ('   —— 这是正常的，我们还没有广告位。', C_DIM),
        ('4) 走完 5 秒应当真的复活（槽内直消 4 张）；', C_OK),
        ('   中途点「跳过」应当什么都不发生、界面不卡。', C_OK),
        ('5) 通关一次，在胜态卡上点「分享」——', C_CREAM),
        ('   应当拉起微信转发面板，且不发任何奖励。', C_CREAM),
        ('6) 回首页点右列「排行榜」——', C_CREAM),
        ('   应当能看到排行榜浮层（好友榜要等有人一起玩）。', C_CREAM),
        ('7) 顺带复核 T04 存档：完全退出小游戏再进，', C_WARN),
        ('   关卡进度 / 金币 / 静音位是否都保持。', C_WARN),
    ]
    for txt, col in lines:
        d.text((tx, y), txt, font=font(26), fill=col)
        y += 40
    y = max(y, y)
    qr_bottom = None
except Exception as e:
    note('[!] 二维码读不到：%s' % e, C_NG)

# ============================================================
#  裁掉底部空白
final = board.crop((0, 0, W, min(H, y + PAD)))

# ★ 交付前自检（判据 1 的正面用法）：右缘最后 2 列不得有内容 ——
#   有 ⇒ 说明有文字/横线跑出板外被裁掉了。这类问题**画的时候不会报错**，
#   只有真去数像素才看得见（第 53 轮就是这么发现的）。
_bad = []
for x in range(W - 2, W):
    for yy in range(0, final.height, 2):
        if max(abs(final.getpixel((x, yy))[i] - C_BG[i]) for i in range(3)) > 26:
            _bad.append((x, yy))
if _bad:
    raise SystemExit('[!] 右缘溢出 %d 像素（首处 %s）—— 有内容被板边裁掉了，'
                     '请检查 note()/table() 的宽度。' % (len(_bad), _bad[0]))
print('[OK] 右缘自检：无内容被裁（板 %dx%d）' % (final.width, final.height))
# 底缘：末行必须是背景 —— 否则说明 H 给少了、内容被截断（同样是静默失败）
_lastok = all(max(abs(final.getpixel((x, final.height - 1))[i] - C_BG[i]) for i in range(3)) <= 26
              for x in range(0, W, 4))
if not _lastok:
    raise SystemExit('[!] 底缘仍有内容 —— 板高 H=%d 不够，内容被截断了，请调大 H。' % H)
print('[OK] 底缘自检：末行已是背景（没有截断）')

out_png = os.path.join(OUT, 'round53-board.png')
final.save(out_png)
print('验收板 -> %s  (%dx%d)' % (out_png, final.width, final.height))
