const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mergeLines, cleanText } = require('../lib/actions');
const { SuiraStore } = require('../lib/store');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}

console.log('\n== mergeLines ==');
t('中文断行不加空格', () => assert.strictEqual(mergeLines('第一行\n第二行'), '第一行第二行'));
t('英文断行加空格', () => assert.strictEqual(mergeLines('hello\nagain'), 'hello again'));
t('中英混排中文处不加空格', () => assert.strictEqual(mergeLines('测试\ntext'), '测试text'));
t('段落之间保留空行', () => assert.strictEqual(mergeLines('段落一\n接续\n\n段落二'), '段落一接续\n\n段落二'));
t('CRLF 归一后英文加空格', () => assert.strictEqual(mergeLines('a\r\nb'), 'a b'));
t('空输入', () => assert.strictEqual(mergeLines(''), ''));
t('全空白输入', () => assert.strictEqual(mergeLines('  \n\n  '), ''));

console.log('\n== cleanText ==');
t('去零宽字符', () => assert.strictEqual(cleanText('a\u200bb\u200dc\ufeff'), 'abc'));
t('压缩多空格', () => assert.strictEqual(cleanText('a    b'), 'a b'));
t('行尾空格移除', () => assert.strictEqual(cleanText('a   \nb'), 'a\nb'));
t('三连空行压成两行', () => assert.strictEqual(cleanText('a\n\n\n\nb'), 'a\n\nb'));
t('幂等性：清理两次结果相同', () => {
  const once = cleanText('  a   b  \n\n\n c  ');
  assert.strictEqual(cleanText(once), once);
});

console.log('\n== Store 基础 ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-t-'));
const dataFile = path.join(tmp, 'data.json');
const store = new SuiraStore(dataFile);

t('新增条目', () => {
  const item = store.addItem({ kind: 'text', title: 'T', text: 'hello' });
  assert.ok(item.id.startsWith('item-'));
  assert.strictEqual(store.getItem(item.id).text, 'hello');
});
t('非法 kind 回落 text', () => assert.strictEqual(store.addItem({ kind: 'bogus', text: 'x' }).kind, 'text'));
t('自动生成 id', () => assert.ok(store.addItem({ text: 'no id' }).id.length > 0));
t('列表倒序', () => {
  const list = store.listItems({ limit: 10 });
  for (let i = 1; i < list.length; i++) assert.ok(list[i-1].createdAt >= list[i].createdAt);
});
t('搜索命中', () => {
  store.addItem({ kind: 'text', title: 'needle', text: 'findme-123' });
  assert.strictEqual(store.listItems({ query: 'findme-123' }).length, 1);
});
t('kind 过滤', () => {
  store.addItem({ kind: 'link', text: 'https://a.com', title: 'L' });
  assert.ok(store.listItems({ kinds: ['link'] }).every((i) => i.kind === 'link'));
});
t('删除条目同时从任务移除', () => {
  const item = store.addItem({ kind: 'text', text: 'tbd' });
  const task = store.createTask('T1');
  store.addItemToTask(task.id, item.id);
  store.removeItem(item.id);
  assert.ok(!store.getTask(task.id).itemIds.includes(item.id));
});
t('任务加入去重', () => {
  const item = store.addItem({ kind: 'text', text: 'dupe' });
  const task = store.createTask('T2');
  store.addItemToTask(task.id, item.id);
  store.addItemToTask(task.id, item.id);
  assert.strictEqual(store.getTask(task.id).itemIds.filter((i) => i === item.id).length, 1);
});
t('confidence 非法回落 unknown', () => {
  assert.strictEqual(store.addItem({ kind: 'text', text: 'c', source: { type: 'clipboard', confidence: 'hacked' } }).source.confidence, 'unknown');
});
t('正文截断 200000', () => assert.strictEqual(store.addItem({ kind: 'text', text: 'x'.repeat(250000) }).text.length, 200000));
t('parentIds 上限 32', () => {
  const item = store.addItem({ kind: 'text', text: 'p', parentIds: Array.from({length: 50}, (_, i) => 'id' + i) });
  assert.ok(item.parentIds.length <= 32);
});
t('NUL 字符被剥离', () => assert.strictEqual(store.addItem({ kind: 'text', text: 'a\u0000b' }).text, 'ab'));

console.log('\n== 保留期 / prune（直接构造数据，绕开 addItem 内建 prune）==');
t('置顶的过期内容保留', () => {
  const s = new SuiraStore(path.join(tmp, 'p1.json'));
  s.data.items = [
    { id: 'a', kind: 'text', title: 'old-pin', text: 'x', createdAt: Date.now() - 400*86400000, pinned: true, source: { type: 'user', confidence: 'certain' } },
    { id: 'b', kind: 'text', title: 'old-free', text: 'y', createdAt: Date.now() - 400*86400000, pinned: false, source: { type: 'user', confidence: 'certain' } }
  ];
  s.prune();
  assert.ok(s.getItem('a'), '置顶应保留');
  assert.strictEqual(s.getItem('b'), null, '非置顶过期应清理');
});
t('任务内过期内容保留', () => {
  const s = new SuiraStore(path.join(tmp, 'p2.json'));
  s.data.items = [{ id: 'a', kind: 'text', title: 'in-task', text: 'x', createdAt: Date.now() - 400*86400000, pinned: false, source: { type: 'user', confidence: 'certain' } }];
  s.data.tasks = [{ id: 't', title: 'T', itemIds: ['a'], createdAt: Date.now(), updatedAt: Date.now() }];
  s.prune();
  assert.ok(s.getItem('a'), '任务内内容应保留');
});
t('新内容不被清理', () => {
  const s = new SuiraStore(path.join(tmp, 'p3.json'));
  s.data.items = [{ id: 'a', kind: 'text', title: 'new', text: 'x', createdAt: Date.now(), pinned: false, source: { type: 'user', confidence: 'certain' } }];
  s.prune();
  assert.ok(s.getItem('a'));
});
t('maxItems 上限生效且置顶优先', () => {
  const s = new SuiraStore(path.join(tmp, 'p4.json'));
  s.data.settings = { ...s.getSettings(), maxItems: 50, retentionDays: 3650 };
  s.data.items = [];
  for (let i = 0; i < 80; i++) {
    s.data.items.push({ id: 'i'+i, kind: 'text', title: 't'+i, text: 'x', createdAt: Date.now() - i*1000, pinned: i === 79, source: { type: 'user', confidence: 'certain' } });
  }
  s.prune();
  assert.ok(s.data.items.length <= 50, '实际 ' + s.data.items.length);
  assert.ok(s.getItem('i79'), '置顶项必须保留');
});

t('maxItems 按刷新后的时间保留，不按旧数组位置误删', () => {
  const s = new SuiraStore(path.join(tmp, 'recent-cap.json'));
  s.data.settings = { ...s.getSettings(), maxItems: 3, retentionDays: 3650 };
  const stamp = Date.now();
  for (let i = 0; i < 3; i++) s.addItem({ id: 'recent-' + i, text: 'content', createdAt: stamp - (3 - i) * 1000 });
  // The oldest item remains at the backing array's end after being touched.
  s.touchItem('recent-0');
  s.addItem({ id: 'newest', text: 'new content', createdAt: Date.now() + 1000 });
  assert.ok(s.getItem('recent-0'), '刚再次复制的内容必须保留');
  assert.strictEqual(s.getItem('recent-1'), null, '应移除最久未刷新的内容');
  assert.deepStrictEqual(s.listItems().map(item => item.id), ['newest', 'recent-0', 'recent-2']);
});

console.log('\n== 执行记录 ==');
t('上限 500 条', () => {
  const s = new SuiraStore(path.join(tmp, 'e.json'));
  for (let i = 0; i < 520; i++) s.recordExecution({ actionId: 'output.copy', inputIds: [], status: 'done' });
  assert.ok(s.listExecutions(600).length <= 500);
});
t('倒序返回', () => {
  const s = new SuiraStore(path.join(tmp, 'e2.json'));
  s.recordExecution({ actionId: 'a', status: 'done', startedAt: 1000 });
  s.recordExecution({ actionId: 'b', status: 'done', startedAt: 2000 });
  assert.strictEqual(s.listExecutions(2)[0].actionId, 'b');
});

console.log('\n== 落盘与重载 ==');
(async () => {
  await store.save();
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.ok(raw.version >= 1 && Array.isArray(raw.items) && Array.isArray(raw.tasks) && Array.isArray(raw.executions));
    console.log('  PASS  落盘为合法 JSON'); pass++;
    const s2 = new SuiraStore(dataFile);
    assert.strictEqual(s2.data.items.length, store.data.items.length);
    console.log('  PASS  重载条目数一致 (' + s2.data.items.length + ')'); pass++;
  } catch (e) { console.log('  FAIL  落盘 -> ' + e.message); fail++; }

  try {
    const missingFile = path.join(tmp, 'new-library.json');
    assert.strictEqual(fs.existsSync(missingFile), false);
    const firstRun = new SuiraStore(missingFile);
    assert.deepStrictEqual(firstRun.data.items, []);
    const item = firstRun.addItem({ text: 'first-run content' });
    await firstRun.save();
    assert.strictEqual(new SuiraStore(missingFile).getItem(item.id).text, 'first-run content');
    console.log('  PASS  文件不存在仍可首次创建并保存'); pass++;
  } catch (e) { console.log('  FAIL  首次创建 -> ' + e.message); fail++; }

  try {
    const damagedFile = path.join(tmp, 'damaged-library.json');
    const original = '{ incomplete ordinary test data';
    fs.writeFileSync(damagedFile, original, 'utf8');
    assert.throws(() => new SuiraStore(damagedFile), /无法读取本地数据.*保护原文件/);
    assert.strictEqual(fs.readFileSync(damagedFile, 'utf8'), original);
    console.log('  PASS  普通损坏夹具停止加载，原文件不变'); pass++;
  } catch (e) { console.log('  FAIL  损坏文件保护 -> ' + e.message); fail++; }

  try {
    const reloadFile = path.join(tmp, 'reload-failure.json');
    const existing = new SuiraStore(reloadFile);
    existing.addItem({ text: 'previously loaded content' });
    await existing.save();
    const original = '{ interrupted ordinary save fixture';
    fs.writeFileSync(reloadFile, original, 'utf8');
    const alreadyQueued = existing.save();
    assert.throws(() => existing.load(), /无法读取本地数据/);
    await assert.rejects(alreadyQueued, /无法读取本地数据/);
    existing.addItem({ text: 'must not overwrite damaged file' });
    await assert.rejects(existing.save(), /无法读取本地数据/);
    assert.strictEqual(fs.readFileSync(reloadFile, 'utf8'), original);
    // A successful explicit reload is required before writes can resume.
    fs.writeFileSync(reloadFile, JSON.stringify({ items: [], tasks: [] }), 'utf8');
    existing.load();
    const recovered = existing.addItem({ text: 'recovered fixture' });
    await existing.save();
    assert.strictEqual(new SuiraStore(reloadFile).getItem(recovered.id).text, 'recovered fixture');
    console.log('  PASS  重载失败后禁止保存，成功重载后才恢复写入'); pass++;
  } catch (e) { console.log('  FAIL  重载失败写入保护 -> ' + e.message); fail++; }

  try {
    const unreadableFile = path.join(tmp, 'read-failure.json');
    const original = JSON.stringify({ items: [], tasks: [], fixture: 'unchanged' });
    fs.writeFileSync(unreadableFile, original, 'utf8');
    const readFileSync = fs.readFileSync;
    try {
      fs.readFileSync = function (file, ...args) {
        if (file === unreadableFile) throw Object.assign(new Error('synthetic read unavailable'), { code: 'EACCES' });
        return readFileSync.call(this, file, ...args);
      };
      assert.throws(() => new SuiraStore(unreadableFile), error => {
        assert.match(error.message, /无法读取本地数据.*保护原文件/);
        assert.strictEqual(error.cause.code, 'EACCES');
        return true;
      });
    } finally { fs.readFileSync = readFileSync; }
    assert.strictEqual(fs.readFileSync(unreadableFile, 'utf8'), original);
    console.log('  PASS  模拟普通读取失败停止加载，不更改权限或原文件'); pass++;
  } catch (e) { console.log('  FAIL  读取失败保护 -> ' + e.message); fail++; }

  try {
    const isolatedFile = path.join(tmp, 'task-snapshots.json');
    const snapshots = new SuiraStore(isolatedFile);
    const item = snapshots.addItem({ kind: 'text', text: 'first snapshot' });
    const task = snapshots.createTask('snapshot task');
    snapshots.addItemToTask(task.id, item.id);
    const firstSave = snapshots.save();
    snapshots.updateItem(item.id, { text: 'second snapshot' });
    const secondSave = snapshots.save();
    await Promise.all([firstSave, secondSave]);
    const reloaded = new SuiraStore(isolatedFile);
    assert.strictEqual(reloaded.getItem(item.id).text, 'second snapshot');
    assert.deepStrictEqual(reloaded.getTask(task.id).itemIds, [item.id]);
    assert.strictEqual(reloaded.listTasks()[0].items[0].text, 'second snapshot');
    reloaded.removeItem(item.id);
    await reloaded.save();
    const afterRemoval = new SuiraStore(isolatedFile);
    assert.deepStrictEqual(afterRemoval.getTask(task.id).itemIds, []);
    console.log('  PASS  顺序保存、任务关联及删除可持久化重载'); pass++;
  } catch (e) { console.log('  FAIL  任务关联与顺序快照 -> ' + e.message); fail++; }

  console.log('\n== 设置白名单 ==');
  const s = await store.updateSettings({ recordClipboard: false, retentionDays: 7, theme: 'dark', ocrLangs: 'eng', maxItems: 500, evilKey: 'x' });
  try {
    assert.strictEqual(s.recordClipboard, false);
    assert.strictEqual(s.retentionDays, 7);
    assert.strictEqual(s.theme, 'dark');
    assert.strictEqual(s.evilKey, undefined);
    console.log('  PASS  白名单生效'); pass++;
  } catch (e) { console.log('  FAIL  白名单 -> ' + e.message); fail++; }
  try {
    assert.strictEqual((await store.updateSettings({ theme: 'neon' })).theme, 'dark');
    console.log('  PASS  非法 theme 被忽略'); pass++;
  } catch (e) { console.log('  FAIL  非法 theme -> ' + e.message); fail++; }
  try {
    const r = await store.updateSettings({ retentionDays: 99999 });
    assert.ok(r.retentionDays <= 3650);
    console.log('  PASS  保留天数被夹紧'); pass++;
  } catch (e) { console.log('  FAIL  保留天数夹紧 -> ' + e.message); fail++; }

  try {
    assert.strictEqual(store.getSettings().panelCompact,false);
    await store.updateSettings({panelCompact:true});await store.save();
    const restored=new SuiraStore(dataFile);await restored.load();assert.strictEqual(restored.getSettings().panelCompact,true);
    assert.strictEqual((await restored.updateSettings({panelCompact:'false'})).panelCompact,true);
    await store.updateSettings({panelCompact:false});
    console.log('  PASS  紧凑面板默认关闭、持久化并拒绝非布尔值');pass++;
  } catch(e) {console.log('  FAIL  紧凑面板设置 -> '+e.message);fail++;}
  console.log('\n== 主窗口状态与剪贴板置顶 ==');
  try {
    assert.strictEqual(store.getWindowState(), null, '初始不应有窗口状态');
    const saved = store.setWindowState({ x: 100, y: 50, width: 1200, height: 800, maximized: false });
    assert.strictEqual(saved.width, 1200);
    await store.save();
    const reloaded = new SuiraStore(dataFile);
    assert.deepStrictEqual(reloaded.getWindowState(), { x: 100, y: 50, width: 1200, height: 800, maximized: false });
    console.log('  PASS  窗口状态可落盘并在重启后恢复'); pass++;
  } catch (e) { console.log('  FAIL  窗口状态持久化 -> ' + e.message); fail++; }
  try {
    store.setWindowState({ x: NaN, y: 0, width: 800, height: 600 });
    assert.strictEqual(store.getWindowState().width, 1200, '非法输入不应覆盖已记录的状态');
    console.log('  PASS  非法窗口状态被丢弃'); pass++;
  } catch (e) { console.log('  FAIL  非法窗口状态 -> ' + e.message); fail++; }
  try {
    const item = store.addItem({ kind: 'text', text: '去重测试' });
    const before = item.createdAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const touched = store.touchItem(item.id);
    assert.ok(touched.createdAt > before, '应刷新 createdAt 让条目回到最前');
    assert.strictEqual(store.touchItem('not-exist'), null);
    console.log('  PASS  同一内容再次复制时置顶而不是新增'); pass++;
  } catch (e) { console.log('  FAIL  touchItem -> ' + e.message); fail++; }

  if (process.env.SUIRA_KEEP_TEST_DATA === '1') console.log('  保留合成测试夹具：' + tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
