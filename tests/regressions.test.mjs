import test from 'node:test';
import assert from 'node:assert/strict';
import { api, source, makeDictionary, speexSilence } from './fixtures.mjs';

for (const tail of [1, 2, 3]) {
  test(`LZO exact output limit with ${tail} trailing literals`, () => {
    const bytes = Uint8Array.from([21, 97, 97, 97, 97, 64 + tail, 0, ...Array(tail).fill(98), 17, 0, 0]);
    const expected = 'a'.repeat(7) + 'b'.repeat(tail);
    assert.equal(Buffer.from(api.lzo.decompress({ inputBuffer: bytes, maxOutputLength: expected.length })).toString(), expected);
    assert.throws(() => api.lzo.decompress({ inputBuffer: bytes, maxOutputLength: expected.length - 1 }));
    assert.throws(() => api.lzo.decompress({ inputBuffer: bytes.subarray(0, -1), maxOutputLength: expected.length }));
  });
}
test('LZO precise eight-byte record works through MDX lookup', async () => {
  const bytes = makeDictionary([['word', 'aaaaaaa']], { recordLZO: Buffer.from([21, 97, 97, 97, 97, 65, 0, 0, 17, 0, 0]) });
  const dictionary = await api.MDXDictionary.open(source(bytes));
  assert.equal((await dictionary.lookup('word'))[0].html, 'aaaaaaa');
});
for (const [name, pairs, query] of [
  ['punctuation', [['be', '<p>target</p>'], ['be-', '@@@LINK=be']], 'be-'],
  ['case', [['Apple', '@@@LINK=apple'], ['apple', '<p>target</p>']], 'Apple'],
]) test(`Alias identity preserves distinct ${name} records`, async () => {
  const dictionary = await api.MDXDictionary.open(source(makeDictionary(pairs)));
  assert.equal((await dictionary.lookup(query))[0].html, '<p>target</p>');
});
test('Alias real cycles, independent branches and shared records', async () => {
  const cycle = await api.MDXDictionary.open(source(makeDictionary([['A', '@@@LINK=B'], ['B', '@@@LINK=A']])));
  await assert.rejects(cycle.lookup('A'), /循环/);
  const branches = await api.MDXDictionary.open(source(makeDictionary([['alias', '@@@LINK=target'], ['alias', '@@@LINK=target'], ['target', '<p>shared</p>'], ['target', null]])));
  assert.deepEqual(await branches.lookup('alias'), [{ headword: 'target', html: '<p>shared</p>' }]);
});
function appEnvironment(overrides = {}) {
  const prefs = new Map([['localMDXClick.enabled', false]]);
  return {
    prefs,
    env: {
      Zotero: { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) }, logError() {} },
      IOUtils: {
        stat: async path => { if (path === '/unreadable') throw new Error('EACCES'); return { type: path.endsWith('.mdx') ? 'regular' : 'directory', size: 4096 }; },
        getChildren: async path => path === '/empty' ? [] : [`${path}/dictionary.mdx`], ...overrides,
      },
    },
  };
}
test('Folder failure keeps prior folder, dictionary list, path and loaded index', async () => {
  const bytes = makeDictionary([['word', 'definition']]); let reads = 0;
  const { env, prefs } = appEnvironment({ read: async (path, { offset, maxBytes }) => { reads++; return bytes.subarray(offset, offset + maxBytes); } });
  const app = api.createApp(env, 'test'); await app.scanFolder('/good');
  const dictionary = await app.loadDictionary(), before = reads;
  await assert.rejects(app.scanFolder('/unreadable'), /EACCES/);
  assert.equal(app.getPath(), '/good/dictionary.mdx'); assert.equal(prefs.get('localMDXClick.folder'), '/good');
  assert.equal(app.getDictionaries().length, 1); assert.equal(await app.loadDictionary(), dictionary); assert.equal(reads, before);
});
test('Successfully scanned empty folder commits an empty selection', async () => {
  const { env, prefs } = appEnvironment(); const app = api.createApp(env, 'test');
  await app.scanFolder('/good'); await app.scanFolder('/empty');
  assert.equal(app.getPath(), ''); assert.deepEqual(app.getDictionaries(), []); assert.equal(prefs.get('localMDXClick.folder'), '/empty');
});
test('Explicit MDX selection commits only after folder scan succeeds', async () => {
  const { env, prefs } = appEnvironment();
  const app = api.createApp(env, 'test'); await app.scanFolder('/good');
  await assert.rejects(app.scanFolder('/unreadable', '/unreadable/new.mdx'), /EACCES/);
  assert.equal(app.getPath(), '/good/dictionary.mdx'); assert.equal(prefs.get('localMDXClick.folder'), '/good');
});
test('Resource configuration changes retain an unchanged MDX index', async () => {
  const bytes = makeDictionary([['word', 'definition']]); let reads = 0;
  const { env } = appEnvironment({ read: async (path, { offset, maxBytes }) => { reads++; return bytes.subarray(offset, offset + maxBytes); } });
  class FilePicker {
    modeGetFolder = 1; returnOK = 0; file = '/external';
    init() {} async show() { return 0; }
  }
  env.ChromeUtils = { importESModule: () => ({ FilePicker }) };
  const app = api.createApp(env, 'test'); await app.scanFolder('/good');
  const dictionary = await app.loadDictionary(), count = reads;
  await app.chooseResources({}, 'folder'); assert.equal(await app.loadDictionary(), dictionary); assert.equal(reads, count);
  app.resetResources(); assert.equal(await app.loadDictionary(), dictionary); assert.equal(reads, count);
});
function looseFS(overrides = {}) {
  return { dirname: () => '/dict', basename: path => path.split('/').at(-1), list: async dir => [`${dir}/image.png`],
    stat: async () => ({ type: 'regular', size: 3 }), readFile: async () => Uint8Array.from([1, 2, 3]), ...overrides };
}
test('Resource stat error continues to the next directory', async () => {
  const resources = new api.LocalResources({ mdxPath: '/dict/A.mdx', folder: '/external', fs: looseFS({
    stat: async path => { if (path.startsWith('/external')) throw new Error('EACCES'); return { type: 'regular', size: 3 }; },
  }) });
  assert.deepEqual((await resources.read('image.png')).bytes, Uint8Array.from([1, 2, 3]));
  assert.ok([...resources.errors].some(error => error.includes('/external/image.png'))); resources.close();
});
test('Cached file read error invalidates location and falls back to MDD', async () => {
  let fail = false;
  const resources = new api.LocalResources({ mdxPath: '/dict/A.mdx', fs: looseFS({
    readFile: async () => { if (fail) throw new Error('ENOENT'); return Uint8Array.from([1, 2, 3]); },
  }) });
  resources.archives = ['/dict/A.mdd']; resources._archive = async () => ({ lookupBytes: async () => Uint8Array.from([4, 5, 6]) });
  assert.equal((await resources.read('image.png')).bytes[0], 1); fail = true;
  assert.equal((await resources.read('image.png')).bytes[0], 4); assert.equal(resources.locations.get('image.png').archive, '/dict/A.mdd');
});
test('Resource close during pending stat propagates cancellation without fallback', async () => {
  let resume, calls = 0;
  const resources = new api.LocalResources({ mdxPath: '/dict/A.mdx', folder: '/external', fs: looseFS({
    stat: () => new Promise(resolve => { resume = resolve; }), readFile: async () => { calls++; return new Uint8Array(1); },
  }) });
  const pending = resources.read('image.png'); while (!resume) await new Promise(resolve => setImmediate(resolve));
  resources.close(); resume({ type: 'regular', size: 1 });
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(calls, 0);
});
test('Resource AbortError propagates without trying another source', async () => {
  let stats = 0;
  const resources = new api.LocalResources({ mdxPath: '/dict/A.mdx', folder: '/external', fs: looseFS({
    stat: async () => { stats++; const error = new Error('cancelled'); error.name = 'AbortError'; throw error; },
  }) });
  await assert.rejects(resources.read('image.png'), error => error.name === 'AbortError'); assert.equal(stats, 1);
});
test('Resource volumes use numeric precedence and skip failed archives', async () => {
  const payload = tag => makeDictionary([['\\image.png', Buffer.from(tag)]], { binary: true });
  const archives = new Map([['/dict/A.2.mdd', payload('two')], ['/dict/A.10.mdd', payload('ten')]]);
  const resources = await api.LocalResources.open({ mdxPath: '/dict/A.mdx', extraArchives: ['/other/manual.mdd'], fs: looseFS({
    list: async () => ['/dict/A.10.mdd', '/dict/A.mdd', '/dict/A.2.mdd'],
    source: async path => { if (!archives.has(path)) throw new Error('EACCES'); return source(archives.get(path)); },
  }) });
  assert.deepEqual(resources.archives, ['/dict/A.mdd', '/dict/A.2.mdd', '/dict/A.10.mdd', '/other/manual.mdd']);
  assert.equal(Buffer.from((await resources.read('image.png')).bytes).toString(), 'two');
  assert.ok([...resources.errors].some(error => error.includes('/dict/A.mdd'))); resources.close();
});
test('Ordinary audio reads once and reuses URL/cache with regular resource requests', async () => {
  let reads = 0, urls = 0;
  const scope = new api.ResourceScope({ read: async key => { reads++; return { key, bytes: Uint8Array.from([1, 2, 3]), mime: 'audio/mpeg' }; } }, null, () => 'blob:' + ++urls);
  const url = await scope.audioURL('sound://pronunciation.mp3');
  assert.equal(reads, 1); assert.equal(await scope.url('pronunciation.mp3'), url); assert.equal(reads, 1);
  assert.equal(await scope.audioURL('pronunciation.mp3'), url); assert.equal(urls, 1); scope.close();
});
test('Concurrent audio and regular requests share one resource read and URL', async () => {
  let reads = 0, urls = 0;
  const scope = new api.ResourceScope({ read: async key => { reads++; return { key, bytes: new Uint8Array([1]), mime: 'audio/mpeg' }; } }, null, () => 'blob:' + ++urls);
  const results = await Promise.all([scope.audioURL('audio.mp3'), scope.url('audio.mp3')]);
  assert.equal(reads, 1); assert.equal(urls, 1); assert.equal(results[0], results[1]); scope.close();
});
test('MDD Unicode names, cross-record blocks, duplicate offsets and lookup metrics', async () => {
  const bytes = makeDictionary([['\\Images\\图.PNG', Buffer.from('picture')], ['\\Images\\图.PNG', null], ['\\sound\\last.wav', Buffer.from('last resource')]], { binary: true, keyBlockSize: 1, recordChunk: 4 });
  const archive = await api.MDDArchive.open(source(bytes));
  assert.equal(Buffer.from(await archive.lookupBytes('/images/图.png')).toString(), 'picture');
  assert.equal(Buffer.from(await archive.lookupBytes('sound/last.wav')).toString(), 'last resource');
  const before = archive.lookupStats.blocksInspected;
  assert.equal(Buffer.from(await archive.lookupBytes('sound/last.wav')).toString(), 'last resource');
  assert.equal(archive.lookupStats.blocksInspected, before); assert.ok(archive.lookupStats.cacheHits > 0);
  assert.ok(archive.lookupStats.bytesRead > 0); archive.clearCache(); assert.equal(archive._lookupCache.size, 0);
});
test('MDD unknown collation retains fallback; repeated misses use bounded cache', async () => {
  const archive = new api.MDDArchive({}); archive._rawTotal = 3;
  archive._keyBlocks = Array.from({ length: 50 }, (_, i) => ({ first: `path/${i}/a`, last: `path/${i}/z` }));
  let reads = 0;
  archive._resourceKeys = async index => { reads++; return index === 49 ? [{ headword: 'other/found', key: 'other/found', start: 0, end: 3 }] : []; };
  archive._entryBytes = async () => Uint8Array.from([1, 2, 3]);
  assert.equal(await archive.lookupBytes('other/missing'), null); assert.equal(reads, 50);
  assert.equal(await archive.lookupBytes('other/missing'), null); assert.equal(reads, 50);
  assert.deepEqual(await archive.lookupBytes('other/found'), Uint8Array.from([1, 2, 3])); assert.equal(reads, 100);
});
test('MDD key and lookup caches evict within their byte limits', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => [String(i).padStart(2, '0') + 'x'.repeat(60000), Buffer.from([i])]);
  const archive = await api.MDDArchive.open(source(makeDictionary(rows, { binary: true, keyBlockSize: 1 })));
  for (const [key, bytes] of rows) assert.deepEqual(await archive.lookupBytes(key), new Uint8Array(bytes));
  assert.ok(archive._keyCacheBytes <= 8 * 1024 * 1024); assert.ok(archive._keyCache.size < rows.length);
  assert.ok(archive._lookupCacheBytes <= 1024 * 1024); assert.ok(archive._lookupCache.size < rows.length);
  assert.deepEqual(await archive.lookupBytes(rows[0][0]), new Uint8Array([0]));
});
test('Closing display scope cancels pending URLs and revokes created URLs', async () => {
  let resume, revoked = [];
  const win = { Blob, URL: { createObjectURL: () => 'blob:one', revokeObjectURL: url => revoked.push(url) } };
  const scope = new api.ResourceScope({ read: async key => ({ key, bytes: new Uint8Array([1]), mime: 'image/png' }) }, win);
  await scope.url('image.png'); scope.close(); assert.deepEqual(revoked, ['blob:one']);
  const pendingScope = new api.ResourceScope({ read: () => new Promise(resolve => { resume = resolve; }) }, win);
  const pending = pendingScope.url('image.png'); while (!resume) await new Promise(resolve => setImmediate(resolve));
  pendingScope.close(); resume({ key: 'image.png', bytes: new Uint8Array([1]), mime: 'image/png' });
  await assert.rejects(pending, /关闭/); assert.equal(pendingScope.urls.size, 0);
});
test('Native CSS relative imports, images, fonts and neutral-plan filtering', async () => {
  const files = new Map([
    ['css/base.css', Buffer.from('@import "nested/extra.css" screen; .image{background:url(../images/bg.png)} @font-face{font-family:Test;src:url(../fonts/missing.woff2),url(../fonts/good.woff2)}')],
    ['css/nested/extra.css', Buffer.from('.nested{color:red}')], ['images/bg.png', Buffer.from([1])], ['fonts/good.woff2', Buffer.from([2])],
  ]);
  const scope = new api.ResourceScope({ read: async key => files.has(key) ? { key, bytes: files.get(key), mime: 'application/octet-stream' } : null }, null, resource => 'blob:' + resource.key);
  const plan = await api.prepareNativeDefinition('<link rel="stylesheet" href="css/base.css"><script>bad()</script><img src="https://example.invalid/x" onclick="bad()"><p class="image">content</p>', scope);
  assert.match(plan.css.join(''), /@media screen/); assert.match(plan.css.join(''), /blob:images\/bg.png/);
  assert.match(plan.css.join(''), /blob:fonts\/good.woff2/); assert.equal(scope.missing.size, 0);
  assert.ok([...scope.optionalMissing].some(key => key.includes('missing.woff2')));
  const visit = nodes => nodes.flatMap(node => [node, ...visit(node.children || [])]);
  for (const node of visit(plan.nodes)) { assert.notEqual(node.tag, 'script'); assert.ok(!node.attrs?.onclick); assert.ok(!node.attrs?.src?.startsWith('https:')); }
  scope.close();
});
test('Annotation adapter clones complete data, preserves snapshot and handles read-only', async () => {
  const annotation = { text: 'word', sortIndex: '00000|000001|00000', pageLabel: '1', position: { pageIndex: 0, rects: [[1, 2, 3, 4]] } };
  const readerWindow = {}, color = '#ff6666'; let passed;
  const Cu = { cloneInto: (data, target) => { assert.equal(target, readerWindow); passed = structuredClone(data); return passed; } };
  const view = { _onAddAnnotation: payload => { assert.equal(payload, passed); assert.equal(payload.color, color); return { ...payload, id: 'TEST' }; } };
  const saved = await api.saveSelectionAnnotation({ view, readerWindow, Cu, annotation, type: 'underline', color });
  assert.equal(saved.type, 'underline'); assert.equal(annotation.color, undefined); assert.deepEqual(saved.position, annotation.position);
  await assert.rejects(api.saveSelectionAnnotation({ view, readerWindow, Cu, annotation, type: 'highlight', color, readOnly: true }), /只读/);
});
test('Selection menu disables, restores and preserves a later extension wrapper', () => {
  let enabled = true, shown, intercepted = 0;
  const popup = { annotation: { text: 'word' }, rect: [0, 0, 1, 1] };
  const original = function (value) { shown = value; };
  const view = { _onSetSelectionPopup: original, _onAddAnnotation() {} };
  const menu = api.replaceSelectionMenu(view, { enabled: () => enabled, onPopup: () => intercepted++ });
  view._onSetSelectionPopup(popup); assert.equal(shown, null); assert.equal(intercepted, 1);
  enabled = false; menu.refresh(); assert.equal(shown, popup);
  enabled = true; menu.refresh(); assert.equal(shown, null);
  const wrapper = view._onSetSelectionPopup;
  const another = value => wrapper(value); view._onSetSelectionPopup = another;
  menu.dispose(); assert.equal(view._onSetSelectionPopup, another); assert.equal(shown, popup);
  view._onSetSelectionPopup(popup); assert.equal(shown, popup);
});
test('Speex WAV output, short chained streams and cumulative file duration', async () => {
  const options = { randomFill: bytes => bytes.fill(0) };
  const wav = await api.decodeSpeex(speexSilence(1, 1), options);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF'); assert.equal((wav.length - 44) / 16000, 1);
  const short = await api.decodeSpeex(Buffer.concat([speexSilence(1, 1), speexSilence(2, 1)]), options);
  assert.equal((short.length - 44) / 16000, 2);
  await assert.rejects(api.decodeSpeex(Buffer.concat([speexSilence(1, 30), speexSilence(2, 30)]), options), /30 秒/);
  const corrupt = speexSilence(1, 1); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(api.decodeSpeex(corrupt, options), /校验/);
  await assert.rejects(api.decodeSpeex(speexSilence(1, 1), { ...options, cancelled: () => true }), /关闭/);
});
for (const mode of [0, 1, 2]) {
  test(`Speex mode ${mode} decodes stereo and multi-frame packets`, async () => {
    const wav = await api.decodeSpeex(speexSilence(100 + mode, 1, { mode, channels: 2, framesPerPacket: 3 }), { randomFill: bytes => bytes.fill(0) });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 8000 * (2 ** mode));
    assert.equal((wav.length - 44) / (8000 * (2 ** mode) * 2 * 2), 1);
  });
}
test('Selection candidates preserve phrase spaces, real hyphens and length bounds', () => {
  assert.deepEqual(api.queryFromText('transfor-\nmation', 'selection').candidates, ['transfor-mation', 'transformation']);
  assert.deepEqual(api.queryFromText('state-of-the-art transfor-\nmation').candidates, ['state-of-the-art transfor-mation', 'state-of-the-art transformation', 'stateoftheart transformation']);
  assert.deepEqual(api.queryFromText('neural network').candidates, ['neural network']);
  assert.equal(api.queryFromText('word '.repeat(17)), null); assert.equal(api.queryFromText('x'.repeat(257)), null);
});
