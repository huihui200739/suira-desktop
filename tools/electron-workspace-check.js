'use strict';
// Isolated profile, empty clipboard and injectable OS registration. The registered
// callbacks, IPC, picker windows, renderer, and persistent store are production code.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),control=path.join(tmp,'key.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child,main;const sockets=[];
async function until(fn){let error;for(let n=0;n<140;n++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await wait(80);}throw error||Error('状态超时');}
(async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  fs.writeFileSync(path.join(tmp,'input.md'),'# Imported\n\nThis is a local file.');fs.writeFileSync(control,'{}');const entry=path.join(tmp,'app.js');
  fs.writeFileSync(entry,`const fs=require('node:fs'),{app,clipboard,globalShortcut,dialog}=require('electron');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(tmp,'input.md'))}]});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(path.join(tmp,'output.md'))}});app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';const keys=new Map();globalShortcut.register=(key,fn)=>{if(keys.has(key))return false;keys.set(key,fn);return true;};globalShortcut.unregister=key=>keys.delete(key);globalShortcut.unregisterAll=()=>keys.clear();let seen=0;setInterval(()=>{const c=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));if(c.seq&&c.seq!==seen){seen=c.seq;keys.get(c.key)?.();}},40);require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);
  await until(()=>main.evaluate('Boolean(window.WorkspaceUI && window.suira?.workspace && document.querySelector(".task-list-empty"))'));
  const errors=[];main.ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);});await main.send('Runtime.enable');
  await main.send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false});
  const workbench=main;
  const go=async page=>{await workbench.evaluate(`window.suira.quick.showMain(${JSON.stringify(page)})`);if(['calendar','markdown'].includes(page)){main=await until(()=>connect(port,t=>t.url.includes('tool='+page)));sockets.push(main.ws);await until(()=>main.evaluate('Boolean(window.WorkspaceUI)'));}else main=workbench;await wait(200);};
  const shot=async name=>{const result=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/screenshots',name),Buffer.from(result.data,'base64'));};
  const task=await main.evaluate(`window.suira.tasks.create('工作台改版')`);assert.ok(task.ok);
  await main.evaluate(`window.suira.tasks.rename({id:${JSON.stringify(task.task.id)},title:'本周工作台计划'})`);
  assert.equal((await main.evaluate(`window.suira.tasks.status({id:${JSON.stringify(task.task.id)},done:true})`)).ok,true);
  assert.equal((await main.evaluate('window.suira.tasks.list()'))[0].progress,'done');
  await go('shelf');await shot('36-workspace-tasks.png');
  await go('calendar');await main.evaluate(`document.getElementById('calendar-new').click();document.getElementById('event-title').value='产品评审';document.getElementById('event-time').value='14:30';document.getElementById('event-notes').value='讨论下一版工作台';document.getElementById('event-form').requestSubmit(document.querySelector('#event-form button[type="submit"]'));true`);
  await until(()=>main.evaluate(`document.querySelector('.agenda-content b')?.textContent==='产品评审'`));
  await main.evaluate(`document.querySelector('[data-done]').click();true`);await until(()=>main.evaluate(`Boolean(document.querySelector('.agenda-item.done'))`));
  await main.evaluate(`document.querySelector('[data-calendar-view="week"]').click();true`);
  assert.equal(await main.evaluate('document.querySelectorAll(".calendar-day").length'),7);
  await main.evaluate(`document.querySelector('[data-calendar-view="agenda"]').click();true`);
  assert.equal(await main.evaluate('document.querySelectorAll(".calendar-agenda-row").length'),1);
  await main.evaluate(`document.getElementById('calendar-search').value='不存在';document.getElementById('calendar-search').dispatchEvent(new Event('input'));true`);
  assert.equal(await main.evaluate('document.querySelectorAll(".calendar-agenda-row").length'),0);
  await main.evaluate(`document.getElementById('calendar-search').value='';document.getElementById('calendar-search').dispatchEvent(new Event('input'));document.querySelector('[data-calendar-view="month"]').click();true`);
  const calendarClient=main;
  assert.equal(await main.evaluate(`Array.from(document.querySelectorAll('.lunar-day')).every(el=>/^(初|十|廿|二|三)/.test(el.textContent))`),true);
  await main.evaluate(`document.querySelector('[data-agenda="countdown"]').click();true`);
  assert.equal(await main.evaluate(`document.querySelectorAll('.countdown-row').length`),0,'Completed events excluded from countdown');
  await main.evaluate(`document.querySelector('[data-agenda="todo"]').click();true`);
  await shot('39-calendar-window.png');
  await go('markdown');
  assert.equal(await main.evaluate(`document.getElementById('md-import').closest('.titlebar')!==null`),true);
  await shot('41-markdown-welcome.png');
  await main.evaluate(`document.getElementById('md-new').click();true`);await until(()=>main.evaluate(`!document.getElementById('md-body').hidden`));
  await main.evaluate(`window.__parseCount=0;window.__previewObserver=new MutationObserver(records=>window.__parseCount+=records.length);window.__previewObserver.observe(document.getElementById('md-preview'),{childList:true});for(let i=0;i<20;i++){document.getElementById('md-editor').value='# burst '+i;document.getElementById('md-editor').dispatchEvent(new Event('input'));}true`);
  await until(()=>main.evaluate(`document.getElementById('md-preview').textContent.includes('burst 19')`));
  assert.equal(await main.evaluate('window.__parseCount'),1,'Typing burst should parse once');
  await main.evaluate('window.__previewObserver.disconnect();true');
  const markdown='# 工作台计划\n\n把想法整理成可以继续的工作。\n\n## 本周重点\n\n- 完善日历与任务\n- 检查快捷键\n\n| 模块 | 状态 |\n| --- | --- |\n| 日历 | 已接入 |\n| Markdown | 已接入 |\n\n```js\nconst next = "keep going";\n```\n\n<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>\n[unsafe](javascript:alert(1))';
  await main.evaluate(`document.getElementById('md-title').value='工作台计划';document.getElementById('md-editor').value=${JSON.stringify(markdown)};document.getElementById('md-editor').dispatchEvent(new Event('input'));true`);
  await until(()=>main.evaluate(`document.getElementById('md-status').textContent==='已保存'`));
  assert.equal(await main.evaluate(`document.querySelector('#md-preview table')!==null && !document.querySelector('#md-preview script,#md-preview img,#md-preview [onerror]') && !window.__unsafe`),true);
  await main.evaluate(`document.getElementById('md-editor').value=${JSON.stringify(markdown.split('<img')[0])};document.getElementById('md-editor').dispatchEvent(new Event('input'));window.WorkspaceUI.flush()`);
  const markdownClient=main;
  assert.notEqual(markdownClient,calendarClient);
  assert.equal(await workbench.evaluate('document.querySelector(".page.is-active").id'),'page-shelf');
  for(const view of ['preview','edit','split']){
    await main.evaluate(`document.querySelector('[data-md-view="${view}"]').click();true`);
    assert.equal(await main.evaluate('document.getElementById("md-split").dataset.view'),view);
  }
  assert.equal(await main.evaluate('getComputedStyle(document.querySelector(".sidebar")).display'),'none');
  await shot('40-markdown-window.png');
  await main.evaluate(`document.getElementById('md-editor').value=${JSON.stringify(markdown)};document.getElementById('md-editor').dispatchEvent(new Event('input'));window.WorkspaceUI.flush()`);
  await main.send('Page.enable');
  const reloaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Reload timed out')),10000);const onMessage=event=>{const data=JSON.parse(event.data);if(data.method==='Page.loadEventFired'){main.ws.removeEventListener('message',onMessage);clearTimeout(timer);resolve();}};main.ws.addEventListener('message',onMessage);});
  await main.send('Page.reload');await reloaded;await until(()=>main.evaluate('Boolean(window.WorkspaceUI && document.querySelector("#page-markdown.is-active"))'));await go('markdown');await until(()=>main.evaluate(`document.getElementById('md-title').value==='工作台计划'`));
  assert.equal(await main.evaluate(`document.getElementById('md-editor').value`),markdown);
  await main.evaluate('window.WorkspaceUI.flush()');
  const mdItems=await main.evaluate(`window.suira.workspace.list('markdown')`);
  assert.equal((await main.evaluate(`window.suira.workspace.export(${JSON.stringify(mdItems[0].id)})`)).ok,true);assert.equal(fs.readFileSync(path.join(tmp,'output.md'),'utf8'),markdown);
  for(const format of ['html','pdf']){console.log('EXPORT',format);
    const result=await main.evaluate(`window.suira.workspace.export(${JSON.stringify(mdItems[0].id)},${JSON.stringify(format)})`);assert.ok(result.ok,JSON.stringify(result));
    const bytes=fs.readFileSync(path.join(tmp,'output.md'));
    if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
    else {const html=bytes.toString();assert.ok(html.includes('<table>'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('onerror='));}
  }
  console.log('CALENDAR EXPORT');
  const ics=await calendarClient.evaluate('window.suira.workspace.calendarExport()');assert.ok(ics.ok);assert.ok(fs.readFileSync(path.join(tmp,'output.md'),'utf8').includes('BEGIN:VEVENT'));
  // Window buttons must target their own window. Closing the calendar leaves Markdown alive.
  console.log('CLOSE CALENDAR');
  await calendarClient.evaluate('setTimeout(()=>window.suira.window.close(),40);true');
  await until(async()=>!(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).some(t=>t.url.includes('tool=calendar')));
  assert.equal(await markdownClient.evaluate('Boolean(window.WorkspaceUI)'),true);
  await markdownClient.evaluate(`document.getElementById('md-editor').value='Saved while closing';document.getElementById('md-editor').dispatchEvent(new Event('input'));setTimeout(()=>window.suira.window.close(),40);true`);
  await until(async()=>!(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).some(t=>t.url.includes('tool=markdown')));
  const savedOnClose=await workbench.evaluate(`window.suira.workspace.list('markdown')`);assert.equal(savedOnClose[0].text,'Saved while closing');

  main=workbench;
  const imported=await main.evaluate('window.suira.workspace.import()');assert.ok(imported.ok);assert.equal(imported.item.text,'# Imported\n\nThis is a local file.');
  assert.equal((await main.evaluate(`window.suira.workspace.remove('markdown',${JSON.stringify(imported.item.id)})`)).ok,true);
  await go('settings');await main.evaluate(`document.querySelector('[data-setting-tab="translation"]').click();true`);await main.evaluate(`document.getElementById('setting-translate-provider').value='openai';document.getElementById('setting-translate-provider').dispatchEvent(new Event('change'));true`);await wait(150);await shot('33-workspace-settings.png');
  await main.evaluate(`document.querySelector('[data-setting-tab="shortcuts"]').click();true`);await until(()=>main.evaluate(`document.getElementById('setting-key-longCapture').value.includes('G')`));
  assert.equal(await main.evaluate(`document.getElementById('status-longCapture').textContent`),'已生效');
  // Trigger the actual registered global callback without competing for the user's OS keys.
  fs.writeFileSync(control,JSON.stringify({seq:1,key:'Alt+G'}));
  const picker=await until(()=>connect(port,t=>t.url.endsWith('/long-picker.html')));sockets.push(picker.ws);
  await until(()=>picker.evaluate('window.__longPickerState?.ready'));await picker.evaluate('window.suira.longCapture.cancelPicker()');await wait(100);
  // Repeated entry after cancellation must work, without leaving a stale busy state.
  fs.writeFileSync(control,JSON.stringify({seq:2,key:'Alt+G'}));await until(()=>picker.evaluate('window.__longPickerState?.revision>=3'));await picker.evaluate('window.suira.longCapture.cancelPicker()');
  await main.evaluate('window.suira.quick.show()');
  const panel=await until(()=>connect(port,t=>t.url.endsWith('/quickpanel.html')));sockets.push(panel.ws);await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
  await until(()=>panel.evaluate('document.visibilityState==="visible"'));await wait(350);
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:400});await wait(350);
  const collapsed=await panel.evaluate(`(()=>{const f=document.querySelector('.search-field').getBoundingClientRect(),s=document.querySelector('.search-slot').getBoundingClientRect();return {width:f.width,left:f.left,slot:s.left,y:f.top+f.height/2};})()`);
  assert.ok(collapsed.width<=46);assert.ok(Math.abs(collapsed.left-collapsed.slot)<1,'collapsed search must align left');
  assert.equal(await panel.evaluate(`document.getElementById('search-close')===null`),true);
  const searchShot=async name=>{const result=await panel.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/screenshots',name),Buffer.from(result.data,'base64'));};
  await searchShot('37-search-collapsed.png');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:collapsed.left-8,y:collapsed.y});await wait(350);
  assert.ok(await panel.evaluate(`document.querySelector('.search-field').getBoundingClientRect().width>200`),'proximity alone expands');
  await searchShot('38-search-expanded.png');
  await panel.evaluate(`document.getElementById('search').value='日历';document.getElementById('search').dispatchEvent(new Event('input'));true`);
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:400});await wait(350);
  assert.ok(await panel.evaluate(`document.querySelector('.search-field').getBoundingClientRect().width<=46`),'leaving collapses');
  assert.equal(await panel.evaluate(`document.getElementById('search').value`),'日历','collapse preserves query');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:collapsed.left+20,y:collapsed.y});await wait(350);
  assert.ok(await panel.evaluate(`document.querySelector('.search-field').getBoundingClientRect().width>200`));
  assert.equal(await panel.evaluate(`document.getElementById('search').value`),'日历');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:400});await wait(350);
  await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F3',windowsVirtualKeyCode:114});
  await panel.send('Input.dispatchKeyEvent',{type:'keyUp',key:'F3',windowsVirtualKeyCode:114});await wait(350);
  assert.equal(await panel.evaluate(`document.activeElement===document.getElementById('search')`),true);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS real Electron: calendar save/completion, Markdown rendering/sanitizing/autosave/reload, settings categories, registered Alt+G callback opens picker twice, expanding search');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1500));process.exitCode=1;}).finally(async()=>{for(const ws of sockets)ws.close();if(child&&child.exitCode===null)child.kill();await wait(500);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}});
