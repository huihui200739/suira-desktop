'use strict';
// Real app, isolated encrypted profile, fictional demo data, no user clipboard or OS shortcuts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { connect } = require('./runtime-client');
const { ensureNativeHost } = require('../lib/key-watch');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  let last;
  for (let n = 0; n < 160; n++) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await wait(80);
  }
  throw last || Error('App did not become ready');
}

async function run({ screenshots = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-doc-shots-'));
  const sockets = [];
  const foundationResults=[];
  let child;
  try {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const control = path.join(tmp, 'control.json');
    fs.writeFileSync(control, '{}');
    const entry = path.join(tmp, 'app.js');
    fs.writeFileSync(entry, `const fs=require('node:fs');
const {app,BrowserWindow,ipcMain,clipboard,globalShortcut,shell}=require('electron');
let openedUrl='', copiedFiles=[];
require(${JSON.stringify(path.join(root,'lib/clipboard-file-list'))}).copyFileList=(_handle,paths)=>{copiedFiles=paths;};
shell.openExternal=async url=>{openedUrl=url;};
app.setPath('userData',${JSON.stringify(path.join(tmp, 'profile'))});
app.getVersion=()=>${JSON.stringify(require('../package.json').version)};
clipboard.read=async()=>[];clipboard.readText=async()=>'';clipboard.write=async()=>{};
globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,name==='app:info'?async(...args)=>{
 const command=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));
 fs.writeFileSync(${JSON.stringify(control)},'{}');
 const target=command.id ? BrowserWindow.fromId(command.id) : null;
 if(target){if(command.size)target.setSize(...command.size);if(command.bounds)target.setBounds(command.bounds);if(command.focus){target.show();target.focus();}if(command.maximize)target.maximize();if(command.restore)target.unmaximize();}
 const {screen}=require('electron');return {...await fn(...args),openedUrl,copiedFiles,surfaces:BrowserWindow.getAllWindows().filter(w=>w.__surfaceRadius||['notes.html','clipboardbar.html'].some(page=>w.webContents.getURL().endsWith('/'+page))).map(w=>({id:w.id,url:w.webContents.getURL(),bounds:w.getBounds(),displayBounds:screen.getDisplayMatching(w.getBounds()).bounds,area:screen.getDisplayMatching(w.getBounds()).workArea,physicalArea:screen.dipToScreenRect(w,screen.getDisplayMatching(w.getBounds()).workArea),focused:w.isFocused(),material:w.__surfaceMaterial,shadow:w.hasShadow(),maximized:w.isMaximized(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()}))};
}:fn);
require(${JSON.stringify(path.join(root, 'main.js'))});`);
    const exe = [process.env.SUIRA_ELECTRON, 'C:\\suira-electron\\electron.exe',
      path.join(os.homedir(), 'suira-electron-dist/electron.exe'),
      path.join(root, 'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
    assert.ok(exe, 'Electron required');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(tmp, 'app.log'), 'w');
    child = spawn(exe, [entry, '--remote-debugging-port=' + port], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    let themeOwner;
    const setTheme = async (client, theme) => {
      await (themeOwner || client).evaluate('window.suira.settings.update('+JSON.stringify({theme})+')');
      await until(() => client.evaluate('matchMedia("(prefers-color-scheme: dark)").matches === '+ (theme === 'dark')));
    };
    const page = async select => {
      const client = await until(() => connect(port, select)); sockets.push(client.ws);
      await until(() => client.evaluate('Boolean(window.suira) && document.readyState === "complete"'));
      const palettes=[];
      for(const scheme of ['light','dark']){
        await setTheme(client, scheme);
        await wait(180);
        const facts=await client.evaluate(`document.fonts.ready.then(()=>{const s=getComputedStyle(document.documentElement);return {url:location.pathname.split('/').pop(),main:document.documentElement.classList.contains('workbench'),font:getComputedStyle(document.body).fontFamily,fontLoaded:[...document.fonts].some(f=>f.family.replaceAll('"','')==='MiSans VF'&&f.status==='loaded'),accent:s.getPropertyValue('--accent').trim(),focus:s.getPropertyValue('--focus-ring').trim(),buttons:[...document.querySelectorAll('.primary-btn,.utility-primary')].filter(b=>!b.matches(':hover,.mia-icon')&&b.getClientRects().length).map(b=>({id:b.id,label:b.textContent,root:document.documentElement.className,primary:getComputedStyle(b).getPropertyValue('--glass-primary').trim(),background:getComputedStyle(b).backgroundColor,ink:getComputedStyle(b).color}))}})`);
        const markdown = await client.evaluate('document.documentElement.dataset.tool === "markdown"');
        const note = facts.url === 'notes.html';
        const workspace = facts.url === 'index.html';
        const dark = scheme === 'dark';
        assert.equal(facts.accent,markdown?(dark?'#f5f5f5':'#757575'):workspace?(dark?'#3b3b3e':'#18181b'):(dark?'#b1a9ff':'#5b5bd6'));
        assert.equal(facts.focus,note?'#757575':markdown?(dark?'#f5f5f5':'#757575'):workspace?(dark?'#f5f5f5':'#18181b'):(dark?'#5958b1':'#9b9ef0'));
        if (facts.url === 'notes.html') {
          assert.equal(await client.evaluate('getComputedStyle(document.getElementById("note")).backgroundColor'),'rgb(255, 255, 255)');
        }
        assert.equal(facts.fontLoaded,facts.main,'VF must be decoded only by the main workbench');
        for(const button of facts.buttons){assert.notEqual(button.background,button.ink,JSON.stringify(button));}
        palettes.push({scheme,...facts});
      }
      await setTheme(client, 'light');
      foundationResults.push(...palettes);return client;
    };
    const main = await page(t => t.url.endsWith('/index.html'));
    themeOwner = main;
    await until(() => main.evaluate('Boolean(window.WorkspaceUI)'));
    // Query the actual Windows HRGN, not a mock of BrowserWindow.setShape.
    const source = path.join(tmp, 'region.cs');
    fs.writeFileSync(source, `using System;using System.IO;using System.Runtime.InteropServices;
class RegionCheck {
 [DllImport("gdi32.dll")]static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr r);
 [DllImport("gdi32.dll")]static extern bool PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")]static extern int GetRgnBox(IntPtr r,out Rect rect);
 [DllImport("user32.dll")]static extern int GetWindowRgn(IntPtr w,IntPtr r);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr w,int index);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr w,int a,out int v,int s);
 [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]static extern int DwmRect(IntPtr w,int a,out Rect v,int s);
 struct Rect{public int l,t,r,b;}
 static void Main(string[] args){
  SetProcessDpiAwarenessContext(new IntPtr(-4));var region=CreateRectRgn(0,0,0,0);
  try{Rect rect;var hwnd=new IntPtr(long.Parse(args[0]));if(!GetWindowRect(hwnd,out rect))throw new Exception("Missing HWND");
   bool system=GetWindowRgn(hwnd,region)==0;int w=rect.r-rect.l,h=rect.b-rect.t;bool ok;
   if(args.Length==3 && args[2]=="native-rounded"){
    int corner;int cornerResult=DwmGetWindowAttribute(hwnd,33,out corner,4);
    bool fullRegion=system||(PtInRegion(region,0,0)&&PtInRegion(region,w-1,0)&&PtInRegion(region,0,h-1)&&PtInRegion(region,w-1,h-1));
    ok=fullRegion&&(cornerResult!=0||corner==2);
    File.WriteAllText(args[1]+".debug","style="+GetWindowLong(hwnd,-16).ToString("x")+", ex="+GetWindowLong(hwnd,-20).ToString("x")+", corner="+corner+", cornerResult="+cornerResult+", fullRegion="+fullRegion);
   }else if(system){
    int corner;DwmGetWindowAttribute(hwnd,33,out corner,4);
    ok=(GetWindowLong(hwnd,-20)&0x80000)==0&&corner==(args.Length>=6?1:2);
    if(args.Length>=6){Rect visible;if(DwmRect(hwnd,9,out visible,16)!=0)throw new Exception("Missing DWM frame bounds");ok=ok&&visible.l>=int.Parse(args[2])-1&&visible.t>=int.Parse(args[3])-1&&visible.r<=int.Parse(args[4])+1&&visible.b<=int.Parse(args[5])+1;File.WriteAllText(args[1]+".debug",visible.l+","+visible.t+","+visible.r+","+visible.b);}
   }else if(args.Length>=6){int l=int.Parse(args[2])-rect.l,t=int.Parse(args[3])-rect.t,r=int.Parse(args[4])-rect.l,b=int.Parse(args[5])-rect.t;string edges=args.Length>6?args[6]:"ltrb";ok=PtInRegion(region,w/2,h/2)&&(!edges.Contains("l")||l<=0||!PtInRegion(region,l-1,h/2))&&(!edges.Contains("t")||t<=0||!PtInRegion(region,w/2,t-1))&&(!edges.Contains("r")||r>=w||!PtInRegion(region,r,h/2))&&(!edges.Contains("b")||b>=h||!PtInRegion(region,w/2,b));}
   else ok=(GetWindowLong(hwnd,-16)&0x40000)==0&&!PtInRegion(region,0,0)&&!PtInRegion(region,w-1,0)&&!PtInRegion(region,0,h-1)&&!PtInRegion(region,w-1,h-1)&&PtInRegion(region,w/2,h/2);
   File.WriteAllText(args[1],ok?"true":"false");
  }finally{DeleteObject(region);}
 }
}`);
    const checker = await ensureNativeHost({ sourcePath: source, targetPath: path.join(tmp, 'region.exe'), onError: message => { throw Error(message); } });
    assert.ok(checker);
    const info = () => main.evaluate('window.suira.app.info()');
    const check = async suffix => {
      const surface = await until(async () => (await info()).surfaces.find(s => s.url.includes(suffix)));
      assert.ok(surface, 'Missing clipped surface: ' + suffix);
      const nativeRounded = suffix === '/clipboardbar.html' && surface.material === 'native-glass';
      if (['/clipboardbar.html','/notes.html'].includes(suffix)) assert.equal(surface.shadow,false,'Utility windows keep their shadow-free frame');
      assert.ok(['transparent','native-glass'].includes(surface.material),'Rounded Windows surfaces use an initialized material: '+suffix);
      const result = path.join(tmp, 'region.json');
      // A newly created HWND can be exposed before Windows applies its rounded shape.
      await until(()=>{execFileSync(checker, [surface.handle, result, ...(nativeRounded ? ['native-rounded'] : [])], { windowsHide: true, timeout: 5000, stdio:'pipe' });return true;});
      assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')), true, 'Native rounded shape must match the surface: ' + suffix + (nativeRounded ? ' ' + fs.readFileSync(result+'.debug','utf8') : ''));
      console.log('PASS native region: ' + suffix);
      return surface;
    };
    const checkPlacement=async(client,suffix)=>{
      const surface=(await info()).surfaces.find(s=>s.url.includes(suffix)),saved=surface.bounds;
      fs.writeFileSync(control,JSON.stringify({id:surface.id,bounds:{...saved,y:surface.area.y+surface.area.height-70}}));await info();
      await until(async()=>{const next=(await info()).surfaces.find(s=>s.id===surface.id);return next.bounds.y+next.bounds.height<=next.area.y+next.area.height;}).catch(async error=>{console.error('Placement state:',JSON.stringify((await info()).surfaces.find(s=>s.id===surface.id)));throw error;});
      fs.writeFileSync(control,JSON.stringify({id:surface.id,bounds:saved,focus:true}));await info();
      await until(()=>client.evaluate('document.documentElement.dataset.windowActive==="true"'));
      assert.notEqual(await client.evaluate('getComputedStyle(document.querySelector(".app-shell"),"::after").borderTopStyle'),'none');
      console.log('PASS taskbar-safe position and native focus style:',suffix);
    };
    const shot = async (client, name, theme = 'light') => {
      const reviewDir = process.env.SUIRA_REVIEW_SHOTS;
      if (!screenshots || (reviewDir && !['clipboard','clipboard-dark','clipboard-hover','clipboard-text-hover','clipboard-link-hover','clipboard-batch-share','clipboard-narrow','notes','notes-narrow','markdown-dark'].includes(name))) return;
      console.log('SHOT '+name);
      await setTheme(client, theme);
      await client.evaluate('document.fonts.ready'); await wait(350);
      const png = await client.send('Page.captureScreenshot', { format: 'png' });
      const dir = reviewDir || path.join(root, 'docs/product'); fs.mkdirSync(dir, { recursive: true });
      const destination=path.join(dir,name+'.png'),temporary=destination+'.tmp';
      try {
        fs.writeFileSync(temporary,Buffer.from(png.data,'base64'));
        for(let attempt=0;;attempt++){
          try{fs.renameSync(temporary,destination);break;}
          catch(error){if(attempt>=8||!['EPERM','EBUSY','UNKNOWN'].includes(error.code))throw error;await wait(200);}
        }
      }
      finally { fs.rmSync(temporary,{force:true}); }
    };
    async function captureNote() {
      await main.evaluate('window.suira.notes.create()');
      const note=await page(t => t.url.endsWith('/notes.html')); await check('/notes.html');await until(()=>note.evaluate('document.getElementById("note").dataset.state==="ready"'));
      const noteFrame=await note.evaluate('(()=>({radius:getComputedStyle(document.getElementById("note")).borderTopLeftRadius,body:getComputedStyle(document.body).backgroundColor}))()');
      assert.equal(noteFrame.radius,'22px','Notes keep their rounded surface');
      assert.equal(noteFrame.body,'rgba(0, 0, 0, 0)','Rounded note corners reveal the transparent window outside the paper');
      await note.evaluate('(()=>{document.querySelector("#note-body .tiptap").focus();document.execCommand("selectAll");document.execCommand("insertText",false,"随手记下，接着做\\n\\n把想法先放在这里，稍后再整理。");return true})()');
      await note.evaluate('window.NoteUI.flush()');
      await shot(note,'notes','dark');
      return note;
    }
    if (process.argv.includes('--notes-only')) {
      const note = await captureNote();
      const surface = (await info()).surfaces.find(entry => entry.url.endsWith('/notes.html'));
      fs.writeFileSync(control, JSON.stringify({id:surface.id, size:[320, 320]}));
      await info();
      await shot(note, 'notes-narrow');
      return;
    }
    if (process.argv.includes('--surfaces-only')) {
      await captureNote();
      for (const sample of [
        {title:"产品体验评审",text:"收集这周的反馈，整理下一版体验。"},
        {title:"下一步",text:"检查窗口圆角与玻璃背景。"},
        {title:"参考资料",text:"https://example.com/design"},
        {title:"会议速记",text:"留下关键决定与待办。"},
        {title:"计划",text:"先完成验证，再准备更新。"},
        {title:"灵感",text:"让界面更柔和，也保持清晰。"}
      ]) await main.evaluate(`window.suira.content.addText(${JSON.stringify(sample)})`);
      await main.evaluate('window.suira.clipboardBar.show()');
      const clipboard = await page(t => t.url.endsWith('/clipboardbar.html'));
      await check('/clipboardbar.html');
      await until(()=>clipboard.evaluate('document.querySelectorAll(".bar-card").length>=6'));
      await until(()=>clipboard.evaluate('document.documentElement.classList.contains("liquid-ui")'));
      const glass=await clipboard.evaluate('(()=>{const scene=document.querySelector(".bar>.glass-scene"),bar=document.getElementById("bar"),style=getComputedStyle(scene);return {root:document.documentElement.className,backend:document.documentElement.dataset.glassBackend,mode:document.documentElement.dataset.glassMode,sceneVisible:Boolean(scene)&&style.display!=="none",radius:parseFloat(getComputedStyle(bar).borderTopLeftRadius),sceneColor:style.backgroundColor}})()');
      assert.equal(glass.sceneVisible,true,'Clipboard shows the shared compositor glass layer');
      assert.ok(glass.radius>=8,'Clipboard keeps rounded glass corners: '+JSON.stringify(glass));
      assert.notEqual(glass.sceneColor,'rgba(0, 0, 0, 0)','Clipboard glass layer has a visible material tint: '+JSON.stringify(glass));
      await shot(clipboard,'clipboard');
      const surface=(await info()).surfaces.find(entry=>entry.url.endsWith('/clipboardbar.html'));
      fs.writeFileSync(control,JSON.stringify({id:surface.id,size:[720,310]}));
      await info();
      await shot(clipboard,'clipboard-narrow');
      return;
    }
    await check('/index.html');
    await checkPlacement(main,'/index.html');
    const demoTask=await main.evaluate(`window.suira.tasks.create('整理灵感，开始下一步')`);
    const demoTexts=[
      {title:'今天，专注三件事',text:'收集灵感，整理成文档，再为下一步留一个明确的入口。'},
      {title:'产品体验评审',text:'周五 14:30，带上本周收集的截图与反馈，讨论下一版体验。'},
      {title:'项目资料',text:'https://example.com/project'},
      {title:'界面细节',text:'让层次清楚一点，让常用操作顺手一点。'},
      {title:'待办清单',text:'✓ 检查窗口稳定性\n□ 整理文档与资料\n□ 准备下周计划'},
      {title:'写给自己的提醒',text:'重要内容先接住，不必现在就整理完。'}
    ];
    for(const [index,payload] of demoTexts.entries()){
      const added=await main.evaluate(`window.suira.content.addText(${JSON.stringify(payload)})`);
      if(index<2)await main.evaluate(`window.suira.tasks.addItem(${JSON.stringify({taskId:demoTask.task.id,itemId:added.item.id})})`);
    }
    await main.evaluate(`document.querySelector('[data-page="shelf"]').click();true`);
    await shot(main, 'workbench');
    assert.ok(await main.evaluate('document.getElementById("task-detail").getBoundingClientRect().width > 0'));
    await main.evaluate(`document.querySelector('[data-page="settings"]').click();true`);
    await until(()=>main.evaluate('document.getElementById("page-settings").classList.contains("is-active")'));
    await main.evaluate('document.getElementById("setting-theme").nextElementSibling.querySelector("button").click();true');
    assert.equal(await main.evaluate('SuiraGlassSelect.isOpen()'),true);
    await shot(main,'settings-controls');
    await main.evaluate('document.getElementById("setting-theme").value="dark";true');
    await shot(main,'settings-controls-dark','dark');
    await setTheme(main, 'dark');
    assert.equal(await main.evaluate('(()=>{const c=document.getElementById("setting-record"),before=c.checked;c.checked=true;const color=getComputedStyle(c).backgroundColor;c.checked=before;return color;})()'),'rgb(59, 59, 62)','Workbench checkbox keeps Mist accent-9 in dark mode');
    await main.evaluate('document.getElementById("setting-theme").value="light";true');
    await main.evaluate('window.suira.settings.update({theme:"light"})');
    await main.evaluate(`SuiraGlassSelect.close();document.querySelector('[data-page="shelf"]').click();true`);
    await main.evaluate(`window.suira.quick.show()`);
    const panel = await page(t => t.url.endsWith('/quickpanel.html'));
    await until(() => panel.evaluate('document.querySelectorAll(".key").length===38'));
    await panel.evaluate(`document.getElementById('guide-close').click();true`);
    await check('/quickpanel.html'); await shot(panel, 'panel'); await shot(panel, 'panel-dark', 'dark');
    await panel.evaluate('window.suira.settings.update({panelCompact:true})');await until(()=>panel.evaluate('document.getElementById("panel").dataset.compact==="true"'));await shot(panel,'panel-compact');await panel.evaluate('window.suira.settings.update({panelCompact:false})');await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
    await panel.evaluate(`window.suira.quick.setPresentation('fullscreen')`);
    await until(()=>panel.evaluate('document.getElementById("panel").dataset.mode==="actions"&&document.querySelector(".key-card").getBoundingClientRect().width>72')).catch(async error=>{console.error('Fullscreen state:',await panel.evaluate(`({mode:state.mode,presentation,scale:document.getElementById('panel').style.getPropertyValue('--keyboard-scale'),key:document.querySelector('.key-card').getBoundingClientRect().width,width:innerWidth,height:innerHeight})`));throw error;});
    await shot(panel,'keyboard-fullscreen');
    await panel.evaluate('document.getElementById("panel-more").click();true');await shot(panel,'keyboard-menu');await panel.evaluate('closeMoreMenu(false);true');
    await panel.evaluate(`window.suira.quick.setPresentation('window')`);
    await panel.evaluate('window.suira.settings.update({theme:"light"})');
    await panel.evaluate(`document.getElementById('panel-more').click();true`);
    const hoverDisplay=async()=>{const point=await panel.evaluate(`(()=>{const r=document.querySelector('[data-menu-section="display"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});};
    await hoverDisplay();await shot(panel,'panel-menu');
    await panel.evaluate(`closeMoreMenu(false);true`);
    await panel.evaluate(`document.getElementById('mode-apps').click();true`);
    await until(()=>panel.evaluate('document.querySelectorAll(".app-item").length>0'));
    await until(()=>panel.evaluate('[...document.querySelectorAll(".app-icon img")].filter(img=>img.naturalWidth>0).length>=Math.min(8,document.querySelectorAll(".app-item").length)'));
    assert.equal(await panel.evaluate(`document.getElementById('apps-grid').scrollHeight<=document.getElementById('apps-grid').clientHeight+1`),true,'Default app page must show every row without clipping');
    await shot(panel,'apps');
    await panel.evaluate(`(()=>{const input=document.getElementById('search');document.getElementById('search-toggle').click();input.focus();input.value='wei';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await until(()=>panel.evaluate('document.querySelectorAll(".command-item").length>0'));
    await until(()=>panel.evaluate('Boolean(document.querySelector(".command-icon img"))'));
    await shot(panel,'app-search');
    await panel.evaluate(`document.getElementById('toolbox').click();true`);
    assert.equal(await panel.evaluate(`document.getElementById('toolbox-panel').scrollHeight<=document.getElementById('toolbox-panel').clientHeight+1`),true,'Default toolbox must show all tools');
    await shot(panel,'toolbox');
    await panel.evaluate(`document.getElementById('mode-actions').click();document.querySelector('.key[data-key="Q"]').click();document.getElementById('binding-app').click();true`);
    await until(()=>panel.evaluate('document.querySelectorAll(".binding-app-option").length>0'));
    await shot(panel,'app-binding');
    await panel.evaluate(`document.getElementById('binding-close').click();document.getElementById('mode-apps').click();window.suira.quick.setPresentation('fullscreen')`);
    await until(()=>panel.evaluate('document.getElementById("panel").dataset.presentation==="fullscreen"'));
    await until(()=>panel.evaluate('[...document.querySelectorAll(".app-icon img")].filter(image=>image.naturalWidth>0).length>=Math.min(32,document.querySelectorAll(".app-item").length)'));
    await shot(panel,'apps-fullscreen');
    await panel.evaluate(`document.getElementById('panel-more').click();true`);await hoverDisplay();await shot(panel,'fullscreen-menu');const menuStyle=await panel.evaluate('(()=>{const m=getComputedStyle(document.getElementById("panel-more-menu")),s=getComputedStyle(document.querySelector(".search-field"));return {background:m.backgroundColor,ink:m.color,height:s.height}})()');assert.equal(menuStyle.height,'44px');assert.equal(menuStyle.background,await panel.evaluate('(()=>{const n=document.createElement("i");n.style.backgroundColor="var(--tool-surface)";document.getElementById("panel").append(n);const c=getComputedStyle(n).backgroundColor;n.remove();return c;})()'),'Fullscreen menu must use the shared themed surface');assert.equal(await panel.evaluate('getComputedStyle(document.querySelector(".app-name")).textShadow'),'none');
    await panel.evaluate(`closeMoreMenu(false);true`);
    await panel.evaluate(`(()=>{const input=document.getElementById('search');input.focus();input.value='wei';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await until(()=>panel.evaluate('document.querySelectorAll(".command-item").length>0'));
    await shot(panel,'app-search-fullscreen');
    await panel.evaluate(`window.suira.quick.setPresentation('window')`);
    await panel.evaluate('window.suira.quick.hide()');
    if (screenshots) {
      const demoImage = await main.evaluate(`(() => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#e9e6dc'; ctx.fillRect(0,0,640,420);
        ctx.fillStyle = '#fdfbf8'; ctx.roundRect(54,46,532,328,12); ctx.fill();
        ctx.fillStyle = '#e5e9e2'; ctx.fillRect(54,92,140,250);
        ctx.fillStyle = '#284c46'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('周末行程',224,138);
        ctx.font = '18px sans-serif'; ['09:00  沿湖散步','11:30  午餐','14:00  整理照片'].forEach((line,index)=>ctx.fillText(line,224,186+index*45));
        return canvas.toDataURL();
      })()`);
      assert.equal((await main.evaluate(`window.suira.imageEditor.open({dataUrl:${JSON.stringify(demoImage)}})`)).ok,true);
      const fixtureEditor=await page(t=>t.url.includes('mode=image-editor'));
      await until(()=>fixtureEditor.evaluate('Boolean(state.image)'));
      assert.equal((await fixtureEditor.evaluate(`window.suira.imageEditor.finish({dataUrl:${JSON.stringify(demoImage)},action:'copy'})`)).ok,true);
      if (process.env.SUIRA_REVIEW_SHOTS) {
        const secondImage = await main.evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef0e7'; ctx.fillRect(0,0,640,420); ctx.fillStyle = '#263a36'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('下周计划',64,90); ctx.font = '18px sans-serif'; ctx.fillText('把资料整理成一份清单',64,140); return canvas.toDataURL(); })()`);
        assert.equal((await fixtureEditor.evaluate(`window.suira.imageEditor.finish({dataUrl:${JSON.stringify(secondImage)},action:'copy'})`)).ok,true);
      }
      await fixtureEditor.evaluate('window.suira.imageEditor.window("close")').catch(()=>{});
      await until(async()=>!(await info()).surfaces.some(surface=>surface.url.includes('mode=image-editor')));
    }
    await main.evaluate('window.suira.clipboardBar.show()');
    const clipboard=await page(t => t.url.endsWith('/clipboardbar.html')); await check('/clipboardbar.html');
    await until(()=>clipboard.evaluate('document.querySelectorAll(".bar-card").length>=6'));
    await until(()=>clipboard.evaluate('document.documentElement.classList.contains("liquid-ui")'));
    const glass=await clipboard.evaluate('(()=>{const scene=document.querySelector(".bar>.glass-scene"),bar=document.getElementById("bar"),style=getComputedStyle(scene);return {mounted:document.documentElement.classList.contains("liquid-ui"),backend:document.documentElement.dataset.glassBackend,mode:document.documentElement.dataset.glassMode,sceneVisible:Boolean(scene)&&style.display!=="none",radius:parseFloat(getComputedStyle(bar).borderTopLeftRadius),sceneColor:style.backgroundColor}})()');
    assert.equal(glass.mounted,true,'Clipboard loads the shared glass surface');
    assert.equal(glass.sceneVisible,true,'Clipboard shows the shared compositor glass layer');
    assert.ok(glass.radius>=8,'Clipboard keeps rounded glass corners: '+JSON.stringify(glass));
    assert.notEqual(glass.sceneColor,'rgba(0, 0, 0, 0)','Clipboard glass layer has a visible material tint: '+JSON.stringify(glass));
    const moveClipboardPointer = (x,y) => clipboard.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await moveClipboardPointer(4,48);
    await shot(clipboard,'clipboard');
    await shot(clipboard,'clipboard-dark','dark');
    if (screenshots && process.env.SUIRA_REVIEW_SHOTS) {
      for (const [kind, name] of [['image','clipboard-hover'], ['text','clipboard-text-hover'], ['link','clipboard-link-hover']]) {
        await moveClipboardPointer(4,48);
        const card = await clipboard.evaluate(`(() => {
          const card = document.querySelector('.bar-card[data-kind="${kind}"]');
          card.scrollIntoView({block:'nearest',inline:'start',behavior:'instant'});
          const r = card.getBoundingClientRect();
          return {x:r.x+r.width/2,y:r.y+r.height/2};
        })()`);
        await moveClipboardPointer(card.x,card.y);
        await until(()=>clipboard.evaluate(`getComputedStyle(document.querySelector('[data-kind="${kind}"] .card-actions')).opacity==='1'`));
        await shot(clipboard,name);
      }
      await clipboard.evaluate(`document.querySelector('[data-kind=link] [data-card-action=open]').click();true`);
      await until(async () => (await info()).openedUrl === 'https://example.com/project');
      const imageMetadata = await clipboard.evaluate(`document.querySelector('[data-kind=image] .card-metadata').textContent`);
      assert.match(imageMetadata, /640×420 · (?:[\d.,]+ KB|[\d,]+ B)/);
      await clipboard.evaluate(`document.querySelector('[data-filter="image"]').click();true`);
      await moveClipboardPointer(4,48);
      await until(() => clipboard.evaluate(`Array.from(document.querySelectorAll('.card-select')).every(button => getComputedStyle(button).opacity === '0')`));
      for (let index = 0; index < 2; index++) {
        const button = await clipboard.evaluate(`(() => { const r = document.querySelectorAll('.card-select')[${index}].getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
        await moveClipboardPointer(button.x, button.y);
        await until(() => clipboard.evaluate(`getComputedStyle(document.querySelectorAll('.card-select')[${index}]).opacity === '1'`));
        for (const type of ['mousePressed','mouseReleased']) {
          await clipboard.send('Input.dispatchMouseEvent',{type,...button,button:'left',clickCount:1});
        }
      }
      assert.equal(await clipboard.evaluate(`document.querySelectorAll('.card-select[aria-pressed="true"]').length`), 2);
      await clipboard.evaluate(`document.querySelector('[data-filter="text"]').click();document.querySelector('[data-filter="image"]').click();document.getElementById('bar-share-images').click();true`);
      assert.equal(await clipboard.evaluate(`document.getElementById('bar-share-images').textContent`),'分享 2 张图片');
      await moveClipboardPointer(4,48);
      assert.equal(await clipboard.evaluate(`Array.from(document.querySelectorAll('.bar-card.is-checked .card-select')).filter(button => getComputedStyle(button).opacity === '1').length`),2);
      await shot(clipboard,'clipboard-batch-share');
      await clipboard.evaluate(`document.querySelector('#bar-share button').click();true`);
      await until(() => clipboard.evaluate(`document.getElementById('bar-notice').textContent.includes('已复制 2 张原图')`));
      const copied = (await info()).copiedFiles;
      const expected = await clipboard.evaluate(`(async () => { const records = await window.suira.content.list({kinds:['image']}); return records.map(item => item.filePath); })()`);
      assert.deepEqual(copied, expected);
      assert.ok(copied.every(file => fs.statSync(file).isFile()));
      await clipboard.evaluate(`document.getElementById('bar-share-images').click();document.querySelector('#bar-share button:last-child').click();true`);
      assert.ok(await clipboard.evaluate(`document.getElementById('bar-share-images').hidden && !document.querySelector('.bar-card.is-checked')`));
      console.log('PASS batch image selection, source files, and clear through real IPC');
      await clipboard.evaluate(`document.querySelector('[data-kind=image] [data-card-action=crop]').click();true`);
      const cropEditor = await page(t => t.url.includes('mode=image-editor'));
      await until(() => cropEditor.evaluate(`Boolean(state.image) && document.getElementById('capture-root').dataset.tool === 'select'`));
      await cropEditor.evaluate('window.suira.imageEditor.window("close")').catch(()=>{});
      console.log('PASS clipboard link, original size, and crop entry through real IPC');
    }
    await main.evaluate('window.suira.settings.update({theme:"light"})');
    await main.evaluate('window.suira.clipboardBar.hide()');
    const date = new Date().toLocaleDateString('en-CA');
    for (const event of [{ title: '产品体验评审', time: '10:00', location: '设计工作室', category: 'work' }, { title: '阅读与灵感整理', time: '16:30', category: 'study' }]) {
      await main.evaluate(`window.suira.workspace.save('calendar',${JSON.stringify({ ...event, date, text: '为专注的工作留一段时间。' })})`);
    }
    await main.evaluate(`window.suira.workspace.open('calendar')`);
    const calendar = await page(t => t.url.includes('tool=calendar'));
    await until(() => calendar.evaluate('document.querySelectorAll(".calendar-day").length===42'));
    await calendar.evaluate(`document.querySelector('[data-agenda="todo"]').click();true`);
    const calendarSurface = await check('tool=calendar'); await shot(calendar, 'calendar');
    await checkPlacement(calendar,'tool=calendar');
    assert.equal(await calendar.evaluate('document.querySelector(".tool-kind").getAttribute("aria-label")'),'日历');
    fs.writeFileSync(control, JSON.stringify({ id: calendarSurface.id, size: [1040, 760] })); await info(); await wait(150); await check('tool=calendar');
    await calendar.evaluate('window.suira.window.maximize()'); await wait(180);
    assert.equal((await info()).surfaces.find(s => s.id === calendarSurface.id).maximized, true);
    const maximized=(await info()).surfaces.find(s=>s.id===calendarSurface.id);
    const regionResult=path.join(tmp,'maximized-region.json'),area=maximized.physicalArea;
    const a=maximized.area,b=maximized.displayBounds,edges=(a.x>b.x?'l':'')+(a.y>b.y?'t':'')+(a.x+a.width<b.x+b.width?'r':'')+(a.y+a.height<b.y+b.height?'b':'');
    execFileSync(checker,[maximized.handle,regionResult,String(area.x),String(area.y),String(area.x+area.width),String(area.y+area.height),edges],{windowsHide:true,timeout:5000});
    assert.equal(JSON.parse(fs.readFileSync(regionResult,'utf8')),true,'Native maximized region must exclude the taskbar, including hidden frame overhang');
    console.log('PASS native maximized region excludes taskbar and frame overhang');
    await calendar.evaluate('window.suira.window.maximize()'); await wait(180); await check('tool=calendar');
    await main.evaluate(`window.suira.workspace.save('markdown',${JSON.stringify({ title: '让想法，顺着写下去', text: '# 让想法，顺着写下去\n\n从一张截图、一段文字，到一份清晰的计划。\n\n## 今天，专注三件事\n\n- [x] 收集零散的灵感\n- [ ] 把重要内容整理成文档\n- [ ] 为下一步留一个明确的入口\n\n> 顺手接住，让工作继续。\n\n## 一个轻盈的工作流\n\n| 收集 | 整理 | 继续 |\n| --- | --- | --- |\n| 截图与剪贴板 | 日历与 Markdown | 任务与速记 |\n\n把注意力留给正在做的事。' })})`);
    await main.evaluate(`window.suira.workspace.open('markdown')`);
    const markdown = await page(t => t.url.includes('tool=markdown'));
    await until(() => markdown.evaluate('Boolean(document.querySelector("#md-preview h1"))'));
    await check('tool=markdown'); await shot(markdown, 'markdown');
    await shot(markdown, 'markdown-dark', 'dark');
    await markdown.evaluate('window.suira.settings.update({theme:"light"})');
    await markdown.evaluate('document.getElementById("md-home").click();true');
    await until(()=>markdown.evaluate('document.getElementById("md-body").hidden'));
    await shot(markdown, 'markdown-home');
    await checkPlacement(markdown,'tool=markdown');
    assert.equal(await markdown.evaluate('document.querySelector(".tool-kind").getAttribute("aria-label")'),'Markdown 文档');
    await until(()=>calendar.evaluate('document.documentElement.dataset.windowActive==="false"'));
    const note = await captureNote();
    const noteId = await note.evaluate('state.id');
    await note.evaluate(`(()=>{const title=document.getElementById('note-page-title');title.value='周末速记';title.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await note.evaluate('window.NoteUI.flush()');
    const savedNote = await main.evaluate(`window.suira.notes.get(${JSON.stringify(noteId)})`);
    assert.equal(savedNote.customTitle,'周末速记');
    assert.ok(savedNote.text.startsWith('随手记下，接着做'));
    const demo = await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=400;c.height=240;const x=c.getContext('2d');x.fillStyle='#dce8ff';x.fillRect(0,0,400,240);return c.toDataURL()})()`);
    assert.equal((await main.evaluate(`window.suira.imageEditor.open({dataUrl:${JSON.stringify(demo)}})`)).ok,true);
    const imageEditor = await page(t => t.url.includes('mode=image-editor'));
    await check('mode=image-editor');
    assert.equal((await imageEditor.evaluate(`window.suira.imageEditor.finish({dataUrl:${JSON.stringify(demo)},action:'pin'})`)).ok,true);
    await check('/pin.html');
    console.log('PASS independent windows, real native corners, resize and maximize/restore');
    if(screenshots && !process.env.SUIRA_REVIEW_SHOTS)fs.writeFileSync(path.join(root,'docs/theme-foundation-'+require('../package.json').version+'.json'),JSON.stringify({version:require('../package.json').version,fontPolicy:'MiSans on main workbench only; system font on utility windows',checks:foundationResults},null,2)+'\n');
    if (process.argv.includes('--preview')) await wait(45000);
  } catch (error) {
    if (fs.existsSync(path.join(tmp, 'app.log'))) console.error(fs.readFileSync(path.join(tmp, 'app.log'), 'utf8').slice(-1800));
    throw error;
  } finally {
    for (const ws of sockets) ws.close();
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
    await wait(400); fs.rmSync(tmp, { recursive: true, force: true });
  }
}
module.exports = { run };
if (require.main === module) run({ screenshots: true }).catch(error => { console.error(error); process.exitCode = 1; });
