'use strict';
const {frameDifference}=require('./long-capture');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function longCaptureTarget({point,probe,ownerPid,current}) {
  const hit=await probe.queryAt(point);
  const target=hit&&hit.pid!==ownerPid?hit:current&&current.pid!==ownerPid?current:null;
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
    stable=previous&&frameDifference(previous,frame)<.0015?stable+1:0;
    if(stable>=2)return frame;
    previous=frame;await pause(80);
  }
  throw Error('选区画面仍在变化，请停止滚动后重试');
}
module.exports={longCaptureTarget,settledFirstFrame,sourceProbePoint};
