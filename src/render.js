/* SPDX-License-Identifier: GPL-3.0-or-later */
import { parseFragment } from 'parse5';
import { popupCSS } from './appearance.js';

const HTML = 'http://www.w3.org/1999/xhtml';
const skip = new Set('script style link meta base iframe frame frameset object embed applet template svg math audio video source track img input button select textarea form noscript audio-wr audio-gbs-liju audio-uss-liju audio-brs-liju audio-br-liju audio-gb-liju audio-ams-liju audio-us-liju audio-n_am-liju'.split(' '));
const safe = new Set('div p span br hr b i em strong u s small sub sup ul ol li dl dt dd blockquote table tbody thead tfoot tr th td ruby rt rp h1 h2 h3 h4 h5 h6'.split(' '));
const blocks = new Set('entry entry-g h-g top-g sn-gs sn-blk sn-blk-nolist subentry-g x-gs x-g-blk unbox shcut-blk sense sense-g x-g xr-g idm-g pv-g runon-g phrvb-g etym-g note-g def-g examples idioms xr-gs vp-gs vp-g form-row'.split(' '));
const classTokens = new Set([
  ...blocks,
  ...'headword h hw def definition chn cn zh x example phon pos sn num label oxford3000 hkey symbol pron-gs pron-g-blk pron-g phon-blk brelabel namelabel audio-gb audio-us pos-g pos-blk shcut sdsymb sn-g licontent gram-g gram-blk gram xsymb x-wr cf-blk cf cl-blk cl gl-blk gl label-g label-g-blk xr-g-blk xrlabel xh-blk xh idm pv vp vpform boxtag pron ipa hwrap word-frequency dcb dcn'.split(' '),
]);

// Oxford alternates a form label and a spelling/pronunciation group. Make
// their relationship explicit so wrapping cannot mix two different forms.
function renderChildren(source) {
  const children = source.childNodes || [];
  if (source.tagName !== 'vp-gs') return children;
  const grouped = [];
  let label;
  for (const child of children) {
    if (child.nodeName === '#text' && !child.value.trim()) continue;
    if (child.tagName === 'vpform') {
      if (label) grouped.push(label);
      label = child;
    } else if (child.tagName === 'vp-g') {
      grouped.push({ tagName: 'form-row', childNodes: label ? [label, child] : [child] });
      label = undefined;
    } else {
      if (label) { grouped.push(label); label = undefined; }
      grouped.push(child);
    }
  }
  if (label) grouped.push(label);
  return grouped;
}

function retainListNumber(source, target, attribute) {
  const value = source.attrs?.find(attr => attr.name === attribute)?.value;
  if (value && /^-?\d{1,6}$/.test(value) && Math.abs(Number(value)) <= 100000) {
    target.setAttribute(attribute, String(Number(value)));
  }
}

export function element(doc, tag, text) {
  const node = doc.createElementNS(HTML, tag);
  if (text != null) node.textContent = text;
  return node;
}

// parse5 has no DOM or network access. Only freshly created neutral HTML nodes
// reach Zotero's privileged document; no dictionary attributes or scripts do.
export function renderDefinition(doc, html) {
  if (html.length > 4_000_000) throw new Error('词条过大，暂不能显示。');
  const parsed = parseFragment(html);
  const fragment = doc.createDocumentFragment();
  const stack = [{ source: parsed, target: fragment, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { source, target, depth } = stack.pop();
    if (depth > 100) continue;
    const pending = [];
    for (const child of renderChildren(source)) {
      if (++count > 60000) throw new Error('词条结构过于复杂，暂不能显示。');
      if (child.nodeName === '#text') {
        target.appendChild(doc.createTextNode(child.value));
        continue;
      }
      const tag = child.tagName?.replace(/^xhtml:/, '');
      if (!tag || skip.has(tag)) continue;
      const classes = (child.attrs?.find(a => a.name === 'class')?.value || '').split(/\s+/);
      // This script-dependent navigation repeats the real NOUN/VERB headings.
      if (classes.includes('cixing_tiaozhuan')) continue;
      const node = element(doc, safe.has(tag) ? tag : blocks.has(tag) ? 'div' : 'span');
      const tokens = [tag, ...classes];
      for (const token of tokens) {
        if (classTokens.has(token)) node.classList.add('dict-' + token);
      }
      if (blocks.has(tag)) node.classList.add('dict-block');
      // Keep real sense numbering without copying arbitrary HTML attributes.
      if (tag === 'ol') retainListNumber(child, node, 'start');
      if (tag === 'li') retainListNumber(child, node, 'value');
      if (tag === 'pron-g-blk') {
        const region = child.childNodes?.some(part => part.tagName === 'namelabel') ? '美式音标' :
          child.childNodes?.some(part => part.tagName === 'brelabel') ? '英式音标' : undefined;
        if (region) node.setAttribute('title', region);
      }
      target.appendChild(node);
      pending.push({ source: child, target: node, depth: depth + 1 });
    }
    stack.push(...pending.reverse());
  }
  return fragment;
}

export function createCard(doc, x, y, word, close) {
  const win = doc.defaultView;
  const host = element(doc, 'div');
  host.setAttribute('data-local-mdx-popup', 'true');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:block;box-sizing:border-box;';
  const root = host.attachShadow({ mode: 'open' });
  const style = element(doc, 'style');
  style.textContent = popupCSS;
  const card = element(doc, 'div'); card.className = 'card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', '本地词典：' + word);
  const header = element(doc, 'header');
  header.append(element(doc, 'h2', '查词 · ' + word));
  const button = element(doc, 'button', '×'); button.type = 'button';
  button.setAttribute('aria-label', '关闭释义'); button.addEventListener('click', close);
  header.append(button);
  const body = element(doc, 'div', '正在查询本地词典…'); body.className = 'body';
  body.setAttribute('aria-live', 'polite');
  const footer = element(doc, 'div', '本地 MDX'); footer.className = 'source';
  const choice = element(doc, 'div'); choice.className = 'dictionary-choice';
  const selector = element(doc, 'select'); selector.setAttribute('aria-label', '选择查询词典');
  const choiceLabel = element(doc, 'span', '词典'); choiceLabel.className = 'dictionary-label';
  choice.append(choiceLabel, selector);
  const queries = element(doc, 'div'); queries.className = 'query-alternatives'; queries.hidden = true;
  card.append(header, choice, queries, body, footer); root.append(style, card); doc.body.append(host);
  const position = () => {
    const rect = host.getBoundingClientRect();
    const left = Math.max(8, Math.min(x + 12, win.innerWidth - rect.width - 8));
    const top = y + 18 + rect.height <= win.innerHeight - 8 ? y + 18 : Math.max(8, y - rect.height - 12);
    host.style.left = left + 'px'; host.style.top = top + 'px';
  };
  position();
  return { host, body, footer, selector, queries, position };
}
