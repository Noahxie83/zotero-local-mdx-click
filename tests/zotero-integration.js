// Run only by the isolated verification copy, never by the shipped addon.
async function runZoteroVerification(config) {
  const report = { version: config.version, steps: [], ok: false };
  const win = Zotero.getMainWindow(), timers = new Set();
  const schedule = (callback, ms) => {
    const timer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer); timers.add(timer);
    timer.initWithCallback(() => { timers.delete(timer); callback(); }, ms, Ci.nsITimer.TYPE_ONE_SHOT);
    return timer;
  };
  const pause = ms => new Promise(resolve => schedule(resolve, ms));
  const save = () => IOUtils.writeUTF8(config.reportPath, JSON.stringify(report, null, 2));
  const step = async (name, details) => { report.steps.push({ name, details }); await save(); };
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const deadline = schedule(async () => { report.error = 'Verification timeout'; await save(); Services.startup.quit(Ci.nsIAppStartup.eForceQuit); }, 120000);
  try {
    require(Zotero.DataDirectory.dir === config.dataPath, 'Refusing to modify a non-test data directory');
    await step('isolated-profile', { version: Zotero.version, dataPath: Zotero.DataDirectory.dir });
    const app = Zotero.LocalMDXClick;
    require(!app.getPath(), 'Fresh profile should have no preset dictionary');
    const item = await Zotero.Attachments.importFromFile({ file: config.pdfPath });
    await step('imported-test-pdf', { id: item.id });
    let reader = await Zotero.Reader.open(item.id); await reader._initPromise;
    await step('opened-test-reader', { id: item.id });
    // Record host persistence errors instead of opening a modal test dialog.
    reader.displayError = error => { report.hostError = String(error); void save(); };
    let view, pdfWin;
    for (let i = 0; i < 300; i++) {
      view = reader._internalReader?._primaryView;
      pdfWin = view?._iframeWindow?.wrappedJSObject || view?._iframeWindow;
      if (view?._pdfPages?.[0]?.chars?.length && pdfWin?.document.querySelector('.textLayer span')) break;
      await pause(100);
    }
    require(view?._pdfPages?.[0]?.chars?.length, 'No PDF character geometry');
    await step('pdf-geometry', { characters: view._pdfPages[0].chars.length });
    app.scanReaders(); await pause(300);
    const chars = view._pdfPages[0].chars, selected = chars.slice(0, 8);
    const rects = selected.map(char => char.rect);
    require(rects.every(rect => rect?.length === 4), 'Unexpected PDF geometry');
    const rect = [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
    const ranges = [{ pageIndex: 0, anchorOffset: 0, headOffset: 8, collapsed: false, sortIndex: '00000|000000|00000', text: 'research', position: { pageIndex: 0, rects: [rect] } }];
    const choose = () => view._setSelectionRanges(Cu.cloneInto(ranges, reader._iframeWindow));
    const popup = () => pdfWin.document.querySelector('[data-local-mdx-popup]')?.shadowRoot;
    async function menu() {
      popup()?.querySelector('header button')?.click(); choose();
      for (let i = 0; i < 100 && !popup()?.querySelector('.annotation-actions button'); i++) await pause(50);
      const root = popup(); require(root?.querySelectorAll('.annotation-actions button').length === 2, 'Missing annotation controls');
      return root;
    }
    for (const [type, color, index] of [['highlight', '#ff6666', 0], ['underline', '#2ea8e5', 1]]) {
      const root = await menu(); root.querySelector(`[data-color="${color}"]`).click();
      await step('selected-color-' + type, { color });
      root.querySelectorAll('.annotation-actions button')[index].click();
      await step('clicked-' + type, { status: root.querySelector('.source').textContent });
      for (let i = 0; i < 150 && !root.querySelector('.source').textContent.includes('已保存'); i++) {
        if (root.querySelector('.source').textContent.includes('失败')) throw new Error(root.querySelector('.source').textContent);
        await pause(50);
      }
      require(root.querySelector('.source').textContent.includes('已保存'), 'Annotation action did not finish');
      await step('accepted-' + type, { status: root.querySelector('.source').textContent });
      for (let i = 0; i < 150 && !item.getAnnotations().some(annotation => annotation.annotationType === type); i++) await pause(50);
      const saved = item.getAnnotations().find(annotation => annotation.annotationType === type);
      await step('annotation-diagnostics-' + type, {
        items: item.getAnnotations().map(annotation => ({ type: annotation.annotationType, color: annotation.annotationColor, text: annotation.annotationText })),
        reader: JSON.parse(JSON.stringify(reader._internalReader._state.annotations)),
        errors: Zotero.getErrors(true).slice(-10),
      });
      require(saved?.annotationColor === color && saved.annotationText === 'research', 'Incorrect stored annotation');
      require(JSON.parse(saved.annotationPosition).rects.length > 0, 'Missing stored annotation position');
      await step('stored-' + type, { type: saved.annotationType, color: saved.annotationColor, text: saved.annotationText, key: saved.key });
    }
    reader.close(); await pause(500); reader = await Zotero.Reader.open(item.id); await reader._initPromise;
    reader.displayError = error => { report.hostError = String(error); void save(); };
    const annotations = reader._internalReader._state.annotations;
    require(annotations.some(annotation => annotation.type === 'highlight' && annotation.color === '#ff6666' && annotation.text === 'research'), 'Highlight missing after reopening');
    require(annotations.some(annotation => annotation.type === 'underline' && annotation.color === '#2ea8e5' && annotation.text === 'research'), 'Underline missing after reopening');
    await step('reopened-reader', { annotations: annotations.length });
    view = reader._internalReader._primaryView;
    for (let i = 0; i < 150 && (!view._iframeWindow || !view._pdfPages?.[0]?.chars?.length); i++) await pause(50);
    require(view._iframeWindow && view._pdfPages?.[0]?.chars?.length, 'Reopened PDF view not ready');
    pdfWin = view._iframeWindow.wrappedJSObject || view._iframeWindow;
    app.scanReaders();
    reader._internalReader._annotationManager._readOnly = true;
    const readonly = await menu(); require([...readonly.querySelectorAll('.annotation-actions button')].every(button => button.disabled), 'Read-only annotation actions enabled');
    reader._internalReader._annotationManager._readOnly = false;
    await step('readonly-controls', { disabled: true });
    readonly.querySelector('header button').click();
    reader._internalReader._updateState(Cu.cloneInto({ splitType: 'vertical' }, reader._iframeWindow));
    let secondary, secondaryWin;
    for (let i = 0; i < 150; i++) {
      secondary = reader._internalReader._secondaryView;
      if (secondary?._iframeWindow && secondary?._pdfPages?.[0]?.chars?.length) break;
      await pause(50);
    }
    require(secondary?._iframeWindow && secondary?._pdfPages?.[0]?.chars?.length, 'Split view not ready');
    secondaryWin = secondary._iframeWindow.wrappedJSObject || secondary._iframeWindow;
    app.scanReaders(); secondary._setSelectionRanges(Cu.cloneInto(ranges, reader._iframeWindow));
    const secondaryPopup = () => secondaryWin.document.querySelector('[data-local-mdx-popup]')?.shadowRoot;
    for (let i = 0; i < 100 && !secondaryPopup()?.querySelector('.annotation-actions button'); i++) await pause(50);
    require(secondaryPopup()?.querySelectorAll('.annotation-actions button').length === 2, 'Split view missing annotation controls');
    await step('split-view-controls', { available: true });
    secondaryPopup().querySelector('header button').click();
    Zotero.Prefs.set('localMDXClick.selectionMenu', 'native'); choose(); await pause(100);
    secondary._setSelectionRanges(Cu.cloneInto(ranges, reader._iframeWindow));
    require(reader._internalReader._state.primaryViewSelectionPopup?.annotation && reader._internalReader._state.secondaryViewSelectionPopup?.annotation, 'Native selection menu not restored');
    require(!popup(), 'Plugin popup conflicts with native menu');
    await step('native-menu', { restored: true });
    Zotero.Prefs.set('localMDXClick.selectionMenu', 'integrated'); await menu();
    app.stop(); choose(); secondary._setSelectionRanges(Cu.cloneInto(ranges, reader._iframeWindow));
    require(!popup() && !secondaryPopup() && reader._internalReader._state.primaryViewSelectionPopup?.annotation && reader._internalReader._state.secondaryViewSelectionPopup?.annotation, 'Plugin cleanup did not restore native callback');
    await step('plugin-cleanup', { restored: true });
    report.ok = true;
  } catch (error) { report.error = String(error); report.stack = error.stack; }
  deadline.cancel(); for (const timer of timers) timer.cancel(); await save(); Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
