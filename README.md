<div align="center">
  <img src="assets/suira-icon.png" width="80" alt="随序图标">
  <h1>随序 SUIRA</h1>
  <p><strong>顺手接住，让工作继续。</strong></p>
  <p>一个快捷键，接住桌面上的截图、文字与灵感。<br>从收集、整理到下一步，让常用工具自然衔接。</p>
  <p>Windows 11 · Electron · 本地优先 · MIT</p>
  <p><a href="#开始使用">开始使用</a> · <a href="docs/README.md">使用与开发文档</a> · <a href="CHANGELOG.md">版本更新</a> · <a href="https://github.com/huihui200739/suira-desktop/issues">反馈问题</a></p>
</div>

<img src="docs/product/panel.png" alt="随序当前版本的随手面板，包含截图、剪贴板、日历与 Markdown 等快捷入口" width="100%">

## 少一些切换，多一点连贯

随序把高频桌面操作放进一张可自定义的键盘面板。从托盘双击打开，点击工具或按字母即可继续；在设置中主动开启全局快捷键后，可以用 `Alt+S` 唤起，或用已注册的 `Alt+对应字母` 直达工具。

| 收集 | 整理 | 继续 |
| --- | --- | --- |
| 区域截图、标注、手动滚动长截图 | 离线 OCR、文本清理、图片编辑 | 钉图文、粘回当前窗口 |
| 文字、图片与文件剪贴板历史 | 日历、待办、农历与倒数日 | 任务匣、文件中转 |
| 随时记下零散想法 | Markdown 编辑与实时预览 | 导出 Markdown、HTML、PDF |

**按你的习惯摆放。** 38 个键位支持绑定工具、应用、网页、文件或文件夹；拖动换位，右键改绑。深浅主题共享一套界面，日历与 Markdown 可以作为独立窗口使用。

**找到应用，直接打开。** 应用启动台可在窗口与全屏展示间切换；输入中文、拼音或首字母即可搜索。右键键位选择「应用」，直接从带图标的列表搜索绑定，无需逐层寻找安装目录。

<table>
  <tr>
    <td width="50%"><img src="docs/product/apps.png" alt="无卡片外框的应用启动台，支持全屏与窗口切换"></td>
    <td width="50%"><img src="docs/product/toolbox.png" alt="透明方块工具箱，每项具有独立图标"></td>
  </tr>
  <tr><td align="center"><b>应用，轻松找到</b></td><td align="center"><b>工具，一眼认出</b></td></tr>
</table>

<table>
  <tr>
    <td width="50%"><img src="docs/product/calendar.png" alt="当前版本日历：月视图、农历与当天待办"></td>
    <td width="50%"><img src="docs/product/markdown.png" alt="当前版本 Markdown：文档列表、编辑与实时预览"></td>
  </tr>
  <tr>
    <td align="center"><b>把时间安排清楚</b><br>日历、待办与重要日期，在一处看见。</td>
    <td align="center"><b>让想法顺着写下去</b><br>编辑、预览、保存与导出，顺手完成。</td>
  </tr>
</table>

<img src="docs/product/clipboard.png" alt="当前剪贴板：柔光渐变、类型卡片，以及预览、复制和粘贴入口" width="100%">

> 展示图由当前版本的真实 Electron 界面生成，使用独立演示数据。[更多当前界面与截图说明](docs/product/README.md)

## 开始使用

当前候选版本 **0.2.10**，面向 Windows 11。正式发布的安装包见 [Releases](https://github.com/huihui200739/suira-desktop/releases)；本轮启动台与应用绑定见 [改进记录](docs/LAUNCHER-2026-10-31.md)，共同功能对照见 [对照报告](docs/SHARED-FEATURES-2026-10-31.md)。也可以从源码运行：

```powershell
npm ci
npm start
```

| 开启全局模式后的预设快捷键 | 功能 |
| --- | --- |
| `Alt+S` | 随手面板 |
| `Alt+C` | 区域截图 |
| `Alt+V` | 剪贴板历史 |
| `Alt+G` | 手动滚动长截图 |
| `Alt+F` / `Alt+M` | 日历 / Markdown |
| `Alt+N` | 速记 |

**先按自己的习惯使用。** 全局快捷键默认关闭，升级时保留原有配置，首次使用新策略需主动开启。点击侧栏「检查与配置快捷键」可查看本软件组合键的当前占用；冲突时换键，不强制抢占。Windows 无法统一扫描其他软件内部的快捷键，开启全局模式后 Alt+字母可能覆盖其菜单操作。[快捷键规则与文件打开方式](docs/SHORTCUTS-AND-MARKDOWN.md)

**让 Markdown 顺手打开。** 安装版会加入 `.md` / `.markdown` 的「打开方式」候选。右键文档选择随序，可按需设为默认应用。编辑自动保存为随序草稿；`Ctrl+S` 写回原文件，发现其他程序修改时会拒绝覆盖。

长截图需要手动滚动目标窗口，画面停稳后自动拼接。

**内容保存在本机。** 内容记录采用本地加密存储，截图与附件保存在本地目录。离线 OCR 不需要云端识别；翻译功能需要自行配置服务，提交翻译时会将选定内容发送给对应服务。[存储与使用边界](docs/KNOWN-ISSUES.md)

## 参与开发

```powershell
npm test                 # 逻辑、界面与交互回归
npm run test:surfaces    # Windows 原生窗口圆角与生命周期检查
npm run verify:workspace # 真实 Electron 日历与 Markdown 工作流
npm run verify:windows   # 连续移动、关闭重开与窗口尺寸稳定性
npm run verify:launcher  # 应用搜索、原生图标、键位绑定与全屏展示
npm run verify:release   # 系统热键冲突、本地文件打开与编辑保护
npm run verify:installer # 独立测试产品的安装、覆盖升级与卸载
npm run screenshots     # 从独立演示实例更新产品截图
npm run dist            # 构建 Windows 安装包
npm run clean           # 清理闲置测试产物
```

源码与测试按职责组织，根目录只保留应用入口和项目配置：

```text
src/       页面、样式与渲染逻辑
lib/       数据、动作与原生能力封装
tests/     自动化回归测试
tools/     开发、验证与截图工具
assets/    图标、原生助手与 OCR 资源
build/     安装器配置
docs/      使用说明、当前产品图与历史记录
```

[开发指南](CONTRIBUTING.md) · [已知问题](docs/KNOWN-ISSUES.md) · [MIT License](LICENSE)
