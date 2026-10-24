'use strict';
/*
 * 速记（Quick Note）渲染层检查。
 *
 * 分两段：
 * 1. 静态约束：文件齐备、不访问网络、不用 eval、ID 对照、只消费设计令牌、
 *    输入是防抖的（逐字落盘会重写整个数据文件）。
 * 2. 无头 Chrome 真实加载 src/notes.html，注入 mock 的 window.suira.notes，
 *    在 380×460 真实视口里断言：标题由正文推导、字数统计、防抖保存、
 *    关窗前补一次保存、钉住状态切换、全部速记列表与切换、Esc 逐级返回、
 *    API 不可用时的可读提示。
 *
 * 用法：node tools/notes-check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-notes-'));
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
}
function finish() {
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
}

/* ------------------------------------------------------------------ *
 * 1. 静态约束
 * ------------------------------------------------------------------ */

console.log('\n== 文件与静态约束 ==');
const files = ['src/notes.html', 'src/notes.css', 'src/notes.js', 'lib/notes.js', 'test-notes.js'];
const missing = files.filter((file) => !fs.existsSync(path.join(ROOT, file)));
check('速记相关文件齐备', missing.length === 0, '缺失: ' + missing.join(', '));

const html = fs.readFileSync(path.join(ROOT, 'src', 'notes.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'notes.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src', 'notes.js'), 'utf8');

check('HTML 引用 notes.css', html.includes('href="notes.css"'));
check('HTML 引用 notes.js', html.includes('src="notes.js"'));
check('HTML 引用共享主题层 theme.css', html.includes('href="theme.css"'));
check('页面不引用任何网络资源', !/https?:\/\//i.test(html + css + js));
check('渲染层不使用网络 API', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(js));
check('渲染层不用 eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(js));

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const jsIds = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
const missingIds = [...jsIds].filter((id) => !htmlIds.has(id));
check('notes.js 引用的 ID 都存在于 HTML', missingIds.length === 0, '缺失: ' + missingIds.join(', '));

const themeCss = fs.readFileSync(path.join(ROOT, 'src', 'theme.css'), 'utf8');
check('页面样式只消费令牌，不写死色值', !/#[0-9a-f]{6}\b/i.test(css.replace(/rgba?\([^)]*\)/g, '')),
  (css.match(/#[0-9a-f]{6}\b/i) || [''])[0]);
check('设计令牌集中在 theme.css', /--slate-12:\s*#1c2024/i.test(themeCss) && /--radius-card:/.test(themeCss));
check('顶栏是拖动区，按钮单独声明 no-drag',
  /\.note-head\s*\{[^}]*-webkit-app-region:\s*drag/.test(css) && /\.note-tools\s*\{[^}]*no-drag/.test(css));
check('输入防抖保存（不逐字落盘）', /setTimeout\(pushText,\s*400\)/.test(js));
check('关窗前补一次保存，不丢最后一次输入', /closeWindow[\s\S]{0,400}await pushText\(\)/.test(js));
check('订阅 opened / changed 广播', js.includes('onOpened') && js.includes('onChanged'));
check('删除前有确认（速记没有回收站）', js.includes('window.confirm'));

const model = require(path.join(ROOT, 'lib', 'notes.js'));
check('模型导出与主进程契约一致',
  ['NOTE_LIMIT', 'noteTitle', 'cleanNote', 'cleanBounds', 'capNotes', 'summarizeNotes', 'applyNoteText']
    .every((name) => model[name] !== undefined));

if (!CHROME) {
  console.log('\n跳过无头 Chrome 检查：未找到 Chrome/Edge');
  finish();
}

/* ------------------------------------------------------------------ *
 * 2. 无头 Chrome fixture
 * ------------------------------------------------------------------ */

const MOCK = `
(function(){
  var params = new URLSearchParams(location.search);
  var scenario = params.get('scenario') || 'default';
  var calls = window.__calls = { update: [], open: [], create: 0, remove: [], pin: [], hide: 0, minimize: 0 };
  var notes = [
    { id: 'n1', title: '买牛奶', text: '买牛奶\\n顺便取快递', createdAt: 1, updatedAt: 10, pinned: false, bounds: null }
  ];
  if (scenario !== 'empty') {
    notes.unshift({ id: 'n2', title: '会议要点', text: '会议要点：先做速记', createdAt: 2, updatedAt: 20, pinned: true, bounds: null });
  }
  var openedCallbacks = [];
  var changedCallbacks = [];
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function emitChanged(){ changedCallbacks.forEach(function(cb){ try { cb(clone(notes)); } catch(e){} }); }
  window.__pushOpened = function(id){ openedCallbacks.forEach(function(cb){ try { cb({ id: id }); } catch(e){} }); };
  window.suira = window.suira || {};
  window.suira.notes = {
    list: function(){
      if (scenario === 'error') return Promise.reject(new Error('主进程速记列表读取失败'));
      return Promise.resolve(clone(notes));
    },
    get: function(id){
      if (scenario === 'error') return Promise.reject(new Error('主进程速记读取失败'));
      return Promise.resolve(clone(notes.filter(function(n){ return n.id === id; })[0] || null));
    },
    open: function(id){ calls.open.push(id); return Promise.resolve({ ok: true, id: id }); },
    openLatest: function(){ calls.open.push('latest'); return Promise.resolve({ ok: true }); },
    create: function(){ calls.create += 1; return Promise.resolve({ ok: true, id: 'new' }); },
    update: function(payload){
      calls.update.push({ id: payload && payload.id, text: payload && payload.text });
      var target = notes.filter(function(n){ return n.id === (payload && payload.id); })[0];
      if (target) { target.text = payload.text; target.updatedAt = Date.now(); }
      return Promise.resolve({ ok: true, note: target ? clone(target) : null });
    },
    togglePin: function(id){
      var target = notes.filter(function(n){ return n.id === id; })[0];
      if (scenario === 'pinerror') return Promise.resolve({ ok: false, error: '这条速记已不存在' });
      if (target) target.pinned = !target.pinned;
      calls.pin.push(id);
      return Promise.resolve({ ok: true, note: target ? clone(target) : null });
    },
    remove: function(id){
      calls.remove.push(id);
      if (scenario === 'delerror') return Promise.resolve({ ok: false, error: '删除失败' });
      notes = notes.filter(function(n){ return n.id !== id; });
      return Promise.resolve({ ok: true });
    },
    minimizeWindow: function(){ calls.minimize += 1; return Promise.resolve({ ok: true }); },
    hideWindow: function(){ calls.hide += 1; return Promise.resolve({ ok: true }); },
    onOpened: function(cb){ openedCallbacks.push(cb); },
    onChanged: function(cb){ changedCallbacks.push(cb); }
  };
  // 删除确认：无头环境不应弹真对话框
  window.confirm = function(){ window.__confirmAsked = true; return true; };
})();
`;

const PROBE = `
(async function(){
  var scenario = new URLSearchParams(location.search).get('scenario') || 'default';
  // 每个探针只跑自己的场景：否则两个脚本会互相覆盖 window.__notesResult
  if (['pinerror', 'delerror', 'error'].indexOf(scenario) >= 0) return;
  var output = { scenario: scenario, errors: [] };
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var $ = function(s){ return document.querySelector(s); };
  function snapshot(){
    var note = document.getElementById('note');
    var body = document.getElementById('note-body');
    return {
      state: note.dataset.state,
      pinned: note.dataset.pinned,
      title: document.getElementById('note-title').textContent,
      text: body.value,
      count: document.getElementById('note-count').textContent,
      saved: document.getElementById('note-saved').textContent,
      savedState: document.getElementById('note-saved').dataset.state,
      pinLabel: document.getElementById('note-pin').textContent,
      pinPressed: document.getElementById('note-pin').getAttribute('aria-pressed'),
      errorHidden: document.getElementById('note-error').hidden,
      errorText: document.getElementById('note-error').textContent,
      indexHidden: document.getElementById('note-index').hidden,
      indexCount: document.getElementById('note-index').querySelectorAll('button').length,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      docScrollH: document.documentElement.scrollHeight,
      docClientH: document.documentElement.clientHeight
    };
  }
  await sleep(120);
  window.__pushOpened(scenario === 'empty' ? 'n1' : 'n2');
  await sleep(160);
  output.opened = snapshot();

  // 输入：标题随正文长出来，字数跟着变，保存是防抖的
  var body = document.getElementById('note-body');
  body.focus();
  body.value = '  换个开头\\n第二行';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(60);
  output.afterInput = snapshot();
  output.updateCallsImmediately = (window.__calls.update || []).length;
  await sleep(600);
  output.updateCallsAfterDebounce = (window.__calls.update || []).length;
  output.lastUpdateText = ((window.__calls.update || []).slice(-1)[0] || {}).text;

  // 全部速记：列出并可切换
  document.getElementById('note-index-btn').click();
  await sleep(180);
  output.afterIndex = snapshot();
  var first = document.querySelector('#note-index button');
  if (first) first.click();
  await sleep(120);
  output.openCalls = (window.__calls.open || []).slice();
  output.indexClosedAfterPick = document.getElementById('note-index').hidden;

  // 钉住切换
  document.getElementById('note-pin').click();
  await sleep(160);
  output.afterPin = snapshot();

  // 删除（confirm 已被 mock 成 true）
  document.getElementById('note-delete').click();
  await sleep(200);
  output.afterDelete = snapshot();
  output.removeCalls = (window.__calls.remove || []).slice();
  output.hideCalls = window.__calls.hide;

  // Esc：先收浮层，再收窗口
  document.getElementById('note-index-btn').click();
  await sleep(120);
  var beforeEsc = window.__calls.hide;
  document.getElementById('note-body').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(120);
  output.escClosedIndexOnly = document.getElementById('note-index').hidden && window.__calls.hide === beforeEsc;
  document.getElementById('note-body').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(200);
  output.hideCallsAfterEsc = window.__calls.hide;

  output.errors = (window.__errs || []).slice();
  window.__notesResult = output;
  var pre = document.createElement('pre');
  pre.textContent = 'N:' + JSON.stringify(output);
  document.body.appendChild(pre);
})().catch(function(error){
  window.__notesResult = { fatal: String((error && error.stack) || error), errors: (window.__errs || []).slice() };
});
`;

const ERROR_PROBE = `
(async function(){
  var scenario = new URLSearchParams(location.search).get('scenario');
  if (['pinerror', 'delerror', 'error'].indexOf(scenario) < 0) return;
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var $ = function(s){ return document.querySelector(s); };
  var output = { scenario: scenario, errors: [] };
  await sleep(120);
  window.__pushOpened('n1');
  await sleep(160);
  if (scenario === 'pinerror') {
    document.getElementById('note-pin').click();
    await sleep(180);
    output.errorHidden = document.getElementById('note-error').hidden;
    output.errorText = document.getElementById('note-error').textContent;
  } else if (scenario === 'delerror') {
    document.getElementById('note-delete').click();
    await sleep(200);
    output.errorHidden = document.getElementById('note-error').hidden;
    output.errorText = document.getElementById('note-error').textContent;
  } else {
    document.getElementById('note-index-btn').click();
    await sleep(200);
    output.errorHidden = document.getElementById('note-error').hidden;
    output.errorText = document.getElementById('note-error').textContent;
    output.indexHidden = document.getElementById('note-index').hidden;
  }
  output.errors = (window.__errs || []).slice();
  window.__notesResult = output;
  var pre = document.createElement('pre');
  pre.textContent = 'N:' + JSON.stringify(output);
  document.body.appendChild(pre);
})().catch(function(error){
  window.__notesResult = { fatal: String((error && error.stack) || error) };
});
`;

function buildFixtures() {
  fs.writeFileSync(path.join(TMP, '__notes_mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, '__notes_probe.js'), PROBE, 'utf8');
  fs.writeFileSync(path.join(TMP, '__notes_error_probe.js'), ERROR_PROBE, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'src', 'theme.css'), path.join(TMP, 'theme.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'notes.css'), path.join(TMP, 'notes.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'notes.js'), path.join(TMP, 'notes.js'));
  const page = html
    .replace('<script src="notes.js"></script>', [
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e.error));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String((e.reason&&e.reason.message)||e.reason));});</script>',
      '<script src="__notes_mock.js"></script>',
      '<script src="notes.js"></script>',
      '<script src="__notes_probe.js"></script>',
      '<script src="__notes_error_probe.js"></script>'
    ].join('\n'));
  fs.writeFileSync(path.join(TMP, '__notes_check.html'), page, 'utf8');
}

const fileUrl = (target) => 'file:///' + path.resolve(target).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let runSequence = 0;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let messageId = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({ ws, send }));
    ws.addEventListener('error', () => reject(new Error('WS error')));
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((resolveSend, rejectSend) => {
        const id = ++messageId;
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          rejectSend(new Error('timeout ' + method));
        }, 15000);
      });
    }
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result ? result.result.value : undefined;
}

async function startChrome(profile) {
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  const portFile = path.join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const text = fs.readFileSync(portFile, 'utf8');
      const first = Number(String(text).split(/\r?\n/)[0].trim());
      if (Number.isFinite(first) && first > 0) { port = first; break; }
    } catch { /* 端口文件还没写出来 */ }
    await sleep(150);
  }
  if (!port) { child.kill(); throw new Error('Chrome 调试端口未就绪'); }

  let targets = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      targets = await response.json();
      if (targets && targets.length) break;
    } catch { /* 端口未就绪 */ }
    await sleep(200);
  }
  if (!targets || !targets.length) { child.kill(); throw new Error('Chrome 调试目标未就绪'); }
  const page = targets.find((target) => target.type === 'page') || targets[0];
  const connection = await connect(page.webSocketDebuggerUrl);
  await connection.send('Page.enable');
  await connection.send('Runtime.enable');
  return { child, send: connection.send };
}

async function waitForResult(send, token, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluate(send, `(function(){
        if (location.search.indexOf(${JSON.stringify(token)}) < 0) return '';
        return window.__notesResult ? JSON.stringify(window.__notesResult) : '';
      })()`);
      if (value) return JSON.parse(value);
    } catch { /* 页面切换中 */ }
    await sleep(100);
  }
  throw new Error('等待页面探针超时：' + token);
}

async function runScenario(send, scenario, width, height) {
  runSequence += 1;
  const token = 'run-' + runSequence;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', {
    url: fileUrl(path.join(TMP, '__notes_check.html'))
      + '?scenario=' + encodeURIComponent(scenario) + '&run=' + token
  });
  await sleep(200);
  return waitForResult(send, token);
}

(async () => {
  buildFixtures();
  const profile = path.join(TMP, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  let browser = null;
  try {
    browser = await startChrome(profile);

    console.log('\n== 无头 Chrome 真实渲染（380×460）==');
    const main = await runScenario(browser.send, 'default', 380, 460);
    check('页面探针未抛异常', !main.fatal, main.fatal);
    check('速记窗口加载后进入 ready', main.opened && main.opened.state === 'ready', JSON.stringify(main.opened));
    check('正文与标题来自主进程下发的那条', main.opened && main.opened.title === '会议要点'
      && main.opened.text.indexOf('会议要点') === 0, JSON.stringify(main.opened));
    check('钉住状态渲染为已钉', main.opened && main.opened.pinned === 'true' && main.opened.pinPressed === 'true');
    check('字数统计正确', main.opened && main.opened.count === '9 字', main.opened && main.opened.count);
    check('窗口内不溢出', main.opened && main.opened.docScrollW <= main.opened.docClientW
      && main.opened.docScrollH <= main.opened.docClientH, JSON.stringify(main.opened));

    check('输入后标题跟着正文变', main.afterInput && main.afterInput.title === '换个开头', main.afterInput && main.afterInput.title);
    check('输入后字数跟着变', main.afterInput && main.afterInput.count === '10 字', main.afterInput && main.afterInput.count);
    check('输入不立刻落盘（防抖）', main.updateCallsImmediately === 0, String(main.updateCallsImmediately));
    check('防抖窗口结束后确实落盘', main.updateCallsAfterDebounce === 1, String(main.updateCallsAfterDebounce));
    check('落盘内容是最新的正文', main.lastUpdateText === '  换个开头\n第二行', JSON.stringify(main.lastUpdateText));

    check('全部速记列出多条', main.afterIndex && main.afterIndex.indexCount >= 2, String(main.afterIndex && main.afterIndex.indexCount));
    check('点一条切过去（走主进程 open）', main.openCalls && main.openCalls.length >= 1, JSON.stringify(main.openCalls));
    check('切换后浮层收起', main.indexClosedAfterPick === true);

    check('钉住可切换往返', main.afterPin && main.afterPin.pinned === 'false' && main.afterPin.pinLabel === '钉',
      JSON.stringify(main.afterPin));
    check('删除走过确认再删', main.removeCalls && main.removeCalls.length === 1, JSON.stringify(main.removeCalls));
    check('删除后关掉窗口', main.hideCalls >= 1, String(main.hideCalls));
    check('Esc 先收浮层，再收窗口', main.escClosedIndexOnly === true && main.hideCallsAfterEsc > main.hideCalls,
      JSON.stringify({ esc: main.escClosedIndexOnly, after: main.hideCallsAfterEsc }));
    check('没有未捕获的页面错误', (main.errors || []).length === 0, JSON.stringify(main.errors));

    console.log('\n== 失败路径 ==');
    const pinError = await runScenario(browser.send, 'pinerror', 380, 460);
    check('钉住失败时给出可读提示', pinError.errorHidden === false && /已不存在/.test(pinError.errorText || ''),
      JSON.stringify(pinError));
    const delError = await runScenario(browser.send, 'delerror', 380, 460);
    check('删除失败时给出可读提示', delError.errorHidden === false && /删除失败/.test(delError.errorText || ''),
      JSON.stringify(delError));
    const listError = await runScenario(browser.send, 'error', 380, 460);
    check('列表读取失败时提示且不崩', listError.errorHidden === false && listError.indexHidden === true,
      JSON.stringify(listError));

    console.log('\n== 小窗口（240×200 下限）==');
    const small = await runScenario(browser.send, 'default', 240, 200);
    check('最小尺寸下不溢出', small.opened && small.opened.docScrollW <= small.opened.docClientW
      && small.opened.docScrollH <= small.opened.docClientH, JSON.stringify(small.opened));
    check('最小尺寸下正文仍可见', small.opened && small.opened.text.length > 0);
  } catch (error) {
    console.log('  FAIL  无头 Chrome 检查异常 -> ' + error.message);
    fail += 1;
  } finally {
    if (browser && browser.child) browser.child.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 2 }); } catch { /* 清理失败不影响结果 */ }
  }
  finish();
})();
