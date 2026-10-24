'use strict';
const assert=require('node:assert/strict');
const {connect}=require('./runtime-client');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const root=await connect(9318,t=>t.url.endsWith('/island.html'));let page;try{
  await root.evaluate("window.suira.quick.showMain('library')");await wait(200);
  page=await connect(9318,t=>t.url.endsWith('/index.html'));await page.send('Page.reload');await wait(800);
  const result=await page.evaluate(`(async()=>{
    const items=await window.suira.content.list({limit:200});const item=items.find(x=>x.kind==='image'&&x.filePath&&x.meta?.width>320);
    if(!item)return {skipped:true};
    const before=state.items;state.items=items;openPreview(item.id);
    try {
      const image=document.querySelector('.preview-image');
      await new Promise(resolve=>{if(image.complete)resolve();else{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});}});
      const original=image.src.startsWith('file:')&&image.naturalWidth>320;
      document.getElementById('preview-pixels').click();await new Promise(r=>setTimeout(r,180));const rect=image.getBoundingClientRect();
      return {original,natural:image.naturalWidth,physicalWidth:Math.round(rect.width*devicePixelRatio),pixelMode:document.getElementById('preview-pixels').getAttribute('aria-pressed')==='true'};
    }finally{closePreview();state.items=before;}
  })()`);
  console.log(JSON.stringify(result));assert.ok(!result.skipped&&result.original&&result.pixelMode);assert.equal(result.physicalWidth,result.natural);
  console.log('PASS 实际图片预览加载原文件，原始像素模式按物理像素 1:1 显示');
}finally{page?.ws.close();root.ws.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
