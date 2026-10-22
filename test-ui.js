const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

console.log('\n== 主窗口 index.html ==');
const html = read('src/index.html');
const appJs = read('src/app.js');
const mainJs = read('main.js');

t('引用的 CSS 存在', () => { if (!fs.existsSync('src/styles.css')) throw new Error('styles.css 缺失'); });
t('引用的 JS 存在', () => { if (!fs.existsSync('src/app.js')) throw new Error('app.js 缺失'); });
t('图标资源存在', () => { if (!fs.existsSync('assets/suira-icon.png')) throw new Error('suira-icon.png 缺失'); });

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...appJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
const missingInHtml = [...jsIds].filter((id) => !htmlIds.has(id));
t('app.js 引用的所有 ID 都存在于 HTML', () => {
  if (missingInHtml.length) throw new Error('缺失: ' + missingInHtml.join(', '));
});

const pageIds = [...htmlIds].filter((id) => id.startsWith('page-'));
t('四个页面容器齐备', () => {
  const want = ['page-shelf', 'page-library', 'page-trail', 'page-settings'];
  const miss = want.filter((p) => !pageIds.includes(p));
  if (miss.length) throw new Error('缺失: ' + miss.join(', '));
});
t('nav 的 data-page 与页面 ID 对应', () => {
  const navs = [...html.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]);
  if (!navs.length) throw new Error('没有 nav');
  for (const n of navs) if (!htmlIds.has('page-' + n)) throw new Error('nav ' + n + ' 无对应页面');
});
t('筛选 chip 的 data-filter 合法', () => {
  const fs2 = [...html.matchAll(/data-filter="([^"]+)"/g)].map((m) => m[1]);
  const valid = ['all', 'text', 'image', 'files', 'link'];
  for (const f of fs2) if (!valid.includes(f)) throw new Error('非法 filter: ' + f);
});

console.log('\n== 前端 API 调用与 preload 一致性 ==');
const preload = read('preload.js');
const nsCalls = [...appJs.matchAll(/window\.suira\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => ({ ns: m[1], fn: m[2] }));
t('app.js 调用的每个 API 都在 preload 中暴露', () => {
  const missing = [];
  for (const c of nsCalls) {
    const re = new RegExp('\\b' + c.ns + ':\\s*\\{[\\s\\S]*?\\b' + c.fn + '\\s*:', 'm');
    if (!re.test(preload)) missing.push(c.ns + '.' + c.fn);
  }
  if (missing.length) throw new Error('未暴露: ' + [...new Set(missing)].join(', '));
});
const qpJs = read('src/quickpanel.js');
const qpCalls = [...qpJs.matchAll(/window\.suira\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => ({ ns: m[1], fn: m[2] }));
t('quickpanel.js 调用的每个 API 都在 preload 中暴露', () => {
  const missing = [];
  for (const c of qpCalls) {
    const re = new RegExp('\\b' + c.ns + ':\\s*\\{[\\s\\S]*?\\b' + c.fn + '\\s*:', 'm');
    if (!re.test(preload)) missing.push(c.ns + '.' + c.fn);
  }
  if (missing.length) throw new Error('未暴露: ' + [...new Set(missing)].join(', '));
});
const ovJs = read('src/overlay.js');
const ovCalls = [...ovJs.matchAll(/window\.suira\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => ({ ns: m[1], fn: m[2] }));
t('overlay.js 调用的每个 API 都在 preload 中暴露', () => {
  const missing = [];
  for (const c of ovCalls) {
    const re = new RegExp('\\b' + c.ns + ':\\s*\\{[\\s\\S]*?\\b' + c.fn + '\\s*:', 'm');
    if (!re.test(preload)) missing.push(c.ns + '.' + c.fn);
  }
  if (missing.length) throw new Error('未暴露: ' + [...new Set(missing)].join(', '));
});
t('三个前端文件都不再引用旧的 shunyu 命名空间', () => {
  const bad = [appJs, qpJs, ovJs].filter((s) => /window\.shunyu/.test(s));
  if (bad.length) throw new Error('仍有 shunyu 残留');
});

console.log('\n== quickpanel.html ==');
const qpHtml = read('src/quickpanel.html');
const qpIds = new Set([...qpHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const qpJsIds = new Set([...qpJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
t('quickpanel.js 引用的 ID 都存在', () => {
  const miss = [...qpJsIds].filter((id) => !qpIds.has(id));
  if (miss.length) throw new Error('缺失: ' + miss.join(', '));
});

console.log('\n== overlay.html ==');
const ovHtml = read('src/overlay.html');
const ovIds = new Set([...ovHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const ovJsIds = new Set([...ovJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
t('overlay.js 引用的 ID 都存在', () => {
  const miss = [...ovJsIds].filter((id) => !ovIds.has(id));
  if (miss.length) throw new Error('缺失: ' + miss.join(', '));
});
t('OCR 结果面板元素齐备', () => {
  for (const id of ['ocr-result', 'ocr-result-text', 'ocr-result-copy', 'ocr-result-shelf', 'ocr-result-retry', 'ocr-result-close']) {
    if (!ovIds.has(id)) throw new Error('缺失 ' + id);
  }
});
t('OCR 面板样式已定义', () => {
  const css = read('src/overlay.css');
  for (const sel of ['.ocr-result', '.ocr-result-actions', '#ocr-result-text']) {
    if (!css.includes(sel)) throw new Error('缺少样式 ' + sel);
  }
});

console.log('\n== styles.css 覆盖检查 ==');
const css = read('src/styles.css');
t('所有主要结构类都有样式', () => {
  const need = ['app-shell','titlebar','sidebar','nav-item','main-scroll','page','page-head','shelf-layout','task-column','task-detail','task-timeline','shelf-card','library-grid','trail-summary','trail-row','settings-grid','setting-card','modal','global-toast'];
  const miss = need.filter((c) => !new RegExp('\\.' + c + '\\b').test(css));
  if (miss.length) throw new Error('缺少: ' + miss.join(', '));
});
t('使用雾蓝品牌色而非旧的绿色', () => {
  if (!css.includes('#506f9e') && !css.includes('#506F9E')) throw new Error('缺少雾蓝主色');
  if (/#62dba0|#64dca2/i.test(css)) throw new Error('仍含旧绿色');
});
t('定义了深浅两套配色', () => {
  if (!css.includes('prefers-color-scheme: dark')) throw new Error('缺少深色模式');
});

console.log('\n== 新增能力接线检查 ==');
t('preload 暴露 recipes 与 search', () => {
  if (!/recipes:\s*\{[\s\S]*?run\s*:/.test(preload)) throw new Error('缺少 recipes.run');
  if (!/search:\s*\{[\s\S]*?query\s*:/.test(preload)) throw new Error('缺少 search.query');
});
t('main.js 注册了 recipes 与 search 处理器', () => {
  for (const ch of ['recipes:list', 'recipes:run', 'search:query']) {
    if (!mainJs.includes(`ipcMain.handle('${ch}'`)) throw new Error('缺少处理器 ' + ch);
  }
});
t('main.js 引入配方/搜索/剪贴板守卫模块', () => {
  for (const m of ['./lib/recipes', './lib/search', './lib/clipboard-guard']) {
    if (!mainJs.includes(`require('${m}')`)) throw new Error('缺少 require ' + m);
  }
});
t('剪贴板记录接入敏感排除与超大内容处理', () => {
  if (!mainJs.includes('shouldExcludeCapture')) throw new Error('未接入敏感排除');
  if (!mainJs.includes('summarizeLargeText')) throw new Error('未接入超大内容处理');
  if (!mainJs.includes('readWithRetry')) throw new Error('未接入锁竞争重试');
});
t('quickpanel 命令区元素齐备', () => {
  for (const id of ['command-section', 'command-list']) {
    if (!qpIds.has(id)) throw new Error('缺少 ' + id);
  }
});
t('quickpanel 样式包含命令项', () => {
  const qcss = read('src/quickpanel.css');
  for (const sel of ['.command-section', '.command-item', '.command-copy']) {
    if (!qcss.includes(sel)) throw new Error('缺少样式 ' + sel);
  }
});
t('quickpanel 使用拼音搜索接口', () => {
  if (!qpJs.includes('window.suira.search.query')) throw new Error('未调用 search.query');
});
t('quickpanel 支持配方执行', () => {
  if (!qpJs.includes('window.suira.recipes.run')) throw new Error('未调用 recipes.run');
});

console.log('\n== 38 键动作面板（复刻第一批）==');
t('quickpanel 有 38 键容器、应用面板与工具箱三个主体', () => {
  for (const id of ['key-grid', 'apps-panel', 'toolbox-panel', 'toolbox', 'mode-chip']) {
    if (!qpIds.has(id)) throw new Error('缺少 ' + id);
  }
});
t('quickpanel 样式包含 38 键布局、应用网格与工具箱', () => {
  const qcss = read('src/quickpanel.css');
  for (const sel of ['.keyboard', '.key-row', '.key-card', '.key-badge', '.apps-grid', '.app-icon', '.tool-grid', '.tool-item']) {
    if (!qcss.includes(sel)) throw new Error('缺少样式 ' + sel);
  }
});
t('行间缩进按物理键盘相对位置（数字行 / QWERTY / ASDF / ZXCV）', () => {
  const qcss = read('src/quickpanel.css');
  for (const row of [1, 2, 3]) {
    if (!qcss.includes(`.key-row[data-row="${row}"]`)) throw new Error('缺少第 ' + row + ' 行缩进规则');
  }
});
t('键位模型独立成模块且是唯一来源', () => {
  if (!fs.existsSync('lib/keybindings.js')) throw new Error('缺少 lib/keybindings.js');
  const kb = read('lib/keybindings.js');
  if (!kb.includes('KEY_ROWS')) throw new Error('缺少 KEY_ROWS');
  if (!kb.includes('module.exports')) throw new Error('未导出键位模型');
  // 渲染层不得自己再写一份键位表：否则两处定义必然漂移
  if (/KEY_ROWS\s*=\s*\[/.test(qpJs)) throw new Error('quickpanel.js 里重复定义了键位表');
});
t('主进程用键位模型生成面板状态', () => {
  if (!mainJs.includes("require('./lib/keybindings')")) throw new Error('main.js 未引入键位模型');
  if (!mainJs.includes('keyLayout')) throw new Error('main.js 未使用 keyLayout');
});
t('未绑定与未实现键都有明确状态，不冒充可用', () => {
  const kb = read('lib/keybindings.js');
  for (const state of ['unbound', 'unimplemented', 'bound']) {
    if (!kb.includes(`'${state}'`)) throw new Error('缺少状态 ' + state);
  }
  if (!qpJs.includes('is-unbound') || !qpJs.includes('is-unimplemented')) throw new Error('渲染层未区分未绑定/未实现');
  if (!qpJs.includes('尚未实现')) throw new Error('未实现动作缺少明确提示');
});
t('按键与鼠标点击走同一执行通道', () => {
  // pressKey 是唯一入口：键盘直达和 click 都必须经过它
  if (!/function pressKey/.test(qpJs)) throw new Error('缺少 pressKey');
  const clickBinding = qpJs.match(/\.key', grid\)\.forEach\(\(button\) => \{\s*button\.addEventListener\('click', \(\) => pressKey\(button\.dataset\.key\)\)/);
  if (!clickBinding) throw new Error('键位点击未走 pressKey');
  if (!/keyByChar\(event\.key\)/.test(qpJs)) throw new Error('键盘直达未走 keyByChar');
});
t('面板执行通道对未实现动作直接拒绝', () => {
  if (!mainJs.includes('PANEL_ACTIONS[id].implemented')) throw new Error('主进程未拦截未实现动作');
});
t('空格切换动作/应用面板', () => {
  if (!qpJs.includes('toggleApps')) throw new Error('缺少 toggleApps');
  if (!qpJs.includes("event.key === ' '")) throw new Error('未绑定空格键');
});
t('应用面板走开始菜单索引并带图标', () => {
  if (!mainJs.includes('app.getFileIcon')) throw new Error('未提取应用图标');
  if (!mainJs.includes("ipcMain.handle('apps:list'")) throw new Error('缺少 apps:list');
  if (!mainJs.includes("ipcMain.handle('apps:icons'")) throw new Error('缺少 apps:icons');
  if (!qpJs.includes('window.suira.apps.list')) throw new Error('渲染层未取应用列表');
  if (!qpJs.includes('window.suira.apps.icons')) throw new Error('渲染层未按需取图标');
});
t('面板图标缓存避免每次打开都重新提取', () => {
  if (!mainJs.includes('appIconCache.has')) throw new Error('缺少图标缓存读取');
  if (!mainJs.includes('appIconCache.set')) throw new Error('缺少图标缓存写入');
});
t('工具箱未完成工具显示明确状态', () => {
  if (!qpJs.includes('is-todo')) throw new Error('缺少未完成样式标记');
  const qcss = read('src/quickpanel.css');
  if (!qcss.includes('.tool-item.is-todo')) throw new Error('缺少 .tool-item.is-todo 样式');
});
t('面板状态接口暴露 rows/keys/tools', () => {
  if (!mainJs.includes("ipcMain.handle('panel:state'")) throw new Error('缺少 panel:state');
  if (!mainJs.includes('tools: TOOLBOX_TOOLS')) throw new Error('panel:state 未返回工具箱目录');
});
t('面板尺寸能装下 38 键与搜索条', () => {
  const width = Number((mainJs.match(/const QUICK_WIDTH = (\d+)/) || [])[1]);
  const height = Number((mainJs.match(/const QUICK_HEIGHT = (\d+)/) || [])[1]);
  if (!(width >= 700)) throw new Error('面板过窄：' + width);
  if (!(height >= 560)) throw new Error('面板过矮：' + height);
});

console.log('\n== 第二批：已复现缺陷的回归断言 ==');
t('配方 ID 与配方定义一致（曾指向不存在的 capture-to-text）', () => {
  const { COMMANDS, RECIPE_IDS } = require('./lib/search');
  const { RECIPES } = require('./lib/recipes');
  const valid = new Set(RECIPES.map((r) => r.id));
  const recipeCommands = COMMANDS.filter((c) => String(c.action).startsWith('recipe:'));
  if (!recipeCommands.length) throw new Error('没有配方类命令');
  for (const command of recipeCommands) {
    const id = command.action.slice('recipe:'.length);
    if (!valid.has(id)) throw new Error(`${command.id} 指向不存在的配方 ${id}`);
  }
  // 命令里的配方 id 必须来自 RECIPES，不允许再手写字符串
  for (const id of Object.values(RECIPE_IDS)) {
    if (!valid.has(id)) throw new Error('RECIPE_IDS 含不存在的配方 ' + id);
  }
  const src = read('lib/search.js');
  if (/recipe:[a-z]/.test(src)) throw new Error('lib/search.js 里仍有手写配方 id');
});
t('搜索模式下的键盘只服务结果列表，不误触 38 键动作', () => {
  // 曾经：document 上的 Enter 直接取 state.actions[focusIndex]，搜索时执行错动作
  if (/state\.actions\[state\.focusIndex\]/.test(qpJs)) throw new Error('仍从 state.actions 取 Enter 目标');
  const searchGuard = qpJs.match(/if \(state\.query\) \{[\s\S]{0,700}?runCommand\(state\.commandIndex\)/);
  if (!searchGuard) throw new Error('搜索模式下没有把 Enter 交给 runCommand');
  if (!qpJs.includes("if (event.key === 'Enter') {\n      if (!state.commandResults.length)")) {
    throw new Error('搜索框 Enter 在无结果时未做明确处理');
  }
});
t('搜索无结果时按 Enter 给出反馈而不是静默', () => {
  if (!qpJs.includes('还在搜索')) throw new Error('缺少搜索中提示');
});
t('搜索命令的应用候选使用 appPath，不靠剥 id 前缀', () => {
  if (!qpJs.includes('entry.appPath')) throw new Error('未使用 appPath');
  const { COMMANDS } = require('./lib/search');
  if (!COMMANDS.every((c) => c.id && c.kind === 'command')) throw new Error('命令表结构异常');
});
t('Ctrl+A 在文本框里不再触发全屏选区', () => {
  const overlay = read('src/overlay.js');
  if (!overlay.includes('isTextInput')) throw new Error('缺少文本输入焦点判断');
  const ctrlA = overlay.match(/if \(event\.ctrlKey && key === 'a'\)[\s\S]{0,260}?\n    \}/);
  if (!ctrlA) throw new Error('缺少 Ctrl+A 处理');
  // 全屏选区必须在 isTextInput 早退之后
  const guardIndex = overlay.indexOf('isTextInput');
  const ctrlAIndex = overlay.indexOf("if (event.ctrlKey && key === 'a')");
  if (guardIndex < 0 || guardIndex > ctrlAIndex) throw new Error('Ctrl+A 早于文本输入判断，仍会误触发');
});
t('OCR 结果面板有「查看原图」按钮且有渲染目标', () => {
  const overlayHtml = read('src/overlay.html');
  if (!overlayHtml.includes('id="ocr-result-original"')) throw new Error('缺少查看原图按钮');
  if (!overlayHtml.includes('id="original-viewer"')) throw new Error('缺少原图查看器容器');
  if (!overlayHtml.includes('id="original-image"')) throw new Error('缺少原图 img');
  const overlay = read('src/overlay.js');
  if (!overlay.includes("$('#ocr-result-original').addEventListener")) throw new Error('查看原图没有 handler');
  if (!overlay.includes('withoutAnnotations')) throw new Error('原图未排除标注');
  const ocss = read('src/overlay.css');
  if (!ocss.includes('.original-viewer')) throw new Error('缺少原图查看器样式');
});
t('面板 OCR 结果也能查看原图（主进程反查来源图片）', () => {
  if (!qpJs.includes("$('#ocr-original')")) throw new Error('quickpanel 缺少查看原图接线');
  if (!qpJs.includes('content.openOriginal')) throw new Error('未调用 openOriginal');
  if (!mainJs.includes("ipcMain.handle('content:open-original'")) throw new Error('缺少 content:open-original');
  if (!mainJs.includes('originItemId')) throw new Error('未按 originItemId 反查来源');
  const preload = read('preload.js');
  if (!preload.includes('openOriginal')) throw new Error('preload 未暴露 openOriginal');
});
t('确认文字必须逐字匹配才允许提交', () => {
  if (!appJs.includes('options.expect')) throw new Error('openModal 未接收确认词');
  if (!appJs.includes("input.value.trim() === expect")) throw new Error('未做逐字校验');
  if (!appJs.includes('confirmBtn.disabled = !ok')) throw new Error('未在未匹配时禁用确认');
  // 两处危险操作都必须传 expect
  if (!/expect: '清空'/.test(appJs)) throw new Error('清空剪贴板未要求确认词');
  if (!/expect: task\.title/.test(appJs)) throw new Error('删除任务未要求输入任务名');
  if (!html.includes('id="modal-hint"')) throw new Error('缺少确认提示元素');
});
t('面板截图入口带意图，O 提字 / P 钉图框完即出结果', () => {
  // 意图由 lib/panel-actions.js 决定（可测），main.js 只负责把 capture 接上
  if (!mainJs.includes('intent')) throw new Error('主进程未传递入口意图');
  if (!/capture: \(intent\) => beginScreenCapture\('panel', \{ intent \}\)/.test(mainJs)) {
    throw new Error('main.js 未把入口意图交给截图');
  }
  const panelActions = read('lib/panel-actions.js');
  if (!panelActions.includes("return startCapture('ocr')")) throw new Error('OCR 入口未带意图');
  if (!panelActions.includes("return startCapture('pin')")) throw new Error('钉图入口未带意图');
  const overlay = read('src/overlay.js');
  if (!overlay.includes('applyIntent')) throw new Error('覆盖层未应用意图');
  if (!overlay.includes('autoAdvanceForIntent')) throw new Error('覆盖层未按意图自动推进');
  if (!overlay.includes('intentAutoDone')) throw new Error('缺少重复触发保护');
});
t('截图完成后按意图回到内容库，不留下悬空窗口', () => {
  if (!mainJs.includes('payload?.action !== \'ocr\'')) throw new Error('OCR 完成时未保留覆盖层供结果面板使用');
  const overlay = read('src/overlay.js');
  if (!overlay.includes('closeOcrResult')) throw new Error('缺少 OCR 结果关闭');
});

t('面板执行层惰性创建（store/actions 在 initialize 后才赋值）', () => {
  // 曾经在模块顶层直接 createPanelActions({store, actions})，而两者此刻是 null，
  // 会把 null 永久捕获进去，第一次按键就 TypeError
  if (!/let panelActions = null/.test(mainJs)) throw new Error('panelActions 不是惰性创建');
  if (!/function getPanelActions\(\)/.test(mainJs)) throw new Error('缺少 getPanelActions');
  if (/^const panelActions = createPanelActions/m.test(mainJs)) throw new Error('仍在模块顶层直接创建执行层');
  if (!mainJs.includes('getPanelActions().run(actionId)')) throw new Error('执行入口未走惰性实例');
});
t('面板执行逻辑独立成可测模块', () => {
  if (!fs.existsSync('lib/panel-actions.js')) throw new Error('缺少 lib/panel-actions.js');
  const pa = read('lib/panel-actions.js');
  if (!pa.includes('createPanelActions')) throw new Error('缺少工厂函数');
  if (!pa.includes('module.exports')) throw new Error('未导出');
  // 副作用必须走注入，不能在模块里直接 require electron
  if (/require\('electron'\)/.test(pa)) throw new Error('执行层不应直接依赖 electron，否则无法测试');
});
t('动作结果能带用户去结果页（openPage 有渲染层处理）', () => {
  if (!qpJs.includes('result.openPage')) throw new Error('渲染层未处理 openPage');
  if (!qpJs.includes('quick.showMain(result.openPage)')) throw new Error('openPage 未接到主窗口跳转');
});

console.log('\n== 第三批差距表与证据链 ==');
t('第三批差距表存在且覆盖全部模块', () => {
  if (!fs.existsSync('docs/BATCH3-GAP-ANALYSIS.md')) throw new Error('缺少 docs/BATCH3-GAP-ANALYSIS.md');
  const doc = read('docs/BATCH3-GAP-ANALYSIS.md');
  for (const module of ['文件中转', '边缘入口', '自定义唤起', '右键', '长截图', '录屏', '速记', '翻译']) {
    if (!doc.includes(module)) throw new Error('差距表缺少模块：' + module);
  }
  // 方案要求：不以占位界面宣称完成。差距表必须写边界声明
  if (!doc.includes('未运行原产品验证任何行为')) throw new Error('缺少证据边界声明');
});
t('差距表依据的原始证据文件确实存在', () => {
  const base = 'Suira-Windows-Docs/Suira-Windows-Docs/research/function-analysis';
  for (const file of ['fuyin-arm64.macho', 'objc-methods.json', 'otool-objc.txt']) {
    if (!fs.existsSync(path.join(base, file))) throw new Error('缺少证据文件 ' + file);
  }
});
t('证据提取脚本可复现且不改动原程序', () => {
  if (!fs.existsSync('tools/fuyin-modules.js')) throw new Error('缺少 tools/fuyin-modules.js');
  const tool = read('tools/fuyin-modules.js');
  // 只读：不得出现写原程序、执行原程序
  if (/writeFileSync\(.*\.macho/.test(tool)) throw new Error('脚本会写原程序文件');
  if (/execSync|spawnSync|child_process/.test(tool)) throw new Error('脚本不应执行外部程序');
  if (!tool.includes('objc-methods.json')) throw new Error('未指明数据来源');
});
t('右键范围已在差距表中纠正（原件指键帽/钉图，非 Explorer）', () => {
  const doc = read('docs/BATCH3-GAP-ANALYSIS.md');
  if (!doc.includes('不是 Windows 资源管理器右键菜单')) {
    throw new Error('未纠正右键范围的误读');
  }
  if (!doc.includes('PinClipboardReceiverRightClickView')) throw new Error('缺少右键类的证据');
});
t('差距表如实标注第三批实现进度（不把未完成写成已完成）', () => {
  const doc = read('docs/BATCH3-GAP-ANALYSIS.md');
  const zeroRows = doc.split('\n').filter((line) => line.includes('| **0**'));
  // 本轮交付 2 项（浮引岛 MVP、自定义唤起增量），其余 6 项仍为 0，不能虚报
  if (zeroRows.length !== 6) throw new Error('应仍有 6 个模块实现量为 0，实际 ' + zeroRows.length);
  if (!doc.includes('**MVP**') && !doc.includes('**增量已实现**')) throw new Error('缺少已实现项的状态标注');
  if (doc.includes('已复刻全部')) throw new Error('差距表出现夸大表述');
});

t('快捷键恢复默认/清除绑定已接到界面', () => {
  const html = read('src/index.html');
  const appJs = read('src/app.js');
  const preload = read('preload.js');
  // 界面元素存在
  if (!html.includes('id="shortcut-restore"')) throw new Error('缺少「恢复默认」按钮');
  if (!html.includes('data-shortcut-clear="quick"')) throw new Error('缺少随手面板「清除绑定」');
  if (!html.includes('data-shortcut-clear="capture"')) throw new Error('缺少区域截图「清除绑定」');
  // 渲染层调用
  if (!appJs.includes('shortcuts.restoreDefault')) throw new Error('恢复默认未接线');
  if (!appJs.includes('shortcuts.clear')) throw new Error('清除绑定未接线');
  // preload 暴露
  if (!preload.includes("'shortcuts:restore-default'")) throw new Error('preload 未暴露 restore-default');
  if (!preload.includes("'shortcuts:clear'")) throw new Error('preload 未暴露 clear');
  // 清除后要有可见状态，不能静默
  if (!appJs.includes('未绑定，点击输入框可重新设置')) throw new Error('清除后缺少状态提示');
});

t('按住型唤起已实现且有独立测试', () => {
  const shortcuts = read('lib/shortcuts.js');
  if (!shortcuts.includes('class MomentaryWatcher')) throw new Error('缺少按住型状态机');
  if (!shortcuts.includes('MomentaryWatcher')) throw new Error('未导出');
  // 依据：原产品 KeyboardMonitorService 有 momentary 语义
  const doc = read('docs/BATCH3-GAP-ANALYSIS.md');
  if (!doc.includes('onMomentaryActivationShortcut')) throw new Error('差距表缺少 momentary 证据');
});

t('真机验证清单存在且覆盖关键路径', () => {
  if (!fs.existsSync('docs/REAL-MACHINE-CHECKLIST.md')) throw new Error('缺少真机验证清单');
  const doc = read('docs/REAL-MACHINE-CHECKLIST.md');
  // 清单必须提醒 ELECTRON_RUN_AS_NODE：这个变量会让窗口不出现
  if (!doc.includes('ELECTRON_RUN_AS_NODE')) throw new Error('清单未提醒 ELECTRON_RUN_AS_NODE');
  // 必须包含自检入口
  if (!doc.includes('npm run diag')) throw new Error('清单未包含自检入口');
  // 必须说明「不会假装已验证」
  if (!doc.includes('我不会假装已验证')) throw new Error('清单缺少诚实性声明');
  // 必须区分「已验证」与「仍需人工确认」两段
  if (!doc.includes('## 已验证（真实 Electron，非模拟）')) throw new Error('缺少已验证段落');
  if (!doc.includes('## 仍需人工确认（只能人眼看）')) throw new Error('缺少待人工确认段落');
  // 关键人工验证项必须在场：Ctrl+A 焦点隔离、查看原图、清除绑定
  if (!doc.includes('Ctrl+A')) throw new Error('缺少 Ctrl+A 焦点隔离项');
  if (!doc.includes('查看原图')) throw new Error('缺少查看原图项');
  if (!doc.includes('清除绑定')) throw new Error('缺少清除绑定项');
});

t('真实 Electron 验证脚本存在且不依赖无头浏览器', () => {
  for (const file of ['tools/electron-real-check.js', 'tools/electron-verify.js', 'tools/electron-capture-check.js']) {
    if (!fs.existsSync(file)) throw new Error('缺少 ' + file);
    const src = read(file);
    // 必须是连真实 Electron 的 CDP，而不是拉起 headless Chrome
    if (src.includes('--headless')) throw new Error(file + ' 仍在使用无头浏览器');
    if (!src.includes('json/list')) throw new Error(file + ' 未连接 CDP');
  }
  // 启动器必须解释为什么用工作区外的 Electron
  const launcher = read('tools/electron-real-check.js');
  if (!launcher.includes('0x80000003')) throw new Error('启动器未说明 ACL 限制的原因');
});

t('诊断报告包含排查真机问题所需的全部区块', () => {
  const mainJs = read('main.js');
  const start = mainJs.indexOf('async function collectDiagnostics(');
  if (start < 0) throw new Error('缺少 collectDiagnostics');
  const body = mainJs.slice(start);
  for (const section of ['环境', '窗口', '快捷键', '能力', '最近内容', '设置']) {
    if (!body.includes(`section('${section}')`)) throw new Error('自检缺少区块：' + section);
  }
});

console.log('\n== 放回子系统接线检查 ==');
t('preload 暴露 returnTo 与 openApp', () => {
  if (!/returnTo:\s*\{[\s\S]*?commit\s*:/.test(preload)) throw new Error('缺少 returnTo.commit');
  if (!/openApp\s*:/.test(preload)) throw new Error('缺少 quick.openApp');
});
t('main.js 注册放回与应用启动处理器', () => {
  for (const ch of ['return:target', 'return:commit', 'quick:open-app']) {
    if (!mainJs.includes(`ipcMain.handle('${ch}'`)) throw new Error('缺少处理器 ' + ch);
  }
});
t('main.js 引入放回/应用索引/前台探测模块', () => {
  for (const m of ['./lib/return-target', './lib/app-index', './lib/foreground-probe']) {
    if (!mainJs.includes(`require('${m}')`)) throw new Error('缺少 require ' + m);
  }
});
t('显示面板前先记录目标窗口（顺序正确）', () => {
  const fn = mainJs.slice(mainJs.indexOf('function showQuickPanel'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  const recordAt = body.indexOf('rememberReturnTarget');
  const showAt = body.indexOf('quickWindow.show()');
  if (recordAt < 0) throw new Error('未调用 rememberReturnTarget');
  if (showAt < 0) throw new Error('未调用 show()');
  if (recordAt > showAt) throw new Error('记录目标的时机晚于显示窗口，会读到自己');
});
t('剪贴板自写回环接入账本', () => {
  if (!mainJs.includes('clipboardLedger.shouldIgnore')) throw new Error('未接入回环防护');
  if (!mainJs.includes('clipboardLedger.record')) throw new Error('未记录自身写入');
});
t('退出时释放前台探测进程', () => {
  if (!mainJs.includes('foregroundProbe.dispose()')) throw new Error('未释放辅助进程');
});
t('随手面板放回条元素齐备', () => {
  for (const id of ['return-bar', 'return-target-text', 'return-commit']) {
    if (!qpIds.has(id)) throw new Error('缺少 ' + id);
  }
});t('随手面板放回条样式已定义', () => {
  const qcss = read('src/quickpanel.css');
  for (const sel of ['.return-bar', '.return-target']) {
    if (!qcss.includes(sel)) throw new Error('缺少样式 ' + sel);
  }
});
t('随手面板调用放回提交接口', () => {
  if (!qpJs.includes('window.suira.returnTo.commit')) throw new Error('未调用 returnTo.commit');
});
t('应用搜索接入 search:query', () => {
  if (!mainJs.includes('appIndex.candidates')) throw new Error('应用索引未接入搜索');
});

console.log('\n== 快捷键与加密接线检查 ==');
t('preload 暴露 shortcuts', () => {
  if (!/shortcuts:\s*\{[\s\S]*?set\s*:/.test(preload)) throw new Error('缺少 shortcuts.set');
  if (!/onChanged\s*:\s*\(callback\)\s*=>\s*subscribe\('shortcuts:changed'/.test(preload)) {
    throw new Error('缺少 shortcuts.onChanged 订阅');
  }
});
t('main.js 注册快捷键处理器', () => {
  for (const ch of ['shortcuts:get', 'shortcuts:set']) {
    if (!mainJs.includes(`ipcMain.handle('${ch}'`)) throw new Error('缺少处理器 ' + ch);
  }
});
t('main.js 引入快捷键与加密模块', () => {
  for (const m of ['./lib/shortcuts', './lib/crypto-store']) {
    if (!mainJs.includes(`require('${m}')`)) throw new Error('缺少 require ' + m);
  }
});
t('热键注册走 ShortcutManager 而非裸 register', () => {
  if (!mainJs.includes('new ShortcutManager')) throw new Error('未使用 ShortcutManager');
  if (!mainJs.includes('shortcutManager.registerAll()')) throw new Error('未调用 registerAll');
});
t('热键注册失败会广播给界面', () => {
  if (!mainJs.includes("broadcast('shortcuts:changed'")) throw new Error('未广播注册状态');
});
t('退出时释放快捷键', () => {
  if (!mainJs.includes('shortcutManager.dispose()') && !mainJs.includes('shortcutManager?.dispose()')) {
    throw new Error('未释放快捷键');
  }
});
t('初始化时创建数据密钥', () => {
  if (!mainJs.includes('keyVault.loadOrCreate')) throw new Error('未创建数据密钥');
  if (!mainJs.includes('keyPath()')) throw new Error('缺少密钥路径');
});
t('store 支持 codec 注入', () => {
  const store = read('lib/store.js');
  if (!store.includes('this.codec')) throw new Error('store 未支持 codec');
  if (!store.includes('isEncrypting')) throw new Error('缺少 isEncrypting');
});
t('解密在 cleanItem 之前执行（避免 [object Object]）', () => {
  const store = read('lib/store.js');
  const decodeAt = store.indexOf('map(decodeItem)');
  const cleanAt = store.indexOf('.map(cleanItem)');
  if (decodeAt < 0) throw new Error('未找到 decodeItem');
  if (cleanAt < 0) throw new Error('未找到 cleanItem');
  if (decodeAt > cleanAt) throw new Error('解密晚于清理，加密信封会被转成字符串');
});
t('设置页有加密开关与改键输入框', () => {
  for (const id of ['setting-encrypt', 'setting-key-quick', 'setting-key-capture', 'status-quick', 'status-capture']) {
    if (!htmlIds.has(id)) throw new Error('缺少 ' + id);
  }
});
t('app.js 调用 shortcuts 接口', () => {
  if (!appJs.includes('window.suira.shortcuts.get')) throw new Error('未调用 shortcuts.get');
  if (!appJs.includes('window.suira.shortcuts.set')) throw new Error('未调用 shortcuts.set');
});
t('改键样式已定义', () => {
  for (const sel of ['.shortcut-input', '.shortcut-status']) {
    if (!css.includes(sel)) throw new Error('缺少样式 ' + sel);
  }
});

console.log('\n== IPC 通道一致性（防死通道）==');
t('preload 的每个 invoke 通道都有 main handler', () => {
  const invoked = [...new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]))];
  const handled = new Set([...mainJs.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
  const missing = invoked.filter((ch) => !handled.has(ch));
  if (missing.length) throw new Error('缺少 handler：' + missing.join(', '));
});
t('main 没有前端用不到的孤儿 handler', () => {
  const invoked = new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
  const handled = [...new Set([...mainJs.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]))];
  const orphans = handled.filter((ch) => !invoked.has(ch));
  if (orphans.length) throw new Error('孤儿 handler：' + orphans.join(', '));
});
t('旧 clipboard 命名空间已移除（与 content 重复）', () => {
  if (preload.includes('clipboard: {')) throw new Error('preload 仍有 clipboard 命名空间');
  if (/ipcMain\.handle\('clipboard:/.test(mainJs)) throw new Error('main 仍有 clipboard:* handler');
});
t('preload 订阅的每个事件都有发送方', () => {
  const subs = [...new Set([...preload.matchAll(/subscribe\('([^']+)'/g)].map((m) => m[1]))];
  const sends = new Set([
    ...[...mainJs.matchAll(/broadcast\('([^']+)'/g)].map((m) => m[1]),
    ...[...mainJs.matchAll(/webContents\.send\('([^']+)'/g)].map((m) => m[1])
  ]);
  const dead = subs.filter((ch) => !sends.has(ch));
  if (dead.length) throw new Error('无人发送：' + dead.join(', '));
});

console.log('\n== 内容库新增交互 ==');
t('清空剪贴板记录：通道与按钮齐备', () => {
  if (!mainJs.includes("ipcMain.handle('content:clear-clipboard'")) throw new Error('缺少 handler');
  if (!preload.includes('clearClipboard')) throw new Error('preload 未暴露');
  if (!htmlIds.has('library-clear')) throw new Error('缺少按钮');
  if (!appJs.includes('content.clearClipboard')) throw new Error('未绑定点击');
});
t('清空操作需要输入确认词（防误删）', () => {
  if (!appJs.includes("输入「清空」以确认")) throw new Error('缺少确认步骤');
  if (!appJs.includes("value !== '清空'")) throw new Error('未校验确认词');
});
t('固定内容：按钮、标记与接口齐备', () => {
  if (!appJs.includes('data-fix=')) throw new Error('缺少固定按钮');
  if (!appJs.includes('content.togglePin')) throw new Error('未调用 togglePin');
  if (!appJs.includes('pin-mark')) throw new Error('缺少固定标记');
  if (!css.includes('.pin-mark')) throw new Error('缺少固定标记样式');
});
t('固定项不会被保留策略清理（store 层）', () => {
  const store = read('lib/store.js');
  if (!/prune[\s\S]{0,600}?pinned/.test(store)) throw new Error('prune 未跳过固定项');
});
t('最大化按钮同步图标状态', () => {
  if (!appJs.includes('syncMaximizeIcon')) throw new Error('缺少 syncMaximizeIcon');
  if (!appJs.includes('window.suira.window.maximize()')) throw new Error('未调用 maximize');
});
t('content:list 为缺缩略图的图片条目补齐', () => {
  if (!mainJs.includes('thumbnailFor(item.filePath)')) throw new Error('未补齐缩略图');
  if (!/kind === 'image' && !item\.thumbnail/.test(mainJs)) throw new Error('未判断缩略图缺失');
});
t('旧 clipboard 渲染函数已删除（无死代码）', () => {
  if (mainJs.includes('renderClipboardRecord')) throw new Error('renderClipboardRecord 仍存在');
});

console.log('\n== 钉图窗口（缩放 / 透明度 / 临时收起）==');
t('钉图使用独立 preload 暴露 pinApi', () => {
  const pinPreload = read('pin-preload.js');
  for (const fn of ['resize', 'setOpacity', 'collapse', 'bounds', 'close']) {
    if (!pinPreload.includes(fn)) throw new Error('pinApi 缺少 ' + fn);
  }
});
t('钉图窗口挂载了 pin-preload', () => {
  if (!mainJs.includes("preload: path.join(__dirname, 'pin-preload.js')")) {
    throw new Error('未挂载 pin-preload');
  }
});
t('钉图窗口注册了全部 pin:* 通道', () => {
  for (const ch of ['pin:resize', 'pin:opacity', 'pin:collapse', 'pin:bounds', 'pin:close']) {
    if (!mainJs.includes(`'${ch}'`)) throw new Error('缺少通道 ' + ch);
  }
});
t('缩放有上下限（不会缩到不可见或撑爆屏幕）', () => {
  if (!/Math\.min\(3, Math\.max\(0\.25/.test(mainJs)) throw new Error('渲染侧缩放未限幅');
  if (!/Math\.max\(80, Math\.min\(4000/.test(mainJs)) throw new Error('主进程尺寸未限幅');
});
t('透明度有下限（不会变成完全不可见）', () => {
  if (!/Math\.max\(0\.25, Math\.min\(1/.test(mainJs)) throw new Error('透明度未限幅');
});
t('临时收起保存并恢复原边界', () => {
  if (!mainJs.includes('savedBounds')) throw new Error('未保存原边界');
  if (!mainJs.includes('state.collapsed')) throw new Error('缺少收起状态');
});
t('钉图窗口只接受自身窗口的指令（防越权）', () => {
  if (!mainJs.includes('pinFromEvent')) throw new Error('缺少来源校验');
  if (!mainJs.includes('pinWindows.has(win)')) throw new Error('未校验窗口归属');
});
t('pin-preload 已纳入打包清单', () => {
  const pkg = JSON.parse(read('package.json'));
  if (!pkg.build.files.includes('pin-preload.js')) throw new Error('未加入 files');
});
t('钉图界面有缩放/透明度/收起控件', () => {
  for (const id of ['zoom-in', 'zoom-out', 'opacity-up', 'opacity-down', 'collapse']) {
    if (!mainJs.includes(`id="${id}"`)) throw new Error('缺少控件 ' + id);
  }
});

console.log('\n== 跨屏截图 ==');
t('使用 getAllDisplays 覆盖全部显示器', () => {
  if (!mainJs.includes('screen.getAllDisplays()')) throw new Error('未枚举全部显示器');
});
t('计算虚拟桌面并集（支持副屏在主屏左侧/上方）', () => {
  if (!mainJs.includes('unionBounds(displays)')) throw new Error('未使用 unionBounds');
  // 负坐标处理在 lib/display-geometry.js 中由 test-display.js 做数值验证
  if (!mainJs.includes("require('./lib/display-geometry')")) throw new Error('未引入几何模块');
});
t('按最大 scaleFactor 合成，避免最清晰屏幕被降采样', () => {
  if (!mainJs.includes('maxScaleFactor(displays)')) throw new Error('未使用 maxScaleFactor');
});
t('多屏时把分块交给渲染进程合成', () => {
  if (!mainJs.includes('collectDesktopTiles')) throw new Error('缺少分块收集');
  if (!mainJs.includes('tiles:')) throw new Error('payload 未携带分块');
  const overlay = read('src/overlay.js');
  if (!overlay.includes('composeTiles')) throw new Error('overlay 未实现合成');
});
t('单屏时不走合成，直接用原图', () => {
  if (!mainJs.includes('tiles.tiles.length === 1 ? tiles.tiles[0].dataUrl')) {
    throw new Error('单屏未走原图路径');
  }
});
t('overlay 窗口覆盖整个虚拟桌面', () => {
  if (!mainJs.includes('overlayWindow.setBounds(virtualBounds)')) throw new Error('overlay 未覆盖虚拟桌面');
  if (!mainJs.includes('x: virtualBounds.x')) throw new Error('overlay x 未对齐虚拟桌面');
});
t('payload 携带每块的位置与尺寸', () => {
  const overlay = read('src/overlay.js');
  if (!overlay.includes('tile.x') || !overlay.includes('tile.width')) {
    throw new Error('合成时未使用分块偏移/尺寸');
  }
});

console.log('\n== 第三批：浮引岛与自定义唤起接线 ==');

t('浮引岛窗口与主进程接线存在', () => {
  if (!mainJs.includes('createIslandWindow')) throw new Error('缺少浮引岛窗口创建');
  if (!mainJs.includes("loadFile(path.join(__dirname, 'src', 'island.html'))")) throw new Error('未加载 island.html');
  for (const channel of ['island:get-state', 'island:add-paths', 'island:remove-item', 'island:clear', 'island:set-policy', 'island:set-expanded', 'island:open-item', 'island:start-drag', 'island:toggle']) {
    if (!mainJs.includes(channel)) throw new Error('缺少 IPC ' + channel);
  }
  if (!mainJs.includes('startDrag')) throw new Error('拖出未走 webContents.startDrag');
});

t('浮引岛持久化走 store 的 island 段', () => {
  const store = read('lib/store.js');
  if (!store.includes('getIsland') || !store.includes('updateIsland')) throw new Error('store 未实现 island 方法');
  if (!store.includes('cleanIsland')) throw new Error('缺少 island 落盘清洗');
  if (!store.includes('shortcutMomentary')) throw new Error('设置未持久化按住型键位');
});

t('浮引岛只收路径，渲染进程不读文件系统', () => {
  const preload = read('preload.js');
  if (!preload.includes('webUtils.getPathForFile')) throw new Error('未使用 webUtils 取真实路径');
  if (!preload.includes('island')) throw new Error('preload 未暴露 island');
  const islandJs = read('src/island.js');
  if (/\breadFile\b|require\('node:fs'\)/.test(islandJs)) throw new Error('渲染层不应直接读写文件系统');
});

t('按住型唤起：侦测助手与状态机已接线', () => {
  const watch = read('lib/key-watch.js');
  if (!watch.includes('class KeyWatchProbe')) throw new Error('缺少 KeyWatchProbe');
  if (!mainJs.includes('setupMomentaryProbe')) throw new Error('主进程未接线');
  if (!mainJs.includes('momentaryStatus')) throw new Error('未向设置页暴露按住型状态');
  if (!fs.existsSync('assets/key-watch.ps1')) throw new Error('缺少 key-watch.ps1');
});

t('面板布局轮换与钉图显隐已注册为快捷键', () => {
  for (const name of ['panelCycle', 'pinnedToggle']) {
    if (!mainJs.includes(name + ':')) throw new Error('缺少 handler ' + name);
  }
  if (!mainJs.includes("'quick:mode'")) throw new Error('未下发面板模式');
  if (!mainJs.includes('togglePinnedVisibility')) throw new Error('缺少钉图显隐');
  const shortcuts = read('lib/shortcuts.js');
  if (!shortcuts.includes('panelCycle')) throw new Error('快捷键模型缺 panelCycle 默认值');
  if (!shortcuts.includes('validateMomentaryAccelerator')) throw new Error('快捷键模型缺按住型校验');
});

t('浮引岛在工具箱里有独立入口', () => {
  const kb = read('lib/keybindings.js');
  if (!kb.includes("id: 'island'")) throw new Error('工具箱缺浮引岛入口');
  if (!kb.includes('toggleIsland: true')) throw new Error('浮引岛入口未标注为浮层切换');
});

t('面板空格键不再吃掉带修饰键的组合（按住型唤起不被面板截断）', () => {
  const qp = read('src/quickpanel.js');
  if (!qp.includes("event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey")) {
    throw new Error('空格处理未排除修饰键');
  }
});

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
