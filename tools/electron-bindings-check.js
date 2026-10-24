'use strict';

// Separate Electron profile; real preload, IPC, store and pointer events.
// External launches and clipboard capture are stubbed only in this test process.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const net = require('node:net'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { connect } = require('./runtime-client');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-bindings-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
const sockets = [];
async function until(fn) {
  for(let n=0;n<100;n++){try{const value=await fn();if(value)return value;}catch{}await wait(100);}
  throw Error('等待独立 Electron 测试实例超时');
}
(async()=>{
  const exe=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(os.homedir(),'suira-electron-dist','electron.exe'),path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
  assert.ok(exe,'需要 Electron');
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const entry=path.join(tmp,'app.js'),sample=path.join(tmp,'sample.txt'),logFile=path.join(tmp,'result.json');
  fs.writeFileSync(sample,'isolated fixture');
  fs.writeFileSync(entry,`const {app,clipboard,shell,dialog,ipcMain}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});
    clipboard.read=async()=>[];clipboard.readText=async()=>'';
    const evidence={opens:[],pickerParents:[]};const save=()=>require('fs').writeFileSync(${JSON.stringify(logFile)},JSON.stringify(evidence));
    shell.openPath=async target=>{evidence.opens.push(target);save();return '';};
    dialog.showOpenDialog=async(parent,options)=>{evidence.pickerParents.push(Boolean(parent&&!parent.isDestroyed()&&parent.getTitle().includes('动作面板')));save();return {canceled:true,filePaths:[]};};
    require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(tmp,'app.log'),'w');
  child=spawn(exe,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  async function client(suffix){const c=await until(()=>connect(port,t=>t.url.endsWith(suffix)));sockets.push(c.ws);await until(()=>c.evaluate('Boolean(window.suira?.panel?.state)'));return c;}
  const main=await client('/index.html');
  await main.evaluate('window.suira.quick.show()');
  const panel=await client('/quickpanel.html');
  await until(()=>panel.evaluate(`document.querySelectorAll('.key').length===38`));await wait(200);
  await main.evaluate('window.suira.quick.show()');
  await until(()=>panel.evaluate('!document.hidden&&document.hasFocus()'));
  await panel.evaluate(`window.__inputTrace=[];for(const t of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(t,e=>window.__inputTrace.push([t,e.target.closest?.('[data-key]')?.dataset.key,e.clientX,e.clientY]));window.addEventListener('error',e=>window.__inputTrace.push(['error',e.message]));true`);
  assert.equal(await panel.evaluate(`typeof window.suira.panel.moveBinding`),'function');
  const keyPoint=char=>panel.evaluate(`(()=>{const e=[...document.querySelectorAll('.key')].find(b=>b.dataset.key===${JSON.stringify(char)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const from=await keyPoint('Z'),to=await keyPoint('S');
  await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
  await panel.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
  for(let n=1;n<=5;n++)await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*n/5,y:from.y+(to.y-from.y)*n/5,button:'left',buttons:1});
  await panel.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  await wait(200);
  if(!await panel.evaluate(`document.querySelector('[data-key="S"]').dataset.action==='capture'`))console.log('INPUT-DIAGNOSTICS',await panel.evaluate(`({trace:window.__inputTrace,hidden:document.hidden,focus:document.hasFocus(),toast:document.getElementById('toast').textContent,drag:document.getElementById('panel').className})`));
  await until(()=>panel.evaluate(`document.querySelector('[data-key="S"]').dataset.action==='capture'`));
  const layout=await panel.evaluate('window.suira.panel.state()');
  assert.equal(layout.keys.find(k=>k.key==='Z').state,'unbound');
  assert.equal(layout.keys.find(k=>k.key==='S').actionId,'capture');
  const blocked=await panel.evaluate(`window.suira.panel.moveBinding({fromKey:'S',toKey:'X'})`);
  assert.equal(blocked.ok,false);
  const bound=await panel.evaluate(`window.suira.panel.setBinding({key:'Q',binding:{type:'file',target:${JSON.stringify(sample)},name:'示例文件'}})`);
  assert.equal(bound.ok,true);
  const moved=await panel.evaluate(`window.suira.panel.moveBinding({fromKey:'Q',toKey:'E'})`);
  assert.equal(moved.ok,true);
  const opened=await panel.evaluate(`window.suira.panel.run('binding:E')`);
  assert.equal(opened.ok,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(logFile,'utf8')).opens,[sample]);
  await main.evaluate('window.suira.quick.show()');await wait(100);
  const picked=await panel.evaluate(`window.suira.panel.pickPath({type:'file'})`);
  assert.equal(picked.canceled,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(logFile,'utf8')).pickerParents,[true]);
  console.log('PASS  真实 Electron 左键移动、preload / IPC、新键模型、占位保护、自定义目标执行及文件选择父窗口');

  // Recreate the process, with the same isolated profile, to verify persistence.
  for(const ws of sockets)ws.close();sockets.length=0;
  child.kill();await new Promise(resolve=>child.once('exit',resolve));
  const secondLog=fs.openSync(path.join(tmp,'reopened.log'),'w');
  child=spawn(exe,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',secondLog,secondLog]});fs.closeSync(secondLog);
  const reopened=await client('/index.html');
  const persisted=await until(()=>reopened.evaluate('window.suira.panel.state()'));
  assert.equal(persisted.keys.find(k=>k.key==='Z').state,'unbound');
  assert.equal(persisted.keys.find(k=>k.key==='S').actionId,'capture');
  assert.equal(persisted.keys.find(k=>k.key==='Q').state,'unbound');
  assert.equal(persisted.keys.find(k=>k.key==='E').label,'示例文件');
  console.log('PASS  重启独立进程后，内置动作和自定义绑定的新旧键位全部保留');
  const duplicateLog=fs.openSync(path.join(tmp,'duplicate.log'),'w');
  const duplicate=spawn(exe,[entry],{env,windowsHide:true,stdio:['ignore',duplicateLog,duplicateLog]});fs.closeSync(duplicateLog);
  let exitCode;
  try { exitCode=await Promise.race([new Promise(resolve=>duplicate.once('exit',resolve)),wait(4000).then(()=>null)]); }
  finally { if(duplicate.exitCode===null)duplicate.kill(); }
  assert.equal(exitCode,0,'重复启动应在 ready 前正常退出，不能弹出主进程错误');
  console.log('PASS  重复启动正常交回主实例，不再调用未就绪的快捷键服务');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  for(const ws of sockets)ws.close();
  if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  await wait(300);
  try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
});
