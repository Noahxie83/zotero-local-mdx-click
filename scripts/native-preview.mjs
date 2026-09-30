/* SPDX-License-Identifier: GPL-3.0-or-later */
// Creates a local review artifact. It does not run browser/Zotero tests.
// Dictionary material remains outside the source tree and source ZIP.
import { build } from 'esbuild';
import { open, stat, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const [word, ...dictionaryPaths] = process.argv.slice(2);
if (!word || !dictionaryPaths.length) throw new Error('用法：node scripts/native-preview.mjs 单词 词典.mdx [其他词典.mdx]');
const compiled = await build({
  stdin: { contents: "export {MDXDictionary} from './src/mdx.js'; export {LocalResources} from './src/resources.js'; export {ResourceScope,prepareNativeDefinition} from './src/native-render.js';", resolveDir: root, sourcefile: 'preview-core.js' },
  write: false, bundle: true, platform: 'node', format: 'esm', target: ['node22'], legalComments: 'none',
});
const core = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const handles = new Map();
const fs = {
  basename: path.basename, dirname: path.dirname,
  list: async folder => (await readdir(folder)).map(name => path.join(folder, name)),
  stat: async file => { const s = await stat(file); return { size: s.size, type: s.isFile() ? 'regular' : 'directory' }; },
  readFile: async file => new Uint8Array(await readFile(file)),
  source: async file => {
    if (!handles.has(file)) handles.set(file, await open(file, 'r'));
    const handle = handles.get(file), info = await handle.stat();
    return { size: info.size, read: async (offset, length) => {
      const result = new Uint8Array(length); let at = 0;
      while (at < length) {
        const { bytesRead } = await handle.read(result, at, length - at, offset + at);
        if (!bytesRead) throw new Error('文件读取不完整'); at += bytesRead;
      }
      return result;
    } };
  },
};
const examples = [];
try {
  for (const input of dictionaryPaths) {
    const mdxPath = path.resolve(input);
    const dictionary = await core.MDXDictionary.open(await fs.source(mdxPath));
    const entries = await dictionary.lookup(word);
    if (!entries.length) throw new Error(path.basename(mdxPath) + ' 未收录 ' + word);
    const resources = await core.LocalResources.open({ mdxPath, fs });
    const scope = new core.ResourceScope(resources, null, resource => 'data:' + resource.mime + ';base64,' + Buffer.from(resource.bytes).toString('base64'));
    const plans = [];
    for (const entry of entries.slice(0, 12)) plans.push(await core.prepareNativeDefinition(entry.html, scope));
    examples.push({ name: path.basename(mdxPath), plans, missing: [...scope.missing], errors: [...resources.errors] });
    console.log(path.basename(mdxPath) + ': ' + plans.length + ' 条词条，' + scope.urls.size + ' 个嵌入资源');
    scope.close(); resources.close(); dictionary.clearCache();
  }
} finally { for (const handle of handles.values()) await handle.close(); }
const client = await build({
  stdin: { contents: `
    import {createCard,element} from './src/render.js';
    import {mountNativeDefinition} from './src/native-render.js';
    const examples = ${JSON.stringify(examples)};
    let current, disposers = [], index = 0;
    function show() {
      disposers.forEach(fn => fn()); disposers = []; current?.host.remove();
      current = createCard(document,0,0,${JSON.stringify(word)},() => {disposers.forEach(fn => fn());current.host.remove();});
      const card = current;
      examples.forEach((sample,i) => {const option=element(document,'option',sample.name); option.value=String(i);card.selector.append(option);});
      card.selector.value=String(index);
      card.selector.onchange=() => {index=Number(card.selector.value);show();};
      card.body.replaceChildren();card.body.style.padding='0';
      const scope = {closed:false,url:async () => '',missing:new Set()};
      examples[index].plans.forEach(plan => {const section=element(document,'section');card.body.append(section);
        disposers.push(mountNativeDefinition(document,section,plan,scope,{
          onEntry:()=>{card.footer.textContent='预览只包含所选单词；在 Zotero 中可以继续跳转查词。';},
          onStatus:()=>{card.footer.textContent='预览不嵌入音频；请在 Zotero 中点击发音。';},
          onClose:()=>{disposers.forEach(fn=>fn());card.host.remove();}
        }));
      });
      card.footer.textContent='原有排版预览 · '+examples[index].name;
      card.footer.title=[...examples[index].missing,...examples[index].errors].join('\\n');
      card.host.style.left='50%';card.host.style.top='76px';card.host.style.transform='translateX(-50%)';
      card.host.shadowRoot.querySelector('.card').style.maxHeight='min(580px,calc(100vh - 100px))';
    }
    document.getElementById('reopen').onclick=show;show();
  `, resolveDir: root, sourcefile: 'native-preview-client.js' },
  write: false, bundle: true, format: 'iife', target: ['firefox140'], legalComments: 'inline',
});
const script = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const output = path.resolve(root, '../原有排版预览-' + version + '.html');
await writeFile(output, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>本地词典原有排版预览</title>
<style>body{margin:0;background:#eef2f6;font:13px 'Segoe UI','Microsoft YaHei',sans-serif;color:#596777}nav{padding:20px;display:flex;justify-content:center;gap:16px;align-items:center}button{padding:5px 9px;background:white;border:1px solid #ced7e1;border-radius:4px;cursor:pointer}</style>
<nav><span>本地词典 ${version} · 原有排版预览（无音频）</span><button id="reopen">重新显示</button></nav><script>${script}</script></html>`);
console.log(output);
