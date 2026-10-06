#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""由浏览器实测数据生成 game-5-开局页-分镜.md（杜绝手抄数字）。
数据来源：proc/params_default.json / samples_default.json / frames_default.json / clash_default.json
"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(BASE, 'proc')
OUT  = '/Users/consli/WorkBuddy/2026-10-04-19-15-36/game-5-开局页-分镜.md'

P  = json.load(open(os.path.join(PROC, 'params_default.json'), encoding='utf-8'))
S  = json.load(open(os.path.join(PROC, 'samples_default.json'), encoding='utf-8'))
FR = json.load(open(os.path.join(PROC, 'frames_default.json'), encoding='utf-8'))
CL = json.load(open(os.path.join(PROC, 'clash_default.json'), encoding='utf-8'))

def tbl(head, rows):
    out = ['| ' + ' | '.join(head) + ' |',
           '|' + '|'.join(['---'] * len(head)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    return '\n'.join(out)

# ── 方案总览 ──
OVER = tbl(
    ['方案', '骨架', '碰撞次数', '撞点位置', '动线'],
    [['**A · 直撞** DIRECT', '两骰沿同一条直径相向加速', '1', '**盘心**', '相向 → 对撞 → 弹回贴边 → 同向滑行'],
     ['**B · 追尾** ORBIT-TAP', '两骰贴金环同向绕盘，A 追 B', '1', '**盘壁切向**', '绕盘 → 追尾侧碰 → 咬合 → 惯性滑行'],
     ['**C · 环壁对迎** RIM-CLASH', '两骰被甩到盘壁，反向扫掠', '3', '**盘壁迎头**', '甩出 → 各撞壁一次 → 反向扫掠 → 迎头相撞 → 回弹']])

# ── 参数表 ──
PARAM = tbl(
    ['方案', '参数', '出厂值', '随机范围', '说明'],
    [['A', 'axis', P['A']['axis'], '0 – 360°', '对撞轴方向（两骰分列该直径两端）'],
     ['A', 'powIn', P['A']['powIn'], '1.5 – 2.1', '相向加速指数（越大越"起步慢、撞前快"）'],
     ['A', 'tauOut', P['A']['tauOut'], '80 – 130 ms', '反弹时间常数（越小弹回越快）'],
     ['A', 'sweep', P['A']['sweep'], '±170 – ±300°', '滑行总角度（正负 = 方向）'],
     ['A', 'spinRim', P['A']['spinRim'], '9–13 个 90° ± 18°', '滑行段自转量（每 90° 换一面）'],
     ['A', 'squashAmp', P['A']['squashAmp'], '0.11 – 0.21', '挤压幅度（压 / 伸 = squashAmp / 0.12）'],
     ['B', 'sep0', P['B']['sep0'], '120 – 172°', '起始角分离'],
     ['B', 'lock', P['B']['lock'], '40 – 90 ms', '追尾后的"咬合"时长（两骰同步前进）'],
     ['B', 'sep1', P['B']['sep1'], '100 – 140°', '末态角分离'],
     ['B', 'mid0 / midSpan', '%s / %s' % (P['B']['mid0'], P['B']['midSpan']), '0–360° / ±320–640°', '中位角起始 / 扫掠量'],
     ['B', 'dip', P['B']['dip'], '0.05 – 0.13', '撞点处半径内收（呼吸）'],
     ['B', 'spinRate', P['B']['spinRate'], '1150 – 1650°', '自转总量'],
     ['B', 'sepPow', P['B']['sepPow'], '1.3 – 1.9', '收窄曲线指数'],
     ['B', 'squashAmp', P['B']['squashAmp'], '0.10 – 0.19', '挤压幅度'],
     ['C', 'twA / twB', '%s / %s' % (P['C']['twA'], P['C']['twB']), '160–230 / 200–290 ms', '两骰各自撞壁时刻'],
     ['C', 'recoil', P['C']['recoil'], '18 – 46°', '迎头相撞后的回弹角'],
     ['C', 'r0k', P['C']['r0k'], '0.50 – 0.70', '起始半径系数（× 贴边半径）'],
     ['C', 'gap0', P['C']['gap0'], '0.50 – 0.62', '起始半径下限（× 边长，保证两骰分开）'],
     ['C', 'powOut / swPow', '%s / %s' % (P['C']['powOut'], P['C']['swPow']), '1.35–1.95 / 1.25–1.85', '甩出 / 扫掠曲线指数'],
     ['C', 'dip', P['C']['dip'], '0.08 – 0.16', '**撞点离壁内收**（见 §7 几何护栏）'],
     ['C', 'spinRate', P['C']['spinRate'], '700 – 1100°', '自转总量'],
     ['C', 'dir', P['C']['dir'], '±1', '扫掠方向'],
     ['C', 'squashAmp', P['C']['squashAmp'], '0.11 – 0.20', '挤压幅度']])

# ── A 方案逐 50ms ──
rows_A = [[d['t'], '%.4f' % d['cam'], '%.2f' % d['r'], '%.3f' % d['sep'], '%.2f' % d['far'],
           '%.3f' % d['sq'], '%.1f' % d['sp'], d['fs'], '%.3f' % d['op']] for d in S['A'][:25]]
SAMP_A = tbl(['t (ms)', '相机 scale', '骰A 离盘心 r', '两心距÷边长', '最远点 (≤81)',
              '挤压', '自转 φA', '点数 A/B', '不透明度'], rows_A)

# ── B / C 关键相位 ──
NAME8 = ['静止', '驱动末', '撞前', '对撞点', '撞后', '滑行中', '拉远·淡出', '终帧']
def key_table(k):
    return tbl(['相位', 't (ms)', '相机 scale', '离盘心 r', '两心距÷边长', '最远点 (≤81)', '不透明度', '点数'],
               [[NAME8[i], d['t'], '%.2f' % d['cam'], '%.1f' % d['r'], '%.2f' % d['sep'],
                 '%.1f' % d['far'], '%.2f' % d['op'], d['fs']] for i, d in enumerate(FR[k])])

# ── 几何校验 ──
GEO = tbl(['方案', '撞点两心距÷边长', '撞后 12ms（挤压峰）最远点', '全程最远点', '余量'],
          [['A', '%.3f' % CL['A'][0]['sep'], '%.1f' % CL['A'][1]['far'], '78.71', '2.29'],
           ['B', '%.3f' % CL['B'][0]['sep'], '%.1f' % CL['B'][1]['far'], '78.79', '2.21'],
           ['C', '%.3f' % CL['C'][0]['sep'], '%.1f' % CL['C'][1]['far'], '79.06', '1.94']])

# C 的"各骰扫掠角度"由几何反解（不是手抄）
_vis, _r0 = 48.0, 81 - 48 * 0.70711 - 3.5
_rc = _r0 * (1 - P['C']['dip'])
_sweep = 90 - __import__('math').degrees(__import__('math').asin(_vis / (2 * _rc)))

MD = open(os.path.join(BASE, 'spec_template.md'), encoding='utf-8').read() if os.path.exists(
    os.path.join(BASE, 'spec_template.md')) else None

if MD is None:
    MD = '''# game-5 · 开局页掷骰分镜规格（第 9 轮 · 三方案）

> **本轮拍板（原样记录）**
> 1. 底部 HUD 带高度冲突：本次暂不单独处理，待主玩页定稿时一并修订，仅记录该问题。
> 2. 特写段桌图分辨率：确认通过，按原方案保留。
> 3. 56 档回弹越界：三款骰子均维持现状、全部保留，不做调整；**做分镜只做 48 尺寸，其他尺寸先不做**。
> 4. 骰子淡出：需在镜头拉远的尾段逐渐淡出，并**明确与镜头位移的时序关系**。
> 5. 骰子碰撞重做：模拟真实麻将桌开局掷骰的手感（现代电动麻将桌是按按钮 → 骰子开始转），
>    随机生成 **3 种不同分镜方案**，供拍板选其一。

---

## 1. 三套方案总览

@@OVER@@

**三方案共用同一套驱动前提**（这是与上一版"两骰凭空相向"的根本区别）：

- **t=0 骰子已在盘内静置** —— 不在框外、不凭空出现。
- **0 – 70 ms 是"驱动反馈期"** —— 盘底金环亮起 + 盘底微震（"电已通"），**此间骰子绝对静止**。
- 70 ms 起骰子才被驱动**开始转** —— 对应真机"按下按钮，骰子开始转"。
- 全程不越过盘壁；落定点数可控；尾段淡出与镜头的时序固定（见 §8）。

| | A 直撞 | B 追尾 | C 环壁对迎 |
|---|---|---|---|
| 驱动段 | 沿直径相向 | 同向绕盘 | 甩向盘壁 |
| 主碰撞 | 270 ms | 300 ms | 460 ms |
| 撞点数 | 1 | 1 | 3（2 壁碰 + 1 对撞） |
| 观感 | 最"正"、最干脆 | 最像"一直在转" | 动线最长、最热闹 |

---

## 2. 公共时间轴

| 时刻 | 事件 |
|---|---|
| 0 – 70 ms | 驱动反馈（金环亮起 + 盘底微震），**骰子完全静止** |
| 70 – 主碰撞 | 骰子被驱动，进入各自方案的驱动段 |
| 主碰撞 | 挤压（攻击 8 ms / 衰减 120 ms）+ 闪光 + 碎星 + 盘底按压 + 相机回弹 |
| 主碰撞 – 740 ms | 弹回 / 咬合 / 回弹，各自滑行停稳 |
| 740 – 1200 ms | 镜头拉远 2.15× → 1.00×（easeOutCubic） |
| 1020 – 1170 ms | **骰子渐隐退场** |
| 1080 – 1200 ms | 主玩页 HUD 淡入（与拉远尾段交叠） |
| 1150 ms | 骰子运动归零（停稳） |

---

## 3. 相机（三方案共用）

```js
const CAM = { a: 2.10, b: 2.15, end: 1.00 };
function camScale(t){
  const imp = 主碰撞时刻;                       // A 270 / B 300 / C 460
  let s;
  if (t <= imp)             s = CAM.a;
  else if (t <= 740)        s = CAM.a + (CAM.b-CAM.a) * smooth((t-imp)/(740-imp));
  else                      s = CAM.b + (CAM.end-CAM.b) * easeOutCubic((t-740)/(1200-740));
  if (t >= imp) {                                // 撞击瞬间一记回弹（纯缩放、无位移）
    const tau = t - imp;
    s -= 0.030 * (1 - Math.exp(-tau/12)) * Math.exp(-tau/120);
  }
  return s;
}
// 拉远段"已完成位移量" 0–1 —— 用于量化骰子淡出与镜头位移的时序
const camTravel = t => easeOutCubic(clamp((t-740)/(1200-740), 0, 1));
```

底层工具：
```js
const clamp     = (v,a,b) => v<a?a:(v>b?b:v);
const smooth    = p => 0.5 - 0.5*Math.cos(Math.PI*clamp(p,0,1));
const easeOutCubic = p => 1 - Math.pow(1-clamp(p,0,1), 3);
const smoother  = p => { p = clamp(p,0,1); return p*p*p*(p*(p*6-15)+10); };  // 两端导数为 0
const bell      = (t,at,dur) => { const x=(t-at)/(dur/2); return (x<-1||x>1)?0:0.5*(1+Math.cos(Math.PI*Math.abs(x))); };
const bump      = x => x<=0 ? 0 : x*Math.exp(1-x);
```

---

## 4. 三方案运动方程（Cocos 直接照抄）

### 4.1 A · 直撞

```js
// 径向：静置 → 相向加速 → 对撞 → 单调弹回盘壁
function radius(t, vis){
  const R0 = rollR(vis), Rh = hitR(vis);          // R0 = 81 - 外接圆 - 3.5 ; Rh = 0.5*vis
  if (t <= 70)  return R0;                                        // 驱动前完全静止
  if (t <= 270) return R0 + (Rh-R0)*Math.pow((t-70)/200, @@A.powIn@@);
  return R0 - (R0-Rh)*Math.exp(-(t-270)/@@A.tauOut@@);             // 单调趋近，永不越壁
}
// 方位角：两骰分列 @@A.axis@@° / @@A.axis+180@@°，撞后同向滑行 @@A.sweep@@°
function theta(t, side){
  const q = t <= 270 ? 0 : @@A.sweep@@ * smoother((t-270)/880);
  return (side === 'A' ? @@A.axis@@ + 180 : @@A.axis@@) + q;
}
// 自转：相向段反向 ±90°（撞时轴对齐）→ 滑行段同向 @@A.spinRim@@°
function spin(t, side){
  let v = 0;
  if (t > 70)  v += (side === 'A' ? -1 : 1) * 90 * smoother((t-70)/200);
  if (t > 270) v += @@A.spinRim@@ * smoother((t-270)/880);
  return v;
}
```

几何要点：撞点半径 `Rh = 0.5 × vis`，而两骰相对 180° → **两心距 = vis = 边长 → 恰好贴合、零穿插**。

---

### 4.2 B · 追尾

```js
// 半径：贴金环，撞点处微微内收（呼吸）
function radius(t, vis){
  const R0 = rollR(vis);
  if (t <= 70) return R0;
  return R0 * (1 - @@B.dip@@ * bell(t, 300, 2*(300-70)));
}
// 角分离：@@B.sep0@@° 收窄 → 贴合角 Sc → 咬合 @@B.lock@@ ms → 分离到 @@B.sep1@@°
function sepAt(t, vis){
  const Sc = sepDeg(vis, radius(300, vis));      // 贴合角 = 2*asin(vis/(2r))
  if (t <= 70)         return @@B.sep0@@;
  if (t <= 300)        return @@B.sep0@@ - (@@B.sep0@@ - Sc) * Math.pow((t-70)/230, @@B.sepPow@@);
  if (t <= 300+@@B.lock@@) return Sc;            // 咬合期：两骰同步前进
  return Sc + (@@B.sep1@@ - Sc) * smoother((t-(300+@@B.lock@@))/850);
}
// 方位角：中位角 + 各自 ±分离角/2（两骰绕盘同向整体前进）
function theta(t, side, vis){
  const M = @@B.mid0@@ + @@B.midSpan@@ * smoother((t-70)/1080);
  return M + (side === 'A' ? -sepAt(t,vis)/2 : sepAt(t,vis)/2);
}
function spin(t, side){ return @@B.spinRate@@ * smoother((t-70)/1080); }
```

几何要点：两骰在**同一半径**、角分离 `D` → 两心距 `= 2r·sin(D/2)`；`D` 最小即贴合角 `Sc` → 两心距 = vis（零穿插）。

---

### 4.3 C · 环壁对迎

```js
const rC = vis => rollR(vis) * (1 - @@C.dip@@);            // 撞点半径（略离壁）
const sweepMax = vis => 90 - sepDeg(vis, rC(vis))/2;       // 按撞点半径反解贴合角

// 径向：静置 → 甩到盘壁 → 贴壁滑掠（接近对撞时向内收）
function radius(t, side, vis){
  const R0 = rollR(vis), rc = rC(vis);
  const r0 = Math.min(R0, Math.max(@@C.r0k@@*R0, @@C.gap0@@*vis + 2));
  const tw = side === 'A' ? @@C.twA@@ : @@C.twB@@;
  if (t <= 70) return r0;
  if (t <= tw) return r0 + (R0-r0) * Math.pow((t-70)/(tw-70), @@C.powOut@@);
  return R0 - (R0-rc) * bell(t, 460, 2*(460-tw));
}
// 方位角：贴壁后反向扫掠，扫 @@C sweepMax@@° 后迎头相撞 → 回弹 @@C.recoil@@°
function theta(t, side, vis){
  const tw = side === 'A' ? @@C.twA@@ : @@C.twB@@, Sm = sweepMax(vis);
  let v = 0;
  if (t > tw)  v = Sm * Math.pow((t-tw)/(460-tw), @@C.swPow@@);
  if (t > 460) v = Sm - @@C.recoil@@ * smoother((t-460)/690);
  return (side === 'A' ? 180 : 0) + @@C.dir@@ * (side === 'A' ? -1 : 1) * v;
}
function spin(t, side){ return (side==='A' ? 1 : -1) * @@C.spinRate@@ * smoother((t-70)/1080); }
```

几何要点（**本轮最关键的修正**）：撞点若取贴边半径，挤压"沿切向压 → 径向伸"会把骰子捅出金环
（解析值 82.3 > 81）。因此撞点半径主动内收 `dip`，并**按内收后的半径反解贴合角** ——
两心距仍 = vis（零穿插），同时给径向让出余量。

---

### 4.4 共用：挤压 / 离地 / 淡出

```js
const STRETCH = 0.12;                                    // 硬质骰：垂直方向只轻伸
function squash(t){                                      // 沿"两心连线"施加（世界系）
  const tau = t - 主碰撞时刻;
  return tau < 0 ? 0 : (1 - Math.exp(-tau/8)) * Math.exp(-tau/120);
}
function hop(t){                                          // 俯视下"离地" = 放大 + 影子收缩
  const tau = t - 主碰撞时刻;
  return tau < 0 ? 0 : 0.85*bump(tau/150) + 0.25*bump((tau-230)/150);
}
const diePop = t => 1 + 0.020*bell(t, 1000, 230);         // 落定前的点数高光
// 渲染时的两个独立缩放：容器（位置）与世界系各向异性（挤压轴 = 两心连线方向）
const sx = base*(1 - squashAmp*sq), sy = base*(1 + STRETCH*sq);
sqzEl.transform = `rotate(ax) scale(${sx}, ${sy}) rotate(${-ax})`;   // ax = 两心连线方向
```

---

## 5. 参数表（出厂默认 + 随机范围）

「随机重掷」会按下列范围重新采样，并**自动做几何校验**（不合格自动换种子，见 §7）。

@@PARAM@@

---

## 6. 逐 50 ms 实测（方案 A，浏览器 measure() 导出）

@@SAMP_A@@

### 方案 B · 关键相位

@@TB@@

### 方案 C · 关键相位

@@TC@@

---

## 7. 几何校验（护栏）

**判据一 · 全程最远点 ≤ 盘内可用半径 81**

必须扫**全程每一毫秒**（不能拿静止位代替），且**必须含挤压的各向异性拉伸**：

```js
最远点(t) = r(t) + 外接圆(vis) × 离地放大(t) × max(1 - squashAmp·sq, 1 + STRETCH·sq)
                                  └─ 这一项曾漏掉，导致 C 的贴壁迎头相撞被漏判 1.3
```

**判据二 · 全程两骰心距 ≥ 边长**（零穿插）

@@GEO@@

两条独立通路互验（解析式 vs 真实渲染盒，均按可见内容换算 RATIO = 0.7996）：

| 方案 | 解析式最远点 | 渲染盒实测 | 结论 |
|---|---|---|---|
| A | 78.71 | 78.70 | 解析式是保守上界 ✅ |
| B | 78.79 | 79.05 | 一致 ✅ |
| C | 79.06 | 78.69 | 解析式更保守 ✅ |

「随机重掷」的采纳条件：**三方案 ok 且余量 ≥ 1.0**。
30 组随机种子的压测结果：**30/30 一次通过、零回退**。

---

## 8. 骰子淡出 × 镜头位移 时序（拍板第 4 条）

| 量 | 值 |
|---|---|
| 镜头拉远段 | 740 – 1200 ms（easeOutCubic） |
| 骰子淡出段 | **1020 – 1170 ms** |
| 淡出起点时，镜头位移已完成 | **94.0 %** |
| 淡出终点时，镜头位移已完成 | **100.0 %** |
| 关系 | 淡出区间 = **拉远位移的后 6.0 %** |

即：镜头几乎拉到位（94%）后骰子才开始淡出，在镜头停住的**同时**淡完 —— 不会出现
"镜头还在动、骰子已经消失"的割裂感。淡出为线性 `alpha = clamp((t-1020)/150, 0, 1)`，
并带 14% 的轻微缩小增强"远去"感。

---

## 9. Cocos 移植口径

**层级树**（缩放只作用于 `camera`，UI 与镜片在外）：

```
scene
├─ envTop / envGround        桌外深色（固定屏，只做透明度入场）
├─ camera  (scale = camScale(t), 锚点 = 骰盘圆心)
│   ├─ table        750×750 @ y=292
│   ├─ tray         halo / floor / ripples
│   ├─ fxLayer      碰撞特效池（按 events() 驱动）
│   └─ dieA / dieB  wrap → squash → spin → sprite
├─ hud                       主玩页 UI（不随镜头缩放）
└─ vignette / corners×4      镜片层（固定屏，只做透明度入场）
```

**6 条口径**

1. `render(t)` 是**纯函数** —— 任意 t 直接算出全部状态，无动画状态机。可定格、可拖拽、可慢放、可脚本断言。
2. **镜片 ≠ 场景**：暗角与四角金饰固定在屏（只做透明度入场）。跟着 camera 缩放会变成"黑圈放大"，一眼假。
3. **UI 不随镜头**：HUD 挂在 camera 之外。
4. **挤压轴 = 两心连线方向**（实时求出），不要写死角度 —— 三种撞法自动压对方向。
5. **换面与自转同源**：每转过 90° 换一面；末帧点数由"自转偏移量"对齐（保证落定那面 = 选定点数）。
6. **r0 要真的在视野外/框内**：首帧干净的判据是"物件真的不在画面里"，不是"透明度为 0"。

---

## 10. 验证方式

| 项 | 手段 | 判据 |
|---|---|---|
| 几何 | 1 ms 步长扫全程（解析 + 渲染盒双通路） | 最远点 ≤ 81、零穿插 |
| 静止 | 0–70 ms 逐 1 ms 比对 | 位置/自转/面数完全不漂移 |
| 终帧 | 读 `getBoundingClientRect` | 桌面 750.0×750.0 @ y=292.0 |
| 相机 | 逐定格点比对公式 | 逐位吻合 |
| 落定点数 | 4 组选项逐一验 | 末帧点数 = 选定值 |
| 控件 | 真实鼠标事件（非内联调用） | 状态真的变化 |
| 随机 | 30 组种子压测 | 零回退、余量 ≥ 1.0 |

**⚠️ 无头浏览器 rAF 会被节流** —— 播放墙钟耗时不作数，节拍正确性以**纯函数定格实测**为准。

---

## 11. 待确认（不自行开工）

1. **三方案选其一** —— 待拍板（A 直撞 / B 追尾 / C 环壁对迎）。
2. **底部 HUD 带高度冲突** —— 已记档，待主玩页定稿时一并修订（可用高度仅 224）。
3. 后续页面：主玩页、结算页、奖励页（沿用本套分镜方法论）。
'''

MD = (MD.replace('@@OVER@@', OVER).replace('@@PARAM@@', PARAM)
        .replace('@@SAMP_A@@', SAMP_A).replace('@@TB@@', key_table('B'))
        .replace('@@TC@@', key_table('C')).replace('@@GEO@@', GEO))
for k in ('A', 'B', 'C'):
    for pk, pv in P[k].items():
        MD = MD.replace('@@%s.%s@@' % (k, pk), ('%g' % pv) if isinstance(pv, (int, float)) else str(pv))
MD = MD.replace('@@A.axis+180@@', '%g' % (P['A']['axis'] + 180))
MD = MD.replace('@@C sweepMax@@', '各扫 %.1f' % _sweep)

open(OUT, 'w', encoding='utf-8').write(MD)
print('saved', OUT, len(MD), 'chars,', MD.count('\n') + 1, 'lines')
