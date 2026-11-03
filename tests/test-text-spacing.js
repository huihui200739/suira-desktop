'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {compactCapture}=require('../src/text-spacing'),{OcrService}=require('../lib/ocr');
(async()=>{
  const raw='已 核 对， 本 轮 已 完 成：\r\n\r\n\r\n• 悬 浮 板 响 应 更 快\r\n \r\nHello world /api/v1\r\n\r\n  const x = 1;';
  assert.equal(compactCapture(raw),'已核对，本轮已完成：\n• 悬浮板响应更快\nHello world /api/v1\n  const x = 1;');
  assert.equal(compactCapture('第一行\n第二行'),'第一行\n第二行');
  assert.equal(compactCapture('你好 👋\n\nhttps://example.com/a?q=hello%20world'),'你好 👋\nhttps://example.com/a?q=hello%20world');
  assert.equal(compactCapture('   \r\n\t'),'');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'suira-ocr-')),file=path.join(dir,'image.png');fs.writeFileSync(file,'synthetic-image');
  const service=new OcrService({langPath:dir,cachePath:dir,idleMs:0});let recognized=0;
  service.ensureWorker=async()=>({recognize:async()=>{recognized++;return {data:{text:raw,blocks:[{text:raw,bbox:{x0:1,y0:2,x1:30,y1:40}}]}};}});
  try{const output=await service.recognizeFile(file);assert.equal(output.text,compactCapture(raw));assert.equal(output.blocks[0].text,output.text);assert.equal(output.blocks[0].bbox.x0,1);assert.equal((await service.recognizeFile(file)).text,output.text);assert.equal(recognized,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  console.log('PASS capture spacing: CJK, paragraphs, English/URL/code boundaries and OCR/cache pipeline');
})().catch(e=>{console.error(e);process.exitCode=1;});
