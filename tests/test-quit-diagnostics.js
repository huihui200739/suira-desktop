'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: tick } = require('node:timers/promises');
const { createQuitCoordinator } = require('../lib/quit-coordinator');
const { recordDiagnostic } = require('../lib/diagnostic-log');
const { flushRendererDrafts } = require('../lib/renderer-flush');
const { SuiraStore } = require('../lib/store');

async function main() {
  const renderer = executeJavaScript => ({ webContents: { executeJavaScript } });
  const crashed = new Error('Renderer process gone');
  const destroyed = new Error('Object has been destroyed');
  const results = await Promise.allSettled([
    flushRendererDrafts(renderer(() => Promise.reject(crashed))),
    flushRendererDrafts(renderer(() => { throw destroyed; })),
    flushRendererDrafts(renderer(() => new Promise(() => {})), 20),
    flushRendererDrafts(renderer(async () => { await tick(); return 'saved'; }))
  ]);
  assert.deepEqual(results.slice(0, 2), [
    { status: 'rejected', reason: crashed },
    { status: 'rejected', reason: destroyed }
  ]);
  assert.equal(results[2].status, 'rejected');
  assert.equal(results[2].reason.code, 'ERR_RENDERER_TIMEOUT');
  assert.deepEqual(results[3], { status: 'fulfilled', value: 'saved' });

  let windows = [{}];
  const events = [];
  const error = Object.assign(new Error('secret and C:\\private'), { code: 'EPERM' });
  let fail = true;
  const event = { preventDefault: () => events.push('prevented') };
  const handle = createQuitCoordinator({
    pendingWindows: () => windows,
    requestWindowClose: () => events.push('confirm'),
    needsFlush: () => true,
    flush: async () => { events.push('flush'); if (fail) throw error; },
    quit: () => handle(event),
    onError: reason => events.push(reason.code),
    onReady: () => events.push('quit')
  });
  handle(event);
  assert.deepEqual(events.splice(0), ['prevented', 'confirm']);
  windows = [];
  handle(event);
  handle(event);
  await tick();
  assert.deepEqual(events.splice(0), ['prevented', 'prevented', 'flush', 'EPERM']);
  fail = false;
  handle(event);
  await tick();
  assert.deepEqual(events.splice(0), ['prevented', 'flush', 'quit']);
  handle(event); // Simulate will-quit cancelling the preceding attempt.
  await tick();
  assert.deepEqual(events, ['prevented', 'flush', 'quit']);

  const owner = path.resolve(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(owner, 'suira-quit-test-'));
  const file = path.join(profile, 'diagnostics.log');
  try {
    await fs.writeFile(file, 'x'.repeat(256 * 1024));
    recordDiagnostic(profile, 'fatal', 'main-exception', error);
    const line = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(Object.keys(line).sort(), ['at', 'code', 'event', 'level', 'type']);
    assert.equal(line.code, 'EPERM');
    assert.equal((await fs.stat(`${file}.1`)).size, 256 * 1024);
    const dataPath = path.join(profile, 'store', 'suira-data.json');
    const store = new SuiraStore(dataPath, { getEncryptionKey: () => null });
    await fs.mkdir(dataPath, { recursive: true });
    const failed = store.save();
    await assert.rejects(store.dispose());
    await assert.rejects(failed);
    await fs.rmdir(dataPath);
    store.addItem({ kind: 'text', text: 'first write' });
    const first = store.save();
    // Start the first snapshot before queuing the final write.
    await tick();
    const closing = store.dispose();
    const last = store.addItem({ kind: 'text', text: 'last write before closing' });
    await Promise.all([first, store.save(), closing]);
    assert.equal(new SuiraStore(dataPath).getItem(last.id).text, 'last write before closing');
    await assert.rejects(store.save(), /store is closed/);
    await assert.rejects(store._serialize({}, null), /writer is closed/);
    await store.dispose();
    console.log('PASS quit retry, worker drain and disposal, flush ordering and bounded diagnostics');
  } finally {
    assert.equal(path.dirname(path.resolve(profile)), owner);
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
