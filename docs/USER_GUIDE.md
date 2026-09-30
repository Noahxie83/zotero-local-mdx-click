# 完整使用指南 · Local MDX 1.1.2

在 Zotero 10.0 系列 PDF 阅读器中单击英文单词，或划选完整的单词与词组，查询所选本地 MDX 词典，并读取配套 MDD 分卷或外置文件中的样式、图片、字体与音频。

**当前版本为 1.1.2，内置 SPX/Speex 解码器。** [下载安装包](https://github.com/Noahxie83/zotero-local-mdx-click/releases/tag/v1.1.2)。版本修复与验证范围见 [1.1.2 验证记录](REVIEW_FIXES_1.1.2.md)。

## 安装与查词

1. Zotero → 工具 → 插件 → 齿轮 → 从文件安装插件，选择 `local-mdx-click-1.1.2.xpi`，完成后重启 Zotero。覆盖已有版本后，原词典路径与选择保留。
2. 设置 → 本地 MDX 点击查词 → 选择词典文件夹，指定存放词典的目录。也可以直接选择 MDX 文件。插件列出其同目录当前层的全部 `.mdx`。
3. 从下拉框选择当前词典。已有选择继续保留；首次按名称排序选择第一部词典。
4. 显示方式默认“词典原有排版”，读取词条实际引用的样式和资源。也可切换为“简洁文字排版”。
5. 打开有文字层的 PDF，单击正文英文单词，或用普通指针拖选完整单词/词组，松开鼠标查询。弹窗和 PDF 工具栏均可切换词典。点击发音图标/链接播放本地音频，点击词条查询链接继续查词。

划选查词默认开启，可在设置中单独关闭。独立高亮/批注工具、拖拽已有选区和带 Ctrl/Alt/Shift 的操作不会触发自动查词。工具栏按钮可开关本地查词，右键可换目录。安装前已打开的 PDF 没有按钮时，可重新打开标签。用 ×、Esc、点击外部或滚动 PDF 关闭弹窗。

## 划选菜单与批注

默认使用“插件查词与批注菜单”。普通指针选择文字后，在一个弹窗中显示词典释义、8 个颜色按钮，以及“高亮选区”和“添加下划线”。先选择颜色，再点击对应动作；批注通过 Zotero 的接口保存到原文献，颜色选择会记住。自动查词和选颜色本身不会创建批注，没有添加笔记功能。

插件在普通指针选文字时替代 Zotero 自带划选弹窗，避免两个菜单覆盖。关闭划选查词、选区过长或没有选择词典时，仍可显示批注工具；只读文献的批注动作禁用。

需要原菜单时，在设置中把“划选菜单”改为“Zotero 自带菜单”。此模式暂停划选自动查词，普通单击查词继续可用。关闭整个插件功能、停用或卸载后恢复自带菜单。其他高亮工具和已有批注的菜单不由插件替代。

## 划选、词组与断行连字符

PDF 把 `transformation` 分成上一行 `transfor-` 和下一行 `mation` 时，拖选两部分后松开鼠标。插件优先读取 Zotero 的 PDF 选区与字形数据，也可读取文字层选区；查询过程不改变选区，批注只在点击批注动作时创建。

| 划选文字 | 尝试的本地词目 |
| --- | --- |
| `transfor-` 换行 `mation` | `transfor-mation`、`transformation` |
| `pre-softmax` | `pre-softmax`、`presoftmax` |
| `neural network` | `neural network` |
| `state-of-the-art transfor-` 换行 `mation` | 保留全部连字符、只拼接断行处、去掉词内连字符，共至多三种写法 |

所有候选都会查询；弹窗显示各自命中情况和对应词目，相同词条合并。字形中被阅读器忽略的软连字符也作为备选处理。普通词组空格保留，不会把 `neural network` 拼成一个词。点击包含词内连字符的单词也查询两种写法。

最多查询 256 字符、16 个词，超出范围只显示批注工具。词组需要当前 MDX 收录完整词目或跳转项；这是本地词典释义查询，没有接入整句机器翻译。跨行单词需划选完整两部分，普通单击不跨行扩展。扫描 PDF 仍需要 OCR 文字层。

增加、删除或替换词典及资源后，点击“刷新词典列表”。MDX 扫描当前层；资源可位于子目录，词典文件保留在所选目录。若同时使用其他点击查词扩展，可在其中一个扩展中关闭重叠的触发方式。

## 通用资源和分卷

以下目录结构用于说明自动关联规则，文件名与目录可自行设置：

```text
Dictionaries/
  DictionaryA.mdx
  DictionaryA.mdd
  DictionaryA.1.mdd
  DictionaryA.2.mdd
  DictionaryA.10.mdd
  DictionaryB.mdx
  DictionaryB.mdd
  style.css
  images/icon.png
  fonts/dictionary.woff2
```

- 自动关联同名 `.mdd` 与数字编号 `.N.mdd`，按数字排序，不固定分卷数量，允许缺号。
- 名字不同或在其他目录的 MDD，通过“添加 MDD 文件 / 分卷”手动多选。可以重复添加。
- 外置资源在其他目录时，通过“选择外置资源文件夹”指定。
- 手动设置按当前 MDX 分别保存。“恢复自动关联”清除当前词典的手动资源设置。
- 查找顺序：指定外置目录 → MDX 同目录 → 自动 MDD → 手动 MDD。先找到的资源优先。
- 按词条引用读取资源，支持子目录、斜杠/反斜杠、根标记、大小写差异与百分号编码。CSS 内相对引用按该 CSS 的目录解析。
- 支持内嵌 CSS、引用 CSS、`@import`、背景图片与字体的 `url(...)`。不会把目录中所有 CSS 混合应用。

资源索引和内容按块读取，并使用有界缓存。MDD 资源按引用提取，适用于自选目录中的不同词典和分卷。

## 范围与限制

| 项目 | 当前实现 |
| --- | --- |
| MDX/MDD | 1.x、2.x；raw、zlib、LZO；2.x 的 `Encrypted=2` 索引混淆 |
| 编码 | UTF-8、UTF-16、GBK 等浏览器支持的编码；MDD 名称按 UTF-16LE 读取 |
| 查询 | 大小写配置、`@@@LINK` 跳转、重复词目与跨记录块内容 |
| 原有排版 | 保留类名、ID、自定义标签与 CSS，放入独立受限显示区域 |
| 图片/字体 | 外置文件与任意已关联 MDD 分卷；解码由 Zotero 显示引擎完成 |
| 发音 | 本地 `sound://` 及 audio 资源；内置标准 Ogg/SPX 的 Speex → WAV 解码 |

MP3、WAV、Ogg 等已接入播放流程，具体可解码性取决于 Zotero/系统。**SPX/Speex 解码器已随插件内置**：从本地文件或 MDD 读取标准 Ogg/Speex，离线转换成内存中的 WAV 再播放，不需要 ffmpeg、Python 或另装解码程序。支持窄带、宽带、超宽带、单/双声道及每包多帧；私有裸流、损坏文件和不兼容位流仍会给出具体提示。本版尚未在 Zotero 中实测播放。

SPX 输入限额 8 MB，整个文件的累计音频最长 30 秒（包括连接的多个逻辑流），解码后 PCM 总量最多 16 MB，WASM 内存上限 16 MB。同一弹窗内重复播放复用转换结果，关闭弹窗后取消待处理解码并撤销音频 URL。技术说明见 [SPX/Speex 音频](SPEEX_AUDIO.md)。

词典 JavaScript、远程资源和外部翻译接口不运行或加载，因此依赖脚本的切换、统计、折叠等功能可能缺失。发音链接和词条跳转由插件处理，对脚本隐藏的发音链接图片提供通用可见性适配。

暂不支持 MDX/MDD 3、密码解密、StyleSheet 反引号宏和词形自动还原。词典自身的变形/跳转词目仍可查到。

单个数据块最大 128 MB、词条 16 MB、显示 HTML 4 MB、资源 64 MB。每个弹窗最多 256 个生成资源、累计 96 MB；CSS 单文件 4 MB、累计 12 MB、导入深度 12。当前 MDX 的词目索引保存在内存；MDD 的索引和记录块分别采用有上限的缓存。大词典首次索引或跨多个分卷查找资源可能需要等待。

原有排版无法准备或创建时回退到文字排版。底部出现“部分资源未能读取”时，鼠标停在提示上可查看缺失文件名，再添加相应资源包或目录。通用读取不意味着所有第三方私有格式和脚本均已兼容。

## 下载与发布

从 [GitHub Releases](https://github.com/Noahxie83/zotero-local-mdx-click/releases) 下载 `.xpi` 安装包、源码 ZIP 和校验和。词典需另行准备，可在 [PDAWiki · MDict 专区](https://www.pdawiki.com/forum/forum.php?gid=7) 搜索，并按作者授权获取文件。安装后选择词典目录即可使用。

各历史版本保留对应安装包、源码快照与说明，当前稳定版为 1.1.2。最新文档与示例源码位于仓库 `main` 分支，版本资产对应其发布时的快照。各版详情见 [版本变更](CHANGES.md)。公开 HTML 演示使用项目自制词典，支持下载后离线打开。

## 开发

需要 Node.js；插件运行时不需要 Node.js 或 Python。

```powershell
npm ci --ignore-scripts
npm test
npm run build
npm run pack:source
```

`npm test` 包含 MDX/MDD、LZO、资源、CSS、Speex、划选和批注适配回归用例。Zotero 持久化验证脚本只在另建的隔离配置中运行；准备方式和覆盖范围见 [1.1.2 审查整改](REVIEW_FIXES_1.1.2.md)。

- `src/mdx.js`：公共容器、解压、MDX 查询与 MDD 二进制资源读取。
- `src/resources.js`：通用分卷发现、文件夹路径与资源定位。
- `src/native-render.js`：原有 CSS、过滤后的 DOM、显示隔离、播放和资源 URL 清理。
- `src/render.js` / `src/appearance.js`：弹窗与可选文字排版。
- `src/main.js`：Zotero 生命周期、词典/资源选择与配置保存。
- `src/word-at-point.js`：PDF 点击位置取词。
- `src/selection-query.js`：PDF 划选、字形恢复和有界连字符候选生成。
- `src/selection-menu.js`：划选弹窗替代、8 色选择和 Zotero 高亮/下划线保存。
- `src/speex.js` / `src/vendor/speex/`：Ogg 分包、Speex WASM 解码、源码和许可。
- `scripts/build.mjs` / `scripts/package-source.mjs`：安装包和源码打包。
- `scripts/build-speex.mjs`：可选重新编译解码器，普通构建使用随源码提供的 WASM。
- `scripts/native-preview.mjs`：从自行指定的 MDX 生成原有排版预览，无音频，不是测试程序。
- `scripts/preview.mjs`：从导出的 HTML 生成文字排版预览。

原有排版预览用法：

```powershell
node scripts/native-preview.mjs network "path/to/dictionaries/DictionaryA.mdx"
```

GPL-3.0-or-later；第三方许可见 `THIRD_PARTY.md` 和安装包中的 `licenses/`。

## 版本与验证

1.1.2 已完成 33 项自动化回归，以及 Zotero 10.0.3 隔离环境中的批注保存、重开、只读、分屏和菜单恢复验证。具体修复、覆盖范围与未验证项见 [验证记录](REVIEW_FIXES_1.1.2.md)。

各版本的功能演进见 [完整变更清单](CHANGES.md)，历史验证与发布记录见 [发布说明](../RELEASE_NOTES.md)。历史验证记录对应其当时版本，当前兼容范围以本指南和 1.1.2 验证记录为准。
