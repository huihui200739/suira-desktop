'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const roleChannels = {
  main: `
    app:info app:open-data-dir app:font-license app:restart app:releases
    updates:state updates:check updates:download settings:get settings:update
    shortcuts:get shortcuts:capture shortcuts:check shortcuts:retry shortcuts:set shortcuts:restore-default shortcuts:clear
    panel:state panel:run panel:binding:set panel:binding:move panel:binding:pick apps:search apps:list apps:icons
    quick:show quick:toggle quick:presentation quick:presentation:set quick:capture
    capture:start image-editor:open clipboard-bar:show clipboard-bar:toggle island:toggle
    content:list content:get content:add-text content:remove content:undo-remove content:toggle-pin content:open-original content:clear-clipboard
    actions:list actions:run colors:list colors:pick recipes:catalog recipes:save recipes:remove recipes:list recipes:run search:query search:execute
    notes:list notes:get notes:open notes:open-latest notes:create notes:update notes:pick-file notes:toggle-pin notes:delete
    tasks:status tasks:list tasks:create tasks:rename tasks:delete tasks:add-item tasks:remove-item tasks:copy-text tasks:export
    executions:list executions:retry ocr:recognize-item return:target return:commit dates:parse
    text-tools:open text-tools:transform translate:status translate:run translate:test translate:models voice:open
    workspace:open workspace:list workspace:save workspace:remove workspace:calendar-export workspace:confirm-calendar-close
    workspace:confirm-close workspace:opened-file workspace:save-file workspace:preview-images workspace:open-link workspace:capture
    workspace:clipboard workspace:recent workspace:import workspace:export workspace:active-document workspace:calendar-draft relay:reply`,
  panel: `
    settings:get settings:update quick:background quick:presentation quick:presentation:set quick:prepared quick:hide
    quick:show quick:toggle quick:open-main quick:show-main quick:capture quick:open-app app:quit app:restart app:releases
    updates:state updates:check updates:download updates:install apps:search apps:list apps:icons
    panel:state panel:run panel:binding:set panel:binding:move panel:binding:pick clipboard-bar:show clipboard-bar:toggle island:toggle
    content:list content:get content:add-text content:open-original actions:list actions:run recipes:list recipes:run
    search:query search:execute translate:status translate:run workspace:open return:target return:commit`,
  calendar: `settings:get settings:update content:undo-remove workspace:list workspace:save workspace:remove workspace:confirm-calendar-close
    workspace:calendar-export workspace:calendar-draft workspace:close-ready workspace:cancel-close relay:reply`,
  markdown: `settings:get settings:update workspace:list workspace:save workspace:remove content:undo-remove workspace:close-ready workspace:cancel-close
    workspace:confirm-close workspace:opened-file workspace:save-file workspace:preview-images workspace:open-link workspace:capture
    workspace:clipboard workspace:recent workspace:import workspace:export workspace:active-document relay:reply`,
  notes: `notes:list notes:get notes:open notes:create notes:update notes:pick-file notes:reveal-file notes:toggle-pin notes:delete
    notes:hide-window notes:minimize-window dates:parse actions:list actions:run relay:reply`,
  clipboard: `clipboard-bar:hide clipboard-bar:set-pinned clipboard-bar:copy-images clipboard-bar:save-image clipboardbar:source-icons
    content:list content:get content:add-text content:toggle-pin image-editor:open actions:list actions:run quick:show-main return:commit`,
  island: `island:get-state island:add-paths island:remove-item island:clear island:undo island:set-policy island:set-expanded
    island:set-mode island:ping island:open-item island:reveal-item island:start-drag`,
  voice: 'voice:status voice:open-settings voice:transcribe voice:close',
  pin: 'pin:data pin:copy pin:save pin:top pin:move pin:resize pin:opacity pin:collapse pin:bounds pin:close actions:list actions:run',
  overlay: `capture:get-data capture:cancel capture:finish capture:start-long content:add-text actions:list actions:run
    colors:list colors:pick return:commit text-tools:configure translate:run translate:status`,
  editor: `image-editor:data image-editor:open image-editor:finish image-editor:window content:add-text actions:list actions:run
    colors:list colors:pick return:commit text-tools:configure translate:run translate:status`,
  text: `text-tools:initial text-tools:capture text-tools:transform text-tools:configure translate:status translate:run
    workspace:clipboard content:list content:add-text ocr:recognize-item return:commit actions:list actions:run`,
  picker: 'long-picker:ready long-picker:cancel capture:start-long',
  longCapture: 'long-capture:state long-capture:command',
  longOutline: '',
  longPreview: '',
  export: '',
  clipboardListener: ''
};

const pages = {
  main: 'index.html', calendar: 'index.html?tool=calendar', markdown: 'index.html?tool=markdown', panel: 'quickpanel.html',
  notes: 'notes.html', clipboard: 'clipboardbar.html', island: 'island.html', voice: 'voice-input.html', pin: 'pin.html',
  overlay: 'overlay.html', editor: 'overlay.html?mode=image-editor', text: 'text-tools.html', picker: 'long-picker.html',
  longCapture: 'long-capture.html', longPreview: 'long-preview.html', longOutline: 'long-outline.html', export: 'export.html',
  clipboardListener: ''
};

const policies = new Map(Object.entries(roleChannels).map(([role, channels]) => [role, new Set(channels.trim().split(/\s+/).filter(Boolean))]));
function grant(roles, channels) {
  for (const role of roles) for (const channel of channels.split(' ')) policies.get(role).add(channel);
}
grant([...policies.keys()].filter(role => pages[role]), 'theme:initial theme:state');
grant(['main', 'calendar', 'markdown', 'notes', 'editor'], 'window:resize-start window:resize-step window:resize-end');
grant(['main', 'calendar', 'markdown', 'text'], 'window:minimize window:maximize window:close window:state window:is-maximized');
grant(['main', 'calendar', 'markdown'], 'window:pin window:reset');
grant(['panel', 'notes', 'clipboard', 'island', 'editor', 'text', 'calendar', 'markdown', 'main'], 'material:preferences');
grant(['panel', 'clipboard'], 'window:hide');

const appearance = ['theme', 'themeChosen'];
const panelSettings = new Set([...appearance, 'panelCompact', 'panelMaterial', 'panelGuideSeen']);
const workspaceSettings = new Set(appearance);

function allowedPayload(role, channel, args) {
  if (channel === 'settings:update' && role !== 'main') {
    const patch = args[0];
    return patch && typeof patch === 'object' && !Array.isArray(patch) &&
      Object.keys(patch).every(key => (role === 'panel' ? panelSettings : workspaceSettings).has(key));
  }
  if (['calendar', 'markdown'].includes(role) && ['workspace:list', 'workspace:save', 'workspace:remove'].includes(channel)) {
    return args[0] === role;
  }
  return true;
}

function createWindowBoundary({ ipcMain, BrowserWindow, srcDir }) {
  const identities = new WeakMap();
  const registered = new Set();
  const allChannels = new Set([...policies.values()].flatMap(set => [...set]));

  function create(role, options) {
    if (!Object.hasOwn(pages, role)) throw new Error(`Unknown window role: ${role}`);
    const [file, query = ''] = pages[role].split('?');
    const win = new BrowserWindow({ ...options, webPreferences: {
      ...options.webPreferences, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false
    } });
    identities.set(win.webContents, { role, url: pathToFileURL(path.join(srcDir, file)).href, query: new URLSearchParams(query) });
    return win;
  }

  function allowed(event, channel, args) {
    const identity = identities.get(event.sender);
    const frame = event.senderFrame;
    if (!identity || !frame || frame !== event.sender.mainFrame || !policies.get(identity.role).has(channel)) return false;
    try {
      const url = new URL(frame.url);
      if ([...identity.query].some(([key, value]) => url.searchParams.get(key) !== value)) return false;
      url.search = '';
      url.hash = '';
      return url.href === identity.url && allowedPayload(identity.role, channel, args);
    } catch { return false; }
  }

  function register(method, channel, handler) {
    if (!allChannels.has(channel)) throw new Error(`Missing IPC policy for ${channel}`);
    registered.add(channel);
    ipcMain[method](channel, (event, ...args) => {
      if (allowed(event, channel, args)) return handler(event, ...args);
      if (channel === 'theme:initial') event.returnValue = null;
      if (method === 'handle') return { ok: false, code: 'IPC_FORBIDDEN', error: '此窗口不能执行该操作' };
    });
  }

  return {
    create,
    handle: (channel, handler) => register('handle', channel, handler),
    on: (channel, handler) => register('on', channel, handler),
    assertCoverage() {
      for (const channel of allChannels) if (!registered.has(channel)) throw new Error(`Unused IPC policy for ${channel}`);
    }
  };
}

function blockNavigation(contents) {
  const deny = event => event.preventDefault();
  contents.on('will-navigate', deny);
  contents.on('will-frame-navigate', deny);
  contents.on('will-redirect', deny);
  contents.on('will-attach-webview', deny);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = { createWindowBoundary, blockNavigation };
