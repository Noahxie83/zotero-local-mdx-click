/* SPDX-License-Identifier: GPL-3.0-or-later */
import { MDXDictionary } from './mdx.js';
import { wordAtPoint } from './word-at-point.js';
import { createCard, renderDefinition, element } from './render.js';
import { LocalResources, MAX_RESOURCE } from './resources.js';
import { ResourceScope, prepareNativeDefinition, mountNativeDefinition } from './native-render.js';

const basename = path => path.split(/[\\/]/).pop();
const dirname = path => {
  const at = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return path.slice(0, at === 0 || (at === 2 && /^[a-z]:/i.test(path)) ? at + 1 : at);
};

export function createApp(env, pluginID) {
  const { Zotero, IOUtils, ChromeUtils, Cu } = env;
  const pref = 'localMDXClick.';
  let stopped = false, timer, dictionaryPromise, dictionaryPath, generation = 0, folderEpoch = 0;
  let dictionaries = [], loadedDictionary, loadedResources, resourcesPromise;
  let status = '尚未选择词典。';
  const sessions = new Map(), toolbarButtons = new Set(), selectors = new Set(), preferenceWindows = new Set();
  const getPath = () => Zotero.Prefs.get(pref + 'path') || '';
  const getFolder = () => Zotero.Prefs.get(pref + 'folder') || '';
  const enabled = () => Zotero.Prefs.get(pref + 'enabled') !== false;
  const errorText = e => String(e?.message || e);
  const log = e => Zotero.logError(e);
  const getMode = () => Zotero.Prefs.get(pref + 'displayMode') === 'text' ? 'text' : 'original';
  const configurations = () => {
    try { return JSON.parse(Zotero.Prefs.get(pref + 'resources') || '{}'); } catch { return {}; }
  };
  const resourceOptions = () => configurations()[getPath()] || {};

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
      doc.getElementById('local-mdx-mode').value = getMode();
      const options = resourceOptions();
      doc.getElementById('local-mdx-resource-folder').textContent = options.folder || '使用 MDX 同目录的资源';
      doc.getElementById('local-mdx-extra-mdd').textContent = options.extraArchives?.length ? options.extraArchives.map(basename).join('、') : '未手动添加分卷（同名 MDD 会自动关联）';
      doc.getElementById('local-mdx-resource-status').textContent = loadedResources ? `已关联 ${loadedResources.archives.length} 个 MDD 文件，按需读取其中资源。` : '查询时自动查找配套 MDD 和文件夹资源。';
      } catch { preferenceWindows.delete(win); }
    }
  }

  async function loadResources() {
    if (resourcesPromise) return resourcesPromise;
    const token = generation;
    const guard = () => { if (stopped || token !== generation) throw new Error('词典选择已变更。'); };
    const fs = {
      dirname, basename,
      list: async path => { guard(); return IOUtils.getChildren(path); },
      stat: async path => { guard(); return IOUtils.stat(path); },
      source: async path => {
        guard(); const stat = await IOUtils.stat(path);
        if (stat.type !== 'regular') throw new Error('资源包不是可读取的文件。');
        return { size: stat.size, read: async (offset, length) => { guard(); return IOUtils.read(path, { offset, maxBytes: length }); } };
      },
      readFile: async path => {
        guard(); const stat = await IOUtils.stat(path);
        if (stat.type !== 'regular' || stat.size > MAX_RESOURCE) throw new Error('资源文件过大或无法读取。');
        return IOUtils.read(path, { maxBytes: MAX_RESOURCE });
      },
    };
    const pending = LocalResources.open({ mdxPath: getPath(), ...resourceOptions(), fs });
    resourcesPromise = pending;
    try {
      const resources = await pending;
      if (stopped || token !== generation) { resources.close(); throw new Error('词典选择已变更。'); }
      loadedResources = resources; updateUI(); return resources;
    } catch (e) { if (resourcesPromise === pending) resourcesPromise = undefined; throw e; }
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
    loadedResources?.close(); loadedResources = undefined; resourcesPromise = undefined;
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
      const next = found.find(d => d.path === getPath()) || found[0];
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
    const folder = dirname(path);
    try { await scanFolder(folder); if (getPath()) await loadDictionary(); }
    catch (e) { log(e); env.Services.prompt.alert(parent, '本地词典', errorText(e)); }
  }

  async function chooseResources(parent, type) {
    if (!getPath()) { await chooseFile(parent); if (!getPath()) return; }
    const targetPath = getPath();
    const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker = new FilePicker();
    picker.init(parent || Zotero.getMainWindow(), type === 'folder' ? '选择当前词典的外置资源文件夹' : '选择额外 MDD 文件或分卷（可多选）', type === 'folder' ? picker.modeGetFolder : picker.modeOpenMultiple);
    if (type !== 'folder') picker.appendFilter('MDD 资源文件', '*.mdd');
    if (await picker.show() !== picker.returnOK || stopped) return;
    const config = configurations(), options = config[targetPath] || {};
    if (type === 'folder') options.folder = picker.file;
    else options.extraArchives = [...new Set([...(options.extraArchives || []), ...picker.files])];
    config[targetPath] = options;
    Zotero.Prefs.set(pref + 'resources', JSON.stringify(config));
    if (getPath() === targetPath) selectDictionary(targetPath);
  }

  function resetResources() {
    const config = configurations(); delete config[getPath()];
    Zotero.Prefs.set(pref + 'resources', JSON.stringify(config)); selectDictionary(getPath());
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
    const close = () => {
      request++;
      try { card?.cleanup?.(); } catch {}
      try { card?.host.remove(); } catch {}
      card = undefined;
    };
    const inside = event => card && event.composedPath().includes(card.host);
    const show = async (word, x, y) => {
      close(); const ticket = request;
      card = createCard(doc, x, y, word, close);
      const current = card;
      const disposers = []; let scope;
      current.cleanup = () => { disposers.forEach(dispose => { try { dispose(); } catch {} }); scope?.close(); };
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
        if (!results.length) current.body.textContent = `未找到“${word}”。按词典词目查询，不自动还原词形。`;
        let resources, resourceError;
        if (getMode() === 'original' && results.length) {
          try { resources = await loadResources(); scope = new ResourceScope(resources, win); }
          catch (e) { resourceError = errorText(e); }
        }
        for (const result of results.slice(0, 12)) {
          if (stopped || ticket !== request || !current.host.isConnected) { scope?.close(); return; }
          const section = element(doc, 'section');
          if (scope) {
            try {
              const plan = await prepareNativeDefinition(result.html, scope);
              if (ticket !== request || !current.host.isConnected) { scope.close(); return; }
              current.body.style.padding = '0';
              current.body.append(section);
              disposers.push(mountNativeDefinition(doc, section, plan, scope, {
                onEntry: entry => { void show(entry, x, y).catch(log); },
                onStatus: message => { if (ticket === request) current.footer.textContent = message; },
                onResize: () => { if (ticket === request) current.position(); }, onClose: close,
                onError: e => {
                  if (ticket !== request || !current.host.isConnected) return;
                  section.style.padding = '14px 19px';
                  section.replaceChildren(renderDefinition(doc, result.html));
                  current.footer.textContent = '原有排版显示失败，已改用文字排版'; current.footer.title = errorText(e);
                },
              }));
              continue;
            } catch (e) { resourceError = errorText(e); log(e); }
          }
          const definition = renderDefinition(doc, result.html);
          if (result.headword.toLowerCase() !== word.toLowerCase() &&
              !definition.querySelector('.dict-h,.dict-hw,.dict-headword,.dict-hwrap h2')) {
            const heading = element(doc, 'strong', result.headword);
            heading.className = 'dict-headword'; section.append(heading);
          }
          section.append(definition);
          current.body.append(section);
        }
        if (ticket !== request || !current.host.isConnected) return;
        const issues = scope?.missing.size || resources?.errors.size || 0;
        current.footer.textContent = basename(getPath()) + (resourceError ? ' · 资源读取失败，显示文字排版' : issues ? ' · 部分资源未能读取' : getMode() === 'original' ? ' · 词典原有排版' : ' · 简洁文字排版');
        current.footer.title = resourceError || [...(scope?.missing || []), ...(resources?.errors || [])].slice(0, 30).join('\n');
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
        await scanFolder(dirname(path)).catch(log);
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
      loadedResources?.close(); loadedResources = undefined; resourcesPromise = undefined;
      toolbarButtons.clear(); selectors.clear(); preferenceWindows.clear(); dictionaryPromise = undefined;
    },
    mountPreferences(win) {
      preferenceWindows.add(win); updateUI();
      win.document.getElementById('local-mdx-choose').onclick = () => chooseDictionary(win).catch(log);
      win.document.getElementById('local-mdx-choose-file').onclick = () => chooseFile(win).catch(log);
      win.document.getElementById('local-mdx-refresh').onclick = () => scanFolder().catch(log);
      win.document.getElementById('local-mdx-select').onchange = event => selectDictionary(event.target.value);
      win.document.getElementById('local-mdx-enabled').onchange = event => setEnabled(event.target.checked);
      win.document.getElementById('local-mdx-mode').onchange = event => {
        Zotero.Prefs.set(pref + 'displayMode', event.target.value); dismissAll(); updateUI();
      };
      win.document.getElementById('local-mdx-choose-resource-folder').onclick = () => chooseResources(win, 'folder').catch(log);
      win.document.getElementById('local-mdx-choose-mdd').onclick = () => chooseResources(win, 'mdd').catch(log);
      win.document.getElementById('local-mdx-reset-resources').onclick = resetResources;
      if (getPath()) loadDictionary().catch(log);
    },
    loadDictionary, loadResources, chooseDictionary, chooseFile, scanReaders, scanFolder, selectDictionary,
    getDictionaries: () => dictionaries.slice(), getPath,
  };
}
