'use strict';
/*
 * 在真实 Electron 里验证截图链路：调用 capture 动作后，
 * 是否真的创建了覆盖层窗口（overlay.html）。
 *
 * 这是第二批验收的关键项：「从动作面板进入工具、完成操作、关闭或返回」。
 * 之前只在无头 Chrome 里验证过页面逻辑，没有验证过主进程真的开了覆盖层。
 *
 * 用法：node tools/electron-capture-check.js
 * 前置：应用已带 --remote-debugging-port=9223 启动
 */
const PORT = Number(process.env.SUIRA_CDP_PORT || 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); j(new Error('timeout ' + method)); } }, 20000);
      });
    }
  });
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'evaluate failed');
  }
  return r.result ? r.result.value : undefined;
}

const listWindows = async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
};

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  const targets = await listWindows();
  const panelTarget = targets.find((t) => t.url.includes('quickpanel.html'));
  if (!panelTarget) throw new Error('找不到动作面板窗口，请先启动应用');

  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  await panel.send('Runtime.enable');

  const before = await listWindows();
  const overlayBefore = before.find((t) => t.url.includes('overlay.html'));
  console.log('\n== 触发截图前的窗口 ==');
  before.forEach((t) => console.log('  ' + t.title + '  ' + t.url.split('/').pop()));
  // 覆盖层现在是「预热常驻窗口」：启动后就存在，只是隐藏。
  check('覆盖层窗口已预热（启动后常驻）', Boolean(overlayBefore), '启动后没有 overlay 窗口');
  let hiddenBefore = false;
  if (overlayBefore) {
    const ov0 = await connect(overlayBefore.webSocketDebuggerUrl);
    await ov0.send('Runtime.enable');
    hiddenBefore = (await evaluate(ov0.send, `document.visibilityState`)) === 'hidden';
    ov0.ws.close();
  }
  check('预热覆盖层在未截图时是隐藏的', hiddenBefore);

  console.log('\n== 调用 capture 动作（等同按 Z）==');
  // capture 是已实现动作，主进程应启动截图覆盖层
  const result = await evaluate(panel.send, `(async () => {
    try {
      const r = await window.suira.panel.run('capture');
      return JSON.stringify({ ok: r && r.ok, keys: r ? Object.keys(r) : [], raw: r });
    } catch (e) {
      return JSON.stringify({ thrown: String(e && e.message || e) });
    }
  })()`);
  console.log('  返回: ' + String(result).slice(0, 200));

  // 等覆盖层创建
  await sleep(2500);
  const after = await listWindows();
  console.log('\n== 触发截图后的窗口 ==');
  after.forEach((t) => console.log('  ' + t.title + '  ' + t.url.split('/').pop()));

  const overlay = after.find((t) => t.url.includes('overlay.html'));
  check('截图覆盖层窗口真的被创建', Boolean(overlay),
    '窗口数 ' + before.length + ' → ' + after.length);
  check('复用同一个预热覆盖层窗口（不是新建）',
    Boolean(overlay) && Boolean(overlayBefore) && overlay.id === overlayBefore.id,
    'before=' + (overlayBefore && overlayBefore.id) + ' after=' + (overlay && overlay.id));

  if (overlay) {
    const ov = await connect(overlay.webSocketDebuggerUrl);
    await ov.send('Runtime.enable');
    const dom = await evaluate(ov.send, `JSON.stringify({
      title: document.title,
      hasSelection: !!document.querySelector('#selection'),
      hasToolbar: !!document.querySelector('#tool-dock, .tool-dock'),
      actions: document.querySelectorAll('[data-action]').length,
      canvasW: (document.querySelector('#screen-canvas') || {}).width || 0,
      canvasH: (document.querySelector('#screen-canvas') || {}).height || 0,
      annotated: (document.querySelector('#annotation-canvas') || {}).width || 0
    })`);
    const d = JSON.parse(dom);
    check('覆盖层页面已加载', d.title.length > 0, dom);
    check('覆盖层有选区元素', d.hasSelection === true, dom);
    check('覆盖层有工具栏', d.hasToolbar === true, dom);
    check('工具栏按钮已渲染', d.actions > 0, '按钮数 ' + d.actions);
    check('截图画布有实际尺寸（截到了屏幕）', d.canvasW > 0 && d.canvasH > 0,
      d.canvasW + '×' + d.canvasH);

    // 取消截图：覆盖层现在只是隐藏（预热复用），CDP 连接不会断。
    try {
      await evaluate(ov.send, `(() => {
        const cancel = document.querySelector('[data-action="cancel"]');
        if (cancel) { cancel.click(); return 'clicked'; }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return 'escaped';
      })()`);
    } catch {
      // 兼容旧实现（取消即销毁）时连接断开，不算失败
    }
    await sleep(1200);
    const cleaned = await listWindows();
    const stillOverlay = cleaned.find((t) => t.url.includes('overlay.html'));
    check('取消后覆盖层仍在（预热复用）', Boolean(stillOverlay), 'overlay 窗口消失了');
    let hiddenAfter = false;
    if (stillOverlay) {
      const ov2 = await connect(stillOverlay.webSocketDebuggerUrl);
      await ov2.send('Runtime.enable');
      hiddenAfter = (await evaluate(ov2.send, `document.visibilityState`)) === 'hidden';
      ov2.ws.close();
    }
    check('取消后覆盖层被隐藏（下次唤起秒开）', hiddenAfter);
    ov.ws.close();
  }

  panel.ws.close();
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('检查失败：' + e.message);
  process.exit(1);
});
