'use strict';
// Three-column feed with fixed navigation/recommendations and a changing live counter.
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
const fixture=()=>`<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:white;color:#14202c;font:15px/23px Arial}nav{position:fixed;left:0;top:0;bottom:0;width:190px;border-right:1px solid #eee;padding:20px}nav p{margin:0 0 30px;font-size:21px}main{position:fixed;left:190px;top:0;bottom:0;width:460px;overflow:auto;scrollbar-width:none}header{position:sticky;top:0;height:60px;background:white;border-bottom:1px solid #ddd;padding:16px;z-index:2}.post{height:280px;padding:16px 20px;border-bottom:1px solid #ddd}.post b{display:block}.post p{margin:10px 0}.cover{height:130px;border-radius:10px;background:linear-gradient(120deg,#314fbd,#76b8ef);padding:20px;color:white;font-size:24px}aside{position:fixed;left:650px;top:0;bottom:0;width:310px;padding:18px 24px;border-left:1px solid #eee}aside section{border:1px solid #ddd;border-radius:14px;padding:20px;margin-bottom:20px}aside p{margin:20px 0;font-size:19px}footer{position:fixed;right:20px;top:32px;color:#999;z-index:3;font-size:11px}</style><nav><h1>X</h1>${['首页','探索','通知','聊天','Grok','书签','个人资料','更多'].map(x=>'<p>'+x+'</p>').join('')}</nav><main><header>为你推荐　　　　正在关注</header>${Array.from({length:40},(_,i)=>'<article class="post"><b>测试作者 '+i+' · @account_'+(i*7919).toString(16)+'</b><p>信息流第 '+(i+1)+' 条：固定侧栏不能干扰中间正文的滚动配准。</p><div class="cover">内容 '+(i*7919).toString(16)+'</div><p>回复 '+i+'　转发 '+(i*3)+'　喜欢 '+(i*11)+'</p></article>').join('')}</main><aside><h2>搜索</h2><section><b>X 上的直播</b><p>固定栏目与正文不一起移动</p><p>科技频道　+100</p></section><section><b>有什么新鲜事</b><p>#固定趋势栏目</p><p>#页面滚动测试</p><p>#不同区域不同运动</p></section><section><b>推荐关注</b><p>测试账号甲</p><p>测试账号乙</p></section></aside><footer>100 人在线</footer>`;
async function settled(){await client.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))).then(()=>true)');}
async function shot(){const {data}=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});return PNG.sync.read(Buffer.from(data,'base64'));}
(async()=>{
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  child=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${tmp}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
  for(let n=0;n<100;n++){try{client=await connect(port,t=>t.type==='page');break;}catch{}await wait(100);}
  assert.ok(client,'Browser debugging target did not start');
  for(const scale of [1,1.25,1.5,2]){
    await client.send('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:scale,mobile:false});
    await client.send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(fixture())});
    for(let n=0;n<100;n++){if(await client.evaluate("document.readyState==='complete'&&Boolean(document.querySelector('main'))"))break;await wait(20);}
    await settled();const first=await shot(),model=new LongCapture(first);
    let previousOffset=0;
    for(const offset of [39,93,152,230,310,390,470]){
      await client.evaluate(`document.querySelector('main').scrollTop=${offset};document.querySelector('footer').textContent=(100+${offset})+' 人在线'`);await settled();
      const result=model.append(await shot());
      assert.equal(result.status,'matched',JSON.stringify({scale,offset,result}));
      assert.ok(Math.abs(result.shift-(offset-previousOffset)*scale)<=1,'Physical scroll distance must follow DPI scale');previousOffset=offset;
    }
    assert.ok(Math.abs(model.height-(600+470)*scale)<=1,'Full image height must include all scroll distance');
    if(Number.isInteger(scale)){
      await client.send('Emulation.setDeviceMetricsOverride',{width:960,height:1070,deviceScaleFactor:scale,mobile:false});
      await client.evaluate("document.querySelector('main').scrollTop=0");await settled();
      const expected=await shot();assert.equal(model.height,expected.height);
      const actual=model.bitmap(),stride=model.width*4,left=Math.round(190*scale)*4,right=Math.round(650*scale)*4;
      // 合成滚动层的渐变栅格化允许 1 级色差；文字/行位置不允许错位。
      for(let y=0;y<model.height;y++){const a=actual.subarray(y*stride+left,y*stride+right),b=expected.data.subarray(y*stride+left,y*stride+right);let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));assert.ok(maximum<=1,'Middle feed has skipped or duplicated rows at '+y);}
      
    }
    await client.send('Emulation.setDeviceMetricsOverride',{width:960,height:600,deviceScaleFactor:scale,mobile:false});
    await client.evaluate("document.querySelector('main').scrollTop=470");await settled();
    const capturedHeight=model.height,capturedBitmap=model.bitmap();
    // 回到已截范围时恢复已确认位置，不能重复增长或跳到相似的另一条帖子。
    for(const offset of [390,310,230,152,93,39,0]) {
      await client.evaluate(`document.querySelector('main').scrollTop=${offset};document.querySelector('footer').textContent=(100+${offset})+' 人在线'`);await settled();
      const result=model.append(await shot());assert.equal(result.status,'duplicate',JSON.stringify({scale,offset,result}));
      assert.equal(model.height,capturedHeight);assert.ok(model.bitmap().equals(capturedBitmap),'Reverse scrolling cannot corrupt captured content');assert.ok(Math.abs(model.position-offset*scale)<=2,'Accepted reverse match must keep the feed position');
    }
    console.log(`PASS multi-column feed / fixed navigation and recommendations ${scale*100}% DPI / down and reverse scrolls${Number.isInteger(scale)?' / scrolling feed pixel comparison':''}`);
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
