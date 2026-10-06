#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规则页（整页）· 裁切与自证（第 27 轮）

被 export_rule_page.mjs 调用（也可单独跑）。职责：
  ① 把「整页原始视图」（Chrome --screenshot 产物，透明底、@2x）按 **alpha>0 的边界**
     裁成卡片本体 → assets/_src/game-play/rule-figs/rule-完整规则页.png
     ★ 卡片高度**不写死** —— 由像素实测。写死高度是第 26 轮的教训来源。
  ② 自证四件事：
     a. 裁切宽度必须精确 = 1264（632 × 2），且右侧/下侧仍有透明余量（证明没被截断）；
     b. 四角 alpha = 0（圆角透明，贴到遮罩上不露方块）；
     c. 卡片内部不透明（alpha ≈ 255）；
     d. ★ **被删的那行说明确实不在成品里** —— 用旧图 rule-点数对应表.png（含该行）
        做**双向真值标定**：
          · 旧图在「面板下边框上方 10~75px」这条带里应当**有墨**（文字真值）；
          · 新图同位置这条带应当**无墨**。
        判据自身先在已知真值的旧图上跑通，才允许用来判新图 —— 本项目的判据纪律。

零第三方依赖之外只用 PIL + numpy（本项目既有依赖）。
"""
import os, re, sys
import numpy as np
from PIL import Image

ROOT  = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
SRC   = os.path.join(ROOT, 'game-5-规则弹层-内容图-源稿.html')
FIGD  = os.path.join(ROOT, 'assets/_src/game-play/rule-figs')
RAW   = os.path.join(FIGD, 'rule-完整规则页-原始视图.png')
OLD   = os.path.join(FIGD, 'rule-点数对应表.png')          # 旧图（含被删的那行说明）
OUT   = os.path.join(FIGD, 'rule-完整规则页.png')

DPX        = 2
PANEL_X0   = 64          # .figDice 左边界 @2x：卡片 border 2 + body padding 30 → CSS 32 → ×2
PANEL_X1   = 1200        # 右边界：632 − 2 − 30 = 600 CSS → ×2

ok_all = True
def chk(name, ok, detail=''):
    global ok_all
    ok_all = ok_all and bool(ok)
    print('  %s %s%s' % ('✅' if ok else '❌', name, ('  · ' + detail) if detail else ''))

# ══════════ ① 源稿自证：那行说明的源码必须已消失 ══════════
print('\n① 源稿自证（改动确实落在源码上）')
html = open(SRC, encoding='utf-8').read()
# ★ 先剥掉 HTML 注释再看 —— 第 27 轮首版在这里误报：文件头注释里**记录**了被删的原文
#   （"原 .diceFoot「和值 2–12：…」"），naive 的 substring 检查把"留痕"当成"没删"。
#   教训：文案类断言必须限定在**渲染可见区**，注释与留痕不算。
visible = re.sub(r'<!--.*?-->', '', html, flags=re.S)
chk('源稿已无 .diceFoot 元素', 'class="diceFoot"' not in visible)
chk('源稿可见区已无该句文案', '左右对称的赠送相同' not in visible)
chk('源稿已无 .diceFoot 样式定义', '.diceFoot{' not in visible)
chk('（留痕）注释里仍记录该行原文，供追溯', '左右对称的赠送相同' in html)

# ══════════ ② 裁切（高度按像素实测，不写死）══════════
print('\n② 裁切（按像素实测，不写死高度）')
im = Image.open(RAW).convert('RGBA')
a = np.asarray(im)
alpha = a[:, :, 3]
col_op = alpha.max(axis=1)          # 每行是否存在不透明像素
row_op = alpha.max(axis=0)          # 每列是否存在不透明像素

xs = np.where(row_op > 8)[0]
x0, x1 = int(xs.min()), int(xs.max()) + 1
# ★ 卡片高度：从顶部往下找**第一条整行全透明的行** —— 那就是卡片下沿。
#   卡片自身除四角圆弧外全不透明，故卡片内部不存在"全透明行"；而卡片与说明块之间有透明间隙。
#   （第 27 轮首版用"alpha 边界的最外接矩形"，把下方的页面说明块一起框进来了 → 高度虚高到 2322。）
y0 = int(np.where(col_op > 8)[0].min())
y1 = None
for y in range(y0 + 10, im.height):
    if col_op[y] == 0:
        y1 = y
        break

print('  RAW %dx%d · 卡片 x[%d,%d) · 上沿 y=%d · 下沿 y=%s' % (im.width, im.height, x0, x1, y0, y1))

chk('卡片宽度 = %d（632 × %d）' % (632 * DPX, DPX), x1 - x0 == 632 * DPX, '实测 %d' % (x1 - x0))
chk('卡片两侧贴满视口（本设计即满宽）', x0 == 0 and x1 == im.width,
    'x0=%d x1=%d 视口宽 %d' % (x0, x1, im.width))
chk('卡片上沿在 y=0（未向上被截断）', y0 == 0, 'y0=%d' % y0)
chk('找到卡片下沿（card 下方存在透明间隙 → 未被截断）', y1 is not None,
    '下沿 y=%s' % y1)
if y1 is None:
    print('\n无法确定卡片下沿，中止'); sys.exit(1)
h = y1 - y0
chk('卡片高度落在合理区间 [1900, 2200]', 1900 <= h <= 2200, '实测 %d px（CSS %.1f）' % (h, h / DPX))

im.crop((x0, y0, x1, y1)).save(OUT)
card = Image.open(OUT).convert('RGBA')
ca = np.asarray(card)
print('  产出 %s  %dx%d  %.1f KB（CSS %.0f×%.0f）' % (
    os.path.basename(OUT), card.width, card.height, os.path.getsize(OUT) / 1024.0,
    card.width / DPX, card.height / DPX))

# ══════════ ③ 透明与不透明 ══════════
print('\n③ 透明底自证')
K = 6
corners = {
    '左上': ca[:K, :K, 3], '右上': ca[:K, -K:, 3],
    '左下': ca[-K:, :K, 3], '右下': ca[-K:, -K:, 3],
}
cmax = max(int(m.max()) for m in corners.values())
chk('四角 alpha = 0（圆角外透明）', cmax == 0, '四角 alpha 最大值 %d' % cmax)
ctr = ca[ca.shape[0] // 2 - 40:ca.shape[0] // 2 + 40, ca.shape[1] // 2 - 40:ca.shape[1] // 2 + 40, 3]
chk('卡片内部不透明', int(ctr.mean()) >= 250, '中心 alpha 均值 %.1f' % ctr.mean())

# ══════════ ④ 「被删的那行」双向真值标定 ══════════
print('\n④ 被删说明行 · 双向真值标定（判据先在已知真值的旧图上跑通）')

def panel_bottom_border_y(arr, x0, x1, y_from):
    """找出「面板下边框」所在行：整行几乎每列都有明显亮线（金色描边比表格分隔线亮得多）。"""
    mx = arr[:, x0:x1, :3].max(axis=2)
    score = (mx > 55).mean(axis=1)
    rows = [y for y in range(y_from, arr.shape[0]) if score[y] > 0.85]
    return rows[-1] if rows else None

def ink(arr, x0, x1, ya, yb):
    """带内「墨量」：像素与全带中位色的绝对差之和的均值。平坦背景 ≈ 0，有文字明显抬升。"""
    band = arr[max(0, ya):yb, x0:x1, :3].astype(np.int16)
    med = np.median(band.reshape(-1, 3), axis=0)
    return float(np.abs(band - med).sum(axis=2).mean())

BAND_TOP, BAND_BOT = 75, 10        # 面板下边框**上方** 10~75px

# —— 真值侧：旧图（.figDice 单独导出，底边框就在图像最底部附近）
oa = np.asarray(Image.open(OLD).convert('RGB'))
ob = panel_bottom_border_y(oa, 0, oa.shape[1], oa.shape[0] // 2)
print('  旧图 %dx%d · 检出下边框 y=%s（真值：应贴近图像底边 %d）' % (oa.shape[1], oa.shape[0], ob, oa.shape[0] - 1))
chk('旧图上判据可用（检出下边框且贴底）', ob is not None and ob >= oa.shape[0] - 8)
ink_old = ink(oa, 0, oa.shape[1], ob - BAND_TOP, ob - BAND_BOT)
print('  旧图该带墨量 = %.2f（真值：含「和值 2–12：…」文字，应明显 > 0）' % ink_old)

# —— 待判侧：新图（整页卡片，面板位置相同 x 区间）
nb = panel_bottom_border_y(ca, PANEL_X0, PANEL_X1, ca.shape[0] // 2)
print('  新图 %dx%d · 检出骰子面板下边框 y=%s' % (card.width, card.height, nb))
chk('新图上判据可用（检出骰子面板下边框）', nb is not None)
ink_new = ink(ca, PANEL_X0, PANEL_X1, nb - BAND_TOP, nb - BAND_BOT)
print('  新图该带墨量 = %.2f（期望：≈ 0，文字已删）' % ink_new)

chk('旧图该带有墨（真值成立）', ink_old >= 2.0)
chk('新图该带无墨（文字确实被删）', ink_new <= 1.0)
chk('新旧对比方向正确（降幅 ≥ 5 倍）', ink_new * 5 <= ink_old,
    '%.2f → %.2f（降 %.0f%%）' % (ink_old, ink_new, 100 * (1 - ink_new / max(ink_old, 1e-6))))

print('\n%s' % ('全部自证通过' if ok_all else '存在未通过项 —— 见上方 ❌'))
sys.exit(0 if ok_all else 1)
