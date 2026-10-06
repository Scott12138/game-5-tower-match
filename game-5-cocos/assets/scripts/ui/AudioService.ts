/**
 * ============================================================
 *  AudioService.ts · 音频服务（BGM + 音效声道池）
 * ============================================================
 *  【为什么必须在启动时 init】
 *  声道池要在启动时建好、音效要在启动时发起加载；等玩家第一次点牌才建的话，
 *  头几次操作一定是**静音**的（音频解码要时间，而那时已经在播了）。
 *  这条在 game-4 上被真机验证过。
 *
 *  【为什么声道挂在 UI 根节点下，而不是某个页面下】
 *  音效不跟着页面销毁 —— 否则从主玩页退回首页时，正在播的尾巴会被一起销毁
 *  （表现是"点返回时音效被掐断"）。
 *
 *  【静音开关的口径】
 *  `setMuted` 同时管 BGM 与音效，并把偏好写进 localStorage（不碰游戏存档 ——
 *  保持"音频只管音频"的单一职责）。
 * ============================================================
 */

// ⚠️ 不要从 'cc' import `log`/`warn`：release 构建 debugMode=ERROR，
//    引擎只在 mode<=INFO 时绑定 ccLog、只在 mode!==ERROR 时绑定 ccWarn，
//    ⇒ 打包产物里它们是空函数。日志一律用 console.log / console.warn。
import { AudioClip, AudioSource, Node, error, resources } from 'cc';

/** 静音偏好的 localStorage 键 */
const MUTE_KEY = 'game5.mute';

export class AudioService {
    private static _music: AudioSource | null = null;
    /** 音效声道池 */
    private static readonly _pool: AudioSource[] = [];
    private static _poolIdx = 0;
    private static readonly _clips = new Map<string, AudioClip>();
    private static readonly _pending = new Map<string, Array<(c: AudioClip | null) => void>>();
    private static _muted = false;
    private static _inited = false;
    /** 当前 BGM 路径（避免同一首被反复从头开始） */
    private static _bgmPath = '';
    /** 资源加载失败过的路径（避免疯狂重试打爆日志） */
    private static readonly _failed = new Set<string>();

    /** 声道数：同时最多 8 个音效（点牌 / 成组 / 道具 / 飞入…），够用且不浪费 */
    private static readonly POOL_SIZE = 8;
    private static readonly BGM_VOL = 0.55;

    // --------------------------------------------------------
    //  初始化
    // --------------------------------------------------------

    /** 在 GameRoot.onLoad 里调一次（必须早于任何 play 调用） */
    public static init(root: Node): void {
        if (this._inited) return;
        this._inited = true;

        try {
            this._muted = globalThis.localStorage?.getItem(MUTE_KEY) === '1';
        } catch {
            this._muted = false;   // 某些环境没有 localStorage（隐私模式 / 小程序早期）
        }

        const musicNode = new Node('Bgm');
        root.addChild(musicNode);
        const ms = musicNode.addComponent(AudioSource);
        ms.loop = true;
        ms.volume = this._muted ? 0 : this.BGM_VOL;
        this._music = ms;

        const sfxNode = new Node('Sfx');
        root.addChild(sfxNode);
        for (let i = 0; i < this.POOL_SIZE; i++) {
            const s = sfxNode.addComponent(AudioSource);
            s.loop = false;
            s.volume = 0.9;
            this._pool.push(s);
        }

        console.log(`[AudioService] 声道池已建立：BGM 1 + 音效 ${this.POOL_SIZE}`);
    }

    // --------------------------------------------------------
    //  静音
    // --------------------------------------------------------

    public static get muted(): boolean { return this._muted; }

    public static setMuted(m: boolean): void {
        this._muted = m;
        try { globalThis.localStorage?.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* 忽略 */ }
        if (this._music) this._music.volume = m ? 0 : this.BGM_VOL;
        if (m) this.stopAllSfx();
    }

    public static toggleMuted(): boolean {
        this.setMuted(!this._muted);
        return this._muted;
    }

    // --------------------------------------------------------
    //  加载
    // --------------------------------------------------------

    /**
     * 预加载一个音频（**只加载不播**）。路径相对 `assets/resources/`，不含扩展名。
     * 进主玩页之前先把要用的都拉进来，避免"第一次点没声"。
     */
    public static preload(path: string, cb?: (c: AudioClip | null) => void): void {
        const hit = this._clips.get(path);
        if (hit) { cb?.(hit); return; }
        if (this._failed.has(path)) { cb?.(null); return; }

        const q = this._pending.get(path);
        if (q) { if (cb) q.push(cb); return; }
        this._pending.set(path, cb ? [cb] : []);

        resources.load(path, AudioClip, (err: Error | null, clip: AudioClip) => {
            const list = this._pending.get(path) ?? [];
            this._pending.delete(path);
            const ok = !err && !!clip;
            if (ok) {
                this._clips.set(path, clip);
            } else {
                this._failed.add(path);
                console.warn(`[AudioService] 音频加载失败：${path} ${err?.message ?? ''}（已记为缺省，不再重试）`);
            }
            for (const f of list) f(ok ? clip : null);
        });
    }

    /** 批量预加载（进主玩页前调用） */
    public static preloadAll(paths: string[], onDone?: (ok: number, total: number) => void): void {
        let left = paths.length;
        let ok = 0;
        if (left === 0) { onDone?.(0, 0); return; }
        for (const p of paths) {
            this.preload(p, (c) => {
                if (c) ok++;
                if (--left === 0) onDone?.(ok, paths.length);
            });
        }
    }

    // --------------------------------------------------------
    //  播放
    // --------------------------------------------------------

    /**
     * 播一个音效。
     * 未加载完会自动"补播" —— 这样调用点不需要关心加载状态，
     * 第一次点牌也不会静音（代价是首次可能晚 100ms 出声，可接受）。
     */
    public static playSfx(path: string, volume = 1.0): void {
        if (this._muted) return;
        const clip = this._clips.get(path);
        if (!clip) {
            if (this._failed.has(path)) return;   // 已知缺失，静默跳过
            this.preload(path, (c) => { if (c) this.playSfx(path, volume); });
            return;
        }
        if (this._pool.length === 0) return;

        const src = this._pool[this._poolIdx];
        this._poolIdx = (this._poolIdx + 1) % this._pool.length;
        const v = Math.max(0, Math.min(1, volume)) * 0.9;
        try {
            // 声道轮转：被复用的声道先停掉，避免"上一声还在响就被改写"的爆音
            if (src.playing) src.stop();
            src.playOneShot(clip, v);
        } catch (e) {
            error('[AudioService] playSfx 异常：', e);
        }
    }

    /** 播 BGM（同一首重复调用不重头开始） */
    public static playBgm(path: string, volume = this.BGM_VOL): void {
        if (!this._music) {
            console.warn('[AudioService] 未初始化，BGM 被忽略（检查 GameRoot.onLoad 是否调了 init）');
            return;
        }
        this._music.volume = this._muted ? 0 : volume;
        if (this._bgmPath === path && this._music.playing) return;

        const clip = this._clips.get(path);
        if (!clip) {
            if (this._failed.has(path)) return;
            this.preload(path, (c) => { if (c) this.playBgm(path, volume); });
            return;
        }
        this._bgmPath = path;
        this._music.stop();
        this._music.clip = clip;
        this._music.play();
    }

    public static stopBgm(): void {
        if (this._music?.playing) this._music.stop();
        this._bgmPath = '';
    }

    public static stopAllSfx(): void {
        for (const s of this._pool) if (s.playing) s.stop();
    }

    /** 页面切换时的收口：停音效、**不断 BGM**（BGM 是跨页连续的） */
    public static onPageChange(): void {
        this.stopAllSfx();
    }
}
