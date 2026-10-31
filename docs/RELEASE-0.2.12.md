# 0.2.12 候选验证

本轮在 Windows 11 x64、Electron 45.0.0 验证。安装包未正式发布，公开更新源尚待仓库所有者选择；应用内更新代码完成不等于线上分发已接通。

| 验证 | 结果 |
| --- | --- |
| `npm test` | 通过，包含更新状态、草稿保存失败保护及原有逻辑与界面回归 |
| `npm run verify:launcher` | 通过，38 键全屏比例、保持当前布局、Alt+S 返回小面板、菜单、图标、绑定与搜索 |
| `node tools/updater-network-check.js` | 通过，真实下载通过校验，错误 SHA512 被拒绝；未执行测试文件 |
| `npm run verify:installer` | 通过，独立测试产品安装、覆盖升级、等待退出进程后更新及卸载，默认文件关联保持不变 |
| `node tools/packaged-markdown-check.js` | 通过，实际打包版本窗口恢复、本地文档打开与保存、全屏及应用绑定 |
| `node tools/release-package-check.js` | 通过，93 个源码文件与包内字节一致，安装器 CRC、更新配置、元数据大小与 SHA512 一致 |
| `npm run screenshots` | 通过，当前演示图、原生圆角、任务栏边界、独立窗口及最大化恢复 |

最新候选安装包保留在桌面，SHA256 与大小记录在 [构建清单](release-0.2.12.json)。当前构建未签名，未执行对实际用户安装目录的覆盖安装。

执行 `npm run clean -- -IncludeObsoletePackages -IncludeLegacyProbes -IncludeLegacyRuntimes`，共清理 39 项、1224.7 MB。包含重复打包目录、旧升级调查程序副本和解压包、临时测试文件。桌面与下载目录未找到待删的历史 Suira 安装包；保留当前候选安装包。清理前后本机内容文件与加密密钥校验值相同，历史备份中的用户数据目录也予以保留。有效测试源码、依赖和当前运行环境未移除。

实际网络服务可用性、真实公开 Release 下载及跨版本在线升级，需在公开分发源确定并发布正式包后继续验收。当前本地测试不能替代这项线上验收。
