# 0.2.36 主题验收

六个预设分别提供浅色与深色版本，明暗模式继续由现有设置控制。暖纸浅色底为 `#F6F2EA`、正文为 `#2A251F`，墨夜与午夜蓝深色底分别为 `#111113`、`#0F1722`。预设 CSS 仅提供 slate 和 accent 色阶，共享语义令牌在所有窗口复用。

壁纸使用 Windows 静态壁纸文件，通过 `lib/launchpad-background.js` 缩至最长边 64px，再在本机进行中位切分。主色饱和度限制为 40–75%，明度限制为 45–60%；中性文字和强调文字达到 4.5:1 对比度。动态主按钮保留白字，指定的 Jade/Cyan 预设按钮使用可读的黑字。壁纸或系统强调色暂时不可用时保留预设，并在设置中说明。

验证结果：

- `npm test`：通过，包含色阶、偏好存储、Windows 颜色事件、壁纸缺失回退、迟到结果保护、统一 preload、减少透明效果及颜色令牌检查。
- `npm run verify:themes`：真实 Electron 19 个窗口通过六个预设 × 两种明暗检查；覆盖三种 preload、首帧配色、原生 BGRA 像素顺序、64px 壁纸采样、Windows 颜色变化、壁纸替换和四档材质同步。详见 [机器记录](themes-0.2.36.json)。
- `node tools/panel-shot.js`：面板交互、键位绑定及十二张预设截图通过，预览使用全新默认键位；壁纸预览使用固定绿色样本。
- `npm run screenshots`：通过，刷新真实 Electron 展示图，并回归原生窗口边角、独立工具窗口、截图翻译与粘回、合并文字窗口和内容内轨迹。
- `npm run verify:glass`：通过，覆盖空闲工具回收、面板复用、可见窗口保护与再次打开。
- 安装包：136 个源码文件与实际 payload 逐字节一致，NSIS 完整性、原版字体与协议 SHA256、更新 feed SHA512 均通过。

预设截图位于 `docs/screenshots/theme-{preset}-{light|dark}.png`；设置页预览为 [theme-settings.png](screenshots/theme-settings.png)。测试使用独立资料目录和虚构壁纸，没有修改用户壁纸、Windows 强调色或应用数据。
