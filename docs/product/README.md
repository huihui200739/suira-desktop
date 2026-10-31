# 当前产品界面

这些图片由 `npm run screenshots` 从当前源码启动的真实 Electron 实例生成。使用独立临时数据目录、虚构文档和日程，不读取用户剪贴板，也不占用系统快捷键。

| 页面 | 截图 |
| --- | --- |
| 随手面板 | [浅色](panel.png) · [深色](panel-dark.png) |
| 日历 | [月视图与待办](calendar.png) |
| Markdown | [编辑与实时预览](markdown.png) |
| 工作台 | [任务匣](workbench.png) |
| 剪贴板 | [柔光渐变与内容操作](clipboard.png) |

截图是渲染内容，不包含 Windows 桌面合成层。原生四角另外通过 `npm run test:surfaces` 验证：读取实际 HWND 的窗口区域，检查四角被排除、中心仍可见，并覆盖窗口缩放及最大化恢复。

旧版本截图保留在 [`../screenshots/`](../screenshots/README.md) 供历史修复说明引用。
