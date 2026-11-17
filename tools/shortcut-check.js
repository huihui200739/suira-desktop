'use strict';
/*
 * 用无头 Chrome 验证「恢复默认 / 清除绑定」在真实 DOM 里生效。
 *
 * 为什么需要这个检查：test-ui.js 只做静态字符串断言，能证明「代码写了」，
 * 但不能证明按钮点下去真的调用、状态真的刷新。这里注入真实的
 * window.suira.shortcuts 替身，跑真实点击。
 *
 * 对应原产品 KeyboardShortcutRecorderController 的 restoreDefault / clearShortcut。
 *
 * 用法：node tools/shortcut-check.js
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
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(TMP, { recursive: true });

const appJs = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

// 从 app.js 抽出快捷键相关的三个函数，放进最小页面里跑真实点击。
// 注意：必须连同 async 前缀一起截取，否则抽出的函数在顶层含 await 会语法报错。
function slice(name, nextMarker) {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(appJs);
  if (!match) throw new Error('无法从 app.js 抽取 ' + name);
  const start = match.index;
  const end = nextMarker ? appJs.indexOf(nextMarker, start) : -1;
  if (end < 0) throw new Error('无法定位 ' + name + ' 的结束位置');
  return appJs.slice(start, end);
}
const keyCaptureSrc = appJs.slice(appJs.indexOf('const KEY_LABELS = {'), appJs.indexOf('function bindShortcutEditors('));
if (!keyCaptureSrc.startsWith('const KEY_LABELS = {') || !keyCaptureSrc.includes('function toAccelerator(')) {
  throw new Error('无法从 app.js 抽取快捷键录入函数');
}
const bindSrc = slice('bindShortcutEditors', '/** 从主进程拉取当前键位与注册状态并渲染。 */');
const refreshSrc = slice('renderShortcutCheck', '/* ---------- modal ---------- */');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
</head><body>
<section class="setting-card">
  <label class="setting-row shortcut-edit">
    <span><b>随手面板</b></span>
    <input class="shortcut-input" type="text" id="setting-key-quick" readonly>
  </label>
  <p class="shortcut-status" id="status-quick"></p>
  <div class="shortcut-actions"><button class="quiet-btn" data-shortcut-clear="quick" type="button">清除绑定</button></div>
  <label class="setting-row shortcut-edit">
    <span><b>区域截图</b></span>
    <input class="shortcut-input" type="text" id="setting-key-capture" readonly>
  </label>
  <p class="shortcut-status" id="status-capture"></p>
  <div class="shortcut-actions">
    <button class="quiet-btn" data-shortcut-clear="capture" type="button">清除绑定</button>
    <button class="quiet-btn" id="shortcut-restore" type="button">恢复默认</button>
  </div>
</section>
<script>
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// window.suira.shortcuts 的替身：模拟主进程的真实返回结构
const state = {
  bindings: { quick: 'CommandOrControl+Alt+Space', capture: 'CommandOrControl+Shift+A' },
  status: {
    quick: { ok: true, accelerator: 'CommandOrControl+Alt+Space', error: '' },
    capture: { ok: true, accelerator: 'CommandOrControl+Shift+A', error: '' }
  }
};
window.__calls = [];
window.__captureDelay = 0;
window.__setFailure = '';
window.suira = {
  shortcuts: {
    capture: async active => { window.__calls.push(['capture', Boolean(active)]); if(active&&window.__captureDelay)await new Promise(resolve=>setTimeout(resolve,window.__captureDelay)); return { ok:true }; },
    get: async () => JSON.parse(JSON.stringify(state)),
    set: async (p) => {
      window.__calls.push(['set', p.name, p.accelerator]);
      if(window.__setFailure)return {ok:false,error:window.__setFailure};
      state.bindings[p.name] = p.accelerator;
      state.status[p.name] = { ok: true, accelerator: p.accelerator, error: '' };
      return { ok: true, status: state.status };
    },
    restoreDefault: async () => {
      window.__calls.push(['restoreDefault']);
      state.bindings = { quick: 'CommandOrControl+Alt+Space', capture: 'CommandOrControl+Shift+A' };
      state.status = {
        quick: { ok: true, accelerator: 'CommandOrControl+Alt+Space', error: '' },
        capture: { ok: true, accelerator: 'CommandOrControl+Shift+A', error: '' }
      };
      return { ok: true, status: state.status, restored: ['quick', 'capture'] };
    },
    clear: async (p) => {
      window.__calls.push(['clear', p.name]);
      delete state.bindings[p.name];
      state.status[p.name] = { ok: true, accelerator: '', error: '', cleared: true };
      return { ok: true, status: state.status };
    }
  }
};

// 抽出的函数内部使用 await，普通 script 顶层不允许，
// 因此统一包进一个 async 立即执行函数，并在内部挂载测试入口。
window.__ready = (async () => {
${keyCaptureSrc}
${bindSrc}
${refreshSrc}
  bindShortcutEditors();
  await refreshShortcuts();
  window.__init = async () => {
    bindShortcutEditors();
    await refreshShortcuts();
  };
  window.__state = () => JSON.parse(JSON.stringify(state));
})();
</script>
</body></html>`;

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
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const detail = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'evaluate failed';
    throw new Error(detail);
  }
  return r.result ? r.result.value : undefined;
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  fs.writeFileSync(path.join(TMP, 'shortcut.html'), PAGE, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'src', 'styles.css'), path.join(TMP, 'styles.css'));

  const userDataDir = path.join(TMP, 'profile-shortcut');
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=900,700', 'about:blank'
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
    await send('Page.navigate', { url: 'file:///' + path.join(TMP, 'shortcut.html').replace(/\\/g, '/') });
    await sleep(900);

    await evaluate(send, 'window.__ready');
    await sleep(200);

    console.log('\n== 初始渲染 ==');
    let view = JSON.parse(await evaluate(send, `JSON.stringify({
      quick: document.getElementById('setting-key-quick').value,
      capture: document.getElementById('setting-key-capture').value,
      statusQuick: document.getElementById('status-quick').textContent
    })`));
    check('面板键位已渲染', view.quick.includes('Ctrl') && view.quick.includes('Alt'), JSON.stringify(view));
    check('截图键位已渲染', view.capture.includes('Ctrl') && view.capture.includes('Shift'), JSON.stringify(view));
    check('已生效状态可见', view.statusQuick.includes('已生效'), view.statusQuick);

    console.log('\n== 清除绑定 ==');
    await evaluate(send, `document.querySelector('[data-shortcut-clear="quick"]').click(), 'ok'`);
    await sleep(300);
    view = JSON.parse(await evaluate(send, `JSON.stringify({
      quick: document.getElementById('setting-key-quick').value,
      statusQuick: document.getElementById('status-quick').textContent,
      calls: window.__calls
    })`));
    const clearedCall = view.calls.find((c) => c[0] === 'clear' && c[1] === 'quick');
    check('点击确实调用了 clear', Boolean(clearedCall), JSON.stringify(view.calls));
    check('输入框清空', view.quick === '', JSON.stringify(view.quick));
    check('显示未绑定提示而非空白', view.statusQuick.includes('未绑定'), view.statusQuick);

    console.log('\n== 录入组合键 ==');
    const pointer = JSON.parse(await evaluate(send, `(()=>{const input=document.getElementById('setting-key-capture');document.getElementById('shortcut-restore').focus();window.__captureDelay=80;const event=new PointerEvent('pointerdown',{bubbles:true,cancelable:true});input.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented,active:document.activeElement.id});})()`));
    check('点击录入框时先阻止提前聚焦',pointer.prevented&&pointer.active==='shortcut-restore',JSON.stringify(pointer));
    await sleep(140);
    let captureReady = JSON.parse(await evaluate(send, `JSON.stringify({active:document.activeElement.id,calls:window.__calls})`));
    check('暂停旧快捷键后才聚焦录入框',captureReady.active==='setting-key-capture'&&captureReady.calls.some(c=>c[0]==='capture'&&c[1]===true),JSON.stringify(captureReady));
    await evaluate(send, `(function(){
      const input=document.getElementById('setting-key-capture');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'c',altKey:true,bubbles:true,cancelable:true}));
      input.dispatchEvent(new Event('blur'));
    })(), 'ok'`);
    await sleep(300);
    view = JSON.parse(await evaluate(send, `JSON.stringify({calls:window.__calls,capture:window.__state().bindings.capture})`));
    check('聚焦录入框先暂停全局快捷键', view.calls.some(c=>c[0]==='capture'&&c[1]===true), JSON.stringify(view.calls));
    check('Alt+C 作为录入值保存，不再误启动旧截图键', view.capture==='Alt+C'&&view.calls.some(c=>c[0]==='set'&&c[1]==='capture'&&c[2]==='Alt+C'), JSON.stringify(view));
    check('保存成功后恢复全局快捷键', view.calls.some(c=>c[0]==='capture'&&c[1]===false), JSON.stringify(view.calls));

    console.log('\n== 恢复默认 ==');
    await evaluate(send, `document.getElementById('shortcut-restore').click(), 'ok'`);
    await sleep(400);
    view = JSON.parse(await evaluate(send, `JSON.stringify({
      quick: document.getElementById('setting-key-quick').value,
      capture: document.getElementById('setting-key-capture').value,
      statusQuick: document.getElementById('status-quick').textContent,
      calls: window.__calls,
      bindings: window.__state().bindings
    })`));
    const restoreCall = view.calls.find((c) => c[0] === 'restoreDefault');
    check('点击确实调用了 restoreDefault', Boolean(restoreCall), JSON.stringify(view.calls));
    check('恢复后键位回到出厂值', view.bindings.quick === 'CommandOrControl+Alt+Space', JSON.stringify(view.bindings));
    check('恢复后输入框重新显示键位', view.quick.includes('Ctrl') && view.quick.includes('Alt'), view.quick);
    check('恢复后状态回到已生效', view.statusQuick.includes('已生效'), view.statusQuick);

    console.log('\n== 失败路径 ==');
    // 让 restoreDefault 返回失败，验证错误可见
    await evaluate(send, `(function(){
      window.suira.shortcuts.restoreDefault = async () => ({ ok:false, error:'被其他程序占用' });
      document.getElementById('shortcut-restore').click();
    })(), 'ok'`);
    await sleep(300);
    view = JSON.parse(await evaluate(send, `JSON.stringify({
      statusQuick: document.getElementById('status-quick').textContent,
      cls: document.getElementById('status-quick').className
    })`));
    check('失败时错误可见', view.statusQuick.includes('占用'), view.statusQuick);
    check('失败时用错误样式', view.cls.includes('is-error'), view.cls);

    console.log('\n== 组合键冲突后恢复原值 ==');
    await evaluate(send, `window.__setFailure='组合键已被占用';document.getElementById('setting-key-capture').dispatchEvent(new Event('focus'));true`);
    await sleep(80);
    await evaluate(send, `(function(){const input=document.getElementById('setting-key-capture');input.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',altKey:true,bubbles:true,cancelable:true}));})()`);
    await sleep(120);
    await evaluate(send, `document.getElementById('shortcut-restore').focus()`);
    await sleep(100);
    view=JSON.parse(await evaluate(send,`JSON.stringify({capture:document.getElementById('setting-key-capture').value,status:document.getElementById('status-capture').textContent,calls:window.__calls})`));
    check('改键失败后保留原绑定并释放录入状态',view.capture.includes('Ctrl')&&view.capture.includes('Shift')&&view.calls.some(c=>c[0]==='capture'&&c[1]===false),JSON.stringify(view));

    ws.close();
  } finally {
    try { child.kill(); } catch {}
  }

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('检查失败：' + e.message);
  process.exit(1);
});
