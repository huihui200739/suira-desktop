'use strict';

// 连接已启动的真实 Electron，验证窗口尺寸、preload、IPC 与面板 DOM。
// SUIRA_CDP_PORT=9315 node tools/electron-panel-check.js
const assert = require('node:assert/strict');
const { QUICK_PANEL_SIZE, quickPanelBounds } = require('../lib/display-geometry');
const PORT = Number(process.env.SUIRA_CDP_PORT || 9223);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = () => fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`超时：${method}`)); }, 15000);
      pending.set(key, { resolve, reject, timer });
      ws.send(JSON.stringify({ id:key, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  return { ws, send, evaluate };
}

(async () => {
  const connections = [];
  let panel;
  try {
    const mainTarget = (await targets()).find(t => t.url.endsWith('/index.html') || t.url.endsWith('/island.html'));
    assert.ok(mainTarget, '需要先以调试端口启动 Electron');
    const main = await connect(mainTarget);
    connections.push(main);
    await main.evaluate('window.suira.quick.show()');
    let panelTarget;
    for (let attempt = 0; attempt < 40; attempt++) {
      panelTarget = (await targets()).find(t => t.url.endsWith('/quickpanel.html'));
      if (panelTarget) break;
      await wait(100);
    }
    assert.ok(panelTarget, '真实 IPC 应创建面板窗口');
    panel = await connect(panelTarget);
    connections.push(panel);
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await panel.evaluate("document.querySelectorAll('.key').length === 38")) break;
      await wait(100);
    }
    // 等待入场动画结束，再测量键帽的最终尺寸。
    await wait(220);
    const result = await panel.evaluate(`(async () => {
      const snapshot = await window.suira.panel.state();
      const rejected = await window.suira.panel.run('not-a-real-action');
      const body = document.getElementById('panel-body');
      const workArea = {x:screen.availLeft,y:screen.availTop,width:screen.availWidth,height:screen.availHeight};
      return {
        viewport:{width:innerWidth,height:innerHeight}, position:{x:screenX,y:screenY}, workArea,
        keys:document.querySelectorAll('.key').length, ipcKeys:snapshot.keys.length,
        rejected:rejected.ok===false && Boolean(rejected.error),
        overflowX:body.scrollWidth>body.clientWidth+1,
        overflowY:body.scrollHeight>body.clientHeight+1,
        keySize:document.querySelector('.key-card').getBoundingClientRect().width,
        square:Array.from(document.querySelectorAll('.key-card')).every(k=>{const r=k.getBoundingClientRect();return Math.abs(r.width-r.height)<1;}),
        brandLoaded:document.querySelector('.brand-symbol img').naturalWidth>0,
        removedText:!document.querySelector('.context-strip, .key-label, #return-bar')
      };
    })()`);
    const bounds = quickPanelBounds(result.workArea);
    assert.equal(result.keys, 38);
    assert.equal(result.ipcKeys, 38);
    assert.equal(result.rejected, true);
    assert.ok(result.square && result.brandLoaded && result.removedText,'应加载正式图标与无文字条的方形键位');
    assert.deepEqual(result.viewport, {width:bounds.width,height:bounds.height});
    assert.deepEqual(result.position, {x:bounds.x,y:bounds.y});
    assert.equal(result.overflowX, false);
    if (bounds.width === QUICK_PANEL_SIZE.width && bounds.height === QUICK_PANEL_SIZE.height) {
      assert.equal(result.keySize, 72);
      assert.equal(result.overflowY, false);
    }
    console.log('PASS  真实 Electron 面板、preload、IPC、工作区位置和键帽布局');
    console.log(JSON.stringify(result));
  } finally {
    if (panel) await panel.evaluate('window.suira.quick.hide()').catch(() => {});
    for (const connection of connections) connection.ws.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
