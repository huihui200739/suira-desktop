'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const {SuiraStore}=require('../lib/store'),{KEY_ROWS}=require('../lib/keybindings'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),appDir=path.join(tmp,'app'),profile=path.join(tmp,'profile');
const version=require('../package.json').version;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),children=[],sockets=[];
async function until(fn){let last;for(let n=0;n<160;n++){try{const value=await fn();if(value)return value;}catch(error){last=error;}await wait(100);}throw last||Error('Packaged Markdown timed out');}
(async()=>{
  try{execFileSync('robocopy.exe',[path.join(root,'dist','win-unpacked'),appDir,'/E','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP'],{stdio:'ignore',windowsHide:true});}catch(e){if(e.status===null||e.status>=8)throw e;}
  const store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,shortcutQuick:'',shortcutCapture:'',shortcutLongCapture:'',shortcutPanelCycle:'',shortcutPinnedToggle:'',shortcutClipboardBar:'',shortcutMomentary:''});await store.setPanelBindings(Object.fromEntries(KEY_ROWS.flat().map(key=>[key,{type:'none'}])));
  const sample = path.join(tmp, 'ocr-fixture.png');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', [
    'Add-Type -AssemblyName System.Drawing',
    '$bitmap = New-Object System.Drawing.Bitmap 620,160',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.Clear([System.Drawing.Color]::White)',
    "$font = New-Object System.Drawing.Font 'Arial',40",
    "$graphics.DrawString('HELLO SUIRA 2026', $font, [System.Drawing.Brushes]::Black, 12, 48)",
    `$bitmap.Save('${sample.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()'
  ].join('; ')], { windowsHide: true, timeout: 20000 });
  const image = store.addItem({ kind: 'image', filePath: sample, title: 'OCR fixture' });
  store.setWindowState({x:20,y:900,width:3000,height:1800,maximized:false});await store.save();
  const env={...process.env,APPDATA:path.join(tmp,'roaming'),LOCALAPPDATA:path.join(tmp,'local')};delete env.ELECTRON_RUN_AS_NODE;fs.mkdirSync(env.APPDATA);fs.mkdirSync(env.LOCALAPPDATA);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const first=path.join(tmp,'中文 packaged.md'),second=path.join(tmp,'第二份 packaged.markdown');fs.writeFileSync(first,'# Packaged first');fs.writeFileSync(second,'# Packaged second');
  const launch=(file,debug=false)=>{const fd=fs.openSync(path.join(tmp,'app.log'),'a');const child=spawn(path.join(appDir,'随序.exe'),[file,'--user-data-dir='+profile,...(debug?['--remote-debugging-port='+port]:[])],{cwd:tmp,env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(child);fs.closeSync(fd);return child;};
  launch(first,true);const md=await until(()=>connect(port,t=>t.url.includes('tool=markdown')));sockets.push(md.ws);
  await until(()=>md.evaluate(`document.getElementById('md-editor').value==='# Packaged first'`));
  assert.equal((await md.evaluate('window.suira.app.info()')).code,'IPC_FORBIDDEN');
  const workbench=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(workbench.ws);
  assert.equal((await workbench.evaluate('window.suira.shortcuts.get()')).globalEnabled,false);
  assert.equal((await workbench.evaluate('window.suira.app.info()')).version,version);
  await until(()=>workbench.evaluate('screenY+outerHeight<=screen.availTop+screen.availHeight+2'));
  const stableSize=await workbench.evaluate('({width:outerWidth,height:outerHeight})');
  for(let n=0;n<12;n++){await wait(120);assert.deepEqual(await workbench.evaluate('({width:outerWidth,height:outerHeight})'),stableSize,'Packaged window must not keep growing');}
  console.log('PASS packaged oversize/bottom-edge recovery settles without size growth');
  await md.evaluate(`document.getElementById('md-editor').value='# Packaged saved';document.getElementById('md-editor').dispatchEvent(new Event('input'));window.WorkspaceUI.flush()`);
  const items=await md.evaluate(`window.suira.workspace.list('markdown')`);assert.equal((await md.evaluate(`window.suira.workspace.saveFile(${JSON.stringify(items[0].id)})`)).ok,true);assert.equal(fs.readFileSync(first,'utf8'),'# Packaged saved');
  const next=launch(second);await until(()=>next.exitCode!==null);await until(()=>md.evaluate(`document.getElementById('md-editor').value==='# Packaged second'`));
  console.log('PASS actual packaged '+version+': default global mode off; Unicode/spaced file argv; explicit original save; second-instance file route');
  await workbench.evaluate('window.suira.quick.show()');
  const panel=await until(()=>connect(port,t=>t.url.endsWith('/quickpanel.html')));sockets.push(panel.ws);
  await until(()=>panel.evaluate('document.visibilityState==="visible"&&document.querySelectorAll(".key").length===38'));await wait(200);
  assert.equal((await panel.evaluate(`window.suira.quick.setPresentation('fullscreen')`)).ok,true);
  await until(()=>panel.evaluate('document.getElementById("panel").dataset.presentation==="fullscreen"&&outerWidth>=screen.width&&outerHeight>=screen.height'));
  assert.equal((await panel.evaluate('window.suira.settings.get()')).panelPresentation,'fullscreen');
  await panel.evaluate('window.suira.quick.hide()');await workbench.evaluate('window.suira.quick.show()');
  await until(()=>panel.evaluate('document.visibilityState==="visible"&&document.getElementById("panel").dataset.presentation==="fullscreen"&&outerWidth>=screen.width'));
  console.log('PASS actual packaged display selection persists across hide/reopen');
  await panel.evaluate(`document.getElementById('mode-apps').click();true`);
  assert.equal((await panel.evaluate(`window.suira.search.query('Edge',{scope:'apps'})`)).every(item=>item.kind==='app'),true);
  await panel.send('Page.bringToFront');
  await until(()=>panel.evaluate('document.hasFocus() && document.getElementById("panel").getAnimations().every(animation=>animation.playState!=="running")'));
  const escape={key:'Escape',code:'Escape',windowsVirtualKeyCode:27};
  await panel.send('Input.dispatchKeyEvent',{...escape,type:'keyDown'});
  await panel.send('Input.dispatchKeyEvent',{...escape,type:'keyUp'});
  await until(()=>panel.evaluate('document.getElementById("panel").dataset.presentation==="window"&&outerHeight<=screen.availHeight+1')).catch(async error=>{
    const state=await panel.evaluate('({presentation:document.getElementById("panel").dataset.presentation,height:outerHeight,available:screen.availHeight,query:document.getElementById("search").value,focus:document.activeElement?.id})');
    throw Error(error.message+': '+JSON.stringify(state));
  });
  await panel.evaluate(`document.getElementById('mode-actions').click();document.querySelector('.key[data-key="Q"]').click();document.getElementById('binding-app').click();true`);
  await until(()=>panel.evaluate('document.getElementById("binding-app-status").textContent!=="正在查找本机应用…"'));
  assert.equal(await panel.evaluate('!document.getElementById("binding-apps-view").hidden&&document.getElementById("binding-app-search").getAttribute("placeholder").includes("拼音")'),true);
  console.log('PASS actual packaged launchpad: full-display geometry, Escape returns window, apps-only search and searchable binding picker');
  await panel.evaluate(`document.getElementById('binding-close').click();document.getElementById('panel-more').click();true`);
  assert.equal(await panel.evaluate('document.getElementById("panel-more-menu").hidden'),false);
  await panel.evaluate(`document.querySelector('[data-menu-action="shortcuts"]').click();true`);
  await until(()=>workbench.evaluate('document.querySelector("[data-setting-tab=shortcuts]").classList.contains("is-active")'));
  console.log('PASS actual packaged shared menu opens the shortcut settings section');
  const recognized = await workbench.evaluate(`window.suira.ocr.recognizeItem(${JSON.stringify(image.id)})`);
  assert.equal(recognized.ok, true, JSON.stringify(recognized));
  assert.match(recognized.output.text, /HELLO SUIRA 2026/i);
  console.log('PASS actual packaged offline OCR recognizes the fixture using bundled models');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1800));process.exitCode=1;}).finally(async()=>{
  sockets.forEach(ws=>ws.close());children.forEach(c=>{if(c.exitCode===null)c.kill();});await wait(600);
  const absolute=path.resolve(tmp);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('suira-workspace-'))throw Error('Unsafe cleanup path');
  fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3,retryDelay:250});
});
