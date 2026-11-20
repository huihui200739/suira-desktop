'use strict';
// Isolated real Electron regression: hotkey latency and paste into a local test editor.
// No real chat is opened. User data and the original clipboard are preserved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { connect } = require('./runtime-client');
const { ForegroundProbe } = require('../lib/foreground-probe');
const { ensureNativeHost } = require('../lib/key-watch');
const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-latency-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = [], children = [];
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await wait(20);
  }
  throw Error('等待测试状态超时');
}
async function page(port, suffix) {
  await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(t => t.url.endsWith(suffix)); } catch { return false; } });
  const client = await connect(port, t => t.url.endsWith(suffix));
  sockets.push(client.ws);
  return client;
}
function launch(exe, entry, port, args = []) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(path.join(TMP, path.basename(entry) + '.log'), 'w');
  const child = spawn(exe, [entry, `--remote-debugging-port=${port}`, ...args], { env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); children.push(child); return child;
}
let editor, probe;
(async () => {
  const exe = [process.env.SUIRA_ELECTRON, 'C:\\suira-electron\\electron.exe', path.join(os.homedir(), 'suira-electron-dist', 'electron.exe'), path.join(ROOT, 'node_modules/electron/dist/electron.exe')].filter(Boolean).find(p => fs.existsSync(p));
  assert.ok(exe, '找不到 Electron');
  const appPort = await freePort(), editorPort = await freePort();
  // Measure the actual panel paint without requiring OS foreground permission.
  // Native paste remains covered by running this tool without --panel-only.
  if (process.argv.includes('--panel-only')) {
    const entry = path.join(TMP, 'panel.js');
    fs.writeFileSync(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(TMP,'profile'))});require(${JSON.stringify(path.join(ROOT,'main.js'))});`);
    const started = performance.now();
    launch(exe, entry, appPort);
    const main = await page(appPort, '/index.html');
    const quick = await page(appPort, '/quickpanel.html');
    await quick.evaluate('document.fonts.ready.then(()=>true)');
    const panelLoadedMs = Math.round(performance.now()-started);
    const firstPaint = () => quick.evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.visibilityState==='visible')))))`);
    const quickReadyMs=[];
    for(let n=0;n<5;n++){
      const start=performance.now();
      await main.evaluate('window.suira.quick.show()');
      assert.ok(await firstPaint());
      quickReadyMs.push(Math.round(performance.now()-start));
      await quick.evaluate('window.suira.quick.hide()');
      await wait(150);
    }
    const report={panelLoadedMs,quickReadyMs,firstPanelReadyMs:quickReadyMs[0],font:await quick.evaluate('getComputedStyle(document.body).fontFamily')};
    if(process.argv.includes('--idle')){
      const before=(await (await fetch(`http://127.0.0.1:${appPort}/json/list`)).json()).find(t=>t.url.endsWith('/quickpanel.html')).id;
      console.log('Waiting 65 seconds to verify idle panel reuse…');
      await wait(65000);
      const after=(await (await fetch(`http://127.0.0.1:${appPort}/json/list`)).json()).find(t=>t.url.endsWith('/quickpanel.html')).id;
      assert.deepEqual(after,before);
      const start=performance.now();await main.evaluate('window.suira.quick.show()');assert.ok(await firstPaint());report.panelAfterIdleMs=Math.round(performance.now()-start);
    }
    fs.writeFileSync(path.join(TMP,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));console.log('PASS real panel font readiness, first paint and idle window reuse');return;
  }
  const dictation = process.argv.includes('--voice');
  const wrapper = path.join(TMP, 'app.js'), editorMain = path.join(TMP, 'editor.js'), html = path.join(TMP, 'editor.html');
  const fixture = dictation ? `const {globalShortcut,net}=require('electron');
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    const shortcuts = new Map();
    globalShortcut.register = (key, callback) => { shortcuts.set(key, callback); return true; };
    globalShortcut.isRegistered = key => shortcuts.has(key);
    globalShortcut.unregister = key => shortcuts.delete(key);
    globalShortcut.unregisterAll = () => shortcuts.clear();
    net.fetch = async () => ({ok:true,json:async()=>({text:'这是直接语音输入'})});
    const fs=require('node:fs'),trigger=${JSON.stringify(path.join(TMP,'voice-hotkey'))};
    let last='';setInterval(()=>{try{const next=fs.readFileSync(trigger,'utf8');if(next!==last){last=next;const action=shortcuts.get('Alt+H');console.log('Voice fixture:',next,Boolean(action));Promise.resolve(action?.()).catch(console.error);}}catch(error){if(error.code!=='ENOENT')console.error(error);}},30).unref();
  ` : '';
  fs.writeFileSync(wrapper, `const {app,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(path.join(TMP, 'app-data'))});
    ${fixture}
    const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,callback)=>handle(channel,channel==='return:commit'?async(...args)=>{const result=await callback(...args);require('fs').writeFileSync(${JSON.stringify(path.join(TMP, 'commit.json'))},JSON.stringify(result));return result;}:callback);
    require(${JSON.stringify(path.join(ROOT, 'main.js'))});`);
  fs.writeFileSync(html, '<!doctype html><title>Suira local paste test</title><textarea id="input" autofocus style="width:90vw;height:40vh"></textarea><div id="image-input" contenteditable="true" style="height:30vh;border:1px solid gray"></div><script>window.imagePastes=0;document.getElementById("image-input").addEventListener("paste",event=>{if(Array.from(event.clipboardData.items).some(item=>item.type.startsWith("image/")))window.imagePastes++;});</script>');
  fs.writeFileSync(editorMain, `
    const {app,BrowserWindow,ipcMain,clipboard,ClipboardItem,nativeImage}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(TMP, 'editor-data'))});
    let win,original;
    app.whenReady().then(async()=>{
      original=await Promise.all((await clipboard.read()).map(async item=>{
        const values={};for(const type of item.types) values[type]=await item.getType(type);
        return new ClipboardItem(values);
      }));
      ipcMain.handle('focus',()=>{win.show();app.focus({steal:true});win.focus();});
      ipcMain.handle('read',()=>clipboard.readText());
      ipcMain.handle('read-png',async(_event,expectedPath)=>{
        const entries=await clipboard.read();const entry=entries.find(item=>item.types.includes('image/png'));
        if(!entry)return {hasPNG:false};
        const image=nativeImage.createFromBuffer(Buffer.from(await (await entry.getType('image/png')).arrayBuffer()));
        return {hasPNG:true,size:image.getSize(),samePixels:image.toBitmap().equals(nativeImage.createFromPath(expectedPath).toBitmap())};
      });
      ipcMain.handle('restore',()=>original.length?clipboard.write(original):clipboard.clear());
      win=new BrowserWindow({width:650,height:320,webPreferences:{nodeIntegration:true,contextIsolation:false}});
      await win.loadFile(${JSON.stringify(html)});win.show();win.focus();
    });`);
  launch(exe, wrapper, appPort);
  const appPage = await page(appPort, '/index.html');
  launch(exe, editorMain, editorPort);
  editor = await page(editorPort, '/editor.html');
  const host = await ensureNativeHost({ sourcePath: path.join(ROOT, 'assets/foreground-host.cs'), targetPath: path.join(TMP, 'foreground.exe'), references: ['System.Web.Extensions.dll'] });
  assert.ok(host, '原生助手编译失败');
  probe = new ForegroundProbe({ nativeHost: host });
  assert.ok(await probe.start());
  const focusEditor = async () => {
    await editor.evaluate(`require('electron').ipcRenderer.invoke('focus')`);
    try { await until(async () => (await probe.query())?.pid === children[1].pid, process.argv.includes('--focus') ? 60000 : 3000); }
    catch (error) { const current = await probe.query(); throw Error(`测试窗口未获得焦点：expected=${children[1].pid}, actual=${current?.pid}, hwnd=${current?.hwnd}`); }
    await editor.evaluate(`document.getElementById('input').focus()`);
  };
  if (dictation) {
    const settings = await appPage.evaluate("window.suira.settings.update({voiceProvider:'openai',voiceBaseUrl:'https://example.com/v1',voiceModel:'fixture-asr',voiceApiKey:'fixture-key'})");
    assert.ok(settings.ok, settings.error);
    const enabled = await appPage.evaluate('window.suira.settings.update({globalShortcutsEnabled:true})');
    assert.ok(enabled.ok, enabled.error);
    const binding = await appPage.evaluate("window.suira.shortcuts.set({name:'voice',accelerator:'Alt+H'})");
    assert.ok(binding.ok, binding.error);
    await appPage.evaluate('window.suira.window.close()');
    await focusEditor();
    const trigger = path.join(TMP, 'voice-hotkey');
    fs.writeFileSync(trigger,'start');
    const voice = await page(appPort,'/voice-input.html');
    await until(() => voice.evaluate('typeof state !== "undefined" && state.phase === "recording" && state.sampleCount > 0'));
    assert.equal((await probe.query()).pid,children[1].pid,'Voice overlay must keep the editor foreground');
    assert.equal(await editor.evaluate('document.activeElement.id'),'input');
    await wait(480);
    fs.writeFileSync(trigger,'stop');
    await until(() => editor.evaluate('document.querySelector("#input").value === "这是直接语音输入"'));
    console.log('PASS Windows direct dictation into a separate Electron editor with microphone and ASR fixtures');
    return;
  }
  const bar = await page(appPort, '/clipboardbar.html');
  const overlay = await page(appPort, '/overlay.html');
  const quick = await page(appPort, '/quickpanel.html');
  const text = 'SUIRA_LATENCY_TEST_历史内容';
  await appPage.evaluate(`window.suira.content.addText({text:${JSON.stringify(text)},source:'user'})`);
  // Global copy preference is deliberately off: a history-card click is an explicit paste.
  await appPage.evaluate(`window.suira.settings.update({pasteAfterCopy:false})`);
  const barTimes = [], captureTimes = [], quickTimes = [];
  for (let n = 0; n < (process.argv.includes('--clipboard-image') ? 0 : 3); n++) {
    await focusEditor();
    let start = performance.now();
    const shown = await appPage.evaluate('window.suira.clipboardBar.show()');
    assert.ok(shown.ok);
    await until(() => bar.evaluate(`document.visibilityState==='visible' && !!Array.from(document.querySelectorAll('.bar-card')).find(c=>c.textContent.includes(${JSON.stringify(text)}))`));
    barTimes.push(Math.round(performance.now() - start));
    const target = await bar.evaluate('window.suira.returnTo.target()');
    assert.equal(target.pid, children[1].pid, '必须记录输入框，而不是自己的浮层');
    if (n === 0) {
      const altered = { ...target, processStartedAt: target.processStartedAt + 1 };
      assert.equal((await probe.pasteTo(altered)).ok, false, '进程实例不匹配时不得粘贴');
    }
    start = performance.now();
    await bar.evaluate(`Array.from(document.querySelectorAll('.bar-card')).find(c=>c.textContent.includes(${JSON.stringify(text)})).click()`);
    await until(() => editor.evaluate(`document.getElementById('input').value===${JSON.stringify(text.repeat(n + 1))}`), 3000);
    console.log(`PASS 第 ${n + 1} 次单击粘贴 ${Math.round(performance.now() - start)}ms`);
    assert.equal(await bar.evaluate('document.visibilityState'), 'hidden');
    assert.equal(await editor.evaluate(`require('electron').ipcRenderer.invoke('read')`), text);
    if (n === 0) {
      // Send a second real Ctrl+V without rewriting the clipboard.
      const second = await probe.pasteTo(target); assert.ok(second.ok);
      await until(() => editor.evaluate(`document.getElementById('input').value===${JSON.stringify(text + text)}`));
      await editor.evaluate(`document.getElementById('input').value=${JSON.stringify(text)}`);
      console.log('PASS 再次 Ctrl+V 仍粘贴同一条历史内容');
    }
    await focusEditor();
    start = performance.now();
    await appPage.evaluate('window.suira.quick.show()');
    await until(() => quick.evaluate(`document.visibilityState==='visible'`));
    quickTimes.push(Math.round(performance.now() - start));
    await quick.evaluate('window.suira.quick.hide()');
    start = performance.now();
    const result = await appPage.evaluate('window.suira.capture.start()'); assert.ok(result.ok);
    await until(() => overlay.evaluate(`document.visibilityState==='visible' && document.getElementById('loading-state').hidden && document.getElementById('screen-canvas').width>0`));
    captureTimes.push(Math.round(performance.now() - start));
    await overlay.evaluate('window.suira.capture.cancel()');
    await until(() => overlay.evaluate(`document.getElementById('screen-canvas').width===0`));
  }
  const imageResult = await appPage.evaluate(`(()=>{const c=document.createElement('canvas');c.width=48;c.height=32;const ctx=c.getContext('2d');ctx.fillStyle='#ff0011';ctx.fillRect(0,0,48,32);return window.suira.capture.finish({dataUrl:c.toDataURL(),action:'copy'});})()`);
  assert.ok(imageResult.ok, '测试图片应正确写入历史与剪贴板');
  if (process.argv.includes('--clipboard-image')) {
    const result = await bar.evaluate(`window.suira.returnTo.commit({itemId:${JSON.stringify(imageResult.item.id)},intent:'copy-only'})`);
    assert.ok(result.ok && result.copied && !result.pasted);
    const image = await editor.evaluate(`require('electron').ipcRenderer.invoke('read-png',${JSON.stringify(imageResult.filePath)})`);
    assert.deepEqual(image, {hasPNG:true,size:{width:48,height:32},samePixels:true});
    console.log('PASS 历史图片复制为真实 PNG 位图，剪贴板像素与历史图片完全相同');
    return;
  }
  await focusEditor();
  await editor.evaluate(`document.getElementById('image-input').focus()`);
  await appPage.evaluate('window.suira.clipboardBar.show()');
  await until(() => bar.evaluate(`!!document.querySelector('[data-id="${imageResult.item.id}"]')`));
  const imageTarget = await bar.evaluate('window.suira.returnTo.target()');
  await bar.evaluate(`document.querySelector('[data-id="${imageResult.item.id}"]').click()`);
  await until(() => editor.evaluate('window.imagePastes===1'), 3000);
  assert.equal(await bar.evaluate('document.visibilityState'), 'hidden');
  assert.ok((await probe.pasteTo(imageTarget)).ok);
  await until(() => editor.evaluate('window.imagePastes===2'), 3000);
  assert.equal(await editor.evaluate(`document.getElementById('image-input').querySelectorAll('img').length`), 2);
  console.log('PASS 历史图片单击粘贴真实位图，再次 Ctrl+V 仍是同一张图');
  const report = { clipboardReadyMs: barTimes, quickReadyMs: quickTimes, captureReadyMs: captureTimes };
  fs.writeFileSync(path.join(TMP, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (process.argv.includes('--idle')) {
    console.log('等待 65 秒验证闲置后的唤起和窗口复用…');
    const before = (await (await fetch(`http://127.0.0.1:${appPort}/json/list`)).json()).map(t => t.id).sort();
    await wait(65000);
    const after = (await (await fetch(`http://127.0.0.1:${appPort}/json/list`)).json()).map(t => t.id).sort();
    assert.deepEqual(after, before, '高频入口闲置后不应销毁重建');
    await focusEditor(); const start = performance.now();
    await appPage.evaluate('window.suira.clipboardBar.show()');
    await until(() => bar.evaluate(`document.visibilityState==='visible'`));
    report.clipboardAfterIdleMs = Math.round(performance.now() - start);
    await bar.evaluate('window.suira.clipboardBar.hide()');
    console.log('PASS 闲置后复用原窗口');
  }
  fs.writeFileSync(path.join(TMP, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  console.log('PASS 真实 Electron 截图、剪贴板、单击粘贴、Ctrl+V 和画布释放');
})().catch(async error => {
  console.error(error.stack);
  const appLog = path.join(TMP, 'app.js.log');
  if (process.argv.includes('--voice') && fs.existsSync(appLog)) console.error(fs.readFileSync(appLog, 'utf8').trim());
  const log = path.join(TMP, 'commit.json'); if (fs.existsSync(log)) console.error('提交结果：' + fs.readFileSync(log, 'utf8'));
  if (editor) { try { console.error('测试输入框：' + JSON.stringify(await editor.evaluate(`({text:document.getElementById('input').value,active:document.activeElement.id,images:window.imagePastes})`))); } catch {} }
  process.exitCode = 1;
}).finally(async () => {
  if (editor) { try { await editor.evaluate(`require('electron').ipcRenderer.invoke('restore')`); } catch {} }
  probe?.dispose();
  for (const socket of sockets) socket.close();
  for (const child of children) child.kill();
  console.log('测试记录：' + TMP);
});
