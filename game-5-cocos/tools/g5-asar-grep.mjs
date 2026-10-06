import fs from 'fs';
const asar = '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
const headerSize = head.readUInt32LE(4);
const hb = Buffer.alloc(headerSize); fs.readSync(fd, hb, 0, headerSize, 8);
const jsonLen = hb.readUInt32LE(4);
const header = JSON.parse(hb.subarray(8, 8 + jsonLen).toString('utf8'));
const baseOffset = 8 + headerSize;
const needle = process.argv[2];
const ctx = Number(process.argv[3] || 0);
const hits = [];
function walk(n, p) {
  if (!n.files) {
    if (n.offset === undefined) return;
    const sz = Number(n.size);
    if (sz > 20 * 1024 * 1024) return;
    const buf = Buffer.alloc(sz);
    try { fs.readSync(fd, buf, 0, sz, baseOffset + Number(n.offset)); } catch { return; }
    const s = buf.toString('utf8');
    if (s.includes(needle)) hits.push({ p, sz, s });
    return;
  }
  for (const k of Object.keys(n.files)) walk(n.files[k], p + '/' + k);
}
walk(header, '');
hits.sort((a, b) => a.sz - b.sz);
for (const h of hits.slice(0, 12)) console.log(`${h.p}  (${h.sz}B)`);
console.log('hits: ' + hits.length);
if (ctx) for (const h of hits.slice(0, 3)) {
  let idx = -1;
  while ((idx = h.s.indexOf(needle, idx + 1)) >= 0) {
    console.log('\n=== ' + h.p + ' @' + idx + ' ===');
    console.log(h.s.slice(Math.max(0, idx - ctx), idx + ctx));
  }
}
