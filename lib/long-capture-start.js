'use strict';
const {frameDifference}=require('./long-capture');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function longCaptureTarget({point,probe,ownerPid,current}) {
  const hit=await probe.queryAt(point);
  const target=hit&&hit.pid!==ownerPid?hit:current&&current.pid!==ownerPid?current:null;
  if(!target)throw Error('选区内没有可滚动的应用窗口，请调整选区后重试');
  const focused=await probe.focusTo(target);
  if(!focused?.ok)throw Error('无法激活选中的窗口，请点击原页面后重试');
  const actual=await probe.query();
  if(!actual||String(actual.hwnd)!==String(target.hwnd)||actual.pid!==target.pid)throw Error('目标窗口尚未就绪，请重试');
  return actual;
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
module.exports={longCaptureTarget,settledFirstFrame};
