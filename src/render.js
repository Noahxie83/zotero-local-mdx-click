/* SPDX-License-Identifier: GPL-3.0-or-later */
import { parseFragment } from 'parse5';

const HTML = 'http://www.w3.org/1999/xhtml';
const skip = new Set('script style link meta base iframe frame frameset object embed applet template svg math audio video source track img input button select textarea form noscript'.split(' '));
const safe = new Set('div p span br hr b i em strong u s small sub sup ul ol li dl dt dd blockquote table tbody thead tfoot tr th td ruby rt rp h1 h2 h3 h4 h5 h6'.split(' '));
const blocks = new Set('entry entry-g h-g top-g sn-g sn-gs sn-blk subentry-g x-gs x-g-blk unbox shcut-blk sense sense-g x-g xr-g idm-g pv-g runon-g phrvb-g gram-g etym-g note-g def-g examples idioms'.split(' '));
const classTokens = new Set('headword h hw def definition chn cn zh x example phon pos sn num label unbox oxford3000'.split(' '));

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
    for (const child of source.childNodes || []) {
      if (++count > 60000) throw new Error('词条结构过于复杂，暂不能显示。');
      if (child.nodeName === '#text') {
        target.appendChild(doc.createTextNode(child.value));
        continue;
      }
      const tag = child.tagName?.replace(/^xhtml:/, '');
      if (!tag || skip.has(tag)) continue;
      const node = element(doc, safe.has(tag) ? tag : blocks.has(tag) ? 'div' : 'span');
      const tokens = [tag, ...(child.attrs?.find(a => a.name === 'class')?.value || '').split(/\s+/)];
      for (const token of tokens) {
        if (classTokens.has(token)) node.classList.add('dict-' + token);
      }
      if (blocks.has(tag)) node.classList.add('dict-block');
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
  style.textContent = `
    :host { color-scheme:light dark; }
    * {box-sizing:border-box} .card {width:min(460px,calc(100vw - 24px));max-height:min(480px,calc(100vh - 24px));display:flex;flex-direction:column;border:1px solid #bac2ca;border-radius:10px;background:#fff;color:#222;box-shadow:0 5px 24px #0003;font:14px/1.65 system-ui,'Microsoft YaHei',sans-serif;user-select:text}
    header {display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid #e6e9ec} h2 {font-size:17px;line-height:1.4;margin:0;flex:1;overflow-wrap:anywhere} button {font:inherit;font-size:20px;background:transparent;border:0;border-radius:4px;color:inherit;cursor:pointer;padding:0 7px} button:hover{background:#8882}
    .body {padding:10px 16px;overflow:auto;min-height:45px;overflow-wrap:anywhere} .source {font-size:11px;opacity:.65;padding:5px 14px;border-top:1px solid #e6e9ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .dictionary-choice {padding:6px 14px;border-bottom:1px solid #e6e9ec}select{font:inherit;font-size:12px;max-width:100%;width:100%;padding:4px;border:1px solid #aaa7;border-radius:4px;background:transparent;color:inherit}.dict-block,p {margin:6px 0} .dict-chn,.dict-cn,.dict-zh {color:#23583f} .dict-x,.dict-example {font-style:italic;color:#555} .dict-pos,.dict-phon {color:#666} .dict-h,.dict-hw,.dict-headword {font-size:18px;font-weight:700} .dict-num,.dict-sn {font-weight:700;margin-right:.3em} h1,h2,h3,h4{font-size:16px} table{border-collapse:collapse;max-width:100%}td,th{padding:3px}ul,ol{padding-left:22px} section+section{border-top:1px solid #bbb;padding-top:8px;margin-top:10px}
    @media(prefers-color-scheme:dark){.card{background:#26292d;color:#eceff1;border-color:#626a72}header,.source{border-color:#454a50}.dict-chn,.dict-cn,.dict-zh{color:#a3d7b8}.dict-x,.dict-example,.dict-pos,.dict-phon{color:#bbb}}
  `;
  const card = element(doc, 'div'); card.className = 'card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', '本地词典：' + word);
  const header = element(doc, 'header');
  header.append(element(doc, 'h2', word));
  const button = element(doc, 'button', '×'); button.type = 'button';
  button.setAttribute('aria-label', '关闭释义'); button.addEventListener('click', close);
  header.append(button);
  const body = element(doc, 'div', '正在查询本地词典…'); body.className = 'body';
  body.setAttribute('aria-live', 'polite');
  const footer = element(doc, 'div', '本地 MDX'); footer.className = 'source';
  const choice = element(doc, 'div'); choice.className = 'dictionary-choice';
  const selector = element(doc, 'select'); selector.setAttribute('aria-label', '选择查询词典');
  choice.append(selector);
  card.append(header, choice, body, footer); root.append(style, card); doc.body.append(host);
  const position = () => {
    const rect = host.getBoundingClientRect();
    const left = Math.max(8, Math.min(x + 12, win.innerWidth - rect.width - 8));
    const top = y + 18 + rect.height <= win.innerHeight - 8 ? y + 18 : Math.max(8, y - rect.height - 12);
    host.style.left = left + 'px'; host.style.top = top + 'px';
  };
  position();
  return { host, body, footer, selector, position };
}
