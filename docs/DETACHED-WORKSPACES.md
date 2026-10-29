# 独立日历与 Markdown 窗口

工作台、面板和快捷键共用工具窗口入口：日历与 Markdown 分别保留一个独立窗口，可同时打开，重复调用会聚焦已有窗口。窗口控制只作用于发起操作的窗口，关闭工具不关闭工作台。Markdown 关闭前和退出应用前会等待正文保存；保存失败时保留窗口供重试。

## Markdown

- 本地自动保存、保存按钮与 Ctrl+S；打开本地文件、文档列表与搜索。
- 编辑、左右预览、纯预览三种模式，支持 Ctrl+1/2/3 切换。
- 标题、加粗、列表、待办、代码、引用、链接、表格、分割线工具；可点击的标题目录和双向同步滚动。
- Markdown、HTML、PDF 三种下载/导出。HTML 与 PDF 由独立的本地渲染页生成，清理不安全 HTML，导出文件不依赖远程脚本、网络字体或 CDN。
- 参考 [Vditor](https://github.com/Vanessa219/vditor) 的分屏预览方式和 [MarkText](https://github.com/marktext/marktext) 的 HTML/PDF 导出能力，扩展现有 Marked/DOMPurify 实现，没有迁入整个编辑器框架。

## 日历

- 月、周、日程列表视图，今天定位、前后切换。
- 日程标题、时间、备注、地点、工作/生活/学习分类和重要标记。
- 日程搜索、分类筛选、隐藏已完成；本月、今天待办、未来七天统计。
- 编辑、完成/重新打开、删除，以及 iCalendar `.ics` 导出。日期时间采用本地日历时间，全天事件使用 DATE。

## 界面与数据

两个窗口共用圆角、半透明表面、按钮和主题令牌；Windows 窗口使用 Acrylic 材质。内容仍由原有本地加密存储保存，旧文档与旧日程无需迁移，旧日程缺少分类时按“工作”显示。

## 检查

- `npm test` 完整回归及 `node test-workspace.js` 的日期、分类、优先级、ICS 和持久化检查。
- `node tools/electron-workspace-check.js` 用隔离数据验证两个独立窗口、三种预览模式、周/月/列表与搜索、真实 HTML/PDF/ICS 文件输出、关闭一个窗口保留另一个、关闭前保存最后输入。
- `node tools/portable-workspace-check.js <绝对路径EXE>` 从隔离用户目录启动桌面便携包，验证原生 Alt+G、Alt+F、Alt+M 以及包内 Markdown 预览。
