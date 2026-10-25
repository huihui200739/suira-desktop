'use strict';
// 独立数据目录与模拟剪贴板/文件对话框；不读取用户桌面或剪贴板。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-image-editor-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms)),sockets=[];let child;
async function until(fn){for(let n=0;n<150;n++){try{const value=await fn();if(value)return value;}catch{}await wait(100);}throw Error('图片编辑器未就绪');}
(async()=>{
  const exe=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);assert.ok(exe);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const source=path.join(tmp,'source.png'),saved=path.join(tmp,'result.png'),control=path.join(tmp,'dialog.json'),writes=path.join(tmp,'clipboard.json');
  fs.writeFileSync(control,JSON.stringify({open:source,canceled:true}));
  const entry=path.join(tmp,'app.js');
  fs.writeFileSync(entry,`const fs=require('node:fs');const {app,clipboard,globalShortcut,dialog}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';clipboard.write=async items=>fs.writeFileSync(${JSON.stringify(writes)},JSON.stringify({count:items.length,types:items[0]?.types}));const keys=new Set();globalShortcut.register=k=>{keys.add(k);return true};globalShortcut.unregister=k=>keys.delete(k);globalShortcut.unregisterAll=()=>keys.clear();const config=()=>JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[config().open]});dialog.showSaveDialog=async()=>({canceled:config().canceled,filePath:config().save});require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(exe,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async predicate=>{const c=await until(()=>connect(port,predicate));sockets.push(c.ws);return c;};
  const main=await page(t=>t.url.endsWith('/index.html'));await until(()=>main.evaluate('Boolean(window.suira?.imageEditor)'));
  const png=await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=1800;c.height=1000;const x=c.getContext('2d');x.fillStyle='#e8edf5';x.fillRect(0,0,c.width,c.height);x.fillStyle='#0d74ce';x.fillRect(900,0,900,1000);x.fillStyle='#fff';x.font='60px sans-serif';x.fillText('SUIRA image editor',960,520);return c.toDataURL()})()`);
  const original=Buffer.from(png.split(',')[1],'base64');fs.writeFileSync(source,original);
  assert.equal((await main.evaluate(`window.suira.panel.run('edit-image')`)).ok,true);
  const editor=await page(t=>t.url.includes('mode=image-editor'));
  await until(()=>editor.evaluate(`!document.getElementById('editor-empty').hidden`));
  assert.equal(await editor.evaluate(`document.getElementById('tool-dock').hidden`),true);
  await editor.evaluate(`document.getElementById('editor-empty-open').click(),true`);
  await until(()=>editor.evaluate(`document.body.classList.contains('editor-has-image')&&!document.getElementById('tool-dock').hidden`));
  assert.deepEqual(await editor.evaluate(`(()=>{const c=compositeSelection();return {width:c.width,height:c.height}})()`),{width:1800,height:1000});
  console.log('PASS I 键动作、空工作台、本地打开、缩小预览仍导出原始 1800×1000');
  const rect=await editor.evaluate(`(()=>{document.querySelector('[data-tool="rect"]').click();const r=root.getBoundingClientRect();return {x:r.left+r.width*.15,y:r.top+r.height*.2,x2:r.left+r.width*.4,y2:r.top+r.height*.5}})()`);
  await editor.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',buttons:1,clickCount:1});
  await editor.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x2,y:rect.y2,button:'left',buttons:1});
  await editor.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x2,y:rect.y2,button:'left',buttons:0,clickCount:1});
  assert.equal(await editor.evaluate('state.annotations.length'),1);
  const before=await editor.evaluate(`(()=>{const c=compositeSelection(),p=c.getContext('2d').getImageData(270,300,1,1).data;return [...p]})()`);assert.ok(before[0]>150&&before[1]<130,JSON.stringify(before));
  const save=()=>editor.evaluate(`captureApi.finish({action:'save',dataUrl:compositeSelection().toDataURL('image/png')})`);
  assert.equal((await save()).canceled,true);assert.equal((await main.evaluate(`window.suira.content.list({kinds:['image']})`)).length,0);
  fs.writeFileSync(control,JSON.stringify({save:source,canceled:false}));assert.equal((await save()).ok,false);assert.deepEqual(fs.readFileSync(source),original);
  fs.writeFileSync(control,JSON.stringify({save:source.slice(0,-4),canceled:false}));assert.equal((await save()).ok,false);assert.deepEqual(fs.readFileSync(source),original);
  fs.writeFileSync(control,JSON.stringify({save:saved,canceled:false}));const output=await save();assert.equal(output.ok,true);assert.equal(fs.readFileSync(saved).readUInt32BE(16),1800);assert.equal(output.item.meta.derivedBy,'image.edit');
  console.log('PASS 真实鼠标标注、另存为取消无残留、拒绝覆盖原图、PNG 新文件与内容库输出');
  await editor.send('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});await wait(200);
  const after=await editor.evaluate(`(()=>{const c=compositeSelection(),p=c.getContext('2d').getImageData(270,300,1,1).data;return {width:c.width,height:c.height,p:[...p],dock:(()=>{const r=toolDock.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()}})()`);
  assert.equal(after.width,1800);assert.equal(after.height,1000);assert.ok(after.p[0]>150&&after.p[1]<130,JSON.stringify(after));assert.equal(after.dock,true);
  const crop=await editor.evaluate(`(()=>{setTool('select');const r=root.getBoundingClientRect();return {x:r.left+r.width*.1,y:r.top+r.height*.1,x2:r.left+r.width*.6,y2:r.top+r.height*.6}})()`);
  await editor.send('Input.dispatchMouseEvent',{type:'mousePressed',x:crop.x,y:crop.y,button:'left',buttons:1,clickCount:1});
  await editor.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:crop.x2,y:crop.y2,button:'left',buttons:1});
  await editor.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:crop.x2,y:crop.y2,button:'left',buttons:0,clickCount:1});
  const cropped=await editor.evaluate(`(()=>{const c=compositeSelection();return {width:c.width,height:c.height,count:state.annotations.length}})()`);
  assert.ok(Math.abs(cropped.width-900)<=1&&Math.abs(cropped.height-500)<=1,JSON.stringify(cropped));assert.equal(cropped.count,1);
  await editor.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true})),true`);assert.equal(await editor.evaluate('state.annotations.length'),1);
  const copied=await editor.evaluate(`captureApi.finish({action:'copy',dataUrl:compositeSelection().toDataURL('image/png')})`);assert.equal(copied.ok,true);assert.ok(fs.existsSync(writes));
  console.log('PASS 缩放窗口保留标注位置与输出分辨率、工具栏完整可见、真实复制 IPC');
  const derived=await main.evaluate(`window.suira.content.get(${JSON.stringify(output.item.id)})`);
  assert.ok(derived);
  assert.equal((await main.evaluate(`window.suira.imageEditor.open({itemId:${JSON.stringify(output.item.id)}})`)).ok,true);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();assert.equal(pages.filter(t=>t.url.includes('mode=image-editor')).length,2);
  assert.equal(await main.evaluate('window.suira.capture.getData()'),null);
  assert.equal((await main.evaluate(`window.suira.imageEditor.open({filePath:${JSON.stringify(path.join(tmp,'missing.png'))}})`)).ok,false);
  assert.deepEqual(fs.readFileSync(source),original);
  console.log('PASS 历史图片进入编辑、新窗口保留已有标注、不调用桌面截图、缺失图片报错、原图未修改');
  // 示例图片与窗口截图只含本脚本生成的数据。
  await editor.send('Emulation.setDeviceMetricsOverride',{width:1120,height:800,deviceScaleFactor:1,mobile:false});await wait(150);
  for(const scheme of ['light','dark']) {
    await editor.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});await wait(300);
    const color=await editor.evaluate(`(()=>{const b=document.querySelector('[data-tool="pen"]'),s=getComputedStyle(b);return {ink:s.getPropertyValue('--ink'),color:s.color,slate:s.getPropertyValue('--slate-12')}})()`);
    const values=color.color.match(/\d+/g).slice(0,3).map(Number);assert.ok(scheme==='dark'?values.reduce((a,b)=>a+b)>600:values.reduce((a,b)=>a+b)<150,JSON.stringify(color));
    const shot=await editor.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(root,'docs','screenshots','28-image-editor-'+scheme+'.png'),Buffer.from(shot.data,'base64'));
  }
  console.log('PASS 裁剪与恢复全图保留标注，明暗主题工具栏图标均清晰可辨');
  const known=new Set((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t=>t.id));
  assert.equal((await main.evaluate('window.suira.imageEditor.open({})')).ok,true);
  const dropPage=await page(t=>t.url.includes('mode=image-editor')&&!known.has(t.id));await until(()=>dropPage.evaluate('Boolean(window.SuiraEditorUI)'));
  await dropPage.evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png.split(',')[1])}),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'drop.png',{type:'image/png'}));document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return true})()`);
  await until(()=>dropPage.evaluate('Boolean(state.image)'));assert.equal(await dropPage.evaluate('compositeSelection().width'),1800);
  const alpha=await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=60;c.height=40;c.getContext('2d').fillRect(20,10,20,20);return c.toDataURL()})()`);
  const prior=new Set((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t=>t.id));
  await dropPage.evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(alpha.split(',')[1])}),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'paste.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));return true})()`);
  const pasted=await page(t=>t.url.includes('mode=image-editor')&&!prior.has(t.id));await until(()=>pasted.evaluate('Boolean(state.image)'));
  const alphaResult=await pasted.evaluate(`(()=>{const c=compositeSelection();return {width:c.width,height:c.height,alpha:c.getContext('2d').getImageData(0,0,1,1).data[3]}})()`);assert.deepEqual(alphaResult,{width:60,height:40,alpha:0});
  assert.equal(await dropPage.evaluate('compositeSelection().width'),1800);
  console.log('PASS 拖入文件和粘贴位图完整导入，透明通道保留，导入新图片保留已有编辑窗口');
  for(const extension of ['jpg','webp']) {
    const url=await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=32;c.height=24;c.getContext('2d').fillRect(0,0,32,24);return c.toDataURL('image/${extension==='jpg'?'jpeg':'webp'}')})()`);
    const file=path.join(tmp,'format.'+extension);fs.writeFileSync(file,Buffer.from(url.split(',')[1],'base64'));
    const earlier=new Set((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t=>t.id));
    const result=await main.evaluate(`window.suira.imageEditor.open({filePath:${JSON.stringify(file)}})`);assert.equal(result.ok,true,extension+' '+JSON.stringify(result));
    const imported=await page(t=>t.url.includes('mode=image-editor')&&!earlier.has(t.id));await until(()=>imported.evaluate('Boolean(state.image)'));
    assert.deepEqual(await imported.evaluate(`(()=>{const c=compositeSelection();return [c.width,c.height]})()`),[32,24]);
  }
  const bmp=Buffer.alloc(374);bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(10,18);bmp.writeInt32LE(10,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.writeUInt32LE(320,34);
  const bmpPath=path.join(tmp,'format.bmp');fs.writeFileSync(bmpPath,bmp);
  const beforeBmp=new Set((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t=>t.id));
  assert.equal((await main.evaluate(`window.suira.imageEditor.open({filePath:${JSON.stringify(bmpPath)}})`)).ok,true);
  const bmpEditor=await page(t=>t.url.includes('mode=image-editor')&&!beforeBmp.has(t.id));await until(()=>bmpEditor.evaluate('Boolean(state.image)'));assert.equal(await bmpEditor.evaluate('compositeSelection().width'),10);
  console.log('PASS 本机原生解码 PNG、JPEG、WebP、BMP 格式');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-3500));process.exitCode=1;}).finally(async()=>{
  for(const ws of sockets)ws.close();if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(300);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
});
