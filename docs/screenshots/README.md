# 界面截图

这套图对应仓库当前提交（`main`），分四组：

- **设计稿视图（01–07）**：无头 Chrome 加载真实页面 + 注入 mock 数据桥，用于稳定展示「有内容时」的界面。
- **真实运行视图（08–11）**：使用独立空数据目录启动 Electron，通过 DevTools 协议截取主窗口，不读取个人剪贴板历史。
- **面板与工具箱视图（12–15、21–22）**：无头 Chrome 加载真实 `quickpanel` 页面，960×660 DIP、2× 输出；展示动作、应用、工具箱、OCR、翻译和深色面板。接口数据为 fixture，键位与工具箱来自生产模型。
- **浮引岛视图（17–18）**：无头 Chrome 加载真实 `island` 页面（176×44 / 520×148 两种窗口尺寸）；16 是覆盖层回归截图。

各图组共用同一份 `src/` 代码与样式，差别只在数据与渲染器（Chrome vs Electron）。

## 设计稿视图

| 图 | 对应页面 |
|---|---|
| [01-task-shelf.png](01-task-shelf.png) | 任务匣：左侧任务列表，右侧当前任务的混合内容，顶部处理轨迹条（`接住内容 → 提取文字 → 合并换行 → 复制`） |
| [02-content-library.png](02-content-library.png) | 内容库：类型筛选、搜索，图片卡片下方挂「1 个处理结果 · 识别文字」 |
| [03-process-trail.png](03-process-trail.png) | 处理轨迹：总动作数 / 成功 / 失败统计，失败行标出原因 |
| [04-settings.png](04-settings.png) | 设置：剪贴板记录、保留策略、OCR 语言、快捷键、加密开关 |
| [05-quick-panel.png](05-quick-panel.png) | 随手面板：当前内容 + 建议动作 + 「放回原处」目标窗口 |
| [06-quick-panel-pinyin.png](06-quick-panel-pinyin.png) | 随手面板搜索态：输入 `rwx` 命中「任务匣」（拼音首字母） |
| [07-capture-overlay.png](07-capture-overlay.png) | 截图覆盖层：`800 × 330` 选区、放大镜、底部标注工具栏 |

## 真实运行视图

| 图 | 说明 |
|---|---|
| [08-live-task-shelf.png](08-live-task-shelf.png) | 真实主窗口 · 任务匣（首次启动，空数据状态） |
| [09-live-content-library.png](09-live-content-library.png) | 真实主窗口 · 内容库（空状态文案） |
| [10-live-process-trail.png](10-live-process-trail.png) | 真实主窗口 · 处理轨迹 |
| [11-live-settings.png](11-live-settings.png) | 真实主窗口 · 设置（独立实例的默认配置） |

## 面板与工具箱视图

| 图 | 说明 |
|---|---|
| [12-panel-actions.png](12-panel-actions.png) | 1160×620 宽幅动作面板：38 键、72×56 键帽、并排上下文栏，原生窗口无外围矩形底板 |
| [13-panel-apps.png](13-panel-apps.png) | 应用面板：空格切换后的开始菜单应用网格 |
| [14-panel-toolbox.png](14-panel-toolbox.png) | 工具箱：13 项，未实现工具标注「尚未实现」 |
| [15-panel-ocr-result.png](15-panel-ocr-result.png) | 面板内 OCR 结果：可编辑文字 + 查看原图 / 合并换行 / 加入任务匣 / 复制文字 |
| [21-panel-translate.png](21-panel-translate.png) | 面板内翻译结果：原文 / 译文对照 + 目标语言重翻 + 复制译文 |
| [22-panel-actions-dark.png](22-panel-actions-dark.png) | 加宽面板深色主题：共享光影与组件令牌 |

## 浮引岛与回归截图

| 图 | 说明 |
|---|---|
| [16-overlay-original.png](16-overlay-original.png) | 截图覆盖层「查看原图」回归截图（`npm run test:overlay` 自动更新） |
| [17-island-collapsed.png](17-island-collapsed.png) | 历史兼容胶囊形态，当前默认隐藏且不响应普通悬停 |
| [18-island-expanded.png](18-island-expanded.png) | 手动打开/拖入后展开：4 张文件卡片、图片缩略图、偏好、撤销与清空 |
| [19-clipboardbar.png](19-clipboardbar.png) | 底部剪贴板历史条（1180×196）：图片缩略图、文字摘要、文件条目 |
| [20-clipboardbar-selected.png](20-clipboardbar-selected.png) | 底部剪贴板条选中态：高亮卡片 + 底部选中项信息 |

## 键位绑定与拖动

| 图 | 说明 |
|---|---|
| [23-panel-binding-menu.png](23-panel-binding-menu.png) | 贴合键位的分类绑定菜单 |
| [24-panel-binding-tools.png](24-panel-binding-tools.png) | 内置工具子页，显示工具当前绑定键 |
| [25-panel-key-drag.png](25-panel-key-drag.png) | 左键拖动时的空位提示与目标高亮 |
| [26-panel-binding-menu-dark.png](26-panel-binding-menu-dark.png) | 绑定菜单深色主题 |

上述截图由 `node tools/panel-shot.js` 使用独立示例数据生成。`npm run test:bindings` 验证模型与真实鼠标 / 键盘交互；`npm run verify:bindings` 使用独立 Electron 数据目录验证 preload、IPC、目标执行和进程重启后的落盘恢复。

## 生成截图

长截图见 [工具条](29-long-capture-hud.png) 与 [拼接结果](30-long-capture-result.png)，由 `npm run verify:long-capture` 使用隔离测试页面生成。

改图工作台见 [浅色预览](28-image-editor-light.png) 和 [深色预览](28-image-editor-dark.png)，由 `npm run verify:image-editor` 使用独立示例图片生成。

截图工具栏的单排图标样式见 [浅色预览](27-overlay-toolbar-light.png) 和 [深色预览](27-overlay-toolbar-dark.png)。由 `npm run test:overlay` 从纯测试画面生成，快捷键只在悬停或聚焦时提示。

```powershell
# 设计稿视图
node tools/shots.js        # 01–04
node tools/shots2.js       # 05–06
node tools/shots3.js       # 07

# 真实运行视图（自动启动独立空数据实例）
node tools/refresh-doc-screenshots.js # 08–11

# 面板 / 工具箱视图
node tools/panel-shot.js   # 12–15、21–22；同时验证交互与布局
npm run test:panel         # 同样的回归检查，不改截图

# 浮引岛视图：落在临时目录 %TEMP%\suira-island-shots\，需要时手动复制进本目录
node tools/island-check.js # 17–18（同时跑 93 项渲染断言）

# 底部剪贴板条视图：落在临时目录 %TEMP%\suira-clipboardbar-shots\
node tools/clipboardbar-check.js --preview # 19–20（93 项断言；预览使用示例缩略图，结果位于临时目录）
```

出图脚本依赖本机 Chrome 或 Edge，找不到时会直接报错退出。
