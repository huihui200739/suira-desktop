'use strict';
// Real Electron + real display capture, isolated data. Saves one short local test video.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{connect}=require('./runtime-client');
const ROOT=path.resolve(__dirname,'..'),TMP=fs.mkdtempSync(path.join(os.tmpdir(),'suira-recorder-live-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms)),clients=[];
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await wait(50);}throw Error('测试状态超时');}
async function port(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
let child,testSource;
(async()=>{
  const debugPort=await port();
  const entry=path.join(TMP,'app.js'),regionFile=path.join(TMP,'region.json');
  const testPreload=path.join(TMP,'test-preload.js');
  fs.writeFileSync(testPreload,`require('electron').contextBridge.exposeInMainWorld('restoreTestClipboard',()=>require('electron').ipcRenderer.invoke('test:restore-clipboard'));`);
  fs.writeFileSync(entry,`const {app,BrowserWindow,screen,ipcMain,clipboard,ClipboardItem}=require('electron');app.setPath('userData',${JSON.stringify(path.join(TMP,'data'))});
    let original=[];app.whenReady().then(async()=>{original=await Promise.all((await clipboard.read()).map(async item=>{const data={};for(const type of item.types)data[type]=await item.getType(type);return new ClipboardItem(data);}));});
    ipcMain.handle('test:restore-clipboard',()=>original.length?clipboard.write(original):clipboard.clear());
    require(${JSON.stringify(path.join(ROOT,'main.js'))});
    app.whenReady().then(async()=>{
      const d=screen.getPrimaryDisplay();const x=d.bounds.x+80,y=d.bounds.y+80;
      const sample=new BrowserWindow({x,y,width:640,height:420,frame:false,alwaysOnTop:true,backgroundColor:'#ff0000',webPreferences:{contextIsolation:true,preload:${JSON.stringify(testPreload)}}});
      await sample.loadURL('data:text/html,<title>Suira recording test source</title><body style="margin:0;background:linear-gradient(90deg,red 50%,blue 50%);width:100vw;height:100vh">');sample.showInactive();sample.moveTop();
      require('fs').writeFileSync(${JSON.stringify(regionFile)},JSON.stringify({x:x+40,y:y+40,width:400,height:240,scale:d.scaleFactor}));
    });`);
  const exe=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(os.homedir(),'suira-electron-dist','electron.exe')].filter(Boolean).find(fs.existsSync);
  assert.ok(exe,'缺少可用 Electron');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(TMP,'app.log'),'w');child=spawn(exe,[entry,`--remote-debugging-port=${debugPort}`,'--background'],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async suffix=>{
    await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).some(t=>t.url.endsWith(suffix));}catch{return false;}});
    const client=await connect(debugPort,t=>t.url.endsWith(suffix));clients.push(client);await until(()=>client.evaluate(`document.readyState==='complete'`));return client;
  };
  const root=await page('/island.html'),overlay=await page('/overlay.html');
  await until(()=>fs.existsSync(regionFile));const region=JSON.parse(fs.readFileSync(regionFile,'utf8'));
  testSource=await connect(debugPort,t=>t.title==='Suira recording test source');clients.push(testSource);
  assert.equal((await root.evaluate(`window.suira.recording.begin()`)).ok,false,'普通浮层不得写入录屏文件');
  assert.ok((await root.evaluate(`window.suira.panel.run('record')`)).ok);
  await until(()=>overlay.evaluate(`state.intent==='record' && !document.getElementById('loading-state').hidden===false`));
  const selected=await overlay.evaluate(`(async()=>{state.selection={x:${region.x}-state.payload.bounds.x,y:${region.y}-state.payload.bounds.y,w:${region.width},h:${region.height}};state.selectionReady=true;renderSelection();await finish();return document.getElementById('action-toast').textContent;})()`);
  const recorder=await page('/recorder.html');
  await until(()=>recorder.evaluate(`document.getElementById('region-size')?.textContent.length>0`));
  await recorder.send('Runtime.evaluate',{expression:`document.getElementById('countdown').checked=false;document.getElementById('start').click()`,userGesture:true});
  const phase=await until(()=>recorder.evaluate(`(()=>{const p=document.getElementById('recorder').dataset.phase;return ['recording','error'].includes(p)?{phase:p,message:document.getElementById('notice').textContent}:null;})()`));
  assert.equal(phase.phase,'recording',phase.message);
  await wait(1300);await recorder.evaluate(`document.getElementById('pause').click()`);
  assert.equal(await recorder.evaluate(`document.getElementById('recorder').dataset.phase`),'paused');
  await wait(650);await recorder.evaluate(`document.getElementById('pause').click()`);await wait(900);
  await recorder.evaluate(`document.getElementById('stop').click()`);
  const final=await until(()=>recorder.evaluate(`(()=>{const p=document.getElementById('recorder').dataset.phase;return ['saved','error'].includes(p)?{phase:p,message:document.getElementById('notice').textContent}:null;})()`));
  assert.equal(final.phase,'saved',final.message);
  const folder=path.join(TMP,'data','recordings'),name=fs.readdirSync(folder).find(f=>f.endsWith('.webm'));
  assert.ok(name,'必须生成真实 WebM');const file=path.join(folder,name),bytes=fs.readFileSync(file);
  assert.equal(bytes.subarray(0,4).toString('hex'),'1a45dfa3');assert.ok(bytes.length>1000);
  const video=await recorder.evaluate(`(async()=>{
    const video=document.createElement('video');video.muted=true;video.src=${JSON.stringify(require('node:url').pathToFileURL(file).href)};
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('视频无法解码'));});
    await video.play();await new Promise(resolve=>setTimeout(resolve,400));
    const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');ctx.drawImage(video,0,0);
    const left=[...ctx.getImageData(Math.round(c.width*.05),Math.round(c.height*.5),1,1).data];
    const right=[...ctx.getImageData(Math.round(c.width*.95),Math.round(c.height*.5),1,1).data];
    return {width:c.width,height:c.height,left,right};
  })()`);
  assert.equal(video.width,Math.round(region.width*region.scale));assert.equal(video.height,Math.round(region.height*region.scale));
  assert.ok(video.left[0]>180&&video.left[2]<80,'左侧应为红色：'+JSON.stringify(video));
  assert.ok(video.right[2]>180&&video.right[0]<80,'右侧应为蓝色：'+JSON.stringify(video));
  console.log('PASS 真实区域录屏、暂停/继续、停止、文件落盘、WebM 解码、DPI 尺寸与左右像素验证');
  console.log(JSON.stringify({file,bytes:bytes.length,...video}));
  const shot=await recorder.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(TMP,'recorder-saved.png'),Buffer.from(shot.data,'base64'));
  // Verify a pinned image's real menu and clipboard without injecting into another app.
  const image=await root.evaluate(`(()=>{const c=document.createElement('canvas');c.width=400;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#b9c8e0';ctx.fillRect(0,0,400,240);return window.suira.capture.finish({dataUrl:c.toDataURL(),action:'pin'});})()`);
  assert.ok(image.ok);const pin=await page('/pin.html');
  await until(()=>pin.evaluate(`document.getElementById('pin-image').naturalWidth>0`));
  await pin.evaluate(`document.dispatchEvent(new MouseEvent('contextmenu',{clientX:80,clientY:50,bubbles:true,cancelable:true}))`);
  assert.equal(await pin.evaluate(`document.getElementById('pin-menu').hidden`),false);
  const menu=await pin.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(TMP,'pin-menu.png'),Buffer.from(menu.data,'base64'));
  assert.ok((await pin.evaluate('window.pinApi.copy()')).ok);
  assert.equal((await pin.evaluate('window.pinApi.toggleTop()')).alwaysOnTop,false);
  assert.equal((await pin.evaluate('window.pinApi.toggleTop()')).alwaysOnTop,true);
  await pin.evaluate(`document.getElementById('collapse').click()`);
  await wait(80);assert.ok(Math.abs(await pin.evaluate(`window.pinApi.bounds().height`)-40)<=1,'分数 DPI 下收起高度允许 1 DIP 舍入');
  await pin.evaluate(`document.getElementById('restore').click()`);await wait(80);
  assert.ok(await pin.evaluate(`window.pinApi.bounds().height>40`));
  console.log('PASS 钉图真实图片、右键菜单、复制、置顶切换、收起与恢复');
  const audio = await recorder.send('Runtime.evaluate',{expression:`(async()=>{await window.suira.recording.prepare({systemAudio:true});const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});try{return {audio:stream.getAudioTracks().length,video:stream.getVideoTracks().length};}finally{stream.getTracks().forEach(track=>track.stop());}})()`,awaitPromise:true,returnByValue:true,userGesture:true});
  if(audio.exceptionDetails)throw Error(audio.exceptionDetails.exception?.description||audio.exceptionDetails.text);
  assert.deepEqual(audio.result.value,{audio:1,video:1});console.log('PASS 系统声音回环采集得到真实音轨，结束后释放');
  if(process.argv.includes('--preview')) {
    const out=path.join(ROOT,'docs','preview','unified-ui-2026-10-24');fs.mkdirSync(out,{recursive:true});
    const screenshot=async(client,name,clip)=>{const image=await client.send('Page.captureScreenshot',{format:'png',...(clip?{clip:{...clip,scale:1}}:{})});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));};
    const scheme=async(client,value)=>{await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]});await wait(160);};
    const bar=await page('/clipboardbar.html');
    for(const text of ['发布前检查清单\n完成界面统一，验证截图与剪贴板。','把灵感随手接住，让工作继续。','https://example.com/design'])await root.evaluate(`window.suira.content.addText({text:${JSON.stringify(text)},source:'user'})`);
    await root.evaluate('window.suira.clipboardBar.show()');await until(()=>bar.evaluate(`document.querySelectorAll('.bar-card').length>=4`));
    for(const value of ['light','dark']){await scheme(bar,value);await screenshot(bar,'clipboard-'+value);await scheme(recorder,value);await screenshot(recorder,'recorder-'+value);await scheme(pin,value);await pin.evaluate(`document.dispatchEvent(new MouseEvent('contextmenu',{clientX:80,clientY:50,bubbles:true,cancelable:true}))`);await screenshot(pin,'pin-'+value);}
    await root.evaluate('window.suira.clipboardBar.hide()');
    await root.evaluate('window.suira.capture.start()');await until(()=>overlay.evaluate(`!document.getElementById('loading-state').hidden===false && !!state.image`));
    const clip=await overlay.evaluate(`(()=>{const ctx=screenCanvas.getContext('2d');ctx.fillStyle='#eef1f6';ctx.fillRect(0,0,screenCanvas.width,screenCanvas.height);state.selection={x:120,y:100,w:600,h:260};state.selectionReady=true;renderSelection();const r=document.getElementById('tool-dock').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x)-12),y:Math.floor(r.y)-12,width:Math.ceil(r.width)+24,height:Math.ceil(r.height)+24};})()`);
    for(const value of ['light','dark']){await scheme(overlay,value);await screenshot(overlay,'toolbar-'+value,clip);}
    await root.evaluate('window.suira.capture.cancel()');
    const quick=await page('/quickpanel.html');await root.evaluate('window.suira.quick.show()');await wait(150);
    for(const value of ['light','dark']){await scheme(quick,value);await screenshot(quick,'panel-'+value);}
    await root.evaluate('window.suira.quick.hide()');
    const gallery=path.join(TMP,'gallery.html'),url=name=>require('node:url').pathToFileURL(path.join(out,name+'.png')).href;
    fs.writeFileSync(gallery,`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#edf0f5;color:#273247;font:15px "Segoe UI","Microsoft YaHei UI",sans-serif;padding:36px}h1{font-size:27px;margin:0 0 8px}p{color:#697487;margin:0 0 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.column{display:flex;flex-direction:column;gap:14px;min-width:0}.dark{background:#1e222b;border-radius:24px;padding:16px;color:#e4e8f1}.light{padding:16px;background:#f6f8fb;border-radius:24px}h2{font-size:13px;font-weight:600;letter-spacing:.08em;margin:0 0 6px}img{display:block;max-width:100%;height:auto}.panel{width:345px;margin:0 auto}.row{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start}.tile{min-width:0}.row img{width:100%}.clipboard{width:100%}.toolbar{width:100%}.pin{max-height:175px;width:auto!important;max-width:100%}</style><h1>随序 · 统一浮层与录屏</h1><p>同一套玻璃材质、控件与交互反馈，随浅色和深色主题切换。</p><div class="grid">${['light','dark'].map(value=>`<section class="column ${value}"><h2>${value==='light'?'LIGHT / 浅色':'DARK / 深色'}</h2><img class="panel" src="${url('panel-'+value)}"><h2>剪贴板历史</h2><img class="clipboard" src="${url('clipboard-'+value)}"><h2>截图工具栏</h2><img class="toolbar" src="${url('toolbar-'+value)}"><div class="row"><div class="tile"><h2>区域录屏</h2><img src="${url('recorder-'+value)}"></div><div class="tile"><h2>钉图右键</h2><img class="pin" src="${url('pin-'+value)}"></div></div></section>`).join('')}</div>`);
    await testSource.send('Page.navigate',{url:require('node:url').pathToFileURL(gallery).href});
    await testSource.send('Emulation.setDeviceMetricsOverride',{width:1440,height:930,deviceScaleFactor:1,mobile:false});
    await until(()=>testSource.evaluate(`document.images.length===10&&[...document.images].every(img=>img.complete&&img.naturalWidth>0)`));
    await screenshot(testSource,'overview');console.log('PREVIEW '+path.join(out,'overview.png'));
  }
  await recorder.evaluate('window.suira.recording.close()');
  // A second recording can be canceled during countdown, without leaving a file/session.
  assert.ok((await root.evaluate(`window.suira.panel.run('record')`)).ok);
  await until(()=>overlay.evaluate(`state.intent==='record' && !!state.payload && document.getElementById('loading-state').hidden`));
  await overlay.evaluate(`(async()=>{state.selection={x:${region.x}-state.payload.bounds.x,y:${region.y}-state.payload.bounds.y,w:200,h:120};await finish();})()`);
  const canceled=await page('/recorder.html');await until(()=>canceled.evaluate(`document.getElementById('region-size')?.textContent.length>0`));
  await canceled.send('Runtime.evaluate',{expression:`document.getElementById('start').click()`,userGesture:true});
  const countdown=await until(()=>canceled.evaluate(`(()=>{const p=document.getElementById('recorder').dataset.phase;return ['countdown','error'].includes(p)?{phase:p,message:document.getElementById('notice').textContent}:null;})()`));
  assert.equal(countdown.phase,'countdown',countdown.message);await canceled.evaluate(`document.getElementById('close').click()`);await wait(200);
  assert.equal(fs.readdirSync(folder).filter(name=>name.endsWith('.partial')).length,0);
  console.log('PASS 倒计时期间可取消，不留下录制数据');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  if(testSource){try{await testSource.evaluate('window.restoreTestClipboard()');}catch{}}
  for(const client of clients)client.ws.close();child?.kill();console.log('测试记录：'+TMP);
});
