'use strict';
/*
 * 在真实 Electron 里验证浮引岛 + 按住型唤起的接线（不是无头模拟）。
 *
 * 背景：本机 Electron 从工作区内部启动会被 ACL 挡住（退出码 0x80000003），
 * 所以和 electron-real-check.js 一样，用工作区外的 Electron 加载本项目页面，
 * 再通过 --remote-debugging-port 连真实窗口做验证。
 *
 * 用法：
 *   1) 带调试口启动应用（数据目录指到工作区内，别污染真实用户数据）：
 *      C:\\temp\\el45\\electron.exe . --remote-debugging-port=9223 --user-data-dir=.udata/verify
 *   2) node tools/electron-island-check.js
 *
 * 这个脚本只读/只写临时文件，结束时清空浮引岛暂存，不删用户数据。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.SUIRA_CDP_PORT || 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

async function listTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await res.json();
  } catch {
    return null;
  }
}

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
  // 统一包成 async IIFE：页面里的 getState/addPaths 都返回 Promise，
  // 顶层 await 在 Runtime.evaluate 里不合法，包装后 awaitPromise 才能拿到值。
  const wrapped = `(async () => (${expression}))()`;
  const r = await send('Runtime.evaluate', { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'evaluate failed');
  }
  return r.result ? r.result.value : undefined;
}

(async () => {
  const targets = await listTargets();
  if (!targets) {
    console.error('连不上 ' + PORT + '。请先带 --remote-debugging-port=' + PORT + ' 启动应用。');
    process.exit(1);
  }
  const mainTarget = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  const panelTarget = targets.find((t) => t.type === 'page' && t.url.includes('quickpanel.html'));
  const islandTarget = targets.find((t) => t.type === 'page' && t.url.includes('island.html'));
  console.log('\n== 真实 Electron 窗口 ==');
  targets.filter((t) => t.type === 'page').forEach((t) => console.log('  ' + t.title + '  ' + t.url.split('/').pop()));
  check('主窗口已创建', Boolean(mainTarget));
  check('动作面板已创建', Boolean(panelTarget));
  check('浮引岛窗口已创建（island.html 真实加载）', Boolean(islandTarget));
  if (!mainTarget || !islandTarget) throw new Error('缺少必要的窗口，无法继续');

  const main = await connect(mainTarget.webSocketDebuggerUrl);
  const island = await connect(islandTarget.webSocketDebuggerUrl);
  await main.send('Runtime.enable');
  await island.send('Runtime.enable');

  console.log('\n== preload 契约 ==');
  const apiKeys = await evaluate(island.send, `JSON.stringify(Object.keys(window.suira.island || {}).sort())`);
  const keys = JSON.parse(apiKeys);
  for (const method of ['getState', 'addPaths', 'pathForFile', 'removeItem', 'clear', 'setPolicy', 'setExpanded', 'openItem', 'startDrag', 'onState', 'onExpanded', 'toggle']) {
    check('preload 暴露 island.' + method, keys.includes(method), apiKeys);
  }
  const panelHasMode = await (async () => {
    const panel = await connect(panelTarget.webSocketDebuggerUrl);
    await panel.send('Runtime.enable');
    const has = await evaluate(panel.send, `typeof window.suira.quick.onMode === 'function'`);
    panel.ws.close();
    return has;
  })();
  check('动作面板有布局轮换通道 quick.onMode', panelHasMode === true);

  console.log('\n== 浮引岛：窗口尺寸与状态 ==');
  const collapsedSize = await evaluate(island.send, `JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`);
  const collapsed = JSON.parse(collapsedSize);
  check('收起态窗口 176×44', collapsed.w === 176 && collapsed.h === 44, collapsedSize);
  const initial = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.getState())`));
  check('初始状态带 items / policy / expanded / maxItems', Array.isArray(initial.items) && typeof initial.policy === 'string' && typeof initial.expanded === 'boolean' && initial.maxItems === 24, JSON.stringify(initial));
  check('浮引岛在屏幕上可见', initial.visible === true, JSON.stringify(initial));

  console.log('\n== 浮引岛：加入 / 去重 / 拖入策略 ==');
  const sandbox = path.join(os.tmpdir(), 'suira-island-e2e-' + process.pid);
  fs.mkdirSync(sandbox, { recursive: true });
  const fileA = path.join(sandbox, 'note-a.txt');
  const fileB = path.join(sandbox, 'note-b.png');
  fs.writeFileSync(fileA, 'a');
  fs.writeFileSync(fileB, 'b');
  const addResult = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.addPaths(${JSON.stringify([fileA, fileB])}))`));
  check('拖入两个文件后暂存 2 条', addResult.items && addResult.items.length === 2, JSON.stringify(addResult.items));
  check('返回结构含 added 计数', addResult.added === 2, JSON.stringify(addResult));
  const dupResult = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.addPaths(${JSON.stringify([fileA])}))`));
  check('重复路径不重复入岛', dupResult.items.length === 2, JSON.stringify(dupResult.items));
  check('图片按扩展名分类为 image', dupResult.items.some((i) => i.kind === 'image'), JSON.stringify(dupResult.items));
  const expandedSize = await evaluate(island.send, `JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`);
  const expanded = JSON.parse(expandedSize);
  check('加入文件后自动展开为 520×148', expanded.w === 520 && expanded.h === 148, expandedSize);
  const policy = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.setPolicy('move'))`));
  check('拖入策略可切到 move', policy.policy === 'move', JSON.stringify(policy));
  await evaluate(island.send, `window.suira.island.setPolicy('copy')`);

  console.log('\n== 浮引岛：持久化 / 移除 / 清空 ==');
  const removeId = dupResult.items[0].id;
  const afterRemove = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.removeItem(${JSON.stringify(removeId)}))`));
  check('移除一条后剩 1 条', afterRemove.items.length === 1, JSON.stringify(afterRemove.items));
  const missing = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.openItem('not-exist'))`));
  check('打开不存在的条目返回失败原因', missing.ok === false && Boolean(missing.error), JSON.stringify(missing));
  const afterClear = JSON.parse(await evaluate(island.send, `JSON.stringify(await window.suira.island.clear())`));
  check('清空后暂存为空', afterClear.items.length === 0, JSON.stringify(afterClear.items));
  const collapsedAgain = JSON.parse(await evaluate(island.send, `JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`));
  check('收起后窗口回到 176×44', collapsedAgain.w === 176 && collapsedAgain.h === 44, JSON.stringify(collapsedAgain));

  console.log('\n== 快捷键：布局轮换 / 钉图显隐 / 按住型 ==');
  const shortcuts = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.shortcuts.get())`));
  for (const name of ['quick', 'capture', 'panelCycle', 'pinnedToggle', 'momentary']) {
    check('快捷键状态包含 ' + name, shortcuts.status && Boolean(shortcuts.status[name]), JSON.stringify(shortcuts.bindings));
  }
  check('面板布局轮换默认 Ctrl+Alt+Q', String(shortcuts.bindings.panelCycle || '').includes('Alt+Q'), shortcuts.bindings.panelCycle);
  check('钉图显隐默认 Ctrl+Alt+H', String(shortcuts.bindings.pinnedToggle || '').includes('Alt+H'), shortcuts.bindings.pinnedToggle);
  check('按住型唤起状态带 watching 字段', typeof shortcuts.status.momentary.watching === 'boolean', JSON.stringify(shortcuts.status.momentary));
  check('按住型侦测在真实主进程里已运行（PowerShell 助手 watching）', shortcuts.status.momentary.watching === true, JSON.stringify(shortcuts.status.momentary));

  // 恢复现场：清空暂存、删临时文件
  await evaluate(island.send, `window.suira.island.clear()`).catch(() => {});
  fs.rmSync(sandbox, { recursive: true, force: true });
  main.ws.close();
  island.ws.close();
  await sleep(200);

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch(async (error) => {
  console.error('验证失败：' + (error && error.message ? error.message : error));
  // 直接 exit 会在 WebSocket 句柄关闭中触发 libuv 断言，让事件循环先收尾
  await sleep(300);
  process.exit(1);
});
