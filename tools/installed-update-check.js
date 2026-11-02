'use strict';
// Use the real installed app and public feed, with disposable data and cache.
// Exercise the menu and download; never trigger installation from this test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),sockets=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function until(fn,count=240){for(let i=0;i<count;i++){const v=await fn();if(v)return v;await wait(250);}throw Error('Installed update check timed out');}
(async()=>{
  const exe=path.join(process.env.LOCALAPPDATA,'Programs/suira-desktop/随序.exe'),profile=path.join(tmp,'profile');
  const store=new SuiraStore(path.join(profile,'suira-data.json'));
  await store.updateSettings({recordClipboard:false,globalShortcutsEnabled:false,panelGuideSeen:true});
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const env={...process.env,APPDATA:path.join(tmp,'roaming'),LOCALAPPDATA:path.join(tmp,'local')};
  for(const key of ['ELECTRON_RUN_AS_NODE','GH_TOKEN','GITHUB_TOKEN','UPDATE_RELEASE_TOKEN'])delete env[key];
  fs.mkdirSync(env.APPDATA);fs.mkdirSync(env.LOCALAPPDATA);
  const log=fs.openSync(path.join(tmp,'app.log'),'w');
  child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port],{env,windowsHide:false,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async suffix=>{let client;await until(async()=>{try{client=await connect(port,t=>t.url.includes(suffix));return true;}catch{return false;}});sockets.push(client.ws);await until(()=>client.evaluate('Boolean(window.suira)'));return client;};
  const main=await page('/index.html'),info=await main.evaluate('window.suira.app.info()');
  assert.equal(path.resolve(info.userData),path.resolve(profile));
  await main.evaluate('window.suira.quick.show()');const panel=await page('/quickpanel.html');
  await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
  await panel.evaluate('document.getElementById("panel-more").click();document.querySelector("[data-menu-action=releases]").click();true');
  const state=()=>panel.evaluate('window.suira.updates.state()');
  await until(async()=>!['idle','checking'].includes((await state()).phase));
  const found=await state();assert.equal(found.phase,process.argv.includes('--current')?'current':'available',JSON.stringify(found));
  assert.equal(await panel.evaluate('document.getElementById("update-dialog").hidden'),false);
  if(found.phase==='available')assert.equal(found.version,require('../package.json').version);
  if(process.argv.includes('--download')){
    assert.equal(found.phase,'available');
    await panel.evaluate('document.getElementById("update-action").click();true');
    await until(async()=>!['available','downloading'].includes((await state()).phase),1440);
    assert.equal((await state()).phase,'ready',JSON.stringify(await state()));
    assert.equal(await panel.evaluate('document.getElementById("update-action").textContent'),'保存草稿并重启更新');
  }
  const proof={version:require('../package.json').version,installedVersion:info.version,menuOpensDialog:true,phase:(await state()).phase,anonymous:true,downloadAndChecksumVerified:process.argv.includes('--download'),installationTriggered:false,isolatedDataAndCache:true};
  fs.writeFileSync(path.join(__dirname,'../docs/installed-update-'+require('../package.json').version+'-'+(process.argv.includes('--current')?'current':process.argv.includes('--download')?'download':'available')+'-verification.json'),JSON.stringify(proof,null,2)+'\n');
  console.log('PASS installed app public update menu',JSON.stringify(proof));
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1200));process.exitCode=1;}).finally(async()=>{
  sockets.forEach(s=>s.close());if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}
  await wait(300);if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:300});
});
