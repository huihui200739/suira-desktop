# 随序 · SUIRA

> 你的 Windows 随手工作台。**顺手接住，让工作继续。**

Electron 实现的 Windows 桌面端样机。产品方向、交互结构与验收标准来自 `Suira-Windows-Docs/`，
本仓库是据此开发的**可运行实现**，不是概念稿。

---

## 快速开始

```powershell
npm install
npm start          # 启动应用
npm test           # 全量自动化测试（370 项）
```

> 打包：`npm run dist`（NSIS 安装包）或 `npm run dist:portable`（免安装单文件）。

---

## 三个核心流程

对应开发方案第 4 节的差异化结构，也是首要打磨的三条链路：

### 1. 截图 → 提字 → 清理换行 → 放进文档

`Ctrl+Alt+A` 唤起截图覆盖层 → 框选区域 → 工具栏点「提取文字」→ 离线 OCR 识别 →
结果面板可直接编辑 → 「加入任务匣」或「复制」。

识别结果作为**派生内容**保存，原始截图不被修改。

### 2. 多次复制 → 按顺序组合 → 一次粘贴

剪贴板历史自动记录文本、图片、文件引用与链接。在任务匣中按需要的顺序收集，
再整体复制或导出为 Markdown。

### 3. 多处收集 → 任务匣 → 处理或导出

任务匣把混合类型内容放在同一个任务里，并保留**派生关系**：
一张截图旁边能看到由它识别出的文字、整理后的文字。顶部的处理轨迹条显示
`接住内容 → 提取文字 → 合并换行 → 复制` 的当前进度。

---

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+Alt+Space` | 打开 / 收起随手面板 |
| `Ctrl+Shift+A` | 区域截图 |
| `Esc` | 关闭面板 / 取消截图 |

> `Alt+F` 作为历史兼容键也绑定了随手面板。

随手面板内：`Enter` 执行选中动作，`↑` `↓` 切换内容，`Tab` / `Shift+Tab` 切换动作，`Ctrl+A` 直接截图。

> 热键通过 `ShortcutManager` 注册，**有冲突检测**：注册失败会在设置页显示原因并支持改键，
> 改键失败自动回滚到原键位。

---

## 功能状态

### 已实现

- **随手面板**：搜索命令 / 应用 / 内容 / 任务，支持**中文、拼音全拼、拼音首字母**（`rwx` → 任务匣）；
  按内容类型给出相关动作；来源预览
- **剪贴板历史**：文本 / 图片 / 文件引用，去重、置顶、保留期、搜索
- **区域截图与标注**：**跨屏区域**（覆盖整个虚拟桌面，支持副屏在主屏左侧/上方）、
  混合 DPI，工具为矩形 / 箭头 / 画笔 / 文字 / 马赛克 / 序号，支持撤销、复制 / 保存 / 钉图
- **离线 OCR**：本地 `tesseract.js`，中英文，识别结果可编辑
- **文本处理**：合并换行、清理多余空格、纯文本
- **任务匣**：混合内容、来源标记、派生关系、批量复制、导出 Markdown
- **处理轨迹**：按步骤记录每次动作的输入输出与失败原因，失败可重试
- **配方（动作链）**：3 条内置模板，显式提交副作用，支持取消
- **钉图**：置顶窗口、缩放、透明度、临时收起（收成窄条后可点回）、悬停工具栏
- **内容库**：按类型筛选、搜索、复制、提取文字、钉图、入匣、**固定**（不被自动清理）、**清空剪贴板记录**（需输入确认词）
- **设置**：记录开关、保留策略、OCR 语言、敏感来源排除、数据目录、**改键**、**内容加密开关**
- **快捷键冲突检测**：注册失败会显示在设置页并给出原因；支持点击改键，
  改键失败自动回滚到原键位；避开 `Alt+Space` / `Win+V` / `Win+Shift+S` 等系统占用
- **内容加密**：正文与标题用 AES-256-GCM 加密落盘，数据密钥由 Windows DPAPI
  （CurrentUser 范围）保护，换用户或换机器无法解密
- **放回原处（完整链路）**：唤起面板前记录目标窗口（HWND / PID / 进程启动时间），
  提交前重新校验 → 复制 → 置前目标窗口 → `SendInput` 注入 `Ctrl+V`。
  任一步失败都降级为「已复制，切回目标后粘贴」，不假装成功
- **应用搜索**：扫描开始菜单快捷方式（当前用户 + 所有用户），支持拼音与首字母

### 未实现 / 受限

- **`SendInput` 的 UIPI 限制**：普通权限无法向以管理员运行的窗口注入输入
  （[官方说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)）。
  此时会如实提示「已复制，请手动粘贴」，不会静默失败。产品本身不以管理员常驻。
- **Explorer 右键菜单**：P1 范围，未实现。
- **SQLite**：使用 JSON 文件存储。加密与迁移已实现，但未换成 SQLite 事务。
- **加密搜索范围**：解密后在内存中搜索，不做索引；超出 200 条后搜索会变慢。
- **长截图 / 录屏**：P2 范围，未实现。

---

## 数据存储

```
%APPDATA%\随序\suira-data.json          内容、任务、执行记录、设置
%APPDATA%\随序\suira-data.key           DPAPI 保护的数据密钥（勿删，删后旧内容无法解密）
%APPDATA%\随序\captures\                截图 PNG
%APPDATA%\随序\clipboard-images\        剪贴板图片
```

`items[].text` / `items[].title` 在磁盘上是加密信封（`{__enc, iv, data, tag}`），
元数据（id、kind、时间、来源）保持明文以便列表与排序。
内存中始终为明文，因此搜索、派生关系、导出都不需要逐条解密。

单文件 JSON，版本号 `version: 1`。写入为整体序列化 + 原子 rename，非增量事务。

---

## 架构

```
main.js                    主进程：窗口、热键、托盘、截图、剪贴板、IPC
preload.js                 contextBridge 暴露 window.suira
lib/store.js               数据层：内容 / 任务 / 执行记录 / 设置
lib/actions.js             动作注册表：类型匹配、派生内容生成
lib/recipes.js             配方执行器：动作链、提交分离、取消
lib/search.js              搜索：拼音 / 首字母 / 打分排序
lib/clipboard-guard.js     剪贴板守卫：锁重试、敏感排除、超大内容
lib/return-target.js       放回校验：目标快照、提交前校验、回环账本
lib/app-index.js           应用索引：开始菜单扫描与缓存
lib/foreground-probe.js    前台窗口探测：常驻 PowerShell 助手客户端
lib/shortcuts.js           快捷键：校验、冲突检测、改键与回滚
lib/crypto-store.js        内容加密：AES-256-GCM + DPAPI 密钥保管
lib/display-geometry.js    虚拟桌面几何：多屏并集、缩放、分块布局
lib/input-injector.js      输入注入：PowerShell + SendInput 发送 Ctrl+V
assets/foreground-helper.ps1  只读 Win32 查询助手（GetForegroundWindow）
lib/ocr.js                 离线 OCR 封装
src/index.html + app.js    主窗口：任务匣 / 内容库 / 处理轨迹 / 设置
src/quickpanel.*           随手面板
src/overlay.*              截图覆盖层 + OCR 结果面板
```

### 动作协议

所有工具共用一套模型，新增功能不增加新入口：

```text
ContentItem = id + kind + payloadRef + source + createdAt + parentIds
Action      = stableId + acceptedTypes + outputType + executor + sideEffect
Execution   = jobId + inputIds + actionId + status + outputIds + error
Recipe      = id + version + accepts + steps[] + commit
```

关键约束：**动作产出新版本，绝不覆盖原始捕获**。`parentIds` 指回来源，
`meta.derivedBy` 标记由哪个动作生成。

---

## 测试

```powershell
npm test                   # 全部 370 项
npm run test:core          # 36 项：数据层、文本处理、保留策略
npm run test:actions       # 16 项：类型匹配、派生关系、失败路径
npm run test:capabilities  # 43 项：拼音搜索、配方执行、剪贴板守卫
npm run test:return        # 38 项：放回校验、目标失效回退、回环账本、应用索引
npm run test:foreground    # 18 项：前台窗口探测、超时、dispose 强制清理
npm run test:security      # 61 项：快捷键冲突、加解密、真实 DPAPI、加密落盘
npm run test:display       # 20 项：多屏并集、负坐标、混合 DPI、分块布局
npm run test:inject        # 20 项：SendInput 脚本、调用协议、失败处理
npm run test:ui            # 75 项：IPC 通道一致性、钉图、跨屏、HTML/JS 接线
npm run test:render        # 43 项：无头 Chrome 真实渲染断言
```

`test-render.js` 用无头 Chrome 加载真实页面，断言 DOM 结构与 canvas 像素值，
fixture 在运行时生成、结束后清理。

### 测试覆盖不到的部分

焦点跳转、输入法交互、多屏 DPI、真实截图与 OCR 精度**必须**在 Windows 真机上人工验证。
自动化测试无法替代这些检查。

---

## 已知限制

- 剪贴板监听为 550ms 轮询，非事件驱动（`WM_CLIPBOARDUPDATE` 需原生模块）
- OCR 首次识别需加载语言包，约 1–2 秒
- 主进程崩溃会丢失未落盘的会话状态
- 打包配置已包含 OCR 语言包，但尚未做签名与安装验证

---

## 许可

MIT
