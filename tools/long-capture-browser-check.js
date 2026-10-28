'use strict';
// Real browser text at Windows DPI scales. Only generated fixture pixels are read.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {PNG}=require('pngjs');
const {connect}=require('./runtime-client');
const {LongCapture}=require('../lib/long-capture');
assert.equal(typeof WebSocket,'function','Run browser regression with Node.js 22 or later');
const executable=[process.env.SUIRA_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
assert.ok(executable,'Install Chrome/Edge or set SUIRA_CHROME to run the browser regression');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-long-capture-'));
let child,client;
const fixture=footer=>`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:15px/24px Arial;background:white;color:#333}header{position:fixed;top:0;width:100%;height:70px;background:#eee;padding:18px}footer{position:fixed;bottom:0;width:100%;height:${footer}px;background:#eee}main{position:fixed;top:70px;bottom:${footer}px;overflow:auto;scrollbar-width:none}.row{padding:12px 32px;min-height:92px;border-bottom:1px solid #ddd}.row b{color:#067bca}p{margin:4px 0}</style><main>${Array.from({length:50},(_,i)=>`<section class="row"><b>Message ${i+1}: ${(i*7919).toString(16)}</b><p>${['A long screenshot should preserve every visible line.','The next message has different text and a different length to align.','Each captured row must appear exactly once in the output.'][i%3]}</p></section>`).join('')}</main><header>Chat application header</header><footer>Compose a message</footer>`;
async function settled(){await client.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))).then(()=>true)');}
async function shot(){const {data}=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});return PNG.sync.read(Buffer.from(data,'base64'));}
(async()=>{
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  child=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${tmp}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
  for(let n=0;n<100;n++){try{client=await connect(port,t=>t.type==='page');break;}catch{}await wait(100);}
  assert.ok(client,'Browser debugging target did not start');
  for(const scale of [1,1.25,1.5,2])for(const footer of [28,140]){
    await client.send('Emulation.setDeviceMetricsOverride',{width:640,height:500,deviceScaleFactor:scale,mobile:false});
    await client.send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(fixture(footer))});
    for(let n=0;n<100;n++){if(await client.evaluate("document.readyState==='complete'&&Boolean(document.querySelector('main'))"))break;await wait(20);}
    await settled();const first=await shot(),model=new LongCapture(first);
    let previousOffset=0;
    for(const offset of [73,141,263]){
      await client.evaluate(`document.querySelector('main').scrollTop=${offset}`);await settled();
      const result=model.append(await shot());
      assert.equal(result.status,'matched',JSON.stringify({scale,footer,offset,result}));
      assert.ok(Math.abs(result.shift-(offset-previousOffset)*scale)<=1,'Physical scroll distance must follow DPI scale');previousOffset=offset;
    }
    assert.ok(Math.abs(model.height-(500+263)*scale)<=1,'Full image height must include all scroll distance');
    if(Number.isInteger(scale)){
      await client.send('Emulation.setDeviceMetricsOverride',{width:640,height:763,deviceScaleFactor:scale,mobile:false});
      await client.evaluate("document.querySelector('main').scrollTop=0");await settled();
      const expected=await shot();assert.equal(model.height,expected.height);
      assert.deepEqual(model.bitmap(),expected.data,'Stitched text, fixed header and composer must match one full-height browser render');
    }
    console.log(`PASS browser text ${scale*100}% DPI / fixed composer ${footer}px / 3 scrolls${Number.isInteger(scale)?' / complete output pixel comparison':''}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  client?.ws.close();
  if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  try { fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
  catch(error) {
    // Chromium 子进程可能仍持有 Windows 文件句柄；统一清理脚本会检查占用后重试。
    if(!['EPERM','EBUSY'].includes(error.code))throw error;
    console.warn('Browser checks finished; temporary profile cleanup deferred to npm run clean:',tmp);
  }
});
