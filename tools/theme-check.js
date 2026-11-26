'use strict';
// Real Electron, production preloads and pages; isolated data and wallpaper fixtures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store'),{PRESET_NAMES,presetPalette,contrast}=require('../lib/palette');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-theme-')),control=path.join(tmp,'control.json'),response=path.join(tmp,'response.json'),log=path.join(tmp,'app.log');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child,client;
async function until(fn){let last;for(let i=0;i<360;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(50);}throw last||Error('Theme verification timed out');}
const probe=`(()=>{const r=document.documentElement,s=getComputedStyle(r),n=document.createElement('span');n.style.cssText='position:absolute;color:var(--on-accent);background:var(--accent-9)';document.body.append(n);const c=getComputedStyle(n),v={name:location.pathname+location.search,preset:r.dataset.theme,revision:r.dataset.themeRevision,mode:r.dataset.glassMode,first:r.dataset.themeCheckFirst?JSON.parse(r.dataset.themeCheckFirst):null,slate:s.getPropertyValue('--slate-2').trim(),accent:s.getPropertyValue('--accent-9').trim(),ink:c.color,button:c.backgroundColor};n.remove();return v;})()`;
const expectedRoles=['main','panel','calendar','markdown','text','notes','clipboard','island','voice','overlay','editor','pin','longCapture','picker','longPreview','longOutline','export'];
const windowSpecs=[['panel','quickpanel',''],['calendar','index','tool=calendar'],['markdown','index','tool=markdown'],['text','text-tools','mode=translate'],['notes','notes',''],['clipboard','clipboardbar',''],['island','island',''],['voice','voice-input',''],['overlay','overlay',''],['editor','overlay','mode=image-editor'],['pin','pin',''],['longCapture','long-capture',''],['picker','long-picker',''],['longPreview','long-preview',''],['longOutline','long-outline',''],['export','export','']];
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});await store.save();fs.writeFileSync(control,'{}');
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const probePreload=path.join(tmp,'first-frame-probe.js');
 fs.writeFileSync(probePreload,`
 'use strict';
 if(typeof document!=='undefined'&&typeof window!=='undefined'&&window.top===window){
  try{require('electron').ipcRenderer.sendSync('__theme_check_preload_done');}catch{}
  let domLoaded=false;
  const latch=()=>{const r=document.documentElement;if(!r||r.dataset.themeCheckFirst)return;r.dataset.themeCheckFirst=JSON.stringify({name:location.pathname+location.search,beforeDomContentLoaded:!domLoaded,readyState:document.readyState,preset:r.dataset.theme,revision:r.dataset.themeRevision,mode:r.dataset.glassMode});};
  document.addEventListener('readystatechange',latch,{once:true});
  document.addEventListener('DOMContentLoaded',()=>{domLoaded=true;},{capture:true,once:true});
  if(document.documentElement)latch();
  else{const o=new window.MutationObserver(()=>{if(document.documentElement){latch();o.disconnect();}});o.observe(document,{childList:true,subtree:true});}
 }
 `);
 const entry=path.join(tmp,'app.js');
 fs.writeFileSync(entry,`
 const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{app,BrowserWindow,clipboard,globalShortcut,systemPreferences,nativeImage,session,ipcMain}=require('electron');
 app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};systemPreferences.getAccentColor=()=> 'e05020ff';
 const palette=require(${JSON.stringify(path.join(root,'lib/palette'))}),background=require(${JSON.stringify(path.join(root,'lib/launchpad-background'))}),originalRead=background.readWallpaperSample;
 const themes=path.join(${JSON.stringify(profile)},'Microsoft/Windows/Themes');fs.mkdirSync(themes,{recursive:true});const wallpaper=path.join(themes,'TranscodedWallpaper');
 function png(color){const chunk=(type,data)=>{const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,bytes,sum]);};const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(128*(1+128*4));for(let y=0;y<128;y++)for(let x=0;x<128;x++)Buffer.from([...color,255]).copy(rows,y*513+1+x*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
 fs.writeFileSync(wallpaper,png([220,30,20]));background.readWallpaperSample=ni=>originalRead(ni,{APPDATA:${JSON.stringify(profile)}});
 const controller=require(${JSON.stringify(path.join(root,'lib/theme-controller'))}),create=controller.createThemeController;controller.createThemeController=options=>create({...options,env:{APPDATA:${JSON.stringify(profile)}},pollMs:1000});
 const roles=new Map(),initialServed=new Set(),initialAtPreload=new Set();
 ipcMain.on('__theme_check_preload_done',event=>{const role=roles.get(event.sender.id);if(role&&initialServed.has(role))initialAtPreload.add(role);event.returnValue=true;});
 const windowIpc=require(${JSON.stringify(path.join(root,'lib/window-ipc'))}),createBoundary=windowIpc.createWindowBoundary;let boundary;
 windowIpc.createWindowBoundary=options=>{boundary=createBoundary(options);const origCreate=boundary.create,origHandleSync=boundary.handleSync;boundary.create=(role,opts)=>{const w=origCreate(role,opts);roles.set(w.webContents.id,role);return w;};boundary.handleSync=(channel,handler)=>origHandleSync(channel,(event,...args)=>{const reply=handler(event,...args);if(channel==='theme:initial'&&reply&&roles.has(event.sender.id))initialServed.add(roles.get(event.sender.id));return reply;});return boundary;};
 const hookSession=ses=>{if(!ses||ses.__themeProbeHooked)return;ses.__themeProbeHooked=true;const orig=ses.registerPreloadScript.bind(ses);ses.registerPreloadScript=script=>{const res=orig(script);if(String(script?.filePath||'').endsWith('theme-preload.js'))orig({type:'frame',filePath:${JSON.stringify(probePreload)}});return res;};};
 app.on('session-created',hookSession);app.once('ready',()=>hookSession(session.defaultSession));
 const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.on('preload-error',(_e,p,error)=>errors.push(String(error)));});
 require(${JSON.stringify(path.join(root,'main.js'))});let last=0;
 setInterval(async()=>{let c;try{c=JSON.parse(fs.readFileSync(${JSON.stringify(control)}));}catch{return;}if(!c.id||last===c.id)return;last=c.id;try{
 if(c.open){await Promise.all(${JSON.stringify(windowSpecs)}.map(([role,file,query])=>{const preload=['export','long-outline'].includes(file)?undefined:file==='pin'?'pin-preload.js':file==='voice-input'?'voice-preload.js':'preload.js';const wp={preload:preload&&path.join(${JSON.stringify(root)},preload),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};if(role==='voice')wp.partition='suira-voice';const w=boundary.create(role,{show:false,width:1024,height:740,webPreferences:wp});return w.loadFile(path.join(${JSON.stringify(root)},'src',file+'.html'),{query:Object.fromEntries(new URLSearchParams(query+'&themeFixture=1'))});}));}
 if(c.accent)systemPreferences.emit('accent-color-changed',{},c.accent);
 if(c.wallpaper){fs.writeFileSync(wallpaper,png(c.wallpaper));const now=new Date(Date.now()+1000);fs.utimesSync(wallpaper,now,now);}
 const sample=await background.readWallpaperSample(nativeImage),all=await Promise.all(BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL().includes('.html')).map(async w=>({role:roles.get(w.webContents.id)||null,...(await w.webContents.executeJavaScript(${JSON.stringify(probe)}).catch(error=>({error:String(error)})))})));
 fs.writeFileSync(${JSON.stringify(response)},JSON.stringify({id:c.id,all,errors,initialServed:[...initialServed],initialAtPreload:[...initialAtPreload],sample:sample&&{width:sample.width,height:sample.height,dominant:palette.dominantColor(sample.data,{order:sample.order})}}));
 }catch(error){fs.writeFileSync(${JSON.stringify(response)},JSON.stringify({id:c.id,error:String(error)}));}},30).unref();
 `);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(log,'w');child=spawn('C:/suira-electron/electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 client=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));await until(()=>client.evaluate('Boolean(window.suira?.theme)'));
 let id=0;async function rpc(extra={}){const key=++id;fs.writeFileSync(control,JSON.stringify({id:key,...extra}));return until(()=>{if(!fs.existsSync(response))return;const r=JSON.parse(fs.readFileSync(response));if(r.id!==key)return;if(r.error)throw Error(r.error);return r;});}
 const initialMaterial=await client.evaluate('window.suira.theme.state().then(s=>s.forcedSolid?"solid":s.material)');
 const opened=await rpc({open:true});assert.deepEqual(opened.errors,[]);
 const byRole=list=>new Map(list.map(w=>[w.role,w]));
 const openedRoles=byRole(opened.all);for(const role of expectedRoles)assert.ok(openedRoles.has(role),'Missing window role: '+role);
 assert.ok(opened.sample.width<=64&&opened.sample.height<=64);assert.equal(opened.sample.dominant,'#dc1e14','Native BGRA order and real wallpaper reader preserve red');
 const records=[];
 for(const mode of ['light','dark'])for(const preset of PRESET_NAMES){
   await client.evaluate(`window.suira.settings.update(${JSON.stringify({theme:mode,themePreset:preset,accentSource:'preset'})})`);
   const state=await client.evaluate('window.suira.theme.state()');
   const result=await until(async()=>{const r=await rpc();const map=byRole(r.all);return expectedRoles.every(role=>{const w=map.get(role);return w&&w.preset===preset&&w.slate===state.palette[mode].slate[1];})?r:null;});
   for(const w of result.all){const ink=w.ink.match(/[\d.]+/g).slice(0,3).map(Number),button=w.button.match(/[\d.]+/g).slice(0,3).map(Number);assert.ok(contrast(ink,button)>=4.5,w.name+' primary contrast');}
   records.push({preset,mode,windows:result.all.length,slate:result.all[0].slate});console.log('PASS',preset,mode,result.all.length,'windows');
 }
 await client.evaluate('window.suira.settings.update({themePreset:"paper",theme:"light",accentSource:"windows"})');await rpc({accent:'10c080ff'});
 await until(()=>client.evaluate('window.suira.theme.state().then(s=>s.dominant==="#10c080")'));const accentState=await client.evaluate('window.suira.theme.state()');assert.equal(accentState.palette.light.slate[1],presetPalette('paper').light.slate[1]);
 await client.evaluate('window.suira.settings.update({themePreset:"wallpaper",accentSource:"wallpaper"})');const before=await client.evaluate('window.suira.theme.state().then(s=>s.dominant)');await rpc({wallpaper:[20,50,220]});await until(()=>client.evaluate(`window.suira.theme.state().then(s=>s.dominant!==${JSON.stringify(before)})`));
 for(const material of ['clear','liquid','soft','solid']){await client.evaluate(`window.suira.settings.update({panelMaterial:${JSON.stringify(material)}})`);await until(async()=>{const map=byRole((await rpc()).all);return expectedRoles.every(role=>{const w=map.get(role);return w&&w.mode===(role==='panel'?material:'solid');});});}
 const final=await rpc();assert.deepEqual(final.errors,[]);
 const finalRoles=byRole(final.all),served=new Set(final.initialServed||[]),atPreload=new Set(final.initialAtPreload||[]);
 for(const role of expectedRoles){
   assert.ok(served.has(role),'theme:initial not served to registered role: '+role);
   assert.ok(atPreload.has(role),role+' first-frame theme:initial must run during preload before DOMContentLoaded');
   const w=finalRoles.get(role);assert.ok(w&&w.first,'Missing latched pre-DOM-ready state for role: '+role);
   assert.equal(w.first.beforeDomContentLoaded,true,role+' latched before DOMContentLoaded');
   assert.equal(w.first.preset,'mist',role+' first-frame preset');
   assert.ok(w.first.revision,role+' first-frame revision');
   assert.equal(w.first.mode,role==='panel'?initialMaterial:'solid',role+' first-frame glassMode');
 }
 await client.evaluate('document.querySelector("[data-page=settings]").click();true');await until(()=>client.evaluate('document.querySelectorAll(".theme-presets button").length===6'));
 await client.evaluate('document.querySelector("[data-preset=pine]").click();true');await until(()=>client.evaluate('document.documentElement.dataset.theme==="pine"'));
 assert.equal(await client.evaluate('document.querySelector("[data-glass-setting]").type'),'range');
 const shot=await client.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/screenshots/theme-settings.png'),Buffer.from(shot.data,'base64'));
 fs.writeFileSync(path.join(root,'docs',`themes-${version}.json`),JSON.stringify({version,records,nativeWallpaperMax64:true,nativeBgraVerified:true,windowsAccentLive:true,wallpaperChangesLive:true,sharedPreloadsBeforeDomReady:true,primaryContrastAtLeast4_5:true,materialFourModes:true,settingsCardsWork:true},null,2)+'\n');
 console.log('PASS live Windows/wallpaper updates, all windows, initial frames, card controls and four material modes');
})().catch(e=>{console.error(e);if(fs.existsSync(log))console.error(fs.readFileSync(log,'utf8').slice(-1200));process.exitCode=1;}).finally(async()=>{client?.ws.close();if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(300);try{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});}catch{}});
