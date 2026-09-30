# Third party notices

This project is distributed under GPL-3.0-or-later. Local dictionary files are not included and retain their original rights.

## minilzo-js

`src/vendor/lzo1x.ts` is the minilzo-js JavaScript port by Alistair Braidwood, derived from minilzo by Markus F. X. J. Oberhumer, distributed through terasum/js-mdict v6.0.6. The original GPL-2.0-or-later header is preserved. The surrounding js-mdict package's MIT declaration does not override this file's GPL license. This project uses the GPL-3.0-or-later option.

Source: https://github.com/terasum/js-mdict/tree/v6.0.6

## RIPEMD-128

`src/vendor/ripemd128.ts` is by Feng Dihai, based on coiscir/jsdigest. Its MIT license notice is preserved in the source. Source: https://github.com/terasum/js-mdict/blob/v6.0.6/src/ripemd128.ts

## Runtime dependencies

- pako 2.1.0 — MIT and Zlib, https://github.com/nodeca/pako
- parse5 7.3.0 — MIT, https://github.com/inikulin/parse5
- entities (pinned in package-lock.json) — BSD-2-Clause, https://github.com/fb55/entities
- css-tree 3.1.0 — MIT, https://github.com/csstree/csstree (parser, walker and generator imports; no lexer/data bundle)
- source-map-js (pinned in package-lock.json) — BSD-3-Clause, https://github.com/7rulnik/source-map-js

css-tree's mdn-data dependency is installed for development but is not bundled by the parser/walker/generator imports used here.

The build copies these license texts into the XPI `licenses/` directory.

## Development dependencies

- esbuild 0.25.10 — MIT, https://github.com/evanw/esbuild
- fflate 0.8.2 — MIT, https://github.com/101arrowz/fflate

## Format and interface references

The MDX reader is an original implementation informed by the file format and js-mdict source; the MDX research package's MIT attribution is retained in `licenses/js-mdict-MIT.txt`.

- https://github.com/zhansliu/writemdict/blob/master/fileformat.md
- https://github.com/terasum/js-mdict
- https://www.zotero.org/support/dev/zotero_7_for_developers
- https://github.com/zotero/reader/blob/master/src/pdf/pdf-view.js

The PDF word extraction and plugin UI are original code. No Hover Translate Eudic code is included.
