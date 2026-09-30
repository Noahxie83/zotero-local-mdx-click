# 词典原生样式与 MDD 资源支持

## 当前状态

0.1.2 修复了 `network` 的文字排版问题，仍使用插件提供的统一文字样式。以下是针对用户所提供词典的只读调查与后续实现方向，不是已完成的功能。

## 实际资源分布

已直接读取配套 MDD 的资源索引，未批量解包音频或图片：

| 文件 | 其中的样式文件 | 资源示例 |
| --- | --- | --- |
| TLD.mdd | v.css | snd 开头的 SPX 音频 |
| TLD.1.mdd | l.css | ameProns 目录的 MP3 |
| TLD.2.mdd | o.css | mediaenglish 前缀的 SPX |
| TLD.3.mdd | cls.css | COLmp3 前缀的 SPX |
| TLD.4.mdd | mw.css | mw 前缀的 SPX |
| TLD.5.mdd | d.css | 以编号命名的 SPX |
| TLD.6.mdd | c.css | uk_pron 等目录的 MP3 |
| 牛津高阶双解(第9版)_V3.1.2版.mdd | oalecd9.css | oalecd9.js、字体、图片资源 |
| 牛津同名 .1.mdd / .2.mdd | 未发现 CSS | 单词与例句的 MP3 |

同目录还存在 `p.css`、`oalecd9.css`、`v.png`、`luk.png`、`lus.png`、`cluk.png`、`clus.png`、`cuk.png`、`cus.png`、`ouk.png`、`ous.png`、`mw.png`、`d.png` 等外置资源。因此，样式和图标可能存放在 MDD，也可能在词典旁边，需要兼顾两种来源。

TLD 词条引用了 `p.css`、分卷中的多个 CSS，以及同目录的图标图片。`p.css` 本身规定了头部字体、音标颜色、考试标签、词性显示和词频数据的隐藏 / 行内排版。当前统一文字转换没有加载这些文件，导致本应隐藏或并排的数字呈现为连续段落。

## 后续实现方向

1. 将 MDX 容器的索引和按需解压逻辑扩展为可读取 MDD 的二进制资源；MDD 资源名按 UTF-16 解析，资源内容保留为字节，不按词条文字解码。
2. 根据所选 MDX 的文件名关联同名 `.mdd`、`.1.mdd`、`.2.mdd` 等分卷，只索引需要的资源包并限制缓存。
3. 根据词条实际引用定位同目录资源和 MDD 资源，保留每部词典自己的 HTML 结构、类名和 CSS。
4. 将词条放进独立的受限显示区域，使原词典样式不改变 Zotero / PDF 阅读器界面。
5. 按需提供图片、字体和音频；使用插件自身的播放逻辑。TLD 同时含 MP3 与 SPX，SPX 解码兼容需要另外评估。
6. 无原生样式的词典继续提供通用文字排版；依赖词典脚本的特殊交互再针对实际需求兼容。

大部分外观应来自词典自身资源，无需逐个手写模板。

参考：[MDict 格式说明](https://github.com/csarron/mdict-analysis)、[js-mdict 实现](https://github.com/terasum/js-mdict)。
