'use strict';
/*
 * 38 键动作面板的键位模型测试。
 * 只测模型层（lib/keybindings.js），不依赖 Electron。
 * 用法：node test-keybindings.js
 */

const assert = require('assert');
const {
  KEY_ROWS,
  KEY_COUNT,
  PANEL_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  TOOLBOX_TOOLS,
  normalizeKey,
  keyLayout
} = require('../lib/keybindings');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

console.log('\n== 键位布局 ==');

t('共 38 个键位', () => assert.strictEqual(KEY_COUNT, 38));

t('四行键数与中国键盘一致（12/10/9/7）', () => {
  assert.deepStrictEqual(KEY_ROWS.map((row) => row.length), [12, 10, 9, 7]);
});

t('数字行包含 0–9 与 - =', () => {
  assert.deepStrictEqual(KEY_ROWS[0], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']);
});

t('字母行是 QWERTY / ASDF / ZXCV 的相对排列', () => {
  assert.strictEqual(KEY_ROWS[1].join(''), 'QWERTYUIOP');
  assert.strictEqual(KEY_ROWS[2].join(''), 'ASDFGHJKL');
  assert.strictEqual(KEY_ROWS[3].join(''), 'ZXCBNM'.replace('ZXCBNM', 'ZXCVBNM'));
});

t('所有键位唯一，没有重复占位', () => {
  const all = KEY_ROWS.flat();
  assert.strictEqual(new Set(all).size, all.length);
});

console.log('\n== 绑定模型 ==');

t('每个绑定都指向目录里存在的动作', () => {
  for (const [key, actionId] of Object.entries(DEFAULT_KEY_BINDINGS)) {
    assert.ok(PANEL_ACTIONS[actionId], `${key} 指向不存在的动作 ${actionId}`);
  }
});

t('一个动作只占用一个键位（无重复绑定同一动作）', () => {
  const actionIds = Object.values(DEFAULT_KEY_BINDINGS);
  assert.strictEqual(new Set(actionIds).size, actionIds.length);
});

t('默认截图位于 C，与 Alt+C 的主键一致；提取文字在 O', () => {
  assert.strictEqual(DEFAULT_KEY_BINDINGS.C, 'capture');
  assert.strictEqual(DEFAULT_KEY_BINDINGS.O, 'ocr');
  assert.strictEqual(DEFAULT_KEY_BINDINGS.P, 'pin');
});

t('默认 V=剪贴板与 Alt+V 一致，X=文本转换、B=标注、L=锁屏', () => {
  assert.strictEqual(DEFAULT_KEY_BINDINGS.V, 'clipboard');
  assert.strictEqual(DEFAULT_KEY_BINDINGS.X, 'text-clean');
  assert.strictEqual(DEFAULT_KEY_BINDINGS.B, 'annotate');
  assert.strictEqual(DEFAULT_KEY_BINDINGS.L, 'lock');
});

console.log('\n== 布局与可用状态 ==');

const layout = keyLayout();

t('布局返回 38 条键位', () => assert.strictEqual(layout.keys.length, 38));
t('布局同样返回 4 行', () => assert.strictEqual(layout.rows.length, 4));

t('已实现动作标记为 bound', () => {
  const bound = layout.keys.filter((k) => k.state === 'bound');
  assert.strictEqual(bound.length, Object.values(PANEL_ACTIONS).filter((a) => a.implemented).length);
});

t('未绑定键显示 unbound（渲染层据此显示「绑定」）', () => {
  const unbound = layout.keys.filter((k) => k.state === 'unbound');
  // 38 键 - 已登记动作（含未实现占位）
  assert.strictEqual(unbound.length, 38 - Object.keys(PANEL_ACTIONS).length);
  assert.ok(unbound.every((k) => k.label === '' && k.actionId === ''));
});

t('未实现的动作标记为 unimplemented，且带名称', () => {
  const todo = layout.keys.filter((k) => k.state === 'unimplemented');
  assert.strictEqual(todo.length, Object.values(PANEL_ACTIONS).filter(a=>!a.implemented).length);
  assert.ok(todo.every((k) => k.label && k.actionId));
});

t('未实现的动作不会被误报为可用（没有 bound 状态）', () => {
  const todoIds = Object.entries(PANEL_ACTIONS).filter(([, a]) => !a.implemented).map(([id]) => id);
  for (const key of layout.keys) {
    if (todoIds.includes(key.actionId)) assert.notStrictEqual(key.state, 'bound', key.actionId + ' 被当成可用');
  }
});

t('isReady 返回 false 时动作降级为不可用', () => {
  const degraded = keyLayout(() => false);
  assert.strictEqual(degraded.keys.filter((k) => k.state === 'bound').length, 0);
});

t('isReady 只影响指定动作', () => {
  const partial = keyLayout((id) => id !== 'capture');
  const capture = partial.keys.find((k) => k.key === 'C');
  const ocr = partial.keys.find((k) => k.key === 'O');
  assert.notStrictEqual(capture.state, 'bound');
  assert.strictEqual(ocr.state, 'bound');
});

console.log('\n== 动作目录与工具箱 ==');

t('动作目录都有标签与提示', () => {
  for (const [id, action] of Object.entries(PANEL_ACTIONS)) {
    assert.ok(action.label, id + ' 缺少 label');
    assert.ok(action.hint, id + ' 缺少 hint');
    assert.strictEqual(typeof action.implemented, 'boolean');
  }
});

t('未实现动作的提示里写明「尚未实现」', () => {
  for (const [id, action] of Object.entries(PANEL_ACTIONS)) {
    if (!action.implemented) assert.match(action.hint, /尚未实现/, id);
  }
});

t('工具箱区分已实现与未完成', () => {
  assert.ok(TOOLBOX_TOOLS.some((t_) => t_.implemented));
  assert.ok(PANEL_ACTIONS.calendar.implemented && PANEL_ACTIONS.markdown.implemented);
  assert.strictEqual(PANEL_ACTIONS.wallpaper, undefined);
  for (const tool of TOOLBOX_TOOLS) {
    if (!tool.implemented) assert.match(tool.hint, /尚未实现/, tool.id);
  }
});

t('工具箱的打开类入口指向真实页面', () => {
  const pages = new Set(['shelf', 'library', 'trail', 'settings']);
  for (const tool of TOOLBOX_TOOLS.filter((t_) => t_.open)) assert.ok(pages.has(tool.open), tool.id + ' 指向未知页面');
});

console.log('\n== 按键归一化 ==');

t('小写字母归一化为大写', () => assert.strictEqual(normalizeKey('z'), 'Z'));
t('数字与符号原样保留', () => {
  assert.strictEqual(normalizeKey('1'), '1');
  assert.strictEqual(normalizeKey('-'), '-');
});
t('非单字符返回原串（不误判功能键）', () => assert.strictEqual(normalizeKey('Space'), 'Space'));

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
