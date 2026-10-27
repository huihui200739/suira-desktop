'use strict';
const {frameSettled}=require('./frame-comparison');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function longCaptureTarget({point,probe,ownerPid,pause=wait}) {
  // 隐藏框选层后 DWM / WindowFromPoint 的命中可能晚一帧更新。只认选区里的
  // 实际窗口，不能在一次命中失败时拿任意前台窗口当作采集源。
  let target=null;
  for(let n=0;n<5;n++) {
    const hit=await probe.queryAt(point);
    if(hit&&hit.pid!==ownerPid){target=hit;break;}
    if(n<4)await pause(60);
  }
  if(!target)throw Error('选区内没有可滚动的应用窗口，请调整选区后重试');
  // 手动滚动只需确认选区中的窗口实例；后台辅助进程没有前台激活权限。
  // 不发送输入，也不把 SetForegroundWindow 的结果作为截图的启动条件。
  const actual=await probe.query(target.hwnd);
  if(!actual||String(actual.hwnd)!==String(target.hwnd)||actual.pid!==target.pid||(target.processStartedAt&&actual.processStartedAt!==target.processStartedAt))throw Error('选中的窗口已关闭或发生变化，请重新框选');
  return actual;
}
function sourceProbePoint(rect,hud=null) {
  const inside=(p,r)=>r&&p.x>=r.x&&p.y>=r.y&&p.x<r.x+r.width&&p.y<r.y+r.height;
  for(const y of [.5,.15,.85])for(const x of [.5,.15,.85]) {
    const p={x:Math.round(rect.x+rect.width*x),y:Math.round(rect.y+rect.height*y)};
    if(!inside(p,hud))return p;
  }
  return {x:rect.x+2,y:rect.y+2};
}
async function settledFirstFrame(capture,pause=wait) {
  let previous=null,stable=0;
  for(let n=0;n<12;n++) {
    const frame=await capture();
    stable=previous&&frameSettled(previous,frame)?stable+1:0;
    if(stable>=2)return frame;
    previous=frame;await pause(80);
  }
  throw Error('选区画面仍在变化，请停止滚动后重试');
}
module.exports={longCaptureTarget,settledFirstFrame,sourceProbePoint,frameSettled};
