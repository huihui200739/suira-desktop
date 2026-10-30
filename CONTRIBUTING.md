# 贡献与开发

需要 Windows 11、Node.js 24 或更新版本，以及 npm。先执行 `npm ci`，再使用 `npm start` 启动；常用脚本见 [package.json](package.json)。

## 代码结构

`main.js` 管理 Electron 生命周期与 IPC；`preload.js` 暴露受控接口；`lib/` 负责可独立测试的数据与业务逻辑；`src/` 负责界面。Windows 原生助手源码在 `assets/`，安装器配置在 `build/`。

逻辑回归统一放在 `tests/`；需要实际 Electron、Windows 原生能力或浏览器渲染的工具位于 `tools/`。不要把依赖、用户配置、密钥、原始性能追踪或构建产物提交到仓库。

## 验证

- `npm test`：完整逻辑、渲染与交互回归。
- `npm run test:surfaces`：独立实例内验证实际 Windows 原生窗口区域、缩放与最大化恢复。
- `npm run verify:workspace`：日历保存与完成、Markdown 编辑、持久化与导出。
- `npm run screenshots`：当前产品截图，输出到 `docs/product/`；演示实例退出后删除临时数据。

新建的 Electron 验证脚本应优先使用 `SUIRA_ELECTRON` 指定运行时，随后回退到已有镜像或项目依赖。中文路径下开发启动器会复用 ASCII 路径的运行时。

## 打包与清理

`npm run dist` 构建 NSIS 安装包，`npm run dist:portable` 构建免安装包。产物位于 `dist/`，不纳入 Git。正式替换已安装应用前应从托盘正常退出，让文档保存和关闭流程完成。

`npm run clean` 只删除已知且未使用的测试产物，保留依赖、当前运行时、用户数据和密钥。先用 `npm run clean -- -Preview` 查看范围；旧安装包清理参数及其保留条件见 `tools/clean-dev-artifacts.ps1`。

## 图片与文档

当前产品图统一使用 `docs/product/`。`docs/screenshots/` 和带日期的文档为历史档案，避免在产品首页展示旧进度。PNG、图标和 OCR 模型通过 Git LFS 管理；需要原始资源时先安装 Git LFS 并执行 `git lfs pull`。
