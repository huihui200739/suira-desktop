'use strict';
// 实际 Electron / preload / IPC；前台窗口、剪贴板与采集适配器使用独立测试内容。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client');const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-long-capture-'));
const {PNG}=require('pngjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[];let child;
async function until(fn){for(let n=0;n<200;n++){try{const v=await fn();if(v)return v;}catch{}await wait(80);}throw Error('测试状态未就绪');}
(async()=>{
  const exe=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);assert.ok(exe);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const control=path.join(tmp,'control.json'),trace=path.join(tmp,'trace.jsonl'),entry=path.join(tmp,'app.js');let config={current:'A',offset:0};const update=patch=>{Object.assign(config,patch);fs.writeFileSync(control,JSON.stringify(config));};update({});
  const browserFixture=`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:14px/1.5 Arial;background:#fff;color:#18202b}header{position:fixed;inset:0 0 auto;height:28px;background:#daeafb;border-bottom:1px solid #aab8c7;padding:3px 12px}footer{position:fixed;inset:auto 0 0;height:20px;background:#e8ecf2;padding:0 12px;font-size:12px}main{position:fixed;inset:28px 0 20px;overflow:auto}.row{height:94px;padding:8px 14px;border-bottom:1px solid #d8dce4}.row b{color:#086dbe}p{margin:4px 0}</style><header>固定页眉 · SUIRA 滚动测试</header><main id="content">${Array.from({length:60},(_,i)=>`<section class="row"><b>第 ${i+1} 段 · ${(i*7919).toString(16)}</b><p>${['这是一段本地生成的测试文字，检查页面滚动后的拼接。','记录进度与图片，保留准确的上下文和完整内容。','Fixed headers and repeated areas should appear only once.'][i%3]}</p></section>`).join('')}</main><footer>固定页脚 · 仅使用测试内容</footer>`;
  fs.writeFileSync(entry,`
const fs=require('node:fs');const {app,BrowserWindow,clipboard,globalShortcut,nativeImage,screen}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});
const config=()=>JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));const log=(type,data)=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({type,...data})+'\\n');
clipboard.read=async()=>[];clipboard.readText=async()=>'';clipboard.writeText=async text=>{if(config().failCopy)throw Error('模拟复制失败');log('clipboard',{kind:'text',text})};clipboard.write=async items=>log('clipboard',{kind:'image',types:items[0].types});
app.on('browser-window-created',(_,win)=>{win.on('show',()=>log('show',{title:win.getTitle(),bounds:win.getBounds()}));});
const hook=BrowserWindow.prototype.hookWindowMessage;
BrowserWindow.prototype.hookWindowMessage=function(message,callback){
  if(message===6){
    this.webContents.on('console-message', event=>{
      if(event.message==='fixture:activate-from-B'){
        const previous=Buffer.alloc(8);previous.writeBigUInt64LE(200n);
        callback(Buffer.from([2,0]),previous);
      }
    });
  }
  return hook.call(this,message,callback);
};
const keys=new Set();globalShortcut.register=k=>{keys.add(k);return true};globalShortcut.unregister=k=>keys.delete(k);globalShortcut.unregisterAll=()=>keys.clear();
const snapshot=name=>name==='self'?{hwnd:'300',pid:process.pid,processStartedAt:123,title:'随序'}:{hwnd:name==='A'?'100':'200',pid:name==='A'?777:888,processStartedAt:123,title:name==='A'?'ChatGPT 当前聊天':'另一个聊天',bounds:{x:0,y:0,width:900,height:700}};
const f=require(${JSON.stringify(path.join(root,'lib/foreground-probe.js'))});f.ForegroundProbe=class {constructor(){this.ready=true;}isAvailable(){return true}isReady(){return true}async start(){return true}stop(){}dispose(){}async query(hwnd){return hwnd?snapshot(hwnd==='100'?'A':'B'):snapshot(config().current)}async queryAt(){return snapshot(config().hit||config().current)}async focusTo(){throw Error('测试禁止强制激活')}async pasteTo(target){log('paste',{target});return{ok:true}}};
const native=require(${JSON.stringify(path.join(root,'lib/native-capture.js'))});native.captureNative=async()=>screen.getAllDisplays().map(d=>{const size=screen.dipToScreenRect(null,d.bounds),data=Buffer.alloc(size.width*size.height*4,230);return {...size,dataUrl:nativeImage.createFromBitmap(data,{width:size.width,height:size.height}).toDataURL()}});
let fixtureWindow,fixtureReady;const seen=new Set();
async function browserCapture(rect){
  if(!fixtureWindow){const {BrowserWindow}=require('electron');fixtureWindow=new BrowserWindow({width:rect.width,height:rect.height,useContentSize:true,frame:false,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});fixtureReady=fixtureWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(browserFixture)}));}
  await fixtureReady;fixtureWindow.webContents.startPainting();
  const offset=config().offset;const layout=await fixtureWindow.webContents.executeJavaScript('(()=>{const c=document.getElementById("content");c.scrollTop='+offset+';return {top:c.scrollTop,height:c.clientHeight,scroll:c.scrollHeight}})()');
  fixtureWindow.webContents.invalidate();await new Promise(r=>setTimeout(r,100));
  const original=await fixtureWindow.webContents.capturePage();
  const full=nativeImage.createFromBuffer(original.toPNG({scaleFactor:1})),image=full.crop({x:0,y:0,width:rect.width,height:rect.height}),png=image.toPNG();
  log('capture',{rect,offset,layout,hash:require('node:crypto').createHash('sha1').update(png).digest('hex')});
  if(!seen.has(offset)){seen.add(offset);fs.writeFileSync(${JSON.stringify(tmp)}+'/frame-'+offset+'.png',png);}
  return {width:rect.width,height:rect.height,dataUrl:image.toDataURL()};
}
const worker=require(${JSON.stringify(path.join(root,'lib/region-capture.js'))});worker.RegionCapture=class {constructor(){this.stopped=false;log('worker',{})}async capture(rect){log('region-request',{});if(config().delayRegion)await new Promise(r=>setTimeout(r,config().delayRegion));if(this.stopped)throw Error('采集已取消');if(config().failRegion)throw Error('模拟原生采集失败');return browserCapture(rect)}stop(){this.stopped=true;log('stop',{})}};
require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(exe,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async select=>{const p=await until(()=>connect(port,select));sockets.push(p.ws);return p;};
  const main=await page(t=>t.url.endsWith('/index.html'));await until(()=>main.evaluate('Boolean(window.suira?.longCapture)'));
  const text=await main.evaluate(`window.suira.content.addText({text:'selected history fixture',title:'历史内容'})`);assert.equal(text.ok,true);
  const records=()=>fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  assert.equal((await main.evaluate('window.suira.clipboardBar.show()')).visible,true);
  const bar=await page(t=>t.url.endsWith('/clipboardbar.html'));
  await main.evaluate('window.suira.clipboardBar.hide()');
  async function commit(itemId=text.item.id){return bar.evaluate(`window.suira.returnTo.commit({itemId:${JSON.stringify(itemId)},intent:'paste-current'})`);}
  async function openBar(name){update({current:name});assert.equal((await main.evaluate('window.suira.clipboardBar.show()')).ok,true);update({current:'self'});}
  await openBar('A');assert.equal((await commit()).pasted,true);assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'100');
  await openBar('B');assert.equal((await commit()).pasted,true);assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'200');
  await openBar('A');update({current:'B'});await commit();assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'200');
  await openBar('self');const oldCount=records().filter(x=>x.type==='paste').length;const own=await commit();assert.equal(own.copied,true);assert.equal(own.pasted||false,false);assert.equal(records().filter(x=>x.type==='paste').length,oldCount);
  update({current:'B'});await main.evaluate('window.suira.quick.show()');update({current:'self'});await main.evaluate('window.suira.clipboardBar.show()');await commit();assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'200');
  await openBar('A');update({failCopy:true});assert.equal((await commit()).ok,false);update({failCopy:false});
  await main.evaluate('window.suira.clipboardBar.hide()');
  await openBar('A');
  assert.equal((await main.evaluate('window.suira.clipboardBar.setPinned(true)')).ok, false, '只有剪贴板窗口可以控制置顶');
  assert.deepEqual(await bar.evaluate('window.suira.clipboardBar.setPinned(true)'), {ok:true,pinned:true});
  await bar.evaluate("console.info('fixture:activate-from-B')");
  const pinned = await commit();
  assert.equal(pinned.pasted && pinned.keptOpen, true);
  assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'200');
  assert.equal(await bar.evaluate('document.visibilityState'), 'visible');
  assert.equal((await bar.evaluate('window.suira.clipboardBar.setPinned(false)')).pinned, false);
  update({current:'B'});
  assert.equal((await commit()).keptOpen, false);
  console.log('PASS 剪贴板置顶时将内容贴到当前窗口，取消置顶后粘贴自动收起');
  console.log('PASS 真实 IPC：每次唤起使用当前聊天、提交时切窗、面板交接、查询自身不复用旧目标、复制失败不误报成功');
  const png=await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=100;c.height=80;c.getContext('2d').fillRect(0,0,100,80);return c.toDataURL()})()`);
  assert.equal((await main.evaluate('window.suira.capture.start()')).ok,true);
  const image=await main.evaluate(`window.suira.capture.finish({action:'copy',dataUrl:${JSON.stringify(png)}})`);assert.equal(image.ok,true,JSON.stringify(image));
  await main.evaluate('window.suira.capture.cancel()');
  await openBar('B');await commit(image.item.id);assert.equal(records().filter(x=>x.type==='clipboard').at(-1).kind,'image');assert.equal(records().filter(x=>x.type==='paste').at(-1).target.hwnd,'200');await wait(100);assert.equal(records().filter(x=>x.type==='clipboard').at(-1).kind,'image');
  console.log('PASS 历史图片复制位图并发往当前聊天，完成后剪贴板仍保留选中图片');
  assert.ok(image.item.filePath.startsWith(tmp+path.sep));fs.unlinkSync(image.item.filePath);
  await openBar('B');const failedImage=await commit(image.item.id);assert.equal(failedImage.copyFailed,true);assert.equal(failedImage.ok,false);assert.match(failedImage.message,/原图片不存在/);await main.evaluate('window.suira.clipboardBar.hide()');
  update({current:'A',offset:0});assert.equal((await main.evaluate(`window.suira.panel.run('long-capture')`)).ok,true);
  const overlay=await page(t=>t.url.endsWith('/long-picker.html'));await until(()=>overlay.evaluate(`window.__longPickerState?.ready`));
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:90,button:'left',buttons:1,clickCount:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:330,button:'left',buttons:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:320,y:330,button:'left',buttons:0,clickCount:1});
  const hud=await page(t=>t.url.endsWith('/long-capture.html'));await until(()=>hud.evaluate('window.suira.longCapture.state()'));const first=await hud.evaluate('window.suira.longCapture.state()');
  update({offset:70});const second=await until(async()=>{const s=await hud.evaluate('window.suira.longCapture.state()');return s.frames===2||s.paused?s:null;});assert.equal(second.frames,2,JSON.stringify(second));
  update({current:'B',offset:120});await until(async()=>(await hud.evaluate('window.suira.longCapture.state()')).paused);const paused=await hud.evaluate('window.suira.longCapture.state()');assert.equal(paused.frames,2);
  update({current:'A'});await hud.evaluate(`window.suira.longCapture.command('resume')`);await until(async()=>(await hud.evaluate('window.suira.longCapture.state()')).frames===3);
  const final=await hud.evaluate('window.suira.longCapture.state()');assert.equal(final.height,first.height+120);
  update({current:'self',hit:'A'});await wait(650);assert.equal((await hud.evaluate('window.suira.longCapture.state()')).paused,false,'源窗口可见时不要求它抢到前台');update({current:'A',hit:null});
  // 按钮必须真的在最上层、可以接住点击：旧版把工具条设成 focusable:false 并每帧隐藏，
  // 用脚本 .click() 依然"成功"，但用户点不动。这里至少保证渲染层没有遮挡/穿透。
  const hit=await hud.evaluate(`(()=>['cancel','pause','finish'].map(command=>{const button=document.querySelector('[data-command="'+command+'"]');if(!button||button.hidden||button.disabled)return {command,ok:false,why:'不可用'};const rect=button.getBoundingClientRect();const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return {command,ok:top===button||button.contains(top),why:top?top.className:'none'};}))()`);
  assert.ok(hit.every(item=>item.ok),'工具条按钮必须命中自身：'+JSON.stringify(hit));
  const shot=await hud.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(root,'docs','screenshots','29-long-capture-hud.png'),Buffer.from(shot.data,'base64'));
  // 右下角预览窗：确认它拿到的就是同一份拼接结果（3 段），并留一张文档截图。
  const preview=await page(t=>t.url.endsWith('/long-preview.html')).catch(()=>null);
  if(preview){
    const previewState=await until(()=>preview.evaluate(`(()=>{const img=document.getElementById('preview-image');return img&&!img.hidden?{width:img.naturalWidth,height:img.naturalHeight,frames:document.getElementById('preview-frames').textContent}:null;})()`));
    assert.ok(previewState.width>0&&previewState.height>0,'预览窗必须渲染出缩略图');assert.match(previewState.frames,/3 段/);
    const previewShot=await preview.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(root,'docs','screenshots','31-long-capture-preview.png'),Buffer.from(previewShot.data,'base64'));
    console.log('PASS 右下角预览窗按段数刷新缩略图',previewState.width+'×'+previewState.height);
  }else console.log('WARN 未找到长图预览窗');
  assert.ok(records().some(r=>r.type==='show'&&r.title==='随序 · 采集区域'),'采集期间必须有独立区域边框');
  const clipboardBefore=records().filter(r=>r.type==='clipboard'&&r.kind==='image').length;
  await hud.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const item=await until(async()=>{const items=await main.evaluate(`window.suira.content.list({kinds:['image']})`);return items.find(item=>item.meta?.captureKind==='long');});assert.equal(item.meta.frames,3);assert.equal(item.meta.height,final.height);
  const saved=fs.readFileSync(item.filePath);assert.equal(saved.readUInt32BE(16),first.width);assert.equal(saved.readUInt32BE(20),final.height);
  const stitched=PNG.sync.read(saved),initial=PNG.sync.read(fs.readFileSync(path.join(tmp,'frame-0.png'))),last=PNG.sync.read(fs.readFileSync(path.join(tmp,'frame-120.png'))),stride=first.width*4;
  assert.deepEqual(stitched.data.subarray(0,24*stride),initial.data.subarray(0,24*stride),'固定页眉保留一次且像素不变');
  assert.deepEqual(stitched.data.subarray((stitched.height-10)*stride),last.data.subarray((last.height-10)*stride),'固定页脚保留在完整长图末尾');
  for(let y=first.height+20;y<final.height-40;y+=20)assert.deepEqual(stitched.data.subarray(y*stride,y*stride+(first.width-24)*4),last.data.subarray((y-120)*stride,(y-120)*stride+(first.width-24)*4),'正文拼接没有重复或断层');
  fs.copyFileSync(item.filePath,path.join(root,'docs','screenshots','30-long-capture-result.png'));
  await until(()=>records().filter(r=>r.type==='clipboard'&&r.kind==='image').length>clipboardBefore);
  assert.equal((await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).some(t=>t.url.includes('mode=image-editor')),false,'完成直接复制，不弹编辑预览');
  assert.equal(await main.evaluate('window.suira.longCapture.state()'),null);
  console.log('PASS G 键框选启动、停稳后自动拼接、切换页面暂停、继续后完成长图、回车直接复制且无编辑预览');
  update({current:'A',offset:0});await main.evaluate(`window.suira.panel.run('long-capture')`);await until(()=>overlay.evaluate(`window.__longPickerState?.ready`));
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:90,button:'left',buttons:1,clickCount:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:330,button:'left',buttons:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:320,y:330,button:'left',buttons:0,clickCount:1});
  const canceledHud=await page(t=>t.url.endsWith('/long-capture.html'));await until(()=>canceledHud.evaluate(`document.getElementById('long-size')?.textContent.includes('段')`));
  await canceledHud.evaluate(`setTimeout(()=>document.querySelector('[data-command="cancel"]').click(),50),true`);
  await until(async()=>!(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).some(t=>t.url.endsWith('/long-capture.html')));
  const count=records().filter(x=>x.type==='capture').length;await wait(600);assert.equal(records().filter(x=>x.type==='capture').length,count);
  const afterCancel=await main.evaluate(`window.suira.content.list({kinds:['image']})`);assert.equal(afterCancel.filter(x=>x.meta?.captureKind==='long').length,1);
  console.log('PASS 真实浏览器文字页面逐行像素校验；取消关闭组件、停止采集且不生成额外图片');
  update({current:'A',failRegion:true});await main.evaluate(`window.suira.panel.run('long-capture')`);await until(()=>overlay.evaluate(`window.__longPickerState?.ready`));
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:90,button:'left',buttons:1,clickCount:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:330,button:'left',buttons:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:320,y:330,button:'left',buttons:0,clickCount:1});
  await until(()=>overlay.evaluate(`window.__longPickerState.error.includes('模拟原生采集失败')`));
  assert.equal(await overlay.evaluate('Boolean(window.__longPickerState.rect)&&window.__longPickerState.ready'),true,'启动失败保留原选区和透明框选层');
  update({failRegion:false});await overlay.evaluate(`document.getElementById('retry').click(),true`);
  const retryHud=await page(t=>t.url.endsWith('/long-capture.html'));await until(()=>retryHud.evaluate('window.suira.longCapture.state()'));
  await retryHud.evaluate(`setTimeout(()=>window.suira.longCapture.command('cancel'),30),true`);
  await until(async()=>!(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).some(t=>t.url.endsWith('/long-capture.html')));
  await main.evaluate(`window.suira.panel.run('long-capture')`);const oldRevision=await overlay.evaluate('window.__longPickerState.revision');await overlay.evaluate('window.suira.longCapture.cancelPicker()');
  await main.evaluate(`window.suira.panel.run('long-capture')`);assert.equal((await overlay.evaluate(`window.suira.longCapture.start({x:80,y:90,width:240,height:240,revision:${oldRevision}})`)).ok,false);
  await overlay.evaluate('window.suira.longCapture.cancelPicker()');
  update({delayRegion:500});await main.evaluate(`window.suira.panel.run('long-capture')`);const requests=records().filter(r=>r.type==='region-request').length;
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:90,button:'left',buttons:1,clickCount:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:330,button:'left',buttons:1});await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:320,y:330,button:'left',buttons:0,clickCount:1});
  await until(()=>records().filter(r=>r.type==='region-request').length>requests);const workers=records().filter(r=>r.type==='worker').length;await overlay.evaluate('window.suira.longCapture.cancelPicker()');await wait(700);
  assert.equal(records().filter(r=>r.type==='worker').length,workers,'准备首帧期间取消不会重新启动组件');assert.equal(await main.evaluate('window.suira.longCapture.state()'),null);update({delayRegion:0});
  console.log('PASS 启动失败保留选区可直接重试；非前台可见源继续采集；框选取消和过期提交不启动采集');
})().catch(error=>{console.error(error);for(const offset of [0,70]){const file=path.join(tmp,'frame-'+offset+'.png');if(fs.existsSync(file))fs.copyFileSync(file,path.join(root,'.workbuddy','long-frame-'+offset+'.png'));}const trace=path.join(tmp,'trace.jsonl');if(fs.existsSync(trace)){const records=fs.readFileSync(trace,'utf8').trim().split('\n').filter(line=>line.includes('"type":"capture"'));console.error(records.slice(0,3).join('\n'));}if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-3000));process.exitCode=1;}).finally(async()=>{
  for(const socket of sockets)socket.close();if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(300);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
});
