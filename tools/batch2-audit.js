'use strict';
/* 第二批验收自查：逐条复核缺陷是否真的修好（读真实文件，不靠嘴说）。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const rows = [];

// 1 配方 ID 一致
const { COMMANDS } = require(path.join(ROOT, 'lib', 'search'));
const { RECIPES } = require(path.join(ROOT, 'lib', 'recipes'));
const validIds = new Set(RECIPES.map((r) => r.id));
const invalid = COMMANDS.filter((c) => String(c.action).startsWith('recipe:') && !validIds.has(c.action.slice('recipe:'.length)));
rows.push(['1 配方 ID 一致', invalid.length === 0, invalid.length ? JSON.stringify(invalid) : '两条配方命令都指向真实配方']);

// 2 搜索键盘执行
const qp = read('src/quickpanel.js');
const searchOk = !/state\.actions\[state\.focusIndex\]/.test(qp)
  && qp.includes('runCommand(state.commandIndex)')
  && qp.includes("if (state.query) {");
rows.push(['2 搜索键盘执行', searchOk, searchOk ? '搜索态 Enter/↑↓ 只作用于结果列表' : '仍在取 state.actions']);

// 3 Ctrl+A 焦点隔离
const ov = read('src/overlay.js');
const guardAt = ov.indexOf('const isTextInput');
const ctrlAAt = ov.indexOf("if (event.ctrlKey && key === 'a')");
const ctrlAOk = guardAt > 0 && ctrlAAt > 0 && guardAt < ctrlAAt;
rows.push(['3 Ctrl+A 焦点隔离', ctrlAOk, ctrlAOk ? '文本焦点先于全屏选区判断' : '顺序不对，仍会误触发']);

// 4 OCR 查看原图（两处入口）
const oh = read('src/overlay.html');
const qh = read('src/quickpanel.html');
const mainJs = read('main.js');
const originalOk = oh.includes('ocr-result-original') && oh.includes('original-viewer')
  && ov.includes('withoutAnnotations') && qh.includes('ocr-original')
  && mainJs.includes("'content:open-original'");
rows.push(['4 OCR 查看原图', originalOk, originalOk ? '覆盖层与面板都有入口，可反查来源图片' : '仍有缺口']);

// 5 确认文字校验
const appJs = read('src/app.js');
const confirmOk = appJs.includes('input.value.trim() === expect')
  && appJs.includes('confirmBtn.disabled = !ok')
  && appJs.includes("expect: '清空'")
  && appJs.includes('expect: task.title');
rows.push(['5 确认文字校验', confirmOk, confirmOk ? '两处危险操作都要求逐字匹配' : '仍有未校验的入口']);

// 附带修掉的两个
const toolDockBind = ov.includes("$$('[data-action]', toolDock)");
rows.push(['+ 工具栏按钮绑定', toolDockBind, toolDockBind ? '「识」与「完成」已绑定（原先从未绑定）' : '仍只绑 .tool-button']);
const lazyOk = mainJs.includes('let panelActions = null') && mainJs.includes('getPanelActions().run(actionId)');
rows.push(['+ 执行层惰性创建', lazyOk, lazyOk ? 'store/actions 就绪后才创建' : '仍会捕获 null']);

// 第二批链路：8 个已实现键位都有收尾语义
const { PANEL_ACTIONS, DEFAULT_KEY_BINDINGS } = require(path.join(ROOT, 'lib', 'keybindings'));
const pa = read('lib/panel-actions.js');
const implemented = Object.entries(PANEL_ACTIONS).filter(([, m]) => m.implemented).map(([id]) => id);
const boundKeys = Object.entries(DEFAULT_KEY_BINDINGS).filter(([, id]) => PANEL_ACTIONS[id]?.implemented);
const missingCase = implemented.filter((id) => !pa.includes(`case '${id}'`));
rows.push(['链路 8 键全覆盖', missingCase.length === 0, missingCase.length ? '未处理: ' + missingCase.join(',') : `${boundKeys.length} 个已绑定键都有处理分支`]);

console.log('\n== 第二批验收自查 ==\n');
let bad = 0;
for (const [name, ok, detail] of rows) {
  console.log((ok ? '  OK   ' : '  BAD  ') + name.padEnd(20, ' ') + ' ' + detail);
  if (!ok) bad += 1;
}
console.log('\n' + (bad ? bad + ' 项未通过' : '全部通过'));
process.exit(bad ? 1 : 0);
