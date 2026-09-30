/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MDXDictionary } from '../src/mdx.js';
import { LocalResources } from '../src/resources.js';
import { ResourceScope, prepareNativeDefinition, mountNativeDefinition } from '../src/native-render.js';
import { createCard } from '../src/render.js';
import { queryFromText } from '../src/selection-query.js';
import { renderSelectionTools } from '../src/selection-menu.js';

// Browser demonstration only: original miniature dictionaries in memory.
// No Zotero profile, filesystem access or annotation persistence is used.
const data = window.localMDXDemoData, files = new Map();
for (const [name, encoded] of Object.entries(data.files)) files.set(name, Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
const fs = {
  dirname: path => path.slice(0, path.lastIndexOf('/')), basename: path => path.split('/').pop(),
  list: async directory => [...files.keys()].filter(name => name.startsWith(directory + '/') && !name.slice(directory.length + 1).includes('/')),
  stat: async name => {
    if (name === 'demo') return { type: 'directory', size: 0 };
    if (!files.has(name)) throw new Error('示例中没有此资源');
    return { type: 'regular', size: files.get(name).length };
  },
  source: async name => {
    const bytes = files.get(name); if (!bytes) throw new Error('示例中没有此文件');
    return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
  },
  readFile: async name => files.get(name),
};
let selectedDictionary = data.dictionaries[0].path, active, sequence = 0;
const loaded = new Map(), target = document.getElementById('result');
const cases = [
  { text: 'network', selection: false, label: '单击 network，查询当前本地词典。' },
  { text: 'transfor-\nmation', selection: true, label: '选中断行两部分；保留连字符与拼接写法分别查询。' },
  { text: 'neural network', selection: true, label: '查询完整词组；批注按钮在本网页中只演示类型和颜色。' },
];
function dispose() {
  sequence++;
  active?.disposers.forEach(fn => fn()); active?.scope?.close(); active?.card.host.remove(); active = null;
}
async function dictionary(path) {
  if (!loaded.has(path)) loaded.set(path, Promise.all([fs.source(path).then(source => MDXDictionary.open(source)), LocalResources.open({ mdxPath: path, fs })]));
  return loaded.get(path);
}
async function show(text, selection = false) {
  const query = queryFromText(text); if (!query) { document.getElementById('hint').textContent = '请划选一个完整词或词组（最多 256 字符、16 个词）。'; return; }
  dispose(); const ticket = sequence;
  target.replaceChildren();
  const card = createCard(document, 0, 0, query.text, () => { dispose(); target.textContent = '点击左侧示例，再次打开词条。'; });
  card.host.style.cssText = 'all:initial;display:block;position:relative;width:100%;'; target.append(card.host);
  const frameStyle = document.createElement('style');
  frameStyle.textContent = ':host{color-scheme:light}.card{width:100%;max-height:650px;box-shadow:none;border-radius:10px}.body{min-height:160px;max-height:460px}';
  card.host.shadowRoot.append(frameStyle);
  active = { card, disposers: [], scope: null };
  for (const entry of data.dictionaries) { const option = document.createElement('option'); option.value = entry.path; option.textContent = entry.name; card.selector.append(option); }
  card.selector.value = selectedDictionary;
  card.selector.addEventListener('change', () => { selectedDictionary = card.selector.value; void show(text, selection); });
  if (selection) renderSelectionTools(document, card.selectionTools, {
    color: '#ffd400', setColor() {},
    add: async (type, color) => { document.getElementById('hint').textContent = `示例动作：${type === 'highlight' ? '高亮' : '下划线'}，颜色 ${color}。安装到 Zotero 后才会保存到文献。`; },
    onStatus: () => { card.footer.textContent = '批注按钮为网页演示，没有写入 Zotero'; },
  });
  try {
    const [mdx, resources] = await dictionary(selectedDictionary); if (ticket !== sequence) return;
    const results = new Map(), attempts = [];
    for (const candidate of query.candidates) {
      const found = await mdx.lookup(candidate); if (ticket !== sequence) return;
      attempts.push(candidate + (found.length ? ' ✓' : '（示例词典未收录）'));
      for (const entry of found) results.set(entry.headword + '\0' + entry.html, entry);
    }
    card.queries.hidden = query.candidates.length < 2; card.queries.textContent = '查询候选：' + attempts.join(' · ');
    card.body.replaceChildren();
    if (!results.size) { card.body.textContent = '示例词典仅收录 network、transformation、neural network 和 pre-softmax。'; card.footer.textContent = '请选择这些示例词体验'; return; }
    const scope = new ResourceScope(resources, window); active.scope = scope;
    for (const entry of results.values()) {
      const plan = await prepareNativeDefinition(entry.html, scope); if (ticket !== sequence) return;
      const section = document.createElement('section'); card.body.append(section);
      active.disposers.push(mountNativeDefinition(document, section, plan, scope, {
        onEntry: word => void show(word, selection), onStatus: message => { card.footer.textContent = message + ' · 此音频是自制提示音'; },
        onClose: () => dispose(), onError: error => { card.footer.textContent = error.message; },
      }));
    }
    card.footer.textContent = '原创示例词条 · CSS / 图片来自示例 MDD 分卷 · 音频为提示音';
  } catch (error) { if (ticket === sequence) { card.body.textContent = '示例读取失败：' + error.message; card.footer.textContent = '可重新点击示例或刷新页面'; } }
}
function activate(index) {
  document.querySelectorAll('[data-case]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.case) === index)));
  document.getElementById('hint').textContent = cases[index].label; void show(cases[index].text, cases[index].selection);
}
document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => activate(Number(button.dataset.case))));
document.querySelectorAll('[data-word]').forEach(button => button.addEventListener('click', () => { document.getElementById('hint').textContent = '单击正文词语，查看本地词条。'; void show(button.dataset.word); }));
document.getElementById('paper').addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection?.rangeCount && !selection.isCollapsed && document.getElementById('paper').contains(selection.anchorNode) && document.getElementById('paper').contains(selection.focusNode)) {
    document.getElementById('hint').textContent = '已读取网页选区。实际插件优先使用 Zotero 的 PDF 字形和选区。'; void show(selection.toString(), true);
  }
});
window.addEventListener('pagehide', dispose);
activate(0);
