'use strict';
// Production Electron UI; all profile/content/cache paths are isolated. Never
// read the real clipboard, register global shortcuts or touch installed data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),sockets=[],errors=[],checks=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let child;
async function until(fn,label='state'){let last;for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(50);}throw last||Error('Timed out: '+label);}
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});store.createTask('提示生命周期验收');await store.save();
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(require('../package.json').version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>false;require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:/suira-electron/electron.exe',[entry,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 async function page(suffix){const c=await until(()=>connect(port,t=>t.url.includes(suffix)),suffix);sockets.push(c.ws);await until(()=>c.evaluate('Boolean(window.SuiraUI?.dismissHints && window.suira)'));await c.send('Runtime.enable');c.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});return c;}
 const main=await page('/index.html');
 async function rect(c,s){return c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);}
 const move=async(c,s)=>c.send('Input.dispatchMouseEvent',{type:'mouseMoved',...(typeof s==='string'?await rect(c,s):s)});
 const click=async(c,s)=>{const r=await rect(c,s);await move(c,r);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...r});};
 const key=async(c,key,code=key)=>{await c.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key==='Tab'?9:key==='Escape'?27:undefined});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
 const hidden=c=>c.evaluate('document.getElementById("surface-hint").hidden');
 async function hover(c,s){await c.evaluate('window.SuiraUI.dismissHints();true');await move(c,{x:innerBlankX,y:innerBlankY});await move(c,s);await until(async()=>!await hidden(c),'hover '+s);}
 // Blank content point is inside both test windows and away from controls.
 const innerBlankX=8,innerBlankY=8;
 async function fixture(c){await c.evaluate(`(()=>{document.getElementById('hint-fixture')?.remove();const f=document.createElement('div');f.id='hint-fixture';f.style.cssText='position:fixed;left:80px;top:300px;z-index:9999;display:flex;gap:20px';f.innerHTML='<button id="hint-a" type="button" data-hint="Fixture A" aria-describedby="fixture-help" style="width:140px;height:38px">A<svg width="16" height="16"><path d="M1 1h14v14H1z"/></svg></button><button id="hint-b" type="button" title="Fixture B" style="width:140px;height:38px">B</button>';document.body.append(f);document.getElementById('hint-a').addEventListener('pointerenter',()=>document.getElementById('hint-a').focus());return true;})()`);await until(()=>c.evaluate('document.getElementById("hint-b").dataset.hint==="Fixture B" && !document.getElementById("hint-b").hasAttribute("title")'));}
 async function suite(c,name){
  await fixture(c);
  await hover(c,'#hint-a');assert.equal(await c.evaluate('document.activeElement.id'),'hint-a');await move(c,{x:innerBlankX,y:innerBlankY});await until(()=>hidden(c));assert.equal(await c.evaluate('document.getElementById("hint-a").getAttribute("aria-describedby")'),'fixture-help');checks.push(name+':pointerenter-focus-leave');
  await hover(c,'#hint-a');await click(c,'#hint-a');await move(c,{x:innerBlankX,y:innerBlankY});await wait(500);assert.equal(await hidden(c),true);checks.push(name+':click-focus-leave');
  await hover(c,'#hint-a');await move(c,'#hint-b');await until(()=>c.evaluate('!document.getElementById("surface-hint").hidden && document.getElementById("surface-hint").textContent==="Fixture B"'));checks.push(name+':focused-A-to-hover-B');
  await c.evaluate('window.SuiraUI.dismissHints();true');await move(c,'#hint-b');await move(c,{x:innerBlankX,y:innerBlankY});await wait(550);assert.equal(await hidden(c),true);checks.push(name+':short-hover-no-late-show');
  await key(c,'Tab');await c.evaluate('document.getElementById("hint-b").focus();true');await until(async()=>!await hidden(c));await key(c,'Escape');assert.equal(await hidden(c),true);assert.equal(await c.evaluate('document.activeElement.id'),'hint-b');checks.push(name+':keyboard-and-Escape');
  for(const [label,expression] of [
   ['ancestor-hidden','document.getElementById("hint-fixture").hidden=true'],
   ['ancestor-inert','document.getElementById("hint-fixture").inert=true'],
   ['aria-hidden','document.getElementById("hint-fixture").setAttribute("aria-hidden","true")'],
   ['target-disabled','document.getElementById("hint-a").disabled=true'],
   ['hint-removed','delete document.getElementById("hint-a").dataset.hint'],
   ['target-removed','document.getElementById("hint-a").remove()'],
   ['target-replaced','document.getElementById("hint-a").replaceWith(document.getElementById("hint-a").cloneNode(true))'],
   ['target-moved','document.getElementById("hint-fixture").style.top="360px"'],
   ['popover','(()=>{const p=document.createElement("div");p.id="hint-popover";p.popover="manual";p.textContent="Menu";document.body.append(p);p.showPopover();})()']
  ]){await fixture(c);await hover(c,'#hint-a');await c.evaluate(expression+';true');await until(()=>hidden(c),label);await c.evaluate('document.getElementById("hint-popover")?.remove();true');checks.push(name+':'+label);}
  await fixture(c);await hover(c,'#hint-a');await c.evaluate('document.getElementById("hint-a").setAttribute("aria-describedby","fixture-help extra surface-hint");window.dispatchEvent(new Event("blur"));true');assert.equal(await hidden(c),true);assert.equal(await c.evaluate('document.getElementById("hint-a").getAttribute("aria-describedby")'),'fixture-help extra');checks.push(name+':blur-description-preserved');
  await fixture(c);await c.evaluate('document.getElementById("hint-b").title="Changed B";true');await until(()=>c.evaluate('document.getElementById("hint-b").dataset.hint==="Changed B" && !document.getElementById("hint-b").hasAttribute("title")'));checks.push(name+':changing-native-title');
  await c.evaluate('document.getElementById("hint-fixture").remove();window.SuiraUI.dismissHints();true');
 }
 await main.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
 await hover(main,'#sidebar-toggle');await click(main,'#sidebar-toggle');await move(main,{x:720,y:420});await wait(550);assert.equal(await hidden(main),true);assert.equal(await main.evaluate('document.activeElement.id'),'sidebar-toggle');checks.push('workbench:reported-sidebar-case');
 await suite(main,'workbench');
 await main.evaluate('window.suira.quick.show()');const panel=await page('/quickpanel.html');await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
 await panel.send('Emulation.setDeviceMetricsOverride',{width:1160,height:760,deviceScaleFactor:1,mobile:false});
 await hover(panel,'.key:not(:disabled)');await panel.evaluate('document.querySelector(".key:not(:disabled)").focus();true');await move(panel,{x:720,y:420});await until(()=>hidden(panel));checks.push('panel:key-mouse-focus-leave');
 await suite(panel,'panel');
 await panel.evaluate('document.getElementById("presentation-toggle").title="全屏提示刷新";true');await until(()=>panel.evaluate('document.getElementById("presentation-toggle").dataset.hint==="全屏提示刷新"'));checks.push('panel:presentation-title-conversion');
 await panel.evaluate('window.suira.quick.hide()');await main.evaluate('window.suira.quick.show()');await until(()=>hidden(panel));checks.push('panel:hide-reopen-no-old-hint');
 await main.evaluate('window.suira.quick.showMain("settings")');await main.evaluate('document.querySelector("[data-setting-tab=general]").click();true');
 await until(()=>main.evaluate('Boolean(document.querySelector("#setting-theme + .glass-select .glass-select-trigger"))'));
 await click(main,'#setting-theme + .glass-select .glass-select-trigger');await until(()=>main.evaluate('window.SuiraGlassSelect.isOpen()'));
 await main.evaluate('document.getElementById("setting-theme").closest(".setting-card").hidden=true;true');await until(()=>main.evaluate('!window.SuiraGlassSelect.isOpen()'));checks.push('settings:hidden-select-ancestor-dismisses-body-menu');
 // A manual action popover must leave the top layer when its owning surface
 // closes, including pin/note-like parent menus. No action is executed here.
 await panel.evaluate(`(()=>{const parent=document.createElement('div');parent.id='action-lifecycle-parent';parent.style.cssText='position:fixed;left:90px;top:330px;z-index:9999';const host=document.createElement('div');host.id='action-lifecycle-host';parent.append(host);document.body.append(parent);window.__lifecycleStrip=window.SuiraActionStrip.mount(host,{getItem:()=>({kind:'text',text:'Ordinary action menu fixture'})});return true;})()`);
 await until(()=>panel.evaluate('document.querySelectorAll("#action-lifecycle-host .action-strip-direct button").length>0'));
 const openActions=async()=>{await panel.evaluate('document.querySelector("#action-lifecycle-host details").open=true;true');await until(()=>panel.evaluate('document.querySelector("#action-lifecycle-host .action-strip-menu").matches(":popover-open")'));};
 for(const [name,expr,restore] of [
  ['parent-hidden','document.getElementById("action-lifecycle-parent").hidden=true','document.getElementById("action-lifecycle-parent").hidden=false'],
  ['parent-inert','document.getElementById("action-lifecycle-parent").inert=true','document.getElementById("action-lifecycle-parent").inert=false'],
  ['blur','window.dispatchEvent(new Event("blur"))','true']
 ]){await openActions();await panel.evaluate(expr+';true');await until(()=>panel.evaluate('!document.querySelector("#action-lifecycle-host details").open&&!document.querySelector("#action-lifecycle-host .action-strip-menu").matches(":popover-open")'));await panel.evaluate(restore+';true');checks.push('panel:action-strip-'+name);}
 await openActions();await panel.evaluate('window.__lifecycleStrip.destroy();true');assert.equal(await panel.evaluate('document.querySelectorAll("#action-lifecycle-host :popover-open").length'),0);checks.push('panel:action-strip-destroy');
 // Exercise actual dynamic title consumers outside the workbench/panel too.
 await main.evaluate('window.suira.notes.create()');const note=await page('/notes.html');await until(()=>note.evaluate('document.getElementById("note").dataset.state==="ready"'));
 await hover(note,'#note-pin');await move(note,{x:140,y:210});await until(()=>hidden(note));await click(note,'#note-pin');
 await until(()=>note.evaluate('document.getElementById("note-pin").dataset.hint==="取消置顶" && !document.getElementById("note-pin").hasAttribute("title")'));
 await move(note,{x:140,y:210});await until(()=>hidden(note));checks.push('notes:pin-dynamic-title-and-mouse-leave');
 await main.evaluate('window.suira.content.addText({text:"Clipboard hint lifecycle fixture",source:"clipboard"})');await main.evaluate('window.suira.clipboardBar.show()');const bar=await page('/clipboardbar.html');await until(()=>bar.evaluate('Boolean(document.querySelector(".bar-card[data-hint]"))'));
 await hover(bar,'.bar-card');await bar.evaluate('document.querySelector(".bar-card").focus();true');await move(bar,{x:8,y:8});await until(()=>hidden(bar));assert.equal(await bar.evaluate('document.querySelectorAll(".bar-card[title]").length'),0);checks.push('clipboardbar:dynamic-card-title-and-focus-leave');
 await bar.evaluate('window.suira.clipboardBar.hide()');await main.evaluate('window.suira.quick.showMain("shelf")');
 assert.deepEqual(errors,[]);
 const proof={version:require('../package.json').version,checkedAt:new Date().toISOString(),isolatedData:true,realElectronPointerAndKeyboard:true,checks,rendererErrors:errors};
 fs.writeFileSync(path.join(root,'docs','hints-'+proof.version+'-verification.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS '+checks.length+' real Electron tooltip/menu lifecycle checks');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1800));process.exitCode=1;}).finally(async()=>{sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(300);assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));assert.match(path.basename(tmp),/^suira-workspace-[A-Za-z0-9]+$/);fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
