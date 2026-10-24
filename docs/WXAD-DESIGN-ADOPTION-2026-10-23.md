# 设计垂点文章筛选与随序落地记录

本轮研究的是文章中的设计方法、组件行为和实现取舍。浏览目录、正文及章节后逐项筛选了 28 篇可读取的站内文章，重点深入与当前桌面浮层、内容浏览和确认弹窗相关的内容。页面中的交互 Demo 未逐个实操，不能把阅读文章称为完成了所有 Demo 的体验。

目录中的旧《Web 流畅界面建议》链接 `https://wxad.design/making-fluid-interfaces/` 本次返回空正文，未将其视为已读；另参考了站内可读取的《制作流畅界面》。Figma 社区文件本次仍无法展开，已从 [Apple 官方设计资源](https://developer.apple.com/design/resources/) 核实其链接来源，未读取内部图层，也没有杜撰组件参数。

## 已落实到项目

| 文章方法 | 随序中的原问题 | 本轮实现 |
| --- | --- | --- |
| [AI 交互动画建议](https://wxad.design/abc/interactive-design-in-ai)：保持容器连续、不要用静态截图代替过程检查 | 剪贴板内容变更先清空轨道，再重建全部卡片 | 按 ID 复用卡片；后台请求期间保留内容、焦点和滚动锚点；插入新记录也保持正在看的位置 |
| [制作流畅界面](https://wxad.design/abc/making-fluid-interfaces)：实时响应、过渡可被打断 | 把所有更新当作首次加载；切换状态缺少连续感 | 先更新选中状态，再过渡背景；快速连续点选可以直接转向最新目标，不锁交互、不排队 |
| [跳跃](https://wxad.design/abc/springen)：一组控件共用背景、表达同一组关系 | 分类、导航各画一块孤立的选中底色 | 内容库分类、主导航和底部剪贴板复用共享选中层；首次定位不从原点飞入，宽度变化和换行重新测量 |
| [发芽](https://wxad.design/abc/spross)：弹层与触发来源有关，考虑有限空间 | 确认弹窗依赖延迟抢焦点；Tab 可以离开弹层 | 从触发位置计算缩放原点；立即聚焦输入；Tab/Shift+Tab 限制在弹窗；Esc 关闭并恢复来源焦点；高弹窗内部滚动 |
| [AD UI 复盘](https://wxad.design/abc/adui)：键盘访问是组件的一部分 | 确认框和预览层只覆盖了部分鼠标路径 | 确认框和内容预览使用同一焦点生命周期；背景暂时 inert；支持减少动态效果、高对比与减少透明效果的样式回退 |
| [发芽](https://wxad.design/abc/spross) / [Functional Motion](https://wxad.design/abc/functional-motion)：反馈要明确且有分寸 | 重复提示没有合并，错误提示阅读时间偏短 | 主窗口与动作面板共用通知逻辑；相同提示合并次数；错误保留更久；提供状态播报。后台刷新失败保留旧内容并显示真实重试入口 |
| [SVG Liquid Glass](https://wxad.design/abc/svg-liquid-glass)：区分折射、色散、高光及实现边界 | 玻璃容易退化成整块透明底或无目的的循环扫光 | 搜索框、工具按钮使用随指针局部移动的边缘高光；停止操作后不运行持续动画；桌面模糊仍由原生 acrylic 提供 |
| [用户界面的品质](https://wxad.design/abc/quality-of-ui)：围绕体验打磨并贯彻到组件 | 同一交互在不同浮层各写一份 | 共享 `ui-motion.js` / `ui-motion.css`，保留现有原生 JS 技术栈，未为使用某个效果而迁移到 React 或加入整套动画框架 |

上述为依据文章方法做出的本项目适配，不是直接拷贝作者组件。没有将完整 SVG 折射滤镜套到整个桌面窗口；页面滤镜不能把 Windows acrylic 直接变成 macOS 的原生 Liquid Glass。

## 全目录取舍

| 文章 | 本轮选择 |
| --- | --- |
| [使用 AI 制作交互动画的建议](https://wxad.design/abc/interactive-design-in-ai) | 采用同一容器、明确输入、连续操作和逐帧检查方法；高频输入不加等待动画 |
| [小 p：一次关于 AI 的交互实验](https://wxad.design/abc/small-p) | 保留“协作对象与上下文可见”的思路，AI 指针、共创画笔和桌面助手暂不加入现有工具 |
| [制作有趣的界面：朋友圈广告年度评选 2025](https://wxad.design/abc/making-fun-interfaces) | 参考操作与确认的节奏；投票、碰撞和结果仪式不适合本轮高频工具操作 |
| [Figma Make 的使用建议与更多 AI 的思考](https://wxad.design/abc/figma-make) | 采用规范、资产、源码和验证一起维护的方法；不迁移生产项目到 Figma Make |
| [让我们继续“跳跃”](https://wxad.design/abc/springen2) | 沿用共享状态的连续性；验证码、头像和图表没有当前需求 |
| [玩一点微广 11 周年的 Demo](https://wxad.design/abc/wxad11) | 不引入转盘、声音和庆典效果；输入内容不增加装饰性的等待时间 |
| [使用 SVG 模拟 Apple Liquid Glass](https://wxad.design/abc/svg-liquid-glass) | 采用局部边缘高光；完整折射/色散另作性能与背景采样验证后再考虑 |
| [用户界面的品质](https://wxad.design/abc/quality-of-ui) | 采用体验、打磨、完整状态的检查方式；本轮修复刷新、错误与键盘路径 |
| [一类叫作“发芽”的 UI 组件](https://wxad.design/abc/spross) | 采用弹窗来源与有限空间处理、同类反馈合并；复杂 Popover 碰撞定位留给真实组件需求 |
| [一类叫作“跳跃”的 UI 动效](https://wxad.design/abc/springen) | 采用共享选中背景；不机械地为所有文字增加双层遮罩 |
| [制作流畅界面](https://wxad.design/abc/making-fluid-interfaces) | 采用及时反馈、可打断与符合产品场景的动效；保留原生滚动 |
| [做 UI 的开发](https://wxad.design/abc/deng) | 工作方法参考，不转换为用户可见的新功能 |
| [关于 Drawer 组件的发散](https://wxad.design/abc/drawer) | 借鉴临时确认与内容浏览的层级区别；未为简单设置新增多层抽屉 |
| [关于 shadcn/ui 的思考与启发](https://wxad.design/abc/shadcn) | 采用源码可控、按需选型；当前纯 JS 项目不照搬其 React 依赖链 |
| [如何依靠 transform 模拟 iOS 原生滚动体验](https://wxad.design/abc/scroll-mock) | 不替换 Windows 原生滚动与触控板行为；无移动端橡皮筋模拟需求 |
| [交互动画的层级设计](https://wxad.design/abc/designing-depth) | 采用前景可操作、背景暂时不可操作的层级区分；不叠加炫技视差 |
| [回顾：制作朋友圈广告年度评选](https://wxad.design/abc/bm) | 参考编排和反馈节奏；评委卡、投票与宣传性入场不采用 |
| [回顾：制作微信广告官网](https://wxad.design/abc/wxad) | 采用流体布局、完整状态和真实走查的思路；不搬宣传页 Banner 和长转场 |
| [回顾：制作微信广告设计语言 AD UI](https://wxad.design/abc/adui) | 采用键盘访问、统一动效与源码维护方式；未引入全套企业后台组件库 |
| [画出完美的文字圆形环绕 UI](https://wxad.design/abc/circular-text) | 当前无环形文字需求，保留可测量的字体与 ResizeObserver 思路 |
| [用 motion/react 实现优雅的 conic-gradient 旋转动画](https://wxad.design/abc/conic-gradient) | 不让常驻工具循环旋转；本轮高光只响应实际指针输入 |
| [Functional Motion](https://wxad.design/abc/functional-motion) | 采用状态明确、分寸适度、同类反馈归并；未引入多层通知堆叠系统 |
| [我的 CSS 生成艺术世界](https://wxad.design/abc/generative) | 艺术探索参考；粒子与生成背景不进入剪贴板正文区域 |
| [制作点赞与投票动画](https://wxad.design/abc/likes) | 当前无点赞投票场景，不把庆典动效加到复制等高频动作上 |
| [用 react-spring 设计有“惯性”的交互动画](https://wxad.design/abc/trail) | 参考连续运动与细调参数；现有控件用可重定向的轻量 CSS 过渡即可 |
| [转盘交互动画：以关键参数，细化我们的感受](https://wxad.design/abc/carousel) | 采用以参数和实际过程判断感受的方法；不增加轮盘式内容浏览 |
| [2023：面对自我的提问与面对自我的回答](https://wxad.design/abc/2023) | 设计工程思考参考，不转为功能需求 |
| [我们认真地想了想 font-family](https://wxad.design/abc/font-family) | 维持 Windows 系统 UI 字体和中文回退；不为模仿 macOS 外观换用平台不自带的字体 |

## 验证

- `npm test` 全量通过。
- 剪贴板渲染与交互：107 项通过，新增在途刷新不闪空、复用同一节点、保持焦点、保持滚动锚点、刷新失败保留旧内容、恢复、共享指示层、快速连续切换、重复反馈合并和减少动态效果检查。慢刷新期间更改选择、重开时输入搜索词，都以用户的最新操作为准；减少动态效果也会关闭键盘平滑滚动。
- 确认弹窗：17 项通过，新增进入焦点、正向/反向 Tab 循环、Esc 关闭和来源焦点恢复。
- 动作面板：浅/深色与四组尺寸回归通过，保持 38 个键位完整可达。
- 当前真实 Electron 实例已验证共享选中层只有一个，连续快速切换最终停在最后选择；按 `requestAnimationFrame` 采样验证了过渡位置变化。采样不是帧率基准，不据此宣称固定 FPS。
- 顶部暂存的真实隐藏、普通悬停/文字拖动不唤起、文件拖入唤起和拖离隐藏复查通过。
- 未对用户历史执行复制、收藏、删除或测试数据注入；内容变更测试使用独立 fixture。
