# 图标翻页与截图画质维护记录

检查日期：2026-10-24。下述时间为本机样本，不是所有电脑的性能保证。

## 本机问题与改动

### 图标

改动前，图标只在翻页后提取，整批完成才更新，内存缓存随进程退出丢失。首屏一次冷加载 2308ms，第二页 1244ms，内存命中 1ms。

现采用六项小批次、两个并发任务，优先当前页并预取相邻页；完成一批就原地更新图标，保持焦点和按钮节点。过期预取不继续排队，重叠请求按文件复用。成功图标写入原子更新的磁盘缓存：最多 512 项、24 小时有效期，快捷方式大小或修改时间变化即失效，损坏缓存按未命中处理。缓存键使用路径哈希，不保存路径明文。

本机结果：首次填充缓存时首屏 549ms、第二页 349ms；重启后读取对应页为 7ms / 16ms；预取完成后真实界面第二页 19ms，来回切换 1ms。测量包含不同的系统文件缓存状态，不能据此断言所有冷启动都按固定倍数加速。

### 截图

发现三个独立问题：

1. 当前 150% 屏幕的逻辑尺寸为 1707×1067；相乘再四舍五入得到 2561×1601，而实际显示模式为 2560×1600。缩略图采集按该尺寸处理，会引入整幅重采样。
2. 分数选区坐标直接交给 drawImage，源矩形与输出尺寸不一致时产生插值。
3. 内容库大图预览优先使用 320px 缩略图，原图再清楚也会在放大预览时发糊。

修复：Windows 使用独立的 DPI 感知 GDI 助手取得物理像素，输出无损 PNG；失败时保留 Electron 兼容路径。单屏保留实际物理尺寸；跨屏预览可统一合成，但落在单个显示器内的导出仍使用该屏原始像素。裁剪边界取整，源与目标一比一；同时修正高 DPI 标注变换顺序。原始 PNG 通过索引复用，避免在 IPC 里重复传输。

大图预览优先读取原文件，缩略图仅作失败回退并明确提示。「原始像素」模式按 naturalWidth / devicePixelRatio 设置 CSS 宽度，避免 150% 系统缩放再次放大位图。

实机测试：原生源图 2560×1600；分数选区输出 166×120，逐通道像素差为 0，1px 黑白条纹仍只有两种颜色。真实图片预览读取到 1134px 原文件，原始像素模式的物理显示宽度也为 1134px。测试没有向用户内容库添加测试图片、覆盖剪贴板或上传屏幕内容。

尚未完成的实机覆盖：HDR 色彩、受保护内容、旋转屏幕、混合 DPI 跨屏接缝。混合 DPI 的几何与原始分块保留已有自动化检查；不把这等同于所有设备验证通过。

## 开源比较与来源

均核对了当前仓库状态和 LICENSE；以下项目在检查时均未归档，最近推送分别为 2026-10-21、10-23、10-24。

| 项目 | 许可证与依赖 | 本轮取舍 |
| --- | --- | --- |
| [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher) | [MIT](https://github.com/Flow-Launcher/Flow.Launcher/blob/dev/LICENSE)；C# / WPF，当前 ImageCache 使用 BitFaster LFU，ImageLoader 包含预载与持久化使用记录 | 借鉴共享缓存、并发复用、后台预载、按来源回退。按 Electron 架构独立实现；未引入 WPF、BitFaster 或其源码。 |
| [ShareX](https://github.com/ShareX/ShareX) | [项目 LICENSE 为 GPLv3](https://github.com/ShareX/ShareX/blob/develop/LICENSE.txt)；当前 ScreenCaptureLib 使用 .NET 10 Windows、Avalonia 相关工程、SkiaSharp 和 Vortice.Direct3D11 | 研究原生物理矩形采集及 GDI / HDR 路径分离；未复制 GPL 源码或打包其依赖。本项目使用独立实现的 Windows API 助手。 |
| [eSearch](https://github.com/xushengfeng/eSearch) | [GPLv3](https://github.com/xushengfeng/eSearch/blob/master/LICENSE)；Electron / TypeScript，node-screenshots 原生模块等 | 同栈参考最直接；其加载代码也说明 Windows VC 运行库等部署成本。本轮不引入整个捕获、OCR 或编辑依赖栈。 |

实现位置参考：[Flow ImageLoader](https://github.com/Flow-Launcher/Flow.Launcher/blob/dev/Flow.Launcher.Infrastructure/Image/ImageLoader.cs)、[ImageCache](https://github.com/Flow-Launcher/Flow.Launcher/blob/dev/Flow.Launcher.Infrastructure/Image/ImageCache.cs)、[ShareX Screenshot](https://github.com/ShareX/ShareX/blob/develop/ShareX.ScreenCaptureLib/Screenshot.cs)、[eSearch screenShot](https://github.com/xushengfeng/eSearch/blob/master/src/renderer/screenShot/screenShot.ts)、[eSearch package.json](https://github.com/xushengfeng/eSearch/blob/master/package.json)。

## Issue / PR 判断

- [Flow #3635](https://github.com/Flow-Launcher/Flow.Launcher/issues/3635)：耗时图标加载的实际故障报告；不能让慢资源卡住整体初始化。
- [Flow PR #3641](https://github.com/Flow-Launcher/Flow.Launcher/pull/3641)：已合并，明确处理图标加载耗时并使用并发。合并提交 `a865a3b35d4b233b03db02aca325defd44af406f`。
- [Flow PR #2089](https://github.com/Flow-Launcher/Flow.Launcher/pull/2089)：已合并，修复缓存保存、读取与重复保存。合并提交 `b97b56742e478740b51a09dbe5ecc6d56baf0854`。
- [Flow PR #4453](https://github.com/Flow-Launcher/Flow.Launcher/pull/4453)：已合并，完善按类型的图像回退并涉及 ARM 上的 Shell 缩略图失败。合并提交 `7a7338676a257bbba0e48ccf974c3a73cbd84ebe`。
- [Flow PR #4695](https://github.com/Flow-Launcher/Flow.Launcher/pull/4695)：检查时仍开放。它指出占位图被 LFU 淘汰后会永久变空白的风险；这是有用的设计审查材料，不能当成已发布修复。本实现的首字母占位不依赖图标缓存。
- [eSearch #386](https://github.com/xushengfeng/eSearch/issues/386)：评论确认保存与钉图不糊、仅截图初始显示糊，说明必须分别验证采集、预览、导出，而非根据一张预览图推断 PNG 已损坏。
- [ShareX #5327](https://github.com/ShareX/ShareX/issues/5327)：报告缩放后 JPEG 质量回退；已关闭但带 Stale 标签，不视为经过验证的修复。本项目截图保持 PNG，没有通过拉高 JPEG 参数掩盖重采样或预览错误。

## 后续同类维护流程

先复现并记录尺寸、像素或耗时基线；筛选未归档且近期维护的仓库，核对具体 LICENSE 与新增依赖的部署成本；阅读相关 Issue、维护者讨论和 PR 实际合并状态。优先复用设计原则，新增实现遵循本项目栈；需要复用代码时另行核对具体文件许可与归属。最后用故障回归、真实设备与可重复测量验证，保留未覆盖条件，而非仅给出「已优化」。

验证入口：`test-app-icons.js`、`test-icon-disk-cache.js`、`test-native-capture.js`、`tools/overlay-check.js`、`tools/icon-speed-probe.js`、`tools/icon-page-benchmark.js`、`tools/capture-quality-live.js`、`tools/preview-quality-live.js`。
