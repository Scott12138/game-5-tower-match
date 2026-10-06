import fs from 'fs';
const asar = '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar';
const fd = fs.openSync(asar, 'r');
const head = Buffer.alloc(8);
fs.readSync(fd, head, 0, 8, 0);
const headerSize = head.readUInt32LE(4);          // pickle: [0:4]=payloadSize, [4:8]=headerSize
const hb = Buffer.alloc(headerSize);
fs.readSync(fd, hb, 0, headerSize, 8);
const jsonLen = hb.readUInt32LE(4);
const header = JSON.parse(hb.subarray(8, 8 + jsonLen).toString('utf8'));
const baseOffset = 8 + headerSize;
let node = header;
for (const p of process.argv[2].split('/').filter(Boolean)) {
  if (!node.files || !node.files[p]) { console.error('NOT FOUND: ' + p); process.exit(2); }
  node = node.files[p];
}
const size = Number(node.size);
const buf = Buffer.alloc(size);
fs.readSync(fd, buf, 0, size, baseOffset + Number(node.offset));
process.stdout.write(buf);
