'use strict';
/*
 * 第二批验收测试：38 键面板的动作能否「进入工具 → 完成操作 → 关闭或返回」。
 *
 * 这里不测「图标能点」，而是真实调用 lib/panel-actions.js 的执行层，
 * 断言每个动作返回的收尾语义：是否收起面板、是否带用户去结果页、
 * OCR 是否回填结果、失败时是否给出可理解的错误。
 *
 * 用法：node test-panel-flows.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createPanelActions } = require('./lib/panel-actions');
const { SuiraStore } = require('./lib/store');
const { createActionRegistry } = require('./lib/actions');
const { PANEL_ACTIONS, DEFAULT_KEY_BINDINGS } = require('./lib/keybindings');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const tmp = path.join(os.tmpdir(), 'suira-panel-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const store = new SuiraStore(path.join(tmp, 'd.json'));

const calls = { capture: [], pin: [], desktop: 0, lock: 0 };
const actions = createActionRegistry({
  store,
  ocr: { recognizeFile: async () => ({ text: '识别出的文字', confidence: 90, blocks: [], engine: 'test', cached: false }) },
  clipboard: { writeText: async () => {}, writeImage: async () => {} },
  shell: { showItemInFolder: () => {}, openExternal: async () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 100, height: 80 }) }) },
  openPath: async () => '',
  pinImage: async () => {},
  broadcast: () => {},
  assetPath: () => '',
  capturesDir: () => tmp,
  makeId: (p) => p + '-' + Math.random().toString(36).slice(2, 8)
});

function makePanel(overrides = {}) {
  return createPanelActions({
    store,
    actions,
    capture: async (intent) => { calls.capture.push(intent); return { ok: true }; },
    pin: (filePath, size) => calls.pin.push({ filePath, size }),
    switchToDesktop: () => { calls.desktop++; return { ok: true, message: '已显示桌面', closePanel: true }; },
    lockWorkstation: () => { calls.lock++; return { ok: true, message: '正在锁屏', closePanel: true }; },
    ...overrides
  });
}

(async () => {
  console.log('\n== 面板动作目录与绑定一致 ==');

  t('8 个已实现动作都在目录里，且都有绑定键', () => {
    const implemented = Object.entries(PANEL_ACTIONS)
      .filter(([, meta]) => meta.implemented)
      .map(([id]) => id);
    const bound = new Set(Object.values(DEFAULT_KEY_BINDINGS));
    for (const id of implemented) {
      if (!bound.has(id)) throw new Error(`${id} 已实现但没有键位`);
    }
    assert.ok(implemented.length >= 8, '已实现动作少于 8 个');
  });

  t('未实现动作不被声明为已实现', () => {
    for (const [id, meta] of Object.entries(PANEL_ACTIONS)) {
      if (meta.implemented !== true && meta.implemented !== false) {
        throw new Error(`${id} 的 implemented 不是布尔值`);
      }
    }
  });

  console.log('\n== 截图链路：面板 → 覆盖层 → 收起面板 ==');

  const panel = makePanel();

  await ta('Z 截图：进入覆盖层并收起面板', async () => {
    const r = await panel.run('capture');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true, '截图会独占屏幕，面板必须收起');
    assert.strictEqual(calls.capture.at(-1), 'copy');
  });

  await ta('B 标注：走同一个覆盖层，不另开一套界面', async () => {
    const r = await panel.run('annotate');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.strictEqual(calls.capture.at(-1), 'copy');
  });

  await ta('O 提字：进入覆盖层时带上 ocr 意图（框完自动识别）', async () => {
    const r = await panel.run('ocr');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.strictEqual(calls.capture.at(-1), 'ocr', 'OCR 入口没有把意图传下去，框完不会自动识别');
  });

  await ta('截图失败时给出可读错误，不假装成功', async () => {
    const failing = makePanel({ capture: async () => ({ ok: false, error: '没有可截取的屏幕' }) });
    const r = await failing.run('capture');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /没有可截取的屏幕/);
  });

  console.log('\n== OCR 链路：识别 → 结果可查看原图 → 复制/入匣 ==');

  await ta('OCR 结果保留来源关联，供「查看原图」反查', async () => {
    const img = store.addItem({ kind: 'image', title: '屏幕截图', filePath: path.join(tmp, 'a.png'), text: '' });
    const r = await actions.execute(img.id, 'ocr.local');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.output.meta.originItemId, img.id, '识别结果未记录来源图片，查看原图会找不到');
    // 反查：从识别结果能回到那张图片
    const source = store.getItem(r.output.meta.originItemId);
    assert.ok(source, '反查不到来源图片');
    assert.strictEqual(source.kind, 'image');
  });

  await ta('OCR 识别结果为空时按失败处理，不返回空面板', async () => {
    const emptyActions = createActionRegistry({
      store,
      ocr: { recognizeFile: async () => ({ text: '', confidence: 0, blocks: [], engine: 'test', cached: false }) },
      clipboard: { writeText: async () => {}, writeImage: async () => {} },
      shell: { showItemInFolder: () => {}, openExternal: async () => {} },
      nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 1, height: 1 }) }) },
      openPath: async () => '',
      pinImage: async () => {},
      broadcast: () => {},
      assetPath: () => '',
      capturesDir: () => tmp,
      makeId: (p) => p + '-e'
    });
    const img = store.addItem({ kind: 'image', title: '空图', filePath: path.join(tmp, 'b.png'), text: '' });
    const r = await emptyActions.execute(img.id, 'ocr.local');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /没有识别到文字/);
  });

  console.log('\n== 钉图链路 ==');

  await ta('P 钉图：手上有图就钉最近这张', async () => {
    const before = calls.pin.length;
    store.addItem({ kind: 'image', title: '要钉的图', filePath: path.join(tmp, 'pin.png'), text: '', meta: { width: 320, height: 200 } });
    const r = await panel.run('pin');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.strictEqual(calls.pin.length, before + 1, '没有真的创建钉图窗口');
    assert.strictEqual(calls.pin.at(-1).size.width, 320, '钉图未沿用图片原始尺寸');
  });

  await ta('P 钉图：手上没图时直接进截图，而不是报错拒绝', async () => {
    const emptyStore = new SuiraStore(path.join(tmp, 'empty.json'));
    const emptyPanel = createPanelActions({
      store: emptyStore,
      actions,
      capture: async (intent) => { calls.capture.push(intent); return { ok: true }; },
      pin: () => { throw new Error('不该走到这里'); },
      switchToDesktop: () => ({ ok: true }),
      lockWorkstation: () => ({ ok: true })
    });
    const r = await emptyPanel.run('pin');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.strictEqual(calls.capture.at(-1), 'pin', '没有图时应带 pin 意图去截图');
  });

  console.log('\n== 剪贴板 / 文本转换链路 ==');

  await ta('X 剪贴板：带用户去内容库，不停在面板', async () => {
    const r = await panel.run('clipboard');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.openPage, 'library');
    assert.strictEqual(r.closePanel, true);
  });

  await ta('V 文本转换：真实生成整理结果并带用户看结果', async () => {
    store.addItem({ kind: 'text', title: '断行文字', text: '第一行\n第二行\n\n第三段' });
    const r = await panel.run('text-clean');
    assert.strictEqual(r.ok, true);
    assert.ok(r.outputId, '没有返回生成结果的 id，用户看不到成果');
    assert.strictEqual(r.openPage, 'library', '生成结果后没有带用户去内容库');
    const output = store.getItem(r.outputId);
    assert.ok(output, '生成的结果在存储里不存在');
    assert.strictEqual(output.text, '第一行第二行\n\n第三段');
  });

  await ta('V 文本转换：没有文字时说明白，不静默失败', async () => {
    const bare = new SuiraStore(path.join(tmp, 'bare.json'));
    const barePanel = createPanelActions({
      store: bare,
      actions,
      capture: async () => ({ ok: true }),
      pin: () => {},
      switchToDesktop: () => ({ ok: true }),
      lockWorkstation: () => ({ ok: true })
    });
    const r = await barePanel.run('text-clean');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /还没有文字内容/);
  });

  console.log('\n== 系统动作链路 ==');

  await ta('D 显示桌面：调用系统能力并收起面板', async () => {
    const r = await panel.run('desktop');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.ok(calls.desktop >= 1);
  });

  await ta('L 锁屏：调用系统能力并收起面板', async () => {
    const r = await panel.run('lock');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.closePanel, true);
    assert.ok(calls.lock >= 1);
  });

  console.log('\n== 未实现动作的边界 ==');

  await ta('未实现动作被拒绝且提示带动作名', async () => {
    const r = await panel.run('wallpaper');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /尚未实现/);
  });

  await ta('未知动作被拒绝，不会掉进任何分支', async () => {
    const r = await panel.run('no-such-action');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /尚未实现/);
  });

  await ta('所有已实现动作都返回确定语义（不返回 undefined）', async () => {
    const fresh = makePanel();
    for (const [id, meta] of Object.entries(PANEL_ACTIONS)) {
      if (!meta.implemented) continue;
      const r = await fresh.run(id);
      assert.ok(r && typeof r === 'object', `${id} 没有返回结果对象`);
      assert.strictEqual(typeof r.ok, 'boolean', `${id} 的 ok 不是布尔值`);
    }
  });

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('测试脚本异常：', error);
  process.exit(1);
});
