const PROJECT_ROOT = require('node:path').resolve(__dirname, '..');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const read = (p) => fs.readFileSync(path.join(PROJECT_ROOT, p), 'utf8');

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
t('主工作台页面齐备，轨迹移入内容详情', () => {
  const want = ['page-shelf', 'page-library', 'page-settings'];
  const miss = want.filter((p) => !pageIds.includes(p));
  if (miss.length) throw new Error('缺失: ' + miss.join(', '));
  if(html.includes('data-page="trail"')||!htmlIds.has('preview-trail'))throw Error('轨迹应只在内容详情展开');
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

t('语音输入界面、受限预加载与主进程通道齐备', () => {
  const voiceHtml = read('src/voice-input.html');
  const voiceJs = read('src/voice-input.js');
  const voicePreload = read('voice-preload.js');
  const voiceIds = new Set([...voiceHtml.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const referencedIds = new Set([...voiceJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]));
  const missingIds = [...referencedIds].filter(id => !voiceIds.has(id));
  if (missingIds.length) throw new Error('语音页缺少元素: ' + missingIds.join(', '));
  for (const method of ['status', 'transcribe', 'commit', 'cancel', 'close', 'openSettings']) {
    if (!voicePreload.includes(`${method}:`)) throw new Error('预加载缺少语音能力 ' + method);
  }
  for (const channel of ['voice:open', 'voice:status', 'voice:transcribe', 'voice:commit', 'voice:cancel', 'voice:close', 'voice:open-settings']) {
    if (!mainJs.includes(`'${channel}'`)) throw new Error('主进程缺少语音通道 ' + channel);
  }
  if (!voiceHtml.includes("connect-src 'none'")) throw new Error('语音页面不应直接建立网络连接');
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
  for (const sel of ['.ocr-result', '.ocr-result-actions', '.ocr-result-columns textarea']) {
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
t('颜色走 Radix 令牌而非自带色板', () => {
  if (!css.includes('var(--ink)')) throw new Error('未引用语义令牌');
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
  const clickBinding = qpJs.match(/button\.addEventListener\('click', \(\) => \{[\s\S]*?pressKey\(button\.dataset\.key\)/);
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
  // 图标缓存已下沉到 lib/app-icons.js（闭包内的 Map），main.js 只负责惰性复用同一个 loader。
  const iconsLib = read('lib/app-icons.js');
  if (!/\bnew Map\(\)/.test(iconsLib)) throw new Error('缺少图标缓存容器');
  if (!iconsLib.includes('cache.has')) throw new Error('缺少图标缓存读取');
  if (!iconsLib.includes('cache.set')) throw new Error('缺少图标缓存写入');
  if (!/if\s*\(\s*!appIconLoader\s*\)/.test(mainJs)) throw new Error('主进程未复用图标 loader');
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
  const { width, height } = require('../lib/display-geometry').QUICK_PANEL_SIZE;
  if (!(width >= 700)) throw new Error('面板过窄：' + width);
  if (!(height >= 560)) throw new Error('面板过矮：' + height);
});

console.log('\n== 第二批：已复现缺陷的回归断言 ==');
t('配方 ID 与配方定义一致（曾指向不存在的 capture-to-text）', () => {
  const { COMMANDS, RECIPE_IDS } = require('../lib/search');
  const { RECIPES } = require('../lib/recipes');
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
  if (!/if \(event.key === 'Enter'\) \{\s+if \(!state\.commandResults\.length\)/.test(qpJs)) {
    throw new Error('搜索框 Enter 在无结果时未做明确处理');
  }
});
t('搜索无结果时按 Enter 给出反馈而不是静默', () => {
  if (!qpJs.includes('还在搜索')) throw new Error('缺少搜索中提示');
});
t('搜索命令的应用候选使用 appPath，不靠剥 id 前缀', () => {
  if (!qpJs.includes('entry.appPath')) throw new Error('未使用 appPath');
  const { COMMANDS } = require('../lib/search');
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
  if (!/confirmBtn\.disabled\s*=\s*[^;]*!ok/.test(appJs)) throw new Error('未在未匹配时禁用确认');
  // 两处危险操作都必须传 expect
  if (!/expect: '清空'/.test(appJs)) throw new Error('清空剪贴板未要求确认词');
  if (!/expect: task\.title/.test(appJs)) throw new Error('删除任务未要求输入任务名');
  if (!html.includes('id="modal-hint"')) throw new Error('缺少确认提示元素');
});
t('面板截图入口带意图，O 提字 / P 钉图框完即出结果', () => {
  // 意图由 lib/panel-actions.js 决定（可测），main.js 只负责把 capture 接上
  if (!mainJs.includes('intent')) throw new Error('主进程未传递入口意图');
  if (!/capture: \(intent\).*beginScreenCapture\('panel', \{ intent \}\)/.test(mainJs)) {
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
  for (const module of ['文件中转', '边缘入口', '自定义唤起', '右键', '长截图', '速记', '翻译']) {
    if (!doc.includes(module)) throw new Error('差距表缺少模块：' + module);
  }
  // 方案要求：不以占位界面宣称完成。差距表必须写边界声明
  if (!doc.includes('未运行原产品验证任何行为')) throw new Error('缺少证据边界声明');
});
t('差距表依据的原始证据文件确实存在', () => {
  const base = 'Suira-Windows-Docs/Suira-Windows-Docs/research/function-analysis';
  // 逆向研究二进制在 .gitignore 中，新克隆的仓库不包含这份可选资料。
  if(!fs.existsSync(base)){console.log('  NOTE  本地研究资料未安装，跳过原始证据校验');return;}
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
  // 长截图已接通手动滚动拼接；独立边缘入口仍未实现。
  if (zeroRows.length !== 1 || !zeroRows.some(row=>row.includes('边缘入口'))) throw new Error('独立边缘入口应仍标记为 0');
  if(!doc.includes('手动滚动拼接已交付')||!doc.includes('验证边界'))throw Error('缺少长截图交付范围与验证边界');
  if(!doc.includes('钉图已交付，键帽右键未完成')||!doc.includes('摄像头、麦克风混音等未完成'))throw Error('缺少部分交付能力的具体边界');
  for (const mark of ['**增量已实现**', '**MVP**', '**B 支已交付**']) {
    if (!doc.includes(mark)) throw new Error('缺少已实现项的状态标注：' + mark);
  }
  // 翻译只交付了 B 支（图片取词），A 支实时语音必须仍写明未做
  if (!/A 支实时语音翻译/.test(doc)) throw new Error('翻译 A 支未标注为未实现');
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
  const recordAt = body.indexOf('clipboardTarget(snapshot,process.pid)');
  const showAt = body.indexOf('win.show()');
  if (recordAt < 0) throw new Error('未重新记录本次前台窗口');
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
t('随手面板不再显示底部内容和放回条', () => {
  for (const id of ['source-card', 'return-bar', 'return-commit']) {
    if (qpIds.has(id)) throw new Error('仍包含 ' + id);
  }
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
  const invoked = new Set([...(preload + read('pin-preload.js')).matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
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
  if (!/Math\.min\(3, Math\.max\(0\.25/.test(read('src/pin.js'))) throw new Error('渲染侧缩放未限幅');
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
    if (!read('src/pin.html').includes(`id="${id}"`)) throw new Error('缺少控件 ' + id);
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
  if (!mainJs.includes('currentVirtualBounds')) throw new Error('缺少虚拟桌面边界计算');
  if (!mainJs.includes('win.setBounds(bounds)')) throw new Error('overlay 未按当前虚拟桌面重设边界');
  if (!mainJs.includes('x: bounds.x')) throw new Error('overlay x 未对齐虚拟桌面');
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

console.log('\n== 第三批：速记（Quick Note）接线 ==');

t('速记窗口与主进程接线存在', () => {
  if (!mainJs.includes('createNoteWindow')) throw new Error('缺少速记窗口创建');
  if (!mainJs.includes("loadFile(path.join(__dirname, 'src', 'notes.html'))")) throw new Error('未加载 notes.html');
  for (const channel of ['notes:list', 'notes:get', 'notes:open', 'notes:create', 'notes:update', 'notes:toggle-pin', 'notes:delete']) {
    if (!mainJs.includes(channel)) throw new Error('缺少 IPC ' + channel);
  }
  if (!fs.existsSync('src/notes.js') || !fs.existsSync('src/notes.css')) throw new Error('速记页面资源缺失');
});

t('速记落盘走 store 的 notes 段并随内容加密', () => {
  const store = read('lib/store.js');
  if (!store.includes('createNote') || !store.includes('updateNoteText')) throw new Error('store 未实现速记方法');
  if (!store.includes('cleanNote')) throw new Error('缺少速记落盘清洗');
  if (!store.includes('notes: encrypting')) throw new Error('速记正文未随内容加密落盘');
});

t('速记语义收敛在纯模型里（可测，不依赖窗口）', () => {
  const model = read('lib/notes.js');
  for (const fn of ['noteTitle', 'cleanNote', 'capNotes', 'cleanBounds']) {
    if (!model.includes(fn)) throw new Error('缺少模型函数 ' + fn);
  }
  if (!fs.existsSync('tests/test-notes.js')) throw new Error('缺少速记测试');
  const pkg = JSON.parse(read('package.json'));
  if (!pkg.scripts.test.includes('test-notes.js')) throw new Error('npm test 未纳入速记测试');
});

t('速记在 38 键面板与工具箱都有入口，且不再是「尚未实现」', () => {
  const kb = read('lib/keybindings.js');
  const note = /note:\s*\{[^}]*\}/.exec(kb);
  if (!note) throw new Error('键位目录缺速记');
  if (!/implemented:\s*true/.test(note[0])) throw new Error('速记仍标注为未实现');
  if (!/key:\s*'N'/.test(note[0])) throw new Error('速记未绑定 N 键');
  const tools = /\{\s*id:\s*'note'[^}]*\}/.exec(kb);
  if (!tools || !/implemented:\s*true/.test(tools[0])) throw new Error('工具箱速记入口未启用');
});

t('速记动作走 panel 执行层（键盘与鼠标同一条通道）', () => {
  const actions = read('lib/panel-actions.js');
  if (!actions.includes("case 'note'")) throw new Error('执行层未处理速记');
  if (!actions.includes('openNote')) throw new Error('未注入速记依赖');
  if (!mainJs.includes('openNote: () => openLatestNote()')) throw new Error('主进程未把速记接到执行层');
});

console.log('\n== 核心框架：截图 / 剪贴板 / 主体 ==');

t('剪贴板采集覆盖文本 / 文件引用 / 图片三条路径', () => {
  if (!mainJs.includes('readClipboardSnapshot')) throw new Error('缺少剪贴板快照读取');
  if (!mainJs.includes('rememberClipboardFiles')) throw new Error('缺少文件引用采集');
  if (!mainJs.includes('parseClipboardFileUris')) throw new Error('缺少 file: URI 解析接线');
  if (!mainJs.includes('text/uri-list')) throw new Error('未读取 text/uri-list');
  if (!mainJs.includes('addImageToStore')) throw new Error('缺少图片采集');
  const capture = read('lib/clipboard-capture.js');
  if (/require\('electron'\)/.test(capture) || /require\('node:fs'\)/.test(capture)) {
    throw new Error('剪贴板纯模型不应依赖 electron / node:fs');
  }
});

t('剪贴板记录来源应用并用于敏感排除', () => {
  if (!mainJs.includes('clipboardSourceSnapshot')) throw new Error('缺少来源应用采集');
  if (!mainJs.includes('processName: source.appName')) throw new Error('敏感排除未使用来源进程名');
  if (!mainJs.includes('windowTitle: source.windowTitle')) throw new Error('敏感排除未使用窗口标题');
});

t('重复内容置顶而不是新增重复条目', () => {
  if (!mainJs.includes('findRecentDuplicate')) throw new Error('未使用最近去重');
  if (!mainJs.includes('touchItem')) throw new Error('未实现置顶');
  if (!mainJs.includes('deduped: true')) throw new Error('置顶后未广播 content:changed');
  const store = read('lib/store.js');
  if (!store.includes('touchItem')) throw new Error('store 缺 touchItem');
});

t('保留期在启动与设置变更时立即生效', () => {
  const initStart = mainJs.indexOf('async function initialize(');
  const initEnd = mainJs.indexOf('async function collectDiagnostics(');
  if (initStart < 0 || initEnd < 0) throw new Error('找不到 initialize / collectDiagnostics');
  if (!/store\.prune\(\)/.test(mainJs.slice(initStart, initEnd))) throw new Error('启动时未清理过期内容');
  // 不看变量叫什么，只看设置更新这条通道里有没有「保留期/上限变了就立刻 prune」
  const updateStart = mainJs.indexOf("ipcMain.handle('settings:update'");
  if (updateStart < 0) throw new Error('找不到 settings:update 处理器');
  const updateEnd = mainJs.indexOf('/* ---------- 翻译', updateStart);
  if (updateEnd < 0) throw new Error('找不到设置处理器边界');
  const updateHandler = mainJs.slice(updateStart, updateEnd);
  if (!/retentionDays\s*!==\s*undefined/.test(updateHandler)) throw new Error('设置变更后未触发清理');
  if (!/store\.prune\(\)/.test(updateHandler)) throw new Error('设置变更后没有真的调用 prune');
});

t('主窗口记忆尺寸 / 位置 / 最大化，并校验多屏', () => {
  if (!mainJs.includes('sanitizeWindowBounds')) throw new Error('未校验记忆边界');
  if (!mainJs.includes('rememberMainWindowState')) throw new Error('未保存窗口状态');
  if (!mainJs.includes("mainWindow.on('resize'") || !mainJs.includes("mainWindow.on('move'")) {
    throw new Error('未监听窗口移动/缩放');
  }
  if (!mainJs.includes('getWindowState()')) throw new Error('未读取窗口状态');
  const store = read('lib/store.js');
  if (!store.includes('getWindowState') || !store.includes('setWindowState')) throw new Error('store 缺窗口状态方法');
  const geometry = read('lib/display-geometry.js');
  if (!geometry.includes('sanitizeWindowBounds')) throw new Error('几何模块缺边界校验');
});

t('处理轨迹失败记录可重试（IPC + preload）', () => {
  if (!mainJs.includes("ipcMain.handle('executions:retry'")) throw new Error('缺少重试 IPC');
  const preload = read('preload.js');
  if (!preload.includes("'executions:retry'")) throw new Error('preload 未暴露 retry');
  if (!mainJs.includes("execution.status !== 'failed'")) throw new Error('未限制只重试失败记录');
});

t('截图保存 / 任务导出对话框不再以隐藏窗口为父窗口', () => {
  const guard = /mainWindow && !mainWindow\.isDestroyed\(\) && mainWindow\.isVisible\(\) \? mainWindow : null/g;
  const count = (mainJs.match(guard) || []).length;
  if (count < 2) throw new Error('保存/导出对话框仍有隐藏父窗口风险，实际命中 ' + count);
});

t('诊断报告不再把异步剪贴板读取写成同步', () => {
  if (!mainJs.includes('await clipboard.readText()')) throw new Error('缺少 await readText');
  if (mainJs.includes('const raw = clipboard.readText();')) throw new Error('仍存在未 await 的 readText');
  const diagStart = mainJs.indexOf('async function collectDiagnostics(');
  const diag = mainJs.slice(diagStart, diagStart + 14000);
  for (const required of ['窗口状态记忆', '剪贴板采集范围']) {
    if (!diag.includes(required)) throw new Error('诊断缺少字段 ' + required);
  }
});

t('托盘提供浮引岛入口且函数不再粘连', () => {
  if (!/label: '浮引岛[^']*'.*click:.*toggleIsland\(\)/.test(mainJs)) throw new Error('托盘缺浮引岛入口');
  if (mainJs.includes('}function createTray')) throw new Error('createTray 仍与前一个函数粘连');
  if (mainJs.includes('}    for (const item')) throw new Error('search:query 仍有粘连格式问题');
});

t('放回原处：图片条目复制位图而不是路径文本', () => {
  if (!mainJs.includes("item?.kind === 'image'") || !mainJs.includes("if(!item.filePath||!fs.existsSync(item.filePath))throw Error('原图片不存在或已被清理')")) {
    throw new Error('图片条目未走位图复制');
  }
  if (!mainJs.includes('await writeClipboardImage(image)')) throw new Error('未调用 writeClipboardImage');
});

t('放回原处：复制失败必须返回失败而不是成功提示', () => {
  if (!mainJs.includes('copyFailed')) throw new Error('复制失败未单独标记');
  if (!mainJs.includes('decision.copyFailed')) throw new Error('return:commit 未处理复制失败');
  if (!mainJs.includes("ok: false, error: decision.message || '复制失败'")) {
    throw new Error('复制失败仍以 ok:true 返回，界面会显示成功');
  }
});

console.log('\n== 体验优化：截图流畅度 / 工具栏时序 / 底部剪贴板条 ==');

t('截图覆盖层是预热常驻窗口（不再每次新建/销毁）', () => {
  if (!mainJs.includes('function createOverlayWindow')) throw new Error('缺少覆盖层预热创建');
  if (!mainJs.includes('showOverlayWindow')) throw new Error('缺少统一显示入口');
  if (!mainJs.includes('hideOverlayWindow')) throw new Error('缺少隐藏而不是销毁');
  if (!mainJs.includes("webContents.send('capture:shown')")) throw new Error('未通知覆盖层重新取画面');
  if (mainJs.includes('overlayWindow.destroy()')) throw new Error('覆盖层仍在销毁，失去预热意义');
  const preload = read('preload.js');
  if (!preload.includes("'capture:shown'")) throw new Error('preload 未暴露 capture.onShown');
  const overlay = read('src/overlay.js');
  if (!overlay.includes('captureApi.onShown') || !overlay.includes('window.suira.capture')) throw new Error('覆盖层未通过共享 API 订阅 capture.onShown');
});

t('截图工具栏在框选完成前不出现', () => {
  const overlay = read('src/overlay.js');
  if (!overlay.includes('toolDock.hidden')) throw new Error('缺少工具栏显隐控制');
  if (!/selecting|selectionReady/.test(overlay)) throw new Error('缺少「正在框选/已完成」状态');
});

t('覆盖层 canvas 不再强制软件渲染', () => {
  const overlay = read('src/overlay.js');
  if(!/const screenCtx = screenCanvas\.getContext\('2d'\);/.test(overlay))throw new Error('主画布不能强制软件渲染');
  if(!overlay.includes('colorSampleCanvas.width=colorSampleCanvas.height=1'))throw new Error('频繁读取的取色画布必须限制为 1 像素');
  if (!/requestAnimationFrame/.test(overlay)) throw new Error('pointermove 未做合帧');
});

t('剪贴板历史条：窗口 / 组合键 / IPC 接线', () => {
  if (!mainJs.includes('createClipboardBarWindow')) throw new Error('缺少底部条窗口创建');
  if (!mainJs.includes('showClipboardBar') || !mainJs.includes('toggleClipboardBar')) throw new Error('缺少显示/切换入口');
  for (const channel of ['clipboard-bar:show', 'clipboard-bar:hide', 'clipboard-bar:toggle']) {
    if (!mainJs.includes(channel)) throw new Error('缺少 IPC ' + channel);
  }
  if (!mainJs.includes("title: '随序 · 剪贴板'")) throw new Error('窗口标题缺失');
  const shortcuts = read('lib/shortcuts.js');
  if (!shortcuts.includes("clipboardBar: 'Alt+V'")) throw new Error('缺省组合键未注册');
  const store = read('lib/store.js');
  if (!store.includes('shortcutClipboardBar')) throw new Error('设置未持久化底部条键位');
  if (!mainJs.includes('clipboardBar: toggleClipboardBar')) throw new Error('快捷键 handler 未接');
});

t('剪贴板历史条：preload 与设置页入口', () => {
  const preload = read('preload.js');
  for (const method of ['show', 'hide', 'toggle', 'onShown']) {
    if (!preload.includes(method + ':') && !preload.includes(method + ' =>') && !preload.includes(method + ':')) {
      throw new Error('preload 未暴露 clipboardBar.' + method);
    }
  }
  const html = read('src/index.html');
  const appJs = read('src/app.js');
  for (const id of ['setting-key-clipboardBar', 'status-clipboardBar']) {
    if (!html.includes(`id="${id}"`)) throw new Error('设置页缺少 ' + id);
  }
  if (!html.includes('data-shortcut-clear="clipboardBar"')) throw new Error('缺少底部条清除绑定按钮');
  if (!appJs.includes("name: 'clipboardBar'")) throw new Error('设置页未绑定底部条改键');
  if (!fs.existsSync('src/clipboardbar.html') || !fs.existsSync('src/clipboardbar.js') || !fs.existsSync('src/clipboardbar.css')) {
    throw new Error('缺少 clipboardbar 页面文件');
  }
  const barJs = read('src/clipboardbar.js');
  if (/require\('node:fs'\)|require\('electron'\)/.test(barJs)) throw new Error('底部条渲染层不应依赖 node/electron');
  if (!barJs.includes('returnTo.commit')) throw new Error('底部条未接放回提交');
});

t('取色放大镜：微信式绿色十字线、两行读数与 Ctrl+C 复制', () => {
  const overlayHtml = read('src/overlay.html');
  const overlayJs = read('src/overlay.js');
  const theme = read('src/theme.css');
  const stage = read('src/stage-tools.js');
  if (!overlayHtml.includes('按 Ctrl+C 复制色值') || !overlayHtml.includes('<kbd>Ctrl+C</kbd> 复制色值')) {
    throw new Error('取色提示未改为微信式 Ctrl+C 复制色值');
  }
  if ((overlayHtml.match(/class="magnifier-readout"/g) || []).length !== 2) {
    throw new Error('信息框应只有坐标与色值两行，RGB 作为色值行的次要信息');
  }
  if (!/--magnifier-crosshair:#00b050/i.test(theme)) throw new Error('十字线应为微信绿');
  if (!overlayJs.includes("themePaint('magnifier-crosshair')") || !overlayJs.includes('strokeRect(center - pixel / 2, center - pixel / 2, pixel, pixel)')) {
    throw new Error('放大镜未绘制绿色十字线与中心像素框');
  }
  if (!overlayJs.includes('const sampleSize = 21')) throw new Error('放大倍率应保持约 8 倍，能看清周围画面');
  if (!overlayJs.includes('measureMagnifier()')) throw new Error('贴边避让应使用真实放大镜尺寸');
  if (!/const colorCopy = [\s\S]{0,200}!magnifier\.hidden[\s\S]{0,160}shiftKey !== event\.ctrlKey/.test(overlayJs)) {
    throw new Error('Shift+C 与 Ctrl+C 都应要求放大镜可见，避免复制陈旧采样点');
  }
  if (!overlayJs.includes("showAction(sampled.hex+' 已复制 · Enter 完成截图')")) throw new Error('复制色值后要提示如何完成截图');
  if (stage.includes('Shift+C')) throw new Error('颜色历史文案仍写着旧快捷键');
});

t('覆盖层回归：画笔拖拽入队、浮层保护、指针取消与迟到结果', () => {
  const js = read('src/overlay.js');
  if (!js.includes('if (!annotating) colorPoint = p;') || !js.includes('queuePointer(p);')) {
    throw new Error('标注拖拽期间必须继续把 pointermove 入队，否则画笔一笔都画不出来');
  }
  if (!js.includes('if (state.drawing) state.drawing.points.push(p);')) throw new Error('画笔松开点必须并入线条');
  if (!js.includes('.ocr-result, .original-viewer, .loading-state')) throw new Error('查看原图/加载态浮层不能触发重新框选');
  if (!js.includes("root.addEventListener('pointercancel', cancelPointer)") || !js.includes("root.addEventListener('lostpointercapture'")) {
    throw new Error('指针取消与捕获丢失必须收掉进行中的绘制');
  }
  if (!js.includes('function releaseImage()') || !js.includes('state.image.close()')) throw new Error('ImageBitmap 需要显式释放');
  if (!js.includes('if (seq !== showSeq) return;') || !js.includes('if (seq === showSeq)')) throw new Error('异步完成结果需要 showSeq 过期保护');
  if (!js.includes('if (!visible) colorPoint = null;')) throw new Error('放大镜隐藏时必须清掉陈旧采样点');
  if (!js.includes('const srcLeft = srcX - half, srcTop = srcY - half;')) throw new Error('边缘取样要保持中心像素对齐画布中心');
});

t('小问题回归：弹窗标签、重启提示、Esc 逐级、搜索条、主题与视图偏好', () => {
  const app = read('src/app.js'), panel = read('src/quickpanel.js');
  const textTools = read('src/text-tools.js'), notes = read('src/notes.js');
  const workspace = read('src/workspace.js'), bar = read('src/clipboardbar.js');
  if (app.includes('catch (error) { toast(')) throw new Error('重启失败分支仍在调用不存在的 toast');
  if (!app.includes("confirmBtn.textContent = options.confirmLabel || '创建';")) throw new Error('弹窗必须重置确认按钮标签');
  if (!/function setSearchExpanded\(expanded = true\)[\s\S]{0,300}classList\.toggle\('is-expanded', expanded\)/.test(panel)) throw new Error('搜索条收起参数必须生效');
  if (!textTools.includes("details[open], dialog[open], [popover]:popover-open")) throw new Error('文字工具 Esc 要先收起浮层');
  if (!notes.includes("if (event.key !== 'Escape' || event.defaultPrevented) return;")) throw new Error('速记 Esc 需要挂到 document');
  if (!workspace.includes("settings?.theme==='dark'?'light':'dark'")) throw new Error('主题按钮要按当前设置切换');
  if (!/supportsVisualEditing[\s\S]{0,200}if\(!automatic\)requestedView=view;/.test(workspace)) throw new Error('视图降级后才能记住用户偏好');
  if (!bar.includes("copySelected('selection')") || !bar.includes("source==='preview'?state.previewItem")) throw new Error('剪贴板条复制必须区分预览项与选中项');
});

t('纯逻辑回归：大整数、JSON 格式化、URL 编码、存储索引与日期', () => {
  const search = read('lib/search-command.js'), tools = read('lib/text-tools.js');
  const store = read('lib/store.js'), dates = read('lib/date-parse.js');
  if (!search.includes('Number.isInteger(value)&&Number.isSafeInteger(value)')) throw new Error('整数结果不能被 toPrecision 静默截断');
  if (!search.includes('数字过大，超出精确计算范围')) throw new Error('超大整数要给出明确错误');
  if (!tools.includes("return parts.join('');")) throw new Error('JSON 格式化不能用 O(n²) 字符串重建');
  if (!tools.includes('URL 编码失败：文字包含无效的 Unicode 字符')) throw new Error('URL 编码失败需要中文提示');
  if (!store.includes('return this.getItem(item.id) || saved;')) throw new Error('addItem 不能按 prune 前的下标返回条目');
  if (!dates.includes("/^\\d+$/.test(now)")) throw new Error('日期解析要接受数字字符串时间戳');
});

t('性能回归：标注历史层、主题缓存、临时画布与大文本热路径', () => {
  const overlay = read('src/overlay.js'), actions = read('lib/actions.js');
  const store = read('lib/store.js'), main = read('main.js');
  const panel = read('src/quickpanel.js'), workspace = read('src/workspace.js');
  const icons = read('lib/app-icons.js'), disk = read('lib/icon-disk-cache.js');
  if (!overlay.includes('function drawHistoryLayer()') || !overlay.includes('releaseHistoryLayer()')) {
    throw new Error('已提交标注必须缓存到离屏层并在拖拽结束释放');
  }
  if (!overlay.includes('function magnifierTheme()')) throw new Error('放大镜主题色不能每帧 getComputedStyle');
  if (!overlay.includes('function closeOriginalViewer()') || !overlay.includes("removeAttribute('src')")) throw new Error('查看原图关闭后要释放 PNG 位图');
  if (!overlay.includes('function resizeCanvases(force = false)')) throw new Error('尺寸未变时不应整屏重绘');
  if (!overlay.includes('mosaicPaletteColors')) throw new Error('马赛克颜色不能逐格重新拼字符串');
  if (!actions.includes("return parts.join('');")) throw new Error('mergeLines 不能用 O(n²) 字符串累加');
  if (store.includes('}, null, 2)')) throw new Error('store 整库序列化不应带缩进');
  if (!main.includes('imageBlobFingerprint')) throw new Error('剪贴板轮询要先比对轻量指纹');
  if (!panel.includes("image.getAttribute('src')!==currentContext.thumbnail")) throw new Error('最近内容缩略图不能每秒重新解码');
  if (!workspace.includes("if(agendaMode!=='countdown')$('agenda-list').innerHTML")) throw new Error('倒数日模式不应先建再丢弃待办 DOM');
  if (!icons.includes('CACHE_LIMIT=512') || !disk.includes('entries=Object.fromEntries(rows)')) throw new Error('图标缓存要有上界并同步裁剪内存');
});

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
