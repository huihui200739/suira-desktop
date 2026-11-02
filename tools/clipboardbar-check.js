'use strict';
/*
 * 剪贴板历史条渲染层检查。
 *
 * 分两段：
 * 1. 静态约束：文件齐备、不引用网络资源、不 require 模块、不用 eval、
 *    JS 引用的 DOM ID 都存在、中文文案、quickpanel 同源设计令牌、
 *    大预览卡片、轨道横向滚动且隐藏滚动条、根元素裁掉溢出。
 * 2. 无头 Chrome 真实加载 src/clipboardbar.html，注入 mock 的 window.suira，
 *    在与主进程共用的宽幅视口里断言：空态、8 条数据渲染、图片缩略图、
 *    默认选中第一条、←/→/End 浏览、滚动位置、滚轮横向滚动、
 *    Enter 提交 payload 与成功后 hide、复制兜底与失败提示、Esc 关闭、
 *    onShown 重置、页面无整体滚动条 / 卡片不溢出。
 *
 * 用法：node tools/clipboardbar-check.js
 * 截图：写到系统临时目录（不污染仓库），路径在结尾打印。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { CLIPBOARD_SHELF_SIZE } = require('../lib/display-geometry');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-clipboardbar-'));
const SHOT_DIR = path.join(os.tmpdir(), 'suira-clipboardbar-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

const LONG_TEXT = '这是一段故意写得很长的剪贴板文本，用来验证摘要会被截断成前九十个字，卡片不会因为文字太长而把布局撑破。'
  + '它会重复几遍，确保总长度明显超过九十字，从而让「前 90 字摘要」这条约束真正被检查到。'
  + '第三遍继续补充内容，让超长文本在卡片里被可靠地截断。';
const THUMB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
const requiredFiles = ['src/clipboardbar.html', 'src/clipboardbar.css', 'src/clipboardbar.js', 'tools/clipboardbar-check.js'];
const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(ROOT, file)));
check('剪贴板历史条相关文件齐备', missingFiles.length === 0, '缺失: ' + missingFiles.join(', '));

const barHtml = fs.readFileSync(path.join(ROOT, 'src', 'clipboardbar.html'), 'utf8');
const barCss = fs.readFileSync(path.join(ROOT, 'src', 'clipboardbar.css'), 'utf8');
const barJs = fs.readFileSync(path.join(ROOT, 'src', 'clipboardbar.js'), 'utf8');

check('HTML 引用 clipboardbar.css', barHtml.includes('href="clipboardbar.css"'));
check('HTML 引用 clipboardbar.js', barHtml.includes('src="clipboardbar.js"'));

const remoteRefs = [barHtml, barCss, barJs].filter((text) => /https?:\/\//i.test(text));
check('页面不引用任何网络资源', remoteRefs.length === 0, remoteRefs.length ? '出现网络地址' : '');
const networkApis = barJs.match(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
check('渲染层不使用网络 API', !networkApis, networkApis ? '出现: ' + networkApis[0] : '');
check('渲染层不 require 模块', !/\brequire\s*\(/.test(barJs));
check('渲染层不用 eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(barJs));

const htmlIds = new Set([...barHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const jsIds = new Set([...barJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
const missingIds = [...jsIds].filter((id) => !htmlIds.has(id));
check('clipboardbar.js 引用的 ID 都存在于 HTML', missingIds.length === 0, '缺失: ' + missingIds.join(', '));

check('界面文案为中文（标题 / 快捷键提示）',
  ['剪贴板历史', '← → 选择', '粘贴到当前窗口'].every((text) => (barHtml + barJs).includes(text)));
check('空态文案符合规格', (barHtml + barJs).includes('还没有剪贴板记录，复制一段文字或一张图再试'));
check('渲染层带 API 不可用提示', barJs.includes('剪贴板历史暂不可用'));
check('渲染层明确提交当前窗口粘贴意图', barJs.includes("intent: 'paste-current'"));
check('渲染层订阅 onShown 与 content.onChanged', barJs.includes('onShown') && barJs.includes('onChanged'));
check('渲染层过滤不可见时的内容刷新', barJs.includes('state.visible'));

const themeCss = fs.readFileSync(path.join(ROOT, 'src', 'theme.css'), 'utf8');
check('HTML 引用共享主题层 theme.css', barHtml.includes('href="theme.css"'));

const tokens = [
  /--slate-12:\s*#1c2024/i,
  /--blue-9:\s*#0090ff/i,
  /--violet-9:\s*#6e56cf/i,
  /--text-1:\s*12px/,
  /Segoe UI/,
  /--radius-panel:\s*24px/,
  /--gap:\s*8px/
];
check('设计令牌集中在 theme.css（与浮引岛 / 动作面板同一套）', tokens.every((pattern) => pattern.test(themeCss)));
check('剪贴板条不写死色值（只消费令牌）', !/#[0-9a-f]{6}\b/i.test(barCss.replace(/rgba?\([^)]*\)/g, '')),
  (barCss.match(/#[0-9a-f]{6}\b/i) || [''])[0]);
check('卡片为宽幅预览，并跟随轨道高度', /width:\s*220px/.test(barCss) && /height:\s*100%/.test(barCss));
check('轨道横向滚动 / 隐藏滚动条',
  /\.bar-track\s*\{[^}]*overflow-x:\s*auto/.test(barCss)
  && barCss.includes('scrollbar-width: none')
  && barCss.includes('::-webkit-scrollbar'));
check('空态居中且截断', barCss.includes('.bar-empty') && barCss.includes('text-overflow: ellipsis'));
check('根元素裁掉溢出', /\.bar\s*\{[^}]*overflow:\s*hidden/.test(barCss) && /html, body \{[^}]*overflow:\s*hidden/.test(barCss));

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
  var scenario = params.get('scenario') || 'main';
  if (scenario === 'offline') return;
  var LONG_TEXT = __LONG_TEXT__;
  var THUMB = __THUMB__;
  var now = Date.now();
  function mk(id, kind, title, text, filePath, thumbnail, appName, ageMs){
    return {
      id: id, kind: kind, title: title || '', text: text || '', filePath: filePath || '',
      thumbnail: thumbnail || '', source: { appName: appName || '', type: kind }, createdAt: now - ageMs
    };
  }
  var ALL = [
    mk('img-1', 'image', '屏幕截图 1', '', 'C:/demo/shot-1.png', THUMB, '微信', 2 * 60000),
    mk('img-2', 'image', '屏幕截图 2', '', 'C:/demo/shot-2.png', THUMB, '飞书', 12 * 60000),
    mk('img-3', 'image', '屏幕截图 3', '', 'C:/demo/shot-3.png', THUMB, '', 3 * 3600000),
    mk('text-1', 'text', '', '下午三点的产品评审改到四点半，会议室换到 3F 望江。', '', '', 'Chrome', 5 * 60000),
    mk('text-2', 'text', '', LONG_TEXT, '', '', '记事本', 26 * 3600000),
    mk('text-3', 'text', '', '复制一段普通文字，用来验证文字卡片的摘要显示。', '', '', '', 8 * 60000),
    mk('files-1', 'files', '季度报告.pdf', 'C:/demo/report.pdf\\nC:/demo/summary.pdf', 'C:/demo/report.pdf', '', '资源管理器', 40 * 60000),
    mk('files-2', 'files', '素材包.zip', 'C:/demo/assets.zip', 'C:/demo/assets.zip', '', '', 2 * 86400000)
  ];

  var calls = window.__calls = { list: 0, commit: [], hide: 0 };
  window.__commitResult = { ok: true, copied: true, pasted: true };
  var shownCallbacks = [];
  var changedCallbacks = [];
  function clone(value){ return JSON.parse(JSON.stringify(value)); }

  window.suira = window.suira || {};
  window.suira.imageEditor = { open: function(options){ calls.edit=options;return Promise.resolve(window.__editFail?{ok:false,error:'原图已被移动'}:{ok:true}); } };
  window.suira.content = {
    togglePin: function(id){
      if(window.__pinThrow) return Promise.reject(new Error('写入失败'));
      var item = ALL.find(function(record){ return record.id === id; });
      if(!item) return Promise.resolve({ok:false});
      item.pinned = !item.pinned;
      return Promise.resolve({ok:true,pinned:item.pinned});
    },
    list: function(options){
      calls.list += 1;
      calls.lastListOptions = clone(options || {});
      if (scenario === 'error') return Promise.reject(new Error('主进程内容库读取失败'));
      if (scenario === 'empty') return Promise.resolve([]);
      if (window.__listThrow) return Promise.reject(new Error('暂时离线'));
      if (window.__listDelay) return new Promise(resolve => setTimeout(()=>resolve(clone(ALL)),window.__listDelay));
      return Promise.resolve(clone(ALL));
    },
    onChanged: function(callback){
      if (typeof callback === 'function') changedCallbacks.push(callback);
      return function(){ changedCallbacks = changedCallbacks.filter(function(fn){ return fn !== callback; }); };
    }
  };
  window.suira.returnTo = {
    commit: function(payload){
      calls.commit.push(clone(payload));
      if (window.__commitThrow) return Promise.reject(new Error('主进程没有响应'));
      return Promise.resolve(clone(window.__commitResult));
    }
  };
  window.suira.clipboardBar = {
    hide: function(){ calls.hide += 1; return Promise.resolve(); },
    onShown: function(callback){
      if (typeof callback === 'function') shownCallbacks.push(callback);
      return function(){ shownCallbacks = shownCallbacks.filter(function(fn){ return fn !== callback; }); };
    }
  };
  window.__fireShown = function(){
    shownCallbacks.forEach(function(callback){ try { callback(); } catch (error) {} });
  };
  window.__addFirst = function(){ ALL.unshift(mk('added','text','新记录','新增内容','','','',0)); };
  window.__fireChanged = function(){
    changedCallbacks.forEach(function(callback){ try { callback(); } catch (error) {} });
  };
})();
`.replace('__LONG_TEXT__', JSON.stringify(LONG_TEXT)).replace('__THUMB__', JSON.stringify(THUMB));

const PROBE = `
(function(){
  var params = new URLSearchParams(location.search);
  var scenario = params.get('scenario') || 'main';
  // 截图时只加载页面，不跑交互探针
  if (params.get('probe') === '0') return;
  function sleep(ms){ return new Promise(function(resolve){ setTimeout(resolve, ms); }); }
  function key(name){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  }
  function metrics(){
    var doc = document.documentElement;
    var body = document.body;
    var track = document.getElementById('bar-track');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.bar-card'));
    var selected = cards.filter(function(card){ return card.classList.contains('is-selected'); })[0] || null;
    var trackRect = track ? track.getBoundingClientRect() : null;
    var selectedVisible = false;
    if (selected && trackRect) {
      var rect = selected.getBoundingClientRect();
      selectedVisible = rect.left >= trackRect.left - 1 && rect.right <= trackRect.right + 1;
    }
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.card-thumb'));
    var snippets = Array.prototype.slice.call(document.querySelectorAll('.card-snippet')).map(function(el){ return el.textContent; });
    var selection = document.getElementById('bar-selection');
    var notice = document.getElementById('bar-notice');
    var empty = document.getElementById('bar-empty');
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      docScrollW: doc.scrollWidth,
      docClientW: doc.clientWidth,
      docScrollH: doc.scrollHeight,
      docClientH: doc.clientHeight,
      bodyScrollW: body.scrollWidth,
      bodyScrollH: body.scrollHeight,
      cardCount: cards.length,
      cardRects: cards.slice(0, 2).map(function(card){
        var rect = card.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
      selectedIndex: cards.indexOf(selected),
      selectedId: selected ? selected.getAttribute('data-id') : '',
      selectedVisible: selectedVisible,
      trackHidden: track ? track.hidden : null,
      trackScrollLeft: track ? Math.round(track.scrollLeft) : -1,
      trackScrollWidth: track ? track.scrollWidth : 0,
      trackClientWidth: track ? track.clientWidth : 0,
      trackOverflowX: track ? getComputedStyle(track).overflowX : '',
      trackOverflowY: track ? getComputedStyle(track).overflowY : '',
      trackScrollBehavior: track ? getComputedStyle(track).scrollBehavior : '',
      trackScrollbarH: track ? Math.max(0, track.offsetHeight - track.clientHeight) : -1,
      trackScrollbarW: track ? Math.max(0, track.offsetWidth - track.clientWidth) : -1,
      cardOverflow: cards.map(function(card){ return Math.max(0, card.scrollWidth - card.clientWidth); }),
      imageCount: imgs.length,
      imageSrcs: imgs.map(function(img){ return img.getAttribute('src'); }),
      snippetLengths: snippets.map(function(text){ return text.length; }),
      fileCountTexts: Array.prototype.slice.call(document.querySelectorAll('.card-count')).map(function(el){ return el.textContent; }),
      emptyHidden: empty ? empty.hidden : null,
      emptyMode: empty ? empty.dataset.mode : '',
      emptyTitle: document.getElementById('bar-empty-title') ? document.getElementById('bar-empty-title').textContent : '',
      emptyHint: document.getElementById('bar-empty-hint') ? document.getElementById('bar-empty-hint').textContent : '',
      retryHidden: document.getElementById('bar-retry') ? document.getElementById('bar-retry').hidden : null,
      countText: document.getElementById('bar-count') ? document.getElementById('bar-count').textContent : '',
      selectionHidden: selection ? selection.hidden : null,
      selectionText: selection ? selection.textContent : '',
      noticeHidden: notice ? notice.hidden : null,
      noticeText: notice ? notice.textContent : '',
      noticeError: notice ? notice.classList.contains('is-error') : null,
      calls: JSON.parse(JSON.stringify(window.__calls || {})),
      errors: (window.__errs || []).slice()
    };
  }
  async function main(){
    var output = { scenario: scenario };
    await sleep(350);
    output.initial = metrics();

    if (scenario === 'empty' || scenario === 'offline' || scenario === 'layout') {
      output.final = metrics();
    } else if (scenario === 'error') {
      document.getElementById('bar-retry').click();
      await sleep(350);
      output.afterRetry = metrics();
    } else {
      key('ArrowRight');
      await sleep(650);
      output.afterRight = metrics();

      key('End');
      await sleep(750);
      output.afterEnd = metrics();

      if (window.__fireShown) {
        window.__fireShown();
        await sleep(550);
      }
      output.afterShown = metrics();

      var track = document.getElementById('bar-track');
      track.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
      await sleep(750);
      output.afterWheel = metrics();

      key('Enter');
      await sleep(250);
      output.afterEnter = metrics();

      window.__commitResult = { ok: true, copied: true, pasted: false, message: '已复制，切回目标后粘贴' };
      key('Enter');
      await sleep(250);
      output.afterFallback = metrics();
      await sleep(2200);
      output.afterFallbackRestore = metrics();

      window.__commitResult = { ok: false, error: '复制失败：目标窗口已关闭' };
      key('Enter');
      await sleep(250);
      output.afterFailure = metrics();
      await sleep(2200);

      window.__commitThrow = true;
      window.__commitResult = { ok: true, copied: true, pasted: true };
      key('Enter');
      await sleep(250);
      output.afterThrow = metrics();
      window.__commitThrow = false;

      if (window.__fireChanged) {
        window.__fireChanged();
        await sleep(400);
      }
      output.afterChanged = metrics();

      key('Escape');
      await sleep(200);
      output.afterEsc = metrics();
    }

    window.__barResult = output;
    var pre = document.createElement('pre');
    pre.textContent = 'B:' + JSON.stringify(output);
    document.body.appendChild(pre);
  }
  main().catch(function(error){
    window.__barResult = {
      scenario: scenario,
      fatal: String((error && error.stack) || error),
      errors: (window.__errs || []).slice()
    };
    var pre = document.createElement('pre');
    pre.textContent = 'B:' + JSON.stringify(window.__barResult);
    document.body.appendChild(pre);
  });
})();
`;

function buildFixtures() {
  fs.mkdirSync(path.join(TMP,'art'),{recursive:true});
  for (const asset of ['ui-motion.css','ui-motion.js','tool-art.css','tool-art.js', 'companion.js', 'companion.css', 'art/companion-courier.png','tool-surfaces.css']) fs.copyFileSync(path.join(ROOT,'src',asset),path.join(TMP,asset));
  fs.writeFileSync(path.join(TMP, '__bar_mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, '__bar_probe.js'), PROBE, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'src', 'theme.css'), path.join(TMP, 'theme.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'clipboardbar.css'), path.join(TMP, 'clipboardbar.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'clipboardbar.js'), path.join(TMP, 'clipboardbar.js'));
  const page = barHtml
    .replace('<link rel="stylesheet" href="clipboardbar.css">',
      '<link rel="stylesheet" href="clipboardbar.css"><style>html,body{background:linear-gradient(135deg,#778aa3,#4c5b70)}</style>')
    .replace('<script src="clipboardbar.js"></script>', [
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e.error));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String((e.reason&&e.reason.message)||e.reason));});</script>',
      '<script src="__bar_mock.js"></script>',
      '<script src="clipboardbar.js"></script>',
      '<script src="__bar_probe.js"></script>'
    ].join('\n'));
  fs.writeFileSync(path.join(TMP, '__bar_check.html'), page, 'utf8');
}

const fileUrl = (target) => 'file:///' + path.resolve(target).replace(/\\/g, '/');
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
  // 调试端口交给 Chrome 自己挑，再从 DevToolsActivePort 读回。
  // 这样不会和其它固定端口的检查脚本冲突，并发跑测试也不会互相劫持浏览器实例。
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
  if (!port) {
    child.kill();
    throw new Error('Chrome 调试端口未就绪');
  }

  let targets = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list');
      targets = await response.json();
      if (targets && targets.length) break;
    } catch { /* 端口未就绪 */ }
    await sleep(200);
  }
  if (!targets || !targets.length) {
    child.kill();
    throw new Error('Chrome 调试目标未就绪');
  }
  const page = targets.find((target) => target.type === 'page') || targets[0];
  const connection = await connect(page.webSocketDebuggerUrl);
  await connection.send('Page.enable');
  await connection.send('Runtime.enable');
  return { child, ws: connection.ws, send: connection.send, port };
}

async function waitForResult(send, token, timeoutMs = 40000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluate(send, `(function(){
        if (location.search.indexOf(${JSON.stringify(token)}) < 0) return '';
        return window.__barResult ? JSON.stringify(window.__barResult) : '';
      })()`);
      if (value) return JSON.parse(value);
    } catch { /* 页面切换中 */ }
    await sleep(100);
  }
  throw new Error('等待页面探针超时：' + token);
}

async function runScenario(send, scenario, width = CLIPBOARD_SHELF_SIZE.width, height = CLIPBOARD_SHELF_SIZE.height, scaleFactor = 1) {
  runSequence += 1;
  const token = 'run-' + runSequence;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scaleFactor, mobile: false });
  // 测试不依赖本机系统主题：显式指定浅色，否则深色系统上截出来的图会变样
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', {
    url: fileUrl(path.join(TMP, '__bar_check.html')) + '?scenario=' + encodeURIComponent(scenario) + '&run=' + token
  });
  await sleep(250);
  return waitForResult(send, token);
}

async function capture(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

function noOverflow(metrics) {
  return metrics.docScrollW <= metrics.docClientW
    && metrics.docScrollH <= metrics.docClientH
    && metrics.bodyScrollW <= metrics.innerW
    && metrics.bodyScrollH <= metrics.innerH;
}

async function runChecks(send) {
  console.log('\n== 空态（没有任何剪贴板记录）==');
  const empty = await runScenario(send, 'empty');
  const emptyView = empty.initial;
  check('视口使用主进程共用的宽幅尺寸', emptyView.innerW === CLIPBOARD_SHELF_SIZE.width && emptyView.innerH === CLIPBOARD_SHELF_SIZE.height,
    emptyView.innerW + '×' + emptyView.innerH);
  check('空态不渲染卡片', emptyView.cardCount === 0, 'cards=' + emptyView.cardCount);
  check('空态隐藏轨道、显示空态区', emptyView.trackHidden === true && emptyView.emptyHidden === false);
  check('空态文案符合规格', emptyView.emptyTitle === '还没有剪贴板记录，复制一段文字或一张图再试', emptyView.emptyTitle);
  check('空态不显示重试按钮', emptyView.retryHidden === true);
  check('空态无页面级滚动条 / 溢出', noOverflow(emptyView),
    JSON.stringify([emptyView.docScrollW, emptyView.docClientW, emptyView.docScrollH, emptyView.docClientH]));
  check('空态无脚本错误', emptyView.errors.length === 0, JSON.stringify(emptyView.errors));

  console.log('\n== 读取失败（content.list 拒绝）==');
  const errored = await runScenario(send, 'error');
  const errorView = errored.initial;
  check('读取失败显示可读错误', errorView.emptyMode === 'error' && errorView.emptyTitle === '暂时读不到剪贴板历史',
    errorView.emptyMode + ' / ' + errorView.emptyTitle);
  check('读取失败说明具体原因', errorView.emptyHint.includes('主进程内容库读取失败'), errorView.emptyHint);
  check('读取失败提供重试按钮', errorView.retryHidden === false);
  check('重试后仍保持可读错误（不白屏）', errored.afterRetry.emptyTitle === '暂时读不到剪贴板历史'
    && errored.afterRetry.emptyMode === 'error');
  check('读取失败无未捕获错误', errorView.errors.length === 0, JSON.stringify(errorView.errors));

  console.log('\n== API 不可用（没有 window.suira）==');
  const offline = await runScenario(send, 'offline');
  const offlineView = offline.initial;
  check('不可用时给出可读提示', offlineView.emptyMode === 'offline' && offlineView.emptyTitle === '剪贴板历史暂不可用',
    offlineView.emptyMode + ' / ' + offlineView.emptyTitle);
  check('不可用时不渲染假卡片', offlineView.cardCount === 0);
  check('不可用态无脚本错误', offlineView.errors.length === 0, JSON.stringify(offlineView.errors));

  console.log('\n== 8 条记录：渲染 / 选中 / 浏览 / 提交 ==');
  const main = await runScenario(send, 'main');
  const initial = main.initial;
  check('渲染出 8 张卡片', initial.cardCount === 8, 'cards=' + initial.cardCount);
  check('有内容时隐藏空态、显示轨道', initial.emptyHidden === true && initial.trackHidden === false,
    'emptyHidden=' + initial.emptyHidden + ' trackHidden=' + initial.trackHidden);
  check('卡片宽 220 且有充足预览高度', initial.cardRects.every((rect) => rect.w === 220 && rect.h >= 170),
    JSON.stringify(initial.cardRects));
  check('3 张图片卡片都有 img 且 src 为 thumbnail', initial.imageCount === 3
    && initial.imageSrcs.length === 3 && initial.imageSrcs.every((src) => src === THUMB),
    JSON.stringify({ count: initial.imageCount }));
  check('files 卡片显示「N 个文件」', initial.fileCountTexts.length === 2
    && initial.fileCountTexts.includes('2 个文件') && initial.fileCountTexts.includes('1 个文件'),
    JSON.stringify(initial.fileCountTexts));
  check('文字卡片摘要不超过 90 字', initial.snippetLengths.length === 3
    && initial.snippetLengths.every((length) => length <= 90), JSON.stringify(initial.snippetLengths));
  check('超长文本被截断到 90 字', initial.snippetLengths.includes(90), JSON.stringify(initial.snippetLengths));
  check('默认选中第 1 条', initial.selectedIndex === 0 && initial.selectedId === 'img-1',
    initial.selectedIndex + ' / ' + initial.selectedId);
  check('底部显示类型 / 标题 / 来源应用 / 相对时间',
    initial.selectionText.includes('图片') && initial.selectionText.includes('来源 微信')
    && initial.selectionText.includes('分钟前'), initial.selectionText);
  check('卡片内容不横向溢出', initial.cardOverflow.every((value) => value === 0),
    JSON.stringify(initial.cardOverflow));
  check('页面无整体滚动条 / 溢出', noOverflow(initial),
    JSON.stringify([initial.docScrollW, initial.docClientW, initial.docScrollH, initial.docClientH]));
  check('轨道可横向滚动', initial.trackOverflowX === 'auto' && initial.trackScrollWidth > initial.trackClientWidth,
    initial.trackScrollWidth + ' > ' + initial.trackClientWidth);
  check('轨道平滑滚动且不显示滚动条', initial.trackScrollBehavior === 'smooth'
    && initial.trackScrollbarH === 0 && initial.trackScrollbarW === 0,
    initial.trackScrollBehavior + ' / ' + initial.trackScrollbarH);

  const afterRight = main.afterRight;
  check('按 → 选中第 2 条', afterRight.selectedIndex === 1 && afterRight.selectedId === 'img-2',
    afterRight.selectedIndex + ' / ' + afterRight.selectedId);
  check('按 → 后 scrollIntoView 生效或滚动位置改变',
    afterRight.selectedVisible === true || afterRight.trackScrollLeft !== initial.trackScrollLeft,
    'visible=' + afterRight.selectedVisible + ' left=' + afterRight.trackScrollLeft);

  const afterEnd = main.afterEnd;
  check('按 End 选中最后一条', afterEnd.selectedIndex === 7 && afterEnd.selectedId === 'files-2',
    afterEnd.selectedIndex + ' / ' + afterEnd.selectedId);
  check('按 End 后轨道滚动到末尾方向', afterEnd.trackScrollLeft > 0, 'left=' + afterEnd.trackScrollLeft);

  const afterShown = main.afterShown;
  check('onShown 后重新拉取列表', afterShown.calls.list >= 2, 'list=' + afterShown.calls.list);
  check('onShown 后选中项重置为第 1 条', afterShown.selectedIndex === 0 && afterShown.selectedId === 'img-1',
    afterShown.selectedIndex + ' / ' + afterShown.selectedId);
  check('onShown 后轨道回到起点', afterShown.trackScrollLeft === 0, 'left=' + afterShown.trackScrollLeft);

  const afterWheel = main.afterWheel;
  check('滚轮 deltaY 改变 scrollLeft', afterWheel.trackScrollLeft > afterShown.trackScrollLeft,
    afterShown.trackScrollLeft + ' -> ' + afterWheel.trackScrollLeft);

  const afterEnter = main.afterEnter;
  const payload = afterEnter.calls.commit[0];
  check('Enter 调用 returnTo.commit 一次', afterEnter.calls.commit.length === 1, JSON.stringify(afterEnter.calls.commit));
  check('提交 payload 完全符合契约',
    payload && payload.itemId === afterShown.selectedId && payload.intent === 'paste-current'
    && JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(['intent', 'itemId']),
    JSON.stringify(payload));
  check('直接粘回成功后调用 hide', afterEnter.calls.hide === 1, 'hide=' + afterEnter.calls.hide);
  check('直接粘回成功后不显示提示行', afterEnter.noticeHidden === true);

  const fallback = main.afterFallback;
  check('复制成功即收起，后续 Ctrl+V 使用所选历史', fallback.calls.hide === 2, 'hide=' + fallback.calls.hide);
  check('收起后不留下提示行', fallback.noticeHidden === true);
  check('复制兜底提示不是错误样式', fallback.noticeError === false);
  check('提示行 2 秒后恢复原来的选中项信息', main.afterFallbackRestore.noticeHidden === true
    && main.afterFallbackRestore.selectionHidden === false, JSON.stringify({
      noticeHidden: main.afterFallbackRestore.noticeHidden,
      selectionHidden: main.afterFallbackRestore.selectionHidden
    }));

  const failure = main.afterFailure;
  check('提交失败时提示 r.error', failure.noticeHidden === false
    && failure.noticeText === '复制失败：目标窗口已关闭' && failure.noticeError === true, failure.noticeText);

  const thrown = main.afterThrow;
  check('commit 抛异常时给出兜底提示', thrown.noticeHidden === false
    && thrown.noticeText.includes('复制失败') && thrown.noticeError === true, thrown.noticeText);
  check('异常兜底不关闭窗口', thrown.calls.hide === 2, 'hide=' + thrown.calls.hide);

  const changed = main.afterChanged;
  check('content.onChanged 后刷新（选中项保留）', changed.calls.list >= afterEnter.calls.list
    && changed.cardCount === 8, 'list=' + changed.calls.list + ' cards=' + changed.cardCount);

  const afterEsc = main.afterEsc;
  check('Esc 调用 hide', afterEsc.calls.hide === 3, 'hide=' + afterEsc.calls.hide);
  check('Esc 后提示行清理', afterEsc.noticeHidden === true);
  check('交互全过程无页面溢出', noOverflow(afterEsc));
  check('交互全过程无脚本错误', afterEsc.errors.length === 0, JSON.stringify(afterEsc.errors));

  console.log('\n== 720×310 窄屏布局 ==');
  const narrow = await runScenario(send, 'layout', 720, 310);
  const narrowView = narrow.initial;
  check('窄屏仍渲染 8 张卡片', narrowView.cardCount === 8, 'cards=' + narrowView.cardCount);
  check('窄屏保留完整预览尺寸', narrowView.cardRects.every((rect) => rect.w === 220 && rect.h >= 170),
    JSON.stringify(narrowView.cardRects));
  check('窄屏无页面级滚动条 / 溢出', noOverflow(narrowView),
    JSON.stringify([narrowView.docScrollW, narrowView.docClientW, narrowView.docScrollH, narrowView.docClientH]));
  check('窄屏轨道仍可横向滚动', narrowView.trackOverflowX === 'auto'
    && narrowView.trackScrollWidth > narrowView.trackClientWidth,
    narrowView.trackScrollWidth + ' > ' + narrowView.trackClientWidth);
  check('窄屏底部信息不溢出', narrowView.selectionText.length > 0 && narrowView.cardOverflow.every((value) => value === 0));

  console.log('\n== 搜索、分类、收藏与输入焦点 ==');
  const editHistory=await evaluate(send, `(async()=>{
    window.__fireShown();await new Promise(r=>setTimeout(r,150));
    const button=document.getElementById('bar-edit');const shown=!button.hidden;button.click();await new Promise(r=>setTimeout(r,60));
    const opened=window.__calls.edit?.itemId==='img-1';window.__editFail=true;button.click();await new Promise(r=>setTimeout(r,60));
    const error=document.getElementById('bar-notice').textContent.includes('原图已被移动');window.__editFail=false;
    const commits=window.__calls.commit.length;document.querySelector('.bar-card[data-id="img-2"] [data-edit-image]').click();await new Promise(r=>setTimeout(r,60));
    const direct=window.__calls.edit.itemId==='img-2'&&window.__calls.commit.length===commits;
    document.querySelector('[data-filter="text"]').click();await new Promise(r=>setTimeout(r,60));const textHidden=button.hidden;
    document.querySelector('[data-filter="all"]').click();await new Promise(r=>setTimeout(r,60));
    return {shown,opened,error,textHidden,direct};
  })()`);
  check('历史图片编辑入口传递选中图片，文字隐藏入口，原图失败显示原因',Object.values(editHistory).every(Boolean),JSON.stringify(editHistory));
  const inspectClipboard=await evaluate(send,`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,80)),result={};window.__fireShown();await wait();
    document.querySelector('[data-filter="text"]').click();await wait();
    const before=window.__calls.commit.length,hidden=window.__calls.hide;
    document.querySelector('[data-id="text-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await wait();
    result.fullText=document.getElementById('bar-preview-content').textContent===${JSON.stringify(LONG_TEXT)};
    result.previewDoesNotPaste=window.__calls.commit.length===before;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));result.enterDoesNotPaste=window.__calls.commit.length===before;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}));result.selectOnlyPreview=getSelection().toString()===${JSON.stringify(LONG_TEXT)};getSelection().removeAllRanges();
    document.getElementById('bar-copy').click();await wait();result.copyOnly=window.__calls.commit.at(-1).intent==='copy-only'&&window.__calls.hide===hidden;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));result.escapeReturns=document.getElementById('bar-preview').hidden&&window.__calls.hide===hidden;
    document.getElementById('bar-preview-toggle').blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));await wait();result.spacePreview=!document.getElementById('bar-preview').hidden;
    document.getElementById('bar-preview-close').click();
    const original=window.suira.content.get,payload='<img src=x onerror="window.__injected=true">';
    window.suira.content.get=async()=>({id:'test-preview',kind:'text',text:payload});document.getElementById('bar-preview-toggle').click();await wait();
    result.safeText=document.getElementById('bar-preview-content').textContent===payload&&!document.querySelector('#bar-preview-content img')&&!window.__injected;
    document.getElementById('bar-preview-close').click();window.suira.content.get=()=>new Promise(r=>setTimeout(()=>r({id:'stale',kind:'text',text:'late'}),150));
    document.getElementById('bar-preview-toggle').click();window.__fireShown();await new Promise(r=>setTimeout(r,240));result.noLatePopup=document.getElementById('bar-preview').hidden;
    window.suira.content.get=original;window.__commitResult={ok:true,copied:true,pasted:true};return result;
  })()`);
  for(const [name,ok] of Object.entries(inspectClipboard))check('内容预览与独立复制：'+name,ok,JSON.stringify(inspectClipboard));
  const wheelSpeed = await evaluate(send, `(()=>{
    const track=document.getElementById('bar-track');
    track.scrollTo({left:0,behavior:'instant'});
    const wheel=new WheelEvent('wheel',{deltaY:40,bubbles:true,cancelable:true});track.dispatchEvent(wheel);
    const first=track.scrollLeft;track.dispatchEvent(new WheelEvent('wheel',{deltaY:40,bubbles:true,cancelable:true}));
    const second=track.scrollLeft;
    track.dispatchEvent(new WheelEvent('wheel',{deltaY:-40,bubbles:true,cancelable:true}));const reversed=track.scrollLeft;
    track.scrollTo({left:0,behavior:'instant'});track.dispatchEvent(new WheelEvent('wheel',{deltaY:1,deltaMode:1,bubbles:true,cancelable:true}));
    const lines=track.scrollLeft;
    const horizontal=new WheelEvent('wheel',{deltaX:60,bubbles:true,cancelable:true});track.dispatchEvent(horizontal);
    return {first,second,reversed,lines,verticalHandled:wheel.defaultPrevented,horizontalNative:!horizontal.defaultPrevented};
  })()`);
  check('滚轮单次立即加速、连续位移不被动画吞掉、反向滚动正确', wheelSpeed.first>=100 && wheelSpeed.second>wheelSpeed.first && wheelSpeed.reversed<wheelSpeed.second, JSON.stringify(wheelSpeed));
  check('行滚轮归一化且水平触控板保留原生手感',wheelSpeed.lines>=90 && wheelSpeed.verticalHandled && wheelSpeed.horizontalNative,JSON.stringify(wheelSpeed));
  const toolbar = await evaluate(send, `(async function(){
    var wait = function(){return new Promise(r=>setTimeout(r,100));};
    var search = document.getElementById('bar-search');
    var pin = document.getElementById('bar-pin');
    var ids = function(){return Array.from(document.querySelectorAll('.bar-card')).map(c=>c.dataset.id);};
    var query = async function(value){search.value=value;search.dispatchEvent(new Event('input',{bubbles:true}));await wait();};
    var filter = async function(value){document.querySelector('[data-filter="'+value+'"]').click();await wait();};
    var result={};
    var filterButton=document.querySelector('[data-filter="text"]');
    var enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    var commits=window.__calls.commit.length;
    filterButton.dispatchEvent(enter);await wait();
    result.buttonEnterPreserved=!enter.defaultPrevented && window.__calls.commit.length===commits;
    await filter('text');result.textOnly=ids().length===3&&ids().every(id=>id.startsWith('text-'));
    await query('Chrome');result.sourceSearch=ids().join()==='text-1';
    search.focus();search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    result.inputArrowsPreserved=document.querySelector('.is-selected').dataset.id==='text-1';
    await query('不存在的关键词');result.emptySearch=!ids().length && document.getElementById('bar-empty').dataset.mode==='filtered' && pin.disabled;
    await query('');await filter('all');
    pin.click();await wait();result.pinSaved=pin.getAttribute('aria-pressed')==='true';
    await filter('favorite');result.favoriteFilter=ids().join()==='img-1';
    window.__pinThrow=true;pin.click();await wait();
    result.pinFailure=document.getElementById('bar-notice').textContent.includes('收藏失败') && ids().join()==='img-1' && pin.getAttribute('aria-pressed')==='true';
    window.__pinThrow=false;pin.click();await wait();
    result.unpinRemovesFavorite=!ids().length && document.getElementById('bar-empty-title').textContent==='还没有收藏内容';
    await query('未命中');window.__fireShown();await wait();
    result.reopenResets=ids().length===8 && search.value==='' && document.querySelector('[data-filter="all"]').getAttribute('aria-pressed')==='true';
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
    result.searchShortcut=document.activeElement===search;
    return result;
  })()`);
  for (const [name, passed] of Object.entries(toolbar)) check(name, passed);
  console.log('\n== 后台刷新保持卡片、焦点与浏览位置 ==');
  const stable = await evaluate(send, `(async function(){
    const wait=ms=>new Promise(r=>setTimeout(r,ms)), track=document.getElementById('bar-track');
    document.getElementById('bar-search').blur();
    document.querySelector('[data-filter="all"]').click();await wait(80);
    track.scrollTo({left:180,behavior:'instant'});
    const anchor=Array.from(track.children).find(c=>c.dataset.id==='img-2');
    anchor.focus({preventScroll:true});
    const oldLeft=anchor.getBoundingClientRect().left;
    window.__listDelay=250;window.__fireChanged();await wait(30);
    const pending=track.hidden===false && track.contains(anchor) && track.getAttribute('aria-busy')==='true';
    await wait(300);
    const sameNode=document.querySelector('[data-id="img-2"]')===anchor;
    const focus=document.activeElement===anchor;
    const samePosition=Math.abs(anchor.getBoundingClientRect().left-oldLeft)<2;
    window.__listThrow=true;window.__fireChanged();await wait(100);
    const retainedOnError=track.hidden===false && track.contains(anchor) && !document.getElementById('bar-refresh-retry').hidden;
    window.__listThrow=false;window.__listDelay=0;window.__addFirst();window.__fireChanged();await wait(100);
    const appendKeepsAnchor=document.querySelector('[data-id="img-2"]')===anchor && Math.abs(anchor.getBoundingClientRect().left-oldLeft)<2;
    const recovered=document.getElementById('bar-refresh-retry').hidden;
    return {pending,sameNode,focus,samePosition,retainedOnError,appendKeepsAnchor,recovered};
  })()`);
  for (const [name, passed] of Object.entries(stable)) check(name, passed);
  const lateRefresh = await evaluate(send, `(async function(){
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.__listDelay=220;window.__fireChanged();await wait(30);
    document.querySelector('[data-id="text-1"]').click();await wait(280);
    const selection=document.querySelector('.bar-card.is-selected')?.dataset.id==='text-1';
    const singleClickCommitted=window.__calls.commit.at(-1)?.itemId==='text-1';
    const hiddenAfterClick=window.__calls.hide>0;
    window.__fireShown();await wait(30);
    const search=document.getElementById('bar-search');search.value='微信';search.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(280);
    const query=search.value==='微信' && document.querySelectorAll('.bar-card').length===1 && document.querySelector('.bar-card').dataset.id==='img-1';
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));window.__listDelay=0;
    return {selectionDuringRefresh:selection,singleClickCommitted,hiddenAfterClick,queryDuringReopen:query};
  })()`);
  for (const [name, passed] of Object.entries(lateRefresh)) check(name, passed);
  const shared = await evaluate(send, `(async function(){
    const group=document.querySelector('[data-selection-group]');
    for(const filter of ['text','image','files','all']) group.querySelector('[data-filter="'+filter+'"]').click();
    await new Promise(r=>setTimeout(r,240));
    const active=group.querySelector('[aria-pressed="true"]'), indicator=group.querySelector('.shared-selection');
    const a=active.getBoundingClientRect(),b=indicator.getBoundingClientRect();
    const toast=document.createElement('div');
    window.SuiraUI.notify(toast,'已复制');window.SuiraUI.notify(toast,'已复制');
    return {oneIndicator:group.querySelectorAll('.shared-selection').length===1,
      rapidSelection:active.dataset.filter==='all' && Math.abs(a.left-b.left)<1 && Math.abs(a.width-b.width)<1,
      repeatedFeedback:toast.textContent==='已复制（2 次）' && toast.getAttribute('aria-live')==='polite'};
  })()`);
  for (const [name, passed] of Object.entries(shared)) check(name, passed);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await evaluate(send, `getComputedStyle(document.querySelector('.shared-selection')).transitionDuration==='0s'`);
  check('减少动态效果立即切换状态',reduced);
  const reducedScroll=await evaluate(send, `(function(){
    const original=Element.prototype.scrollIntoView;let behavior='';
    Element.prototype.scrollIntoView=function(options){behavior=options.behavior;};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    Element.prototype.scrollIntoView=original;return behavior==='instant';
  })()`);
  check('减少动态效果也关闭键盘平滑滚动',reducedScroll);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  for (const [width,height] of [[464,310],[720,210]]) {
    const compact = await runScenario(send, 'layout', width, height);
    check('小屏 '+width+'×'+height+' 不溢出且可浏览', noOverflow(compact.initial) && compact.initial.cardCount===8 && compact.initial.errors.length===0);
  }

  console.log('\n== 截图（临时目录，不污染仓库）==');
  runSequence += 1;
  await send('Emulation.setDeviceMetricsOverride', { ...CLIPBOARD_SHELF_SIZE, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', {
    url: fileUrl(path.join(TMP, '__bar_check.html')) + '?scenario=main&probe=0&run=shot-' + runSequence
  });
  await sleep(900);
  if (process.argv.includes('--preview')) {
    const thumbs = ['12-panel-actions.png','14-panel-toolbox.png','22-panel-actions-dark.png'].map(name =>
      'data:image/png;base64,' + fs.readFileSync(path.join(ROOT,'docs','screenshots',name)).toString('base64'));
    await evaluate(send, `Array.from(document.querySelectorAll('.card-thumb')).forEach((img,index)=>{img.src=${JSON.stringify(thumbs)}[index%3];})`);
    await sleep(150);
  }
  const shotInitial = await capture(send, 'clipboardbar-main.png');
  await evaluate(send, `(function(){
    for (var i = 0; i < 2; i += 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    }
    return true;
  })()`);
  await sleep(700);
  const shotSelected = await capture(send, 'clipboardbar-selected.png');
  for (const [label, file] of [['初始选中第 1 条', shotInitial], ['按 → 选中第 3 条', shotSelected]]) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    check('截图已生成：' + label, size > 2000, file);
    if (size > 2000) console.log('        ' + file);
  }
}

(async () => {
  buildFixtures();
  let chrome = null;
  try {
    chrome = await startChrome(path.join(TMP, 'profile'));
    await runChecks(chrome.send);
  } catch (error) {
    console.log('  FAIL  检查执行失败 -> ' + (error && error.message ? error.message : error));
    fail += 1;
  } finally {
    if (chrome) {
      try { chrome.ws.close(); } catch {}
      try { chrome.child.kill(); } catch {}
      await sleep(300);
    }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }
  finish();
})();
