import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/mdx.js', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { MDXDictionary } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));

function adler(bytes) { let a = 1, b = 0; for (const n of bytes) { a = (a + n) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function number(n, width = 4, little = false) { const b = Buffer.alloc(width); if (width === 8) b.writeBigUInt64BE(BigInt(n)); else if (width === 1) b[0] = n; else if (width === 2) b.writeUInt16BE(n); else little ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; }
function block(raw, compress = true) { return Buffer.concat([Buffer.from([compress ? 2 : 0, 0, 0, 0]), number(adler(raw)), compress ? deflateSync(raw) : raw]); }

// Small original definitions, written for this fixture. No third party
// dictionary data or machine-specific paths are needed to run the tests.
function fixture(version) {
  const modern = version >= 2, width = modern ? 8 : 4;
  const words = ['alias', 'apple', 'cycle', 'zebra'];
  const definitions = ['@@@LINK=apple\n', '<div><b>apple</b> 自制测试释义</div>\0', '@@@LINK=cycle\n', '<p>last entry 跨块末词</p>\0'];
  const header = Buffer.from(`<Dictionary GeneratedByEngineVersion="${version}" Encoding="UTF-8" Encrypted="0" KeyCaseSensitive="No" StripKey="Yes"/>\0`, 'utf16le');
  let offset = 0;
  const keyRaw = Buffer.concat(words.map((word, i) => { const key = Buffer.concat([number(offset, width), Buffer.from(word + '\0')]); offset += Buffer.byteLength(definitions[i]); return key; }));
  const keys = block(keyRaw);
  const wordInfo = word => Buffer.concat([number(word.length, modern ? 2 : 1), Buffer.from(word + (modern ? '\0' : ''))]);
  const infoRaw = Buffer.concat([number(words.length, width), wordInfo(words[0]), wordInfo(words.at(-1)), number(keys.length, width), number(keyRaw.length, width)]);
  const info = modern ? block(infoRaw) : infoRaw;
  const keyHeader = Buffer.concat([number(1, width), number(words.length, width), ...(modern ? [number(infoRaw.length, width)] : []), number(info.length, width), number(keys.length, width)]);
  const records = Buffer.from(definitions.join(''));
  const parts = []; for (let i = 0; i < records.length; i += 23) parts.push(records.subarray(i, i + 23));
  const packs = parts.map((p, i) => block(p, i % 2 === 0));
  const recordInfo = Buffer.concat(parts.map((p, i) => Buffer.concat([number(packs[i].length, width), number(p.length, width)])));
  const recordHeader = Buffer.concat([number(parts.length, width), number(words.length, width), number(recordInfo.length, width), number(packs.reduce((n, p) => n + p.length, 0), width)]);
  return Buffer.concat([number(header.length), header, number(adler(header), 4, true), keyHeader, ...(modern ? [number(adler(keyHeader))] : []), info, keys, recordHeader, recordInfo, ...packs]);
}
const source = bytes => ({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });

for (const version of [1.2, 2]) {
  test(`MDX ${version}: Unicode, aliases, case, raw/zlib and cross-block last entry`, async () => {
    const dict = await MDXDictionary.open(source(fixture(version)));
    assert.equal(dict.count, 4);
    assert.match((await dict.lookup('APPLE'))[0].html, /自制测试释义/);
    assert.equal((await dict.lookup('alias'))[0].headword, 'apple');
    assert.equal((await dict.lookup('zebra'))[0].html, '<p>last entry 跨块末词</p>');
    assert.deepEqual(await dict.lookup('absent'), []);
    await assert.rejects(() => dict.lookup('cycle'), /循环/);
  });
}
test('Corrupt headers and compressed record payloads are rejected', async () => {
  const header = fixture(2); header[10] ^= 1;
  await assert.rejects(() => MDXDictionary.open(source(header)), /校验/);
  const payload = fixture(2); payload[payload.length - 1] ^= 1;
  const dict = await MDXDictionary.open(source(payload));
  await assert.rejects(() => dict.lookup('zebra'));
});
