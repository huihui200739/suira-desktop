'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVoiceWindow } = require('../lib/voice-window');

function fixture({ transcribe = async () => ({ ok: true, text: 'fixture' }) } = {}) {
  const handlers = new Map();
  const main = {}, panel = { isVisible: () => true }, target = { hwnd: '42', focusHwnd: '43' };
  const calls = [];
  let win, checkPermission, requestPermission;
  const makeWindow = (role, options) => {
    assert.equal(role, 'voice');
    assert.equal(options.focusable, false);
    assert.equal(options.webPreferences.sandbox, true);
    const created = new EventEmitter();
    let closed = false;
    Object.assign(created, {
      webContents: { owner: created, send: channel => calls.push(['send', channel]) },
      close() { closed = true; this.emit('closed'); },
      isDestroyed: () => closed,
      setPosition: () => {}, setMenuBarVisibility: () => {},
      loadFile: async file => assert.match(file, /voice-input\.html$/),
      showInactive: () => calls.push(['show'])
    });
    win = created;
    return created;
  };
  const permissionSession = {
    setPermissionCheckHandler: fn => { checkPermission = fn; },
    setPermissionRequestHandler: fn => { requestPermission = fn; }
  };
  const voice = createVoiceWindow({
    windowIpc: { create: makeWindow, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { fromWebContents: sender => sender.owner || null },
    screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) },
    session: { fromPartition: name => { assert.equal(name, 'suira-voice'); return permissionSession; } },
    getSettings: () => ({ voiceApiKeyEnc: 'opaque' }),
    decryptSecret: () => 'fixture credential',
    getMainWindow: () => main, getPanelWindow: () => panel, getForeground: () => target,
    captureTarget: (foreground, options) => { assert.equal(options.selectionMethod, 'voice'); return foreground; },
    hideQuickPanel: () => calls.push(['hide']), showSettings: () => calls.push(['settings']),
    writeClipboardText: async text => calls.push(['clipboard', text]),
    pasteTo: async (to, options) => { calls.push(['paste', to, options]); return { ok: true }; },
    transcribe
  });
  voice.registerIpc();
  return {
    main, panel, target, calls, window: () => win,
    invoke: (channel, owner, payload) => handlers.get(`voice:${channel}`)({ sender: { owner } }, payload),
    check: (...args) => checkPermission(...args),
    request: (contents, permission, details) => new Promise(resolve => requestPermission(contents, permission, resolve, details))
  };
}

test('voice session only grants audio to its own top frame', async () => {
  const f = fixture();
  assert.equal(f.invoke('status', null).ok, false);
  assert.equal(f.invoke('open', {}).ok, false);
  assert.equal((await f.invoke('open', f.main)).ok, true);
  const contents = f.window().webContents;
  assert.equal(f.check(contents, 'media', '', { isMainFrame: true, mediaType: 'audio' }), true);
  assert.equal(await f.request(contents, 'media', { isMainFrame: true, mediaTypes: ['audio'] }), true);
  for (const [sender, details] of [[{}, { isMainFrame: true, mediaTypes: ['audio'] }],
    [contents, { isMainFrame: false, mediaTypes: ['audio'] }], [contents, { isMainFrame: true, mediaTypes: ['audio', 'video'] }]]) {
    assert.equal(await f.request(sender, 'media', details), false);
  }
  assert.equal(f.invoke('status', f.window()).configured, true);
  assert.equal(Object.hasOwn(f.invoke('status', f.window()), 'apiKey'), false);
  assert.equal(f.invoke('open-settings', f.main).ok, false);
  assert.equal(f.invoke('open-settings', f.window()).ok, true);
  assert.deepEqual(f.calls.slice(-1), [['settings']]);
  assert.equal(await f.request(contents, 'media', { isMainFrame: true, mediaTypes: ['audio'] }), false);
});

test('preview only copies; panel dictation pastes without activating another window', async () => {
  const f = fixture();
  await f.invoke('open', f.main);
  assert.deepEqual(await f.invoke('transcribe', f.window()), { ok: true, pasted: false });
  assert.deepEqual(f.calls.slice(-1), [['clipboard', 'fixture']]);
  f.invoke('close', f.window());
  await f.invoke('open', f.panel);
  f.window().__openedAt = 0;
  await f.invoke('open', f.panel);
  await f.invoke('open', f.panel);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'send'), [['send', 'voice:stop']]);
  assert.deepEqual(await f.invoke('transcribe', f.window()), { ok: true, pasted: true });
  assert.deepEqual(f.calls.slice(-2), [['clipboard', 'fixture'], ['paste', f.target, { stayInForeground: true }]]);
});

test('closing during recognition aborts and ignores any late answer', async () => {
  let finish, signal;
  const f = fixture({ transcribe: options => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  } });
  await f.invoke('open', f.panel);
  const win = f.window();
  const pending = f.invoke('transcribe', win);
  assert.equal((await f.invoke('transcribe', win)).ok, false);
  f.invoke('close', win);
  assert.ok(signal.aborted);
  finish({ ok: true, text: 'late' });
  assert.deepEqual(await pending, { ok: false, cancelled: true });
  assert.ok(!f.calls.some(([kind]) => kind === 'clipboard' || kind === 'paste'));
});
