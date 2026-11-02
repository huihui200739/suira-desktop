# 当前产品界面

本轮更新的主面板、工具箱、Markdown、日历和剪贴板等图片为 0.2.20。除下述历史 0.2.19 材质图外，这些图片由 `npm run screenshots` 从源码启动的真实 Electron 实例生成。使用独立临时数据目录、虚构文档和日程，不读取用户剪贴板，也不占用系统快捷键。

2026-11-02 的 `panel-material*` 和 `toolbox-material` 图片使用真实 Chrome 渲染生产页面、样式和图标，IPC 为隔离演示数据；用于展示已确认的柔光键帽与全部工具物件。它们不包含 Windows 桌面合成层。安装版的图标、动效模块、原生模糊及外观切换另由独立配置实测通过。

| 页面 | 截图 |
| --- | --- |
| 随手面板 | [浅色](panel.png) · [深色](panel-dark.png) · [全屏键位](keyboard-fullscreen.png) |
| 0.2.19 柔光键帽与工具物件 | [浅色](panel-material.png) · [深色](panel-material-dark.png) · [工具箱](toolbox-material.png) |
| 历史原生桌面透色验证（0.2.17，非本轮重拍） | [红色测试背景](panel-desktop-red.png) · [蓝色测试背景](panel-desktop-blue.png) |
| 历史复杂背景遮挡验证 | [模拟消息窗口](panel-desktop-busy-blue.png) |
| 应用启动台 | [窗口](apps.png) · [全屏展示](apps-fullscreen.png) |
| 应用搜索与绑定 | [搜索结果](app-search.png) · [键位应用选择](app-binding.png) |
| 三点菜单 | [窗口菜单](panel-menu.png) · [全屏菜单](fullscreen-menu.png) |
| 全屏搜索 | [高对比文字与深色结果面板](app-search-fullscreen.png) |
| 工具箱 | [图标方块](toolbox.png) |
| 日历 | [月视图与待办](calendar.png) |
| Markdown | [编辑与实时预览](markdown.png) · [深色](markdown-dark.png) · [最近文档](markdown-home.png) |
| 工作台 | [任务匣](workbench.png) |
| 剪贴板 | [中性内容架与内容操作](clipboard.png) |

除 `panel-desktop-*` 外，截图是渲染内容，不包含 Windows 桌面合成层。桌面透色图通过受控背景和原生屏幕采集生成，不拍摄用户桌面；`npm run verify:composition` 同时对两种背景做像素差分。原生四角另外通过 `npm run test:surfaces` 验证：读取实际 HWND 的窗口区域，检查四角被排除、中心仍可见，并覆盖窗口缩放及最大化恢复。

0.2.20：五组彩色物件、即时轻抬和单次反光；跨页面入口与空状态统一，正文保持安静。动效量化与当前验证边界见 [本轮核对](../vivid-keycaps-0.2.20.md)。

2026-11-01 界面打磨：键位名称移至键面下方，快捷字母采用中性角标；Markdown 正文使用稳定实色面，大纲默认收起、可从顶栏展开；日历以今天圆环和选中浅底区分状态，右栏使用紧凑列表；剪贴板取消彩色背景渐变。0.2.17 在保持透明度预设和原生圆角裁剪的基础上接入真实桌面背景模糊。

设计审查方法参考 Damir Sokolovsky 的 [unslop](https://github.com/heydamir/unslop)（CC BY 4.0），以用户提供的桌面工具截图为视觉方向。

后续补齐顶栏可编辑文档标题、操作分组、最近文件路径、预览模式工具栏收起、按需展开日历备注和窄窗口适配。完整状态与原生模糊实验结果见 [逐项核对](../ui-polish-status.md)。

应用名称与图标来自本机 Windows 开始菜单；文档、日程与剪贴板使用独立演示数据。全屏展示图为当前显示器大小的无边框启动台，不代表 macOS 的独立空间。

0.2.8 全屏采用七列五行、居中搜索胶囊和分页圆点。实际使用时读取 Windows 静态壁纸并模糊；动态壁纸使用系统提供的静态图。仓库演示图使用蓝色渐变，不读取或发布用户壁纸。工具玻璃方块缩小到约 96 像素。

0.2.12 键位布局也支持沉浸全屏，保持 38 键的排列并按照可用区域等比例放大，切换全屏不再改变当前布局。

旧版本截图保留在 [`../screenshots/`](../screenshots/README.md) 供历史修复说明引用。

0.2.23：主面板图更新为实际安装版的分层键帽与像素伙伴。柔和/通透/深色对照见 panel-soft-0.2.22.png、panel-clear-0.2.22.png、panel-dark-0.2.22.png（材质在 0.2.23 未变）；最终伙伴可见性与交付记录见 [0.2.23 核对](../material-companion-0.2.23.md)。
