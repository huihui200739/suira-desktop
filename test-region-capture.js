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
  console.log('PASS 区域协议分块响应、请求串行、负坐标、停止取消和子进程失败清理');
})().catch(error=>{console.error(error);process.exitCode=1;});
