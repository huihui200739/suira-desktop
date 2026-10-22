# 界面截图

这套图对应仓库当前提交（`main`），分两组：

- **设计稿视图（01–07）**：无头 Chrome 加载真实页面 + 注入 mock 数据桥，用于稳定展示「有内容时」的界面。
- **真实运行视图（08–11）**：Electron 应用真实启动后，通过 DevTools 协议直接截取主窗口。

两张图组共用同一份 `src/` 代码与 `src/styles.css`，差别只在数据与渲染器（Chrome vs Electron）。

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
| [11-live-settings.png](11-live-settings.png) | 真实主窗口 · 设置（注意开关是蓝色实心「开」，与设计稿视图的灰色不同——设计稿里 mock 重新赋值了 settings 对象，属渲染脚本问题而非产品缺陷） |

## 复现

```powershell
# 设计稿视图
node tools/shots.js        # 01–04
node tools/shots2.js       # 05–06
node tools/shots3.js       # 07

# 真实运行视图（需先以调试端口启动应用）
#   electron . --remote-debugging-port=9223
node tools/cdp-shot.js     # 08–11
```

出图脚本依赖本机 Chrome 或 Edge，找不到时会直接报错退出。
