const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createActionRegistry } = require('../lib/actions');
const { SuiraStore } = require('../lib/store');
const { runRecipe } = require('../lib/recipes');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-act-'));
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
  pinText:async text=>pinCalls.push({text}),
  appendMarkdown:async text=>({type:'markdown',id:'today',text}),
  openCalendarDraft:async draft=>broadcasts.push({ch:'draft',draft}),
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
    assert.deepStrictEqual(list.slice(0,9), ['output.copy', 'text.translate', 'text.to-note', 'text.to-markdown', 'text.to-calendar', 'text.pin', 'text.merge-lines', 'text.clean', 'output.shelf']);
    for(const id of ['ai.summarize','ai.rewrite','ai.explain','ai.reply','text.convert.json','text.convert.traditional'])assert.ok(list.includes(id));
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

  await ta('追加最近速记保留原文和置顶状态',async()=>{const first=await registry.execute(textItem.id,'text.to-note');assert.ok(first.ok);const note=store.getNote(first.destination.id);assert.equal(note.text,textItem.text);store.toggleNotePin(note.id);const second=await registry.execute(textItem.id,'text.to-note');assert.ok(second.ok);assert.equal(store.getNote(note.id).text,textItem.text+'\n\n'+textItem.text);assert.equal(store.getNote(note.id).pinned,true);});
  await ta('超长速记追加失败且原文不变',async()=>{const note=store.createNote({text:'x'.repeat(20000)});const result=await registry.execute(textItem.id,'text.to-note');assert.equal(result.ok,false);assert.equal(store.getNote(note.id).text.length,20000);});
  await ta('Markdown 接力返回目标文档',async()=>{const result=await registry.execute(textItem.id,'text.to-markdown');assert.ok(result.ok);assert.equal(result.destination.id,'today');});
  await ta('日历只产生草稿，不写入日程',async()=>{const input=store.addItem({kind:'text',text:'明天下午3点开会'}),count=store.data.items.length;const result=await registry.execute(input.id,'text.to-calendar');assert.ok(result.ok);assert.equal(result.draft.time,'15:00');assert.equal(result.draft.draft,true);assert.equal(store.data.items.length,count);assert.ok(broadcasts.some(e=>e.ch==='draft'));});
  await ta('文字钉图传入文字不修改原内容',async()=>{const result=await registry.execute(textItem.id,'text.pin');assert.ok(result.ok);assert.equal(pinCalls.at(-1).text,textItem.text);});
  await ta('图片不能直接作为文字追加',async()=>{const image=store.addItem({kind:'image',filePath:'example.png'});assert.equal((await registry.execute(image.id,'text.to-note')).ok,false);});
  console.log('\n== 普通保存失败与配方提交 ==');
  await ta('保存失败返回失败结果，不因记录失败再次抛出', async () => {
    const failureStore = new SuiraStore(path.join(tmp, 'save-failure.json'));
    const source = failureStore.addItem({ kind: 'text', text: 'original' });
    let saveCalls = 0;
    failureStore.save = async () => { saveCalls++; throw new Error('测试存储暂不可用'); };
    const failureRegistry = createActionRegistry({ store: failureStore, makeId: () => 'job-save-failure' });
    const result = await failureRegistry.execute(source.id, 'text.clean');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.execution.status, 'failed');
    assert.match(result.error, /测试存储暂不可用/);
    assert.match(result.error, /执行记录保存失败/);
    assert.strictEqual(saveCalls, 2);
    assert.strictEqual(failureStore.getItem(source.id).text, 'original');
  });
  await ta('操作失败且记录保存失败时保留两种失败原因', async () => {
    const failureStore = new SuiraStore(path.join(tmp, 'record-failure.json'));
    const source = failureStore.addItem({ kind: 'text', text: 'original' });
    failureStore.save = async () => { throw new Error('测试记录保存失败'); };
    const failureRegistry = createActionRegistry({ store: failureStore, makeId: () => 'job-record-failure' });
    const result = await failureRegistry.execute(source.id, 'no.such.action');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /未知动作/);
    assert.match(result.error, /测试记录保存失败/);
  });
  await ta('收集配方预览不执行副作用，显式提交只执行一次', async () => {
    const calls = [];
    const deps = { execute: async (id, action) => { calls.push(action); return { ok: true }; } };
    const preview = await runRecipe(deps, 'input', 'collect-to-shelf');
    assert.strictEqual(preview.ok, true);
    assert.deepStrictEqual(calls, []);
    const committed = await runRecipe(deps, 'input', 'collect-to-shelf', { commit: true });
    assert.strictEqual(committed.ok, true);
    assert.deepStrictEqual(calls, ['output.shelf']);
  });
  await ta('配方步骤失败时不执行最终提交', async () => {
    const calls = [];
    const result = await runRecipe({ execute: async (id, action) => {
      calls.push(action);
      return { ok: false, error: '测试处理未完成' };
    } }, 'input', 'clean-text', { commit: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stoppedAt, 'text.merge-lines');
    assert.deepStrictEqual(calls, ['text.merge-lines']);
  });
  await ta('配方提交抛出普通错误时返回失败并保留当前结果', async () => {
    const calls = [];
    const result = await runRecipe({ execute: async (id, action) => {
      calls.push(action);
      if (action === 'output.copy') throw new Error('测试剪贴板暂不可用');
      return { ok: true, output: { id: id + '-next', text: 'processed' } };
    } }, 'input', 'clean-text', { commit: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stoppedAt, 'output.copy');
    assert.strictEqual(result.error, '测试剪贴板暂不可用');
    assert.ok(result.current);
    assert.strictEqual(result.output, null);
    assert.deepStrictEqual(calls, ['text.merge-lines', 'text.clean', 'output.copy']);
  });
  await ta('配方提交期间取消时丢弃迟到的成功结果', async () => {
    const controller = new AbortController();
    const result = await runRecipe({ execute: async (id, action) => {
      if (action === 'output.copy') { controller.abort(); return { ok: true }; }
      return { ok: true, output: { id: id + '-next', text: 'processed' } };
    } }, 'input', 'clean-text', { commit: true, signal: controller.signal });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.canceled, true);
    assert.strictEqual(result.output, null);
    assert.strictEqual(result.steps.at(-1).canceled, true);
  });
  if (process.env.SUIRA_KEEP_TEST_DATA === '1') console.log('  保留合成测试夹具：' + tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
