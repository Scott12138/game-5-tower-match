# -*- coding: utf-8 -*-
"""开局页定稿资产 · 投产质量核验
桌图 C：边长精度 / 正交度（毡面左右边缘收敛差）/ 骰盘圆心与直径 / 四边完整性
骰子 bone4：alpha 软边比例 / 白边检测 / 点数连通域计数 / 内容边界框与安全边距
"""
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = '/Users/consli/WorkBuddy/2026-10-04-19-15-36'
TABLE = ROOT + '/docs-verify/game-5/game-start/proc/engine/table_C_750.jpg'
DICE = ROOT + '/docs-verify/game-5/game-start/proc/dice/dice_vec_bone4_320.png'

fails = []
lines = []


def hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    v = mx
    h = np.zeros_like(mx); nz = d > 1e-6
    i = nz & (mx == r); h[i] = (60 * ((g[i] - b[i]) / d[i])) % 360
    i = nz & (mx == g); h[i] = 60 * ((b[i] - r[i]) / d[i]) + 120
    i = nz & (mx == b); h[i] = 60 * ((r[i] - g[i]) / d[i]) + 240
    return h, s, v


# ============ 桌图 ============
im = Image.open(TABLE).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255
H, W = a.shape[:2]
lines.append('=== 桌图 C（%s）===' % TABLE.split('/')[-1])
lines.append('尺寸 %d × %d   （目标 750 × 750）' % (W, H))
if (W, H) != (750, 750):
    fails.append('桌图尺寸 ≠ 750×750')

h_, s_, v_ = hsv(a)
felt = (h_ > 95) & (h_ < 175) & (s_ > 0.22) & (v_ > 0.10)

# 1) 正交度：毡面左右边缘斜率收敛差
ys, xs = np.where(felt)
y0, y1 = ys.min(), ys.max()
Y, L, R = [], [], []
for y in range(int(y0 + (y1 - y0) * 0.20), int(y0 + (y1 - y0) * 0.85), 6):
    xr = np.where(felt[y])[0]
    if len(xr) > 60:
        Y.append(y); L.append(xr.min()); R.append(xr.max())
Y = np.array(Y); L = np.array(L); R = np.array(R)
kl = np.polyfit(Y, L, 1)[0] * 100
kr = np.polyfit(Y, R, 1)[0] * 100
conv = abs(kl - kr)
lines.append('正交度（毡面左右边缘收敛差）%.2f px/100px   （0 = 严格正交；< 5 视为可用）' % conv)
if conv > 5:
    fails.append('正交度 %.2f > 5，桌图带明显透视' % conv)

# 2) 毡面上下宽度差（复检）
ws = []
for y in range(int(y0 + (y1 - y0) * 0.20), int(y0 + (y1 - y0) * 0.85), 6):
    xr = np.where(felt[y])[0]
    if len(xr) > 60:
        ws.append(xr.max() - xr.min() + 1)
ws = np.array(ws, dtype=np.float32)
taper = (ws.max() - ws.min()) / ws.mean() * 100
lines.append('毡面上下宽度波动 %.2f%%   （< 1.5%% 视为等宽）' % taper)

# 3) 骰盘：金环 圆心 / 半径 / 长宽比
gold = (h_ > 26) & (h_ < 64) & (s_ > 0.28) & (v_ > 0.32)
gm = gold.copy()
gm[:int(H * .22), :] = False; gm[int(H * .78):, :] = False
gm[:, :int(W * .22)] = False; gm[:, int(W * .78):] = False
gy, gx = np.where(gm)
cx, cy = gx.mean(), gy.mean()
rx = np.percentile(np.abs(gx - cx), 99)
ry = np.percentile(np.abs(gy - cy), 99)
ratio = rx / ry
lines.append('骰盘圆心 归一化 (%.4f, %.4f)  →　750 设计值 (%.0f, %.0f)  →　屏绝对 y=292 时 (%.0f, %.0f)'
             % (cx / W, cy / H, cx / W * 750, cy / H * 750, cx / W * 750, 292 + cy / H * 750))
lines.append('骰盘直径 %.1f 设计值（占桌面边长 %.1f%%）  长宽比 %.4f（1 = 正圆）'
             % (rx * 2 / W * 750, rx * 2 / W * 100, ratio))
if abs(ratio - 1) > 0.05:
    fails.append('骰盘长宽比 %.4f 偏离正圆 > 5%%' % ratio)

# 4) 四边完整性：最外 1px 圈与内部 30px 处的色调差异应存在（说明有独立桌框），且四边不应出现"被切断的毡面大面积"
def ring_stats(n):
    top = a[n, :, :].reshape(-1, 3); bot = a[H - 1 - n, :, :].reshape(-1, 3)
    lef = a[:, n, :].reshape(-1, 3); rig = a[:, W - 1 - n, :].reshape(-1, 3)
    out = {}
    for k, arr in (('top', top), ('bot', bot), ('lef', lef), ('rig', rig)):
        m = arr.mean(0)
        out[k] = (m * 255).round().astype(int)
    return out


r0 = ring_stats(0)
lines.append('最外圈平均色  top %s  bot %s  left %s  right %s'
             % (tuple(r0['top']), tuple(r0['bot']), tuple(r0['lef']), tuple(r0['rig'])))
# 毡面触边检测：最外圈若有 >=8% 像素判为毡面 → 桌面被画幅裁切
edge_felt = {}
for k in ('top', 'bot', 'lef', 'rig'):
    if k == 'top':
        row = felt[0, :]
    elif k == 'bot':
        row = felt[H - 1, :]
    elif k == 'lef':
        row = felt[:, 0]
    else:
        row = felt[:, W - 1]
    edge_felt[k] = row.mean() * 100
lines.append('最外圈毡面像素占比  top %.1f%%  bot %.1f%%  left %.1f%%  right %.1f%%   （应全 ≈ 0）'
             % (edge_felt['top'], edge_felt['bot'], edge_felt['lef'], edge_felt['rig']))
for k, val in edge_felt.items():
    if val > 3:
        fails.append('桌图 %s 边毡面触边 %.1f%%（桌面被裁切）' % (k, val))

# ============ 骰子 ============
d = Image.open(DICE)
lines.append('')
lines.append('=== 骰子（%s）===' % DICE.split('/')[-1])
lines.append('尺寸 %s  mode %s' % (d.size, d.mode))
if d.mode != 'RGBA':
    fails.append('骰子无 alpha 通道')
da = np.asarray(d).astype(np.float32)
al = da[:, :, 3]
rgb = da[:, :, :3] / 255

op = al > 245
lines.append('不透明占比 %.1f%%   全透明占比 %.1f%%' % (op.mean() * 100, (al < 10).mean() * 100))

# 软边比例：alpha 处于中间地带（含抗锯齿 + 毛边）
soft = ((al > 10) & (al < 245)).sum()
edge_total = (al > 10).sum()
lines.append('软边像素占比 %.2f%%（抗锯齿正常值 < 6%%，过高=毛边）' % (soft / max(edge_total, 1) * 100))
if soft / max(edge_total, 1) > 0.06:
    fails.append('骰子软边占比 %.1f%% 偏高，边缘可能有毛刺' % (soft / max(edge_total, 1) * 100))

# 白边检测：在不透明区域向外膨胀 2px 的壳层里找"近白高不透明"像素
dil = ndimage.binary_dilation(op, iterations=3)
shell = dil & (~op)
lum = rgb.mean(-1)
sat = np.where(rgb.max(-1) > 1e-6, (rgb.max(-1) - rgb.min(-1)) / np.maximum(rgb.max(-1), 1e-6), 0)
white_shell = shell & (lum > 0.86) & (sat < 0.18) & (al > 60)
lines.append('外沿壳层近白像素数 %d（应为 0，>200 说明有白毛边）' % white_shell.sum())
if white_shell.sum() > 200:
    fails.append('骰子外沿存在白毛边 %d 像素' % white_shell.sum())

# 点数：朱红连通域计数（应 = 4）
h2, s2, v2 = hsv(rgb)
red = ((h2 < 22) | (h2 > 345)) & (s2 > 0.45) & (v2 > 0.30) & op
lab, n = ndimage.label(red)
sizes = ndimage.sum(red, lab, range(1, n + 1))
big = [s for s in sizes if s > 30]
lines.append('朱红点数连通域 %d 个（面积>30px 的 %d 个）  → 期望 4' % (n, len(big)))
if len(big) != 4:
    fails.append('骰子点数检测 = %d 个，期望 4 个' % len(big))

# 内容边界框与安全边距
cy_, cx_ = np.where(op)
bb = (cx_.min(), cy_.min(), cx_.max(), cy_.max())
mg = [bb[0], bb[1], d.size[0] - 1 - bb[2], d.size[1] - 1 - bb[3]]
lines.append('内容边界框 %s   四边留白 L%d T%d R%d B%d（裁剪到紧贴会让缩放时被切边）' % (bb, *mg))
if min(mg) < 6:
    fails.append('骰子内容边距过小 %d，缩放时易切边' % min(mg))
lines.append('单颗骰子实际边长 %d × %d' % (bb[2] - bb[0] + 1, bb[3] - bb[1] + 1))

# ============ 汇总 ============
lines.append('')
if fails:
    lines.append('❌ 不合格 %d 项：' % len(fails))
    for f in fails:
        lines.append('   - ' + f)
else:
    lines.append('✅ 全部通过 —— 桌图 C 与骰子（矢量骨白 4 点）可直接投产')

report = '\n'.join(lines)
print(report)
open(ROOT + '/docs-verify/game-5/game-start/verify_final.txt', 'w', encoding='utf-8').write(report)
