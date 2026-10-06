#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 r44-freesound-search.py · 第 44 轮：freesound 批量检索
============================================================
【为什么这么写】
本机没有 freesound API token，但**搜索页与预览直链都是匿名的**：
  - 搜索页        https://freesound.org/search/?q=<query>
  - 每个结果块    <div class="bw-player" data-sound-id=... data-mp3=... data-title=...>
  - 预览件        https://cdn.freesound.org/previews/<前3位>/<id>_<uid>-lq.mp3
所以不需要 token 也能拿到「可试听的低码率预览件」（-lq），
足够做**候选筛选**；真正入库时再去取原始文件（那时需要登录，另议）。

【判据纪律】
- 抓不到结果 = 报错退出，**绝不静默返回空表**（否则会把"没抓到"当成"这库没有"）。
- 每条都记 sound_id：title 会重名，id 才是主键。

【用法】
  python3 tools/r44-freesound-search.py <out.json> "<query>" ["<query>" ...]
============================================================
"""

import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0 Safari/537.36')

# data-* 属性都出现在同一个 bw-player 块里
ATTR = {
    'id':       r'data-sound-id="(\d+)"',
    'uid':      r'data-user-id="(\d+)"',
    'title':    r'data-title="([^"]*)"',
    'dur':      r'data-duration="([\d.]+)"',
    'mp3':      r'data-mp3="([^"]*)"',
    'user':     r'data-username="([^"]*)"',
    'downloads': r'data-num-downloads="(\d+)"',
    'rate':     r'data-value="(\d)"',
}


def fetch(url, timeout=40, tries=3):
    """带重试的抓取；代理从环境变量走（http_proxy/https_proxy）。"""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA,
                                                       'Accept-Language': 'en-US,en;q=0.9'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:                       # 网络抖动重试，最终失败要抛
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'抓取失败 {url}: {last}')


def search(q, want=30):
    url = 'https://freesound.org/search/?q=' + urllib.parse.quote(q)
    html = fetch(url)
    # ★ 先判「页面结构」再判「查询结果」：
    #   data-sound-id 一次都没出现 ⇒ 结构变了/被拦了 ⇒ 必须报错；
    #   出现了但带预览件的被过滤光 ⇒ 只是这个查询没货 ⇒ 返回空表即可。
    total_blocks = len(re.findall(r'data-sound-id="', html))
    if total_blocks == 0:
        low = html.lower()
        if 'no results' in low or '0 sounds' in low or 'nothing found' in low:
            return []
        raise RuntimeError(
            f'查询「{q}」页面里一个结果块都没有，且不像"无结果"页 —— 结构变了或被拦了'
            f'（HTML {len(html)} B）')
    # 每个结果块以 bw-player 的 data-sound-id 为锚，向后取一段窗口
    idx = [m.start() for m in re.finditer(r'data-sound-id="', html)]
    rows, seen = [], set()
    for i in idx:
        blk = html[i:i + 3000]
        rec = {}
        for k, pat in ATTR.items():
            m = re.search(pat, blk)
            if m:
                rec[k] = m.group(1)
        if not rec.get('id') or rec['id'] in seen:
            continue
        if not rec.get('mp3'):                       # 没有预览件的直接跳过
            continue
        seen.add(rec['id'])
        # 许可：结果块里没有，sound 页才有 → 这里先留空，选定后再补
        rec['query'] = q
        rec['page'] = f"https://freesound.org/people/{rec.get('user','')}/sounds/{rec['id']}/"
        rec['dur'] = float(rec.get('dur', 0))
        rec['downloads'] = int(rec.get('downloads', 0) or 0)
        rows.append(rec)
        if len(rows) >= want:
            break
    return rows


def license_of(rec):
    """取 sound 页上的许可名（匿名可读）。"""
    try:
        html = fetch(rec['page'], timeout=30, tries=2)
    except Exception as e:
        return f'(未取到: {e})'
    m = re.search(r'/help/licensing/"[^>]*>\s*([^<]{2,60})', html)
    if m:
        return m.group(1).strip()
    m = re.search(r'(Creative Commons[^<]{0,40})', html)
    return m.group(1).strip() if m else '(未识别)'


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    out_path, queries = sys.argv[1], sys.argv[2:]
    allrows = {}
    print(f'  {"query":<22}{"id":>9}  {"时长s":>8}  {"下载":>7}  标题')
    for q in queries:
        for r in search(q):
            allrows.setdefault(r['id'], r)
        print(f'  ── 「{q}」累计 {len(allrows)} 条')
    # 逐条补许可（只在最终入选时才有必要，这里对前若干条做，避免打太多请求）
    print()
    print(f'  [v] 共 {len(allrows)} 条唯一结果 → {out_path}')
    with open(out_path, 'w') as f:
        json.dump(list(allrows.values()), f, ensure_ascii=False, indent=2)
    for r in sorted(allrows.values(), key=lambda x: -x['downloads'])[:40]:
        print(f'  {r["query"][:20]:<22}{r["id"]:>9}  {r["dur"]:>8.2f}  {r["downloads"]:>7}  {r["title"][:56]}')
        os.environ.setdefault('_', '')


if __name__ == '__main__':
    main()
