'use strict';
// Isolated, fictional trace data. Real Electron + real actions, no user clipboard/network.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {SuiraStore}=require('../lib/store'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),sockets=[];let child;
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){let last;for(let n=0;n<150;n++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(40);}throw last||Error('Trace state timed out');}
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});const now=Date.now();
 for(const item of [
  {id:'image',kind:'image',title:'界面评审截图',createdAt:now-3600000},
  {id:'ocr',kind:'text',title:'截图文字',text:'让 收 集 更 连 贯\n\n保 留 清 楚 的 内 容 层 次',parentIds:['image'],createdAt:now-3500000},
  {id:'clean',kind:'text',title:'整理后的评审要点',text:'让收集更连贯\n保留清楚的内容层次',parentIds:['ocr'],createdAt:now-3400000},
  {id:'meeting',kind:'text',title:'项目会议记录',text:'周五讨论下一版体验，整理已收集的参考。',createdAt:now-4000000},
  {id:'retry',kind:'text',title:'待整理的笔记',text:'  记下想法  \n\n\n继续下一步  ',createdAt:now-3000000},
  {id:'poster',kind:'image',title:'活动海报',createdAt:now-5000},
  {id:'gone-output',kind:'text',title:'已保留的派生内容',text:'原内容已清理',parentIds:['gone-content'],createdAt:now-4000}
 ])store.addItem(item);
 const add=(id,actionId,inputIds,outputIds,status,ago,duration,error='')=>store.recordExecution({id,actionId,inputIds,outputIds,status,startedAt:now-ago,finishedAt:status==='running'?0:now-ago+duration,error});
 add('ocr1','ocr.local',['image'],['ocr'],'done',3600000,1180);add('clean1','text.clean',['ocr'],['clean'],'done',3500000,82);add('translate1','text.translate',['clean'],[],'failed',3400000,210,'目标语言与原文相同，请换一个目标语言');add('translate2','text.translate',['clean'],[],'failed',3300000,160,'目标语言与原文相同，请换一个目标语言');add('copy1','output.copy',['clean'],[],'done',3200000,31);
 add('meeting-copy','output.copy',['meeting'],[],'done',4200000,28);add('retry1','text.clean',['retry'],[],'failed',3800000,50,'整理暂时未完成，请重试');add('poster-ocr','ocr.local',['poster'],[],'running',1500,0);add('gone','text.clean',['gone-content'],[],'failed',7200000,20,'原内容已被清理');await store.save();
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';clipboard.writeText=()=>{};globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:/suira-electron/electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);const ev=main.evaluate;
 await until(()=>ev('Boolean(window.suira)&&Boolean(document.querySelector(".task-list-empty,.task-row"))'));
 await ev('window.__traceErrors=[];addEventListener("error",e=>window.__traceErrors.push(e.message));document.querySelector("[data-page=library]").click();true');
 await until(()=>ev('Boolean(document.querySelector("[data-preview=image]"))'));
 assert.equal(await ev('Boolean(document.querySelector("[data-page=trail],#page-trail"))'),false,'History has no standalone navigation');
 const shot=async name=>{if(!process.argv.includes('--shots'))return;const image=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/product',name+'.png'),Buffer.from(image.data,'base64'));};
 const click=async selector=>{const p=await ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!e)throw Error("No visible control: "+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await main.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
 const openItem=async id=>{
   await ev('if(!document.getElementById("preview").hidden)document.getElementById("preview-close").click();true');
   await click('[data-preview="'+id+'"]');assert.equal(await ev('document.getElementById("preview-trail").open'),false);
   await click('#preview-trail>summary');await until(()=>ev('document.querySelectorAll("#content-trail .trace-group").length===1'));
 };
 await openItem('image');assert.equal(await ev('document.querySelector(".trace-group").textContent.includes("4 个步骤 · 5 次处理")'),true);
 assert.equal(await ev('[...document.querySelectorAll(".trace-duration")].filter(e=>e.checkVisibility()).length'),0,'Durations stay hidden by default');await shot('trace-overview');
 await click('[data-step-id="translate2"]>summary');assert.equal(await ev('document.querySelector("[data-step-id=translate2]").open'),true);assert.equal(await ev('document.querySelector("[data-step-id=translate2] .trace-attempts").textContent.includes("1 次尝试")'),true);await shot('trace');
 await click('[data-trace-timing="image"]');assert.equal(await ev('document.querySelector("[data-group-id=image] .trace-timings").hidden'),false);
 await ev('refreshTrail()');assert.equal(await ev('document.querySelector("[data-step-id=translate2]").open'),true,'Refreshing preserves expanded steps');
 await click('[data-trace-preview="clean"]');assert.equal(await ev('document.querySelector(".preview-text").textContent'),'让收集更连贯\n保留清楚的内容层次');
 await click('#preview-trail>summary');await until(()=>ev('Boolean(document.querySelector("[data-step-id=translate2]"))'));if(!await ev('document.querySelector("[data-step-id=translate2]").open'))await click('[data-step-id="translate2"]>summary');await wait(220);if(await ev('document.querySelector("[data-trace-timing=image]").getAttribute("aria-pressed")=="true"'))await click('[data-trace-timing=image]');await ev('document.querySelector("[data-step-id=translate2]").scrollIntoView({block:"start"});true');await shot('trace');await click('[data-trace-translate="clean"]');
 const translation=await until(()=>connect(port,t=>t.url.includes('text-tools.html?mode=translate')));sockets.push(translation.ws);await until(()=>translation.evaluate('document.getElementById("tool-source").value.includes("让收集更连贯")'));await translation.evaluate('document.getElementById("tool-close").click();true');await main.send('Page.bringToFront');
 await openItem('poster');assert.equal(await ev('[...document.querySelectorAll(".trace-duration")].some(e=>e.checkVisibility())'),false);await click('[data-trace-timing=poster]');
 const before=await ev('document.querySelector("[data-duration-group=poster]").textContent');await wait(1100);assert.notEqual(await ev('document.querySelector("[data-duration-group=poster]").textContent'),before,'Opt-in running durations update');
 await openItem('gone-output');await click('[data-step-id=gone]>summary');assert.equal(await ev('document.querySelector("[data-group-id=gone-content]").textContent.includes("原内容已清理，无法重试")'),true);assert.equal(await ev('Boolean(document.querySelector("[data-group-id=gone-content] [data-trace-retry]"))'),false);
 await openItem('retry');await click('[data-step-id=retry1]>summary');await click('[data-trace-retry=retry1]');await until(()=>ev('document.querySelector("[data-group-id=retry] .trace-group-meta .trace-status").textContent==="已完成"'));assert.equal(await ev('document.querySelector("[data-group-id=retry]").textContent.includes("2 次尝试")'),true);
 const originals=await ev('window.suira.content.list({limit:500})');assert.equal(originals.find(i=>i.id==='retry').text,'  记下想法  \n\n\n继续下一步  ');assert.equal(await ev('document.querySelectorAll(".trace-group").length'),1,'Only this content lineage is shown');
 for(const theme of ['light','dark']){await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await main.send('Emulation.setDeviceMetricsOverride',{width:820,height:720,deviceScaleFactor:1,mobile:false});assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await ev('document.getElementById("content-trail").scrollWidth<=document.getElementById("content-trail").clientWidth+1'),true);}
 assert.deepEqual(await ev('window.__traceErrors'),[]);
 const proof={version,source:'isolated real Electron profile and real local text action',embeddedInContentDetails:true,noStandaloneNavigation:true,contentLineageGrouping:true,retryAttemptsCollapsed:true,inputPreview:true,adjustTranslation:true,stepDurationsHiddenByDefault:true,optInLiveDurations:true,expandedStateRetained:true,missingContentHonest:true,realRetryRecoversWithoutDuplicateGroup:true,originalTextPreserved:true,lightDarkAndNarrowLayout:true};fs.writeFileSync(path.join(root,'docs',`trail-${version}.json`),JSON.stringify(proof,null,2)+'\n');console.log('PASS embedded trace workflows',JSON.stringify(proof));
})().catch(e=>{console.error(e);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1000));process.exitCode=1;}).finally(async()=>{sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(250);if(path.dirname(tmp)!==path.resolve(os.tmpdir()))throw Error('Unsafe test cleanup');fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});});
