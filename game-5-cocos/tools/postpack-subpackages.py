#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 postpack-subpackages.py · 构建后处理：把自定义 Bundle 转成微信小游戏分包
============================================================
【为什么需要它 —— Cocos 3.8.8 命令行**配不出** bundle 级「小游戏分包」】

目标：主包只留 `splash/ + audio/`（微信小游戏主包红线 4MB），
      `home/`(1.4M) 与 `game/`(4.6M) 必须变成**小游戏分包**。

官方文档（`manual/zh/editor/publish/subpackage.html`）要求两件事：
    ① Bundle 级：目标平台选小游戏平台，压缩类型选「小游戏分包」
    ② 构建级：把「主包压缩类型」设为「小游戏分包」

实测：② `mainBundleCompressionType: "subpackage"` 走命令行**有效**
      （产物里 internal/ + main/ 会落到 subpackages/），
      但 ① 在 CLI 下**怎么配都不生效**。已逐一试过、全部失败：

      | # | 配置通道                    | key 取值             | 结果 |
      |---|-----------------------------|----------------------|------|
      | 1 | settings builder.json       | bundle 名            | ✗    |
      | 2 | settings builder.json       | bundle uuid          | ✗    |
      | 3 | settings builder.json       | `db://assets/...`    | ✗    |
      | 4 | settings builder.json       | `assets/bundles/...` | ✗    |
      | 5 | 同上 + configMode:auto+preferredOptions | bundle 名/uuid | ✗ |
      | 6 | meta userData.bundleConfigID 引用自定义方案 | 「方案名」 | ✗   |
      | 7 | 构建参数 bundleConfigs[]（IBundleOptions） | db:// 与相对路径 | ✗ |

      （键名 `bundleConfig.custom` 确实被编辑器认下 —— 构建后它会被回写并补上
       `__version__`；但内容不参与小游戏分包判定。另外**别把这个文件写成半截**：
       实测只写 `{"__version__":"1.3.9"}` 会让 CLI 构建**卡死不退**。）

【所以改用「构建后搬运」—— 这条路有引擎源码背书，不是猜的】

产物 `engine-adapter.js` 里 bundle 下载器的真实逻辑（反混淆后）：
    cc.assetManager.init = function (opts) {
        ...
        var subs = cc.settings.querySettings('assets', 'subpackages');
        subs && subs.forEach(function (n) { subpackagePath[n] = 'subpackages/' + n; });
    };
    // 下载 bundle 时：
    subpackagePath[name]
        ? ( loadSubpackage(name, ...)              // ← wx.loadSubpackage({name})
            , read('subpackages/' + name + '/config.json')
            , cfg.base = 'subpackages/' + name + '/' )
        : ( ... 普通 assets/ 路径 ... )

即：**运行时只认 `src/settings.json` 里 `assets.subpackages` 这个数组**。
只要数组里有 `home`，引擎就会用 `wx.loadSubpackage('home')` 去要它，
并从 `subpackages/home/` 读 config.json —— 与 Cocos 自己产出的分包走的是同一条码路。

微信端再据 `game.json` 的 `subpackages` 声明，把这两个 root 目录排除出主包体积。

【幂等】重复执行安全：已是分包则跳过，数组去重。
【用法】
    python3 tools/postpack-subpackages.py [build/wechatgame]

------------------------------------------------------------
★ 第 53 轮追加：开放数据域（好友排行榜）

  `build-templates/wechatgame/openDataContext/` → 产物里的 `openDataContext/`，
  并在 `game.json` 写 `"openDataContext": "openDataContext"`。

  【为什么不靠 build-templates 自动拷】Cocos 文档说 `build-templates/<平台>/` 会被
    自动拷进产物 —— 本项目 CLI 构建下**实测没拷到**。所以这里兜底复拷（以源为准整体覆盖）。
  【为什么 game.json 必须手改】构建器不会写 `openDataContext` 字段，
    缺了它平台找不到开放数据域入口（表现为好友榜永远是空白）。
============================================================
"""

import io
import json
import os
import shutil
import sys

# 工程根（本文件在 tools/ 下）—— 用来定位 build-templates/
PROJ_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 需要转成「小游戏分包」的自定义 Bundle 名（= 目录 meta 里的 bundleName）
SUBPACKAGE_BUNDLES = ['home', 'game']

# 主包必须保留的 Bundle（本工程 = resources，内含 splash/ 与 audio/）
KEEP_IN_MAIN = ['resources']


def read_json(path):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for fn in files:
            total += os.path.getsize(os.path.join(root, fn))
    return total


def main():
    build_dir = sys.argv[1] if len(sys.argv) > 1 else 'build/wechatgame'
    if not os.path.isdir(build_dir):
        print('[✗] 找不到构建产物目录：%s' % build_dir)
        return 2

    assets_dir = os.path.join(build_dir, 'assets')
    sub_dir = os.path.join(build_dir, 'subpackages')
    settings_path = os.path.join(build_dir, 'src', 'settings.json')
    game_json_path = os.path.join(build_dir, 'game.json')

    for p in (assets_dir, settings_path, game_json_path):
        if not os.path.exists(p):
            print('[✗] 构建产物不完整，缺少：%s' % p)
            return 2

    os.makedirs(sub_dir, exist_ok=True)
    moved = []

    # ---------- ① 搬目录：assets/<name>  →  subpackages/<name> ----------
    for name in SUBPACKAGE_BUNDLES:
        src = os.path.join(assets_dir, name)
        dst = os.path.join(sub_dir, name)
        if not os.path.isdir(src):
            if os.path.isdir(dst):
                print('[=] %-6s 已是分包，跳过' % name)
            else:
                print('[!] %-6s 既不在 assets/ 也不在 subpackages/，跳过' % name)
            continue
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.move(src, dst)
        moved.append('%s (%.0fK)' % (name, dir_size(dst) / 1024.0))
        print('[+] %-6s → subpackages/%s' % (name, name))

    # ---------- ①b 补齐分包入口 game.js ----------
    # 【微信硬性要求】`game.json` 里声明的每个 subpackage，其 root 目录下**必须**
    # 存在 `game.js`，否则开发者工具直接拒绝编译，报：
    #     game.json: 未找到 ["subpackages"][N]["root"] 对应的 /subpackages/xxx/game.js 文件
    # 实测踩到过（第一次出码就卡在这里）。
    # Cocos 只给"含代码的 bundle"（internal / main）生成 game.js；
    # 我们这两张是**纯资源包**，必须自己补一个占位入口。
    for name in SUBPACKAGE_BUNDLES:
        entry = os.path.join(sub_dir, name, 'game.js')
        if not os.path.isfile(entry):
            with io.open(entry, 'w', encoding='utf-8') as f:
                f.write('// %s：纯资源分包，入口文件仅用于满足微信分包校验（无逻辑）\n' % name)
            print('[+] %-6s 补分包入口 game.js' % name)

    # ---------- ② 登记到 src/settings.json 的 assets.subpackages ----------
    settings = read_json(settings_path)
    assets = settings.setdefault('assets', {})
    subs = assets.setdefault('subpackages', [])
    added = []
    for name in SUBPACKAGE_BUNDLES:
        if name not in subs:
            subs.append(name)
            added.append(name)
    write_json(settings_path, settings)
    print('[+] settings.json assets.subpackages = %s' % json.dumps(subs, ensure_ascii=False))

    # ---------- ③ 登记到 game.json（微信据此把目录排除出主包） ----------
    game = read_json(game_json_path)
    gsubs = game.setdefault('subpackages', [])
    have = set()
    for item in gsubs:
        if isinstance(item, dict) and 'name' in item:
            have.add(item['name'])
    for name in SUBPACKAGE_BUNDLES:
        if name not in have:
            gsubs.append({'name': name, 'root': 'subpackages/%s/' % name})
    write_json(game_json_path, game)
    print('[+] game.json subpackages = %s'
          % json.dumps([i.get('name') for i in gsubs], ensure_ascii=False))

    # ---------- ④ 开放数据域（好友排行榜，第 53 轮新增）----------
    # 【为什么必须在这里补】
    #   ① `build-templates/wechatgame/` 下的文件**理论上**由 Cocos 构建时自动拷进产物，
    #      但这条路在 CLI 构建下不可靠（本项目实测没拷进来）⇒ 这里兜底复拷一份。
    #   ② `game.json` 的 `openDataContext` 字段**构建器根本不会写**，
    #      没有它平台就不知道开放数据域的入口在哪。
    #   两件事都幂等：目录已一致就跳过、字段已存在就跳过。
    odc_src = os.path.join(PROJ_ROOT, 'build-templates', 'wechatgame', 'openDataContext')
    odc_dst = os.path.join(build_dir, 'openDataContext')
    if os.path.isdir(odc_src):
        # 以「源目录为准」整体覆盖 —— 只比 mtime 的话，改了源码但时间戳没变会漏拷
        if os.path.isdir(odc_dst):
            shutil.rmtree(odc_dst)
        shutil.copytree(odc_src, odc_dst)
        entry_js = os.path.join(odc_dst, 'index.js')
        if not os.path.isfile(entry_js):
            print('[✗] 开放数据域缺入口 index.js：%s' % odc_dst)
            return 2
        print('[+] openDataContext/ 已就位（%.1fK，入口 index.js）' % (dir_size(odc_dst) / 1024.0))
    else:
        print('[!] 找不到 %s —— 好友排行榜会失效（构建模板被删了？）' % odc_src)

    game = read_json(game_json_path)
    if os.path.isdir(odc_dst):
        if game.get('openDataContext') != 'openDataContext':
            game['openDataContext'] = 'openDataContext'
            write_json(game_json_path, game)
            print('[+] game.json openDataContext = "openDataContext"')
        else:
            print('[=] game.json openDataContext 已登记，跳过')

    # ---------- ⑤ 对账 ----------
    total = dir_size(build_dir)
    sub_total = dir_size(sub_dir)
    main_total = total - sub_total
    print('')
    print('    产物总计   = %8.2f MB' % (total / 1048576.0))
    print('    分包合计   = %8.2f MB' % (sub_total / 1048576.0))
    print('    ─────────────────────────')
    print('    主包        = %8.2f MB   (微信红线 4MB)' % (main_total / 1048576.0))
    print('    开放数据域  = %s' % ('已就位' if os.path.isdir(odc_dst) else '缺失'))

    remain = []
    for d in sorted(os.listdir(assets_dir)):
        if os.path.isdir(os.path.join(assets_dir, d)):
            remain.append(d)
    print('    主包 assets/ 仅剩： %s' % (', '.join(remain) or '(空)'))

    ok = main_total <= 4 * 1024 * 1024 and all(
        os.path.isdir(os.path.join(sub_dir, n)) for n in SUBPACKAGE_BUNDLES
    )
    if not ok:
        print('[✗] 分包化未达标（主包超 4MB 或分包目录缺失）')
        return 1
    if moved:
        print('[✓] 分包化完成：%s' % ', '.join(moved))
    else:
        print('[✓] 分包结构已就绪（本次无需搬运）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
