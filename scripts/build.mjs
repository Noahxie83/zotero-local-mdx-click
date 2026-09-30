import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  entryPoints: [path.join(root, 'src/main.js')],
  outfile: path.join(root, 'addon/content/plugin.js'),
  bundle: true, format: 'iife', globalName: 'LocalMDXModule',
  platform: 'browser', target: ['firefox140'], legalComments: 'inline',
});
await mkdir(path.join(root, 'addon/licenses'), { recursive: true });
for (const [src, dest] of [
  ['LICENSE', 'LICENSE'], ['THIRD_PARTY.md', 'THIRD_PARTY.md'],
  ['node_modules/pako/LICENSE', 'licenses/pako.txt'],
  ['node_modules/parse5/LICENSE', 'licenses/parse5.txt'],
  ['node_modules/entities/LICENSE', 'licenses/entities.txt'],
  ['node_modules/css-tree/LICENSE', 'licenses/css-tree.txt'],
  ['node_modules/source-map-js/LICENSE', 'licenses/source-map-js.txt'],
  ['src/vendor/lzo1x.ts', 'licenses/lzo1x-source.ts'],
  ['src/vendor/NOTICE.md', 'licenses/lzo1x-NOTICE.md'],
  ['src/vendor/ripemd128.ts', 'licenses/ripemd128-source.ts'],
  ['src/vendor/js-mdict-LICENSE', 'licenses/js-mdict-MIT.txt'],
]) await cp(path.join(root, src), path.join(root, 'addon', dest));
const files = {};
async function walk(dir, prefix = '') {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + ent.name;
    if (ent.isDirectory()) await walk(path.join(dir, ent.name), name + '/');
    else files[name] = new Uint8Array(await readFile(path.join(dir, ent.name)));
  }
}
await walk(path.join(root, 'addon'));
const manifest = JSON.parse(await readFile(path.join(root, 'addon/manifest.json'), 'utf8'));
await mkdir(path.join(root, 'dist'), { recursive: true });
const name = `local-mdx-click-${manifest.version}.xpi`;
const out = path.join(root, 'dist', name);
const xpi = zipSync(files, { level: 6 });
await writeFile(out, xpi);
await writeFile(path.join(root, 'dist/SHA256SUMS.txt'), createHash('sha256').update(xpi).digest('hex') + '  ' + name + '\n');
console.log(out);
