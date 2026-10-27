'use strict';
// 独立外部窗口 + 真实前台探针/GDI 区域采集，不读取或改写用户数据。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-long-capture-'));
const executable=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),children=[],sockets=[];
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn,label){let error;for(let n=0;n<150;n++){try{const v=await fn();if(v)return v;}catch(e){error=e;}await wait(100);}throw Error(label||error?.message||'状态超时');}
async function launch(file,p){assert.ok(executable,'Set SUIRA_ELECTRON or install Electron');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(file+'.log','w');const c=spawn(executable,[file,'--remote-debugging-port='+p],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(c);fs.closeSync(fd);}
async function page(p,select){const client=await until(()=>connect(p,select));sockets.push(client.ws);return client;}
(async()=>{
  const ap=await port(),fp=await port(),entry=path.join(tmp,'app.js'),fixture=path.join(tmp,'fixture.js');
  const trace=path.join(tmp,'trace.jsonl');
  fs.writeFileSync(entry,`const fs=require('node:fs');const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
  const log=(type,data={})=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({type,...data})+'\\n');
  const probe=require(${JSON.stringify(path.join(root,'lib/foreground-probe'))});probe.ForegroundProbe.prototype.focusTo=async()=>{throw Error('长截图不应强制激活窗口')};
  const start=require(${JSON.stringify(path.join(root,'lib/long-capture-start'))}),original=start.longCaptureTarget;start.longCaptureTarget=async options=>{const target=await original(options);log('target',{pid:target.pid});return target};
  const native=require(${JSON.stringify(path.join(root,'lib/native-capture'))}),capture=native.captureNative;native.captureNative=async(...args)=>{log('desktop');return capture(...args)};
  require(${JSON.stringify(path.join(root,'main.js'))});`);
  fs.writeFileSync(fixture,`const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'fixture-profile'))});let win;app.whenReady().then(async()=>{win=new BrowserWindow({title:'SUIRA Native Scroll Fixture',x:100,y:100,width:900,height:700,useContentSize:true,frame:true,show:false,alwaysOnTop:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{margin:0;font:18px/1.8 Arial;background:white;color:black}header{height:50px;background:lightblue}p{height:70px;border-bottom:1px solid #999}</style><header>Native scrolling fixture</header>'+Array.from({length:80},(_,i)=>'<p>Row '+i+' '+(i*7919).toString(16)+' real GDI scrolling screenshot</p>').join('')));win.show();win.moveTop();win.focus();});ipcMain.handle('focus',()=>{win.show();win.moveTop();win.focus();return win.getContentBounds()});`);
  await launch(entry,ap);const main=await page(ap,t=>t.url.endsWith('/index.html'));await until(()=>main.evaluate('Boolean(window.suira?.longCapture)'));
  await wait(1500);await launch(fixture,fp);const source=await page(fp,t=>t.type==='page');
  await until(()=>source.evaluate(`document.readyState==='complete'&&Boolean(document.querySelector('header'))`));
  const bounds=await until(()=>source.evaluate(`require('electron').ipcRenderer.invoke('focus')`));await wait(250);
  for(const entry of ['toolbar','panel']) {
    await source.evaluate(`scrollTo(0,0);require('electron').ipcRenderer.invoke('focus')`);await wait(200);
    const desktopBefore=fs.existsSync(trace)?fs.readFileSync(trace,'utf8').split('\n').filter(l=>l.includes('"desktop"')).length:0;
    const startedAt=Date.now();const capture=await main.evaluate(entry==='toolbar'?`window.suira.capture.start({intent:'copy'})`:`window.suira.panel.run('long-capture')`);assert.equal(capture.ok,true);
    if(entry==='panel'){assert.equal(fs.existsSync(trace)?fs.readFileSync(trace,'utf8').split('\n').filter(l=>l.includes('"desktop"')).length:0,desktopBefore,'直接长截图不调用整屏采集');console.log('透明框选入口耗时',Date.now()-startedAt,'ms');}
    const overlay=await page(ap,t=>t.url.endsWith(entry==='toolbar'?'/overlay.html':'/long-picker.html'));await until(()=>overlay.evaluate(entry==='toolbar'?'Boolean(state.image)':'window.__longPickerState?.ready'));
    const rect={x:bounds.x+60,y:bounds.y+90,width:480,height:380};
    await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',buttons:1,clickCount:1});
    await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width,y:rect.y+rect.height,button:'left',buttons:1});
    await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+rect.width,y:rect.y+rect.height,button:'left',buttons:0,clickCount:1});
    if(entry==='toolbar')await overlay.evaluate(`document.querySelector('[data-action="long"]').click(),true`);
    const hud=await page(ap,t=>t.url.endsWith('/long-capture.html'));const initial=await until(()=>hud.evaluate('window.suira.longCapture.state()'));assert.equal(initial.frames,1);
    await wait(650);await source.evaluate('scrollTo(0,100)');let last;const stitched=await until(async()=>{const s=last=await hud.evaluate('window.suira.longCapture.state()');return s.frames>1?s:null;},'原生采集应在滚动后产生第二段').catch(e=>{console.log('Last state:',JSON.stringify(last));throw e;});assert.ok(stitched.height>initial.height);
    console.log('PASS',entry,'真实入口 → 选区保留/前台交接 → GDI 滚动拼接，尺寸',initial.height,'→',stitched.height);
    await hud.evaluate(`setTimeout(()=>window.suira.longCapture.command('cancel'),40),true`);
    await until(async()=>!(await(await fetch('http://127.0.0.1:'+ap+'/json/list')).json()).some(t=>t.url.endsWith('/long-capture.html')));
  }
  const targets=fs.readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type==='target');assert.equal(targets.length,2);assert.ok(targets.every(r=>r.pid===children[1].pid),'实际采集源必须是普通外部测试窗口');
  console.log('PASS 普通非置顶带标题栏窗口；后台激活不可用仍可采集；两个入口取消后均关闭原生采集');
})().catch(error=>{console.error(error);for(const name of ['app.js.log','fixture.js.log'])if(fs.existsSync(path.join(tmp,name)))console.error(fs.readFileSync(path.join(tmp,name),'utf8').slice(-1400));process.exitCode=1;}).finally(async()=>{for(const ws of sockets)ws.close();for(const c of children)if(c.exitCode===null)c.kill();await wait(600);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}});
