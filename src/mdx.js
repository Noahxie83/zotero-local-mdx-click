// SPDX-License-Identifier: GPL-3.0-or-later
// MDX v1/v2 container reader. This module never evaluates dictionary HTML or JS.
import { Inflate } from "pako";
import lzo from "./vendor/lzo1x.ts";
import { ripemd128 } from "./vendor/ripemd128.ts";

const MAX_HEADER = 16 * 1024 * 1024;
const MAX_BLOCK = 128 * 1024 * 1024;
const MAX_ENTRY = 16 * 1024 * 1024;
const MAX_ENTRIES = 10_000_000;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

function ensure(ok, message) {
  if (!ok) throw new Error(`MDX: ${message}`);
}

class Cursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n) {
    ensure(Number.isSafeInteger(n) && n >= 0 && this.at + n <= this.bytes.length, "词典结构不完整或长度无效");
    const bytes = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return bytes;
  }
  num(width) {
    const at = this.at;
    this.take(width);
    let value;
    if (width === 1) value = this.view.getUint8(at);
    else if (width === 2) value = this.view.getUint16(at, false);
    else if (width === 4) value = this.view.getUint32(at, false);
    else if (width === 8) value = this.view.getUint32(at, false) * 4294967296 + this.view.getUint32(at + 4, false);
    else throw new Error("MDX: 无效的数字宽度");
    ensure(Number.isSafeInteger(value), "词典偏移超过 JavaScript 可安全读取范围");
    return value;
  }
  zeroTerminated(unit) {
    const start = this.at;
    for (; this.at + unit <= this.bytes.length; this.at += unit) {
      if (this.bytes[this.at] === 0 && (unit === 1 || this.bytes[this.at + 1] === 0)) {
        const result = this.bytes.subarray(start, this.at);
        this.at += unit;
        return result;
      }
    }
    throw new Error("MDX: 词条索引缺少结束符");
  }
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let begin = 0; begin < bytes.length; begin += 5552) {
    const end = Math.min(begin + 5552, bytes.length);
    for (let i = begin; i < end; i++) { a += bytes[i]; b += a; }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function unpack(bytes, expected) {
  ensure(bytes.length >= 8, "压缩块长度不足");
  ensure(Number.isSafeInteger(expected) && expected >= 0 && expected <= MAX_BLOCK, "词典数据块过大");
  ensure(bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0, "未知压缩格式");
  const checksum = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, false);
  let result;
  if (bytes[0] === 0) result = bytes.subarray(8);
  else if (bytes[0] === 2) {
    // Bound output while inflating, before a corrupt block can allocate arbitrarily.
    result = new Uint8Array(expected);
    let written = 0;
    const decoder = new Inflate({ chunkSize: 65536 });
    decoder.onData = chunk => {
      ensure(written + chunk.length <= expected, "压缩块展开超过声明长度");
      result.set(chunk, written);
      written += chunk.length;
    };
    decoder.push(bytes.subarray(8), true);
    ensure(!decoder.err && decoder.ended && written === expected, "zlib 数据块解压失败或长度不符");
  }
  else if (bytes[0] === 1) {
    result = lzo.decompress({ inputBuffer: bytes.subarray(8), maxOutputLength: expected });
    ensure(result instanceof Uint8Array, "LZO 数据块解压失败");
  } else throw new Error(`MDX: 不支持压缩类型 ${bytes[0]}`);
  ensure(result.length === expected, "解压后的数据长度与索引不一致");
  ensure(adler32(result) === checksum, "数据块校验失败，词典可能损坏");
  return result;
}

function xmlEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (whole, code) => {
    if (code[0] === "#") {
      const cp = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return cp <= 0x10ffff && cp >= 0 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[code.toLowerCase()];
  });
}

function attributes(header) {
  const result = Object.create(null);
  for (const m of header.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[m[1]] = xmlEntities(m[2] ?? m[3]);
  return result;
}

// MDX 2's Encrypted=2 obfuscates the key-info payload only. The block checksum
// remains readable and supplies the RIPEMD-128 seed; record contents are plain.
function decodeKeyInfo(bytes) {
  ensure(bytes.length >= 8, "关键词信息块长度不足");
  const seed = new Uint8Array(8);
  seed.set(bytes.subarray(4, 8)); seed[4] = 0x95; seed[5] = 0x36;
  const key = ripemd128(seed);
  const out = bytes.slice();
  let previous = 0x36;
  for (let i = 8; i < out.length; i++) {
    const original = bytes[i];
    out[i] = (((original >>> 4) | (original << 4)) & 255) ^ previous ^ ((i - 8) & 255) ^ key[(i - 8) % 16];
    previous = original;
  }
  return out;
}

export class MDXDictionary {
  static async open(source) {
    ensure(source && typeof source.read === "function" && Number.isSafeInteger(source.size) && source.size >= 24, "无法读取词典文件");
    const dict = new MDXDictionary(source);
    await dict._open();
    return dict;
  }

  constructor(source) {
    this.source = source;
    this.title = "本地 MDX 词典";
    this.count = 0;
    this.stats = {};
    this._keys = new Map();
    this._records = [];
    this._cache = new Map();
    this._pending = new Map();
    this._cacheBytes = 0;
  }

  async _read(offset, length) {
    ensure(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && length <= MAX_BLOCK && offset + length <= this.source.size, "读取位置超出词典文件范围");
    const result = await this.source.read(offset, length);
    ensure(ArrayBuffer.isView(result) && result.BYTES_PER_ELEMENT === 1 && result.byteLength === length, "词典文件读取不完整");
    // IOUtils may return a Uint8Array from a different Firefox compartment.
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }

  _normalize(word) {
    let value = String(word).normalize("NFC").trim();
    if (!this._caseSensitive) value = value.toLowerCase();
    if (this._stripKey) value = value.replace(/[()., '\-&/\\@_$]/g, "");
    return value;
  }

  async _open() {
    const size = new Cursor(await this._read(0, 4)).num(4);
    ensure(size >= 2 && size <= MAX_HEADER && size % 2 === 0, "MDX 文件头无效");
    const headerBytes = await this._read(4, size);
    const checkBytes = await this._read(4 + size, 4);
    const headerChecksum = new DataView(checkBytes.buffer, checkBytes.byteOffset, 4).getUint32(0, true);
    ensure(adler32(headerBytes) === headerChecksum, "词典文件头校验失败");
    this.header = attributes(new TextDecoder("utf-16le").decode(headerBytes));
    const version = Number.parseFloat(this.header.GeneratedByEngineVersion || this.header.RequiredEngineVersion);
    ensure(Number.isFinite(version) && version >= 1 && version < 3, "目前仅支持 MDX 1.x / 2.x 词典");
    const encryption = this.header.Encrypted || "0";
    const encryptionBits = encryption.toLowerCase() === "no" ? 0 : Number(encryption);
    ensure(encryptionBits === 0 || (encryptionBits === 2 && version >= 2), "暂不支持需要密码的 MDX 词典");
    const encoding = (this.header.Encoding || "UTF-8").toUpperCase().replaceAll("_", "-");
    const decoderName = encoding === "UTF-16" ? "utf-16le" : ["GBK", "GB2312"].includes(encoding) ? "gb18030" : encoding;
    try { this._decoder = new TextDecoder(decoderName); } catch { throw new Error(`MDX: 不支持词典编码 ${encoding}`); }
    this._unit = decoderName.toLowerCase().startsWith("utf-16") ? 2 : 1;
    this._caseSensitive = this.header.KeyCaseSensitive === "Yes";
    this._stripKey = this.header.StripKey !== "No";
    this.title = (this.header.Title || "").replace(/<[^>]*>/g, "").trim() || "本地 MDX 词典";

    const modern = version >= 2;
    const width = modern ? 8 : 4;
    let at = 4 + size + 4;
    const keyHeaderBytes = await this._read(at, modern ? 40 : 16);
    const kh = new Cursor(keyHeaderBytes);
    const keyBlockCount = kh.num(width);
    this.count = kh.num(width);
    const keyInfoUnpackedSize = modern ? kh.num(width) : null;
    const keyInfoSize = kh.num(width);
    const keyBlocksSize = kh.num(width);
    ensure(keyBlockCount > 0 && keyBlockCount <= MAX_ENTRIES && this.count > 0 && this.count <= MAX_ENTRIES, "词典索引数量无效或过大");
    at += keyHeaderBytes.length;
    if (modern) {
      const checksum = new Cursor(await this._read(at, 4)).num(4);
      ensure(adler32(keyHeaderBytes) === checksum, "关键词文件头校验失败");
      at += 4;
    }
    const keyInfoRaw = await this._read(at, keyInfoSize);
    const ki = new Cursor(modern ? unpack(encryptionBits === 2 ? decodeKeyInfo(keyInfoRaw) : keyInfoRaw, keyInfoUnpackedSize) : keyInfoRaw);
    at += keyInfoSize;
    const keyBlocksAt = at;
    const keyBlocks = [];
    let keyPackedSum = 0;
    let keyEntrySum = 0;
    for (let i = 0; i < keyBlockCount; i++) {
      const entries = ki.num(width);
      for (let j = 0; j < 2; j++) {
        const chars = ki.num(modern ? 2 : 1);
        ki.take((chars + (modern ? 1 : 0)) * this._unit);
      }
      const packed = ki.num(width);
      const unpacked = ki.num(width);
      ensure(packed >= 8 && packed <= MAX_BLOCK && unpacked <= MAX_BLOCK, "关键词块长度无效");
      keyBlocks.push({ entries, packed, unpacked, at: keyBlocksAt + keyPackedSum });
      keyPackedSum += packed;
      keyEntrySum += entries;
    }
    ensure(ki.at === ki.bytes.length && keyPackedSum === keyBlocksSize && keyEntrySum === this.count, "关键词索引总数或长度不一致");

    at = keyBlocksAt + keyBlocksSize;
    const rh = new Cursor(await this._read(at, width * 4));
    const recordBlockCount = rh.num(width);
    const recordEntries = rh.num(width);
    const recordInfoSize = rh.num(width);
    const recordPackedSize = rh.num(width);
    ensure(recordBlockCount > 0 && recordBlockCount <= MAX_ENTRIES && recordEntries === this.count && recordInfoSize === recordBlockCount * width * 2, "释义索引无效");
    at += width * 4;
    const ri = new Cursor(await this._read(at, recordInfoSize));
    at += recordInfoSize;
    let packedTotal = 0;
    let rawTotal = 0;
    for (let i = 0; i < recordBlockCount; i++) {
      const packed = ri.num(width);
      const unpacked = ri.num(width);
      ensure(packed >= 8 && packed <= MAX_BLOCK && unpacked > 0 && unpacked <= MAX_BLOCK, "释义块长度无效");
      this._records.push({ at: at + packedTotal, packed, unpacked, start: rawTotal, end: rawTotal + unpacked });
      packedTotal += packed;
      rawTotal += unpacked;
      ensure(Number.isSafeInteger(rawTotal), "释义数据超过安全读取范围");
    }
    ensure(packedTotal === recordPackedSize && at + packedTotal <= this.source.size, "释义数据总长度不一致");
    this._rawTotal = rawTotal;

    const entries = [];
    let previous = -1;
    for (const block of keyBlocks) {
      const cur = new Cursor(unpack(await this._read(block.at, block.packed), block.unpacked));
      for (let i = 0; i < block.entries; i++) {
        const offset = cur.num(width);
        const headword = this._decoder.decode(cur.zeroTerminated(this._unit));
        ensure(offset >= previous && offset < rawTotal, "释义偏移无效或未按顺序排列");
        previous = offset;
        const entry = { headword, start: offset, end: 0 };
        entries.push(entry);
        const key = this._normalize(headword);
        if (!this._keys.has(key)) this._keys.set(key, []);
        this._keys.get(key).push(entry);
      }
      ensure(cur.at === cur.bytes.length, "关键词块包含未识别数据");
    }
    let end = rawTotal;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (i + 1 < entries.length && entries[i].start < entries[i + 1].start) end = entries[i + 1].start;
      entries[i].end = end;
    }
    this.stats = { version, encoding, entries: this.count, keyBlocks: keyBlockCount, recordBlocks: recordBlockCount, fileSize: this.source.size };
  }

  async _recordBlock(index) {
    if (this._cache.has(index)) {
      const bytes = this._cache.get(index);
      this._cache.delete(index);
      this._cache.set(index, bytes);
      return bytes;
    }
    if (this._pending.has(index)) return this._pending.get(index);
    const job = (async () => {
      const block = this._records[index];
      const bytes = unpack(await this._read(block.at, block.packed), block.unpacked);
      if (bytes.length > MAX_CACHE_BYTES) return bytes;
      this._cache.set(index, bytes);
      this._cacheBytes += bytes.length;
      while (this._cacheBytes > MAX_CACHE_BYTES && this._cache.size > 1) {
        const oldest = this._cache.keys().next().value;
        this._cacheBytes -= this._cache.get(oldest).length;
        this._cache.delete(oldest);
      }
      return bytes;
    })();
    this._pending.set(index, job);
    try { return await job; } finally { this._pending.delete(index); }
  }

  async _entryHTML(entry) {
    const length = entry.end - entry.start;
    ensure(length >= 0 && length <= MAX_ENTRY, "单个词条超过初版支持的 16 MB 限制");
    let lo = 0;
    let hi = this._records.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._records[mid].end <= entry.start) lo = mid + 1;
      else hi = mid;
    }
    const result = new Uint8Array(length);
    let written = 0;
    for (let i = lo; i < this._records.length && this._records[i].start < entry.end; i++) {
      const block = this._records[i];
      const bytes = await this._recordBlock(i);
      const slice = bytes.subarray(Math.max(0, entry.start - block.start), Math.min(bytes.length, entry.end - block.start));
      result.set(slice, written);
      written += slice.length;
    }
    ensure(written === length, "词条释义跨块读取不完整");
    return this._decoder.decode(result).replace(/\0+$/, "");
  }

  async lookup(word) {
    return this._lookup(String(word).trim(), new Set(), 0);
  }

  async _lookup(word, visited, depth) {
    if (!word) return [];
    const key = this._normalize(word);
    ensure(depth < 20 && !visited.has(key), "词典内部跳转形成循环或跳转过多");
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    let entries = this._keys.get(key) || [];
    // Prefer the word as written: "be" should not also show "Be" or "be-".
    // Duplicate exact headwords remain available because MDX uses them for senses.
    const exact = entries.filter(entry => entry.headword.normalize("NFC") === word.normalize("NFC"));
    if (exact.length) entries = exact;
    else {
      const folded = entries.filter(entry => entry.headword.normalize("NFC").toLowerCase() === word.normalize("NFC").toLowerCase());
      if (folded.length) entries = folded;
    }
    const results = [];
    const seenOffsets = new Set();
    for (const entry of entries) {
      if (seenOffsets.has(entry.start)) continue;
      seenOffsets.add(entry.start);
      const html = await this._entryHTML(entry);
      const link = html.trim().match(/^@@@LINK=([^\r\n\0]+)\s*$/);
      if (link) results.push(...await this._lookup(link[1].trim(), nextVisited, depth + 1));
      else results.push({ headword: entry.headword, html });
    }
    const unique = new Map();
    for (const result of results) unique.set(`${result.headword}\0${result.html}`, result);
    return [...unique.values()];
  }

  clearCache() {
    this._cache.clear();
    this._cacheBytes = 0;
  }
}
