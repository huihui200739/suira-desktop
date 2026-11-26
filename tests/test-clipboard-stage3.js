'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseColor, normalizePlainText, sanitizeTags } = require('../src/clipboard-color');
const { SuiraStore } = require('../lib/store');
const { registerContentIpc } = require('../lib/content-ipc');

(async () => {
  // 1. Color auto-detection, CSS Color 4 formats, & lossless round-trip conversion
  const blue = parseColor('#3b82f6');
  assert.ok(blue, 'Parses 6-digit HEX');
  assert.equal(blue.hex, '#3B82F6');
  assert.equal(blue.rgb, 'rgb(59, 130, 246)');
  assert.equal(parseColor(blue.hsl).hex, '#3B82F6', 'HSL round-trips back to exact #3B82F6');
  assert.equal(blue.isLight, false);

  // Near-black & 1/255 alpha fidelity (P1-2 regressions!)
  const nearBlack = parseColor('#010101');
  assert.equal(nearBlack.hex, '#010101');
  assert.equal(parseColor(nearBlack.hsl).hex, '#010101', '#010101 -> HSL -> HEX stays #010101');
  const minAlpha = parseColor('#00000001');
  assert.equal(minAlpha.hex, '#00000001');
  assert.notEqual(minAlpha.a, 0, '1/255 alpha never collapses to 0');
  assert.equal(parseColor(minAlpha.rgb).hex, '#00000001', '1/255 alpha RGB round-trips to #00000001');
  assert.equal(parseColor(minAlpha.hsl).hex, '#00000001', '1/255 alpha HSL round-trips to #00000001');

  const shortHex = parseColor('#fff');
  assert.equal(shortHex.hex, '#FFFFFF');
  assert.equal(shortHex.rgb, 'rgb(255, 255, 255)');
  assert.equal(shortHex.hsl, 'hsl(0, 0%, 100%)');
  assert.equal(shortHex.isLight, true);

  const rgba = parseColor('rgba(16, 185, 129, 0.5)');
  assert.ok(rgba, 'Parses rgba()');
  assert.equal(rgba.hex, '#10B98180');
  assert.equal(rgba.rgb, 'rgba(16, 185, 129, 0.5)');
  assert.equal(parseColor(rgba.hsl).hex, '#10B98180');

  const css4 = parseColor('rgb(255 128 0 / 50%)');
  assert.ok(css4, 'Parses CSS Color 4 space/slash syntax');
  assert.equal(css4.hex, '#FF800080');

  // CSS Color 4 percentage RGB & angle units (turn/rad/grad) (P2-1 regressions!)
  const pctRgb = parseColor('rgb(100% 0% 0% / 50%)');
  assert.ok(pctRgb, 'Parses percentage RGB with slash alpha');
  assert.equal(pctRgb.hex, '#FF000080');
  const turnHsl = parseColor('hsl(.5turn 100% 50%)');
  assert.ok(turnHsl, 'Parses hsl() with turn angle unit');
  assert.equal(turnHsl.hex, '#00FFFF');
  const gradHsl = parseColor('hsl(200grad, 100%, 50%)');
  assert.equal(gradHsl.hex, '#00FFFF');
  const radHsl = parseColor(`hsl(${Math.PI}rad, 100%, 50%)`);
  assert.equal(radHsl.hex, '#00FFFF');

  // Rejects mixed number/percent RGB, out-of-range values, multi-line strings, and CSS injection
  assert.equal(parseColor('rgb(100%, 0, 0)'), null);
  assert.equal(parseColor('hello world'), null);
  assert.equal(parseColor('#12345'), null);
  assert.equal(parseColor('rgb(300, 0, 0)'), null);
  assert.equal(parseColor('hsl(120, 120%, 50%)'), null);
  assert.equal(parseColor('#fff; background: url(evil)'), null);
  assert.equal(parseColor('#ffffff\nnext line'), null);

  // 2. Plain-text normalization (Shift+Enter unformatted paste)
  const messy = '\uFEFF  第一行\u00A0测试  \r\n\u200B第二行   \r\n\r\n\r\n\r\n第三行\t ';
  assert.equal(normalizePlainText(messy), '第一行 测试\n第二行\n\n第三行');
  assert.equal(normalizePlainText(''), '');

  // 3. Tag sanitization, persistence, & serialized rollback concurrency (P1-1 regression!)
  assert.deepEqual(
    sanitizeTags([' 工作 ', '工作', '代码\n注入', '', '12345678901234567890', 'A', 'B', 'C', 'D']),
    ['工作', '代码注入', '1234567890123456', 'A', 'B']
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'suira-clip-stage3-'));
  try {
    const storePath = path.join(root, 'suira-data.json');
    const store = new SuiraStore(storePath);
    const item = store.addItem({ kind: 'text', title: '品牌蓝', text: '#3b82f6', source: { type: 'clipboard' } });
    const wsItem = store.addItem({ kind: 'text', title: '工作区文档', text: '# Doc', source: { type: 'user' }, meta: { workspace: 'markdown' } });
    await store.save();

    const handlers = new Map();
    let broadcasts = 0;
    registerContentIpc({
      handle: (ch, fn) => handlers.set(ch, fn),
      store,
      removalUndo: { undo: async () => ({ ok: true }), remove: async () => ({ ok: true }) },
      broadcast: () => { broadcasts += 1; },
      classifyText: () => 'text',
      thumbnailFor: () => '',
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      shell: {}
    });

    const setRes = await handlers.get('content:set-tags')({}, { id: item.id, tags: ['工作', '设计', '工作'] });
    assert.equal(setRes.ok, true);
    assert.deepEqual(setRes.tags, ['工作', '设计']);
    assert.equal(broadcasts, 1);

    // Concurrent tag update while first save fails: A fails and rolls back BEFORE B mutates & saves -> B persists cleanly!
    const origSave = store.save.bind(store);
    let failFirst = true;
    let releaseFirst;
    const firstStarted = new Promise((resolve) => {
      store.save = async () => {
        if (failFirst) {
          failFirst = false;
          resolve();
          await new Promise((r) => { releaseFirst = r; });
          throw new Error('模拟磁盘写入失败');
        }
        return origSave();
      };
    });
    const reqA = handlers.get('content:set-tags')({}, { id: item.id, tags: ['A'] });
    await firstStarted;
    const reqB = handlers.get('content:set-tags')({}, { id: item.id, tags: ['B'] });
    releaseFirst();
    await assert.rejects(() => reqA, /模拟磁盘写入失败/);
    const resB = await reqB;
    store.save = origSave;
    assert.equal(resB.ok, true);
    assert.deepEqual(resB.tags, ['B']);
    assert.deepEqual(store.getItem(item.id).meta.tags, ['B'], 'Memory keeps B after A failed');
    const reloadedAfterRace = new SuiraStore(storePath);
    assert.deepEqual(reloadedAfterRace.getItem(item.id).meta.tags, ['B'], 'Disk keeps B after A failed');

    // Workspace items reject tagging
    const wsRes = await handlers.get('content:set-tags')({}, { id: wsItem.id, tags: ['非法'] });
    assert.equal(wsRes.ok, false);

    // Clearing tags removes meta.tags cleanly
    const clearRes = await handlers.get('content:set-tags')({}, { id: item.id, tags: [] });
    assert.equal(clearRes.ok, true);
    assert.deepEqual(clearRes.tags, []);
    assert.equal(store.getItem(item.id).meta.tags, undefined);

    console.log('PASS Stage 3 Clipboard Bar color detection, lossless conversion, plain-text normalization, and serialized tag persistence');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
