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
  assignPanelBinding,
  movePanelBinding
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
  assert.deepStrictEqual(cleanBinding({ type: 'action', id: 'calendar' }), {type:'action',id:'calendar'});
  assert.strictEqual(cleanBinding({ type: 'action', id: 'wallpaper' }), null);
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
    C: { type: 'action', id: 'capture' },
    q: { type: 'none' },
    '！': { type: 'app', target: 'C:\\x.exe' },
    W: { type: 'nope' }
  });
  assert.deepStrictEqual(Object.keys(map).sort(), ['C', 'Q']);
});

console.log('\n== 有效绑定（覆盖表 + 出厂默认） ==');

t('不在覆盖表里的键回落出厂默认', () => {
  assert.deepStrictEqual(effectiveBinding({}, 'C'), { type: 'action', id: 'capture' });
  assert.deepStrictEqual(effectiveBinding({ C: { type: 'none' } }, 'C'), { type: 'none' }, '显式清空优先于默认');
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
  assert.deepStrictEqual(outcome.bindings.C, { type: 'none' }, '截图原来的键 C 应清空');
  assert.match(outcome.message, /W/);
});

t('把动作换到已占用键：与目标键内容互换', () => {
  // W 上已有自定义绑定：换位后该绑定应挪到 C
  const start = { W: { type: 'folder', target: 'D:\\资料', name: '资料' } };
  const outcome = assignPanelBinding(start, 'W', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.W, { type: 'action', id: 'capture' });
  assert.deepStrictEqual(outcome.bindings.C, { type: 'folder', target: 'D:\\资料', name: '资料' }, '原 W 的绑定换到 C');
  assert.match(outcome.message, /资料/);
});

t('把动作绑回自己当前的键是无操作', () => {
  const outcome = assignPanelBinding({}, 'C', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.changed, false);
  assert.deepStrictEqual(outcome.bindings, {});
});

t('动作被清空后可重新指派到任意键（无家可归场景）', () => {
  const start = { C: { type: 'none' } };
  const outcome = assignPanelBinding(start, 'X', { type: 'action', id: 'capture' });
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.X, { type: 'action', id: 'capture' });
  assert.deepStrictEqual(outcome.bindings.C, { type: 'none' }, 'C 保持原来的显式清空');
});

t('自定义绑定直接落键，被替换的内置动作会提示移除', () => {
  const outcome = assignPanelBinding({}, 'D', { type: 'url', target: 'https://github.com/' });
  assert.strictEqual(outcome.ok, true);
  assert.strictEqual(outcome.bindings.D.type, 'url');
  assert.match(outcome.message, /回到桌面/);
});

t('清除绑定写入显式 none，出厂默认不再生效', () => {
  const outcome = assignPanelBinding({}, 'C', null);
  assert.strictEqual(outcome.ok, true);
  assert.deepStrictEqual(outcome.bindings.C, { type: 'none' });
  assert.deepStrictEqual(effectiveBinding(outcome.bindings, 'C'), { type: 'none' });
  assert.match(outcome.message, /截图/);
});

t('未知键位与非法绑定被拒绝', () => {
  assert.strictEqual(assignPanelBinding({}, '你好', { type: 'app', target: 'C:\\x.exe' }).ok, false);
  assert.strictEqual(assignPanelBinding({}, 'C', { type: 'nope' }).ok, false);
  assert.strictEqual(assignPanelBinding({}, 'C', { type: 'action', id: 'record' }).ok, false, '已删除动作不能绑');
});

console.log('\n== 换位后的完整键面 ==');

t('换位后每个动作仍只占用一个键位', () => {
  let bindings = {};
  // 截图 C→W，提取文字 O→E：两次换位后 38 键里每个动作仍唯一
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

console.log('\n== 拖动换位 ==');
t('拖到空字母、数字、符号键时清空原位并保持动作唯一', () => {
  for (const target of ['S', '1', '0', '-', '=']) {
    const start = {};
    const result = movePanelBinding(start, 'c', target);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(start, {}, '不修改调用方的覆盖表');
    assert.deepStrictEqual(effectiveBinding(result.bindings, 'C'), { type: 'none' });
    assert.deepStrictEqual(effectiveBinding(result.bindings, target), { type: 'action', id: 'capture' });
    assert.strictEqual([...VALID_KEYS].filter(key => effectiveBinding(result.bindings, key).id === 'capture').length, 1);
  }
});
t('应用、文件、文件夹和网页绑定都能移动，名字和目标保持完整', () => {
  for (const type of ['app', 'file', 'folder', 'url']) {
    const binding = cleanBinding({ type, target: type === 'url' ? 'https://example.com/' : 'C:\\Demo\\example', name: '示例' });
    const result = movePanelBinding({ Q: binding }, 'Q', 'E');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(effectiveBinding(result.bindings, 'Q'), { type: 'none' });
    assert.deepStrictEqual(effectiveBinding(result.bindings, 'E'), binding);
  }
});
t('拖到已有功能或自定义绑定上会拒绝，双方内容都不改变', () => {
  for (const start of [{}, { X: { type: 'url', target: 'https://example.com/', name: '示例' } }]) {
    const before = JSON.stringify(start);
    const result = movePanelBinding(start, 'C', 'X');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /已经绑定/);
    assert.strictEqual(JSON.stringify(start), before);
    assert.strictEqual(result.bindings, start);
  }
});
t('占位的未实现工具可作为空位，原本已清空的默认键也能放入', () => {
  assert.strictEqual(movePanelBinding({}, 'C', 'W').ok, true);
  assert.strictEqual(movePanelBinding({ X: { type: 'none' } }, 'C', 'X').ok, true);
});
t('松回原键不改数据，空键和未知键不能作为移动来源', () => {
  assert.strictEqual(movePanelBinding({}, 'C', 'C').changed, false);
  for (const [from, to] of [['Q', 'E'], ['W', 'E'], ['未知', 'Q'], ['C', 'F13']]) {
    assert.strictEqual(movePanelBinding({}, from, to).ok, false);
  }
});
t('连续移动后新键触发同一动作，旧键不会回落到默认绑定', () => {
  const first = movePanelBinding({}, 'C', 'S');
  const second = movePanelBinding(first.bindings, 'S', '2');
  assert.strictEqual(effectiveBinding(second.bindings, '2').id, 'capture');
  assert.strictEqual(effectiveBinding(second.bindings, 'S').type, 'none');
  assert.strictEqual(effectiveBinding(second.bindings, 'C').type, 'none');
});

(async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { SuiraStore } = require('./lib/store');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-bindings-'));
  try {
    const file = path.join(temporary, 'data.json');
    const store = new SuiraStore(file);
    await store.setPanelBindings(movePanelBinding(store.getPanelBindings(), 'C', 'S').bindings);
    const reopened = new SuiraStore(file);
    const restored = reopened.getPanelBindings();
    assert.strictEqual(effectiveBinding(restored, 'C').type, 'none');
    assert.strictEqual(effectiveBinding(restored, 'S').id, 'capture');
    console.log('  PASS  保存后重建 store，移动后的键位和原键空位都保留');
    pass++;
    const previous = reopened.getPanelBindings();
    const save = reopened.save;
    reopened.save = async () => { throw new Error('磁盘写入失败'); };
    await assert.rejects(reopened.setPanelBindings(movePanelBinding(previous, 'S', '2').bindings), /磁盘写入失败/);
    assert.deepStrictEqual(reopened.getPanelBindings(), previous);
    assert.deepStrictEqual(new SuiraStore(file).getPanelBindings(), previous);
    reopened.save = save;
    await reopened.setPanelBindings(movePanelBinding(previous, 'S', '2').bindings);
    assert.strictEqual(effectiveBinding(new SuiraStore(file).getPanelBindings(), '2').id, 'capture');
    console.log('  PASS  写入失败时内存与磁盘保留原绑定，恢复后仍可继续移动');
    pass++;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
