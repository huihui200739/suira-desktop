'use strict';
/*
 * 在真实 Electron 里验证速记（第三批第 4 项）。
 *
 * 为什么要这个脚本：无头 Chrome 只能证明渲染层逻辑对，证明不了
 * 「preload 真的注入了 notes 命名空间」「IPC 真的连到主进程」「窗口真的被创建出来」。
 * 这三件事只能在真实 Electron 里验。
 *
 * 与仓库其它 verify:* 脚本一致：Electron 必须从工作区外启动
 * （工作区目录有沙箱 ACL，工作区内的 electron.exe 会崩 0x80000003）。
 *
 * 用法：node tools/electron-notes-check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9233;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pass = 0, fail = 0;
const check = (name, condition, detail) => {
  if (condition) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

function findWorkingElectron() {
  const candidates = [
    process.env.SUIRA_ELECTRON,
    'C:\\suira-electron\\electron.exe',
    path.join(os.homedir(), 'suira-electron-dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function listTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForApp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets();
    if (targets && targets.some((target) => target.url.includes('index.html'))) return targets;
    await sleep(500);
  }
  return null;
}

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
        }, 20000);
      });
    }
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result ? result.result.value : undefined;
}

(async () => {
  if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error('请先清除 ELECTRON_RUN_AS_NODE：Remove-Item Env:\\ELECTRON_RUN_AS_NODE');
    process.exit(1);
  }
  const electron = findWorkingElectron();
  if (!electron) {
    console.log('跳过：未找到工作区外可用的 Electron（用 SUIRA_ELECTRON 指定路径可启用本检查）');
    process.exit(0);
  }

  // 数据目录落在工作区内：受管控环境下 AppData 对 Electron 不可写
  const userData = path.join(ROOT, '.udata-notes-e2e');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });

  console.log('\n使用 Electron: ' + electron);
  const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true
  });

  let connection = null;
  try {
    const targets = await waitForApp();
    if (!targets) throw new Error('应用未能在 30 秒内启动');
    const main = targets.find((target) => target.url.includes('index.html'));
    connection = await connect(main.webSocketDebuggerUrl);
    await connection.send('Runtime.enable');

    console.log('\n== preload 与 IPC ==');
    const hasNamespace = await evaluate(connection.send,
      `typeof window.suira === 'object' && typeof window.suira.notes === 'object'`);
    check('preload 注入了 notes 命名空间', hasNamespace === true);

    const apiShape = await evaluate(connection.send,
      `JSON.stringify(Object.keys(window.suira.notes).sort())`);
    check('notes 接口齐备', ['create', 'get', 'list', 'open', 'remove', 'togglePin', 'update']
      .every((name) => String(apiShape).includes(name)), apiShape);

    console.log('\n== 真实链路：建 → 改 → 钉 → 开 → 删 ==');
    const created = await evaluate(connection.send, `window.suira.notes.create()`);
    check('creates 返回 ok 与 id', Boolean(created && created.ok && created.id), JSON.stringify(created));
    const noteId = created && created.id;

    await sleep(400);
    const openedWindows = await listTargets();
    check('速记窗口真的被创建出来',
      Boolean(openedWindows && openedWindows.some((target) => target.url.includes('notes.html'))),
      JSON.stringify((openedWindows || []).map((target) => target.url.split('/').pop())));

    const updated = await evaluate(connection.send,
      `window.suira.notes.update({ id: ${JSON.stringify(noteId)}, text: '真实 Electron 速记\\n第二行', richText:'<h1>真实 Electron 速记</h1><p>第二行</p>' })`);
    check('update 返回 ok', Boolean(updated && updated.ok), JSON.stringify(updated));
    check('标题由正文推导', updated && updated.note && updated.note.title === '真实 Electron 速记',
      updated && updated.note && updated.note.title);

    const pinned = await evaluate(connection.send,
      `window.suira.notes.togglePin(${JSON.stringify(noteId)})`);
    check('togglePin 往返为 true → false',
      Boolean(pinned && pinned.note && pinned.note.pinned === true), JSON.stringify(pinned && pinned.note));
    const unpinned = await evaluate(connection.send,
      `window.suira.notes.togglePin(${JSON.stringify(noteId)})`);
    check('再切一次回到未钉住', Boolean(unpinned && unpinned.note && unpinned.note.pinned === false));

    const reopened = await evaluate(connection.send,
      `window.suira.notes.open(${JSON.stringify(noteId)})`);
    check('已开窗口的 open 返回 ok（置前而不是重复建）', Boolean(reopened && reopened.ok), JSON.stringify(reopened));

    await sleep(900);
    const noteTarget = (await listTargets()).find(target => target.url.endsWith('/notes.html'));
    const noteConnection = await connect(noteTarget.webSocketDebuggerUrl);
    try {
      check('富文本通过真实 IPC 渲染为标题', await evaluate(noteConnection.send,
        `document.querySelector('#note-body h1')?.textContent`) === '真实 Electron 速记');
    } finally { noteConnection.ws.close(); }
    console.log('\n== 落盘 ==');
    const dataFile = path.join(userData, 'suira-data.json');
    check('数据文件已写出', fs.existsSync(dataFile));
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    check('notes 段落盘', Array.isArray(raw.notes) && raw.notes.length >= 1,
      JSON.stringify((raw.notes || []).length));
    const leaked = (raw.notes || []).filter((note) => typeof note.text === 'string' && note.text.length > 0);
    check('正文在磁盘上是加密信封（不落明文）', leaked.length === 0, JSON.stringify(leaked.slice(0, 1)));
    check('富文本同样使用加密信封', (raw.notes || []).some(note => typeof note.richText === 'object' && note.richText !== null));
    check('磁盘上不出现刚写的明文', !fs.readFileSync(dataFile, 'utf8').includes('真实 Electron 速记'));

    console.log('\n== 清理 ==');
    const removed = await evaluate(connection.send, `window.suira.notes.remove(${JSON.stringify(noteId)})`);
    check('删除返回 ok', Boolean(removed && removed.ok), JSON.stringify(removed));
    await sleep(600);
    const after = await evaluate(connection.send, `window.suira.notes.list()`);
    check('删除后列表里不再有这条', !(after || []).some((note) => note.id === noteId), JSON.stringify(after));
    const gone = await listTargets();
    check('删除后窗口已关闭',
      !(gone || []).some((target) => target.url.includes('notes.html')),
      JSON.stringify((gone || []).map((target) => target.url.split('/').pop())));
  } catch (error) {
    console.log('  FAIL  真实 Electron 速记链路异常 -> ' + error.message);
    fail += 1;
  } finally {
    if (connection && connection.ws) { try { connection.ws.close(); } catch {} }
    try { child.kill(); } catch {}
    await sleep(800);
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 2 }); } catch { /* 清理失败不影响结果 */ }
  }

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('启动失败：' + error.message);
  process.exit(1);
});
