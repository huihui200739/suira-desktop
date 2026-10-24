'use strict';
// Publishable main-window screenshots: isolated data and an empty clipboard adapter.
// Never connect this script to the user's running profile or copy their clipboard.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process'),{connect}=require('./runtime-client');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'suira-doc-shots-'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
  await client.send('Emulation.setDeviceMetricsOverride',{width:1264,height:868,deviceScaleFactor:1,mobile:false});
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  for(const [page,name] of [['shelf','08-live-task-shelf.png'],['library','09-live-content-library.png'],['trail','10-live-process-trail.png'],['settings','11-live-settings.png']]){
    await client.evaluate(`window.suira.quick.showMain(${JSON.stringify(page)})`);await wait(250);
    const items=await client.evaluate('window.suira.content.list({limit:1})');
    if(items.length)throw Error('拒绝导出包含历史内容的文档截图');
    const image=await client.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(root,'docs','screenshots',name),Buffer.from(image.data,'base64'));
  }
  console.log('PASS 四张主窗口文档截图已从独立空数据实例生成');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{client?.ws.close();child?.kill();});
