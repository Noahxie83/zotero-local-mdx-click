/* SPDX-License-Identifier: GPL-3.0-or-later */
// Build an optional local visual sample from a previously extracted entry.
// This is a preview artifact, not a browser or Zotero test runner.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const [input, word = 'introduction', dictionaryName = '本地词典'] = process.argv.slice(2);
if (!input) throw new Error('用法：node scripts/preview.mjs 词条.html 单词 词典名称');
const html = await readFile(input, 'utf8');
const result = await build({
  stdin: { contents: `
    import { createCard, renderDefinition, element } from './src/render.js';
    let current;
    function show() {
      current?.host.remove();
      current = createCard(document, 0, 0, ${JSON.stringify(word)}, () => current.host.remove());
      current.body.replaceChildren(renderDefinition(document, ${JSON.stringify(html)}));
      current.selector.append(element(document, 'option', ${JSON.stringify(dictionaryName)}));
      current.footer.textContent = '本地排版预览 · 0.1.1';
      current.host.style.left = '50%'; current.host.style.top = '76px';
      current.host.style.transform = 'translateX(-50%)';
      current.host.shadowRoot.querySelector('.card').style.maxHeight = 'min(580px,calc(100vh - 100px))';
    }
    document.getElementById('reopen').addEventListener('click', show);
    show();
  `, resolveDir: root, sourcefile: 'local-preview.js', loader: 'js' },
  write: false, bundle: true, format: 'iife', target: ['firefox140'], legalComments: 'inline',
});
// Keep local dictionary material outside the source project / source ZIP.
const output = path.resolve(root, '../词条排版预览-0.1.1.html');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await writeFile(output, `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>本地 MDX 词条排版预览</title>
<style>body{margin:0;background:#eef2f6;font:13px 'Segoe UI','Microsoft YaHei',sans-serif;color:#596777}nav{padding:20px;display:flex;justify-content:center;gap:16px;align-items:center}nav button{padding:5px 9px;background:white;border:1px solid #ced7e1;border-radius:4px;color:#42546a;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#181d23;color:#aab6c5}}</style>
<nav><span>本地 MDX · 0.1.1 词条排版预览</span><button id="reopen">重新显示</button></nav>
<script>${script}</script></html>`);
console.log(output);
