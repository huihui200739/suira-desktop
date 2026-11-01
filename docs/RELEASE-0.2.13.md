# 0.2.13 公开更新源验收 · 2026-11-01

已发布 [随序 0.2.13](https://github.com/huihui200739/suira-updates/releases/tag/v0.2.13)。源码仓库 `suira-desktop` 保持私有；公开的 `suira-updates` 只包含产品 README、安装包、blockmap、latest.yml 和 SHA256 清单，不镜像源码历史。

验证结果：

- 实际构建配置和安装包内 `app-update.yml` 指向 `huihui200739/suira-updates`，93 个应用源码文件与包内字节一致。
- 四个远端 Release 文件的大小与 GitHub SHA256 摘要均与本机构建一致；匿名 API 能读取正式 Release。
- `node tools/updater-public-check.js` 使用真实 Electron / electron-updater、隔离数据与缓存，清除发布令牌后匿名测试：模拟 0.2.12 发现 0.2.13，下载完整安装包，SHA512 与本机构建一致；模拟 0.2.13 返回已是最新版。测试不执行安装器。
- `node tests/test-update-controller.js`、`node tools/updater-network-check.js` 通过；错误下载校验值被拒绝。
- `node tools/packaged-markdown-check.js` 通过：实际 0.2.13 窗口尺寸稳定、本地文件打开与保存、第二实例路由、启动台及应用绑定流程。
- 发布工具拒绝额外文件和不同的远端校验值；凭据只在维护工具进程内使用，没有加入客户端或复制到 CI。

本轮没有覆盖安装用户正在使用的随序。安装器等待退出与默认文件关联保护沿用已验证的 0.2.12 实现。当前安装包仍未代码签名，Windows 可能显示安全提示。构建大小与校验值见 [发布清单](release-0.2.13.json)。

首次接入公开更新源需手动安装 0.2.13 一次，后续正式版本可从三点菜单「检查更新」下载并重启安装。CI 自动跨仓库上传是可选配置，当前使用本机发布流程；无需为客户端配置任何令牌。
