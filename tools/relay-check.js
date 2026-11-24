'use strict';
// Real application IPC and renderers with a fictional desktop, OCR and translator.
// No user clipboard, wallpaper, document or foreground application is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store'),{createWorkspace}=require('../lib/workspace');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-relay-')),sockets=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function until(fn){let last;for(let i=0;i<180;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(50);}throw last||Error('Relay state timed out');}
(async()=>{
 const profile=path.join(tmp,'profile'),store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});store.createNote({text:'原笔记'});const english=store.addItem({kind:'text',text:'Hello relay',title:'English sample'});const sourceImage=store.addItem({kind:'image',filePath:path.join(tmp,'fixture.png'),title:'测试图片',meta:{width:800,height:600}});await store.save();
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const entry=path.join(tmp,'app.js'),copied=path.join(tmp,'copied.txt');
 const saveChoice=path.join(tmp,'save-image-choice.txt'), savedImage=path.join(tmp,'saved-image.png');
 const closeProof=path.join(tmp,'close-calendar.json');
 const hooks=`\nrunTranslation=async text=>{if(text==='SLOW')await new Promise(done=>setTimeout(done,350));return {ok:true,text:'译文：'+text,from:'en',to:'zh',provider:'fixture'};};beginScreenCapture=async(source,options={})=>{createOverlayWindow();capturePayload={dataUrl:fixtureImage.toDataURL(),bounds:{x:0,y:0,width:800,height:600},size:{width:800,height:600},scaleFactor:1,displayId:1,displays:[{id:1,bounds:{x:0,y:0,width:800,height:600},scaleFactor:1}],intent:options.intent||'copy',source};await showOverlayWindow(capturePayload);return {ok:true};};
 dialog.showMessageBox=async(_win,options)=>{require('node:fs').writeFileSync(${JSON.stringify(closeProof)},JSON.stringify(options));return {response:0};};`;
 fs.writeFileSync(entry,`const fs=require('node:fs'),{app,clipboard,dialog,globalShortcut,nativeImage}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getVersion=()=>${JSON.stringify(version)};clipboard.read=async()=>[];clipboard.readText=async()=>'';clipboard.writeText=async text=>fs.writeFileSync(${JSON.stringify(copied)},text);clipboard.writeImage=async()=>{};dialog.showSaveDialog=async()=>{const filePath=fs.readFileSync(${JSON.stringify(saveChoice)},'utf8');return filePath?{canceled:false,filePath}:{canceled:true};};globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};const fixtureImage=nativeImage.createFromBitmap(Buffer.alloc(800*600*4,255),{width:800,height:600});fs.writeFileSync(${JSON.stringify(path.join(tmp,'fixture.png'))},fixtureImage.toPNG());require(${JSON.stringify(path.join(root,'lib/ocr'))}).OcrService.prototype.recognizeFile=async()=>({text:'明天下午3点开会',confidence:99,blocks:[],engine:'fixture'});const Module=require('node:module'),filename=${JSON.stringify(path.join(root,'main.js'))},m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(${JSON.stringify(root)});m._compile('const fixtureImage=require("electron").nativeImage.createFromBitmap(Buffer.alloc(800*600*4,255),{width:800,height:600});\\n'+fs.readFileSync(filename,'utf8')+${JSON.stringify(hooks)},filename);`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:/suira-electron/electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 async function page(suffix,ready='Boolean(window.suira)'){const p=await until(()=>connect(port,t=>t.url.includes(suffix)));sockets.push(p.ws);await until(()=>p.evaluate(ready));return p;}
 const shot=async(client,name)=>{if(!process.argv.includes('--shots'))return;await wait(180);const png=await client.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'docs/product',`relay-${version}-${name}.png`),Buffer.from(png.data,'base64'));};
 const main=await page('/index.html');const run=(text,action)=>main.evaluate(`window.suira.actions.run(${JSON.stringify({kind:'text',text})},${JSON.stringify(action)})`);
 console.log('CHECK '+"today");
 let result=await run('今天的第一段','text.to-markdown');assert.ok(result.ok,JSON.stringify(result));let docs=await main.evaluate('window.suira.workspace.list("markdown")');assert.equal(docs.length,1);assert.ok(docs[0].title.startsWith('今天 · '));
 await run('今天的第二段','text.to-markdown');assert.equal((await main.evaluate('window.suira.workspace.list("markdown")')).length,1);
 console.log('CHECK '+"markdown");
 await main.evaluate('window.suira.workspace.open("markdown")');const md=await page('tool=markdown','Boolean(window.WorkspaceUI && !document.getElementById("md-body").hidden && document.getElementById("md-editor").value)');
 await md.evaluate('document.querySelector("[data-md-view=edit]").click();var relayArea37=document.getElementById("md-editor");relayArea37.value+="\\n刚输入尚未保存";relayArea37.dispatchEvent(new Event("input"));true');
 result=await run('接力追加','text.to-markdown');assert.ok(result.ok,JSON.stringify(result));await until(()=>md.evaluate('document.getElementById("md-editor").value.includes("刚输入尚未保存\\n\\n接力追加")'));
 console.log('CHECK '+"note");
 await main.evaluate('window.suira.notes.openLatest()');const note=await page('/notes.html','document.getElementById("note").dataset.state==="ready"');
 await note.evaluate('document.querySelector("#note-body .tiptap").focus();document.execCommand("selectAll");document.execCommand("insertText",false,"速记里尚未保存的文字");true');
 await note.evaluate('document.querySelector("[data-format=large]").click()');
 result=await run('从结果接过来','text.to-note');assert.ok(result.ok,JSON.stringify(result));assert.equal((await main.evaluate('window.suira.notes.list()'))[0].text,'速记里尚未保存的文字\n\n从结果接过来');
 await until(()=>note.evaluate('Boolean(document.querySelector("#note-body h1")) && window.NoteUI.text().includes("从结果接过来")'));
 await note.evaluate('document.querySelector("#note-body .tiptap").focus();document.execCommand("selectAll");document.execCommand("insertText",false,"明天下午3点开会");true');await until(()=>note.evaluate('!document.getElementById("note-date-hint").hidden'));
 console.log('CHECK '+"calendar");
 const calendarCount=(await main.evaluate('window.suira.workspace.list("calendar")')).length;await note.evaluate('document.getElementById("note-date-hint").click();true');const calendar=await page('tool=calendar','Boolean(window.WorkspaceUI)');await until(()=>calendar.evaluate('document.getElementById("event-form").dataset.draft==="true"')).catch(async error=>{console.error('DRAFT_STATE',await calendar.evaluate('({form:document.getElementById("event-form").outerHTML,toast:document.getElementById("global-toast").textContent})'));throw error;});
 await until(()=>calendar.evaluate('(()=>{const r=document.getElementById("event-title").getBoundingClientRect();return r.top>0&&r.bottom<innerHeight;})()'));await shot(calendar,'calendar-draft');assert.equal(await calendar.evaluate('document.getElementById("event-time").value'),'15:00');assert.equal((await main.evaluate('window.suira.workspace.list("calendar")')).length,calendarCount);await calendar.evaluate('document.getElementById("event-cancel").click();true');assert.equal((await main.evaluate('window.suira.workspace.list("calendar")')).length,calendarCount);
 result=await run('11月8日 14:30 评审','text.to-calendar');assert.ok(result.ok,JSON.stringify(result));await until(()=>calendar.evaluate('document.getElementById("event-time").value==="14:30"'));await calendar.evaluate('document.querySelector("#event-form button[type=submit]").click();true');await until(async()=>(await main.evaluate('window.suira.workspace.list("calendar")')).length===calendarCount+1);
 await until(()=>calendar.evaluate('document.getElementById("event-form").hidden'));
 await calendar.evaluate('document.getElementById("calendar-new").click();document.getElementById("event-title").value="正在编辑 A";document.getElementById("calendar-next").click();document.querySelector(".calendar-day:not(.outside)").click();document.getElementById("event-title").focus();true');
 for(const text of ['11月10日 10:30 接力 B','11月11日 11:30 接力 C'])assert.ok((await run(text,'text.to-calendar')).ok);
 await until(()=>calendar.evaluate('document.querySelector(".calendar-draft-notice:not([hidden])").textContent.includes("2 条")'));
 assert.equal(await calendar.evaluate('document.activeElement.id'), 'event-title');
 assert.equal(await calendar.evaluate('document.getElementById("event-title").value'),'正在编辑 A');
 assert.equal(await calendar.evaluate('window.WorkspaceUI.calendarBlocksUpdate()'),true);
 await calendar.evaluate('document.getElementById("close").click();true');
 await until(()=>fs.existsSync(closeProof));
 const closeOptions=JSON.parse(fs.readFileSync(closeProof,'utf8'));
 assert.match(closeOptions.message,/3 条日程未保存/);
 assert.equal(closeOptions.buttons[closeOptions.defaultId],'继续编辑');
 assert.equal(await calendar.evaluate('document.getElementById("event-title").value'),'正在编辑 A');
 await calendar.evaluate('document.getElementById("event-form").requestSubmit();true');
 await until(()=>calendar.evaluate('document.getElementById("event-title").value.includes("接力 B")'));
 await calendar.evaluate('document.getElementById("event-cancel").click();true');
 await until(()=>calendar.evaluate('document.getElementById("event-title").value.includes("接力 C")'));
 await calendar.evaluate('document.getElementById("event-cancel").click();true');
 assert.equal(await calendar.evaluate('window.WorkspaceUI.calendarBlocksUpdate()'),false);
 console.log('CHECK '+"pin");
 await run('文字钉图 <b>保持原文</b>','text.pin');const pin=await page('/pin.html','Boolean(window.pinApi)&&!document.getElementById("pin-text").hidden');assert.equal(await pin.evaluate('document.getElementById("pin-text").textContent'),'文字钉图 <b>保持原文</b>');assert.equal(await pin.evaluate('document.querySelectorAll("#pin-text b").length'),0);await pin.evaluate('window.pinApi.copy()');assert.equal(fs.readFileSync(copied,'utf8'),'文字钉图 <b>保持原文</b>');await pin.evaluate('document.getElementById("more").click();true');await until(()=>pin.evaluate('document.querySelectorAll("#pin-action-strip button[data-action-id]").length>3'));
 assert.equal(await pin.evaluate('(()=>{const a=document.querySelector("#pin-action-strip .action-strip-direct").getBoundingClientRect(),b=document.getElementById("pin-menu").getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;})()'),true,'Pin menu shows all three next steps immediately');await shot(pin,'text-pin-menu');await note.evaluate('document.getElementById("note-more").click();true');await shot(note,'note-menu');
 // Fresh screenshot text returns to the saved source cursor; cancel keeps it intact.
 async function sourceCapture(command){await md.evaluate('window.suira.workspace.open("markdown")');await md.evaluate('document.querySelector("[data-md-view=edit]").click();var relayArea37=document.getElementById("md-editor");relayArea37.value="前文\\n\\n后文";relayArea37.focus();relayArea37.setSelectionRange(3,3);relayArea37.dispatchEvent(new Event("input"));true');await md.send('Input.insertText',{text:'/'});await until(()=>md.evaluate('Boolean(document.querySelector(".md-context-menu [data-command=capture]"))'));await md.evaluate(`document.querySelector('.md-context-menu [data-command=${command}]').click();true`);const overlay=await page('/overlay.html');await until(()=>overlay.evaluate('document.visibilityState==="visible"&&document.getElementById("loading-state").hidden'));return overlay;}
 console.log('CHECK '+"source capture");
 let overlay=await sourceCapture('capture-text');await overlay.evaluate('state.selection={x:30,y:30,w:500,h:150};state.selectionReady=true;autoAdvanceForIntent();true');await until(()=>md.evaluate('document.getElementById("md-editor").value.includes("明天下午3点开会")'));await until(()=>md.evaluate('document.getElementById("md-editor").value.includes("前文\\n明天下午3点开会\\n后文")'));
 overlay=await sourceCapture('capture');await overlay.evaluate('state.selection={x:30,y:30,w:500,h:150};state.selectionReady=true;autoAdvanceForIntent();true');await until(()=>md.evaluate('document.getElementById("md-editor").value.includes("![截图](suira-image://")'));await until(()=>md.evaluate('Boolean(document.querySelector("#md-preview a[href^=\\"suira-image://\\"]"))'));
 overlay=await sourceCapture('capture-text');const before=await md.evaluate('document.getElementById("md-editor").value');await overlay.evaluate('document.querySelector("[data-action=cancel]").click();true');await until(()=>md.evaluate('document.visibilityState==="visible"'));assert.equal(await md.evaluate('document.getElementById("md-editor").value'),before);
 // Visual slash capture retains content on both sides of a selection.
 console.log('CHECK '+"visual capture");
 await md.evaluate('document.querySelector("[data-md-view=write]").click();true');await until(()=>md.evaluate('Boolean(window.WorkspaceUI?.documentEditor)'));await md.evaluate('WorkspaceUI.documentEditor.focus();WorkspaceUI.documentEditor.setSelection(2);true');await md.evaluate('WorkspaceUI.documentEditor.apply("capture-text");true');await until(()=>overlay.evaluate('document.visibilityState==="visible"&&document.getElementById("loading-state").hidden'));await overlay.evaluate('state.selection={x:30,y:30,w:500,h:150};state.selectionReady=true;autoAdvanceForIntent();true');await until(()=>md.evaluate('WorkspaceUI.documentEditor.getMarkdown().includes("明天下午3点开会")'));
 // OCR result, translation result and clipboard use the same component.
 console.log('CHECK '+"OCR relay");
 await main.evaluate('window.suira.panel.run("ocr")');await until(()=>overlay.evaluate('document.visibilityState==="visible"&&document.getElementById("loading-state").hidden'));await overlay.evaluate('state.selection={x:30,y:30,w:500,h:150};state.selectionReady=true;autoAdvanceForIntent();true');await until(()=>overlay.evaluate('document.getElementById("ocr-result-text").value==="明天下午3点开会"&&document.querySelectorAll("#ocr-action-strip button[data-action-id]").length>3')); await overlay.evaluate('[...document.querySelectorAll("#ocr-action-strip [data-action-id]")].find(button=>button.dataset.actionId==="output.copy").click();true');await until(()=>fs.existsSync(copied)&&fs.readFileSync(copied,'utf8')==='明天下午3点开会');await shot(overlay,'ocr-result');await overlay.evaluate('document.querySelector("[data-action=cancel]").click();true');
 console.log('CHECK '+"text relay");
 await main.evaluate('window.suira.textTools.open({mode:"convert",text:"Hello relay"})');const tool=await page('/text-tools.html');await until(()=>tool.evaluate('document.querySelectorAll("#tool-action-strip .action-strip-direct button").length===3'));
 await tool.evaluate('document.getElementById("tool-result").focus();true');await tool.send('Input.dispatchKeyEvent',{type:'keyDown',key:'k',code:'KeyK',modifiers:2});await tool.send('Input.dispatchKeyEvent',{type:'keyUp',key:'k',code:'KeyK',modifiers:2});await until(()=>tool.evaluate('document.querySelector("#tool-action-strip details").open'));await until(()=>tool.evaluate('document.querySelector("#tool-action-strip .action-strip-menu").matches(":popover-open")'));
 await shot(tool,'full-action-list');await tool.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await tool.evaluate('document.getElementById("tool-result").blur();true');await tool.send('Input.dispatchKeyEvent',{type:'keyDown',key:'1',code:'Digit1'});await until(()=>tool.evaluate('document.getElementById("tool-result").value.startsWith("译文：")'));
 console.log('CHECK '+"clipboard");
 assert.equal((await main.evaluate('window.suira.clipboardBar.show()')).visible, true);
 const bar=await page('/clipboardbar.html');
 const openEnglishActions = async () => {
   await bar.evaluate(`document.querySelector('[data-id="${english.id}"] [data-card-action=more]').click();true`);
   await until(()=>bar.evaluate(`document.querySelector('[data-id="${english.id}"] #bar-action-strip [popover]')?.matches(':popover-open') && document.querySelector('#bar-action-strip [popover] button')?.dataset.actionId==='text.translate'`));
 };
 await openEnglishActions();
 // Open the floating actions directly on a card other than the current selection.
 await bar.evaluate(`document.querySelector('[data-id="${sourceImage.id}"] [data-card-action=more]').click();true`);
 await until(()=>bar.evaluate(`document.querySelector('[data-id="${sourceImage.id}"] #bar-action-strip [popover]')?.matches(':popover-open') && document.querySelector('#bar-action-strip [popover] button')?.dataset.actionId==='ocr.local'`));
 await bar.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await until(()=>bar.evaluate(`!document.querySelector('#bar-action-strip [popover]').matches(':popover-open')`));
 const save = () => bar.evaluate(`window.suira.clipboardBar.saveImage(${JSON.stringify(sourceImage.id)})`);
 fs.writeFileSync(saveChoice,'');
 assert.equal((await save()).canceled,true);
 const original=fs.readFileSync(path.join(tmp,'fixture.png'));
 fs.writeFileSync(saveChoice,path.join(tmp,'fixture.png'));
 assert.equal((await save()).ok,false);
 assert.deepEqual(fs.readFileSync(path.join(tmp,'fixture.png')),original);
 fs.writeFileSync(saveChoice,savedImage);
 assert.equal((await main.evaluate(`window.suira.clipboardBar.saveImage(${JSON.stringify(sourceImage.id)})`)).ok,false);
 await bar.evaluate(`document.querySelector('[data-id="${sourceImage.id}"] [data-card-action=save]').click();true`);
 await until(()=>bar.evaluate(`document.getElementById('bar-notice').textContent==='图片已保存'`));
 assert.deepEqual(fs.readFileSync(savedImage),original);
 console.log('PASS 卡片更多操作、另存取消、原图保护及字节一致的图片导出');
 if (process.argv.includes('--clipboard-shots')) {
   const samples = [
     {text:'周五 14:30 评审新版。会前整理录音、截图和所有需要确认的细节。'},
     {text:'https://example.com/studio/design-review?view=notes'},
     {text:'从一段文字、一张截图，到一份可以继续编辑的文档。'}
   ];
   for (const sample of samples) await main.evaluate(`window.suira.content.addText(${JSON.stringify(sample)})`);
   const captureClipboard = async (theme, filename) => {
     await bar.evaluate(`window.suira.settings.update(${JSON.stringify({theme})})`);
     await until(()=>bar.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches===${theme==='dark'}`));
     await bar.send('Emulation.setDeviceMetricsOverride',{width:1460,height:310,deviceScaleFactor:1.25,mobile:false});
     await wait(250);
     const appearance = await bar.evaluate(`(()=>{
       const track = document.getElementById('bar-track');
       const card = track.querySelector('.bar-card[data-kind=link]');
       card.querySelector('.card-select').click();
       track.scrollTo({left:0,behavior:'instant'});
       const x=card.getBoundingClientRect(), region=track.getBoundingClientRect();
       const chrome=getComputedStyle(document.querySelector('.bar-head'));
       return {selected:card.classList.contains('is-selected') && x.left>=region.left && x.right<=region.right,background:chrome.backgroundColor,filter:chrome.backdropFilter};
     })()`);
     assert.ok(appearance.selected, 'The selected link must appear in the captured viewport');
     assert.equal(appearance.background, 'rgba(0, 0, 0, 0)', 'The header must use the window glass');
     assert.equal(appearance.filter, 'none');
     await wait(150);
     const png=await bar.send('Page.captureScreenshot',{format:'png',omitBackground:true});
     fs.writeFileSync(path.join(root,'docs','product',filename),Buffer.from(png.data,'base64'));
   };
   await until(()=>bar.evaluate(`Boolean(document.querySelector('.bar-card[data-kind=link]'))`));
   await captureClipboard('light','clipboard.png');
   await captureClipboard('dark','clipboard-dark.png');
   await bar.send('Emulation.clearDeviceMetricsOverride');
   await bar.evaluate('window.suira.settings.update({theme:"light"})');
 }
 console.log('CHECK '+"late result");
 await tool.evaluate('document.getElementById("tool-result").value="SLOW";document.getElementById("tool-result").dispatchEvent(new Event("input"));true');await wait(160);await tool.evaluate('document.getElementById("tool-result").blur();true');await tool.send('Input.dispatchKeyEvent',{type:'keyDown',key:'1',code:'Digit1'});await wait(50);await tool.evaluate('document.getElementById("tool-result").value="新的结果";document.getElementById("tool-result").dispatchEvent(new Event("input"));true');await wait(450);assert.equal(await tool.evaluate('document.getElementById("tool-result").value'),'新的结果','A late relay result never replaces a newer edit');
 await shot(tool,'text-result');await shot(bar,'clipboard-image');
 console.log('CHECK '+"nested result");
 await main.evaluate('window.suira.clipboardBar.show()');
 await until(()=>bar.evaluate(`document.visibilityState==='visible' && Boolean(document.querySelector('[data-id="${english.id}"]'))`));
 await openEnglishActions();
 await bar.evaluate('document.querySelector("#bar-action-strip [popover] button").click();true');await until(()=>bar.evaluate('Boolean(document.querySelector("#relay-result[open] textarea"))'));await bar.evaluate('document.querySelector("#relay-result textarea").focus();true');await bar.send('Input.dispatchKeyEvent',{type:'keyDown',key:'k',code:'KeyK',modifiers:2});await until(()=>bar.evaluate('document.querySelector("#relay-result details").open'));assert.equal(await bar.evaluate('document.querySelector("#bar-action-strip details").open'),false,'Shortcuts belong to the visible result');await bar.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await bar.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await wait(80);if(await bar.evaluate('Boolean(document.querySelector("#relay-result[open]"))')){await bar.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await bar.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});}await until(()=>bar.evaluate('!document.querySelector("#relay-result[open]")')).catch(async error=>{console.error('EXIT_STATE',await bar.evaluate('({visible:document.visibilityState,dialog:document.getElementById("relay-result")?.outerHTML.slice(0,500),details:document.querySelector("#relay-result details")?.open,focus:document.activeElement?.outerHTML.slice(0,300)})'));throw error;});
 const attachments=(await main.evaluate('window.suira.content.list({limit:200})')).filter(item=>item.meta?.documentAttachment);assert.ok(attachments.length>0&&attachments.every(item=>item.pinned),'Inserted image attachments survive retention cleanup');
 const proof={version,lateRelayResultProtected:true,documentImageRetained:true,fixtureDesktop:true,fixtureOcrAndTranslator:true,todayDocumentReused:true,currentDocumentPreservesUnsavedText:true,recentNotePreservesUnsavedText:true,calendarDraftNeedsConfirmation:true,calendarCancelWritesNothing:true,calendarExplicitSave:true,textPinLiteralAndCopy:true,pinMenuRelay:true,sourceCursorTextCapture:true,sourceCursorImageCapture:true,captureImageReferenceReadable:true,captureCancelPreservesSource:true,visualCursorTextCapture:true,ocrResultRelay:true,translationRelay:true,ctrlKFullList:true,numberShortcut:true,englishClipboardTranslation:true,imageClipboardOcr:true};if (process.argv.includes('--shots')) fs.writeFileSync(path.join(root,'docs',`relay-${version}.json`),JSON.stringify(proof,null,2)+'\n');console.log('PASS relay workflows',JSON.stringify(proof));
})().catch(e=>{console.error(e);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1500));process.exitCode=1;}).finally(async()=>{sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await wait(300);fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:150});});
