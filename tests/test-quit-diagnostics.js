'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: tick } = require('node:timers/promises');
const { createQuitCoordinator } = require('../lib/quit-coordinator');
const { recordDiagnostic } = require('../lib/diagnostic-log');

async function main() {
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
    console.log('PASS quit retry, flush ordering and bounded diagnostics without exception text');
  } finally {
    assert.equal(path.dirname(path.resolve(profile)), owner);
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
