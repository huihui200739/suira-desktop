'use strict';
// Independent profile. No desktop capture, user clipboard, real OS shortcuts or external launch.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-ui-polish-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child;const sockets=[];
async function until(fn){for(let n=0;n<150;n++){try{const value=await fn();if(value)return value;}catch{}await wait(100);}throw Error('独立界面实例未就绪');}
(async()=>{
  const exe=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(os.homedir(),'suira-electron-dist','electron.exe'),path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
  assert.ok(exe,'需要 Electron');
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const entry=path.join(tmp,'app.js');
  fs.writeFileSync(entry,`const {app,clipboard,globalShortcut}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.unregister=key=>keys.delete(key);globalShortcut.unregisterAll=()=>keys.clear();require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(tmp,'app.log'),'w');
  child=spawn(exe,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  async function page(suffix){const c=await until(()=>connect(port,t=>t.url.endsWith(suffix)));sockets.push(c.ws);return c;}
  const main=await page('/index.html');await until(()=>main.evaluate('Boolean(window.suira?.capture)'));
  const png=await main.evaluate(`(()=>{const c=document.createElement('canvas');c.width=360;c.height=240;const x=c.getContext('2d');x.fillStyle='#0d74ce';x.fillRect(0,0,360,240);x.fillStyle='#fff';x.font='28px sans-serif';x.fillText('SUIRA test',50,125);return c.toDataURL();})()`);
  const opened=await main.evaluate(`window.suira.capture.finish({dataUrl:${JSON.stringify(png)},action:'pin'})`);assert.equal(opened.ok,true);
  const pin=await page('/pin.html');await until(()=>pin.evaluate(`document.getElementById('pin-image').naturalWidth>0`));await wait(120);
  const bounds=()=>pin.evaluate('window.pinApi.bounds()');const original=await bounds();
  await pin.evaluate(`document.getElementById('collapse').click(),true`);await until(async()=>Math.abs((await bounds()).height-40)<=1);
  const small=await bounds();const start={x:small.width/2,y:20};
  await pin.send('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
  await pin.send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
  await pin.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+28,y:27,button:'left',buttons:1});await wait(140);
  await pin.send('Input.dispatchMouseEvent',{type:'mouseReleased',...start,button:'left',buttons:0,clickCount:1});await wait(100);
  const moved=await bounds();
  assert.ok(moved.x>small.x+10,JSON.stringify({small,moved}));assert.ok(Math.abs(moved.height-small.height)<=1);assert.ok(Math.abs(moved.width-small.width)<=1);
  assert.equal(await pin.evaluate(`document.body.classList.contains('is-collapsed')`),true,'拖动松手不能误展开');
  await pin.evaluate(`document.getElementById('restore').click(),true`);await until(async()=>Math.abs((await bounds()).height-original.height)<=1);
  const expanded=await bounds();assert.ok(Math.abs(expanded.x-moved.x)<=1);assert.ok(Math.abs(expanded.y-moved.y)<=1);assert.ok(Math.abs(expanded.width-original.width)<=1);
  await pin.evaluate(`document.getElementById('collapse').click(),true`);await until(async()=>Math.abs((await bounds()).height-40)<=1);
  await pin.send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
  await pin.send('Input.dispatchMouseEvent',{type:'mouseReleased',...start,button:'left',buttons:0,clickCount:1});
  await until(async()=>Math.abs((await bounds()).height-original.height)<=1);
  for(let n=0;n<3;n++){
    await pin.evaluate(`document.getElementById('collapse').click(),true`);await until(async()=>Math.abs((await bounds()).height-40)<=1);
    await pin.evaluate(`document.getElementById('restore').click(),true`);await until(async()=>Math.abs((await bounds()).height-original.height)<=1);
    const size=await bounds();assert.ok(Math.abs(size.width-original.width)<=1);assert.ok(Math.abs(size.height-original.height)<=1);
  }
  console.log('PASS 收起钉图真实鼠标拖动、松手不误展开、原尺寸与新位置保留、单击仍可展开');
  await pin.evaluate('window.pinApi.close()');
  const targets=[path.join(process.env.SystemRoot||'C:\\Windows','System32','shell32.dll'),path.join(process.env.SystemRoot||'C:\\Windows','System32','imageres.dll')];
  const icons=await main.evaluate(`window.suira.apps.icons(${JSON.stringify(targets)})`);
  const dimensions=targets.map(file=>{const data=Buffer.from((icons[file]||'').split(',')[1]||'','base64');return data.length>=24?{width:data.readUInt32BE(16),height:data.readUInt32BE(20)}:{width:0,height:0};});
  assert.ok(dimensions.every(size=>size.width>=128&&size.height>=128),JSON.stringify(dimensions));
  console.log('PASS Windows 图标资源按高分辨率提取 '+JSON.stringify(dimensions));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  for(const ws of sockets)ws.close();
  if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}
  await wait(300);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
});
