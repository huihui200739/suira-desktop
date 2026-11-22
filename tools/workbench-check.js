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
  store.addItemToTask(task.id, item.id);
  store.addItem({ kind: 'text', title: '整理结果', text: '保留一个干净的阅读界面。', parentIds: [item.id], source: { type: 'derived' } });
  store.addItem({ kind: 'link', title: '链接示例', text: 'https://example.com', source: { type: 'user' } });
  await store.save();
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
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
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
  await until(async () => {
    const expanded = await geometry();
    return near(expanded.rail, 184) && near(expanded.main, expanded.brand);
  }, 'expanded sidebar aligned with the titlebar');
  await page.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
  await page.evaluate('document.activeElement?.blur();document.getElementById("sidebar-toggle").focus();true');
  await until(() => page.evaluate('!document.getElementById("surface-hint").hidden'));
  assert.ok(await page.evaluate('document.getElementById("surface-hint").textContent.includes("收起侧边栏")'), 'Expanded sidebar also explains its shortcut');
  const appearance = target => target.evaluate(`(() => {
    const root = document.documentElement;
    return { url: location.search, preset: root.dataset.theme, source: root.dataset.accentSource,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      background: getComputedStyle(document.querySelector('.app-shell > .glass-scene')).backgroundColor };
  })()`);
  const t3Background = 'rgb(252, 252, 252)', darkBackground = 'rgb(19, 19, 21)';
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
  assert.equal((await appearance(page)).background, darkBackground, 'Dark Mist keeps the solid workspace surface');
  await changeAppearance({ theme: 'light', themePreset: 'paper' }, { dark: false, preset: 'paper' });
  assert.notEqual((await appearance(page)).background, t3Background, 'Other presets retain their palette');
  await changeAppearance({ themePreset: 'mist', accentSource: 'windows' }, { preset: 'mist', source: 'windows' });
  assert.notEqual((await appearance(page)).background, t3Background, 'External accent source restores the native palette');
  await changeAppearance({ accentSource: 'preset' }, { source: 'preset', background: t3Background });
  const readStyle = (target, selector, properties, pseudo = null) => target.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)});
      return Object.fromEntries(${JSON.stringify(properties)}.map(property => [property, style.getPropertyValue(property).trim()]));
    })()`);
  const neutral = 'rgb(24, 24, 27)', white = 'rgb(255, 255, 255)';
  const polishDirectory = process.env.SUIRA_WORKBENCH_POLISH_SHOTS;
  const polishShot = async (target, name) => {
    if (!polishDirectory) return;
    await target.evaluate('document.activeElement?.blur();true');
    const image = await target.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(polishDirectory, name + '.png'), Buffer.from(image.data, 'base64'));
  };
  assert.equal((await readStyle(page, '.task-column', ['border-radius']))['border-radius'], '0px', 'Docked task index has square corners');
  await until(() => page.evaluate('Boolean(document.querySelector(".derived-card"))'));
  assert.equal((await readStyle(page, '.derived-card', ['border-left-color']))['border-left-color'], 'rgb(228, 228, 231)');
  assert.equal((await readStyle(page, '.trail-step:last-child b', ['background-color']))['background-color'], neutral);
  assert.equal((await readStyle(page, '#task-search', ['border-top-width']))['border-top-width'], '0px');
  await polishShot(page, 'task');
  await click('[data-page="library"]');
  const libraryStyle = (filter, background = neutral) => page.evaluate(`new Promise(resolve => {
    const group = document.getElementById('library-filters');
    const active = group.querySelector('.is-active');
    const samples = [];
    function sample() {
      const style = getComputedStyle(active);
      const indicator = group.querySelector('.shared-selection');
      samples.push({filter:active.dataset.filter, pressed:active.getAttribute('aria-pressed'), background:style.backgroundColor,
        ink:style.color, indicator:indicator && getComputedStyle(indicator).display, animations:group.getAnimations({subtree:true}).length});
      if(samples.length===4) resolve(samples);
      else requestAnimationFrame(sample);
    }
    sample();
  })`).then(samples => {
    for (const sample of samples) {
      assert.equal(sample.filter, filter);
      assert.equal(sample.pressed, 'true');
      assert.equal(sample.background, background, 'Filter is already neutral on the first frame');
      assert.equal(sample.ink, white);
      assert.equal(sample.indicator, 'none');
      assert.equal(sample.animations, 0);
    }
  });
  for (const kind of ['text','image','files','link','all','link','text','all']) {
    await click(`[data-filter="${kind}"]`);
    await libraryStyle(kind);
  }
  assert.equal(await page.evaluate('document.querySelectorAll("#library-filters [aria-pressed=true]").length'), 1);
  assert.equal(await page.evaluate('document.querySelectorAll(".library-card").length'), 3);
  await page.evaluate('document.querySelector("[data-filter=link]").focus();true');
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await libraryStyle('link');
  assert.equal(await page.evaluate('document.querySelectorAll(".library-card").length'), 1);
  await click('[data-filter=all]');
  await polishShot(page, 'library');
  await click('[data-page="settings"]');
  assert.equal((await readStyle(page, '[data-preset=mist]', ['border-top-color']))['border-top-color'], neutral);
  assert.equal((await readStyle(page, '[data-preset=mist] .theme-swatch', ['background-color'], '::after'))['background-color'], neutral);
  assert.equal((await readStyle(page, '[data-preset=paper] .theme-swatch', ['background-color'], '::after'))['background-color'], 'rgb(204, 78, 0)');
  await polishShot(page, 'settings');
  await click('[data-page="shelf"]');
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
  await page.evaluate('document.activeElement?.blur();document.querySelector("[data-page=library]").focus();true');
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
  await page.send('Emulation.setEmulatedMedia', { features: [] });
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
  await tool.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const pane of ['.mia-notes', '.mia-main']) assert.equal((await readStyle(tool, pane, ['border-radius']))['border-radius'], '0px');
  await polishShot(tool, 'markdown');
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
  await calendar.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await calendar.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  assert.equal((await readStyle(calendar, '#calendar-new', ['background-color']))['background-color'], neutral);
  assert.equal((await readStyle(calendar, '.calendar-card', ['border-radius']))['border-radius'], '0px');
  const weekday = await readStyle(calendar, '.calendar-day:not(.weekend):not(.outside):not(.today):not(.selected)', ['border-radius', 'background-color']);
  assert.deepEqual(weekday, { 'border-radius': '0px', 'background-color': white });
  const selectedDay = await readStyle(calendar, '.calendar-day.selected', ['border-radius', 'box-shadow']);
  assert.equal(selectedDay['border-radius'], '0px');
  assert.ok(selectedDay['box-shadow'].includes(neutral));
  assert.equal((await readStyle(calendar, '.countdown-row[data-kind=term]', ['background-color'], '::before'))['background-color'], 'rgb(201, 154, 60)');
  assert.equal((await readStyle(calendar, '.countdown-row[data-kind=holiday]', ['background-color'], '::before'))['background-color'], 'rgb(194, 74, 56)');
  assert.equal((await readStyle(calendar, '.countdown-row', ['border-left-width']))['border-left-width'], '0px');
  await calendar.evaluate('document.querySelector("[data-countdown=term]").click();true');
  assert.ok(await calendar.evaluate('document.querySelector("[data-countdown=term]").getAttribute("aria-pressed")==="true" && [...document.querySelectorAll(".countdown-row")].every(row=>row.dataset.kind==="term")'));
  await calendar.evaluate('document.querySelector("[data-countdown=all]").click();document.querySelector("button[aria-label=窗口置顶]").click();true');
  await until(() => calendar.evaluate('document.querySelector("button[aria-label=窗口置顶]").getAttribute("aria-pressed")==="true"'));
  assert.equal((await readStyle(calendar, 'button[aria-label=窗口置顶]', ['color']))['color'], neutral);
  const controlsToggle = 'button[aria-label="搜索和视图"]';
  await calendar.evaluate('document.querySelector(' + JSON.stringify(controlsToggle) + ').click();true');
  assert.equal((await readStyle(calendar, controlsToggle, ['color'])).color, neutral);
  assert.equal(await calendar.evaluate('document.getElementById("calendar-controls").checkVisibility()'), true);
  for (const view of ['week', 'agenda', 'month']) {
    await calendar.evaluate('document.querySelector("[data-calendar-view=' + view + ']").click();true');
    assert.equal(await calendar.evaluate('document.querySelector(".calendar-layout").dataset.view'), view);
  }
  await calendar.evaluate('document.querySelector(' + JSON.stringify(controlsToggle) + ').click();true');
  await calendar.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
  assert.ok(await calendar.evaluate('document.querySelector(".calendar-layout").getBoundingClientRect().right <= innerWidth && document.getElementById("countdown-filters").scrollWidth <= document.getElementById("countdown-filters").clientWidth'));
  await calendar.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await polishShot(calendar, 'calendar');
  await calendar.evaluate('document.querySelector("[data-agenda=todo]").click();true');
  assert.equal((await readStyle(calendar, '#countdown-filters', ['display'])).display, 'none');
  assert.equal((await readStyle(calendar, '#calendar-new', ['background-color']))['background-color'], neutral);
  await calendar.evaluate('document.getElementById("calendar-new").click();document.getElementById("event-title").value="工作台打磨验收";document.getElementById("event-date").value="2026-11-08";document.getElementById("event-time").value="14:30";document.getElementById("event-form").requestSubmit();true');
  await until(async () => (await calendar.evaluate('window.suira.workspace.list("calendar")')).some(item => item.title === '工作台打磨验收' && item.meta.date === '2026-11-08'));
  await until(() => calendar.evaluate('document.getElementById("event-form").hidden'));
  // Toggle from the actual calendar toolbar so all open windows follow the same setting.
  const themeButton = 'button[aria-label="切换明暗主题"]';
  const toggleCalendarTheme = async (dark, background) => {
    await calendar.evaluate('document.querySelector(' + JSON.stringify(themeButton) + ').click();true');
    for (const target of [page, calendar, tool]) {
      await until(async () => {
        const style = await appearance(target);
        assert.equal(style.dark, dark, JSON.stringify(style));
        assert.equal(style.background, target === tool && !dark ? white : background, JSON.stringify(style));
        return true;
      }, 'theme switch across open windows');
    }
  };
  const darkFill = 'rgb(59, 59, 62)', darkInk = 'rgb(245, 245, 245)';
  const darkButton = { 'background-color': darkFill, color: white };
  await toggleCalendarTheme(true, darkBackground);
  await click('[data-page="shelf"]');
  await click(`.task-row[data-id="${task.id}"]`);
  await until(() => page.evaluate('Boolean(document.querySelector(".derived-card"))'));
  assert.equal((await readStyle(page, '.nav-item.is-active b', ['color'])).color, darkInk);
  assert.equal((await readStyle(page, '.nav .shared-selection', ['background-color']))['background-color'], 'rgb(41, 41, 44)');
  assert.equal((await readStyle(page, '.task-column', ['border-radius']))['border-radius'], '0px');
  assert.deepEqual(await readStyle(page, '#shelf-import', ['background-color', 'color']), darkButton);
  assert.deepEqual(await readStyle(page, '.trail-step:last-child b', ['background-color', 'color']), darkButton);
  assert.equal((await readStyle(page, '.derived-card', ['border-left-color']))['border-left-color'], 'rgb(53, 53, 56)');
  assert.equal((await readStyle(page, '.derived-tag', ['color'])).color, darkInk);
  await polishShot(page, 'task-dark');

  await click('[data-page="library"]');
  for (const kind of ['text', 'link', 'all']) {
    await click(`[data-filter="${kind}"]`);
    await libraryStyle(kind, darkFill);
  }
  await page.evaluate('document.querySelector("[data-filter=link]").focus();true');
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await libraryStyle('link', darkFill);
  await polishShot(page, 'library-dark');
  await click('[data-page="settings"]');
  assert.equal((await readStyle(page, '[data-preset=mist] .theme-swatch', ['background-color'], '::after'))['background-color'], darkFill);
  await polishShot(page, 'settings-dark');
  for (const pane of ['.mia-notes', '.mia-main']) assert.equal((await readStyle(tool, pane, ['border-radius']))['border-radius'], '0px');
  await polishShot(tool, 'markdown-dark');

  await calendar.evaluate('document.querySelector("[data-agenda=countdown]").click();document.querySelector("[data-countdown=term]").click();true');
  assert.deepEqual(await readStyle(calendar, '#calendar-new', ['background-color', 'color']), darkButton);
  assert.deepEqual(await readStyle(calendar, '.agenda-tabs .is-active', ['background-color', 'color']), darkButton);
  assert.deepEqual(await readStyle(calendar, '.calendar-day.today > .day-number', ['background-color', 'color']), darkButton);
  assert.equal((await readStyle(calendar, '[data-countdown=term]', ['color'])).color, darkInk);
  assert.equal((await readStyle(calendar, '.calendar-day.selected', ['border-radius']))['border-radius'], '0px');
  assert.equal((await readStyle(calendar, '.countdown-row[data-kind=term]', ['background-color'], '::before'))['background-color'], 'rgb(212, 172, 86)');
  await polishShot(calendar, 'calendar-dark');
  await calendar.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
  assert.ok(await calendar.evaluate('document.querySelector(".calendar-layout").getBoundingClientRect().right <= innerWidth && document.getElementById("countdown-filters").scrollWidth <= document.getElementById("countdown-filters").clientWidth'));
  await toggleCalendarTheme(false, t3Background);
  assert.deepEqual(await readStyle(calendar, '#calendar-new', ['background-color', 'color']), { 'background-color': neutral, color: white });
  assert.deepEqual(errors, []);
  console.log('PASS real Electron: light/dark Mist surfaces and filter frames across all five pages, sidebar pointer/keyboard, compact navigation, ARIA, focus hints, persisted reload, 800–1600px layouts, reduced motion, async clipboard destination and standalone document/calendar create/save/switch flows');
})().catch(error => { console.error(error); if (fs.existsSync(path.join(tmp, 'app.log'))) console.error(fs.readFileSync(path.join(tmp, 'app.log'), 'utf8').slice(-2200)); process.exitCode = 1; }).finally(async () => {
  sockets.forEach(socket => socket.close());
  if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
  await wait(300);
  assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir())); assert.match(path.basename(tmp), /^suira-workspace-[a-zA-Z0-9]+$/);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
