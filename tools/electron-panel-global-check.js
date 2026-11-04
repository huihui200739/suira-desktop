'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect}=require('./runtime-client'),{PANEL_ACTIONS}=require('../lib/keybindings');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-bindings-')),control=path.join(tmp,'control.json'),trace=path.join(tmp,'trace.jsonl');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let child,ws,seq=0,config={seq:0};const sockets=[];fs.writeFileSync(control,JSON.stringify(config));
const update=patch=>{Object.assign(config,patch);fs.writeFileSync(control,JSON.stringify(config));};
const records=()=>fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function until(fn){for(let n=0;n<150;n++){try{const v=await fn();if(v)return v;}catch{}await wait(80);}throw Error('全局键验证状态超时');}
(async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`
const fs=require('node:fs');const {app,clipboard,globalShortcut,shell}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});
const config=()=>JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8')),log=(type,data)=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({type,...data})+'\\n');
clipboard.read=async()=>[];clipboard.readText=async()=>'';const keys=new Map();
globalShortcut.register=(key,handler)=>{if(config().blocked===key||keys.has(key))return false;keys.set(key,handler);return true;};globalShortcut.unregister=key=>keys.delete(key);globalShortcut.unregisterAll=()=>keys.clear();
shell.openPath=async target=>{log('open',{target});return ''};shell.openExternal=async target=>log('open',{target});
const pa=require(${JSON.stringify(path.join(root,'lib/panel-actions'))});pa.createPanelActions=()=>({run:async action=>{log('action',{action});return action==='translate'?{ok:true,translate:{text:'fixture translation',source:'fixture',to:'en'}}:{ok:true,closePanel:true};}});
let seen=0;setInterval(async()=>{const c=config();if(c.seq===seen)return;seen=c.seq;try{await keys.get(c.key)?.();log('invoked',{seq:c.seq,key:c.key,registered:keys.has(c.key)});}catch(e){log('error',{message:e.message});}},30);
require(${JSON.stringify(path.join(root,'main.js'))});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:\\suira-electron\\electron.exe',[entry,'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const main=await until(()=>connect(port,t=>t.url.endsWith('/index.html')));ws=main.ws;await until(()=>main.evaluate('Boolean(window.suira?.panel)'));await main.evaluate('window.suira.settings.update({globalShortcutsEnabled:true})');await wait(500);
  async function press(key){const current=++seq;update({seq:current,key});await until(()=>records().find(r=>r.type==='invoked'&&r.seq===current));}
  const snapshot=await main.evaluate('window.suira.shortcuts.get()');
  for(const [action,meta] of Object.entries(PANEL_ACTIONS).filter(([,m])=>m.implemented&&m.key)) {
    assert.ok(Object.values(snapshot.bindings).includes('Alt+'+meta.key),action);
    if(['capture','clipboard'].includes(action))continue;
    await press('Alt+'+meta.key);assert.equal(records().filter(r=>r.type==='action').at(-1).action,action);
    if(action==='translate') {
      const panel=await until(()=>connect(port,t=>t.url.endsWith('/quickpanel.html')));sockets.push(panel.ws);
      await until(()=>panel.evaluate(`!document.getElementById('translate-panel').hidden&&document.getElementById('translate-text').value==='fixture translation'`));
    }
  }
  assert.equal((await main.evaluate(`window.suira.panel.moveBinding({fromKey:'G',toKey:'Q'})`)).ok,true);
  await press('Alt+G');assert.equal(records().at(-1).registered,false);await press('Alt+Q');assert.equal(records().filter(r=>r.type==='action').at(-1).action,'long-capture');
  assert.equal((await main.evaluate(`window.suira.panel.setBinding({key:'F',binding:{type:'url',target:'https://example.com',name:'fixture'}})`)).ok,true);
  await press('Alt+F');assert.equal(records().filter(r=>r.type==='open').at(-1).target,'https://example.com');
  assert.equal((await main.evaluate(`window.suira.panel.setBinding({key:'S',binding:{type:'folder',target:${JSON.stringify(tmp)},name:'fixture'}})`)).ok,true);
  await press('Alt+S');assert.notEqual(records().filter(r=>r.type==='open').at(-1)?.target,tmp);assert.equal((await main.evaluate('window.suira.shortcuts.get()')).bindings.quick,'Alt+S');
  update({blocked:'Alt+J'});const rejected=await main.evaluate(`window.suira.panel.moveBinding({fromKey:'Q',toKey:'J'})`);assert.equal(rejected.ok,false);
  await press('Alt+Q');assert.equal(records().filter(r=>r.type==='action').at(-1).action,'long-capture');
  const layout=await main.evaluate('window.suira.panel.state()');assert.equal(layout.keys.find(k=>k.key==='Q').actionId,'long-capture');
  console.log('PASS 全部内置功能注册 Alt 字母并直达执行；长截图换位即解绑旧键/启用新键');
  console.log('PASS 自定义网页直达、S 唤起键保持优先、新组合键被占用整批回滚');
})().catch(error=>{console.error(error);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1500));process.exitCode=1;}).finally(async()=>{ws?.close();for(const socket of sockets)socket.close();if(child&&child.exitCode===null)child.kill();await wait(600);try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}});
