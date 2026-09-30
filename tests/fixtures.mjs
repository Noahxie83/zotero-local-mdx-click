import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

export const api = await (async () => {
  const compiled = await build({
    stdin: { contents: [
      "export { MDXDictionary, MDDArchive } from './src/mdx.js';",
      "export { createApp } from './src/main.js';",
      "export { ResourceScope, prepareNativeDefinition } from './src/native-render.js';",
      "export { LocalResources } from './src/resources.js';",
      "export { queryFromText } from './src/selection-query.js';",
      "export { saveSelectionAnnotation, replaceSelectionMenu } from './src/selection-menu.js';",
      "export { decodeSpeex } from './src/speex.js';",
      "export { default as lzo } from './src/vendor/lzo1x.ts';",
    ].join('\n'), resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.wasm': 'binary' },
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'local-mdx-tests-'));
  const file = path.join(directory, 'core.mjs');
  try { await writeFile(file, compiled.outputFiles[0].contents); return await import(pathToFileURL(file).href); }
  finally { await unlink(file); await rmdir(directory); }
})();

export const source = bytes => ({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
function adler(bytes) { let a = 1, b = 0; for (const n of bytes) { a = (a + n) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function num(n, width = 8, little = false) {
  const b = Buffer.alloc(width);
  if (width === 8) b.writeBigUInt64BE(BigInt(n));
  else if (width === 2) b.writeUInt16BE(n);
  else little ? b.writeUInt32LE(n) : b.writeUInt32BE(n);
  return b;
}
function block(bytes, compress = false) {
  return Buffer.concat([Buffer.from([compress ? 2 : 0, 0, 0, 0]), num(adler(bytes), 4), compress ? deflateSync(bytes) : bytes]);
}

// Original miniature data only. A null definition shares the prior record.
export function makeDictionary(pairs, { binary = false, keyBlockSize = pairs.length, recordChunk = 23, recordLZO } = {}) {
  const header = Buffer.from('<Dictionary GeneratedByEngineVersion="2.0" Encoding="UTF-8" Encrypted="0" KeyCaseSensitive="No" StripKey="Yes"/>\0', 'utf16le');
  let offset = 0;
  const records = [], rows = [];
  for (const [word, content] of pairs) {
    const start = content === null ? rows.at(-1).start : offset;
    rows.push({ word, start });
    if (content !== null) {
      const bytes = binary ? Buffer.from(content) : Buffer.from(content + '\0');
      records.push(bytes); offset += bytes.length;
    }
  }
  const encoding = binary ? 'utf16le' : 'utf8', unit = binary ? 2 : 1;
  const keys = [], infos = [];
  for (let at = 0; at < rows.length; at += keyBlockSize) {
    const entries = rows.slice(at, at + keyBlockSize);
    const raw = Buffer.concat(entries.map(row => Buffer.concat([num(row.start), Buffer.from(row.word + '\0', encoding)])));
    const packed = block(raw, true); keys.push(packed);
    const bound = word => Buffer.concat([num(Buffer.byteLength(word, encoding) / unit, 2), Buffer.from(word + '\0', encoding)]);
    infos.push(Buffer.concat([num(entries.length), bound(entries[0].word), bound(entries.at(-1).word), num(packed.length), num(raw.length)]));
  }
  const infoRaw = Buffer.concat(infos), info = block(infoRaw, true);
  const kh = Buffer.concat([num(keys.length), num(rows.length), num(infoRaw.length), num(info.length), num(keys.reduce((n, key) => n + key.length, 0))]);
  const raw = Buffer.concat(records), parts = [];
  if (recordLZO) parts.push(raw);
  else for (let at = 0; at < raw.length; at += recordChunk) parts.push(raw.subarray(at, at + recordChunk));
  const packs = parts.map((bytes, i) => recordLZO
    ? Buffer.concat([Buffer.from([1, 0, 0, 0]), num(adler(bytes), 4), recordLZO]) : block(bytes, i % 2 === 0));
  const recordInfo = Buffer.concat(parts.map((bytes, i) => Buffer.concat([num(packs[i].length), num(bytes.length)])));
  const rh = Buffer.concat([num(parts.length), num(rows.length), num(recordInfo.length), num(packs.reduce((n, pack) => n + pack.length, 0))]);
  return Buffer.concat([num(header.length, 4), header, num(adler(header), 4, true), kh, num(adler(kh), 4), info, ...keys, rh, recordInfo, ...packs]);
}

function oggPage(serial, sequence, flags, packets, granule) {
  const header = Buffer.alloc(27 + packets.length);
  header.write('OggS'); header[5] = flags; header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14); header.writeUInt32LE(sequence, 18); header[26] = packets.length;
  packets.forEach((packet, index) => { header[27 + index] = packet.length; });
  const bytes = Buffer.concat([header, ...packets]); let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  bytes.writeUInt32LE(crc >>> 0, 22); return bytes;
}
export function speexSilence(serial, seconds, { mode = 0, channels = 1, framesPerPacket = 1 } = {}) {
  const rate = 8000 * (2 ** mode), frameSize = 160 * (2 ** mode);
  const header = Buffer.alloc(80); header.write('Speex   '); header.write('1.2.1', 8);
  for (const [offset, value] of [[28, 1], [32, 80], [36, rate], [40, mode], [44, 4], [48, channels], [52, -1], [56, frameSize], [64, framesPerPacket]]) header.writeInt32LE(value, offset);
  const result = [oggPage(serial, 0, 2, [header], 0), oggPage(serial, 1, 0, [Buffer.alloc(8)], 0)];
  // Speex null narrowband submode uses five zero bits. Wideband decoders
  // accept absent extension layers; stereo defaults to balanced channels.
  const packets = Array.from({ length: Math.ceil((seconds * rate / frameSize + 1) / framesPerPacket) }, () => Buffer.alloc(Math.ceil(5 * framesPerPacket / 8)));
  let sequence = 2;
  for (let offset = 0; offset < packets.length; offset += 200) {
    const last = offset + 200 >= packets.length;
    result.push(oggPage(serial, sequence++, last ? 4 : 0, packets.slice(offset, offset + 200), last ? seconds * rate : -1));
  }
  return Buffer.concat(result);
}
