'use strict';
/*
 * 浮引岛（文件中转）渲染层检查。
 *
 * 分两段：
 * 1. 静态约束：文件齐备、不访问网络、不用 eval、ID 对照、设计令牌、滚动条处理。
 * 2. 无头 Chrome 真实加载 src/island.html，注入 mock 的 window.suira.island，
 *    在 176×44（收起）与 520×148（展开）两个真实视口里断言：
 *    DOM 结构、两种尺寸都不溢出、24 个文件时卡片可读且滚动条隐藏、
 *    悬停 180ms 展开/重入取消/收起、拖入 → addPaths、拖出 → startDrag、
 *    点击打开、移除、策略切换、清空、空态、API 不可用时的可读提示。
 *
 * 用法：node tools/island-check.js
 * 截图：写到系统临时目录（不污染仓库），路径在结尾打印。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-island-'));
const SHOT_DIR = path.join(os.tmpdir(), 'suira-island-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const ICON_PATH = path.join(ROOT, 'assets', 'suira-icon.png');

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
const islandFiles = ['src/island.html', 'src/island.css', 'src/island.js', 'lib/island-model.js', 'tests/test-island.js'];
const missingFiles = islandFiles.filter((file) => !fs.existsSync(path.join(ROOT, file)));
check('浮引岛相关文件齐备', missingFiles.length === 0, '缺失: ' + missingFiles.join(', '));

const islandHtml = fs.readFileSync(path.join(ROOT, 'src', 'island.html'), 'utf8');
const islandCss = fs.readFileSync(path.join(ROOT, 'src', 'island.css'), 'utf8');
const islandJs = fs.readFileSync(path.join(ROOT, 'src', 'island.js'), 'utf8');

check('HTML 引用 island.css', islandHtml.includes('href="island.css"'));
check('HTML 引用 island.js', islandHtml.includes('src="island.js"'));

const remoteRefs = [islandHtml, islandCss, islandJs].filter((text) => /https?:\/\//i.test(text));
check('页面不引用任何网络资源', remoteRefs.length === 0);
const networkApis = islandJs.match(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
check('渲染层不使用网络 API', !networkApis, networkApis ? '出现: ' + networkApis[0] : '');
check('渲染层不用 eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(islandJs));

const htmlIds = new Set([...islandHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const jsIds = new Set([...islandJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
const missingIds = [...jsIds].filter((id) => !htmlIds.has(id));
check('island.js 引用的 ID 都存在于 HTML', missingIds.length === 0, '缺失: ' + missingIds.join(', '));

check('界面文案为中文（空态 / 策略 / 清空）', ['把文件拖进来暂存', '复制', '移动', '清空'].every((text) => islandHtml.includes(text)));
check('渲染层带 API 不可用提示', islandJs.includes('文件中转暂不可用') && islandJs.includes('暂不可用'));
check('悬停收起延迟为 180ms', /COLLAPSE_DELAY\s*=\s*180/.test(islandJs));
check('拖入走 pathForFile + addPaths', islandJs.includes('pathForFile') && islandJs.includes('addPaths'));
check('拖出走 startDrag', islandJs.includes('startDrag'));
check('订阅 state / expanded 广播', islandJs.includes('onState') && islandJs.includes('onExpanded'));

const themeCss = fs.readFileSync(path.join(ROOT, 'src', 'theme.css'), 'utf8');

check('HTML 引用共享主题层 theme.css', islandHtml.includes('href="theme.css"'));

const tokens = [
  /--slate-12:\s*#1c2024/i,
  /--blue-9:\s*#0090ff/i,
  /--text-1:\s*12px/i,
  /Segoe UI/,
  /--radius-panel:\s*24px/,
  /--gap:\s*var\(--space-2\)/,
  /--space-2:\s*8px/
];
check('设计令牌集中在 theme.css（品牌基色 + 语义层）', tokens.every((pattern) => pattern.test(themeCss)));
check('页面样式不再写死色值（只消费令牌）', !/#[0-9a-f]{6}\b/i.test(islandCss.replace(/rgba?\([^)]*\)/g, '')),
  (islandCss.match(/#[0-9a-f]{6}\b/i) || [''])[0]);
check('浮引岛自带 16px 圆角令牌', /--radius-island:\s*16px/.test(islandCss));
check('卡片网格隐藏滚动条', /scrollbar-width:\s*none/.test(islandCss) && islandCss.includes('::-webkit-scrollbar'));
check('根元素裁掉溢出', /\.island\s*\{[^}]*overflow:\s*hidden/.test(islandCss));
check('三态样式齐备（休眠 / 胶囊 / 卡片）', ['.island[data-mode="sleep"]', '.rail {', '.sheet {'].every((text) => islandCss.includes(text)));

const model = require(path.join(ROOT, 'lib', 'island-model.js'));
check('模型导出与主进程契约一致', ['MAX_ITEMS', 'classifyPath', 'normalizeShelfItem', 'addShelfItems', 'removeShelfItem', 'clearShelf', 'isShelfablePath', 'summarizeShelf']
  .every((name) => model[name] !== undefined));
check('MAX_ITEMS 为 24', model.MAX_ITEMS === 24);

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
  var scenario = params.get('scenario') || 'four';
  if (scenario === 'offline') return;
  var calls = window.__calls = {
    startDrag: [], openItem: [], removeItem: [], clear: 0, undo:0,
    setPolicy: [], addPaths: [], pathForFile: [], setExpanded: [], setMode: [], ping: 0
  };
  var seq = 0;
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function makeItem(name, filePath, kind){
    seq += 1;
    return { id: 'mock-' + seq, name: name, path: filePath, kind: kind, addedAt: 1730000000000 + seq };
  }
  var IMG_PATH = __IMG_PATH__;
  function initialItems(){
    if (scenario === 'empty') return [];
    if (scenario === 'full') {
      var kinds = ['image', 'document', 'archive', 'folder', 'file'];
      var list = [];
      for (var i = 0; i < 24; i += 1) {
        var kind = kinds[i % kinds.length];
        list.push(makeItem('文件 ' + (i + 1) + '.' + (kind === 'image' ? 'png' : 'txt'), 'C:/demo/shelf/file-' + (i + 1) + '.' + (kind === 'image' ? 'png' : 'txt'), kind));
      }
      return list;
    }
    if (scenario === 'collapsed' || scenario === 'hover' || scenario === 'state') {
      return [
        makeItem('季度报告.pdf', 'C:/demo/shelf/季度报告.pdf', 'document'),
        makeItem('屏幕截图.png', IMG_PATH, 'image')
      ];
    }
    return [
      makeItem('屏幕截图.png', IMG_PATH, 'image'),
      makeItem('第三季度产品评审会议纪要与后续行动项清单.pdf', 'C:/demo/shelf/第三季度产品评审会议纪要与后续行动项清单.pdf', 'document'),
      makeItem('素材包.zip', 'C:/demo/shelf/素材包.zip', 'archive'),
      makeItem('待整理素材', 'C:/demo/shelf/待整理素材/', 'folder')
    ];
  }
  // 岛的初始形态：默认休眠；hover 场景从休眠起步验证「悬停浮现胶囊」的节奏
  var initialMode = scenario === 'collapsed' ? 'rail' : 'sleep';
  var state = { items: initialItems(), policy: 'copy', expanded: false, mode: initialMode, maxItems: 24 };
  var undoStack = [];
  if (scenario === 'actions') state.items = state.items.slice(0, 2);
  var stateCallbacks = [];
  var expandedCallbacks = [];
  var modeCallbacks = [];
  function emitState(){
    var payload = clone(state);
    stateCallbacks.forEach(function(callback){ try { callback(payload); } catch (error) {} });
  }
  function emitExpanded(){
    expandedCallbacks.forEach(function(callback){ try { callback(state.expanded); } catch (error) {} });
  }
  function emitMode(){
    modeCallbacks.forEach(function(callback){ try { callback(state.mode); } catch (error) {} });
  }
  window.__pushMode = function(mode){ state.mode=mode; state.expanded=mode==='sheet'; emitMode(); emitExpanded(); };
  window.__pushState = function(next){
    if (next && Array.isArray(next.items)) state.items = next.items;
    if (next && (next.policy === 'copy' || next.policy === 'move')) state.policy = next.policy;
    emitState();
  };
  window.suira = window.suira || {};
  window.suira.island = {
    getState: function(){
      if (scenario === 'error') return Promise.reject(new Error('主进程暂存状态读取失败'));
      return Promise.resolve(clone(state));
    },
    addPaths: function(paths){
      calls.addPaths.push(clone(paths));
      (paths || []).forEach(function(filePath){
        if (!filePath || typeof filePath !== 'string') return;
        var name = filePath.split(/[\\\\/]/).pop() || filePath;
        var next = makeItem(name, filePath, 'file');
        next.id = 'added-' + seq;
        state.items.unshift(next);
      });
      if (state.items.length > state.maxItems) state.items = state.items.slice(0, state.maxItems);
      emitState();
      return Promise.resolve(clone(state));
    },
    pathForFile: function(file){
      var name = file && file.name ? file.name : '';
      calls.pathForFile.push(name);
      var map = window.__draggedMap || {};
      return map[name] || '';
    },
    removeItem: function(id){
      calls.removeItem.push(id);
      undoStack.push(clone(state.items));
      state.canUndo = true;
      state.items = state.items.filter(function(entry){ return entry.id !== id; });
      emitState();
      return Promise.resolve(clone(state));
    },
    clear: function(){
      calls.clear += 1;
      if (state.items.length) undoStack.push(clone(state.items));
      state.canUndo = undoStack.length > 0;
      state.items = [];
      emitState();
      return Promise.resolve(clone(state));
    },
    undo: function(){
      calls.undo += 1;
      state.items = undoStack.pop() || state.items;
      state.canUndo = undoStack.length > 0;
      emitState();
      return Promise.resolve(clone(state));
    },
    setPolicy: function(policy){
      calls.setPolicy.push(policy);
      if (policy === 'copy' || policy === 'move') state.policy = policy;
      emitState();
      return Promise.resolve(clone(state));
    },
    setExpanded: function(value){
      calls.setExpanded.push(Boolean(value));
      state.expanded = Boolean(value);
      emitExpanded();
      return Promise.resolve();
    },
    // 三态：主进程改窗口尺寸后回推最终形态
    setMode: function(mode){
      calls.setMode.push(mode);
      state.mode = mode;
      state.expanded = mode === 'sheet';
      emitMode();
      emitExpanded();
      return Promise.resolve({ ok: true, mode: mode });
    },
    ping: function(){ calls.ping += 1; },
    onMode: function(callback){
      if (typeof callback === 'function') modeCallbacks.push(callback);
      return function(){ modeCallbacks = modeCallbacks.filter(function(fn){ return fn !== callback; }); };
    },
    openItem: function(id){
      calls.openItem.push(id);
      if (window.__forceOpenError) return Promise.resolve({ ok: false, error: '文件已被移动或删除' });
      return Promise.resolve({ ok: true });
    },
    startDrag: function(id){ calls.startDrag.push(id); return Promise.resolve(true); },
    onState: function(callback){
      if (typeof callback === 'function') stateCallbacks.push(callback);
      return function(){ stateCallbacks = stateCallbacks.filter(function(fn){ return fn !== callback; }); };
    },
    onExpanded: function(callback){
      if (typeof callback === 'function') expandedCallbacks.push(callback);
      return function(){ expandedCallbacks = expandedCallbacks.filter(function(fn){ return fn !== callback; }); };
    }
  };
})();
`.replace('__IMG_PATH__', JSON.stringify(ICON_PATH));

const PROBE = `
(function(){
  var scenario = new URLSearchParams(location.search).get('scenario') || 'four';
  function sleep(ms){ return new Promise(function(resolve){ setTimeout(resolve, ms); }); }
  function metrics() {
    var documentElement = document.documentElement;
    var body = document.body;
    var island = document.getElementById('island');
    var rail = document.getElementById('rail');
    var sheet = document.getElementById('sheet');
    var shelf = document.getElementById('shelf');
    var wrap = shelf ? shelf.parentElement : null;
    var sheetRect = sheet && !sheet.hidden ? sheet.getBoundingClientRect() : null;
    var railRect = rail && !rail.hidden ? rail.getBoundingClientRect() : null;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.file-card'));
    var names = Array.prototype.slice.call(document.querySelectorAll('.file-name')).map(function(el){ return el.textContent; });
    var thumbs = Array.prototype.slice.call(document.querySelectorAll('.file-thumb')).map(function(img){ return !!(img.complete && img.naturalWidth > 0); });
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      docScrollW: documentElement.scrollWidth,
      docClientW: documentElement.clientWidth,
      docScrollH: documentElement.scrollHeight,
      docClientH: documentElement.clientHeight,
      bodyScrollW: body.scrollWidth,
      bodyScrollH: body.scrollHeight,
      expanded: island ? island.dataset.expanded : '',
      mode: island ? island.dataset.mode : '',
      railHidden: rail ? rail.hidden : null,
      sheetHidden: sheet ? sheet.hidden : null,
      railCount: document.getElementById('rail-count') ? document.getElementById('rail-count').textContent : '',
      railPolicy: document.getElementById('rail-policy') ? document.getElementById('rail-policy').textContent : '',
      railRect: railRect ? { w: Math.round(railRect.width), h: Math.round(railRect.height) } : null,
      railOverflow: rail ? Math.max(0, rail.scrollWidth - rail.clientWidth) : -1,
      sheetRect: sheetRect ? { w: Math.round(sheetRect.width), h: Math.round(sheetRect.height) } : null,
      sheetRadius: sheet ? getComputedStyle(sheet).borderRadius : '',
      sheetTop: sheetRect ? sheetRect.top : null,
      sheetLeft: sheetRect ? sheetRect.left : null,
      sheetShadow: sheet ? getComputedStyle(sheet).boxShadow : '',
      emptyBorder: document.getElementById('empty') ? getComputedStyle(document.getElementById('empty')).borderTopStyle : '',
      cards: cards.length,
      names: names,
      removeButtons: document.querySelectorAll('.file-remove').length,
      cardHeight: cards.length ? Math.round(cards[0].getBoundingClientRect().height) : 0,
      cardOverflow: cards.slice(0, 4).map(function(card){ return Math.max(0, card.scrollWidth - card.clientWidth); }),
      firstRowTops: cards.slice(0, 4).map(function(card){ return Math.round(card.getBoundingClientRect().top); }),
      footCount: document.getElementById('foot-count') ? document.getElementById('foot-count').textContent : '',
      clearDisabled: document.getElementById('clear') ? document.getElementById('clear').disabled : null,
      activePolicy: (document.querySelector('.policy-btn.is-active') || {}).id || '',
      emptyHidden: document.getElementById('empty') ? document.getElementById('empty').hidden : null,
      emptyMode: document.getElementById('empty') ? document.getElementById('empty').dataset.mode : '',
      emptyTitle: document.getElementById('empty-title') ? document.getElementById('empty-title').textContent : '',
      emptyHint: document.getElementById('empty-hint') ? document.getElementById('empty-hint').textContent : '',
      retryHidden: document.getElementById('retry') ? document.getElementById('retry').hidden : null,
      toastVisible: document.getElementById('toast') ? document.getElementById('toast').classList.contains('is-visible') : null,
      toastText: document.getElementById('toast') ? document.getElementById('toast').textContent : '',
      shelfScrollH: shelf ? shelf.scrollHeight : 0,
      shelfClientH: shelf ? shelf.clientHeight : 0,
      shelfScrollbarW: shelf ? Math.max(0, shelf.offsetWidth - shelf.clientWidth) : -1,
      shelfOverflowY: shelf ? getComputedStyle(shelf).overflowY : '',
      shelfScrollTop: shelf ? Math.round(shelf.scrollTop) : 0,
      scrollHint: wrap ? wrap.classList.contains('is-scrollable') : false,
      thumbLoaded: thumbs,
      calls: JSON.parse(JSON.stringify(window.__calls || {}))
    };
  }
  async function main(){
    var output = { scenario: scenario, errors: (window.__errs || []).slice() };
    var root = document.getElementById('island');
    function enter(){ root.dispatchEvent(new MouseEvent('mouseenter')); }
    function leave(){ root.dispatchEvent(new MouseEvent('mouseleave')); }
    // 模拟用户从工具箱/托盘显式打开，不靠普通悬停唤醒。
    async function openSheet(){
      await window.suira.island.setMode('sheet');
      enter();
    }

    await sleep(180);
    output.initial = metrics();

    if (scenario === 'collapsed') {
      output.after = metrics();
    } else if (scenario === 'offline') {
      enter();
      await sleep(120);
      output.afterHover = metrics();
      document.getElementById('rail').click();
      await sleep(80);
      output.afterClick = metrics();
    } else if (scenario === 'hover') {
      // 普通悬停/文字拖拽保持隐藏；只有 Files 拖入才展开。
      output.before = metrics();
      enter();
      await sleep(220);
      output.afterEnter = metrics();
      var textTransfer = new DataTransfer();
      textTransfer.setData('text/plain', '不是文件');
      root.dispatchEvent(new DragEvent('dragenter', {bubbles:true,cancelable:true,dataTransfer:textTransfer}));
      await sleep(60);
      output.afterText = metrics();
      var fileTransfer = new DataTransfer();
      fileTransfer.items.add(new File(['test'], 'test.txt', {type:'text/plain'}));
      root.dispatchEvent(new DragEvent('dragenter', {bubbles:true,cancelable:true,dataTransfer:fileTransfer}));
      await sleep(120);
      output.afterClick = metrics();
      root.dispatchEvent(new DragEvent('dragleave', {bubbles:true,cancelable:true,dataTransfer:fileTransfer}));
      await sleep(80);
      output.afterLeaveShort = metrics();
      await sleep(350);
      output.afterLeave = metrics();
      window.__pushMode('sleep');
      await sleep(80);
      output.afterSleepBroadcast = metrics();
      await openSheet();
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
      await sleep(40);
      output.afterEscape = metrics();
    } else if (scenario === 'empty') {
      openSheet();
      await sleep(160);
      output.expanded = metrics();
    } else if (scenario === 'error') {
      openSheet();
      await sleep(240);
      output.expanded = metrics();
      document.getElementById('retry').click();
      await sleep(160);
      output.afterRetry = metrics();
    } else if (scenario === 'four' || scenario === 'full') {
      openSheet();
      await sleep(200);
      output.expanded = metrics();
      if (scenario === 'full') {
        var shelf = document.getElementById('shelf');
        shelf.scrollTop = shelf.scrollHeight;
        await sleep(160);
        output.afterScroll = metrics();
        // 复位到顶部，截图与人工查看都从第一行开始
        shelf.scrollTop = 0;
        await sleep(80);
      }
    } else if (scenario === 'state') {
      openSheet();
      await sleep(160);
      output.beforePush = metrics();
      window.__pushState({
        items: [
          { id: 'push-1', name: '推送一.pdf', path: 'C:/demo/push/一.pdf', kind: 'document', addedAt: 1 },
          { id: 'push-2', name: '推送二.png', path: 'C:/demo/push/二.png', kind: 'image', addedAt: 2 },
          { id: 'push-3', name: '推送三.zip', path: 'C:/demo/push/三.zip', kind: 'archive', addedAt: 3 },
          { id: 'push-4', name: '推送四', path: 'C:/demo/push/四/', kind: 'folder', addedAt: 4 },
          { id: 'push-5', name: '推送五.txt', path: 'C:/demo/push/五.txt', kind: 'file', addedAt: 5 }
        ],
        policy: 'move'
      });
      await sleep(120);
      output.afterPush = metrics();
    } else if (scenario === 'actions') {
      openSheet();
      await sleep(160);
      output.afterExpand = metrics();

      document.querySelector('.file-open').click();
      await sleep(60);
      output.openCalls = (window.__calls.openItem || []).slice();

      // 主进程对「文件已被移动或删除」是 resolve 一个 ok:false 的状态，界面要有提示
      window.__forceOpenError = true;
      document.querySelectorAll('.file-open')[1].click();
      await sleep(80);
      output.openErrorToast = metrics();
      window.__forceOpenError = false;

      document.querySelector('.file-remove').click();
      await sleep(100);
      output.afterRemove = metrics();

      document.getElementById('policy-move').click();
      await sleep(100);
      output.afterPolicy = metrics();

      var card = document.querySelector('.file-card');
      var dragStart = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      card.dispatchEvent(dragStart);
      // startDrag 必须在 dragstart 里同步发起（主进程要在鼠标仍按下时调 startDrag），
      // 所以这里不等 sleep 就取一次调用记录。
      output.dragSyncCalls = (window.__calls.startDrag || []).slice();
      await sleep(80);
      output.dragPrevented = dragStart.defaultPrevented;
      output.dragCalls = (window.__calls.startDrag || []).slice();

      window.__draggedMap = { '拖入文档.pdf': 'C:/demo/dropped/拖入文档.pdf' };
      var dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['demo'], '拖入文档.pdf', { type: 'application/pdf' }));
      var dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer });
      root.dispatchEvent(dragOver);
      await sleep(60);
      output.overPrevented = dragOver.defaultPrevented;
      var drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer });
      root.dispatchEvent(drop);
      await sleep(160);
      output.addPathsCalls = (window.__calls.addPaths || []).slice();
      output.afterDrop = metrics();

      document.getElementById('clear').click();
      await sleep(120);
      output.afterClear = metrics();
      document.getElementById('undo').click();
      await sleep(80);
      output.afterUndo = metrics();
    }

    window.__islandResult = output;
    var pre = document.createElement('pre');
    pre.textContent = 'I:' + JSON.stringify(output);
    document.body.appendChild(pre);
  }
  main().catch(function(error){
    window.__islandResult = { scenario: scenario, fatal: String((error && error.stack) || error), errors: (window.__errs || []).slice() };
    var pre = document.createElement('pre');
    pre.textContent = 'I:' + JSON.stringify(window.__islandResult);
    document.body.appendChild(pre);
  });
})();
`;

function buildFixtures() {
  fs.writeFileSync(path.join(TMP, '__island_mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, '__island_probe.js'), PROBE, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'src', 'theme.css'), path.join(TMP, 'theme.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'island.css'), path.join(TMP, 'island.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'island.js'), path.join(TMP, 'island.js'));
  const page = islandHtml
    .replace('<link rel="stylesheet" href="island.css">',
      '<link rel="stylesheet" href="island.css"><style>html,body{background:linear-gradient(135deg,#778aa3,#4c5b70)}</style>')
    .replace('<script src="island.js"></script>', [
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e.error));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String((e.reason&&e.reason.message)||e.reason));});</script>',
      '<script src="__island_mock.js"></script>',
      '<script src="island.js"></script>',
      '<script src="__island_probe.js"></script>'
    ].join('\n'));
  fs.writeFileSync(path.join(TMP, '__island_check.html'), page, 'utf8');
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
  // 这样不会和 tools/shortcut-check.js 等固定端口（9337）冲突，
  // 并发跑测试时也不会互相劫持到对方的浏览器实例。
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

async function waitForResult(send, token, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluate(send, `(function(){
        if (location.search.indexOf(${JSON.stringify(token)}) < 0) return '';
        return window.__islandResult ? JSON.stringify(window.__islandResult) : '';
      })()`);
      if (value) return JSON.parse(value);
    } catch { /* 页面切换中 */ }
    await sleep(100);
  }
  throw new Error('等待页面探针超时：' + token);
}

async function runScenario(send, scenario, width, height, scaleFactor = 1) {
  runSequence += 1;
  const token = 'run-' + runSequence;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scaleFactor, mobile: false });
  // 测试不依赖本机系统主题：显式指定浅色，否则深色系统上截出来的图会变样
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', {
    url: fileUrl(path.join(TMP, '__island_check.html')) + '?scenario=' + encodeURIComponent(scenario) + '&run=' + token
  });
  await sleep(200);
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
  console.log('\n== 收起态 176×44 ==');
  const collapsed = await runScenario(send, 'collapsed', 200, 68);
  check('视口为 200×68（胶囊 176×44 + 12px 阴影留白）', collapsed.initial.innerW === 200 && collapsed.initial.innerH === 68,
    collapsed.initial.innerW + '×' + collapsed.initial.innerH);
  check('旧 rail 快照不能恢复常驻入口', collapsed.after.railHidden === true && collapsed.after.sheetHidden === true);
  check('休眠时没有可见胶囊尺寸', collapsed.after.railRect === null);
  check('细条显示文件数与策略', collapsed.after.railCount === '2' && collapsed.after.railPolicy === '复制',
    collapsed.after.railCount + ' / ' + collapsed.after.railPolicy);
  check('细条内容不溢出', collapsed.after.railOverflow === 0, 'overflow=' + collapsed.after.railOverflow);
  check('收起态无页面滚动条 / 溢出', noOverflow(collapsed.after),
    JSON.stringify({ doc: [collapsed.after.docScrollW, collapsed.after.docClientW, collapsed.after.docScrollH, collapsed.after.docClientH] }));
  check('收起态无脚本错误', collapsed.errors.length === 0, JSON.stringify(collapsed.errors));

  console.log('\n== 展开态 520×148（4 个文件）==');
  const four = await runScenario(send, 'four', 520, 148);
  const fourView = four.expanded;
  check('窗口与托盘同尺寸，不再留外圈底板', four.initial.innerW === 520 && four.initial.innerH === 148,
    four.initial.innerW + '×' + four.initial.innerH);
  check('展开态隐藏细条、显示卡片区', fourView.expanded === 'true' && fourView.railHidden === true && fourView.sheetHidden === false);
  check('展开卡片尺寸铺满窗口', fourView.sheetRect && fourView.sheetRect.w === 520 && fourView.sheetRect.h === 148,
    JSON.stringify(fourView.sheetRect));
  check('渲染 4 张文件卡片', fourView.cards === 4, 'cards=' + fourView.cards);
  check('卡片显示文件名', ['屏幕截图.png', '第三季度产品评审会议纪要与后续行动项清单.pdf', '素材包.zip', '待整理素材']
    .every((name) => fourView.names.includes(name)), JSON.stringify(fourView.names));
  check('每张卡片都有移除按钮', fourView.removeButtons === 4, 'removeButtons=' + fourView.removeButtons);
  check('图片卡片渲染出真实缩略图', fourView.thumbLoaded.length === 1 && fourView.thumbLoaded[0] === true,
    JSON.stringify({ thumbs: fourView.thumbLoaded.length, loaded: fourView.thumbLoaded[0] }));
  check('4 张卡片单行排列（4 列网格）', new Set(fourView.firstRowTops).size === 1, JSON.stringify(fourView.firstRowTops));
  check('超长文件名被截断且不撑破卡片', fourView.names.some((name) => name.length > 20)
    && fourView.cardOverflow.every((value) => value === 0), JSON.stringify(fourView.cardOverflow));
  check('卡片高度 42px、内容不溢出', fourView.cardHeight === 42 && fourView.cardOverflow.every((value) => value === 0),
    'height=' + fourView.cardHeight + ' overflow=' + JSON.stringify(fourView.cardOverflow));
  check('底部显示数量（暂存 4 / 24 个）', fourView.footCount === '暂存 4 / 24 个', fourView.footCount);
  check('清空按钮在有内容时可用', fourView.clearDisabled === false);
  check('当前策略标记为「复制」', fourView.activePolicy === 'policy-copy', fourView.activePolicy);
  check('展开态无页面滚动条 / 溢出', noOverflow(fourView), JSON.stringify(fourView.docScrollW + '/' + fourView.docClientW));
  check('4 个文件时不需要内部滚动', fourView.shelfScrollH <= fourView.shelfClientH && fourView.scrollHint === false,
    fourView.shelfScrollH + ' / ' + fourView.shelfClientH);
  check('顶部平齐贴边、底部圆角收口', fourView.sheetRadius === '0px 0px 16px 16px', fourView.sheetRadius);
  check('托盘紧贴窗口上沿，没有悬浮留白和厚阴影', fourView.sheetTop === 0 && fourView.sheetLeft === 0 && fourView.sheetShadow === 'none');
  check('展开态无脚本错误', four.errors.length === 0, JSON.stringify(four.errors));

  console.log('\n== 展开态 520×148（24 个文件，满额）==');
  const full = await runScenario(send, 'full', 520, 148);
  const fullView = full.expanded;
  check('24 张卡片全部渲染', fullView.cards === 24, 'cards=' + fullView.cards);
  check('底部显示 24 / 24', fullView.footCount === '暂存 24 / 24 个', fullView.footCount);
  check('满额时无页面滚动条 / 溢出', noOverflow(fullView));
  check('满额时网格内部可滚动', fullView.shelfScrollH > fullView.shelfClientH,
    fullView.shelfScrollH + ' > ' + fullView.shelfClientH);
  check('卡片区确实使用内部滚动（overflow-y: auto）', fullView.shelfOverflowY === 'auto', fullView.shelfOverflowY);
  check('内部滚动不占滚动条宽度', fullView.shelfScrollbarW === 0, 'scrollbarW=' + fullView.shelfScrollbarW);
  check('可滚动时显示渐隐提示', fullView.scrollHint === true);
  check('可以滚到列表底部', full.afterScroll.shelfScrollTop > 0, 'scrollTop=' + full.afterScroll.shelfScrollTop);
  check('滚到底部后仍无页面级滚动条', noOverflow(full.afterScroll));
  check('滚到底部后渐隐提示消失', full.afterScroll.scrollHint === false);
  check('24 个卡片仍保持 42px 可读高度', fullView.cardHeight === 42, 'height=' + fullView.cardHeight);
  check('24 个文件时无脚本错误', full.errors.length === 0, JSON.stringify(full.errors));

  console.log('\n== 空态 ==');
  const empty = await runScenario(send, 'empty', 440, 108);
  const emptyView = empty.expanded;
  check('空态无卡片', emptyView.cards === 0);
  check('空态显示拖入提示', emptyView.emptyHidden === false && emptyView.emptyMode === 'empty' && emptyView.emptyTitle === '把文件拖进来暂存',
    emptyView.emptyMode + ' / ' + emptyView.emptyTitle);
  check('空态提示说明来源', emptyView.emptyHint.includes('资源管理器'), emptyView.emptyHint);
  check('空态不显示重试按钮', emptyView.retryHidden === true);
  check('空态清空按钮禁用', emptyView.clearDisabled === true);
  check('空态无页面溢出', noOverflow(emptyView));
  check('空态接收区紧凑，无大虚线框', emptyView.innerW === 440 && emptyView.innerH === 108 && emptyView.emptyBorder === 'none');

  console.log('\n== API 不可用 ==');
  const offline = await runScenario(send, 'offline', 200, 68);
  check('不可用时仍保持隐藏，不在顶部常驻离线条', offline.afterHover.mode === 'sleep' && offline.afterHover.railHidden === true);
  check('不可用时不假装展开', offline.afterHover.expanded === 'false' && offline.afterHover.sheetHidden === true);
  check('点击细条给出可读提示（不是没反应）',
    offline.afterClick.toastVisible === true && offline.afterClick.toastText.includes('未就绪'),
    JSON.stringify(offline.afterClick.toastText));
  check('不可用态无脚本错误', offline.errors.length === 0, JSON.stringify(offline.errors));
  check('不可用态无页面溢出', noOverflow(offline.afterClick));

  console.log('\n== 读取失败（有接口但 getState 拒绝）==');
  const errored = await runScenario(send, 'error', 440, 108);
  const errorView = errored.expanded;
  check('读取失败时仍可展开', errorView.expanded === 'true');
  check('读取失败显示可读错误', errorView.emptyMode === 'error' && errorView.emptyTitle === '暂时读不到暂存内容',
    errorView.emptyMode + ' / ' + errorView.emptyTitle);
  check('读取失败提供重试按钮', errorView.retryHidden === false);
  check('重试后仍保持可读错误（不白屏）', errored.afterRetry.emptyTitle === '暂时读不到暂存内容');
  check('读取失败无未捕获错误', errored.errors.length === 0, JSON.stringify(errored.errors));

  console.log('\n== 隐藏式：普通悬停不显示 → 文件拖近才展开 → 离开回收 ==');
  const hover = await runScenario(send, 'hover', 544, 172);
  check('初始为休眠态：细条与卡片都不显示', hover.before.mode === 'sleep'
    && hover.before.railHidden === true && hover.before.sheetHidden === true,
    hover.before.mode + ' / rail:' + hover.before.railHidden + ' / sheet:' + hover.before.sheetHidden);
  check('普通悬停不显示胶囊或卡片', hover.afterEnter.mode === 'sleep'
    && hover.afterEnter.railHidden === true && hover.afterEnter.sheetHidden === true,
    hover.afterEnter.mode);
  check('拖拽文字不会唤醒文件中转', hover.afterText.mode === 'sleep');
  check('文件拖入时展开成暂存卡片', hover.afterClick.mode === 'sheet' && hover.afterClick.sheetHidden === false,
    hover.afterClick.mode);
  check('指针刚离开时卡片仍保留（留出移动到卡片的时间）', hover.afterLeaveShort.mode === 'sheet',
    hover.afterLeaveShort.mode);
  check('离开超过回收延迟后自动回到休眠', hover.afterLeave.mode === 'sleep', hover.afterLeave.mode);
  const modes = hover.afterLeave.calls.setMode || [];
  check('只请求 sheet / sleep，不留下胶囊', modes.includes('sheet') && modes.includes('sleep') && !modes.includes('rail'),
    JSON.stringify(modes));
  check('mode=sleep 后旧 expanded=false 广播不能把胶囊重新显示', hover.afterSleepBroadcast.mode === 'sleep' && hover.afterSleepBroadcast.railHidden === true);
  check('Esc 一次就完全隐藏，不停在胶囊态', hover.afterEscape.mode === 'sleep');

  console.log('\n== 主进程广播（island:state）==');
  const pushed = await runScenario(send, 'state', 544, 172);
  check('广播前渲染 2 张卡片', pushed.beforePush.cards === 2, 'cards=' + pushed.beforePush.cards);
  check('收到广播后重绘为 5 张卡片', pushed.afterPush.cards === 5, 'cards=' + pushed.afterPush.cards);
  check('收到广播后策略同步为「移动」', pushed.afterPush.railPolicy === '移动' && pushed.afterPush.activePolicy === 'policy-move',
    pushed.afterPush.activePolicy);

  console.log('\n== 用户操作：打开 / 移除 / 策略 / 拖出 / 拖入 / 清空 ==');
  const actions = await runScenario(send, 'actions', 544, 172);
  check('展开后调用 setMode(sheet)', actions.afterExpand.calls.setMode.includes('sheet'),
    JSON.stringify(actions.afterExpand.calls.setMode));
  check('点击卡片调用 openItem', actions.openCalls.length === 1, JSON.stringify(actions.openCalls));
  check('openItem 返回 ok:false 时给出可读提示（不是没反应）',
    actions.openErrorToast.toastVisible === true && actions.openErrorToast.toastText.includes('移动或删除'),
    JSON.stringify(actions.openErrorToast.toastText));
  check('点击移除调用 removeItem 并从界面移除', actions.afterRemove.cards === 1
    && actions.afterRemove.calls.removeItem.length === 1,
    'cards=' + actions.afterRemove.cards);
  check('切换策略调用 setPolicy 并更新标记', actions.afterPolicy.calls.setPolicy.includes('move')
    && actions.afterPolicy.activePolicy === 'policy-move' && actions.afterPolicy.railPolicy === '移动',
    actions.afterPolicy.activePolicy + ' / ' + actions.afterPolicy.railPolicy);
  check('拖出取消 HTML5 拖拽并调用 startDrag', actions.dragPrevented === true && actions.dragCalls.length === 1,
    JSON.stringify(actions.dragCalls));
  check('startDrag 在 dragstart 内同步发起（不推迟到 await 之后）', actions.dragSyncCalls.length === 1,
    JSON.stringify(actions.dragSyncCalls));
  check('dragover 被接受（允许放置）', actions.overPrevented === true);
  check('拖入经 pathForFile 拿到路径并调用 addPaths', actions.addPathsCalls.length === 1
    && actions.addPathsCalls[0][0] === 'C:/demo/dropped/拖入文档.pdf',
    JSON.stringify(actions.addPathsCalls));
  check('拖入后卡片数增加且给出提示', actions.afterDrop.cards === 2
    && actions.afterDrop.toastVisible === true && actions.afterDrop.toastText.includes('已暂存'),
    'cards=' + actions.afterDrop.cards + ' toast=' + actions.afterDrop.toastText);
  check('清空调用 clear 并回到空态', actions.afterClear.calls.clear === 1
    && actions.afterClear.cards === 0 && actions.afterClear.emptyHidden === false,
    'cards=' + actions.afterClear.cards);
  check('点击撤销找回清空前的文件卡片', actions.afterUndo.cards === 2 && actions.afterUndo.calls.undo === 1);
  check('操作过程无页面溢出', noOverflow(actions.afterClear));
  check('操作过程无脚本错误', actions.errors.length === 0, JSON.stringify(actions.errors));

  await runScenario(send, 'four', 520, 148);
  for (const value of ['reduce', 'no-preference']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    const plain = await evaluate(send, `(()=>{const sheet=document.querySelector('.sheet');return getComputedStyle(sheet).opacity==='1'&&sheet.getAnimations().length===0;})()`);
    check('已展开的浮引岛不重播入场：' + value, plain === true);
  }

  console.log('\n== 截图（临时目录，不污染仓库）==');
  await runScenario(send, 'collapsed', 200, 68, 2);
  const shotCollapsed = await capture(send, 'island-collapsed.png');
  await runScenario(send, 'four', 520, 148, 2);
  const shotExpanded = await capture(send, 'island-expanded.png');
  await runScenario(send, 'full', 520, 148, 2);
  const shotFull = await capture(send, 'island-full.png');
  for (const [label, file] of [['收起态', shotCollapsed], ['展开态', shotExpanded], ['满额 24 个', shotFull]]) {
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
