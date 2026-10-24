# macOS 27 组件参考与本轮实现

本轮目标是调整随序的实际组件，而非套用 Figma 网站的页面样式。

## 参考来源

- 官方社区库：https://www.figma.com/community/file/1651309434229735362/macos-27
- 用户文件：https://www.figma.com/design/fdO6T9vWFuEW9QiLpvVrqw/Untitled
- 原始实例参考画板：https://www.figma.com/design/fdO6T9vWFuEW9QiLpvVrqw/Untitled?node-id=5-303

文件内 Page 1 原先没有画布节点，但已关联 macOS 27 库。通过 get_libraries 取得该库后，限定库范围检索成功。此前的空画布不能证明用户没有关联组件；应先检查关联库。

通过官方远程组件创建了五个原始实例作为参考，未重新绘制源组件：

| 组件 | 实例 ID | 原始尺寸 | 读取情况 |
| --- | --- | --- | --- |
| Button / Light / XL / Idle | 5:304 | 36 × 36 | 取得名称、变体和尺寸；完整上下文未取得 |
| Button / Dark / XL / Idle | 5:312 | 36 × 36 | 同上 |
| Search Field / Idle / Text=False | 5:320 | 120 × 24 | 取得设计上下文和预览 |
| Segmented Control / Light / XL | 5:332 | 145 × 36 | 取得设计上下文和预览 |
| Segmented Control / Dark / XL | 5:360 | 145 × 36 | 完整上下文未取得 |

后续 get_design_context、get_screenshot 与属性读取均返回 Starter MCP 额度耗尽。本轮未取得完整材质参数或可下载静态素材，不声称是整套组件的像素级移植。返回的 SearchField、BG 和 SegmentedControl 代码片段在本项目及依赖中没有对应实现；本项目继续使用现有 Electron / HTML / CSS / JavaScript。

## 实际落地

- 搜索框采用参考中的圆角输入轮廓，区分输入凹面与按钮浮面。
- 增加动作 / 应用分段控件：36px 容器、9px 选中背景圆角，选中状态立即响应并可连续打断。
- 工具箱按钮、工具项、动作键、底部返回条统一透光令牌与边缘高光。移除厚白键帽、凸出的快捷键徽标和实心彩色底。
- 默认宽度保持 1160 DIP，38 键固定布局。数字行降低视觉重量，动作图标保留辨识色，未实现动作保持淡轮廓。
- 剪贴板横栏统一搜索凹面、分类容器、卡片边缘和提交按钮，保留横向浏览与来源信息。
- 键位提示改为页面内的可访问组件，支持焦点、屏幕边界约束、失焦关闭，避免透明窗口上的系统提示白色矩形。
- 修复按钮聚焦后空格被全局快捷键截获的问题。
- Windows 原生材质继续使用 acrylic；不把 CSS 渐变称为 macOS 原生 Liquid Glass 或真实光学折射。

## 验证

面板渲染检查包含键盘激活、焦点提示、搜索和异步错误路径，以及浅色 / 深色 / 800×560 / 640×480 布局。剪贴板检查覆盖筛选、横向浏览、异步刷新和减少动态效果。运行实例另检验原生材质、工作区位置、实际窗口尺寸与顶部暂存的隐藏行为。
