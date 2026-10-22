# 随序 · SUIRA

> 你的 Windows 随手工作台。**顺手接住，让工作继续。**

Electron 实现的 Windows 桌面端样机。产品方向、交互结构与验收标准来自 `Suira-Windows-Docs/`，
本仓库是据此开发的**可运行实现**，不是概念稿。

---

## 快速开始

```powershell
npm install
npm start          # 启动应用
npm test           # 全量自动化测试（491 项）
```

> 打包：`npm run dist`（NSIS 安装包）或 `npm run dist:portable`（免安装单文件）。

> 启动遇到问题？先看 [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)。

---

## 界面

主入口是浮引式的 **38 键动作面板**；完整界面图见 [docs/screenshots/](docs/screenshots/README.md)。

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/12-panel-actions.png" alt="38 键动作面板"></td>
    <td width="50%"><img src="docs/screenshots/13-panel-apps.png" alt="应用面板"></td>
  </tr>
  <tr>
    <td align="center"><b>38 键动作面板</b>：固定键位、彩色图标、角标键帽，未绑定键显示「绑定」</td>
    <td align="center"><b>应用面板</b>：空格切换，开始菜单应用网格与搜索</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/14-panel-toolbox.png" alt="工具箱"></td>
    <td width="50%"><img src="docs/screenshots/05-quick-panel.png" alt="任务匣 / 内容库"></td>
  </tr>
  <tr>
    <td align="center"><b>工具箱</b>：集中入口，未完成工具明确标注「尚未实现」</td>
    <td align="center"><b>任务匣 / 内容库</b>：降为低频管理入口</td>
  </tr>
</table>

### 38 键面板的键位（对照本机浮引）

| 键 | 动作 | 状态 |
|---|---|---|
| `Z` | 截图（框选 + 标注） | 已实现 |
| `X` | 剪贴板（内容库） | 已实现 |
| `V` | 文本转换（合并换行 / 清理） | 已实现 |
| `B` | 标注（截图覆盖层） | 已实现 |
| `O` | 提取文字（离线 OCR） | 已实现 |
| `P` | 钉图文 | 已实现 |
| `D` | 回到桌面 | 已实现 |
| `L` | 锁屏 | 已实现 |
| `W` `S` `G` `T` `I` `F` `N` `M` | 壁纸 / 录屏 / 长截图 / 翻译 / 改图 / 日历 / 速记 / Markdown | 规划占位：键位保留，明确标注「未实现」 |
| 其余键 | — | 显示「绑定」，未绑定动作 |

键位与动作的映射集中在 `lib/keybindings.js`；鼠标点击与键盘直达走同一条 `panel:run` 通道。
空格在「动作面板 / 应用面板」之间切换，工具箱是独立入口。

---

## 三个核心流程

主入口为 38 键动作面板（`Ctrl+Alt+Space` 唤起）后的链路：

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
| `Ctrl+Alt+Space` | 打开 / 收起 38 键动作面板 |
| `Ctrl+Shift+A` | 区域截图 |
| `Esc` | 关闭面板 / 取消截图 |

> `Alt+F` 作为历史兼容键也绑定了面板。

面板内：`空格` 在动作面板 / 应用面板之间切换，`字母键` 直达对应动作，
`/` 或 `F3` 聚焦搜索，`↑` `↓` `Enter` 选择搜索结果，`Esc` 逐级返回。

> 热键通过 `ShortcutManager` 注册，**有冲突检测**：注册失败会在设置页显示原因并支持改键，
> 改键失败自动回滚到原键位。设置页还支持**恢复默认**（一键回到出厂键位）和
> **清除绑定**（解绑后不再响应，条目保留可重新绑定）——对应原产品
> `KeyboardShortcutRecorderController` 的 `restoreDefault` / `clearShortcut`。

### 按住型唤起

原产品把唤起分成两套语义：切换型（按一下开、再按一下收）和**按住型**（按住显示、松手收起）。
`MomentaryWatcher` 实现后者：Electron 的 `globalShortcut` 拿不到「松开」事件，
所以用「按下时开始，定时器发现超过间隔没有新按下就判定松手」来实现。
这个类只吃时间戳、不依赖 Electron，因此可完整测试。

---

## 功能状态

### 已实现

- **38 键动作面板**：固定键位布局（12 / 10 / 9 / 7，行间错位与物理键盘一致），
  8 个键位已接到真实能力，其余显示「绑定」或明确标注「未实现」；
  鼠标点击与键盘直达走同一条执行通道
- **按键链路跑到底（第二批）**：每个已实现键位都能「进入工具 → 完成操作 → 关闭或返回」，
  不是只做到图标可点：
  - `Z` / `B` 截图与标注 → 覆盖层框选 → 标注 → 完成 / 保存 / 钉图
  - `O` 提字 → 带意图进覆盖层，**框完自动识别** → 结果面板可编辑 → 复制 / 入匣 / **查看原图**
  - `P` 钉图 → 手上有图直接钉，没有图就截一张来钉
  - `X` 剪贴板 → 跳到内容库看历史
  - `V` 文本转换 → 真实生成整理结果并带用户去内容库查看
  - `D` / `L` 显示桌面 / 锁屏
  动作收尾语义显式化：`closePanel`（接管屏幕）、`openPage`（去结果页）、`ocr`（回填结果），
  逻辑在 `lib/panel-actions.js`，可被测试直接覆盖
- **应用面板**：空格切换，扫描开始菜单得到应用网格、图标缓存、分页与搜索；
  选中即启动，路径取自候选的 `appPath`
- **工具箱**：集中入口，未完成工具显示明确状态，不放空壳按钮
- **搜索**：命令 / 应用 / 内容 / 任务，支持**中文、拼音全拼、拼音首字母**（`rwx` → 任务匣）；
  命令区与 38 键面板区域分离，不再混成一列长列表
- **剪贴板历史**：文本 / 图片 / 文件引用，去重、置顶、保留期、搜索
- **区域截图与标注**：**跨屏区域**（覆盖整个虚拟桌面，支持副屏在主屏左侧/上方）、
  混合 DPI，工具为矩形 / 箭头 / 画笔 / 文字 / 马赛克 / 序号，支持撤销、复制 / 保存 / 钉图
- **离线 OCR**：本地 `tesseract.js`，中英文，识别结果可编辑，可**查看原图**
  （原图 = 框选区域未加标注的原始画面）
- **文本处理**：合并换行、清理多余空格、纯文本
- **任务匣**：混合内容、来源标记、派生关系、批量复制、导出 Markdown（已降为低频管理入口）
- **处理轨迹**：按步骤记录每次动作的输入输出与失败原因，失败可重试
- **配方（动作链）**：3 条内置模板，显式提交副作用，支持取消
- **钉图**：置顶窗口、缩放、透明度、临时收起（收成窄条后可点回）、悬停工具栏
- **内容库**：按类型筛选、搜索、复制、提取文字、钉图、入匣、**固定**（不被自动清理）、
  **清空剪贴板记录**（必须逐字输入确认词才允许提交）
- **设置**：记录开关、保留策略、OCR 语言、敏感来源排除、数据目录、**改键**、**内容加密开关**
- **快捷键冲突检测**：注册失败会显示在设置页并给出原因；支持点击改键，
  改键失败自动回滚到原键位；避开 `Alt+Space` / `Win+V` / `Win+Shift+S` 等系统占用
- **内容加密**：正文与标题用 AES-256-GCM 加密落盘，数据密钥由 Windows DPAPI
  （CurrentUser 范围）保护，换用户或换机器无法解密
- **放回原处（完整链路）**：唤起面板前记录目标窗口（HWND / PID / 进程启动时间），
  提交前重新校验 → 复制 → 置前目标窗口 → `SendInput` 注入 `Ctrl+V`。
  任一步失败都降级为「已复制，切回目标后粘贴」，不假装成功
- **回到桌面 / 锁屏**：`D` / `L` 键位调用系统能力，失败如实报错

### 未实现 / 受限

- **38 键面板中的规划键位**：壁纸、录屏、长截图、翻译、改图、日历、速记、Markdown
  保留键位但在面板上标注「未实现」，点击只给提示，不假装可用。
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
lib/keybindings.js         38 键面板的键位模型：布局、动作目录、绑定与可用状态
lib/panel-actions.js       面板动作执行层：按键语义与收尾，副作用走注入
src/index.html + app.js    主窗口：任务匣 / 内容库 / 处理轨迹 / 设置（低频管理）
src/quickpanel.*           38 键动作面板 + 应用面板 + 工具箱（主入口）
src/overlay.*              截图覆盖层 + OCR 结果面板
```

### 动作协议

所有工具共用一套模型，新增功能不增加新入口：

```text
ContentItem = id + kind + payloadRef + source + createdAt + parentIds
Action      = stableId + acceptedTypes + outputType + executor + sideEffect
Execution   = jobId + inputIds + actionId + status + outputIds + error
Recipe      = id + version + accepts + steps[] + commit
KeyBinding  = key + actionId（lib/keybindings.js 是唯一来源）
```

关键约束：**动作产出新版本，绝不覆盖原始捕获**。`parentIds` 指回来源，
`meta.derivedBy` 标记由哪个动作生成。38 键面板的每个按键通过 `panel:run`
执行；未实现动作在主进程与渲染层都被拦截，不会假装可用。

---

## 测试

```powershell
npm test                   # 全部 491 项
npm run test:core          # 36 项：数据层、文本处理、保留策略
npm run test:actions       # 16 项：类型匹配、派生关系、失败路径
npm run test:capabilities  # 43 项：拼音搜索、配方执行、剪贴板守卫
npm run test:keybindings   # 24 项：38 键布局、绑定模型、未实现动作不冒充可用
npm run test:flows         # 18 项：按键链路「进入工具 → 完成操作 → 关闭/返回」
npm run test:return        # 38 项：放回校验、目标失效回退、回环账本、应用索引
npm run test:foreground    # 18 项：前台窗口探测、超时、dispose 强制清理
npm run test:security      # 73 项：快捷键冲突、恢复默认/清除、按住型唤起、加解密、加密落盘
npm run test:display       # 20 项：多屏并集、负坐标、混合 DPI、分块布局
npm run test:inject        # 20 项：SendInput 脚本、调用协议、失败处理
npm run test:ui            # 109 项：IPC 通道一致性、键位接线、缺陷回归、钉图、跨屏、第三批差异表
npm run test:render        # 51 项：无头 Chrome 真实渲染断言（含面板模式切换）
npm run test:confirm       # 12 项：确认词校验（真实 DOM，错误输入不得通过）
npm run test:overlay       # 21 项：覆盖层 Ctrl+A 焦点隔离、查看原图、工具栏绑定
npm run test:shortcut      # 12 项：恢复默认/清除绑定的真实点击（真实 DOM）
npm run audit:batch3       # 从保存的浮引切片提取第三批各模块的静态证据
```

`test-render.js` 用无头 Chrome 加载真实页面，断言 DOM 结构与 canvas 像素值，
fixture 在运行时生成、结束后清理。面板截图可用 `node tools/panel-shot.js`
重新生成（无头 Chrome 渲染真实 quickpanel 页面）。

`tools/confirm-check.js` 与 `tools/overlay-check.js` 不走静态正则，而是用无头 Chrome
加载真实页面后**派发真实的键盘与指针事件**，断言行为：
确认框输错不许提交、文本框内 `Ctrl+A` 不改画布选区、查看原图渲染出选区尺寸的原始画面。
这类「能点但没反应」的缺陷只有真实交互才测得出来。

### 测试覆盖不到的部分

焦点跳转、输入法交互、多屏 DPI、真实截图与 OCR 精度**必须**在 Windows 真机上人工验证。
自动化测试无法替代这些检查。本机 Electron 无法创建 GUI 窗口（进程被系统中断），
因此**所有涉及真实窗口的验证都还没在真机上跑过**，见下方「未验证」。

---

## 已知限制

- 剪贴板监听为 550ms 轮询，非事件驱动（`WM_CLIPBOARDUPDATE` 需原生模块）
- OCR 首次识别需加载语言包，约 1–2 秒
- 主进程崩溃会丢失未落盘的会话状态
- 打包配置已包含 OCR 语言包，但尚未做签名与安装验证
- 数据目录不可写时没有降级方案，会直接退出（详见 [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)）

---

## 未验证（需要在真机上确认）

本机 Electron 无法创建 GUI 窗口，下面这些**只有代码与无头渲染层面的证据**，
尚未在真实 Windows 桌面会话里点过。请在真机上按顺序确认：

| # | 待确认 | 怎么看 |
|---|---|---|
| 1 | 面板按键真的触发主进程动作 | `Ctrl+Alt+Space` 打开面板，按 `Z`，应出现截图覆盖层 |
| 2 | `O` 提字框完自动识别 | 按 `O` → 框选 → 松开鼠标后应自动进入识别，无需再点「识」 |
| 3 | `P` 钉图 | 有图时按 `P` 应直接出现置顶钉图窗口；无图时应进入截图 |
| 4 | 「查看原图」 | 截图 OCR 结果面板点「查看原图」，应显示选区原始画面（不含标注） |
| 5 | 文本框内 `Ctrl+A` | 截图时选「文字」工具输入内容后按 `Ctrl+A`，应全选文字而不是选中全屏 |
| 6 | 确认词校验 | 内容库点「清空剪贴板记录」，输入错误内容时确认按钮应保持禁用 |
| 7 | `V` 文本转换结果可见 | 按 `V` 后应跳到内容库并看到新生成的整理结果 |
| 8 | 多屏 / 混合 DPI 截图 | 副屏在主屏左侧或上方时框选位置应准确 |
| 9 | 恢复默认 / 清除绑定 | 设置页点「清除绑定」后该快捷键应立刻失效；点「恢复默认」应回到 `Ctrl+Alt+Space` |
| 10 | 按住型唤起 | 目前只有状态机实现，尚未绑到全局热键（Electron 拿不到松手事件），需真机确认可行性 |

> 第 1–7 项的行为逻辑已由 `test-panel-flows.js`、`tools/confirm-check.js`、
> `tools/overlay-check.js` 用真实事件覆盖，但这些测试跑在无头 Chrome 里，
> **不是 Electron 窗口**。真机结论以实际操作为准。

---

## 第三批：周边入口与扩展工具

第三批的范围（文件中转、边缘入口、自定义唤起、右键、长截图、录屏、速记、翻译）
**尚未开始实现**。开工前先产出了差距表 [docs/BATCH3-GAP-ANALYSIS.md](docs/BATCH3-GAP-ANALYSIS.md)，
原因见该文：方案要求「先观察原产品完整行为再写验收」，但本机没有浮引可运行，
改用仓库内保存的浮引 6.0.1 arm64 切片的静态分析产物作为替代证据。

```powershell
npm run audit:batch3              # 查看全部模块的静态证据
node tools/fuyin-modules.js note  # 只看某个模块
```

可以从静态证据确认的范围：

| 模块 | 可确认 | 无法确认 |
|---|---|---|
| 文件中转 | 拖放五段、拖出、QuickLook 预览、悬停展开、点击外部收起、持久化 | 岛的位置与卡槽数量、`shelf-state.json` 字段 |
| 长截图 | 算法参数名（稳定延迟、最小采集间隔、宽度比校验、像素上限） | 参数数值、支持的滚动容器范围 |
| 录屏 | 选区/倒计时/摄像头/音频/光标高亮/键盘提示完整链条 | 音频混流细节、输出格式 |
| 自定义唤起 | 录制器方法、切换型与按住型两套语义 | 各快捷键默认值 |
| 速记 | 窗口生命周期完整、多页与桌面钉住 | 编辑与富文本能力 |
| 翻译 | 实时语音翻译与图片取词翻译是两支 | 默认语言、是否保留原文 |
| 边缘入口 | pull 与 orb 两类、定时器驱动指针检测、槽位概念 | 触发阈值、外观与动作列表 |
| 右键 | **原件指键帽与钉图窗口的右键，不是 Explorer 右键菜单** | — |

> 该差距表已写入 `test-ui.js` 的断言，防止证据文件丢失或范围被改动。
> 所有标「推测」的内容都是假设，不是已还原的结论。

---

## 许可

MIT
