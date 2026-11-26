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
const { checkKeyPersistence } = require('./key-persistence-check');

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
  await checkKeyPersistence();
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
    const wrappedKey = await fs.readFile(keyPath, 'utf8');
    const codec = { isReady: () => true, encode: item => encryptItem(legacy.key, item), decode: item => decryptItem(legacy.key, item) };
    const fixture = new SuiraStore(dataPath, { codec });
    await fixture.updateSettings({ recordClipboard: true, globalShortcutsEnabled: false, panelGuideSeen: true });
    const sample = fixture.addItem({ kind: 'text', title: 'Protected existing record', text: 'legacy fixture' });
    const stale = fixture.addItem({ kind: 'text', title: 'Expired fixture', text: 'expire this', createdAt: Date.now() - 2 * 86400000 });
    const imagePath = path.join(profile, 'legacy-fixture.png');
    const { PNG } = require('pngjs');
    await fs.writeFile(imagePath, PNG.sync.write(new PNG({ width: 5, height: 7 })));
    const image = fixture.addItem({ kind: 'image', title: 'Legacy image', filePath: imagePath });
    await fixture.save();
    const entry = path.join(profile, 'app.js'), result = path.join(profile, 'listener-ready');
    const fallback = path.join(profile, 'listener-fallback');
    const writerClosed = path.join(profile, 'writer-closed');
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
        if (fs.existsSync(${JSON.stringify(fallback)})) {
          win.once('closed', () => fs.writeFileSync(${JSON.stringify(fallback)}, 'destroyed'));
          setTimeout(() => {
            text = 'clipboard polling fixture';
            sequence += 1;
          }, 450);
          throw new Error('Simulated clipboard listener registration failure');
        }
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
      const { SuiraStore } = require(${JSON.stringify(path.join(root, 'lib/store'))});
      const dispose = SuiraStore.prototype.dispose;
      SuiraStore.prototype.dispose = async function () {
        await dispose.call(this);
        await require('node:assert/strict').rejects(this.save(), /store is closed/);
        fs.writeFileSync(${JSON.stringify(writerClosed)}, 'ok');
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
      return { ...client, async evaluate(expression) {
        try { return await client.evaluate(expression); }
        catch (error) { throw new Error(`Electron fixture evaluation failed: ${expression.slice(0, 120)}`, { cause: error }); }
      } };
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
    assert.equal((await main.evaluate('window.suira.voice.open()')).ok, true);
    const voice = await until(() => connect(port, target => target.url.endsWith('/voice-input.html')));
    sockets.push(voice.ws);
    await until(() => voice.evaluate('Boolean(window.suiraVoice)'));
    const voiceStatus = await voice.evaluate('window.suiraVoice.status()');
    assert.equal(voiceStatus.ok, true);
    assert.equal(voiceStatus.configured, false);
    assert.equal(await voice.evaluate('typeof window.suira'), 'undefined');
    assert.equal((await voice.evaluate('window.suiraVoice.close()')).ok, true);

    const listed = await main.evaluate(`(async () => {
      const items = await window.suira.content.list({ cardDetails: true });
      return items.find(item => item.id === ${JSON.stringify(image.id)});
    })()`);
    assert.match(listed.thumbnail, /^data:image\/png;base64,/);
    assert.equal(listed.meta.byteSize, (await fs.stat(imagePath)).size);
    assert.equal(listed.meta.width, 5);
    assert.equal(listed.meta.height, 7);
    assert.equal((await main.evaluate(`window.suira.content.get(${JSON.stringify(stale.id)})`)).text, 'expire this');
    await main.evaluate('window.suira.settings.update({retentionDays:1})');
    assert.ok(!(await main.evaluate('window.suira.content.list()')).some(item => item.id === stale.id));
    assert.ok((await fs.readFile(keyPath, 'utf8')) === wrappedKey, 'Existing DPAPI envelope should remain intact');
    assert.equal(await until(() => fs.readFile(result, 'utf8')), 'ok');
    // The injected clipboard does not touch the user's system clipboard. The Win32
    // message still travels through the real hidden HWND and Electron's hook.
    await until(async () => (await main.evaluate('window.suira.content.list()')).some(item => item.text === 'clipboard event fixture'));
    assert.equal((await main.evaluate('window.suira.settings.update({recordClipboard:false})')).ok, true);
    await fs.writeFile(fallback, 'force failure');
    assert.equal((await main.evaluate('window.suira.settings.update({recordClipboard:true})')).ok, true);
    assert.equal(await fs.readFile(fallback, 'utf8'), 'destroyed', 'Failed native listener HWND must be released');
    await until(async () => (await main.evaluate('window.suira.content.list()')).some(item => item.text === 'clipboard polling fixture'));
    assert.equal((await main.evaluate('window.suira.settings.update({recordClipboard:false})')).ok, true);
    await fs.unlink(fallback);
    assert.equal((await main.evaluate('window.suira.settings.update({recordClipboard:true})')).ok, true);
    assert.equal((await main.evaluate('window.suira.panel.run("note")')).ok, true);
    const [createdNote] = await main.evaluate('window.suira.notes.list()');
    assert.ok(createdNote?.id);
    const noteId = JSON.stringify(createdNote.id);
    let noteTarget;
    let note = await page(target => {
      if (!target.url.endsWith('/notes.html')) return false;
      noteTarget = target.id;
      return true;
    });
    const noteReady = 'document.getElementById("note")?.dataset.state === "ready"';
    await until(() => note.evaluate(noteReady));
    assert.equal((await main.evaluate(`window.suira.notes.open(${noteId})`)).id, createdNote.id);
    const listTargets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    assert.deepEqual((await listTargets()).filter(target => target.url.endsWith('/notes.html')).map(target => target.id), [noteTarget]);
    for (const pinned of ['true', 'false']) {
      await note.evaluate('document.getElementById("note-pin").click()');
      await until(() => note.evaluate(`document.getElementById("note-pin").getAttribute("aria-pressed") === "${pinned}"`));
      assert.equal((await main.evaluate(`window.suira.notes.get(${noteId})`)).pinned, pinned === 'true');
    }
    await note.evaluate(`{
      const title = document.getElementById('note-page-title');
      title.value = 'Close and reopen';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('note-close').click();
    }`);
    await until(async () => !(await listTargets()).some(target => target.id === noteTarget));
    assert.equal((await main.evaluate(`window.suira.notes.get(${noteId})`)).customTitle, 'Close and reopen');
    assert.equal((await main.evaluate('window.suira.notes.openLatest()')).id, createdNote.id);
    note = await page(target => target.url.endsWith('/notes.html'));
    await until(() => note.evaluate(noteReady));
    assert.equal(await note.evaluate('document.getElementById("note-page-title").value'), 'Close and reopen');
    assert.equal((await main.evaluate(`window.suira.actions.run({ kind: 'text', text: 'note relay fixture' }, 'text.to-note')`)).ok, true);
    await until(() => note.evaluate('window.NoteUI.text() === "note relay fixture"'));
    assert.equal((await main.evaluate(`window.suira.textTools.open({ mode: 'convert', text: 'text tools fixture' })`)).ok, true);
    const textTools = await page(target => target.url.includes('/text-tools.html'));
    await until(() => textTools.evaluate(`Boolean(document.querySelector('#tool-action-strip [data-action-id="text.translate"]'))`));
    assert.equal((await textTools.evaluate('window.suira.settings.update({recordClipboard:false})')).code, 'IPC_FORBIDDEN');
    await textTools.evaluate('window.suira.window.close()');
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
    assert.equal((await note.evaluate(`window.suira.notes.update({ id: ${noteId}, text: 'last debounced body' })`)).ok, true);
    await note.evaluate(`{
      const title = document.getElementById('note-page-title');
      title.value = 'last debounced title';
      title.dispatchEvent(new Event('input', { bubbles: true }));
    }`);
    await main.evaluate(`window.WorkspaceUI.flush = () => {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) { /* Simulate a blocked renderer thread, not just a pending promise. */ }
    }; true`);
    // Once quit is dispatched, its DevTools reply can race the process exit.
    const requested = panel.evaluate('window.suira.app.quit()').then(result => {
      assert.equal(result.ok, true);
      return exit;
    });
    assert.equal(await Promise.race([requested, exit, sleep(8000, 'timeout', { ref: false })]), 0, 'Quit must not wait for a stalled renderer');
    assert.equal(await fs.readFile(writerClosed, 'utf8'), 'ok');
    const diagnostics = (await fs.readFile(path.join(profile, 'diagnostics.log'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(diagnostics.some(line => line.event === 'quit-renderer-flush' && line.code === 'ERR_RENDERER_TIMEOUT'));
    const persisted = new SuiraStore(dataPath, { codec });
    assert.equal(persisted.getNote(createdNote.id).text, 'last debounced body');
    assert.equal(persisted.getNote(createdNote.id).customTitle, 'last debounced title');
    assert.equal(persisted.getItem(sample.id).text, 'legacy fixture');
    child = spawn(executable, [entry, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    const restarted = await page(target => target.url.endsWith('/index.html'));
    assert.equal((await restarted.evaluate(`window.suira.content.get(${JSON.stringify(sample.id)})`)).text, 'legacy fixture');
    console.log('PASS real Electron: native clipboard and polling fallback, navigation and IPC guard, task export, notes, relay, stalled-renderer quit, writer disposal and DPAPI restart');
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
