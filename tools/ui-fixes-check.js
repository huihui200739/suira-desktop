'use strict';
// Only synthetic clipboard, images, service responses and an isolated profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-ui-fixes-')),sockets=[],errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function until(fn){let last;for(let i=0;i<180;i++){try{const value=await fn();if(value)return value;}catch(error){last=error;}await wait(40);}throw last||Error('New tools state timed out');}
(async()=>{
 const electron = process.env.SUIRA_ELECTRON || ['C:\\suira-electron\\electron.exe', path.join(root,'node_modules','electron','dist','electron.exe')].find(fs.existsSync);
 assert.ok(electron && fs.existsSync(electron), 'Install Electron dependencies or set SUIRA_ELECTRON to a valid executable');
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});await store.save();
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const control=path.join(tmp,'control.json'),stateFile=path.join(tmp,'state.json'),entry=path.join(tmp,'app.js');fs.writeFileSync(control,'{}');
 const hooks=`\ntranslateConfig=()=>({provider:'openai',apiKey:'fixture-secret',baseUrl:'https://example.invalid/v1',model:'fixture',source:'auto',target:'zh'});translateStatus=()=>({configured:true,provider:'openai',hasKey:true,target:'zh',targets:[{code:'zh',label:'中文'},{code:'en',label:'英文'}]});global.__ui40Show=showQuickPanel;global.__ui40Overlay=showOverlayWindow;global.__ui40Store=()=>store;appIndex.candidates=async()=>[];`;
 fs.writeFileSync(entry,`const fs=require('node:fs'),{app,clipboard,net,shell,globalShortcut,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};global.__requests=[];global.__opened=[];global.__copied='';global.__captures=[];const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>handle(channel,channel==='capture:start'?(_event,options)=>{global.__captures.push(options);return {ok:true};}:fn);clipboard.read=async()=>[];clipboard.readText=async()=>global.__copied;clipboard.writeText=async value=>{global.__copied=value;};shell.openExternal=async url=>global.__opened.push(url);globalShortcut.register=()=>false;net.fetch=async(url,options)=>{global.__requests.push({url:String(url),body:options?.body?JSON.parse(options.body):null});if(String(url).includes('frankfurter.dev'))return {ok:true,json:async()=>({base:'USD',quote:'CNY',rate:7,date:'2026-11-06'})};if(String(url).includes('example.invalid'))return {ok:true,json:async()=>({choices:[{message:{content:'Fixture result'}}]})};throw Error('Unexpected network endpoint');};require(${JSON.stringify(path.join(root,'lib/ocr'))}).OcrService.prototype.recognizeFile=async()=>({text:'',engine:'fixture'});const Module=require('node:module'),filename=${JSON.stringify(path.join(root,'main.js'))},m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(${JSON.stringify(root)});m._compile(fs.readFileSync(filename,'utf8')+${JSON.stringify(hooks)},filename);let last=0;setInterval(async()=>{if(!app.isReady())return;let c;try{c=JSON.parse(fs.readFileSync(${JSON.stringify(control)}));}catch{return;}if(!c.id||c.id===last)return;last=c.id;try{if(c.show)await global.__ui40Show();if(c.overlay)await global.__ui40Overlay(c.overlay);fs.writeFileSync(${JSON.stringify(stateFile)},JSON.stringify({id:c.id,copied:global.__copied,captures:global.__captures,requests:global.__requests,opened:global.__opened,executions:global.__ui40Store()?.data.executions}));}catch(error){fs.writeFileSync(${JSON.stringify(stateFile)},JSON.stringify({id:c.id,error:String(error)}));}},30).unref();`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(electron,[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const page=async suffix=>{const result=await until(()=>connect(port,target=>target.url.includes(suffix)));sockets.push(result.ws);await until(()=>result.evaluate('Boolean(window.suira)'));await result.send('Runtime.enable');result.ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});return result;};
 let id=0;const rpc=async values=>{const key=++id;fs.writeFileSync(control,JSON.stringify({id:key,...values}));return until(()=>{if(!fs.existsSync(stateFile))return;const state=JSON.parse(fs.readFileSync(stateFile));if(state.id!==key)return;if(state.error)throw Error(state.error);return state;});};

 const main=await page('/index.html');
 const move=async(client,x,y)=>client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
 // CDP 合成的 mouseMoved 偶尔会被合并/丢失；重新派发到状态生效，别误判成功能回归。
 const moveAndWait=async(client,x,y,expr,label)=>{
  for(let attempt=0;attempt<6;attempt++){
   await move(client,x,y);await wait(70);
   try{if(await client.evaluate(expr))return;}catch{}
  }
  throw Error('Pointer move did not take effect: '+label);
 };
 // 数据广播会重建列表 DOM：坐标取到与实际命中之间可能刚好被刷新。
 // 重新量一次再试，别把正常的界面刷新误判成功能回归。
 const click=async(client,selector)=>{
  for(let attempt=0;attempt<4;attempt++){
   const box=await client.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing "+'+JSON.stringify(selector)+');e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
   await move(client,box.x,box.y);await wait(150);
   const hit=await client.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return Boolean(e&&e.contains(document.elementFromPoint('+box.x+','+box.y+')));})()');
   if(hit){await client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});return;}
   await wait(150);
  }
  assert.fail('Hit target '+selector);
 };
 const text='  First line\n\nSecond line  ',a=await main.evaluate('window.suira.content.addText('+JSON.stringify({text,title:'按钮验收 A',source:'clipboard'})+')'),b=await main.evaluate('window.suira.content.addText({text:"Second task item",title:"按钮验收 B",source:"clipboard"})'),task=await main.evaluate('window.suira.tasks.create("任务按钮验收")');
 for(const item of [a.item,b.item])assert.equal((await main.evaluate('window.suira.tasks.addItem('+JSON.stringify({taskId:task.task.id,itemId:item.id})+')')).ok,true);
 await main.evaluate('window.suira.quick.showMain("shelf")');await until(()=>main.evaluate('document.querySelectorAll("#task-items [data-copy]").length===2'));
 await click(main,'#task-items [data-preview-item="'+a.item.id+'"]');await until(()=>main.evaluate('!document.getElementById("preview").hidden'));assert.equal(await main.evaluate('document.querySelector("#preview-body .preview-text").textContent'),'First line\nSecond line');await click(main,'#preview-close');
 await click(main,'#task-items [data-copy="'+b.item.id+'"]');await until(async()=>(await rpc()).copied==='Second task item');
 await click(main,'#task-items [data-recipe-item="'+a.item.id+'"]');await until(()=>main.evaluate('document.querySelectorAll("#task-items .derived-card").length>0'));await until(()=>main.evaluate('!document.querySelector("#task-items [data-recipe-item]").disabled'));await wait(300);
 console.log('Task preview, copy and recipe passed');const derived=await main.evaluate('document.querySelector("#task-items .derived-card [data-copy]").dataset.copy');await click(main,'#task-items .derived-card [data-preview-item]');await until(()=>main.evaluate('!document.getElementById("preview").hidden'));const derivedText=await main.evaluate('document.querySelector("#preview-body .preview-text").textContent');assert.ok(derivedText.trim());await click(main,'#preview-close');await click(main,'#task-items .derived-card [data-copy]');console.log('Derived preview',derivedText);const derivedOriginal=(await main.evaluate('window.suira.content.list({limit:100})')).find(item=>item.id===derived).text;await until(async()=>(await rpc()).copied===derivedOriginal);
 await click(main,'#task-items [data-remove="'+b.item.id+'"]');await until(()=>main.evaluate('!document.querySelector('+JSON.stringify('#task-items [data-remove="'+b.item.id+'"]')+')'));assert.ok((await main.evaluate('window.suira.content.list({limit:100})')).some(item=>item.id===b.item.id),'Removing membership retains original content');
 const shots=process.argv.includes('--shots'),shot=async(client,name)=>{if(shots){await wait(200);const result=await client.send('Page.captureScreenshot',{format:'png',fromSurface:name==='color-preview'?false:true});if(name==='color-preview'){const png=require('pngjs').PNG.sync.read(Buffer.from(result.data,'base64'));let crosshair=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]<70&&png.data[i+1]>130&&png.data[i+2]<130&&png.data[i+1]>png.data[i]+70&&png.data[i+1]>png.data[i+2]+50)crosshair++;assert.ok(crosshair>30,'Rendered screenshot contains green WeChat-style crosshair');}fs.writeFileSync(path.join(root,'docs/product','fixes-'+version+'-'+name+'.png'),Buffer.from(result.data,'base64'));}};
 await shot(main,'task-buttons');await main.evaluate('window.suira.quick.showMain("library")');
 for(const width of [1160,800]){await main.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await wait(100);const box=await main.evaluate('(()=>{const e=document.getElementById("library-capture"),r=e.getBoundingClientRect(),s=e.querySelector("svg").getBoundingClientRect();return {width:r.width,height:r.height,icon:s.width,line:e.querySelector("span").getBoundingClientRect().height,right:r.right};})()');assert.ok(box.width>=66&&box.width<110&&box.height===36&&box.icon===16&&box.line<25&&box.right<=width,JSON.stringify(box));}
 await click(main,'#library-capture');await until(async()=>(await rpc()).captures.length===1);await main.send('Emulation.clearDeviceMetricsOverride');await shot(main,'library-button');
 await main.evaluate('window.suira.content.addText({text:"Latest copied text",source:"clipboard"})');await rpc({show:true});const panel=await page('/quickpanel.html');await until(()=>panel.evaluate('!document.getElementById("recent-context-trigger").hidden'));assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),false);
 await panel.evaluate('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>true)');
 const keyBox=()=>panel.evaluate('(()=>{const r=document.getElementById("key-grid").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');const before=await keyBox();
 await click(panel,'#recent-context-trigger');assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),true);assert.deepEqual(await keyBox(),before,'Popover never displaces keyboard');assert.ok(await panel.evaluate('(()=>{const r=document.getElementById("recent-context").getBoundingClientRect();return r.width<=380&&r.right<=innerWidth&&r.bottom<=innerHeight;})()'));await shot(panel,'recent-open');
 await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),false);await shot(panel,'recent-collapsed');
 await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'k',code:'KeyK',modifiers:2});await until(()=>panel.evaluate('document.querySelector("#recent-context .action-strip-menu").matches(":popover-open")'));await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),true,'First Escape closes action list only');await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),false);
 await click(panel,'#recent-context-trigger');await click(panel,'#mode-actions');assert.equal(await panel.evaluate('document.getElementById("recent-context").matches(":popover-open")'),false,'Outside click dismisses');await main.evaluate('window.suira.settings.update({panelRecent:false})');await until(()=>panel.evaluate('document.getElementById("recent-context-trigger").hidden'));await wait(100);assert.deepEqual(await keyBox(),before,'No recent entry has same keyboard geometry');
 const {PNG}=require('pngjs'),image=new PNG({width:800,height:600});for(let y=0;y<600;y++)for(let x=0;x<800;x++){const i=(y*800+x)*4;image.data[i]=x%256;image.data[i+1]=y%256;image.data[i+2]=0x56;image.data[i+3]=255;}
 const dataUrl='data:image/png;base64,'+PNG.sync.write(image).toString('base64'),payload={dataUrl,size:{width:800,height:600},bounds:{x:0,y:0,width:800,height:600},scaleFactor:1,intent:''};await rpc({overlay:payload});const overlay=await page('/overlay.html');await until(()=>overlay.evaluate('Boolean(state.image)'));
 await overlay.send('Emulation.setDeviceMetricsOverride',{width:1000,height:750,deviceScaleFactor:1,mobile:false});await wait(100);await moveAndWait(overlay,300,250,'!document.getElementById("magnifier").hidden','magnifier after first move');const sample=await overlay.evaluate('({coords:document.getElementById("magnifier-coords").textContent,hex:document.getElementById("magnifier-color").textContent,rgb:document.getElementById("magnifier-rgb").textContent,parent:document.getElementById("magnifier").parentElement.id,selectionHidden:document.getElementById("selection").hidden})');assert.deepEqual(sample,{coords:'240, 200',hex:'#F0C856',rgb:'240, 200, 86',parent:'capture-root',selectionHidden:true});
 const style=await overlay.evaluate('(()=>{const c=document.getElementById("magnifier-canvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let green=0;for(let i=0;i<d.length;i+=4)if(d[i]<70&&d[i+1]>130&&d[i+2]<130&&d[i+1]>d[i]+70&&d[i+1]>d[i+2]+50)green++;return {green,hint:document.getElementById("magnifier-hint").textContent,readouts:document.querySelectorAll("#magnifier .magnifier-readout").length,crosshair:getComputedStyle(document.documentElement).getPropertyValue("--magnifier-crosshair").trim()};})()');assert.ok(style.green>150,'WeChat-style green crosshair is drawn on the magnifier canvas');assert.equal(style.hint,'按 Ctrl+C 复制色值');assert.equal(style.readouts,2,'WeChat-style readout has exactly coordinates and color rows');assert.equal(style.crosshair,'#00b050');
 await shot(overlay,'color-preview');await moveAndWait(overlay,999,749,'document.getElementById("magnifier-coords").textContent==="799, 599"','corner coords');assert.equal(await overlay.evaluate('document.getElementById("magnifier-color").textContent'),'#1F5756');assert.ok(await overlay.evaluate('(()=>{const r=document.getElementById("magnifier").getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.x>=0&&r.y>=0;})()'),'Magnifier fits at screen edge');
 await overlay.send('Input.dispatchKeyEvent',{type:'keyDown',key:'C',code:'KeyC',modifiers:8});await until(async()=>(await rpc()).copied==='#1F5756');assert.ok(await overlay.evaluate('Boolean(state.image)'),'Color copy keeps capture open');
 await moveAndWait(overlay,120,90,'document.getElementById("magnifier-coords").textContent==="96, 72"','second coords');await overlay.send('Input.dispatchKeyEvent',{type:'keyDown',key:'c',code:'KeyC',modifiers:2});await until(async()=>(await rpc()).copied==='#604856');assert.ok(await overlay.evaluate('Boolean(state.image)'),'Ctrl+C copies the sampled color without completing the capture');
 await move(overlay,100,120);await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:100,y:120});await move(overlay,500,400);await wait(80);assert.equal(await overlay.evaluate('document.getElementById("magnifier").hidden'),false);await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:500,y:400});
 await moveAndWait(overlay,580,220,'!document.getElementById("magnifier").hidden','magnifier after selection');const toolBox=await overlay.evaluate('(()=>{const r=document.querySelector("#tool-dock button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');await moveAndWait(overlay,toolBox.x,toolBox.y,'document.getElementById("magnifier").hidden','magnifier over toolbar');
 // 0.2.40 回归：标注拖拽期间 pointermove 被整段丢掉，画笔一笔都画不出来。
 // 这里用真实鼠标事件验证中间帧点和松开点都进入线条。
 let penReady=false;
 for(let attempt=0;attempt<3&&!penReady;attempt++){
  await overlay.evaluate('setTool("pen");true');await move(overlay,180,280);await move(overlay,200,300);
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:200,y:300});
  await move(overlay,240,330);await move(overlay,280,360);await move(overlay,320,390);await wait(80);
  await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:330,y:400});
  await wait(120);penReady=await overlay.evaluate('state.annotations.some(a=>a.type==="pen")');
 }
 if(!penReady){
  const diag=await overlay.evaluate('({mode:state.mode,drawing:state.drawing&&state.drawing.type,annotations:state.annotations.length,tool:state.tool,selection:Boolean(state.selection),ready:state.selectionReady})');
  throw Error('Pen drag produced no annotation: '+JSON.stringify(diag)+' rendererErrors='+JSON.stringify(errors.slice(-3)));
 }
 const pen=await overlay.evaluate('(()=>{const a=state.annotations.find(a=>a.type==="pen");const last=a.points[a.points.length-1];return {count:a.points.length,x:last.x,y:last.y};})()');
 assert.ok(pen.count>=3,'Pen drag keeps intermediate pointermove points: '+JSON.stringify(pen));
 assert.ok(Math.abs(pen.x-330)<2&&Math.abs(pen.y-400)<2,'Pen includes the pointerup point: '+JSON.stringify(pen));
 // 查看原图是全屏浮层，在上面按下不能静默清空选区和标注。
 await overlay.evaluate('document.getElementById("original-viewer").hidden=false;true');
 await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:450,y:300});
 await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:450,y:300});
 const kept=await overlay.evaluate('({selection:Boolean(state.selection),annotations:state.annotations.length})');
 assert.ok(kept.selection&&kept.annotations>0,'Original viewer must not reset selection or annotations: '+JSON.stringify(kept));
 await overlay.evaluate('document.getElementById("original-viewer").hidden=true;true');
 // 放大镜隐藏后，Shift+C 不能拿旧采样点静默复制颜色。
 const copiedBefore=(await rpc()).copied;await move(overlay,toolBox.x,toolBox.y);
 await until(()=>overlay.evaluate('document.getElementById("magnifier").hidden'));
 await overlay.send('Input.dispatchKeyEvent',{type:'keyDown',key:'C',code:'KeyC',modifiers:8});await wait(150);
 assert.equal((await rpc()).copied,copiedBefore,'Shift+C must not copy a stale sample while the magnifier is hidden');
 const reviewDir=process.env.SUIRA_REVIEW_SHOTS;
 if(reviewDir){
  await move(overlay,toolBox.x,toolBox.y);
  const frame=await overlay.send('Page.captureScreenshot',{format:'png',fromSurface:false});
  fs.writeFileSync(path.join(reviewDir,'capture-reselect.png'),Buffer.from(frame.data,'base64'));
 }
 await click(overlay,'[data-action="reselect"]');
 const cleared='Boolean(state.image && !state.selection && !state.annotations.length && toolDock.hidden)';
 await until(()=>overlay.evaluate(cleared));
 await move(overlay,100,120);
 await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:100,y:120});
 await move(overlay,500,400);
 await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:500,y:400});
 await until(()=>overlay.evaluate('Boolean(state.selection && !toolDock.hidden)'));
 await overlay.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Delete',code:'Delete',windowsVirtualKeyCode:46});
 await until(()=>overlay.evaluate(cleared));
 console.log('PASS 清除选区按钮与 Delete 均保留截图会话，可以直接重画');
 await overlay.evaluate('resetOverlay();true');assert.equal(await overlay.evaluate('document.getElementById("magnifier").hidden'),true);assert.deepEqual(errors,[]);
 const proof={version,isolatedFixture:true,actualPointerHitTests:true,idleMagnifier:true,sourcePixelAndDpiMapping:true,sourceEdgeClamped:true,crosshairAndHexRgb:true,greenWeChatCrosshair:true,weChatTwoRowReadout:true,ctrlCHint:true,renderedCrosshairPixels:true,shiftCCopiesAndKeepsCapture:true,ctrlCCopiesColorAndKeepsCapture:true,penDragKeepsPoints:true,pointerUpPointIncluded:true,originalViewerProtectsSelection:true,staleShiftCIgnored:true,dynamicMagnifierBounds:true,toolbarHidesPreview:true,resetHidesPreview:true,allTaskButtons:true,multipleItemsAndDerivedButtons:true,removedItemRetained:true,compactCaptureButton:true,collapsedRecentEntry:true,recentDoesNotDisplaceKeyboard:true,popoverDismissal:true,ctrlKAndNestedEscape:true,noRendererErrors:true};if(!reviewDir)fs.writeFileSync(path.join(root,'docs','ui-fixes-'+version+'.json'),JSON.stringify(proof,null,2)+'\n');console.log('PASS four UI fixes',JSON.stringify(proof));
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1600));process.exitCode=1;}).finally(async()=>{sockets.forEach(socket=>socket.close());if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}await wait(250);assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});});
