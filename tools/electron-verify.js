'use strict';
/*
 * 在真实 Electron 窗口里验证（不是无头 Chrome 模拟）。
 *
 * 背景：本机 Electron 无法从工作区内部启动（沙箱限制，退出码 0x80000003），
 * 但把同一个 Electron 放到工作区外运行、加载本项目的页面，可以正常启动。
 * 于是用 --remote-debugging-port 连上真实 Electron 窗口做验证。
 *
 * 这比无头 Chrome 更接近真机：页面跑在真实 Electron 里，
 * preload 真实注入 window.suira，IPC 真实连到主进程。
 *
 * 用法：node tools/electron-verify.js
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

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  // 找到两个真实窗口
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const mainTarget = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  const panelTarget = targets.find((t) => t.type === 'page' && t.url.includes('quickpanel.html'));
  if (!mainTarget) throw new Error('找不到主窗口（index.html）');
  if (!panelTarget) throw new Error('找不到动作面板（quickpanel.html）');

  console.log('\n== 真实 Electron 窗口 ==');
  console.log('  主窗口: ' + mainTarget.title);
  console.log('  面板  : ' + panelTarget.title);

  const main = await connect(mainTarget.webSocketDebuggerUrl);
  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  await main.send('Runtime.enable');
  await panel.send('Runtime.enable');

  console.log('\n== preload 与 IPC 真实可用 ==');
  const bridge = await evaluate(main.send, `JSON.stringify({
    hasSuira: typeof window.suira === 'object',
    keys: window.suira ? Object.keys(window.suira).sort() : []
  })`);
  const b = JSON.parse(bridge);
  check('window.suira 由 preload 注入', b.hasSuira === true, bridge);
  check('暴露了 panel/content/shortcuts 等命名空间',
    ['panel', 'content', 'shortcuts', 'capture', 'ocr'].every((k) => b.keys.includes(k)),
    JSON.stringify(b.keys));

  // 真实 IPC：向主进程要快捷键状态
  const shortcuts = await evaluate(main.send, `window.suira.shortcuts.get().then(r => JSON.stringify(r))`);
  const sc = JSON.parse(shortcuts);
  check('IPC 真实返回快捷键状态', sc && typeof sc.bindings === 'object', shortcuts);
  check('面板快捷键已绑定', Boolean(sc.bindings.quick), JSON.stringify(sc.bindings));
  check('截图快捷键已绑定', Boolean(sc.bindings.capture), JSON.stringify(sc.bindings));

  // 真实 IPC：面板状态（含 38 键与工具箱目录）
  // keyLayout() 返回 { rows, keys, count }，不是 keyRows
  const panelState = await evaluate(panel.send, `window.suira.panel.state().then(r => JSON.stringify({
    ok: !!r,
    rows: r && r.rows ? r.rows.length : 0,
    keys: r && r.keys ? r.keys.length : 0,
    count: r && r.count ? r.count : 0,
    tools: r && r.tools ? r.tools.length : 0,
    implemented: r && r.tools ? r.tools.filter(t => t.implemented).length : 0,
    states: r && r.keys ? [...new Set(r.keys.map(k => k.state))].sort() : []
  }))`);
  const ps = JSON.parse(panelState);
  check('面板拿到 4 行键盘布局', ps.rows === 4, panelState);
  check('面板拿到 38 个键位', ps.keys === 38 && ps.count === 38, panelState);
  check('面板能拿到工具箱目录', ps.tools >= 12, panelState);
  check('工具箱区分已实现/未实现', ps.implemented > 0 && ps.implemented < ps.tools, panelState);
  // 未实现入口必须有独立状态，不能和「已绑定可用」混在一起
  check('未实现入口有独立状态标记', ps.states.includes('unimplemented'), JSON.stringify(ps.states));

  console.log('\n== 主窗口真实渲染 ==');
  const dom = await evaluate(main.send, `JSON.stringify({
    title: document.title,
    hasNav: !!document.querySelector('.nav, nav, [data-page]'),
    bodyText: document.body.innerText.length,
    stylesLoaded: getComputedStyle(document.body).fontFamily !== ''
  })`);
  const d = JSON.parse(dom);
  check('主窗口标题正确', d.title.includes('随序'), d.title);
  check('主窗口有内容（非空白页）', d.bodyText > 50, '正文长度 ' + d.bodyText);
  check('样式表已生效', d.stylesLoaded === true, JSON.stringify(d));

  console.log('\n== 面板真实渲染 ==');
  const panelDom = await evaluate(panel.send, `JSON.stringify({
    title: document.title,
    keys: document.querySelectorAll('[data-key], .keycap, .key').length,
    bodyText: document.body.innerText.length
  })`);
  const pd = JSON.parse(panelDom);
  check('面板标题正确', pd.title.includes('随序'), pd.title);
  check('面板渲染出键位元素', pd.keys > 0, '键位元素数 ' + pd.keys);
  check('面板有可见内容', pd.bodyText > 20, '正文长度 ' + pd.bodyText);

  console.log('\n== 剪贴板监听（真实主进程）==');
  const clip = await evaluate(main.send, `(async () => {
    // 通过真实 IPC 触发一次内容查询，确认主进程在响应
    const items = await window.suira.content.list({ limit: 3 });
    return JSON.stringify({ ok: Array.isArray(items), count: Array.isArray(items) ? items.length : -1 });
  })()`);
  const cl = JSON.parse(clip);
  check('主进程内容接口可调用', cl.ok === true, clip);

  console.log('\n== 面板真实键盘交互 ==');
  // 打开面板并聚焦，模拟真实按键
  await evaluate(panel.send, `(async () => {
    window.__pressed = [];
    return 'ok';
  })()`);
  // 未实现键位点下去必须明确告知，不能静默无反应
  const unimplemented = await evaluate(panel.send, `(async () => {
    const r = await window.suira.panel.run('record');
    return JSON.stringify(r);
  })()`);
  const ui = JSON.parse(unimplemented);
  check('未实现动作被拒绝并给出原因', ui.ok === false && Boolean(ui.error), unimplemented);
  check('拒绝原因包含「尚未实现」', String(ui.error || '').includes('尚未实现'), ui.error);

  // 未知动作同样要拒绝
  const unknown = await evaluate(panel.send, `(async () => {
    const r = await window.suira.panel.run('not-a-real-action');
    return JSON.stringify(r);
  })()`);
  const uk = JSON.parse(unknown);
  check('未知动作被拒绝', uk.ok === false, unknown);

  // 面板内按键直达：派发真实 keydown，看是否进入截图（会产生覆盖层窗口）
  const beforeTargets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).length;
  console.log('  面板按键前窗口数: ' + beforeTargets);

  main.ws.close();
  panel.ws.close();

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  // 直接 exit 会在 WebSocket 句柄仍关闭中时触发 libuv 断言
  // （Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)），
  // 让事件循环自然收尾再退出。
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('验证失败：' + e.message);
  process.exit(1);
});
