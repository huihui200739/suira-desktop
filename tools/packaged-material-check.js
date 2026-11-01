'use strict';
// Validate the installed payload using a disposable profile, never the real data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),profile=path.join(tmp,'profile'),sockets=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let child;
async function until(fn){let last;for(let i=0;i<180;i++){try{const value=await fn();if(value)return value;}catch(error){last=error;}await wait(80);}throw last||Error('Packaged window did not become ready');}
(async()=>{
  const exe=process.argv[2]||path.join(process.env.LOCALAPPDATA,'Programs/suira-desktop/随序.exe');
  assert.ok(fs.existsSync(exe));
  const store=new SuiraStore(path.join(profile,'suira-data.json'));
  await store.updateSettings({globalShortcutsEnabled:false,recordClipboard:false,panelMaterial:'soft',panelGuideSeen:true});
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port],{windowsHide:true,env,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async suffix=>{const client=await until(()=>connect(port,t=>t.url.includes(suffix)));sockets.push(client.ws);await until(()=>client.evaluate('Boolean(window.suira)'));return client;};
  const main=await page('/index.html');
  const info=await main.evaluate('window.suira.app.info()');
  assert.equal(path.resolve(info.userData),path.resolve(profile),'Test must use an isolated profile');
  assert.equal(info.version,require('../package.json').version);
  await main.evaluate('window.suira.quick.show()');const panel=await page('/quickpanel.html');
  assert.equal((await panel.evaluate('window.suira.app.info()')).nativeBlur,true,'Packaged native module must load and enable blur');
  await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
  assert.equal(await panel.evaluate('document.querySelectorAll(".key.is-bound .suira-art").length'),14,'Installed tool objects must be packaged');
  assert.equal(await panel.evaluate('Boolean(window.SuiraKeycapMotion && document.querySelector(".key-face"))'),true,'Installed key material and motion module must load');
  await panel.evaluate('window.suira.settings.update({panelMaterial:"solid"})');
  assert.equal((await panel.evaluate('window.suira.app.info()')).nativeBlur,false);
  await panel.evaluate('window.suira.settings.update({panelMaterial:"soft"})');
  assert.equal((await panel.evaluate('window.suira.app.info()')).nativeBlur,true);
  for(const tool of ['calendar','markdown']){
    await main.evaluate(`window.suira.workspace.open(${JSON.stringify(tool)})`);
    const client=await page('tool='+tool);
    assert.equal((await client.evaluate('window.suira.app.info()')).nativeBlur,true,'Packaged tool native blur: '+tool);
  }
  await main.evaluate('window.suira.clipboardBar.show()');const shelf=await page('/clipboardbar.html');
  assert.equal((await shelf.evaluate('window.suira.app.info()')).nativeBlur,true);
  console.log('PASS installed '+info.version+': packaged native module, panel/calendar/Markdown/clipboard blur and preference toggles; isolated profile');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1400));process.exitCode=1;}).finally(async()=>{
  sockets.forEach(socket=>socket.close());if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}await wait(400);
  if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
});
