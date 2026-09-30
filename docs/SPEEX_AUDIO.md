# SPX/Speex 发音实现（1.1.2）

## 使用

只有一个 1.1 安装包，已包含 Speex 解码器。用户选择自己的 MDX 后，插件按原有资源规则从同目录、外置资源目录或已关联 MDD 分卷读取发音。点击原词条的发音图标即可使用；无需配置解码器路径，不需要 ffmpeg、Python、Node.js 或下载外部程序。

`.spx` 通常是 Ogg 容器中的 Speex 数据。读取到 `.spx` 或检测到 Ogg/Speex 头部后，插件将其离线转换为 16 位 PCM WAV，用 Zotero 的音频元素播放。其他音频格式保持原播放流程。文件读取或解码失败时显示具体原因；这类格式问题与 MDD 分卷是否过大无直接关系。

## 处理流程

1. 按资源路径读取原始字节，不批量解包 MDD。
2. 校验 Ogg 页、CRC、页序号和分段表，拼接跨页数据包。
3. 读取 Speex 头部的模式、采样率、声道、位流版本、每包帧数和附加头部。
4. 在插件上下文创建 WASM 实例，逐包解码，保留同一包内的位读取状态，处理多帧和双声道。
5. 按解码延迟及末尾采样位置裁剪，输出内存 WAV，创建 Blob URL 播放。
6. 同一弹窗复用转换结果；关闭时取消待处理解码、停止播放并撤销 URL。

词典 iframe 仍禁止运行词典脚本。WASM 不提供文件系统或网络接口，仅提供本地随机字节和不输出内容的标准 I/O 适配。

## 范围与限额

- 标准 Ogg/Speex，窄带、宽带、超宽带，单/双声道，每包 1–64 帧。
- 支持依次连接且采样率/声道相同的逻辑流；不支持交错的多个 Speex 音轨。
- 输入最大 8 MB，单包音频最大 64 KB，整个文件累计最长 30 秒（包括连续逻辑流），输出 PCM 累计最大 16 MB。
- WASM 初始内存 2 MB，上限 16 MB；结果仍受弹窗总资源限额约束。
- 私有裸 Speex、加密数据、损坏 Ogg、缺失结束页、版本不兼容等给出提示，不尝试猜测参数。

## 源码与重建

解码核心来自 Speex 1.2.1，使用固定源码快照：

https://github.com/caitunai/speex/tree/cbabf6e8213ad6eb2c984c2904996ad529536b1b/internal/csrc/speex

原 C 源码、项目编写的解码接口、预编译 WASM 和许可证在 `src/vendor/speex/`；JS 容器与 WAV 处理在 `src/speex.js`。使用实际 Speex 编解码库，不是 SpeexDSP 的预处理模块，也不使用第三方 npm 包的单帧包装器。

普通 `npm run build` 使用已提供的 WASM。需要修改解码核心时，单独安装 wasi-sdk 34.0，并执行：

```powershell
$env:WASI_CC = '自己安装的 wasi-sdk\bin\clang.exe'
node scripts/build-speex.mjs
npm run build
```

工具链版本、编译参数与完整来源说明见 `src/vendor/speex/NOTICE.md`。开发工具链不打入插件。XPI 附带第三方许可，源码 ZIP 同时包含 C 源码与 WASM；不包含用户词典或发音数据。

## 交付状态

1.1.2 自动化回归使用自制静音 Ogg 流，实际执行内置 WASM 解码并核对 WAV，覆盖窄带单声道、三种模式的双声道/每包三帧、短连续流、累计超时、CRC 损坏及取消。宽带/超宽带用例使用合法窄带 null 子模式和缺省扩展层，验证对应解码器初始化、输出采样率和帧长度；它们不代表全部实际音质模式和立体声参数位流均已测过。详见 [整改记录](REVIEW_FIXES_1.1.2.md)。尚未在 Zotero 中实测真实词典的发音播放，解码测试不等同于播放验收。

格式参考：[Speex Ogg 容器说明](https://www.speex.org/docs/manual/speex-manual/node8.html)、[Ogg framing](https://www.xiph.org/ogg/doc/framing.html)、[Speex 解码 API](https://www.speex.org/docs/manual/speex-manual/node7.html)。
