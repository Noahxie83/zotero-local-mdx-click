# Speex decoder

`upstream/` contains unmodified Speex 1.2.1 C sources from the vendored source in
https://github.com/caitunai/speex/tree/cbabf6e8213ad6eb2c984c2904996ad529536b1b/internal/csrc/speex

The original BSD-style copyright notices and `upstream/COPYING` are preserved.
`all.c` is the upstream repository's amalgamation include list, with include
paths changed to `upstream/`; its repository MIT license is in
`assembly-MIT-LICENSE`. This is the codec, not SpeexDSP preprocessing/resampling.

`decoder.c` is this project's original decoding-only interface, under
GPL-3.0-or-later. It exposes packet decoding, including multiple frames,
narrowband/wideband/ultra-wideband modes and intensity stereo handling.

`decoder.wasm` is compiled using wasi-sdk 34.0:

- wasi-libc revision: `2e6fb9d8ee0c`
- LLVM revision: `895aa2c896ad`, version 23.1.0
- SDK config revision: `f992bcc08219`
- `-Oz -flto`, wasm32-wasip1 reactor, 2 MB initial memory, 16 MB maximum memory
- Exports and compiler arguments: `scripts/build-speex.mjs`

WASI libc uses the licenses described in `WASI-LIBC-LICENSE`, including
Apache-2.0 with LLVM exception, MIT and BSD components. The relevant complete
license notices are included here and copied into the XPI. LLVM's license is
also included. Rebuild with a separately installed wasi-sdk compiler by setting
`WASI_CC`, then running `node scripts/build-speex.mjs`.

The normal XPI build embeds the prebuilt WASM in the JavaScript bundle. No
compiler, Emscripten, native executable, external decoder or network download is
required at runtime. The source ZIP includes the C sources and WASM. The SDK
itself is a development dependency and is not distributed in the plugin.

The host adapter supplies only local random bytes and inert standard I/O;
no WASI filesystem or network access is exposed. Audio becomes an in-memory
PCM WAV, owned and revoked by the dictionary popup's resource scope.
