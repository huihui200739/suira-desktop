'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {RegionCapture}=require('./lib/region-capture');
function child(){const p=new EventEmitter();p.stdout=new PassThrough();p.stdin=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{p.killed=true;p.emit('exit',0);};return p;}
(async()=>{
  const p=child(),client=new RegionCapture('fixture',()=>p),rect={x:-300,y:50,width:100,height:200};
  const first=client.capture(rect);await assert.rejects(client.capture(rect),/未就绪/);
  const line=JSON.stringify({width:100,height:200,dataUrl:'data:image/png;base64,test'})+'\n';p.stdout.write(line.slice(0,12));p.stdout.write(line.slice(12));assert.equal((await first).width,100);
  const second=client.capture(rect);client.stop();await assert.rejects(second,/取消/);assert.equal(p.killed,true);await assert.rejects(client.capture(rect),/未就绪/);
  const p2=child(),failed=new RegionCapture('fixture',()=>p2),pending=failed.capture(rect);p2.emit('error',Error('broken'));await assert.rejects(pending,/broken/);assert.equal(failed.stopped,true);
  const p3=child(),early=new RegionCapture('fixture',()=>p3);p3.stderr.write('blocked by policy');p3.emit('exit',5);await assert.rejects(early.capture(rect),/blocked by policy/,'首个请求前退出也保留组件错误');
  const p4=child(),nativeError=new RegionCapture('fixture',()=>p4),request=nativeError.capture(rect);p4.stdout.write('{"error":"invalid-region"}\n');await assert.rejects(request,/invalid-region/);nativeError.stop();
  const p5=child(),cold=new RegionCapture('fixture',()=>p5,{startupTimeout:100,timeout:5});const coldFrame=cold.capture(rect);await new Promise(r=>setTimeout(r,15));p5.stdout.write(line);await coldFrame;
  await assert.rejects(cold.capture(rect),/超时/,'首帧成功后恢复普通采集超时');
  console.log('PASS 区域协议分块响应、请求串行、负坐标、停止取消和子进程失败清理');
})().catch(error=>{console.error(error);process.exitCode=1;});
