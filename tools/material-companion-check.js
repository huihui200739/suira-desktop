'use strict';
// Production Electron pages; isolated profile, synthetic content, no OS shortcuts.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {PNG}=require('pngjs'),{connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),clients=[];
let child;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let error;for(let i=0;i<180;i++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await wait(80);}throw error||Error('Material/companion timeout');}
(async()=>{
 const store=new SuiraStore(path.join(tmp,'profile/suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});app.getVersion=()=>${JSON.stringify(require('../package.json').version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:false,stdio:['ignore',log,log]});fs.closeSync(log);
 const page=async suffix=>{const c=await until(()=>connect(port,t=>t.url.includes(suffix)));clients.push(c.ws);await until(()=>c.evaluate('Boolean(window.suira)'));await until(()=>c.evaluate('(()=>{const n=document.querySelector(".suira-companion .companion-button");if(!n)return false;const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()'));return c;};
 const main=await page('/index.html');
 if(process.argv.includes('--controls-only')){
  await main.evaluate('window.suira.notes.create()');const note=await page('/notes.html');
  await note.send('Emulation.setDeviceMetricsOverride',{width:240,height:200,deviceScaleFactor:1,mobile:false});
  await note.evaluate('document.querySelector(".companion-button").click();true');
  assert.equal(await note.evaluate('(()=>{const r=document.querySelector(".companion-options").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()'),true,'Partner controls fit the smallest note window');
  await note.evaluate('document.querySelector(".companion-options [data-buddy=quiet]").click();true');
  await until(()=>note.evaluate('window.suira.settings.get().then(s=>s.companionMotion===false)'));
  await note.evaluate('document.querySelector("[data-buddy-hide]").click();true');await until(()=>note.evaluate('document.querySelector(".suira-companion").hidden'));
  await main.evaluate('window.suira.settings.update({companionEnabled:true,companionMotion:true})');await until(()=>note.evaluate('!document.querySelector(".suira-companion").hidden'));
  await note.evaluate('(()=>{const e=document.getElementById("note-body");e.value="保存后的伙伴反馈";e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  await until(()=>note.evaluate('document.querySelector(".suira-companion").dataset.pose==="saved"'));
  console.log('PASS smallest-window controls, persisted quiet mode, hide/restore, actual save response');return;
 }
 await main.evaluate('window.suira.quick.show()');const panel=await page('/quickpanel.html');await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
 if(process.argv.includes('--visibility-only')){for(const tool of ['calendar','markdown']){await main.evaluate('window.suira.workspace.open('+JSON.stringify(tool)+')');await page('tool='+tool);}await main.evaluate('window.suira.clipboardBar.show()');await page('/clipboardbar.html');await main.evaluate('window.suira.notes.create()');await page('/notes.html');console.log('PASS all six partner docks have nonzero dimensions and remain inside their actual viewport');return;}
 if(process.argv.includes('--flow-only')){
  const point=await panel.evaluate('(()=>{const r=document.querySelectorAll(".key")[2].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.width/2};})()');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await until(()=>panel.evaluate('document.querySelectorAll(".key")[2].classList.contains("is-key-sheen")'));
  assert.equal(await panel.evaluate('getComputedStyle(document.querySelectorAll(".key-sheen")[2]).animationDuration'),'0.24s');
  console.log('PASS empty keys receive the same bounded, single 240ms silver reflection');return;
 }
 const sprite=PNG.sync.read(fs.readFileSync(path.join(root,'src/art/companion-courier.png')));assert.equal(sprite.width%4,0);assert.equal(sprite.data[3],0,'Generated asset keeps true alpha');
 await panel.evaluate('new Promise((resolve,reject)=>{const i=new Image();i.onload=resolve;i.onerror=reject;i.src="art/companion-courier.png";})');
 await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
 const proof={version:require('../package.json').version,materials:[],windows:['workbench','panel'],spriteAlpha:true};
 for(const material of ['soft','clear']){
  await panel.evaluate(`window.suira.settings.update({panelMaterial:${JSON.stringify(material)}})`);await wait(200);
  const coords=await panel.evaluate('(()=>{const r=document.querySelectorAll(".key-face")[2].getBoundingClientRect(),p=document.getElementById("panel").getBoundingClientRect();return {width:innerWidth,height:innerHeight,key:{x:r.x+r.width*.22,y:r.y+r.height*.3},tray:{x:12,y:p.height/2}}})()');
  const data=await panel.send('Page.captureScreenshot',{format:'png'}),png=PNG.sync.read(Buffer.from(data.data,'base64')),scale=png.width/coords.width;
  const sample=p=>{const k=(Math.floor(p.y*scale)*png.width+Math.floor(p.x*scale))*4,a=png.data[k+3]/255;return [0,1,2].map(i=>png.data[k+i]*a+255*(1-a));};
  const key=sample(coords.key),tray=sample(coords.tray),difference=key.reduce((n,v,i)=>n+v-tray[i],0)/3;
  assert.ok(difference>25,'Empty keys remain visible on white desktop: '+difference);
  proof.materials.push({material,keyTrayChannelDifference:Math.round(difference)});
  fs.writeFileSync(path.join(root,'docs/product/panel-'+material+'-'+require('../package.json').version+'.png'),Buffer.from(data.data,'base64'));
 }
 await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await wait(100);const dark=await panel.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/product/panel-dark-'+require('../package.json').version+'.png'),Buffer.from(dark.data,'base64'));
 await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 assert.equal(await panel.evaluate('getComputedStyle(document.querySelector(".key-sheen")).width!=="0px"'),true);
 await main.evaluate('window.suira.settings.update({companionEnabled:false})');await until(()=>panel.evaluate('document.querySelector(".suira-companion").hidden'));
 await main.evaluate('window.suira.settings.update({companionEnabled:true,companionStyle:"mint",companionSize:40,companionMotion:false})');
 await until(()=>panel.evaluate('document.querySelector(".suira-companion").dataset.style==="mint"'));assert.equal(await panel.evaluate('getComputedStyle(document.querySelector(".suira-companion")).getPropertyValue("--buddy-size").trim()'),'40px');
 await panel.evaluate('document.querySelector(".companion-button").dispatchEvent(new PointerEvent("pointerenter"));true');assert.equal(await panel.evaluate('document.querySelector(".suira-companion").dataset.pose'),'idle');
 for(const tool of ['calendar','markdown']){await main.evaluate(`window.suira.workspace.open(${JSON.stringify(tool)})`);const c=await page('tool='+tool);proof.windows.push(tool);assert.equal(await c.evaluate('document.querySelector(".suira-companion").dataset.style'),'mint');}
 await main.evaluate('window.suira.clipboardBar.show()');await page('/clipboardbar.html');proof.windows.push('clipboard');await main.evaluate('window.suira.notes.create()');await page('/notes.html');proof.windows.push('note');
 await main.evaluate('window.suira.settings.update({companionStyle:"courier",companionSize:32,companionMotion:true,panelMaterial:"soft"})');
 await main.evaluate('window.suira.quick.show()');await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await panel.evaluate('window.SuiraCompanion.react("saved");true');assert.equal(await panel.evaluate('document.querySelector(".suira-companion").dataset.pose'),'idle');
 proof.settingsBroadcast=true;proof.quietAndReducedMotion=true;fs.writeFileSync(path.join(root,'docs/material-companion-verification.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS material separation, generated asset, six windows, live settings and reduced motion',JSON.stringify(proof));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{clients.forEach(c=>c.close());if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}await wait(200);if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});});
