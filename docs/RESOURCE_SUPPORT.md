# 通用 MDX/MDD 资源读取设计（0.2.0）

词典名称、目录、CSS 名称、分卷数量与资源前缀均不写成模板。按用户选择的路径和词条实际引用读取资源。

## 容器

`MDictContainer` 处理公共头部、校验、压缩与记录块。`MDXDictionary` 返回文字，`MDDArchive` 强制按 UTF-16LE 解析资源名并返回原始字节，不使用去标点词目规则。

MDD 先读块元数据，查询时优先查头尾资源名范围中的关键词块。若未找到，再扫描剩余块，以兼容其他排序方式。索引与记录块都有缓存上限。重复偏移按下一更大偏移确定资源长度，内容允许跨记录块。

实现范围为 1.x/2.x、raw/zlib/LZO 和索引 `Encrypted=2`。3.x、密码解密和私有格式未承诺支持。

## 分卷与路径

`LocalResources` 接收文件系统适配器，无固定系统路径。匹配所选 MDX 的同名 `.mdd` 和 `.N.mdd`，按数字排序，允许缺号。其他名称/位置的分卷手动添加；资源目录与额外分卷按 MDX 保存。

依次查找指定外置目录、MDX 同目录、自动 MDD 和额外 MDD。文件夹逐层解析路径，支持子目录与大小写差异。定位缓存有容量限制，切换或刷新时清理。

统一斜杠、根标记、百分号编码和点路径，拒绝越过资源根、系统绝对路径、控制字符与外部 URL。MDD 只读，不批量解包。

## 排版与生命周期

parse5 读取 HTML，保留类名、ID、普通元数据和自定义标签，过滤脚本、事件属性、活动嵌入、表单及未处理 URL。HTML namespace 标签和 CSS 选择器对应转换。css-tree 解析 CSS 导入、URL 和导入条件，资源引用按所在 CSS 的目录解析。

iframe 使用 `sandbox="allow-same-origin"`，不提供脚本权限。先创建插件自己的空文档与严格 CSP，再由插件插入过滤后的新节点。词典 HTML 不直接替换 Zotero 文档，词典 CSS 只影响自己的 iframe。

每个弹窗独立管理 Blob URL；关闭时停止音频、移除观察器与 iframe 并撤销 URL。切换或退出还会清理资源缓存。原有排版失败提供文字回退。

`sound://` 与词条查询链接由插件处理。部分词典用脚本显示发音图片，通用规则只显示已有发音链接中的图片，不执行词典脚本。不附带 SPX/Speex 解码器；CSS 不能替代脚本计算。

## 交付状态

已完成本地构建，尚未完成 Zotero 运行验收。本次没有运行或新增测试。安装包和源码不含用户词典；本地预览位于源码目录外，可能包含词条与资源，不纳入发布包。

参考：[MDict 分析](https://github.com/csarron/mdict-analysis)、[格式说明](https://github.com/zhansliu/writemdict/blob/master/fileformat.md)、[js-mdict](https://github.com/terasum/js-mdict)、[css-tree](https://github.com/csstree/csstree)、[iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。
