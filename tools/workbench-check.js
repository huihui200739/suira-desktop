'use strict';
// Real Electron renderer/IPC with an isolated synthetic profile. Never inspect or
// mutate the installed application, user's clipboard, documents or shortcuts.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { connect } = require('./runtime-client');
const { SuiraStore } = require('../lib/store');
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-workspace-'));
const sockets = [], errors = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Fractional Windows DPI can round a CSS edge by one device pixel.
const near = (value, expected) => Math.abs(value - expected) <= 1;
const close = (value, expected, label) => assert.ok(near(value, expected), `${label || 'geometry'}: ${value} vs ${expected}`);
let child;
async function until(fn, label = 'state') {
  let last;
  for (let i = 0; i < 150; i++) { try { const result = await fn(); if (result) return result; } catch (error) { last = error; } await wait(60); }
  throw last || Error('Timed out: ' + label);
}
(async () => {
  const profile = path.join(tmp, 'profile'), store = new SuiraStore(path.join(profile, 'suira-data.json'));
  await store.updateSettings({ recordClipboard: false, globalShortcutsEnabled: false, panelGuideSeen: true });
  const task = store.createTask('产品体验打磨'), item = store.addItem({ kind: 'text', title: '让工作自然继续', text: '收起导航，专注当前内容。\n任务、截图和文字仍然触手可及。', source: { type: 'user' } });
  store.addItemToTask(task.id, item.id); await store.save();
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const entry = path.join(tmp, 'app.js');
  fs.writeFileSync(entry, `const {app,clipboard,globalShortcut}=require('electron');app.getVersion=()=>${JSON.stringify(require('../package.json').version)};app.setPath('userData',${JSON.stringify(profile)});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>false;require(${JSON.stringify(path.join(root, 'main.js'))});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.SUIRA_TEST_ELECTRON || ['C:/suira-electron/electron.exe', path.join(root, 'node_modules/electron/dist/electron.exe')].find(p => fs.existsSync(p));
  assert.ok(executable, 'An Electron runtime must be installed');
  const log = fs.openSync(path.join(tmp, 'app.log'), 'w');
  child = spawn(executable, [entry, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] }); fs.closeSync(log);
  const page = await until(() => connect(port, target => target.url.endsWith('/index.html')), 'workbench window'); sockets.push(page.ws);
  await page.send('Runtime.enable'); page.ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text); });
  await until(() => page.evaluate('Boolean(document.querySelector(".task-row") && window.suira && document.documentElement.classList.contains("liquid-ui"))'));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  const click = async selector => {
    const box = await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
    assert.ok(box.hit, 'Reachable pointer target: ' + selector);
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const geometry = () => page.evaluate(`(()=>{const r=document.querySelector('.sidebar').getBoundingClientRect(),m=document.querySelector('.main-scroll').getBoundingClientRect(),b=document.querySelector('.brand').getBoundingClientRect(),n=document.querySelector('.nav-item').getBoundingClientRect(),i=document.querySelector('.nav .shared-selection').getBoundingClientRect();return {rail:r.width,main:m.x,brand:b.width,item:n.width,indicator:i.width,expanded:document.getElementById('sidebar-toggle').getAttribute('aria-expanded'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  const shot = async name => { if (!process.argv.includes('--shots')) return; await page.evaluate('document.activeElement?.blur();true'); await page.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:900, y:500 }); await wait(200); const image = await page.send('Page.captureScreenshot', { format: 'png' }); const directory = path.join(root, 'docs/product'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'sidebar-' + name + '.png'), Buffer.from(image.data, 'base64')); };
  await until(async () => near((await geometry()).rail, 184), 'expanded sidebar'); const expanded = await geometry(); close(expanded.main, expanded.brand);
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
  await page.evaluate('document.getElementById("sidebar-toggle").focus();true');
  await until(() => page.evaluate('!document.getElementById("surface-hint").hidden'));
  assert.ok(await page.evaluate('document.getElementById("surface-hint").textContent.includes("收起侧边栏")'), 'Expanded sidebar also explains its shortcut');
  const appearance = target => target.evaluate(`(() => {
    const root = document.documentElement;
    return { preset: root.dataset.theme, source: root.dataset.accentSource,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      background: getComputedStyle(document.querySelector('.app-shell > .glass-scene')).backgroundColor };
  })()`);
  const t3Background = 'rgb(252, 252, 252)';
  const changeAppearance = async (settings, expected) => {
    await page.evaluate(`window.suira.settings.update(${JSON.stringify(settings)})`);
    await until(async () => {
      const current = await appearance(page);
      return Object.entries(expected).every(([key, value]) => value === current[key]);
    }, 'appearance');
  };
  await changeAppearance({ theme: 'light', themePreset: 'mist', accentSource: 'preset' }, { dark: false, preset: 'mist' });
  assert.equal((await appearance(page)).background, t3Background);
  await changeAppearance({ theme: 'dark' }, { dark: true });
  assert.notEqual((await appearance(page)).background, t3Background, 'Dark mode restores the native palette');
  await changeAppearance({ theme: 'light', themePreset: 'paper' }, { dark: false, preset: 'paper' });
  assert.notEqual((await appearance(page)).background, t3Background, 'Other presets retain their palette');
  await changeAppearance({ themePreset: 'mist', accentSource: 'windows' }, { preset: 'mist', source: 'windows' });
  assert.notEqual((await appearance(page)).background, t3Background, 'External accent source restores the native palette');
  await changeAppearance({ accentSource: 'preset' }, { source: 'preset', background: t3Background });
  await shot('expanded');
  await click('#sidebar-toggle'); await until(async () => near((await geometry()).rail, 64)); await wait(200);
  const collapsed = await geometry(); close(collapsed.main, 64); close(collapsed.brand, 64); assert.equal(collapsed.expanded, 'false'); close(collapsed.item, collapsed.indicator); assert.equal(collapsed.overflow, false);
  assert.equal(await page.evaluate('localStorage.getItem("suira.sidebar.collapsed")'), 'true');
  assert.ok(await page.evaluate('Array.from(document.querySelectorAll(".nav-item")).every(e=>e.getAttribute("aria-label")&&e.dataset.hint)'));
  await shot('collapsed');
  await click('[data-page="library"]'); await until(() => page.evaluate('document.querySelector("[data-page=library]").getAttribute("aria-current")==="page"'));
  await click('[data-page="settings"]'); await until(() => page.evaluate('document.querySelector("#page-settings").classList.contains("is-active")'));
  await click('[data-page="shelf"]');
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
  await page.evaluate('document.querySelector("[data-page=library]").focus();true');
  await until(() => page.evaluate('!document.getElementById("surface-hint").hidden'));
  assert.equal(await page.evaluate('document.getElementById("surface-hint").textContent'), '内容库');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '\\', code: 'Backslash', modifiers: 2 });
  await until(async () => near((await geometry()).rail, 184));
  await page.evaluate('document.getElementById("task-search").focus();true');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '\\', code: 'Backslash', modifiers: 2 });
  assert.equal(await page.evaluate('document.getElementById("sidebar-toggle").getAttribute("aria-expanded")'), 'true', 'Typing controls retain shortcuts');
  await click('#sidebar-toggle'); await page.send('Page.reload');
  await until(() => page.evaluate('Boolean(document.querySelector(".task-row") && document.getElementById("sidebar-toggle").getAttribute("aria-expanded")==="false")'));
  await until(async () => near((await geometry()).rail, 64));
  for (const width of [800, 1000, 1600]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }); await wait(200);
    const g = await geometry(); close(g.main, 64); assert.equal(g.overflow, false);
    await click('#sidebar-toggle'); await until(async () => near((await geometry()).rail, (width <= 900 ? 160 : 184)));
    await click('#sidebar-toggle'); await until(async () => near((await geometry()).rail, 64));
  }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".app-body")).transitionDuration'), '0s');
  await click('#sidebar-toggle'); assert.equal((await geometry()).expanded, 'true');
  // Read starts on task A; selection can change while clipboard access waits.
  await page.evaluate('navigator.clipboard.readText=()=>new Promise(resolve=>window.__resolveClipboard=resolve);true');
  await click('#shelf-import');
  const second = await page.evaluate('window.suira.tasks.create("另一个任务")'); assert.ok(second.ok);
  await until(() => page.evaluate('document.querySelectorAll(".task-row").length===2'));
  await click('.task-row[data-id="' + second.task.id + '"]');
  await page.evaluate('window.__resolveClipboard("Isolated delayed clipboard fixture");true');
  await until(async () => (await page.evaluate('window.suira.tasks.list()')).find(t => t.id === task.id).items.length === 2);
  const tasks = await page.evaluate('window.suira.tasks.list()'); assert.equal(tasks.find(t => t.id === second.task.id).items.length, 0, 'Pending import keeps original task');
  await click('[data-page="markdown"]');
  const tool = await until(() => connect(port, target => target.url.includes('tool=markdown'))); sockets.push(tool.ws);
  await until(() => tool.evaluate('Boolean(window.WorkspaceUI)'));
  assert.equal(await tool.evaluate('getComputedStyle(document.getElementById("sidebar-toggle")).display'), 'none', 'Standalone document controls are unchanged');
  await tool.evaluate('document.getElementById("md-new").click();true');
  await until(() => tool.evaluate('!document.getElementById("md-body").hidden'));
  await tool.evaluate('document.querySelector("[data-md-view=edit]").click();document.getElementById("md-title").value="保存与切换验收";document.getElementById("md-editor").value="# 普通编辑验收\\n\\n第一稿";document.getElementById("md-editor").dispatchEvent(new Event("input"));window.WorkspaceUI.flush()');
  const originalDocs = await tool.evaluate('window.suira.workspace.list("markdown")');
  const original = originalDocs.find(item => item.title === '保存与切换验收'); assert.ok(original);
  await tool.evaluate('document.getElementById("md-editor").value+="\\n\\n切换前的最后修改";document.getElementById("md-editor").dispatchEvent(new Event("input"));document.getElementById("md-new").click();true');
  await until(async () => (await tool.evaluate('window.suira.workspace.list("markdown")')).length === 2);
  await until(() => tool.evaluate('document.getElementById("md-title").value==="未命名文档"'));
  const stored = (await tool.evaluate('window.suira.workspace.list("markdown")')).find(item => item.id === original.id);
  assert.ok(stored.text.includes('切换前的最后修改'), 'Real document switch flushes final edit');
  await tool.evaluate('window.WorkspaceUI.flush()');
  const calendarResult = await page.evaluate('window.suira.workspace.open("calendar")'); assert.notEqual(calendarResult?.ok, false);
  const calendar = await until(() => connect(port, target => target.url.includes('tool=calendar'))); sockets.push(calendar.ws);
  await until(() => calendar.evaluate('document.querySelectorAll(".calendar-day").length===42'));
  await calendar.evaluate('document.getElementById("calendar-new").click();document.getElementById("event-title").value="工作台打磨验收";document.getElementById("event-date").value="2026-11-08";document.getElementById("event-time").value="14:30";document.getElementById("event-form").requestSubmit();true');
  await until(async () => (await calendar.evaluate('window.suira.workspace.list("calendar")')).some(item => item.title === '工作台打磨验收' && item.meta.date === '2026-11-08'));
  await until(() => calendar.evaluate('document.getElementById("event-form").hidden'));
  assert.deepEqual(errors, []);
  console.log('PASS real Electron: sidebar pointer/keyboard, compact navigation, ARIA, focus hints, persisted reload, 800–1600px layouts, reduced motion, async clipboard destination and standalone document/calendar create/save/switch flows');
})().catch(error => { console.error(error); if (fs.existsSync(path.join(tmp, 'app.log'))) console.error(fs.readFileSync(path.join(tmp, 'app.log'), 'utf8').slice(-2200)); process.exitCode = 1; }).finally(async () => {
  sockets.forEach(socket => socket.close());
  if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
  await wait(300);
  assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir())); assert.match(path.basename(tmp), /^suira-workspace-[a-zA-Z0-9]+$/);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
