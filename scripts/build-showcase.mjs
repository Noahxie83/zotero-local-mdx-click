/* SPDX-License-Identifier: GPL-3.0-or-later */
import { build } from 'esbuild';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDictionary } from '../tests/fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const descriptions = {
  network: ['A group of connected nodes that exchange information.', '相互连接并交换信息的节点所组成的网络。', 'The network carries signals between its nodes.', '网络在节点间传递信号。'],
  transformation: ['A change that maps an input into a new representation.', '把输入映射为新表示的变换。', 'A transformation changes the representation of an input.', '变换改变输入的表示形式。'],
  'neural network': ['A model built from connected units with learnable parameters.', '由带有可学习参数的连接单元构成的模型。', 'The neural network learns from examples.', '神经网络从样例中学习。'],
  'pre-softmax': ['Describing values before the softmax operation.', '用于描述 softmax 运算前的数值。', 'Inspect the pre-softmax values before normalization.', '归一化前查看 softmax 运算之前的数值。'],
};
const styles = [
  'body{font:18px/1.6 Georgia,"SimSun",serif;padding:18px 20px;color:#253648}h2{font-size:31px;color:#0088d6;margin:0 0 5px}.ipa{color:#0068b4;font-size:19px}.us{color:#b42d36}.pos{background:#0088d6;color:white;font:700 13px "Segoe UI",sans-serif;padding:4px 8px;display:inline-block;margin-top:16px}hr{border:0;border-top:2px solid #0088d6;margin:0 0 17px}.def{color:#096cab;font-size:20px}.example{font-style:italic;margin-top:12px}.zh{margin-top:3px}img{width:140px;float:right;margin:8px 0 16px 20px}a{color:#087bd0}small{font:12px "Segoe UI",sans-serif;color:#586d7f}',
  'body{font:17px/1.65 "Segoe UI","Microsoft YaHei",sans-serif;padding:20px;color:#102b46;background:#fcfcf9}h2{font:700 32px Georgia,serif;margin:0 0 6px}.ipa{color:#0068b4}.us{color:#b42d36}.pos{border:1px solid #dbe5ed;border-radius:20px;display:inline-block;padding:2px 12px;font-size:12px;margin-top:18px}hr{border:0;border-top:1px solid #dbe5ed;margin:14px 0}.def{font-size:18px}.example{background:#eff6fb;border-radius:6px;padding:12px;font:italic 18px/1.6 Georgia,serif}.zh{color:#586d7f}img{width:120px;margin:16px 0}a{color:#087bd0}small{font-size:12px;color:#586d7f}',
];
const diagram = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130" viewBox="0 0 200 130"><rect width="200" height="130" rx="12" fill="#eff6fb"/><g stroke="#087bd0" stroke-width="2"><path d="M35 35 100 65 165 30M35 100 100 65 165 100" fill="none"/></g><g fill="#087bd0"><circle cx="35" cy="35" r="9"/><circle cx="35" cy="100" r="9"/><circle cx="100" cy="65" r="12"/><circle cx="165" cy="30" r="9"/><circle cx="165" cy="100" r="9"/></g></svg>';
const wav = Buffer.alloc(44 + 8000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
for(let i=0;i<4000;i++) wav.writeInt16LE(Math.round(1200*Math.sin(i*2*Math.PI*600/16000)*Math.sin(i*Math.PI/4000)),44+i*2);
const dictionaries = [{path:'demo/Study.mdx',name:'研究英语 · 示例词典'}, {path:'demo/Pocket.mdx',name:'简明双语 · 示例词典'}], files = {};
for (const [index, item] of dictionaries.entries()) {
  const definitions = Object.entries(descriptions).map(([word, [definition, chinese, example, translation]]) => {
    const pronunciation = word === 'network' ? '<span class="ipa">/ˈnetwɜːk/</span> <span class="ipa us">/ˈnetwɝːk/</span>' : '';
    return [word, `<link rel="stylesheet" href="style.css"><h2>${word}</h2>${pronunciation}<br><span class="pos">${word === 'pre-softmax' ? 'ADJECTIVE' : 'NOUN'}</span><hr>${word === 'network' ? '<img src="images/network.svg" alt="原创网络示意图">' : ''}<div class="def">${definition}</div><div class="zh">${chinese}</div><div class="example">⇒ ${example}</div><div class="zh">${translation}</div><p><a href="sound://demo.wav">▷ 试听资源提示音</a></p><small>原创释义 · 音频仅为提示音，非单词发音</small>`];
  });
  definitions.push(['transfor-mation', '@@@LINK=transformation']); definitions.sort((a,b)=>a[0].localeCompare(b[0],'en'));
  files[item.path] = makeDictionary(definitions).toString('base64');
  files[item.path.replace('.mdx','.mdd')] = makeDictionary([['demo.wav', wav],['style.css',Buffer.from(styles[index])]], {binary:true, keyBlockSize:1, recordChunk:8192}).toString('base64');
  files[item.path.replace('.mdx','.2.mdd')] = makeDictionary([['images/network.svg',Buffer.from(diagram)]],{binary:true}).toString('base64');
}
const bundle = await build({ entryPoints:[path.join(root,'examples/showcase.js')],bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,write:false,loader:{'.wasm':'binary'},legalComments:'none' });
const esc = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
let licenses = 'Local MDX — GPL-3.0-or-later\n'+await readFile(path.join(root,'LICENSE'),'utf8');
for(const name of await readdir(path.join(root,'addon/licenses'))) licenses += '\n\n--- '+name+' ---\n'+await readFile(path.join(root,'addon/licenses',name),'utf8');
const logo = 'data:image/svg+xml;base64,'+(await readFile(path.join(root,'docs/assets/wordmark.svg'))).toString('base64');
const template = await readFile(path.join(root,'examples/template.html'),'utf8');
const html = template.replace('__WORDMARK__',()=>logo).replace('__LICENSES__',()=>esc(licenses)).replace('__DATA__',()=>JSON.stringify({dictionaries,files}).replace(/</g,'\\u003c')).replace('__BUNDLE__',()=>bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await writeFile(path.join(root,'docs/index.html'),html);await writeFile(path.join(root,'docs/.nojekyll'),'');await mkdir(path.join(root,'dist'),{recursive:true});
await writeFile(path.join(root,'dist/local-mdx-click-demo-1.1.2.html'),html);console.log('Built standalone showcase: '+Buffer.byteLength(html)+' bytes');
