/* SPDX-License-Identifier: GPL-3.0-or-later */
// Optional developer rebuild. The delivered source includes the compiled WASM
// so installing/building the Zotero XPI never requires a native compiler.
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = process.env.WASI_CC;
if (!compiler) throw new Error('Set WASI_CC to wasi-sdk 34 clang (wasm32-wasip1 target).');
const base = join(root, 'src/vendor/speex');
const names = ['spx_alloc', 'spx_free', 'spx_open', 'spx_close', 'spx_version', 'spx_frame_size', 'spx_lookahead', 'spx_packet'];
const args = [
  '--target=wasm32-wasip1', '-mexec-model=reactor',
  join(base, 'all.c'), join(base, 'decoder.c'),
  '-I' + join(base, 'upstream/include'), '-I' + join(base, 'upstream/include/speex'), '-I' + join(base, 'upstream/libspeex'),
  '-DFLOATING_POINT', '-DUSE_SMALLFT', '-DEXPORT=', '-Oz', '-flto', '-lm',
  '-Wl,--strip-all', '-Wl,--export-memory', '-Wl,--initial-memory=2097152', '-Wl,--max-memory=16777216',
  ...names.map(name => '-Wl,--export=' + name), '-o', join(base, 'decoder.wasm'),
];
const result = spawnSync(resolve(compiler), args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(join(base, 'decoder.wasm'));
