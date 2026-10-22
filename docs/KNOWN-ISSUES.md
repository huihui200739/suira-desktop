# 已知问题与排查记录

> 本文件记录 2026-10-22 一次真实启动排查的结论。
> **重要：文末「更正」一节推翻了最初的判断，请以更正后的结论为准。**

## 现象

在开发机（Windows 11，路径 `C:\Users\huihui\Desktop\截图工具`）上直接启动：

```powershell
npm start
```

出现以下两种失败之一，窗口都不出现：

| 退出方式 | 观测到的退出码 |
|---|---|
| 进程立即终止，无任何窗口 | `0xC0000005`（ACCESS_VIOLATION，`-1073741819`） |
| 控制台打印「随序启动失败」后退出 | `0xFFFF7003`（`-36861`） |

第二种情况能拿到完整错误：

```
随序启动失败: [Error: EPERM: operation not permitted, mkdir
  'C:\Users\huihui\AppData\Roaming\随序 SUIRA\captures'] {
  errno: -4048, code: 'EPERM', syscall: 'mkdir'
}
```

同时 Electron 自身报：

```
Lock file can not be created: 拒绝访问。 (0x5)
Failed to create cache directory: ...\随序 SUIRA\GPUPersistentCache: 拒绝访问。 (0x5)
```

## 定位过程与确定性结论

做了 2×2 对照，把「应用代码路径」和「数据目录位置」两个变量拆开：

| 应用目录 | userData | 结果 |
|---|---|---|
| 中文 `截图工具` | 默认 `%APPDATA%\随序 SUIRA` | ✗ 启动失败 |
| ASCII `C:\suira-dev`（junction） | 默认 | ✗ 启动失败 |
| 中文 `截图工具` | 工作区内 `.udata` | ✓ 正常启动，窗口出现 |
| ASCII `C:\suira-dev` | 工作区内 `.udata` | ✓ 正常启动 |

**结论：路径里的中文不是原因。** ASCII 路径 + 默认数据目录同样崩溃；中文路径 + 工作区数据目录正常。

用同一个 `electron.exe` 二进制分别以两种模式写同一批位置，进一步排除应用代码嫌疑：

| 写入目标 | `node.exe` | `electron.exe`（`ELECTRON_RUN_AS_NODE=1`） |
|---|---|---|
| `%APPDATA%\...` | OK | **EPERM** |
| `%TEMP%\...` | OK | **EPERM** |
| `%USERPROFILE%\...` | OK | **EPERM** |
| 仓库工作目录内 | OK | OK |

也就是说：**只要能写进工作目录，Electron 就能正常启动；凡是需要写 AppData / Temp / UserProfile 就 EPERM。**
这与本次排查所处环境（受管控的沙箱会话）对 Electron 进程的文件访问限制一致，属于**环境约束，不是产品代码缺陷**。

## 由此暴露的产品层真实问题

虽然不是代码 bug 导致崩溃，但排查过程暴露了产品本身需要补的几处：

### 1. 数据目录不可写时没有任何降级路径

已核实代码路径：`initialize()`（`main.js:1155`）第一行就是 `await ensureDirs()`，
而 `ensureDirs()`（`main.js:103`）直接 `Promise.all` 三个 `mkdir`，没有 try/catch。
失败后异常冒到顶层 `.catch`（`main.js:1222`），只做
`dialog.showErrorBox('随序启动失败', ...)` + `app.quit()`。

用户看到的是「程序打不开」加一大段 stack，拿不到可操作的补救办法。

建议：`ensureDirs()` 失败时回落到一个可写的备选目录（可执行文件同级 `./data`，
或 `app.getPath('temp')` 的子目录），并在设置页显著提示当前数据落在非默认位置；
同时把失败原因写成一句人话，而不是整段 stack。

### 2. 页面完全没有 CSP

已核实：`src/index.html`、`src/quickpanel.html`、`src/overlay.html` 三个页面
**没有任何 `Content-Security-Policy` meta**，`main.js` 里也没有
`onHeadersReceived` / `webRequest` 注入 CSP 头（两处检索命中数均为 0）。

原型阶段可以接受，但页面会加载远程内容、渲染识别出的文字，
打包前建议补上最小可用策略（默认 `default-src 'self'`）。

### 3. `main.js:1112` 缺少换行，函数粘连

```js
}function createTray() {
```

`registerIpc()` 的收尾大括号和 `createTray()` 之间没有换行。语法合法、运行无影响，
但会干扰 diff 阅读与格式化工具，建议修正。

### 4. `overlay.html` 引用了不存在的图片

`src/overlay.html:24`：

```html
<img src="../assets/screenshot.png" alt="">
```

但 `assets/` 下并没有 `screenshot.png`（目录里是 `brand.svg`、`icon.ico`、
`icon.png`、`logo.png`、`suira-icon.png`、`foreground-helper.ps1`、`tessdata/`）。
截图覆盖层左上角的品牌位因此是空的，控制台会有一条 404。

修法二选一：补一张图，或把引用换成已有的 `brand.svg` / `logo.png`。

### 5. 曾观察到托盘的告警，但未能复现

排查过程中有一次启动日志里出现过：

```
WARNING: ... Unable to create status tray icon.
```

但单独写探针验证（同一台机器、同一份 `assets/suira-icon.png`、真实 Electron 主进程）时，
`nativeImage` 正常加载（1254×1254）、`resize` 正常、`new Tray()` + `setContextMenu()` 全部成功。
**这条不能确认为产品缺陷**，暂记为「偶发、原因不明」，留待有稳定复现步骤再处理。

## 复现方式

在**普通用户桌面会话**（非沙箱、有 AppData 写权限）下：

```powershell
npm install
npm start
```

若仍复现，请附上 `%APPDATA%\随序\` 的目录是否存在，以及启动时控制台的「随序启动失败」全文。

---

## 更正

最初我把这个崩溃归因为「路径含中文导致 Electron 主进程崩溃」，并据此给出「映射到 ASCII 路径」的绕过方案。
**这个结论是错的**，上面的 2×2 对照已经推翻它：ASCII 路径 + 默认数据目录照样崩溃，中文路径 + 可用数据目录完全正常。

真正的变量是**数据目录是否可写**。ASCII junction 那次之所以"看起来有效"，是因为当时同时把
`--user-data-dir` 指到了工作区内 —— 起作用的是后者，不是路径本身。

保留这段更正，是为了避免后续再照着错误结论去改代码或改部署结构。

---

## 第三批开发期间的修复（2026-10-22）

- **第 3 条已修（本轮补全）**：`main.js` 里 `}function createTray()` 的粘连已补换行。
  更正：上一轮只修了 `registerIpc()` 与 `pin:` 处理器之间的同类问题，`createTray` 这处
  当时漏掉了；本轮已确认 `}function` / `}    for (` 两种粘连都不再存在（`test-ui.js` 有断言）。
- **第 4 条已修**：`src/overlay.html` 品牌位原先引用不存在的 `../assets/screenshot.png`，
  改为已有的 `../assets/brand.svg`（18×18），覆盖层不再出现 404 与空品牌位。
- **第 1 条仍未处理**：数据目录不可写时依然没有降级路径，会直接退出并弹错误框。
  第三批新增的浮引岛/按住型侦测/OCR 缓存都依赖同一数据目录，这条对真机部署仍是一个门槛。
- **第 2 条仍未处理**：三个页面仍没有 CSP。页面依赖内联脚本与 `data:` 图片，
  加最小策略需要先拆内联脚本，留到发布前统一做。
- **第 5 条**：托盘告警未再复现，继续按「偶发、原因不明」记录。

---

## 核心框架开发期间发现并修复的问题（2026-10-22 第二轮）

### 1. 截图提字在 Electron 主进程里永久卡住（已修，严重）

**现象**：真实 Electron 里按 `O` 框选后，OCR 结果面板一直显示「正在准备本地识别…」，
不报错、不结束；主进程 CPU 很低。同一份 `OcrService` 在纯 `node` 下 0.8 秒就能识别。

**根因**：`tesseract.js` 用 `is-electron` 判断环境。Electron 主进程里 `env` 是 `electron`
而不是 `node`，`worker-script/index.js` 因此把本地 `langPath` 当成 URL 去 `fetch`，
抛 `TypeError: Only absolute URLs are supported`；该异常发生在 worker 消息回调里，
`createWorker` 永远不会 resolve，于是表现为永久等待。

**修法**（不改 `node_modules`）：`OcrService.prepareLanguageCache()` 在 `createWorker` 之前
把 `assets/tessdata/*.traineddata.gz` 解压进 `cachePath`。tesseract 缓存命中时不走 fetch
分支，完全离线。`test-ocr.js` 覆盖缓存命中/重建/缺包/坏包；`verify:core` 在真实 Electron 里
用带文字的图片识别出 `HELLO SUIRA 2026`。

**边界**：首次识别需要解压语言包（约 1–2 秒）；`cachePath` 必须可写（与第 1 条同一风险）。

### 2. 剪贴板文件引用从未被采集（已修）

Electron 45 把资源管理器复制的文件暴露为 `text/uri-list`（`file:///C:/...`，多行），
原实现只读 `text/plain` 与图片格式，所以「复制文件」在历史里完全消失。
现在一次 `clipboard.read()` 同时解析文本 / 文件 / 图片，文件条目保存路径列表与文件名，
不复制文件本体。注意平台格式细节：复制文件时**没有** `text/plain`。

### 3. 剪贴板去重只比较最后一条（已修）

`A → B → A` 会留下两条 A。现在按「最近 300 条 + kind 一致 + 归一化文本/hash 一致」判重，
命中就刷新 `createdAt` 置顶，不新增条目。

### 4. 剪贴板来源应用一直是空（已修）

`shouldExcludeCapture` 支持按进程名/窗口标题排除密码管理器，但主进程从没把来源传进去。
现在每次剪贴板变化都读一次前台窗口（`foregroundProbe`），把 `appId/appName/windowTitle`
写进 `source`，并用于敏感排除。注意：这是**推断**（`confidence: 'inferred'`），
轮询时机约晚 0.5 秒，用户如果在这期间切窗口可能记错来源，UI 不把它当确定事实。

### 5. 主窗口没有位置记忆（已修）

现在记录 `windowState`（位置/尺寸/最大化），启动时用 `sanitizeWindowBounds` 校验：
显示器被拔掉、分辨率变化、窗口落在负坐标副屏、只露出一条边等情况都会回落到可见位置，
不会出现「窗口不见了」。
