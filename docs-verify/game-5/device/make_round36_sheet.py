# -*- coding: utf-8 -*-
"""
第 36 轮 · 扫码报「运行环境加载失败」排查与解决 —— 生成自包含 HTML 报告。

为什么用「生成脚本 + 导出 PNG」两条腿：
  HTML 便于你自己点开看（二维码可直接扫），PNG 便于归档和贴到别处。
  HTML 里的 markdown 必须过一遍 inline()，否则 **粗** / `码` 会原样显示（第 35 轮踩过）。
"""
import base64
import io
import os

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
QR = os.path.join(ROOT, '真机预览二维码.png')
OUT_HTML = os.path.join(ROOT, '70-第36轮-扫码无法进入-排查与解决.html')


def inline(s: str) -> str:
    """把 **粗** / `码` 转成 HTML —— HTML 不认 markdown，不转就会原样显示星号和反引号。"""
    out, i, bold = [], 0, False
    while i < len(s):
        if s.startswith('**', i):
            out.append('</b>' if bold else '<b>')
            bold = not bold
            i += 2
        elif s[i] == '`':
            j = s.find('`', i + 1)
            if j == -1:
                out.append(s[i]); i += 1
            else:
                out.append('<code>' + s[i + 1:j] + '</code>'); i = j + 1
        else:
            out.append(s[i]); i += 1
    if bold:
        out.append('</b>')
    return ''.join(out)


def img64(path: str) -> str:
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()


# ----------------------------------------------------------------- 数据表
EXCLUDE_ROWS = [
    ('二维码链接有效性', '解码得 `mp.weixin.qq.com/a/~~…~~`；生成于 11:45，排查时仅过 6 分钟',
     '正常', 'ok'),
    ('AppID 配置', '`project.config.json` = `wxfaa19afc583badd9`，与授权一致',
     '正确', 'ok'),
    ('主包体积', '3,097,454 B = **2.95 MB**（微信红线 4 MB）',
     '合规', 'ok'),
    ('总包体积', '9,204,650 B = **8.79 MB**（上限 30 MB）',
     '合规', 'ok'),
    ('产物引用完整性', '`game.js` 引用的 7 个入口文件逐一存在（web-adapter / first-screen / polyfills / system / import-map / application / engine-adapter）',
     '完整', 'ok'),
    ('分包登记', '`game.json` 四个分包 root 均以 `/` 结尾且彼此平级；`settings.json` 的 `assets.subpackages` 与之逐个一致',
     '合规', 'ok'),
    ('分包入口文件', '四个分包目录下均有 `game.js`（微信硬性要求）',
     '齐全', 'ok'),
    ('基础库版本', '`libVersion` = `widelyUsed` —— 微信官方推荐的稳定值（不是 Cocos 那个会报错的 `game`）',
     '合规', 'ok'),
    ('游戏代码本身', '真机比例 421×927 @DPR3 真实鼠标事件冒烟 **25/25**，未捕获异常 0',
     '正常', 'ok'),
    ('报错文本来源', '全产物检索「运行环境」**零命中** ⇒ 这句话**不是游戏代码发出来的**，来自微信客户端侧',
     '已定性', 'info'),
]

EVIDENCE_ROWS = [
    ('①', 'IDE 日志', '`task type:upload exec error Error: read ECONNRESET`',
     '07:44:38 起共 **18 条**，一直到 11:45:22 —— **每一次出码都命中**'),
    ('②', 'IDE 日志', '`https://servicewechat.com/wxa-dev-logic/devsync` → `TypeError: Failed to fetch`',
     '每小时复现，同一个域名'),
    ('③', 'IDE 日志', '`getVendorConfig: getOnlineConfig failed … Error: read ECONNRESET`',
     '同一个域名，又一次'),
    ('④', '代理内核规则表', '规则总数 **1112** 条，其中含 `servicewechat` 的：**0 条**',
     '该域名不匹配任何规则 ⇒ 落到兜底 `Match → ⚓️其他流量`（境外节点）'),
    ('⑤', '网络对照实验', '同一域名 `servicewechat.com`，两条链路各测',
     '**直连 15/15 成功** vs **走代理 7/15 成功（53% 失败）**'),
]

FIX_ROWS = [
    ('① 备份', '`Clash_1774939444.yaml` → `.bak-20261006-120542`（70,188 B）',
     '改配置前先留退路'),
    ('② 定位', '用内核 API `GET /configs` + `GET /rules` 确认**真正生效**的是 70 KB 那份（不是 805 B 的 `config.yaml`，后者只是 ClashX 的端口基础配置）',
     '目录里有两份，认错就白改'),
    ('③ 插规则', '在 `rules:` **最前面**插入 7 条 `DIRECT`：servicewechat.com / weixin.qq.com / wechat.com / weixinbridge.com / qpic.cn / gtimg.cn / tenpay.com',
     '放最前 = 优先命中，不被前面任何规则抢走'),
    ('④ 热重载', '`PUT /configs?force=true` → HTTP **204**，规则表 1112 → **1119**',
     '免重启就生效'),
    ('⑤ 填坑', '热重载让内核改按 70 KB 配置的端口声明启动，`port` / `mixed-port` 双双归 0（只剩 socks 7891）→ 系统代理指向的 7890 断掉 ⇒ **重启 ClashX** 恢复 `mixed-port: 7890`',
     '★ 这条坑已记档：改完务必复查端口'),
]

VERIFY_ROWS = [
    ('`servicewechat.com` 走代理（小请求）', '7 / 15 成功', '**20 / 20 成功**', '53% 失败 → 0%'),
    ('IDE `task type:upload` 报错', '每次出码必现（累计 18 条）', '**新增 0 条**', '上传通道打通'),
    ('出码结果', '`✔ preview` 但包没传上去（静默失败）', '`✔ preview` + 校验段显式通过', '不再静默失败'),
    ('`google.com` 走代理', '正常', '正常（302 / 0.18s）', '没误伤境外流量'),
]

FALLBACK_ROWS = [
    ('微信本地缓存脏', '旧版本代码包残留会让新包解析失败（社区统计能解决约 7 成首次加载失败）',
     '微信 → 我 → 设置 → 通用 → 存储空间 → 清理缓存；然后**杀掉微信进程**重开'),
    ('手机系统时间不准', '预览版走 HTTPS 且校验时间戳，时间偏移会导致环境初始化失败（有完全同症状的案例）',
     '设置 → 通用 → 日期与时间 → 打开「自动设置」'),
    ('微信号无该项目权限', '预览码只对**开发者 / 体验者**开放，名单外的人扫码会被拦',
     '登录 mp.weixin.qq.com → 成员管理 → 确认你的微信号在名单里'),
    ('微信版本过低', '基础库能力与预览通道都依赖较新的客户端',
     '升级到最新版微信后重扫'),
    ('手机内存不足', '运行环境初始化阶段对可用内存敏感',
     '清理后台应用后重试'),
    ('网络链路抖动', '本轮已量化：直连也曾出现 7.8s / 11.5s 的异常抖动',
     'WiFi ↔ 4G 互换一次再扫'),
]


def badge(kind: str, text: str) -> str:
    return f'<span class="badge {kind}">{text}</span>'


def build() -> None:
    exclude_html = '\n'.join(
        f'<tr><td class="k">{inline(a)}</td><td class="note">{inline(b)}</td>'
        f'<td class="c">{badge(k, inline(c))}</td></tr>'
        for a, b, c, k in EXCLUDE_ROWS)

    evidence_html = '\n'.join(
        f'<tr><td class="num">{n}</td><td class="src">{inline(src)}</td>'
        f'<td class="mono">{inline(text)}</td><td class="note">{inline(meaning)}</td></tr>'
        for n, src, text, meaning in EVIDENCE_ROWS)

    fix_html = '\n'.join(
        f'<tr><td class="k">{inline(a)}</td><td class="mono">{inline(b)}</td>'
        f'<td class="note">{inline(c)}</td></tr>'
        for a, b, c in FIX_ROWS)

    verify_html = '\n'.join(
        f'<tr><td>{inline(a)}</td><td class="mono bad">{inline(b)}</td>'
        f'<td class="mono good">{inline(c)}</td><td class="note">{inline(d)}</td></tr>'
        for a, b, c, d in VERIFY_ROWS)

    fallback_html = '\n'.join(
        f'<tr><td class="k">{inline(a)}</td><td class="note">{inline(b)}</td>'
        f'<td class="mono">{inline(c)}</td></tr>'
        for a, b, c in FALLBACK_ROWS)

    qr = img64(QR) if os.path.isfile(QR) else ''

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>第36轮 · 扫码无法进入 · 排查与解决</title>
<style>
  :root {{
    --ink:#16211C; --sub:#5D6B64; --line:#DFE5E0; --bg:#F5F7F5; --card:#FFFFFF;
    --green:#1B5E4A; --green2:#2E8B63; --gold:#B8860B; --red:#C0392B; --amber:#B7791F;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; padding:40px 32px 56px; background:var(--bg); color:var(--ink);
         font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
         font-size:15px; line-height:1.72; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1080px; margin:0 auto; }}
  header {{ border-bottom:3px solid var(--green); padding-bottom:18px; margin-bottom:26px; }}
  h1 {{ margin:0 0 8px; font-size:27px; letter-spacing:.4px; }}
  .sub {{ color:var(--sub); font-size:14px; }}
  .verdict {{ background:var(--green); color:#F2F7F4; border-radius:12px; padding:22px 26px;
              margin:0 0 30px; }}
  .verdict .lbl {{ font-size:12.5px; letter-spacing:2.5px; opacity:.75; margin-bottom:8px; }}
  .verdict .txt {{ font-size:16.5px; line-height:1.78; }}
  .verdict b {{ color:#FFD98A; }}
  h2 {{ font-size:18px; margin:36px 0 14px; padding-left:12px;
        border-left:4px solid var(--green2); }}
  h2 .en {{ font-size:12px; color:var(--sub); font-weight:400; margin-left:8px;
            letter-spacing:1px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:10px;
           overflow:hidden; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th {{ background:#EEF3EF; text-align:left; padding:11px 14px; font-weight:600;
        font-size:13px; color:#2C3B34; border-bottom:1px solid var(--line); }}
  td {{ padding:11px 14px; border-bottom:1px solid #EDF1EE; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  .k {{ font-weight:600; white-space:nowrap; }}
  .c {{ text-align:center; white-space:nowrap; }}
  .num {{ font-family:var(--mono); color:var(--sub); width:34px; }}
  .src {{ white-space:nowrap; color:var(--sub); font-size:13px; }}
  .note {{ color:#41504A; font-size:13.5px; }}
  .mono {{ font-family:var(--mono); font-size:12.8px; word-break:break-all; }}
  .bad {{ color:var(--red); }}
  .good {{ color:#1E8449; font-weight:600; }}
  code {{ font-family:var(--mono); font-size:12.6px; background:#EEF3EF;
          padding:1px 5px; border-radius:4px; color:#22483A; }}
  b {{ color:#0F3D2E; }}
  .badge {{ display:inline-block; padding:2px 10px; border-radius:20px; font-size:12.3px;
            font-weight:600; white-space:nowrap; }}
  .badge.ok {{ background:#E3F4EA; color:#1E8449; }}
  .badge.info {{ background:#E8EEF8; color:#2C5282; }}
  .chain {{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:2px 0 6px; }}
  .step {{ background:#FFF; border:1px solid var(--line); border-radius:8px;
           padding:8px 13px; font-size:13.2px; }}
  .step.hit {{ border-color:#E7B7B1; background:#FDF3F2; color:#8E2B20; font-weight:600; }}
  .arrow {{ color:#9DAFA6; font-weight:700; }}
  .pair {{ display:flex; gap:16px; flex-wrap:wrap; margin:4px 0 2px; }}
  .box {{ flex:1 1 300px; border:1px solid var(--line); border-radius:10px;
          background:#FFF; padding:16px 18px; }}
  .box h4 {{ margin:0 0 10px; font-size:13.5px; letter-spacing:.6px; color:var(--sub); }}
  .big {{ font-family:var(--mono); font-size:25px; font-weight:700; }}
  .big.red {{ color:var(--red); }} .big.green {{ color:#1E8449; }}
  .qr {{ display:flex; gap:22px; align-items:center; background:#FFF; border:1px solid var(--line);
         border-radius:10px; padding:20px 22px; }}
  .qr img {{ width:190px; height:190px; image-rendering:pixelated;
             border:1px solid var(--line); border-radius:8px; }}
  .qr .meta {{ font-size:13.5px; color:var(--sub); line-height:1.9; }}
  .qr .meta b {{ color:var(--ink); }}
  ul {{ margin:8px 0 0; padding-left:22px; }} li {{ margin:5px 0; }}
  .warn {{ background:#FEF9EC; border:1px solid #F0DCA8; border-left:4px solid var(--amber);
           border-radius:8px; padding:14px 18px; margin-top:12px; font-size:14px; }}
  .warn b {{ color:#8A5A00; }}
  footer {{ margin-top:38px; padding-top:16px; border-top:1px solid var(--line);
            color:var(--sub); font-size:12.5px; }}
</style></head><body><div class="wrap">

<header>
  <h1>扫码报「运行环境加载失败」· 排查与解决</h1>
  <div class="sub">game-5《麻麻大消除》· 第 36 轮 · 2026-10-06 12:0x ·
    数据源：微信开发者工具日志（WeappLog）+ ClashX 内核规则表 + 网络对照实验</div>
</header>

<div class="verdict">
  <div class="lbl">结 论</div>
  <div class="txt">
    代理规则集里有 <b>qq.com / tencent.com</b> 的直连条目，唯独<b>漏了 servicewechat.com</b> ——
    它是微信小游戏「上传预览包 + 数据同步」的域名。这个域名于是落到兜底的
    <b>Match → ⚓️其他流量</b> 走了境外节点，上传代码包时被重置（实测 <b>53% 失败</b>）。
    而 <b>cli preview 上传失败时照样打印 ✔ preview 并给出二维码</b>，
    所以二维码、包体、产物结构、AppID 逐项检查全都正常，
    但服务器上并没有可用的包 ⇒ 你扫码后看到「运行环境加载失败」。
    <br><br>
    <b>与游戏代码无关。</b> 已修好并验证：该域名走代理从 53% 失败降到 <b>0% 失败</b>，
    出码日志的上传报错从「每次必现」降到 <b>0 条</b>。
  </div>
</div>

<h2>因果链 <span class="en">CAUSAL CHAIN</span></h2>
<div class="chain">
  <span class="step">规则集缺 servicewechat.com</span><span class="arrow">→</span>
  <span class="step">落到兜底 Match 走境外节点</span><span class="arrow">→</span>
  <span class="step hit">上传预览包 ECONNRESET</span><span class="arrow">→</span>
  <span class="step">工具仍打印 ✔ preview 并出码</span><span class="arrow">→</span>
  <span class="step">服务器无可用包</span><span class="arrow">→</span>
  <span class="step hit">扫码报「运行环境加载失败」</span>
</div>

<h2>一、逐项排除 <span class="en">ELIMINATION</span></h2>
<p class="note" style="margin:0 0 12px">
  你提到的四个方向（二维码有效性 / 运行环境依赖 / 权限 / 网络配置）逐条查过。
  下表前九项<b>全部正常</b> —— 这正是这个 bug 难查的地方：所有常规检查都会给你绿灯。
</p>
<div class="card"><table>
  <thead><tr><th style="width:150px">检查项</th><th>依据</th><th style="width:96px">结论</th></tr></thead>
  <tbody>
{exclude_html}
  </tbody>
</table></div>

<h2>二、证据链 <span class="en">EVIDENCE</span></h2>
<div class="card"><table>
  <thead><tr><th style="width:34px">#</th><th style="width:104px">来源</th>
    <th style="width:330px">原始记录</th><th>说明</th></tr></thead>
  <tbody>
{evidence_html}
  </tbody>
</table></div>

<h3 style="margin:22px 0 10px; font-size:15px">对照实验：同一域名，两条链路</h3>
<div class="pair">
  <div class="box">
    <h4>直连（不走代理）</h4>
    <div class="big green">15 / 15</div>
    <div class="note">成功，0% 失败</div>
  </div>
  <div class="box">
    <h4>走 ClashX 代理（修复前）</h4>
    <div class="big red">7 / 15</div>
    <div class="note">成功，<b>53% 失败</b>（000 = 连接被重置）</div>
  </div>
</div>
<p class="note" style="margin-top:10px">
  同一个域名、同一台机器、同一时段 —— 唯一变量就是走不走代理。
  这是把「网络配置」这条从猜测变成结论的关键一步。
</p>

<h2>三、修复动作 <span class="en">FIX</span></h2>
<div class="card"><table>
  <thead><tr><th style="width:80px">步骤</th><th style="width:400px">做了什么</th><th>为什么</th></tr></thead>
  <tbody>
{fix_html}
  </tbody>
</table></div>

<div class="warn">
  <b>⚠️ 第 ⑤ 步这条坑值得单说</b>：热重载本身是成功的（内核返回 204、规则表涨到 1119 条），
  但它让内核改按 70 KB 配置里的端口声明启动，而 <code>config.yaml</code> 的注释早就写着
  「只有这份文件的端口设置会随 ClashX 启动生效」—— 两者一冲突，<code>port</code> 与
  <code>mixed-port</code> 双双归 0，只剩 socks 7891，而系统代理指向 7890，于是整个机器断网。
  已通过重启 ClashX 恢复（<code>mixed-port: 7890</code> 回归）。
  <b>教训：改完代理配置务必复查端口，别只看"重载成功"。</b>
</div>

<h2>四、验证结果 <span class="en">VERIFICATION</span></h2>
<div class="card"><table>
  <thead><tr><th style="width:250px">指标</th><th style="width:210px">修复前</th>
    <th style="width:200px">修复后</th><th>变化</th></tr></thead>
  <tbody>
{verify_html}
  </tbody>
</table></div>

<h2>五、当前有效的真机试玩码 <span class="en">QR</span></h2>
<div class="qr">
  <img src="{qr}" alt="真机预览二维码">
  <div class="meta">
    AppID　 <b>wxfaa19afc583badd9</b>（<b>只可预览，绝不可上传</b>）<br>
    解码自证　 <b>OK</b>（Vision 框架实解）<br>
    校验　 <b>✅ [8/7] 日志无新增上传错误</b> —— 与上一张的关键区别<br>
    包体　 9,216,600 B（8.79 MB）· 主包 2.99 MB / 红线 4 MB<br>
    <span style="color:#C0392B">⚠️ 预览码只有最新一张有效，重跑脚本会让上一张作废</span><br>
    <span style="color:#C0392B">⚠️ 约 25 分钟过期，过期了说一声，秒换一张</span>
  </div>
</div>

<h2>六、工具链已加固 <span class="en">HARDENING</span></h2>
<ul>
  <li><b>wechat-preview.sh 新增 <code>[8/7]</code> 上传校验</b> ——
      出码后自动比对 IDE 日志里 <code>task type:upload exec error</code> 的增量。
      有新增就<b>明确失败退出（退出码 3）</b>并给出四条修法，不再让「静默失败」蒙混过去。</li>
  <li><b>新增 <code>tools/wechat-preview-safe.sh</code></b> ——
      临时关系统代理出码，<code>trap</code> 保证无论成败（含 Ctrl-C）都把代理恢复原样；
      自带直连连通性自检。给「不方便改代理规则」的场景用。</li>
</ul>

<h2>七、如果还有问题：备用排查清单 <span class="en">FALLBACK</span></h2>
<p class="note" style="margin:0 0 12px">
  本轮已把「网络配置」这条钉死。倘若仍进不去，按下列顺序排查（均为客户端侧因素）。
</p>
<div class="card"><table>
  <thead><tr><th style="width:140px">可能原因</th><th>机理</th><th style="width:330px">怎么做</th></tr></thead>
  <tbody>
{fallback_html}
  </tbody>
</table></div>

<h2>八、长期注意 <span class="en">CAVEAT</span></h2>
<div class="warn">
  <b>代理配置会被订阅更新覆盖。</b> 这 7 条规则是写进
  <code>~/.config/clash/Clash_1774939444.yaml</code> 的；机场更新订阅时会重写该文件，
  规则会丢。三个选择：<br>
  ① 更新订阅后重跑一次今天的插入动作（我可以封装成脚本）；<br>
  ② 在 ClashX 的「绕过代理域名」设置里加 —— 这份设置不随订阅更新；<br>
  ③ 干脆让微信开发者工具自己不走代理：<b>设置 → 代理设置 → 不使用任何代理</b>（一劳永逸）。<br>
  原配置已备份：<code>Clash_1774939444.yaml.bak-20261006-120542</code>，要回退直接覆盖回去。
</div>

<footer>
  报告生成：game-5 第 36 轮 ｜ 原始日志：<code>~/Library/Application Support/微信开发者工具/*/WeappLog/logs/</code>
  ｜ 判据脚本：<code>tools/wechat-preview.sh</code> 的 <code>[8/7]</code> 段
</footer>

</div></body></html>'''

    with io.open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'✅ 已生成 {OUT_HTML}  ({os.path.getsize(OUT_HTML):,} B)')


if __name__ == '__main__':
    build()
