/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MDDArchive, resourceKey } from './mdx.js';

export const MAX_RESOURCE = 64 * 1024 * 1024;
export class ResourceCancelledError extends Error {
  constructor(message = '资源读取已结束。') { super(message); this.name = 'AbortError'; this.code = 'LOCAL_MDX_CANCELLED'; }
}
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
    this._errorCount = 0;
    this.closed = false;
  }

  _checkActive() {
    if (this.closed) throw new ResourceCancelledError();
    this.fs.guard?.();
  }

  _failure(path, error) {
    this._checkActive();
    if (error?.name === 'AbortError' || error?.code === 'LOCAL_MDX_CANCELLED') throw error;
    this._errorCount++;
    this.errors.add(path + '：' + String(error?.message || error));
  }

  async discover() {
    const stem = this.fs.basename(this.mdxPath).replace(/\.mdx$/i, '');
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escaped + '(?:\\.(\\d+))?\\.mdd$', 'i');
    const files = [];
    for (const folder of this.folders) {
      let paths;
      try { this._checkActive(); paths = await this.fs.list(folder); this._checkActive(); }
      catch (e) { this._failure(folder, e); continue; }
      for (const path of paths) {
        const match = this.fs.basename(path).match(pattern);
        if (match) files.push({ path, number: match[1] ? Number(match[1]) : -1 });
      }
    }
    files.sort((a, b) => a.number - b.number);
    this.archives = [...new Set([...files.map(item => item.path), ...this.extraArchives])];
  }

  async _archive(path) {
    this._checkActive();
    if (!this.archivePromises.has(path)) {
      this.archivePromises.set(path, (async () => {
        try { return await MDDArchive.open(await this.fs.source(path)); }
        catch (e) { this._failure(path, e); return null; }
      })());
    }
    const pending = this.archivePromises.get(path);
    try {
      const archive = await pending; this._checkActive();
      if (!archive && this.archivePromises.get(path) === pending) this.archivePromises.delete(path);
      return archive;
    } catch (e) {
      if (this.archivePromises.get(path) === pending) this.archivePromises.delete(path);
      throw e;
    }
  }

  async _loose(folder, key) {
    // Resolve one directory at a time, including case differences on systems
    // whose filesystem is case sensitive. Do not scan unrelated subfolders.
    let directory = folder;
    const segments = key.split('/');
    for (let i = 0; i < segments.length; i++) {
      this._checkActive();
      if (!this.directoryMaps.has(directory)) {
        const pending = Promise.resolve().then(() => this.fs.list(directory)).then(paths => {
          this._checkActive(); return new Map(paths.map(path => [this.fs.basename(path).normalize('NFC').toLowerCase(), path]));
        });
        this.directoryMaps.set(directory, pending);
      }
      const pending = this.directoryMaps.get(directory);
      let names;
      try { names = await pending; this._checkActive(); }
      catch (e) {
        if (this.directoryMaps.get(directory) === pending) this.directoryMaps.delete(directory);
        this._failure(directory, e); return null;
      }
      const path = names.get(segments[i].normalize('NFC').toLowerCase());
      if (!path) return null;
      let stat;
      try { stat = await this.fs.stat(path); this._checkActive(); }
      catch (e) { this._failure(path, e); return null; }
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
    this._checkActive();
    const normalized = resourceKey(key);
    const failedBefore = this._errorCount, tried = new Set();
    if (this.locations.has(normalized)) {
      const location = this.locations.get(normalized);
      if (!location) return null;
      tried.add(location.file ? 'file:' + location.file : 'archive:' + location.archive);
      const resource = await this._readLocation(location, key);
      if (resource) return resource;
      this.locations.delete(normalized);
    }
    for (const folder of this.folders) {
      const path = await this._loose(folder, key);
      this._checkActive();
      if (!path || tried.has('file:' + path)) continue;
      tried.add('file:' + path);
      const location = { file: path }, resource = await this._readLocation(location, key);
      if (resource) { this._remember(normalized, location); return resource; }
    }
    for (const path of this.archives) {
      if (tried.has('archive:' + path)) continue;
      const location = { archive: path }, resource = await this._readLocation(location, key);
      if (resource) { this._remember(normalized, location); return resource; }
    }
    this._checkActive();
    // Transient I/O failures should be retried rather than cached as absence.
    if (failedBefore === this._errorCount) this._remember(normalized, null);
    return null;
  }

  async _readLocation(location, key) {
    const path = location.file || location.archive;
    try {
      this._checkActive();
      const bytes = location.file ? await this.fs.readFile(path) : await (await this._archive(path))?.lookupBytes(key);
      this._checkActive();
      if (!bytes) return null;
      if (bytes.byteLength > MAX_RESOURCE) throw new Error('资源文件超过读取大小限制。');
      return { key, bytes, mime: mimeType(key) };
    } catch (e) { this._failure(path, e); return null; }
  }

  _remember(key, location) {
    this.locations.set(key, location);
    if (this.locations.size > 2048) this.locations.delete(this.locations.keys().next().value);
  }

  close() {
    this.closed = true;
    for (const pending of this.archivePromises.values()) pending.then(archive => archive?.clearCache()).catch(() => {});
    this.archivePromises.clear(); this.locations.clear(); this.directoryMaps.clear();
  }
}
