# 当前产品界面

这些图片由 `npm run screenshots` 从当前源码启动的真实 Electron 实例生成。使用独立临时数据目录、虚构文档和日程，不读取用户剪贴板，也不占用系统快捷键。

| 页面 | 截图 |
| --- | --- |
| 随手面板 | [浅色](panel.png) · [深色](panel-dark.png) · [全屏键位](keyboard-fullscreen.png) |
| 实际桌面透色验证 | [红色测试背景](panel-desktop-red.png) · [蓝色测试背景](panel-desktop-blue.png) |
| 复杂背景遮挡验证 | [模拟消息窗口](panel-desktop-busy-blue.png) |
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

2026-11-01 界面打磨：键位名称移至键面下方，快捷字母采用中性角标；Markdown 正文使用稳定实色面，大纲默认收起、可从顶栏展开；日历以今天圆环和选中浅底区分状态，右栏使用紧凑列表；剪贴板取消彩色背景渐变。透明度预设与原生圆角裁剪保持原有机制，未引入桌面实时模糊。

设计审查方法参考 Damir Sokolovsky 的 [unslop](https://github.com/heydamir/unslop)（CC BY 4.0），以用户提供的桌面工具截图为视觉方向。

应用名称与图标来自本机 Windows 开始菜单；文档、日程与剪贴板使用独立演示数据。全屏展示图为当前显示器大小的无边框启动台，不代表 macOS 的独立空间。

0.2.8 全屏采用七列五行、居中搜索胶囊和分页圆点。实际使用时读取 Windows 静态壁纸并模糊；动态壁纸使用系统提供的静态图。仓库演示图使用蓝色渐变，不读取或发布用户壁纸。工具玻璃方块缩小到约 96 像素。

0.2.12 键位布局也支持沉浸全屏，保持 38 键的排列并按照可用区域等比例放大，切换全屏不再改变当前布局。

旧版本截图保留在 [`../screenshots/`](../screenshots/README.md) 供历史修复说明引用。
