'use strict';

/*
 * lib/island-model.js 的纯函数测试。
 * 写法对齐 test-core.js：自定义 t(name, fn) + PASS/FAIL 计数，退出码 0 表示全绿。
 *
 * 覆盖：分类、路径边界（null / 相对 / \0 / 超长）、规范化、去重、容量与 dropped、
 * 删除、清空、统计，以及「不修改入参」的纯函数性。
 *
 * 用法：node test-island.js
 */

const assert = require('assert');
const {
  MAX_ITEMS,
  classifyPath,
  normalizeShelfItem,
  addShelfItems,
  removeShelfItem,
  clearShelf,
  isShelfablePath,
  summarizeShelf
} = require('../lib/island-model');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const NOW = 1730000000000;
const PDF = 'C:\\Users\\demo\\Desktop\\季度报告.pdf';
const PNG = 'C:\\Users\\demo\\Pictures\\屏幕截图.png';
const ZIP = 'C:\\Users\\demo\\Downloads\\素材包.zip';
const DIR = 'C:\\Users\\demo\\Desktop\\待整理';

console.log('\n== classifyPath ==');
t('png 归为图片', () => assert.strictEqual(classifyPath(PNG), 'image'));
t('扩展名大小写不敏感（JPG）', () => assert.strictEqual(classifyPath('C:\\a\\photo.JPG'), 'image'));
t('svg 归为图片', () => assert.strictEqual(classifyPath('C:\\a\\logo.svg'), 'image'));
t('pdf 归为文档', () => assert.strictEqual(classifyPath(PDF), 'document'));
t('DOCX 归为文档', () => assert.strictEqual(classifyPath('C:\\a\\周报.DOCX'), 'document'));
t('md 归为文档', () => assert.strictEqual(classifyPath('C:\\a\\README.md'), 'document'));
t('zip 归为压缩包', () => assert.strictEqual(classifyPath(ZIP), 'archive'));
t('tar.gz 归为压缩包', () => assert.strictEqual(classifyPath('C:\\a\\备份.tar.gz'), 'archive'));
t('尾部反斜杠视为文件夹', () => assert.strictEqual(classifyPath('C:\\Users\\demo\\素材\\'), 'folder'));
t('尾部正斜杠视为文件夹', () => assert.strictEqual(classifyPath('C:/Users/demo/素材/'), 'folder'));
t('无扩展名归为普通文件', () => assert.strictEqual(classifyPath(DIR), 'file'));
t('未知扩展名归为普通文件', () => assert.strictEqual(classifyPath('C:\\a\\data.xyz'), 'file'));
t('点开头的无扩展名文件归为普通文件', () => assert.strictEqual(classifyPath('C:\\a\\.gitignore'), 'file'));
t('非字符串输入归为普通文件', () => {
  assert.strictEqual(classifyPath(null), 'file');
  assert.strictEqual(classifyPath(''), 'file');
  assert.strictEqual(classifyPath(undefined), 'file');
});

console.log('\n== isShelfablePath ==');
t('盘符绝对路径可暂存', () => assert.strictEqual(isShelfablePath(PDF), true));
t('POSIX 绝对路径可暂存', () => assert.strictEqual(isShelfablePath('/home/demo/a.txt'), true));
t('UNC 共享路径可暂存', () => assert.strictEqual(isShelfablePath('\\\\server\\share\\a.txt'), true));
t('首尾空白会被去掉后判定', () => assert.strictEqual(isShelfablePath('  C:\\a\\b.txt  '), true));
t('相对路径不可暂存', () => assert.strictEqual(isShelfablePath('docs\\a.txt'), false));
t('盘符相对路径不可暂存', () => assert.strictEqual(isShelfablePath('C:relative.txt'), false));
t('空字符串不可暂存', () => assert.strictEqual(isShelfablePath(''), false));
t('纯空白不可暂存', () => assert.strictEqual(isShelfablePath('   '), false));
t('null / 非字符串不可暂存', () => {
  assert.strictEqual(isShelfablePath(null), false);
  assert.strictEqual(isShelfablePath(42), false);
});
t('含 NUL 字符不可暂存', () => assert.strictEqual(isShelfablePath('C:\\a\\b\u0000c.txt'), false));
t('长度上限 4096：等于上限可暂存', () => {
  const exact = 'C:\\' + 'a'.repeat(4093);
  assert.strictEqual(exact.length, 4096);
  assert.strictEqual(isShelfablePath(exact), true);
});
t('长度上限 4096：超出不可暂存', () => {
  assert.strictEqual(isShelfablePath('C:\\' + 'a'.repeat(4094)), false);
});

console.log('\n== normalizeShelfItem：非法输入 ==');
t('null 返回 null', () => assert.strictEqual(normalizeShelfItem(null), null));
t('undefined 返回 null', () => assert.strictEqual(normalizeShelfItem(undefined), null));
t('数组返回 null', () => assert.strictEqual(normalizeShelfItem([PDF]), null));
t('字符串返回 null', () => assert.strictEqual(normalizeShelfItem(PDF), null));
t('缺少 path 返回 null', () => assert.strictEqual(normalizeShelfItem({ name: 'a.txt' }), null));
t('相对路径返回 null', () => assert.strictEqual(normalizeShelfItem({ path: 'docs\\a.txt' }), null));
t('含 NUL 的路径返回 null', () => assert.strictEqual(normalizeShelfItem({ path: 'C:\\a\u0000b.txt' }), null));
t('超长路径返回 null', () => assert.strictEqual(normalizeShelfItem({ path: 'C:\\' + 'a'.repeat(5000) }), null));
t('空对象返回 null', () => assert.strictEqual(normalizeShelfItem({}), null));

console.log('\n== normalizeShelfItem：规范化 ==');
t('name 默认取 basename', () => {
  const item = normalizeShelfItem({ path: PDF }, NOW);
  assert.strictEqual(item.name, '季度报告.pdf');
});
t('显式 name 优先并被去掉首尾空白', () => {
  const item = normalizeShelfItem({ path: PDF, name: '  自定义名称  ' }, NOW);
  assert.strictEqual(item.name, '自定义名称');
});
t('name 截断到 160 个字符', () => {
  const item = normalizeShelfItem({ path: PDF, name: '长'.repeat(200) }, NOW);
  assert.strictEqual(Array.from(item.name).length, 160);
});
t('文件名以文件夹结尾时 basename 正确', () => {
  const item = normalizeShelfItem({ path: 'C:\\Users\\demo\\素材\\' }, NOW);
  assert.strictEqual(item.name, '素材');
  assert.strictEqual(item.kind, 'folder');
});
t('kind 由 classifyPath 推断', () => {
  assert.strictEqual(normalizeShelfItem({ path: PNG }, NOW).kind, 'image');
  assert.strictEqual(normalizeShelfItem({ path: PDF }, NOW).kind, 'document');
  assert.strictEqual(normalizeShelfItem({ path: ZIP }, NOW).kind, 'archive');
  assert.strictEqual(normalizeShelfItem({ path: DIR }, NOW).kind, 'file');
});
t('显式合法 kind 优先（主进程可传 folder）', () => {
  assert.strictEqual(normalizeShelfItem({ path: DIR, kind: 'folder' }, NOW).kind, 'folder');
});
t('非法 kind 回落到推断值', () => {
  const item = normalizeShelfItem({ path: PNG, kind: 'executable' }, NOW);
  assert.strictEqual(item.kind, 'image');
});
t('缺 id 时生成 island-<base36 时间>-<4 hex>', () => {
  const item = normalizeShelfItem({ path: PDF }, NOW);
  assert.match(item.id, /^island-[0-9a-z]+-[0-9a-f]{4}$/);
  assert.ok(item.id.startsWith('island-' + NOW.toString(36) + '-'), '实际: ' + item.id);
});
t('传入 id 保留（去 NUL、截断到 120）', () => {
  assert.strictEqual(normalizeShelfItem({ path: PDF, id: 'keep-1' }, NOW).id, 'keep-1');
  const long = normalizeShelfItem({ path: PDF, id: 'x'.repeat(200) }, NOW);
  assert.strictEqual(long.id.length, 120);
});
t('addedAt 缺省使用传入的 now', () => {
  assert.strictEqual(normalizeShelfItem({ path: PDF }, NOW).addedAt, NOW);
});
t('addedAt 显式值优先', () => {
  assert.strictEqual(normalizeShelfItem({ path: PDF, addedAt: 1234567890 }, NOW).addedAt, 1234567890);
});
t('path 首尾空白被规范化', () => {
  const item = normalizeShelfItem({ path: '  C:\\a\\b.txt  ' }, NOW);
  assert.strictEqual(item.path, 'C:\\a\\b.txt');
});
t('返回值恰好是五个字段', () => {
  const item = normalizeShelfItem({ path: PDF, extra: 'ignored' }, NOW);
  assert.deepStrictEqual(Object.keys(item).sort(), ['addedAt', 'id', 'kind', 'name', 'path']);
});
t('不修改入参、且返回新对象', () => {
  const input = { path: PDF, name: '原名', id: 'x', kind: 'document', addedAt: 7 };
  const before = clone(input);
  const item = normalizeShelfItem(input, NOW);
  assert.deepStrictEqual(input, before);
  assert.notStrictEqual(item, input);
});

console.log('\n== addShelfItems：新增与去重 ==');
t('新条目放最前，块内保持传入顺序', () => {
  const existing = [{ path: 'C:\\old\\a.txt', id: 'old1', name: 'a.txt', kind: 'file', addedAt: 1 }];
  const result = addShelfItems(existing, [{ path: PDF }, { path: PNG }], { now: NOW });
  assert.deepStrictEqual(result.items.map((i) => i.name), ['季度报告.pdf', '屏幕截图.png', 'a.txt']);
  assert.strictEqual(result.added, 2);
  assert.strictEqual(result.dropped, 0);
});
t('路径去重大小写不敏感且保留原条目', () => {
  const existing = [{ id: 'old1', name: 'B.TXT', path: 'C:\\a\\B.TXT', kind: 'file', addedAt: 11 }];
  const result = addShelfItems(existing, [{ path: 'c:\\a\\b.txt' }], { now: NOW });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].id, 'old1');
  assert.strictEqual(result.items[0].addedAt, 11);
  assert.strictEqual(result.added, 0);
});
t('重复 incoming 只保留一条', () => {
  const result = addShelfItems([], [{ path: PDF }, { path: PDF.toUpperCase() }], { now: NOW });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.added, 1);
});
t('非法 incoming 被跳过且不计数', () => {
  const result = addShelfItems([], [null, { path: 'docs\\x.txt' }, { path: PDF }], { now: NOW });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.dropped, 0);
});
t('incoming 为空/缺省时原样保留（副本）', () => {
  const existing = [{ path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 5 }];
  const result = addShelfItems(existing, null, { now: NOW });
  assert.deepStrictEqual(result.items, existing);
  assert.strictEqual(result.added, 0);
  assert.strictEqual(result.dropped, 0);
  assert.notStrictEqual(result.items, existing);
});
t('传入单个对象也按一条处理', () => {
  const result = addShelfItems([], { path: PDF }, { now: NOW });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.added, 1);
});
t('existing 中的重复路径只保留第一条', () => {
  const result = addShelfItems([
    { path: PDF, id: 'first', name: '季度报告.pdf', kind: 'document', addedAt: 1 },
    { path: PDF.toLowerCase(), id: 'second', name: '季度报告.pdf', kind: 'document', addedAt: 2 }
  ], [], { now: NOW });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].id, 'first');
});

console.log('\n== addShelfItems：容量与 dropped ==');
t('默认 cap 为 MAX_ITEMS（24）', () => {
  assert.strictEqual(MAX_ITEMS, 24);
  const incoming = Array.from({ length: 30 }, (_, i) => ({ path: 'C:\\incoming\\f' + i + '.txt' }));
  const result = addShelfItems([], incoming, { now: NOW });
  assert.strictEqual(result.items.length, 24);
  assert.strictEqual(result.added, 24);
  assert.strictEqual(result.dropped, 6);
  assert.strictEqual(result.items[0].name, 'f0.txt');
  assert.strictEqual(result.items[23].name, 'f23.txt');
});
t('自定义 cap 生效', () => {
  const incoming = Array.from({ length: 5 }, (_, i) => ({ path: 'C:\\incoming\\f' + i + '.txt' }));
  const result = addShelfItems([], incoming, { cap: 3, now: NOW });
  assert.strictEqual(result.items.length, 3);
  assert.strictEqual(result.added, 3);
  assert.strictEqual(result.dropped, 2);
});
t('超限时从尾部丢弃最旧条目', () => {
  const existing = Array.from({ length: 23 }, (_, i) => ({
    path: 'C:\\old\\f' + i + '.txt', id: 'old' + i, name: 'f' + i + '.txt', kind: 'file', addedAt: i
  }));
  const result = addShelfItems(existing, [{ path: PDF }, { path: PNG }], { now: NOW });
  assert.strictEqual(result.items.length, 24);
  assert.strictEqual(result.added, 2);
  assert.strictEqual(result.dropped, 1);
  assert.strictEqual(result.items[0].name, '季度报告.pdf');
  assert.ok(!result.items.some((item) => item.id === 'old22'), '最旧的 old22 应被挤出');
  assert.ok(result.items.some((item) => item.id === 'old21'), 'old21 应还在');
});
t('旧条目占满时新条目仍进入并挤出旧条目', () => {
  const existing = Array.from({ length: 24 }, (_, i) => ({
    path: 'C:\\old\\f' + i + '.txt', id: 'old' + i, name: 'f' + i + '.txt', kind: 'file', addedAt: i
  }));
  const result = addShelfItems(existing, [{ path: PDF }], { now: NOW });
  assert.strictEqual(result.items.length, 24);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.dropped, 1);
  assert.strictEqual(result.items[0].name, '季度报告.pdf');
});
t('重复加入同一文件不会增长列表', () => {
  const first = addShelfItems([], [{ path: PDF }], { now: NOW });
  const second = addShelfItems(first.items, [{ path: PDF }], { now: NOW + 1 });
  assert.strictEqual(second.items.length, 1);
  assert.strictEqual(second.added, 0);
  assert.strictEqual(second.dropped, 0);
  assert.strictEqual(second.items[0].addedAt, NOW);
});

console.log('\n== addShelfItems：纯函数性 ==');
t('不修改 existing / incoming，返回新数组', () => {
  const existing = [{ path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 1 }];
  const incoming = [{ path: PNG, name: '截图' }];
  const existingBefore = clone(existing);
  const incomingBefore = clone(incoming);
  const result = addShelfItems(existing, incoming, { now: NOW });
  assert.deepStrictEqual(existing, existingBefore);
  assert.deepStrictEqual(incoming, incomingBefore);
  assert.notStrictEqual(result.items, existing);
  assert.notStrictEqual(result.items[0], existing[0]);
});
t('修改返回值不会影响入参对象', () => {
  const existing = [{ path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 1 }];
  const result = addShelfItems(existing, [{ path: PNG }], { now: NOW });
  result.items[1].name = '被改掉';
  assert.strictEqual(existing[0].name, '季度报告.pdf');
});
t('now 选项用于新条目 addedAt', () => {
  const result = addShelfItems([], [{ path: PDF }], { now: NOW });
  assert.strictEqual(result.items[0].addedAt, NOW);
});
t('options 非法时退回默认 cap 且不抛错', () => {
  const result = addShelfItems([], [{ path: PDF }], { cap: 0, now: NOW });
  assert.strictEqual(result.items.length, 1);
});

console.log('\n== removeShelfItem ==');
t('按 id 删除并保持顺序', () => {
  const items = [
    { path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 1 },
    { path: PNG, id: 'b', name: '屏幕截图.png', kind: 'image', addedAt: 2 },
    { path: ZIP, id: 'c', name: '素材包.zip', kind: 'archive', addedAt: 3 }
  ];
  const result = removeShelfItem(items, 'b');
  assert.deepStrictEqual(result.map((i) => i.id), ['a', 'c']);
  assert.strictEqual(items.length, 3, '入参不得被修改');
});
t('未知 id 返回等长新数组', () => {
  const items = [{ path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 1 }];
  const result = removeShelfItem(items, 'nope');
  assert.strictEqual(result.length, 1);
  assert.notStrictEqual(result, items);
});
t('空 id 返回副本而不是全部删掉', () => {
  const items = [{ path: PDF, id: 'a', name: '季度报告.pdf', kind: 'document', addedAt: 1 }];
  assert.strictEqual(removeShelfItem(items, '').length, 1);
});
t('非数组输入返回空数组', () => {
  assert.deepStrictEqual(removeShelfItem(null, 'a'), []);
});

console.log('\n== clearShelf ==');
t('清空返回空数组', () => {
  const result = clearShelf();
  assert.deepStrictEqual(result, []);
  assert.notStrictEqual(result, clearShelf());
});

console.log('\n== summarizeShelf ==');
t('分类统计正确', () => {
  const items = [
    { path: PNG, id: '1', name: 'a.png', kind: 'image', addedAt: 1 },
    { path: 'C:\\a\\b.jpg', id: '2', name: 'b.jpg', kind: 'image', addedAt: 2 },
    { path: PDF, id: '3', name: 'c.pdf', kind: 'document', addedAt: 3 },
    { path: ZIP, id: '4', name: 'd.zip', kind: 'archive', addedAt: 4 },
    { path: 'C:\\a\\dir\\', id: '5', name: 'dir', kind: 'folder', addedAt: 5 },
    { path: 'C:\\a\\noext', id: '6', name: 'noext', kind: 'file', addedAt: 6 }
  ];
  assert.deepStrictEqual(summarizeShelf(items), {
    count: 6, images: 2, documents: 1, archives: 1, folders: 1
  });
});
t('空列表统计为 0', () => {
  assert.deepStrictEqual(summarizeShelf([]), { count: 0, images: 0, documents: 0, archives: 0, folders: 0 });
});
t('非数组输入统计为 0', () => {
  assert.deepStrictEqual(summarizeShelf(null), { count: 0, images: 0, documents: 0, archives: 0, folders: 0 });
});
t('缺失 kind 时按路径推断', () => {
  const summary = summarizeShelf([{ path: PNG, id: '1', name: 'a.png', addedAt: 1 }]);
  assert.strictEqual(summary.images, 1);
  assert.strictEqual(summary.count, 1);
});
t('不修改入参', () => {
  const items = [{ path: PNG, id: '1', name: 'a.png', kind: 'image', addedAt: 1 }];
  const before = clone(items);
  summarizeShelf(items);
  assert.deepStrictEqual(items, before);
});

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
