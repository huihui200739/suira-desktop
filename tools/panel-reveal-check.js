'use strict';
// Inspect real cold/warm window reveals in an isolated profile. No user screen
// or clipboard content is read. Renderer state is sampled on the native show.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),control=path.join(tmp,'control.json'),response=path.join(tmp,'response.json'),sockets=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function until(fn){let last;for(let i=0;i<150;i++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await wait(40);}throw last||Error('Reveal timed out');}
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});await store.save();fs.writeFileSync(control,'{}');
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const fs=require('node:fs'),{app,BrowserWindow,clipboard,globalShortcut,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
const frames=[],messages=[];let lastRequest=0;
app.on('browser-window-created',(_e,w)=>{const send=w.webContents.send.bind(w.webContents);w.webContents.send=(name,...args)=>{if(name.startsWith('quick:'))messages.push({name,at:Date.now()});return send(name,...args);};w.on('show',()=>{if(!w.webContents.getURL().includes('/quickpanel.html'))return;
// Keep unrelated desktop focus changes out of this timing probe. The utilities test exercises real outside-focus dismissal.
w.isFocused=()=>w.isVisible();
const frame={at:Date.now(),native:w.__nativeBlur,frame:w.__glassFrameReady};frames.push(frame);w.webContents.executeJavaScript('({keys:document.querySelectorAll(".key").length,mode:document.getElementById("panel").dataset.mode,prepared:document.documentElement.dataset.panelPrepared,animation:getComputedStyle(document.querySelector(".panel")).animationName})').then(value=>frame.dom=value);});});
require(${JSON.stringify(path.join(root,'main.js'))});
const control=${JSON.stringify(control)},response=${JSON.stringify(response)};
setInterval(()=>{if(!app.isReady())return;try{
 const c=JSON.parse(fs.readFileSync(control,'utf8'));if(!c.id||c.id<=lastRequest)return;
 const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/quickpanel.html'));if(c.destroy)w?.destroy();
 fs.writeFileSync(response,JSON.stringify({id:c.id,value:{exists:Boolean(w&&!w.isDestroyed()),visible:Boolean(w&&!w.isDestroyed()&&w.isVisible()),frames,messages}}));
 lastRequest=c.id;
}catch(error){console.error('Reveal test control:',error.message);}},15).unref();`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:/suira-electron/electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 let id=0;const rpc=async extra=>{const request=++id;fs.writeFileSync(control+'.next',JSON.stringify({id:request,...extra}));fs.renameSync(control+'.next',control);return until(()=>{if(!fs.existsSync(response))return;const data=JSON.parse(fs.readFileSync(response));return data.id===request?data.value:null;});};
 const main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);await until(()=>main.evaluate('Boolean(window.suira)'));
 const measured=[];
 const show=async()=>{const before=await rpc(),start=Date.now();await main.evaluate('window.suira.quick.show()');const result=await until(async()=>{const r=await rpc();return r.visible&&r.frames.length>before.frames.length&&r.frames.at(-1).dom?r:null;});const frame=result.frames.at(-1);assert.equal(frame.dom.keys,38);assert.equal(frame.dom.mode,'actions');assert.ok(frame.dom.prepared);assert.ok(['none','panel-reveal'].includes(frame.dom.animation));assert.equal(frame.native,true);assert.equal(frame.frame,true);const inspectedMs=Date.now()-start;measured.push({nativeMs:frame.at-start,inspectedMs});return inspectedMs;};
 const cold=await show();let panel=await until(()=>connect(port,t=>t.url.endsWith('/quickpanel.html')));sockets.push(panel.ws);
 const first=await rpc();
 assert.equal(first.visible,true,'The repeated request starts with the panel open');
 await panel.evaluate('window.suira.quick.show()');
 const refocused=await until(async()=>{const next=await rpc();return next.messages.filter(m=>m.name==='quick:selection').length>first.messages.filter(m=>m.name==='quick:selection').length?next:null;});
 assert.equal(refocused.frames.length,first.frames.length,'An already visible panel is not shown again');
 assert.equal(refocused.messages.filter(m=>m.name==='quick:shown').length,1,'Refocus does not send a second reveal notification');
 await panel.evaluate('document.getElementById("mode-apps").click();window.suira.quick.hide()');await until(async()=>!(await rpc()).visible);
 const warm=[];for(let i=0;i<3;i++){warm.push(await show());await panel.evaluate('window.suira.quick.hide()');await until(async()=>!(await rpc()).visible);}
 const before=await rpc();await panel.evaluate('window.suira.quick.show();window.suira.quick.hide();true');await wait(500);const cancelled=await rpc();assert.equal(cancelled.visible,false);assert.equal(cancelled.frames.length,before.frames.length,'Cancelled preparation must not reveal later');
 const result=await rpc(),shown=result.messages.filter(m=>m.name==='quick:shown');assert.equal(shown.length,4,'Exactly one shown notification per completed invocation');
 await rpc({destroy:true});const recreated=await show();panel=await until(()=>connect(port,t=>t.url.endsWith('/quickpanel.html')));sockets.push(panel.ws);
 await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const motion=await panel.evaluate(`(()=>{const node=document.getElementById('panel');SuiraUI.resetReveal(node);SuiraUI.reveal(node);const style=getComputedStyle(node);const tokenMs=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-fast'))||0;return {name:style.animationName,duration:style.animationDuration,tokenMs};})()`);assert.equal(motion.name,'panel-reveal');assert.equal(Math.round(parseFloat(motion.duration)*1000),Math.round(motion.tokenMs));assert.ok(motion.tokenMs>0&&motion.tokenMs<=160);
 for(const input of ['pointermove','pointerdown','keydown']){
   const state=await panel.evaluate(`(()=>{const node=document.getElementById('panel');SuiraUI.resetReveal(node);SuiraUI.reveal(node);
     const initial=node.classList.contains('is-revealing');document.body.dispatchEvent(new Event(${JSON.stringify(input)},{bubbles:true}));
     const afterInput=getComputedStyle(node).animationName;SuiraUI.reveal(node);
     return {initial,afterInput,afterDuplicate:getComputedStyle(node).animationName};})()`);
   assert.deepEqual(state,{initial:true,afterInput:'none',afterDuplicate:'none'},'First '+input+' completes this reveal without replay');
 }
 await panel.evaluate(`(()=>{const node=document.getElementById('panel');SuiraUI.resetReveal(node);SuiraUI.reveal(node);node.getAnimations()[0].pause();return true;})()`);
 await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await until(()=>panel.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.getElementById('panel').classList.contains('is-revealing')`));
 await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 assert.equal(await panel.evaluate(`(()=>{const node=document.getElementById('panel');SuiraUI.reveal(node);return getComputedStyle(node).animationName;})()`),'none','Restoring motion does not replay an existing reveal');

 const paired={enabled:[],disabled:[]};
 for(let trial=0;trial<4;trial++)for(const enabled of (trial%2?[true,false]:[false,true])){
   await panel.evaluate('(()=>{let s=document.getElementById("reveal-benchmark-style");if(!s){s=document.createElement("style");s.id="reveal-benchmark-style";document.head.append(s);}s.textContent='+JSON.stringify(enabled?'':'.panel.is-revealing{animation:none!important}')+';window.suira.quick.hide();return true;})()');
   await until(async()=>!(await rpc()).visible);await wait(180);await show();paired[enabled?'enabled':'disabled'].push(measured.at(-1).nativeMs);console.log('PAIRED',enabled?'enabled':'disabled',measured.at(-1));
 }
 await panel.evaluate('document.getElementById("reveal-benchmark-style").remove();true');
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[1]+sorted[2])/2;};
 const pairedMedians={enabled:median(paired.enabled),disabled:median(paired.disabled)};
 assert.ok(pairedMedians.enabled<=pairedMedians.disabled+32,'The renderer animation must not delay native reveal');

 const proof={version,motion,paired,pairedMedians,measured,coldReadyBeforeShow:true,warmReadyBeforeShow:true,oneShownEvent:true,cancelledRevealSuppressed:true,recreatedReadyBeforeShow:true,keys:38,nativeBlur:true,nativeCorners:true,nonBlockingRevealMilliseconds:parseFloat(motion.duration)*1000,coldMilliseconds:cold,warmMilliseconds:warm,recreatedMilliseconds:recreated};fs.writeFileSync(path.join(root,'docs',`panel-reveal-${version}.json`),JSON.stringify(proof,null,2)+'\n');console.log('PASS native panel reveal',JSON.stringify(proof));
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1800));process.exitCode=1;}).finally(async()=>{sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(200);if(path.dirname(tmp)!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});});
