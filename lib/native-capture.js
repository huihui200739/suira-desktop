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
function captureWindowsNative(executable,excludePid=0) {
  return new Promise(resolve=>execFile(executable,['--windows',String(excludePid||0)],{windowsHide:true,timeout:1500,maxBuffer:4*1024*1024},(error,stdout)=>{
    if(error){resolve([]);return;}
    try{const list=JSON.parse(stdout);resolve(Array.isArray(list)?list:[]);}catch{resolve([]);}
  }));
}
function clampRect(rect,bounds) {
  if(!rect||!bounds)return null;
  const x1=Math.max(0,Math.round(rect.x-bounds.x));
  const y1=Math.max(0,Math.round(rect.y-bounds.y));
  const x2=Math.min(Math.round(bounds.width),Math.round(rect.x+rect.width-bounds.x));
  const y2=Math.min(Math.round(bounds.height),Math.round(rect.y+rect.height-bounds.y));
  const width=x2-x1,height=y2-y1;
  return width>=12&&height>=12?{x:x1,y:y1,width,height}:null;
}
function normalizeSnapRects(rawWindows,virtualBounds,toDipPoint) {
  if(!Array.isArray(rawWindows)||!virtualBounds)return [];
  const convert=rect=>{
    if(!rect||!Number.isFinite(rect.x)||!Number.isFinite(rect.y)||!Number.isFinite(rect.width)||!Number.isFinite(rect.height)||rect.width<1||rect.height<1)return null;
    if(typeof toDipPoint==='function'){
      const x1=Math.round(rect.x),y1=Math.round(rect.y),x2=Math.round(rect.x+rect.width-1),y2=Math.round(rect.y+rect.height-1);
      const corners=[toDipPoint({x:x1,y:y1}),toDipPoint({x:x2,y:y1}),toDipPoint({x:x1,y:y2}),toDipPoint({x:x2,y:y2})];
      if(corners.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
      const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x));
      const minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
      return clampRect({x:minX,y:minY,width:Math.max(0,maxX-minX+1),height:Math.max(0,maxY-minY+1)},virtualBounds);
    }
    return clampRect(rect,virtualBounds);
  };
  const result=[];
  for(const win of rawWindows){
    const box=convert(win);
    if(!box)continue;
    const seen=new Set([`${box.x},${box.y},${box.width},${box.height}`]);
    const rawChildren=Array.isArray(win.children)?win.children:[];
    const rawParentById=new Map();
    for(const child of rawChildren)if(child&&child.id!==undefined)rawParentById.set(child.id,child.parent);
    const keptIds=new Set();
    if(win.id!==undefined)keptIds.add(win.id);
    const children=[];
    for(const child of rawChildren){
      const cbox=convert(child);
      if(!cbox)continue;
      const key=`${cbox.x},${cbox.y},${cbox.width},${cbox.height}`;
      if(seen.has(key))continue;
      seen.add(key);
      if(child.id!==undefined)keptIds.add(child.id);
      const entry=child.id!==undefined?{...cbox,id:child.id,parent:child.parent}:cbox;
      children.push(entry);
    }
    for(const entry of children){
      if(entry.id===undefined||entry.parent===undefined)continue;
      let cur=entry.parent;
      const walked=new Set();
      while(cur!==undefined&&!keptIds.has(cur)&&!walked.has(cur)){
        walked.add(cur);
        const next=rawParentById.get(cur);
        if(next===undefined||next===cur)break;
        cur=next;
      }
      entry.parent=cur;
    }
    const winEntry=win.id!==undefined?{...box,id:win.id,children}:{...box,children};
    result.push(winEntry);
  }
  return result;
}
module.exports={captureNative,captureWindowsNative,nativeDesktopTiles,normalizeSnapRects};
