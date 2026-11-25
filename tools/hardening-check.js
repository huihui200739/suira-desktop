'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { connect } = require('./runtime-client');
const { KeyVault, decryptItem, encryptItem } = require('../lib/crypto-store');
const { SuiraStore } = require('../lib/store');

const root = path.resolve(__dirname, '..');
async function until(read) {
  for (let attempt = 0; attempt < 160; attempt++) {
    try { const value = await read(); if (value) return value; } catch (error) {
      if (attempt === 159) throw error;
    }
    await sleep(60);
  }
  throw Error('Fixture did not reach the expected state');
}

async function run() {
  const owner = path.resolve(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(owner, 'suira-hardening-'));
  const sockets = [];
  let child;
  try {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const keyPath = path.join(profile, 'suira-data.key');
    const dataPath = path.join(profile, 'suira-data.json');
    const legacy = new KeyVault();
    assert.equal((await legacy.loadOrCreate(keyPath)).ok, true);
    const codec = { isReady: () => true, encode: item => encryptItem(legacy.key, item), decode: item => decryptItem(legacy.key, item) };
    const fixture = new SuiraStore(dataPath, { codec });
    await fixture.updateSettings({ recordClipboard: true, globalShortcutsEnabled: false, panelGuideSeen: true });
    const sample = fixture.addItem({ kind: 'text', title: 'Protected existing record', text: 'legacy fixture' });
    const stale = fixture.addItem({ kind: 'text', title: 'Expired fixture', text: 'expire this', createdAt: Date.now() - 2 * 86400000 });
    await fixture.save();
    const entry = path.join(profile, 'app.js'), result = path.join(profile, 'listener-ready');
    await fs.writeFile(entry, `
      const { app, clipboard, dialog, globalShortcut, ipcMain } = require('electron');
      const fs = require('node:fs');
      app.setPath('userData', ${JSON.stringify(profile)});
      const taskExport = ${JSON.stringify(path.join(profile, 'task-export.md'))};
      let savePrompts = 0;
      dialog.showSaveDialog = async (parent, options) => {
        const assert = require('node:assert/strict');
        assert.ok(options.defaultPath.endsWith('Audit_Task.md'));
        if (savePrompts === 0) assert.equal(parent, null, 'Hidden workbench is not a dialog parent');
        else assert.ok(parent?.isVisible() && parent.webContents.getURL().endsWith('/index.html'), 'Visible workbench owns the dialog');
        savePrompts += 1;
        return { canceled: savePrompts === 1, filePath: taskExport };
      };
      const registered = [];
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, callback) => { registered.push(channel); return handle(channel, callback); };
      app.on('browser-window-created', (_event, win) => {
        win.webContents.once('did-finish-load', () => fs.writeFileSync(${JSON.stringify(path.join(profile, 'registered.json'))}, JSON.stringify(registered)));
      });
      globalShortcut.register = () => false;
      let text = '';
      let sequence = 1;
      const { InputInjector } = require(${JSON.stringify(path.join(root, 'lib/input-injector'))});
      InputInjector.prototype.clipboardSequence = () => sequence;
      clipboard.read = async () => text ? [{ types: ['text/plain'], getType: async () => text }] : [];
      clipboard.availableFormats = () => [];
      clipboard.readText = async () => text;
      clipboard.writeText = async value => {
        fs.writeFileSync(${JSON.stringify(path.join(profile, 'clipboard-written.txt'))}, value);
      };
      const events = require(${JSON.stringify(path.join(root, 'lib/windows-clipboard-events'))});
      const watch = events.watchWindowsClipboard;
      events.watchWindowsClipboard = (win, callback) => {
        const stop = watch(win, callback);
        const ffi = require(${JSON.stringify(path.join(root, 'node_modules/koffi'))});
        const send = ffi.load('user32.dll').func('__stdcall','PostMessageW','int',['uintptr_t','uint32','uintptr_t','intptr_t']);
        setTimeout(() => {
          text = 'clipboard event fixture';
          sequence += 1;
          if (!send(win.getNativeWindowHandle().readBigUInt64LE(), 0x031d, 0, 0)) throw Error('Native notification failed');
          fs.writeFileSync(${JSON.stringify(result)}, 'ok');
        }, 450);
        return stop;
      };
      require(${JSON.stringify(path.join(root, 'main.js'))});
    `);
    const candidates = [process.env.SUIRA_TEST_ELECTRON, 'C:/suira-electron/electron.exe', path.join(root, 'node_modules/electron/dist/electron.exe')];
    let executable;
    for (const file of candidates.filter(Boolean)) if (await fs.stat(file).catch(() => null)) { executable = file; break; }
    assert.ok(executable, 'Electron runtime required');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [entry, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    const exit = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    const page = async predicate => {
      const client = await until(() => connect(port, predicate));
      sockets.push(client.ws);
      await until(() => client.evaluate('Boolean(window.suira)'));
      return client;
    };
    const main = await page(target => target.url.endsWith('/index.html'));
    const registered = await until(async () => JSON.parse(await fs.readFile(path.join(profile, 'registered.json'), 'utf8')));
    const invoked = new Set();
    for (const name of ['preload.js', 'voice-preload.js', 'pin-preload.js']) {
      const source = await fs.readFile(path.join(root, name), 'utf8');
      for (const [, channel] of source.matchAll(/invoke\('([^']+)'/g)) invoked.add(channel);
    }
    assert.deepEqual(registered.sort(), [...invoked].sort(), 'Preload and actual IPC registrations must match');
    assert.equal((await main.evaluate(`window.suira.content.get(${JSON.stringify(sample.id)})`)).text, 'legacy fixture');
    assert.equal((await main.evaluate(`window.suira.content.get(${JSON.stringify(stale.id)})`)).text, 'expire this');
    await main.evaluate('window.suira.settings.update({retentionDays:1})');
    assert.ok(!(await main.evaluate('window.suira.content.list()')).some(item => item.id === stale.id));
    assert.match(await fs.readFile(keyPath, 'utf8'), /^safeStorage:/);
    assert.equal(await until(() => fs.readFile(result, 'utf8')), 'ok');
    // The injected clipboard does not touch the user's system clipboard. The Win32
    // message still travels through the real hidden HWND and Electron's hook.
    await until(async () => (await main.evaluate('window.suira.content.list()')).some(item => item.text === 'clipboard event fixture'));
    assert.equal((await main.evaluate('window.suira.notes.create()')).ok, true);
    const note = await page(target => target.url.endsWith('/notes.html'));
    assert.equal((await note.evaluate('window.suira.settings.update({recordClipboard:false})')).code, 'IPC_FORBIDDEN');
    assert.equal(await note.evaluate(`Boolean(window.open('about:blank'))`), false);
    await note.evaluate(`{
      const link = document.createElement('a');
      link.href = 'index.html';
      link.textContent = 'Navigation fixture';
      link.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:140px;height:60px;app-region:no-drag';
      document.body.append(link);
    }`);
    for (const type of ['mousePressed', 'mouseReleased']) await note.send('Input.dispatchMouseEvent', { type, x: 35, y: 15, button: 'left', clickCount: 1 });
    await sleep(100);
    assert.ok(await note.evaluate(`location.pathname.endsWith('/notes.html')`));
    await main.evaluate('window.suira.quick.show()');
    const panel = await page(target => target.url.endsWith('/quickpanel.html'));
    await until(() => panel.evaluate('document.readyState === "complete"'));
    const panelState = await panel.evaluate('window.suira.panel.state()');
    for (const name of ['rows', 'keys', 'tools']) assert.ok(Array.isArray(panelState[name]), `Missing panel ${name}`);
    assert.equal((await panel.evaluate('window.suira.settings.update({recordClipboard:false})')).code, 'IPC_FORBIDDEN');
    const task = (await main.evaluate(`window.suira.tasks.create('Audit/Task')`)).task;
    assert.ok(task?.id);
    const taskId = JSON.stringify(task.id);
    const copied = path.join(profile, 'clipboard-written.txt');
    const exported = path.join(profile, 'task-export.md');
    assert.equal((await main.evaluate(`window.suira.tasks.copyText(${taskId})`)).ok, false);
    await assert.rejects(fs.stat(copied), { code: 'ENOENT' });
    const assignment = JSON.stringify({ taskId: task.id, itemId: sample.id });
    assert.equal((await main.evaluate(`window.suira.tasks.addItem(${assignment})`)).ok, true);
    assert.deepEqual(await main.evaluate(`window.suira.tasks.copyText(${taskId})`), { ok: true, text: 'legacy fixture' });
    assert.equal(await fs.readFile(copied, 'utf8'), 'legacy fixture');
    for (const method of ['list', 'copyText', 'export']) {
      assert.equal((await panel.evaluate(`window.suira.tasks.${method}(${taskId})`)).code, 'IPC_FORBIDDEN');
    }
    await main.evaluate('window.suira.window.close()');
    await until(() => main.evaluate('document.visibilityState === "hidden"'));
    assert.deepEqual(await main.evaluate(`window.suira.tasks.export(${taskId})`), { ok: false, canceled: true });
    await assert.rejects(fs.stat(exported), { code: 'ENOENT' });
    await panel.evaluate('window.suira.quick.showMain("shelf")');
    await until(() => main.evaluate('document.visibilityState === "visible"'));
    assert.deepEqual(await main.evaluate(`window.suira.tasks.export(${taskId})`), { ok: true, filePath: exported });
    assert.match(await fs.readFile(exported, 'utf8'), /^# Audit\/Task\n[\s\S]*\n## Protected existing record\n\nlegacy fixture\n/);
    assert.equal((await main.evaluate(`window.suira.tasks.removeItem(${assignment})`)).ok, true);
    const notes = await note.evaluate('window.suira.notes.list()');
    assert.ok(notes.length);
    assert.equal((await note.evaluate(`window.suira.notes.update(${JSON.stringify({ id: notes[0].id, text: 'last debounced edit' })})`)).ok, true);
    assert.equal((await panel.evaluate('window.suira.app.quit()')).ok, true);
    assert.equal(await Promise.race([exit, sleep(8000, 'timeout', { ref: false })]), 0);
    const persisted = new SuiraStore(dataPath, { codec });
    assert.equal(persisted.getNote(notes[0].id).text, 'last debounced edit');
    assert.equal(persisted.getItem(sample.id).text, 'legacy fixture');
    child = spawn(executable, [entry, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    const restarted = await page(target => target.url.endsWith('/index.html'));
    assert.equal((await restarted.evaluate(`window.suira.content.get(${JSON.stringify(sample.id)})`)).text, 'legacy fixture');
    console.log('PASS real Electron: legacy key migration and restart, native clipboard notification, denied navigation/popups/IPC, task copy/export/cancel and immediate quit flush');
  } finally {
    for (const socket of sockets) socket.close();
    if (child?.pid && child.exitCode === null && !child.signalCode) {
      const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done;
    }
    assert.equal(path.dirname(path.resolve(profile)), owner);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
