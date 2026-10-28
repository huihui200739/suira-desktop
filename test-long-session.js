'use strict';
const assert=require('node:assert/strict');const {LongCaptureSession,sameSource}=require('./lib/long-capture-session');
const target={hwnd:'1',pid:2,processStartedAt:3,title:'滚动页面',bounds:{x:10,y:10,width:300,height:400}};
const make=offset=>{const w=120,h=240,data=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,n=((y+offset)*7919)^(x*104729)^((y+offset)*x*23);data[i]=n%251;data[i+1]=(n>>>5)%241;data[i+2]=(n>>>11)%239;data[i+3]=255;}return{width:w,height:h,data};};
(async()=>{
  let offset=0,current=target,captures=0;
  const session=new LongCaptureSession({first:make(0),target,current:async()=>current,capture:async()=>{captures++;return make(offset);},auto:false});
  offset=70;await session.poll();assert.equal(session.model.frames,1,'滚动中的首帧不立即拼接');await session.poll();assert.equal(session.model.frames,2);assert.equal(session.model.height,310);
  await session.poll();assert.equal(session.model.frames,2,'重复帧不增加长度');
  session.pause();const previous=captures;await session.poll();assert.equal(captures,previous);
  session.resume();current={...target,hwnd:'another'};await session.poll();assert.equal(session.paused,true);assert.equal(captures,previous,'切换窗口不得继续采集');
  current=target;session.resume();offset=110;await session.poll();await session.poll();assert.equal(session.model.frames,3);
  current={...target,bounds:{...target.bounds,x:11}};await session.poll();assert.equal(session.paused,true);
  assert.equal(sameSource(target,{...target,title:'另一标签页'}),false);assert.equal(sameSource(target,{...target,processStartedAt:44}),false);
  await session.stop();session.resume();await session.poll();assert.equal(session.stopped,true);assert.equal(session.candidate,null);
  const failure=new LongCaptureSession({first:make(0),target,current:async()=>target,capture:async()=>{throw Error('采集失败');},auto:false});await failure.poll();assert.equal(failure.paused,true);assert.equal(failure.model.height,240);await failure.stop();
  let source=target;
  const switched=new LongCaptureSession({first:make(0),target,current:async()=>source,capture:async()=>{source={...target,hwnd:'other'};return make(70);},auto:false});
  await switched.poll();assert.equal(switched.paused,true);assert.equal(switched.model.frames,1,'采集过程中切窗不得拼接错误画面');await switched.stop();
  let release,entered;
  const waiting=new Promise(r=>{entered=r;});
  const pendingSession=new LongCaptureSession({first:make(0),target,current:async()=>target,capture:()=>{entered();return new Promise(r=>{release=r;});},auto:false});
  const pending=pendingSession.poll();await waiting;pendingSession.pause();pendingSession.resume();release(make(70));await pending;
  assert.equal(pendingSession.candidate,null,'暂停继续前开始的在途采集必须丢弃');await pendingSession.stop();

  // 滚动过程中对不上是常态：只提示、不锁死会话；画面停住还连续对不上才暂停。
  const noise=seed=>{const w=120,h=240,data=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,n=((y+seed)*2654435761^(x+seed*7)*40503)>>>0;data[i]=n%251;data[i+1]=(n>>>7)%241;data[i+2]=(n>>>13)%239;data[i+3]=255;}return{width:w,height:h,data};};
  let previews=0;
  const tolerant=new LongCaptureSession({first:make(0),target,current:async()=>target,capture:async()=>noise(11),onPreview:()=>{previews++;},auto:false,maxMisses:3});
  await tolerant.poll();assert.equal(tolerant.model.frames,1);
  await tolerant.poll();assert.equal(tolerant.paused,false,'画面还在变化时不得暂停');
  await tolerant.poll();assert.equal(tolerant.paused,false,'连续变化期间仍然不暂停');
  await tolerant.poll();
  await tolerant.poll();assert.equal(tolerant.paused,true,'画面停住且始终对不上才提示回滚');
  assert.match(tolerant.message,/往回滚/);assert.equal(tolerant.model.height,240,'对不上不得污染已拼接结果');
  await tolerant.stop();

  previews=0;
  const matching=new LongCaptureSession({first:make(0),target,current:async()=>target,capture:async()=>make(70),onPreview:()=>{previews++;},auto:false});
  await matching.poll();await matching.poll();
  assert.equal(previews,1,'每次成功拼接都要推一张新预览');await matching.stop();

  // 高频轮询下重复帧不应该重复回调，也不应该累加高度。
  previews=0;
  const quiet=new LongCaptureSession({first:make(0),target,current:async()=>target,capture:async()=>make(70),onPreview:()=>{previews++;},auto:false});
  await quiet.poll();
  for(let n=0;n<5;n++)await quiet.poll();
  assert.equal(quiet.model.frames,2,'重复画面只拼一次');assert.equal(previews,1);await quiet.stop();
  console.log('PASS 停稳后拼接、重复去重、暂停继续、切窗/移窗/换页停止采集、取消及采集失败保留有效结果');
})().catch(error=>{console.error(error);process.exitCode=1;});
