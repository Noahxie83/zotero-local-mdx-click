/* SPDX-License-Identifier: GPL-3.0-or-later */
import { zipSync } from 'fflate';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const omit = new Set(['.git', 'node_modules', 'dist', 'preview']);
const generated = new Set(['addon/content/plugin.js', 'addon/LICENSE', 'addon/THIRD_PARTY.md']);
const files = {};
async function walk(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (omit.has(item.name) || generated.has(name) || name.startsWith('addon/licenses/') || /\.(?:mdx|mdd|xpi|zip)$/i.test(name)) continue;
    if (item.isDirectory()) await walk(path.join(dir, item.name), name + '/');
    else if (item.isFile()) files['zotero-local-mdx-click/' + name] = new Uint8Array(await readFile(path.join(dir, item.name)));
  }
}
await walk(root);
await mkdir(path.join(root, 'dist'), { recursive: true });
const suffix = process.argv.includes('--docs') ? '-docs' : '';
const out = path.join(root, 'dist', `local-mdx-click-source-${manifest.version}${suffix}.zip`);
await writeFile(out, zipSync(files, { level: 6 }));
console.log(out);
