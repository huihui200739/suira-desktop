# 0.2.21 圆角与软件内更新

日期：2026-11-02。上一轮彩色物件、快速轻抬、单次反光、空键层次、行距及跨页面图标已完成；本轮处理用户新指出的灰色尖角和更新源落后。

## 圆角

旧版使用的 Windows accent blur 在真实桌面条纹背景中越过自定义 HWND 圆角区域；只检查 Page.captureScreenshot 或窗口 HRGN 的四个顶点，无法检查这层系统合成。新版圆角窗口采用稳定的 alpha 半透玻璃，停止未裁剪的原生背景模糊。现有配色、图标、键位动效与透明度档位保留；代价是桌面文字不再经过这条原生模糊路径。

工作台、日历和 Markdown 取消显式的 backgroundMaterial:none 初始化及重复材质设置，保留原有非透明窗口的原生最大化能力。透明浮窗保留原先透明创建方式；共用的原生圆角区域仍在显示、恢复和缩放后更新。

新增真实桌面验证：显式显示受控窗口，在采集前确认红蓝背景可见；用 GetWindowRect 与 GetWindowRgn/PtInRegion 确定真实物理边界和四角外像素，再比较窗口可见时与隐藏后同一条纹背景的屏幕像素。这样既不受 Electron/DPI 边界舍入误差干扰，也不把“圆角命中区域正确”误作“合成层没有外溢”。

六类窗口均通过，平均每通道差值在 0–0.20 范围（允许小于 2 的系统边缘误差）：[悬浮板](native-corners-panel-verification.json)、[工作台](native-corners-main-verification.json)、[日历](native-corners-calendar-verification.json)、[Markdown](native-corners-markdown-verification.json)、[剪贴板](native-corners-clipboard-verification.json)、[速记](native-corners-note-verification.json)。其他共用浮窗的原生四角、尺寸与恢复由 test:surfaces 检查。历史 native-blur-verification.json 保留 0.2.17 版本标识，不代表本版启用了背景模糊。

曾试用透明文档窗口，但 Electron 的原生最大化不生效，已撤回该改动；最后版本的原生最大化、恢复与工作区边界检查通过。直接启动工作区下打包 exe 没有建立调试连接，这次尝试未计为通过；使用源码 Electron 的原生实测及 100 个生产文件逐字节打包对比检查通过。

## 更新

排查时公开更新源最后正式版为 0.2.16，而本机为 0.2.20。这是最近改动无法从软件更新的原因，菜单与下载流程本身已经存在。

0.2.21 已发布到 [现有公开更新源](https://github.com/huihui200739/suira-updates/releases/tag/v0.2.21)。只上传安装包、blockmap、latest.yml、SHA256SUMS 四个允许的产物；每个远端文件的大小与 SHA256 均匹配本机。私有源码和用户数据未公开。

实际安装的 0.2.20 在隔离用户目录与独立缓存中，从三点菜单进入更新对话框，匿名发现 0.2.21，点击下载后到达 ready 状态，并显示“保存草稿并重启更新”。SHA512 校验通过，测试没有触发安装。详见 [安装版公开源下载验证](installed-update-download-verification.json) 和 [构建清单](release-0.2.21.json)。

当前由自动化启动的常规程序仍需用户从托盘退出，并从普通桌面重新打开一次，再在软件内完成升级，避免安装器继承受限环境。升级后的运行版本与数据另行核对；加密内容及密钥已在本机备份，不提交到仓库。

## 验证

- npm test 完整回归通过。
- verify:workspace：日历、Markdown 的保存/导出/重载等工作流通过。
- verify:launcher：图标、应用绑定、菜单、全屏与三个材质档位和重启记忆通过。
- test:surfaces：真实 HWND 圆角、各独立窗口、调整尺寸、最大化/恢复及任务栏避让通过。
- verify:installer-safety：普通/受限启动、用户数据保留和文件占用回滚通过。
- updater-network-check：正确 SHA512 下载通过，错误值被拒绝，未执行安装器。
- release-package-check：100 个生产文件、安装器 CRC、更新 feed、SHA512 与本机构建一致。

设计沿用用户确认的 0.2.20 方向；审查方法参考 Damir Sokolovsky 的 [unslop](https://github.com/heydamir/unslop)（CC BY 4.0）。

## 用户已完成软件内升级

用户确认已从软件内完成更新。本机实际程序版本为 0.2.21.0，exe 和 asar SHA256 与公开发布包一致；实际安装版的悬浮板、Markdown、日历、剪贴板材质与外观切换检查通过。再次从安装版菜单检查公开更新源，返回 current。工具现在等 38 个键位就绪后才点击菜单，避免将 preload 就绪当作页面事件已接线；该等待修正后检查通过，未将最初的测试超时算作通过。

现有加密内容、便签、任务的正文与标题、保护密钥和自定义绑定保留，解密通过。程序正常运行，未由自动化重新启动。卸载列表仍残留旧字段，本次确认已安装内容后同步校正为 0.2.21，未宣称根治该历史注册信息问题。交付记录见 [安装与数据核验](corners-delivery-verification.json) 和 [当前版本检查](installed-update-current-verification.json)。

收尾已运行 npm run clean -- -IncludeObsoletePackages，清理 31 项、约 833 MB 闲置测试缓存、旧包与重复构建；当前安装程序、桌面 0.2.21 安装包、依赖和加密快照保留。此前已被拒绝删除的旧程序备份未重试。
