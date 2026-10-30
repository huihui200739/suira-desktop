'use strict';

/**
 * 剪贴板采集纯函数层单测（无 electron / 无 fs）。
 * 风格与 test-core.js 一致：自定义 t() 计数，失败退出码 1。
 */

const assert = require('assert');
const {
  parseClipboardFileUris,
  filesItemFields,
  normalizeForCompare,
  findRecentDuplicate,
  buildCaptureItem
} = require('../lib/clipboard-capture');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const EMPTY_FIELDS = { title: '', text: '', filePath: '' };

/* ============================================================
 * 1. parseClipboardFileUris
 * ============================================================ */
console.log('\n== parseClipboardFileUris ==');

t('单文件', () => {
  assert.deepStrictEqual(parseClipboardFileUris('file:///C:/Users/a/b.txt'), ['C:\\Users\\a\\b.txt']);
});

t('多文件（LF）', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/a.txt\nfile:///D:/b/c.txt'),
    ['C:\\a.txt', 'D:\\b\\c.txt']
  );
});

t('多文件（CRLF）', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/a.txt\r\nfile:///C:/b.txt\r\n'),
    ['C:\\a.txt', 'C:\\b.txt']
  );
});

t('空行被忽略', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/a.txt\n\n   \n\t\nfile:///C:/b.txt'),
    ['C:\\a.txt', 'C:\\b.txt']
  );
});

t('# 注释行被忽略', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('#这行是注释\nfile:///C:/a.txt\n#file:///C:/b.txt'),
    ['C:\\a.txt']
  );
});

t('http/https/mailto 行被忽略', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('http://example.com/a.txt\nhttps://example.com/b\nmailto:a@b.c\nfile:///C:/ok.txt'),
    ['C:\\ok.txt']
  );
});

t('百分号编码空格 %20', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/path%20with%20space.txt'),
    ['C:\\path with space.txt']
  );
});

t('百分号编码中文', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/%E4%B8%AD%E6%96%87/%E6%8A%A5%E5%91%8A.txt'),
    ['C:\\中文\\报告.txt']
  );
});

t('原文中文路径', () => {
  assert.deepStrictEqual(parseClipboardFileUris('file:///C:/中文.txt'), ['C:\\中文.txt']);
});

t('UNC 路径 file://server/share/x.txt', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file://server/share/x.txt'),
    ['\\\\server\\share\\x.txt']
  );
});

t('file:// 缺少第三条斜杠（file://C:/...）', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file://C:/Users/a/b.txt'),
    ['C:\\Users\\a\\b.txt']
  );
});

t('协议大小写不敏感 FILE:///', () => {
  assert.deepStrictEqual(parseClipboardFileUris('FILE:///C:/a.txt'), ['C:\\a.txt']);
});

t('单斜杠形态 file:/C:/x.txt', () => {
  assert.deepStrictEqual(parseClipboardFileUris('file:/C:/x.txt'), ['C:\\x.txt']);
});

t('localhost 视为本机', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file://localhost/C:/x.txt'),
    ['C:\\x.txt']
  );
});

t('重复路径去重（大小写不敏感）且保持原顺序/首次大小写', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///D:/z.txt\nfile:///c:/A.txt\nfile:///C:/a.txt\nfile:///D:/z.txt'),
    ['D:\\z.txt', 'c:\\A.txt']
  );
});

t('非法百分号编码的行被跳过，合法行保留', () => {
  assert.deepStrictEqual(
    parseClipboardFileUris('file:///C:/bad%ZZname.txt\nfile:///C:/good.txt'),
    ['C:\\good.txt']
  );
});

t('只有 file:// 无法还原成路径 -> 忽略', () => {
  assert.deepStrictEqual(parseClipboardFileUris('file://'), []);
});

t('空白输入', () => {
  assert.deepStrictEqual(parseClipboardFileUris(''), []);
  assert.deepStrictEqual(parseClipboardFileUris('   \r\n\t\n  '), []);
});

t('非字符串输入', () => {
  assert.deepStrictEqual(parseClipboardFileUris(null), []);
  assert.deepStrictEqual(parseClipboardFileUris(undefined), []);
  assert.deepStrictEqual(parseClipboardFileUris(123), []);
  assert.deepStrictEqual(parseClipboardFileUris({}), []);
});

/* ============================================================
 * 2. filesItemFields
 * ============================================================ */
console.log('\n== filesItemFields ==');

t('空输入', () => {
  assert.deepStrictEqual(filesItemFields([]), EMPTY_FIELDS);
  assert.deepStrictEqual(filesItemFields(), EMPTY_FIELDS);
  assert.deepStrictEqual(filesItemFields(['', '   ', 42, null]), EMPTY_FIELDS);
});

t('单文件', () => {
  const fields = filesItemFields(['C:\\Users\\a\\报告.txt']);
  assert.deepStrictEqual(fields, {
    title: '报告.txt',
    text: 'C:\\Users\\a\\报告.txt',
    filePath: 'C:\\Users\\a\\报告.txt'
  });
});

t('3 个文件：文件名用「、」连接', () => {
  const fields = filesItemFields(['C:\\a\\a.txt', 'C:\\b\\b.txt', 'C:\\d\\c.txt']);
  assert.strictEqual(fields.title, 'a.txt\u3001b.txt\u3001c.txt');
});

t('5 个文件：前 3 个 + 「 等 5 个」', () => {
  const paths = ['C:\\a\\1.txt', 'C:\\b\\2.txt', 'C:\\c\\3.txt', 'C:\\d\\4.txt', 'C:\\e\\5.txt'];
  assert.strictEqual(filesItemFields(paths).title, '1.txt\u30012.txt\u30013.txt 等 5 个');
});

t('超长文件名截断到 60 字符并加省略号', () => {
  const name = 'x'.repeat(70) + '.txt';
  const title = filesItemFields([`C:\\${name}`]).title;
  assert.strictEqual(title.length, 61);
  assert.ok(title.endsWith('\u2026'));
  assert.strictEqual(title, 'x'.repeat(60) + '\u2026');
});

t('text 每行一个绝对路径，无额外缩进', () => {
  const paths = ['C:\\a\\1.txt', 'C:\\b\\2.txt', 'C:\\c\\3.txt'];
  const fields = filesItemFields(paths);
  assert.deepStrictEqual(fields.text.split('\n'), paths);
  assert.strictEqual(fields.text, paths.join('\n'));
});

t('filePath 取第一个路径', () => {
  const fields = filesItemFields(['C:\\first\\a.txt', 'C:\\second\\b.txt']);
  assert.strictEqual(fields.filePath, 'C:\\first\\a.txt');
});

t('混合斜杠与含空格的文件名', () => {
  const fields = filesItemFields(['C:/Users/a/b.txt', 'C:\\My Folder\\c d.txt']);
  assert.strictEqual(fields.title, 'b.txt\u3001c d.txt');
  assert.strictEqual(fields.filePath, 'C:/Users/a/b.txt');
});

t('不改入参（数组被冻结仍可调用）', () => {
  const paths = deepFreeze(['C:\\a\\1.txt', 'C:\\b\\2.txt']);
  const fields = filesItemFields(paths);
  assert.strictEqual(fields.text, 'C:\\a\\1.txt\nC:\\b\\2.txt');
  assert.deepStrictEqual(paths, ['C:\\a\\1.txt', 'C:\\b\\2.txt']);
});

/* ============================================================
 * 3. normalizeForCompare
 * ============================================================ */
console.log('\n== normalizeForCompare ==');

t('CRLF 统一为 \\n', () => {
  assert.strictEqual(normalizeForCompare('a\r\nb'), 'a\nb');
});

t('单独 CR 统一为 \\n', () => {
  assert.strictEqual(normalizeForCompare('a\rb'), 'a\nb');
});

t('去首尾空白', () => {
  assert.strictEqual(normalizeForCompare('  hello  '), 'hello');
  assert.strictEqual(normalizeForCompare('\n\t hello \r\n'), 'hello');
});

t('去掉零宽字符 \\u200b-\\u200d 与 \\ufeff', () => {
  assert.strictEqual(normalizeForCompare('a\u200bb\u200dc\ufeff'), 'abc');
  assert.strictEqual(normalizeForCompare('\ufeffhello\u200b'), 'hello');
});

t('连续空白压缩为单个空格', () => {
  assert.strictEqual(normalizeForCompare('a   b\t\tc'), 'a b c');
});

t('换行保留为分隔符（只压缩换行以外的空白）', () => {
  assert.strictEqual(normalizeForCompare('a\n\nb    c'), 'a\n\nb c');
});

t('非字符串输入返回空串', () => {
  assert.strictEqual(normalizeForCompare(null), '');
  assert.strictEqual(normalizeForCompare(undefined), '');
  assert.strictEqual(normalizeForCompare(123), '');
  assert.strictEqual(normalizeForCompare({}), '');
  assert.strictEqual(normalizeForCompare(['a']), '');
});

t('空串与全空白串', () => {
  assert.strictEqual(normalizeForCompare(''), '');
  assert.strictEqual(normalizeForCompare('   \n\t '), '');
});

t('幂等性：normalize(normalize(x)) === normalize(x)', () => {
  const once = normalizeForCompare('  a\r\n\r\n  b   c\u200b  ');
  assert.strictEqual(normalizeForCompare(once), once);
});

/* ============================================================
 * 4. findRecentDuplicate
 * ============================================================ */
console.log('\n== findRecentDuplicate ==');

const BASE = Date.now();
const textItem = { id: 't1', kind: 'text', text: 'hello', createdAt: BASE - 1000 };
const imageItem = { id: 'i1', kind: 'image', text: '', meta: { hash: 'hash-1' }, createdAt: BASE - 1000 };

t('同 kind 文本命中', () => {
  const hit = findRecentDuplicate([textItem], { kind: 'text', text: 'hello' });
  assert.strictEqual(hit, textItem);
});

t('不同 kind 不命中（即使文本相同）', () => {
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'files', text: 'hello' }), null);
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'link', text: 'hello' }), null);
});

t('文本仅空白差异命中', () => {
  const item = { id: 'w1', kind: 'text', text: 'hello    world', createdAt: BASE };
  assert.strictEqual(findRecentDuplicate([item], { kind: 'text', text: '  hello world  ' }), item);
});

t('换行与空格不被视为同一内容（保留换行语义）', () => {
  const item = { id: 'w2', kind: 'text', text: 'hello\nworld', createdAt: BASE };
  assert.strictEqual(findRecentDuplicate([item], { kind: 'text', text: 'hello world' }), null);
});

t('image hash 命中', () => {
  assert.strictEqual(
    findRecentDuplicate([imageItem], { kind: 'image', hash: 'hash-1' }),
    imageItem
  );
});

t('image 候选可读 meta.hash', () => {
  assert.strictEqual(
    findRecentDuplicate([imageItem], { kind: 'image', meta: { hash: 'hash-1' } }),
    imageItem
  );
});

t('image 缺 hash 不命中', () => {
  assert.strictEqual(findRecentDuplicate([imageItem], { kind: 'image' }), null);
  assert.strictEqual(findRecentDuplicate([imageItem], { kind: 'image', hash: '' }), null);
  const noHashItem = { id: 'i2', kind: 'image', meta: {}, createdAt: BASE };
  assert.strictEqual(findRecentDuplicate([noHashItem], { kind: 'image', hash: 'hash-1' }), null);
});

t('files 路径列表命中（paths 兜底）', () => {
  const item = {
    id: 'f1',
    kind: 'files',
    text: 'C:\\a.txt\nC:\\b.txt',
    filePath: 'C:\\a.txt',
    createdAt: BASE
  };
  assert.strictEqual(
    findRecentDuplicate([item], { kind: 'files', paths: ['C:\\a.txt', 'C:\\b.txt'] }),
    item
  );
});

t('files 候选 text 命中', () => {
  const item = { id: 'f2', kind: 'files', text: 'C:\\a.txt\nC:\\b.txt', createdAt: BASE };
  assert.strictEqual(
    findRecentDuplicate([item], { kind: 'files', text: 'C:\\a.txt\nC:\\b.txt' }),
    item
  );
});

t('windowMs 过滤过旧条目', () => {
  const old = { id: 'o1', kind: 'text', text: 'hello', createdAt: Date.now() - 10000 };
  assert.strictEqual(findRecentDuplicate([old], { kind: 'text', text: 'hello' }, { windowMs: 5000 }), null);
  assert.strictEqual(findRecentDuplicate([old], { kind: 'text', text: 'hello' }, { windowMs: 20000 }), old);
});

t('windowMs=0 不限时间', () => {
  const old = { id: 'o2', kind: 'text', text: 'hello', createdAt: Date.now() - 10000 };
  assert.strictEqual(findRecentDuplicate([old], { kind: 'text', text: 'hello' }, { windowMs: 0 }), old);
});

t('limit 只查最近 N 条', () => {
  const items = [
    { id: 'm', kind: 'text', text: 'target', createdAt: BASE - 3000 },
    { id: 'n1', kind: 'text', text: 'other-1', createdAt: BASE - 1000 },
    { id: 'n2', kind: 'text', text: 'other-2', createdAt: BASE - 2000 }
  ];
  assert.strictEqual(findRecentDuplicate(items, { kind: 'text', text: 'target' }, { limit: 2 }), null);
  assert.strictEqual(findRecentDuplicate(items, { kind: 'text', text: 'target' }, { limit: 3 }), items[0]);
});

t('默认 limit 为 200', () => {
  const many = [];
  for (let i = 0; i < 200; i++) {
    many.push({ id: 'n' + i, kind: 'text', text: 'no-' + i, createdAt: BASE - i });
  }
  many.push({ id: 'deep', kind: 'text', text: 'deep-target', createdAt: BASE - 5000 });
  assert.strictEqual(findRecentDuplicate(many, { kind: 'text', text: 'deep-target' }), null);
  assert.strictEqual(
    findRecentDuplicate(many, { kind: 'text', text: 'deep-target' }, { limit: 201 }),
    many[200]
  );
});

t('limit=0 不查', () => {
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'text', text: 'hello' }, { limit: 0 }), null);
});

t('返回最近一条（createdAt 最大）', () => {
  const items = [
    { id: 'old', kind: 'text', text: 'hello', createdAt: BASE - 5000 },
    { id: 'new', kind: 'text', text: 'hello', createdAt: BASE - 500 }
  ];
  // 输入顺序打乱也不影响
  const hit = findRecentDuplicate([items[0], items[1]], { kind: 'text', text: 'hello' });
  assert.strictEqual(hit.id, 'new');
});

t('输入顺序任意，内部按 createdAt 排序', () => {
  const items = [
    { id: 'a', kind: 'text', text: 'x', createdAt: BASE - 100 },
    { id: 'b', kind: 'text', text: 'x', createdAt: BASE - 900 }
  ];
  assert.strictEqual(findRecentDuplicate(items, { kind: 'text', text: 'x' }).id, 'a');
});

t('空 items', () => {
  assert.strictEqual(findRecentDuplicate([], { kind: 'text', text: 'hello' }), null);
  assert.strictEqual(findRecentDuplicate(null, { kind: 'text', text: 'hello' }), null);
});

t('candidate 非法（null / 无 kind / 未知 kind）', () => {
  assert.strictEqual(findRecentDuplicate([textItem], null), null);
  assert.strictEqual(findRecentDuplicate([textItem], undefined), null);
  assert.strictEqual(findRecentDuplicate([textItem], { text: 'hello' }), null);
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'bogus', text: 'hello' }), null);
});

t('candidate 文本为空不命中', () => {
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'text', text: '   ' }), null);
  assert.strictEqual(findRecentDuplicate([textItem], { kind: 'text' }), null);
});

t('link 类型同 kind 去重', () => {
  const item = { id: 'l1', kind: 'link', text: 'https://example.com/a', createdAt: BASE };
  assert.strictEqual(
    findRecentDuplicate([item], { kind: 'link', text: 'https://example.com/a' }),
    item
  );
  assert.strictEqual(
    findRecentDuplicate([item], { kind: 'link', text: 'https://example.com/b' }),
    null
  );
});

t('不改入参（items 顺序与内容不变，候选不变）', () => {
  const items = [
    { id: 'a', kind: 'text', text: 'x', createdAt: BASE - 100 },
    { id: 'b', kind: 'text', text: 'x', createdAt: BASE - 900 }
  ];
  const candidate = { kind: 'text', text: 'x' };
  const itemsSnapshot = JSON.stringify(items);
  const candidateSnapshot = JSON.stringify(candidate);
  findRecentDuplicate(deepFreeze(items), deepFreeze(candidate));
  assert.strictEqual(JSON.stringify(items), itemsSnapshot);
  assert.strictEqual(JSON.stringify(candidate), candidateSnapshot);
});

/* ============================================================
 * 5. buildCaptureItem
 * ============================================================ */
console.log('\n== buildCaptureItem ==');

const SOURCE = deepFreeze({ type: 'clipboard', appName: 'Explorer', confidence: 'inferred' });

t('text：字段与 title 缺省（正文前 42 字符）', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'hello world' }, SOURCE);
  assert.deepStrictEqual(item, {
    kind: 'text',
    title: 'hello world',
    text: 'hello world',
    filePath: '',
    source: { type: 'clipboard', appName: 'Explorer', confidence: 'inferred' },
    meta: {}
  });
  assert.strictEqual(item.source.type, 'clipboard');
});

t('text：长正文 title 截断到 42 字符', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'x'.repeat(100) });
  assert.strictEqual(item.title.length, 42);
});

t('text：候选 title 优先', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'hello', title: ' 自定义 ' });
  assert.strictEqual(item.title, '自定义');
});

t('text：meta 透传', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'x', meta: { truncated: true } });
  assert.deepStrictEqual(item.meta, { truncated: true });
});

t('link：kind 原样保留', () => {
  const item = buildCaptureItem({ kind: 'link', text: 'https://example.com/a?b=1' });
  assert.strictEqual(item.kind, 'link');
  assert.strictEqual(item.title, 'https://example.com/a?b=1');
});

t('image：title/text/filePath 与 meta.hash + 宽高', () => {
  const item = buildCaptureItem({ kind: 'image', hash: 'abc', width: 800, height: 600 }, SOURCE);
  assert.deepStrictEqual(item, {
    kind: 'image',
    title: '剪贴板图片',
    text: '',
    filePath: '',
    source: { type: 'clipboard', appName: 'Explorer', confidence: 'inferred' },
    meta: { hash: 'abc', width: 800, height: 600 }
  });
});

t('image：hash 可来自 meta.hash，filePath 透传，缺宽高不带字段', () => {
  const item = buildCaptureItem({ kind: 'image', meta: { hash: 'mh' }, filePath: 'C:\\p.png' });
  assert.deepStrictEqual(item.meta, { hash: 'mh' });
  assert.strictEqual(item.filePath, 'C:\\p.png');
});

t('image：无 hash 时 meta 不带 hash', () => {
  const item = buildCaptureItem({ kind: 'image' });
  assert.strictEqual(item.title, '剪贴板图片');
  assert.deepStrictEqual(item.meta, {});
});

t('files：title/text/filePath 来自 filesItemFields', () => {
  const paths = ['C:\\a\\1.txt', 'C:\\b\\2.txt'];
  const item = buildCaptureItem({ kind: 'files', paths }, SOURCE);
  assert.deepStrictEqual(item, {
    kind: 'files',
    title: '1.txt\u30012.txt',
    text: 'C:\\a\\1.txt\nC:\\b\\2.txt',
    filePath: 'C:\\a\\1.txt',
    source: { type: 'clipboard', appName: 'Explorer', confidence: 'inferred' },
    meta: {}
  });
});

t('files：单路径用 filePath 兜底', () => {
  const item = buildCaptureItem({ kind: 'files', filePath: 'C:\\x\\only.txt' });
  assert.strictEqual(item.title, 'only.txt');
  assert.strictEqual(item.text, 'C:\\x\\only.txt');
});

t('files：空 paths', () => {
  const item = buildCaptureItem({ kind: 'files', paths: [] });
  assert.deepStrictEqual(
    { title: item.title, text: item.text, filePath: item.filePath },
    EMPTY_FIELDS
  );
});

t('source 透传（默认空对象）', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'x' });
  assert.deepStrictEqual(item.source, {});
  const withSource = buildCaptureItem({ kind: 'text', text: 'x' }, { type: 'clipboard', appName: 'WeChat' });
  assert.deepStrictEqual(withSource.source, { type: 'clipboard', appName: 'WeChat' });
});

t('不生成 id / createdAt', () => {
  const item = buildCaptureItem({ kind: 'text', text: 'x' });
  assert.ok(!('id' in item));
  assert.ok(!('createdAt' in item));
  assert.ok(!('updatedAt' in item));
});

t('不改入参（深冻结的候选仍可调用，快照不变）', () => {
  const candidate = deepFreeze({
    kind: 'files',
    paths: ['C:\\a\\1.txt', 'C:\\b\\2.txt'],
    meta: { origin: 'explorer' }
  });
  const snapshot = JSON.stringify(candidate);
  const item = buildCaptureItem(candidate, SOURCE);
  assert.strictEqual(JSON.stringify(candidate), snapshot);
  assert.notStrictEqual(item.meta, candidate.meta);
  assert.strictEqual(item.meta.origin, 'explorer');
});

t('候选非法返回 null', () => {
  assert.strictEqual(buildCaptureItem(null), null);
  assert.strictEqual(buildCaptureItem(undefined), null);
  assert.strictEqual(buildCaptureItem({}), null);
  assert.strictEqual(buildCaptureItem('text'), null);
});

t('options.title 覆盖、options.meta 合并（便捷扩展）', () => {
  const item = buildCaptureItem(
    { kind: 'text', text: 'x', meta: { a: 1 } },
    {},
    { title: '自定义标题', meta: { b: 2 } }
  );
  assert.strictEqual(item.title, '自定义标题');
  assert.deepStrictEqual(item.meta, { a: 1, b: 2 });
});

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
