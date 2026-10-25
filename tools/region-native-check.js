'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {ensureNativeHost}=require('../lib/key-watch'),{RegionCapture}=require('../lib/region-capture');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-long-capture-'));let worker;
(async()=>{
  const exe=await ensureNativeHost({sourcePath:path.resolve(__dirname,'../assets/capture-host.cs'),targetPath:path.join(tmp,'region.exe'),references:['System.Drawing.dll']});assert.ok(exe,'区域采集组件应可编译');
  worker=new RegionCapture(exe);
  // 只验证尺寸与通信，不记录或打印桌面像素，也不操作任何窗口。
  for(let i=0;i<2;i++){const frame=await worker.capture({x:0,y:0,width:40,height:40});assert.equal(frame.width,40);assert.equal(frame.height,40);const png=Buffer.from(frame.dataUrl.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),40);assert.equal(png.readUInt32BE(20),40);}
  console.log('PASS Windows 原生区域组件编译与连续 PNG 帧协议；未保存桌面画面');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{worker?.stop();await new Promise(r=>setTimeout(r,200));try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}});
