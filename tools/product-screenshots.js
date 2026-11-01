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
const {app,BrowserWindow,ipcMain,clipboard,globalShortcut}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(tmp, 'profile'))});
app.getVersion=()=>${JSON.stringify(require('../package.json').version)};
require(${JSON.stringify(path.join(root,'lib','launchpad-background.js'))}).readLaunchpadBackground=async()=>({dataUrl:'',source:'demo-gradient'});
clipboard.read=async()=>[];clipboard.readText=async()=>'';
globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,name==='app:info'?async(...args)=>{
 const command=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));
 fs.writeFileSync(${JSON.stringify(control)},'{}');
 const target=command.id ? BrowserWindow.fromId(command.id) : null;
 if(target){if(command.size)target.setSize(...command.size);if(command.bounds)target.setBounds(command.bounds);if(command.focus){target.show();target.focus();}if(command.maximize)target.maximize();if(command.restore)target.unmaximize();}
 const {screen}=require('electron');return {...await fn(...args),surfaces:BrowserWindow.getAllWindows().filter(w=>w.__surfaceRadius).map(w=>({id:w.id,url:w.webContents.getURL(),bounds:w.getBounds(),displayBounds:screen.getDisplayMatching(w.getBounds()).bounds,area:screen.getDisplayMatching(w.getBounds()).workArea,physicalArea:screen.dipToScreenRect(w,screen.getDisplayMatching(w.getBounds()).workArea),focused:w.isFocused(),material:w.__surfaceMaterial,maximized:w.isMaximized(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()}))};
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
    const page = async select => {
      const client = await until(() => connect(port, select)); sockets.push(client.ws);
      await until(() => client.evaluate('Boolean(window.suira)')); return client;
    };
    const main = await page(t => t.url.endsWith('/index.html'));
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
 struct Rect{public int l,t,r,b;}
 static void Main(string[] args){SetProcessDpiAwarenessContext(new IntPtr(-4));var region=CreateRectRgn(0,0,0,0);try{Rect rect;var hwnd=new IntPtr(long.Parse(args[0]));if(!GetWindowRect(hwnd,out rect)||GetWindowRgn(hwnd,region)==0)throw new Exception("Missing native region");int w=rect.r-rect.l,h=rect.b-rect.t;bool ok;if(args.Length>=6){int l=int.Parse(args[2])-rect.l,t=int.Parse(args[3])-rect.t,r=int.Parse(args[4])-rect.l,b=int.Parse(args[5])-rect.t;string edges=args.Length>6?args[6]:"ltrb";Rect box;GetRgnBox(region,out box);File.WriteAllText(args[1]+".debug","hwnd="+rect.l+","+rect.t+","+rect.r+","+rect.b+" region="+box.l+","+box.t+","+box.r+","+box.b+" area="+l+","+t+","+r+","+b);ok=PtInRegion(region,w/2,h/2)&&(!edges.Contains("l")||l<=0||!PtInRegion(region,l-1,h/2))&&(!edges.Contains("t")||t<=0||!PtInRegion(region,w/2,t-1))&&(!edges.Contains("r")||r>=w||!PtInRegion(region,r,h/2))&&(!edges.Contains("b")||b>=h||!PtInRegion(region,w/2,b));}else{ok=(GetWindowLong(hwnd,-16)&0x40000)==0&&!PtInRegion(region,0,0)&&!PtInRegion(region,w-1,0)&&!PtInRegion(region,0,h-1)&&!PtInRegion(region,w-1,h-1)&&PtInRegion(region,w/2,h/2);}File.WriteAllText(args[1],ok?"true":"false");}finally{DeleteObject(region);}}
}`);
    const checker = await ensureNativeHost({ sourcePath: source, targetPath: path.join(tmp, 'region.exe'), onError: message => { throw Error(message); } });
    assert.ok(checker);
    const info = () => main.evaluate('window.suira.app.info()');
    const check = async suffix => {
      const surface = await until(async () => (await info()).surfaces.find(s => s.url.includes(suffix)));
      assert.ok(surface, 'Missing clipped surface: ' + suffix);
      assert.equal(surface.material, 'transparent');
      const result = path.join(tmp, 'region.json');
      // A newly created HWND can be exposed before Windows applies its HRGN.
      await until(()=>{execFileSync(checker, [surface.handle, result], { windowsHide: true, timeout: 5000, stdio:'pipe' });return true;});
      assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')), true, 'Native corners must be excluded: ' + suffix);
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
      if (!screenshots) return;
      console.log('SHOT '+name);
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await client.evaluate('document.fonts.ready'); await wait(350);
      const png = await client.send('Page.captureScreenshot', { format: 'png' });
      const dir = path.join(root, 'docs/product'); fs.mkdirSync(dir, { recursive: true });
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
    await main.evaluate(`window.suira.quick.showMain('shelf')`);
    await shot(main, 'workbench');
    await main.evaluate(`window.suira.quick.show()`);
    const panel = await page(t => t.url.endsWith('/quickpanel.html'));
    await until(() => panel.evaluate('document.querySelectorAll(".key").length===38'));
    await panel.evaluate(`document.getElementById('guide-close').click();true`);
    await check('/quickpanel.html'); await shot(panel, 'panel'); await shot(panel, 'panel-dark', 'dark');
    await panel.evaluate(`window.suira.quick.setPresentation('fullscreen')`);
    await until(()=>panel.evaluate('document.getElementById("panel").dataset.mode==="actions"&&document.querySelector(".key-card").getBoundingClientRect().width>72')).catch(async error=>{console.error('Fullscreen state:',await panel.evaluate(`({mode:state.mode,presentation,scale:document.getElementById('panel').style.getPropertyValue('--keyboard-scale'),key:document.querySelector('.key-card').getBoundingClientRect().width,width:innerWidth,height:innerHeight})`));throw error;});
    await shot(panel,'keyboard-fullscreen');
    await panel.evaluate(`window.suira.quick.setPresentation('window')`);
    await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
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
    await panel.evaluate(`document.getElementById('panel-more').click();true`);await hoverDisplay();await shot(panel,'fullscreen-menu');
    await panel.evaluate(`closeMoreMenu(false);true`);
    await panel.evaluate(`(()=>{const input=document.getElementById('search');input.focus();input.value='wei';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await until(()=>panel.evaluate('document.querySelectorAll(".command-item").length>0'));
    await shot(panel,'app-search-fullscreen');
    await panel.evaluate(`window.suira.quick.setPresentation('window')`);
    await main.evaluate('window.suira.quick.hide()');
    await main.evaluate('window.suira.clipboardBar.show()');
    const clipboard=await page(t => t.url.endsWith('/clipboardbar.html')); await check('/clipboardbar.html');
    await until(()=>clipboard.evaluate('document.querySelectorAll(".bar-card").length>=6'));await shot(clipboard,'clipboard');
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
    await markdown.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await markdown.evaluate('document.getElementById("md-home").click();true');
    await until(()=>markdown.evaluate('document.documentElement.classList.contains("md-home")'));
    await shot(markdown, 'markdown-home');
    await checkPlacement(markdown,'tool=markdown');
    assert.equal(await markdown.evaluate('document.querySelector(".tool-kind").getAttribute("aria-label")'),'Markdown 文档');
    await until(()=>calendar.evaluate('document.documentElement.dataset.windowActive==="false"'));
    await main.evaluate('window.suira.notes.create()');
    await page(t => t.url.endsWith('/notes.html')); await check('/notes.html');
    await main.evaluate('window.suira.imageEditor.open()');
    await page(t => t.url.includes('mode=image-editor')); await check('mode=image-editor');
    const demo = await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=400;c.height=240;const x=c.getContext('2d');x.fillStyle='#dce8ff';x.fillRect(0,0,400,240);return c.toDataURL()})()`);
    await main.evaluate(`window.suira.capture.finish({dataUrl:${JSON.stringify(demo)},action:'pin'})`);
    await check('/pin.html');
    console.log('PASS independent windows, real native corners, resize and maximize/restore');
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
