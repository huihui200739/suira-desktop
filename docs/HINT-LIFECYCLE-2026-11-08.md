# 提示与浮层生命周期修复 · 0.2.45

## 用户问题与确认根因

用户反馈点击工作台侧边栏按钮后，鼠标已移走，“收起侧边栏”提示仍停在画面，悬浮板也有同类残留。

原共享提示把 `document.activeElement === hintTarget` 当作保留依据；鼠标点击或菜单 pointerenter 自动 focus 后，按钮焦点不消失，pointerout 不关闭，甚至阻挡悬停其他控件的新提示。原校验只发生在延迟显示前，可见提示不会随目标隐藏、移除或属性失效清理。动态插入/更新的 title 未统一转换，导致原生提示与共享提示混用。

## 修复范围

- [共享提示](../src/ui-motion.js)：区分鼠标和键盘来源，鼠标点击/自动聚焦不生成永久焦点提示；快速掠过取消计时器。键盘 Tab/方向键可看提示，Escape 关闭不丢焦点。
- 鼠标离开控件/窗口、pointercancel、拖动、右键菜单、beforetoggle、滚动、窗口失焦/尺寸变化、页面隐藏或离开时清理。捕获监听可覆盖组件 stopPropagation 的场景。
- 等待和显示期间验证连接、可见性、hidden/inert/aria-hidden、禁用、data-hint、aria-expanded；目标移动或文案失效时关闭旧泡。侧栏 data-hint-when-expanded 例外保留。
- 动态 title（包括非按钮节点）统一转为共享 data-hint，状态变化同步说明。只添加/移除自身 aria-describedby token，不覆盖其他组件说明。
- [悬浮板](../src/quickpanel.js)重新准备显示时显式复位提示，弹窗打开时清掉背景提示。
- [下拉控件](../src/glass-select.js)：祖先隐藏、inert/aria-hidden、样式不可见时关闭挂在 body 的菜单，拒绝不可见控件重新打开，不把焦点还给隐藏控件。
- [下一步动作菜单](../src/action-strip.js)：同步关闭 manual popover，父菜单隐藏、失焦、页面隐藏、DOM 移除或 destroy 时复位；销毁解绑监听/观察器。

提示仅在等待或显示时启用有效性观察，不使用后台定时轮询；忽略键帽/玻璃光照 CSS 变量帧，保留原“指针在键帽内移动不重复读取布局”约束。

## 实际通过的验证

- `npm run test:hints`：[28 项提示状态机](../tests/test-hints.js)、[下拉生命周期](../tests/test-glass-select-lifecycle.js)、[动作菜单生命周期](../tests/test-action-strip-lifecycle.js)。普通合成 DOM，直接执行生产代码，不接触用户数据。
- `npm run verify:hints`：[43 项真实 Electron 指针/键盘验证](hints-0.2.45-verification.json)，覆盖用户报告路径、悬浮板自动 focus、A→B 悬停、短悬停、键盘/Escape、隐藏/禁用/替换/移除/移动、popover、动态 title、窗口重开、隐藏下拉与动作浮层、destroy。
- `npm run verify:workbench`：侧栏、状态记忆、窄窗口、延迟剪贴板原目标、文档/日历新建保存切换流程通过。
- `node tools/panel-shot.js --check`：面板交互、菜单、绑定/拖动、错误反馈、12 种主题/明暗组合、四组视口和键帽性能检查通过。首次运行发现提示观察器带来额外布局读取，修复后完整重跑通过，未放宽原性能断言。
- `node tools/notes-check.js`：速记静态和真实浏览器渲染 40/0，通过标题/输入/保存/钉住/列表/Escape/小窗/失败提示。
- `npm run test:workbench` 与 UI 接线检查：核心 45/0、动作 28/0、UI 143/0，相关文档/日历/清理回归通过；颜色令牌和主题 CSS 检查通过。
- 匹配语法检查、diff 检查与 Windows NSIS 安装包构建/源码字节核对后交付。

## 边界

这是提示和浮层生命周期的有界修复，不宣称整个产品无缺陷。完整项目测试集未运行；所有测试都使用独立数据，不读取实际剪贴板正文，不自动安装或重启用户应用。触屏/辅助技术/多屏 DPI 的全部组合尚未人工覆盖。安装器尚未代码签名。

0.2.45 已发布到[正式自动更新源](https://github.com/huihui200739/suira-updates/releases/tag/v0.2.45)。[匿名公开资产核对](release-public-0.2.45-verification.json)通过；[0.2.44 → 0.2.45 实际下载](updater-public-0.2.45-verification.json)达到 100%，SHA-512 匹配，0.2.45 自检为最新，未触发用户安装或重启。[安装包清单](release-0.2.45.json)。
