# 浮引函数级反编译与 Windows 开发映射

版本：v1.0 · 2026-10-21。关联：[随序开发方案](../随序-Windows产品与开发方案.md)。

本轮已对本机浮引 6.0.1（216）的 arm64 主程序执行真实的 Ghidra 函数反编译，复核了面板、剪贴板、截图和 OCR 的若干关键路径。它将上一阶段的类型名、导入接口和字符串线索推进到了函数体、条件分支、字段读写与具体调用点。**当前完成的是限定核心路径的函数级研究，不是全应用源码恢复。**

对 Windows 开发最有价值的发现是：显隐有独立状态机；布局可以预准备和复用；动画从当前视觉状态继续；剪贴板用内容序号和递增代次控制过期任务；截图结果有只完成一次的保护；OCR 有缓存复用、任务取消和结构化结果处理。这些机制可以独立重写成 Windows 实现。

## 1. 样本、工具与证据规则

**版本复核：第一阶段结构/UI 研究记录的是 5.4.0（209），本轮函数切片属于当前安装的 6.0.1（216）。** 已重新抽取当前 arm64 切片，哈希与实际反编译输入完全一致；当前 Info.plist 已留存为 [current-bundle-info.json](../../research/function-analysis/current-bundle-info.json)。早期样本通用程序哈希为 `4f61dc3a3c9f825bb590d6149b0a93f32050882ea526aef896af3fcf08999e00`。两个阶段不是同一份程序，本文函数地址不能套用到旧样本，也没有做两版本行为差异审计。

| 项目 | 本轮身份 |
|---|---|
| 原样本 | `/Applications/浮引.app/Contents/MacOS/浮引`，6.0.1（216），`me.vkr.fg` |
| 通用程序 SHA-256 | `94f56b34ce8a795347014610b9dc1b801b53840128687359fb529d52b6d28bee` |
| 分析切片 | [fuyin-arm64.macho](../../research/function-analysis/fuyin-arm64.macho)，由 `lipo -thin arm64` 派生 |
| 切片 SHA-256 | `994fea714090a8a2ee1aaedea5a40ef1789d41f281f87c948eb20502062c1307` |
| 分析工具 | REA `rea-agents@6.7.0`；Ghidra 12.1.4；现有 JDK 21 |
| 地址口径 | 静态、未加 ASLR slide 的 arm64 VA；image base `0x100000000` |
| 分析方式 | 本地静态导入、默认自动分析、定向 `analyze_function`、调用引用和汇编复核 |

Ghidra 官方发行包在工作区解压；Mac arm64 decompiler 由该发行包自带 C++ 源码构建。没有修改原应用，也没有修改 Codex 全局配置。没有读取个人剪贴板数据库、笔记正文或账号凭据，没有运行调试器或测量原产品性能。

下文“已确认”指本样本静态代码中存在对应分支或调用；不代表某次真实用户操作已经执行。`FUN_...` 和 C 伪代码来自分析器，中文职责名由分析者概括。Swift 的隐式 self、异步 continuation、泛型、Optional 和 ARC 仍可能表现为 `unaff_x20`、`unaff_x22`、`extraout_*` 或未解析间接调用，不能把这些签名当作原始 Swift 源码。

完整证据保存于 [函数证据目录](../../research/function-analysis/)，总索引为 [evidence-index.json](../../research/function-analysis/evidence-index.json)。面板和剪贴板的详细函数表、汇编点及完整 Evidence ID 分别见 [面板追踪](函数追踪-面板.md) 与 [剪贴板追踪](函数追踪-剪贴板.md)。

## 2. 面板：状态、布局、动画与输入

### 入口和模式路由

实际 Objective-C 菜单入口 `0x10006dfe4`、`0x10006e014` 分别将首参数 0 / 1 传给公共路由 `0x100086374`。入口 selector 分别对应动作面板和应用面板；公共路由还读取窗口可见性、`motionState` 和 `currentOpenTarget`，再进入展示 `0x100a5c4e0` 或切换 `0x100a405dc`。这条菜单链已经确认，不能直接代替所有全局快捷键回调链。

补查 `RegisterEventHotKey` 的直接调用者后，`0x10006993c` 中确实存在注册后随即注销返回句柄的分支（伪代码 L294–297、L892–895）。这支持“存在探测式注册路径”的推断，不能把这个函数直接称为实际常驻热键处理器。具体键位、双击/长按状态机和完整热键事件到面板的链路仍未完成。

### 显示与隐藏

展示函数会写 `pendingOpenTarget/currentOpenTarget`，对准备好的目标、布局及当前呈现状态进行比较。需要时才执行 `layoutSubtreeIfNeeded`、`displayIfNeeded`，并前置窗口、获取键盘焦点、将 `contentView` 设为 first responder。局部键盘监听只在未暂停捕获且监听尚不存在时注册；窗口外鼠标有独立的本地和全局监听。

隐藏函数 `0x100a6270c` 会递增通知和准备代次、取消重定位任务，设置隐藏标志，并在可见分支暂时禁用窗口鼠标事件。静态配置中有 **80 ms 的面板快捷键抑制**，以及向另一回调传递的 **100 ms 抑制请求**，是两个不同的值。子窗口跟踪、屏幕边缘返回和特殊状态另有分支。

动画函数 `0x100a5b588` 取消旧 `motionTask`，优先取得 `presentationLayer.transform`，再移除旧动画并建立新动画。因此反向操作可以从当前画面接续。状态值的高置信解释为：0 隐藏、1 展示过渡、2 稳定可见、3 隐藏过渡；值 4 的特殊状态尚未命名。代码有 0.16 / 0.20 / 0.25 秒时长选择，不能泛化为全部动画的固定时长。

本轮追加展开了两个回调核心，补上子研究原先留下的边界：

- `0x100a645f0`：动画完成回调先恢复控制器弱引用，再检查当前 `motionState` 是否仍为相应方向的 1 或 3，符合才调用 `0x100a61c5c`。已证实状态门控；最终收尾 helper 未继续展开，不能声称全部完成路径都已恢复。
- `0x100a64670`：主队列通知回调实际比较捕获的 `panelDidOrderNotificationGeneration`；同时核对窗口仍是当前窗口、可见、未进入隐藏、状态在 1 / 2，满足才发送通知。**这里不只是捕获了 generation，确实存在过期回调检查。**

展示函数还有 `panel.presentation.slow` 记录：用 uptime 差值乘 1000，与 35.0 比较后记录目标、是否预热等上下文。**35 ms 是日志阈值，不是实测延迟，也不是性能保证。**

### Windows 落点

使用 `PanelLifecycle` 统一管理 Hidden / Opening / Visible / Closing，所有转换在 UI 调度器串行提交；缓存布局键包含内容版本、DPI、显示器工作区和主题版本。新输入打断动画时，从当前视觉进度继续。对延迟通知核对 generation 和窗口实例，对动画完成回调核对当前状态。关闭开始立即停止接受动作，避免透明窗口仍可点击。

原应用隐藏后的来源窗口恢复尚未找到完整证据。随序要自己实现并验收 `ReturnTargetService`，记录来源 HWND、PID 和进程实例，不能把面板获取焦点误写成原窗口恢复已经还原。

## 3. 剪贴板：检测、版本核对、取消与重试

构造函数 `0x1001d852c` 获取 general pasteboard，建立标签为 `clipboard.monitor` 的队列，并分别初始化捕获、查询、图片刷新等任务字段。下列路径有函数体支持：

```text
监控启动 0x1001de648
  → timer 闭包 0x10022eedc → 0x1001dede0
      → 比较捕获盒中的 changeCount；变化才创建 MainActor 任务
      （该异步任务到服务入口的全部 continuation 尚未展开）

服务变化检查 0x1001df154
  → 序号变化：更新外部变化标记、清内部标记
  → 0x1001df48c：captureGeneration++，取消旧 retry task
  → 0x1001fc3a4：读取前核对序号和代次
      → 0x100205a44：尝试取得 payload
      → 读取后再次核对 changeCount
      ├─ 有效结果：进入异步后处理
      └─ 空结果或读期间变化：0x1002050f8 有界重试
```

一条后台 monitor 的 timer 配置已通过汇编常量复核：首次 deadline 为 now + 1.3，repeating 为 **1.3 秒**，leeway 为 **250 毫秒**。创建函数仅在 timer 尚不存在时工作；当前直接调用者 `0x1002b427c` 先检查对象偏移 `0x12` 的标志，再启动监控并更新另外两个状态字节。该对象状态的完整语义未恢复。**这些是这条路径的配置，不是浮引所有复制行为的响应延迟。**

重试函数要求原序号和 generation 仍匹配，且 `retryIndex < 3`，之后取消旧重试并创建新任务。存在表值 200 / 600 / 1200，但等待 continuation 的单位尚未确认，不将它写成已证实的毫秒退避。

payload 路径先调用两个尚未展开的 helper，再走明确可识别的 NSImage 可读性、图片读取与文本读取分支。可识别的文本分支裁去两端空白和换行，仅在非空时返回文本。由于有未解析 helper 和 jumptable，不能宣称全部格式优先级已恢复，也不能将未知 helper 称为隐私过滤。

在子研究之后又展开了 `0x1002060f0`：它以 utility 优先级构造后处理任务，再等待任务值；**最终去重、INSERT/UPDATE、事务和保存失败处理仍未追到。** 序号相同提前返回也不等于内容去重。

### Windows 落点

沿用主方案的系统变化通知；每次变化创建独立 capture generation，读前、读后、重试前和提交前核对版本。取消令牌加版本校验同时使用，不能假设 cancel 会立即终止已运行任务。锁竞争采用可配置、有界重试。

随序应保存用户复制的原始文本；空白整理作为单独动作生成新内容，避免缩进丢失。这是独立产品选择。去重、敏感格式排除、自写回环和落盘事务按自己的数据模型实现，当前反编译不能为原应用的这些机制背书。

## 4. 截图：原生采集与一次完成保护

鼠标释放的 Objective-C 入口 `0x101409e08` 转入 `0x101409b20`。后者先检查 `isInteractionEnabled`，处理 `suppressMouseUpAfterDoubleClick` 和 `pendingSingleClick`，将窗口内事件坐标转换到屏幕坐标，再进入 session helper。已看到鼠标释放路由和双击抑制，尚未逐边连接到最终矩形计算和采集请求。

从 `captureImageWithFilter:configuration:completionHandler:` 的实际引用定位到 `0x1017b8200`。该函数建立 CheckedContinuation 和带 NSLock、完成标志的上下文，安装回调，再调用 `SCScreenshotManager.captureImage`，随后等待 continuation。解码字符串为 `captureImage(contentFilter:configuration:timeout:)`，说明存在带 timeout 参数的封装入口；具体超时分支、时长和所有取消路径尚未还原。

回调包装 `0x1017be37c` 转发到 `0x1017b1f84`。后者无论图像成功还是错误路径，都在锁内检查完成标志；已经完成则返回，否则置完成后解锁并 resume continuation。由此可确认 **此回调入口具备只完成一次的保护**。不能据此声称所有竞争参与者都已经审计。

以下为分析者整理的等价控制流摘要，省略 Swift ABI 和错误构造细节，**不是恢复的原源码**：

```text
onCaptureCallback(image, error, sharedState):
    lock(sharedState)
    if sharedState.completed:
        unlock(sharedState)
        return
    sharedState.completed = true
    unlock(sharedState)
    resumeContinuation(image 或 error)
```

### Windows 落点

`CaptureSession` 分离选择区域、采集、预览和后续动作；用 jobId / generation 标识会话。成功、失败、超时、用户取消都竞争同一个完成出口，在 C# 实现中采用 `TrySetResult / TrySetException / TrySetCanceled` 或等价原子状态转换。完成后清理设备、纹理、回调和遮罩窗口；迟到结果不能重新打开已关闭预览。Windows 图形采集与 DPI 换算仍按主方案独立实现。

## 5. OCR：缓存、任务、引擎与输出

钉图内容视图的 `textRecognitionPressed` 入口 `0x101736984` 转入 `0x10173590c(0)`。后者先检查资源是否已释放和一处能力策略回调；策略的商业语义未展开。普通触发下，已有 analysis 或 trim 后非空全文可以复用；否则取消旧 `textRecognitionTask`，清空旧结果，写识别状态 1，并持有图像启动弱引用任务。有缓存时写状态 2 并更新视图；状态的完整 UI 枚举仍以分析者解释为限。

实际引擎路径已超过类型名层面：

| 函数 | 函数体中可见的处理 |
|---|---|
| `0x101898e0c` | 创建 `VNRecognizeTextRequest`，设置识别级别、语言纠正、语言表、最小文本高度及自动语言检测，然后调用执行函数 |
| `0x1018a0444` | 以 CGImage 创建 `VNImageRequestHandler`，执行 `performRequests:error:`，处理错误，读取 `VNRecognizedTextObservation` 结果 |
| `0x1018a003c` | 每个 observation 取 `topCandidates(1)`；提取字符串、trim 并跳过空串；读取 `boundingBox` 和 `confidence` 形成结构化记录 |
| `0x1018a0444` | 将结构化记录的文字以换行符 `0x0A` 连接为全文 |
| `0x1018993dc` | 在执行前后检查取消，再 yield 结果并 finish AsyncStream |

几个 Ghidra 未命名 ObjC stub 已用本切片的 ADRP/LDR 指令、selector 引用槽和 selector 字符串复核，见 [selector-stub-map.json](../../research/function-analysis/selector-stub-map.json)。识别级别传入原始值 0，语言纠正与自动语言检测传入 1。这里不猜测未解码的语言表元素，也不将没有复核的浮点参数写成准确配置。`0x1018a003c` 还调用一个数组处理 helper；其排序规则未展开，不能宣称已经恢复段落、表格或多栏阅读顺序算法。

钉图 UI 入口和上述引擎入口分别已取得证据，但两者之间全部 async continuation 尚未逐边连接。本轮没有测量识别速度、准确率、中文语言覆盖或缓存命中率。

### Windows 落点

定义 `OcrResult { blocks, fullText, engine, languageInfo }`。引擎返回文字块、矩形与可用的置信度；不同引擎缺少字段时允许为空。缓存键包括图像内容哈希、引擎及版本、语言配置和处理参数；用户修改图像或参数后重新计算。取消后不向已释放视图回写结果。先保留结构化输出，再提供全文、合并换行和表格预览等独立动作。

## 6. 覆盖矩阵与剩余缺口

| 原始问题 | 状态 | 已回答部分 | 尚未回答部分 |
|---|---|---|---|
| 热键到面板 | 部分回答 | 菜单入口到公共路由、面板内键盘监听、热键注册探测候选 | 全局热键实际回调、双击/长按、所有键位 |
| 面板显示与焦点 | 部分回答 | 状态机、布局准备、窗口前置、输入焦点、动画接续、通知代次检查 | 隐藏后来源窗口/控件恢复，所有特殊状态与完成路径 |
| 剪贴板捕获与历史 | 部分回答 | 一条监控配置、序号/代次、取消、有界重试、可识别 payload 分支 | 完整格式分支、内容去重、隐私排除、最终落库 |
| 截图区域到结果 | 部分回答 | 鼠标释放路由、原生采集调用、回调一次完成保护 | 全部坐标/区域链、超时策略、长截图和录屏 |
| OCR | 部分回答 | UI 缓存/取消、实际 Vision 请求、候选提取、结构化记录、全文拼接 | 完整 UI 到引擎异步链、语言表、排序 helper、准确率 |
| 模块准备/暂停/释放 | 未解决完整状态机 | 找到监控启动调用者和若干 MainActor deinit/释放包装 | dormant/prepared/suspended/releasing 转换条件与实际资源效果 |

生命周期相关 `0x1002b39a0` 等函数主要是 actor 隔离检查、引用释放或析构包装，不能因地址位于相关区域就称为状态机。对 `runtime shutdown` / `memory.pressure.received` 的两次精确字符串 xref 查询为空；这只是当前引用查询的范围，不能证明没有相应功能。下一步如需深入，可从内存压力注册回调和运行时实例字段的交叉引用继续追踪。

默认自动分析完成并报告成功，但期间有 analyzer 的 `ArrayIndexOutOfBoundsException`；日志已保留。部分函数存在无法恢复的 jumptable、未解析间接调用及分析器类型误差。不能将全程序索引条数写成“恢复了多少完整业务函数”，也不能把未找到的边写成不存在。

这些缺口不阻止 Windows 原生样机开发。当前已有足够证据把核心交互拆成可验证的工程任务；未还原的行为按独立需求实现和测试，不能以“仿照原版”代替验收。

## 7. 写入开发排期的具体任务

下列任务合并进主方案原有阶段，不额外叠加一套未经估算的新工期。

| 阶段 | 必须落实的实现 | 验收场景 |
|---|---|---|
| 第 1 周技术样机 | 面板状态机、当前视觉状态接续、布局缓存、原目标身份记录 | 快速开关 20 次；动画中反向；切换显示器/DPI；旧回调不能隐藏新窗口 |
| 第 3–4 周剪贴板 | 系统通知、版本号、取消、读前后校验、有界重试、独立去重事务 | 快速连续复制文本/图片；读期间再次复制；剪贴板锁竞争；自身写回不生成回环 |
| 第 5–6 周截图/OCR | 单一任务完成出口、超时和取消、结构化 OCR、参数化缓存 | 取消后迟到结果；反复点击识别；图像修改后缓存失效；无文字及引擎失败 |
| 后续整合与稳定性 | 来源 HWND 校验、输入法和子窗口 transient 状态、分段延迟记录 | 原窗口关闭、用户主动切换目标、管理员目标、IME 候选、系统对话框 |

上述常数是研究样本的配置证据。随序的动画、抑制期、重试间隔与缓存容量以 Windows 真机测量决定；原计划中的 100 ms 热唤起等仍是待验证的产品目标。

## 8. 根补查证据索引

面板与剪贴板的原始 24 个子研究函数索引见各自追踪文档。这里列出根补查中直接支持本文新增结论的记录；每个 JSON 的 `normalized_result` 保留伪代码、汇编及分析限制，旁边有同名 `.pseudo.c` 可阅读。

| 结论 | 地址 / 证据文件 | Evidence ID |
|---|---|---|
| 菜单动作入口 | `0x10006dfe4` · [003-action-entry](../../research/function-analysis/extracted/003-action-entry.json) | `ev_dee68ae094188ff1d146d542f4af20686e3b9f233c0a720387f403cd7c53bd3b` |
| 菜单应用入口 | `0x10006e014` · [004-app-entry](../../research/function-analysis/extracted/004-app-entry.json) | `ev_05ea615dd14dcb3488cf104bffa3cfeb12c82b02d439e5af9364525363700a2e` |
| 鼠标释放路由 | `0x101409b20` · [330-mouse-up-core](../../research/function-analysis/extracted/330-mouse-up-core.json) | `ev_c6877e056b066fc3eab3d0234d273151d3454d54bce2f38e541704c0fde26cf1` |
| 原生截图采集 | `0x1017b8200` · [331-capture-call](../../research/function-analysis/extracted/331-capture-call.json) | `ev_994de58431c891714223928c35ef81fc2644a6f831833ffe076eac21ae222976` |
| 采集回调包装 | `0x1017be37c` · [340-capture-callback](../../research/function-analysis/extracted/340-capture-callback.json) | `ev_9f808817ca7ea71faa3bd40197efe3c5a2deaac765b5bd5934c080503ee99405` |
| 回调一次完成保护 | `0x1017b1f84` · [346-capture-resume](../../research/function-analysis/extracted/346-capture-resume.json) | `ev_63dae0da7a4b4c909a0a2a593914fd1fefc932131ea194cd70f1073f179bf6c4` |
| 钉图 OCR 缓存与取消 | `0x10173590c` · [333-ocr-trigger](../../research/function-analysis/extracted/333-ocr-trigger.json) | `ev_6f9c7ad71ff4856ad592b84b2b5208b2e9a976b56777b5796469b83beca403d1` |
| OCR 请求配置 | `0x101898e0c` · [347-ocr-request](../../research/function-analysis/extracted/347-ocr-request.json) | `ev_90a644e6c1e3746c96a3d9269c97143ca9219cc62ab078df35ca83a4de7b61c5` |
| OCR 执行与全文拼接 | `0x1018a0444` · [332-ocr-call](../../research/function-analysis/extracted/332-ocr-call.json) | `ev_c09db71b40f79fc83b2ad84ac602ab5af1e037f3f00b66a8a47b72c1f283835b` |
| OCR 候选与结构化记录 | `0x1018a003c` · [341-ocr-extract](../../research/function-analysis/extracted/341-ocr-extract.json) | `ev_5137327164567a7ba01cb116994761a16981f2e2def07eb6add5c9e3aac06b48` |
| OCR 取消与流式返回 | `0x1018993dc` · [348-ocr-request2](../../research/function-analysis/extracted/348-ocr-request2.json) | `ev_8e6e3acac10af01522a11b48e663a6f37103960aeb2239f02a5d137dc3a434ca` |
| monitor 启动上层 | `0x1002b427c` · [344-clipboard-start-caller](../../research/function-analysis/extracted/344-clipboard-start-caller.json) | `ev_9eaddcae3cca866b13eaf233cab8f45c5597806e96564fb4e99036e18d476ae3` |
| 剪贴板异步后处理 | `0x1002060f0` · [349-clipboard-store-cont](../../research/function-analysis/extracted/349-clipboard-store-cont.json) | `ev_4e2de130bbd6ec7d07bdfa12583fb06c38908159347a0e751a65ca1d6eb8bf1c` |
| 热键探测式注册候选 | `0x10006993c` · [350-hotkey-register](../../research/function-analysis/extracted/350-hotkey-register.json) | `ev_a6b14e5d5ba366028fb8406a9f77f8d3f2d84a412f58fbd60a0e41a8c2f95b00` |
| 动画完成状态门控 | `0x100a645f0` · [351-panel-completion-core](../../research/function-analysis/extracted/351-panel-completion-core.json) | `ev_d2001b10bef5e021b972fc58456a7f691c4c71ffeb02a82c2a32604a5e88e359` |
| 延迟通知 generation 校验 | `0x100a64670` · [352-panel-notification-core](../../research/function-analysis/extracted/352-panel-notification-core.json) | `ev_7a404b496e4834ba7b3e2438c788b060d4d784621c7ca29b34d7270429bc4f93` |

## 9. 留存与复核

原始请求在 `research/function-analysis/requests/`，完整响应在 `responses/`，只读投影在 `extracted/`。已保存 [自动分析日志](../../research/function-analysis/ghidra-autoanalysis.log)、[ObjC 索引说明](../../research/function-analysis/索引与候选入口说明.md)、[工具来源清单](../../research/function-analysis/toolchain-manifest.json) 和 [portable evidence bundle](../../research/function-analysis/rea-function-evidence-bundle.json)；会话结束后不依赖临时 Ghidra 数据库来阅读本轮证据。

要重新生成可读投影，在本工作区运行：

```sh
python3 research/function-analysis/extract-results.py
```

该脚本只读取已保存响应，不启动或重新分析目标。重新反编译时，应先校验样本哈希，以新的输出目录启动 REA/Ghidra 会话，先 `open_binary`，再用本轮请求参数复核所需函数；不要直接复用会读取旧请求、可能覆盖响应的研究驱动目录。研究完成后执行 `close_binary`。

本文件提供机制研究和 Windows 独立实现建议，不交付原应用源代码，也不将 C 伪代码直接移植到产品。当前随序仍处于开发方案阶段，尚无 Windows 原生可执行程序与真机性能报告。
