# 在线更新与发布

0.2.12 安装版加入应用内更新。旧版没有更新入口，因此第一次需要手动安装；之后在随手面板搜索栏右侧三点菜单选择「检查更新」，下载新版本，等待校验完成，再选择「保存草稿并重启更新」。更新保留本机内容、键位与设置。

更新不会在后台自行下载或在普通退出时偷偷安装。安装前保存 Markdown 和速记的随序草稿；外部 Markdown 原文件仍通过 Ctrl+S 写回。保存失败会取消安装，正在截图时也需先完成截图。更新包校验失败不得安装。开发模式与便携版不提供自动安装。

## 分发源

源码仓库 `huihui200739/suira-desktop` 保持私有。0.2.13 起，安装包、更新元数据和说明发布在公开的 [suira-updates](https://github.com/huihui200739/suira-updates)。客户端匿名检查和下载，不包含 GitHub 访问令牌。

`package.json` 的 `build.publish.repo` 已指向 `suira-updates`。维护者发布时使用进程环境变量 `UPDATE_RELEASE_TOKEN`，或本机已登录的 Git 凭据；凭据只在维护工具内存中使用，不写入仓库、安装包和用户配置。公开仓库只包含产品说明与 Release 产物，不镜像私有源码历史。

## 发布步骤

1. 更新 `package.json` / `package-lock.json` 的版本及 `CHANGELOG.md`，完成对应验证。
2. 运行 `npm run dist` 构建。该命令只生成产物，不发布。
3. 运行 `node tools/release-package-check.js`，生成已核对的构建清单，再运行 `npm run release:updates -- --draft`。工具仅上传安装包、`.blockmap`、`latest.yml` 和生成的 `SHA256SUMS.txt`，并核对远端每个文件的大小和 SHA256。说明来自 `docs/distribution/版本.md`。
4. 完成检查后运行 `npm run release:updates -- --publish`，将一致的草稿公开为正式 Release。安装版不读取草稿和预发布版本，也不降级安装。已上传的不同内容不会自动覆盖。

`.github/workflows/release-windows.yml` 支持手动触发或版本标签 `v版本号`，在 Windows 测试并构建。标签必须与包版本一致。默认 `GITHUB_TOKEN` 不能跨仓库发布；若需要 CI 自动上传草稿，可自行配置仅有 `suira-updates` 内容写入权限的 `UPDATE_RELEASE_TOKEN` Secret。未配置时不尝试跨仓库上传，仍保留可下载的构建产物，可在本机执行上述发布命令。本轮使用本机 Git 登录发布，没有复制本机凭据到 CI。

自动更新内部仍是下载并运行安装器，用户无需再次寻找下载地址或手动覆盖安装。本项目当前安装包尚未代码签名，SHA512 用于校验下载完整性，不代表发布者代码签名；Windows 可能仍显示安全提示。

## 验证

- `npm test`：包括更新状态流、显式下载、草稿保存失败时取消安装、未发布与不支持模式。
- `node tools/updater-network-check.js`：使用真实 Electron 与 electron-updater，从本机隔离 HTTP 服务下载无执行能力的测试文件，验证正确校验值通过、错误校验值被拒绝。不会执行安装器。
- `node tools/updater-public-check.js`：匿名检查公开更新源，模拟旧版下载完整安装包并验证 SHA512，随后确认当前版本返回已是最新版；使用隔离数据，不执行安装器。
- `npm run verify:launcher`：真实 Electron 验证 38 键全屏比例、更新菜单与开发模式提示。
- `node tools/release-package-check.js`：打包源码、更新配置与安装包校验元数据一致。
- `npm run verify:installer`：独立名称、独立路径的测试产品，验证安装、覆盖安装、等待旧进程退出、卸载及默认文件关联保持不变。不会替换用户正在使用的随序。
