/**
 * ============================================================
 *  TileRenderer.ts · 牌面渲染（一张牌 = 一个 TileView）
 * ============================================================
 *  视觉规格**逐条照抄** `game-5-主玩页-排版.html` 的 `.tile` 规则族：
 *
 *   ┌ 牌体（`.tile` / `.tile.imgmode`）
 *   │   本工程用 224×298 的 AI 母版，**图片自带金边与厚度** ⇒ 走 imgmode：
 *   │   不加底色、不加描边（加了会与图里的金边打架，边缘变成"双线毛刺"）
 *   ├ 可点（`.tile.live`）= **上浮 + 影加深 + 金色 2px 环 + 外发光**
 *   │   ⚠️ 关键设计口径：**"可点"靠"有影"表达，"被压"靠"无影"表达** ——
 *   │      不是靠灰化。这条是定稿稿写在注释里的自觉，不要改成"灰掉不可点"。
 *   └ 被压（`.tile.dead`）= `saturate(.74) brightness(.85)` + 几乎没有影
 *
 *  ★ 横牌 = **纯旋转**：节点恒为牌体 w×h，只设 `angle = 90`。
 *     绝不允许"换宽高"——那会把牌面横向拉伸 1.33 倍（第 32 轮第 5 条明令禁止）。
 * ============================================================
 */

import { Color, Graphics, Layers, Node, Sprite, UIOpacity, UITransform, Vec3, v3 } from 'cc';

import { COLOR, FONT, SKIN } from '../CFG';
import { createLabel, createNode, fillRoundRect, loadFrame, strokeRoundRect } from './UIFactory';
import { hex2color } from './Palette';
import { decode, faceLabel, spritePath, type FaceCode } from '../core/TileData';

export type TileState =
    /** 可点：满亮 + 金环 + 外发光 + 大影（"浮起来"） */
    | 'pick'
    /** 被压：降饱和压暗 + 几乎无影（"压住了"） */
    | 'cover'
    /** 系统锁定（例如胜负判定后禁止再点）：可点外观 + 更暗 */
    | 'lock';

export interface TileViewOpts {
    w: number;
    h: number;
    face: FaceCode;
    rot: 0 | 90;
    x: number;
    y: number;
}

/** 被压的降饱和/压暗系数（照抄 `.tile.dead` 的 filter） */
const DEAD_SAT = 0.74;
const DEAD_BRI = 0.85;

export class TileView {
    public readonly node: Node;
    public readonly w: number;
    public readonly h: number;
    public readonly face: FaceCode;
    public rot: 0 | 90;

    private _sp: Sprite | null = null;
    private _base: Graphics | null = null;
    private _ring: Graphics | null = null;
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

        // ② 牌面（图片虽自带金边，但**加载失败时**要有兜底，否则整局看不见牌）
        const spNode = createNode('Face', this.node, { w: o.w, h: o.h });
        const sp = spNode.addComponent(Sprite);
        // ⚠️ 顺序：先定模式、再赋贴图、最后显式写尺寸（写反会被 TRIMMED 改回原图尺寸）
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        this._sp = sp;
        spNode.active = false;

        loadFrame(spritePath(o.face), (sf) => {
            if (!this.node.isValid) return;
            if (!sf) { this.buildFallback(); return; }
            sp.spriteFrame = sf;
            const ui = spNode.getComponent(UITransform)!;
            ui.setContentSize(o.w, o.h);
            spNode.active = true;
        });

        // ③ 金环 / 发光（在牌体之上）
        const ring = createNode('Ring', this.node, { w: o.w, h: o.h });
        this._ring = ring.addComponent(Graphics);

        this.setState('cover');
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

        // 牌面明暗（imgmode：图片自带金边，这里只调明暗，不加任何描边）
        if (this._sp) {
            const k = live ? 1.0 : (lock ? 0.55 : DEAD_SAT * DEAD_BRI);
            this._sp.color = new Color(
                Math.round(255 * k), Math.round(255 * k), Math.round(255 * k), 255,
            );
        }
        if (this._fallback) {
            const op = this._fallback.getComponent(UIOpacity) ?? this._fallback.addComponent(UIOpacity);
            op.opacity = live ? 255 : (lock ? 150 : 210);
        }

        this.drawBase(live, lock);
        this.drawRing(live);
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

    /** 金环 + 外发光（只在可点时画；外发光用几层递减 alpha 的描边逼近） */
    private drawRing(live: boolean): void {
        const g = this._ring;
        if (!g) return;
        g.clear();
        if (!live) return;
        const r = Math.max(6, this.w * 0.12);
        // 外发光（3 层，由外到内渐亮）
        for (let i = 3; i >= 1; i--) {
            strokeRoundRect(g, 0, 0, this.w + i * 8, this.h + i * 8, r + i * 4,
                COLOR.GOLD, i === 1 ? 2.5 : 1.0, Math.round(52 / i));
        }
        // 主环
        strokeRoundRect(g, 0, 0, this.w + 4, this.h + 4, r + 2, COLOR.GOLD, 3, 132);
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
