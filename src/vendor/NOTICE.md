# LZO implementation

`lzo1x.ts` is vendored from `terasum/js-mdict`, tag `v6.0.6`:
https://github.com/terasum/js-mdict/blob/v6.0.6/src/lzo1x.ts

The file is the JavaScript port of minilzo by Alistair Braidwood, originally
derived from Markus F. X. J. Oberhumer's minilzo. Its file-level license is
**GPL-2.0-or-later**, retained at the top of the source. The containing project's
MIT license does not replace this file-level license. The plugin is distributed
under GPL-3.0-or-later, including this compatible component.

Local changes add input bounds checks, invalid lookbehind checks, and a maximum
output size taken from the MDX block metadata. These checks prevent corrupt LZO
blocks from growing their output without bound.

MDX parsing is implemented in `../mdx.js`. The public format structure was
cross-checked with these sources:

- https://github.com/terasum/js-mdict/tree/v6.0.6/src
- https://github.com/fengdh/mdict-js
- https://github.com/zhansliu/writemdict

The parser and plugin do not contain dictionary definitions. Users select their
own local dictionary files; those files are not copied into the distributable.
