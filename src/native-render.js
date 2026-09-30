/* SPDX-License-Identifier: GPL-3.0-or-later */
import { parseFragment } from 'parse5';
import parseCSS from 'css-tree/parser';
import walkCSS from 'css-tree/walker';
import generateCSS from 'css-tree/generator';
import { localReference, decodeStyle } from './resources.js';
import { resourceKey } from './mdx.js';
import { element } from './render.js';
import { decodeSpeex, isOggSpeex } from './speex.js';

const BLOCKED = new Set('script meta base iframe frame frameset object embed applet template noscript svg math form input button select textarea portal'.split(' '));
const VOID = new Set('area br col hr img source track wbr'.split(' '));
const BASE_STYLE = `
  html { color-scheme: light; background: white; color: #222; }
  body { margin: 0; padding: 12px 14px; font: 16px/1.5 'Segoe UI','Microsoft YaHei',sans-serif; overflow-wrap: break-word; }
  img { max-width: 100%; } a { color: inherit; text-decoration: none; }
  a[data-mdx-audio],a[data-mdx-entry] { cursor: pointer; }
  [data-mdx-audio]:focus-visible,[data-mdx-entry]:focus-visible { outline: 2px solid #0088d6; }
`;
export const NATIVE_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
// Some dictionaries hide pronunciation images until their own script starts.
// Show the already-resolved image of a playable link without running that script.
const CONTROLS_STYLE = `
  a[data-mdx-audio] img { display: inline-block !important; }
  ol[data-mdx-native-number]::before { content: none !important; display: none !important; }
  ol[data-mdx-native-number] > li::marker {
    color: var(--mdx-number-color, currentColor);
    font-weight: var(--mdx-number-weight, normal);
    font-size: var(--mdx-number-size, inherit);
  }
`;

function isListNumberContent(content, start) {
  if (!content || content === 'none' || content === 'normal') return false;
  // CSSOM may return either the resolved string or the original attr/counter
  // expression. Use the CSS parser to handle quoted strings and CSS escapes.
  let value;
  try { value = parseCSS(content, { context: 'value' }); } catch { return false; }
  let dynamic = false, uncertain = false;
  const text = [];
  value.children.forEach(part => {
    if (part.type === 'String') text.push(part.value);
    else if (part.type === 'WhiteSpace') return;
    else if (part.type === 'Function') {
      const name = part.name.toLowerCase();
      const argument = part.children.first;
      if (argument?.type === 'Identifier' &&
          ((name === 'attr' && argument.name.toLowerCase() === 'start') ||
           (name === 'counter' && argument.name.toLowerCase() === 'list-item'))) dynamic = true;
      else uncertain = true;
    } else uncertain = true;
  });
  if (uncertain) return false;
  if (dynamic) return /^[\s.()\[\]、:：]*$/.test(text.join(''));
  const number = text.join('').match(/^[\s(\[]*([+-]?\d+)[\s.)\]、:：]*$/);
  return !!number && Number(number[1]) === start;
}

function normalizeListNumbers(doc) {
  // A prefixed legacy list has no browser list markers in its source form.
  // Converting it to HTML <ol>/<li> adds markers. Only suppress its generated
  // number when an actual native numbered marker is also present.
  for (const list of doc.querySelectorAll('ol[data-mdx-prefixed-list]')) {
    const first = [...list.children].find(child => child.localName === 'li');
    if (!first) continue;
    const win = doc.defaultView;
    const itemStyle = win.getComputedStyle(first);
    if (!itemStyle.display.includes('list-item') ||
        !['decimal', 'decimal-leading-zero'].includes(itemStyle.listStyleType)) continue;
    const marker = win.getComputedStyle(first, '::marker').content;
    if (marker === 'none' || marker === '""' || marker === "''") continue;
    const before = win.getComputedStyle(list, '::before');
    if (before.display === 'none' || before.visibility === 'hidden' ||
        !isListNumberContent(before.content, list.start)) continue;
    // Retain the dictionary's color and emphasis on the remaining number.
    const color = before.color, weight = before.fontWeight, size = before.fontSize;
    list.style.setProperty('--mdx-number-color', color);
    list.style.setProperty('--mdx-number-weight', weight);
    list.style.setProperty('--mdx-number-size', size);
    list.setAttribute('data-mdx-native-number', '');
  }
}

// Every popup owns its URLs. Closing it revokes images/fonts/audio and stops
// pending preparation from allocating more URLs.
export class ResourceScope {
  constructor(resources, win, makeURL) {
    this.resources = resources;
    this.win = win;
    this.makeURL = makeURL;
    this.urls = new Map(); this.pending = new Map(); this.missing = new Set();
    this.optionalMissing = new Set();
    this.audioPending = new Map();
    this.bytes = 0; this.closed = false;
  }
  async url(reference, base = '', { required = true } = {}) {
    if (this.closed) throw new Error('查词窗口已关闭。');
    if (/^data:(image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/[^;,]+|application\/(?:font-woff|font-woff2|vnd.ms-fontobject|x-font-ttf|x-font-woff|x-font-opentype));/i.test(reference)) {
      return reference.length <= 4_000_000 ? reference : '';
    }
    const key = localReference(reference, base);
    if (!key) return '';
    const normalized = resourceKey(key);
    if (!this.pending.has(normalized)) {
      this.pending.set(normalized, (async () => {
        const resource = await this.resources.read(key);
        if (!resource) return { url: '', reason: key };
        if (this.closed) throw new Error('查词窗口已关闭。');
        if (this.urls.size >= 256 || this.bytes + resource.bytes.length > 96 * 1024 * 1024) {
          return { url: '', reason: key + '（超过窗口资源限额）' };
        }
        this.bytes += resource.bytes.length;
        const url = this.makeURL ? this.makeURL(resource) : this.win.URL.createObjectURL(new this.win.Blob([resource.bytes], { type: resource.mime }));
        this.urls.set(normalized, url); return { url };
      })());
    }
    const result = await this.pending.get(normalized);
    if (!result.url && required) this.missing.add(result.reason);
    return result.url;
  }
  async audioURL(reference) {
    if (this.closed) throw new Error('查词窗口已关闭。');
    const key = localReference(reference);
    if (!key) return '';
    const normalized = 'audio:' + resourceKey(key);
    if (!this.audioPending.has(normalized)) {
      this.audioPending.set(normalized, (async () => {
        const resource = await this.resources.read(key);
        if (!resource) { this.missing.add(key); return ''; }
        if (this.closed) throw new Error('查词窗口已关闭。');
        if (!/\.spx$/i.test(key) && !isOggSpeex(resource.bytes)) return this.url(key);
        const bytes = await decodeSpeex(resource.bytes, {
          cancelled: () => this.closed,
          yieldControl: this.win ? () => new Promise(resolve => this.win.setTimeout(resolve, 0)) : undefined,
          randomFill: this.win ? buffer => this.win.crypto.getRandomValues(buffer) : undefined,
        });
        if (this.closed) throw new Error('查词窗口已关闭。');
        if (this.urls.size >= 256 || this.bytes + bytes.length > 96 * 1024 * 1024) throw new Error('解码发音超过查词窗口资源限额。');
        this.bytes += bytes.length;
        const converted = { bytes, mime: 'audio/wav' };
        const url = this.makeURL ? this.makeURL(converted) : this.win.URL.createObjectURL(new this.win.Blob([bytes], { type: converted.mime }));
        this.urls.set(normalized, url); return url;
      })());
    }
    return this.audioPending.get(normalized);
  }
  close() {
    this.closed = true;
    if (!this.makeURL) for (const url of this.urls.values()) { try { this.win.URL.revokeObjectURL(url); } catch {} }
    this.urls.clear(); this.pending.clear(); this.audioPending.clear();
  }
}

class DictionaryStyles {
  constructor(scope) { this.scope = scope; this.total = 0; this.loaded = 0; }
  async external(reference, base = '', ancestors = new Set()) {
    const key = localReference(reference, base);
    if (!key || ancestors.has(resourceKey(key))) return '';
    if (ancestors.size >= 12 || this.loaded >= 64) { this.scope.missing.add(key + '（样式导入超过限额）'); return ''; }
    this.loaded++;
    const resource = await this.scope.resources.read(key);
    if (!resource) { this.scope.missing.add(key); return ''; }
    if (resource.bytes.length > 4 * 1024 * 1024 || this.total + resource.bytes.length > 12 * 1024 * 1024) {
      this.scope.missing.add(key + '（样式文件过大）'); return '';
    }
    this.total += resource.bytes.length;
    return this.rewrite(decodeStyle(resource.bytes), key, new Set([...ancestors, resourceKey(key)]));
  }
  async rewrite(css, base = '', ancestors = new Set(), context = 'stylesheet') {
    if (css.length > 4_000_000) { this.scope.missing.add(base || '内嵌样式过大'); return ''; }
    let ast;
    try { ast = parseCSS(css, { context, parseCustomProperty: true }); }
    catch { this.scope.missing.add(base || '内嵌样式无法解析'); return ''; }
    const imports = [], urls = [], fontSources = new Map();
    walkCSS(ast, {
      enter(node) {
        if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
          imports.push(node); return walkCSS.skip;
        }
        if (node.type === 'Atrule' && ['charset', 'namespace'].includes(node.name.toLowerCase())) {
          node.type = 'Raw'; node.value = ''; return walkCSS.skip;
        }
        if (node.type === 'Declaration' && node.property.toLowerCase() === 'src' && this.atrule?.name.toLowerCase() === 'font-face') {
          fontSources.set(node, { available: false, local: false, missing: [] });
        }
        const fontSource = fontSources.get(this.declaration);
        if (node.type === 'Function' && node.name.toLowerCase() === 'local' && fontSource) fontSource.local = true;
        if (node.type === 'Url') urls.push({ node, fontSource });
        // HTML namespace prefixes are normalized in the corresponding DOM.
        if (node.type === 'TypeSelector') node.name = node.name.replace(/^xhtml(?:\\:|\|)/i, '');
      },
    });
    for (const node of imports) {
      const pieces = node.prelude?.children?.toArray() || [];
      const first = pieces.shift();
      let imported = first && ['Url', 'String'].includes(first.type) ? await this.external(first.value, base, ancestors) : '';
      // @import conditions must still govern the inlined local stylesheet.
      for (const piece of pieces.reverse()) {
        if (piece.type === 'MediaQueryList') imported = `@media ${generateCSS(piece)}{${imported}}`;
        else if (piece.type === 'Function' && piece.name.toLowerCase() === 'supports') imported = `@supports (${generateCSS(piece.children.first)}){${imported}}`;
        else if (piece.type === 'Function' && piece.name.toLowerCase() === 'layer') imported = `@layer ${piece.children.toArray().map(child => generateCSS(child)).join('')}{${imported}}`;
        else if (piece.type === 'Identifier' && piece.name.toLowerCase() === 'layer') imported = `@layer{${imported}}`;
        else { imported = ''; break; }
      }
      node.type = 'Raw'; node.value = imported;
    }
    for (const { node, fontSource } of urls) {
      if (node.value.startsWith('#')) continue;
      const reference = node.value;
      const url = await this.scope.url(reference, base, { required: !fontSource });
      if (fontSource) {
        if (url) fontSource.available = true;
        else {
          const key = localReference(reference, base);
          if (key) fontSource.missing.push(key);
        }
      }
      node.value = url || 'data:,';
    }
    // src entries in @font-face are alternatives, not a set of required files.
    // Missing candidates matter only when the whole group has no usable source.
    for (const source of fontSources.values()) {
      const target = source.available || source.local ? this.scope.optionalMissing : this.scope.missing;
      for (const key of source.missing) target.add(key);
    }
    return generateCSS(ast);
  }
}

function entryReference(href) {
  const match = href.match(/^(?:entry:\/\/|[dx]:)(.+)$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

// Build a neutral plan with no DOM/network access. Keep source classes, IDs,
// custom tags and CSS selectors rather than assigning a dictionary template.
export async function prepareNativeDefinition(html, scope) {
  if (html.length > 4_000_000) throw new Error('词条过大，暂不能显示。');
  const source = parseFragment(html);
  const styles = new DictionaryStyles(scope);
  const css = [];
  let count = 0;
  async function children(parent, depth) {
    if (depth > 100) return [];
    const result = [];
    for (const node of parent.childNodes || []) {
      if (++count > 60000) throw new Error('词条结构过于复杂。');
      if (scope.closed) throw new Error('查词窗口已关闭。');
      if (node.nodeName === '#text') { result.push({ text: node.value }); continue; }
      const tag = node.tagName?.replace(/^xhtml:/i, '');
      if (!tag || !/^[a-z][a-z\d-]*$/.test(tag) || BLOCKED.has(tag)) continue;
      const attributes = Object.fromEntries((node.attrs || []).filter(a => !a.namespace && !a.prefix).map(a => [a.name, a.value]));
      if (tag === 'link') {
        if ((attributes.rel || '').toLowerCase().split(/\s+/).includes('stylesheet') && attributes.href) {
          const value = await styles.external(attributes.href);
          if (value) css.push(attributes.media ? `@media ${attributes.media}{${value}}` : value);
        }
        continue;
      }
      if (tag === 'style') {
        const value = await styles.rewrite((node.childNodes || []).map(part => part.value || '').join(''));
        if (value) css.push(attributes.media ? `@media ${attributes.media}{${value}}` : value);
        continue;
      }
      const attrs = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (/^on/i.test(key) || !/^[a-z_][a-z\d_.-]*$/i.test(key) || /^data-mdx-/i.test(key)) continue;
        if (['src', 'srcset', 'href', 'poster', 'background', 'action', 'formaction', 'ping', 'is', 'autofocus', 'autoplay', 'contenteditable', 'xmlns', 'slot'].includes(key)) continue;
        if (key === 'style') {
          const style = await styles.rewrite(value, '', new Set(), 'declarationList');
          if (style) attrs.style = style;
        } else attrs[key] = value.slice(0, 10000);
      }
      if (tag === 'ol' && node.tagName !== tag) attrs['data-mdx-prefixed-list'] = '';
      if (tag === 'img' && attributes.src) {
        const url = await scope.url(attributes.src);
        if (url) attrs.src = url;
        else { attrs.alt ||= '图片未找到'; attrs.title = '未找到：' + attributes.src; }
      }
      if (tag === 'audio') {
        // MDict also uses empty <audio name="..."> tags as metadata.
        // Only real src attributes become playable native audio controls.
        if (attributes.src) {
          let url;
          try { url = await scope.audioURL(attributes.src); }
          catch (e) { scope.missing.add(attributes.src + '（' + e.message + '）'); }
          if (url) { attrs.src = url; attrs.controls = ''; attrs.preload = 'none'; }
        }
      }
      if (tag === 'source' && attributes.src) {
        let url;
        const audioSource = node.parentNode?.tagName?.replace(/^xhtml:/, '') === 'audio';
        try { url = audioSource ? await scope.audioURL(attributes.src) : await scope.url(attributes.src); }
        catch (e) { scope.missing.add(attributes.src + '（' + e.message + '）'); }
        if (url) {
          attrs.src = url;
          // A Speex source becomes WAV. Let the Blob's MIME type describe the
          // resolved audio rather than retaining a stale source type hint.
          if (audioSource) delete attrs.type;
        }
      }
      if (tag === 'a' && attributes.href) {
        if (/^sound:\/\//i.test(attributes.href)) {
          const key = localReference(attributes.href);
          if (key) {
            attrs['data-mdx-audio'] = key; attrs.tabindex = '0'; attrs.role = 'button'; attrs['aria-label'] ||= '播放发音';
            const extension = key.split('.').pop().toUpperCase();
            const hint = extension === 'SPX' ? 'SPX/Speex 发音（插件离线解码）' : `${extension} 发音`;
            attrs.title = attrs.title ? attrs.title + ' · ' + hint : hint;
          }
        } else {
          const entry = entryReference(attributes.href);
          if (entry) { attrs['data-mdx-entry'] = entry; attrs.tabindex = '0'; attrs.role = 'link'; }
          else if (attributes.href.startsWith('#')) attrs['data-mdx-anchor'] = attributes.href.slice(1);
        }
      }
      const nested = VOID.has(tag) ? [] : await children(node, depth + 1);
      result.push({ tag, attrs, children: nested });
    }
    return result;
  }
  const nodes = await children(source, 0);
  return { nodes, css, styled: css.length > 0 };
}

export function appendNativeNodes(doc, target, plans) {
  for (const plan of plans) {
    if (plan.text != null) { target.append(doc.createTextNode(plan.text)); continue; }
    const node = element(doc, plan.tag);
    for (const [name, value] of Object.entries(plan.attrs)) node.setAttribute(name, value);
    // Creating the DOM directly preserves nested dictionary link tags without
    // HTML reparsing rearranging the outer pronunciation link.
    appendNativeNodes(doc, node, plan.children); target.append(node);
  }
}

export function mountNativeDefinition(doc, container, plan, scope, { onEntry, onStatus, onResize, onClose, onError }) {
  const iframe = element(doc, 'iframe');
  iframe.setAttribute('title', '词典原有排版');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.style.cssText = 'display:block;width:100%;height:420px;border:0;background:white;';
  let disposed = false, observer, audio, audioRequest = 0;
  const dispose = () => {
    disposed = true; audioRequest++; observer?.disconnect();
    try { audio?.pause(); audio?.removeAttribute('src'); } catch {}
    try { for (const media of iframe.contentDocument?.querySelectorAll('audio,video') || []) { media.pause(); media.removeAttribute('src'); } } catch {}
    iframe.remove();
  };
  iframe.addEventListener('load', () => {
    if (disposed || scope.closed) return;
    try {
      const frameDoc = iframe.contentDocument;
      if (!frameDoc?.body) throw new Error('无法创建词典显示区域。');
      const style = element(frameDoc, 'style');
      style.textContent = BASE_STYLE + '\n' + plan.css.join('\n') + '\n' + CONTROLS_STYLE; frameDoc.head.append(style);
      appendNativeNodes(frameDoc, frameDoc.body, plan.nodes);
      normalizeListNumbers(frameDoc);
      const resize = () => {
        if (disposed) return;
        // The outer popup supplies scrolling; do not clamp content height.
        const height = Math.max(70, Math.ceil(frameDoc.body.scrollHeight), Math.ceil(frameDoc.body.getBoundingClientRect().height));
        const next = Math.min(height, 100000) + 'px';
        if (iframe.style.height !== next) { iframe.style.height = next; onResize?.(); }
      };
      const win = frameDoc.defaultView;
      observer = new win.ResizeObserver(resize); observer.observe(frameDoc.body);
      frameDoc.fonts?.ready.then(resize); frameDoc.addEventListener('load', resize, true);
      const play = async key => {
        const ticket = ++audioRequest;
        audio?.pause(); onStatus?.('正在读取发音…');
        try {
          const url = await scope.audioURL(key);
          if (disposed || ticket !== audioRequest) return;
          if (!url) throw new Error('未找到音频：' + key);
          audio = element(frameDoc, 'audio'); audio.src = url;
          audio.addEventListener('error', () => {
            if (!disposed && ticket === audioRequest) onStatus?.('音频播放失败：可能是文件损坏或当前环境不支持此格式。');
          });
          await audio.play();
          if (!disposed && ticket === audioRequest) onStatus?.('正在播放发音');
        } catch (e) {
          if (!disposed && ticket === audioRequest) onStatus?.('发音播放失败：' + e.message);
        }
      };
      const activate = event => {
        const anchor = event.target.closest?.('[data-mdx-audio],[data-mdx-entry],[data-mdx-anchor]');
        if (!anchor) return;
        event.preventDefault(); event.stopPropagation();
        if (anchor.dataset.mdxAudio) void play(anchor.dataset.mdxAudio);
        else if (anchor.dataset.mdxEntry) onEntry?.(anchor.dataset.mdxEntry);
        else frameDoc.getElementById(anchor.dataset.mdxAnchor)?.scrollIntoView();
      };
      frameDoc.addEventListener('click', activate);
      frameDoc.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose?.(); }
        else if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
      resize();
    } catch (e) { dispose(); onStatus?.('原有排版显示失败：' + e.message); onError?.(e); }
  }, { once: true });
  // Only our empty document is parsed. Dictionary markup is inserted as fresh
  // filtered nodes after the sandbox and strict CSP are already active.
  iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + NATIVE_CSP + '"></head><body></body></html>';
  container.append(iframe);
  return dispose;
}
