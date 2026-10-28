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
const fixture=()=>`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:14px/22px Arial;background:#f2f3f7;color:#17202a}header{position:fixed;top:0;left:0;width:100%;height:60px;background:white;border-bottom:1px solid #ddd;padding:16px 24px;z-index:2}main{position:fixed;top:60px;bottom:0;width:100%;overflow:auto;scrollbar-width:none}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0 24px;padding:20px 140px 20px 24px;background:white}.card{height:230px;min-width:0}.cover{height:100px;border-radius:5px;margin-bottom:8px;background:linear-gradient(125deg,#294bca,#29adbe);position:relative;overflow:hidden}.cover:after{content:'课程封面';position:absolute;inset:28px 12px;transform:rotate(-12deg);color:white;font-size:22px;font-weight:bold}.card:nth-child(3n) .cover{background:linear-gradient(60deg,#e8a72b,#ffdaa0)}b{display:block;line-height:20px}small{display:block;color:#999;font-size:11px;margin-top:6px}aside{position:fixed;bottom:50px;right:0;display:grid;gap:12px;z-index:3}aside button{width:112px;height:32px;background:white;border:1px solid #ddd;border-radius:18px;color:#2486ff}footer{position:fixed;bottom:0;left:0;background:#eee;border:1px solid #ccc;font-size:11px;line-height:18px;color:#333;z-index:4;padding:0 3px}</style><main><div class="grid">${Array.from({length:48},(_,i)=>'<article class="card"><div class="cover"></div><b>课程 '+(i+1)+' · '+['算法分析与设计','程序设计基础','大学英语','操作系统'][i%4]+'</b><small>测试学院 · '+(i*7919).toString(16)+'</small><small>开课时间：2026-09-01</small></article>').join('')}</div></main><header>我的课　　我教的课</header><aside><button>更新公告</button><button>使用帮助</button></aside><footer>https://course.test/visit?courseId=0</footer>`;
async function settled(){await client.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))).then(()=>true)');}
async function shot(){const {data}=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});return PNG.sync.read(Buffer.from(data,'base64'));}
(async()=>{
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  child=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${tmp}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
  for(let n=0;n<100;n++){try{client=await connect(port,t=>t.type==='page');break;}catch{}await wait(100);}
  assert.ok(client,'Browser debugging target did not start');
  for(const scale of [1,1.25,1.5,2]){const footer=0;
    await client.send('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:scale,mobile:false});
    await client.send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(fixture(footer))});
    for(let n=0;n<100;n++){if(await client.evaluate("document.readyState==='complete'&&Boolean(document.querySelector('main'))"))break;await wait(20);}
    await settled();const first=await shot(),model=new LongCapture(first);
    let previousOffset=0;
    for(const offset of [39,93,152,230,310,390,470]){
      await client.evaluate(`document.querySelector('main').scrollTop=${offset};document.querySelector('footer').textContent='https://course.test/visit?courseId='+${offset}`);await settled();
      const result=model.append(await shot());
      assert.equal(result.status,'matched',JSON.stringify({scale,footer,offset,result}));
      assert.ok(Math.abs(result.shift-(offset-previousOffset)*scale)<=1,'Physical scroll distance must follow DPI scale');previousOffset=offset;
    }
    assert.ok(Math.abs(model.height-(600+470)*scale)<=1,'Full image height must include all scroll distance');
    if(Number.isInteger(scale)){
      await client.send('Emulation.setDeviceMetricsOverride',{width:960,height:1070,deviceScaleFactor:scale,mobile:false});
      await client.evaluate("document.querySelector('main').scrollTop=0");await settled();
      const expected=await shot();assert.equal(model.height,expected.height);
      const actual=model.bitmap();assert.ok(actual.equals(expected.data),'Course grid differs from one tall browser render: repeated overlay or broken seam');
      if(process.argv.includes('--save-preview')&&scale===1)fs.writeFileSync(path.join(__dirname,'..','docs','screenshots','32-long-capture-grid.png'),PNG.sync.write({width:model.width,height:model.height,data:actual}));
    }
    console.log(`PASS course grid / changing hover URL / floating help buttons ${scale*100}% DPI / 7 scrolls${Number.isInteger(scale)?' / complete output pixel comparison':''}`);
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
