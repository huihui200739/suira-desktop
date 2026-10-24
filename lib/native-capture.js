'use strict';
const {execFile}=require('node:child_process');
const {tileLayout}=require('./display-geometry');
function captureNative(executable) {
  return new Promise((resolve,reject)=>execFile(executable,[],{windowsHide:true,timeout:10000,maxBuffer:96*1024*1024},(error,stdout)=>{
    if(error){reject(error);return;}try{const frames=JSON.parse(stdout);if(!Array.isArray(frames)||!frames.length)throw Error('没有采集画面');resolve(frames);}catch(e){reject(e);}
  }));
}
function nativeDesktopTiles(displays,frames,bounds,scale) {
  const remaining=[...frames],layout=tileLayout(displays,bounds,scale),tiles=[],rawTiles=[];
  for(const d of displays) {
    const origin=d.nativeOrigin||{x:d.bounds.x*(d.scaleFactor||1),y:d.bounds.y*(d.scaleFactor||1)};
    remaining.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y));
    const frame=remaining.shift(),tile=layout.find(t=>t.id===d.id);
    if(!frame||!tile||frame.width<1||frame.height<1||!frame.dataUrl?.startsWith('data:image/png;base64,'))throw Error('显示器画面不完整');
    const local={x:d.bounds.x-bounds.x,y:d.bounds.y-bounds.y,width:d.bounds.width,height:d.bounds.height};
    rawTiles.push({...local,dataUrl:frame.dataUrl,pixelWidth:frame.width,pixelHeight:frame.height});
    tiles.push({...tile,dataUrl:frame.dataUrl});
  }
  // 单屏直接使用原始尺寸，避免逻辑尺寸乘 DPI 产生 1px 误差后又全屏重采样。
  const single=tiles.length===1;
  return {tiles,rawTiles,width:single?frames[0].width:Math.round(bounds.width*scale),height:single?frames[0].height:Math.round(bounds.height*scale)};
}
module.exports={captureNative,nativeDesktopTiles};
