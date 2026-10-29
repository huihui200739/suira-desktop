'use strict';
// Run only after the user's normal copy has exited so real OS keys are available.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {connect}=require('./runtime-client');
const executable=process.argv[2];if(!executable||!fs.existsSync(executable))throw Error('Pass the absolute portable EXE path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),profile=path.join(tmp,'profile'),sockets=[];
fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'suira-data.json'),JSON.stringify({settings:{recordClipboard:false,themeChosen:true,theme:'light'}}));
let child;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let error;for(let n=0;n<160;n++){try{const value=await fn();if(value)return value;}catch(e){error=e;}await wait(100);}throw error||Error('状态超时');}
(async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const extra=[];if(process.argv.includes('--source')){const entry=path.join(tmp,'entry.js');fs.writeFileSync(entry,`require('electron').app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.resolve(__dirname,'../main.js'))});`);extra.push(entry);}
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;child=spawn(executable,[...extra,`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'ignore'});
  const main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));sockets.push(main.ws);
  const info=await until(()=>main.evaluate('window.suira?.app.info()'));assert.equal(path.resolve(info.userData).toLowerCase(),path.resolve(profile).toLowerCase(),'Do not test against user data');
  await until(()=>main.evaluate('Boolean(window.WorkspaceUI && window.marked && window.DOMPurify)'));
  await until(async()=>{const s=await main.evaluate('window.suira.shortcuts.get()');return s.status.longCapture?.ok;});
  const snapshot=await main.evaluate('window.suira.shortcuts.get()');
  assert.equal(snapshot.bindings.longCapture,'Alt+G');assert.equal(snapshot.status.longCapture.ok,true,JSON.stringify(snapshot.status.longCapture));
  const injection=path.join(tmp,'key.ps1');fs.writeFileSync(injection,`param([int]$key)
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class SuiraTestKey{[DllImport("user32.dll")]public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);}'
try { [SuiraTestKey]::keybd_event(0x12,0,0,[UIntPtr]::Zero);[SuiraTestKey]::keybd_event([byte]$key,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40 } finally { [SuiraTestKey]::keybd_event([byte]$key,0,2,[UIntPtr]::Zero);[SuiraTestKey]::keybd_event(0x12,0,2,[UIntPtr]::Zero) }`);
  const press=key=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',injection,'-key',String(key.charCodeAt(0))],{windowsHide:true,timeout:15000,stdio:'pipe'});
  let previous=0;
  for(let n=0;n<2;n++){
    press('G');const picker=await until(()=>connect(port,t=>t.url.endsWith('/long-picker.html')));sockets.push(picker.ws);
    const state=await until(()=>picker.evaluate(`window.__longPickerState?.ready && window.__longPickerState.revision>${previous}?window.__longPickerState:null`));previous=state.revision;
    await picker.evaluate('window.suira.longCapture.cancelPicker()');await wait(200);
  }
  for(const [key,page] of [['F','calendar'],['M','markdown']]){
    press(key);await until(()=>main.evaluate(`Boolean(document.querySelector('#page-${page}.is-active'))`));
  }
  const result=await main.evaluate(`window.suira.workspace.save('markdown',{title:'Packaged preview',text:'# Ready\\n\\n**Local renderer**'})`);assert.ok(result.ok);
  await main.evaluate(`window.WorkspaceUI.open('markdown')`);await until(()=>main.evaluate(`document.querySelector('#md-preview strong')?.textContent==='Local renderer'`));
  assert.equal((await main.evaluate(`window.suira.shortcuts.clear({name:'longCapture'})`)).ok,true);
  await wait(200);const cleared=await main.evaluate('window.suira.shortcuts.get()');assert.equal(cleared.bindings.longCapture,'');assert.equal(cleared.bindings['panelKey:G'],'');
  const failed=Object.entries(snapshot.status).filter(([name,value])=>!value.ok&&!value.optional).map(([name,value])=>({name,error:value.error}));
  assert.deepEqual(failed,[],'Every configured key should actually register');
  console.log('PASS Desktop portable: isolated profile, bundled Markdown preview, actual Windows Alt+G twice, Alt+F calendar, Alt+M Markdown; all configured hotkeys effective');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{for(const ws of sockets)ws.close();if(child?.pid&&child.exitCode===null)try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}await wait(600);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}});
