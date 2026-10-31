'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process');
const {SuiraStore}=require('../lib/store'),{KEY_ROWS}=require('../lib/keybindings'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),appDir=path.join(tmp,'app'),profile=path.join(tmp,'profile');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),children=[],sockets=[];
async function until(fn){let last;for(let n=0;n<160;n++){try{const value=await fn();if(value)return value;}catch(error){last=error;}await wait(100);}throw last||Error('Packaged Markdown timed out');}
(async()=>{
  try{execFileSync('robocopy.exe',[path.join(root,'dist','win-unpacked'),appDir,'/E','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP'],{stdio:'ignore',windowsHide:true});}catch(e){if(e.status===null||e.status>=8)throw e;}
  const store=new SuiraStore(path.join(profile,'suira-data.json'));await store.updateSettings({recordClipboard:false,shortcutQuick:'',shortcutCapture:'',shortcutLongCapture:'',shortcutPanelCycle:'',shortcutPinnedToggle:'',shortcutClipboardBar:'',shortcutMomentary:''});await store.setPanelBindings(Object.fromEntries(KEY_ROWS.flat().map(key=>[key,{type:'none'}])));
  const env={...process.env,APPDATA:path.join(tmp,'roaming'),LOCALAPPDATA:path.join(tmp,'local')};delete env.ELECTRON_RUN_AS_NODE;fs.mkdirSync(env.APPDATA);fs.mkdirSync(env.LOCALAPPDATA);
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const first=path.join(tmp,'中文 packaged.md'),second=path.join(tmp,'第二份 packaged.markdown');fs.writeFileSync(first,'# Packaged first');fs.writeFileSync(second,'# Packaged second');
  const launch=(file,debug=false)=>{const fd=fs.openSync(path.join(tmp,'app.log'),'a');const child=spawn(path.join(appDir,'随序.exe'),[file,'--user-data-dir='+profile,...(debug?['--remote-debugging-port='+port]:[])],{cwd:tmp,env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(child);fs.closeSync(fd);return child;};
  launch(first,true);const md=await until(()=>connect(port,t=>t.url.includes('tool=markdown')));sockets.push(md.ws);
  await until(()=>md.evaluate(`document.getElementById('md-editor').value==='# Packaged first'`));assert.equal((await md.evaluate('window.suira.shortcuts.get()')).globalEnabled,false);
  await md.evaluate(`document.getElementById('md-editor').value='# Packaged saved';document.getElementById('md-editor').dispatchEvent(new Event('input'));window.WorkspaceUI.flush()`);
  const items=await md.evaluate(`window.suira.workspace.list('markdown')`);assert.equal((await md.evaluate(`window.suira.workspace.saveFile(${JSON.stringify(items[0].id)})`)).ok,true);assert.equal(fs.readFileSync(first,'utf8'),'# Packaged saved');
  const next=launch(second);await until(()=>next.exitCode!==null);await until(()=>md.evaluate(`document.getElementById('md-editor').value==='# Packaged second'`));
  console.log('PASS actual packaged 0.2.4: default global mode off; Unicode/spaced file argv; explicit original save; second-instance file route');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1800));process.exitCode=1;}).finally(async()=>{
  sockets.forEach(ws=>ws.close());children.forEach(c=>{if(c.exitCode===null)c.kill();});await wait(600);
  const absolute=path.resolve(tmp);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('suira-workspace-'))throw Error('Unsafe cleanup path');
  fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3,retryDelay:250});
});
