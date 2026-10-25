'use strict';
const assert=require('node:assert/strict');
const {longCaptureTarget,settledFirstFrame}=require('./lib/long-capture-start');
(async()=>{
  const external={hwnd:'42',pid:2,processStartedAt:100},self={hwnd:'1',pid:1};let focused;
  const probe={queryAt:async()=>external,focusTo:async target=>{focused=target;return {ok:true};},query:async()=>external};
  assert.deepEqual(await longCaptureTarget({point:{x:50,y:50},probe,ownerPid:1,current:self}),external);assert.equal(focused,external);
  probe.queryAt=async()=>self;
  await assert.rejects(longCaptureTarget({point:{x:50,y:50},probe,ownerPid:1,current:self}),/没有可滚动/);
  probe.queryAt=async()=>external;probe.focusTo=async()=>({ok:false});
  await assert.rejects(longCaptureTarget({point:{x:50,y:50},probe,ownerPid:1,current:self}),/无法激活/);
  probe.focusTo=async()=>({ok:true});probe.query=async()=>self;
  await assert.rejects(longCaptureTarget({point:{x:50,y:50},probe,ownerPid:1,current:self}),/尚未就绪/);
  const frame=v=>({width:64,height:100,data:Buffer.alloc(64*100*4,v)});let n=0;
  const result=await settledFirstFrame(async()=>frame(n++===0?80:255),async()=>{});
  assert.equal(result.data[0],255);assert.equal(n,4,'遮罩首帧应丢弃，连续三帧停稳才开始');
  n=0;await assert.rejects(settledFirstFrame(async()=>frame(n++%2?30:255),async()=>{}),/仍在变化/);
  console.log('PASS 选区命中外部窗口、激活失败/焦点被抢拒绝、遮罩首帧过滤与不稳定画面恢复');
})().catch(e=>{console.error(e);process.exitCode=1;});
