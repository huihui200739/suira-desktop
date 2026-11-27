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
const files = ['src/notes.html', 'src/notes.css', 'src/notes.js', 'lib/notes.js', 'tests/test-notes.js'];
const missing = files.filter((file) => !fs.existsSync(path.join(ROOT, file)));
check('速记相关文件齐备', missing.length === 0, '缺失: ' + missing.join(', '));

const html = fs.readFileSync(path.join(ROOT, 'src', 'notes.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'notes.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src', 'notes.js'), 'utf8');

check('HTML 引用 notes.css', html.includes('href="notes.css"'));
check('HTML 引用 notes.js', html.includes('src="notes.js"'));
check('HTML 引用共享主题层 theme.css', html.includes('href="theme.css"'));
check('速记恢复圆角白色画布与透明窗口底', /\.note\s*\{[^}]*border-radius:\s*22px/.test(css) && /html,body\s*\{[^}]*background:\s*transparent/.test(css));
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
    pickFile: function(){ return Promise.resolve('C:/示例/发票.pdf'); },
    update: function(payload){
      calls.update.push(payload);
      if (window.__failNextUpdate) {
        window.__failNextUpdate = false;
        return Promise.resolve({ ok: false, error: '临时保存失败' });
      }
      var target = notes.filter(function(n){ return n.id === (payload && payload.id); })[0];
      if (target) Object.assign(target, payload, {updatedAt:Date.now()});
      var response = { ok: true, note: target ? clone(target) : null };
      if (window.__holdUpdate) {
        return new Promise(function(resolve){ window.__releaseUpdate = function(){ resolve(response); }; });
      }
      return Promise.resolve(response);
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
  window.suira.actions = {
    list: function(){
      return Promise.resolve([
        { id: 'output.copy', label: '复制', direct: true },
        { id: 'text.translate', label: '翻译', direct: true },
        { id: 'text.to-note', label: '追加到速记', direct: true },
        { id: 'text.to-markdown', label: '追加到 Markdown', direct: false },
        { id: 'text.to-calendar', label: '加到日历', direct: false },
        { id: 'text.pin', label: '钉在桌面', direct: false }
      ]);
    },
    run: function(_item, id){
      calls.actionRuns = (calls.actionRuns || []).concat(id);
      if (id === 'text.translate') return Promise.resolve({ ok: false, error: '翻译服务暂不可用' });
      return Promise.resolve({ ok: true, message: '已复制' });
    }
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
      text: window.NoteUI.text(),
      count: document.getElementById('note-count').textContent,
      saved: document.getElementById('note-saved').textContent,
      savedState: document.getElementById('note-saved').dataset.state,
      pinLabel: document.getElementById('note-pin').textContent,
      pinPressed: document.getElementById('note-pin').getAttribute('aria-pressed'),
      errorHidden: document.getElementById('note-error').hidden,
      errorText: document.getElementById('note-error').textContent,
      indexHidden: document.getElementById('note-index').hidden,
      indexCount: document.getElementById('note-pages').querySelectorAll('button').length,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      docScrollH: document.documentElement.scrollHeight,
      docClientH: document.documentElement.clientHeight,
      bodyHeight: Math.round(body.getBoundingClientRect().height),
      pagesHeight: Math.round(document.getElementById('note-pages').getBoundingClientRect().height),
      metaTime: document.getElementById('note-meta-time').textContent
    };
  }
  await sleep(120);
  window.__pushOpened(scenario === 'empty' ? 'n1' : 'n2');
  await sleep(160);
  output.opened = snapshot();

  // 输入：标题随正文长出来，字数跟着变，保存是防抖的
  var body = document.getElementById('note-body');
  body.querySelector('.tiptap').focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, '  换个开头\\n第二行');
  await sleep(60);
  output.afterInput = snapshot();
  output.updateCallsImmediately = (window.__calls.update || []).length;
  await sleep(600);
  output.updateCallsAfterDebounce = (window.__calls.update || []).length;
  output.lastUpdateText = ((window.__calls.update || []).slice(-1)[0] || {}).text;
  output.afterSaveMetaTime = document.getElementById('note-meta-time').textContent;

  if (scenario === 'toolbar') {
    var command = function(name){ document.querySelector('[data-format="'+name+'"]').click(); };
    body.querySelector('.tiptap').focus();
    document.execCommand('selectAll');
    await sleep(80);
    for (var mark of ['bold','italic','underline','strike']) command(mark);
    output.markup = body.innerHTML;
    command('large'); output.large = !!body.querySelector('h1');
    command('small'); output.small = !!body.querySelector('h2');
    command('body'); output.paragraph = !body.querySelector('h1,h2');
    document.getSelection().collapseToEnd();
    await sleep(80);
    command('bulletList'); output.bullets = !!body.querySelector('ul > li');
    command('bulletList');
    command('taskList');
    body.querySelector('input[type=checkbox]').click();
    await sleep(110);
    document.getElementById('note-attach').click();
    await sleep(110);
    document.getElementById('note-ledger').click();
    document.querySelector('#note-ledger-form [name=amount]').value = '12.50';
    document.getElementById('note-ledger-form').requestSubmit();
    document.getElementById('note-close').click();
    await sleep(100);
    output.savedToolbar = window.__calls.update.at(-1);
    window.__pushOpened('n1');
    await sleep(100);
    window.__pushOpened('n2');
    await sleep(100);
    output.reopened = {
      checked: Boolean(body.querySelector('li[data-checked=true]')),
      attachment: body.querySelector('.note-file')?.textContent,
      text: window.NoteUI.text(),
      html:body.innerHTML,
      hidden: window.__calls.hide
    };
    window.__notesResult = output;
    return;
  }

  // 单层 ... 更多动作菜单：不嵌套，且每行是水平单行（图标与文字同行、高度正常）
  var moreTrigger = document.getElementById('note-more');
  if (moreTrigger) {
    moreTrigger.click();
    await sleep(100);
    var rows = Array.from(document.querySelectorAll('.action-strip-menu-list button'));
    var rowMetrics = rows.slice(0, 4).map(function(btn){
      var r = btn.getBoundingClientRect();
      var icon = btn.querySelector('.action-strip-icon');
      var text = btn.querySelector('.action-strip-text');
      var ir = icon ? icon.getBoundingClientRect() : null;
      var tr = text ? text.getBoundingClientRect() : null;
      return {
        display: getComputedStyle(btn).display,
        h: Math.round(r.height),
        aligned: Boolean(ir && tr && Math.abs((ir.top + ir.height / 2) - (tr.top + tr.height / 2)) <= 4)
      };
    });
    output.moreMenu = {
      nestedCount: document.querySelectorAll('.note-relay-menu').length,
      rowCount: rows.length,
      rowMetrics: rowMetrics
    };
    moreTrigger.click();
    await sleep(60);
    // 菜单关闭时在工具栏按钮上按数字键不得触发动作；仅打开菜单后按数字键才触发
    var runsBeforeKey = (window.__calls.actionRuns || []).length;
    var pinBtn = document.getElementById('note-pin');
    pinBtn.focus();
    pinBtn.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
    await sleep(60);
    output.moreMenu.closedDigitIgnored = (window.__calls.actionRuns || []).length === runsBeforeKey;
    moreTrigger.click();
    await sleep(60);
    moreTrigger.focus();
    moreTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    await sleep(80);
    output.moreMenu.openDigitRan = (window.__calls.actionRuns || []).length === runsBeforeKey + 1 && (window.__calls.actionRuns || []).at(-1) === 'output.copy';
    // 交错时序测试：编辑触发防抖保存在途 -> 执行 ... 动作 -> 保存返回不覆盖动作成功/失败反馈
    window.__holdUpdate = true;
    window.__releaseUpdate = null;
    body.querySelector('.tiptap').focus();
    document.execCommand('insertText', false, '!');
    await sleep(460);
    moreTrigger.click();
    await sleep(80);
    var copyBtn = document.querySelector('.action-strip-menu-list button[data-action-id="output.copy"]');
    if (copyBtn) {
      output.moreMenu.okHeld = typeof window.__releaseUpdate === 'function';
      copyBtn.click();
      await sleep(80);
      if (window.__releaseUpdate) window.__releaseUpdate();
      window.__holdUpdate = false;
      await sleep(80);
      output.moreMenu.okFeedback = document.getElementById('note-saved').textContent;
    }
    window.__holdUpdate = true;
    window.__releaseUpdate = null;
    body.querySelector('.tiptap').focus();
    document.execCommand('insertText', false, '?');
    await sleep(460);
    moreTrigger.click();
    await sleep(80);
    var failBtn = document.querySelector('.action-strip-menu-list button[data-action-id="text.translate"]');
    if (failBtn) {
      output.moreMenu.errHeld = typeof window.__releaseUpdate === 'function';
      failBtn.click();
      await sleep(80);
      if (window.__releaseUpdate) window.__releaseUpdate();
      window.__holdUpdate = false;
      await sleep(80);
      output.moreMenu.errorHidden = document.getElementById('note-error').hidden;
      output.moreMenu.errorText = document.getElementById('note-error').textContent;
      // 动作失败 -> 保存失败 -> 重试保存成功 -> 动作错误仍保留可见
      var callsBeforeFail = window.__calls.update.length;
      window.__failNextUpdate = true;
      body.querySelector('.tiptap').focus();
      document.execCommand('insertText', false, '.');
      await sleep(480);
      output.moreMenu.saveFailed = window.__calls.update.length === callsBeforeFail + 1 && document.getElementById('note-saved').dataset.state === 'error';
      body.querySelector('.tiptap').focus();
      document.execCommand('insertText', false, '.');
      await sleep(480);
      output.moreMenu.saveRetriedOk = window.__calls.update.length === callsBeforeFail + 2
        && document.getElementById('note-saved').textContent === '已保存'
        && String((window.__calls.update.at(-1) || {}).text || '').includes('..');
      output.moreMenu.afterRetryErrorHidden = document.getElementById('note-error').hidden;
      output.moreMenu.afterRetryErrorText = document.getElementById('note-error').textContent;
    }
    window.NoteUI.notice('');
    await sleep(60);
  }

  // 全部速记：列出并可切换（宽屏已自动展开时直接测列表，避免再次点击把侧栏合上）
  if (document.getElementById('note-index').hidden) {
    document.getElementById('note-index-btn').click();
    await sleep(180);
  }
  output.afterIndex = snapshot();
  var first = document.querySelector('#note-pages button');
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

  // Esc：先收浮层（若焦点在侧栏内应还给侧栏开关），再收窗口
  document.getElementById('note-index-btn').click();
  await sleep(120);
  document.getElementById('note-search').focus();
  var beforeEsc = window.__calls.hide;
  document.getElementById('note-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(120);
  output.escClosedIndexOnly = document.getElementById('note-index').hidden && window.__calls.hide === beforeEsc;
  output.escRestoredToggleFocus = document.activeElement === document.getElementById('note-index-btn');
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
  fs.mkdirSync(path.join(TMP,'art'),{recursive:true});for(const asset of ['utility-surface.css','liquid-glass.js','liquid-glass.css','companion.js','companion.css','ui-motion.css','ui-motion.js','glass-select.css','glass-select.js','icons.js','action-strip.css','action-strip.js','relay-surfaces.js','art/companion-courier.png'])fs.copyFileSync(path.join(ROOT,'src',asset),path.join(TMP,asset));
  fs.copyFileSync(path.join(ROOT, 'src', 'notes.js'), path.join(TMP, 'notes.js'));
  fs.mkdirSync(path.join(TMP,'vendor'));
  for (const asset of ['document-editor.js','purify.js']) fs.copyFileSync(path.join(ROOT,'src/vendor',asset),path.join(TMP,'vendor',asset));
  const page = html
    .replace('<script src="notes.js"></script>', [
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e.error));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String((e.reason&&e.reason.message)||e.reason));});</script>',
      '<script src="__notes_mock.js"></script>',
      '<script src="notes.js"></script>'
    ].join('\n'))
    .replace('</body>', [
      '<script src="__notes_probe.js"></script>',
      '<script src="__notes_error_probe.js"></script>',
      '</body>'
    ].join('\n'));
  require('./browser-fixture').writeFixture(path.join(TMP, '__notes_check.html'), page);
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

    check('钉住可切换往返', main.afterPin && main.afterPin.pinned === 'false' && main.afterPin.pinPressed === 'false',
      JSON.stringify(main.afterPin));
    check('删除走过确认再删', main.removeCalls && main.removeCalls.length === 1, JSON.stringify(main.removeCalls));
    check('删除后关掉窗口', main.hideCalls >= 1, String(main.hideCalls));
    check('Esc 先收浮层，再收窗口（焦点在侧栏内时还给侧栏开关）',
      main.escClosedIndexOnly === true && main.escRestoredToggleFocus === true && main.hideCallsAfterEsc > main.hideCalls,
      JSON.stringify({ esc: main.escClosedIndexOnly, focus: main.escRestoredToggleFocus, after: main.hideCallsAfterEsc }));
    check('没有未捕获的页面错误', (main.errors || []).length === 0, JSON.stringify(main.errors));

    const toolbar = await runScenario(browser.send, 'toolbar', 760, 550);
    check('四个文字格式都写入所选正文', ['strong','em','u','s'].every(tag => toolbar.markup?.includes('<'+tag+'>')), JSON.stringify(toolbar));
    check('大标题、小标题、正文与项目符号可切换', toolbar.large && toolbar.small && toolbar.paragraph && toolbar.bullets);
    check('关窗补保存后重开仍有已勾选清单、附件和账目', toolbar.reopened?.checked && toolbar.reopened?.attachment === '发票.pdf'
      && toolbar.reopened?.text.includes('支出 ¥12.50') && toolbar.reopened?.hidden === 1, JSON.stringify({saved:toolbar.savedToolbar,reopened:toolbar.reopened}));

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

    console.log('\n== 小窗口（240×200 下限）与宽矮窗口（750×240）==');
    const small = await runScenario(browser.send, 'default', 240, 200);
    check('最小尺寸下不溢出', small.opened && small.opened.docScrollW <= small.opened.docClientW
      && small.opened.docScrollH <= small.opened.docClientH, JSON.stringify(small.opened));
    check('最小尺寸下正文仍可见', small.opened && small.opened.text.length > 0 && small.opened.bodyHeight >= 40, JSON.stringify({ bodyHeight: small.opened && small.opened.bodyHeight }));
    const wideShort = await runScenario(browser.send, 'default', 750, 240);
    check('宽矮窗口（750×240）侧栏列表可见且可切换页面',
      wideShort.afterIndex && wideShort.afterIndex.pagesHeight >= 60 && wideShort.openCalls && wideShort.openCalls.length >= 1,
      JSON.stringify({ pagesHeight: wideShort.afterIndex && wideShort.afterIndex.pagesHeight, openCalls: wideShort.openCalls }));
    check('速记 ... 菜单为单层、横向单行排列且成功/失败均有可见反馈',
      main.moreMenu && main.moreMenu.nestedCount === 0 && main.moreMenu.rowCount >= 4
      && main.moreMenu.rowMetrics.every(row => row.display === 'flex' && row.h >= 24 && row.h <= 38 && row.aligned)
      && main.moreMenu.closedDigitIgnored === true && main.moreMenu.openDigitRan === true
      && main.moreMenu.okHeld === true && main.moreMenu.errHeld === true
      && main.moreMenu.okFeedback === '已复制'
      && main.moreMenu.errorHidden === false && /翻译服务暂不可用/.test(main.moreMenu.errorText || '')
      && main.moreMenu.saveFailed === true && main.moreMenu.saveRetriedOk === true
      && main.moreMenu.afterRetryErrorHidden === false && /翻译服务暂不可用/.test(main.moreMenu.afterRetryErrorText || ''),
      JSON.stringify(main.moreMenu));
    check('保存后页头更新时间同步刷新',
      main.opened && main.afterSaveMetaTime && main.afterSaveMetaTime !== main.opened.metaTime && /^今天\s+\d{2}:\d{2}$/.test(main.afterSaveMetaTime),
      JSON.stringify({ before: main.opened && main.opened.metaTime, after: main.afterSaveMetaTime }));
  } catch (error) {
    console.log('  FAIL  无头 Chrome 检查异常 -> ' + error.message);
    fail += 1;
  } finally {
    if (browser && browser.child) browser.child.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 2 }); } catch { /* 清理失败不影响结果 */ }
  }
  finish();
})();
