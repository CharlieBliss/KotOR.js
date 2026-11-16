/**
 * Zip a Claude skill folder for upload to the Claude app, with forward-slash paths (PowerShell 5.1's
 * Compress-Archive writes backslashes, which other unzippers can mishandle).
 *
 * Usage: node scripts/pack-skill.js [skill-folder-name]   (default: kotor-gm-scenes)
 * Output: skills/<name>.zip
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const name = process.argv[2] || 'kotor-gm-scenes';
const root = path.join(__dirname, '..', 'skills');
const dir = path.join(root, name);

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

// The skill's own tests and Python caches stay out of the zip
const LEFT_OUT = new Set(['tests', '__pycache__']);
const files = walk(dir).filter((f) => !path.relative(dir, f).split(path.sep).some((part) => LEFT_OUT.has(part))).sort();
const locals = [];
const centrals = [];
let offset = 0;
for (const file of files) {
  const entryName = Buffer.from(path.join(name, path.relative(dir, file)).split(path.sep).join('/'));
  const data = fs.readFileSync(file);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(entryName.length, 26);
  locals.push(local, entryName, deflated);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(entryName.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, entryName);
  offset += local.length + entryName.length + deflated.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
const out = path.join(root, `${name}.zip`);
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${out}: ${files.length} files, ${fs.statSync(out).size} bytes`);
