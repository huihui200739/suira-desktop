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

- **第 3 条已修**：`main.js` 里 `registerIpc()` 收尾与 `createTray()` 之间的粘连
  （`}function createTray()`）已补换行；`search:query` 里 `}    for (` 的同类格式问题一并修掉。
- **第 4 条已修**：`src/overlay.html` 品牌位原先引用不存在的 `../assets/screenshot.png`，
  改为已有的 `../assets/brand.svg`（18×18），覆盖层不再出现 404 与空品牌位。
- **第 1 条仍未处理**：数据目录不可写时依然没有降级路径，会直接退出并弹错误框。
  第三批新增的浮引岛/按住型侦测都依赖同一数据目录，这条对真机部署仍是一个门槛。
- **第 2 条仍未处理**：三个页面仍没有 CSP。页面依赖内联脚本与 `data:` 图片，
  加最小策略需要先拆内联脚本，留到发布前统一做。
- **第 5 条**：托盘告警未再复现，继续按「偶发、原因不明」记录。
