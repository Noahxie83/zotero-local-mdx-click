/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MDDArchive, resourceKey } from './mdx.js';

export const MAX_RESOURCE = 64 * 1024 * 1024;
const MIME = {
  css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', avif: 'image/avif', ttf: 'font/ttf', otf: 'font/otf',
  woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', spx: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};

export function mimeType(key) {
  return MIME[key.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

// Paths in a dictionary are relative to its resource root, never arbitrary
// computer paths. A leading slash/backslash is an MDict archive root marker.
export function localReference(reference, base = '') {
  let value = String(reference).trim();
  if (!value || value.startsWith('#')) return null;
  value = value.replace(/^(sound|res):\/\//i, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return null;
  value = value.split(/[?#]/, 1)[0];
  try { value = decodeURIComponent(value); } catch { /* Literal % is legal. */ }
  value = value.replace(/\\/g, '/');
  if (/[\0-\x1f:]/.test(value)) return null;
  const root = value.startsWith('/');
  const parts = root ? [] : base.split('/').slice(0, -1);
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

export function decodeStyle(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const probe = new TextDecoder().decode(bytes.subarray(0, 256));
  const charset = probe.match(/^\s*@charset\s+["']([^"']+)/i)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}

export class LocalResources {
  static async open(options) {
    const result = new LocalResources(options);
    await result.discover(); return result;
  }

  constructor({ mdxPath, folder = '', extraArchives = [], fs }) {
    this.fs = fs;
    this.mdxPath = mdxPath;
    this.root = fs.dirname(mdxPath);
    this.folders = [...new Set([folder, this.root].filter(Boolean))];
    this.extraArchives = extraArchives;
    this.archives = [];
    this.archivePromises = new Map();
    this.locations = new Map();
    this.directoryMaps = new Map();
    this.errors = new Set();
    this.closed = false;
  }

  async discover() {
    const stem = this.fs.basename(this.mdxPath).replace(/\.mdx$/i, '');
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escaped + '(?:\\.(\\d+))?\\.mdd$', 'i');
    const files = [];
    for (const folder of this.folders) {
      let paths;
      try { paths = await this.fs.list(folder); }
      catch (e) { this.errors.add('资源目录无法读取：' + folder); continue; }
      for (const path of paths) {
        const match = this.fs.basename(path).match(pattern);
        if (match) files.push({ path, number: match[1] ? Number(match[1]) : -1 });
      }
    }
    files.sort((a, b) => a.number - b.number);
    this.archives = [...new Set([...files.map(item => item.path), ...this.extraArchives])];
  }

  async _archive(path) {
    if (!this.archivePromises.has(path)) {
      this.archivePromises.set(path, (async () => {
        try { return await MDDArchive.open(await this.fs.source(path)); }
        catch (e) { this.errors.add(this.fs.basename(path) + '：' + e.message); return null; }
      })());
    }
    return this.archivePromises.get(path);
  }

  async _loose(folder, key) {
    // Resolve one directory at a time, including case differences on systems
    // whose filesystem is case sensitive. Do not scan unrelated subfolders.
    let directory = folder;
    const segments = key.split('/');
    for (let i = 0; i < segments.length; i++) {
      if (!this.directoryMaps.has(directory)) {
        const pending = this.fs.list(directory).then(paths => new Map(paths.map(path => [this.fs.basename(path).normalize('NFC').toLowerCase(), path]))).catch(() => new Map());
        this.directoryMaps.set(directory, pending);
      }
      const names = await this.directoryMaps.get(directory);
      const path = names.get(segments[i].normalize('NFC').toLowerCase());
      if (!path) return null;
      const stat = await this.fs.stat(path);
      if (i === segments.length - 1) {
        if (stat.type !== 'regular' || stat.size > MAX_RESOURCE) return null;
        return path;
      }
      if (stat.type !== 'directory') return null;
      directory = path;
    }
    return null;
  }

  async read(key) {
    if (this.closed) throw new Error('资源读取已结束。');
    const normalized = resourceKey(key);
    if (this.locations.has(normalized)) {
      const location = this.locations.get(normalized);
      if (!location) return null;
      if (location.file) return { key, bytes: await this.fs.readFile(location.file), mime: mimeType(key) };
      const archive = await this._archive(location.archive);
      const bytes = await archive?.lookupBytes(key);
      return bytes ? { key, bytes, mime: mimeType(key) } : null;
    }
    for (const folder of this.folders) {
      const path = await this._loose(folder, key);
      if (path) {
        this._remember(normalized, { file: path });
        return { key, bytes: await this.fs.readFile(path), mime: mimeType(key) };
      }
    }
    for (const path of this.archives) {
      const archive = await this._archive(path);
      if (!archive) continue;
      try {
        const bytes = await archive.lookupBytes(key);
        if (bytes) { this._remember(normalized, { archive: path }); return { key, bytes, mime: mimeType(key) }; }
      } catch (e) { this.errors.add(this.fs.basename(path) + '：' + e.message); }
    }
    this._remember(normalized, null); return null;
  }

  _remember(key, location) {
    this.locations.set(key, location);
    if (this.locations.size > 2048) this.locations.delete(this.locations.keys().next().value);
  }

  close() {
    this.closed = true;
    for (const pending of this.archivePromises.values()) pending.then(archive => archive?.clearCache());
    this.archivePromises.clear(); this.locations.clear(); this.directoryMaps.clear();
  }
}
