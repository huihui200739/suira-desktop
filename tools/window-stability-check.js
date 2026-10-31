'use strict';
// Uses real Electron geometry and events, with only test files/profile/hotkeys.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),control=path.join(tmp,'control.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child;const sockets=[];
async function until(fn){let error;for(let n=0;n<160;n++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await wait(80);}throw error||Error('Window stability check timed out');}
(async()=>{
  const store=new SuiraStore(path.join(tmp,'profile','suira-data.json'));store.setWindowState({x:120,y:100,width:1001,height:701,maximized:false});await store.save();
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));fs.writeFileSync(control,'{}');
  const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const fs=require('node:fs'),{app,BrowserWindow,screen,clipboard,globalShortcut,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};const moduleProbe=require(${JSON.stringify(path.join(root,'lib','foreground-probe.js'))});const Probe=moduleProbe.ForegroundProbe;let ownProbe;moduleProbe.ForegroundProbe=class extends Probe{constructor(o){super(o);ownProbe=this;}};let boundsCalls=0,trace=[];const original=BrowserWindow.prototype.setBounds;BrowserWindow.prototype.setBounds=function(bounds,...args){boundsCalls++;trace.push({id:this.id,before:this.getBounds(),requested:bounds});return original.call(this,bounds,...args);};const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,name==='app:info'?async(...args)=>{const c=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));fs.writeFileSync(${JSON.stringify(control)},'{}');const win=BrowserWindow.fromId(c.id||0);if(c.fallback){ownProbe.stop();ownProbe.nativeHost="";ownProbe.nativeHostReady=Promise.resolve(null);await ownProbe.start();}if(win){if(c.bounds)win.setBounds(c.bounds);if(c.position){const point=screen.dipToScreenPoint({x:c.position[0],y:c.position[1]});await ownProbe.placeOwnWindow(win.getNativeWindowHandle().readBigUInt64LE().toString(),point);}if(c.maximize)win.maximize();if(c.restore)win.unmaximize();if(c.close)win.close();}return {...await fn(...args),boundsCalls,trace:trace.slice(-6),windows:BrowserWindow.getAllWindows().filter(w=>w.__desktopWindow).map(w=>({id:w.id,url:w.webContents.getURL(),bounds:w.getBounds(),area:screen.getDisplayMatching(w.getBounds()).workArea,maximized:w.isMaximized(),pendingRestore:Boolean(w.__restorePhysicalSize)}))};}:fn);require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const runtimeArgs=[entry,'--remote-debugging-port='+port,...(process.env.SUIRA_TEST_SCALE?['--force-device-scale-factor='+process.env.SUIRA_TEST_SCALE]:[])];const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(process.env.SUIRA_ELECTRON||'C:\\suira-electron\\electron.exe',runtimeArgs,{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  let main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);await until(()=>main.evaluate('Boolean(window.suira?.workspace)'));
  const info=()=>main.evaluate('window.suira.app.info()'),command=async c=>{fs.writeFileSync(control,JSON.stringify(c));return info();};
  await main.evaluate(`window.suira.workspace.open('calendar')`);await main.evaluate(`window.suira.workspace.open('markdown')`);await until(async()=>(await info()).windows.length===3);
  await wait(400);const initial=await info();await wait(2200);const idle=await info();

  for(const win of idle.windows){
    const stable=win.bounds;
    for(let n=0;n<5;n++)await command({id:win.id,position:[stable.x,win.area.y+win.area.height-80]});
    await wait(500);const after=(await info()).windows.find(w=>w.id===win.id);
    assert.ok(Math.abs(after.bounds.width-stable.width)<=1&&Math.abs(after.bounds.height-stable.height)<=1,'Moving must not resize '+win.url+': '+JSON.stringify({stable,after}));
    await wait(1600);const last=(await info()).windows.find(w=>w.id===win.id);assert.deepEqual(last.bounds,after.bounds,'Window must settle without growth');
  }
  assert.equal(idle.boundsCalls,initial.boundsCalls,'Idle windows must not enter a setBounds feedback loop');
  const baseline=initial.windows.find(win=>win.url.endsWith('/index.html')).bounds;
  for(let n=0;n<3;n++){
    const window=(await info()).windows.find(win=>win.url.endsWith('/index.html'));
    await command({id:window.id,close:true});await wait(800);main.ws.close();
    const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;await wait(200);
    const log=fs.openSync(path.join(tmp,'app.log'),'a');child=spawn(process.env.SUIRA_ELECTRON||'C:\\suira-electron\\electron.exe',runtimeArgs,{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
    main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);await until(()=>main.evaluate('Boolean(window.suira?.workspace)'));
    await until(async()=>!(await info()).windows.find(win=>win.url.endsWith('/index.html')).pendingRestore);
    const restored=(await info()).windows.find(win=>win.url.endsWith('/index.html')).bounds;
    assert.ok(Math.abs(restored.width-baseline.width)<=1&&Math.abs(restored.height-baseline.height)<=1,'Restart must preserve size: '+JSON.stringify({baseline,restored}));
  }
  console.log('PASS real fractional-DPI windows: stable startup/idle, repeated bottom-edge move preserves size and settles');
  console.log('PASS three close/relaunch cycles preserve remembered window dimensions');
  await command({fallback:true});
  const current=(await info()).windows.find(win=>win.url.endsWith('/index.html'));
  await command({id:current.id,position:[current.bounds.x,current.area.y+current.area.height-80]});await wait(600);
  const fallback=(await info()).windows.find(win=>win.id===current.id);
  assert.ok(Math.abs(fallback.bounds.width-current.bounds.width)<=1&&Math.abs(fallback.bounds.height-current.bounds.height)<=1);
  assert.ok(fallback.bounds.y+fallback.bounds.height<=fallback.area.y+fallback.area.height+1);
  assert.equal((await main.evaluate('window.suira.window.reset()')).ok,true);await wait(300);
  const reset=(await info()).windows.find(win=>win.id===current.id);
  assert.ok(Math.abs(reset.bounds.width-Math.min(1180,reset.area.width-48))<=2);
  console.log('PASS PowerShell fallback preserves native dimensions; explicit reset restores a usable default size');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1600));process.exitCode=1;}).finally(async()=>{sockets.forEach(ws=>ws.close());if(child&&child.exitCode===null)child.kill();await wait(500);const p=path.resolve(tmp);if(path.dirname(p)!==path.resolve(os.tmpdir())||!path.basename(p).startsWith('suira-workspace-'))throw Error('Unsafe cleanup path');fs.rmSync(p,{recursive:true,force:true,maxRetries:3,retryDelay:200});});
