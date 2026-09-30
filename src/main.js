/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MDXDictionary } from './mdx.js';
import { wordAtPoint } from './word-at-point.js';
import { createCard, renderDefinition, element } from './render.js';

export function createApp(env, pluginID) {
  const { Zotero, IOUtils, ChromeUtils, Cu } = env;
  const pref = 'localMDXClick.';
  let stopped = false, timer, dictionaryPromise, dictionaryPath, generation = 0, folderEpoch = 0;
  let dictionaries = [], loadedDictionary;
  let status = '尚未选择词典。';
  const sessions = new Map(), toolbarButtons = new Set(), selectors = new Set(), preferenceWindows = new Set();
  const getPath = () => Zotero.Prefs.get(pref + 'path') || '';
  const getFolder = () => Zotero.Prefs.get(pref + 'folder') || '';
  const enabled = () => Zotero.Prefs.get(pref + 'enabled') !== false;
  const errorText = e => String(e?.message || e);
  const log = e => Zotero.logError(e);

  function fillSelect(select) {
    const signature = dictionaries.map(d => d.path).join('\n');
    if (select.dataset.list !== signature) {
      select.replaceChildren();
      for (const d of dictionaries) {
        const option = element(select.ownerDocument, 'option', d.name);
        option.value = d.path; select.append(option);
      }
      if (!dictionaries.length) select.append(element(select.ownerDocument, 'option', '请先选择词典文件夹'));
      select.dataset.list = signature;
    }
    if (select.value !== getPath()) select.value = getPath();
    select.disabled = !dictionaries.length;
  }

  function updateUI() {
    for (const button of toolbarButtons) {
      try {
        if (!button.isConnected) { toolbarButtons.delete(button); continue; }
        button.textContent = enabled() ? '本地词典 ✓' : '本地词典';
        button.setAttribute('aria-pressed', String(enabled()));
        button.title = getPath() ? '单击切换点击查词；右键更换词典文件夹' : '选择本地词典文件夹';
      } catch { toolbarButtons.delete(button); }
    }
    for (const select of selectors) {
      try { if (!select.isConnected) selectors.delete(select); else fillSelect(select); }
      catch { selectors.delete(select); }
    }
    for (const win of preferenceWindows) {
      try {
      if (win.closed) { preferenceWindows.delete(win); continue; }
      const doc = win.document;
      const path = doc.getElementById('local-mdx-path');
      if (!path) { preferenceWindows.delete(win); continue; }
      path.textContent = getPath() || '未选择词典';
      doc.getElementById('local-mdx-folder').textContent = getFolder() || '未选择文件夹';
      fillSelect(doc.getElementById('local-mdx-select'));
      doc.getElementById('local-mdx-status').textContent = status;
      doc.getElementById('local-mdx-enabled').checked = enabled();
      } catch { preferenceWindows.delete(win); }
    }
  }

  async function loadDictionary() {
    const path = getPath();
    if (!path) throw new Error('请先在“设置 → 本地 MDX 点击查词”选择词典文件夹。');
    if (dictionaryPromise && dictionaryPath === path) return dictionaryPromise;
    dictionaryPath = path;
    const token = generation;
    status = '正在建立词目索引…'; updateUI();
    const pending = (async () => {
      const stat = await IOUtils.stat(path);
      if (stat.type !== 'regular') throw new Error('请选择一个 .mdx 文件。');
      const result = await MDXDictionary.open({
        size: stat.size,
        read: async (offset, length) => {
          if (stopped || token !== generation) throw new Error('词典选择已变更。');
          return IOUtils.read(path, { offset, maxBytes: length });
        },
      });
      if (!stopped && token === generation && dictionaryPath === path) {
        loadedDictionary = result;
        status = `词典已就绪（${result.count ?? result.stats?.entries ?? ''} 个词目）。`;
        updateUI();
      }
      return result;
    })();
    dictionaryPromise = pending;
    pending.catch(e => {
      if (!stopped && dictionaryPromise === pending) {
        dictionaryPromise = undefined;
        status = '读取失败：' + errorText(e); updateUI();
      }
    });
    return pending;
  }

  function dismissAll() { for (const s of sessions.values()) { try { s.close(); } catch {} } }
  function setEnabled(value) {
    Zotero.Prefs.set(pref + 'enabled', !!value);
    if (!value) dismissAll();
    updateUI();
  }

  function selectDictionary(path, keepSession) {
    if (path && !dictionaries.some(d => d.path === path)) throw new Error('该词典不在当前文件夹列表中，请刷新词典列表。');
    generation++;
    loadedDictionary?.clearCache(); loadedDictionary = undefined;
    dictionaryPromise = undefined; dictionaryPath = undefined;
    Zotero.Prefs.set(pref + 'path', path || '');
    for (const s of sessions.values()) if (s !== keepSession) { try { s.close(); } catch {} }
    status = path ? '已选择词典，正在建立索引…' : '此文件夹未找到 MDX 词典。';
    updateUI();
    if (path && enabled()) loadDictionary().catch(log);
  }

  async function scanFolder(folder = getFolder()) {
    const epoch = ++folderEpoch;
    status = '正在读取词典文件夹…'; updateUI();
    try {
      if (!folder) { dictionaries = []; status = '尚未选择词典文件夹。'; updateUI(); return []; }
      const stat = await IOUtils.stat(folder);
      if (stat.type !== 'directory') throw new Error('词典文件夹不存在。');
      const children = await IOUtils.getChildren(folder);
      const found = [];
      for (const path of children) {
        if (!/\.mdx$/i.test(path)) continue;
        if ((await IOUtils.stat(path)).type === 'regular') {
          found.push({ path, name: path.split(/[\\/]/).pop().replace(/\.mdx$/i, '') });
        }
      }
      if (stopped || epoch !== folderEpoch) return dictionaries.slice();
      found.sort((a, b) => a.name.localeCompare(b.name)); dictionaries = found;
      Zotero.Prefs.set(pref + 'folder', folder);
      const next = found.find(d => d.path === getPath()) || found.find(d => /牛津|oxford/i.test(d.name)) || found[0];
      // Refresh invalidates an index too: the same file may have been replaced.
      selectDictionary(next?.path || '');
      return dictionaries.slice();
    } catch (e) {
      if (!stopped && epoch === folderEpoch) {
        dictionaries = []; selectDictionary('');
        status = '无法读取文件夹：' + errorText(e); updateUI();
      }
      throw e;
    }
  }

  async function chooseDictionary(parent) {
    const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker = new FilePicker();
    picker.init(parent || Zotero.getMainWindow(), '选择词典文件夹', picker.modeGetFolder);
    if (await picker.show() !== picker.returnOK || stopped) return;
    setEnabled(true);
    try { await scanFolder(picker.file); if (getPath()) await loadDictionary(); }
    catch (e) { log(e); env.Services.prompt.alert(parent, '本地词典', errorText(e)); }
  }

  async function chooseFile(parent) {
    const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker = new FilePicker();
    picker.init(parent || Zotero.getMainWindow(), '选择 MDX 词典文件', picker.modeOpen);
    picker.appendFilter('MDX 词典', '*.mdx');
    if (await picker.show() !== picker.returnOK || stopped) return;
    const path = picker.file;
    Zotero.Prefs.set(pref + 'path', path);
    const folder = path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
    try { await scanFolder(folder); if (getPath()) await loadDictionary(); }
    catch (e) { log(e); env.Services.prompt.alert(parent, '本地词典', errorText(e)); }
  }

  function attach(view, win) {
    if (!win?.document?.body || sessions.has(win) || stopped) return;
    const doc = win.document;
    let down, card, request = 0, moved = false;
    const listeners = [];
    const on = (target, name, fn, capture = false) => {
      target.addEventListener(name, fn, capture);
      listeners.push(() => target.removeEventListener(name, fn, capture));
    };
    const close = () => { request++; try { card?.host.remove(); } catch {} card = undefined; };
    const inside = event => card && event.composedPath().includes(card.host);
    const show = async (word, x, y) => {
      close(); const ticket = request;
      card = createCard(doc, x, y, word, close);
      const current = card;
      fillSelect(current.selector);
      const selectedPath = getPath();
      current.selector.addEventListener('change', () => {
        selectDictionary(current.selector.value, sessions.get(win));
        void show(word, x, y).catch(log);
      });
      try {
        const dictionary = await loadDictionary();
        const results = await dictionary.lookup(word);
        if (stopped || ticket !== request || getPath() !== selectedPath || !current.host.isConnected) return;
        current.body.replaceChildren();
        if (!results.length) current.body.textContent = `未找到“${word}”。首版按词典词目查询，不自动还原词形。`;
        for (const result of results.slice(0, 12)) {
          const section = element(doc, 'section');
          if (result.headword.toLowerCase() !== word.toLowerCase()) section.append(element(doc, 'strong', result.headword));
          section.append(renderDefinition(doc, result.html));
          current.body.append(section);
        }
        current.footer.textContent = getPath().split(/[\\/]/).pop();
      } catch (e) {
        if (ticket === request && getPath() === selectedPath && current.host.isConnected) current.body.textContent = errorText(e);
        log(e);
      }
      if (ticket === request) current.position();
    };
    on(win, 'pointerdown', event => {
      down = undefined; moved = false;
      if (inside(event)) return;
      close();
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !enabled() || !getPath()) return;
      if (view._tool?.type && view._tool.type !== 'pointer') return;
      if (event.target.closest?.('input,textarea,button,a,select,[contenteditable="true"],.annotationLayer,.textAnnotation')) return;
      if (!event.target.closest?.('.page')) return;
      down = { x: event.clientX, y: event.clientY, id: event.pointerId, time: Date.now() };
    }, true);
    on(win, 'pointermove', event => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) moved = true;
    }, true);
    on(win, 'pointerup', async event => {
      const origin = down; down = undefined;
      if (!origin || moved || event.button !== 0 || event.pointerId !== origin.id || Date.now() - origin.time > 650) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !enabled()) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) return;
      // Zotero's native text selection may stop bubbling pointerup. Capture it,
      // then let the reader finish updating its selection before querying.
      await Promise.resolve();
      if (win.getSelection()?.isCollapsed === false || view._isSelectionCollapsed?.() === false) return;
      const word = wordAtPoint(win, event.clientX, event.clientY, view);
      if (word) void show(word, event.clientX, event.clientY).catch(log);
    }, true);
    on(win, 'pointercancel', () => { down = undefined; });
    on(win, 'keydown', event => { if (event.key === 'Escape' && card) { close(); event.stopPropagation(); } }, true);
    on(win, 'scroll', event => { if (!inside(event)) close(); }, true);
    on(win, 'resize', close);
    const cleanup = () => { close(); listeners.forEach(f => { try { f(); } catch {} }); sessions.delete(win); };
    on(win, 'unload', cleanup);
    sessions.set(win, { close, cleanup, show, view });
  }

  function scanReaders() {
    if (stopped) return;
    for (const [win, session] of sessions) {
      try { if (win.closed) session.cleanup(); } catch { session.cleanup(); }
    }
    for (const reader of Zotero.Reader._readers || []) {
      try {
        if (reader.type !== 'pdf') continue;
        const internal = reader._internalReader;
        for (const view of [internal?._primaryView, internal?._secondaryView]) {
          const wrapped = view?._iframeWindow;
          const win = wrapped && Cu.unwaiveXrays(wrapped);
          if ((win?.wrappedJSObject || win)?.PDFViewerApplication) attach(view, win);
        }
      } catch { /* A reader may be destroyed during the scan. */ }
    }
    updateUI();
  }
  function toolbar(event) {
    if (event.reader.type !== 'pdf' || stopped) return;
    const button = element(event.doc, 'button');
    button.type = 'button'; button.className = 'toolbar-button';
    button.style.cssText = 'width:auto;padding:0 8px;font-size:12px;white-space:nowrap;';
    button.addEventListener('click', () => {
      if (!getPath()) void chooseDictionary(Zotero.getMainWindow()).catch(log);
      else setEnabled(!enabled());
    });
    button.addEventListener('contextmenu', e => { e.preventDefault(); void chooseDictionary(Zotero.getMainWindow()).catch(log); });
    const select = element(event.doc, 'select');
    select.setAttribute('aria-label', '选择本地词典');
    select.style.cssText = 'max-width:200px;min-width:100px;font-size:12px;';
    select.addEventListener('change', () => selectDictionary(select.value));
    selectors.add(select);
    toolbarButtons.add(button); event.append(button, select); updateUI();
    scanReaders();
  }

  return {
    async start() {
      await Zotero.PreferencePanes.register({ pluginID, id: 'local-mdx-click-preferences', label: '本地 MDX 点击查词', src: 'content/preferences.xhtml' });
      Zotero.Reader.registerEventListener('renderToolbar', toolbar, pluginID);
      timer = env.setInterval(scanReaders, 1000);
      scanReaders();
      if (getFolder()) await scanFolder().catch(log);
      else if (getPath()) {
        // Preserve a configuration from an earlier single-file build.
        const path = getPath();
        await scanFolder(path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))).catch(log);
      }
    },
    stop() {
      stopped = true;
      generation++; folderEpoch++;
      env.clearInterval(timer);
      Zotero.Reader.unregisterEventListener('renderToolbar', toolbar);
      for (const session of [...sessions.values()]) session.cleanup();
      for (const button of toolbarButtons) { try { button.remove(); } catch {} }
      for (const select of selectors) { try { select.remove(); } catch {} }
      loadedDictionary?.clearCache(); loadedDictionary = undefined;
      toolbarButtons.clear(); selectors.clear(); preferenceWindows.clear(); dictionaryPromise = undefined;
    },
    mountPreferences(win) {
      preferenceWindows.add(win); updateUI();
      win.document.getElementById('local-mdx-choose').onclick = () => chooseDictionary(win).catch(log);
      win.document.getElementById('local-mdx-choose-file').onclick = () => chooseFile(win).catch(log);
      win.document.getElementById('local-mdx-refresh').onclick = () => scanFolder().catch(log);
      win.document.getElementById('local-mdx-select').onchange = event => selectDictionary(event.target.value);
      win.document.getElementById('local-mdx-enabled').onchange = event => setEnabled(event.target.checked);
      if (getPath()) loadDictionary().catch(log);
    },
    loadDictionary, chooseDictionary, chooseFile, scanReaders, scanFolder, selectDictionary,
    getDictionaries: () => dictionaries.slice(), getPath,
  };
}
