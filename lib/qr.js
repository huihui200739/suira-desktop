'use strict';
function decodeQr(data,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>8000000||data.length!==width*height*4)return null;
 const result=require('jsqr')(new Uint8ClampedArray(data),width,height,{inversionAttempts:'attemptBoth'});if(!result?.data)return null;
 const text=result.data.slice(0,8192);let url='';try{const parsed=new URL(text);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
 return {text,url,location:result.location};
}
module.exports={decodeQr};
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread&&workerData?.suiraQr){try{parentPort.postMessage(decodeQr(workerData.data,workerData.width,workerData.height));}catch{parentPort.postMessage(null);}}
function scanImage(image){
 if(!image||image.isEmpty?.()||typeof image.toBitmap!=='function')return Promise.resolve(null);
 let {width,height}=image.getSize();const scale=Math.min(1,1600/Math.max(width,height));if(scale<1)image=image.resize({width:Math.round(width*scale),height:Math.round(height*scale),quality:'best'});
 ({width,height}=image.getSize());const data=image.toBitmap();for(let i=0;i<data.length;i+=4){const blue=data[i];data[i]=data[i+2];data[i+2]=blue;}
 return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();resolve(value);};const worker=new Worker(__filename.replace(/app\.asar([\\/])/,'app.asar.unpacked$1'),{workerData:{suiraQr:true,data,width,height}}),timer=setTimeout(()=>finish(null),3000);worker.on('message',finish);worker.on('error',()=>finish(null));worker.on('exit',()=>finish(null));});
}
module.exports.scanImage=scanImage;
