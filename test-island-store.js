'use strict';
/*
 * 浮引岛（文件中转）的落盘层测试。
 *
 * lib/island-model.js 负责暂存语义（去重/上限/分类），本文件只验证
 * store 的 island 段：清洗、容量、策略、重启后仍在。
 * 纯 Node，不需要 Electron。
 *
 * 用法：node test-island-store.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SuiraStore } = require('./lib/store');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
};
const tAsync = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
};

const tmp = path.join(os.tmpdir(), 'suira-island-' + process.pid + '-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const dataFile = path.join(tmp, 'data.json');

const shelfItem = (id, filePath, extra = {}) => ({
  id,
  name: path.basename(filePath),
  path: filePath,
  kind: 'file',
  addedAt: 1700000000000,
  ...extra
});

(async () => {
  const store = new SuiraStore(dataFile);

  console.log('\n== 初始状态 ==');
  t('默认空暂存、复制策略', () => {
    const island = store.getIsland();
    assert.deepStrictEqual(island.items, []);
    assert.strictEqual(island.policy, 'copy');
  });
  t('设置里带有第三批快捷键项', () => {
    const settings = store.getSettings();
    assert.strictEqual(settings.shortcutPanelCycle, 'CommandOrControl+Alt+Q');
    assert.strictEqual(settings.shortcutPinnedToggle, 'CommandOrControl+Alt+H');
    assert.strictEqual(settings.shortcutMomentary, 'CommandOrControl+Alt+Shift+Space');
  });

  console.log('\n== 写入与清洗 ==');
  await tAsync('写入条目并持久化', async () => {
    await store.updateIsland({ items: [shelfItem('i1', 'C:\\tmp\\a.png'), shelfItem('i2', 'C:\\tmp\\b.pdf')] });
    const island = store.getIsland();
    assert.strictEqual(island.items.length, 2);
    assert.strictEqual(island.items[0].path, 'C:\\tmp\\a.png');
  });

  await tAsync('缺 path / 非法条目被丢弃，不写坏文件', async () => {
    await store.updateIsland({ items: [null, {}, { id: 'x' }, shelfItem('ok', 'C:\\tmp\\ok.txt')] });
    const island = store.getIsland();
    assert.strictEqual(island.items.length, 1);
    assert.strictEqual(island.items[0].id, 'ok');
  });

  await tAsync('非法 kind 回落 file', async () => {
    await store.updateIsland({ items: [shelfItem('k', 'C:\\tmp\\k.bin', { kind: 'script' })] });
    assert.strictEqual(store.getIsland().items[0].kind, 'file');
  });

  await tAsync('缺 id 自动补，name 缺失由路径推导', async () => {
    await store.updateIsland({ items: [{ path: 'C:\\tmp\\推导名字.txt' }] });
    const item = store.getIsland().items[0];
    assert.ok(item.id && item.id.startsWith('island-'));
    assert.strictEqual(item.name, '推导名字.txt');
  });

  await tAsync('上限 24 条，超出丢尾部最旧', async () => {
    const items = Array.from({ length: 30 }, (_, index) => shelfItem('c' + index, `C:\\tmp\\n${index}.txt`));
    await store.updateIsland({ items });
    const stored = store.getIsland().items;
    assert.strictEqual(stored.length, 24);
    assert.strictEqual(stored[0].id, 'c0');
    assert.strictEqual(stored[23].id, 'c23');
  });

  await tAsync('策略只接受 copy / move，非法值不改当前值', async () => {
    await store.updateIsland({ policy: 'move' });
    assert.strictEqual(store.getIsland().policy, 'move');
    // 非法输入被忽略：不能因为一次坏请求把用户策略重置掉
    await store.updateIsland({ policy: 'delete-everything' });
    assert.strictEqual(store.getIsland().policy, 'move');
    await store.updateIsland({ policy: 'copy' });
    assert.strictEqual(store.getIsland().policy, 'copy');
  });

  await tAsync('只改策略时不动条目列表', async () => {
    await store.updateIsland({ items: [shelfItem('keep', 'C:\\tmp\\keep.txt')] });
    await store.updateIsland({ policy: 'move' });
    assert.strictEqual(store.getIsland().items.length, 1);
    assert.strictEqual(store.getIsland().items[0].id, 'keep');
  });

  console.log('\n== 重启恢复 ==');
  t('重开 store 后暂存与策略都在', () => {
    const reopened = new SuiraStore(dataFile);
    const island = reopened.getIsland();
    assert.strictEqual(island.items.length, 1);
    assert.strictEqual(island.items[0].path, 'C:\\tmp\\keep.txt');
    assert.strictEqual(island.policy, 'move');
  });

  t('旧数据格式（没有 island 段）能正常打开', () => {
    const legacyFile = path.join(tmp, 'legacy.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, items: [], tasks: [], executions: [], settings: {} }), 'utf8');
    const legacy = new SuiraStore(legacyFile);
    assert.deepStrictEqual(legacy.getIsland(), { items: [], policy: 'copy' });
  });

  console.log('\n== 设置持久化 ==');
  await tAsync('清除绑定（空串）能落盘，不会被默认值顶回来', async () => {
    await store.updateSettings({ shortcutQuick: '' });
    assert.strictEqual(store.getSettings().shortcutQuick, '');
    const reopened = new SuiraStore(dataFile);
    assert.strictEqual(reopened.getSettings().shortcutQuick, '');
  });

  await tAsync('按住型键位可改可清', async () => {
    await store.updateSettings({ shortcutMomentary: 'Control+Alt+Shift+F9' });
    assert.strictEqual(store.getSettings().shortcutMomentary, 'Control+Alt+Shift+F9');
    await store.updateSettings({ shortcutMomentary: '' });
    assert.strictEqual(store.getSettings().shortcutMomentary, '');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('测试运行失败:', error);
  process.exit(1);
});
