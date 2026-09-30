/* SPDX-License-Identifier: GPL-3.0-or-later */
import codecBytes from './vendor/speex/decoder.wasm';

const MAX_INPUT = 8 * 1024 * 1024, MAX_PCM = 16 * 1024 * 1024;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i << 24;
  for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
  crcTable[i] = value >>> 0;
}
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const magic = (bytes, offset, text) => [...text].every((letter, i) => bytes[offset + i] === letter.charCodeAt(0));
let compiled;

export function isOggSpeex(bytes) {
  return bytes.length >= 35 && magic(bytes, 0, 'OggS') && magic(bytes, 27 + bytes[26], 'Speex   ');
}

function parseOgg(bytes) {
  requireValue(bytes instanceof Uint8Array && bytes.length > 27 && bytes.length <= MAX_INPUT, 'SPX 文件为空或超过 8 MB 解码限额。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const streams = new Map();
  let offset = 0, packetCount = 0, pageCount = 0;
  while (offset < bytes.length) {
    requireValue(++pageCount <= 10000 && offset + 27 <= bytes.length && magic(bytes, offset, 'OggS') && bytes[offset + 4] === 0, 'Ogg/SPX 页头损坏或文件不完整。');
    const flags = bytes[offset + 5], segments = bytes[offset + 26];
    const bodyStart = offset + 27 + segments;
    requireValue(flags < 8 && bodyStart <= bytes.length, 'Ogg/SPX 分段表损坏。');
    let bodySize = 0;
    for (let i = 0; i < segments; i++) bodySize += bytes[offset + 27 + i];
    const end = bodyStart + bodySize;
    requireValue(end <= bytes.length, 'Ogg/SPX 音频数据不完整。');
    let crc = 0;
    for (let i = offset; i < end; i++) {
      const byte = i >= offset + 22 && i < offset + 26 ? 0 : bytes[i];
      crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]) >>> 0;
    }
    requireValue(crc === view.getUint32(offset + 22, true), 'Ogg/SPX 页校验失败，音频资源可能损坏。');
    const serial = view.getUint32(offset + 14, true), sequence = view.getUint32(offset + 18, true);
    let stream = streams.get(serial);
    if (!stream) {
      requireValue((flags & 2) && !(flags & 1) && streams.size < 8, 'Ogg/SPX 缺少起始页或逻辑流过多。');
      stream = { packets: [], partial: [], partialSize: 0, sequence, start: offset, end: 0, granule: -1, eos: false };
      streams.set(serial, stream);
    } else {
      requireValue(!stream.eos && !(flags & 2) && sequence === ((stream.sequence + 1) >>> 0), 'Ogg/SPX 页顺序不连续。');
      stream.sequence = sequence;
    }
    requireValue(Boolean(flags & 1) === (stream.partialSize > 0), 'Ogg/SPX 跨页数据包不完整。');
    let position = bodyStart;
    for (let i = 0; i < segments; i++) {
      const length = bytes[offset + 27 + i];
      stream.partial.push(bytes.subarray(position, position + length));
      stream.partialSize += length; position += length;
      requireValue(stream.partialSize <= 1024 * 1024, 'Ogg/SPX 单个数据包过大。');
      if (length < 255) {
        requireValue(++packetCount <= 8192, 'Ogg/SPX 数据包过多。');
        const packet = new Uint8Array(stream.partialSize); let at = 0;
        for (const piece of stream.partial) { packet.set(piece, at); at += piece.length; }
        stream.packets.push(packet); stream.partial = []; stream.partialSize = 0;
      }
    }
    const granule = view.getBigInt64(offset + 6, true);
    requireValue(granule >= -1n && granule <= BigInt(Number.MAX_SAFE_INTEGER), 'Ogg/SPX 采样位置无效。');
    if (granule >= 0n) stream.granule = Number(granule);
    if (flags & 4) {
      requireValue(!stream.partialSize, 'Ogg/SPX 最后一个数据包不完整。');
      stream.eos = true; stream.end = end;
    }
    offset = end;
  }
  const speex = [...streams.values()].filter(stream => magic(stream.packets[0] || [], 0, 'Speex   '));
  requireValue(speex.length > 0, '该 SPX 不是标准 Ogg/Speex 文件，无法确定解码参数。');
  for (let i = 0; i < speex.length; i++) {
    requireValue(speex[i].eos, 'Ogg/Speex 文件缺少结束页。');
    if (i) requireValue(speex[i].start >= speex[i - 1].end, '暂不支持交错的多个 Speex 音轨。');
  }
  return speex;
}

function header(stream) {
  const bytes = stream.packets[0];
  requireValue(bytes.length >= 80, 'Speex 头部不完整。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getInt32(32, true), version = view.getInt32(28, true);
  const rate = view.getInt32(36, true), mode = view.getInt32(40, true), bitstream = view.getInt32(44, true);
  const channels = view.getInt32(48, true), frameSize = view.getInt32(56, true);
  const frames = view.getInt32(64, true) || 1, extra = view.getInt32(68, true);
  requireValue(size >= 80 && size <= bytes.length && version >= 0 && version <= 1, 'Speex 头部版本不支持。');
  requireValue(rate >= 4000 && rate <= 192000 && mode >= 0 && mode <= 2 && (channels === 1 || channels === 2), 'Speex 采样率、声道或编码模式不支持。');
  requireValue(frames >= 1 && frames <= 64 && extra >= 0 && extra <= 64 && stream.packets.length > 2 + extra, 'Speex 包含无效的帧数或附加头部。');
  requireValue(stream.granule <= rate * 30, 'SPX 发音超过 30 秒解码限额。');
  return { rate, mode, bitstream, channels, frameSize, frames, extra };
}

async function instance(randomFill) {
  if (!compiled) compiled = WebAssembly.compile(codecBytes).catch(error => { compiled = undefined; throw error; });
  let memory;
  const wasi = {
    fd_write(fd, iovs, count, output) {
      const view = new DataView(memory.buffer); let length = 0;
      if (count < 0 || count > 1024 || iovs < 0 || iovs + count * 8 > view.byteLength || output < 0 || output + 4 > view.byteLength) return 21;
      for (let i = 0; i < count; i++) length += view.getUint32(iovs + i * 8 + 4, true);
      view.setUint32(output, length >>> 0, true); return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 29,
    proc_exit: () => { throw new Error('Speex 解码器停止，音频数据可能损坏。'); },
    random_get(pointer, length) {
      const bytes = new Uint8Array(memory.buffer);
      if (pointer < 0 || length < 0 || pointer + length > bytes.length) return 21;
      for (let offset = 0; offset < length; offset += 65536) randomFill(bytes.subarray(pointer + offset, pointer + Math.min(length, offset + 65536)));
      return 0;
    },
  };
  const module = await WebAssembly.instantiate(await compiled, { wasi_snapshot_preview1: wasi });
  memory = module.exports.memory; module.exports._initialize?.();
  return module.exports;
}

function trimChunks(chunks, skip, length) {
  const result = [];
  for (const chunk of chunks) {
    const start = Math.min(skip, chunk.length); skip -= start;
    const end = start + Math.min(length, chunk.length - start);
    if (end > start) { result.push(chunk.subarray(start, end)); length -= end - start; }
    if (!length) break;
  }
  return result;
}

export async function decodeSpeex(bytes, { cancelled = () => false, yieldControl, randomFill = buffer => globalThis.crypto.getRandomValues(buffer) } = {}) {
  // IOUtils may return a typed array from another privileged JS compartment.
  requireValue(bytes?.byteLength > 0 && bytes.byteLength <= MAX_INPUT, 'SPX 文件为空或超过 8 MB 解码限额。');
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const streams = parseOgg(bytes), output = []; let format, totalBytes = 0, totalFrames = 0;
  for (const stream of streams) {
    requireValue(!cancelled(), '发音查询已关闭。');
    const info = header(stream);
    if (format) requireValue(format.rate === info.rate && format.channels === info.channels, '连续 Speex 音轨的采样率或声道不一致。');
    format = info;
    requireValue(stream.granule < 0 || totalFrames + stream.granule <= info.rate * 30, 'SPX 整个文件的累计发音超过 30 秒解码限额。');
    const api = await instance(randomFill);
    requireValue(api.spx_version(info.mode) === info.bitstream, 'Speex 位流版本与附带解码器不兼容。');
    let decoder = 0, input = 0, pcm = 0;
    const chunks = []; let samples = 0;
    try {
      decoder = api.spx_open(info.mode, info.channels, info.rate);
      requireValue(decoder, '无法初始化 Speex 解码器。');
      const frameSize = api.spx_frame_size(decoder), lookahead = api.spx_lookahead(decoder);
      requireValue(frameSize > 0 && frameSize <= 640 && info.frameSize === frameSize && lookahead >= 0 && lookahead <= 1280, 'Speex 帧大小或解码延迟无效。');
      const capacity = frameSize * info.channels * info.frames;
      input = api.spx_alloc(65536); pcm = api.spx_alloc(capacity * 2);
      requireValue(input && pcm, 'Speex 解码内存不足。');
      for (let i = 2 + info.extra; i < stream.packets.length; i++) {
        requireValue(!cancelled(), '发音查询已关闭。');
        const packet = stream.packets[i];
        requireValue(packet.length > 0 && packet.length <= 65536, 'Speex 音频数据包为空或过大。');
        new Uint8Array(api.memory.buffer).set(packet, input);
        const count = api.spx_packet(decoder, input, packet.length, pcm, info.frames, capacity);
        requireValue(count >= 0 && count <= frameSize * info.frames, 'Speex 音频帧损坏，无法解码。');
        const length = count * info.channels * 2;
        samples += count;
        // Include prior logical streams while decoding, allowing only one
        // packet of codec padding until the stream's final granule is applied.
        requireValue(totalFrames + Math.max(0, samples - lookahead) <= info.rate * 30 + frameSize * info.frames, 'SPX 整个文件的累计发音超过 30 秒解码限额。');
        requireValue(samples <= info.rate * 30 + lookahead + frameSize * info.frames && totalBytes + samples * info.channels * 2 <= MAX_PCM, 'SPX 解码后的发音过长或超过 16 MB 限额。');
        if (length) chunks.push(new Uint8Array(api.memory.buffer, pcm, length).slice());
        if (yieldControl && i % 16 === 0) await yieldControl();
      }
      const audible = Math.max(0, samples - lookahead);
      const frames = stream.granule >= 0 ? Math.min(audible, stream.granule) : audible;
      const length = frames * info.channels * 2;
      requireValue(length > 0, 'Speex 音频没有可播放的采样。');
      requireValue(totalFrames + frames <= info.rate * 30, 'SPX 整个文件的累计发音超过 30 秒解码限额。');
      output.push(...trimChunks(chunks, lookahead * info.channels * 2, length)); totalBytes += length;
      totalFrames += frames;
    } finally {
      if (decoder) api.spx_close(decoder);
      if (input) api.spx_free(input);
      if (pcm) api.spx_free(pcm);
    }
  }
  requireValue(!cancelled() && totalBytes > 0 && totalBytes <= MAX_PCM, '发音已关闭或解码后数据过大。');
  const wav = new Uint8Array(44 + totalBytes), view = new DataView(wav.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  }
  view.setUint32(4, wav.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true); view.setUint32(24, format.rate, true);
  view.setUint32(28, format.rate * format.channels * 2, true); view.setUint16(32, format.channels * 2, true);
  view.setUint16(34, 16, true); view.setUint32(40, totalBytes, true);
  let offset = 44; for (const chunk of output) { wav.set(chunk, offset); offset += chunk.length; }
  return wav;
}
