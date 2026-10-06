#!/usr/bin/env node
/**
 * ============================================================
 *  r40-motion-check.mjs · 开局页掷骰动画（方案 B「追尾」）运动学硬判据
 * ============================================================
 *
 *  【为什么这个脚本有资格当判据】
 *  它 **import 的是游戏本体用的同一份函数**（`assets/scripts/core/DiceMotion.ts`
 *  编译产物），而不是自己再抄一遍运动方程。
 *  —— 抄一遍只能验"两份抄写是否一致"；引用同一份才验得到"游戏里到底怎么跑的"。
 *
 *  【验的是什么】
 *  用户第 40 轮的诉求是「先掷骰 → 方案 B 追尾转弯后**定格** → 再拉远露出整张麻将桌，
 *  拉远不能太快」。这四件事都必须在**时间轴数据**上被钉死，不能靠"看着像"：
 *      A 零穿插        —— 两骰中心距 ÷ 边长 全程 >= 1.000（真源 §7 几何护栏）
 *      B 不捅出金环     —— 最远点半径 全程 <= 81
 *      C 追尾真的发生了 —— 角分离在 300ms 收敛到"贴合角"，此刻两心距 = 1.000
 *      D 真的有定格     —— t >= 1150 之后 半径/角分离/自转 **逐帧恒定**
 *      E 拉远确实在定格之后 —— 1149ms 时相机仍压在 2.15×，1150ms 之后才开始拉
 *      F 拉远够慢       —— 拉远段 = 800ms 且单调、无跳变
 *      G 拉远能露出整桌 —— 终点回到 1.000×
 *      H 点數对齐       —— 自转归零那一刻显示的面 == 本局掷出的点数（6 个面各验一次）
 *
 *  用法：node tools/r40-motion-check.mjs
 * ============================================================
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(HERE, '..');
const CREATOR = process.env.CREATOR || '/Applications/Cocos/Creator/3.8.8';
const TSC = `${CREATOR}/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc`;

// ------------------------------------------------------------
//  1. 编译纯函数模块（用 Cocos 自带的 tsc，与编辑器同版本）
// ------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'g5-dice-'));
try {
    execFileSync(process.execPath, [
        TSC,
        'assets/scripts/core/DiceMotion.ts',
        '--target', 'es2020',
        '--module', 'esnext',
        '--moduleResolution', 'node',
        '--skipLibCheck',
        '--rootDir', 'assets/scripts/core',
        '--outDir', outDir,
    ], { cwd: PROJ, stdio: 'pipe' });

    const js = readdirSync(outDir).find((f) => f.endsWith('.js'));
    if (!js) throw new Error(`编译产物没生成：${outDir}`);
    const mjs = join(outDir, 'DiceMotion.mjs');
    copyFileSync(join(outDir, js), mjs);

    const M = await import(pathToFileURL(mjs).href);

    // ------------------------------------------------------------
    //  2. 断言
    // ------------------------------------------------------------
    const fails = [];
    const rows = [];
    const ok = (name) => { rows.push([name, 'OK', '']); };
    const ng = (name, detail) => { rows.push([name, 'FAIL', detail]); fails.push(name); };

    const { TL, TOTAL_MS, R_IN, DIE_VIS, TRAY_DOM } = M;

    // ---- 扫全程（每 0.5ms，够密；拥挤区间只有几毫秒宽）----
    const STEP = 0.5;
    let minDist = Infinity, minDistAt = -1;
    let maxFar = -Infinity, maxFarAt = -1;
    let minCam = Infinity, maxCam = -Infinity;

    for (let t = 0; t <= TOTAL_MS + 1e-9; t += STEP) {
        const d = M.contactRatio(t, DIE_VIS);
        if (d < minDist) { minDist = d; minDistAt = t; }
        const f = M.farthest(t, DIE_VIS);
        if (f > maxFar) { maxFar = f; maxFarAt = t; }
        const c = M.camScaleAt(t);
        if (c < minCam) minCam = c;
        if (c > maxCam) maxCam = c;
    }

    // A. 零穿插
    if (minDist >= 1.0 - 1e-6) ok(`A 零穿插 · min(中心距/边长) = ${minDist.toFixed(6)} @ t=${minDistAt}ms`);
    else ng('A 零穿插', `min = ${minDist.toFixed(6)} @ t=${minDistAt}ms（< 1.000 即两骰穿模）`);

    // B. 不捅出金环
    if (maxFar <= R_IN) ok(`B 不捅出金环 · max(最远点) = ${maxFar.toFixed(2)} <= ${R_IN} @ t=${maxFarAt}ms`);
    else ng('B 不捅出金环', `max = ${maxFar.toFixed(2)} @ t=${maxFarAt}ms > ${R_IN}`);

    // C. 追尾真的发生：碰撞时刻两心距恰好 = 1.000（贴合角反解是否正确的唯一判据）
    const distAtImpact = M.contactRatio(TL.IMPACT, DIE_VIS);
    if (Math.abs(distAtImpact - 1) <= 2e-4) ok(`C 追尾贴合 · t=300ms 中心距/边长 = ${distAtImpact.toFixed(6)}`);
    else ng('C 追尾贴合', `t=300ms 中心距/边长 = ${distAtImpact.toFixed(6)}，应 = 1.000`);

    // C2. 角分离确实是从 150° 收窄到贴合角（而不是全程不动）
    const sep0 = M.bSep(0, DIE_VIS), sepLock = M.bSep(TL.IMPACT, DIE_VIS), sepEnd = M.bSep(TOTAL_MS, DIE_VIS);
    if (Math.abs(sep0 - 150) < 1e-6 && sepLock < 80 && Math.abs(sepEnd - 122) < 1e-6) {
        ok(`C2 角分离曲线 · 150° -> ${sepLock.toFixed(2)}°(咬合) -> ${sepEnd.toFixed(1)}°`);
    } else {
        ng('C2 角分离曲线', `150 -> ${sepLock.toFixed(2)} -> ${sepEnd.toFixed(2)}（期望 150 -> ~74.5 -> 122）`);
    }

    // D. 真的有定格：SETTLE 之后三个运动量逐帧恒定
    const probe = [TL.SETTLE, TL.SETTLE + 50, TL.SETTLE + 200, TOTAL_MS];
    const dr = probe.map((t) => M.bRadius(t, DIE_VIS));
    const ds = probe.map((t) => M.bSep(t, DIE_VIS));
    const dp = probe.map((t) => M.bSpin(t));
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const sp = Math.max(spread(dr), spread(ds), spread(dp));
    if (sp < 1e-9) ok(`D 定格 · t>=${TL.SETTLE}ms 半径/角分离/自转 逐帧恒定（极差 ${sp.toExponential(1)}）`);
    else ng('D 定格', `SETTLE 之后仍在动：半径极差 ${spread(dr).toExponential(2)} / 角分离 ${spread(ds).toExponential(2)} / 自转 ${spread(dp).toExponential(2)}`);

    // D2. 定格"之前"必须真的还在动 —— 否则"定格"可能是假的（整段本来就不动）。
    //     ⚠️ 判据要选**在定格前仍在变的量**：`自转` 在 SPIN_END(950ms) 就归零了
    //        （这是真源的有意设计：自转必须早于定格，玩家才看得清点数），
    //        用它当判据会假报警。真正一直变到 1150ms 的是**中位角**。
    const dMid = Math.abs(M.bMid(TL.SETTLE) - M.bMid(TL.SETTLE - 120));
    if (dMid > 0.5) ok(`D2 定格前确有运动 · 1030->1150ms 中位角仍在走 ${dMid.toFixed(2)}°`);
    else ng('D2 定格前确有运动', `SETTLE 前 120ms 中位角只动了 ${dMid.toFixed(3)}° —— 定格点其实是假的`);

    // D3. 自转归零必须**早于**定格（真源的硬要求：玩家要在停稳之前看清落定点数）
    const spinLocked = Math.abs(M.bSpin(TL.SPIN_END + 1) - M.bSpin(TL.SETTLE)) < 1e-9;
    if (spinLocked && TL.SPIN_END < TL.SETTLE) {
        ok(`D3 自转先于定格归零 · ${TL.SPIN_END}ms 归零 -> ${TL.SETTLE}ms 定格（提前 ${TL.SETTLE - TL.SPIN_END}ms 看点数）`);
    } else {
        ng('D3 自转先于定格归零', `SPIN_END=${TL.SPIN_END} / SETTLE=${TL.SETTLE}`);
    }

    // E. 拉远起点 = 定格时刻
    const camBefore = M.camScaleAt(TL.PULL - 1);
    const camAt = M.camScaleAt(TL.PULL);
    const camAfter = M.camScaleAt(TL.PULL + 120);
    if (camBefore >= 2.1499 && camBefore <= 2.1501 && camAfter < camBefore - 0.01) {
        ok(`E 拉远落在定格之后 · t=${TL.PULL - 1}ms 相机 ${camBefore.toFixed(4)}× -> t=${TL.PULL + 120}ms ${camAfter.toFixed(4)}×`);
    } else {
        ng('E 拉远落在定格之后', `${camBefore.toFixed(4)} / ${camAt.toFixed(4)} / ${camAfter.toFixed(4)}（期望 ~2.15 -> 下降）`);
    }

    // F. 拉远够慢 + 单调 + 无跳变。
    //    `easeOutCubic` 的**初始**斜率最大（= 3×平均速率），所以"最陡的那一帧"衡量的是
    //    拉远起步有多冲。拿它和定稿的 460ms 比：800ms 必须明显更平缓。
    const PULL_MS = TL.PULL_MS;
    const CAM_SPAN = M.CAM.b - M.CAM.end;
    let back = 0;
    for (let t = TL.PULL; t < TOTAL_MS; t += STEP) {
        if (M.camScaleAt(t + STEP) > M.camScaleAt(t) + 1e-9) back++;
    }
    let maxStep = 0;
    for (let t = TL.PULL; t < TOTAL_MS; t += STEP) {
        maxStep = Math.max(maxStep, Math.abs(M.camScaleAt(t + STEP) - M.camScaleAt(t)));
    }
    const perFrame = maxStep * (16.7 / STEP);                        // 换算到 60fps 一帧
    const perFrameRef = CAM_SPAN * 3 / 460 * 16.7;                   // 定稿 460ms 的同口径值
    if (PULL_MS >= 700 && back === 0 && perFrame <= perFrameRef * 0.75) {
        ok(`F 拉远平缓 · ${PULL_MS}ms（定稿 460ms）· 最陡一帧 ${perFrame.toFixed(4)}× vs 定稿 ${perFrameRef.toFixed(4)}×（降到 ${(perFrame / perFrameRef * 100).toFixed(0)}%）`);
    } else {
        ng('F 拉远平缓', `${PULL_MS}ms / 回退 ${back} 次 / 最陡一帧 ${perFrame.toFixed(4)}× vs 定稿 ${perFrameRef.toFixed(4)}×`);
    }

    // G. 拉远能露出整张桌子（回到 1.000×）
    const camEnd = M.camScaleAt(TOTAL_MS);
    if (Math.abs(camEnd - 1) < 0.002) ok(`G 拉远终点 · ${camEnd.toFixed(5)}×（露出整张 750 麻将桌）`);
    else ng('G 拉远终点', `${camEnd.toFixed(5)}×，期望 1.000`);

    // H. 点数对齐：自转归零那一刻显示的面 == 目标点数（6 面全验）
    let bad = [];
    for (let k = 1; k <= 6; k++) {
        const off = M.faceOffsetFor(k);
        const got = M.faceAt(TL.SPIN_END, off);
        if (got !== k) bad.push(`${k}->${got}`);
    }
    if (bad.length === 0) ok('H 落定点数对齐 · 1..6 全部 faceAt(950ms) == 目标点数');
    else ng('H 落定点数对齐', `不一致：${bad.join(' ')}`);

    // H2. 自转归零后就该锁死点数（往后不再换面）
    const faceSeq = [TL.SPIN_END, TL.SPIN_END + 100, TOTAL_MS].map((t) => M.faceAt(t, M.faceOffsetFor(4)));
    if (faceSeq.every((v) => v === 4)) ok('H2 换面锁定 · 自转归零后 100ms / 动画结束 都仍是落定面');
    else ng('H2 换面锁定', `${faceSeq.join(' / ')}`);

    // ---- 逐 50ms 对账表（与真源 §6「方案 B 关键相位」同口径）----
    const table = [];
    for (const t of [0, 70, 150, 240, 300, 360, 420, 600, 950, 1150, 1450, 1750, 1950]) {
        table.push({
            t,
            cam: M.camScaleAt(t),
            r: M.bRadius(t, DIE_VIS),
            sep: M.bSep(t, DIE_VIS),
            dist: M.contactRatio(t, DIE_VIS),
            far: M.farthest(t, DIE_VIS),
        });
    }

    // ------------------------------------------------------------
    //  3. 输出
    // ------------------------------------------------------------
    console.log('');
    console.log('  开局页掷骰 · 方案 B「追尾」运动学判据（与游戏同源，非另抄一份公式）');
    console.log('  ' + '-'.repeat(74));
    for (const [name, st, detail] of rows) {
        const tag = st === 'OK' ? '[OK]  ' : '[FAIL]';
        console.log(`  ${tag} ${name}${detail ? '  · ' + detail : ''}`);
    }
    console.log('  ' + '-'.repeat(74));
    console.log('  相位对账（DOM 桌面坐标系；两心距/边长 = 1.000 即刚好贴合）');
    console.log('    t(ms)  相机×    半径     角分离    中心距/边    最远点');
    for (const r of table) {
        console.log(`    ${String(r.t).padStart(5)}  ${r.cam.toFixed(4)}  ${r.r.toFixed(2).padStart(7)}  ${r.sep.toFixed(1).padStart(7)}  ${r.dist.toFixed(4).padStart(9)}  ${r.far.toFixed(2).padStart(7)}`);
    }
    console.log('  ' + '-'.repeat(74));
    console.log(`  盘心 DOM 偏移 (${TRAY_DOM.dx}, ${TRAY_DOM.dy}) · 盘内可用半径 ${R_IN} · 总时长 ${TOTAL_MS}ms`);
    console.log(`  相机区间 ${minCam.toFixed(4)}× ~ ${maxCam.toFixed(4)}×`);
    console.log('');

    if (fails.length) {
        console.log(`[✗] ${fails.length} 项不通过：${fails.join(' / ')}`);
        process.exitCode = 1;
    } else {
        console.log(`[✓] 全部 ${rows.length} 项通过`);
    }
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
