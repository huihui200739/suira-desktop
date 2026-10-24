const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createActionRegistry } = require('./lib/actions');
const { SuiraStore } = require('./lib/store');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const tmp = path.join(os.tmpdir(), 'suira-act-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const store = new SuiraStore(path.join(tmp, 'd.json'));

const written = [];
const broadcasts = [];
const pinCalls = [];
const registry = createActionRegistry({
  store,
  ocr: { recognizeFile: async () => ({ text: '识别出的文字\n第二行', confidence: 91, blocks: [], engine: 'test', cached: false }) },
  clipboard: {
    writeText: async (v) => written.push({ kind: 'text', v }),
    writeImage: async () => written.push({ kind: 'image' })
  },
  shell: { showItemInFolder: () => {}, openExternal: async () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 100, height: 80 }) }) },
  openPath: async () => '',
  pinImage: async (p, w, h) => pinCalls.push({ p, w, h }),
  broadcast: (ch, p) => broadcasts.push({ ch, p }),
  assetPath: () => '',
  capturesDir: () => tmp,
  makeId: (p) => p + '-test'
});

(async () => {
  console.log('\n== listForItem 类型匹配 ==');
  t('文字条目动作集', () => {
    const list = registry.listForItem({ kind: 'text' });
    // 第三批：文字条目多了「翻译」，位置紧跟复制（最常用的排前面）
    assert.deepStrictEqual(list, ['output.copy', 'text.translate', 'text.merge-lines', 'text.clean', 'output.shelf']);
  });
  t('图片条目动作集', () => {
    const list = registry.listForItem({ kind: 'image' });
    // 图片条目：取词 → 翻译 → 钉图，都是对同一张图的操作
    assert.deepStrictEqual(list, ['ocr.local', 'text.translate', 'image.pin', 'output.copy', 'output.shelf']);
  });
  t('文件条目动作集', () => {
    assert.deepStrictEqual(registry.listForItem({ kind: 'files' }), ['files.reveal', 'output.copy', 'output.shelf']);
  });
  t('null 条目返回空', () => assert.deepStrictEqual(registry.listForItem(null), []));

  console.log('\n== 动作执行 ==');
  const textItem = store.addItem({ kind: 'text', title: '原文', text: '第一行\n第二行\n\n第三段' });

  await ta('text.merge-lines 生成派生内容且保留父子关系', async () => {
    const r = await registry.execute(textItem.id, 'text.merge-lines');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.output.text, '第一行第二行\n\n第三段');
    assert.deepStrictEqual(r.output.parentIds, [textItem.id]);
    assert.strictEqual(r.output.meta.originItemId, textItem.id);
    assert.strictEqual(store.getItem(textItem.id).text, '第一行\n第二行\n\n第三段', '原内容不能被覆盖');
  });

  await ta('text.clean 生成派生内容', async () => {
    const r = await registry.execute(textItem.id, 'text.clean');
    assert.strictEqual(r.ok, true);
    assert.ok(r.output.id !== textItem.id);
  });

  await ta('output.copy 文字写入剪贴板', async () => {
    written.length = 0;
    const r = await registry.execute(textItem.id, 'output.copy');
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(written[0], { kind: 'text', v: '第一行\n第二行\n\n第三段' });
  });

  await ta('output.shelf 加入临时收集并自动建任务', async () => {
    const r = await registry.execute(textItem.id, 'output.shelf');
    assert.strictEqual(r.ok, true);
    const task = store.data.tasks.find((x) => x.title === '临时收集');
    assert.ok(task && task.itemIds.includes(textItem.id));
  });

  const imgItem = store.addItem({ kind: 'image', title: '图', filePath: path.join(tmp, 'a.png'), meta: { width: 100, height: 80 } });
  await ta('ocr.local 生成文字并带引擎与置信度', async () => {
    const r = await registry.execute(imgItem.id, 'ocr.local');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.output.text, '识别出的文字\n第二行');
    assert.strictEqual(r.output.meta.engine, 'test');
    assert.strictEqual(r.output.meta.confidence, 91);
    assert.strictEqual(r.output.meta.derivedBy, 'ocr.local');
  });

  await ta('image.pin 调用钉图并传尺寸', async () => {
    pinCalls.length = 0;
    const r = await registry.execute(imgItem.id, 'image.pin');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(pinCalls.length, 1);
    assert.deepStrictEqual({ w: pinCalls[0].w, h: pinCalls[0].h }, { w: 100, h: 80 });
  });

  console.log('\n== 失败路径 ==');
  await ta('未知动作返回 ok:false 且记录失败', async () => {
    const r = await registry.execute(textItem.id, 'no.such.action');
    assert.strictEqual(r.ok, false);
    assert.ok(r.error);
    assert.strictEqual(r.execution.status, 'failed');
  });

  await ta('不存在的条目返回 ok:false', async () => {
    const r = await registry.execute('ghost-id', 'output.copy');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /不存在/);
  });

  await ta('图片无 filePath 时 ocr 失败但不崩溃', async () => {
    const bad = store.addItem({ kind: 'image', title: 'bad', filePath: '' });
    const r = await registry.execute(bad.id, 'ocr.local');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /没有可读取的文件/);
  });

  await ta('OCR 空结果视为失败', async () => {
    const emptyRegistry = createActionRegistry({
      store,
      ocr: { recognizeFile: async () => ({ text: '', confidence: 0, blocks: [], engine: 'test', cached: false }) },
      clipboard: { writeText: async () => {}, writeImage: async () => {} },
      shell: {}, nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 1, height: 1 }) }) },
      openPath: async () => '', pinImage: async () => {}, broadcast: () => {}, assetPath: () => '',
      capturesDir: () => tmp, makeId: (p) => p + '-x'
    });
    const img = store.addItem({ kind: 'image', title: 'e', filePath: path.join(tmp, 'e.png') });
    const r = await emptyRegistry.execute(img.id, 'ocr.local');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /没有识别到文字/);
  });

  console.log('\n== 执行记录 ==');
  await ta('每次执行都留下 execution 记录', async () => {
    const before = store.data.executions.length;
    await registry.execute(textItem.id, 'text.merge-lines');
    assert.strictEqual(store.data.executions.length, before + 1);
    const last = store.data.executions[store.data.executions.length - 1];
    assert.strictEqual(last.status, 'done');
    assert.ok(last.jobId);
    assert.ok(last.finishedAt >= last.startedAt);
  });

  await ta('派生内容可追溯回原内容', async () => {
    const derived = store.data.items.filter((i) => (i.parentIds || []).includes(textItem.id));
    assert.ok(derived.length >= 2, '实际 ' + derived.length);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
