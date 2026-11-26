'use strict';
// Validate the installed payload using a disposable profile, never the real data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{SuiraStore}=require('../lib/store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),profile=path.join(tmp,'profile'),sockets=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let child;
async function until(fn){let last;for(let i=0;i<180;i++){try{const value=await fn();if(value)return value;}catch(error){last=error;}await wait(80);}throw last||Error('Packaged window did not become ready');}
(async()=>{
  let exe=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||path.join(process.env.LOCALAPPDATA,'Programs/suira-desktop/随序.exe'));
  assert.ok(fs.existsSync(exe));
  const store=new SuiraStore(path.join(profile,'suira-data.json'));
  await store.updateSettings({globalShortcutsEnabled:false,recordClipboard:false,panelMaterial:'soft',panelGuideSeen:true});
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const env={...process.env,APPDATA:path.join(tmp,'roaming'),LOCALAPPDATA:path.join(tmp,'local')};delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(env.APPDATA);fs.mkdirSync(env.LOCALAPPDATA);
  const log=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port],{windowsHide:false,env,stdio:['ignore',log,log]});fs.closeSync(log);
  const page=async suffix=>{const client=await until(()=>connect(port,t=>t.url.includes(suffix)));sockets.push(client.ws);await until(()=>client.evaluate('Boolean(window.suira)'));return client;};
  const main=await page('/index.html');
  async function companion(client){
    assert.equal(await client.evaluate('Boolean(document.querySelector(".suira-companion,[data-buddy]")) || Array.from(document.scripts).some(script=>script.src.includes("companion.js"))'),false,'Pixel companion and settings are removed');
  }
  await companion(main);
  const info=await main.evaluate('window.suira.app.info()');
  assert.equal(path.resolve(info.userData),path.resolve(profile),'Test must use an isolated profile');
  assert.equal(info.version,require('../package.json').version);
  const material = client => client.evaluate('window.suira.material.preferences()');
  async function checkNativeGlass(client, surface) {
    const preferences = await material(client);
    assert.equal(preferences.nativeBlur, true, `Native blur: ${surface}`);
    assert.equal(preferences.frameReady, true, `DWM frame and corners: ${surface}`);
  }
  async function checkSolidSurface(client, surface) {
    const preferences = await material(client);
    assert.equal(preferences.nativeBlur, false, `Solid surface: ${surface}`);
    assert.equal(await client.evaluate('document.documentElement.dataset.glassMode'), 'solid', `Solid glassMode: ${surface}`);
  }
  await checkSolidSurface(main, 'workbench');
  await main.evaluate('window.suira.quick.show()');const panel=await page('/quickpanel.html');
  assert.equal((await panel.evaluate('window.suira.app.info()')).code, 'IPC_FORBIDDEN');
  await checkNativeGlass(panel, 'panel');
  await until(()=>panel.evaluate('document.querySelectorAll(".key").length===38'));
  await companion(panel);
  if(process.argv.includes('--preview')){
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await wait(250);
    const shot=await panel.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(__dirname,'../docs/product/panel.png'),Buffer.from(shot.data,'base64'));
  }
  assert.equal(await panel.evaluate('document.querySelectorAll(".key.is-bound .suira-art").length'),15,'Installed tool objects must be packaged');
  assert.equal(await panel.evaluate('Boolean(window.SuiraKeycapMotion && document.querySelector(".key-face"))'),true,'Installed key material and motion module must load');
  const families = await panel.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('.key.is-bound .suira-art.vivid'),
    node => Array.from(node.classList).find(name => name.startsWith('family-'))))).sort()`);
  assert.deepEqual(families, ['family-amber', 'family-blue', 'family-iris', 'family-jade', 'family-orange', 'family-slate']);
  await panel.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await panel.send('Page.bringToFront');
  await until(()=>panel.evaluate('document.visibilityState === "visible" && Boolean(document.documentElement.dataset.panelPrepared)'));
  await panel.evaluate('Promise.all(document.querySelector(".panel").getAnimations().map(animation => animation.finished.catch(() => {})))');
  const target=await panel.evaluate('(()=>{const b=document.querySelector("[data-key=T]").getBoundingClientRect();return {x:b.x+b.width*.7,y:b.y+b.height*.3};})()');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
  assert.equal(await panel.evaluate(`document.elementFromPoint(${target.x}, ${target.y})?.closest('.key')?.dataset.key`), 'T');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});
  await until(()=>panel.evaluate('document.querySelector("[data-key=T]").classList.contains("is-key-near")'));
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
  await panel.evaluate('window.suira.settings.update({panelMaterial:"solid"})');
  assert.equal((await material(panel)).nativeBlur, false);
  await panel.evaluate('window.suira.settings.update({panelMaterial:"soft"})');
  await checkNativeGlass(panel, 'panel after restoring glass');
  assert.equal(await panel.evaluate('document.documentElement.dataset.glassBackend'),'native');
  assert.equal(await panel.evaluate('document.querySelector(".glass-scene").children.length'),0,'No wallpaper background');
  const documentText = '# 打包验证文档\n\n可视化编辑与目录。';
  assert.equal((await main.evaluate(`window.suira.workspace.save('markdown', {title: '打包验证文档', text: ${JSON.stringify(documentText)}})`)).ok, true);
  for(const tool of ['calendar','markdown']){
    await main.evaluate(`window.suira.workspace.open(${JSON.stringify(tool)})`);
    const client=await page('tool='+tool);
    await companion(client);
    await checkSolidSurface(client, tool);
    await until(()=>client.evaluate('Boolean(document.querySelector(".tool-kind .suira-art.vivid"))'));
    if(tool==='calendar')assert.equal(await client.evaluate('document.querySelector(".tool-kind .calendar-page").getBoundingClientRect().height>0'),true,'Calendar icon content must not match the hidden page selector');
    else {
      await until(()=>client.evaluate(`document.getElementById('md-editor').value === ${JSON.stringify(documentText)}`));
      await client.evaluate(`document.querySelector('[data-md-view="write"]').click()`);
      await until(()=>client.evaluate('Boolean(window.WorkspaceUI?.documentEditor)'));
      assert.equal(await client.evaluate('document.getElementById("md-split").dataset.view'),'write','Packaged visual editor is active');
      assert.equal(await client.evaluate('Boolean(document.querySelector("#md-outline [data-heading]"))'),true,'Packaged outline loads');
      await until(()=>client.evaluate('Boolean(document.querySelector("#md-empty .suira-art.vivid"))'));
      assert.equal(await client.evaluate('getComputedStyle(document.querySelector("#md-empty .art-object")).backgroundColor'),'rgba(0, 0, 0, 0)','Empty-state styling must not leak into the object layers');
    }
  }
  await main.evaluate('window.suira.clipboardBar.show()');const shelf=await page('/clipboardbar.html');
  await checkSolidSurface(shelf, 'clipboard');
  await until(()=>shelf.evaluate('Boolean(document.querySelector(".bar-mark .suira-art.vivid"))'));
  await companion(shelf);
  console.log('PASS installed '+info.version+': packaged native module, panel/calendar/Markdown/clipboard corner-safe material and preference toggles; isolated profile');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1400));process.exitCode=1;}).finally(async()=>{
  sockets.forEach(socket=>socket.close());if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}await wait(400);
  if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
});
