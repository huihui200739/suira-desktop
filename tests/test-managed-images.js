'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SuiraStore } = require('../lib/store');
const { createManagedImages } = require('../lib/managed-images');
const { createRemovalUndo } = require('../lib/removal-undo');

async function run() {
  const owner = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(owner, 'suira-reclaim-'));
  try {
    const captures = path.join(root, 'captures');
    const clipboard = path.join(root, 'clipboard-images');
    const dataPath = path.join(root, 'suira-data.json');
    await fs.mkdir(captures);
    await fs.mkdir(clipboard);
    const source = { type: 'screenshot', acquisitionMethod: 'screen-capture' };
    const filePath = path.join(captures, 'capture-2026-01-01T01-02-03-004Z.png');
    const external = path.join(root, path.basename(filePath));
    await fs.writeFile(filePath, 'managed');
    await fs.writeFile(external, 'external');
    const open = () => new SuiraStore(dataPath, { managedImages: createManagedImages({ captures, clipboard }) });
    let store = open();
    const a = store.addItem({ kind: 'image', filePath, source });
    const b = store.addItem({ kind: 'image', filePath, source: { acquisitionMethod: 'clipboard-image-update' }, managedFileMethod: 'screen-capture' });
    const c = store.addItem({ kind: 'image', filePath: external, source });
    await store.save();
    store.removeItem(a.id);
    await store.save();
    assert.equal(await fs.readFile(filePath, 'utf8'), 'managed', 'Shared reference is retained');
    const pending = store.detachItem(b.id);
    const release = store.holdImage(pending.item);
    store.removeItem(c.id);
    await store.save();
    assert.equal(await fs.readFile(filePath, 'utf8'), 'managed', 'Undo owns a reference');
    assert.deepEqual(JSON.parse(await fs.readFile(dataPath, 'utf8')).pendingImageCleanup.map(item => item.id), [b.id]);
    assert.equal(store.restoreDetachedItem(pending), true);
    release();
    await store.save();
    assert.equal(await fs.readFile(filePath, 'utf8'), 'managed', 'Undo restores the record before releasing the file');

    store = open();
    const detached = store.detachItem(b.id);
    store.holdImage(detached.item);
    await store.save();
    store = open();
    await store.save();
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(external, 'utf8'), 'external');

    await fs.writeFile(filePath, 'expired');
    const expired = store.addItem({ kind: 'image', filePath, source, createdAt: 1 });
    const rename = fs.rename;
    try {
      fs.rename = async () => { throw Object.assign(new Error('fixture write failure'), { code: 'EIO' }); };
      await assert.rejects(store.save(), /fixture write failure/);
    } finally { fs.rename = rename; }
    assert.equal(store.getItem(expired.id), null, 'Retention prunes the metadata');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'expired', 'Failed metadata write must leave image intact');
    assert.ok(!(await fs.readdir(root)).some(name => name.endsWith('.tmp')));
    await store.save();
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });

    await fs.writeFile(filePath, 'undo queue image');
    const queued = store.addItem({ kind: 'image', filePath, source });
    const task = store.createTask('Image task');
    store.addItemToTask(task.id, queued.id);
    let changes = 0;
    const saveErrors = [];
    const undo = createRemovalUndo({ store, onChange: () => changes++, onSaveError: error => saveErrors.push(error) });
    const sender = {};
    const first = await undo.remove(sender, queued.id);
    assert.equal(first.taskCount, 1);
    assert.equal((await undo.undo({}, first.token)).expired, true, 'Tokens are scoped to the originating window');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'undo queue image');
    assert.deepEqual(await undo.undo(sender, first.token), { ok: true });
    assert.deepEqual(store.getTask(task.id).itemIds, [queued.id]);
    const evicted = await undo.remove(sender, queued.id);
    for (let index = 0; index < 10; index++) {
      const item = store.addItem({ kind: 'text', text: `queue ${index}` });
      assert.equal((await undo.remove(sender, item.id)).ok, true);
    }
    await store.save();
    assert.equal((await undo.undo(sender, evicted.token)).expired, true);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
    assert.deepEqual(saveErrors, []);
    assert.equal(changes, 13);
    console.log('PASS managed images: shared reference, restart, retention, failed commit, external original, window-scoped undo and queue eviction');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), owner);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
