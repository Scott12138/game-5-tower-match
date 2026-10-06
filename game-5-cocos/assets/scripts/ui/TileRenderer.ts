/**
 * ============================================================
 *  TileRenderer.ts · 牌面渲染（一张牌 = 一个 TileView）
 * ============================================================
 *  ★ 第 45 轮用户拍板后的**当前生效口径**（此前是"靠有影/无影表达"）：
 *
 *   ┌ 牌体（`.tile` / `.tile.imgmode`）
 *   │   本工程用 224×298 的 AI 母版，**图片自带金边与厚度** ⇒ 走 imgmode：
 *   │   不加底色、不加描边（加了会与图里的金边打架，边缘变成"双线毛刺"）
 *   ├ 可点（原 `.tile.live`）= **原色满亮 + 影加深（"浮起来"）**
 *   │   ⚠️ 第 45 轮**删掉了金环与三层外发光**。用户原话：
 *   │      「牌本占位符（黄色框框）…指的是每张牌周边的光晕」——
 *   │      实测他在截图上圈的那道暖金线（x=192~193）正好落在牌节点边界
 *   │      **外侧** 2~4px（牌图自带的金框在 x=202~206，是另一回事），
 *   │      即 `drawRing()` 画的主环 + 外发光。删掉后牌堆只剩牌图自身的金饰。
 *   └ 被压（原 `.tile.dead`）= **换灰阶贴图**（方案 C：grayscale .9 / brightness .66
 *      / contrast .95，离线烘好，见 `TileData.deadSpritePath`）。
 *      实测整图饱和 0.302 → 0.038（降到 13%），"彩色 = 能点"一眼可辨。
 *      ⚠️ 不再叠 `Sprite.color` 灰滤镜 —— 逐通道乘法**降不了饱和度**，
 *         红墨乘 0.66 还是红的（详见 `deadSpritePath` 的注释）。
 *
 *  ★ 横牌 = **纯旋转**：节点恒为牌体 w×h，只设 `angle = 90`。
 *     绝不允许"换宽高"——那会把牌面横向拉伸 1.33 倍（第 32 轮第 5 条明令禁止）。
 * ============================================================
 */

import { Color, Graphics, Layers, Node, Sprite, UIOpacity, UITransform, Vec3, v3 } from 'cc';

import { COLOR, FONT, SKIN } from '../CFG';
import { createLabel, createNode, fillRoundRect, loadFrame, strokeRoundRect } from './UIFactory';
import { hex2color } from './Palette';
import { deadSpritePath, decode, faceLabel, spritePath, type FaceCode } from '../core/TileData';

export type TileState =
    /** 可点：原色满亮 + 大影（"浮起来"） */
    | 'pick'
    /** 被压：灰阶贴图 + 几乎无影（"压住了"） */
    | 'cover'
    /** 系统锁定（例如入槽飞行中 / 胜负判定后禁止再点）：原色 + 更暗 */
    | 'lock';

export interface TileViewOpts {
    w: number;
    h: number;
    face: FaceCode;
    rot: 0 | 90;
    x: number;
    y: number;
}

/** 锁定态的原色压暗系数（入槽飞行中 / 面板盖住时）—— 与原来写死的 0.55 一致 */
const LOCK_K = 0.55;
/** 灰阶贴图**缺失**时的兜底压暗系数（正常路径走不到，只为不让被压牌仍是满亮彩色） */
const DEAD_FALLBACK_K = 0.62;

/** 把系数折成 `Sprite.color`（灰阶三通道等值 = 只压暗、不改色相） */
const tint = (k: number): Color => {
    const v = Math.round(255 * k);
    return new Color(v, v, v, 255);
};
const TINT_LOCK = tint(LOCK_K);
const TINT_WHITE = tint(1.0);
const TINT_DEAD_FALLBACK = tint(DEAD_FALLBACK_K);


export class TileView {
    public readonly node: Node;
    public readonly w: number;
    public readonly h: number;
    public readonly face: FaceCode;
    public rot: 0 | 90;

    private _sp: Sprite | null = null;
    private _faceNode: Node | null = null;
    private _spDead: Sprite | null = null;
    private _deadNode: Node | null = null;
    private _base: Graphics | null = null;
    private _fallback: Node | null = null;
    private _state: TileState = 'cover';

    constructor(parent: Node, name: string, o: TileViewOpts) {
        this.w = o.w;
        this.h = o.h;
        this.face = o.face;
        this.rot = o.rot;

        this.node = createNode(name, parent, { w: o.w, h: o.h, x: o.x, y: o.y });
        // 旋转中心必须是牌体中心 —— 节点锚点已是 (0.5,0.5)，所以直接设角度即可
        this.node.angle = o.rot === 90 ? 90 : 0;

        // ① 影（在牌体之下）
        const base = createNode('Base', this.node);
        this._base = base.addComponent(Graphics);

        // ② 牌面 —— **两张叠着**：原色（可点 / 锁定）与灰阶（被压，方案 C）。
        //    为什么用两个节点而不是切 `spriteFrame`：切贴图每次都要走一遍
        //    `loadFrame` 的异步回调（首帧会闪一下空白），而 `active` 开关是同步的、
        //    零加载；两张图的加载也各自只发生一次（`loadFrame` 内部有缓存）。
        //    图片虽自带金边，但**加载失败时**要有兜底，否则整局看不见牌。
        const faceNode = createNode('Face', this.node, { w: o.w, h: o.h });
        const sp = faceNode.addComponent(Sprite);
        // ⚠️ 顺序：先定模式、再赋贴图、最后显式写尺寸（写反会被 TRIMMED 改回原图尺寸）
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        this._sp = sp;
        this._faceNode = faceNode;
        faceNode.active = false;

        loadFrame(spritePath(o.face), (sf) => {
            if (!this.node.isValid) return;
            if (!sf) { this.buildFallback(); return; }
            sp.spriteFrame = sf;
            const ui = faceNode.getComponent(UITransform)!;
            ui.setContentSize(o.w, o.h);
            // 显隐交给 applyState 统一裁决（刚加载完时本张牌可能正是"被压"）
            this.applyState();
        });

        const deadNode = createNode('FaceDead', this.node, { w: o.w, h: o.h });
        const spDead = deadNode.addComponent(Sprite);
        spDead.sizeMode = Sprite.SizeMode.CUSTOM;
        spDead.trim = false;
        spDead.color = TINT_WHITE;          // 灰阶已在贴图里烘好，这里不再叠色
        this._spDead = spDead;
        this._deadNode = deadNode;
        deadNode.active = false;

        loadFrame(deadSpritePath(o.face), (sf) => {
            if (!this.node.isValid) return;
            // ⚠️ 加载失败**不**建兜底：还有原色那张可以顶着（兜底压暗由 applyState 负责）。
            //    这里静默即可，避免每张牌刷两遍 warn。
            if (!sf) return;
            spDead.spriteFrame = sf;
            deadNode.getComponent(UITransform)!.setContentSize(o.w, o.h);
            this.applyState();
        });

        // ③ 金环 / 外发光 —— **第 45 轮删除**（用户：牌周边的黄色框/光晕）
        //    原实现在 `Ring` 节点上画 3 层递减 alpha 的金色描边 + 1 道主环，
        //    实测那道主环落在牌体**外侧** 2~4px，看起来就像一个占位框。

        // ⚠️ `setState` 对相同状态会早退，而字段初值就是 'cover' ⇒ 这一次调用是空转，
        //    必须显式补一次 `applyState()`，否则"开局即被压"的牌会停在
        //    "两张贴图都 active=false"的空白态（第 45 轮实测踩到）。
        this.setState('cover');
        this.applyState();
    }

    /** 牌面图缺失时的矢量兜底：画一块牌 + 中文牌名，保证"没有素材也玩得下去" */
    private buildFallback(): void {
        if (!this.node.isValid || this._fallback) return;
        const grp = createNode('Fallback', this.node, { w: this.w, h: this.h });
        const g = grp.addComponent(Graphics);
        fillRoundRect(g, 0, 0, this.w, this.h, Math.max(6, this.w * 0.13), COLOR.IVORY, 255);
        strokeRoundRect(g, 0, 0, this.w, this.h, Math.max(6, this.w * 0.13), COLOR.EDGE, 2, 255);

        const f = decode(this.face);
        const isWan = f.suit === 'wan';
        const label = createLabel(grp, isWan ? `${f.num}` : `${f.num}`, {
            fontSize: Math.round(this.h * (isWan ? 0.46 : 0.44)),
            color: isWan ? COLOR.BROWN : COLOR.RED,
            bold: true, serif: true, w: this.w, h: this.h,
        });
        label.node.setPosition(0, isWan ? this.h * 0.02 : 0, 0);
        // 万能补一枚小花色字（条/筒在矢量兜底里只给数字 + 花色字）
        if (!isWan) {
            createLabel(grp, f.suit === 'tong' ? '筒' : '条', {
                fontSize: Math.round(this.h * 0.17), color: COLOR.BROWN, bold: true, serif: true,
            }).node.setPosition(0, -this.h * 0.30, 0);
        }
        this._fallback = grp;
        this._fallback.name = `Fallback_${faceLabel(this.face)}`;
        this.applyState();
    }

    // --------------------------------------------------------
    //  状态
    // --------------------------------------------------------

    public get state(): TileState { return this._state; }

    public setState(s: TileState): void {
        if (this._state === s) return;
        this._state = s;
        this.applyState();
    }

    private applyState(): void {
        const live = this._state === 'pick';
        const lock = this._state === 'lock';
        const dead = !live && !lock;

        // 矢量兜底态：只调透明度（原色都没加载出来，谈不上灰阶）
        if (this._fallback) {
            const op = this._fallback.getComponent(UIOpacity) ?? this._fallback.addComponent(UIOpacity);
            op.opacity = live ? 255 : (lock ? 150 : 210);
            this.drawBase(live, lock);
            return;
        }

        const hasColor = !!this._sp?.spriteFrame;
        const hasDead = !!this._spDead?.spriteFrame;
        // 灰阶图没到位时**退回原色**（宁可先彩色，也不能让牌空着）
        const useDead = dead && hasDead;

        if (this._faceNode) this._faceNode.active = !useDead && hasColor;
        if (this._deadNode) this._deadNode.active = useDead;
        if (this._sp) this._sp.color = lock ? TINT_LOCK : TINT_WHITE;
        if (this._spDead) this._spDead.color = TINT_WHITE;
        // 兜底：灰阶图缺失时把原色压暗，至少与"可点"拉开距离
        if (dead && !hasDead && this._sp) this._sp.color = TINT_DEAD_FALLBACK;

        this.drawBase(live, lock);
    }

    /** 影：可点 = 大而远（"浮起来"）；被压 = 几乎贴地（"压住了"） */
    private drawBase(live: boolean, lock: boolean): void {
        const g = this._base;
        if (!g) return;
        g.clear();
        if (lock) {
            fillRoundRect(g, 0, -3, this.w * 0.98, this.h * 0.97, this.w * 0.12, '#000000', 90);
            return;
        }
        if (live) {
            fillRoundRect(g, 0, -16, this.w * 0.97, this.h * 0.96, this.w * 0.12, '#000000', 140);
            fillRoundRect(g, 0, -9, this.w * 0.99, this.h * 0.98, this.w * 0.12, '#000000', 120);
        } else {
            fillRoundRect(g, 0, -3, this.w * 0.98, this.h * 0.97, this.w * 0.12, '#000000', 80);
        }
    }

    // --------------------------------------------------------
    //  位置 / 变换
    // --------------------------------------------------------

    public setPos(x: number, y: number): void {
        this.node.setPosition(x, y, 0);
    }

    public get pos(): Vec3 { return this.node.position; }

    /** 飞到目标点并缩到 `k`（视觉用；状态由调用方自己管） */
    public setFlyTransform(x: number, y: number, k: number, angle?: number): void {
        this.node.setPosition(x, y, 0);
        this.node.setScale(v3(k, k, 1));
        if (angle !== undefined) this.node.angle = angle;
    }

    /** 复位到"桌上的正常姿态"（洗牌 / 移出道具回桌时用） */
    public resetToBoard(x: number, y: number): void {
        this.node.setPosition(x, y, 0);
        this.node.setScale(v3(1, 1, 1));
        this.node.angle = this.rot === 90 ? 90 : 0;
        this.node.active = true;
    }

    public setVisible(v: boolean): void {
        this.node.active = v;
    }

    public destroy(): void {
        if (this.node.isValid) this.node.destroy();
    }
}

// ============================================================
//  槽内小牌（只读展示，不参与交互）
// ============================================================

/**
 * 建一个"槽内小牌"节点（不返回类，槽位条自己管回收）。
 *
 * 【为什么槽内牌单独一个函数而不是复用 TileView】
 *  ① 槽内不需要影 / 金环 / 可点态，带一整套 Graphics 是纯浪费（一局最多 9 个，但每次
 *     落位都会重建，138 张的关卡里这个开销是可见的）；
 *  ② 槽内牌要按**格子的 contain 尺寸**显示（68×80 格里塞 112×149 的牌），
 *     与桌上"1:1 原始尺寸"是两套缩放口径，混在一起容易写错。
 */
export function createSlotTile(parent: Node, face: FaceCode, boxW: number, boxH: number): Node {
    // contain：等比缩到能塞进格子
    const k = Math.min(boxW / 112, boxH / 149);
    const w = Math.round(112 * k);
    const h = Math.round(149 * k);

    const root = createNode(`SlotTile_${faceLabel(face)}`, parent, { w: boxW, h: boxH });
    root.layer = Layers.Enum.UI_2D;

    const holder = createNode('Img', root, { w, h });
    const sp = holder.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.trim = false;
    holder.active = false;

    loadFrame(spritePath(face), (sf) => {
        if (!root.isValid) return;
        if (!sf) { buildSlotFallback(root, face, boxW, boxH); return; }
        sp.spriteFrame = sf;
        holder.getComponent(UITransform)!.setContentSize(w, h);
        holder.active = true;
    });
    return root;
}

function buildSlotFallback(root: Node, face: FaceCode, boxW: number, boxH: number): void {
    const k = Math.min(boxW / 112, boxH / 149);
    const w = Math.round(112 * k);
    const h = Math.round(149 * k);
    const grp = createNode('Fb', root, { w, h });
    const g = grp.addComponent(Graphics);
    fillRoundRect(g, 0, 0, w, h, Math.max(4, w * 0.15), COLOR.IVORY, 255);
    strokeRoundRect(g, 0, 0, w, h, Math.max(4, w * 0.15), COLOR.EDGE, 1.5, 255);
    const f = decode(face);
    createLabel(grp, f.suit === 'wan' ? `${f.num}万` : `${f.num}${f.suit === 'tong' ? '筒' : '条'}`, {
        fontSize: Math.max(10, Math.round(h * 0.34)),
        color: f.suit === 'wan' ? COLOR.BROWN : COLOR.RED,
        bold: true, serif: true, w, h,
    });
}

/** 花色 → 面板上要用的强调色（碰 / 吃 飘字、规则示意用） */
export function suitAccent(face: FaceCode): string {
    const f = decode(face);
    return f.suit === 'wan' ? COLOR.BROWN : COLOR.RED;
}

/** 牌面大小号的衬线字族（飘字 / 规则文案用） */
export const TILE_FONT = FONT.SERIF;
export const HAIR = hex2color(COLOR.HAIR);
export const SLOT_SKIN = SKIN.SLOT;
