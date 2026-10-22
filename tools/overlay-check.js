'use strict';
/*
 * 用无头 Chrome 验证截图覆盖层的两处修复在真实 DOM 里生效：
 *
 * 1. Ctrl+A：在文字输入框里应当「全选文字」，不能把选区重置成整个屏幕
 *    （复现缺陷：文字编辑器里按 Ctrl+A 会清空输入并选中全屏）
 * 2. 查看原图：OCR 结果面板的按钮必须真的把未加标注的原图渲染出来
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
const MOCK = `
(function(){
  var handlers = {};
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
      cancel: async function(){ window.__canceled = true; return { ok:true }; }
    },
    content: {
      addText: async function(p){ window.__added = p; return { ok:true, item:{ id:'txt2' } }; },
      list: async function(){ return []; }
    },
    actions: { run: async function(){ return { ok:true }; } },
    quick: { hide: async function(){ return {ok:true}; } }
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

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'overlay.html'), 'utf8')
    .replace('<script src="overlay.js"></script>', '<script src="__mock.js"></script><script src="overlay.js"></script>');
  fs.writeFileSync(path.join(TMP, '__mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, 'overlay.html'), html, 'utf8');
  for (const asset of ['overlay.css', 'overlay.js']) {
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
    await sleep(1500);

    const loaded = await evaluate(send, `JSON.stringify({
      loadingHidden: document.getElementById('loading-state').hidden,
      hasImage: (function(){ try { return true; } catch(e){ return false; } })()
    })`);
    check('覆盖层画面已加载', JSON.parse(loaded).loadingHidden === true, loaded);

    console.log('\n== Ctrl+A 不再误把选区重置为全屏 ==');

    // 先建立一个小选区
    await evaluate(send, `(function(){
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
    // 注意：已有选区时 mode 是 annotate，直接拖会画笔画一笔而不是重选，
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

    console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
    ws.close();
  } finally {
    child.kill();
    await sleep(400);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
