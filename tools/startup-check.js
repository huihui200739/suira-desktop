'use strict';
// Fresh isolated profile; observe real renderer creation/show order.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),entry=path.join(tmp,'app.js'),record=path.join(tmp,'startup.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child,client;
(async()=>{
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
 const start=performance.now(),events=[];const record=(name,win)=>{events.push({name,url:win.webContents.getURL(),ms:Math.round(performance.now()-start)});fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(events));};app.on('browser-window-created',(_,win)=>{record('created',win);win.once('show',()=>record('show',win));win.webContents.once('did-finish-load',()=>record('loaded',win));});require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:'ignore'});
 for(let n=0;n<250;n++){try{const events=JSON.parse(fs.readFileSync(record));if(events.some(e=>e.name==='loaded'&&e.url.endsWith('/overlay.html')))break;}catch{}await wait(60);}
 const events=JSON.parse(fs.readFileSync(record));const main=events.find(e=>e.name==='show'&&e.url.endsWith('/index.html'));assert.ok(main,'Workbench should show');
 for(const page of ['quickpanel','clipboardbar','overlay']){const event=events.find(e=>e.name==='loaded'&&e.url.endsWith('/'+page+'.html'));assert.ok(event,page+' loads');assert.ok(event.ms>main.ms,page+' must load after first workbench frame');}
 client=await connect(port,t=>t.url.endsWith('/index.html'));assert.equal(await client.evaluate('Boolean(window.WorkspaceUI)'),true);
 const report={version:require('../package.json').version,note:'Single cold-profile run, milliseconds since loading main module; native helpers compiled asynchronously.',events};fs.writeFileSync(path.join(root,'docs/startup-latency.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));console.log('PASS workbench visible before all tool prewarming');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{client?.ws.close();child?.kill();});
