'use strict';
/*
 * 用无头 Chrome 验证截图覆盖层在真实 DOM 里的行为：
 *
 * 1. 工具栏时序：拖动框选期间只显示顶部提示条，松开形成有效选区后才出现编辑工具栏；
 *    重新开始框选时旧选区与工具栏立刻消失。
 * 2. 流畅度：pointermove 合帧（同帧多次移动只应用一次）、主画布不再用软件 canvas、
 *    拖动路径不再逐帧读布局。
 * 3. 预热覆盖层契约：页面加载完成后不自动取画面；每次 capture:shown 先 reset 再加载，
 *    第二次唤起时选区 / 工具栏 / 标注 / 面板全部清空。
 * 4. 历史缺陷回归：Ctrl+A 焦点隔离、查看原图尺寸、工具栏按钮绑定、完成提交。
 *
 * 用法：node tools/overlay-check.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'tools', '.panel-shot');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(TMP, { recursive: true });

// 覆盖层需要一份「屏幕画面」：用 canvas 生成纯色 PNG 当作 payload.dataUrl，
// 这样 compositeSelection 能真的裁出一张图。
// capture.onShown 对应主进程的 capture:shown：fixture 用 __fireShown() 主动唤起。
const MOCK = `
(function(){
  var shownCallbacks = [];
  var releaseCallbacks = [];
  function makeScreen(w, h, color) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    x.fillStyle = '#123456';
    x.fillRect(20, 20, 120, 60);
    return c.toDataURL('image/png');
  }
  var screenData = makeScreen(800, 600, '#e8edf5');
  window.__screenData = screenData;
  window.suira = {
    capture: {
      getData: async function(){
        return {
          dataUrl: screenData,
          tiles: null,
          size: { width: 800, height: 600 },
          bounds: { x:0, y:0, width:800, height:600 },
          scaleFactor: 1,
          intent: '',
          displays: [{ id:1, bounds:{x:0,y:0,width:800,height:600}, scaleFactor:1 }]
        };
      },
      finish: async function(p){ window.__finish = p; return { ok:true, item:{id:'img1'}, output:{ id:'txt1', text:'识别出的文字' } }; },
      cancel: async function(){ window.__canceled = true; return { ok:true }; },
      // 预热覆盖层契约：主进程每次唤起截图前发 capture:shown
      onShown: function(cb){
        shownCallbacks.push(cb);
        return function(){
          var i = shownCallbacks.indexOf(cb);
          if (i >= 0) shownCallbacks.splice(i, 1);
        };
      },
      // 隐藏即释放契约：主进程 hide 时发 capture:release，渲染层要还掉画面/画布
      onRelease: function(cb){
        releaseCallbacks.push(cb);
        return function(){
          var i = releaseCallbacks.indexOf(cb);
          if (i >= 0) releaseCallbacks.splice(i, 1);
        };
      }
    },
    content: {
      addText: async function(p){ window.__added = p; return { ok:true, item:{ id:'txt2' } }; },
      list: async function(){ return []; }
    },
    actions: { run: async function(){ return { ok:true }; } },
    quick: { hide: async function(){ return {ok:true}; } }
  };
  window.__shownCount = 0;
  window.__fireShown = function(){
    window.__shownCount += 1;
    var list = shownCallbacks.slice();
    for (var i = 0; i < list.length; i += 1) list[i]();
  };
  window.__releaseCount = 0;
  window.__fireRelease = function(){
    window.__releaseCount += 1;
    var list = releaseCallbacks.slice();
    for (var i = 0; i < list.length; i += 1) list[i]();
  };
})();
`;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({ ws, send }));
    ws.addEventListener('error', () => reject(new Error('WS error')));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
        else entry.resolve(msg.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const mid = ++id;
        pending.set(mid, { resolve: r, reject: j });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); j(new Error('timeout ' + method)); } }, 15000);
      });
    }
  });
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
  return r.result ? r.result.value : undefined;
}

/** 轮询页面条件，避免用固定 sleep 猜加载耗时 */
async function waitFor(send, expression, timeoutMs = 5000, interval = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await evaluate(send, `Boolean(${expression})`);
      if (ok) return true;
    } catch { /* 页面还在导航 */ }
    await sleep(interval);
  }
  return false;
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  const overlaySource = fs.readFileSync(path.join(ROOT, 'src', 'overlay.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'overlay.html'), 'utf8')
    .replace('<script src="overlay.js"></script>', '<script src="__mock.js"></script><script src="overlay.js"></script>');
  fs.writeFileSync(path.join(TMP, '__mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, 'overlay.html'), html, 'utf8');
  for (const asset of ['theme.css', 'ui-motion.css', 'ui-motion.js', 'overlay.css', 'overlay.js']) {
    fs.copyFileSync(path.join(ROOT, 'src', asset), path.join(TMP, asset));
  }

  const userDataDir = path.join(TMP, 'profile-overlay');
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=800,600', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    let targets = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await res.json();
        if (targets.length) break;
      } catch { /* 端口未就绪 */ }
      await sleep(250);
    }
    if (!targets || !targets.length) throw new Error('Chrome 调试端口未就绪');
    const page = targets.find((t) => t.type === 'page');
    const { ws, send } = await connect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file:///' + path.join(TMP, 'overlay.html').replace(/\\/g, '/') });

    console.log('\n== 预热契约：页面就绪后等待 capture:shown ==');
    const ready = await waitFor(send, `typeof window.__fireShown === 'function' && !!window.__lastCapturePerf`, 5000);
    check('mock 提供 capture.onShown，覆盖层完成引导', ready);
    const beforeShown = await evaluate(send, `JSON.stringify({
      shownAt: window.__lastCapturePerf && window.__lastCapturePerf.shownAt,
      loadingHidden: document.getElementById('loading-state').hidden,
      dockHidden: document.getElementById('tool-dock').hidden
    })`);
    const bs = JSON.parse(beforeShown);
    check('页面加载完成后不自动取画面（等 shown 事件）', bs.shownAt === 0, beforeShown);

    await evaluate(send, `window.__fireShown(), 'ok'`);
    const loadedOk = await waitFor(send, `document.getElementById('loading-state').hidden === true`, 6000);
    check('收到 shown 后画面已加载', loadedOk);
    const loaded = await evaluate(send, `JSON.stringify({
      shownCount: window.__shownCount,
      perf: window.__lastCapturePerf
    })`);
    const ld = JSON.parse(loaded);
    check('第一次 shown 被处理且埋点已写入 shownAt/imageReadyAt',
      ld.shownCount === 1 && ld.perf.shownAt > 0 && ld.perf.imageReadyAt > 0, loaded);

    console.log('\n== 任务 A：工具栏要框选完（松开）才出现 ==');
    const initial = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      selectionHidden: document.getElementById('selection').hidden,
      hintHidden: document.getElementById('capture-hint').classList.contains('is-hidden')
    })`);
    const init = JSON.parse(initial);
    check('初始没有选区时 #tool-dock 隐藏', init.dockHidden === true, initial);
    check('初始选区框隐藏', init.selectionHidden === true, initial);
    check('初始只显示顶部提示条', init.hintHidden === false, initial);

    // 开始一次框选：按下 + 同一任务里连续 6 次 pointermove（顺带验证合帧），先不松手
    await evaluate(send, `(function(){
      window.__perfStart = JSON.parse(JSON.stringify(window.__lastCapturePerf));
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:100, clientY:100, bubbles:true, pointerId:11}));
      for (var i = 1; i <= 6; i += 1) {
        root.dispatchEvent(new PointerEvent('pointermove', {clientX:100 + i * 50, clientY:100 + i * 25, bubbles:true, pointerId:11}));
      }
    })(), 'ok'`);
    await sleep(150);
    const dragging = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      selectionHidden: document.getElementById('selection').hidden,
      hintHidden: document.getElementById('capture-hint').classList.contains('is-hidden'),
      perf: window.__lastCapturePerf,
      prev: window.__perfStart
    })`);
    const dr = JSON.parse(dragging);
    check('拖动中 #tool-dock 仍然隐藏（框选完才出现）', dr.dockHidden === true, dragging);
    check('拖动中橡皮筋选区框可见', dr.selectionHidden === false, dragging);
    check('拖动中顶部提示条保持显示', dr.hintHidden === false, dragging);
    check('pointermove 合帧：6 次移动只应用 1 帧',
      dr.perf.pointerMoves - dr.prev.pointerMoves === 6 && dr.perf.framesApplied - dr.prev.framesApplied === 1,
      'moves=' + (dr.perf.pointerMoves - dr.prev.pointerMoves) + ' frames=' + (dr.perf.framesApplied - dr.prev.framesApplied));
    check('首次 pointerdown 后写入 firstPointerMs', dr.perf.firstPointerMs > 0, JSON.stringify(dr.perf));

    await evaluate(send, `(function(){
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:400, clientY:250, bubbles:true, pointerId:11}));
    })(), 'ok'`);
    await sleep(150);
    const released = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      dockLeft: parseInt(document.getElementById('tool-dock').style.left, 10),
      dockTop: parseInt(document.getElementById('tool-dock').style.top, 10),
      selW: Math.round(parseFloat(document.getElementById('selection').style.width)),
      selH: Math.round(parseFloat(document.getElementById('selection').style.height)),
      hintHidden: document.getElementById('capture-hint').classList.contains('is-hidden')
    })`);
    const rl = JSON.parse(released);
    check('松开后 #tool-dock 出现', rl.dockHidden === false, released);
    check('合帧后选区尺寸取最后一帧坐标', rl.selW === 300 && rl.selH === 150, released);
    check('工具栏定位在选区下方（有 left/top，且在视口内）',
      Number.isFinite(rl.dockLeft) && Number.isFinite(rl.dockTop) && rl.dockTop > 250 && rl.dockTop < 600 && rl.dockLeft >= 0,
      released);
    check('松开后顶部提示条收起', rl.hintHidden === true, released);

    // 留存纯测试画面的单排工具栏，检查浅色与深色下的紧凑布局。
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(80);
      const layout = await evaluate(send, `(() => {
        const dock=document.getElementById('tool-dock'), r=dock.getBoundingClientRect();
        const buttons=[...dock.querySelectorAll('[data-shortcut]')];
        const centers=buttons.map(button=>{const b=button.getBoundingClientRect();return b.y+b.height/2;});
        return {x:r.x,y:r.y,width:r.width,height:r.height,
          singleRow:Math.max(...centers)-Math.min(...centers)<1,
          hasKeyLabels:!!dock.querySelector('kbd,small'),
          inViewport:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};
      })()`);
      check(scheme+' 工具栏单排、无字母行且在视口内',layout.singleRow&&!layout.hasKeyLabels&&layout.inViewport&&layout.height<=48,JSON.stringify(layout));
      const shot = await send('Page.captureScreenshot', {format:'png',fromSurface:true,
        clip:{x:Math.max(0,layout.x-8),y:Math.max(0,layout.y-8),width:layout.width+16,height:layout.height+16,scale:2}});
      fs.writeFileSync(path.join(ROOT,'docs','screenshots','27-overlay-toolbar-'+scheme+'.png'),Buffer.from(shot.data,'base64'));
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    // 重新开始新框选：按下瞬间旧选区与工具栏都要消失
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="select"]').click();
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:200, clientY:400, bubbles:true, pointerId:12}));
    })(), 'ok'`);
    await sleep(120);
    const restarted = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      selectionHidden: document.getElementById('selection').hidden,
      hintHidden: document.getElementById('capture-hint').classList.contains('is-hidden')
    })`);
    const rs = JSON.parse(restarted);
    check('重新开始新框选时工具栏立即隐藏', rs.dockHidden === true, restarted);
    check('重新开始新框选时旧选区立即消失', rs.selectionHidden === true, restarted);
    check('重新开始新框选时提示条恢复', rs.hintHidden === false, restarted);

    // 完成这次新框选，进入「已有选区」状态
    await evaluate(send, `(function(){
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointermove', {clientX:360, clientY:470, bubbles:true, pointerId:12}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:360, clientY:470, bubbles:true, pointerId:12}));
    })(), 'ok'`);
    await sleep(150);
    const again = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      selW: Math.round(parseFloat(document.getElementById('selection').style.width))
    })`);
    check('再次框选松手后工具栏重新出现', JSON.parse(again).dockHidden === false, again);

    // 已有选区上移动 / 缩放：工具栏保持可见并跟随
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="select"]').click();
      var root = document.getElementById('capture-root');
      var sel = document.getElementById('selection');
      var before = { left: parseInt(document.getElementById('tool-dock').style.left, 10), top: parseInt(document.getElementById('tool-dock').style.top, 10) };
      window.__dockBefore = before;
      // 用选区元素本身作为 target，模拟「按住选区内部拖动」
      sel.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:280, clientY:430, bubbles:true, pointerId:13}));
      root.dispatchEvent(new PointerEvent('pointermove', {clientX:330, clientY:450, bubbles:true, pointerId:13}));
    })(), 'ok'`);
    await sleep(150);
    const moving = await evaluate(send, `JSON.stringify({
      dockHidden: document.getElementById('tool-dock').hidden,
      before: window.__dockBefore,
      top: parseInt(document.getElementById('tool-dock').style.top, 10),
      selTop: parseFloat(document.getElementById('selection').style.top)
    })`);
    const mv = JSON.parse(moving);
    check('移动已有选区时工具栏保持可见', mv.dockHidden === false, moving);
    check('移动已有选区时工具栏跟随（top 变化）', Number.isFinite(mv.top) && mv.top !== mv.before.top, moving);
    await evaluate(send, `(function(){
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:330, clientY:450, bubbles:true, pointerId:13}));
    })(), 'ok'`);
    await sleep(120);
    const movedEnd = await evaluate(send, `JSON.stringify({ dockHidden: document.getElementById('tool-dock').hidden })`);
    check('移动结束后工具栏仍在', JSON.parse(movedEnd).dockHidden === false, movedEnd);

    // 幽灵箭头回归：松手时提交重绘若读到残缺的进行中形状会抛错，
    // state.drawing 残留后鼠标一动就拖出一条从旧起点跟随光标的箭头，
    // 下一次选区外松手还会被误提交进截图。这里锁定「一次拖拽只出一条箭头」。
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="arrow"]').click();
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:280, clientY:450, bubbles:true, pointerId:21}));
      for (var i = 1; i <= 3; i += 1) root.dispatchEvent(new PointerEvent('pointermove', {clientX:280 + i * 20, clientY:450 - i * 10, bubbles:true, pointerId:21}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:340, clientY:420, bubbles:true, pointerId:21}));
      return 'ok';
    })()`);
    await sleep(120);
    const arrow1 = await evaluate(send, `JSON.stringify({
      arrows: state.annotations.filter(function(a){ return a.type === 'arrow'; }).length,
      drawing: state.drawing ? state.drawing.type : null
    })`);
    const a1 = JSON.parse(arrow1);
    check('箭头松手后恰好提交 1 条且无残留绘制', a1.arrows === 1 && a1.drawing === null, arrow1);

    await evaluate(send, `(function(){
      var root = document.getElementById('capture-root');
      for (var i = 1; i <= 3; i += 1) root.dispatchEvent(new PointerEvent('pointermove', {clientX:500 + i * 15, clientY:300 + i * 10, bubbles:true, pointerId:22}));
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:560, clientY:340, bubbles:true, pointerId:22}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:570, clientY:350, bubbles:true, pointerId:22}));
      return 'ok';
    })()`);
    await sleep(120);
    const ghost = await evaluate(send, `JSON.stringify({
      arrows: state.annotations.filter(function(a){ return a.type === 'arrow'; }).length,
      drawing: state.drawing ? state.drawing.type : null
    })`);
    const gh = JSON.parse(ghost);
    check('松手后移动鼠标 + 选区外点击不会多出箭头', gh.arrows === 1 && gh.drawing === null, ghost);

    console.log('\n== 运行期证明：拖动时不做布局读取 ==');

    // 把 Element.prototype.getBoundingClientRect 与 offsetWidth getter 打上计数器，
    // 在真实 pointer 事件序列 + 两帧 rAF 里统计 JS 层的强制同步布局次数。
    const layoutProbe = (action, args) => evaluate(send, `(function(){
      var rectCalls = 0, offsetCalls = 0;
      var origRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function(){ rectCalls += 1; return origRect.call(this); };
      var offsetDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: function(){ offsetCalls += 1; return offsetDesc.get.call(this); } });
      function restore() {
        Element.prototype.getBoundingClientRect = origRect;
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetDesc);
      }
      var rootEl = document.getElementById('capture-root');
      var sel = document.getElementById('selection');
      ${action}
      return new Promise(function(resolve){
        requestAnimationFrame(function(){ requestAnimationFrame(function(){
          restore();
          ${args}
          resolve(JSON.stringify({ rectCalls: rectCalls, offsetCalls: offsetCalls }));
        }); });
      });
    })()`);

    // 1) 橡皮筋框选：拖动期间不应有任何布局读取
    const dragProbe = await layoutProbe(
      `rootEl.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:60, clientY:60, bubbles:true, pointerId:41}));
       for (var i = 1; i <= 4; i += 1) rootEl.dispatchEvent(new PointerEvent('pointermove', {clientX:60 + i * 40, clientY:60 + i * 30, bubbles:true, pointerId:41}));`,
      `rootEl.dispatchEvent(new PointerEvent('pointerup', {clientX:220, clientY:180, bubbles:true, pointerId:41}));`
    );
    const dp = JSON.parse(dragProbe);
    check('框选拖动期间 0 次 getBoundingClientRect / offsetWidth 读取',
      dp.rectCalls === 0 && dp.offsetCalls === 0, dragProbe);

    // 2) 移动已有选区：工具栏用缓存尺寸定位，同样不应读布局
    const moveProbe = await layoutProbe(
      `document.querySelector('[data-tool="select"]').click();
       sel.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:120, clientY:120, bubbles:true, pointerId:42}));
       for (var j = 1; j <= 4; j += 1) rootEl.dispatchEvent(new PointerEvent('pointermove', {clientX:120 + j * 20, clientY:120 + j * 15, bubbles:true, pointerId:42}));`,
      `rootEl.dispatchEvent(new PointerEvent('pointerup', {clientX:200, clientY:180, bubbles:true, pointerId:42}));`
    );
    const mp = JSON.parse(moveProbe);
    check('移动 / 缩放选区期间 0 次 getBoundingClientRect / offsetWidth 读取',
      mp.rectCalls === 0 && mp.offsetCalls === 0, moveProbe);

    console.log('\n== Ctrl+A 不再误把选区重置为全屏 ==');

    // 先建立一个小选区（先切回「选择区域」，否则会画一笔）
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="select"]').click();
      var root = document.getElementById('capture-root');
      var down = new PointerEvent('pointerdown', {button:0, clientX:100, clientY:100, bubbles:true, pointerId:1});
      root.dispatchEvent(down);
      var move = new PointerEvent('pointermove', {clientX:300, clientY:250, bubbles:true, pointerId:1});
      root.dispatchEvent(move);
      var up = new PointerEvent('pointerup', {clientX:300, clientY:250, bubbles:true, pointerId:1});
      root.dispatchEvent(up);
    })(), 'ok'`);
    await sleep(300);
    const selectionAfterDrag = await evaluate(send, `(function(){
      var s = document.getElementById('selection');
      return JSON.stringify({ hidden: s.hidden, w: s.style.width, h: s.style.height });
    })()`);
    check('拖拽后形成选区', JSON.parse(selectionAfterDrag).hidden === false, selectionAfterDrag);

    // 在画布上（非文本输入）按 Ctrl+A：应当选中全屏，这是预期行为
    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true})), 'ok'`);
    await sleep(250);
    const fullSelect = await evaluate(send, `(function(){
      var s = document.getElementById('selection');
      var root = document.getElementById('capture-root');
      return JSON.stringify({
        w: Math.round(parseFloat(s.style.width)),
        h: Math.round(parseFloat(s.style.height)),
        rootW: root.clientWidth, rootH: root.clientHeight
      });
    })()`);
    const fu = JSON.parse(fullSelect);
    check('画布上 Ctrl+A 仍然选中全屏（预期保留）', Math.abs(fu.w - fu.rootW) <= 2 && Math.abs(fu.h - fu.rootH) <= 2, fullSelect);

    // 打开文字编辑器并聚焦输入框，按 Ctrl+A 应当只全选文字
    await evaluate(send, `(function(){
      var ed = document.getElementById('text-editor');
      ed.hidden = false;
      var ta = document.getElementById('text-input');
      ta.value = '这是一段已经输入的文字';
      ta.focus();
      ta.setSelectionRange(0, 0);
    })(), 'ok'`);
    await sleep(200);
    const beforeCtrlA = await evaluate(send, `(function(){
      var s = document.getElementById('selection');
      return JSON.stringify({ w: Math.round(parseFloat(s.style.width)), h: Math.round(parseFloat(s.style.height)) });
    })()`);

    // 在 textarea 上派发 Ctrl+A（target 就是 textarea）
    await evaluate(send, `(function(){
      var ta = document.getElementById('text-input');
      ta.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}));
    })(), 'ok'`);
    await sleep(250);
    const afterCtrlA = await evaluate(send, `(function(){
      var s = document.getElementById('selection');
      var ta = document.getElementById('text-input');
      return JSON.stringify({
        w: Math.round(parseFloat(s.style.width)),
        h: Math.round(parseFloat(s.style.height)),
        textValue: ta.value,
        selStart: ta.selectionStart,
        selEnd: ta.selectionEnd
      });
    })()`);
    const bc = JSON.parse(beforeCtrlA), ac = JSON.parse(afterCtrlA);
    check('文本框内 Ctrl+A 不改变画布选区（不再跳成全屏）', ac.w === bc.w && ac.h === bc.h,
      'before=' + beforeCtrlA + ' after=' + afterCtrlA);
    check('文本框内 Ctrl+A 不清空已输入文字', ac.textValue === '这是一段已经输入的文字', afterCtrlA);

    console.log('\n== OCR 结果面板「查看原图」==');

    // 关掉文字编辑器，用真实拖拽重新建立一个选区。
    // 已有选区时 mode 是 annotate，直接拖会画笔画一笔而不是重选，
    // 所以先切回「选择区域」工具——这正是用户会做的动作。
    await evaluate(send, `(function(){
      document.getElementById('text-editor').hidden = true;
      document.querySelector('[data-tool="select"]').click();
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:120, clientY:90, bubbles:true, pointerId:2}));
      root.dispatchEvent(new PointerEvent('pointermove', {clientX:420, clientY:290, bubbles:true, pointerId:2}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:420, clientY:290, bubbles:true, pointerId:2}));
    })(), 'ok'`);
    await sleep(350);
    const selNow = await evaluate(send, `(function(){
      var s = document.getElementById('selection');
      return JSON.stringify({
        hidden: s.hidden,
        w: Math.round(parseFloat(s.style.width)),
        h: Math.round(parseFloat(s.style.height))
      });
    })()`);
    const sn = JSON.parse(selNow);
    check('重新建立 300x200 选区', sn.hidden === false && sn.w === 300 && sn.h === 200, selNow);

    // 直接调用 OCR：走真实 startOcr → capture.finish
    await evaluate(send, `document.querySelector('[data-action="ocr"]').click(), 'ok'`);
    await sleep(600);
    const ocrPanel = await evaluate(send, `JSON.stringify({
      hidden: document.getElementById('ocr-result').hidden,
      text: document.getElementById('ocr-result-text').value,
      hasOriginal: !!document.getElementById('ocr-result-original'),
      actions: Array.from(document.querySelectorAll('.ocr-result-actions button')).map(function(b){return b.textContent.trim();})
    })`);
    check('OCR 结果面板打开并填入文字', JSON.parse(ocrPanel).hidden === false, ocrPanel);
    check('OCR 结果面板有「查看原图」按钮', JSON.parse(ocrPanel).hasOriginal === true, ocrPanel);

    // 点「查看原图」
    await evaluate(send, `document.getElementById('ocr-result-original').click(), 'ok'`);
    await sleep(400);
    const originalViewer = await evaluate(send, `(function(){
      var v = document.getElementById('original-viewer');
      var img = document.getElementById('original-image');
      return JSON.stringify({
        hidden: v.hidden,
        srcPrefix: (img.src || '').slice(0, 22),
        srcLength: (img.src || '').length,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight
      });
    })()`);
    const ov = JSON.parse(originalViewer);
    check('点击查看原图后原图层显示', ov.hidden === false, originalViewer);
    check('原图层渲染出真实图片数据', ov.srcPrefix.startsWith('data:image/png') && ov.srcLength > 500, originalViewer);
    check('原图尺寸等于选区（未被全屏放大）', ov.naturalW === 300 && ov.naturalH === 200, originalViewer);

    // 留存截图作为证据
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const outDir = path.join(ROOT, 'docs', 'screenshots');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, '16-overlay-original.png'), Buffer.from(shot.data, 'base64'));
      console.log('  已保存 docs/screenshots/16-overlay-original.png');
    } catch (e) {
      console.log('  （截图跳过：' + e.message + '）');
    }

    // 关闭原图层
    await evaluate(send, `document.getElementById('original-close').click(), 'ok'`);
    await sleep(200);
    const closed = await evaluate(send, `JSON.stringify({ hidden: document.getElementById('original-viewer').hidden })`);
    check('原图层可关闭并回到 OCR 结果', JSON.parse(closed).hidden === true, closed);

    console.log('\n== 马赛克 / 标注仍能真的画出来（去掉 getImageData 热点后）==');

    const annotationPixels = () => evaluate(send, `(function(){
      var c = document.getElementById('annotation-canvas');
      var data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var count = 0;
      for (var i = 3; i < data.length; i += 16) { if (data[i]) count += 1; }
      return count;
    })()`);

    // 马赛克现在用预计算调色板取色，拖动路径不再 getImageData
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="mosaic"]').click();
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:150, clientY:130, bubbles:true, pointerId:31}));
      root.dispatchEvent(new PointerEvent('pointermove', {clientX:260, clientY:220, bubbles:true, pointerId:31}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:260, clientY:220, bubbles:true, pointerId:31}));
    })(), 'ok'`);
    await sleep(250);
    const mosaicPixels = await annotationPixels();
    check('马赛克拖动后标注画布有像素（调色板取色路径可用）', mosaicPixels > 0, 'pixels=' + mosaicPixels);
    await evaluate(send, `document.querySelector('[data-action="undo"]').click(), 'ok'`);
    await sleep(150);
    const afterUndo = await annotationPixels();
    check('撤销马赛克后标注画布清空', afterUndo === 0, 'pixels=' + afterUndo);

    // 矩形标注（普通 canvas 绘制路径）
    await evaluate(send, `(function(){
      document.querySelector('[data-tool="rect"]').click();
      var root = document.getElementById('capture-root');
      root.dispatchEvent(new PointerEvent('pointerdown', {button:0, clientX:140, clientY:120, bubbles:true, pointerId:32}));
      root.dispatchEvent(new PointerEvent('pointermove', {clientX:260, clientY:220, bubbles:true, pointerId:32}));
      root.dispatchEvent(new PointerEvent('pointerup', {clientX:260, clientY:220, bubbles:true, pointerId:32}));
    })(), 'ok'`);
    await sleep(200);
    const rectPixels = await annotationPixels();
    check('矩形标注画到 annotation canvas 上', rectPixels > 0, 'pixels=' + rectPixels);

    console.log('\n== 工具栏按钮都真的绑定了行为 ==');
    // 复现过的缺陷：选择器只匹配 .tool-button，而「识」与「完成」是别的类，
    // 点击完全没反应
    const bindings = await evaluate(send, `(function(){
      var dock = document.getElementById('tool-dock');
      var all = Array.from(dock.querySelectorAll('[data-action]'));
      return JSON.stringify({
        total: all.length,
        classes: all.map(function(b){ return b.className + '|' + b.dataset.action; })
      });
    })()`);
    const bd = JSON.parse(bindings);
    // undo / cancel / pin / save / ocr（.token-button）/ copy（.complete-button）
    check('工具栏带 data-action 的按钮数量完整', bd.total === 6, bindings);
    const buttonsWithAction = ['undo', 'cancel', 'pin', 'save', 'ocr', 'copy'];
    const wired = bd.classes.map((c) => String(c).split('|')[1]);
    for (const action of buttonsWithAction) {
      check('按钮 ' + action + ' 已绑定', wired.includes(action), JSON.stringify(wired));
    }

    console.log('\n== 工具栏全部键位与输入保护 ==');
    const keyboardTools=await evaluate(send, `(async()=>{
      document.getElementById('ocr-result-close').click();document.getElementById('original-close').click();
      const press=(key,extra={})=>document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
      const expected={a:'select',p:'pen',r:'rect',l:'arrow',t:'text',m:'mosaic',n:'steps'};
      const tools={};for(const [key,tool] of Object.entries(expected)){press(key);tools[key]=document.getElementById('capture-root').dataset.tool===tool;}
      press('c');const colorsOpened=!document.getElementById('color-popover').hidden;press('3');
      const colorPicked=document.getElementById('color-popover').hidden&&document.getElementById('color-dot').style.background.includes('106');
      const actions={};for(const [key,action] of [['s','save'],['q','pin'],['Enter','copy'],['o','ocr']]){
        window.__finish=null;press(key);await new Promise(r=>setTimeout(r,60));actions[key]=window.__finish?.action===action;
        if(key==='o')document.getElementById('ocr-result-close').click();
      }
      window.__finish=null;press('s',{ctrlKey:true});await new Promise(r=>setTimeout(r,60));const ctrlSave=window.__finish?.action==='save';
      window.__finish=null;press('c',{ctrlKey:true});await new Promise(r=>setTimeout(r,60));const ctrlCopy=window.__finish?.action==='copy';
      window.__finish=null;press('s',{repeat:true});await new Promise(r=>setTimeout(r,30));const repeatSafe=window.__finish===null;
      press('r');press('p',{isComposing:true});const imeSafe=document.getElementById('capture-root').dataset.tool==='rect';
      const ta=document.getElementById('ocr-result-text');ta.focus();ta.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true,cancelable:true}));const typingSafe=document.getElementById('capture-root').dataset.tool==='rect';ta.blur();
      window.__canceled=false;press('Escape');const canceled=window.__canceled===true;
      const labels=[...document.querySelectorAll('#tool-dock [data-shortcut]')].every(button=>button.hasAttribute('aria-keyshortcuts')&&button.dataset.hint.includes('(')&&!button.querySelector('kbd,small'));
      return {tools,colorsOpened,colorPicked,actions,ctrlSave,ctrlCopy,repeatSafe,imeSafe,typingSafe,canceled,labels};
    })()`);
    for(const [key,passed] of Object.entries(keyboardTools.tools))check('按 '+key.toUpperCase()+' 切换对应工具',passed);
    for(const [key,passed] of Object.entries(keyboardTools.actions))check('按 '+key+' 执行对应工具栏动作',passed);
    for(const key of ['colorsOpened','colorPicked','ctrlSave','ctrlCopy','repeatSafe','imeSafe','typingSafe','canceled','labels'])check('键盘 '+key,keyboardTools[key]);
    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true,cancelable:true})),true`);
    check('Z 撤销标注',await annotationPixels()===0);
    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true})),true`);
    check('Ctrl Y 恢复撤销的标注',await annotationPixels()>0);

    // 「完成」按钮（.complete-button）点击后应真的提交截图
    await evaluate(send, `(function(){
      document.getElementById('ocr-result-close').click();
      window.__finish = null;
      document.querySelector('[data-action="copy"]').click();
    })(), 'ok'`);
    await sleep(500);
    const doneClick = await evaluate(send, `JSON.stringify({
      finished: !!window.__finish,
      action: window.__finish && window.__finish.action
    })`);
    check('点「完成」真的提交截图（不再无反应）', JSON.parse(doneClick).finished === true, doneClick);
    check('「完成」提交的 action 是 copy', JSON.parse(doneClick).action === 'copy', doneClick);

    console.log('\n== 第二次 capture:shown：状态被彻底重置 ==');

    // 当前仍有选区 / 工具栏 / 标注，再触发一次唤起
    const second = await evaluate(send, `(function(){
      var c = document.getElementById('annotation-canvas');
      var beforeData = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var beforePixels = 0;
      for (var i = 3; i < beforeData.length; i += 16) { if (beforeData[i]) beforePixels += 1; }
      window.__fireShown();
      var afterData = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var afterPixels = 0;
      for (var j = 3; j < afterData.length; j += 16) { if (afterData[j]) afterPixels += 1; }
      return JSON.stringify({
        beforePixels: beforePixels,
        afterPixels: afterPixels,
        shownCount: window.__shownCount,
        dockHidden: document.getElementById('tool-dock').hidden,
        selectionHidden: document.getElementById('selection').hidden,
        loadingHidden: document.getElementById('loading-state').hidden,
        hintHidden: document.getElementById('capture-hint').classList.contains('is-hidden'),
        ocrHidden: document.getElementById('ocr-result').hidden,
        viewerHidden: document.getElementById('original-viewer').hidden,
        editorHidden: document.getElementById('text-editor').hidden
      });
    })()`);
    const sec = JSON.parse(second);
    check('第二次 shown 前确实有标注内容', sec.beforePixels > 0, second);
    check('第二次 shown 同步清空选区', sec.selectionHidden === true, second);
    check('第二次 shown 同步隐藏工具栏', sec.dockHidden === true, second);
    check('第二次 shown 同步清空标注画布', sec.afterPixels === 0, second);
    check('第二次 shown 显示 loading 并在途', sec.loadingHidden === false, second);
    check('第二次 shown 恢复顶部提示条', sec.hintHidden === false, second);
    check('第二次 shown 隐藏 OCR / 原图 / 文字编辑器',
      sec.ocrHidden === true && sec.viewerHidden === true && sec.editorHidden === true, second);
    check('shown 事件计数为 2', sec.shownCount === 2, second);

    const reloadedOk = await waitFor(send, `document.getElementById('loading-state').hidden === true`, 6000);
    check('第二次 shown 后新画面加载完成（loading 消失）', reloadedOk);
    const afterSecondLoad = await evaluate(send, `(function(){
      var c = document.getElementById('screen-canvas');
      var px = c.getContext('2d').getImageData(4, 4, 1, 1).data;
      return JSON.stringify({
        loadingHidden: document.getElementById('loading-state').hidden,
        dockHidden: document.getElementById('tool-dock').hidden,
        selectionHidden: document.getElementById('selection').hidden,
        pixel: [px[0], px[1], px[2], px[3]],
        shownAt: window.__lastCapturePerf.shownAt,
        imageReadyAt: window.__lastCapturePerf.imageReadyAt
      });
    })()`);
    const asl = JSON.parse(afterSecondLoad);
    check('第二次 shown 后新画面真的重绘到 screen canvas', asl.pixel[0] > 200 && asl.pixel[3] === 255, afterSecondLoad);
    check('第二次 shown 后仍是空白状态（无选区 / 无工具栏）',
      asl.selectionHidden === true && asl.dockHidden === true, afterSecondLoad);
    check('第二次 shown 的埋点已刷新', asl.shownAt > 0 && asl.imageReadyAt > 0, afterSecondLoad);

    console.log('\n== 原始像素与分数 DPI 裁剪 ==');
    const fidelity=await evaluate(send, `(async()=>{
      const saved={image:state.image,raw:state.rawTiles,selection:state.selection,annotations:state.annotations};
      try {
        const source=document.createElement('canvas');source.width=1200;source.height=900;
        const c=source.getContext('2d');for(let x=0;x<1200;x++){c.fillStyle=x%2?'#fff':'#000';c.fillRect(x,0,1,900);}
        const image=await new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=source.toDataURL('image/png');});
        state.image=image;state.rawTiles=[{x:0,y:0,width:800,height:600,image}];state.selection={x:10.25,y:7.5,w:83.5,h:52.25};state.annotations=[];
        const out=compositeSelection(),sx=Math.round(10.25*1.5),sy=Math.round(7.5*1.5);
        const actual=out.getContext('2d').getImageData(0,0,out.width,out.height).data,expected=c.getImageData(sx,sy,out.width,out.height).data;
        let differences=0;for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])differences++;
        state.annotations=[{type:'rect',x:15.25,y:12.5,w:20,h:20,color:'#ff0000',width:2}];
        const annotated=compositeSelection(),pixels=annotated.getContext('2d').getImageData(0,0,annotated.width,annotated.height).data;
        let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]<60&&pixels[i+2]<60)red++;
        return {width:out.width,height:out.height,differences,red};
      }finally{state.image=saved.image;state.rawTiles=saved.raw;state.selection=saved.selection;state.annotations=saved.annotations;}
    })()`);
    const fq=typeof fidelity==='string'?JSON.parse(fidelity):fidelity;
    check('150% DPI 分数选区逐像素保留源图',fq.differences===0,JSON.stringify(fq));
    check('像素坐标裁剪尺寸正确',fq.width===126&&fq.height===79,JSON.stringify(fq));
    check('高 DPI 标注仍正确绘制',fq.red>0,JSON.stringify(fq));

    console.log('\n== 截图加载避免重复解码与多屏重新编码 ==');
    const decoding = await evaluate(send, `(async()=>{
      const NativeImage=window.Image, originalGetData=window.suira.capture.getData;
      let decoded=0;
      window.Image=function(){decoded++;return new NativeImage();};
      const color=value=>{const c=document.createElement('canvas');c.width=100;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle=value;ctx.fillRect(0,0,100,80);return c.toDataURL();};
      const red=color('#ff0000'),blue=color('#0000ff');
      try {
        const single={dataUrl:red,size:{width:100,height:80},scaleFactor:1,rawTiles:[{x:0,y:0,width:100,height:80,tileIndex:0}]};
        window.suira.capture.getData=async()=>single;resetOverlay();await loadCapture(showSeq);
        const singleDecoded=decoded;decoded=0;
        const tiles=[{x:0,y:0,width:100,height:80,dataUrl:red},{x:100,y:0,width:100,height:80,dataUrl:blue}];
        window.suira.capture.getData=async()=>({tiles,tileSize:{width:200,height:80},size:{width:200,height:80},scaleFactor:1,rawTiles:tiles.map((t,i)=>({...t,dataUrl:undefined,tileIndex:i}))});
        resetOverlay();await loadCapture(showSeq);
        const composed=state.image instanceof HTMLCanvasElement;
        const pixels=state.image.getContext('2d');
        return {singleDecoded,multiDecoded:decoded,composed,left:[...pixels.getImageData(10,10,1,1).data],right:[...pixels.getImageData(110,10,1,1).data]};
      }finally{window.Image=NativeImage;window.suira.capture.getData=originalGetData;}
    })()`);
    check('单屏原图与裁剪共用一次解码',decoding.singleDecoded===1,JSON.stringify(decoding));
    check('双屏各解码一次，并直接使用合成画布',decoding.multiDecoded===2&&decoding.composed,JSON.stringify(decoding));
    check('多屏拼接保持左右屏原始颜色',decoding.left.join(',')==='255,0,0,255'&&decoding.right.join(',')==='0,0,255,255',JSON.stringify(decoding));

    console.log('\n== 隐藏即释放：capture:release 归还画面与画布后备缓冲 ==');
    const releaseResult = await evaluate(send, `(function(){
      window.__fireRelease();
      var sc = document.getElementById('screen-canvas');
      var ac = document.getElementById('annotation-canvas');
      var oi = document.getElementById('original-image');
      return JSON.stringify({
        released: window.__overlayReleased === true,
        releaseCount: window.__releaseCount,
        screen: [sc.width, sc.height],
        annotation: [ac.width, ac.height],
        originalSrc: oi ? (oi.getAttribute('src') || '') : ''
      });
    })()`);
    const rel = JSON.parse(releaseResult);
    check('收到 release 后释放标记置位且只触发一次', rel.released === true && rel.releaseCount === 1, releaseResult);
    check('screen canvas 后备缓冲真正释放（width/height = 0）', rel.screen[0] === 0 && rel.screen[1] === 0, releaseResult);
    check('annotation canvas 后备缓冲真正释放', rel.annotation[0] === 0 && rel.annotation[1] === 0, releaseResult);
    check('OCR「查看原图」的 data URL 已清空', rel.originalSrc === '', releaseResult);

    console.log('\n== 源码层性能约束（静态）==');
    check('主画布 getContext 不再传 willReadFrequently',
      !/getContext\('2d',\s*\{\s*willReadFrequently/.test(overlaySource), '仍有软件 canvas');
    check('主画布不再用 getImageData 读回（screenCtx.getImageData 已移除）',
      !/screenCtx\.getImageData/.test(overlaySource));
    check('拖动路径不再逐帧 root.getBoundingClientRect（只剩 refreshMetrics 一处）',
      (overlaySource.match(/root\.getBoundingClientRect/g) || []).length === 1);
    check('拖动路径不再逐帧读 root.clientWidth / root.clientHeight',
      !/root\.clientWidth|root\.clientHeight/.test(overlaySource));
    check('工具栏尺寸只测量一次（toolDock.offsetWidth 仅 measureDock 一处）',
      (overlaySource.match(/toolDock\.offsetWidth/g) || []).length === 1);

    console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
    ws.close();
  } finally {
    child.kill();
    await sleep(400);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
