'use strict';
// Isolated profile. Shorten only the production 15-second idle timer to test
// actual teardown/reopen paths without touching the user's running instance.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[];let child;
async function until(fn){let error;for(let i=0;i<160;i++){try{const v=await fn();if(v)return v;}catch(e){error=e;}await wait(50);}throw error||Error('Timed out');}
(async()=>{
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');
 fs.writeFileSync(entry,`const {app,ipcMain,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
 const timer=global.setTimeout;global.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000||ms===10000?2000:ms,...args);
 const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,name==='app:info'?async(...args)=>({...await fn(...args),metrics:app.getAppMetrics().map(p=>({type:p.type,kb:p.memory.workingSetSize}))}):fn);
 require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 const get=async suffix=>{const c=await until(()=>connect(port,t=>t.url.endsWith(suffix)));sockets.push(c.ws);return c;};
 const main=await get('/index.html');await until(()=>main.evaluate('Boolean(window.WorkspaceUI)'));
 const targets=async()=> (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
 const metrics=async()=>{const m=(await main.evaluate('window.suira.app.info()')).metrics;return {processes:m.length,workingSetMB:Math.round(m.reduce((n,p)=>n+p.kb,0)/1024)};};
 const report={};
 assert.ok(!(await targets()).some(t=>/(quickpanel|clipboardbar|overlay)\.html$/.test(t.url)),'Tools load on demand');
 for(const [name,suffix,show,hide] of [['clipboard','/clipboardbar.html','window.suira.clipboardBar.show()','window.suira.clipboardBar.hide()'],['panel','/quickpanel.html','window.suira.quick.show()','window.suira.quick.hide()'],['capture','/overlay.html','window.suira.capture.start()','window.suira.capture.cancel()']]){
   await main.evaluate(show);let page=await get(suffix);await until(()=>page.evaluate(name==='capture'?'document.visibilityState==="visible" && document.getElementById("screen-canvas").width>0 && document.getElementById("loading-state").hidden':'document.visibilityState==="visible"'));const original=(await targets()).find(t=>t.url.endsWith(suffix)).id;
   await page.evaluate(hide);const start=performance.now();await main.evaluate(show);await until(()=>page.evaluate(name==='capture'?'document.visibilityState==="visible" && document.getElementById("screen-canvas").width>0 && document.getElementById("loading-state").hidden':'document.visibilityState==="visible"'));report[name+'WarmMs']=Math.round(performance.now()-start);
   // Visible surfaces must survive past the shortened idle interval.
   await wait(2200);assert.equal((await targets()).find(t=>t.url.endsWith(suffix))?.id,original);
   await page.evaluate(hide);report[name+'BeforeIdle']=await metrics();
   await until(async()=>!(await targets()).some(t=>t.url.endsWith(suffix)));report[name+'AfterIdle']=await metrics();
   const cold=performance.now();await main.evaluate(show);page=await get(suffix);await until(()=>page.evaluate(name==='capture'?'document.visibilityState==="visible" && document.getElementById("screen-canvas").width>0 && document.getElementById("loading-state").hidden':'document.visibilityState==="visible"'));report[name+'RecreatedMs']=Math.round(performance.now()-cold);assert.notEqual((await targets()).find(t=>t.url.endsWith(suffix)).id,original);await page.evaluate(hide);
 }
 await main.evaluate('window.suira.window.close()');
 await until(async()=>!(await targets()).some(t=>t.url.endsWith('/index.html')));
 console.log(JSON.stringify(report,null,2));console.log('PASS idle teardown, warm reuse, visible-window protection and recreation');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const s of sockets)s.close();child?.kill();});
