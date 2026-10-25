# 第三批差距表：周边入口与扩展工具

日期：2026-10-22。对应《浮引复刻-差距与改版方案》第三批：
「逐项实现文件中转、边缘入口、自定义唤起、右键、长截图、录屏、速记、翻译等。
各项**先观察原产品完整行为**，再写差距和验收，不自行删去模块，也不以占位界面宣称完成。」

> 2026-10-25 当前状态补充：长截图已交付 Windows 单屏选区内的手动滚动拼接、固定栏处理、失败暂停和改图预览，见[实现、用法与验证边界](LONG-CAPTURE-AND-CURRENT-PASTE-2026-10-25.md)。下文实施顺序与“0”记录是历史分析，不代表本次增量状态。区域录屏此前已按产品决策移除。

## 这份表解决什么问题

> 2026-10-23 后续补充：文件中转已改为隐藏式接收、多显示器工作区跟随、真实路径校验，
> 并支持本次运行最近 10 次撤销移除/清空。官网对照、剩余差距与验证边界见
> [隐藏式文件中转记录](ISLAND-HIDDEN-AND-GAPS-2026-10-23.md)；下文早期 MVP 尺寸与悬停说明为历史记录。

方案要求「先观察原产品完整行为」。当前开发环境**没有浮引可运行**（macOS 应用，
参考图路径 `/Users/huihui/...` 在本机不存在），因此不能靠操作观察来写规格。

替代证据来自仓库内保存的浮引 6.0.1（216）arm64 切片分析产物：

```
Suira-Windows-Docs/Suira-Windows-Docs/research/function-analysis/
  fuyin-arm64.macho        原始切片（36 MB，SHA-256 994fea71…1307）
  objc-methods.json        618 个类 / 1766 个 OC 方法（otool -ov 解析）
  otool-objc.txt           原始输出，可独立核验
  rea-function-evidence-bundle.json  函数级证据包（41 MB）
```

复现命令：`node tools/fuyin-modules.js [模块id]`

**证据边界（必须遵守）**：

1. 类与方法存在 ≠ 行为已还原。Swift 类多走直接派发，`otool` 看不到其方法，
   这类类只能拿到「类存在 + 实例字段名 + vtable 槽位数」。
2. 字段名可提出职责假设，不证明算法已恢复。下文凡标「推测」的均为假设。
3. 原产品运行在 macOS，依赖 ScreenCaptureKit / Vision / NSPanel / QuickLook 等系统能力。
   Windows 侧要**独立实现**，不能把「仿照原版」当作验收。
4. 本表不声称任何模块已复刻完成。

## 证据强度汇总

| 模块 | 命中类 | OC 方法 | 实例字段 | vtable 槽 | 证据强度 | 当前实现量 |
|---|---|---|---|---|---|---|
| 文件中转（浮引岛） | 12 | 40 | 104 | 10 | 强：类 + 拖放/QuickLook 方法 + 状态字段 | **MVP** |
| 边缘入口 | 11 | 10 | 92 | 10 | 中：类 + orb/pull 字段齐全，行为在 Swift 侧 | **0** |
| 右键入口 | 2 | 18 | 2 | 0 | 强但**范围需纠正**，见下 | **钉图已交付，键帽右键未完成** |
| 长截图 | 10 | 27 | 92 | 12 | 强：算法参数直接可见 | **手动滚动拼接已交付，范围见顶部补充** |
| 录屏 | 32 | 54 | 237 | 24 | 强：完整会话/倒计时/摄像头/音频链 | **区域录屏已交付；摄像头、麦克风混音等未完成** |
| 速记 | 8 | 38 | 25 | 4 | 中：窗口控制器方法全，编辑逻辑在 Swift | **纯文本已交付** |
| 翻译 | 24 | 52 | 168 | 17 | 中：分实时翻译与图片取词翻译两支 | **B 支已交付** |
| 自定义唤起 | 6 | 10 | 175 | 5 | 强：录制器有 save/restoreDefault/clearShortcut | **增量已实现** |

> **本轮进度（2026-10-24）**：第三批按「建议的实施顺序」推进，已交付前四项的可运行实现
> （自定义唤起增量、文件中转 MVP、图片取词翻译 B 支、**速记纯文本版**），都不是占位界面。
> 2026-10-24 追加交付：区域录屏（倒计时、暂停/继续、系统声音、WebM 保存）及钉图右键菜单。
> 边缘入口的独立面板、键帽右键、长截图以及录屏中的摄像头/麦克风混音仍未完成。
> 下方保留早期技术分析；本轮实测边界见 [统一浮层与录屏记录](UNIFIED-SURFACES-AND-RECORDING-2026-10-24.md)。

## 本轮已实现（第三批前三项）

### 自定义唤起增量

- **按住型唤起**：新增 `lib/key-watch.js` + `assets/key-watch.ps1`。Electron 的
  `globalShortcut` 只给按下事件，这里用常驻 PowerShell 助手轮询 `GetAsyncKeyState`
  拿到按下/松开边沿；按住显示面板、松手收起。默认 `Ctrl+Alt+Shift+Space`，
  设置页可改键、清除绑定、恢复默认；启动失败会回滚并在设置页显示原因。
- **面板布局轮换**：默认 `Ctrl+Alt+Q`，在 动作 / 应用 / 工具箱 之间轮换
  （对应原产品 `onPanelCycleLayout`）；面板未显示时先显示再定位。
- **钉图显隐**：默认 `Ctrl+Alt+H`，有可见钉图就全部隐藏，再按一次恢复
  （对应 `onPinnedImageVisibilityShortcut`）；没有钉图时明确提示。
- **验收方式**：`node test-key-watch.js`（含真实 PowerShell `-SelfTest` 集成用例）、
  `node test-security.js`、`node tools/electron-verify.js`。

### 文件中转（浮引岛）MVP

- **浮层形态**：屏幕顶部居中；收起 176×44，悬停展开 520×148，失焦或点外部收起。
  出现时用 `showInactive`，不抢当前输入焦点。
- **拖入**：资源管理器拖文件到岛；路径经 `webUtils.getPathForFile` 取得后落 `store.island`。
  路径大小写不敏感去重、上限 24 条、超出丢最旧。
- **拖出**：`webContents.startDrag` 走原生拖放，可直接拖回资源管理器。
- **卡片操作**：打开（`shell.openPath`）、在资源管理器中显示、移除、清空；
  拖入策略（复制/移动）可切换并持久化。文件本体不复制，只保存引用。
- **入口**：工具箱「浮引岛」一行，显示/收起；不占主窗口页面，也不替代任务匣。
- **明确未做**：iCloud/云同步、卡槽编号、跨显示器跟随、拖出后的真实移动落盘、
  QuickLook 式多页预览。这些要按「先观察原产品再写验收」继续做，不在此宣称完成。

### 图片取词翻译（翻译 B 支，第三批第 3 项）

- **入口**：面板 `T` 键 / 工具箱「翻译」/ 内容库条目的「翻译」动作，三条入口共用
  `text.translate` 一个动作，不存在第二套逻辑。
- **链路**：有文字就翻文字；没有文字就翻最近一张截图 —— 先走离线 OCR 取词，
  识别结果单独落一条内容，译文挂在这条内容下（`meta.originItemId` 指回图片），
  处理轨迹里能看出「译文来自哪张图、取词取到了什么」。
- **结果面板**：原文 / 译文对照，可改目标语言重翻（不重新取词）、复制译文、加入任务匣；
  图片来源保留「查看原图」，纯文字来源不显示这个按钮（没图可看就不给假入口）。
- **引擎可插拔**（`lib/translate.js`）：`none` / OpenAI 兼容 `/chat/completions`
  （DeepSeek、通义、Ollama 等）/ DeepL / 微软翻译。默认 `none`，
  **未配置时返回「去设置里配置」的可读原因，绝不产出假译文**。
- **安全**：密钥用数据密钥 AES-256-GCM 加密后落盘（`translateApiKeyEnc`），
  渲染层只能看到 `translateApiKeySet` 布尔值；错误文案不回显请求头。
- **长文本**：按段落 → 句子 → 硬切三级边界分块（单块 ≤4500 字符），顺序翻译再拼回，
  不会把代理对切成两半。
- **验收**：`node test-translate.js`（32 项：语言码、语种粗判、分块、三家引擎的
  请求构造与回包解析、错误说明、注入 fetch 的完整链路、密钥不落明文）+
  `node test-panel-flows.js` 的 3 条翻译链路断言。
- **明确未做**：A 支实时语音翻译（麦克风授权 + 流式识别 + 边译边出）；
在已打开图片上框选局部取词。这两项需要单独的音频链路与图像交互，不做占位。

### 速记（纯文本，第三批第 4 项）

- **入口**：面板 `N` 键 / 工具箱「速记」/ 托盘「速记（接着上一条写）」，三条入口共用
  `panel:run('note')` 一条链路，不存在第二套逻辑。
- **接着写，不是每次新建**：打开最近编辑的一条；一条都没有时才新建。
  每次新建会留下一堆空笔记，那不是「顺手」，是制造垃圾。
- **多页 = 多窗口**：一条笔记一个窗口（对应原产品 `pageID` / `controllers`）。
  窗口内「全部速记」浮层可切到任意一条。
- **桌面钉住**：`pinned` 为真时窗口置顶（对应 `FuYinQuickNoteDesktopPinController` 的
  桌面钉住语义），不是另开一套渲染。
- **位置记忆**：`bounds` 随笔记落盘，恢复时走 `sanitizeWindowBounds`
  （对应原产品 `framePersistenceTask` / `pendingFrames`）；副屏被拔掉会回落到可见位置。
- **不做富文本**：正文编辑逻辑未还原（原产品在 Swift 侧），Markdown 另有
  `MarkdownPanelController` 22 个类，属于另一个量级，不做半成品。
- **落盘**：正文与标题跟内容一样加密（`notes[]` 走同一个编解码器），
  磁盘上不出现明文；输入防抖 700ms，关窗前补一次同步保存。
- **验收**：`node test-notes.js`（26 项：标题推导、容量收敛、位置校验、加密落盘、
  重启恢复、脏数据清洗）+ `node tools/notes-check.js`（40 项真实 DOM）+
  `node tools/electron-notes-check.js`（16 项真实 Electron 链路）。

## 逐项差距

### 1. 文件中转（浮引岛）— 证据最强，建议第一个做

**原产品形态（静态证据）**：

| 类 | 证据 |
|---|---|
| `FloatingIslandController` | 37 个实例字段：`visualModel` `store` `panel` `dropReceiverPanel` `isPresentationSuppressed` `currentScreen` `pointerPollingToken` `keyMonitor` `outsideClickLocalMonitor` `outsideClickGlobalMonitor` `hoverExpandTask` `pointerExitedAt` `lastPointerTickAt` |
| `FloatingIslandDropReceiverView` | 12 个 OC 方法：`draggingEntered:` `draggingUpdated:` `draggingExited:` `prepareForDragOperation:` `performDragOperation:` `mouseDown:` `acceptsFirstMouse:` |
| `FloatingIslandDragSource` | `draggingSession:sourceOperationMaskForDraggingContext:` `draggingSession:endedAtPoint:operation:` |
| `FloatingIslandQuickLookDataSource` | `numberOfPreviewItemsInPreviewPanel:` `previewPanel:previewItemAtIndex:` |
| `FloatingIslandStore` / `FloatingIslandPersistenceWriter` | 33 + 1 字段；对应 `shelf-state.json` 持久化 |
| `FloatingIslandScopedResource` | 4 字段，推测为拖出后的资源生命周期 |

**可以确定的交互**（方法签名直接支撑）：
- 接收拖放：enter / update / exit / prepare / perform 五段完整
- 拖出：作为 drag source，结束后按 operation 处理（移动或复制）
- 预览：QuickLook 面板，可翻页
- 悬停展开：`hoverExpandTask` + `pointerExitedAt` + `lastPointerTickAt` 表明按指针停留时间触发
- 点击外部收起：local + global 两套监听（对应 macOS 的窗口内/全局）
- 持久化：独立 store + writer，状态落 `shelf-state.json`

**Windows 落点**：
- 拖放用 HTML5 DnD 或 OLE 拖放；Electron 内用 `webContents` 的 drag 事件
- 顶部悬浮窗：`alwaysOnTop` + 无边框 + 可拖出
- 悬停展开用 `pointerenter` 计时 + `pointerleave` 取消
- 持久化复用现有 `lib/store.js` 模式，新增 `shelfState` 段

**验收场景**：拖文件到岛 → 岛展开 → 点开预览 → 拖出到资源管理器保留 → 重启后仍在 → 点外部收起

**风险**：跨进程拖放（从资源管理器拖入、拖出到资源管理器）在 Electron 里是弱项，
需要实测；`shelf-state.json` 的字段结构未还原，只能自定义。

---

### 2. 长截图 — 算法参数有据，但风险最高

**原产品形态（静态证据）**：

`ScreenshotLongCaptureController` 的 65 个字段里，直接暴露了算法参数：

| 字段 | 含义（推测） |
|---|---|
| `captureFrame` / `selectionFrame` | 采集帧与选区帧 |
| `axis` | 滚动轴（纵向/横向） |
| `maxPixelHeight` | 像素高度上限 |
| `minimumCaptureInterval` | 两次采集最小间隔 |
| `settledCaptureDelay` | 等待画面稳定后再采的延迟 |
| `minimumCaptureWidthRatio` | 最小宽度比，用于判定采集是否有效 |
| `captureWidthRetryDelayNanoseconds` | 宽度不符时的重试延迟 |
| `scrollMonitorGlobal` / `scrollMonitorLocal` | 滚动事件监听 |
| `initialExcludedWindowIDs` | 初始排除的窗口（把自己界面排除） |
| `includesOwnAppInterface` | 是否包含自身界面 |

另有 7 个窗口类：`BackdropPanel` / `BackdropView` / `HUDButton` / `HUDPanel` /
`SelectionPanel` / `SelectionView` / `PreviewPanel` / `AutoButtonPanel`。

**这说明原产品不是「周期性滚轮 + 拼图」**：它靠 `settledCaptureDelay` 等画面稳定后
再采，用 `minimumCaptureWidthRatio` 校验采集有效性，宽度不符就延迟重试。
方案第 169 行明确要求「长截图需要单独攻克固定页眉、重复区域、滚动容器与虚拟列表；
不能仅靠周期性滚轮和拼图就宣称通用支持」——这里的字段正好印证该要求。

**Windows 落点**：需要先做技术验证（滚轮注入 + 稳定检测 + 图像拼接），
在验证通过前**不应对外宣称支持**。

**验收场景**：普通网页、固定页眉页面、虚拟列表页面各一张；失败要如实提示而非产出错图

**风险**：最高。参数的具体数值未还原，需要自己测量；Electron 下滚动注入与采集
时序是难点。**建议放在录屏之后**。

---

### 3. 录屏 — 证据最全，但 Windows 侧依赖系统能力

**原产品形态（静态证据）**：32 个类，链条完整：

| 环节 | 类 |
|---|---|
| 选区 | `ScreenRecordingSelectionSession`（87 字段）、`SelectionWindowController`、`SelectionCoordinator` |
| 覆盖层/工具栏 | `ScreenRecordingOverlayWindow`、`ScreenRecordingToolbarWindow` |
| 倒计时 | `ScreenRecordingStartCountdownController`、`StartCountdownPanel`、`StartCountdownModel`、`StartCountdownPreferenceStore` |
| 摄像头 | `CameraPreviewController`、`CameraPreviewWindow`、`CameraPreviewView`、`CameraInteractionView`（14 OC 方法） |
| 音频 | `ScreenRecordingMixedAudioWriterContext`、`SilentRecordingPreferenceStore` |
| 焦点/提示 | `ScreenRecordingFocusAccess` `FocusRenderer` `FocusFeedback` `CursorHaloController` `KeyboardHintController` `KeyboardHintModel` |
| 输出 | `ScreenRecordingCaptureService`、`OutputDirectoryPreferenceStore`、`MenuBarIndicatorPreferenceStore` |

偏好项独立成 store：静音录制、倒计时、输出目录、参考线、菜单栏指示器——
说明这些都是用户可配置项。

**Windows 落点**：Electron 可用 `desktopCapturer` + `MediaRecorder`，
但**选区外框、光标高亮、键盘提示、摄像头画中画**都要自己做；
音频混流（系统声 + 麦克风）在 Electron 里受限，需实测。
录制本身属高复杂度，建议先做「选区 + 录制 + 保存」最小闭环。

**风险**：中高。系统声音采集在 Windows 上需要额外处理。

---

### 4. 自定义唤起 — 现有代码已有基础，做增量即可

**原产品形态（静态证据）**：

`KeyboardShortcutRecorderController` 有 9 个 OC 方法，含 `save` / `restoreDefault` /
`clearShortcut` / `cancel`，配套 `KeyboardShortcutRecorderPanel`。

`KeyboardMonitorService`（114 字段）暴露了大量回调字段名，说明唤起不止一个快捷键：

```
onActivationShortcut / onMomentaryActivationShortcut / onMomentaryActivationShortcutEnded
onOperationShortcut / onPanelShortcutKey / onMomentaryPanelShortcutKey
onPanelEscape / onPanelCycleLayout / onPanelPresentationToggle / onPanelShortcutSettingsKey
onTransientEscape / onScreenshotCompletionPreviewEscape
onPriorityKeyDown / onPriorityFlagsChanged / onPriorityShortcut
onPinnedImageVisibilityShortcut / onTrackpadPinchPanelEvent / onTrackpadSpreadDismissRequested
onPanelOpenTargetPreparationRequested
```

关键发现：存在 **momentary（按住）** 与普通（切换）两套语义，
以及 **panelCycleLayout**（面板布局轮换）、**pinnedImageVisibilityShortcut**（钉图显隐）。

**Windows 落点**：现有 `lib/shortcuts.js` 已有校验、冲突检测、改键回滚。
缺口是：按住型唤起、面板布局轮换、钉图显隐快捷键。

**验收场景**：改键后立即生效；冲突给原因；恢复默认；清除绑定；按住型唤起松手即收

**风险**：低。这是投入产出比最高的一项。

---

### 5. 速记 — 窗口行为清楚，编辑逻辑未还原

**原产品形态（静态证据）**：

`FuYinNotesPanelController` 15 个 OC 方法覆盖完整窗口生命周期：
`windowShouldClose:` `windowWillMiniaturize:` `windowDidDeminiaturize:` `windowDidMove:`
`windowDidResize:` `windowDidEndLiveResize:` `windowWillEnterFullScreen:` /
`windowDidEnterFullScreen:` / `windowWillExitFullScreen:` / `windowDidExitFullScreen:`

`FuYinNotesPanel` 有 `canBecomeKeyWindow` `cancelOperation:` `performKeyEquivalent:` `keyDown:`。

字段揭示的能力：
- 多页：`_pinnedPageIDs`、`pageID`、`controllers`
- 桌面钉住：`FuYinQuickNoteDesktopPinController`、`FuYinQuickNotePinnedPageWindowController`、`FuYinQuickNotePinnedPagePanel`
- 全屏协调：`fullScreenCoordinator`、`isWindowFullScreen`、`isPendingHideAfterExitingFullScreen`
- 位置记忆：`framePersistenceTask`、`pendingFrames`、`pendingFrameFlushWorkItem`、`didRestorePinnedPages`
- 空间切换：`spaceChangeObserver`（macOS 多桌面）
- 快捷键：`FuYinQuickNoteShortcutStore`

**未还原**：正文编辑、富文本格式、Markdown 处理（另有独立 `MarkdownPanelController` 22 个类）。

**Windows 落点**：多页笔记 + 桌面钉住 + 位置记忆。文本编辑用 `contenteditable`，
存储复用 `lib/store.js`。

**风险**：中。如果只做纯文本速记，风险低；富文本/Markdown 是另一个量级。

---

### 6. 翻译 — 两个不同功能，不要混为一个

**原产品形态（静态证据）**：24 个类，实为两支：

**A. 实时翻译（语音）**：`LiveTranslationAudioEngine`（15 字段，含 `microphone` `hasMicrophoneTap`
`stream` `output` `analyzer` `input`）、`LiveTranslationAudioInput`、`LiveTranslationStreamOutput`、
`LiveTranslationFinishGate`、`LiveTranslationHistoryStore`、`LiveTranslationHotKeyService`、
`LiveTranslationIslandPanelController`、`LiveTranslationIslandGeometry`、`LiveTranslationShortcutStore`。

字段 `onPreparation` `onAuthorizationWillBegin` `onAuthorizationDidEnd` 表明有麦克风授权流程。

**B. 图片取词翻译**：`ImageTextRecognitionSnippetTranslationViewModel`
—— 截图 OCR 后翻译选中片段，与现有 OCR 能力直接衔接。

**Windows 落点**：
- B 支（图片取词翻译）**投入产出比高**：复用现有 OCR，接一个翻译引擎即可
- A 支（实时语音翻译）需要音频采集 + 流式识别 + 翻译，复杂度高，建议延后

**注意**：原产品用系统翻译能力，Windows 需要自己选引擎。方案 P1 提到
「用户自带模型 API 的翻译/润色」，可沿用该思路：内置不可用时让用户配 API。

**风险**：B 低；A 高。

---

### 7. 边缘入口 — 类齐全，行为细节不足

**原产品形态（静态证据）**：11 个类

| 类 | 字段/方法 |
|---|---|
| `FullScreenEdgeActivationController` | 5 OC 方法：`closeForCurrentRun:` `closePermanently:` `toggleLaunchAtLogin:` `init`；字段 `_isTemporarilyPaused` `onExecuteAction` `orbControllers` `edgePullControllers` `suspendedTargets` `activeTarget` `activeEdgeSlot` `claimedEdgeContactSlot` |
| `ScreenEdgePointerFrameDriver` | `handleTimer:`（定时驱动指针位置检测） |
| `ScreenEdgePullController` | 22 字段 |
| `FullScreenEdgeOrbController` | 23 字段 |
| `FullScreenEdgeOrbGuideController` | 7 字段 |
| `ScreenEdgeEntranceRuntimeState` / `ScreenEdgeDisplayEnvironmentStore` | 状态与环境 |

**可以确定**：屏幕边缘存在两类交互——**pull（拉出）** 与 **orb（球）**，
都由定时器驱动指针位置检测；`claimedEdgeContactSlot` / `activeEdgeSlot` 表明有「槽位」概念，
即不同边缘位置触发不同动作；`toggleLaunchAtLogin` 说明支持开机自启。

**未还原**：具体触发阈值、手势判定、orb 的外观与动作列表。

**Windows 落点**：Electron 下需要 `screen.getCursorScreenPoint()` 轮询（类似
`ScreenEdgePointerFrameDriver` 的 timer），或全局鼠标钩子。

**风险**：中高。轮询有功耗代价；边缘手势与 Windows 自身手势（如贴边分屏）可能冲突。

---

### 8. 右键入口 — 范围需纠正

**这是本表最重要的纠正。**

方案文档第 36 行写「浮引岛/球/触点/右键…分别建立可验证的交互规格，
不以任务匣替代文件中转、边缘入口或系统右键」，容易被读成「Explorer 右键菜单」。

但切片里匹配 `RightClick` 的只有 2 个类，且都是**组件内部的右键交互**：

| 类 | 方法 | 字段 |
|---|---|---|
| `PinClipboardReceiverRightClickView` | `rightMouseDown:` `mouseDown:` `hitTest:` `acceptsFirstMouse:` 等 8 个 | `onRightClick` `onControlClick` |
| `ShortcutKeycapRightClickView` | `rightMouseDown:` `rightMouseUp:` `mouseUp:` 等 10 个 | 无 |

也就是说：原件里「右键」是**钉图窗口的剪贴板接收区**和**键帽**上的右键菜单，
**不是 Windows 资源管理器右键菜单**。

另外方案 P1 把「Explorer 新右键入口」列为首发稳定后的功能，且当前项目 README
也记着「Explorer 右键菜单：P1 范围，未实现」。

**结论**：这两件事要分开记录：
- 「键帽/钉图右键」属第三批（有证据，可做）
- 「Explorer 右键菜单」属 P1 扩展（无原件证据，需自行设计）

## 建议的实施顺序

按「证据强度 ÷ 风险」排序，且每项都必须做到完整闭环：

| 顺序 | 模块 | 理由 |
|---|---|---|
| 1 | 自定义唤起增量 | 现有代码已有基础，证据强，风险低 —— **已交付** |
| 2 | 文件中转（浮引岛） | 证据最强，是原产品核心入口之一 —— **已交付** |
| 3 | 图片取词翻译（翻译 B 支） | 复用现有 OCR，闭环短 —— **已交付** |
| 4 | 速记（纯文本） | 窗口行为清楚，先不做富文本 —— **已交付** |
| 5 | 键帽/钉图右键 | 范围小，证据明确 |
| 6 | 边缘入口 | 需先定触发阈值，建议先做技术验证 |
| 7 | 录屏 | 链条长，先做最小闭环 |
| 8 | 长截图 | 风险最高，必须独立技术验证后再做 |

**不建议并行铺开 8 项**：方案禁止「以占位界面宣称完成」，
铺开的结果会是 8 个占位壳。

## 需要补充观察的事项

以下细节静态证据不足以确定，如果后续能拿到原产品操作机会，应优先确认：

| 模块 | 待确认 |
|---|---|
| 文件中转 | 岛的显示位置（顶部居中？）、卡槽数量、拖出后保留还是移除、跨显示器行为 |
| 边缘入口 | 触发距离阈值、拉出 vs 球的分工、边缘位置能否自定义 |
| 长截图 | 各参数实际数值、支持的滚动容器范围、失败时的用户提示 |
| 录屏 | 音频默认是否含系统声、倒计时秒数默认值、输出格式 |
| 速记 | 是否支持富文本、多页的组织方式、钉住到桌面的具体形态 |
| 翻译 | 默认目标语言、是否保留原文对照 |

## 与现有代码的衔接

| 现有能力 | 可复用于 |
|---|---|
| `lib/store.js` | 浮引岛状态、速记正文（已落地 `notes[]`）、翻译历史 |
| `lib/actions.js` | 翻译动作、速记入匣 |
| `lib/ocr.js` | 图片取词翻译的取词环节 |
| `lib/shortcuts.js` | 自定义唤起增量 |
| `src/overlay.*` | 长截图/录屏的选区交互 |
| `main.js` 的 `createPinWindow` | 钉图右键 |
| `lib/keybindings.js` 的 `TOOLBOX_TOOLS` | 工具箱新增入口 |

## 边界声明

- 本表基于静态分析，**未运行原产品验证任何行为**
- 所有标「推测」的内容都是假设，不是结论
- 本表不声称任何第三批模块已完成复刻
- 参数数值（阈值、延迟、时长）均未还原，需在 Windows 侧实测确定
