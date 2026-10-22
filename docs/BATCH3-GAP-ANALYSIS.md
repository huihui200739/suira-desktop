# 第三批差距表：周边入口与扩展工具

日期：2026-10-22。对应《浮引复刻-差距与改版方案》第三批：
「逐项实现文件中转、边缘入口、自定义唤起、右键、长截图、录屏、速记、翻译等。
各项**先观察原产品完整行为**，再写差距和验收，不自行删去模块，也不以占位界面宣称完成。」

## 这份表解决什么问题

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
| 文件中转（浮引岛） | 12 | 40 | 104 | 10 | 强：类 + 拖放/QuickLook 方法 + 状态字段 | **0** |
| 边缘入口 | 11 | 10 | 92 | 10 | 中：类 + orb/pull 字段齐全，行为在 Swift 侧 | **0** |
| 右键入口 | 2 | 18 | 2 | 0 | 强但**范围需纠正**，见下 | **0** |
| 长截图 | 10 | 27 | 92 | 12 | 强：算法参数直接可见 | **0** |
| 录屏 | 32 | 54 | 237 | 24 | 强：完整会话/倒计时/摄像头/音频链 | **0** |
| 速记 | 8 | 38 | 25 | 4 | 中：窗口控制器方法全，编辑逻辑在 Swift | **0** |
| 翻译 | 24 | 52 | 168 | 17 | 中：分实时翻译与图片取词翻译两支 | **0** |
| 自定义唤起 | 6 | 10 | 175 | 5 | 强：录制器有 save/restoreDefault/clearShortcut | **0** |

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
| 1 | 自定义唤起增量 | 现有代码已有基础，证据强，风险低 |
| 2 | 文件中转（浮引岛） | 证据最强，是原产品核心入口之一 |
| 3 | 图片取词翻译（翻译 B 支） | 复用现有 OCR，闭环短 |
| 4 | 速记（纯文本） | 窗口行为清楚，先不做富文本 |
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
| `lib/store.js` | 浮引岛状态、速记正文、翻译历史 |
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
