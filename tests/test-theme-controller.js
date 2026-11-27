'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createThemeController}=require('../lib/theme-controller'),{installThemeBridge}=require('../lib/theme-preload'),{SuiraStore}=require('../lib/store');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'suira-theme-test-'));
  try{
    const store=new SuiraStore(path.join(folder,'data.json'));
    assert.equal(store.getSettings().themePreset,'mist');assert.equal(store.getSettings().accentSource,'preset');
    await store.updateSettings({themePreset:'paper',accentSource:'windows'});
    await store.updateSettings({themePreset:'bogus',accentSource:'bogus'});
    assert.equal(store.getSettings().themePreset,'paper');assert.equal(store.getSettings().accentSource,'windows');
    await store.save();const loaded=new SuiraStore(path.join(folder,'data.json'));await loaded.load();assert.equal(loaded.getSettings().themePreset,'paper');
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
  let settings={themePreset:'mist',accentSource:'preset',panelMaterial:'liquid'},sample={data:Buffer.from([10,160,30,255]),order:'rgba'},reads=0,watched=0,closed=0;
  const native=Object.assign(new EventEmitter(),{shouldUseDarkColors:false}),windows=Object.assign(new EventEmitter(),{getAccentColor:()=> 'ff0000ff'}),sent=[];
  let reader=async()=>{reads++;return sample;};
  const controller=createThemeController({getSettings:()=>settings,nativeTheme:native,systemPreferences:windows,readWallpaper:()=>reader(),publish:v=>sent.push(v),env:{APPDATA:folder},watch:()=>{watched++;const e=new EventEmitter();e.close=()=>closed++;return e;},pollMs:100000});
  try{
    await controller.refresh();assert.equal(reads,0);assert.equal(watched,0);
    settings={...settings,accentSource:'windows'};await controller.refresh();assert.equal(controller.snapshot().dominant,'#ff0000');
    windows.emit('accent-color-changed',{},'0000ffff');await delay(240);assert.equal(controller.snapshot().dominant,'#0000ff');
    settings={...settings,themePreset:'wallpaper',accentSource:'preset'};await controller.refresh();assert.equal(controller.snapshot().wallpaperAvailable,true);assert.equal(watched,1);
    assert.ok(!JSON.stringify(controller.snapshot()).includes('APPDATA'));
    let resolve;reader=()=>new Promise(r=>{resolve=r;});const stale=controller.refresh();settings={...settings,themePreset:'paper'};await controller.refresh();resolve(sample);await stale;assert.equal(controller.snapshot().preset,'paper','Late wallpaper does not overwrite a newer preset');assert.equal(closed,1);
    settings={...settings,accentSource:'wallpaper'};reader=async()=>null;await controller.refresh();assert.equal(controller.snapshot().accentAvailable,false);assert.equal(controller.snapshot().preset,'paper');
    const ipc=new EventEmitter(),styles=new Map(),root={dataset:{},style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}},media=new EventEmitter();media.matches=false;media.addEventListener=media.on.bind(media);ipc.sendSync=()=>controller.snapshot();
    installThemeBridge({ipcRenderer:ipc,document:{documentElement:root,addEventListener:()=>{}},window:{location:{pathname:'/src/quickpanel.html'},matchMedia:()=>media}});
    assert.equal(root.dataset.theme,'paper');assert.equal(root.dataset.glassMode,'liquid','QuickPanel follows glass material');assert.equal(styles.size,25);assert.equal(styles.get('--slate-2'),'#f6f2ea');
    const clipRoot={dataset:{},style:{setProperty:()=>{},removeProperty:()=>{}}};
    installThemeBridge({ipcRenderer:ipc,document:{documentElement:clipRoot,addEventListener:()=>{}},window:{location:{pathname:'/src/clipboardbar.html'},matchMedia:()=>media}});
    assert.equal(clipRoot.dataset.glassMode,'solid','Non-panel windows stay solid across theme broadcasts');
    const mdRoot={dataset:{},style:{setProperty:()=>{},removeProperty:()=>{}}};
    installThemeBridge({ipcRenderer:ipc,document:{documentElement:mdRoot,querySelector:s=>s==='.panel'?{className:'panel'}:null,addEventListener:()=>{}},window:{location:{pathname:'/src/index.html',href:'file:///C:/app/src/index.html?tool=markdown'},matchMedia:()=>media}});
    assert.equal(mdRoot.dataset.glassMode,'solid','Markdown window starts solid even when document contains .panel');
    settings={...settings,panelMaterial:'soft'};await controller.refresh();ipc.emit('theme:changed',{},controller.snapshot());
    assert.equal(root.dataset.glassMode,'soft','QuickPanel follows glass material broadcast');
    assert.equal(clipRoot.dataset.glassMode,'solid','Clipboard bar stays solid after material broadcast');
    assert.equal(mdRoot.dataset.glassMode,'solid','Markdown window stays solid after material broadcast even with .panel');
    media.matches=true;media.emit('change');assert.equal(styles.get('--slate-2'),'#211c17');assert.equal(clipRoot.dataset.glassMode,'solid','System theme change keeps non-panel windows solid');assert.equal(mdRoot.dataset.glassMode,'solid','System theme change keeps Markdown solid even with .panel');
    ipc.emit('theme:changed',{}, {...controller.snapshot(),revision:0,preset:'ink'});assert.equal(root.dataset.theme,'paper','Out-of-order broadcast is ignored');
    native.shouldUseDarkColors=true;native.emit('updated');await delay(240);assert.equal(controller.snapshot().dark,true);
    native.prefersReducedTransparency=true;await controller.refresh();ipc.emit('theme:changed',{},controller.snapshot());assert.equal(root.dataset.glassMode,'solid');assert.equal(root.dataset.themeForcedSolid,'true');
  }finally{controller.dispose();}
  assert.equal(windows.listenerCount('accent-color-changed'),0);assert.equal(native.listenerCount('updated'),0);
  console.log('PASS stored preferences, Windows accent events, wallpaper race/fallback, shared preload and listener cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
