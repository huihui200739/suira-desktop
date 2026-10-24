'use strict';

/*
 * 38 键面板自定义键位绑定的模型测试。
 * 只测纯模型（lib/panel-bindings.js），不依赖 Electron。
 * 用法：node test-panel-bindings.js
 */

const assert = require('assert');
const {
  VALID_KEYS,
  cleanBinding,
  cleanBindingMap,
  effectiveBinding,
  bindingLabel,
  assignPanelBinding
} = require('./lib/panel-bindings');
const { DEFAULT_KEY_BINDINGS, PANEL_ACTIONS } = require('./lib/keybindings');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

console.log('\n== 绑定清洗 ==');

t('38 个键位都可绑定，键位唯一', () => {
  assert.strictEqual(VALID_KEYS.size, 38);
  assert.ok(VALID_KEYS.has('1') && VALID_KEYS.has('Q') && VALID_KEYS.has('='));
});

t('内置动作绑定只接受已实现动作', () => {
  assert.deepStrictEqual(cleanBinding({ type: 'action', id: 'capture' }), { type: 'action', id: 'capture' });
  assert.strictEqual(cleanBinding({ type: 'action', id: 'record' }), null, '已删除的动作不能绑');
  assert.strictEqual(cleanBinding({ type: 'action', id: 'long-capture' }), null, '未实现动作不能绑');
});

t('路径/网页绑定带名字，非法协议拒绝', () => {
  const app = cleanBinding({ type: 'app', target: 'C:\\tools\\VS Code\\Code.exe' });
  assert.strictEqual(app.name, 'Code.exe');
  assert.strictEqual(cleanBinding({ type: 'app', target: '  ' }), null);
  assert.strictEqual(cleanBinding({ type: 'url', target: 'javascript:alert(1)' }), null, '非 http(s) 网址拒绝');
  assert.strictEqual(cleanBinding({ type: 'url', target: 'file:///C:/Windows' }), null);
  const url = cleanBinding({ type: 'url', target: 'https://github.com/' });
  assert.strictEqual(url.name, 'github.com');
  assert.strictEqual(cleanBinding({ type: 'folder', target: 'D:\\工作' }).type, 'folder');
  assert.strictEqual(cleanBinding({ type: 'none' }).type, 'none');
  assert.strictEqual(cleanBinding({ type: 'nope' }), null);
  assert.strictEqual(cleanBinding(null), null);
});

t('整表清洗丢弃非法键位与非法条目', () => {
  const map = cleanBindingMap({
    Z: { type: 'action', id: 'capture' },
    q: { type: 'none' },
    '！': { type: 'app', target: 'C:\\x.exe' },
    W: { type: 'nope' }
  });
  assert.deepStrictEqual(Object.keys(map).sort(), ['Q', 'Z']);
});

console.log('\n== 有效绑定（覆盖表 + 出厂默认） ==');

t('不在覆盖表里的键回落出厂默认', () => {
  assert.deepStrictEqual(effectiveBinding({}, 'Z'), { type: 'action', id: 'capture' });
  assert.deepStrictEqual(effectiveBinding({ Z: { type: 'none' } }, 'Z'), { type: 'none' }, '显式清空优先于默认');
  assert.deepStrictEqual(effectiveBinding({ W: { type: 'app', target: 'C:\\x.exe', name: 'x' } }, 'W').type, 'app');
  assert.deepStrictEqual(effectiveBinding({}, 'E'), { type: 'none' }, '默认无绑定的键返回 none');
});

t('bindingLabel 覆盖动作与自定义', () => {
  assert.strictEqual(bindingLabel({ type: 'action', id: 'capture' }), PANEL_ACTIONS.capture.label);
  assert.strictEqual(bindingLabel({ type: 'none' }), '空');
  assert.strictEqual(bindingLabel({ type: 'url', target: 'https://github.com/', name: 'github.com' }), 'github.com');
});

console.log('\n== 指派与换位 ==');

t('把动作换到空键：原默认键被显式清空', () => {
  const outcome = assignPanelBinding({}, 'W', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.W, { type: 'action', id: 'capture' });
  assert.deepStrictEqual(outcome.bindings.Z, { type: 'none' }, '截图原来的键 Z 应清空');
  assert.match(outcome.message, /W/);
});

t('把动作换到已占用键：与目标键内容互换', () => {
  // W 上已有自定义绑定：换位后该绑定应挪到 Z
  const start = { W: { type: 'folder', target: 'D:\\资料', name: '资料' } };
  const outcome = assignPanelBinding(start, 'W', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.W, { type: 'action', id: 'capture' });
  assert.deepStrictEqual(outcome.bindings.Z, { type: 'folder', target: 'D:\\资料', name: '资料' }, '原 W 的绑定换到 Z');
  assert.match(outcome.message, /资料/);
});

t('把动作绑回自己当前的键是无操作', () => {
  const outcome = assignPanelBinding({}, 'Z', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.changed, false);
  assert.deepStrictEqual(outcome.bindings, {});
});

t('动作被清空后可重新指派到任意键（无家可归场景）', () => {
  const start = { Z: { type: 'none' } };
  const outcome = assignPanelBinding(start, 'X', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.X, { type: 'action', id: 'capture' });
  assert.deepStrictEqual(outcome.bindings.Z, { type: 'none' }, 'Z 保持原来的显式清空');
});

t('自定义绑定直接落键，被替换的内置动作会提示移除', () => {
  const outcome = assignPanelBinding({}, 'D', { type: 'url', target: 'https://github.com/' });
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.bindings.D.type, 'url');
  assert.match(outcome.message, /回到桌面/);
});

t('清除绑定写入显式 none，出厂默认不再生效', () => {
  const outcome = assignPanelBinding({}, 'Z', null);
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.Z, { type: 'none' });
  assert.deepStrictEqual(effectiveBinding(outcome.bindings, 'Z'), { type: 'none' });
  assert.match(outcome.message, /截图/);
});

t('未知键位与非法绑定被拒绝', () => {
  assert.strictEqual(assignPanelBinding({}, '你好', { type: 'app', target: 'C:\\x.exe' }).ok, false);
  assert.strictEqual(assignPanelBinding({}, 'Z', { type: 'nope' }).ok, false);
  assert.strictEqual(assignPanelBinding({}, 'Z', { type: 'action', id: 'record' }).ok, false, '已删除动作不能绑');
});

console.log('\n== 换位后的完整键面 ==');

t('换位后每个动作仍只占用一个键位', () => {
  let bindings = {};
  // 截图 Z→W，提取文字 O→E：两次换位后 38 键里每个动作仍唯一
  bindings = assignPanelBinding(bindings, 'W', { type: 'action', id: 'capture' }).bindings;
  bindings = assignPanelBinding(bindings, 'E', { type: 'action', id: 'ocr' }).bindings;
  const seen = new Set();
  for (const key of VALID_KEYS) {
    const binding = effectiveBinding(bindings, key);
    if (binding.type !== 'action') continue;
    const label = binding.id;
    assert.ok(!seen.has(label), label + ' 出现在多个键位');
    seen.add(label);
  }
  assert.ok(seen.has('capture') && seen.has('ocr'));
  assert.deepStrictEqual(effectiveBinding(bindings, 'W'), { type: 'action', id: 'capture' });
  assert.deepStrictEqual(effectiveBinding(bindings, 'E'), { type: 'action', id: 'ocr' });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
