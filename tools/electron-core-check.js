'use strict';
/*
 * 在真实 Electron 里验证「截图 / 剪贴板 / 主体」三大基础框架的核心链路。
 *
 * 自行启动隔离实例，使用临时资料库与模拟剪贴板，不连接用户实例。
 *
 * 用法：node tools/electron-core-check.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'suira-core-e2e-'));
const USER_DATA = path.join(tempDir, 'profile');
const input = path.join(tempDir, 'clipboard-input.json');
const output = path.join(tempDir, 'clipboard-output');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];
let PORT, child, exited;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};
const ps = (command) => execFileSync('powershell.exe', ['-NoProfile', '-Sta', '-Command', command], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 20000
}).trim();

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => { sockets.push(ws); resolve({ ws, send }); });
    ws.addEventListener('error', () => reject(new Error('WS error')));
    ws.addEventListener('close', () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Electron debugger disconnected'));
      }
      pending.clear();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
        else entry.resolve(msg.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const mid = ++id;
        const timer = setTimeout(() => { if (pending.delete(mid)) j(new Error('timeout ' + method)); }, 120000);
        pending.set(mid, { resolve: r, reject: j, timer });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    }
  });
}

async function evaluate(send, expression) {
  const wrapped = `(async () => (${expression}))()`;
  const r = await send('Runtime.evaluate', { expression: wrapped, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'evaluate failed');
  }
  return r.result ? r.result.value : undefined;
}

const listItems = (send) => evaluate(send, `JSON.stringify(await window.suira.content.list({ limit: 50 }))`).then((raw) => JSON.parse(raw));

/** 等待异步原生通知和保存，不假定采集间隔。 */
async function waitFor(check, timeoutMs = 6000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

(async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  PORT = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const entry = path.join(tempDir, 'app.js');
  fs.writeFileSync(entry, `
    const { app, clipboard, globalShortcut } = require('electron');
    const fs = require('node:fs');
    const input = ${JSON.stringify(input)}, output = ${JSON.stringify(output)};
    app.setPath('userData', ${JSON.stringify(USER_DATA)});
    globalShortcut.register = () => false;
    let sequence = 1, types = {};
    const { InputInjector } = require(${JSON.stringify(path.join(root, 'lib/input-injector'))});
    InputInjector.prototype.clipboardSequence = () => sequence;
    InputInjector.prototype.paste = async () => { throw Error('System paste is disabled in this fixture'); };
    const { ForegroundProbe } = require(${JSON.stringify(path.join(root, 'lib/foreground-probe'))});
    ForegroundProbe.prototype.pasteTo = async () => ({ ok: false });
    clipboard.availableFormats = () => [];
    clipboard.read = async () => Object.keys(types).length ? [{ types: Object.keys(types), getType: async type => types[type] }] : [];
    clipboard.readText = async () => types['text/plain'] || '';
    clipboard.writeText = async text => { types = { 'text/plain': text }; sequence++; fs.writeFileSync(output, 'text'); };
    clipboard.write = async items => {
      const image = await items[0]?.getType('image/png');
      types = image ? { 'image/png': image } : {};
      sequence++;
      fs.writeFileSync(output, image ? 'image' : 'other');
    };
    const events = require(${JSON.stringify(path.join(root, 'lib/windows-clipboard-events'))});
    const watch = events.watchWindowsClipboard;
    events.watchWindowsClipboard = (win, callback) => {
      const dispose = watch(win, callback);
      const ffi = require(${JSON.stringify(path.join(root, 'node_modules/koffi'))});
      const notify = ffi.load('user32.dll').func('__stdcall', 'PostMessageW', 'int', ['uintptr_t','uint32','uintptr_t','intptr_t']);
      const timer = setInterval(() => {
        if (!fs.existsSync(input)) return;
        const data = JSON.parse(fs.readFileSync(input, 'utf8'));
        fs.unlinkSync(input);
        types = data.image ? { 'image/png': new Blob([Buffer.from(data.image, 'base64')]) } : data.types;
        sequence++;
        if (!notify(win.getNativeWindowHandle().readBigUInt64LE(), 0x031d, 0, 0)) throw Error('Clipboard notification failed');
      }, 40);
      return () => { clearInterval(timer); dispose(); };
    };
    require(${JSON.stringify(path.join(root, 'main.js'))});
  `);
  const executable = [process.env.SUIRA_TEST_ELECTRON, 'C:/suira-electron/electron.exe', path.join(root, 'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
  assert.ok(executable, 'An Electron runtime must be installed');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [entry, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${PORT}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  exited = once(child, 'exit').catch(error => { console.error(error.message); process.exitCode = 1; });
  const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page');
  const overlayTargets = async () => (await pageTargets()).filter(t => t.url.endsWith('/overlay.html'));
  const mainTarget = await waitFor(async () => {
    try { return (await pageTargets()).find(t => t.url.endsWith('/index.html')); } catch { return null; }
  });
  assert.ok(mainTarget, '找不到隔离实例的主窗口');
  const main = await connect(mainTarget.webSocketDebuggerUrl);
  await main.send('Runtime.enable');
  assert.ok(await waitFor(() => evaluate(main.send, 'Boolean(window.suira && document.querySelector(".nav-item"))')));
  const startOverlay = async () => {
    const result = await evaluate(main.send, 'window.suira.capture.start()');
    assert.ok(result.ok, JSON.stringify(result));
    const target = await waitFor(async () => (await overlayTargets())[0]);
    assert.ok(target, '截图覆盖层未就绪');
    return connect(target.webSocketDebuggerUrl);
  };
  const finishCapture = async (dataUrl, action) => {
    const overlay = await startOverlay();
    try {
      const result = await evaluate(overlay.send, `window.suira.capture.finish(${JSON.stringify({ dataUrl, action })})`);
      if (action === 'ocr') await evaluate(overlay.send, 'window.suira.capture.cancel()');
      return result;
    } finally { overlay.ws.close(); }
  };
  const png = new PNG({ width: 36, height: 36 });
  png.data.fill(255);
  const dataUrl = () => 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
  const pngDataUrl = dataUrl();
  const writeFixture = value => {
    fs.writeFileSync(input + '.tmp', JSON.stringify(value));
    fs.renameSync(input + '.tmp', input);
  };
  const writeText = text => writeFixture({ types: { 'text/plain': text } });

  console.log('\n== 截图：复制 ==');
  const copyResult = await finishCapture(pngDataUrl, 'copy');
  check('截图完成并入库（action=copy）', copyResult.ok === true && Boolean(copyResult.item?.id), JSON.stringify(copyResult).slice(0, 200));
  check('截图条目类型为 image', copyResult.item?.kind === 'image', copyResult.item?.kind);
  // 同一张图重复截图会命中 hash 去重、删掉新写的文件并复用旧条目，
  // 所以这里校验「条目实际指向的文件存在」而不是「新写的那份存在」。
  const captureFile = copyResult.item?.filePath || copyResult.filePath;
  check('截图文件已落盘', Boolean(captureFile) && fs.existsSync(captureFile), captureFile);
  check('复制写入了图片格式', fs.readFileSync(output, 'utf8') === 'image');

  console.log('\n== 截图：钉图 ==');
  const pinResult = await finishCapture(pngDataUrl, 'pin');
  check('钉图完成', pinResult.ok === true, JSON.stringify(pinResult).slice(0, 200));
  const pin = await waitFor(async () => (await pageTargets()).find(t => t.url.endsWith('/pin.html')));
  check('钉图后打开独立窗口', Boolean(pin));

  console.log('\n== 截图：提字 ==');
  const ocrPng = path.join(tempDir, 'ocr-sample.png');
  ps([
    "Add-Type -AssemblyName System.Drawing",
    '$bmp = New-Object System.Drawing.Bitmap 520,150',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.Clear([System.Drawing.Color]::White)',
    "$font = New-Object System.Drawing.Font 'Arial',40",
    "$g.DrawString('HELLO SUIRA 2026', $font, [System.Drawing.Brushes]::Black, 12, 48)",
    "$bmp.Save('" + ocrPng.replace(/'/g, "''") + "', [System.Drawing.Imaging.ImageFormat]::Png)",
    '$g.Dispose(); $bmp.Dispose()'
  ].join('; '));
  const ocrDataUrl = 'data:image/png;base64,' + fs.readFileSync(ocrPng).toString('base64');
  const ocrResult = await finishCapture(ocrDataUrl, 'ocr');
  check('截图提字返回成功', ocrResult.ok === true, JSON.stringify(ocrResult).slice(0, 200));
  check('识别结果非空', Boolean(ocrResult.output?.text && ocrResult.output.text.trim().length), ocrResult.output?.text);
  check('识别结果与原图建立派生关系', (ocrResult.output?.parentIds || []).includes(ocrResult.item?.id), JSON.stringify(ocrResult.output?.parentIds));

  console.log('\n== 剪贴板：文本 ==');
  writeText('E2E-TEXT-001 core framework');
  const textItem = await waitFor(async () => {
    const items = await listItems(main.send);
    return items.find((item) => item.source?.type === 'clipboard' && String(item.text).includes('E2E-TEXT-001'));
  });
  check('剪贴板文本被采集', Boolean(textItem), '等待 6 秒仍未入库');
  check('文本条目带来源对象（type=clipboard）', textItem?.source?.type === 'clipboard', JSON.stringify(textItem?.source));
  check('文本条目记录了通知采集方式', textItem?.source?.acquisitionMethod === 'clipboard-update', textItem?.source?.acquisitionMethod);
  check('文本条目记录了来源应用字段', typeof textItem?.source?.appName === 'string', JSON.stringify(textItem?.source));

  console.log('\n== 剪贴板：文件引用 ==');
  const fileA = path.join(tempDir, 'e2e-a.txt');
  const fileB = path.join(tempDir, 'e2e-b.txt');
  fs.writeFileSync(fileA, 'a');
  fs.writeFileSync(fileB, 'b');
  writeFixture({ types: { 'text/uri-list': [fileA, fileB].map(file => pathToFileURL(file).href).join('\r\n') } });
  const filesItem = await waitFor(async () => {
    const items = await listItems(main.send);
    return items.find((item) => item.kind === 'files' && String(item.text).includes(fileA));
  });
  check('复制文件后采集为 files 类型', Boolean(filesItem), '等待 6 秒仍未入库');
  check('文件名进入标题', String(filesItem?.title || '').includes('e2e-a.txt'), filesItem?.title);
  check('两个绝对路径都在正文里', String(filesItem?.text || '').includes(fileA) && String(filesItem?.text || '').includes(fileB), String(filesItem?.text || '').slice(0, 200));
  check('filePath 指向第一个文件', filesItem?.filePath === fileA, filesItem?.filePath);
  const allFilesItems = (await listItems(main.send)).filter((item) => item.kind === 'files' && String(item.text).includes(tempDir));
  check('文件条目不重复入库', allFilesItems.length === 1, 'files items = ' + allFilesItems.length);

  console.log('\n== 剪贴板：重复内容置顶 ==');
  writeText('E2E-DEDUPE-AAA');
  await waitFor(async () => (await listItems(main.send)).some((item) => String(item.text) === 'E2E-DEDUPE-AAA'));
  writeText('E2E-DEDUPE-BBB');
  await waitFor(async () => (await listItems(main.send)).some((item) => String(item.text) === 'E2E-DEDUPE-BBB'));
  writeText('E2E-DEDUPE-AAA');
  const dupItem = await waitFor(async () => {
    const items = await listItems(main.send);
    return items[0]?.text === 'E2E-DEDUPE-AAA' ? items : null;
  });
  const dedupeList = dupItem || (await listItems(main.send));
  const dupItems = dedupeList.filter((item) => String(item.text) === 'E2E-DEDUPE-AAA');
  check('同样的文字只保留一条', dupItems.length === 1, 'count = ' + dupItems.length);
  check('再次复制后回到列表最前', dedupeList[0]?.text === 'E2E-DEDUPE-AAA', dedupeList[0]?.text);

  console.log('\n== 剪贴板：图片 ==');
  for (let i = 0; i < png.data.length; i += 4) png.data[i] = 0;
  writeFixture({ image: dataUrl().split(',')[1] });
  const clipboardImage = await waitFor(async () => {
    const list = await listItems(main.send);
    return list.find((item) => item.kind === 'image' && item.source?.type === 'clipboard');
  });
  const imageItems = await listItems(main.send);
  check('剪贴板图片被采集', Boolean(clipboardImage), JSON.stringify(imageItems.slice(0, 3).map((i) => i.kind + ':' + i.source?.type)));
  check('图片缩略图已生成', Boolean(clipboardImage?.thumbnail), String(clipboardImage?.thumbnail || '').slice(0, 24));
  check('图片按 hash 去重（同图只一条）', imageItems.filter((i) => i.kind === 'image' && i.source?.type === 'clipboard').length === 1, 'count');

  console.log('\n== 主体：粘贴回原窗口（复制兜底） ==');
  const pasteTarget = textItem || (await listItems(main.send)).find((item) => String(item.text).includes('E2E-TEXT-001'));
  const commitResult = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.returnTo.commit({ itemId: ${JSON.stringify(pasteTarget?.id || '')}, intent: 'return-and-paste' }))`));
  check('放回接口可用且返回复制结果', commitResult.ok === true && commitResult.copied === true, JSON.stringify(commitResult));
  check('返回可读的解释文案', typeof commitResult.message === 'string' && commitResult.message.length > 0, commitResult.message);

  console.log('\n== 主体：内容库预览 / 粘贴 / 定位按钮 ==');
  await evaluate(main.send, `document.querySelector('[data-page="library"]').click()`);
  await sleep(500);
  const libraryUi = JSON.parse(await evaluate(main.send, `JSON.stringify({
    cards: document.querySelectorAll('.library-card').length,
    paste: document.querySelectorAll('.library-card [data-paste]').length,
    reveal: document.querySelectorAll('.library-card [data-reveal]').length,
    previewHidden: document.getElementById('preview').hidden
  })`));
  check('内容库渲染出卡片', libraryUi.cards > 0, JSON.stringify(libraryUi));
  check('内容库卡片带「粘贴」按钮', libraryUi.paste > 0, JSON.stringify(libraryUi));
  check('文件条目带「所在文件夹」按钮', libraryUi.reveal > 0, JSON.stringify(libraryUi));
  check('预览层默认关闭', libraryUi.previewHidden === true, JSON.stringify(libraryUi));
  await evaluate(main.send, `document.querySelector('.library-card').click()`);
  await sleep(350);
  const preview = JSON.parse(await evaluate(main.send, `JSON.stringify({
    hidden: document.getElementById('preview').hidden,
    title: document.getElementById('preview-title').textContent,
    bodyLength: document.getElementById('preview-body').innerText.length,
    images: document.querySelectorAll('#preview-body img').length
  })`));
  check('点卡片主体打开预览层', preview.hidden === false, JSON.stringify(preview));
  check('预览层显示标题与内容（文字或图片）', preview.title.length > 0 && (preview.bodyLength > 0 || preview.images > 0), JSON.stringify(preview));
  await evaluate(main.send, `document.getElementById('preview-close').click()`);
  await sleep(250);
  const previewClosed = JSON.parse(await evaluate(main.send, `JSON.stringify({ hidden: document.getElementById('preview').hidden })`));
  check('关闭按钮能退出预览层', previewClosed.hidden === true, JSON.stringify(previewClosed));

  console.log('\n== 主体：处理轨迹失败重试 ==');
  // 用「文字内容跑 OCR」制造一次真实失败：文字没有图片文件可识别
  const retryTarget = pasteTarget;
  await evaluate(main.send, `window.suira.actions.run(${JSON.stringify(retryTarget?.id || '')}, 'ocr.local')`);
  await sleep(400);
  const executions = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.executions.list(50))`));
  const failedExecution = executions.find((entry) => entry.status === 'failed');
  check('失败动作被记录在轨迹里', Boolean(failedExecution), JSON.stringify(executions.slice(0, 2)));
  if (failedExecution) {
    const retryResult = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.executions.retry(${JSON.stringify(failedExecution.id)}))`));
    check('失败记录可调用重试接口', typeof retryResult === 'object' && 'ok' in retryResult, JSON.stringify(retryResult).slice(0, 200));
    const afterExecutions = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.executions.list(50))`));
    check('重试会产生新的执行记录', afterExecutions.length > executions.length, executions.length + ' -> ' + afterExecutions.length);
  }

  console.log('\n== 主体：内容预览中的轨迹重试按钮 ==');
  await evaluate(main.send, `document.querySelector(${JSON.stringify(`[data-preview="${retryTarget?.id}"]`)}).click()`);
  await evaluate(main.send, 'document.querySelector("#preview-trail > summary").click()');
  const retryVisible = await waitFor(() => evaluate(main.send, 'Boolean(document.querySelector("#preview-trail[open] [data-trace-retry]"))'));
  check('内容预览中的失败记录可重试', Boolean(retryVisible));
  if (retryVisible) {
    const beforeClick = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.executions.list(50))`)).length;
    await evaluate(main.send, `document.querySelector('[data-trace-retry]').click()`);
    check('点「重试」真实触发一次新的执行', Boolean(await waitFor(() => evaluate(main.send, `(async () => (await window.suira.executions.list(50)).length > ${beforeClick})()`))));
  }
  await evaluate(main.send, `document.querySelector('#preview-close').click()`);

  console.log('\n== 主体：窗口状态记忆 ==');
  const dataPath = path.join(USER_DATA, 'suira-data.json');
  const readWindowState = () => {
    try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')).windowState || null; } catch { return null; }
  };
  // Electron 不实现 CDP 的 Browser.setWindowBounds，改用应用自己的最大化入口：
  // 最大化/还原会触发主进程的记忆逻辑，能验证「状态确实落盘」。
  await evaluate(main.send, `window.suira.window.maximize()`);
  await sleep(1400);
  const maximizedState = readWindowState();
  check('最大化后写入 windowState', Boolean(maximizedState), dataPath);
  check('windowState 记录 maximized=true', maximizedState?.maximized === true, JSON.stringify(maximizedState));
  check('windowState 记录了有效宽高', Number(maximizedState?.width) > 0 && Number(maximizedState?.height) > 0, JSON.stringify(maximizedState));
  await evaluate(main.send, `window.suira.window.maximize()`);
  await sleep(1400);
  const restoredState = readWindowState();
  check('还原后 windowState 回到 maximized=false', restoredState?.maximized === false, JSON.stringify(restoredState));

  console.log('\n== 截图：预热覆盖层 / 工具栏时序 / 合帧 ==');
  const overlay = await startOverlay();
  check('截图覆盖层窗口已出现', Boolean(overlay));
  await overlay.send('Runtime.enable');
  const ready = await waitFor(async () => {
    const hidden = await evaluate(overlay.send, `document.getElementById('loading-state').hidden`);
    return hidden === true ? true : null;
  }, 8000);
  check('覆盖层画面加载完成（loading 消失）', ready === true);

  // 模拟真实框选：按下 → 多次移动（同一帧内应被合并）→ 松开
  const dispatchPointer = (type, x, y) => evaluate(overlay.send, `
    document.getElementById('capture-root').dispatchEvent(new PointerEvent('${type}', {
      bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y},
      button: 0, buttons: ${type === 'pointerup' ? 0 : 1}, pointerId: 1, pointerType: 'mouse'
    }))`);
  await dispatchPointer('pointerdown', 120, 120);
  for (let i = 1; i <= 6; i += 1) await dispatchPointer('pointermove', 120 + i * 40, 120 + i * 24);
  // 合帧是用 requestAnimationFrame 做的：等一帧再断言，否则读到的是「还没应用」
  await sleep(180);
  const during = JSON.parse(await evaluate(overlay.send, `JSON.stringify({
    dockHidden: document.getElementById('tool-dock').hidden,
    selectionHidden: document.getElementById('selection').hidden,
    selectionWidth: parseFloat(document.getElementById('selection').style.width) || 0
  })`));
  check('拖动中不出现编辑工具栏', during.dockHidden === true, JSON.stringify(during));
  check('拖动中橡皮筋选区可见', during.selectionHidden === false && during.selectionWidth > 0, JSON.stringify(during));
  await dispatchPointer('pointerup', 400, 280);
  await sleep(250);
  const after = JSON.parse(await evaluate(overlay.send, `JSON.stringify({
    dockHidden: document.getElementById('tool-dock').hidden,
    dims: document.querySelectorAll('.dim').length
  })`));
  check('松开鼠标后编辑工具栏出现', after.dockHidden === false, JSON.stringify(after));
  check('选区外压暗用 4 块矩形（不再用 100vmax 阴影）', after.dims === 4, JSON.stringify(after));

  const perf = JSON.parse(await evaluate(overlay.send, `JSON.stringify(window.__lastCapturePerf || {})`));
  check('pointermove 合帧生效（帧数少于事件数）',
    Number(perf.framesApplied) > 0 && Number(perf.framesApplied) < Number(perf.pointerMoves),
    JSON.stringify(perf));

  await evaluate(overlay.send, `window.suira.capture.cancel()`);
  await sleep(400);
  check('取消后覆盖层被隐藏而不是销毁', (await overlayTargets()).length === 1);
  check('隐藏后页面 visibilityState=hidden', await evaluate(overlay.send, `document.visibilityState`) === 'hidden');

  await evaluate(main.send, `window.suira.capture.start()`);
  const visibleAgain = await waitFor(async () => {
    const state = await evaluate(overlay.send, `document.visibilityState`);
    return state === 'visible' ? true : null;
  }, 6000);
  check('第二次唤起复用同一个预热窗口', visibleAgain === true && (await overlayTargets()).length === 1);
  await evaluate(overlay.send, `window.suira.capture.cancel()`);
  await sleep(300);

  console.log('\n== 底部剪贴板历史条 ==');
  await evaluate(main.send, `window.suira.clipboardBar.toggle()`);
  const barTarget = await waitFor(async () => {
    const list = await pageTargets();
    return list.find((t) => t.url.includes('clipboardbar.html')) || null;
  }, 8000);
  check('底部剪贴板条窗口已出现', Boolean(barTarget));
  const bar = await connect(barTarget.webSocketDebuggerUrl);
  await bar.send('Runtime.enable');
  const barReady = await waitFor(async () => {
    const cards = await evaluate(bar.send, `document.querySelectorAll('.bar-card').length`);
    return cards > 0 ? cards : null;
  }, 6000);
  check('历史条渲染出卡片（读取真实内容库）', Boolean(barReady), 'cards = ' + barReady);
  const barState = JSON.parse(await evaluate(bar.send, `JSON.stringify({
    selected: document.querySelector('.bar-card[aria-current="true"]')?.dataset.id || '',
    first: document.querySelector('.bar-card')?.dataset.id || '',
    pageScroll: document.documentElement.scrollHeight > window.innerHeight + 2,
    trackScrollable: (function () { var t = document.getElementById('bar-track'); return t ? t.scrollWidth > t.clientWidth : false; })()
  })`));
  check('默认选中第一条', barState.selected.length > 0 && barState.selected === barState.first, JSON.stringify(barState));
  check('历史条没有页面级滚动条', barState.pageScroll === false, JSON.stringify(barState));
  check('轨道可横向滚动（内容多于视口时）', barState.trackScrollable === true, JSON.stringify(barState));
  await evaluate(bar.send, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await sleep(200);
  const selectedAfterRight = await evaluate(bar.send, `document.querySelector('.bar-card[aria-current="true"]')?.dataset.id || ''`);
  check('→ 可以切换选中项', Boolean(selectedAfterRight) && selectedAfterRight !== barState.selected, barState.selected + ' -> ' + selectedAfterRight);
  await evaluate(bar.send, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);
  check('Esc 收起历史条', await evaluate(bar.send, `document.visibilityState`) === 'hidden');

  // 选中历史里的图片：应复制位图，而不是把文件路径当文本复制
  await evaluate(main.send, `window.suira.clipboardBar.toggle()`);
  await sleep(700);
  const imageItem = JSON.parse(await evaluate(main.send, `JSON.stringify((await window.suira.content.list({ limit: 60 })).find((i) => i.kind === 'image') || null)`));
  if (imageItem) {
    const commit = JSON.parse(await evaluate(main.send, `JSON.stringify(await window.suira.returnTo.commit({ itemId: ${JSON.stringify(imageItem.id)}, intent: 'return-and-paste' }))`));
    check('图片条目提交返回已复制', commit.ok === true && commit.copied === true, JSON.stringify(commit));
    check('图片条目复制的是图片而不是路径文本', fs.readFileSync(output, 'utf8') === 'image');
  }
  await evaluate(bar.send, `window.suira.clipboardBar.hide()`);

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exitCode = fail ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  for (const socket of sockets) socket.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
  assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
  assert.match(path.basename(tempDir), /^suira-core-e2e-[a-z0-9]+$/i);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
