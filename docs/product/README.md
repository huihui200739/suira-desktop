# 当前产品界面

这些图片由 `npm run screenshots` 从当前源码启动的真实 Electron 实例生成。使用独立临时数据目录、虚构文档和日程，不读取用户剪贴板，也不占用系统快捷键。

| 页面 | 截图 |
| --- | --- |
| 随手面板 | [浅色](panel.png) · [深色](panel-dark.png) |
| 应用启动台 | [窗口](apps.png) · [全屏展示](apps-fullscreen.png) |
| 应用搜索与绑定 | [搜索结果](app-search.png) · [键位应用选择](app-binding.png) |
| 工具箱 | [图标方块](toolbox.png) |
| 日历 | [月视图与待办](calendar.png) |
| Markdown | [编辑与实时预览](markdown.png) |
| 工作台 | [任务匣](workbench.png) |
| 剪贴板 | [柔光渐变与内容操作](clipboard.png) |

截图是渲染内容，不包含 Windows 桌面合成层。原生四角另外通过 `npm run test:surfaces` 验证：读取实际 HWND 的窗口区域，检查四角被排除、中心仍可见，并覆盖窗口缩放及最大化恢复。

应用名称与图标来自本机 Windows 开始菜单；文档、日程与剪贴板使用独立演示数据。全屏展示图为当前显示器大小的无边框启动台，不代表 macOS 的独立空间。

旧版本截图保留在 [`../screenshots/`](../screenshots/README.md) 供历史修复说明引用。
