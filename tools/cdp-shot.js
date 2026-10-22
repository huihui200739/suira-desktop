'use strict';
/*
 * 通过 CDP（Chrome DevTools Protocol）从真实运行中的随序窗口截图。
 * 需要应用以 --remote-debugging-port=9223 启动。
 * 用法：node cdp-shot.js
 */
const fs = require('fs');
const path = require('path');

const PORT = 9223;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({ ws, send }));
    ws.addEventListener('error', (e) => reject(new Error('WS error')));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(JSON.stringify(msg.error)));
        else r(msg.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const mid = ++id;
        pending.set(mid, { resolve: r, reject: j });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); j(new Error('timeout ' + method)); } }, 20000);
      });
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result ? r.result.value : undefined;
}

async function shot(send, name) {
  // 窗口不可见 / 未合成时 captureScreenshot 会一直挂着，所以先强制前台
  try { await send('Page.bringToFront'); } catch { /* 忽略 */ }
  await sleep(250);
  try {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return fs.statSync(file).size;
  } catch (e) {
    // 退路：按布局尺寸裁一张整页图
    const m = await send('Page.getLayoutMetrics');
    const w = Math.ceil(m.cssContentSize.width);
    const h = Math.ceil(m.cssContentSize.height);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 }
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return fs.statSync(file).size;
  }
}

(async () => {
  const targets = await listTargets();
  const main = targets.find((t) => t.url.includes('index.html'));
  if (!main) { console.log('未找到主窗口目标'); process.exit(1); }
  const { ws, send } = await connect(main.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await sleep(600);

  const pages = [
    ['shelf', '08-live-task-shelf.png'],
    ['library', '09-live-content-library.png'],
    ['trail', '10-live-process-trail.png'],
    ['settings', '11-live-settings.png']
  ];
  for (const [page, name] of pages) {
    const ok = await evaluate(send, `(function(){var n=document.querySelector('.nav-item[data-page="${page}"]'); if(!n) return 'no-nav'; n.click(); return 'clicked';})()`);
    await sleep(900);
    const size = await shot(send, name);
    console.log(`${name}  ${size} bytes  (${ok})`);
  }

  // 采样一些真实运行时数据，便于描述"现在做到哪一步"
  const facts = await evaluate(send, `JSON.stringify({
    version: (document.querySelector('.side-card small, #app-version')||{}).textContent || '',
    tasks: document.querySelectorAll('.task-row').length,
    libraryCards: document.querySelectorAll('.library-card').length,
    trailRows: document.querySelectorAll('.trail-row').length,
    navItems: Array.from(document.querySelectorAll('.nav-item')).map(function(n){return n.getAttribute('data-page');}),
    shortcutPills: Array.from(document.querySelectorAll('.shortcut-pill')).map(function(n){return n.textContent.trim();})
  })`);
  console.log('FACTS ' + facts);

  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });




