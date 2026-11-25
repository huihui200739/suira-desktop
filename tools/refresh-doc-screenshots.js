'use strict';
// Publishable main-window screenshots: isolated data and an empty clipboard adapter.
// Never connect this script to the user's running profile or copy their clipboard.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'suira-doc-shots-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=process.argv[2] ? path.resolve(process.argv[2]) : path.join(root,'docs','screenshots');
let child,client;
(async()=>{
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const entry=path.join(temporary,'app.js');
  fs.writeFileSync(entry,`const {app,clipboard}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';require(${JSON.stringify(path.join(root,'main.js'))});`);
  const executable=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(os.homedir(),'suira-electron-dist','electron.exe'),path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);
  if(!executable)throw Error('找不到 Electron');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(temporary,'app.log'),'w');
  child=spawn(executable,[entry,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  for(let attempt=0;attempt<100;attempt++){
    try{client=await connect(port,target=>target.url.endsWith('/index.html'));break;}catch{await wait(150);}
  }
  if(!client)throw Error('文档截图实例未就绪');
  for(let attempt=0;attempt<100;attempt++){
    if(await client.evaluate('Boolean(window.suira && document.querySelector(".nav-item"))'))break;
    await wait(100);
  }
  await client.send('Emulation.setDeviceMetricsOverride',{width:1264,height:868,deviceScaleFactor:1,mobile:false});
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  for(const [page,name] of [['shelf','08-live-task-shelf.png'],['library','09-live-content-library.png'],['trail','10-live-process-trail.png'],['settings','11-live-settings.png']]){
    const current=page==='trail'?'library':page;
    await client.evaluate(`document.querySelector('.nav-item[data-page="${current}"]').click()`);
    assert.equal((await client.evaluate('window.suira.content.list({limit:2})')).length,0,'文档截图仅允许空资料库或测试内容');
    if(page==='trail'){
      const {item}=await client.evaluate('window.suira.content.addText({text:"这是一段用于展示处理轨迹的示例内容。"})');
      await client.evaluate(`window.suira.actions.run(${JSON.stringify(item.id)}, 'ocr.local')`);
      const selector=JSON.stringify(`[data-preview="${item.id}"]`);
      for(let attempt=0;attempt<100;attempt++){
        if(await client.evaluate(`Boolean(document.querySelector(${selector}))`))break;
        await wait(100);
      }
      await client.evaluate(`document.querySelector(${selector}).click(); document.querySelector('#preview-trail > summary').click()`);
      for(let attempt=0;attempt<100;attempt++){
        if(await client.evaluate('Boolean(document.querySelector("#preview-trail[open] .trace-group"))'))break;
        await wait(100);
      }
      assert.ok(await client.evaluate('Boolean(document.querySelector("#preview-trail[open] .trace-group"))'));
      const image=await client.send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(output,name),Buffer.from(image.data,'base64'));
      await client.evaluate(`document.querySelector('#preview-close').click(); window.suira.content.remove(${JSON.stringify(item.id)})`);
      continue;
    }
    await wait(250);
    const image=await client.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(output,name),Buffer.from(image.data,'base64'));
  }
  console.log('PASS 四张主窗口文档截图已从独立测试实例生成');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  client?.ws.close();
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
  assert.match(path.basename(temporary),/^suira-doc-shots-[a-z0-9]+$/i);
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
});
