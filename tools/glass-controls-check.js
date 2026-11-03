'use strict';
// Real product pages, disposable encrypted profile and synthetic test backing only.
// No desktop image or user data is captured. Screenshots demonstrate CSS contrast,
// not DWM background composition (covered by native-glass-live-check.js).
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),sockets=[];
let child;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let last;for(let i=0;i<160;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(80);}throw last||Error('Glass controls not ready');}
const parse=s=>{const m=s.match(/rgba?\(([^)]+)\)/);assert.ok(m,'Expected computed RGB: '+s);const a=m[1].split(',').map(Number);return [...a.slice(0,3),a[3]??1];};
const blend=(front,back)=>[...front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3])),1];
const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));
 await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true,panelMaterial:'clear'});
 const item=store.addItem({kind:'text',title:'周末拍摄清单',text:'相机、电池、路线图\n出发前检查天气',source:{type:'user'}});await store.save();
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};require(${JSON.stringify(path.join(root,'main.js'))});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 const page=async suffix=>{const c=await until(()=>connect(port,t=>t.url.includes(suffix)));sockets.push(c.ws);await until(()=>c.evaluate('Boolean(window.suira && document.documentElement.dataset.glassBackend)'));return c;};
 const main=await page('/index.html');await until(()=>main.evaluate('Boolean(window.WorkspaceUI)'));
 const proof={version,syntheticBacking:true,userDataCaptured:false,checks:[],contrast:[]};
 const style=async(c,selector)=>c.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});const s=getComputedStyle(n);return {background:s.backgroundColor,image:s.backgroundImage,color:s.color,border:s.borderColor,shadow:s.boxShadow,display:s.display};})()`);
 const prepare=async(c,theme)=>{await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await c.send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false});await c.evaluate(`document.body.style.setProperty('background',${JSON.stringify(theme==='light'?'#000':'#fff')},'important');true`);await wait(100);};
 const shot=async(c,name)=>{const s=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/product',`glass-controls-${version}-${name}.png`),Buffer.from(s.data,'base64'));};
 await prepare(main,'light');
 assert.equal((await style(main,'#task-detail')).image,'none','Empty task view has no giant white plate');
 assert.equal((await style(main,'#shelf-first')).display,'none','One primary task creation action');
 assert.ok(parse((await style(main,'.sidebar')).background)[3]<.15,'Navigation keeps the actual backdrop');
 await shot(main,'workbench');
 const secondary=(await style(main,'#shelf-import')).image;
 assert.ok(secondary.includes('linear-gradient'),'Secondary actions have the shared thin material');
 const task=await main.evaluate('window.suira.tasks.create("周末拍摄").then(r=>r.task)');
 await main.evaluate(`window.suira.tasks.addItem({taskId:${JSON.stringify(task.id)},itemId:${JSON.stringify(item.id)}})`);
 await until(()=>main.evaluate('Boolean(document.querySelector(".shelf-card-actions button"))'));
 assert.equal((await style(main,'.shelf-card-actions button')).image,secondary,'Actual content-card actions match the shared control surface');
 await main.evaluate('document.querySelector("[data-page=library]").click();true');
 assert.equal((await style(main,'.chip:not(.is-active)')).image,secondary);
 const active=await style(main,'.chip.is-active');assert.notEqual(active.background,active.color,'Selected filters retain readable ink');
 await main.evaluate('document.querySelector("[data-page=settings]").click();true');
 for(const selector of ['.number-input','.shortcut-input','[data-glass-setting]'])assert.equal((await style(main,selector)).image,secondary,selector+' uses shared material');
 proof.checks.push('Empty workbench hierarchy','Sidebar backing','Task content actions','Library filters','Settings fields');
 await main.evaluate('window.suira.workspace.open("markdown")');const md=await page('tool=markdown');await until(()=>md.evaluate('Boolean(document.querySelector("#welcome-open"))'));
 for(const theme of ['light','dark']){
  await prepare(md,theme);
  const primary=await style(md,'#welcome-open'),other=await style(main,'#shelf-new');
  if(theme==='light')assert.equal(primary.image,other.image,'Markdown and workbench primary actions share the same finish');
  const floor=await style(md,'.glass-scene'),back=blend(parse(floor.background),theme==='light'?[0,0,0,1]:[255,255,255,1]);
  // The veil alone is the minimum reading background; local films only improve it.
  for(const selector of ['#md-empty>b','#md-empty>p','#md-paste','.document-sidebar h3','.workspace-empty']){
   const s=await style(md,selector),ratio=contrast(parse(s.color),back);assert.ok(ratio>=4.5,theme+' '+selector+' contrast '+ratio.toFixed(2));proof.contrast.push({theme,selector,ratio:+ratio.toFixed(2)});
  }
  assert.equal((await style(md,'#md-paste')).shadow,'none','Text action has no clipped button edge');
  assert.equal(await md.evaluate('getComputedStyle(document.querySelector("#md-paste")).borderTopWidth'),'0px');
  await md.evaluate('document.querySelector("#welcome-open").focus();true');assert.equal(await md.evaluate('getComputedStyle(document.activeElement).outlineStyle'),'solid','Keyboard focus remains visible');
  await shot(md,'markdown-'+theme);
 }
 await main.evaluate('window.suira.workspace.open("calendar")');const calendar=await page('tool=calendar');await until(()=>calendar.evaluate('Boolean(document.querySelector(".agenda-tabs"))'));
 await prepare(calendar,'light');assert.equal((await style(calendar,'#calendar-new')).image,secondary,'Calendar add action matches secondary controls');
 assert.equal((await style(calendar,'.agenda-tabs .is-active')).image,secondary,'Selected segmented control has the same highlight');
 proof.checks.push('Markdown primary/secondary/text actions','Light-on-dark and dark-on-light reading contrast','Keyboard focus','Calendar add and segmented actions');
 await main.evaluate('window.suira.clipboardBar.show()');const clipboard=await page('/clipboardbar.html');
 await main.evaluate('window.suira.notes.create()');const note=await page('/notes.html');
 for(const c of [main,md,calendar,clipboard,note])assert.equal(await c.evaluate('document.querySelector(".glass-scene").children.length'),0,'Live background contains no image');
 proof.checks.push('Five reading/collection windows have no static background');
 fs.writeFileSync(path.join(root,'docs',`glass-controls-${version}.json`),JSON.stringify(proof,null,2)+'\n');
 console.log('PASS shared glass controls and reading contrast',JSON.stringify(proof));
})().catch(e=>{console.error(e);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1000));process.exitCode=1;}).finally(async()=>{sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(250);if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});});
